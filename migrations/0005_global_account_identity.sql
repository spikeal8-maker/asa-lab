-- C1.1 — global Account identity and Personal Workspace (Issue #48).
--
-- Additive by design: the tenant-scoped `users` table and every foreign key
-- that points at it stay exactly as they are. A global `accounts` row is the
-- new identity; existing teachers are backfilled into it together with a
-- membership in the workspace they already work in.
--
-- A workspace reuses the existing tenant boundary, so row-level security and
-- the restricted runtime role keep working unchanged. In the product a
-- workspace is called Personal Workspace or Organization Workspace.
--
-- A Personal Workspace is NOT a school: registration never fabricates a
-- `schools` row, an `academic_periods` row or a `users(role='teacher')` row.
-- An account is a creator; educator capability is a separate audited grant.
-- Because a legacy session still needs a tenant-scoped user, public
-- registration stays behind a feature flag until principal-aware sessions
-- (sessions_v2) exist.

CREATE TABLE IF NOT EXISTS accounts (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email                     varchar(255) NOT NULL,
    password_hash             text         NOT NULL,
    email_verification_state  varchar(32)  NOT NULL DEFAULT 'unverified'
                              CHECK (email_verification_state IN ('unverified', 'pending', 'verified')),
    birth_date                date         NOT NULL,
    country                   varchar(2)   NOT NULL,
    status                    varchar(32)  NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'suspended', 'closed')),
    created_at                timestamptz  NOT NULL DEFAULT now()
);
-- Email is the global login identifier and is case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_ci_idx ON accounts (lower(email));

