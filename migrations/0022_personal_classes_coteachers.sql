-- Tinkercad-like teaching model: a verified/provisional educator can create a
-- personal class without first creating a user-facing school. Classes may also
-- have one primary owner and up to five co-teachers invited by a revocable link.

ALTER TABLE classroom_memberships
    ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);

UPDATE classroom_memberships m
   SET account_id = l.account_id
  FROM legacy_user_account_links l
 WHERE m.account_id IS NULL
   AND l.tenant_id = m.tenant_id
   AND l.user_id = m.user_id
   AND l.migration_state = 'active';

ALTER TABLE classroom_memberships
    DROP CONSTRAINT IF EXISTS classroom_memberships_member_role_check;
ALTER TABLE classroom_memberships
    ADD CONSTRAINT classroom_memberships_member_role_check
    CHECK (member_role IN ('owner', 'co_teacher', 'student'));

CREATE UNIQUE INDEX IF NOT EXISTS classroom_memberships_class_account_idx
    ON classroom_memberships (classroom_id, account_id)
    WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS classroom_memberships_account_role_idx
    ON classroom_memberships (account_id, member_role, classroom_id)
    WHERE account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS personal_teaching_contexts (
    account_id         uuid PRIMARY KEY REFERENCES accounts(id),
    tenant_id          uuid NOT NULL REFERENCES tenants(id),
    workspace_id       uuid NOT NULL REFERENCES workspaces(id),
    school_id          uuid NOT NULL,
    academic_period_id uuid NOT NULL,
    user_id            uuid NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, school_id) REFERENCES schools (tenant_id, id),
    FOREIGN KEY (tenant_id, academic_period_id) REFERENCES academic_periods (tenant_id, id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
    UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS classroom_teacher_invitations (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL REFERENCES tenants(id),
    classroom_id          uuid NOT NULL,
    token_hash            varchar(64) NOT NULL UNIQUE,
    invited_by_account_id uuid NOT NULL REFERENCES accounts(id),
    accepted_by_account_id uuid REFERENCES accounts(id),
    status                varchar(16) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
    expires_at            timestamptz NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    accepted_at           timestamptz,
    revoked_at            timestamptz,
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS classroom_teacher_invitations_class_idx
    ON classroom_teacher_invitations (tenant_id, classroom_id, status, created_at DESC);

REVOKE ALL ON personal_teaching_contexts, classroom_teacher_invitations FROM asalab_app;

CREATE OR REPLACE FUNCTION classroom_ensure_personal_teacher(p_account_id uuid)
RETURNS TABLE (
    tenant_id uuid,
    workspace_id uuid,
    school_id uuid,
    academic_period_id uuid,
    user_id uuid
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_workspace uuid;
    v_school uuid;
    v_period uuid;
    v_user uuid;
    v_principal uuid;
    v_email varchar(255);
    v_password_hash text;
    v_display_name varchar(255);
    v_year integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.capability_grants g
         WHERE g.account_id = p_account_id
           AND g.capability = 'educator'
           AND g.state IN ('provisional', 'verified'))
    THEN
        RETURN;
    END IF;

    SELECT c.tenant_id, c.workspace_id, c.school_id, c.academic_period_id, c.user_id
      INTO v_tenant, v_workspace, v_school, v_period, v_user
      FROM public.personal_teaching_contexts c
     WHERE c.account_id = p_account_id;
    IF v_user IS NOT NULL THEN
        RETURN QUERY SELECT v_tenant, v_workspace, v_school, v_period, v_user;
        RETURN;
    END IF;

    SELECT w.tenant_id, w.id, pr.id, a.email, a.password_hash,
           COALESCE(NULLIF(p.display_name, ''), p.username)
      INTO v_tenant, v_workspace, v_principal, v_email, v_password_hash, v_display_name
      FROM public.workspace_memberships wm
      JOIN public.workspaces w ON w.id = wm.workspace_id AND w.kind = 'personal'
      JOIN public.accounts a ON a.id = wm.account_id AND a.status = 'active'
      JOIN public.profiles p ON p.account_id = a.id
      JOIN public.principals pr ON pr.account_id = a.id
     WHERE wm.account_id = p_account_id
     LIMIT 1;
    IF v_tenant IS NULL THEN RETURN; END IF;

    INSERT INTO public.schools (tenant_id, title)
    VALUES (v_tenant, 'Личные классы')
    RETURNING id INTO v_school;

    v_year := extract(year FROM current_date)::integer;
    INSERT INTO public.academic_periods
        (tenant_id, school_id, title, starts_on, ends_on, is_active)
    VALUES
        (v_tenant, v_school, v_year::text,
         make_date(v_year, 1, 1), make_date(v_year, 12, 31), true)
    RETURNING id INTO v_period;

    INSERT INTO public.users
        (tenant_id, school_id, role, email, display_name, password_hash, status)
    VALUES
        (v_tenant, v_school, 'teacher', v_email, v_display_name, v_password_hash, 'active')
    RETURNING id INTO v_user;

    INSERT INTO public.legacy_user_account_links
        (tenant_id, user_id, account_id, principal_id, migration_state)
    VALUES (v_tenant, v_user, p_account_id, v_principal, 'active');

    INSERT INTO public.personal_teaching_contexts
        (account_id, tenant_id, workspace_id, school_id, academic_period_id, user_id)
    VALUES (p_account_id, v_tenant, v_workspace, v_school, v_period, v_user);

    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_tenant, v_user, 'account', p_account_id,
         'classroom.personal_teaching_enabled',
         jsonb_build_object('workspaceId', v_workspace));

    RETURN QUERY SELECT v_tenant, v_workspace, v_school, v_period, v_user;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_access(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (tenant_id uuid, user_id uuid, teacher_role varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT m.tenant_id, m.user_id, m.member_role
      FROM public.classroom_memberships m
      JOIN public.classrooms c
        ON c.tenant_id = m.tenant_id AND c.id = m.classroom_id
     WHERE m.account_id = p_account_id
       AND m.classroom_id = p_classroom_id
       AND m.member_role IN ('owner', 'co_teacher')
       AND c.status = 'active'
     LIMIT 1;
$$;

-- Resolve cross-workspace classroom/project access from the global principal.
-- This lets an invited educator work in a colleague's class without switching
-- their active personal workspace or receiving school-administrator rights.
CREATE OR REPLACE FUNCTION classroom_project_context_for_principal(
    p_principal_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (tenant_id uuid, user_id uuid, teacher_role varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT m.tenant_id, m.user_id, m.member_role
      FROM public.principals principal
      JOIN public.classroom_memberships m ON m.account_id = principal.account_id
      JOIN public.classrooms c
        ON c.tenant_id = m.tenant_id AND c.id = m.classroom_id
     WHERE principal.id = p_principal_id
       AND m.classroom_id = p_classroom_id
       AND m.member_role IN ('owner', 'co_teacher')
       AND c.status = 'active'
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION project_context_for_principal(
    p_principal_id uuid,
    p_project_id uuid
)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT project.tenant_id,
           CASE
             WHEN project.project_scope = 'classroom' THEN membership.user_id
             ELSE legacy_link.user_id
           END
      FROM public.principals principal
      JOIN public.projects project ON project.id = p_project_id
      LEFT JOIN public.classroom_memberships membership
        ON membership.tenant_id = project.tenant_id
       AND membership.classroom_id = project.classroom_id
       AND membership.account_id = principal.account_id
       AND membership.member_role IN ('owner', 'co_teacher')
      LEFT JOIN public.legacy_user_account_links legacy_link
        ON legacy_link.tenant_id = project.tenant_id
       AND legacy_link.account_id = principal.account_id
       AND legacy_link.migration_state = 'active'
     WHERE principal.id = p_principal_id
       AND (
         (project.project_scope = 'personal'
          AND project.owner_principal_id = p_principal_id)
         OR
         (project.project_scope = 'classroom' AND membership.user_id IS NOT NULL)
       )
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION classroom_list_for_account(p_account_id uuid)
RETURNS TABLE (
    id uuid,
    title varchar,
    status varchar,
    age_band varchar,
    topic_keys text[],
    safe_mode_default boolean,
    created_at timestamptz,
    join_code_version integer,
    join_code_status varchar,
    student_count integer,
    teacher_role varchar,
    workspace_kind varchar,
    workspace_title varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title, c.status, c.age_band, c.topic_keys,
           c.safe_mode_default, c.created_at, jc.version, jc.status,
           count(s.id) FILTER (WHERE s.status <> 'removed')::integer,
           m.member_role, w.kind, w.title
      FROM public.classrooms c
      JOIN public.classroom_memberships m
        ON m.tenant_id = c.tenant_id AND m.classroom_id = c.id
      JOIN public.workspaces w ON w.tenant_id = c.tenant_id
      LEFT JOIN LATERAL (
          SELECT code.version, code.status
            FROM public.classroom_join_codes code
           WHERE code.tenant_id = c.tenant_id AND code.classroom_id = c.id
           ORDER BY code.version DESC LIMIT 1
      ) jc ON true
      LEFT JOIN public.classroom_student_seats s
        ON s.tenant_id = c.tenant_id AND s.classroom_id = c.id
     WHERE m.account_id = p_account_id
       AND m.member_role IN ('owner', 'co_teacher')
       AND c.status = 'active'
     GROUP BY c.id, jc.version, jc.status, m.member_role, w.kind, w.title
     ORDER BY c.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION classroom_management_summary(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    id uuid,
    title varchar,
    status varchar,
    age_band varchar,
    topic_keys text[],
    safe_mode_default boolean,
    created_at timestamptz,
    join_code_version integer,
    join_code_status varchar,
    student_count integer,
    teacher_role varchar,
    workspace_kind varchar,
    workspace_title varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title, c.status, c.age_band, c.topic_keys,
           c.safe_mode_default, c.created_at, jc.version, jc.status,
           count(s.id) FILTER (WHERE s.status <> 'removed')::integer,
           m.member_role, w.kind, w.title
      FROM public.classrooms c
      JOIN public.classroom_memberships m
        ON m.tenant_id = c.tenant_id AND m.classroom_id = c.id
      JOIN public.workspaces w ON w.tenant_id = c.tenant_id
      LEFT JOIN LATERAL (
          SELECT code.version, code.status
            FROM public.classroom_join_codes code
           WHERE code.tenant_id = c.tenant_id AND code.classroom_id = c.id
           ORDER BY code.version DESC LIMIT 1
      ) jc ON true
      LEFT JOIN public.classroom_student_seats s
        ON s.tenant_id = c.tenant_id AND s.classroom_id = c.id
     WHERE m.account_id = p_account_id
       AND m.classroom_id = p_classroom_id
       AND m.member_role IN ('owner', 'co_teacher')
       AND c.status = 'active'
     GROUP BY c.id, jc.version, jc.status, m.member_role, w.kind, w.title;
$$;

CREATE OR REPLACE FUNCTION classroom_management_roster(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    id uuid,
    display_label varchar,
    login_handle varchar,
    safe_mode boolean,
    status varchar,
    last_active_at timestamptz,
    created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.id, s.display_label, s.login_handle, s.safe_mode, s.status,
           s.last_active_at, s.created_at
      FROM public.classroom_student_seats s
     WHERE s.classroom_id = p_classroom_id
       AND s.status <> 'removed'
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships m
            WHERE m.account_id = p_account_id
              AND m.classroom_id = p_classroom_id
              AND m.tenant_id = s.tenant_id
              AND m.member_role IN ('owner', 'co_teacher'))
     ORDER BY lower(s.display_label), s.id;
$$;

CREATE OR REPLACE FUNCTION classroom_management_add_seat(
    p_account_id uuid,
    p_classroom_id uuid,
    p_display_label varchar,
    p_login_handle varchar,
    p_safe_mode boolean
)
RETURNS TABLE (
    id uuid, display_label varchar, login_handle varchar, safe_mode boolean,
    status varchar, last_active_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_access record;
    v_id uuid;
BEGIN
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
    INSERT INTO public.classroom_student_seats
        (tenant_id, classroom_id, display_label, login_handle,
         normalized_login_handle, safe_mode, created_by)
    VALUES
        (v_access.tenant_id, p_classroom_id, trim(p_display_label), lower(trim(p_login_handle)),
         lower(trim(p_login_handle)), p_safe_mode, v_access.user_id)
    RETURNING classroom_student_seats.id INTO v_id;
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_access.tenant_id, v_access.user_id, 'student_seat', v_id,
         'classroom.student_seat_created',
         jsonb_build_object('classroomId', p_classroom_id, 'safeMode', p_safe_mode,
                            'teacherRole', v_access.teacher_role));
    RETURN QUERY
    SELECT s.id, s.display_label, s.login_handle, s.safe_mode, s.status,
           s.last_active_at, s.created_at
      FROM public.classroom_student_seats s WHERE s.id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_management_update_seat(
    p_account_id uuid,
    p_classroom_id uuid,
    p_seat_id uuid,
    p_display_label varchar,
    p_login_handle varchar,
    p_safe_mode boolean,
    p_status varchar
)
RETURNS TABLE (
    id uuid, display_label varchar, login_handle varchar, safe_mode boolean,
    status varchar, last_active_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_access record;
    v_updated integer := 0;
BEGIN
    IF p_status NOT IN ('issued', 'active', 'suspended') THEN RAISE EXCEPTION 'invalid seat status'; END IF;
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
    UPDATE public.classroom_student_seats s
       SET display_label = trim(p_display_label),
           login_handle = lower(trim(p_login_handle)),
           normalized_login_handle = lower(trim(p_login_handle)),
           safe_mode = p_safe_mode, status = p_status, updated_at = now()
     WHERE s.tenant_id = v_access.tenant_id
       AND s.classroom_id = p_classroom_id
       AND s.id = p_seat_id AND s.status <> 'removed';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN RAISE EXCEPTION 'student seat unavailable'; END IF;
    IF p_status = 'suspended' THEN
        UPDATE public.classroom_student_sessions ss SET revoked_at = now()
          FROM public.classroom_student_seats s
         WHERE ss.seat_id = s.id AND s.id = p_seat_id AND ss.revoked_at IS NULL;
    END IF;
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_access.tenant_id, v_access.user_id, 'student_seat', p_seat_id,
         'classroom.student_seat_updated',
         jsonb_build_object('classroomId', p_classroom_id, 'safeMode', p_safe_mode,
                            'status', p_status, 'teacherRole', v_access.teacher_role));
    RETURN QUERY
    SELECT s.id, s.display_label, s.login_handle, s.safe_mode, s.status,
           s.last_active_at, s.created_at
      FROM public.classroom_student_seats s WHERE s.id = p_seat_id;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_management_remove_seat(
    p_account_id uuid,
    p_classroom_id uuid,
    p_seat_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_access record;
    v_updated integer := 0;
BEGIN
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
    UPDATE public.classroom_student_seats s
       SET status = 'removed', updated_at = now()
     WHERE s.tenant_id = v_access.tenant_id AND s.classroom_id = p_classroom_id
       AND s.id = p_seat_id AND s.status <> 'removed';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    UPDATE public.classroom_student_sessions ss SET revoked_at = now()
      FROM public.classroom_student_seats s
     WHERE ss.seat_id = s.id AND s.id = p_seat_id AND ss.revoked_at IS NULL;
    IF v_updated = 1 THEN
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (v_access.tenant_id, v_access.user_id, 'student_seat', p_seat_id,
             'classroom.student_seat_removed',
             jsonb_build_object('classroomId', p_classroom_id,
                                'teacherRole', v_access.teacher_role));
    END IF;
    RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_management_rotate_join_code(
    p_account_id uuid,
    p_classroom_id uuid,
    p_token_hash varchar,
    p_version integer
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_access record;
BEGIN
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
    UPDATE public.classroom_join_codes SET status = 'revoked', revoked_at = now()
     WHERE tenant_id = v_access.tenant_id AND classroom_id = p_classroom_id AND status = 'active';
    INSERT INTO public.classroom_join_codes
        (tenant_id, classroom_id, token_hash, version, status)
    VALUES (v_access.tenant_id, p_classroom_id, p_token_hash, p_version, 'active');
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_access.tenant_id, v_access.user_id, 'classroom', p_classroom_id,
         'classroom.join_code_rotated',
         jsonb_build_object('version', p_version, 'teacherRole', v_access.teacher_role));
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_management_update_policy(
    p_account_id uuid,
    p_classroom_id uuid,
    p_safe_mode_default boolean
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_access record; v_updated integer := 0;
BEGIN
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
    UPDATE public.classrooms SET safe_mode_default = p_safe_mode_default
     WHERE tenant_id = v_access.tenant_id AND id = p_classroom_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (v_access.tenant_id, v_access.user_id, 'classroom', p_classroom_id,
             'classroom.safe_mode_updated',
             jsonb_build_object('safeModeDefault', p_safe_mode_default,
                                'teacherRole', v_access.teacher_role));
    END IF;
    RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_management_revoke_join_code(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_access record; v_updated integer := 0;
BEGIN
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
    UPDATE public.classroom_join_codes SET status = 'revoked', revoked_at = now()
     WHERE tenant_id = v_access.tenant_id AND classroom_id = p_classroom_id AND status = 'active';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (v_access.tenant_id, v_access.user_id, 'classroom', p_classroom_id,
             'classroom.join_code_revoked',
             jsonb_build_object('teacherRole', v_access.teacher_role));
    END IF;
    RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_team(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    account_id uuid,
    display_name varchar,
    avatar_data_url text,
    teacher_role varchar,
    joined_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT m.account_id, p.display_name, p.avatar_data_url, m.member_role, m.created_at
      FROM public.classroom_memberships viewer
      JOIN public.classroom_memberships m
        ON m.tenant_id = viewer.tenant_id AND m.classroom_id = viewer.classroom_id
      JOIN public.profiles p ON p.account_id = m.account_id
     WHERE viewer.account_id = p_account_id
       AND viewer.classroom_id = p_classroom_id
       AND viewer.member_role IN ('owner', 'co_teacher')
       AND m.member_role IN ('owner', 'co_teacher')
     ORDER BY (m.member_role = 'owner') DESC, lower(p.display_name);
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_invitation_create(
    p_account_id uuid,
    p_classroom_id uuid,
    p_token_hash varchar,
    p_expires_at timestamptz
)
RETURNS TABLE (id uuid, expires_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_tenant uuid; v_user uuid; v_id uuid; v_created timestamptz;
BEGIN
    SELECT m.tenant_id, m.user_id INTO v_tenant, v_user
      FROM public.classroom_memberships m
     WHERE m.account_id = p_account_id AND m.classroom_id = p_classroom_id
       AND m.member_role = 'owner';
    IF v_tenant IS NULL THEN RAISE EXCEPTION 'classroom owner required'; END IF;
    UPDATE public.classroom_teacher_invitations AS invitation
       SET status = 'expired'
     WHERE invitation.tenant_id = v_tenant
       AND invitation.classroom_id = p_classroom_id
       AND invitation.status = 'pending'
       AND invitation.expires_at <= now();
    IF (
        SELECT count(*) FROM (
            SELECT m.id FROM public.classroom_memberships m
             WHERE m.tenant_id = v_tenant AND m.classroom_id = p_classroom_id
               AND m.member_role = 'co_teacher'
            UNION ALL
            SELECT i.id FROM public.classroom_teacher_invitations i
             WHERE i.tenant_id = v_tenant AND i.classroom_id = p_classroom_id
               AND i.status = 'pending' AND i.expires_at > now()
        ) slots
    ) >= 5 THEN
        RAISE EXCEPTION 'co-teacher limit reached';
    END IF;
    INSERT INTO public.classroom_teacher_invitations
        (tenant_id, classroom_id, token_hash, invited_by_account_id, expires_at)
    VALUES (v_tenant, p_classroom_id, p_token_hash, p_account_id, p_expires_at)
    RETURNING classroom_teacher_invitations.id, classroom_teacher_invitations.created_at
         INTO v_id, v_created;
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_tenant, v_user, 'classroom', p_classroom_id,
         'classroom.co_teacher_invited', jsonb_build_object('invitationId', v_id));
    RETURN QUERY SELECT v_id, p_expires_at, v_created;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_invitation_list(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (id uuid, status varchar, expires_at timestamptz, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT i.id, i.status, i.expires_at, i.created_at
      FROM public.classroom_teacher_invitations i
     WHERE i.classroom_id = p_classroom_id
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships m
            WHERE m.account_id = p_account_id AND m.classroom_id = p_classroom_id
              AND m.member_role = 'owner')
       AND i.status = 'pending'
       AND i.expires_at > now()
     ORDER BY i.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_invitation_resolve(p_token_hash varchar)
RETURNS TABLE (
    classroom_id uuid,
    classroom_title varchar,
    owner_display_name varchar,
    status varchar,
    expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title, p.display_name,
           CASE WHEN i.status = 'pending' AND i.expires_at <= now() THEN 'expired'::varchar ELSE i.status END,
           i.expires_at
      FROM public.classroom_teacher_invitations i
      JOIN public.classrooms c
        ON c.tenant_id = i.tenant_id AND c.id = i.classroom_id
      JOIN public.profiles p ON p.account_id = i.invited_by_account_id
     WHERE i.token_hash = p_token_hash
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_invitation_accept(
    p_account_id uuid,
    p_token_hash varchar
)
RETURNS TABLE (classroom_id uuid, classroom_title varchar, teacher_role varchar)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_invitation record;
    v_user uuid;
    v_principal uuid;
    v_email varchar(255);
    v_password_hash text;
    v_display_name varchar(255);
    v_school uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.capability_grants g
         WHERE g.account_id = p_account_id AND g.capability = 'educator'
           AND g.state IN ('provisional', 'verified'))
    THEN RAISE EXCEPTION 'educator required'; END IF;
    SELECT i.*, c.title, c.school_id INTO v_invitation
      FROM public.classroom_teacher_invitations i
      JOIN public.classrooms c ON c.tenant_id = i.tenant_id AND c.id = i.classroom_id
     WHERE i.token_hash = p_token_hash FOR UPDATE OF i;
    IF v_invitation.id IS NULL OR v_invitation.status <> 'pending' OR v_invitation.expires_at <= now()
    THEN RAISE EXCEPTION 'invitation unavailable'; END IF;
    IF v_invitation.invited_by_account_id = p_account_id
    THEN RAISE EXCEPTION 'owner cannot accept own invitation'; END IF;
    IF (SELECT count(*) FROM public.classroom_memberships m
         WHERE m.tenant_id = v_invitation.tenant_id
           AND m.classroom_id = v_invitation.classroom_id
           AND m.member_role = 'co_teacher') >= 5
    THEN RAISE EXCEPTION 'co-teacher limit reached'; END IF;

    SELECT l.user_id INTO v_user
      FROM public.legacy_user_account_links l
     WHERE l.account_id = p_account_id AND l.tenant_id = v_invitation.tenant_id
       AND l.migration_state = 'active' LIMIT 1;
    IF v_user IS NULL THEN
        SELECT pr.id, a.email, a.password_hash,
               COALESCE(NULLIF(p.display_name, ''), p.username)
          INTO v_principal, v_email, v_password_hash, v_display_name
          FROM public.accounts a
          JOIN public.profiles p ON p.account_id = a.id
          JOIN public.principals pr ON pr.account_id = a.id
         WHERE a.id = p_account_id AND a.status = 'active';
        v_school := v_invitation.school_id;
        INSERT INTO public.users
            (tenant_id, school_id, role, email, display_name, password_hash, status)
        VALUES
            (v_invitation.tenant_id, v_school, 'teacher', v_email,
             v_display_name, v_password_hash, 'active')
        RETURNING id INTO v_user;
        INSERT INTO public.legacy_user_account_links
            (tenant_id, user_id, account_id, principal_id, migration_state)
        VALUES (v_invitation.tenant_id, v_user, p_account_id, v_principal, 'active');
    END IF;

    INSERT INTO public.classroom_memberships
        (tenant_id, classroom_id, user_id, account_id, member_role)
    VALUES
        (v_invitation.tenant_id, v_invitation.classroom_id, v_user, p_account_id, 'co_teacher')
    ON CONFLICT ON CONSTRAINT classroom_memberships_tenant_id_classroom_id_user_id_key DO UPDATE
        SET account_id = EXCLUDED.account_id, member_role = 'co_teacher';
    UPDATE public.classroom_teacher_invitations
       SET status = 'accepted', accepted_by_account_id = p_account_id, accepted_at = now()
     WHERE id = v_invitation.id;
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_invitation.tenant_id, v_user, 'classroom', v_invitation.classroom_id,
         'classroom.co_teacher_joined', jsonb_build_object('invitationId', v_invitation.id));
    RETURN QUERY SELECT v_invitation.classroom_id, v_invitation.title::varchar, 'co_teacher'::varchar;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_invitation_revoke(
    p_account_id uuid,
    p_classroom_id uuid,
    p_invitation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_tenant uuid; v_user uuid; v_updated integer := 0;
BEGIN
    SELECT m.tenant_id, m.user_id INTO v_tenant, v_user
      FROM public.classroom_memberships m
     WHERE m.account_id = p_account_id AND m.classroom_id = p_classroom_id
       AND m.member_role = 'owner';
    IF v_tenant IS NULL THEN RAISE EXCEPTION 'classroom owner required'; END IF;
    UPDATE public.classroom_teacher_invitations
       SET status = 'revoked', revoked_at = now()
     WHERE id = p_invitation_id AND tenant_id = v_tenant AND classroom_id = p_classroom_id
       AND status = 'pending';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (v_tenant, v_user, 'classroom', p_classroom_id,
             'classroom.co_teacher_invitation_revoked',
             jsonb_build_object('invitationId', p_invitation_id));
    END IF;
    RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_teacher_remove(
    p_account_id uuid,
    p_classroom_id uuid,
    p_teacher_account_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_tenant uuid; v_user uuid; v_updated integer := 0;
BEGIN
    SELECT m.tenant_id, m.user_id INTO v_tenant, v_user
      FROM public.classroom_memberships m
     WHERE m.account_id = p_account_id AND m.classroom_id = p_classroom_id
       AND m.member_role = 'owner';
    IF v_tenant IS NULL THEN RAISE EXCEPTION 'classroom owner required'; END IF;
    DELETE FROM public.classroom_memberships m
     WHERE m.tenant_id = v_tenant AND m.classroom_id = p_classroom_id
       AND m.account_id = p_teacher_account_id AND m.member_role = 'co_teacher';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (v_tenant, v_user, 'classroom', p_classroom_id,
             'classroom.co_teacher_removed',
             jsonb_build_object('accountId', p_teacher_account_id));
    END IF;
    RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION classroom_ensure_personal_teacher(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_access(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_project_context_for_principal(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION project_context_for_principal(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_list_for_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_management_summary(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_management_roster(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_management_add_seat(uuid, uuid, varchar, varchar, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_management_update_seat(uuid, uuid, uuid, varchar, varchar, boolean, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_management_remove_seat(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_management_rotate_join_code(uuid, uuid, varchar, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_management_update_policy(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_management_revoke_join_code(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_team(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_invitation_create(uuid, uuid, varchar, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_invitation_list(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_invitation_resolve(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_invitation_accept(uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_invitation_revoke(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_teacher_remove(uuid, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION classroom_ensure_personal_teacher(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_access(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_project_context_for_principal(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION project_context_for_principal(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_list_for_account(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_management_summary(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_management_roster(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_management_add_seat(uuid, uuid, varchar, varchar, boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_management_update_seat(uuid, uuid, uuid, varchar, varchar, boolean, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_management_remove_seat(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_management_rotate_join_code(uuid, uuid, varchar, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_management_update_policy(uuid, uuid, boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_management_revoke_join_code(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_team(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_invitation_create(uuid, uuid, varchar, timestamptz) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_invitation_list(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_invitation_resolve(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_invitation_accept(uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_invitation_revoke(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_teacher_remove(uuid, uuid, uuid) TO asalab_app;
