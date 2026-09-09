-- A class code and a public handle locate a seat; only a personal random
-- credential proves control. Historical seat/project/learner IDs are retained.
CREATE TABLE classroom_seat_credentials (
  seat_id uuid PRIMARY KEY REFERENCES classroom_student_seats(id),
  credential_hash varchar(64) NOT NULL CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  version integer NOT NULL CHECK (version > 0),
  last_request_id uuid NOT NULL,
  issued_by_account_id uuid NOT NULL REFERENCES accounts(id),
  issued_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON classroom_seat_credentials FROM PUBLIC, asalab_app;
ALTER TABLE classroom_seat_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_seat_credentials FORCE ROW LEVEL SECURITY;
CREATE TABLE classroom_seat_credential_receipts (
  seat_id uuid NOT NULL REFERENCES classroom_student_seats(id),
  request_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  PRIMARY KEY (seat_id, request_id)
);
REVOKE ALL ON classroom_seat_credential_receipts FROM PUBLIC, asalab_app;
ALTER TABLE classroom_seat_credential_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_seat_credential_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE classroom_student_sessions ADD COLUMN credential_version integer;

CREATE FUNCTION classroom_seat_credential_issue(
  p_account uuid, p_classroom uuid, p_seat uuid, p_hash varchar, p_request uuid
) RETURNS TABLE (result_code varchar, credential_version integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_tenant uuid; v_user uuid; v_version integer;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_request IS NULL THEN
    RETURN QUERY SELECT 'invalid_request'::varchar, NULL::integer; RETURN;
  END IF;
  SELECT seat.tenant_id, access.user_id INTO v_tenant, v_user
    FROM public.classroom_student_seats seat
    CROSS JOIN LATERAL public.classroom_teacher_access(p_account,p_classroom) access
    JOIN public.accounts a ON a.id=p_account AND a.status='active'
    WHERE seat.id=p_seat AND seat.classroom_id=p_classroom AND seat.status <> 'removed'
      AND access.tenant_id=seat.tenant_id AND EXISTS (
        SELECT 1 FROM public.capability_grants g WHERE g.account_id=p_account
          AND g.capability='educator' AND g.state IN ('provisional','verified'))
    FOR UPDATE OF seat;
  IF v_tenant IS NULL THEN RETURN QUERY SELECT 'not_found'::varchar, NULL::integer; RETURN; END IF;
  SELECT c.version INTO v_version FROM public.classroom_seat_credential_receipts c WHERE c.seat_id=p_seat AND c.request_id=p_request;
  IF FOUND THEN
    RETURN QUERY SELECT 'already_issued'::varchar,v_version; RETURN;
  END IF;
  SELECT c.version INTO v_version FROM public.classroom_seat_credentials c WHERE c.seat_id=p_seat;
  v_version := COALESCE(v_version,0)+1;
  INSERT INTO public.classroom_seat_credentials (seat_id,credential_hash,version,last_request_id,issued_by_account_id)
    VALUES (p_seat,p_hash,v_version,p_request,p_account)
    ON CONFLICT (seat_id) DO UPDATE SET credential_hash=excluded.credential_hash,version=excluded.version,
      last_request_id=excluded.last_request_id,issued_by_account_id=excluded.issued_by_account_id,issued_at=now();
  INSERT INTO public.classroom_seat_credential_receipts (seat_id,request_id,version) VALUES (p_seat,p_request,v_version);
  UPDATE public.classroom_student_sessions SET revoked_at=now() WHERE seat_id=p_seat AND revoked_at IS NULL;
  INSERT INTO public.audit_events (tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
    VALUES (v_tenant,v_user,'student_seat',p_seat,'seat.credential_issued',
      jsonb_build_object('classroomId',p_classroom,'version',v_version,'requestId',p_request));
  RETURN QUERY SELECT 'issued'::varchar,v_version;
END;
$$;
REVOKE ALL ON FUNCTION classroom_seat_credential_issue(uuid,uuid,uuid,varchar,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_seat_credential_issue(uuid,uuid,uuid,varchar,uuid) TO asalab_app;

-- Preserve the implementation for the checked wrapper, but remove every
-- runtime permission to the old credential-less entry point.
REVOKE ALL ON FUNCTION classroom_student_seat_sign_in(varchar,varchar,varchar,integer) FROM PUBLIC, asalab_app;
CREATE FUNCTION classroom_student_seat_sign_in(
  p_code_hash varchar,p_handle varchar,p_credential_hash varchar,p_token_hash varchar,p_ttl_hours integer
) RETURNS TABLE (seat_id uuid,classroom_id uuid,classroom_title varchar,display_label varchar,
  teacher_display_name varchar,safe_mode boolean,avatar_key varchar,expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_seat uuid; v_version integer;
BEGIN
  SELECT s.id,cred.version INTO v_seat,v_version FROM public.classroom_student_seats s
    JOIN public.classroom_join_codes code ON code.classroom_id=s.classroom_id AND code.tenant_id=s.tenant_id
    JOIN public.classroom_seat_credentials cred ON cred.seat_id=s.id
    WHERE code.token_hash=p_code_hash AND code.status='active'
      AND s.normalized_login_handle=lower(trim(p_handle)) AND s.status IN ('issued','active')
      AND cred.credential_hash=p_credential_hash FOR UPDATE OF s;
  IF v_seat IS NULL OR p_ttl_hours IS NULL OR p_ttl_hours NOT BETWEEN 1 AND 8 THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.classroom_student_seat_sign_in(p_code_hash,p_handle,p_token_hash,p_ttl_hours);
  UPDATE public.classroom_student_sessions SET credential_version=v_version WHERE token_hash=p_token_hash AND classroom_student_sessions.seat_id=v_seat;
END;
$$;
REVOKE ALL ON FUNCTION classroom_student_seat_sign_in(varchar,varchar,varchar,varchar,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_student_seat_sign_in(varchar,varchar,varchar,varchar,integer) TO asalab_app;

ALTER FUNCTION classroom_student_session_context(varchar) RENAME TO classroom_student_session_context_legacy;
REVOKE ALL ON FUNCTION classroom_student_session_context_legacy(varchar) FROM PUBLIC, asalab_app;
CREATE FUNCTION classroom_student_session_context(p_token_hash varchar)
RETURNS TABLE (seat_id uuid,classroom_id uuid,classroom_title varchar,display_label varchar,
  teacher_display_name varchar,safe_mode boolean,avatar_key varchar,expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.classroom_student_sessions s
    JOIN public.classroom_seat_credentials c ON c.seat_id=s.seat_id AND c.version=s.credential_version
    WHERE s.token_hash=p_token_hash AND s.revoked_at IS NULL AND s.expires_at>now()
      AND s.last_seen_at>now()-interval '60 minutes') THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.classroom_student_session_context_legacy(p_token_hash);
END;
$$;
REVOKE ALL ON FUNCTION classroom_student_session_context(varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_student_session_context(varchar) TO asalab_app;
