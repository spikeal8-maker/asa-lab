-- R1 / C1.1 — global Account identity, Personal Workspace and the legacy bridge.
--
-- Strictly additive. The tenant-scoped `users` table, every foreign key that
-- points at it, and every existing tenant, class and project stay exactly as
-- they are: this migration only adds new tables and fills them in.
--
-- Two rules shape everything below.
--
--   * A Personal Workspace is not a school. Nothing here creates a `schools`
--     row, an `academic_periods` row or a `users(role='teacher')` row, and no
--     account is handed the educator capability for having registered.
--   * The legacy execution identity — the tenant-scoped user that still owns
--     classes and projects — lives in its own link table with real composite
--     integrity, not as a loose column on a membership.
--
-- Because a session still needs a tenant-scoped user, public registration
-- stays behind a feature flag until principal-aware sessions (sessions_v2)
-- exist. See docs/architecture/ASA_IDENTITY_WORKSPACE_TRANSITION_PLAN.md.

-- ---------------------------------------------------------------------------
-- Preflight: refuse to run against data this chain cannot honestly describe.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_orphans integer;
BEGIN
    IF to_regclass('public.principals') IS NULL THEN
        RETURN;
    END IF;
    -- A principal is an actor; an actor with no subject can own content that
    -- belongs to nobody. Such a row is never deleted here: it is a signal that
    -- something upstream is wrong, and it stops the migration instead.
    SELECT count(*) INTO v_orphans FROM public.principals WHERE account_id IS NULL;
    IF v_orphans > 0 THEN
        RAISE EXCEPTION
            'preflight failed: % principal row(s) have no subject. Resolve them deliberately (assign an account or archive the row) before applying 0005; this migration never deletes principals.',
            v_orphans;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Global identity
-- ---------------------------------------------------------------------------
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
    -- Compatibility field from the transition plan; `visibility` is the
    -- authoritative one and `privacy` is never read by the application.
    privacy      varchar(32)  NOT NULL DEFAULT 'private'
                 CHECK (privacy IN ('private', 'unlisted', 'public')),
    -- Normative profile visibility (asa-target-platform-2026-07). `unlisted`
    -- belongs to project visibility and never described a profile.
    visibility   varchar(32)  NOT NULL DEFAULT 'private'
                 CHECK (visibility IN ('private', 'restricted', 'public')),
    updated_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_ci_idx ON profiles (lower(username));
COMMENT ON COLUMN profiles.privacy IS
    'Deprecated compatibility field kept for the identity transition; use profiles.visibility.';
COMMENT ON COLUMN profiles.visibility IS
    'Normative profile visibility: private | restricted | public.';

