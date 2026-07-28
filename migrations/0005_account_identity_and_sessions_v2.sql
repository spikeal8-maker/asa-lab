-- ACCOUNT-VERTICAL-001 — a real account, its own workspace, and a session it
-- can actually sign in with.
--
-- One scenario end to end: an adult creates an account, the server gives them
-- exactly one Personal Workspace and a session bound to their principal, they
-- make a personal Electronics project, sign out, sign back in with either the
-- email or the username, and the project is still there.
--
-- Everything here is additive. The tenant-scoped `users` table and every
-- existing tenant, class and project stay exactly as they are; the only
-- relaxations are on `projects`, `project_drafts` and `project_versions`,
-- where the tenant-scoped author becomes optional so that an account with no
-- `users` row can own its own work.
--
-- A Personal Workspace is not a school: no `schools`, no `academic_periods`,
-- no `users(role='teacher')` row is created for it, and no account is handed
-- the educator capability for having registered.

-- ---------------------------------------------------------------------------
-- Global identity
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email                    varchar(255) NOT NULL,
    password_hash            text         NOT NULL,
    email_verification_state varchar(32)  NOT NULL DEFAULT 'unverified'
                             CHECK (email_verification_state IN ('unverified', 'pending', 'verified')),
    birth_date               date         NOT NULL,
    country                  varchar(2)   NOT NULL,
    status                   varchar(32)  NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'suspended', 'closed')),
    created_at               timestamptz  NOT NULL DEFAULT now()
);
-- Email is the global login identifier and is case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_ci_idx ON accounts (lower(email));

CREATE TABLE IF NOT EXISTS profiles (
    account_id   uuid PRIMARY KEY REFERENCES accounts(id),
    username     varchar(64)  NOT NULL,
    display_name varchar(255) NOT NULL,
    visibility   varchar(32)  NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private', 'restricted', 'public')),
    updated_at   timestamptz  NOT NULL DEFAULT now()
);
-- The username is a pseudonym and a login identifier, so it is unique and
-- case-insensitive like the email.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_ci_idx ON profiles (lower(username));

