-- AI-STUDENT-ACCESS-003. Existing Account conversations keep their identifiers,
-- data and SQL entry points. School conversations belong to the existing Seat
-- principal, including after Account linkage; linking never moves a conversation.
ALTER TABLE ai_assistant_threads ADD COLUMN owner_principal_id uuid REFERENCES principals(id);
ALTER TABLE ai_assistant_messages ADD COLUMN owner_principal_id uuid REFERENCES principals(id);
ALTER TABLE ai_assistant_request_quota ADD COLUMN owner_principal_id uuid REFERENCES principals(id);
UPDATE ai_assistant_threads t SET owner_principal_id=p.id FROM principals p
 WHERE p.kind='account' AND p.account_id=t.account_id;
UPDATE ai_assistant_messages m SET owner_principal_id=p.id FROM principals p
 WHERE p.kind='account' AND p.account_id=m.account_id;
UPDATE ai_assistant_request_quota q SET owner_principal_id=p.id FROM principals p
 WHERE p.kind='account' AND p.account_id=q.account_id;
ALTER TABLE ai_assistant_threads ALTER COLUMN owner_principal_id SET NOT NULL;
ALTER TABLE ai_assistant_messages ALTER COLUMN owner_principal_id SET NOT NULL;
ALTER TABLE ai_assistant_request_quota ALTER COLUMN owner_principal_id SET NOT NULL;
ALTER TABLE ai_assistant_threads ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE ai_assistant_messages ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE ai_assistant_request_quota DROP CONSTRAINT ai_assistant_request_quota_pkey;
ALTER TABLE ai_assistant_request_quota ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE ai_assistant_request_quota ADD PRIMARY KEY(owner_principal_id,request_id);
ALTER TABLE ai_assistant_request_quota ADD UNIQUE(account_id,request_id);
ALTER TABLE ai_assistant_threads ADD UNIQUE(id,owner_principal_id);
ALTER TABLE ai_assistant_messages ADD CONSTRAINT ai_message_thread_owner_fk
 FOREIGN KEY(thread_id,owner_principal_id) REFERENCES ai_assistant_threads(id,owner_principal_id) ON DELETE CASCADE;
CREATE INDEX ai_assistant_threads_owner_idx ON ai_assistant_threads(owner_principal_id,updated_at DESC,id DESC);
CREATE INDEX ai_assistant_request_quota_owner_idx ON ai_assistant_request_quota(owner_principal_id,created_at DESC);
CREATE UNIQUE INDEX ai_assistant_owner_request_once_idx ON ai_assistant_messages(owner_principal_id,request_id) WHERE role='user';

-- The compatibility account_id is never an alternate owner. Legacy Account
-- inserts may omit owner_principal_id, but cannot forge a different owner.
CREATE FUNCTION ai_chat_row_owner_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_owner public.principals%ROWTYPE;
BEGIN
 IF NEW.owner_principal_id IS NULL AND NEW.account_id IS NOT NULL THEN
  SELECT id INTO NEW.owner_principal_id FROM public.principals WHERE kind='account' AND account_id=NEW.account_id;
 END IF;
 SELECT * INTO v_owner FROM public.principals WHERE id=NEW.owner_principal_id;
 IF NOT FOUND OR NOT (
  (v_owner.kind='account' AND NEW.account_id IS NOT NULL AND NEW.account_id=v_owner.account_id)
  OR (v_owner.kind='student_seat' AND NEW.account_id IS NULL AND v_owner.seat_id IS NOT NULL)
 ) THEN RAISE EXCEPTION 'AI_OWNER_INVALID' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.owner_principal_id IS DISTINCT FROM OLD.owner_principal_id
  OR NEW.account_id IS DISTINCT FROM OLD.account_id) THEN
  RAISE EXCEPTION 'AI_OWNER_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ai_threads_owner_check BEFORE INSERT OR UPDATE ON ai_assistant_threads
 FOR EACH ROW EXECUTE FUNCTION ai_chat_row_owner_check();
CREATE TRIGGER ai_messages_owner_check BEFORE INSERT OR UPDATE ON ai_assistant_messages
 FOR EACH ROW EXECUTE FUNCTION ai_chat_row_owner_check();
CREATE TRIGGER ai_quota_owner_check BEFORE INSERT OR UPDATE ON ai_assistant_request_quota
 FOR EACH ROW EXECUTE FUNCTION ai_chat_row_owner_check();
