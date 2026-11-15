-- AI-TEXT-COMPLETE-005. Forward-only extension of the canonical owner contract
-- in 0226. Archive never deletes history or either paid-operation ledger.
ALTER TABLE ai_assistant_threads ADD COLUMN archived_at timestamptz;
ALTER TABLE ai_assistant_threads ADD COLUMN next_message_ordinal bigint NOT NULL DEFAULT 0;
ALTER TABLE ai_assistant_messages ADD COLUMN ordinal bigint;
ALTER TABLE ai_assistant_messages ADD COLUMN source_user_message_id uuid;

-- Preserve every historical identifier, timestamp and message. An ordinal is a
-- separate immutable admission order, so a later backdated message can never
-- enter the context of an earlier question.
WITH ordered AS (
    SELECT id, row_number() OVER (PARTITION BY thread_id ORDER BY created_at, id) AS ordinal
    FROM ai_assistant_messages
)
UPDATE ai_assistant_messages m SET ordinal = ordered.ordinal FROM ordered WHERE m.id = ordered.id;
UPDATE ai_assistant_threads t SET next_message_ordinal = counts.last_ordinal
FROM (SELECT thread_id, max(ordinal) AS last_ordinal FROM ai_assistant_messages GROUP BY thread_id) counts
WHERE t.id = counts.thread_id;
UPDATE ai_assistant_messages answer SET source_user_message_id = question.id
FROM ai_assistant_messages question
WHERE answer.role = 'assistant' AND question.role = 'user'
  AND question.thread_id = answer.thread_id AND question.owner_principal_id = answer.owner_principal_id
  AND question.request_id = answer.request_id;
ALTER TABLE ai_assistant_messages ALTER COLUMN ordinal SET NOT NULL;
ALTER TABLE ai_assistant_messages ADD CONSTRAINT ai_message_ordinal_positive CHECK (ordinal > 0);
ALTER TABLE ai_assistant_messages ADD UNIQUE (thread_id, ordinal);
ALTER TABLE ai_assistant_messages ADD UNIQUE (id, thread_id, owner_principal_id);
ALTER TABLE ai_assistant_messages ADD CONSTRAINT ai_message_source_owner_fk
    FOREIGN KEY (source_user_message_id, thread_id, owner_principal_id)
    REFERENCES ai_assistant_messages (id, thread_id, owner_principal_id);
ALTER TABLE ai_assistant_messages ADD CONSTRAINT ai_user_has_no_source
    CHECK (role = 'assistant' OR source_user_message_id IS NULL);
CREATE INDEX ai_message_source_idx ON ai_assistant_messages
    (source_user_message_id, ordinal DESC) WHERE role = 'assistant';
CREATE INDEX ai_threads_archive_owner_idx ON ai_assistant_threads
    (owner_principal_id, (archived_at IS NOT NULL), updated_at DESC, id DESC);

CREATE FUNCTION ai_text_source_digest(
    p_owner uuid, p_thread uuid, p_source uuid, p_ordinal bigint, p_prompt varchar
) RETURNS bytea
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
    SELECT sha256(convert_to(jsonb_build_array(p_owner, p_thread, p_source, p_ordinal, p_prompt)::text, 'UTF8'))
$$;
REVOKE ALL ON FUNCTION ai_text_source_digest(uuid, uuid, uuid, bigint, varchar) FROM PUBLIC, asalab_app;

