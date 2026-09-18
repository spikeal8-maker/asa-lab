-- E1-FIX-02 review corrections: durable generated-rotation replay,
-- batch preview reservation, and API-only automatic creation semantics.
-- Migration 0148 is historical and intentionally remains unchanged.

CREATE TABLE public.classroom_student_code_requests (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  classroom_id uuid NOT NULL,
  seat_id uuid NOT NULL REFERENCES public.classroom_student_seats(id),
  request_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id),
  request_kind varchar(16) NOT NULL CHECK (request_kind IN ('generated','explicit')),
  payload_digest varchar(64) NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  credential_version integer NOT NULL CHECK (credential_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seat_id,request_id),
  FOREIGN KEY (tenant_id,classroom_id) REFERENCES public.classrooms(tenant_id,id)
);
REVOKE ALL ON public.classroom_student_code_requests FROM PUBLIC,asalab_app;
ALTER TABLE public.classroom_student_code_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_student_code_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY classroom_student_code_requests_tenant
  ON public.classroom_student_code_requests
  USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
  WITH CHECK (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

ALTER TABLE public.classroom_student_seat_batches
  ADD COLUMN operation_state varchar(16) NOT NULL DEFAULT 'committed'
  CHECK (operation_state IN ('prepared','committed'));
ALTER TABLE public.classroom_student_seat_batch_rows
  DROP CONSTRAINT IF EXISTS classroom_student_seat_batch_rows_row_status_check;
ALTER TABLE public.classroom_student_seat_batch_rows
  ADD CONSTRAINT classroom_student_seat_batch_rows_row_status_check
  CHECK (row_status IN ('valid','created','duplicate','conflict','invalid'));

-- The old stateless preview can no longer back the HTTP preview contract.
REVOKE EXECUTE ON FUNCTION public.classroom_student_seat_batch_preview(uuid,uuid,jsonb)
  FROM asalab_app;
REVOKE EXECUTE ON FUNCTION public.classroom_student_seat_batch_commit(uuid,uuid,uuid,jsonb,jsonb)
  FROM asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_student_seat_batch_prepare_v2(
  p_account uuid,p_classroom uuid,p_request uuid,p_students jsonb
)
RETURNS TABLE(
  result_code varchar,reused boolean,row_index integer,display_label varchar,
  login_handle varchar,safe_mode boolean,row_status varchar,reason_code varchar
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_access record;
  v_digest varchar;
  v_existing public.classroom_student_seat_batches%ROWTYPE;
  v_item jsonb;
  v_ordinal bigint;
  v_index integer;
  v_label varchar;
  v_handle varchar;
  v_safe boolean;
  v_seen text[]:=ARRAY[]::text[];
  v_attempt integer;
BEGIN
  SELECT * INTO v_access
    FROM public.classroom_teacher_access(p_account,p_classroom);
  IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
  PERFORM set_config('app.tenant_id',v_access.tenant_id::text,true);

  IF p_request IS NULL OR p_students IS NULL OR jsonb_typeof(p_students)<>'array'
     OR jsonb_array_length(p_students)<1 OR jsonb_array_length(p_students)>100 THEN
    RETURN QUERY SELECT 'invalid_request'::varchar,false,NULL::integer,NULL::varchar,
      NULL::varchar,NULL::boolean,NULL::varchar,NULL::varchar;
    RETURN;
  END IF;

  v_digest:=encode(public.digest(convert_to(p_students::text,'UTF8'),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,2149));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_classroom::text,2149));

  SELECT * INTO v_existing
    FROM public.classroom_student_seat_batches batch
   WHERE batch.request_id=p_request
   FOR UPDATE;
  IF v_existing.request_id IS NOT NULL THEN
    IF v_existing.account_id IS DISTINCT FROM p_account
       OR v_existing.classroom_id IS DISTINCT FROM p_classroom
       OR v_existing.payload_digest IS DISTINCT FROM v_digest THEN
      RETURN QUERY SELECT 'request_conflict'::varchar,true,NULL::integer,NULL::varchar,
        NULL::varchar,NULL::boolean,NULL::varchar,NULL::varchar;
      RETURN;
    END IF;
    RETURN QUERY
      SELECT 'ok'::varchar,true,row.row_index,row.display_label,row.login_handle,
        row.safe_mode,row.row_status,row.reason_code
      FROM public.classroom_student_seat_batch_rows row
      WHERE row.request_id=p_request
      ORDER BY row.row_index;
    RETURN;
  END IF;

  INSERT INTO public.classroom_student_seat_batches(
    request_id,tenant_id,classroom_id,account_id,payload_digest,operation_state
  ) VALUES (
    p_request,v_access.tenant_id,p_classroom,p_account,v_digest,'prepared'
  );

  FOR v_item,v_ordinal IN
    SELECT item.value,item.ordinality
      FROM jsonb_array_elements(p_students) WITH ORDINALITY AS item(value,ordinality)
  LOOP
    v_index:=(v_ordinal-1)::integer;
    v_label:=NULL;
    v_handle:=NULL;
    v_safe:=NULL;

    IF jsonb_typeof(v_item)<>'object'
       OR jsonb_typeof(v_item->'displayLabel') IS DISTINCT FROM 'string' THEN
      INSERT INTO public.classroom_student_seat_batch_rows(
        tenant_id,request_id,row_index,row_status,reason_code
      ) VALUES (
        v_access.tenant_id,p_request,v_index,'invalid','invalid_row'
      );
      CONTINUE;
    END IF;

    IF v_item ? 'loginHandle' OR v_item ? 'studentCode' THEN
      INSERT INTO public.classroom_student_seat_batch_rows(
        tenant_id,request_id,row_index,row_status,reason_code,display_label
      ) VALUES (
        v_access.tenant_id,p_request,v_index,'invalid','student_code_not_allowed',
        trim(v_item->>'displayLabel')
      );
      CONTINUE;
    END IF;

    v_label:=trim(v_item->>'displayLabel');
    IF length(v_label)<1 OR length(v_label)>120 THEN
      INSERT INTO public.classroom_student_seat_batch_rows(
        tenant_id,request_id,row_index,row_status,reason_code,display_label
      ) VALUES (
        v_access.tenant_id,p_request,v_index,'invalid','invalid_label',v_label
      );
      CONTINUE;
    END IF;

    IF v_item ? 'safeMode' THEN
      IF jsonb_typeof(v_item->'safeMode')<>'boolean' THEN
        INSERT INTO public.classroom_student_seat_batch_rows(
          tenant_id,request_id,row_index,row_status,reason_code,display_label
        ) VALUES (
          v_access.tenant_id,p_request,v_index,'invalid','invalid_safe_mode',v_label
        );
        CONTINUE;
      END IF;
      v_safe:=(v_item->>'safeMode')::boolean;
    ELSE
      v_safe:=true;
    END IF;

    v_attempt:=0;
    LOOP
      v_handle:=public.classroom_student_code_random();
      EXIT WHEN NOT v_handle=ANY(v_seen)
        AND NOT EXISTS (
          SELECT 1 FROM public.classroom_student_seats seat
           WHERE seat.tenant_id=v_access.tenant_id
             AND seat.classroom_id=p_classroom
             AND seat.normalized_login_handle=v_handle
        )
        AND NOT EXISTS (
          SELECT 1
            FROM public.classroom_student_seat_batch_rows reserved
            JOIN public.classroom_student_seat_batches batch
              ON batch.request_id=reserved.request_id
           WHERE batch.tenant_id=v_access.tenant_id
             AND batch.classroom_id=p_classroom
             AND batch.operation_state='prepared'
             AND reserved.login_handle=v_handle
        );
      v_attempt:=v_attempt+1;
      IF v_attempt>1000 THEN RAISE EXCEPTION 'student code generation exhausted'; END IF;
    END LOOP;

    v_seen:=array_append(v_seen,v_handle);
    INSERT INTO public.classroom_student_seat_batch_rows(
      tenant_id,request_id,row_index,row_status,reason_code,
      display_label,login_handle,safe_mode
    ) VALUES (
      v_access.tenant_id,p_request,v_index,'valid','ready',
      v_label,v_handle,v_safe
    );
  END LOOP;

  RETURN QUERY
    SELECT 'ok'::varchar,false,row.row_index,row.display_label,row.login_handle,
      row.safe_mode,row.row_status,row.reason_code
    FROM public.classroom_student_seat_batch_rows row
    WHERE row.request_id=p_request
    ORDER BY row.row_index;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_seat_batch_prepare_v2(uuid,uuid,uuid,jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_seat_batch_prepare_v2(uuid,uuid,uuid,jsonb)
  TO asalab_app;

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
  v_prepare record;
  v_row record;
  v_hash varchar;
  v_seat record;
  v_issue record;
  v_existing_seat record;
  v_created integer:=0;
BEGIN
  SELECT * INTO v_access
    FROM public.classroom_teacher_access(p_account,p_classroom);
  IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
  PERFORM set_config('app.tenant_id',v_access.tenant_id::text,true);

  IF p_request IS NULL OR p_students IS NULL OR jsonb_typeof(p_students)<>'array'
     OR jsonb_array_length(p_students)<1 OR jsonb_array_length(p_students)>100 THEN
    RETURN QUERY SELECT 'invalid_request'::varchar,false,NULL::integer,NULL::varchar,NULL::varchar,
      NULL::varchar,NULL::varchar,NULL::boolean,NULL::uuid,NULL::integer;
    RETURN;
  END IF;

  v_digest:=encode(public.digest(convert_to(p_students::text,'UTF8'),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,2149));

  SELECT * INTO v_existing
    FROM public.classroom_student_seat_batches batch
   WHERE batch.request_id=p_request
   FOR UPDATE;

  IF v_existing.request_id IS NULL THEN
    FOR v_prepare IN
      SELECT * FROM public.classroom_student_seat_batch_prepare_v2(
        p_account,p_classroom,p_request,p_students
      )
    LOOP
      IF v_prepare.result_code<>'ok' THEN
        RETURN QUERY SELECT v_prepare.result_code::varchar,false,NULL::integer,
          NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,NULL::boolean,
          NULL::uuid,NULL::integer;
        RETURN;
      END IF;
    END LOOP;
    SELECT * INTO v_existing
      FROM public.classroom_student_seat_batches batch
     WHERE batch.request_id=p_request
     FOR UPDATE;
  END IF;

  IF v_existing.account_id IS DISTINCT FROM p_account
     OR v_existing.classroom_id IS DISTINCT FROM p_classroom
     OR v_existing.payload_digest IS DISTINCT FROM v_digest THEN
    RETURN QUERY SELECT 'request_conflict'::varchar,true,NULL::integer,NULL::varchar,NULL::varchar,
      NULL::varchar,NULL::varchar,NULL::boolean,NULL::uuid,NULL::integer;
    RETURN;
  END IF;

  IF v_existing.operation_state='committed' THEN
    RETURN QUERY
      SELECT 'ok'::varchar,true,row.row_index,row.row_status,row.reason_code,row.display_label,
        row.login_handle,row.safe_mode,row.seat_id,row.credential_version
      FROM public.classroom_student_seat_batch_rows row
      WHERE row.request_id=p_request
      ORDER BY row.row_index;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_classroom::text,2149));

  FOR v_row IN
    SELECT * FROM public.classroom_student_seat_batch_rows row
     WHERE row.request_id=p_request
     ORDER BY row.row_index
     FOR UPDATE
  LOOP
    IF v_row.row_status<>'valid' THEN CONTINUE; END IF;
    v_hash:=encode(public.digest(convert_to(v_row.login_handle,'UTF8'),'sha256'),'hex');
    BEGIN
      SELECT * INTO v_seat FROM public.classroom_management_add_seat(
        p_account,p_classroom,v_row.display_label,v_row.login_handle,v_row.safe_mode
      );
      SELECT * INTO v_issue FROM public.classroom_seat_credential_issue(
        p_account,p_classroom,v_seat.id,v_hash,p_request
      );
      IF v_issue.result_code<>'issued' THEN
        RAISE EXCEPTION 'batch student code issue failed: %',v_issue.result_code;
      END IF;
      UPDATE public.classroom_student_seat_batch_rows row
         SET row_status='created',reason_code='created',
             seat_id=v_seat.id,credential_version=v_issue.credential_version
       WHERE row.request_id=p_request AND row.row_index=v_row.row_index;
      v_created:=v_created+1;
    EXCEPTION WHEN unique_violation THEN
      SELECT seat.id,seat.display_label INTO v_existing_seat
        FROM public.classroom_student_seats seat
       WHERE seat.tenant_id=v_access.tenant_id
         AND seat.classroom_id=p_classroom
         AND seat.normalized_login_handle=v_row.login_handle
       LIMIT 1;
      IF v_existing_seat.id IS NULL THEN RAISE; END IF;
      UPDATE public.classroom_student_seat_batch_rows row
         SET row_status=CASE
               WHEN lower(trim(v_existing_seat.display_label))=lower(v_row.display_label)
                 THEN 'duplicate' ELSE 'conflict' END,
             reason_code=CASE
               WHEN lower(trim(v_existing_seat.display_label))=lower(v_row.display_label)
                 THEN 'existing_same_seat' ELSE 'student_code_in_use' END,
             seat_id=v_existing_seat.id
       WHERE row.request_id=p_request AND row.row_index=v_row.row_index;
    END;
  END LOOP;

  UPDATE public.classroom_student_seat_batches
     SET operation_state='committed'
   WHERE request_id=p_request;

  INSERT INTO public.audit_events(
    tenant_id,actor_user_id,entity_type,entity_id,action,payload_json
  ) VALUES (
    v_access.tenant_id,v_access.user_id,'classroom',p_classroom,
    'classroom.student_seat_batch_committed',
    jsonb_build_object('requestId',p_request,'created',v_created,'rows',jsonb_array_length(p_students))
  );

  RETURN QUERY
    SELECT 'ok'::varchar,false,row.row_index,row.row_status,row.reason_code,row.display_label,
      row.login_handle,row.safe_mode,row.seat_id,row.credential_version
    FROM public.classroom_student_seat_batch_rows row
    WHERE row.request_id=p_request
    ORDER BY row.row_index;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_seat_batch_commit_v2(uuid,uuid,uuid,jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_seat_batch_commit_v2(uuid,uuid,uuid,jsonb)
  TO asalab_app;

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
  v_payload_digest varchar;
  v_receipt integer;
  v_current_version integer;
  v_issue record;
  v_request public.classroom_student_code_requests%ROWTYPE;
BEGIN
  v_code:=trim(COALESCE(p_student_code,''));
  IF v_code !~ '^[A-Za-z0-9]{4,10}$' OR p_request IS NULL THEN
    RETURN QUERY SELECT 'invalid_request'::varchar,NULL::integer,false;
    RETURN;
  END IF;

  SELECT * INTO v_access
    FROM public.classroom_teacher_access(p_account,p_classroom);
  IF v_access.user_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::varchar,NULL::integer,false;
    RETURN;
  END IF;
  PERFORM set_config('app.tenant_id',v_access.tenant_id::text,true);

  SELECT seat.id,seat.tenant_id,seat.normalized_login_handle
    INTO v_seat
    FROM public.classroom_student_seats seat
   WHERE seat.id=p_seat
     AND seat.classroom_id=p_classroom
     AND seat.tenant_id=v_access.tenant_id
     AND seat.status<>'removed'
   FOR UPDATE;
  IF v_seat.id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::varchar,NULL::integer,false;
    RETURN;
  END IF;

  v_payload_digest:=encode(
    public.digest(convert_to('explicit:'||v_code,'UTF8'),'sha256'),'hex'
  );
  SELECT * INTO v_request
    FROM public.classroom_student_code_requests request
   WHERE request.seat_id=p_seat AND request.request_id=p_request;

  IF v_request.request_id IS NOT NULL THEN
    IF v_request.account_id IS DISTINCT FROM p_account
       OR v_request.classroom_id IS DISTINCT FROM p_classroom
       OR v_request.request_kind<>'explicit'
       OR v_request.payload_digest<>v_payload_digest THEN
      RETURN QUERY SELECT 'request_conflict'::varchar,v_request.credential_version,true;
      RETURN;
    END IF;
    SELECT cred.version INTO v_current_version
      FROM public.classroom_seat_credentials cred WHERE cred.seat_id=p_seat;
    IF v_current_version=v_request.credential_version
       AND v_seat.normalized_login_handle=v_code THEN
      RETURN QUERY SELECT 'ok'::varchar,v_current_version,true;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'request_conflict'::varchar,v_request.credential_version,true;
    RETURN;
  END IF;

  -- Backward-compatible replay protection for receipts created before this migration.
  SELECT receipt.version INTO v_receipt
    FROM public.classroom_seat_credential_receipts receipt
   WHERE receipt.seat_id=p_seat AND receipt.request_id=p_request;
  IF FOUND THEN
    SELECT cred.version INTO v_current_version
      FROM public.classroom_seat_credentials cred WHERE cred.seat_id=p_seat;
    IF v_seat.normalized_login_handle=v_code AND v_current_version=v_receipt THEN
      RETURN QUERY SELECT 'ok'::varchar,v_current_version,true;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'request_conflict'::varchar,v_receipt,true;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.classroom_student_seats other
     WHERE other.tenant_id=v_access.tenant_id
       AND other.classroom_id=p_classroom
       AND other.id<>p_seat
       AND other.normalized_login_handle=v_code
  ) THEN
    RETURN QUERY SELECT 'code_in_use'::varchar,NULL::integer,false;
    RETURN;
  END IF;

  v_hash:=encode(public.digest(convert_to(v_code,'UTF8'),'sha256'),'hex');
  SELECT cred.version INTO v_current_version
    FROM public.classroom_seat_credentials cred WHERE cred.seat_id=p_seat;

  IF v_seat.normalized_login_handle=v_code AND EXISTS (
    SELECT 1 FROM public.classroom_seat_credentials cred
     WHERE cred.seat_id=p_seat AND cred.credential_hash=v_hash
  ) THEN
    INSERT INTO public.classroom_student_code_requests(
      tenant_id,classroom_id,seat_id,request_id,account_id,request_kind,
      payload_digest,credential_version
    ) VALUES (
      v_access.tenant_id,p_classroom,p_seat,p_request,p_account,'explicit',
      v_payload_digest,v_current_version
    );
    RETURN QUERY SELECT 'ok'::varchar,v_current_version,false;
    RETURN;
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

  INSERT INTO public.classroom_student_code_requests(
    tenant_id,classroom_id,seat_id,request_id,account_id,request_kind,
    payload_digest,credential_version
  ) VALUES (
    v_access.tenant_id,p_classroom,p_seat,p_request,p_account,'explicit',
    v_payload_digest,v_issue.credential_version
  );
  INSERT INTO public.audit_events(
    tenant_id,actor_user_id,entity_type,entity_id,action,payload_json
  ) VALUES (
    v_access.tenant_id,v_access.user_id,'student_seat',p_seat,
    'seat.student_code_changed',
    jsonb_build_object('classroomId',p_classroom,'version',v_issue.credential_version,
      'requestId',p_request)
  );
  RETURN QUERY SELECT 'ok'::varchar,v_issue.credential_version,false;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_code_set(uuid,uuid,uuid,varchar,uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_code_set(uuid,uuid,uuid,varchar,uuid)
  TO asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_student_code_generate(
  p_account uuid,p_classroom uuid,p_seat uuid,p_request uuid
)
RETURNS TABLE(
  result_code varchar,student_code varchar,code_version integer,reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_access record;
  v_seat record;
  v_code varchar;
  v_hash varchar;
  v_payload_digest varchar;
  v_current_version integer;
  v_issue record;
  v_request public.classroom_student_code_requests%ROWTYPE;
  v_attempt integer:=0;
BEGIN
  IF p_request IS NULL THEN
    RETURN QUERY SELECT 'invalid_request'::varchar,NULL::varchar,NULL::integer,false;
    RETURN;
  END IF;

  SELECT * INTO v_access
    FROM public.classroom_teacher_access(p_account,p_classroom);
  IF v_access.user_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::varchar,NULL::varchar,NULL::integer,false;
    RETURN;
  END IF;
  PERFORM set_config('app.tenant_id',v_access.tenant_id::text,true);

  SELECT seat.id,seat.tenant_id,seat.normalized_login_handle
    INTO v_seat
    FROM public.classroom_student_seats seat
   WHERE seat.id=p_seat
     AND seat.classroom_id=p_classroom
     AND seat.tenant_id=v_access.tenant_id
     AND seat.status<>'removed'
   FOR UPDATE;
  IF v_seat.id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::varchar,NULL::varchar,NULL::integer,false;
    RETURN;
  END IF;

  v_payload_digest:=encode(
    public.digest(convert_to('generated','UTF8'),'sha256'),'hex'
  );
  SELECT * INTO v_request
    FROM public.classroom_student_code_requests request
   WHERE request.seat_id=p_seat AND request.request_id=p_request;

  IF v_request.request_id IS NOT NULL THEN
    IF v_request.account_id IS DISTINCT FROM p_account
       OR v_request.classroom_id IS DISTINCT FROM p_classroom
       OR v_request.request_kind<>'generated'
       OR v_request.payload_digest<>v_payload_digest THEN
      RETURN QUERY SELECT 'request_conflict'::varchar,NULL::varchar,
        v_request.credential_version,true;
      RETURN;
    END IF;
    SELECT cred.version INTO v_current_version
      FROM public.classroom_seat_credentials cred WHERE cred.seat_id=p_seat;
    IF v_current_version=v_request.credential_version THEN
      RETURN QUERY SELECT 'ok'::varchar,v_seat.normalized_login_handle,
        v_current_version,true;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'request_conflict'::varchar,NULL::varchar,
      v_request.credential_version,true;
    RETURN;
  END IF;

  -- A legacy receipt with no semantic metadata cannot safely be reinterpreted.
  IF EXISTS (
    SELECT 1 FROM public.classroom_seat_credential_receipts receipt
     WHERE receipt.seat_id=p_seat AND receipt.request_id=p_request
  ) THEN
    RETURN QUERY SELECT 'request_conflict'::varchar,NULL::varchar,NULL::integer,true;
    RETURN;
  END IF;

  LOOP
    v_code:=public.classroom_student_code_random();
    EXIT WHEN v_code<>v_seat.normalized_login_handle
      AND NOT EXISTS (
        SELECT 1 FROM public.classroom_student_seats other
         WHERE other.tenant_id=v_access.tenant_id
           AND other.classroom_id=p_classroom
           AND other.id<>p_seat
           AND other.normalized_login_handle=v_code
      );
    v_attempt:=v_attempt+1;
    IF v_attempt>1000 THEN RAISE EXCEPTION 'student code generation exhausted'; END IF;
  END LOOP;

  v_hash:=encode(public.digest(convert_to(v_code,'UTF8'),'sha256'),'hex');
  UPDATE public.classroom_student_seats
     SET login_handle=v_code,normalized_login_handle=v_code
   WHERE id=p_seat;

  SELECT * INTO v_issue FROM public.classroom_seat_credential_issue(
    p_account,p_classroom,p_seat,v_hash,p_request
  );
  IF v_issue.result_code<>'issued' THEN
    RAISE EXCEPTION 'student code credential rotation failed: %',v_issue.result_code;
  END IF;

  INSERT INTO public.classroom_student_code_requests(
    tenant_id,classroom_id,seat_id,request_id,account_id,request_kind,
    payload_digest,credential_version
  ) VALUES (
    v_access.tenant_id,p_classroom,p_seat,p_request,p_account,'generated',
    v_payload_digest,v_issue.credential_version
  );
  INSERT INTO public.audit_events(
    tenant_id,actor_user_id,entity_type,entity_id,action,payload_json
  ) VALUES (
    v_access.tenant_id,v_access.user_id,'student_seat',p_seat,
    'seat.student_code_changed',
    jsonb_build_object('classroomId',p_classroom,'version',v_issue.credential_version,
      'requestId',p_request,'generated',true)
  );

  RETURN QUERY SELECT 'ok'::varchar,v_code,v_issue.credential_version,false;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_code_generate(uuid,uuid,uuid,uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_code_generate(uuid,uuid,uuid,uuid)
  TO asalab_app;
