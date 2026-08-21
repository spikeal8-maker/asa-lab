-- Administrative Control Plane foundation (Stage A).
--
-- This is deliberately additive. The tenant-scoped legacy audit_events table
-- remains the source for existing classroom actions; administrative events use
-- principal identity and an explicit platform/organization scope.

CREATE TABLE IF NOT EXISTS administrative_audit_events (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at         timestamptz NOT NULL DEFAULT now(),
    actor_principal_id  uuid NOT NULL REFERENCES principals(id),
    actor_account_id    uuid NOT NULL REFERENCES accounts(id),
    actor_role          varchar(64) NOT NULL,
    scope_kind          varchar(32) NOT NULL
                        CHECK (scope_kind IN ('platform', 'organization')),
    scope_id            uuid REFERENCES workspaces(id),
    action              varchar(128) NOT NULL,
    target_type         varchar(64),
    target_id           varchar(255),
    reason_code         varchar(64),
    reason_text         varchar(500),
    ticket_id           varchar(64),
    request_id          varchar(128) NOT NULL,
    idempotency_key     varchar(128),
    result              varchar(32) NOT NULL
                        CHECK (result IN ('allowed', 'denied', 'succeeded', 'failed')),
    before_version      bigint,
    after_version       bigint,
    metadata_json       jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(metadata_json) = 'object'),
    CHECK (
        (scope_kind = 'platform' AND scope_id IS NULL)
        OR (scope_kind = 'organization' AND scope_id IS NOT NULL)
    ),
    CHECK (length(trim(action)) BETWEEN 3 AND 128),
    CHECK (length(trim(request_id)) BETWEEN 1 AND 128)
);

