-- LRN-M1-001: converge future authored definitions on the existing
-- learning_activities -> learning_activity_versions core. Existing runtime
-- references and immutable historical rows are deliberately not backfilled.

ALTER TABLE learning_activities
    ADD COLUMN visibility_policy varchar(16) NOT NULL DEFAULT 'private',
    ADD COLUMN authoring_origin varchar(32) NOT NULL DEFAULT 'legacy_runtime',
    ADD COLUMN reusable_authored_content boolean NOT NULL DEFAULT false,
    ADD COLUMN draft_revision integer,
    ADD COLUMN draft_payload jsonb,
    ADD COLUMN current_published_version_id uuid,
    ADD COLUMN source_teacher_assignment_id uuid,
    ADD COLUMN creation_request_id varchar(128),
    ADD COLUMN creation_request_digest varchar(64);

ALTER TABLE learning_activities DROP CONSTRAINT learning_activities_type_check;
ALTER TABLE learning_activities ADD CONSTRAINT learning_activities_type_check CHECK (
    activity_type IN ('project', 'quiz', 'essay', 'file', 'manual',
                      'open_response', 'composite')
);
ALTER TABLE learning_activities ADD CONSTRAINT learning_activities_visibility_check
    CHECK (visibility_policy IN ('private', 'school')
           AND (scope_kind <> 'personal' OR visibility_policy = 'private'));
ALTER TABLE learning_activities ADD CONSTRAINT learning_activities_origin_check
    CHECK (authoring_origin IN ('legacy_runtime', 'canonical',
                                'teacher_assignment', 'quiz_version'));
ALTER TABLE learning_activities ADD CONSTRAINT learning_activities_draft_check CHECK (
    (authoring_origin = 'legacy_runtime'
        AND reusable_authored_content = false
        AND draft_revision IS NULL
        AND draft_payload IS NULL
        AND creation_request_id IS NULL
        AND creation_request_digest IS NULL)
    OR
    (authoring_origin <> 'legacy_runtime'
        AND reusable_authored_content = true
        AND draft_revision > 0
        AND jsonb_typeof(draft_payload) = 'object'
        AND creation_request_id ~ '^[A-Za-z0-9._:-]{8,128}$'
        AND creation_request_digest ~ '^[0-9a-f]{64}$')
);
ALTER TABLE learning_activities ADD CONSTRAINT learning_activities_teacher_source_fk
    FOREIGN KEY (tenant_id, source_teacher_assignment_id)
    REFERENCES teacher_assignments(tenant_id, id);
CREATE UNIQUE INDEX learning_activities_teacher_source_idx
    ON learning_activities(source_teacher_assignment_id)
    WHERE source_teacher_assignment_id IS NOT NULL;
CREATE UNIQUE INDEX learning_activities_creation_request_idx
    ON learning_activities(tenant_id, owner_principal_id, creation_request_id)
    WHERE creation_request_id IS NOT NULL;
CREATE INDEX learning_activities_author_library_idx
    ON learning_activities(owner_principal_id, archived_at, created_at DESC)
    WHERE reusable_authored_content = true;

ALTER TABLE learning_activity_versions ALTER COLUMN max_points DROP NOT NULL;
ALTER TABLE learning_activity_versions
    DROP CONSTRAINT learning_activity_versions_points_check;
ALTER TABLE learning_activity_versions ADD CONSTRAINT learning_activity_versions_points_check
    CHECK (max_points IS NULL OR max_points > 0);
ALTER TABLE learning_activity_versions
    ADD COLUMN canonical_kind varchar(24),
    ADD COLUMN result_mode varchar(16),
    ADD COLUMN policy_snapshot jsonb,
    ADD COLUMN quiz_version_id uuid,
    ADD COLUMN starter_project_version_id uuid,
    ADD COLUMN provenance jsonb,
    ADD COLUMN source_draft_revision integer,
    ADD COLUMN publication_request_id varchar(128),
    ADD COLUMN published_by_principal_id uuid,
    ADD COLUMN canonical_contract_version smallint;

ALTER TABLE learning_activity_versions DROP CONSTRAINT learning_activity_versions_type_check;
ALTER TABLE learning_activity_versions ADD CONSTRAINT learning_activity_versions_type_check CHECK (
    activity_type IN ('project', 'quiz', 'essay', 'file', 'manual',
                      'open_response', 'composite')
);
ALTER TABLE learning_activity_versions
    ADD CONSTRAINT learning_activity_versions_kind_check
    CHECK (canonical_kind IS NULL OR canonical_kind IN ('quiz', 'project', 'essay', 'file', 'manual'));
