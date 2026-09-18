-- E1-FIX-02 additive Student Code runtime contract.
-- Historical migrations remain unchanged; protected credential storage is a separate bounded slice.

-- CSPRNG source for automatic Student Codes. Rejection sampling avoids modulo bias.
CREATE OR REPLACE FUNCTION public.classroom_student_code_random()
RETURNS varchar
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE
SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_alphabet constant text := '2346789ACDEFGHJKMNPQRTUVWXYacdefghjkmnpqrtuvwxy';
  v_code text := '';
  v_byte integer;
  v_limit integer := (256 / length(v_alphabet)) * length(v_alphabet);
BEGIN
  WHILE length(v_code) < 6 LOOP
    v_byte := get_byte(uuid_send(gen_random_uuid()), 0);
    IF v_byte >= v_limit THEN CONTINUE; END IF;
    v_code := v_code || substr(v_alphabet,(v_byte % length(v_alphabet))+1,1);
  END LOOP;
  RETURN v_code::varchar;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_code_random() FROM PUBLIC, asalab_app;

-- Keep existing owner + co_teacher exact-class authorization, but preserve code case.
CREATE OR REPLACE FUNCTION public.classroom_management_add_seat(
  p_account_id uuid,p_classroom_id uuid,p_display_label varchar,
  p_login_handle varchar,p_safe_mode boolean
)
RETURNS TABLE (
  id uuid,display_label varchar,login_handle varchar,safe_mode boolean,
  status varchar,avatar_key varchar,last_active_at timestamptz,created_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_access record; v_seat_id uuid; v_code varchar;
BEGIN
  v_code:=trim(COALESCE(p_login_handle,''));
  IF v_code !~ '^[A-Za-z0-9]{4,10}$' THEN RAISE EXCEPTION 'invalid student code'; END IF;
  SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id,p_classroom_id);
  IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
  INSERT INTO public.classroom_student_seats(
    tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,created_by
  ) VALUES (
    v_access.tenant_id,p_classroom_id,trim(p_display_label),v_code,
    v_code,p_safe_mode,v_access.user_id
  ) RETURNING classroom_student_seats.id INTO v_seat_id;
  INSERT INTO public.audit_events(
    tenant_id,actor_user_id,entity_type,entity_id,action,payload_json
  ) VALUES (
    v_access.tenant_id,v_access.user_id,'student_seat',v_seat_id,
    'classroom.student_seat_created',
    jsonb_build_object('classroomId',p_classroom_id,'safeMode',p_safe_mode,
      'teacherRole',v_access.teacher_role)
  );
  RETURN QUERY
    SELECT s.id,s.display_label,s.login_handle,s.safe_mode,s.status,s.avatar_key,
      s.last_active_at,s.created_at
    FROM public.classroom_student_seats s WHERE s.id=v_seat_id;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_management_add_seat(uuid,uuid,varchar,varchar,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_management_add_seat(uuid,uuid,varchar,varchar,boolean) TO asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_management_update_seat(
  p_account_id uuid,p_classroom_id uuid,p_seat_id uuid,p_display_label varchar,
  p_login_handle varchar,p_safe_mode boolean,p_status varchar,p_avatar_key varchar
)
RETURNS TABLE (
  id uuid,display_label varchar,login_handle varchar,safe_mode boolean,
  status varchar,avatar_key varchar,last_active_at timestamptz,created_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_access record; v_updated integer:=0; v_current_code varchar;
BEGIN
  IF p_status NOT IN ('issued','active','suspended') THEN RAISE EXCEPTION 'invalid seat status'; END IF;
  SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id,p_classroom_id);
  IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
  SELECT s.login_handle INTO v_current_code
    FROM public.classroom_student_seats s
    WHERE s.tenant_id=v_access.tenant_id AND s.classroom_id=p_classroom_id
      AND s.id=p_seat_id AND s.status<>'removed'
    FOR UPDATE;
  IF v_current_code IS NULL THEN RAISE EXCEPTION 'student seat unavailable'; END IF;
  IF trim(p_login_handle) IS DISTINCT FROM v_current_code THEN
    RAISE EXCEPTION 'student code requires rotation';
  END IF;
  UPDATE public.classroom_student_seats s
    SET display_label=trim(p_display_label),safe_mode=p_safe_mode,status=p_status,
      avatar_key=p_avatar_key,updated_at=now()
    WHERE s.tenant_id=v_access.tenant_id AND s.classroom_id=p_classroom_id
      AND s.id=p_seat_id AND s.status<>'removed';
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated=0 THEN RAISE EXCEPTION 'student seat unavailable'; END IF;
  IF p_status='suspended' THEN
    UPDATE public.classroom_student_sessions ss SET revoked_at=now()
      WHERE ss.seat_id=p_seat_id AND ss.revoked_at IS NULL;
  END IF;
  INSERT INTO public.audit_events(
    tenant_id,actor_user_id,entity_type,entity_id,action,payload_json
  ) VALUES (
    v_access.tenant_id,v_access.user_id,'student_seat',p_seat_id,
    'classroom.student_seat_updated',
    jsonb_build_object('classroomId',p_classroom_id,'safeMode',p_safe_mode,
      'status',p_status,'avatarKey',p_avatar_key,'teacherRole',v_access.teacher_role)
  );
  RETURN QUERY
    SELECT s.id,s.display_label,s.login_handle,s.safe_mode,s.status,s.avatar_key,
      s.last_active_at,s.created_at
    FROM public.classroom_student_seats s WHERE s.id=p_seat_id;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_management_update_seat(
  uuid,uuid,uuid,varchar,varchar,boolean,varchar,varchar
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_management_update_seat(
  uuid,uuid,uuid,varchar,varchar,boolean,varchar,varchar
) TO asalab_app;

-- Preview validates staff-entered codes case-sensitively and uses CSPRNG for automatic rows.
CREATE OR REPLACE FUNCTION public.classroom_student_seat_batch_preview(
  p_account uuid,p_classroom uuid,p_students jsonb
)
RETURNS TABLE(
  row_index integer,display_label varchar,login_handle varchar,safe_mode boolean,
  row_status varchar,reason_code varchar
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_access record; v_item jsonb; v_ordinal bigint; v_index integer;
  v_label varchar; v_handle varchar; v_requested varchar; v_safe boolean;
  v_seen text[]:=ARRAY[]::text[]; v_existing record; v_attempt integer;
BEGIN
  SELECT * INTO v_access FROM public.classroom_teacher_access(p_account,p_classroom);
  IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
  PERFORM set_config('app.tenant_id',v_access.tenant_id::text,true);
  IF p_students IS NULL OR jsonb_typeof(p_students)<>'array'
     OR jsonb_array_length(p_students)<1 OR jsonb_array_length(p_students)>100 THEN
    RAISE EXCEPTION 'invalid student seat batch';
  END IF;
  FOR v_item,v_ordinal IN
    SELECT item.value,item.ordinality
    FROM jsonb_array_elements(p_students) WITH ORDINALITY AS item(value,ordinality)
  LOOP
    v_index:=(v_ordinal-1)::integer;
    v_label:=NULL; v_handle:=NULL; v_requested:=NULL; v_safe:=NULL;
    IF jsonb_typeof(v_item)<>'object'
       OR jsonb_typeof(v_item->'displayLabel') IS DISTINCT FROM 'string' THEN
      RETURN QUERY SELECT v_index,NULL::varchar,NULL::varchar,NULL::boolean,
        'invalid'::varchar,'invalid_row'::varchar; CONTINUE;
    END IF;
    v_label:=trim(v_item->>'displayLabel');
    IF length(v_label)<1 OR length(v_label)>120 THEN
      RETURN QUERY SELECT v_index,v_label,NULL::varchar,NULL::boolean,
        'invalid'::varchar,'invalid_label'::varchar; CONTINUE;
    END IF;
    IF v_item ? 'safeMode' THEN
      IF jsonb_typeof(v_item->'safeMode')<>'boolean' THEN
        RETURN QUERY SELECT v_index,v_label,NULL::varchar,NULL::boolean,
          'invalid'::varchar,'invalid_safe_mode'::varchar; CONTINUE;
      END IF;
      v_safe:=(v_item->>'safeMode')::boolean;
    ELSE v_safe:=true; END IF;
    IF v_item ? 'loginHandle' AND jsonb_typeof(v_item->'loginHandle')<>'string' THEN
      RETURN QUERY SELECT v_index,v_label,NULL::varchar,v_safe,
        'invalid'::varchar,'invalid_student_code'::varchar; CONTINUE;
    END IF;
    v_requested:=trim(COALESCE(v_item->>'loginHandle',''));
    IF v_requested='' THEN
      v_attempt:=0;
      LOOP
        v_handle:=public.classroom_student_code_random();
        EXIT WHEN NOT v_handle=ANY(v_seen) AND NOT EXISTS (
          SELECT 1 FROM public.classroom_student_seats seat
          WHERE seat.tenant_id=v_access.tenant_id AND seat.classroom_id=p_classroom
            AND seat.normalized_login_handle=v_handle
        );
        v_attempt:=v_attempt+1;
        IF v_attempt>1000 THEN RAISE EXCEPTION 'student code generation exhausted'; END IF;
      END LOOP;
    ELSE
      v_handle:=v_requested;
    END IF;
    IF v_handle !~ '^[A-Za-z0-9]{4,10}$' THEN
      RETURN QUERY SELECT v_index,v_label,v_handle,v_safe,
        'invalid'::varchar,'invalid_student_code'::varchar; CONTINUE;
    END IF;
    IF v_handle=ANY(v_seen) THEN
      RETURN QUERY SELECT v_index,v_label,v_handle,v_safe,
        'duplicate'::varchar,'duplicate_in_batch'::varchar; CONTINUE;
    END IF;
    v_seen:=array_append(v_seen,v_handle);
    SELECT seat.id,seat.display_label,seat.status INTO v_existing
      FROM public.classroom_student_seats seat
      WHERE seat.tenant_id=v_access.tenant_id AND seat.classroom_id=p_classroom
        AND seat.normalized_login_handle=v_handle
      LIMIT 1;
    IF v_existing.id IS NOT NULL THEN
      IF lower(trim(v_existing.display_label))=lower(v_label) THEN
        RETURN QUERY SELECT v_index,v_label,v_handle,v_safe,
          'duplicate'::varchar,'existing_same_seat'::varchar;
      ELSE
        RETURN QUERY SELECT v_index,v_label,v_handle,v_safe,
          'conflict'::varchar,'student_code_in_use'::varchar;
      END IF;
      CONTINUE;
    END IF;
    RETURN QUERY SELECT v_index,v_label,v_handle,v_safe,'valid'::varchar,'ready'::varchar;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_seat_batch_preview(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_seat_batch_preview(uuid,uuid,jsonb) TO asalab_app;

-- Atomic case-sensitive rotation. classroom_seat_credential_issue increments version
-- and revokes every active StudentSeat session for the same seat.
CREATE OR REPLACE FUNCTION public.classroom_student_code_set(
  p_account uuid,p_classroom uuid,p_seat uuid,p_student_code varchar,p_request uuid
)
RETURNS TABLE(result_code varchar,code_version integer,reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_access record; v_seat record; v_code varchar; v_hash varchar;
  v_receipt integer; v_current_version integer; v_issue record;
BEGIN
  v_code:=trim(COALESCE(p_student_code,''));
  IF v_code !~ '^[A-Za-z0-9]{4,10}$' OR p_request IS NULL THEN
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
  INSERT INTO public.audit_events(
    tenant_id,actor_user_id,entity_type,entity_id,action,payload_json
  ) VALUES (
    v_access.tenant_id,v_access.user_id,'student_seat',p_seat,'seat.student_code_changed',
    jsonb_build_object('classroomId',p_classroom,'version',v_issue.credential_version,
      'requestId',p_request)
  );
  RETURN QUERY SELECT 'ok'::varchar,v_issue.credential_version,false;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_code_set(uuid,uuid,uuid,varchar,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_code_set(uuid,uuid,uuid,varchar,uuid) TO asalab_app;
-- Case-sensitive four-argument primitive; runtime permission remains revoked.
CREATE OR REPLACE FUNCTION public.classroom_student_seat_sign_in(
  p_token_hash varchar,p_login_handle varchar,p_session_token_hash varchar,p_ttl_hours integer
)
RETURNS TABLE(
  seat_id uuid,classroom_id uuid,classroom_title varchar,display_label varchar,
  teacher_display_name varchar,safe_mode boolean,avatar_key varchar,expires_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_seat_id uuid; v_classroom_id uuid; v_classroom_title varchar; v_display_label varchar;
  v_teacher_display_name varchar; v_safe_mode boolean; v_avatar_key varchar; v_expires_at timestamptz;
BEGIN
  IF p_ttl_hours IS NULL OR p_ttl_hours NOT BETWEEN 1 AND 8 THEN RETURN; END IF;
  SELECT seat.id,classroom.id,classroom.title,seat.display_label,
    public.classroom_teacher_public_display_name(classroom.tenant_id,classroom.created_by),
    (classroom.safe_mode_default OR seat.safe_mode),seat.avatar_key
  INTO v_seat_id,v_classroom_id,v_classroom_title,v_display_label,
    v_teacher_display_name,v_safe_mode,v_avatar_key
  FROM public.classroom_join_codes code
  JOIN public.classrooms classroom
    ON classroom.tenant_id=code.tenant_id AND classroom.id=code.classroom_id
  JOIN public.classroom_student_seats seat
    ON seat.tenant_id=classroom.tenant_id AND seat.classroom_id=classroom.id
  WHERE code.token_hash=p_token_hash AND code.status='active' AND classroom.status='active'
    AND seat.normalized_login_handle=trim(p_login_handle)
    AND seat.status IN ('issued','active')
  LIMIT 1 FOR UPDATE OF seat;
  IF v_seat_id IS NULL THEN RETURN; END IF;
  v_expires_at:=now()+make_interval(hours=>p_ttl_hours);
  INSERT INTO public.classroom_student_sessions(seat_id,token_hash,expires_at)
    VALUES(v_seat_id,p_session_token_hash,v_expires_at);
  UPDATE public.classroom_student_seats
    SET status='active',last_active_at=now(),updated_at=now()
    WHERE id=v_seat_id;
  RETURN QUERY SELECT v_seat_id,v_classroom_id,v_classroom_title,v_display_label,
    v_teacher_display_name,v_safe_mode,v_avatar_key,v_expires_at;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_seat_sign_in(varchar,varchar,varchar,integer)
  FROM PUBLIC, asalab_app;

-- Checked runtime wrapper: exact case must match both the seat and credential hash.
CREATE OR REPLACE FUNCTION public.classroom_student_seat_sign_in(
  p_code_hash varchar,p_handle varchar,p_credential_hash varchar,
  p_token_hash varchar,p_ttl_hours integer
)
RETURNS TABLE(
  seat_id uuid,classroom_id uuid,classroom_title varchar,display_label varchar,
  teacher_display_name varchar,safe_mode boolean,avatar_key varchar,expires_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_seat uuid; v_version integer;
BEGIN
  SELECT s.id,cred.version INTO v_seat,v_version
  FROM public.classroom_student_seats s
  JOIN public.classroom_join_codes code
    ON code.classroom_id=s.classroom_id AND code.tenant_id=s.tenant_id
  JOIN public.classroom_seat_credentials cred ON cred.seat_id=s.id
  WHERE code.token_hash=p_code_hash AND code.status='active'
    AND s.normalized_login_handle=trim(p_handle) AND s.status IN ('issued','active')
    AND cred.credential_hash=p_credential_hash
  FOR UPDATE OF s;
  IF v_seat IS NULL OR p_ttl_hours IS NULL OR p_ttl_hours NOT BETWEEN 1 AND 8 THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.classroom_student_seat_sign_in(
    p_code_hash,p_handle,p_token_hash,p_ttl_hours
  );
  UPDATE public.classroom_student_sessions
    SET credential_version=v_version
    WHERE token_hash=p_token_hash AND classroom_student_sessions.seat_id=v_seat;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_seat_sign_in(
  varchar,varchar,varchar,varchar,integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_seat_sign_in(
  varchar,varchar,varchar,varchar,integer
) TO asalab_app;