CREATE INDEX IF NOT EXISTS administrative_audit_scope_time_idx
    ON administrative_audit_events (scope_kind, scope_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS administrative_audit_actor_time_idx
    ON administrative_audit_events (actor_principal_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS administrative_audit_idempotency_idx
    ON administrative_audit_events (actor_principal_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION administrative_audit_events_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'administrative audit events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS administrative_audit_no_update ON administrative_audit_events;
CREATE TRIGGER administrative_audit_no_update
    BEFORE UPDATE OR DELETE ON administrative_audit_events
    FOR EACH ROW EXECUTE FUNCTION administrative_audit_events_immutable();

ALTER TABLE administrative_audit_events ENABLE ROW LEVEL SECURITY;
-- No table policy is installed. Runtime callers have no table privileges and
-- must use the audited SECURITY DEFINER functions below. FORCE RLS is omitted
-- deliberately: otherwise a non-superuser migration owner could not execute
-- those functions against its own table.
REVOKE ALL ON administrative_audit_events FROM PUBLIC;
REVOKE ALL ON administrative_audit_events FROM asalab_app;
REVOKE ALL ON FUNCTION administrative_audit_events_immutable() FROM PUBLIC;

-- This function is the database-side lower bound for administrative scope.
-- The TypeScript policy engine may narrow a role further for a specific
-- permission, but neither layer may widen the scope established here.
CREATE OR REPLACE FUNCTION admin_authorized_role(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid
) RETURNS varchar
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_account_id uuid;
    v_role varchar;
BEGIN
    IF p_scope_kind NOT IN ('platform', 'organization') THEN
        RETURN NULL;
    END IF;
    IF (p_scope_kind = 'platform' AND p_scope_id IS NOT NULL)
       OR (p_scope_kind = 'organization' AND p_scope_id IS NULL) THEN
        RETURN NULL;
    END IF;

    SELECT p.account_id
      INTO v_account_id
      FROM public.principals p
      JOIN public.accounts a ON a.id = p.account_id AND a.status = 'active'
     WHERE p.id = p_actor_principal_id;
    IF v_account_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT 'platform_admin'::varchar
      INTO v_role
      FROM public.capability_grants g
     WHERE g.account_id = v_account_id
       AND g.capability = 'platform_admin'
       AND g.state = 'verified';
    IF v_role IS NOT NULL THEN
        RETURN v_role;
    END IF;

    IF p_scope_kind = 'platform' THEN
        RETURN NULL;
    END IF;

    SELECT m.role
      INTO v_role
      FROM public.workspace_memberships m
      JOIN public.workspaces w
        ON w.id = m.workspace_id
       AND w.kind = 'organization'
       AND w.status = 'active'
     WHERE m.account_id = v_account_id
       AND m.workspace_id = p_scope_id
       AND m.state = 'active'
       AND m.role IN ('owner', 'school_admin', 'moderator', 'billing_admin');
    RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION admin_append_audit_event(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_action varchar,
    p_target_type varchar,
    p_target_id varchar,
    p_reason_code varchar,
    p_reason_text varchar,
    p_ticket_id varchar,
    p_request_id varchar,
    p_idempotency_key varchar,
    p_result varchar,
    p_before_version bigint DEFAULT NULL,
    p_after_version bigint DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_account_id uuid;
    v_role varchar;
    v_event_id uuid;
BEGIN
    v_role := public.admin_authorized_role(
        p_actor_principal_id,
        p_scope_kind,
        p_scope_id
    );
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'administrative scope denied' USING ERRCODE = '42501';
    END IF;
    IF p_result NOT IN ('allowed', 'denied', 'succeeded', 'failed') THEN
        RAISE EXCEPTION 'invalid administrative audit result' USING ERRCODE = '22023';
    END IF;
    IF length(trim(p_action)) NOT BETWEEN 3 AND 128
       OR length(trim(p_request_id)) NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'invalid administrative audit action or request id'
            USING ERRCODE = '22023';
    END IF;

    SELECT account_id INTO v_account_id
      FROM public.principals
     WHERE id = p_actor_principal_id;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_event_id
          FROM public.administrative_audit_events
         WHERE actor_principal_id = p_actor_principal_id
           AND idempotency_key = p_idempotency_key;
        IF v_event_id IS NOT NULL THEN
            RETURN v_event_id;
        END IF;
    END IF;

    BEGIN
        INSERT INTO public.administrative_audit_events (
            actor_principal_id,
            actor_account_id,
            actor_role,
            scope_kind,
            scope_id,
            action,
            target_type,
            target_id,
            reason_code,
            reason_text,
            ticket_id,
            request_id,
            idempotency_key,
            result,
            before_version,
            after_version
        ) VALUES (
            p_actor_principal_id,
            v_account_id,
            v_role,
            p_scope_kind,
            p_scope_id,
            trim(p_action),
            NULLIF(trim(p_target_type), ''),
            NULLIF(trim(p_target_id), ''),
            NULLIF(trim(p_reason_code), ''),
            NULLIF(trim(p_reason_text), ''),
            NULLIF(trim(p_ticket_id), ''),
            trim(p_request_id),
            NULLIF(trim(p_idempotency_key), ''),
            p_result,
            p_before_version,
            p_after_version
        ) RETURNING id INTO v_event_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_event_id
          FROM public.administrative_audit_events
         WHERE actor_principal_id = p_actor_principal_id
           AND idempotency_key = NULLIF(trim(p_idempotency_key), '');
    END;
    RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_list_audit_events(
    p_actor_principal_id uuid,
    p_scope_kind varchar,
    p_scope_id uuid,
    p_limit integer DEFAULT 50,
    p_before timestamptz DEFAULT NULL,
    p_before_id uuid DEFAULT NULL
) RETURNS TABLE (
    id uuid,
    occurred_at timestamptz,
    actor_principal_id uuid,
    actor_role varchar,
    scope_kind varchar,
    scope_id uuid,
    action varchar,
    target_type varchar,
    target_id varchar,
    reason_code varchar,
    reason_text varchar,
    ticket_id varchar,
    request_id varchar,
    result varchar,
    before_version bigint,
    after_version bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.admin_authorized_role(p_actor_principal_id, p_scope_kind, p_scope_id) IS NULL THEN
        RAISE EXCEPTION 'administrative scope denied' USING ERRCODE = '42501';
    END IF;
    IF p_limit < 1 OR p_limit > 200 THEN
        RAISE EXCEPTION 'audit page limit must be between 1 and 200' USING ERRCODE = '22023';
    END IF;
    IF (p_before IS NULL) <> (p_before_id IS NULL) THEN
        RAISE EXCEPTION 'audit cursor requires both time and id' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT e.id,
           e.occurred_at,
           e.actor_principal_id,
           e.actor_role,
           e.scope_kind,
           e.scope_id,
           e.action,
           e.target_type,
           e.target_id,
           e.reason_code,
           e.reason_text,
           e.ticket_id,
           e.request_id,
           e.result,
           e.before_version,
           e.after_version
      FROM public.administrative_audit_events e
     WHERE (
           p_before IS NULL
           OR (e.occurred_at, e.id) < (p_before, p_before_id)
       )
       AND (
           p_scope_kind = 'platform'
           OR (e.scope_kind = 'organization' AND e.scope_id = p_scope_id)
       )
     ORDER BY e.occurred_at DESC, e.id DESC
     LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION admin_authorized_role(uuid, varchar, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_authorized_role(uuid, varchar, uuid) FROM asalab_app;
REVOKE ALL ON FUNCTION admin_append_audit_event(
    uuid, varchar, uuid, varchar, varchar, varchar, varchar, varchar, varchar,
    varchar, varchar, varchar, bigint, bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_audit_events(uuid, varchar, uuid, integer, timestamptz, uuid)
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION admin_append_audit_event(
    uuid, varchar, uuid, varchar, varchar, varchar, varchar, varchar, varchar,
    varchar, varchar, varchar, bigint, bigint
) TO asalab_app;
GRANT EXECUTE ON FUNCTION admin_list_audit_events(uuid, varchar, uuid, integer, timestamptz, uuid)
    TO asalab_app;
