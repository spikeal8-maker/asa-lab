-- Checkers M1 classroom learning: an educator can enrol an existing ASA
-- account into a class, while each learner keeps an isolated Checkers state.
-- Project Core remains subject-neutral: classroom membership controls read
-- access and only the owner can mutate the shared assignment document.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('teacher', 'student'));

ALTER TABLE workspace_memberships DROP CONSTRAINT IF EXISTS workspace_memberships_role_check;
ALTER TABLE workspace_memberships
    ADD CONSTRAINT workspace_memberships_role_check
    CHECK (role IN ('owner', 'member', 'student', 'educator', 'school_admin',
                    'billing_admin', 'moderator'));

ALTER TABLE classroom_memberships
    DROP CONSTRAINT IF EXISTS classroom_memberships_member_role_check;
ALTER TABLE classroom_memberships
    ADD CONSTRAINT classroom_memberships_member_role_check
    CHECK (member_role IN ('owner', 'student'));

CREATE TABLE IF NOT EXISTS checkers_student_states (
    tenant_id         uuid NOT NULL REFERENCES tenants(id),
    project_id        uuid NOT NULL,
    classroom_id      uuid NOT NULL,
    student_user_id   uuid NOT NULL,
    student_account_id uuid NOT NULL REFERENCES accounts(id),
    document_json     jsonb NOT NULL,
    revision          integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, project_id, student_user_id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms (tenant_id, id),
    FOREIGN KEY (tenant_id, student_user_id) REFERENCES users (tenant_id, id),
    CHECK (jsonb_typeof(document_json) = 'object')
);
CREATE INDEX IF NOT EXISTS checkers_student_states_classroom_idx
    ON checkers_student_states (tenant_id, classroom_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE ON checkers_student_states TO asalab_app;
ALTER TABLE checkers_student_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkers_student_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checkers_student_states_tenant ON checkers_student_states;
CREATE POLICY checkers_student_states_tenant ON checkers_student_states
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE OR REPLACE FUNCTION checkers_enrol_student_by_email(
    p_tenant_id uuid,
    p_teacher_user_id uuid,
    p_project_id uuid,
    p_email varchar
)
RETURNS TABLE (student_user_id uuid, student_account_id uuid, display_name varchar, email varchar)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_classroom_id uuid;
    v_school_id uuid;
    v_account_id uuid;
    v_principal_id uuid;
    v_workspace_id uuid;
    v_user_id uuid;
    v_display_name varchar;
    v_email varchar;
    v_password_hash text;
    v_existing_workspace_role varchar;
BEGIN
    SELECT p.classroom_id, c.school_id
      INTO v_classroom_id, v_school_id
      FROM public.projects p
      JOIN public.classrooms c
        ON c.tenant_id = p.tenant_id AND c.id = p.classroom_id
      JOIN public.classroom_memberships m
        ON m.tenant_id = c.tenant_id AND m.classroom_id = c.id
     WHERE p.tenant_id = p_tenant_id
       AND p.id = p_project_id
       AND p.project_scope = 'classroom'
       AND p.module_key = 'checkers'
       AND m.user_id = p_teacher_user_id
       AND m.member_role = 'owner';
    IF v_classroom_id IS NULL THEN
        RAISE EXCEPTION 'checkers classroom project is unavailable';
    END IF;

    SELECT a.id, a.password_hash, a.email, pr.display_name, p.id
      INTO v_account_id, v_password_hash, v_email, v_display_name, v_principal_id
      FROM public.accounts a
      JOIN public.profiles pr ON pr.account_id = a.id
      JOIN public.principals p ON p.account_id = a.id AND p.kind = 'account'
     WHERE lower(a.email) = lower(trim(p_email))
     LIMIT 1;
    IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'student account was not found';
    END IF;

    SELECT l.user_id INTO v_user_id
      FROM public.legacy_user_account_links l
     WHERE l.tenant_id = p_tenant_id
       AND l.account_id = v_account_id
       AND l.migration_state = 'active'
     LIMIT 1;
    IF v_user_id IS NULL THEN
        INSERT INTO public.users
            (tenant_id, school_id, role, email, display_name, password_hash)
        VALUES
            (p_tenant_id, v_school_id, 'student', v_email, v_display_name, v_password_hash)
        RETURNING id INTO v_user_id;
        INSERT INTO public.legacy_user_account_links
            (tenant_id, user_id, account_id, principal_id)
        VALUES
            (p_tenant_id, v_user_id, v_account_id, v_principal_id);
    END IF;

    SELECT w.id INTO v_workspace_id
      FROM public.workspaces w
     WHERE w.tenant_id = p_tenant_id AND w.kind = 'organization'
     LIMIT 1;
    SELECT wm.role INTO v_existing_workspace_role
      FROM public.workspace_memberships wm
     WHERE wm.account_id = v_account_id AND wm.workspace_id = v_workspace_id;
    IF v_existing_workspace_role IS NOT NULL
       AND v_existing_workspace_role NOT IN ('student', 'member') THEN
        RAISE EXCEPTION 'account already has a staff role in this workspace';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.capability_grants g
         WHERE g.account_id = v_account_id
           AND g.capability IN ('educator', 'platform_admin')
           AND g.state IN ('provisional', 'verified')
    ) THEN
        RAISE EXCEPTION 'staff account cannot be enrolled as a student';
    END IF;
    INSERT INTO public.workspace_memberships (account_id, workspace_id, role, state)
    VALUES (v_account_id, v_workspace_id, 'student', 'active')
    ON CONFLICT (account_id, workspace_id) DO UPDATE
        SET role = 'student', state = 'active';
    INSERT INTO public.capability_grants
        (account_id, capability, state, policy_version, granted_by)
    VALUES
        (v_account_id, 'registered_student', 'verified', 'asa-lab-2026-07', 'server')
    ON CONFLICT (account_id, capability) DO NOTHING;
    INSERT INTO public.classroom_memberships
        (tenant_id, classroom_id, user_id, member_role)
    VALUES
        (p_tenant_id, v_classroom_id, v_user_id, 'student')
    ON CONFLICT (tenant_id, classroom_id, user_id) DO UPDATE
        SET member_role = 'student';
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (p_tenant_id, p_teacher_user_id, 'checkers_classroom', v_classroom_id,
         'checkers.student_enrolled',
         jsonb_build_object('projectId', p_project_id, 'studentUserId', v_user_id));

    RETURN QUERY SELECT v_user_id, v_account_id, v_display_name, v_email;
