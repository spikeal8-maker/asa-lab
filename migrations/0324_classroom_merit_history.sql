-- Classroom custom merit editing and historic grant/revocation read.
-- Additive migration: existing 0202 grants, receipt idempotency, forced RLS
-- and account/StudentSeat authorization are preserved.
CREATE FUNCTION public.classroom_participant_merit_update(
  p_actor uuid,
  p_class uuid,
  p_input jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_class public.classrooms%ROWTYPE;
  v_prior public.classroom_participant_receipts%ROWTYPE;
  v_id uuid;
  v_payload jsonb;
  v_result jsonb;
BEGIN
  IF p_input IS NULL
    OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR p_input - ARRAY['requestId','id','title','description'] <> '{}'::jsonb
    OR jsonb_typeof(p_input->'requestId') IS DISTINCT FROM 'string'
    OR COALESCE(p_input->>'requestId','') !~ '^[A-Za-z0-9._:-]{8,128}$'
    OR jsonb_typeof(p_input->'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_input->'title') IS DISTINCT FROM 'string'
    OR COALESCE(length(btrim(p_input->>'title')),0) NOT BETWEEN 1 AND 60
    OR p_input->>'title' ~ '[<>[:cntrl:]]'
    OR p_input->>'title' ~* '(https?://|www\.)'
    OR jsonb_typeof(p_input->'description') IS DISTINCT FROM 'string'
    OR length(p_input->>'description') > 240
    OR p_input->>'description' ~ '[<>[:cntrl:]]'
    OR p_input->>'description' ~* '(https?://|www\.)'
  THEN
    RETURN '{"error":"invalid_merit"}'::jsonb;
  END IF;

  BEGIN
    v_id := (p_input->>'id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN '{"error":"invalid_body"}'::jsonb;
  END;

  IF NOT public.classroom_journal_teacher(p_actor,p_class) THEN
    RETURN '{"error":"forbidden"}'::jsonb;
  END IF;

  SELECT * INTO v_class FROM public.classrooms WHERE id=p_class FOR UPDATE;
  IF v_class.status IS DISTINCT FROM 'active' THEN
    RETURN '{"error":"classroom_archived"}'::jsonb;
  END IF;

  v_payload := jsonb_build_object('action','merit_update','input',p_input);
  SELECT * INTO v_prior
  FROM public.classroom_participant_receipts
  WHERE classroom_id=p_class AND actor_id=p_actor
    AND request_id=p_input->>'requestId';
  IF FOUND THEN
    IF v_prior.payload <> v_payload THEN
      RETURN '{"error":"idempotency_conflict"}'::jsonb;
    END IF;
    RETURN v_prior.result;
  END IF;

  UPDATE public.classroom_custom_merits
  SET title=btrim(p_input->>'title'),
      description=p_input->>'description'
  WHERE classroom_id=p_class AND id=v_id;
  IF NOT FOUND THEN
    RETURN '{"error":"forbidden"}'::jsonb;
  END IF;

  v_result := jsonb_build_object('saved',true,'id',v_id);
  INSERT INTO public.classroom_participant_receipts(
    classroom_id,actor_id,request_id,payload,result
  ) VALUES(p_class,p_actor,p_input->>'requestId',v_payload,v_result);
  INSERT INTO public.audit_events(
    tenant_id,entity_type,entity_id,action,payload_json
  ) VALUES(
    v_class.tenant_id,'classroom',p_class,
    'classroom.participant.merit_update',
    jsonb_build_object('actorId',p_actor,'meritId',v_id,
      'requestId',p_input->>'requestId')
  );
  RETURN v_result;
END;
$$;

-- The original merit grants are persisted as one auditable receipt and an
-- immutable audit event per actual mutation. Historical reads join both
-- records; the current grants table alone would lose revoked awards.
CREATE FUNCTION public.classroom_participant_merit_history(
  p_actor uuid,
  p_class uuid,
  p_seat uuid,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
WITH history AS MATERIALIZED (
  SELECT event.id, event.created_at, merit.id AS merit_id, merit.title,
         (receipt.payload->'input'->>'granted')::boolean AS granted
  FROM public.audit_events event
  JOIN public.classroom_participant_receipts receipt
    ON receipt.classroom_id=p_class
   AND receipt.actor_id::text=event.payload_json->>'actorId'
   AND receipt.request_id=event.payload_json->>'requestId'
  JOIN public.classroom_custom_merits merit
    ON merit.classroom_id=p_class
   AND merit.id=(receipt.payload->'input'->>'id')::uuid
  WHERE event.entity_type='classroom'
    AND event.entity_id=p_class
    AND event.action='classroom.participant.merit_grant'
    AND receipt.payload->>'action'='merit_grant'
    AND (receipt.payload->'input'->>'seatId')::uuid=p_seat
    AND receipt.payload->'input'->>'granted' IN ('true','false')
  ORDER BY event.id DESC
  OFFSET p_offset LIMIT 51
)
SELECT jsonb_build_object(
  'items',COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'eventId',page.id,
      'meritId',page.merit_id,
      'title',page.title,
      'granted',page.granted,
      'at',page.created_at
    ) ORDER BY page.id DESC)
    FROM (SELECT * FROM history ORDER BY id DESC LIMIT 50) page
  ),'[]'::jsonb),
  'hasMore',(SELECT count(*) FROM history)>50,
  'offset',p_offset
)
WHERE p_offset BETWEEN 0 AND 100000
  AND public.classroom_participant_allowed(p_actor,p_class,p_seat);
$$;

REVOKE ALL ON FUNCTION
  public.classroom_participant_merit_update(uuid,uuid,jsonb),
  public.classroom_participant_merit_history(uuid,uuid,uuid,integer)
FROM PUBLIC,asalab_app;

GRANT EXECUTE ON FUNCTION
  public.classroom_participant_merit_update(uuid,uuid,jsonb),
  public.classroom_participant_merit_history(uuid,uuid,uuid,integer)
TO asalab_app;