ALTER TABLE learning_activity_versions
    ADD CONSTRAINT learning_activity_versions_result_mode_check
    CHECK (result_mode IS NULL OR result_mode IN ('ungraded', 'completion', 'graded'));
ALTER TABLE learning_activity_versions
    ADD CONSTRAINT learning_activity_versions_quiz_fk
    FOREIGN KEY (tenant_id, quiz_version_id) REFERENCES quiz_versions(tenant_id, id);
ALTER TABLE learning_activity_versions
    ADD CONSTRAINT learning_activity_versions_starter_project_fk
    FOREIGN KEY (starter_project_version_id) REFERENCES project_versions(id);
ALTER TABLE learning_activity_versions
    ADD CONSTRAINT learning_activity_versions_publisher_fk
    FOREIGN KEY (published_by_principal_id) REFERENCES principals(id);
ALTER TABLE learning_activity_versions
    ADD CONSTRAINT learning_activity_versions_canonical_contract_check CHECK (
        canonical_contract_version IS NULL
        OR (
            canonical_contract_version = 1
            AND canonical_kind IS NOT NULL
            AND activity_type = canonical_kind
            AND result_mode IS NOT NULL
            AND source_draft_revision > 0
            AND publication_request_id ~ '^[A-Za-z0-9._:-]{8,128}$'
            AND published_by_principal_id IS NOT NULL
            AND jsonb_typeof(policy_snapshot) = 'object'
            AND policy_snapshot ?& ARRAY[
                'attemptPolicy', 'resultSelectionPolicy', 'completionPolicy',
                'latePolicy', 'assessmentPolicy', 'feedbackReleasePolicy'
            ]
            AND (policy_snapshot - ARRAY[
                'attemptPolicy', 'resultSelectionPolicy', 'completionPolicy',
                'latePolicy', 'assessmentPolicy', 'feedbackReleasePolicy'
            ]) = '{}'::jsonb
            AND jsonb_typeof(policy_snapshot -> 'attemptPolicy') IN ('object', 'null')
            AND jsonb_typeof(policy_snapshot -> 'resultSelectionPolicy') IN ('object', 'null')
            AND jsonb_typeof(policy_snapshot -> 'completionPolicy') IN ('object', 'null')
            AND jsonb_typeof(policy_snapshot -> 'latePolicy') IN ('object', 'null')
            AND jsonb_typeof(policy_snapshot -> 'assessmentPolicy') IN ('object', 'null')
            AND jsonb_typeof(policy_snapshot -> 'feedbackReleasePolicy') IN ('object', 'null')
            AND jsonb_typeof(provenance) = 'object'
            AND (
                (result_mode = 'graded' AND max_points > 0)
                OR (result_mode IN ('ungraded', 'completion') AND max_points IS NULL)
            )
            AND ((canonical_kind = 'quiz' AND quiz_version_id IS NOT NULL)
                 OR (canonical_kind <> 'quiz' AND quiz_version_id IS NULL))
            AND ((canonical_kind = 'project' AND length(trim(module_key)) > 0)
                 OR canonical_kind <> 'project')
        )
    );
CREATE UNIQUE INDEX learning_activity_versions_draft_once_idx
    ON learning_activity_versions(activity_id, source_draft_revision)
    WHERE canonical_contract_version = 1;
CREATE UNIQUE INDEX learning_activity_versions_publish_request_idx
    ON learning_activity_versions(activity_id, publication_request_id)
    WHERE publication_request_id IS NOT NULL;

CREATE UNIQUE INDEX learning_activity_versions_activity_pointer_idx
    ON learning_activity_versions(activity_id, id);

ALTER TABLE learning_activities ADD CONSTRAINT learning_activities_current_version_fk
    FOREIGN KEY (id, current_published_version_id)
    REFERENCES learning_activity_versions(activity_id, id);

CREATE OR REPLACE FUNCTION learning_activity_snapshot_digest(p_snapshot jsonb)
RETURNS varchar
LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT encode(public.digest(convert_to(p_snapshot::text, 'UTF8'), 'sha256'), 'hex')::varchar;
$$;