-- There is one actual user question. A fresh variant has its own paid request
-- receipt and an immutable reference to that question, never a fabricated user
-- message. Deleting its thread may remove this projection, but not its quota.
CREATE TABLE ai_assistant_regenerations (
    owner_principal_id uuid NOT NULL REFERENCES principals(id),
    request_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    source_user_message_id uuid NOT NULL,
    source_ordinal bigint NOT NULL CHECK (source_ordinal > 0),
    source_prompt varchar(3000) NOT NULL CHECK (char_length(source_prompt) BETWEEN 1 AND 3000),
    source_digest bytea NOT NULL CHECK (octet_length(source_digest) = 32),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (owner_principal_id, request_id),
    FOREIGN KEY (thread_id, owner_principal_id)
        REFERENCES ai_assistant_threads (id, owner_principal_id) ON DELETE CASCADE,
    FOREIGN KEY (source_user_message_id, thread_id, owner_principal_id)
        REFERENCES ai_assistant_messages (id, thread_id, owner_principal_id),
    FOREIGN KEY (owner_principal_id, request_id)
        REFERENCES ai_assistant_request_quota (owner_principal_id, request_id)
);
ALTER TABLE ai_assistant_regenerations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_assistant_regenerations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ai_assistant_regenerations FROM PUBLIC, asalab_app;

CREATE FUNCTION ai_text_message_metadata() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.id, NEW.thread_id, NEW.owner_principal_id, NEW.account_id, NEW.request_id,
               NEW.role, NEW.content, NEW.state, NEW.created_at, NEW.ordinal, NEW.source_user_message_id)
           IS DISTINCT FROM
           ROW(OLD.id, OLD.thread_id, OLD.owner_principal_id, OLD.account_id, OLD.request_id,
               OLD.role, OLD.content, OLD.state, OLD.created_at, OLD.ordinal, OLD.source_user_message_id) THEN
            RAISE EXCEPTION 'AI_MESSAGE_IMMUTABLE' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    UPDATE public.ai_assistant_threads t SET next_message_ordinal = next_message_ordinal + 1
    WHERE t.id = NEW.thread_id AND t.owner_principal_id = NEW.owner_principal_id
    RETURNING next_message_ordinal INTO NEW.ordinal;
    -- Keep the existing composite message/thread foreign-key failure contract.
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_OWNER_INVALID' USING ERRCODE = '23503'; END IF;
    IF NEW.role = 'assistant' AND NEW.source_user_message_id IS NULL THEN
        SELECT q.id INTO NEW.source_user_message_id FROM public.ai_assistant_messages q
        WHERE q.thread_id = NEW.thread_id AND q.owner_principal_id = NEW.owner_principal_id
          AND q.request_id = NEW.request_id AND q.role = 'user';
    END IF;
    IF NEW.source_user_message_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.ai_assistant_messages q
        WHERE q.id = NEW.source_user_message_id AND q.thread_id = NEW.thread_id
          AND q.owner_principal_id = NEW.owner_principal_id AND q.role = 'user' AND q.ordinal < NEW.ordinal
    ) THEN RAISE EXCEPTION 'AI_SOURCE_INVALID' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ai_text_message_metadata BEFORE INSERT OR UPDATE ON ai_assistant_messages
    FOR EACH ROW EXECUTE FUNCTION ai_text_message_metadata();
REVOKE ALL ON FUNCTION ai_text_message_metadata() FROM PUBLIC, asalab_app;

CREATE FUNCTION ai_text_regeneration_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'AI_REGENERATION_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER ai_text_regeneration_immutable BEFORE UPDATE ON ai_assistant_regenerations
    FOR EACH ROW EXECUTE FUNCTION ai_text_regeneration_immutable();
REVOKE ALL ON FUNCTION ai_text_regeneration_immutable() FROM PUBLIC, asalab_app;

-- Enforce archive even for an older API worker using ai_chat_begin_paid.
-- A previously admitted operation can finish or abort; both clear its marker.
CREATE FUNCTION ai_text_archive_admission_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF OLD.archived_at IS NOT NULL AND NEW.active_request_id IS NOT NULL
       AND NEW.active_request_id IS DISTINCT FROM OLD.active_request_id THEN
        RAISE EXCEPTION 'AI_THREAD_ARCHIVED' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ai_text_archive_admission_guard BEFORE UPDATE ON ai_assistant_threads
    FOR EACH ROW EXECUTE FUNCTION ai_text_archive_admission_guard();
REVOKE ALL ON FUNCTION ai_text_archive_admission_guard() FROM PUBLIC, asalab_app;

