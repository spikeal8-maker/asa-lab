-- E1 Batch StudentSeat: authoritative preview, idempotent commit, no plaintext credential storage.

CREATE TABLE public.classroom_student_seat_batches (
  request_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  classroom_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  payload_digest varchar(64) NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,classroom_id) REFERENCES public.classrooms(tenant_id,id)
);

CREATE TABLE public.classroom_student_seat_batch_rows (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  request_id uuid NOT NULL REFERENCES public.classroom_student_seat_batches(request_id),
  row_index integer NOT NULL CHECK (row_index >= 0 AND row_index < 100),
  row_status varchar(16) NOT NULL CHECK (row_status IN ('created','duplicate','conflict','invalid')),
  reason_code varchar(48) NOT NULL,
  display_label varchar(120),
  login_handle varchar(32),
  safe_mode boolean,
  seat_id uuid REFERENCES public.classroom_student_seats(id),
  credential_version integer CHECK (credential_version IS NULL OR credential_version > 0),
  PRIMARY KEY (request_id,row_index),
  UNIQUE (tenant_id,request_id,row_index)
);

REVOKE ALL ON public.classroom_student_seat_batches,public.classroom_student_seat_batch_rows FROM PUBLIC,asalab_app;
ALTER TABLE public.classroom_student_seat_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_student_seat_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_student_seat_batch_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_student_seat_batch_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY classroom_student_seat_batches_tenant ON public.classroom_student_seat_batches
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY classroom_student_seat_batch_rows_tenant ON public.classroom_student_seat_batch_rows
 USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