CREATE OR REPLACE FUNCTION learning_activity_normalize_draft(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_kind varchar,
    p_title varchar,
    p_instructions varchar,
    p_result_mode varchar,
    p_max_points integer,
    p_policy_snapshot jsonb,
    p_module_key varchar,
    p_quiz_version_id uuid,
    p_starter_project_version_id uuid,
    p_source_teacher_assignment_id uuid
)
RETURNS TABLE (result_code varchar, draft_payload jsonb, authoring_origin varchar)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_title varchar := NULLIF(trim(p_title), '');
    v_instructions varchar := NULLIF(trim(p_instructions), '');
    v_module varchar := NULLIF(trim(p_module_key), '');
    v_max integer := p_max_points;
    v_policy jsonb := p_policy_snapshot;
    v_quiz record;
    v_assignment record;
    v_origin varchar := 'canonical';
BEGIN
    IF NOT public.learning_author_can_use_tenant(p_principal_id, p_tenant_id) THEN
        RETURN QUERY SELECT 'tenant_forbidden'::varchar, NULL::jsonb, NULL::varchar;
        RETURN;
    END IF;
    IF p_kind NOT IN ('quiz', 'project', 'essay', 'file', 'manual')
       OR p_result_mode NOT IN ('ungraded', 'completion', 'graded')
       OR v_title IS NULL OR length(v_title) > 255
       OR (v_instructions IS NOT NULL AND length(v_instructions) > 12000)
       OR jsonb_typeof(v_policy) IS DISTINCT FROM 'object'
       OR NOT (v_policy ?& ARRAY[
           'attemptPolicy', 'resultSelectionPolicy', 'completionPolicy',
           'latePolicy', 'assessmentPolicy', 'feedbackReleasePolicy'
       ])
       OR (v_policy - ARRAY[
           'attemptPolicy', 'resultSelectionPolicy', 'completionPolicy',
           'latePolicy', 'assessmentPolicy', 'feedbackReleasePolicy'
       ]) <> '{}'::jsonb
       OR jsonb_typeof(v_policy -> 'attemptPolicy') NOT IN ('object', 'null')
       OR jsonb_typeof(v_policy -> 'resultSelectionPolicy') NOT IN ('object', 'null')
       OR jsonb_typeof(v_policy -> 'completionPolicy') NOT IN ('object', 'null')
       OR jsonb_typeof(v_policy -> 'latePolicy') NOT IN ('object', 'null')
       OR jsonb_typeof(v_policy -> 'assessmentPolicy') NOT IN ('object', 'null')
       OR jsonb_typeof(v_policy -> 'feedbackReleasePolicy') NOT IN ('object', 'null') THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::jsonb, NULL::varchar;
        RETURN;
    END IF;
    IF (p_result_mode = 'graded' AND (v_max IS NULL OR v_max <= 0))
       OR (p_result_mode IN ('ungraded', 'completion') AND v_max IS NOT NULL) THEN
        RETURN QUERY SELECT 'invalid_result_mode'::varchar, NULL::jsonb, NULL::varchar;
        RETURN;
    END IF;
    IF p_starter_project_version_id IS NOT NULL THEN
        -- CURRENT ProjectVersion has no authoring-starter provenance. A learner
        -- submission checkpoint cannot silently become reusable source content.
        RETURN QUERY SELECT 'starter_project_unprovenanced'::varchar,
                            NULL::jsonb, NULL::varchar;
        RETURN;
    END IF;
    IF p_source_teacher_assignment_id IS NOT NULL THEN
        SELECT assignment.title, assignment.brief, assignment.module_key
          INTO v_assignment
          FROM public.teacher_assignments assignment
         WHERE assignment.id = p_source_teacher_assignment_id
           AND assignment.tenant_id = p_tenant_id
           AND assignment.owner_principal_id = p_principal_id;
        IF v_assignment.title IS NULL OR p_kind <> 'project' THEN
            RETURN QUERY SELECT 'teacher_assignment_forbidden'::varchar,
                                NULL::jsonb, NULL::varchar;
            RETURN;
        END IF;
        v_title := v_assignment.title;
        v_instructions := v_assignment.brief;
        v_module := v_assignment.module_key;
        v_origin := 'teacher_assignment';
    END IF;
    IF p_kind = 'project' AND v_module IS NULL THEN
        RETURN QUERY SELECT 'project_module_required'::varchar, NULL::jsonb, NULL::varchar;
        RETURN;
    END IF;
    IF p_kind = 'quiz' THEN
        SELECT quiz.id, quiz.total_points, quiz.attempt_limit,
               quiz.time_limit_minutes, quiz.pass_threshold_basis_points,
               quiz.feedback_release_policy, quiz.owner_principal_id
          INTO v_quiz
          FROM public.quiz_versions quiz
         WHERE quiz.id = p_quiz_version_id
           AND quiz.tenant_id = p_tenant_id
           AND quiz.owner_principal_id = p_principal_id;
        IF v_quiz.id IS NULL THEN
            RETURN QUERY SELECT 'quiz_version_forbidden'::varchar, NULL::jsonb, NULL::varchar;
            RETURN;
        END IF;
        v_origin := 'quiz_version';
        v_max := CASE WHEN p_result_mode = 'graded' THEN v_quiz.total_points ELSE NULL END;
        v_policy := v_policy || jsonb_build_object(
            'attemptPolicy', jsonb_build_object(
                'maxAttempts', v_quiz.attempt_limit,
                'timeLimitMinutes', v_quiz.time_limit_minutes
            ),
            'assessmentPolicy', CASE WHEN p_result_mode = 'graded'
                THEN jsonb_build_object(
                    'mode', 'automatic',
                    'passThresholdBasisPoints', v_quiz.pass_threshold_basis_points
                )
                ELSE jsonb_build_object('mode', 'automatic_completion') END,
            'feedbackReleasePolicy', jsonb_build_object(
                'mode', v_quiz.feedback_release_policy
            )
        );
    ELSIF p_quiz_version_id IS NOT NULL THEN
        RETURN QUERY SELECT 'quiz_reference_wrong_kind'::varchar, NULL::jsonb, NULL::varchar;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'ok'::varchar, jsonb_build_object(
        'kind', p_kind,
        'title', v_title,
        'instructions', v_instructions,
        'resultMode', p_result_mode,
        'maxPoints', v_max,
        'policies', v_policy,
        'moduleKey', v_module,
        'quizVersionId', p_quiz_version_id,
        'starterProjectVersionId', p_starter_project_version_id,
        'sourceTeacherAssignmentId', p_source_teacher_assignment_id
    ), v_origin;