CREATE FUNCTION ai_text_search_threads(
    p_owner uuid, p_query varchar, p_archived boolean,
    p_before_at timestamptz, p_before_id uuid, p_limit integer
) RETURNS TABLE (id uuid, title varchar, updated_at timestamptz, archived_at timestamptz, match_preview text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_query text := lower(trim(COALESCE(p_query, '')));
BEGIN
    IF char_length(v_query) > 200 OR p_archived IS NULL
       OR (p_before_at IS NULL) <> (p_before_id IS NULL) THEN
        RAISE EXCEPTION 'AI_SEARCH_INVALID' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
    SELECT t.id, t.title, t.updated_at, t.archived_at,
           CASE WHEN hit.position IS NOT NULL THEN
               substring(hit.content FROM greatest(1, hit.position - 45) FOR 180) ELSE NULL END
    FROM public.ai_assistant_threads t
    LEFT JOIN LATERAL (
        SELECT m.content, strpos(lower(m.content), v_query) AS position
        FROM public.ai_assistant_messages m
        WHERE v_query <> '' AND m.thread_id = t.id AND m.owner_principal_id = p_owner
          AND strpos(lower(m.content), v_query) > 0
        ORDER BY m.created_at DESC, m.id DESC LIMIT 1
    ) hit ON true
    WHERE t.owner_principal_id = p_owner AND public.ai_chat_owner_valid(p_owner)
      AND (t.archived_at IS NOT NULL) = p_archived
      AND (p_before_at IS NULL OR (t.updated_at, t.id) < (p_before_at, p_before_id))
      AND (v_query = '' OR strpos(lower(t.title), v_query) > 0 OR hit.position IS NOT NULL)
    ORDER BY t.updated_at DESC, t.id DESC LIMIT LEAST(GREATEST(p_limit, 1), 51);
END;
$$;

CREATE FUNCTION ai_text_archive(p_owner uuid, p_thread uuid, p_archived boolean)
RETURNS TABLE (id uuid, title varchar, updated_at timestamptz, archived_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_thread public.ai_assistant_threads%ROWTYPE;
BEGIN
    IF p_archived IS NULL THEN RAISE EXCEPTION 'AI_ARCHIVE_INVALID' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_thread FROM public.ai_assistant_threads t
    WHERE t.id = p_thread AND t.owner_principal_id = p_owner AND public.ai_chat_owner_valid(p_owner)
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE = '42501'; END IF;
    IF (v_thread.archived_at IS NOT NULL) <> p_archived THEN
        IF v_thread.busy_until > clock_timestamp() THEN
            RAISE EXCEPTION 'AI_THREAD_BUSY_OR_MISSING' USING ERRCODE = 'P0001';
        END IF;
        UPDATE public.ai_assistant_threads t
        SET archived_at = CASE WHEN p_archived THEN clock_timestamp() ELSE NULL END,
            updated_at = clock_timestamp()
        WHERE t.id = p_thread AND t.owner_principal_id = p_owner;
    END IF;
    RETURN QUERY SELECT t.id, t.title, t.updated_at, t.archived_at
    FROM public.ai_assistant_threads t WHERE t.id = p_thread AND t.owner_principal_id = p_owner;
END;
$$;

CREATE FUNCTION ai_text_messages_page(
    p_owner uuid, p_thread uuid, p_before_at timestamptz, p_before_id uuid, p_limit integer
) RETURNS TABLE (
    id uuid, role varchar, content varchar, created_at timestamptz, request_id uuid, state varchar,
    source_user_message_id uuid, source_prompt varchar, regenerated boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT page.id, page.role, page.content, page.created_at, page.request_id, page.state,
           page.source_user_message_id, question.content,
           page.source_user_message_id IS NOT NULL AND question.request_id <> page.request_id
    FROM (
        SELECT m.* FROM public.ai_assistant_messages m
        JOIN public.ai_assistant_threads t ON t.id = m.thread_id AND t.owner_principal_id = m.owner_principal_id
        WHERE t.id = p_thread AND t.owner_principal_id = p_owner AND public.ai_chat_owner_valid(p_owner)
          AND (p_before_at IS NULL OR (m.created_at, m.id) < (p_before_at, p_before_id))
        ORDER BY m.created_at DESC, m.id DESC LIMIT LEAST(GREATEST(p_limit, 1), 81)
    ) page
    LEFT JOIN public.ai_assistant_messages question ON question.id = page.source_user_message_id
        AND question.owner_principal_id = p_owner AND question.thread_id = p_thread
    ORDER BY page.created_at ASC, page.id ASC
$$;

CREATE FUNCTION ai_text_request_messages(p_owner uuid, p_thread uuid, p_request uuid)
RETURNS TABLE (
    id uuid, role varchar, content varchar, created_at timestamptz, request_id uuid, state varchar,
    source_user_message_id uuid, source_prompt varchar, regenerated boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT m.id, m.role, m.content, m.created_at, m.request_id, m.state,
           m.source_user_message_id, q.content,
           m.source_user_message_id IS NOT NULL AND q.request_id <> m.request_id
    FROM public.ai_assistant_messages m
    JOIN public.ai_assistant_threads t ON t.id = m.thread_id AND t.owner_principal_id = m.owner_principal_id
    LEFT JOIN public.ai_assistant_messages q ON q.id = m.source_user_message_id
        AND q.owner_principal_id = p_owner AND q.thread_id = p_thread
    WHERE t.id = p_thread AND t.owner_principal_id = p_owner AND public.ai_chat_owner_valid(p_owner)
      AND m.request_id = p_request ORDER BY m.ordinal
$$;

-- New workers require 0228 before any paid admission. This wrapper is not a
-- fallback: on an old schema the function is absent and the request fails
-- before a ledger reservation or provider fetch.
CREATE FUNCTION ai_text_begin_paid(
    p_owner uuid, p_thread uuid, p_request uuid, p_text varchar, p_expected_version bigint
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.ai_chat_begin_paid(p_owner, p_thread, p_request, p_text, p_expected_version)
$$;

CREATE FUNCTION ai_text_regeneration_replay(p_owner uuid, p_thread uuid, p_request uuid, p_source uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_existing public.ai_assistant_regenerations%ROWTYPE;
BEGIN
    IF NOT public.ai_chat_owner_valid(p_owner) THEN
        RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_existing FROM public.ai_assistant_regenerations r
    WHERE r.owner_principal_id = p_owner AND r.request_id = p_request;
    IF FOUND THEN
        IF v_existing.thread_id <> p_thread OR v_existing.source_user_message_id <> p_source
           OR v_existing.source_digest IS DISTINCT FROM public.ai_text_source_digest(
                p_owner, p_thread, p_source, v_existing.source_ordinal, v_existing.source_prompt)
           OR NOT EXISTS (
               SELECT 1 FROM public.ai_assistant_messages q WHERE q.id = p_source
                 AND q.owner_principal_id = p_owner AND q.thread_id = p_thread AND q.role = 'user'
                 AND public.ai_text_source_digest(p_owner, p_thread, p_source, q.ordinal, q.content)
                     = v_existing.source_digest
           ) THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE = '22023'; END IF;
        RETURN true;
    END IF;
    IF EXISTS (SELECT 1 FROM public.ai_assistant_request_quota q
               WHERE q.owner_principal_id = p_owner AND q.request_id = p_request) THEN
        RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE = '22023';
    END IF;
    RETURN false;
END;
$$;

CREATE FUNCTION ai_text_regenerate_begin(
    p_owner uuid, p_thread uuid, p_request uuid, p_source uuid, p_expected_version bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_source public.ai_assistant_messages%ROWTYPE;
        v_config public.ai_assistant_config%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text, 7312));
    -- The same source receipt is free even after teacher revocation, archival,
    -- changed provider configuration, or a lost/interrupted upstream response.
    IF public.ai_text_regeneration_replay(p_owner, p_thread, p_request, p_source) THEN RETURN false; END IF;
    v_account := public.ai_chat_require_generation(p_owner);
    SELECT * INTO v_source FROM public.ai_assistant_messages m
    WHERE m.id = p_source AND m.thread_id = p_thread AND m.owner_principal_id = p_owner
      AND m.role = 'user' AND char_length(m.content) BETWEEN 1 AND 3000;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_SOURCE_DENIED' USING ERRCODE = '42501'; END IF;
    IF (SELECT count(*) FROM public.ai_assistant_request_quota q
        WHERE q.owner_principal_id = p_owner AND q.created_at > now() - interval '1 hour') >= 30 THEN
        RAISE EXCEPTION 'AI_RATE_LIMIT' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO STRICT v_config FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
    IF p_expected_version IS DISTINCT FROM v_config.configuration_version THEN
        RAISE EXCEPTION 'AI_CONFIG_CHANGED';
    END IF;
    IF NOT v_config.enabled OR v_config.api_key_ciphertext IS NULL
       OR v_config.api_key_iv IS NULL OR v_config.api_key_auth_tag IS NULL THEN
        RAISE EXCEPTION 'AI_DISABLED';
    END IF;
    PERFORM public.ai_paid_operation_reserve('chat');
    UPDATE public.ai_assistant_threads t
    SET busy_until = clock_timestamp() + interval '85 seconds', active_request_id = p_request,
        updated_at = clock_timestamp()
    WHERE t.id = p_thread AND t.owner_principal_id = p_owner
      AND (t.busy_until IS NULL OR t.busy_until < clock_timestamp());
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_BUSY_OR_MISSING' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO public.ai_assistant_request_quota (account_id, owner_principal_id, request_id)
    VALUES (v_account, p_owner, p_request);
    INSERT INTO public.ai_assistant_regenerations
        (owner_principal_id, request_id, thread_id, source_user_message_id, source_ordinal, source_prompt, source_digest)
    VALUES (p_owner, p_request, p_thread, p_source, v_source.ordinal, v_source.content,
        public.ai_text_source_digest(p_owner, p_thread, p_source, v_source.ordinal, v_source.content));
    RETURN true;
END;
$$;

CREATE FUNCTION ai_text_generation_context(p_owner uuid, p_thread uuid, p_request uuid)
RETURNS TABLE (role varchar, content varchar)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_source public.ai_assistant_messages%ROWTYPE;
BEGIN
    IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE = '42501'; END IF;
    SELECT q.* INTO v_source FROM public.ai_assistant_messages q
    WHERE q.owner_principal_id = p_owner AND q.thread_id = p_thread AND q.role = 'user'
      AND (q.request_id = p_request OR EXISTS (
          SELECT 1 FROM public.ai_assistant_regenerations r WHERE r.owner_principal_id = p_owner
            AND r.thread_id = p_thread AND r.request_id = p_request AND r.source_user_message_id = q.id
            AND r.source_digest = public.ai_text_source_digest(p_owner, p_thread, q.id, q.ordinal, q.content)
      ));
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_SOURCE_DENIED' USING ERRCODE = '42501'; END IF;
    RETURN QUERY
    WITH questions AS (
        SELECT q.* FROM public.ai_assistant_messages q
        WHERE q.thread_id = p_thread AND q.owner_principal_id = p_owner AND q.role = 'user'
          AND q.ordinal <= v_source.ordinal
        ORDER BY q.ordinal DESC LIMIT 8
    ), context AS (
        SELECT q.ordinal, 0 AS part, q.role, q.content FROM questions q
        UNION ALL
        SELECT q.ordinal, 1 AS part, answer.role, answer.content
        FROM questions q JOIN LATERAL (
            SELECT a.role, a.content FROM public.ai_assistant_messages a
            WHERE a.thread_id = p_thread AND a.owner_principal_id = p_owner AND a.role = 'assistant'
              AND a.source_user_message_id = q.id AND a.ordinal < v_source.ordinal
            ORDER BY a.ordinal DESC LIMIT 1
        ) answer ON true WHERE q.id <> v_source.id
    ) SELECT context.role, context.content FROM context ORDER BY context.ordinal, context.part;
END;
$$;

CREATE OR REPLACE FUNCTION ai_chat_finish(
    p_principal uuid, p_thread uuid, p_request uuid, p_answer varchar, p_state varchar DEFAULT 'complete'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_inserted uuid; v_source uuid;
BEGIN
    IF p_state NOT IN ('complete', 'stopped') OR char_length(p_answer) NOT BETWEEN 1 AND 8192 THEN
        RAISE EXCEPTION 'AI_RESPONSE_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT p.account_id INTO v_account FROM public.principals p WHERE p.id = p_principal;
    PERFORM 1 FROM public.ai_assistant_threads t
    WHERE t.id = p_thread AND t.owner_principal_id = p_principal AND t.active_request_id = p_request FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE = '42501'; END IF;
    SELECT m.id INTO v_source FROM public.ai_assistant_messages m
    WHERE m.thread_id = p_thread AND m.owner_principal_id = p_principal AND m.request_id = p_request AND m.role = 'user';
    IF v_source IS NULL THEN
        SELECT r.source_user_message_id INTO v_source FROM public.ai_assistant_regenerations r
        WHERE r.owner_principal_id = p_principal AND r.thread_id = p_thread AND r.request_id = p_request;
    END IF;
    IF v_source IS NULL THEN RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE = '42501'; END IF;
    INSERT INTO public.ai_assistant_messages
        (thread_id, account_id, owner_principal_id, request_id, role, content, state, source_user_message_id)
    VALUES (p_thread, v_account, p_principal, p_request, 'assistant', p_answer, p_state, v_source)
    ON CONFLICT (thread_id, role, request_id) DO NOTHING RETURNING id INTO v_inserted;
    UPDATE public.ai_assistant_threads SET busy_until = NULL, active_request_id = NULL, updated_at = clock_timestamp()
    WHERE id = p_thread AND owner_principal_id = p_principal AND active_request_id = p_request;
    RETURN v_inserted IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION ai_chat_abort(p_principal uuid, p_thread uuid, p_request uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    UPDATE public.ai_assistant_threads t SET busy_until = NULL, active_request_id = NULL
    WHERE t.id = p_thread AND t.owner_principal_id = p_principal AND t.active_request_id = p_request
      AND (EXISTS (SELECT 1 FROM public.ai_assistant_messages m
                   WHERE m.thread_id = p_thread AND m.owner_principal_id = p_principal
                     AND m.request_id = p_request AND m.role = 'user')
           OR EXISTS (SELECT 1 FROM public.ai_assistant_regenerations r
                      WHERE r.thread_id = p_thread AND r.owner_principal_id = p_principal AND r.request_id = p_request))
$$;

REVOKE ALL ON FUNCTION ai_text_search_threads(uuid, varchar, boolean, timestamptz, uuid, integer),
    ai_text_archive(uuid, uuid, boolean), ai_text_messages_page(uuid, uuid, timestamptz, uuid, integer),
    ai_text_request_messages(uuid, uuid, uuid), ai_text_begin_paid(uuid, uuid, uuid, varchar, bigint),
    ai_text_regeneration_replay(uuid, uuid, uuid, uuid), ai_text_regenerate_begin(uuid, uuid, uuid, uuid, bigint),
    ai_text_generation_context(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_text_search_threads(uuid, varchar, boolean, timestamptz, uuid, integer),
    ai_text_archive(uuid, uuid, boolean), ai_text_messages_page(uuid, uuid, timestamptz, uuid, integer),
    ai_text_request_messages(uuid, uuid, uuid), ai_text_begin_paid(uuid, uuid, uuid, varchar, bigint),
    ai_text_regeneration_replay(uuid, uuid, uuid, uuid), ai_text_regenerate_begin(uuid, uuid, uuid, uuid, bigint),
    ai_text_generation_context(uuid, uuid, uuid) TO asalab_app;
