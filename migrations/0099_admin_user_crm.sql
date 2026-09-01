-- Real user CRM projection for the integrated administrative directory.
--
-- Notes and IP labels are server-owned administrative data. The runtime role
-- has no table access; scoped SECURITY DEFINER functions are the only boundary.

CREATE TABLE admin_account_notes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          uuid NOT NULL REFERENCES accounts(id),
    author_principal_id uuid NOT NULL REFERENCES principals(id),
    scope_kind          varchar(32) NOT NULL CHECK (scope_kind IN ('platform', 'organization')),
    scope_id            uuid REFERENCES workspaces(id),
    note                varchar(2000) NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 2000),
    created_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (scope_kind = 'platform' AND scope_id IS NULL)
        OR (scope_kind = 'organization' AND scope_id IS NOT NULL)
    )
);

CREATE INDEX admin_account_notes_account_time_idx
    ON admin_account_notes (account_id, scope_kind, scope_id, created_at DESC, id DESC);

CREATE TABLE admin_ip_labels (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_kind           varchar(32) NOT NULL CHECK (scope_kind IN ('platform', 'organization')),
    scope_id             uuid REFERENCES workspaces(id),
    ip_address           inet NOT NULL,
    label_kind           varchar(24) NOT NULL
                         CHECK (label_kind IN ('school', 'home', 'mobile', 'organization', 'other')),
    label                varchar(120),
    updated_by_principal uuid NOT NULL REFERENCES principals(id),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (scope_kind = 'platform' AND scope_id IS NULL)
        OR (scope_kind = 'organization' AND scope_id IS NOT NULL)
    ),
    CHECK (label IS NULL OR length(trim(label)) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX admin_ip_labels_scope_address_idx
    ON admin_ip_labels (
        scope_kind,
        COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
        ip_address
    );

ALTER TABLE admin_account_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_ip_labels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_account_notes FROM PUBLIC;
REVOKE ALL ON admin_account_notes FROM asalab_app;
REVOKE ALL ON admin_ip_labels FROM PUBLIC;
REVOKE ALL ON admin_ip_labels FROM asalab_app;

CREATE FUNCTION admin_account_notes_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'administrative account notes are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_account_notes_no_update
    BEFORE UPDATE OR DELETE ON admin_account_notes
    FOR EACH ROW EXECUTE FUNCTION admin_account_notes_immutable();

REVOKE ALL ON FUNCTION admin_account_notes_immutable() FROM PUBLIC;

DROP FUNCTION admin_list_accounts(
    uuid, varchar, uuid, varchar, integer, timestamptz, uuid
);

CREATE FUNCTION admin_list_accounts(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_search varchar,
    p_limit integer,
    p_before timestamptz,
    p_before_id uuid
) RETURNS TABLE (
    account_id uuid,
    principal_id uuid,
    email varchar,
    display_name varchar,
    username varchar,
    account_status varchar,
    email_verification_state varchar,
    created_at timestamptz,
    organization_role varchar,
    membership_state varchar,
    active_session_count bigint,
    last_seen_at timestamptz,
    has_ever_signed_in boolean,
    is_platform_admin boolean,
    last_ip_address text,
    last_device varchar,
    recent_activity_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_role varchar;
    v_search varchar;
BEGIN
    v_role := public.admin_authorized_role(p_actor_principal_id, p_scope_kind, p_scope_id);
    IF v_role IS NULL
       OR (p_scope_kind = 'platform' AND v_role <> 'platform_admin')
       OR (p_scope_kind = 'organization' AND v_role NOT IN ('owner', 'school_admin')) THEN
        RAISE EXCEPTION 'administrative accounts scope denied' USING ERRCODE = '42501';
    END IF;
    IF p_limit < 1 OR p_limit > 200 THEN
        RAISE EXCEPTION 'account page limit must be between 1 and 200' USING ERRCODE = '22023';
    END IF;
    IF (p_before IS NULL) <> (p_before_id IS NULL) THEN
        RAISE EXCEPTION 'account cursor requires both time and id' USING ERRCODE = '22023';
    END IF;
    v_search := lower(NULLIF(trim(p_search), ''));
    IF v_search IS NOT NULL AND length(v_search) > 100 THEN
        RAISE EXCEPTION 'account search is too long' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT account.id,
           principal.id,
           account.email,
           COALESCE(
               NULLIF(trim(profile.display_name), ''),
               NULLIF(trim(profile.username), ''),
               split_part(account.email, '@', 1),
               'Без имени'
           )::varchar,
           profile.username,
           account.status,
           account.email_verification_state,
           account.created_at,
           scoped_membership.role,
           scoped_membership.state,
           COALESCE(session_stats.active_count, 0),
           session_stats.last_seen_at,
           COALESCE(session_stats.has_ever_signed_in, false),
           (p_scope_kind = 'platform' AND EXISTS (
               SELECT 1 FROM public.capability_grants grant_row
                WHERE grant_row.account_id = account.id
                  AND grant_row.capability = 'platform_admin'
                  AND grant_row.state = 'verified'
           )),
           latest_activity.ip_address,
           latest_activity.device,
           COALESCE(latest_activity.recent_count, 0)
      FROM public.accounts account
      JOIN public.profiles profile ON profile.account_id = account.id
      JOIN public.principals principal ON principal.account_id = account.id
      LEFT JOIN LATERAL (
          SELECT membership.role, membership.state
            FROM public.workspace_memberships membership
           WHERE p_scope_kind = 'organization'
             AND membership.workspace_id = p_scope_id
             AND membership.account_id = account.id
           LIMIT 1
      ) scoped_membership ON true
      LEFT JOIN LATERAL (
          SELECT count(*) FILTER (
                     WHERE session.revoked_at IS NULL AND session.expires_at > now()
                 )::bigint AS active_count,
                 max(session.last_seen_at) AS last_seen_at,
                 (count(*) > 0) AS has_ever_signed_in
            FROM public.sessions_v2 session
           WHERE session.principal_id = principal.id
             AND (p_scope_kind = 'platform' OR session.active_workspace_id = p_scope_id)
      ) session_stats ON true
      LEFT JOIN LATERAL (
          SELECT (
                     SELECT host(recent.ip_address)
                       FROM public.product_analytics_events recent
                      WHERE recent.account_id = account.id
                        AND recent.ip_address IS NOT NULL
                        AND (p_scope_kind = 'platform' OR recent.workspace_id = p_scope_id)
                      ORDER BY recent.occurred_at DESC, recent.id DESC
                      LIMIT 1
                 ) AS ip_address,
                 (
                     SELECT recent.user_agent_summary
                       FROM public.product_analytics_events recent
                      WHERE recent.account_id = account.id
                        AND recent.user_agent_summary IS NOT NULL
                        AND (p_scope_kind = 'platform' OR recent.workspace_id = p_scope_id)
                      ORDER BY recent.occurred_at DESC, recent.id DESC
                      LIMIT 1
                 )::varchar AS device,
                 count(*) FILTER (WHERE event.occurred_at >= now() - interval '30 days')::bigint
                     AS recent_count
            FROM public.product_analytics_events event
           WHERE event.account_id = account.id
             AND (p_scope_kind = 'platform' OR event.workspace_id = p_scope_id)
      ) latest_activity ON true
     WHERE (p_scope_kind = 'platform' OR scoped_membership.role IS NOT NULL)
       AND (
           v_search IS NULL
           OR position(v_search IN lower(account.email)) > 0
           OR position(v_search IN lower(profile.display_name)) > 0
           OR position(v_search IN lower(profile.username)) > 0
       )
       AND (
           p_before IS NULL
           OR (account.created_at, account.id) < (p_before, p_before_id)
       )
     ORDER BY account.created_at DESC, account.id DESC
     LIMIT p_limit;
END;
$$;

CREATE FUNCTION admin_get_account_crm(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_target_account_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_role varchar;
    v_payload jsonb;
BEGIN
    v_role := public.admin_authorized_role(p_actor_principal_id, p_scope_kind, p_scope_id);
    IF v_role IS NULL
       OR (p_scope_kind = 'platform' AND v_role <> 'platform_admin')
       OR (p_scope_kind = 'organization' AND v_role NOT IN ('owner', 'school_admin')) THEN
        RAISE EXCEPTION 'administrative account CRM scope denied' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.accounts account
         WHERE account.id = p_target_account_id
           AND (p_scope_kind = 'platform' OR EXISTS (
               SELECT 1 FROM public.workspace_memberships membership
                WHERE membership.account_id = account.id
                  AND membership.workspace_id = p_scope_id
                  AND membership.state = 'active'))
    ) THEN
        RAISE EXCEPTION 'administrative account CRM target denied' USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_build_object(
        'accountId', account.id,
        'email', account.email,
        'displayName', COALESCE(
            NULLIF(trim(profile.display_name), ''),
            NULLIF(trim(profile.username), ''),
            split_part(account.email, '@', 1),
            'Без имени'
        ),
        'username', profile.username,
        'status', account.status,
        'emailVerificationState', account.email_verification_state,
        'createdAt', account.created_at,
        'firstAuthenticatedAt', account.first_authenticated_at,
        'organizations', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'workspaceId', workspace.id,
                'title', workspace.title,
                'role', membership.role,
                'state', membership.state
            ) ORDER BY workspace.title, workspace.id)
              FROM public.workspace_memberships membership
              JOIN public.workspaces workspace ON workspace.id = membership.workspace_id
             WHERE membership.account_id = account.id
               AND (p_scope_kind = 'platform' OR workspace.id = p_scope_id)
        ), '[]'::jsonb),
        'sessions', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'sessionId', recent.id,
                'workspaceId', recent.active_workspace_id,
                'workspaceTitle', recent.workspace_title,
                'createdAt', recent.created_at,
                'lastSeenAt', recent.last_seen_at,
                'expiresAt', recent.expires_at,
                'revokedAt', recent.revoked_at,
                'status', CASE
                    WHEN recent.revoked_at IS NOT NULL THEN 'revoked'
                    WHEN recent.expires_at <= now() THEN 'expired'
                    ELSE 'active'
                END,
                'device', NULLIF(recent.client_metadata ->> 'userAgentSummary', '')
            ) ORDER BY recent.last_seen_at DESC, recent.id DESC)
              FROM (
                  SELECT session.*, workspace.title AS workspace_title
                    FROM public.sessions_v2 session
                    JOIN public.principals principal ON principal.id = session.principal_id
                    JOIN public.workspaces workspace ON workspace.id = session.active_workspace_id
                   WHERE principal.account_id = account.id
                     AND (p_scope_kind = 'platform' OR session.active_workspace_id = p_scope_id)
                   ORDER BY session.last_seen_at DESC, session.id DESC
                   LIMIT 20
              ) recent
        ), '[]'::jsonb),
        'activity', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', recent.id,
                'occurredAt', recent.occurred_at,
                'eventType', recent.event_type,
                'outcome', recent.outcome,
                'authMethod', recent.auth_method,
                'moduleKey', recent.module_key,
                'ipAddress', CASE WHEN recent.ip_address IS NULL THEN NULL ELSE host(recent.ip_address) END,
                'device', recent.user_agent_summary
            ) ORDER BY recent.occurred_at DESC, recent.id DESC)
              FROM (
                  SELECT event.*
                    FROM public.product_analytics_events event
                   WHERE event.account_id = account.id
                     AND (p_scope_kind = 'platform' OR event.workspace_id = p_scope_id)
                   ORDER BY event.occurred_at DESC, event.id DESC
                   LIMIT 100
              ) recent
        ), '[]'::jsonb),
        'ipAddresses', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'address', activity.address,
                'firstSeenAt', activity.first_seen_at,
                'lastSeenAt', activity.last_seen_at,
                'eventCount', activity.event_count,
                'device', activity.device,
                'labelKind', label.label_kind,
                'label', label.label
            ) ORDER BY activity.last_seen_at DESC, activity.address)
              FROM (
                  SELECT host(event.ip_address) AS address,
                         min(event.occurred_at) AS first_seen_at,
                         max(event.occurred_at) AS last_seen_at,
                         count(*)::bigint AS event_count,
                         (array_agg(event.user_agent_summary ORDER BY event.occurred_at DESC)
                             FILTER (WHERE event.user_agent_summary IS NOT NULL))[1] AS device
                    FROM public.product_analytics_events event
                   WHERE event.account_id = account.id
                     AND event.ip_address IS NOT NULL
                     AND (p_scope_kind = 'platform' OR event.workspace_id = p_scope_id)
                   GROUP BY host(event.ip_address)
                   ORDER BY max(event.occurred_at) DESC
                   LIMIT 30
              ) activity
              LEFT JOIN public.admin_ip_labels label
                ON label.scope_kind = p_scope_kind
               AND label.scope_id IS NOT DISTINCT FROM p_scope_id
               AND host(label.ip_address) = activity.address
        ), '[]'::jsonb),
        'notes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', recent.id,
                'note', recent.note,
                'createdAt', recent.created_at,
                'authorDisplayName', recent.author_display_name
            ) ORDER BY recent.created_at DESC, recent.id DESC)
              FROM (
                  SELECT note.id, note.note, note.created_at,
                         COALESCE(NULLIF(trim(author.display_name), ''), author.username, 'Администратор')
                             AS author_display_name
                    FROM public.admin_account_notes note
                    JOIN public.principals principal ON principal.id = note.author_principal_id
                    JOIN public.profiles author ON author.account_id = principal.account_id
                   WHERE note.account_id = account.id
                     AND note.scope_kind = p_scope_kind
                     AND note.scope_id IS NOT DISTINCT FROM p_scope_id
                   ORDER BY note.created_at DESC, note.id DESC
                   LIMIT 50
              ) recent
        ), '[]'::jsonb),
        'max', jsonb_build_object(
            'linked', EXISTS (
                SELECT 1 FROM public.account_external_identities identity
                 WHERE identity.account_id = account.id
                   AND identity.provider = 'max'
                   AND identity.revoked_at IS NULL
            ),
            'verifiedAt', (
                SELECT identity.verified_at
                  FROM public.account_external_identities identity
                 WHERE identity.account_id = account.id
                   AND identity.provider = 'max'
                   AND identity.revoked_at IS NULL
                 ORDER BY identity.verified_at DESC NULLS LAST, identity.id DESC
                 LIMIT 1
            )
        )
    ) INTO v_payload
      FROM public.accounts account
      JOIN public.profiles profile ON profile.account_id = account.id
     WHERE account.id = p_target_account_id;

    RETURN v_payload;
