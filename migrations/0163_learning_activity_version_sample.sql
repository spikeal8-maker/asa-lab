-- LRN-UX-01 UX1A2: immutable sample image for a canonical published activity version.
-- This slice is author-only: learner/runtime media delivery is deliberately not added.

CREATE TABLE learning_activity_version_media (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    activity_version_id uuid NOT NULL,
    role varchar(16) NOT NULL,
    content_type varchar(32) NOT NULL,
    bytes bytea NOT NULL,
    content_hash varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (activity_version_id, role),
    UNIQUE (tenant_id, activity_version_id, role),
    FOREIGN KEY (tenant_id, activity_version_id)
        REFERENCES learning_activity_versions(tenant_id, id),
    CONSTRAINT learning_activity_version_media_role_check
        CHECK (role = 'sample'),
    CONSTRAINT learning_activity_version_media_content_type_check
        CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT learning_activity_version_media_size_check
        CHECK (octet_length(bytes) BETWEEN 1 AND 400000),
    CONSTRAINT learning_activity_version_media_hash_check
        CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

CREATE TRIGGER learning_activity_version_media_immutable
    BEFORE UPDATE OR DELETE ON learning_activity_version_media
    FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();

CREATE OR REPLACE FUNCTION learning_activity_version_sample_meta(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid,
    p_activity_version_id uuid
)
RETURNS TABLE (
    result_code varchar,
    content_type varchar,
    content_hash varchar
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_activity_id uuid;
    v_version_id uuid;
    v_media record;
BEGIN
    SELECT activity.id
      INTO v_activity_id
      FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin <> 'legacy_runtime'
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id);

    IF v_activity_id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::varchar, NULL::varchar;
        RETURN;
    END IF;

    SELECT version.id
      INTO v_version_id
      FROM public.learning_activity_versions version
     WHERE version.id = p_activity_version_id
       AND version.tenant_id = p_tenant_id
       AND version.activity_id = p_activity_id
       AND version.canonical_contract_version = 1;

    IF v_version_id IS NULL THEN
        RETURN QUERY SELECT 'version_not_found'::varchar, NULL::varchar, NULL::varchar;
        RETURN;
    END IF;

    SELECT media.content_type, media.content_hash
      INTO v_media
      FROM public.learning_activity_version_media media
     WHERE media.tenant_id = p_tenant_id
       AND media.activity_version_id = p_activity_version_id
       AND media.role = 'sample';

    IF v_media.content_hash IS NULL THEN
        RETURN QUERY SELECT 'sample_not_found'::varchar, NULL::varchar, NULL::varchar;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'ok'::varchar, v_media.content_type::varchar,
                        v_media.content_hash::varchar;
END;
$$;

CREATE OR REPLACE FUNCTION learning_activity_version_sample_get(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid,
    p_activity_version_id uuid
)
RETURNS TABLE (
    result_code varchar,
    content_type varchar,
    bytes bytea,
    content_hash varchar
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_activity_id uuid;
    v_version_id uuid;
    v_media record;
BEGIN
    SELECT activity.id
      INTO v_activity_id
      FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin <> 'legacy_runtime'
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id);

    IF v_activity_id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::varchar, NULL::bytea, NULL::varchar;
        RETURN;
    END IF;

    SELECT version.id
      INTO v_version_id
      FROM public.learning_activity_versions version
     WHERE version.id = p_activity_version_id
       AND version.tenant_id = p_tenant_id
       AND version.activity_id = p_activity_id
       AND version.canonical_contract_version = 1;

    IF v_version_id IS NULL THEN
        RETURN QUERY SELECT 'version_not_found'::varchar, NULL::varchar, NULL::bytea, NULL::varchar;
        RETURN;
    END IF;

    SELECT media.content_type, media.bytes, media.content_hash
      INTO v_media
      FROM public.learning_activity_version_media media
     WHERE media.tenant_id = p_tenant_id
       AND media.activity_version_id = p_activity_version_id
       AND media.role = 'sample';

    IF v_media.content_hash IS NULL THEN
        RETURN QUERY SELECT 'sample_not_found'::varchar, NULL::varchar, NULL::bytea, NULL::varchar;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'ok'::varchar, v_media.content_type::varchar, v_media.bytes::bytea,
                        v_media.content_hash::varchar;
END;
$$;

CREATE OR REPLACE FUNCTION learning_activity_publish(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid,
    p_expected_revision integer,
    p_request_id varchar
)
RETURNS TABLE (
    result_code varchar,
    activity_version_id uuid,
    version_number integer,
    content_digest varchar,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_activity record;
    v_existing record;
    v_number integer;
    v_id uuid;
    v_snapshot jsonb;
    v_digest varchar;
    v_sample_content_type varchar;
    v_sample_bytes bytea;
    v_sample_content_hash varchar;
BEGIN
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request_id'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_activity_id::text, 9001));

    SELECT * INTO v_activity
      FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin <> 'legacy_runtime'
       AND activity.archived_at IS NULL
     FOR UPDATE;

    IF v_activity.id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT version.id, version.version_number, version.content_digest,
           version.source_draft_revision
      INTO v_existing
      FROM public.learning_activity_versions version
     WHERE version.activity_id = p_activity_id
       AND version.publication_request_id = p_request_id;

    IF v_existing.id IS NOT NULL THEN
        IF v_existing.source_draft_revision <> p_expected_revision THEN
            RETURN QUERY SELECT 'idempotency_conflict'::varchar, NULL::uuid,
                                NULL::integer, NULL::varchar, false;
        ELSE
            RETURN QUERY SELECT 'ok'::varchar, v_existing.id, v_existing.version_number,
                                v_existing.content_digest, true;
        END IF;
        RETURN;
    END IF;

    SELECT version.id, version.version_number, version.content_digest,
           version.source_draft_revision
      INTO v_existing
      FROM public.learning_activity_versions version
     WHERE version.activity_id = p_activity_id
       AND version.source_draft_revision = p_expected_revision
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
        RETURN QUERY SELECT 'ok'::varchar, v_existing.id, v_existing.version_number,
                            v_existing.content_digest, true;
        RETURN;
    END IF;

    IF v_activity.draft_revision <> p_expected_revision THEN
        RETURN QUERY SELECT 'revision_conflict'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.learning_migration_compatibility_activity_versions compatibility
         WHERE compatibility.learning_activity_version_id = v_activity.current_published_version_id
            OR compatibility.classroom_assignment_id::text =
               v_activity.draft_payload ->> 'sourceClassroomAssignmentId'
    ) THEN
        RETURN QUERY SELECT 'compatibility_not_reusable'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT media.content_type, media.bytes, media.content_hash
      INTO v_sample_content_type, v_sample_bytes, v_sample_content_hash
      FROM public.learning_activity_draft_media media
     WHERE media.tenant_id = p_tenant_id
       AND media.activity_id = p_activity_id
       AND media.role = 'sample';

    SELECT COALESCE(max(version.version_number), 0) + 1
      INTO v_number
      FROM public.learning_activity_versions version
     WHERE version.activity_id = p_activity_id;

    v_snapshot := jsonb_build_object(
        'activityId', v_activity.id,
        'versionNumber', v_number,
        'kind', v_activity.draft_payload ->> 'kind',
        'title', v_activity.draft_payload ->> 'title',
        'instructions', v_activity.draft_payload -> 'instructions',
        'resultMode', v_activity.draft_payload ->> 'resultMode',
        'maxPoints', v_activity.draft_payload -> 'maxPoints',
        'policies', v_activity.draft_payload -> 'policies',
        'moduleKey', v_activity.draft_payload -> 'moduleKey',
        'quizVersionId', v_activity.draft_payload -> 'quizVersionId',
        'starterProjectVersionId', v_activity.draft_payload -> 'starterProjectVersionId',
        'sample', CASE
            WHEN v_sample_content_hash IS NULL THEN NULL::jsonb
            ELSE jsonb_build_object(
                'contentType', v_sample_content_type,
                'contentHash', v_sample_content_hash
            )
        END,
        'provenance', jsonb_build_object(
            'authoringOrigin', v_activity.authoring_origin,
            'sourceTeacherAssignmentId', v_activity.source_teacher_assignment_id,
            'sourceDraftRevision', v_activity.draft_revision
        )
    );

    v_digest := public.learning_activity_snapshot_digest(v_snapshot);

    INSERT INTO public.learning_activity_versions (
        tenant_id, activity_id, version_number, title, instructions,
        activity_type, module_key, max_points, scoring_policy, content_digest,
        canonical_kind, result_mode, policy_snapshot, quiz_version_id,
        starter_project_version_id, provenance, source_draft_revision,
        publication_request_id, published_by_principal_id,
        canonical_contract_version
    ) VALUES (
        v_activity.tenant_id, v_activity.id, v_number,
        v_activity.draft_payload ->> 'title',
        NULLIF(v_activity.draft_payload ->> 'instructions', ''),
        v_activity.draft_payload ->> 'kind',
        NULLIF(v_activity.draft_payload ->> 'moduleKey', ''),
        NULLIF(v_activity.draft_payload ->> 'maxPoints', '')::integer,
        jsonb_build_object('kind', 'canonical',
                           'resultMode', v_activity.draft_payload ->> 'resultMode'),
        v_digest,
        v_activity.draft_payload ->> 'kind',
        v_activity.draft_payload ->> 'resultMode',
        v_activity.draft_payload -> 'policies',
        NULLIF(v_activity.draft_payload ->> 'quizVersionId', '')::uuid,
        NULLIF(v_activity.draft_payload ->> 'starterProjectVersionId', '')::uuid,
        v_snapshot -> 'provenance', v_activity.draft_revision,
        p_request_id, p_principal_id, 1
    ) RETURNING id INTO v_id;

    IF v_sample_content_hash IS NOT NULL THEN
        INSERT INTO public.learning_activity_version_media (
            tenant_id, activity_version_id, role, content_type, bytes, content_hash
        ) VALUES (
            p_tenant_id, v_id, 'sample',
            v_sample_content_type, v_sample_bytes, v_sample_content_hash
        );
    END IF;

    UPDATE public.learning_activities
       SET current_published_version_id = v_id
     WHERE id = p_activity_id;

    RETURN QUERY SELECT 'ok'::varchar, v_id, v_number, v_digest, false;
END;
$$;

ALTER TABLE learning_activity_version_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_activity_version_media FORCE ROW LEVEL SECURITY;

CREATE POLICY learning_activity_version_media_tenant
    ON learning_activity_version_media
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE ALL ON learning_activity_version_media FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION learning_activity_version_sample_meta(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_version_sample_get(uuid,uuid,uuid,uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION learning_activity_version_sample_meta(uuid,uuid,uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_activity_version_sample_get(uuid,uuid,uuid,uuid) TO asalab_app;

COMMENT ON TABLE learning_activity_version_media IS
    'Immutable media copied into one exact canonical LearningActivityVersion at publication time.';
