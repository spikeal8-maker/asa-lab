-- LRN-UX-01 UX1A1: one owner-only image attached to the canonical activity draft.
-- Draft media is deliberately not copied into learning_activity_versions in this slice.

CREATE TABLE learning_activity_draft_media (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    activity_id uuid NOT NULL,
    role varchar(16) NOT NULL,
    content_type varchar(32) NOT NULL,
    bytes bytea NOT NULL,
    content_hash varchar(64) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (activity_id, role),
    UNIQUE (tenant_id, activity_id, role),
    FOREIGN KEY (tenant_id, activity_id)
        REFERENCES learning_activities(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT learning_activity_draft_media_role_check
        CHECK (role = 'sample'),
    CONSTRAINT learning_activity_draft_media_content_type_check
        CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT learning_activity_draft_media_size_check
        CHECK (octet_length(bytes) BETWEEN 1 AND 400000),
    CONSTRAINT learning_activity_draft_media_hash_check
        CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

CREATE OR REPLACE FUNCTION learning_activity_draft_sample_meta(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid,
    p_expected_revision integer
)
RETURNS TABLE (
    result_code varchar,
    content_type varchar,
    content_hash varchar,
    draft_revision integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_activity record;
    v_media record;
BEGIN
    SELECT activity.id, activity.draft_revision
      INTO v_activity
      FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND activity.archived_at IS NULL
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin = 'canonical'
       AND activity.source_teacher_assignment_id IS NULL
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id);

    IF v_activity.id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::varchar, NULL::varchar, NULL::integer;
        RETURN;
    END IF;

    IF p_expected_revision IS NOT NULL
       AND v_activity.draft_revision <> p_expected_revision THEN
        RETURN QUERY SELECT 'revision_conflict'::varchar, NULL::varchar, NULL::varchar,
                            v_activity.draft_revision;
        RETURN;
    END IF;

    SELECT media.content_type, media.content_hash
      INTO v_media
      FROM public.learning_activity_draft_media media
     WHERE media.tenant_id = p_tenant_id
       AND media.activity_id = p_activity_id
       AND media.role = 'sample';

    IF v_media.content_hash IS NULL THEN
        RETURN QUERY SELECT 'sample_not_found'::varchar, NULL::varchar, NULL::varchar,
                            v_activity.draft_revision;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'ok'::varchar, v_media.content_type::varchar,
                        v_media.content_hash::varchar, v_activity.draft_revision;
END;
$$;

CREATE OR REPLACE FUNCTION learning_activity_draft_sample_get(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid
)
RETURNS TABLE (
    result_code varchar,
    content_type varchar,
    bytes bytea,
    content_hash varchar,
    draft_revision integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_activity record;
    v_media record;
BEGIN
    SELECT activity.id, activity.draft_revision
      INTO v_activity
      FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND activity.archived_at IS NULL
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin = 'canonical'
       AND activity.source_teacher_assignment_id IS NULL
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id);

    IF v_activity.id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::varchar, NULL::bytea,
                            NULL::varchar, NULL::integer;
        RETURN;
    END IF;

    SELECT media.content_type, media.bytes, media.content_hash
      INTO v_media
      FROM public.learning_activity_draft_media media
     WHERE media.tenant_id = p_tenant_id
       AND media.activity_id = p_activity_id
       AND media.role = 'sample';

    IF v_media.content_hash IS NULL THEN
        RETURN QUERY SELECT 'sample_not_found'::varchar, NULL::varchar, NULL::bytea,
                            NULL::varchar, v_activity.draft_revision;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'ok'::varchar, v_media.content_type::varchar, v_media.bytes::bytea,
                        v_media.content_hash::varchar, v_activity.draft_revision;
END;
$$;

CREATE OR REPLACE FUNCTION learning_activity_draft_sample_set(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid,
    p_expected_revision integer,
    p_bytes bytea,
    p_content_type varchar
)
RETURNS TABLE (
    result_code varchar,
    draft_revision integer,
    content_hash varchar
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_activity record;
    v_revision integer;
    v_hash varchar;
BEGIN
    IF p_content_type NOT IN ('image/png', 'image/jpeg', 'image/webp')
       OR p_bytes IS NULL
       OR octet_length(p_bytes) < 1
       OR octet_length(p_bytes) > 400000 THEN
        RETURN QUERY SELECT 'invalid_media'::varchar, NULL::integer, NULL::varchar;
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_activity_id::text, 9162));

    SELECT activity.id, activity.draft_revision
      INTO v_activity
      FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND activity.archived_at IS NULL
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin = 'canonical'
       AND activity.source_teacher_assignment_id IS NULL
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
     FOR UPDATE;

    IF v_activity.id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::integer, NULL::varchar;
        RETURN;
    END IF;

    IF p_expected_revision IS NULL OR v_activity.draft_revision <> p_expected_revision THEN
        RETURN QUERY SELECT 'revision_conflict'::varchar, v_activity.draft_revision, NULL::varchar;
        RETURN;
    END IF;

    v_hash := encode(public.digest(p_bytes, 'sha256'), 'hex');

    INSERT INTO public.learning_activity_draft_media (
        tenant_id, activity_id, role, content_type, bytes, content_hash, updated_at
    ) VALUES (
        p_tenant_id, p_activity_id, 'sample', p_content_type, p_bytes, v_hash, now()
    )
    ON CONFLICT (activity_id, role) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        content_type = EXCLUDED.content_type,
        bytes = EXCLUDED.bytes,
        content_hash = EXCLUDED.content_hash,
        updated_at = now();

    UPDATE public.learning_activities
       SET draft_revision = draft_revision + 1
     WHERE id = p_activity_id
     RETURNING draft_revision INTO v_revision;

    RETURN QUERY SELECT 'ok'::varchar, v_revision, v_hash;
END;
$$;

CREATE OR REPLACE FUNCTION learning_activity_draft_sample_delete(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid,
    p_expected_revision integer
)
RETURNS TABLE (
    result_code varchar,
    draft_revision integer
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_activity record;
    v_revision integer;
    v_deleted integer;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_activity_id::text, 9162));

    SELECT activity.id, activity.draft_revision
      INTO v_activity
      FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND activity.archived_at IS NULL
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin = 'canonical'
       AND activity.source_teacher_assignment_id IS NULL
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
     FOR UPDATE;

    IF v_activity.id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::integer;
        RETURN;
    END IF;

    IF p_expected_revision IS NULL OR v_activity.draft_revision <> p_expected_revision THEN
        RETURN QUERY SELECT 'revision_conflict'::varchar, v_activity.draft_revision;
        RETURN;
    END IF;

    DELETE FROM public.learning_activity_draft_media media
     WHERE media.tenant_id = p_tenant_id
       AND media.activity_id = p_activity_id
       AND media.role = 'sample';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    IF v_deleted = 0 THEN
        RETURN QUERY SELECT 'sample_not_found'::varchar, v_activity.draft_revision;
        RETURN;
    END IF;

    UPDATE public.learning_activities
       SET draft_revision = draft_revision + 1
     WHERE id = p_activity_id
     RETURNING draft_revision INTO v_revision;

    RETURN QUERY SELECT 'ok'::varchar, v_revision;
END;
$$;

ALTER TABLE learning_activity_draft_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_activity_draft_media FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_activity_draft_media_tenant
    ON learning_activity_draft_media
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE ALL ON learning_activity_draft_media FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION learning_activity_draft_sample_meta(uuid,uuid,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_draft_sample_get(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_draft_sample_set(uuid,uuid,uuid,integer,bytea,varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_draft_sample_delete(uuid,uuid,uuid,integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION learning_activity_draft_sample_meta(uuid,uuid,uuid,integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_activity_draft_sample_get(uuid,uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_activity_draft_sample_set(uuid,uuid,uuid,integer,bytea,varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_activity_draft_sample_delete(uuid,uuid,uuid,integer) TO asalab_app;

COMMENT ON TABLE learning_activity_draft_media IS
    'Mutable owner-only media for a canonical LearningActivity draft. Not published version content.';