END;
$$;

CREATE FUNCTION admin_add_account_note(
    p_actor_principal_id uuid,
    p_target_account_id uuid,
    p_note varchar,
    p_request_id varchar
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative account note denied' USING ERRCODE = '42501';
    END IF;
    IF length(trim(p_note)) NOT BETWEEN 1 AND 2000
       OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128
       OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_target_account_id) THEN
        RAISE EXCEPTION 'invalid administrative account note' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.admin_account_notes
        (account_id, author_principal_id, scope_kind, scope_id, note)
    VALUES
        (p_target_account_id, p_actor_principal_id, 'platform', NULL, trim(p_note))
    RETURNING id INTO v_id;

    PERFORM public.admin_append_audit_event(
        p_actor_principal_id, 'platform', NULL,
        'administration.account.note.add',
        'account', p_target_account_id::text,
        'admin_console', left(trim(p_note), 500), NULL,
        p_request_id, p_request_id, 'succeeded', NULL, NULL
    );
    RETURN v_id;
END;
$$;

CREATE FUNCTION admin_set_account_ip_label(
    p_actor_principal_id uuid,
    p_target_account_id uuid,
    p_ip_address inet,
    p_label_kind varchar,
    p_label varchar,
    p_request_id varchar
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, 'platform', NULL)
       IS DISTINCT FROM 'platform_admin' THEN
        RAISE EXCEPTION 'administrative IP label denied' USING ERRCODE = '42501';
    END IF;
    IF p_label_kind NOT IN ('school', 'home', 'mobile', 'organization', 'other')
       OR (p_label IS NOT NULL AND length(trim(p_label)) NOT BETWEEN 1 AND 120)
       OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128
       OR NOT EXISTS (
           SELECT 1 FROM public.product_analytics_events event
            WHERE event.account_id = p_target_account_id
              AND event.ip_address = p_ip_address
       ) THEN
        RAISE EXCEPTION 'invalid administrative IP label' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.admin_ip_labels
        (scope_kind, scope_id, ip_address, label_kind, label, updated_by_principal)
    VALUES
        ('platform', NULL, p_ip_address, p_label_kind, NULLIF(trim(p_label), ''), p_actor_principal_id)
    ON CONFLICT (
        scope_kind,
        (COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)),
        ip_address
    ) DO UPDATE SET
        label_kind = EXCLUDED.label_kind,
        label = EXCLUDED.label,
        updated_by_principal = EXCLUDED.updated_by_principal,
        updated_at = now()
    RETURNING id INTO v_id;

    PERFORM public.admin_append_audit_event(
        p_actor_principal_id, 'platform', NULL,
        'administration.ip.label.set',
        'account', p_target_account_id::text,
        'admin_console', p_label_kind || CASE WHEN p_label IS NULL THEN '' ELSE ': ' || trim(p_label) END,
        NULL, p_request_id, p_request_id, 'succeeded', NULL, NULL
    );
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION admin_get_account_crm(uuid, varchar, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_accounts(uuid, varchar, uuid, varchar, integer, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_add_account_note(uuid, uuid, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_account_ip_label(uuid, uuid, inet, varchar, varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_account_crm(uuid, varchar, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_list_accounts(uuid, varchar, uuid, varchar, integer, timestamptz, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_add_account_note(uuid, uuid, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_set_account_ip_label(uuid, uuid, inet, varchar, varchar, varchar) TO asalab_app;
