ALTER TABLE accounts
    ADD COLUMN first_authenticated_at timestamptz,
    ADD COLUMN max_prompt_dismissed_until timestamptz;

UPDATE accounts a
   SET first_authenticated_at = first_session.created_at
  FROM (
      SELECT p.account_id, min(s.created_at) AS created_at
        FROM sessions_v2 s
        JOIN principals p ON p.id = s.principal_id
       GROUP BY p.account_id
  ) first_session
 WHERE first_session.account_id = a.id
   AND a.first_authenticated_at IS NULL;

ALTER TABLE account_external_identities
    ADD COLUMN verified_at timestamptz,
    ADD COLUMN revoked_at timestamptz,
    ADD COLUMN revoked_by_principal_id uuid REFERENCES principals(id),
    ADD COLUMN revoke_reason varchar(500);
UPDATE account_external_identities SET verified_at = linked_at WHERE verified_at IS NULL;
ALTER TABLE account_external_identities
    ALTER COLUMN verified_at SET DEFAULT now(),
    ALTER COLUMN verified_at SET NOT NULL;

CREATE TABLE account_external_identity_events (
    id          bigserial PRIMARY KEY,
    identity_id uuid NOT NULL REFERENCES account_external_identities(id) ON DELETE CASCADE,
    account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    provider    varchar(32) NOT NULL CHECK (provider = 'max'),
    event       varchar(32) NOT NULL CHECK (event IN ('linked', 'verified', 'used', 'revoked')),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor_principal_id uuid REFERENCES principals(id),
    reason      varchar(500)
);
CREATE INDEX account_external_identity_events_account_idx
    ON account_external_identity_events (account_id, occurred_at DESC);
REVOKE ALL ON account_external_identity_events FROM asalab_app;
ALTER TABLE account_external_identity_events ENABLE ROW LEVEL SECURITY;

INSERT INTO account_external_identity_events (identity_id, account_id, provider, event, occurred_at)
SELECT id, account_id, provider, 'linked', linked_at FROM account_external_identities;

CREATE FUNCTION record_first_account_authentication()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    UPDATE public.accounts a
       SET first_authenticated_at = COALESCE(a.first_authenticated_at, NEW.created_at)
      FROM public.principals p
     WHERE p.id = NEW.principal_id AND a.id = p.account_id;
    RETURN NEW;
END;
$$;
CREATE TRIGGER sessions_v2_record_first_auth
AFTER INSERT ON sessions_v2
FOR EACH ROW EXECUTE FUNCTION record_first_account_authentication();

CREATE FUNCTION auth_max_status(p_account_id uuid)
RETURNS TABLE (
    linked boolean,
    verified_at timestamptz,
    first_authenticated_at timestamptz,
    prompt_due boolean,
    prompt_dismissed_until timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT active_identity.id IS NOT NULL,
           active_identity.verified_at,
           a.first_authenticated_at,
           a.first_authenticated_at IS NOT NULL
             AND a.first_authenticated_at + interval '24 hours' <= now()
             AND active_identity.id IS NULL
             AND (a.max_prompt_dismissed_until IS NULL OR a.max_prompt_dismissed_until <= now()),
           a.max_prompt_dismissed_until
      FROM public.accounts a
      LEFT JOIN LATERAL (
          SELECT i.id, i.verified_at
            FROM public.account_external_identities i
           WHERE i.account_id = a.id
             AND i.provider = 'max'
             AND i.revoked_at IS NULL
           LIMIT 1
      ) active_identity ON true
     WHERE a.id = p_account_id AND a.status = 'active'
$$;

CREATE FUNCTION auth_max_dismiss_prompt(p_account_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_until timestamptz;
BEGIN
    UPDATE public.accounts
       SET max_prompt_dismissed_until = now() + interval '7 days'
     WHERE id = p_account_id AND status = 'active'
     RETURNING max_prompt_dismissed_until INTO v_until;
    RETURN v_until;
END;
$$;

-- A revoked identity must never authenticate even though its immutable history
-- remains available to administrators.
CREATE OR REPLACE FUNCTION auth_max_identity_account(p_subject varchar)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT i.account_id
      FROM public.account_external_identities i
     WHERE i.provider = 'max' AND i.subject = p_subject AND i.revoked_at IS NULL
     LIMIT 1
$$;

REVOKE ALL ON FUNCTION auth_max_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_max_dismiss_prompt(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_max_identity_account(varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_max_status(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_max_dismiss_prompt(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION auth_max_identity_account(varchar) TO asalab_app;