REVOKE ALL ON FUNCTION ai_chat_row_owner_check() FROM PUBLIC,asalab_app;

CREATE TABLE ai_classroom_policies (
 classroom_id uuid PRIMARY KEY REFERENCES classrooms(id),
 mode varchar(12) NOT NULL DEFAULT 'deny' CHECK(mode IN('deny','allow','rating')),
 minimum_rating integer NOT NULL DEFAULT 50 CHECK(minimum_rating BETWEEN 0 AND 100),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 updated_by uuid REFERENCES principals(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_seat_overrides (
 seat_id uuid PRIMARY KEY REFERENCES classroom_student_seats(id),
 mode varchar(12) NOT NULL CHECK(mode IN('allow','deny'))
);
CREATE TABLE ai_classroom_policy_receipts (
 classroom_id uuid NOT NULL REFERENCES classrooms(id), actor_id uuid NOT NULL REFERENCES principals(id),
 request_id uuid NOT NULL, payload jsonb NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(classroom_id,actor_id,request_id)
);

CREATE FUNCTION ai_chat_owner_valid(p_owner uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.principals p JOIN public.accounts a ON a.id=p.account_id
  WHERE p.id=p_owner AND p.kind='account' AND a.status='active')
 OR EXISTS(SELECT 1 FROM public.principals p JOIN public.classroom_student_seats s ON s.id=p.seat_id
  JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id
  WHERE p.id=p_owner AND p.kind='student_seat' AND s.status IN('issued','active') AND c.status='active');
$$;

-- Rating is the existing participant score (including its null state), not a
-- new grade calculation. No game/safe-mode policy is read or changed here.
CREATE FUNCTION ai_student_rule_allowed(p_mode varchar,p_override varchar,p_rating numeric,p_minimum integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE p_override WHEN 'allow' THEN true WHEN 'deny' THEN false
  ELSE CASE p_mode WHEN 'allow' THEN true WHEN 'rating' THEN COALESCE(p_rating>=p_minimum,false) ELSE false END END;
$$;
CREATE FUNCTION ai_student_access(p_seat uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH rule AS (SELECT s.id,s.status,c.status class_status,COALESCE(p.mode,'deny') mode,
  COALESCE(p.minimum_rating,50) minimum_rating,COALESCE(o.mode,'inherit') override,
  CASE WHEN COALESCE(p.mode,'deny')='rating' AND o.mode IS NULL THEN
   (SELECT (m.item->>'score')::numeric FROM public.classroom_participant_metrics(c.id) m WHERE m.item->>'seatId'=s.id::text)
  END rating
  FROM public.classroom_student_seats s JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id
  LEFT JOIN public.ai_classroom_policies p ON p.classroom_id=c.id LEFT JOIN public.ai_seat_overrides o ON o.seat_id=s.id
  WHERE s.id=p_seat)
 SELECT jsonb_build_object('canGenerate',status IN('issued','active') AND class_status='active'
   AND public.ai_student_rule_allowed(mode,override,rating,minimum_rating),
  'reason',CASE WHEN status NOT IN('issued','active') OR class_status<>'active' THEN 'ai_scope_inactive'
   WHEN public.ai_student_rule_allowed(mode,override,rating,minimum_rating) THEN NULL
   WHEN override='deny' THEN 'ai_seat_denied'
   WHEN mode='rating' AND override='inherit' AND rating IS NULL THEN 'ai_rating_unavailable'
   WHEN mode='rating' AND override='inherit' THEN 'ai_rating_required' ELSE 'ai_teacher_permission_required' END,
  'rating',rating,'minimumRating',minimum_rating) FROM rule;
$$;

-- Only the server supplies an authenticated actor. A Seat selector is not
-- authority: Account linkage is re-proved in the canonical learner graph on
-- every request. A Seat actor can select only itself. Teachers gain no read.
CREATE FUNCTION ai_access_owner(p_actor uuid,p_seat uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_actor public.principals%ROWTYPE; v_seat uuid; v_owner uuid;
BEGIN
 SELECT * INTO v_actor FROM public.principals WHERE id=p_actor;
 IF NOT FOUND OR NOT public.ai_chat_owner_valid(p_actor) THEN
  RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 IF v_actor.kind='account' AND p_seat IS NULL THEN RETURN p_actor; END IF;
 v_seat:=COALESCE(p_seat,v_actor.seat_id);
 IF v_actor.kind='student_seat' AND v_seat IS DISTINCT FROM v_actor.seat_id THEN
  RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.classroom_student_seats s JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id
  WHERE s.id=v_seat AND s.status IN('issued','active') AND c.status='active' FOR UPDATE OF s;
 IF NOT FOUND OR (v_actor.kind='account' AND NOT public.classroom_participant_owns(p_actor,v_seat)) THEN
  RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 SELECT id INTO v_owner FROM public.principals WHERE kind='student_seat' AND seat_id=v_seat;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 RETURN v_owner;
END;
$$;
-- Uses the same signed Seat session proof as SeatContextUseCase, but its
-- principal projection is read-only. Historical missing principals deny;
-- only the canonical new-Seat constructor initializes their identity.
CREATE FUNCTION ai_student_principal_existing(p_seat uuid)
RETURNS TABLE(principal_id uuid,tenant_id uuid,classroom_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT p.id,s.tenant_id,s.classroom_id FROM public.principals p
 JOIN public.classroom_student_seats s ON s.id=p.seat_id
 JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id
 WHERE s.id=p_seat AND p.kind='student_seat' AND s.status IN('issued','active') AND c.status='active';
$$;
CREATE FUNCTION ai_access_scopes(p_actor uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('personal',p.kind='account','items',COALESCE((SELECT jsonb_agg(
  jsonb_build_object('seatId',s.id,'classroomId',c.id,'classroomTitle',c.title,'displayName',s.display_label)
  ||public.ai_student_access(s.id) ORDER BY lower(c.title),c.id,s.id)
  FROM public.classroom_student_seats s JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id
  WHERE s.status IN('issued','active') AND c.status='active'
   AND EXISTS(SELECT 1 FROM public.principals owner WHERE owner.kind='student_seat' AND owner.seat_id=s.id) AND
   ((p.kind='student_seat' AND p.seat_id=s.id) OR (p.kind='account' AND s.account_id=p.account_id AND public.classroom_participant_owns(p_actor,s.id)))),'[]'::jsonb))
 FROM public.principals p WHERE p.id=p_actor AND public.ai_chat_owner_valid(p_actor);
$$;
CREATE FUNCTION ai_access_status(p_owner uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE p.kind WHEN 'account' THEN '{"canGenerate":true,"reason":null}'::jsonb ELSE public.ai_student_access(p.seat_id) END
 FROM public.principals p WHERE p.id=p_owner AND public.ai_chat_owner_valid(p_owner);
$$;

CREATE FUNCTION ai_classroom_access_teacher(p_actor uuid,p_class uuid,p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.principals p JOIN public.accounts a ON a.id=p.account_id AND a.status='active'
  JOIN public.classroom_memberships m ON m.account_id=a.id JOIN public.classrooms c ON c.id=m.classroom_id AND c.tenant_id=m.tenant_id
  WHERE p.id=p_actor AND p.kind='account' AND c.id=p_class AND m.member_role IN('owner','co_teacher')
   AND (c.status='active' OR (NOT p_write AND c.status='archived')));
$$;
CREATE FUNCTION ai_classroom_access_get(p_actor uuid,p_class uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
 IF NOT public.ai_classroom_access_teacher(p_actor,p_class,false) THEN RAISE EXCEPTION 'AI_TEACHER_DENIED' USING ERRCODE='42501'; END IF;
 -- Evaluate the class rating once, rather than once per participant row.
 WITH metrics AS MATERIALIZED(SELECT item FROM public.classroom_participant_metrics(p_class)),
 policy AS(SELECT c.status,COALESCE(p.mode,'deny') mode,COALESCE(p.minimum_rating,50) minimum_rating,COALESCE(p.revision,0) revision
  FROM public.classrooms c LEFT JOIN public.ai_classroom_policies p ON p.classroom_id=c.id WHERE c.id=p_class)
 SELECT jsonb_build_object('classroomId',p_class,'mode',p.mode,'minimumRating',p.minimum_rating,'revision',p.revision,'readOnly',p.status<>'active',
  'students',COALESCE((SELECT jsonb_agg(jsonb_build_object('seatId',s.id,'displayName',s.display_label,'status',s.status,
   'override',COALESCE(o.mode,'inherit'),'rating',(m.item->>'score')::numeric,'canGenerate',p.status='active' AND s.status IN('issued','active')
    AND public.ai_student_rule_allowed(p.mode,COALESCE(o.mode,'inherit'),(m.item->>'score')::numeric,p.minimum_rating)) ORDER BY lower(s.display_label),s.id)
   FROM public.classroom_student_seats s LEFT JOIN public.ai_seat_overrides o ON o.seat_id=s.id LEFT JOIN metrics m ON m.item->>'seatId'=s.id::text
   WHERE s.classroom_id=p_class AND s.status<>'removed'),'[]'::jsonb)) INTO v_result FROM policy p;
 RETURN v_result;
END;
$$;
CREATE FUNCTION ai_classroom_access_set(p_actor uuid,p_class uuid,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_class public.classrooms%ROWTYPE; v_prior public.ai_classroom_policy_receipts%ROWTYPE;
 v_revision bigint; v_request uuid; v_seat uuid; v_result jsonb;
BEGIN
 IF NOT public.ai_classroom_access_teacher(p_actor,p_class,true) THEN RAISE EXCEPTION 'AI_TEACHER_DENIED' USING ERRCODE='42501'; END IF;
 IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR length(p_input::text)>2000
  OR jsonb_typeof(p_input->'requestId') IS DISTINCT FROM 'string'
  OR (p_input->>'requestId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  OR jsonb_typeof(p_input->'expectedRevision') IS DISTINCT FROM 'number'
  OR (p_input->>'expectedRevision') !~ '^[0-9]{1,15}$' THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023'; END IF;
 v_request:=(p_input->>'requestId')::uuid;
 SELECT * INTO STRICT v_class FROM public.classrooms WHERE id=p_class FOR UPDATE;
 IF NOT public.ai_classroom_access_teacher(p_actor,p_class,true) THEN RAISE EXCEPTION 'AI_TEACHER_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_prior FROM public.ai_classroom_policy_receipts WHERE classroom_id=p_class AND actor_id=p_actor AND request_id=v_request;
 IF FOUND THEN
  IF v_prior.payload IS DISTINCT FROM p_input THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
  RETURN v_prior.result;
 END IF;
 INSERT INTO public.ai_classroom_policies(classroom_id) VALUES(p_class) ON CONFLICT DO NOTHING;
 SELECT revision INTO v_revision FROM public.ai_classroom_policies WHERE classroom_id=p_class;
 IF v_revision<>(p_input->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'AI_POLICY_CONFLICT' USING ERRCODE='40001'; END IF;
 IF p_input->>'kind'='classroom' THEN
  IF p_input - ARRAY['kind','requestId','expectedRevision','mode','minimumRating']<>'{}'::jsonb
   OR p_input->>'mode' IS NULL OR p_input->>'mode' NOT IN('deny','allow','rating')
   OR jsonb_typeof(p_input->'minimumRating') IS DISTINCT FROM 'number' OR (p_input->>'minimumRating') !~ '^[0-9]{1,3}$'
   OR (p_input->>'minimumRating')::integer NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023'; END IF;
  UPDATE public.ai_classroom_policies SET mode=p_input->>'mode',minimum_rating=(p_input->>'minimumRating')::integer WHERE classroom_id=p_class;
 ELSIF p_input->>'kind'='seat' THEN
  IF p_input - ARRAY['kind','requestId','expectedRevision','seatId','override']<>'{}'::jsonb
   OR p_input->>'override' IS NULL OR p_input->>'override' NOT IN('inherit','allow','deny')
   OR p_input->>'seatId' IS NULL OR (p_input->>'seatId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   THEN RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023'; END IF;
  v_seat:=(p_input->>'seatId')::uuid;
  PERFORM 1 FROM public.classroom_student_seats WHERE id=v_seat AND classroom_id=p_class AND tenant_id=v_class.tenant_id AND status<>'removed' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_TEACHER_DENIED' USING ERRCODE='42501'; END IF;
  IF p_input->>'override'='inherit' THEN DELETE FROM public.ai_seat_overrides WHERE seat_id=v_seat;
  ELSE INSERT INTO public.ai_seat_overrides(seat_id,mode) VALUES(v_seat,p_input->>'override')
   ON CONFLICT(seat_id) DO UPDATE SET mode=excluded.mode; END IF;
 ELSE RAISE EXCEPTION 'AI_POLICY_INVALID' USING ERRCODE='22023'; END IF;
 UPDATE public.ai_classroom_policies SET revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp() WHERE classroom_id=p_class RETURNING revision INTO v_revision;
 v_result:=jsonb_build_object('saved',true,'revision',v_revision);
 INSERT INTO public.ai_classroom_policy_receipts(classroom_id,actor_id,request_id,payload,result) VALUES(p_class,p_actor,v_request,p_input,v_result);
 INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
 VALUES(v_class.tenant_id,'classroom',p_class,'classroom.ai_access.update',jsonb_build_object('actorId',p_actor,'seatId',v_seat,'requestId',v_request,'revision',v_revision,'kind',p_input->>'kind'));
 RETURN v_result;
END;
$$;

DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['ai_classroom_policies','ai_seat_overrides','ai_classroom_policy_receipts',
  'ai_assistant_threads','ai_assistant_messages','ai_assistant_request_quota'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,asalab_app',name);
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION ai_chat_owner_valid(uuid),ai_student_rule_allowed(varchar,varchar,numeric,integer),ai_student_access(uuid),
 ai_classroom_access_teacher(uuid,uuid,boolean) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION ai_access_owner(uuid,uuid),ai_access_scopes(uuid),ai_access_status(uuid),
 ai_classroom_access_get(uuid,uuid),ai_classroom_access_set(uuid,uuid,jsonb),ai_student_principal_existing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_access_owner(uuid,uuid),ai_access_scopes(uuid),ai_access_status(uuid),
 ai_classroom_access_get(uuid,uuid),ai_classroom_access_set(uuid,uuid,jsonb),ai_student_principal_existing(uuid) TO asalab_app;

-- Serializes new generation with teacher changes. Revoking AI admission leaves
-- existing own history and cancellation available. An operation already
-- admitted may finish; neither revocation nor cancellation refunds its ledger.
CREATE FUNCTION ai_chat_require_generation(p_owner uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_actor public.principals%ROWTYPE; v_access jsonb;
BEGIN
 SELECT * INTO v_actor FROM public.principals WHERE id=p_owner;
 IF NOT FOUND OR NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 IF v_actor.kind='student_seat' THEN
  PERFORM 1 FROM public.classroom_student_seats s JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id
   WHERE s.id=v_actor.seat_id FOR SHARE OF c,s;
  v_access:=public.ai_student_access(v_actor.seat_id);
  IF COALESCE((v_access->>'canGenerate')::boolean,false) IS NOT true THEN
   RAISE EXCEPTION 'AI_STUDENT_DENIED' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN v_actor.account_id;
END;
$$;
REVOKE ALL ON FUNCTION ai_chat_require_generation(uuid) FROM PUBLIC,asalab_app;

CREATE OR REPLACE FUNCTION ai_chat_create(p_principal uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_id uuid;
BEGIN
    v_account:=public.ai_chat_require_generation(p_principal);
    INSERT INTO public.ai_assistant_threads(account_id,owner_principal_id)
      VALUES (v_account,p_principal) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION ai_chat_list(p_principal uuid)
RETURNS TABLE (id uuid, title varchar, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT t.id, t.title, t.updated_at
      FROM public.ai_assistant_threads t
      JOIN public.principals p ON p.id = t.owner_principal_id
     WHERE p.id = p_principal AND public.ai_chat_owner_valid(p.id)
     ORDER BY t.updated_at DESC, t.id DESC LIMIT 50
$$;

CREATE OR REPLACE FUNCTION ai_chat_messages(p_principal uuid, p_thread uuid)
RETURNS TABLE (
    id uuid, role varchar, content varchar, created_at timestamptz,
    request_id uuid, state varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT m.id, m.role, m.content, m.created_at, m.request_id, m.state
      FROM (
          SELECT msg.id, msg.role, msg.content, msg.created_at, msg.request_id, msg.state
            FROM public.ai_assistant_messages msg
            JOIN public.ai_assistant_threads t ON t.id = msg.thread_id
            JOIN public.principals p ON p.id = t.owner_principal_id
           WHERE p.id = p_principal AND public.ai_chat_owner_valid(p.id)
             AND msg.thread_id = p_thread AND msg.owner_principal_id = t.owner_principal_id
           ORDER BY msg.created_at DESC, msg.id DESC LIMIT 80
      ) m
     ORDER BY m.created_at ASC, m.id ASC
$$;

CREATE OR REPLACE FUNCTION ai_chat_rename(p_principal uuid, p_thread uuid, p_title varchar)
RETURNS TABLE (id uuid, title varchar, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF char_length(trim(p_title)) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'AI_TITLE_INVALID' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    UPDATE public.ai_assistant_threads t SET
        title = trim(p_title), updated_at = clock_timestamp()
      FROM public.principals p
     WHERE p.id = p_principal AND public.ai_chat_owner_valid(p.id)
       AND p.id = t.owner_principal_id AND t.id = p_thread
    RETURNING t.id, t.title, t.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION ai_chat_delete(p_principal uuid, p_thread uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH removed AS (
        DELETE FROM public.ai_assistant_threads t
        USING public.principals p
        WHERE p.id = p_principal AND public.ai_chat_owner_valid(p.id)
          AND p.id = t.owner_principal_id AND t.id = p_thread
          AND (t.busy_until IS NULL OR t.busy_until < clock_timestamp())
        RETURNING t.id
    )
    SELECT EXISTS (SELECT 1 FROM removed)
$$;

CREATE OR REPLACE FUNCTION ai_chat_list_page(
    p_principal uuid, p_before_at timestamptz, p_before_id uuid, p_limit integer
)
RETURNS TABLE (id uuid, title varchar, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT t.id, t.title, t.updated_at
      FROM public.ai_assistant_threads t
      JOIN public.principals p ON p.id = t.owner_principal_id
     WHERE p.id = p_principal AND public.ai_chat_owner_valid(p.id)
       AND (p_before_at IS NULL OR (t.updated_at, t.id) < (p_before_at, p_before_id))
     ORDER BY t.updated_at DESC, t.id DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 51)
$$;

CREATE OR REPLACE FUNCTION ai_chat_messages_page(
    p_principal uuid, p_thread uuid,
    p_before_at timestamptz, p_before_id uuid, p_limit integer
)
RETURNS TABLE (
    id uuid, role varchar, content varchar, created_at timestamptz,
    request_id uuid, state varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT m.id, m.role, m.content, m.created_at, m.request_id, m.state
      FROM (
        SELECT msg.id, msg.role, msg.content, msg.created_at, msg.request_id, msg.state
          FROM public.ai_assistant_messages msg
          JOIN public.ai_assistant_threads t ON t.id = msg.thread_id
          JOIN public.principals p ON p.id = t.owner_principal_id
         WHERE p.id = p_principal AND public.ai_chat_owner_valid(p.id)
           AND msg.thread_id = p_thread AND msg.owner_principal_id = t.owner_principal_id
           AND (p_before_at IS NULL OR
                (msg.created_at, msg.id) < (p_before_at, p_before_id))
         ORDER BY msg.created_at DESC, msg.id DESC
         LIMIT LEAST(GREATEST(p_limit, 1), 51)
      ) m
     ORDER BY m.created_at ASC, m.id ASC
$$;

CREATE OR REPLACE FUNCTION ai_chat_begin_paid(
    p_principal uuid, p_thread uuid, p_request uuid, p_text varchar, p_expected_version bigint
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_account uuid;
    v_existing_text varchar;
    v_existing_thread uuid;
    v_title varchar(120);
    v_config public.ai_assistant_config%ROWTYPE;
BEGIN
    IF char_length(trim(p_text)) NOT BETWEEN 1 AND 3000 THEN
        RAISE EXCEPTION 'AI_INPUT_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT p.account_id INTO v_account FROM public.principals p
     WHERE p.id = p_principal;
    IF NOT public.ai_chat_owner_valid(p_principal) THEN
        RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_principal::text, 7312));
    -- Replays are resolved before the busy/quota checks and never trigger another provider call.
    SELECT m.thread_id, m.content INTO v_existing_thread, v_existing_text
      FROM public.ai_assistant_messages m
     WHERE m.owner_principal_id = p_principal AND m.request_id = p_request AND m.role = 'user';
    IF FOUND THEN
        IF v_existing_thread <> p_thread OR v_existing_text <> trim(p_text) THEN
            RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE = '22023';
        END IF;
        RETURN false;
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.ai_assistant_request_quota q
         WHERE q.owner_principal_id = p_principal AND q.request_id = p_request
    ) THEN
        RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE = '22023';
    END IF;
    v_account:=public.ai_chat_require_generation(p_principal);
    IF (SELECT count(*) FROM public.ai_assistant_request_quota q
         WHERE q.owner_principal_id = p_principal
           AND q.created_at > now() - interval '1 hour') >= 30 THEN
        RAISE EXCEPTION 'AI_RATE_LIMIT' USING ERRCODE = 'P0001';
    END IF;
    -- Serialize settings changes with admission. Replays above remain free even
    -- when their runtime version is stale or the provider has been disabled.
    SELECT * INTO STRICT v_config
      FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
    IF p_expected_version IS DISTINCT FROM v_config.configuration_version THEN
        RAISE EXCEPTION 'AI_CONFIG_CHANGED';
    END IF;
    IF NOT v_config.enabled OR v_config.api_key_ciphertext IS NULL
       OR v_config.api_key_iv IS NULL OR v_config.api_key_auth_tag IS NULL THEN
        RAISE EXCEPTION 'AI_DISABLED';
    END IF;
    -- Replays above return before this shared, non-refundable reservation.
    -- A later failure rolls back admission and the messages together.
    PERFORM public.ai_paid_operation_reserve('chat');
    v_title := left(regexp_replace(trim(p_text), E'[\r\n]+', ' ', 'g'), 110);
    UPDATE public.ai_assistant_threads t SET
        busy_until = clock_timestamp() + interval '85 seconds',
        active_request_id = p_request,
        title = CASE WHEN t.title = 'Новый чат' THEN v_title ELSE t.title END,
        updated_at = clock_timestamp()
      WHERE t.id = p_thread AND t.owner_principal_id = p_principal
        AND (t.busy_until IS NULL OR t.busy_until < clock_timestamp());
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AI_THREAD_BUSY_OR_MISSING' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.ai_assistant_messages
        (thread_id, account_id, owner_principal_id, request_id, role, content)
      VALUES (p_thread, v_account, p_principal, p_request, 'user', trim(p_text));
    INSERT INTO public.ai_assistant_request_quota (account_id, owner_principal_id, request_id)
      VALUES (v_account, p_principal, p_request);
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION ai_chat_finish(
    p_principal uuid, p_thread uuid, p_request uuid, p_answer varchar,
    p_state varchar DEFAULT 'complete'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_inserted uuid;
BEGIN
    IF p_state NOT IN ('complete', 'stopped') OR
       char_length(p_answer) NOT BETWEEN 1 AND 8192 THEN
        RAISE EXCEPTION 'AI_RESPONSE_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT p.account_id INTO v_account FROM public.principals p
     WHERE p.id = p_principal;
    -- Serialise finish with the admission row. Expired workers cannot clear
    -- a newer in-flight request or attach an old answer to its thread.
    PERFORM 1 FROM public.ai_assistant_threads t
     WHERE t.id = p_thread AND t.owner_principal_id = p_principal
       AND t.active_request_id = p_request
     FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.ai_assistant_messages m
         WHERE m.thread_id = p_thread AND m.owner_principal_id = p_principal
           AND m.request_id = p_request AND m.role = 'user'
    ) THEN
        RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.ai_assistant_messages
        (thread_id, account_id, owner_principal_id, request_id, role, content, state)
      VALUES (p_thread, v_account, p_principal, p_request, 'assistant', p_answer, p_state)
      ON CONFLICT (thread_id, role, request_id) DO NOTHING
      RETURNING id INTO v_inserted;
    UPDATE public.ai_assistant_threads
       SET busy_until = NULL, active_request_id = NULL, updated_at = clock_timestamp()
     WHERE id = p_thread AND owner_principal_id = p_principal
       AND active_request_id = p_request;
    RETURN v_inserted IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION ai_chat_abort(p_principal uuid, p_thread uuid, p_request uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    UPDATE public.ai_assistant_threads t
       SET busy_until = NULL, active_request_id = NULL
     WHERE t.id = p_thread AND t.active_request_id = p_request AND EXISTS (
         SELECT 1 FROM public.principals p
          WHERE p.id = p_principal
            AND p.id = t.owner_principal_id
     ) AND EXISTS (
         SELECT 1 FROM public.ai_assistant_messages m
          WHERE m.thread_id = p_thread AND m.request_id = p_request
            AND m.role = 'user' AND m.owner_principal_id = t.owner_principal_id
     )
$$;