END;
$$;

CREATE OR REPLACE FUNCTION learning_activity_create(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_scope_kind varchar,
    p_visibility_policy varchar,
    p_kind varchar,
    p_title varchar,
    p_instructions varchar,
    p_result_mode varchar,
    p_max_points integer,
    p_policy_snapshot jsonb,
    p_module_key varchar,
    p_quiz_version_id uuid,
    p_starter_project_version_id uuid,
    p_source_teacher_assignment_id uuid,
    p_request_id varchar
)
RETURNS TABLE (result_code varchar, activity_id uuid, draft_revision integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_normalized record; v_id uuid; v_existing record;
        v_request_snapshot jsonb; v_request_digest varchar;
BEGIN
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request_id'::varchar, NULL::uuid, NULL::integer;
        RETURN;
    END IF;
    IF p_scope_kind NOT IN ('personal', 'school')
       OR p_visibility_policy NOT IN ('private', 'school')
       OR (p_scope_kind = 'personal' AND p_visibility_policy = 'school') THEN
        RETURN QUERY SELECT 'invalid_scope'::varchar, NULL::uuid, NULL::integer;
        RETURN;
    END IF;
    SELECT * INTO v_normalized FROM public.learning_activity_normalize_draft(
        p_principal_id, p_tenant_id, p_kind, p_title, p_instructions,
        p_result_mode, p_max_points, p_policy_snapshot, p_module_key,
        p_quiz_version_id, p_starter_project_version_id,
        p_source_teacher_assignment_id
    );
    IF v_normalized.result_code <> 'ok' THEN
        RETURN QUERY SELECT v_normalized.result_code::varchar, NULL::uuid, NULL::integer;
        RETURN;
    END IF;
    v_request_snapshot := jsonb_build_object(
        'tenantId', p_tenant_id,
        'ownerPrincipalId', p_principal_id,
        'scope', p_scope_kind,
        'visibility', p_visibility_policy,
        'draft', v_normalized.draft_payload
    );
    v_request_digest := public.learning_activity_snapshot_digest(v_request_snapshot);
    PERFORM pg_advisory_xact_lock(hashtextextended(
        COALESCE(p_source_teacher_assignment_id::text,
                 p_tenant_id::text || ':' || p_principal_id::text || ':' || p_request_id),
        9000
    ));
    SELECT activity.id, activity.creation_request_digest
      INTO v_existing
      FROM public.learning_activities activity
     WHERE activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND activity.creation_request_id = p_request_id;
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.creation_request_digest <> v_request_digest THEN
            RETURN QUERY SELECT 'idempotency_conflict'::varchar, NULL::uuid, NULL::integer;
        ELSE
            RETURN QUERY SELECT 'ok'::varchar, v_existing.id, 1;
        END IF;
        RETURN;
    END IF;
    IF p_source_teacher_assignment_id IS NOT NULL THEN
        SELECT activity.id, activity.creation_request_digest
          INTO v_existing
          FROM public.learning_activities activity
         WHERE source_teacher_assignment_id = p_source_teacher_assignment_id;
        IF v_existing.id IS NOT NULL THEN
            IF v_existing.creation_request_digest <> v_request_digest THEN
                RETURN QUERY SELECT 'source_conflict'::varchar, NULL::uuid, NULL::integer;
            ELSE
                RETURN QUERY SELECT 'ok'::varchar, v_existing.id, 1;
            END IF;
            RETURN;
        END IF;
    END IF;
    INSERT INTO public.learning_activities (
        tenant_id, owner_principal_id, scope_kind, activity_type, title,
        visibility_policy, authoring_origin, reusable_authored_content,
        draft_revision, draft_payload, source_teacher_assignment_id,
        creation_request_id, creation_request_digest
    ) VALUES (
        p_tenant_id, p_principal_id, p_scope_kind, p_kind,
        v_normalized.draft_payload ->> 'title', p_visibility_policy,
        v_normalized.authoring_origin, true, 1, v_normalized.draft_payload,
        p_source_teacher_assignment_id, p_request_id, v_request_digest
    ) RETURNING id INTO v_id;
    RETURN QUERY SELECT 'ok'::varchar, v_id, 1;
END;
$$;

CREATE OR REPLACE FUNCTION learning_activity_draft_put(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid,
    p_expected_revision integer,
    p_title varchar,
    p_instructions varchar,
    p_result_mode varchar,
    p_max_points integer,
    p_policy_snapshot jsonb,
    p_module_key varchar,
    p_quiz_version_id uuid,
    p_starter_project_version_id uuid
)
RETURNS TABLE (result_code varchar, draft_revision integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_activity record; v_normalized record; v_revision integer;
BEGIN
    SELECT * INTO v_activity FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
       AND activity.reusable_authored_content = true
       AND activity.archived_at IS NULL;
    IF v_activity.id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::integer;
        RETURN;
    END IF;
    IF v_activity.draft_revision <> p_expected_revision THEN
        RETURN QUERY SELECT 'revision_conflict'::varchar, v_activity.draft_revision;
        RETURN;
    END IF;
    SELECT * INTO v_normalized FROM public.learning_activity_normalize_draft(
        p_principal_id, v_activity.tenant_id, v_activity.activity_type,
        p_title, p_instructions, p_result_mode, p_max_points,
        p_policy_snapshot, p_module_key, p_quiz_version_id,
        p_starter_project_version_id, v_activity.source_teacher_assignment_id
    );
    IF v_normalized.result_code <> 'ok' THEN
        RETURN QUERY SELECT v_normalized.result_code::varchar, NULL::integer;
        RETURN;
    END IF;
    UPDATE public.learning_activities activity
       SET title = v_normalized.draft_payload ->> 'title',
           draft_payload = v_normalized.draft_payload,
           draft_revision = activity.draft_revision + 1
     WHERE activity.id = p_activity_id
       AND activity.draft_revision = p_expected_revision
     RETURNING activity.draft_revision INTO v_revision;
    IF v_revision IS NULL THEN
        RETURN QUERY SELECT 'revision_conflict'::varchar, NULL::integer;
    ELSE
        RETURN QUERY SELECT 'ok'::varchar, v_revision;
    END IF;
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
DECLARE v_activity record; v_existing record; v_number integer; v_id uuid;
        v_snapshot jsonb; v_digest varchar;
BEGIN
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request_id'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_activity_id::text, 9001));
    SELECT * INTO v_activity FROM public.learning_activities activity
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
      INTO v_existing FROM public.learning_activity_versions version
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
      INTO v_existing FROM public.learning_activity_versions version
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
        SELECT 1 FROM public.learning_migration_compatibility_activity_versions compatibility
         WHERE compatibility.learning_activity_version_id = v_activity.current_published_version_id
            OR compatibility.classroom_assignment_id::text =
               v_activity.draft_payload ->> 'sourceClassroomAssignmentId'
    ) THEN
        RETURN QUERY SELECT 'compatibility_not_reusable'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;
    SELECT COALESCE(max(version.version_number), 0) + 1 INTO v_number
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
    UPDATE public.learning_activities
       SET current_published_version_id = v_id
     WHERE id = p_activity_id;
    RETURN QUERY SELECT 'ok'::varchar, v_id, v_number, v_digest, false;
END;
$$;

CREATE OR REPLACE FUNCTION learning_activity_list(
    p_principal_id uuid,
    p_tenant_id uuid
)
RETURNS TABLE (
    activity_id uuid, title varchar, kind varchar, result_mode varchar,
    visibility_policy varchar, draft_revision integer,
    current_published_version_id uuid, archived_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT activity.id, activity.title, activity.activity_type,
           activity.draft_payload ->> 'resultMode', activity.visibility_policy,
           activity.draft_revision, activity.current_published_version_id,
           activity.archived_at
      FROM public.learning_activities activity
     WHERE activity.owner_principal_id = p_principal_id
       AND activity.tenant_id = p_tenant_id
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin <> 'legacy_runtime'
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
       AND NOT EXISTS (
           SELECT 1 FROM public.learning_migration_compatibility_activity_versions compatibility
            WHERE compatibility.learning_activity_version_id = activity.current_published_version_id
       )
     ORDER BY activity.created_at DESC, activity.id;
$$;

CREATE OR REPLACE FUNCTION learning_activity_get(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid
)
RETURNS TABLE (
    activity_id uuid, tenant_id uuid, title varchar, kind varchar,
    owner_scope varchar, visibility_policy varchar, draft_revision integer,
    draft_payload jsonb, current_published_version_id uuid, archived_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT activity.id, activity.tenant_id, activity.title, activity.activity_type,
           activity.scope_kind, activity.visibility_policy, activity.draft_revision,
           activity.draft_payload, activity.current_published_version_id,
           activity.archived_at
      FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin <> 'legacy_runtime';
$$;

CREATE OR REPLACE FUNCTION learning_activity_version_list(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid
)
RETURNS TABLE (
    activity_version_id uuid, version_number integer, kind varchar,
    result_mode varchar, max_points integer, policy_snapshot jsonb,
    quiz_version_id uuid, starter_project_version_id uuid,
    provenance jsonb, content_digest varchar, published_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT version.id, version.version_number, version.canonical_kind,
           version.result_mode, version.max_points, version.policy_snapshot,
           version.quiz_version_id, version.starter_project_version_id,
           version.provenance, version.content_digest, version.published_at
      FROM public.learning_activities activity
      JOIN public.learning_activity_versions version
        ON version.tenant_id = activity.tenant_id
       AND version.activity_id = activity.id
       AND version.canonical_contract_version = 1
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
       AND activity.reusable_authored_content = true
     ORDER BY version.version_number DESC;
$$;

REVOKE ALL ON FUNCTION learning_activity_snapshot_digest(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_normalize_draft(
    uuid, uuid, varchar, varchar, varchar, varchar, integer, jsonb,
    varchar, uuid, uuid, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_create(
    uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar,
    integer, jsonb, varchar, uuid, uuid, uuid, varchar
) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_draft_put(
    uuid, uuid, uuid, integer, varchar, varchar, varchar, integer, jsonb,
    varchar, uuid, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_publish(uuid, uuid, uuid, integer, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_list(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_get(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_version_list(uuid, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION learning_activity_create(
    uuid, uuid, varchar, varchar, varchar, varchar, varchar, varchar,
    integer, jsonb, varchar, uuid, uuid, uuid, varchar
) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_activity_draft_put(
    uuid, uuid, uuid, integer, varchar, varchar, varchar, integer, jsonb,
    varchar, uuid, uuid
) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_activity_publish(uuid, uuid, uuid, integer, varchar)
    TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_activity_list(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_activity_get(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_activity_version_list(uuid, uuid, uuid) TO asalab_app;

COMMENT ON COLUMN learning_activities.visibility_policy IS
    'Live root visibility. Changing it does not create a content version.';
COMMENT ON COLUMN learning_activity_versions.policy_snapshot IS
    'Immutable canonical runtime/pedagogical defaults for future ActivityRun pinning.';
COMMENT ON COLUMN learning_activity_versions.canonical_contract_version IS
    'NULL means historical/compatibility row; 1 means canonical M1 authoring contract.';
