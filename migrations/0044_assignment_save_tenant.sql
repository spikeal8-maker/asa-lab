-- Why a new task would not save.
--
-- teacher_assignment_save found the teacher's tenant through
-- legacy_user_account_links — a table that only holds the accounts carried over
-- from before the account migration. Two rows in a development database, none
-- for anyone who has registered since. So for every teacher who joined after
-- the migration the lookup returned NULL, the function returned NULL, and the
-- dialog answered "Задание не найдено." after they had typed the whole thing.
--
-- The tenant a person owns things in is their personal workspace, which is what
-- every other function of this kind already uses. The legacy link stays as a
-- fallback so accounts that predate workspaces keep working.

CREATE OR REPLACE FUNCTION teacher_assignment_save(
    p_principal_id uuid,
    p_assignment_id uuid,
    p_title varchar,
    p_brief varchar,
    p_module_key varchar,
    p_goal varchar DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_tenant uuid; v_id uuid;
BEGIN
    IF p_assignment_id IS NULL THEN
        SELECT p.account_id INTO v_account
          FROM public.principals p
         WHERE p.id = p_principal_id;
        IF v_account IS NULL THEN RETURN NULL; END IF;

        -- Where this person's own things live.
        SELECT w.tenant_id INTO v_tenant
          FROM public.workspace_memberships m
          JOIN public.workspaces w ON w.id = m.workspace_id
         WHERE m.account_id = v_account
           AND m.state = 'active'
           AND w.kind = 'personal'
           AND w.status = 'active'
         LIMIT 1;

        -- Accounts carried over from before workspaces existed.
        IF v_tenant IS NULL THEN
            SELECT link.tenant_id INTO v_tenant
              FROM public.legacy_user_account_links link
             WHERE link.account_id = v_account AND link.migration_state = 'active'
             LIMIT 1;
        END IF;

        -- A teacher whose only tenant is the school they teach in: the classes
        -- they own are there, and so is the work they set.
        IF v_tenant IS NULL THEN
            SELECT m.tenant_id INTO v_tenant
              FROM public.classroom_memberships m
             WHERE m.account_id = v_account AND m.member_role = 'owner'
             ORDER BY m.created_at
             LIMIT 1;
        END IF;

        IF v_tenant IS NULL THEN RETURN NULL; END IF;

        INSERT INTO public.teacher_assignments
            (tenant_id, owner_principal_id, title, brief, module_key, goal)
        VALUES (v_tenant, p_principal_id, trim(p_title), NULLIF(trim(p_brief), ''),
                p_module_key, NULLIF(trim(p_goal), ''))
        RETURNING id INTO v_id;
        RETURN v_id;
    END IF;

    UPDATE public.teacher_assignments t
       SET title = trim(p_title),
           brief = NULLIF(trim(p_brief), ''),
           module_key = p_module_key,
           goal = NULLIF(trim(p_goal), ''),
           updated_at = now()
     WHERE t.id = p_assignment_id AND t.owner_principal_id = p_principal_id
    RETURNING t.id INTO v_id;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION teacher_assignment_save(uuid, uuid, varchar, varchar, varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION teacher_assignment_save(uuid, uuid, varchar, varchar, varchar, varchar) TO asalab_app;