END;
$$;

CREATE OR REPLACE FUNCTION checkers_classroom_roster(
    p_tenant_id uuid,
    p_teacher_user_id uuid,
    p_project_id uuid
)
RETURNS TABLE (student_user_id uuid, student_account_id uuid, display_name varchar, email varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT m.user_id, l.account_id, u.display_name, u.email
      FROM public.projects p
      JOIN public.classroom_memberships owner_membership
        ON owner_membership.tenant_id = p.tenant_id
       AND owner_membership.classroom_id = p.classroom_id
       AND owner_membership.user_id = p_teacher_user_id
       AND owner_membership.member_role = 'owner'
      JOIN public.classroom_memberships m
        ON m.tenant_id = p.tenant_id
       AND m.classroom_id = p.classroom_id
       AND m.member_role = 'student'
      JOIN public.users u
        ON u.tenant_id = m.tenant_id AND u.id = m.user_id AND u.status = 'active'
      JOIN public.legacy_user_account_links l
        ON l.tenant_id = m.tenant_id AND l.user_id = m.user_id
       AND l.migration_state = 'active'
     WHERE p.tenant_id = p_tenant_id
       AND p.id = p_project_id
       AND p.project_scope = 'classroom'
       AND p.module_key = 'checkers'
     ORDER BY lower(u.display_name), m.user_id;
$$;

REVOKE ALL ON FUNCTION checkers_enrol_student_by_email(uuid, uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION checkers_classroom_roster(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION checkers_enrol_student_by_email(uuid, uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION checkers_classroom_roster(uuid, uuid, uuid) TO asalab_app;