CREATE OR REPLACE FUNCTION public.classroom_student_seat_batch_preview(
  p_account uuid,p_classroom uuid,p_students jsonb
)
RETURNS TABLE(
  row_index integer,display_label varchar,login_handle varchar,safe_mode boolean,
  row_status varchar,reason_code varchar
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_access record;
  v_item jsonb;
  v_ordinal bigint;
  v_index integer;
  v_label varchar;
  v_handle varchar;
  v_requested varchar;
  v_safe boolean;
  v_seen text[]:=ARRAY[]::text[];
  v_existing record;
BEGIN
  SELECT * INTO v_access FROM public.classroom_teacher_access(p_account,p_classroom);
  IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
  PERFORM set_config('app.tenant_id',v_access.tenant_id::text,true);
  IF p_students IS NULL OR jsonb_typeof(p_students)<>'array'
     OR jsonb_array_length(p_students)<1 OR jsonb_array_length(p_students)>100 THEN
    RAISE EXCEPTION 'invalid student seat batch';
  END IF;

  FOR v_item,v_ordinal IN
    SELECT item.value,item.ordinality FROM jsonb_array_elements(p_students) WITH ORDINALITY AS item(value,ordinality)
  LOOP
    v_index:=(v_ordinal-1)::integer;
    v_label:=NULL; v_handle:=NULL; v_requested:=NULL; v_safe:=NULL;
    IF jsonb_typeof(v_item)<>'object'
       OR jsonb_typeof(v_item->'displayLabel') IS DISTINCT FROM 'string' THEN
      RETURN QUERY SELECT v_index,NULL::varchar,NULL::varchar,NULL::boolean,'invalid'::varchar,'invalid_row'::varchar;
      CONTINUE;
    END IF;
    v_label:=trim(v_item->>'displayLabel');
    IF length(v_label)<1 OR length(v_label)>120 THEN
      RETURN QUERY SELECT v_index,v_label,NULL::varchar,NULL::boolean,'invalid'::varchar,'invalid_label'::varchar;
      CONTINUE;
    END IF;
    IF v_item ? 'safeMode' THEN
      IF jsonb_typeof(v_item->'safeMode')<>'boolean' THEN
        RETURN QUERY SELECT v_index,v_label,NULL::varchar,NULL::boolean,'invalid'::varchar,'invalid_safe_mode'::varchar;
        CONTINUE;
      END IF;
      v_safe:=(v_item->>'safeMode')::boolean;
    ELSE v_safe:=true; END IF;
    IF v_item ? 'loginHandle' AND jsonb_typeof(v_item->'loginHandle')<>'string' THEN
      RETURN QUERY SELECT v_index,v_label,NULL::varchar,v_safe,'invalid'::varchar,'invalid_handle'::varchar;
      CONTINUE;
    END IF;
    v_requested:=lower(trim(COALESCE(v_item->>'loginHandle','')));
    IF v_requested='' THEN
      v_handle:='seat-'||substr(encode(public.digest(convert_to(
        p_classroom::text||':'||v_index::text||':'||v_label,'UTF8'),'sha256'),'hex'),1,12);
    ELSE v_handle:=v_requested; END IF;
    IF v_handle !~ '^[a-z0-9._-]{3,32}$' THEN
      RETURN QUERY SELECT v_index,v_label,v_handle,v_safe,'invalid'::varchar,'invalid_handle'::varchar;
      CONTINUE;
    END IF;
    IF v_handle=ANY(v_seen) THEN
      RETURN QUERY SELECT v_index,v_label,v_handle,v_safe,'duplicate'::varchar,'duplicate_in_batch'::varchar;
      CONTINUE;
    END IF;
    v_seen:=array_append(v_seen,v_handle);
    SELECT seat.id,seat.display_label,seat.status INTO v_existing
      FROM public.classroom_student_seats seat
     WHERE seat.tenant_id=v_access.tenant_id AND seat.classroom_id=p_classroom
       AND seat.normalized_login_handle=v_handle
     LIMIT 1;
    IF v_existing.id IS NOT NULL THEN
      IF lower(trim(v_existing.display_label))=lower(v_label) THEN
        RETURN QUERY SELECT v_index,v_label,v_handle,v_safe,'duplicate'::varchar,'existing_same_seat'::varchar;
      ELSE
        RETURN QUERY SELECT v_index,v_label,v_handle,v_safe,'conflict'::varchar,'handle_in_use'::varchar;
      END IF;
      CONTINUE;
    END IF;
    RETURN QUERY SELECT v_index,v_label,v_handle,v_safe,'valid'::varchar,'ready'::varchar;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_seat_batch_preview(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_seat_batch_preview(uuid,uuid,jsonb) TO asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_student_seat_batch_commit(
  p_account uuid,p_classroom uuid,p_request uuid,p_students jsonb,p_credential_hashes jsonb
)
RETURNS TABLE(
  result_code varchar,reused boolean,row_index integer,row_status varchar,reason_code varchar,
  display_label varchar,login_handle varchar,safe_mode boolean,seat_id uuid,credential_version integer
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_access record;
  v_digest varchar;
  v_existing public.classroom_student_seat_batches%ROWTYPE;
  v_row record;
  v_hash varchar;
  v_seat record;
  v_issue record;
  v_existing_seat record;
  v_created integer:=0;
BEGIN
  SELECT * INTO v_access FROM public.classroom_teacher_access(p_account,p_classroom);
  IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
  PERFORM set_config('app.tenant_id',v_access.tenant_id::text,true);
  IF p_request IS NULL OR p_students IS NULL OR jsonb_typeof(p_students)<>'array'
     OR jsonb_array_length(p_students)<1 OR jsonb_array_length(p_students)>100 THEN
    RETURN QUERY SELECT 'invalid_request'::varchar,false,NULL::integer,NULL::varchar,NULL::varchar,
      NULL::varchar,NULL::varchar,NULL::boolean,NULL::uuid,NULL::integer; RETURN;
  END IF;
  v_digest:=encode(public.digest(convert_to(p_students::text,'UTF8'),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,1135));
  SELECT * INTO v_existing FROM public.classroom_student_seat_batches batch WHERE batch.request_id=p_request FOR UPDATE;
  IF v_existing.request_id IS NOT NULL THEN
    IF v_existing.account_id IS DISTINCT FROM p_account OR v_existing.classroom_id IS DISTINCT FROM p_classroom
       OR v_existing.payload_digest IS DISTINCT FROM v_digest THEN
      RETURN QUERY SELECT 'request_conflict'::varchar,true,NULL::integer,NULL::varchar,NULL::varchar,
        NULL::varchar,NULL::varchar,NULL::boolean,NULL::uuid,NULL::integer; RETURN;
    END IF;
    RETURN QUERY
      SELECT 'ok'::varchar,true,row.row_index,row.row_status,row.reason_code,row.display_label,
        row.login_handle,row.safe_mode,row.seat_id,row.credential_version
      FROM public.classroom_student_seat_batch_rows row
      WHERE row.request_id=p_request ORDER BY row.row_index;
    RETURN;
  END IF;
  IF p_credential_hashes IS NULL OR jsonb_typeof(p_credential_hashes)<>'array' THEN
    RETURN QUERY SELECT 'invalid_credentials'::varchar,false,NULL::integer,NULL::varchar,NULL::varchar,
      NULL::varchar,NULL::varchar,NULL::boolean,NULL::uuid,NULL::integer; RETURN;
  END IF;
  FOR v_row IN SELECT * FROM public.classroom_student_seat_batch_preview(p_account,p_classroom,p_students) LOOP
    IF v_row.row_status='valid' THEN
      SELECT cred.value->>'hash' INTO v_hash
      FROM jsonb_array_elements(p_credential_hashes) cred(value)
      WHERE cred.value->>'index' ~ '^\d+$' AND (cred.value->>'index')::integer=v_row.row_index
      LIMIT 1;
      IF v_hash IS NULL OR v_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN QUERY SELECT 'invalid_credentials'::varchar,false,NULL::integer,NULL::varchar,NULL::varchar,
          NULL::varchar,NULL::varchar,NULL::boolean,NULL::uuid,NULL::integer; RETURN;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.classroom_student_seat_batches(request_id,tenant_id,classroom_id,account_id,payload_digest)
  VALUES(p_request,v_access.tenant_id,p_classroom,p_account,v_digest);

  FOR v_row IN SELECT * FROM public.classroom_student_seat_batch_preview(p_account,p_classroom,p_students) LOOP
    IF v_row.row_status<>'valid' THEN
      INSERT INTO public.classroom_student_seat_batch_rows(
        tenant_id,request_id,row_index,row_status,reason_code,display_label,login_handle,safe_mode)
      VALUES(v_access.tenant_id,p_request,v_row.row_index,v_row.row_status,v_row.reason_code,
        v_row.display_label,v_row.login_handle,v_row.safe_mode);
      CONTINUE;
    END IF;
    SELECT cred.value->>'hash' INTO v_hash
      FROM jsonb_array_elements(p_credential_hashes) cred(value)
      WHERE cred.value->>'index' ~ '^\d+$' AND (cred.value->>'index')::integer=v_row.row_index
      LIMIT 1;
    BEGIN
      SELECT * INTO v_seat FROM public.classroom_management_add_seat(
        p_account,p_classroom,v_row.display_label,v_row.login_handle,v_row.safe_mode);
      SELECT * INTO v_issue FROM public.classroom_seat_credential_issue(
        p_account,p_classroom,v_seat.id,v_hash,p_request);
      IF v_issue.result_code<>'issued' THEN RAISE EXCEPTION 'batch credential issue failed'; END IF;
      INSERT INTO public.classroom_student_seat_batch_rows(
        tenant_id,request_id,row_index,row_status,reason_code,display_label,login_handle,safe_mode,seat_id,credential_version)
      VALUES(v_access.tenant_id,p_request,v_row.row_index,'created','created',v_row.display_label,
        v_row.login_handle,v_row.safe_mode,v_seat.id,v_issue.credential_version);
      v_created:=v_created+1;
    EXCEPTION WHEN unique_violation THEN
      SELECT seat.id,seat.display_label INTO v_existing_seat
      FROM public.classroom_student_seats seat
      WHERE seat.tenant_id=v_access.tenant_id AND seat.classroom_id=p_classroom
        AND seat.normalized_login_handle=v_row.login_handle LIMIT 1;
      IF v_existing_seat.id IS NULL THEN RAISE; END IF;
      INSERT INTO public.classroom_student_seat_batch_rows(
        tenant_id,request_id,row_index,row_status,reason_code,display_label,login_handle,safe_mode,seat_id)
      VALUES(v_access.tenant_id,p_request,v_row.row_index,
        CASE WHEN lower(trim(v_existing_seat.display_label))=lower(v_row.display_label) THEN 'duplicate' ELSE 'conflict' END,
        CASE WHEN lower(trim(v_existing_seat.display_label))=lower(v_row.display_label) THEN 'existing_same_seat' ELSE 'handle_in_use' END,
        v_row.display_label,v_row.login_handle,v_row.safe_mode,v_existing_seat.id);
    END;
  END LOOP;

  INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
  VALUES(v_access.tenant_id,v_access.user_id,'classroom',p_classroom,'classroom.student_seat_batch_committed',
    jsonb_build_object('requestId',p_request,'created',v_created,'rows',jsonb_array_length(p_students)));

  RETURN QUERY
    SELECT 'ok'::varchar,false,row.row_index,row.row_status,row.reason_code,row.display_label,
      row.login_handle,row.safe_mode,row.seat_id,row.credential_version
    FROM public.classroom_student_seat_batch_rows row
    WHERE row.request_id=p_request ORDER BY row.row_index;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_seat_batch_commit(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_seat_batch_commit(uuid,uuid,uuid,jsonb,jsonb) TO asalab_app;
