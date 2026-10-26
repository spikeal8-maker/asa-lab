-- Publisher admission only. Retain all Project and publication history.
-- Existing readers, copy and admin actions reuse this canonical policy.
CREATE OR REPLACE FUNCTION public.project_publication_policy_reason(p_project_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_project record;
BEGIN
    SELECT p.module_key, p.project_scope, p.classroom_id, p.status, actor.kind, actor.account_id,
           account.status AS account_status
      INTO v_project
      FROM public.projects p
      LEFT JOIN public.principals actor ON actor.id = p.owner_principal_id
      LEFT JOIN public.accounts account ON account.id = actor.account_id
     WHERE p.id = p_project_id;
    IF NOT FOUND THEN RETURN 'not_available'; END IF;

    IF EXISTS (SELECT 1 FROM public.learning_project_origins o WHERE o.project_id = p_project_id)
       OR EXISTS (SELECT 1 FROM public.learning_legacy_project_origins o WHERE o.project_id = p_project_id)
       OR EXISTS (SELECT 1 FROM public.classroom_assignment_work w WHERE w.project_id = p_project_id) THEN
        RETURN 'learning_work_protected';
    END IF;
    IF v_project.project_scope IS DISTINCT FROM 'personal'
       OR v_project.classroom_id IS NOT NULL
       OR v_project.status IS DISTINCT FROM 'active'
       OR v_project.kind IS DISTINCT FROM 'account'
       OR v_project.account_status IS DISTINCT FROM 'active' THEN
        RETURN 'publication_forbidden';
    END IF;

    IF v_project.module_key IS NULL OR v_project.module_key NOT IN ('three-d', 'electronics', 'blocks') THEN
        RETURN 'module_not_publishable';
    END IF;

    -- Classroom and Seat-owned sources are ineligible regardless of their Safe
    -- Mode flag. The policy is re-evaluated for every read, so changing the
    -- Project's own scope/origin closes existing public access. A linked Seat
    -- or a school membership does not govern an Account's independent personal
    -- Project and must never become a global Account publication ban.
    RETURN NULL;
END;
$$;