-- Actor registry: one row per thing that can own or act on content.
--
-- Only account principals are valid today. A StudentSeat principal arrives in
-- the same migration as the `student_seats` table and its foreign key, so a
-- seat principal can never exist without a seat to point at.
CREATE TABLE IF NOT EXISTS principals (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind       varchar(32) NOT NULL CHECK (kind IN ('account', 'student_seat')),
    account_id uuid REFERENCES accounts(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT principals_account_subject_present
        CHECK (kind = 'account' AND account_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS principals_account_idx ON principals (account_id)
    WHERE account_id IS NOT NULL;

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
COMMENT ON COLUMN capability_grants.capability IS
    'Normative global capabilities: creator, educator, registered_student, guardian, platform_admin.';

-- ---------------------------------------------------------------------------
-- Workspaces
-- ---------------------------------------------------------------------------
-- A workspace is the product name for a data boundary; it maps onto exactly
-- one tenant, so existing row-level security keeps applying unchanged.
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
    -- Deprecated compatibility field from the transition plan. It is written
    -- during backfill so a dual-read stays possible, but nothing reads it: the
    -- resolver uses legacy_user_account_links, which has composite tenant
    -- integrity. Removing it needs its own owner-approved destructive
    -- migration, at least two release gates from now.
    user_id      uuid,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS workspace_memberships_account_idx ON workspace_memberships (account_id);
COMMENT ON COLUMN workspace_memberships.role IS
    'Scoped workspace role, normative set: owner, member, educator, school_admin, billing_admin, moderator. school_admin is scoped to one workspace and is never a global capability.';
COMMENT ON COLUMN workspace_memberships.user_id IS
    'Deprecated compatibility field; the authoritative bridge is legacy_user_account_links.';

-- ---------------------------------------------------------------------------
-- Legacy bridge
-- ---------------------------------------------------------------------------
/**
 * The bridge between a global account and the tenant-scoped `users` row that
 * still executes its work.
 *
 * It carries the integrity a membership column could not: (tenant_id, user_id)
 * is a real composite foreign key into `users`. A Personal Workspace has no row
 * here at all, which is the point — it does not depend on `users` existing.
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
    created_at      timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
    UNIQUE (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS legacy_user_account_links_account_idx
    ON legacy_user_account_links (account_id);

-- ---------------------------------------------------------------------------
-- Backfill. Idempotent: every step is guarded, so a repeat changes nothing.
-- Nothing is renamed, moved or deleted.
-- ---------------------------------------------------------------------------

-- 1. Every existing tenant becomes an organization workspace.
INSERT INTO workspaces (tenant_id, kind, title)
SELECT t.id, 'organization', t.title
  FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.tenant_id = t.id);

-- 2. Every existing teacher becomes an account, keeping their password hash.
INSERT INTO accounts (email, password_hash, birth_date, country, email_verification_state)
SELECT DISTINCT ON (lower(u.email)) u.email, u.password_hash, DATE '1990-01-01', 'RU', 'unverified'
  FROM users u
 WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE lower(a.email) = lower(u.email))
 ORDER BY lower(u.email), u.created_at;

-- 3. Usernames are pseudonyms: never derived from the email, because that
--    would leak the address and collide across domains.
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

-- 4. Everyone creates; that is the baseline capability of an account.
INSERT INTO capability_grants (account_id, capability, state, policy_version, granted_by)
SELECT a.id, 'creator', 'verified', 'asa-lab-2026-07', 'migration'
  FROM accounts a
 WHERE NOT EXISTS (
        SELECT 1 FROM capability_grants g WHERE g.account_id = a.id AND g.capability = 'creator');

-- 5. Existing teachers already run classes, so they keep educator. New
--    accounts never get it here: it is a separate audited grant.
INSERT INTO capability_grants (account_id, capability, state, policy_version, granted_by)
SELECT DISTINCT a.id, 'educator', 'verified', 'asa-lab-2026-07', 'migration'
  FROM accounts a
  JOIN users u ON lower(u.email) = lower(a.email)
 WHERE u.role = 'teacher'
   AND NOT EXISTS (
        SELECT 1 FROM capability_grants g WHERE g.account_id = a.id AND g.capability = 'educator');

-- 6. Membership in the organization workspace they already work in.
INSERT INTO workspace_memberships (account_id, workspace_id, role, user_id)
SELECT a.id, w.id, 'educator', u.id
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

/**
 * 8. Every account gets exactly one Personal Workspace.
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
        -- Only complete identities: an account has a profile and a principal
        -- before it has a place to work, so a half-built row never gains one.
        SELECT a.id,
               COALESCE(NULLIF(p.display_name, ''), p.username) AS title
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
            INSERT INTO tenants (workspace_slug, title)
            VALUES (v_slug, v_account.title)
            RETURNING id INTO v_tenant;
            INSERT INTO tenant_placements (tenant_id, mode) VALUES (v_tenant, 'SHARED_CLUSTER');
        END IF;

        INSERT INTO workspaces (tenant_id, kind, title)
        VALUES (v_tenant, 'personal', v_account.title)
        ON CONFLICT (tenant_id) DO NOTHING;

        INSERT INTO workspace_memberships (account_id, workspace_id, role)
        SELECT v_account.id, w.id, 'owner'
          FROM workspaces w
         WHERE w.tenant_id = v_tenant
        ON CONFLICT (account_id, workspace_id) DO NOTHING;

        INSERT INTO audit_events (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES (v_tenant, NULL, 'account', v_account.id, 'account.personal_workspace_backfilled',
                jsonb_build_object('workspaceKind', 'personal', 'source', 'migration'));
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Runtime role: identity tables stay unreachable directly, exactly like
-- tenants/users/sessions. Access goes through the narrow SECURITY DEFINER
-- functions below.
-- ---------------------------------------------------------------------------
REVOKE ALL ON accounts, profiles, workspaces, workspace_memberships, capability_grants,
              principals, legacy_user_account_links
    FROM asalab_app;

ALTER TABLE accounts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces                ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memberships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_grants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE principals                ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_user_account_links ENABLE ROW LEVEL SECURITY;

/**
 * Register an adult account with its Personal Workspace.
 *
 * Creates exactly the identity: account, profile, principal, the creator
 * capability, the tenant that backs the workspace and the workspace itself.
 *
 * It deliberately does NOT create a school, an academic period or a
 * tenant-scoped `users` row, and it grants no educator capability. Everything
 * happens in one function call, so the caller either gets a whole account or
 * none at all.
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

    INSERT INTO public.workspace_memberships (account_id, workspace_id, role)
    VALUES (v_account, v_workspace, 'owner');

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
 *
 * The link table is the authority; the deprecated membership column is not
 * read here.
 */
CREATE OR REPLACE FUNCTION auth_account_for_user(p_tenant_id uuid, p_user_id uuid)
RETURNS TABLE (account_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT l.account_id
      FROM public.legacy_user_account_links l
     WHERE l.tenant_id = p_tenant_id AND l.user_id = p_user_id AND l.migration_state = 'active'
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

/**
 * Workspaces the account may act in.
 *
 * `user_id` is the legacy execution identity for that workspace, read from the
 * link table; a Personal Workspace simply has none until principal-aware
 * sessions land.
 */
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
    SELECT w.id, w.tenant_id, w.kind, w.title, m.role, l.user_id
      FROM public.workspace_memberships m
      JOIN public.workspaces w ON w.id = m.workspace_id
      LEFT JOIN public.legacy_user_account_links l
             ON l.tenant_id = w.tenant_id
            AND l.account_id = m.account_id
            AND l.migration_state = 'active'
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
     WHERE p.account_id = p_account_id;
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
