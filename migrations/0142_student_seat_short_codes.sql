-- E1 StudentSeat access convergence: one short student code after the class code.
-- The existing Seat/LearnerIdentity/history remain unchanged. login_handle is retained as
-- the storage slot for the teacher-readable code, while classroom_seat_credentials keeps
-- the verifier/version used to invalidate sessions on rotation.

ALTER TABLE public.classroom_seat_credentials
  ALTER COLUMN issued_by_account_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.classroom_student_code_candidate(p_seed text, p_salt integer DEFAULT 0)
RETURNS varchar
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_hash bytea;
  v_alphabet constant text := '2346789acdefghjkmnpqrtuvwxy';
  v_code text := '';
  v_index integer;
BEGIN
  v_hash := public.digest(
    convert_to(COALESCE(p_seed,'') || ':' || COALESCE(p_salt,0)::text, 'UTF8'),
    'sha256'
  );
  FOR v_index IN 0..5 LOOP
    v_code := v_code || substr(
      v_alphabet,
      (get_byte(v_hash, v_index) % length(v_alphabet)) + 1,
      1
    );
  END LOOP;
  RETURN v_code::varchar;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_code_candidate(text,integer) FROM PUBLIC, asalab_app;

-- Existing StudentSeats receive a short code without changing seat ids or learning history.
-- Migrated credentials are system-issued, therefore issued_by_account_id may be NULL.
DO $$
DECLARE
  v_seat record;
  v_code varchar;
  v_salt integer;
  v_hash varchar;
  v_request uuid;
BEGIN
  FOR v_seat IN
    SELECT seat.id, seat.classroom_id
      FROM public.classroom_student_seats seat
     WHERE seat.status <> 'removed'
     ORDER BY seat.classroom_id, seat.id
  LOOP
    v_salt := 0;
    LOOP
      v_code := public.classroom_student_code_candidate(v_seat.id::text, v_salt);
      EXIT WHEN NOT EXISTS (
        SELECT 1
          FROM public.classroom_student_seats other
         WHERE other.classroom_id = v_seat.classroom_id
           AND other.id <> v_seat.id
           AND other.normalized_login_handle = v_code
      );
      v_salt := v_salt + 1;
      IF v_salt > 1000 THEN RAISE EXCEPTION 'student code generation exhausted'; END IF;
    END LOOP;

    UPDATE public.classroom_student_seats
       SET login_handle = v_code,
           normalized_login_handle = v_code
     WHERE id = v_seat.id;

    v_hash := encode(public.digest(convert_to(v_code,'UTF8'),'sha256'),'hex');
    v_request := gen_random_uuid();
    INSERT INTO public.classroom_seat_credentials(
      seat_id, credential_hash, version, last_request_id, issued_by_account_id, issued_at
    ) VALUES (
      v_seat.id, v_hash, 1, v_request, NULL, now()
    )
    ON CONFLICT (seat_id) DO UPDATE
      SET credential_hash = EXCLUDED.credential_hash,
          version = public.classroom_seat_credentials.version + 1,
          last_request_id = EXCLUDED.last_request_id,
          issued_at = now();

    UPDATE public.classroom_student_sessions
       SET revoked_at = now()
     WHERE seat_id = v_seat.id AND revoked_at IS NULL;
  END LOOP;
END;
$$;

