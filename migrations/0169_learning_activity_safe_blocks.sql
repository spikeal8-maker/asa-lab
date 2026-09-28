-- A2c: safe ordered author blocks and immutable published task content.
-- Existing versions retain their original digest and legacy instructions.
CREATE FUNCTION public.learning_safe_task_blocks_valid(p_blocks jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_block jsonb; v_item jsonb; v_type text; v_text text;
BEGIN
    IF p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(p_blocks) > 32 THEN RETURN false; END IF;
    FOR v_block IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
        IF jsonb_typeof(v_block) <> 'object' THEN RETURN false; END IF;
        v_type := v_block ->> 'type';
        IF v_type IS NULL OR v_type NOT IN ('heading','paragraph','list','callout','link') THEN RETURN false; END IF;
        IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_block) AS fields(name)
                    WHERE fields.name NOT IN ('type','text','items','href')) THEN RETURN false; END IF;
        IF v_type = 'list' THEN
            IF v_block ? 'text' OR v_block ? 'href' OR NOT (v_block ? 'items')
               OR jsonb_typeof(v_block -> 'items') <> 'array' THEN RETURN false; END IF;
            IF jsonb_array_length(v_block -> 'items') NOT BETWEEN 1 AND 20 THEN RETURN false; END IF;
            FOR v_item IN SELECT value FROM jsonb_array_elements(v_block -> 'items') LOOP
                IF jsonb_typeof(v_item) <> 'string' OR length(trim(v_item #>> '{}')) NOT BETWEEN 1 AND 500
                   THEN RETURN false; END IF;
            END LOOP;
        ELSE
            IF v_block ? 'items' OR NOT (v_block ? 'text')
               OR jsonb_typeof(v_block -> 'text') <> 'string' THEN RETURN false; END IF;
            v_text := trim(v_block ->> 'text');
            IF length(v_text) < 1 THEN RETURN false; END IF;
            IF v_type IN ('heading','link') AND length(v_text) > 160 THEN RETURN false; END IF;
            IF v_type IN ('paragraph','callout') AND length(v_text) > 12000 THEN RETURN false; END IF;
            IF v_type = 'link' THEN
                IF NOT (v_block ? 'href') OR jsonb_typeof(v_block -> 'href') <> 'string'
                   OR length(v_block ->> 'href') > 2048
                   OR (v_block ->> 'href') !~* '^https?://[^[:space:]]+$' THEN RETURN false; END IF;
            ELSIF v_block ? 'href' THEN RETURN false;
            END IF;
        END IF;
    END LOOP;
    RETURN true;
END;
$$;

ALTER TABLE public.learning_activity_versions
    ADD COLUMN blocks jsonb,
    ADD COLUMN blocks_snapshot_present boolean NOT NULL DEFAULT false;
ALTER TABLE public.learning_activity_versions
    ADD CONSTRAINT learning_activity_versions_safe_blocks_check
    CHECK ((NOT blocks_snapshot_present AND blocks IS NULL)
        OR (blocks_snapshot_present AND public.learning_safe_task_blocks_valid(blocks)));
ALTER TABLE public.learning_activities
    ADD COLUMN creation_blocks_snapshot jsonb;
ALTER TABLE public.learning_activities
    ADD CONSTRAINT learning_activities_creation_blocks_check
    CHECK (creation_blocks_snapshot IS NULL OR public.learning_safe_task_blocks_valid(creation_blocks_snapshot));

-- Drafts keep the older Contents field separate from author blocks. At
-- publication and draft preview it becomes the first visible paragraph.
-- Historical versions still use this only as a read-time projection.
CREATE FUNCTION public.learning_activity_task_blocks(p_blocks jsonb, p_instructions varchar)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
    SELECT CASE WHEN length(trim(COALESCE(p_instructions,''))) > 0
                THEN jsonb_build_array(jsonb_build_object('type','paragraph','text',p_instructions))
                     || COALESCE(p_blocks,'[]'::jsonb)
                ELSE COALESCE(p_blocks,'[]'::jsonb) END;
$$;

-- Legacy draft writes preserve authored blocks when other fields change.
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
    p_starter_project_version_id uuid,
    p_goal jsonb
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
    IF p_goal IS NOT NULL AND
       (jsonb_typeof(p_goal) NOT IN ('string', 'null') OR
        length(trim(p_goal #>> '{}')) > 160) THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::integer;
        RETURN;
    END IF;
    IF p_goal IS NOT NULL THEN
        v_normalized.draft_payload := v_normalized.draft_payload ||
            jsonb_build_object('goal', NULLIF(trim(p_goal #>> '{}'), ''));
    ELSIF v_activity.draft_payload ? 'goal' THEN
        v_normalized.draft_payload := v_normalized.draft_payload ||
            jsonb_build_object('goal', v_activity.draft_payload -> 'goal');
    END IF;
    IF v_activity.draft_payload ? 'blocks' THEN
        v_normalized.draft_payload := v_normalized.draft_payload ||
            jsonb_build_object('blocks', v_activity.draft_payload -> 'blocks');
    END IF;
    IF NOT public.learning_safe_task_blocks_valid(public.learning_activity_task_blocks(
        v_normalized.draft_payload -> 'blocks',
        NULLIF(v_normalized.draft_payload ->> 'instructions','')::varchar
    )) THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::integer;
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


-- Every new publication includes blocks in its immutable digest.
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
    v_goal varchar;
    v_blocks jsonb;
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

    -- Pre-goal drafts can still be published. Freeze their teacher source goal
    -- once, at publication; an explicit null in a new draft stays null.
    v_goal := CASE WHEN v_activity.draft_payload ? 'goal'
        THEN NULLIF(v_activity.draft_payload ->> 'goal', '')
        ELSE (
            SELECT teacher.goal
              FROM public.teacher_assignments teacher
             WHERE teacher.tenant_id = p_tenant_id
               AND teacher.id = v_activity.source_teacher_assignment_id
        )
    END;

    v_blocks := public.learning_activity_task_blocks(
        v_activity.draft_payload -> 'blocks',
        NULLIF(v_activity.draft_payload ->> 'instructions','')::varchar);
    IF NOT public.learning_safe_task_blocks_valid(v_blocks) THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::uuid, NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    v_snapshot := jsonb_build_object(
        'activityId', v_activity.id,
        'versionNumber', v_number,
        'kind', v_activity.draft_payload ->> 'kind',
        'title', v_activity.draft_payload ->> 'title',
        'instructions', v_activity.draft_payload -> 'instructions',
        'goal', v_goal,
        'blocks', v_blocks,
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
            'sourceVersionId', v_activity.draft_base_version_id,
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
        canonical_contract_version, goal, goal_snapshot_present, blocks, blocks_snapshot_present
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
        p_request_id, p_principal_id, 1,
        v_goal, true, v_blocks, true
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
       SET current_published_version_id = v_id, draft_base_version_id = NULL
     WHERE id = p_activity_id;

    RETURN QUERY SELECT 'ok'::varchar, v_id, v_number, v_digest, false;
END;
$$;


-- Editing from an exact version copies the pinned blocks.
CREATE OR REPLACE FUNCTION learning_activity_draft_from_version(p_principal uuid,p_tenant uuid,p_activity uuid,p_version uuid,p_expected integer)
RETURNS TABLE(result_code varchar,draft_revision integer,source_version_number integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.learning_activities%ROWTYPE; v public.learning_activity_versions%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_activity::text,9001));
 SELECT * INTO a FROM public.learning_activities WHERE id=p_activity AND tenant_id=p_tenant
   AND owner_principal_id=p_principal AND reusable_authored_content AND archived_at IS NULL
   AND public.learning_author_can_use_tenant(p_principal,p_tenant) FOR UPDATE;
 IF a.id IS NULL THEN RETURN QUERY SELECT 'activity_not_found'::varchar,NULL::integer,NULL::integer; RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.learning_activity_versions WHERE id=a.current_published_version_id
   AND source_draft_revision=a.draft_revision) THEN
   RETURN QUERY SELECT 'draft_exists'::varchar,a.draft_revision,NULL::integer; RETURN;
 END IF;
 IF a.draft_revision IS DISTINCT FROM p_expected THEN RETURN QUERY SELECT 'revision_conflict'::varchar,a.draft_revision,NULL::integer; RETURN; END IF;
 SELECT * INTO v FROM public.learning_activity_versions WHERE id=p_version AND activity_id=a.id AND canonical_contract_version=1;
 IF v.id IS NULL THEN RETURN QUERY SELECT 'version_not_found'::varchar,a.draft_revision,NULL::integer; RETURN; END IF;
 UPDATE public.learning_activities SET title=v.title,draft_revision=a.draft_revision+1,draft_base_version_id=v.id,
   draft_payload=jsonb_build_object('kind',v.canonical_kind,'title',v.title,'instructions',v.instructions,
     'goal',CASE WHEN v.goal_snapshot_present THEN v.goal ELSE NULL END,
     'resultMode',v.result_mode,'maxPoints',v.max_points,'policies',v.policy_snapshot,'moduleKey',v.module_key,
     'quizVersionId',v.quiz_version_id,'starterProjectVersionId',v.starter_project_version_id,
     'blocks', CASE WHEN v.blocks_snapshot_present THEN
         CASE WHEN v.instructions IS NOT NULL AND jsonb_array_length(v.blocks)>0
                    AND v.blocks -> 0 = jsonb_build_object('type','paragraph','text',v.instructions)
              THEN v.blocks - 0 ELSE v.blocks END
         ELSE '[]'::jsonb END)
 WHERE id=a.id;
 RETURN QUERY SELECT 'ok'::varchar,a.draft_revision+1,v.version_number;
END;
$$;


-- Existing project authorization continues to protect this exact-version context.
CREATE OR REPLACE FUNCTION learning_work_context_for_project(
    p_viewer_principal_id uuid, p_project_id uuid
)
RETURNS TABLE (context jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT jsonb_build_object(
        'projectId', work.project_id,
        'seatId', seat.id,
        'classroomAssignmentId', assignment.id,
        'activityRunId', run.id,
        'participationId', participation.id,
        'learningActivityVersionId', version.id,
        'assignmentVersionId', assignment.learning_activity_version_id,
        'runVersionId', run.learning_activity_version_id,
        'versionNumber', version.version_number,
        'contentDigest', version.content_digest,
        'sourceKind', CASE WHEN assignment.course_run_id IS NULL THEN 'direct' ELSE 'course' END,
        'courseRunId', course.id,
        'courseLessonId', lesson.id,
        'courseBlockId', run.source_course_block_id,
        'title', COALESCE(version.title, lesson.assignment_title, teacher.title),
        'brief', CASE WHEN run.source_course_block_id IS NOT NULL THEN version.instructions
                      ELSE COALESCE(version.instructions, lesson.assignment_brief, teacher.brief) END,
        'blocks', CASE WHEN version.blocks_snapshot_present
                         AND (assignment.course_run_id IS NULL OR cardinality.exact_run)
                       THEN version.blocks ELSE NULL END,
        'blocksSnapshotPresent', version.blocks_snapshot_present
                                 AND (assignment.course_run_id IS NULL OR cardinality.exact_run),
        'goal', CASE WHEN version.goal_snapshot_present THEN version.goal
                     WHEN run.source_course_block_id IS NOT NULL THEN NULL
                     ELSE COALESCE(lesson.assignment_goal, teacher.goal) END,
        'moduleKey', CASE WHEN run.source_course_block_id IS NOT NULL THEN version.module_key
                         ELSE COALESCE(version.module_key, lesson.module_key, teacher.module_key) END,
        'sampleImage', CASE
            WHEN run.source_course_block_id IS NOT NULL THEN NULL
            WHEN assignment.course_run_id IS NULL
                 AND assignment.learning_activity_version_id = version.id
                 AND version.canonical_contract_version = 1
                 AND EXISTS (
                    SELECT 1 FROM public.learning_activity_version_media media
                     WHERE media.activity_version_id = version.id AND media.role = 'sample'
                )
                THEN '/api/assignments/activity-versions/' || version.id::text || '/sample'
            WHEN assignment.course_run_id IS NULL
                 AND assignment.learning_activity_version_id IS NOT NULL THEN NULL
            WHEN run.source_course_block_id IS NULL AND course_media.version_id IS NOT NULL
                THEN '/api/class-join/course-runs/' || course.id::text || '/lessons/' || lesson.source_lesson_id::text || '/sample'
            WHEN assignment.course_run_id IS NOT NULL THEN lesson.static_sample_image
            ELSE teacher.sample_image
        END,
        'dueAt', assignment.due_at,
        'assignmentStatus', assignment.status,
        'runStatus', run.lifecycle_status,
        'courseStatus', course.status,
        'classroomStatus', classroom.status,
        'seatStatus', seat.status,
        'participationStatus', participation.status,
        'participationExcused', participation.excused,
        'effectiveConditions', CASE WHEN run.id IS NULL THEN NULL
            ELSE public.learning_effective_conditions_internal(run.id, participation.id) END,
        'submittedAt', work.submitted_at,
        'snapshotRevision', snapshot.source_revision,
        'updatedAt', draft.updated_at,
        'attemptId', attempt.id,
        'attemptNumber', attempt.attempt_number,
        'submissionId', submission.id,
        'submittedProjectVersionId', submission.project_version_id,
        'classroomTitle', classroom.title,
        'courseTitle', course.title,
        'lessonTitle', lesson.title
    )
      FROM public.classroom_assignment_work work
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id = work.tenant_id AND assignment.id = work.assignment_id
      JOIN public.classrooms classroom
        ON classroom.tenant_id = assignment.tenant_id AND classroom.id = assignment.classroom_id
      JOIN public.classroom_student_seats seat
        ON seat.id = work.seat_id AND seat.classroom_id = assignment.classroom_id
      JOIN public.principals viewer ON viewer.id = p_viewer_principal_id
      LEFT JOIN public.teacher_assignments teacher ON teacher.id = assignment.assignment_id
      LEFT JOIN public.classroom_course_runs course ON course.id = assignment.course_run_id
      LEFT JOIN public.activity_runs run
        ON run.source_classroom_assignment_id = assignment.id
      LEFT JOIN LATERAL (
          SELECT count(*) = 1 AS exact_run FROM public.activity_runs sibling
           WHERE sibling.tenant_id = assignment.tenant_id
             AND sibling.source_classroom_assignment_id = assignment.id
      ) cardinality ON true
      LEFT JOIN public.classroom_course_run_lessons lesson
        ON lesson.run_id = assignment.course_run_id
       AND ((run.id IS NOT NULL AND lesson.id = run.source_course_lesson_id)
            OR (run.id IS NULL AND lesson.classroom_assignment_id = assignment.id))
      LEFT JOIN public.course_version_media course_media
        ON course_media.version_id = course.course_version_id
       AND course_media.source_lesson_id = lesson.source_lesson_id
      LEFT JOIN public.learner_identity_links link
        ON link.tenant_id = assignment.tenant_id
       AND link.school_id = classroom.school_id
       AND link.seat_id = seat.id AND link.status = 'active'
       AND link.link_kind = 'student_seat'
      LEFT JOIN public.activity_participations participation
        ON participation.activity_run_id = run.id
       AND participation.learner_identity_id = link.learner_identity_id
      LEFT JOIN public.classroom_activity_versions compatibility
        ON compatibility.classroom_assignment_id = assignment.id
      LEFT JOIN public.learning_activity_versions version
        ON version.id = COALESCE(run.learning_activity_version_id,
                                 assignment.learning_activity_version_id,
                                 compatibility.learning_activity_version_id)
      LEFT JOIN public.project_drafts draft ON draft.project_id = work.project_id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = work.project_id
      LEFT JOIN LATERAL (
          SELECT item.* FROM public.learning_attempts item
           WHERE item.classroom_assignment_id = assignment.id AND item.seat_id = seat.id
           ORDER BY item.attempt_number DESC, item.id DESC LIMIT 1
      ) attempt ON true
      LEFT JOIN public.learning_submissions submission ON submission.attempt_id = attempt.id
     WHERE work.project_id = p_project_id
       AND ((viewer.kind = 'student_seat' AND viewer.seat_id = seat.id)
            OR (viewer.kind = 'account' AND viewer.account_id = seat.account_id))
       AND EXISTS (
           SELECT 1 FROM public.project_context_for_principal(p_viewer_principal_id, p_project_id)
       );
$$;

-- The last JSON argument is absent (SQL NULL) or an explicit safe array.
-- The old 13-argument signature above retains the stored block key.
CREATE FUNCTION public.learning_activity_draft_put(
    p_principal_id uuid, p_tenant_id uuid, p_activity_id uuid,
    p_expected_revision integer, p_title varchar, p_instructions varchar,
    p_result_mode varchar, p_max_points integer, p_policy_snapshot jsonb,
    p_module_key varchar, p_quiz_version_id uuid,
    p_starter_project_version_id uuid, p_goal jsonb, p_blocks jsonb
)
RETURNS TABLE (result_code varchar, draft_revision integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_result record;
BEGIN
    IF p_blocks IS NOT NULL AND (
        NOT public.learning_safe_task_blocks_valid(p_blocks) OR
        NOT public.learning_safe_task_blocks_valid(
            public.learning_activity_task_blocks(p_blocks,p_instructions))
    ) THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::integer; RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_activity_id::text, 9001));
    SELECT * INTO v_result FROM public.learning_activity_draft_put(
        p_principal_id,p_tenant_id,p_activity_id,p_expected_revision,
        p_title,p_instructions,p_result_mode,p_max_points,p_policy_snapshot,
        p_module_key,p_quiz_version_id,p_starter_project_version_id,p_goal
    );
    IF v_result.result_code = 'ok' AND p_blocks IS NOT NULL THEN
        UPDATE public.learning_activities AS activity
           SET draft_payload = activity.draft_payload || jsonb_build_object('blocks',p_blocks)
         WHERE activity.id=p_activity_id AND activity.tenant_id=p_tenant_id
           AND activity.owner_principal_id=p_principal_id
           AND activity.draft_revision=v_result.draft_revision;
    END IF;
    RETURN QUERY SELECT v_result.result_code::varchar,v_result.draft_revision;
END;
$$;

-- Lock with the same creation key before checking a receipt so a concurrent
-- request cannot silently attach different blocks to an existing activity.
CREATE FUNCTION public.learning_activity_create(
    p_principal_id uuid,p_tenant_id uuid,p_scope_kind varchar,
    p_visibility_policy varchar,p_kind varchar,p_title varchar,
    p_instructions varchar,p_result_mode varchar,p_max_points integer,
    p_policy_snapshot jsonb,p_module_key varchar,p_quiz_version_id uuid,
    p_starter_project_version_id uuid,p_source_teacher_assignment_id uuid,
    p_request_id varchar,p_goal jsonb,p_blocks jsonb
)
RETURNS TABLE (result_code varchar,activity_id uuid,draft_revision integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_existing uuid; v_result record; v_stored jsonb;
BEGIN
    IF p_blocks IS NOT NULL AND (
        NOT public.learning_safe_task_blocks_valid(p_blocks) OR
        NOT public.learning_safe_task_blocks_valid(
            public.learning_activity_task_blocks(p_blocks,p_instructions))
    ) THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar,NULL::uuid,NULL::integer; RETURN;
    END IF;
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request_id'::varchar,NULL::uuid,NULL::integer; RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
        COALESCE(p_source_teacher_assignment_id::text,
                 p_tenant_id::text || ':' || p_principal_id::text || ':' || p_request_id),9000));
    SELECT id INTO v_existing FROM public.learning_activities
     WHERE tenant_id=p_tenant_id AND owner_principal_id=p_principal_id
       AND creation_request_id=p_request_id;
    IF v_existing IS NULL AND p_source_teacher_assignment_id IS NOT NULL THEN
        SELECT id INTO v_existing FROM public.learning_activities
         WHERE source_teacher_assignment_id=p_source_teacher_assignment_id;
    END IF;
    SELECT * INTO v_result FROM public.learning_activity_create(
        p_principal_id,p_tenant_id,p_scope_kind,p_visibility_policy,p_kind,
        p_title,p_instructions,p_result_mode,p_max_points,p_policy_snapshot,
        p_module_key,p_quiz_version_id,p_starter_project_version_id,
        p_source_teacher_assignment_id,p_request_id,p_goal
    );
    IF v_result.result_code <> 'ok' THEN
        RETURN QUERY SELECT v_result.result_code::varchar,v_result.activity_id,v_result.draft_revision;
        RETURN;
    END IF;
    SELECT creation_blocks_snapshot INTO v_stored
      FROM public.learning_activities WHERE id=v_result.activity_id;
    IF v_existing IS NOT NULL THEN
        IF v_stored IS DISTINCT FROM p_blocks THEN
            RETURN QUERY SELECT 'idempotency_conflict'::varchar,NULL::uuid,NULL::integer;
            RETURN;
        END IF;
    ELSIF p_blocks IS NOT NULL THEN
        UPDATE public.learning_activities AS activity
           SET draft_payload=activity.draft_payload || jsonb_build_object('blocks',p_blocks),
                creation_blocks_snapshot=p_blocks
          WHERE activity.id=v_result.activity_id AND activity.tenant_id=p_tenant_id
            AND activity.owner_principal_id=p_principal_id AND activity.draft_revision=1;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar,v_result.activity_id,v_result.draft_revision;
END;
$$;

-- The author-only existing preview validates ownership, exact source and
-- draft revision. Reuse it before reading a block payload.
CREATE FUNCTION public.learning_activity_blocks_preview_as_author(
    p_principal uuid,p_tenant uuid,p_activity uuid,p_source varchar,
    p_version uuid,p_revision integer
)
RETURNS TABLE (result_code varchar,blocks jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_preview record; v_payload jsonb;
BEGIN
    SELECT * INTO v_preview FROM public.learning_activity_preview_with_goal_as_author(
        p_principal,p_tenant,p_activity,p_source,p_version,p_revision);
    IF v_preview.result_code IS DISTINCT FROM 'ok' THEN
        RETURN QUERY SELECT COALESCE(v_preview.result_code,'preview_failed')::varchar,NULL::jsonb; RETURN;
    END IF;
    IF p_source='draft' THEN
        SELECT draft_payload INTO v_payload FROM public.learning_activities
         WHERE id=p_activity AND tenant_id=p_tenant AND owner_principal_id=p_principal
           AND draft_revision=p_revision;
        IF v_payload IS NULL THEN
            RETURN QUERY SELECT 'revision_conflict'::varchar,NULL::jsonb; RETURN;
        END IF;
        RETURN QUERY SELECT 'ok'::varchar,
          public.learning_activity_task_blocks(v_payload -> 'blocks',
            NULLIF(v_payload ->> 'instructions','')::varchar); RETURN;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar,
      CASE WHEN version.blocks_snapshot_present THEN version.blocks
           ELSE public.learning_activity_task_blocks(NULL,version.instructions) END
      FROM public.learning_activity_versions version
      WHERE version.id=p_version AND version.activity_id=p_activity AND version.tenant_id=p_tenant;
END;
$$;

-- Course occurrences pass their exact ActivityRun. A handout can own sibling
-- runs, and its work row cannot prove which sibling the learner started.
CREATE FUNCTION public.learning_activity_blocks_for_seat(
    p_seat uuid,p_assignment uuid,p_activity_run uuid
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT CASE WHEN version.canonical_contract_version=1 THEN jsonb_build_object(
        'present',true,'blocks',CASE WHEN
            (assignment.course_run_id IS NULL AND work.project_id IS NOT NULL)
            OR (assignment.course_run_id IS NOT NULL AND work.project_id IS NOT NULL
                AND cardinality.exact_run)
            OR EXISTS (
            SELECT 1 FROM public.learner_identity_links link
            JOIN public.activity_participations participation
              ON participation.tenant_id=runtime.tenant_id AND participation.school_id=runtime.school_id
             AND participation.activity_run_id=runtime.id
             AND participation.learner_identity_id=link.learner_identity_id
           WHERE runtime.id IS NOT NULL
             AND link.tenant_id=runtime.tenant_id AND link.school_id=runtime.school_id
             AND link.seat_id=seat.id AND link.link_kind='student_seat' AND link.status='active'
             AND runtime.lifecycle_status='active' AND classroom.status='active'
             AND assignment.status='open' AND participation.status IN ('assigned','active')
             AND ((runtime.source_kind='direct'
                   AND public.learning_direct_assignment_seat_visible(seat.id,assignment.id))
               OR (runtime.source_kind='course'
                   AND public.learning_course_seat_visible(seat.id,runtime.source_course_run_id)
                   AND EXISTS (SELECT 1 FROM public.classroom_course_runs course
                        WHERE course.id=runtime.source_course_run_id AND course.status='open')
                   AND (participation.source_course_enrollment_id IS NULL OR EXISTS (
                      SELECT 1 FROM public.course_enrollments enrollment
                       WHERE enrollment.id=participation.source_course_enrollment_id
                         AND enrollment.status IN ('assigned','active')))))
             AND COALESCE((public.learning_effective_conditions_internal(
                 runtime.id,participation.id)#>>'{values,opensAt}')::timestamptz,
                 '-infinity'::timestamptz) <= now()
        ) THEN CASE WHEN version.blocks_snapshot_present THEN version.blocks
                    ELSE public.learning_activity_task_blocks(NULL,version.instructions) END
          ELSE NULL END)
      ELSE NULL END
    FROM public.classroom_student_seats seat
    JOIN public.classrooms classroom ON classroom.id=seat.classroom_id
       AND classroom.tenant_id=seat.tenant_id
    JOIN public.classroom_assignments assignment
      ON assignment.id=p_assignment AND assignment.tenant_id=seat.tenant_id
     AND assignment.classroom_id=seat.classroom_id
    LEFT JOIN LATERAL (
        SELECT candidate.* FROM public.activity_runs candidate
         WHERE candidate.tenant_id=assignment.tenant_id
           AND candidate.source_classroom_assignment_id=assignment.id
           AND ((assignment.course_run_id IS NULL AND p_activity_run IS NULL
                 AND candidate.source_kind='direct')
             OR (assignment.course_run_id IS NOT NULL
                 AND candidate.id=p_activity_run
                 AND candidate.source_kind='course'
                 AND candidate.source_course_run_id=assignment.course_run_id))
         ORDER BY candidate.id LIMIT 1
    ) runtime ON true
    LEFT JOIN LATERAL (
        SELECT count(*) = 1 AS exact_run FROM public.activity_runs sibling
         WHERE sibling.tenant_id = assignment.tenant_id
           AND sibling.source_classroom_assignment_id = assignment.id
    ) cardinality ON true
    JOIN public.learning_activity_versions version
      ON version.id=COALESCE(runtime.learning_activity_version_id,
                             assignment.learning_activity_version_id)
     AND version.tenant_id=assignment.tenant_id
    LEFT JOIN public.classroom_assignment_work work
      ON work.assignment_id=assignment.id AND work.seat_id=seat.id
    WHERE seat.id=p_seat AND seat.status='active'
      AND ((assignment.course_run_id IS NULL AND p_activity_run IS NULL)
        OR (assignment.course_run_id IS NOT NULL AND runtime.id=p_activity_run))
      AND (assignment.status='open' OR work.project_id IS NOT NULL);
$$;

-- Only direct assignments have a unique version without an ActivityRun key.
CREATE FUNCTION public.learning_activity_blocks_for_seat(p_seat uuid,p_assignment uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.learning_activity_blocks_for_seat(p_seat,p_assignment,NULL::uuid);
$$;

REVOKE ALL ON FUNCTION public.learning_safe_task_blocks_valid(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_activity_task_blocks(jsonb,varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_activity_draft_put(uuid,uuid,uuid,integer,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_activity_create(uuid,uuid,varchar,varchar,varchar,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,uuid,varchar,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_activity_blocks_preview_as_author(uuid,uuid,uuid,varchar,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_activity_blocks_for_seat(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.learning_activity_blocks_for_seat(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_activity_draft_put(uuid,uuid,uuid,integer,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,jsonb,jsonb) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.learning_activity_create(uuid,uuid,varchar,varchar,varchar,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,uuid,varchar,jsonb,jsonb) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.learning_activity_blocks_preview_as_author(uuid,uuid,uuid,varchar,uuid,integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.learning_activity_blocks_for_seat(uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.learning_activity_blocks_for_seat(uuid,uuid,uuid) TO asalab_app;
