-- Safe Checkers class play. Games are restricted to enrolled classmates;
-- communication is a server-owned allowlist with mute, throttling, reporting
-- and append-only audit evidence. No user-authored message field exists.

CREATE TABLE IF NOT EXISTS checkers_class_games (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    project_id      uuid NOT NULL,
    classroom_id    uuid NOT NULL,
    created_by_user_id uuid NOT NULL,
    light_user_id   uuid NOT NULL,
    dark_user_id    uuid NOT NULL,
    mode            varchar(32) NOT NULL DEFAULT 'friendly'
                    CHECK (mode IN ('friendly', 'team', 'teacher-event')),
    status          varchar(16) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'declined', 'finished')),
    document_json   jsonb NOT NULL,
    version         integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users (tenant_id, id),
    FOREIGN KEY (tenant_id, light_user_id) REFERENCES users (tenant_id, id),
    FOREIGN KEY (tenant_id, dark_user_id) REFERENCES users (tenant_id, id),
    CHECK (light_user_id <> dark_user_id),
    CHECK (jsonb_typeof(document_json) = 'object')
);
CREATE INDEX IF NOT EXISTS checkers_class_games_participants_idx
    ON checkers_class_games (tenant_id, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS checkers_reaction_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    project_id      uuid NOT NULL,
    classroom_id    uuid NOT NULL,
    game_id         uuid NOT NULL,
    sender_user_id  uuid NOT NULL,
    reaction_id     varchar(32) NOT NULL
                    CHECK (reaction_id IN ('good-luck', 'good-move', 'thanks-for-game',
                                           'applause', 'thinking', 'friendly-smile')),
    game_state      varchar(16) NOT NULL CHECK (game_state IN ('active', 'finished')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms (tenant_id, id),
    FOREIGN KEY (tenant_id, game_id) REFERENCES checkers_class_games (tenant_id, id),
    FOREIGN KEY (tenant_id, sender_user_id) REFERENCES users (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS checkers_reaction_events_game_idx
    ON checkers_reaction_events (tenant_id, game_id, created_at DESC);

CREATE TABLE IF NOT EXISTS checkers_reaction_mutes (
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    project_id      uuid NOT NULL,
    user_id         uuid NOT NULL,
    muted           boolean NOT NULL DEFAULT true,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, project_id, user_id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS checkers_safety_signals (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        uuid NOT NULL REFERENCES tenants(id),
    project_id       uuid NOT NULL,
    classroom_id     uuid NOT NULL,
    game_id          uuid NOT NULL,
    reaction_event_id uuid NOT NULL,
    reporter_user_id uuid NOT NULL,
    status           varchar(16) NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'reviewed')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, reaction_event_id, reporter_user_id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms (tenant_id, id),
    FOREIGN KEY (tenant_id, game_id) REFERENCES checkers_class_games (tenant_id, id),
    FOREIGN KEY (tenant_id, reaction_event_id) REFERENCES checkers_reaction_events (tenant_id, id),
    FOREIGN KEY (tenant_id, reporter_user_id) REFERENCES users (tenant_id, id)
);

GRANT SELECT, INSERT, UPDATE ON checkers_class_games TO asalab_app;
GRANT SELECT, INSERT ON checkers_reaction_events TO asalab_app;
GRANT SELECT, INSERT, UPDATE ON checkers_reaction_mutes TO asalab_app;
GRANT SELECT, INSERT, UPDATE ON checkers_safety_signals TO asalab_app;

ALTER TABLE checkers_class_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkers_class_games FORCE ROW LEVEL SECURITY;
ALTER TABLE checkers_reaction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkers_reaction_events FORCE ROW LEVEL SECURITY;
ALTER TABLE checkers_reaction_mutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkers_reaction_mutes FORCE ROW LEVEL SECURITY;
ALTER TABLE checkers_safety_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkers_safety_signals FORCE ROW LEVEL SECURITY;

CREATE POLICY checkers_class_games_tenant ON checkers_class_games
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY checkers_reaction_events_tenant ON checkers_reaction_events
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY checkers_reaction_mutes_tenant ON checkers_reaction_mutes
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY checkers_safety_signals_tenant ON checkers_safety_signals
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE OR REPLACE FUNCTION checkers_classroom_members(
    p_tenant_id uuid,
    p_actor_user_id uuid,
    p_project_id uuid
)
RETURNS TABLE (member_user_id uuid, member_account_id uuid, display_name varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT m.user_id, l.account_id, u.display_name
      FROM public.projects p
      JOIN public.classroom_memberships actor_membership
        ON actor_membership.tenant_id = p.tenant_id
       AND actor_membership.classroom_id = p.classroom_id
       AND actor_membership.user_id = p_actor_user_id
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

REVOKE ALL ON FUNCTION checkers_classroom_members(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION checkers_classroom_members(uuid, uuid, uuid) TO asalab_app;