CREATE TABLE IF NOT EXISTS profiles (
    account_id   uuid PRIMARY KEY REFERENCES accounts(id),
    username     varchar(64)  NOT NULL,
    display_name varchar(255) NOT NULL,
    bio          text,
    privacy      varchar(32)  NOT NULL DEFAULT 'private'
                 CHECK (privacy IN ('private', 'unlisted', 'public')),
    updated_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_ci_idx ON profiles (lower(username));

-- A workspace is the product name for a data boundary; it maps onto exactly
-- one tenant so existing RLS policies keep applying without change.
CREATE TABLE IF NOT EXISTS workspaces (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL UNIQUE REFERENCES tenants(id),
    kind       varchar(32)  NOT NULL CHECK (kind IN ('personal', 'organization')),
    title      varchar(255) NOT NULL,
    created_at timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_memberships (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id   uuid NOT NULL REFERENCES accounts(id),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    -- school_admin is a scoped workspace role, never a global capability.
    role         varchar(32) NOT NULL CHECK (role IN ('owner', 'educator', 'school_admin')),
    -- The tenant-scoped user this membership acts as, while `users` still
    -- carries classroom ownership and audit lineage.
    user_id      uuid,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS workspace_memberships_account_idx ON workspace_memberships (account_id);

-- Capabilities are issued by the server only; the browser can never grant one.
CREATE TABLE IF NOT EXISTS capability_grants (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id     uuid NOT NULL REFERENCES accounts(id),
    capability     varchar(32) NOT NULL
                   CHECK (capability IN ('creator', 'educator', 'guardian', 'platform_admin')),
    state          varchar(32) NOT NULL DEFAULT 'provisional'
                   CHECK (state IN ('provisional', 'verified', 'suspended', 'revoked')),
    policy_version varchar(32) NOT NULL,
    granted_by     varchar(32) NOT NULL DEFAULT 'server'
                   CHECK (granted_by IN ('server', 'self_attestation', 'admin')),
    granted_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, capability)
);

-- Actor registry: one row per thing that can own or act on content. Student
-- seats join this table in C3; ownership then references a principal instead of
-- a nullable pair of foreign keys.
CREATE TABLE IF NOT EXISTS principals (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind       varchar(32) NOT NULL CHECK (kind IN ('account', 'student_seat')),
    account_id uuid REFERENCES accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT principals_exactly_one_subject
        CHECK ((kind = 'account' AND account_id IS NOT NULL)
            OR (kind = 'student_seat' AND account_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS principals_account_idx ON principals (account_id)
    WHERE account_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Backfill: every existing tenant becomes an organization workspace and every
-- existing teacher becomes an account with a membership in it. Nothing is
-- renamed, moved or deleted.
-- ---------------------------------------------------------------------------
INSERT INTO workspaces (tenant_id, kind, title)
SELECT t.id, 'organization', t.title
  FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.tenant_id = t.id);

INSERT INTO accounts (email, password_hash, birth_date, country, email_verification_state)
SELECT DISTINCT ON (lower(u.email)) u.email, u.password_hash, DATE '1990-01-01', 'RU', 'unverified'
  FROM users u
 WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE lower(a.email) = lower(u.email))
 ORDER BY lower(u.email), u.created_at;

-- Usernames are pseudonyms: never derived from the email, because that would
-- leak the address and collide across domains.
INSERT INTO profiles (account_id, username, display_name)
SELECT a.id,
       'edu-' || substr(replace(a.id::text, '-', ''), 1, 10),
       COALESCE(u.display_name, 'edu-' || substr(replace(a.id::text, '-', ''), 1, 10))
  FROM accounts a
  JOIN LATERAL (
        SELECT display_name FROM users WHERE lower(email) = lower(a.email) ORDER BY created_at LIMIT 1
       ) u ON true
 WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.account_id = a.id);

INSERT INTO principals (kind, account_id)
SELECT 'account', a.id
  FROM accounts a
 WHERE NOT EXISTS (SELECT 1 FROM principals p WHERE p.account_id = a.id);

INSERT INTO capability_grants (account_id, capability, state, policy_version, granted_by)
SELECT a.id, 'creator', 'verified', 'asa-lab-2026-07', 'server'
  FROM accounts a
 WHERE NOT EXISTS (
        SELECT 1 FROM capability_grants g WHERE g.account_id = a.id AND g.capability = 'creator');

-- Existing teachers already run classes, so they keep the educator capability.
INSERT INTO capability_grants (account_id, capability, state, policy_version, granted_by)
SELECT DISTINCT a.id, 'educator', 'verified', 'asa-lab-2026-07', 'server'
  FROM accounts a
  JOIN users u ON lower(u.email) = lower(a.email)
 WHERE u.role = 'teacher'
   AND NOT EXISTS (
        SELECT 1 FROM capability_grants g WHERE g.account_id = a.id AND g.capability = 'educator');

INSERT INTO workspace_memberships (account_id, workspace_id, role, user_id)
SELECT a.id, w.id, 'educator', u.id
  FROM users u
  JOIN accounts a ON lower(a.email) = lower(u.email)
  JOIN workspaces w ON w.tenant_id = u.tenant_id
 WHERE NOT EXISTS (
        SELECT 1 FROM workspace_memberships m
         WHERE m.account_id = a.id AND m.workspace_id = w.id);

-- ---------------------------------------------------------------------------
-- Runtime role: identity tables stay unreachable directly, exactly like
-- tenants/users/sessions. Access goes through the narrow SECURITY DEFINER
-- functions below.
-- ---------------------------------------------------------------------------
REVOKE ALL ON accounts, profiles, workspaces, workspace_memberships, capability_grants, principals
    FROM asalab_app;

ALTER TABLE accounts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces            ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_grants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE principals            ENABLE ROW LEVEL SECURITY;

/**
 * Register an adult account with its Personal Workspace.
 *
 * Creates exactly the identity: account, profile, principal, the creator
 * capability, the tenant that backs the workspace and the workspace itself.
 *
 * It deliberately does NOT create a school, an academic period or a
 * tenant-scoped `users` row. A Personal Workspace is not a school and an
 * account is not a teacher; masking a creator as a teacher for legacy session
 * compatibility would hand out authority the server never granted.
 */
CREATE OR REPLACE FUNCTION auth_register_account(
    p_email          varchar,
    p_password_hash  text,
    p_display_name   varchar,
    p_username       varchar,
    p_birth_date     date,
    p_country        varchar,
    p_policy_version varchar
)
RETURNS TABLE (account_id uuid, workspace_id uuid, tenant_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_account   uuid;
    v_tenant    uuid;
    v_workspace uuid;
    v_slug      varchar(64);
BEGIN
    INSERT INTO public.accounts (email, password_hash, birth_date, country)
    VALUES (lower(p_email), p_password_hash, p_birth_date, upper(p_country))
    RETURNING id INTO v_account;

    INSERT INTO public.profiles (account_id, username, display_name)
    VALUES (v_account, p_username, COALESCE(NULLIF(p_display_name, ''), p_username));

    INSERT INTO public.principals (kind, account_id) VALUES ('account', v_account);

    INSERT INTO public.capability_grants (account_id, capability, state, policy_version, granted_by)
    VALUES (v_account, 'creator', 'verified', p_policy_version, 'server');

    v_slug := 'personal-' || pg_catalog.replace(v_account::text, '-', '');
    INSERT INTO public.tenants (workspace_slug, title)
    VALUES (v_slug, COALESCE(NULLIF(p_display_name, ''), p_username))
    RETURNING id INTO v_tenant;
    INSERT INTO public.tenant_placements (tenant_id, mode) VALUES (v_tenant, 'SHARED_CLUSTER');

    INSERT INTO public.workspaces (tenant_id, kind, title)
    VALUES (v_tenant, 'personal', COALESCE(NULLIF(p_display_name, ''), p_username))
    RETURNING id INTO v_workspace;

    -- No user_id: this membership belongs to an account, not to a teacher.
    INSERT INTO public.workspace_memberships (account_id, workspace_id, role, user_id)
    VALUES (v_account, v_workspace, 'owner', NULL);

    -- actor_user_id stays NULL: the actor is an account principal, and the
    -- composite foreign key is not enforced when the column is NULL.
    INSERT INTO public.audit_events (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES (v_tenant, NULL, 'account', v_account, 'account.registered',
            pg_catalog.jsonb_build_object('workspaceKind', 'personal', 'policyVersion', p_policy_version));

    RETURN QUERY SELECT v_account, v_workspace, v_tenant;
END;
$$;

/** Username availability check for the registration form. */
CREATE OR REPLACE FUNCTION auth_username_available(p_username varchar)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT NOT EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(p_username));
$$;

/**
 * Resolve the account behind a legacy tenant-scoped session, so capability
 * checks can run for sessions that still come from `users`.
 */
CREATE OR REPLACE FUNCTION auth_account_for_user(p_tenant_id uuid, p_user_id uuid)
RETURNS TABLE (account_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT m.account_id
      FROM public.workspace_memberships m
      JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE w.tenant_id = p_tenant_id AND m.user_id = p_user_id
     LIMIT 1;
$$;

/** Look up an account for password verification (global, workspace-free). */
CREATE OR REPLACE FUNCTION auth_find_account(p_email_lower varchar)
RETURNS TABLE (id uuid, email varchar, password_hash text, status varchar, email_verification_state varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.id, a.email, a.password_hash, a.status, a.email_verification_state
      FROM public.accounts a
     WHERE lower(a.email) = p_email_lower AND a.status = 'active'
     LIMIT 1;
$$;

/** Workspaces the account may act in, with the tenant-scoped user for each. */
CREATE OR REPLACE FUNCTION auth_account_workspaces(p_account_id uuid)
RETURNS TABLE (
    workspace_id uuid,
    tenant_id uuid,
    kind varchar,
    title varchar,
    role varchar,
    user_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT w.id, w.tenant_id, w.kind, w.title, m.role, m.user_id
      FROM public.workspace_memberships m
      JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE m.account_id = p_account_id
     ORDER BY (w.kind = 'personal') DESC, w.title;
$$;

/** Capability grants of an account, for the session payload. */
CREATE OR REPLACE FUNCTION auth_account_capabilities(p_account_id uuid)
RETURNS TABLE (capability varchar, state varchar, policy_version varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT g.capability, g.state, g.policy_version
      FROM public.capability_grants g
     WHERE g.account_id = p_account_id
     ORDER BY g.capability;
$$;

/** Profile of an account. */
CREATE OR REPLACE FUNCTION auth_account_profile(p_account_id uuid)
RETURNS TABLE (username varchar, display_name varchar, email varchar, email_verification_state varchar, birth_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT p.username, p.display_name, a.email, a.email_verification_state, a.birth_date
      FROM public.profiles p
      JOIN public.accounts a ON a.id = p.account_id
     WHERE p.account_id = p_account_id
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_register_account(varchar, text, varchar, varchar, date, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_username_available(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_account_for_user(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_find_account(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_account_workspaces(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_account_capabilities(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_account_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_register_account(varchar, text, varchar, varchar, date, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_username_available(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_account_for_user(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_find_account(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_account_workspaces(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_account_capabilities(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_account_profile(uuid) TO asalab_app;
