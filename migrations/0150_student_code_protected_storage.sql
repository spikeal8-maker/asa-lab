-- Protected Student Code storage foundation.
-- Secrets remain outside PostgreSQL. This migration is additive only: it does
-- not backfill existing rows, remove legacy compatibility fields, or enable an
-- enforced runtime mode.
CREATE TABLE public.classroom_student_code_protected (
  seat_id uuid PRIMARY KEY REFERENCES public.classroom_student_seats(id),
  tenant_id uuid NOT NULL,
  classroom_id uuid NOT NULL,
  credential_version integer NOT NULL CHECK (credential_version > 0),
  credential_state varchar(24) NOT NULL DEFAULT 'protected'
    CHECK (credential_state IN ('protected','legacy_predictable')),
  encryption_key_id varchar(128) NOT NULL
    CHECK (encryption_key_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  encryption_nonce bytea NOT NULL CHECK (octet_length(encryption_nonce) = 12),
  encryption_ciphertext bytea NOT NULL CHECK (octet_length(encryption_ciphertext) > 0),
  encryption_tag bytea NOT NULL CHECK (octet_length(encryption_tag) = 16),
  lookup_key_id varchar(128) NOT NULL
    CHECK (lookup_key_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  lookup_digest varchar(64) NOT NULL CHECK (lookup_digest ~ '^[0-9a-f]{64}$'),
  protected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, classroom_id, lookup_key_id, lookup_digest)
);
CREATE INDEX classroom_student_code_protected_class_idx
  ON public.classroom_student_code_protected(tenant_id,classroom_id,seat_id);

CREATE TABLE public.classroom_student_code_retired_digests (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  classroom_id uuid NOT NULL,
  seat_id uuid NOT NULL REFERENCES public.classroom_student_seats(id),
  credential_version integer NOT NULL CHECK (credential_version > 0),
  lookup_key_id varchar(128) NOT NULL
    CHECK (lookup_key_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  lookup_digest varchar(64) NOT NULL CHECK (lookup_digest ~ '^[0-9a-f]{64}$'),
  retired_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, classroom_id, lookup_key_id, lookup_digest)
);
CREATE INDEX classroom_student_code_retired_seat_idx
  ON public.classroom_student_code_retired_digests(tenant_id,classroom_id,seat_id,credential_version);

REVOKE ALL ON public.classroom_student_code_protected,
  public.classroom_student_code_retired_digests FROM PUBLIC, asalab_app;
ALTER TABLE public.classroom_student_code_protected ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_student_code_protected FORCE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_student_code_retired_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_student_code_retired_digests FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.classroom_student_code_protection_context(
  p_account uuid,p_classroom uuid
)
RETURNS TABLE(tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT access.tenant_id
  FROM public.classroom_teacher_access(p_account,p_classroom) access
  WHERE access.user_id IS NOT NULL
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.classroom_student_code_protection_context(uuid,uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_code_protection_context(uuid,uuid)
  TO asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_student_code_protected_write(
  p_account uuid,
  p_classroom uuid,
  p_seat uuid,
  p_credential_version integer,
  p_credential_state varchar,
  p_encryption_key_id varchar,
  p_encryption_nonce bytea,
  p_encryption_ciphertext bytea,
  p_encryption_tag bytea,
  p_lookup_key_id varchar,
  p_lookup_digest varchar,
  p_lookup_candidates jsonb
)
RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_current_version integer;
BEGIN
  IF p_credential_version IS NULL OR p_credential_version <= 0
     OR p_credential_state NOT IN ('protected','legacy_predictable')
     OR p_encryption_key_id IS NULL
     OR p_encryption_key_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_encryption_nonce IS NULL OR octet_length(p_encryption_nonce) <> 12
     OR p_encryption_ciphertext IS NULL OR octet_length(p_encryption_ciphertext) = 0
     OR p_encryption_tag IS NULL OR octet_length(p_encryption_tag) <> 16
     OR p_lookup_key_id IS NULL OR p_lookup_key_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_lookup_digest IS NULL OR p_lookup_digest !~ '^[0-9a-f]{64}$'
     OR p_lookup_candidates IS NULL OR jsonb_typeof(p_lookup_candidates) <> 'array'
     OR jsonb_array_length(p_lookup_candidates) = 0 THEN
    RETURN 'invalid_request';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lookup_candidates) candidate
    WHERE COALESCE(candidate->>'keyId','') !~ '^[A-Za-z0-9._:-]{1,128}$'
       OR COALESCE(candidate->>'digest','') !~ '^[0-9a-f]{64}$'
  ) OR NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lookup_candidates) candidate
    WHERE candidate->>'keyId'=p_lookup_key_id
      AND candidate->>'digest'=p_lookup_digest
  ) THEN
    RETURN 'invalid_request';
  END IF;

  SELECT seat.tenant_id,access.user_id,cred.version
    INTO v_tenant,v_user,v_current_version
  FROM public.classroom_student_seats seat
  JOIN public.classroom_seat_credentials cred ON cred.seat_id=seat.id
  CROSS JOIN LATERAL public.classroom_teacher_access(p_account,p_classroom) access
  WHERE seat.id=p_seat
    AND seat.classroom_id=p_classroom
    AND seat.status<>'removed'
    AND access.user_id IS NOT NULL
    AND access.tenant_id=seat.tenant_id
  FOR UPDATE OF seat,cred;

  IF v_tenant IS NULL THEN RETURN 'not_found'; END IF;
  IF v_current_version<>p_credential_version THEN RETURN 'version_conflict'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lookup_candidates) candidate
    JOIN public.classroom_student_code_protected active
      ON active.tenant_id=v_tenant
     AND active.classroom_id=p_classroom
     AND active.lookup_key_id=candidate->>'keyId'
     AND active.lookup_digest=candidate->>'digest'
    WHERE active.seat_id<>p_seat
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_lookup_candidates) candidate
    JOIN public.classroom_student_code_retired_digests retired
      ON retired.tenant_id=v_tenant
     AND retired.classroom_id=p_classroom
     AND retired.lookup_key_id=candidate->>'keyId'
     AND retired.lookup_digest=candidate->>'digest'
  ) THEN
    RETURN 'code_in_use';
  END IF;

  INSERT INTO public.classroom_student_code_retired_digests(
    tenant_id,classroom_id,seat_id,credential_version,lookup_key_id,lookup_digest
  )
  SELECT current.tenant_id,current.classroom_id,current.seat_id,current.credential_version,
         current.lookup_key_id,current.lookup_digest
  FROM public.classroom_student_code_protected current
  WHERE current.seat_id=p_seat
    AND current.credential_version<>p_credential_version
  ON CONFLICT DO NOTHING;

  INSERT INTO public.classroom_student_code_protected(
    seat_id,tenant_id,classroom_id,credential_version,credential_state,
    encryption_key_id,encryption_nonce,encryption_ciphertext,encryption_tag,
    lookup_key_id,lookup_digest,protected_at,updated_at
  ) VALUES (
    p_seat,v_tenant,p_classroom,p_credential_version,p_credential_state,
    p_encryption_key_id,p_encryption_nonce,p_encryption_ciphertext,p_encryption_tag,
    p_lookup_key_id,p_lookup_digest,now(),now()
  )
  ON CONFLICT (seat_id) DO UPDATE SET
    tenant_id=excluded.tenant_id,
    classroom_id=excluded.classroom_id,
    credential_version=excluded.credential_version,
    credential_state=excluded.credential_state,
    encryption_key_id=excluded.encryption_key_id,
    encryption_nonce=excluded.encryption_nonce,
    encryption_ciphertext=excluded.encryption_ciphertext,
    encryption_tag=excluded.encryption_tag,
    lookup_key_id=excluded.lookup_key_id,
    lookup_digest=excluded.lookup_digest,
    updated_at=now();

  RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_code_protected_write(
  uuid,uuid,uuid,integer,varchar,varchar,bytea,bytea,bytea,varchar,varchar,jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_code_protected_write(
  uuid,uuid,uuid,integer,varchar,varchar,bytea,bytea,bytea,varchar,varchar,jsonb
) TO asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_student_code_protected_read(
  p_account uuid,p_classroom uuid
)
RETURNS TABLE(
  seat_id uuid,
  tenant_id uuid,
  classroom_id uuid,
  credential_version integer,
  credential_state varchar,
  encryption_key_id varchar,
  encryption_nonce bytea,
  encryption_ciphertext bytea,
  encryption_tag bytea,
  lookup_key_id varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT protected.seat_id,protected.tenant_id,protected.classroom_id,
         protected.credential_version,protected.credential_state,
         protected.encryption_key_id,protected.encryption_nonce,
         protected.encryption_ciphertext,protected.encryption_tag,
         protected.lookup_key_id
  FROM public.classroom_student_code_protected protected
  JOIN public.classroom_student_seats seat ON seat.id=protected.seat_id
  CROSS JOIN LATERAL public.classroom_teacher_access(p_account,p_classroom) access
  WHERE protected.classroom_id=p_classroom
    AND seat.classroom_id=p_classroom
    AND seat.status<>'removed'
    AND access.user_id IS NOT NULL
    AND access.tenant_id=protected.tenant_id
$$;
REVOKE ALL ON FUNCTION public.classroom_student_code_protected_read(uuid,uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_code_protected_read(uuid,uuid)
  TO asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_student_code_protected_match(
  p_classroom uuid,p_lookup_candidates jsonb
)
RETURNS TABLE(seat_id uuid,credential_version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT protected.seat_id,protected.credential_version
  FROM public.classroom_student_code_protected protected
  JOIN public.classroom_student_seats seat ON seat.id=protected.seat_id
  JOIN public.classrooms classroom ON classroom.id=protected.classroom_id
    AND classroom.tenant_id=protected.tenant_id
  JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_lookup_candidates)='array'
      THEN p_lookup_candidates ELSE '[]'::jsonb END
  ) candidate
    ON candidate->>'keyId'=protected.lookup_key_id
   AND candidate->>'digest'=protected.lookup_digest
  WHERE protected.classroom_id=p_classroom
    AND classroom.status='active'
    AND seat.status IN ('issued','active')
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.classroom_student_code_protected_match(uuid,jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_code_protected_match(uuid,jsonb)
  TO asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_student_seat_sign_in_protected(
  p_code_hash varchar,
  p_seat uuid,
  p_credential_version integer,
  p_token_hash varchar,
  p_ttl_hours integer
)
RETURNS TABLE(
  seat_id uuid,classroom_id uuid,classroom_title varchar,display_label varchar,
  teacher_display_name varchar,safe_mode boolean,avatar_key varchar,expires_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_seat_id uuid;
  v_classroom_id uuid;
  v_classroom_title varchar;
  v_display_label varchar;
  v_teacher_display_name varchar;
  v_safe_mode boolean;
  v_avatar_key varchar;
  v_expires_at timestamptz;
BEGIN
  IF p_ttl_hours IS NULL OR p_ttl_hours NOT BETWEEN 1 AND 8
     OR p_credential_version IS NULL OR p_credential_version <= 0 THEN
    RETURN;
  END IF;

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
  JOIN public.classroom_student_code_protected protected
    ON protected.seat_id=seat.id
   AND protected.credential_version=p_credential_version
  WHERE code.token_hash=p_code_hash
    AND code.status='active'
    AND classroom.status='active'
    AND seat.id=p_seat
    AND seat.status IN ('issued','active')
  LIMIT 1
  FOR UPDATE OF seat;

  IF v_seat_id IS NULL THEN RETURN; END IF;

  v_expires_at:=now()+make_interval(hours=>p_ttl_hours);
  INSERT INTO public.classroom_student_sessions(
    seat_id,token_hash,expires_at,credential_version
  ) VALUES (
    v_seat_id,p_token_hash,v_expires_at,p_credential_version
  );
  UPDATE public.classroom_student_seats
    SET status='active',last_active_at=now(),updated_at=now()
    WHERE id=v_seat_id;

  RETURN QUERY SELECT v_seat_id,v_classroom_id,v_classroom_title,v_display_label,
    v_teacher_display_name,v_safe_mode,v_avatar_key,v_expires_at;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_student_seat_sign_in_protected(
  varchar,uuid,integer,varchar,integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_student_seat_sign_in_protected(
  varchar,uuid,integer,varchar,integer
) TO asalab_app;
