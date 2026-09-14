-- E1 archive acceptance: an archived class is readable teaching history.
-- Mutating classroom functions still require active teacher access; this only
-- lets the existing class page resolve its learning context while archived.
CREATE OR REPLACE FUNCTION classroom_learning_context(p_account uuid,p_classroom uuid)
RETURNS TABLE (id uuid, kind varchar, school_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT lc.id,lc.kind,lc.school_id FROM public.classrooms c
  JOIN public.learning_contexts lc ON lc.tenant_id=c.tenant_id AND lc.id=c.school_id
  CROSS JOIN LATERAL public.classroom_teacher_access_any(p_account,c.id) access
  JOIN public.accounts a ON a.id=p_account AND a.status='active'
  WHERE c.id=p_classroom AND access.tenant_id=c.tenant_id AND EXISTS (
    SELECT 1 FROM public.capability_grants g WHERE g.account_id=p_account
      AND g.capability='educator' AND g.state IN ('provisional','verified'));
$$;

REVOKE ALL ON FUNCTION classroom_learning_context(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_learning_context(uuid,uuid) TO asalab_app;