-- Actor registry: one row per thing that can own or act on content. Only
-- account principals exist in this slice; a StudentSeat principal arrives in
-- the same migration as the seat table it would point at.
CREATE TABLE IF NOT EXISTS principals (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind       varchar(32) NOT NULL CHECK (kind IN ('account')),
    account_id uuid NOT NULL REFERENCES accounts(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS principals_account_idx ON principals (account_id);

-- Capabilities are issued by the server only; the browser can never grant one.
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

-- ---------------------------------------------------------------------------
-- Workspaces: the product name for a data boundary, one per tenant, so the
-- existing row-level security keeps applying unchanged.
-- ---------------------------------------------------------------------------
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
    role         varchar(32) NOT NULL
                 CHECK (role IN ('owner', 'member', 'educator', 'school_admin',
                                 'billing_admin', 'moderator')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS workspace_memberships_account_idx ON workspace_memberships (account_id);

/**
 * The bridge between a global account and the tenant-scoped `users` row that
 * still owns the classes and projects made before accounts existed.
 *
 * (tenant_id, user_id) is a real composite foreign key, so the bridge cannot
 * point at a user from another tenant. A Personal Workspace has no row here at
 * all — it does not depend on `users` existing.
 */
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

-- ---------------------------------------------------------------------------
-- sessions_v2: a session belongs to a principal, not to a tenant-scoped user.
-- ---------------------------------------------------------------------------
/**
 * The active workspace is part of the session, because that is what makes a
 * request's tenant server-derived: the browser never sends a tenant, a
 * workspace or a role, and the server reads them from here.
 *
 * Only the SHA-256 hash of the token is stored, exactly like the legacy
 * sessions table.
 */
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

-- ---------------------------------------------------------------------------
-- Ownership by principal.
--
-- A project made inside a Personal Workspace has no tenant-scoped author, so
-- the author column becomes optional and a principal column joins it. Every
-- existing row keeps its `created_by` and gains the matching principal, so
-- nothing that already exists changes hands.
-- ---------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_principal_id uuid REFERENCES principals(id);
ALTER TABLE projects ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_owner_present_check;
ALTER TABLE projects ADD CONSTRAINT projects_owner_present_check
    CHECK (created_by IS NOT NULL OR owner_principal_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS projects_owner_principal_idx
    ON projects (tenant_id, owner_principal_id, created_at DESC)
    WHERE owner_principal_id IS NOT NULL;
-- Idempotency for account-owned projects mirrors the teacher-owned index.
CREATE UNIQUE INDEX IF NOT EXISTS projects_principal_idempotency_idx
    ON projects (tenant_id, owner_principal_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND owner_principal_id IS NOT NULL;

ALTER TABLE project_drafts ADD COLUMN IF NOT EXISTS updated_by_principal_id uuid REFERENCES principals(id);
ALTER TABLE project_drafts ALTER COLUMN updated_by DROP NOT NULL;
ALTER TABLE project_drafts DROP CONSTRAINT IF EXISTS project_drafts_author_present_check;
ALTER TABLE project_drafts ADD CONSTRAINT project_drafts_author_present_check
    CHECK (updated_by IS NOT NULL OR updated_by_principal_id IS NOT NULL);

ALTER TABLE project_versions ADD COLUMN IF NOT EXISTS created_by_principal_id uuid REFERENCES principals(id);
ALTER TABLE project_versions ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE project_versions DROP CONSTRAINT IF EXISTS project_versions_author_present_check;
ALTER TABLE project_versions ADD CONSTRAINT project_versions_author_present_check
    CHECK (created_by IS NOT NULL OR created_by_principal_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Backfill: every existing teacher becomes an account without losing anything.
-- Idempotent — each step is guarded, so a repeat changes nothing.
-- ---------------------------------------------------------------------------

-- 1. Every existing tenant becomes an organization workspace.
INSERT INTO workspaces (tenant_id, kind, title)
SELECT t.id, 'organization', t.title
  FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.tenant_id = t.id);

-- 2. Every existing teacher becomes an account, keeping their password hash.
INSERT INTO accounts (email, password_hash, birth_date, country)
SELECT DISTINCT ON (lower(u.email)) u.email, u.password_hash, DATE '1990-01-01', 'RU'
  FROM users u
 WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE lower(a.email) = lower(u.email))
 ORDER BY lower(u.email), u.created_at;

-- 3. A pseudonym, never derived from the email: an address would leak through
--    the username and collide across domains.
INSERT INTO profiles (account_id, username, display_name)
SELECT a.id,
       'edu-' || substr(replace(a.id::text, '-', ''), 1, 10),
       COALESCE(u.display_name, 'edu-' || substr(replace(a.id::text, '-', ''), 1, 10))
  FROM accounts a
  JOIN LATERAL (
        SELECT display_name FROM users WHERE lower(email) = lower(a.email)
         ORDER BY created_at LIMIT 1
       ) u ON true
 WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.account_id = a.id);

INSERT INTO principals (kind, account_id)
SELECT 'account', a.id
  FROM accounts a
 WHERE NOT EXISTS (SELECT 1 FROM principals p WHERE p.account_id = a.id);

-- 4. Everyone creates; that is the baseline capability of an account.
INSERT INTO capability_grants (account_id, capability, state, policy_version, granted_by)
SELECT a.id, 'creator', 'verified', 'asa-lab-2026-07', 'migration'
  FROM accounts a
 WHERE NOT EXISTS (
        SELECT 1 FROM capability_grants g WHERE g.account_id = a.id AND g.capability = 'creator');

-- 5. Existing teachers already run classes, so they keep educator. A new
--    account never gets it here: it is a separate audited grant.
INSERT INTO capability_grants (account_id, capability, state, policy_version, granted_by)
SELECT DISTINCT a.id, 'educator', 'verified', 'asa-lab-2026-07', 'migration'
  FROM accounts a
  JOIN users u ON lower(u.email) = lower(a.email)
 WHERE u.role = 'teacher'
   AND NOT EXISTS (
        SELECT 1 FROM capability_grants g WHERE g.account_id = a.id AND g.capability = 'educator');

-- 6. Membership in the organization workspace they already work in.
INSERT INTO workspace_memberships (account_id, workspace_id, role)
SELECT a.id, w.id, 'educator'
  FROM users u
  JOIN accounts a ON lower(a.email) = lower(u.email)
  JOIN workspaces w ON w.tenant_id = u.tenant_id
 WHERE NOT EXISTS (
        SELECT 1 FROM workspace_memberships m
         WHERE m.account_id = a.id AND m.workspace_id = w.id);

-- 7. The legacy bridge for that same pair.
INSERT INTO legacy_user_account_links (tenant_id, user_id, account_id, principal_id)
SELECT u.tenant_id, u.id, a.id, p.id
  FROM users u
  JOIN accounts a ON lower(a.email) = lower(u.email)
  JOIN principals p ON p.account_id = a.id
 WHERE NOT EXISTS (
        SELECT 1 FROM legacy_user_account_links l
         WHERE l.tenant_id = u.tenant_id AND l.user_id = u.id);

-- 8. Work that already exists gains its principal owner, keeping created_by.
UPDATE projects p
   SET owner_principal_id = l.principal_id
  FROM legacy_user_account_links l
 WHERE p.owner_principal_id IS NULL
   AND l.tenant_id = p.tenant_id AND l.user_id = p.created_by;

UPDATE project_drafts d
   SET updated_by_principal_id = l.principal_id
  FROM legacy_user_account_links l
 WHERE d.updated_by_principal_id IS NULL
   AND l.tenant_id = d.tenant_id AND l.user_id = d.updated_by;

-- Checkpoints are immutable by trigger, and that guarantee is respected here:
-- historical versions keep the author they were written with, and the
-- principal column describes the ones created from now on.

/**
 * 9. Every account gets exactly one Personal Workspace.
 *
 * An organization workspace is where a teacher works for a school; a Personal
 * Workspace is where the same person works for themselves. They are different
 * boundaries, so the personal one gets its own tenant — and, because it is not
 * a school, no `schools`, `academic_periods` or `users` row comes with it.
 *
 * Idempotent by construction: an account that already owns a personal
 * workspace is skipped, so a repeated backfill creates no second one.
 */
DO $$
DECLARE
    v_account record;
    v_tenant  uuid;
    v_slug    varchar(64);
BEGIN
    FOR v_account IN
        SELECT a.id, COALESCE(NULLIF(p.display_name, ''), p.username) AS title
          FROM accounts a
          JOIN profiles p ON p.account_id = a.id
          JOIN principals pr ON pr.account_id = a.id
         WHERE NOT EXISTS (
                SELECT 1
                  FROM workspace_memberships m
                  JOIN workspaces w ON w.id = m.workspace_id
                 WHERE m.account_id = a.id AND w.kind = 'personal')
    LOOP
        v_slug := 'personal-' || substr(replace(v_account.id::text, '-', ''), 1, 32);
        SELECT t.id INTO v_tenant FROM tenants t WHERE t.workspace_slug = v_slug;
        IF v_tenant IS NULL THEN
            INSERT INTO tenants (workspace_slug, title) VALUES (v_slug, v_account.title)
            RETURNING id INTO v_tenant;
            INSERT INTO tenant_placements (tenant_id, mode) VALUES (v_tenant, 'SHARED_CLUSTER');
        END IF;

        INSERT INTO workspaces (tenant_id, kind, title)
        VALUES (v_tenant, 'personal', v_account.title)
        ON CONFLICT (tenant_id) DO NOTHING;

        INSERT INTO workspace_memberships (account_id, workspace_id, role)
        SELECT v_account.id, w.id, 'owner' FROM workspaces w WHERE w.tenant_id = v_tenant
        ON CONFLICT (account_id, workspace_id) DO NOTHING;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Runtime role: identity tables stay unreachable directly, exactly like
-- tenants, users and sessions. Access goes through the narrow SECURITY DEFINER
-- functions below.
-- ---------------------------------------------------------------------------
REVOKE ALL ON accounts, profiles, principals, capability_grants, workspaces,
              workspace_memberships, legacy_user_account_links, sessions_v2
    FROM asalab_app;

ALTER TABLE accounts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE principals                ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_grants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces                ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memberships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_user_account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions_v2               ENABLE ROW LEVEL SECURITY;

/**
 * Register an adult account, its Personal Workspace and its first session, in
 * one statement.
 *
 * Either all of it exists — account, profile, principal, creator capability,
 * tenant, workspace, membership, session and audit event — or none of it does.
 * A registration that produced an account without a session would leave a
 * person who can sign up and never sign in.
 */
CREATE OR REPLACE FUNCTION auth_register_account(
    p_email          varchar,
    p_password_hash  text,
    p_display_name   varchar,
    p_username       varchar,
    p_birth_date     date,
    p_country        varchar,
    p_policy_version varchar,
    p_token_hash     text,
    p_ttl_hours      integer
)
RETURNS TABLE (account_id uuid, principal_id uuid, workspace_id uuid, tenant_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_account   uuid;
    v_principal uuid;
    v_tenant    uuid;
    v_workspace uuid;
    v_slug      varchar(64);
    v_title     varchar(255);
BEGIN
    v_title := COALESCE(NULLIF(p_display_name, ''), p_username);

    INSERT INTO public.accounts (email, password_hash, birth_date, country)
    VALUES (lower(p_email), p_password_hash, p_birth_date, upper(p_country))
    RETURNING id INTO v_account;

    INSERT INTO public.profiles (account_id, username, display_name)
    VALUES (v_account, p_username, v_title);

    INSERT INTO public.principals (kind, account_id)
    VALUES ('account', v_account)
    RETURNING id INTO v_principal;

    INSERT INTO public.capability_grants (account_id, capability, state, policy_version, granted_by)
    VALUES (v_account, 'creator', 'verified', p_policy_version, 'server');

    v_slug := 'personal-' || pg_catalog.replace(v_account::text, '-', '');
    INSERT INTO public.tenants (workspace_slug, title) VALUES (v_slug, v_title)
    RETURNING id INTO v_tenant;
    INSERT INTO public.tenant_placements (tenant_id, mode) VALUES (v_tenant, 'SHARED_CLUSTER');

    INSERT INTO public.workspaces (tenant_id, kind, title)
    VALUES (v_tenant, 'personal', v_title)
    RETURNING id INTO v_workspace;

    INSERT INTO public.workspace_memberships (account_id, workspace_id, role)
    VALUES (v_account, v_workspace, 'owner');

    INSERT INTO public.sessions_v2 (principal_id, active_workspace_id, token_hash, expires_at)
    VALUES (v_principal, v_workspace, p_token_hash, now() + make_interval(hours => p_ttl_hours));

    -- actor_user_id stays NULL: the actor is an account principal, and the
    -- composite foreign key is not enforced when the column is NULL.
    INSERT INTO public.audit_events (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES (v_tenant, NULL, 'account', v_account, 'account.registered',
            pg_catalog.jsonb_build_object('workspaceKind', 'personal', 'policyVersion', p_policy_version));

    RETURN QUERY SELECT v_account, v_principal, v_workspace, v_tenant;
END;
$$;

/** Look up an account by email for password verification. */
CREATE OR REPLACE FUNCTION auth_find_account(p_email_lower varchar)
RETURNS TABLE (id uuid, email varchar, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.id, a.email, a.password_hash
      FROM public.accounts a
     WHERE lower(a.email) = p_email_lower AND a.status = 'active'
     LIMIT 1;
$$;

/** The same by username: a person should not have to remember which one. */
CREATE OR REPLACE FUNCTION auth_find_account_by_username(p_username_lower varchar)
RETURNS TABLE (id uuid, email varchar, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.id, a.email, a.password_hash
      FROM public.accounts a
      JOIN public.profiles p ON p.account_id = a.id
     WHERE lower(p.username) = p_username_lower AND a.status = 'active'
     LIMIT 1;
$$;

/** Username availability for the registration form. */
CREATE OR REPLACE FUNCTION auth_username_available(p_username varchar)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT NOT EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(p_username));
$$;

/** The workspace an account signs into by default: its own. */
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

/** Capability grants of an account, for the session answer. */
CREATE OR REPLACE FUNCTION auth_account_capabilities(p_account_id uuid)
RETURNS TABLE (capability varchar, state varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT g.capability, g.state
      FROM public.capability_grants g
     WHERE g.account_id = p_account_id
     ORDER BY g.capability;
$$;

/** Workspaces the account may act in. */
CREATE OR REPLACE FUNCTION auth_account_workspaces(p_account_id uuid)
RETURNS TABLE (workspace_id uuid, tenant_id uuid, kind varchar, title varchar, role varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT w.id, w.tenant_id, w.kind, w.title, m.role
      FROM public.workspace_memberships m
      JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE m.account_id = p_account_id
     ORDER BY (w.kind = 'personal') DESC, w.title;
$$;

/**
 * The account behind a legacy tenant-scoped session, through the bridge.
 *
 * The organization workspace of that tenant comes with it, so a legacy session
 * describes the same ActiveContext shape as a principal-bound one.
 */
CREATE OR REPLACE FUNCTION auth_account_for_user(p_tenant_id uuid, p_user_id uuid)
RETURNS TABLE (account_id uuid, principal_id uuid, workspace_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT l.account_id, l.principal_id, w.id
      FROM public.legacy_user_account_links l
      JOIN public.workspaces w ON w.tenant_id = l.tenant_id
     WHERE l.tenant_id = p_tenant_id AND l.user_id = p_user_id AND l.migration_state = 'active'
     LIMIT 1;
$$;

/** Open a principal-bound session in a workspace the account is a member of. */
CREATE OR REPLACE FUNCTION session_v2_create(
    p_principal_id uuid,
    p_workspace_id uuid,
    p_token_hash   text,
    p_ttl_hours    integer
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
        RAISE EXCEPTION 'principal % is not a member of workspace %', p_principal_id, p_workspace_id;
    END IF;

    INSERT INTO public.sessions_v2 (principal_id, active_workspace_id, token_hash, expires_at)
    VALUES (p_principal_id, p_workspace_id, p_token_hash, now() + make_interval(hours => p_ttl_hours))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

/**
 * The ActiveContext of a request: who is acting, where, and as whom.
 *
 * `user_id` is the legacy execution identity for that workspace when one
 * exists; in a Personal Workspace it is NULL, and the work is owned by the
 * principal instead.
 */
CREATE OR REPLACE FUNCTION session_v2_context(p_token_hash text)
RETURNS TABLE (
    principal_id   uuid,
    account_id     uuid,
    workspace_id   uuid,
    tenant_id      uuid,
    workspace_kind varchar,
    user_id        uuid,
    email          varchar,
    display_name   varchar,
    school_id      uuid
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
    RETURNING s.principal_id, s.active_workspace_id INTO v_principal, v_workspace;

    IF v_principal IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT pr.id,
           pr.account_id,
           w.id,
           w.tenant_id,
           w.kind,
           l.user_id,
           a.email,
           p.display_name,
           u.school_id
      FROM public.principals pr
      JOIN public.accounts a ON a.id = pr.account_id
      JOIN public.profiles p ON p.account_id = a.id
      JOIN public.workspaces w ON w.id = v_workspace
      LEFT JOIN public.legacy_user_account_links l
             ON l.account_id = a.id AND l.tenant_id = w.tenant_id AND l.migration_state = 'active'
      LEFT JOIN public.users u ON u.tenant_id = w.tenant_id AND u.id = l.user_id
     WHERE pr.id = v_principal;
END;
$$;

/** Sign out: the token stops working immediately. */
CREATE OR REPLACE FUNCTION session_v2_revoke(p_token_hash text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    UPDATE public.sessions_v2 SET revoked_at = now()
     WHERE token_hash = p_token_hash AND revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION auth_register_account(varchar, text, varchar, varchar, date, varchar, varchar, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_find_account(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_find_account_by_username(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_username_available(varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_personal_workspace(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_account_capabilities(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_account_workspaces(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_account_for_user(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION session_v2_create(uuid, uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION session_v2_context(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION session_v2_revoke(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_register_account(varchar, text, varchar, varchar, date, varchar, varchar, text, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_find_account(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_find_account_by_username(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_username_available(varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_personal_workspace(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_account_capabilities(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_account_workspaces(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_account_for_user(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION session_v2_create(uuid, uuid, text, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION session_v2_context(text) TO asalab_app;
GRANT EXECUTE ON FUNCTION session_v2_revoke(text) TO asalab_app;
