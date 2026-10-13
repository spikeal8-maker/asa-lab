-- Read-only access must match classroom_management_roster for archived classes.
-- Only the credential reader changes: active-only writes, login checks, tenant
-- matching and removal checks remain unchanged. Never alter issued codes here.
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
  lookup_key_id varchar,
  lookup_digest varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT protected.seat_id,protected.tenant_id,protected.classroom_id,
         protected.credential_version,protected.credential_state,
         protected.encryption_key_id,protected.encryption_nonce,
         protected.encryption_ciphertext,protected.encryption_tag,
         protected.lookup_key_id,protected.lookup_digest
  FROM public.classroom_student_code_protected protected
  JOIN public.classroom_student_seats seat ON seat.id=protected.seat_id
  CROSS JOIN LATERAL public.classroom_teacher_access_any(p_account,p_classroom) access
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