-- Preview now creates a stable six-character code when the teacher supplies only a name.
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
  v_salt integer;
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
      RETURN QUERY SELECT v_index,v_label,NULL::varchar,v_safe,'invalid'::varchar,'invalid_student_code'::varchar;
      CONTINUE;
    END IF;
    v_requested:=lower(trim(COALESCE(v_item->>'loginHandle','')));
    IF v_requested='' THEN
      v_salt:=0;
      LOOP
        v_handle:=public.classroom_student_code_candidate(
          p_classroom::text||':'||v_index::text||':'||lower(v_label),v_salt
        );
        EXIT WHEN NOT v_handle=ANY(v_seen) AND NOT EXISTS (
          SELECT 1 FROM public.classroom_student_seats seat
           WHERE seat.tenant_id=v_access.tenant_id AND seat.classroom_id=p_classroom
             AND seat.normalized_login_handle=v_handle
        );
        v_salt:=v_salt+1;
        IF v_salt>1000 THEN RAISE EXCEPTION 'student code generation exhausted'; END IF;
      END LOOP;
    ELSE v_handle:=v_requested; END IF;
    IF v_handle !~ '^[2346789acdefghjkmnpqrtuvwxy]{6}$' THEN
      RETURN QUERY SELECT v_index,v_label,v_handle,v_safe,'invalid'::varchar,'invalid_student_code'::varchar;
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
        RETURN QUERY SELECT v_index,v_label,v_handle,v_safe,'conflict'::varchar,'student_code_in_use'::varchar;
      END IF;
      CONTINUE;
    END IF;
    RETURN QUERY SELECT v_index,v_label,v_handle,v_safe,'valid'::varchar,'ready'::varchar;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_seat_batch_preview(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_seat_batch_preview(uuid,uuid,jsonb) TO asalab_app;

-- V2 commits the exact code chosen inside the same transaction and derives its verifier
-- server-side. This removes the preview/commit race that can otherwise pair one visible
-- code with a verifier calculated for a different candidate.
CREATE OR REPLACE FUNCTION public.classroom_student_seat_batch_commit_v2(
  p_account uuid,p_classroom uuid,p_request uuid,p_students jsonb
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
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,2142));
  SELECT * INTO v_existing FROM public.classroom_student_seat_batches batch
    WHERE batch.request_id=p_request FOR UPDATE;
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
    v_hash:=encode(public.digest(convert_to(v_row.login_handle,'UTF8'),'sha256'),'hex');
    BEGIN
      SELECT * INTO v_seat FROM public.classroom_management_add_seat(
        p_account,p_classroom,v_row.display_label,v_row.login_handle,v_row.safe_mode);
      SELECT * INTO v_issue FROM public.classroom_seat_credential_issue(
        p_account,p_classroom,v_seat.id,v_hash,p_request);
      IF v_issue.result_code<>'issued' THEN RAISE EXCEPTION 'batch student code issue failed'; END IF;
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
        CASE WHEN lower(trim(v_existing_seat.display_label))=lower(v_row.display_label) THEN 'existing_same_seat' ELSE 'student_code_in_use' END,
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
REVOKE ALL ON FUNCTION public.classroom_student_seat_batch_commit_v2(uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_seat_batch_commit_v2(uuid,uuid,uuid,jsonb) TO asalab_app;

-- Atomic code rotation. The code itself is never written to audit payloads.
CREATE OR REPLACE FUNCTION public.classroom_student_code_set(
  p_account uuid,p_classroom uuid,p_seat uuid,p_student_code varchar,p_request uuid
)
RETURNS TABLE(result_code varchar,code_version integer,reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_access record;
  v_seat record;
  v_code varchar;
  v_hash varchar;
  v_receipt integer;
  v_current_version integer;
  v_issue record;
BEGIN
  v_code:=lower(trim(COALESCE(p_student_code,'')));
  IF v_code !~ '^[2346789acdefghjkmnpqrtuvwxy]{6}$' OR p_request IS NULL THEN
    RETURN QUERY SELECT 'invalid_request'::varchar,NULL::integer,false; RETURN;
  END IF;
  SELECT * INTO v_access FROM public.classroom_teacher_access(p_account,p_classroom);
  IF v_access.user_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::varchar,NULL::integer,false; RETURN;
  END IF;
  SELECT seat.id,seat.tenant_id,seat.normalized_login_handle
    INTO v_seat
    FROM public.classroom_student_seats seat
   WHERE seat.id=p_seat AND seat.classroom_id=p_classroom
     AND seat.tenant_id=v_access.tenant_id AND seat.status<>'removed'
   FOR UPDATE;
  IF v_seat.id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::varchar,NULL::integer,false; RETURN;
  END IF;

  SELECT receipt.version INTO v_receipt
    FROM public.classroom_seat_credential_receipts receipt
   WHERE receipt.seat_id=p_seat AND receipt.request_id=p_request;
  IF FOUND THEN
    SELECT cred.version INTO v_current_version
      FROM public.classroom_seat_credentials cred WHERE cred.seat_id=p_seat;
    IF v_seat.normalized_login_handle=v_code AND v_current_version=v_receipt THEN
      RETURN QUERY SELECT 'ok'::varchar,v_current_version,true; RETURN;
    END IF;
    RETURN QUERY SELECT 'request_conflict'::varchar,v_receipt,true; RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.classroom_student_seats other
     WHERE other.tenant_id=v_access.tenant_id AND other.classroom_id=p_classroom
       AND other.id<>p_seat AND other.normalized_login_handle=v_code
  ) THEN
    RETURN QUERY SELECT 'code_in_use'::varchar,NULL::integer,false; RETURN;
  END IF;

  v_hash:=encode(public.digest(convert_to(v_code,'UTF8'),'sha256'),'hex');
  SELECT cred.version INTO v_current_version
    FROM public.classroom_seat_credentials cred WHERE cred.seat_id=p_seat;
  IF v_seat.normalized_login_handle=v_code AND EXISTS (
    SELECT 1 FROM public.classroom_seat_credentials cred
     WHERE cred.seat_id=p_seat AND cred.credential_hash=v_hash
  ) THEN
    RETURN QUERY SELECT 'ok'::varchar,v_current_version,false; RETURN;
  END IF;

  UPDATE public.classroom_student_seats
     SET login_handle=v_code,normalized_login_handle=v_code
   WHERE id=p_seat;
  SELECT * INTO v_issue FROM public.classroom_seat_credential_issue(
    p_account,p_classroom,p_seat,v_hash,p_request
  );
  IF v_issue.result_code<>'issued' THEN
    RAISE EXCEPTION 'student code credential rotation failed: %',v_issue.result_code;
  END IF;
  INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
  VALUES(v_access.tenant_id,v_access.user_id,'student_seat',p_seat,'seat.student_code_changed',
    jsonb_build_object('classroomId',p_classroom,'version',v_issue.credential_version,'requestId',p_request));
  RETURN QUERY SELECT 'ok'::varchar,v_issue.credential_version,false;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_code_set(uuid,uuid,uuid,varchar,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_code_set(uuid,uuid,uuid,varchar,uuid) TO asalab_app;