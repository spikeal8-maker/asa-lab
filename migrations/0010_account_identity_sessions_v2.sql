-- Owner preview convergence: additive global identity and principal sessions.
-- Existing tenants, users, sessions, projects and tenant lineage are preserved.

CREATE TABLE IF NOT EXISTS accounts (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email                    varchar(255) NOT NULL,
    password_hash            text NOT NULL,
    email_verification_state varchar(32) NOT NULL DEFAULT 'unverified'
                             CHECK (email_verification_state IN ('unverified', 'pending', 'verified')),
    birth_date               date NOT NULL,
    country                  varchar(2) NOT NULL,
    status                   varchar(32) NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'suspended', 'closed')),
    created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_ci_idx ON accounts (lower(email));

CREATE TABLE IF NOT EXISTS profiles (
    account_id   uuid PRIMARY KEY REFERENCES accounts(id),
    username     varchar(64) NOT NULL,
    display_name varchar(255) NOT NULL,
    visibility   varchar(32) NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private', 'restricted', 'public')),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_ci_idx ON profiles (lower(username));

CREATE TABLE IF NOT EXISTS principals (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind       varchar(32) NOT NULL CHECK (kind = 'account'),
    account_id uuid NOT NULL REFERENCES accounts(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS principals_account_idx ON principals (account_id);

CREATE TABLE IF NOT EXISTS capability_grants (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id     uuid NOT NULL REFERENCES accounts(id),
    capability     varchar(32) NOT NULL
                   CHECK (capability IN ('creator', 'educator', 'registered_student',
                                         'guardian', 'platform_admin')),
    state          varchar(32) NOT NULL DEFAULT 'provisional'
                   CHECK (state IN ('provisional', 'verified', 'suspended', 'revoked')),
    policy_version varchar(32) NOT NULL,
    granted_by     varchar(32) NOT NULL DEFAULT 'server'
                   CHECK (granted_by IN ('server', 'self_attestation', 'admin', 'migration')),
    granted_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, capability)
);

CREATE TABLE IF NOT EXISTS workspaces (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL UNIQUE REFERENCES tenants(id),
    kind       varchar(32) NOT NULL CHECK (kind IN ('personal', 'organization')),
    title      varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_memberships (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id   uuid NOT NULL REFERENCES accounts(id),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    role         varchar(32) NOT NULL
                 CHECK (role IN ('owner', 'member', 'educator', 'school_admin',
                                 'billing_admin', 'moderator')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS workspace_memberships_account_idx
    ON workspace_memberships (account_id);

CREATE TABLE IF NOT EXISTS legacy_user_account_links (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    user_id         uuid NOT NULL,
    account_id      uuid NOT NULL REFERENCES accounts(id),
    principal_id    uuid NOT NULL REFERENCES principals(id),
    migration_state varchar(32) NOT NULL DEFAULT 'active'
                    CHECK (migration_state IN ('active', 'superseded', 'retired')),
    migrated_at     timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
    UNIQUE (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS legacy_user_account_links_account_idx
    ON legacy_user_account_links (account_id);

CREATE TABLE IF NOT EXISTS sessions_v2 (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    principal_id        uuid NOT NULL REFERENCES principals(id),
    active_workspace_id uuid NOT NULL REFERENCES workspaces(id),
    token_hash          text NOT NULL UNIQUE,
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    last_seen_at        timestamptz NOT NULL DEFAULT now(),
    revoked_at          timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_v2_principal_idx ON sessions_v2 (principal_id)
    WHERE revoked_at IS NULL;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_principal_id uuid REFERENCES principals(id);
ALTER TABLE projects ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_owner_present_check;
ALTER TABLE projects ADD CONSTRAINT projects_owner_present_check
    CHECK (created_by IS NOT NULL OR owner_principal_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS projects_owner_principal_idx
    ON projects (tenant_id, owner_principal_id, created_at DESC)
    WHERE owner_principal_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS projects_principal_idempotency_idx
    ON projects (tenant_id, owner_principal_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND owner_principal_id IS NOT NULL;

ALTER TABLE project_drafts
    ADD COLUMN IF NOT EXISTS updated_by_principal_id uuid REFERENCES principals(id);
ALTER TABLE project_drafts ALTER COLUMN updated_by DROP NOT NULL;
ALTER TABLE project_drafts DROP CONSTRAINT IF EXISTS project_drafts_author_present_check;
ALTER TABLE project_drafts ADD CONSTRAINT project_drafts_author_present_check
    CHECK (updated_by IS NOT NULL OR updated_by_principal_id IS NOT NULL);

ALTER TABLE project_versions
    ADD COLUMN IF NOT EXISTS created_by_principal_id uuid REFERENCES principals(id);
ALTER TABLE project_versions ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE project_versions DROP CONSTRAINT IF EXISTS project_versions_author_present_check;
ALTER TABLE project_versions ADD CONSTRAINT project_versions_author_present_check
    CHECK (created_by IS NOT NULL OR created_by_principal_id IS NOT NULL);

INSERT INTO workspaces (tenant_id, kind, title)
SELECT t.id, 'organization', t.title
  FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.tenant_id = t.id);

INSERT INTO accounts (email, password_hash, birth_date, country)
SELECT DISTINCT ON (lower(u.email))
       u.email, u.password_hash, DATE '1990-01-01', 'RU'
  FROM users u
 WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE lower(a.email) = lower(u.email))
 ORDER BY lower(u.email), u.created_at;

INSERT INTO profiles (account_id, username, display_name)
SELECT a.id,
       'edu-' || substr(replace(a.id::text, '-', ''), 1, 10),
       COALESCE(u.display_name, 'edu-' || substr(replace(a.id::text, '-', ''), 1, 10))
  FROM accounts a
  JOIN LATERAL (
        SELECT display_name
          FROM users
         WHERE lower(email) = lower(a.email)
         ORDER BY created_at
         LIMIT 1
       ) u ON true
 WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.account_id = a.id);

INSERT INTO principals (kind, account_id)
SELECT 'account', a.id
  FROM accounts a
 WHERE NOT EXISTS (SELECT 1 FROM principals p WHERE p.account_id = a.id);

INSERT INTO capability_grants (account_id, capability, state, policy_version, granted_by)
SELECT a.id, 'creator', 'verified', 'asa-lab-2026-07', 'migration'
  FROM accounts a
 WHERE NOT EXISTS (
       SELECT 1 FROM capability_grants g
        WHERE g.account_id = a.id AND g.capability = 'creator');

INSERT INTO capability_grants (account_id, capability, state, policy_version, granted_by)
SELECT DISTINCT a.id, 'educator', 'verified', 'asa-lab-2026-07', 'migration'
  FROM accounts a
  JOIN users u ON lower(u.email) = lower(a.email)
 WHERE u.role = 'teacher'
   AND NOT EXISTS (
       SELECT 1 FROM capability_grants g
        WHERE g.account_id = a.id AND g.capability = 'educator');

INSERT INTO workspace_memberships (account_id, workspace_id, role)
SELECT a.id, w.id, 'educator'
  FROM users u
  JOIN accounts a ON lower(a.email) = lower(u.email)
  JOIN workspaces w ON w.tenant_id = u.tenant_id
 WHERE NOT EXISTS (
       SELECT 1 FROM workspace_memberships m
        WHERE m.account_id = a.id AND m.workspace_id = w.id);

INSERT INTO legacy_user_account_links (tenant_id, user_id, account_id, principal_id)
SELECT u.tenant_id, u.id, a.id, p.id
  FROM users u
  JOIN accounts a ON lower(a.email) = lower(u.email)
  JOIN principals p ON p.account_id = a.id
 WHERE NOT EXISTS (
       SELECT 1 FROM legacy_user_account_links l
        WHERE l.tenant_id = u.tenant_id AND l.user_id = u.id);

UPDATE projects p
   SET owner_principal_id = l.principal_id
  FROM legacy_user_account_links l
 WHERE p.owner_principal_id IS NULL
   AND l.tenant_id = p.tenant_id
   AND l.user_id = p.created_by;

UPDATE project_drafts d
   SET updated_by_principal_id = l.principal_id
  FROM legacy_user_account_links l
 WHERE d.updated_by_principal_id IS NULL
   AND l.tenant_id = d.tenant_id
   AND l.user_id = d.updated_by;

DO $$
DECLARE
    v_account record;
    v_tenant uuid;
    v_slug varchar(64);
BEGIN
    FOR v_account IN
        SELECT a.id, COALESCE(NULLIF(p.display_name, ''), p.username) AS title
          FROM accounts a
          JOIN profiles p ON p.account_id = a.id
         WHERE NOT EXISTS (
               SELECT 1
                 FROM workspace_memberships m
                 JOIN workspaces w ON w.id = m.workspace_id
                WHERE m.account_id = a.id AND w.kind = 'personal')
    LOOP
        v_slug := 'personal-' || substr(replace(v_account.id::text, '-', ''), 1, 32);
        SELECT id INTO v_tenant FROM tenants WHERE workspace_slug = v_slug;
        IF v_tenant IS NULL THEN
            INSERT INTO tenants (workspace_slug, title)
            VALUES (v_slug, v_account.title)
            RETURNING id INTO v_tenant;
            INSERT INTO tenant_placements (tenant_id, mode)
            VALUES (v_tenant, 'SHARED_CLUSTER');
        END IF;
        INSERT INTO workspaces (tenant_id, kind, title)
        VALUES (v_tenant, 'personal', v_account.title)
        ON CONFLICT (tenant_id) DO NOTHING;
        INSERT INTO workspace_memberships (account_id, workspace_id, role)
        SELECT v_account.id, w.id, 'owner'
          FROM workspaces w
         WHERE w.tenant_id = v_tenant
        ON CONFLICT (account_id, workspace_id) DO NOTHING;
    END LOOP;
END;
$$;

REVOKE ALL ON accounts, profiles, principals, capability_grants, workspaces,
              workspace_memberships, legacy_user_account_links, sessions_v2
    FROM asalab_app;

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_user_account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions_v2 ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION auth_register_account(
    p_email varchar,
    p_password_hash text,
    p_display_name varchar,
    p_username varchar,
    p_birth_date date,
    p_country varchar,
    p_policy_version varchar,
    p_token_hash text,
    p_ttl_hours integer
)
RETURNS TABLE (account_id uuid, principal_id uuid, workspace_id uuid, tenant_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_account uuid;
    v_principal uuid;
    v_tenant uuid;
    v_workspace uuid;
    v_title varchar(255);
BEGIN
    v_title := COALESCE(NULLIF(p_display_name, ''), p_username);
    INSERT INTO public.accounts (email, password_hash, birth_date, country)
    VALUES (lower(p_email), p_password_hash, p_birth_date, upper(p_country))
    RETURNING id INTO v_account;
    INSERT INTO public.profiles (account_id, username, display_name)
    VALUES (v_account, lower(p_username), v_title);
    INSERT INTO public.principals (kind, account_id)
    VALUES ('account', v_account)
    RETURNING id INTO v_principal;
    INSERT INTO public.capability_grants
        (account_id, capability, state, policy_version, granted_by)
    VALUES (v_account, 'creator', 'verified', p_policy_version, 'server');
    INSERT INTO public.tenants (workspace_slug, title)
    VALUES ('personal-' || replace(v_account::text, '-', ''), v_title)
    RETURNING id INTO v_tenant;
    INSERT INTO public.tenant_placements (tenant_id, mode)
    VALUES (v_tenant, 'SHARED_CLUSTER');
    INSERT INTO public.workspaces (tenant_id, kind, title)
    VALUES (v_tenant, 'personal', v_title)
    RETURNING id INTO v_workspace;
    INSERT INTO public.workspace_memberships (account_id, workspace_id, role)
    VALUES (v_account, v_workspace, 'owner');
    INSERT INTO public.sessions_v2
        (principal_id, active_workspace_id, token_hash, expires_at)
    VALUES (v_principal, v_workspace, p_token_hash,
            now() + make_interval(hours => p_ttl_hours));
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES (v_tenant, NULL, 'account', v_account, 'account.registered',
            jsonb_build_object('workspaceKind', 'personal',
                               'policyVersion', p_policy_version));
    RETURN QUERY SELECT v_account, v_principal, v_workspace, v_tenant;
END;
$$;

CREATE OR REPLACE FUNCTION auth_find_account(p_email_lower varchar)
RETURNS TABLE (id uuid, email varchar, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.id, a.email, a.password_hash
      FROM public.accounts a
     WHERE lower(a.email) = p_email_lower AND a.status = 'active'
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_find_account_by_username(p_username_lower varchar)
RETURNS TABLE (id uuid, email varchar, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.id, a.email, a.password_hash
      FROM public.accounts a
      JOIN public.profiles p ON p.account_id = a.id
     WHERE lower(p.username) = p_username_lower AND a.status = 'active'
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_username_available(p_username varchar)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE lower(username) = lower(p_username));
$$;

CREATE OR REPLACE FUNCTION auth_personal_workspace(p_account_id uuid)
RETURNS TABLE (workspace_id uuid, tenant_id uuid, principal_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT w.id, w.tenant_id, pr.id
      FROM public.workspace_memberships m
      JOIN public.workspaces w ON w.id = m.workspace_id
      JOIN public.principals pr ON pr.account_id = m.account_id
     WHERE m.account_id = p_account_id AND w.kind = 'personal'
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_account_capabilities(p_account_id uuid)
RETURNS TABLE (capability varchar, state varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT g.capability, g.state
      FROM public.capability_grants g
     WHERE g.account_id = p_account_id
     ORDER BY g.capability;
$$;

CREATE OR REPLACE FUNCTION auth_account_workspaces(p_account_id uuid)
RETURNS TABLE (workspace_id uuid, tenant_id uuid, kind varchar, title varchar, role varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT w.id, w.tenant_id, w.kind, w.title, m.role
      FROM public.workspace_memberships m
      JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE m.account_id = p_account_id
     ORDER BY (w.kind = 'personal') DESC, w.title;
$$;

CREATE OR REPLACE FUNCTION auth_account_for_user(p_tenant_id uuid, p_user_id uuid)
RETURNS TABLE (account_id uuid, principal_id uuid, workspace_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT l.account_id, l.principal_id, w.id
      FROM public.legacy_user_account_links l
      JOIN public.workspaces w
        ON w.tenant_id = l.tenant_id AND w.kind = 'organization'
     WHERE l.tenant_id = p_tenant_id
       AND l.user_id = p_user_id
       AND l.migration_state = 'active'
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_legacy_actor_for_account(p_account_id uuid)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT l.tenant_id, l.user_id
      FROM public.legacy_user_account_links l
      JOIN public.users u
        ON u.tenant_id = l.tenant_id AND u.id = l.user_id
     WHERE l.account_id = p_account_id
       AND l.migration_state = 'active'
       AND u.status = 'active'
     ORDER BY l.migrated_at
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION session_v2_create(
    p_principal_id uuid,
    p_workspace_id uuid,
    p_token_hash text,
    p_ttl_hours integer
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_id uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM public.workspace_memberships m
          JOIN public.principals pr ON pr.account_id = m.account_id
         WHERE pr.id = p_principal_id AND m.workspace_id = p_workspace_id)
    THEN
        RAISE EXCEPTION 'principal is not a member of workspace';
    END IF;
    INSERT INTO public.sessions_v2
        (principal_id, active_workspace_id, token_hash, expires_at)
    VALUES (p_principal_id, p_workspace_id, p_token_hash,
            now() + make_interval(hours => p_ttl_hours))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION session_v2_context(p_token_hash text)
RETURNS TABLE (
    principal_id uuid,
    account_id uuid,
    workspace_id uuid,
    tenant_id uuid,
    workspace_kind varchar,
    user_id uuid,
    email varchar,
    display_name varchar,
    school_id uuid
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_principal uuid;
    v_workspace uuid;
BEGIN
    UPDATE public.sessions_v2 s
       SET last_seen_at = now()
     WHERE s.token_hash = p_token_hash
       AND s.revoked_at IS NULL
       AND s.expires_at > now()
    RETURNING s.principal_id, s.active_workspace_id
         INTO v_principal, v_workspace;
    IF v_principal IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT pr.id, pr.account_id, w.id, w.tenant_id, w.kind,
           l.user_id, a.email, p.display_name, u.school_id
      FROM public.principals pr
      JOIN public.accounts a
        ON a.id = pr.account_id AND a.status = 'active'
      JOIN public.profiles p ON p.account_id = a.id
      JOIN public.workspaces w ON w.id = v_workspace
      JOIN public.workspace_memberships m
        ON m.account_id = a.id AND m.workspace_id = w.id
      LEFT JOIN public.legacy_user_account_links l
        ON l.account_id = a.id
       AND l.tenant_id = w.tenant_id
       AND l.migration_state = 'active'
      LEFT JOIN public.users u
        ON u.tenant_id = w.tenant_id AND u.id = l.user_id
     WHERE pr.id = v_principal;
END;
$$;

CREATE OR REPLACE FUNCTION session_v2_revoke(p_token_hash text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    UPDATE public.sessions_v2
       SET revoked_at = now()
     WHERE token_hash = p_token_hash AND revoked_at IS NULL;
$$;

-- Personal Workspace sessions may resolve only personal projects owned by
-- their server-derived principal. The function exposes no unrelated tenant.
CREATE OR REPLACE FUNCTION project_tenant_for_principal(
    p_principal_id uuid,
    p_project_id uuid
)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT p.tenant_id
      FROM public.projects p
     WHERE p.id = p_project_id
       AND p.project_scope = 'personal'
       AND p.owner_principal_id = p_principal_id
       AND p.status = 'active'
     LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION project_list_for_principal(
    p_principal_id uuid,
    p_scope varchar DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    project_scope varchar,
    classroom_id uuid,
    module_key varchar,
    title varchar,
    status varchar,
    created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT p.id, p.project_scope, p.classroom_id, p.module_key,
           p.title, p.status, p.created_at
      FROM public.projects p
     WHERE p.owner_principal_id = p_principal_id
       AND p.project_scope = 'personal'
       AND p.status = 'active'
       AND (p_scope IS NULL OR p.project_scope = p_scope)
     ORDER BY p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION auth_register_account(varchar, text, varchar, varchar, date, varchar, varchar, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_find_account(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_find_account_by_username(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_username_available(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_personal_workspace(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_account_capabilities(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_account_workspaces(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_account_for_user(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_legacy_actor_for_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION session_v2_create(uuid, uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION session_v2_context(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION session_v2_revoke(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION project_tenant_for_principal(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION project_list_for_principal(uuid, varchar) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_register_account(varchar, text, varchar, varchar, date, varchar, varchar, text, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_find_account(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_find_account_by_username(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_username_available(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_personal_workspace(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_account_capabilities(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_account_workspaces(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_account_for_user(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_legacy_actor_for_account(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION session_v2_create(uuid, uuid, text, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION session_v2_context(text) TO asalab_app;
GRANT EXECUTE ON FUNCTION session_v2_revoke(text) TO asalab_app;
GRANT EXECUTE ON FUNCTION project_tenant_for_principal(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION project_list_for_principal(uuid, varchar) TO asalab_app;
