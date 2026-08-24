-- Owner-only additive convergence procedures for ASA Learning M0.
--
-- Nothing in this migration invokes the procedures. Applying the schema is
-- not a backfill. The explicit test-only tool calls these functions after the
-- read-only M0-005 preflight has completed.

CREATE OR REPLACE FUNCTION learning_m0_deterministic_uuid(p_value text)
RETURNS uuid
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_hex text;
BEGIN
    v_hex := encode(public.digest(convert_to('asa-learning-m0-006:' || p_value, 'UTF8'), 'sha256'), 'hex');
    v_hex := substr(v_hex, 1, 12) || '5' || substr(v_hex, 14, 3)
          || 'a' || substr(v_hex, 18, 15);
    RETURN (
        substr(v_hex, 1, 8) || '-' || substr(v_hex, 9, 4) || '-'
        || substr(v_hex, 13, 4) || '-' || substr(v_hex, 17, 4) || '-'
        || substr(v_hex, 21, 12)
    )::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION learning_m0_convergence_apply(
    p_batch_key varchar,
    p_school_id uuid,
    p_source_snapshot_digest varchar,
    p_as_of timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_batch uuid;
    v_existing record;
    v_created_identities integer := 0;
    v_created_seat_links integer := 0;
    v_created_account_links integer := 0;
    v_created_activities integer := 0;
    v_created_versions integer := 0;
    v_created_mappings integer := 0;
    v_created_attempts integer := 0;
    v_created_submissions integer := 0;
    v_exact_existing integer := 0;
    v_unresolved integer := 0;
    v_feedback integer := 0;
    v_row record;
    v_attempt uuid;
    v_submission uuid;
    v_learner uuid;
    v_activity_version uuid;
    v_project_version uuid;
    v_digest varchar;
BEGIN
    IF p_batch_key IS NULL OR length(trim(p_batch_key)) NOT BETWEEN 8 AND 160 THEN
        RAISE EXCEPTION 'invalid learning migration batch key';
    END IF;
    IF p_source_snapshot_digest IS NULL
       OR p_source_snapshot_digest !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'invalid learning migration source digest';
    END IF;
    IF p_as_of IS NULL THEN
        RAISE EXCEPTION 'explicit asOf is required';
    END IF;

    SELECT school.tenant_id INTO v_tenant
      FROM public.schools school WHERE school.id = p_school_id;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'school not found';
    END IF;
    PERFORM set_config('app.tenant_id', v_tenant::text, true);
    PERFORM pg_advisory_xact_lock(hashtextextended(p_school_id::text || ':' || p_batch_key, 0));
    v_batch := public.learning_m0_deterministic_uuid(
        'batch:' || v_tenant || ':' || p_school_id || ':' || p_batch_key
    );

    SELECT * INTO v_existing
      FROM public.learning_migration_batches batch
     WHERE batch.tenant_id = v_tenant
       AND batch.school_id = p_school_id
       AND batch.batch_key = p_batch_key
     FOR UPDATE;
    IF v_existing.id IS NOT NULL AND (
        v_existing.id <> v_batch
        OR v_existing.source_snapshot_digest <> p_source_snapshot_digest
        OR v_existing.as_of <> p_as_of
    ) THEN
        RAISE EXCEPTION 'batch key already belongs to a different source snapshot';
    END IF;

    INSERT INTO public.learning_migration_batches (
        id, tenant_id, school_id, batch_key, operation_kind, mode, state,
        source_snapshot_digest, as_of
    ) VALUES (
        v_batch, v_tenant, p_school_id, trim(p_batch_key),
        'm0_identity_activity_convergence', 'automatic', 'active',
        p_source_snapshot_digest, p_as_of
    ) ON CONFLICT (tenant_id, school_id, batch_key) DO UPDATE
       SET state = 'active', disabled_at = NULL, completed_at = NULL;

    UPDATE public.learning_migration_artifacts
       SET disabled_at = NULL
     WHERE batch_id = v_batch AND disabled_at IS NOT NULL;

    UPDATE public.learner_identities
       SET state = 'active'
     WHERE created_by_batch_id = v_batch AND state = 'inactive';
    UPDATE public.learner_identity_links
       SET status = 'active', disabled_at = NULL
     WHERE created_by_batch_id = v_batch AND status = 'inactive';

    -- Resolve one learner for an Account within one school. Existing persisted
    -- links win. Several different existing learner links are ambiguity and do
    -- not get silently merged.
    WITH scoped_seats AS (
        SELECT seat.id AS seat_id, seat.account_id
          FROM public.classroom_student_seats seat
          JOIN public.classrooms classroom
            ON classroom.tenant_id = seat.tenant_id
           AND classroom.id = seat.classroom_id
         WHERE seat.tenant_id = v_tenant
           AND classroom.school_id = p_school_id
    ), account_resolution AS (
        SELECT scoped.account_id,
               count(DISTINCT existing_seat.learner_identity_id)
                   FILTER (WHERE existing_seat.learner_identity_id IS NOT NULL) AS existing_count,
               COALESCE(
                   max(existing_account.learner_identity_id::text)::uuid,
                   CASE WHEN count(DISTINCT existing_seat.learner_identity_id)
                                  FILTER (WHERE existing_seat.learner_identity_id IS NOT NULL) <= 1
                        THEN max(existing_seat.learner_identity_id::text)::uuid END,
                   public.learning_m0_deterministic_uuid(
                       'learner:' || p_school_id || ':account:' || scoped.account_id
                   )
               ) AS learner_id
          FROM scoped_seats scoped
          LEFT JOIN public.learner_identity_links existing_account
            ON existing_account.school_id = p_school_id
           AND existing_account.account_id = scoped.account_id
          LEFT JOIN public.learner_identity_links existing_seat
            ON existing_seat.seat_id = scoped.seat_id
         WHERE scoped.account_id IS NOT NULL
         GROUP BY scoped.account_id
    ), resolved AS (
        SELECT scoped.seat_id, scoped.account_id,
               COALESCE(
                   existing_seat.learner_identity_id,
                   CASE WHEN account.existing_count <= 1 THEN account.learner_id END,
                   public.learning_m0_deterministic_uuid(
                       'learner:' || p_school_id || ':seat:' || scoped.seat_id
                   )
               ) AS learner_id
          FROM scoped_seats scoped
          LEFT JOIN account_resolution account ON account.account_id = scoped.account_id
          LEFT JOIN public.learner_identity_links existing_seat
            ON existing_seat.seat_id = scoped.seat_id
    )
    INSERT INTO public.learner_identities (
        id, tenant_id, school_id, state, created_by_batch_id
    )
    SELECT DISTINCT resolved.learner_id, v_tenant, p_school_id, 'active', v_batch
      FROM resolved
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_created_identities = ROW_COUNT;

    WITH scoped_seats AS (
        SELECT seat.id AS seat_id, seat.account_id
          FROM public.classroom_student_seats seat
          JOIN public.classrooms classroom
            ON classroom.tenant_id = seat.tenant_id
           AND classroom.id = seat.classroom_id
         WHERE seat.tenant_id = v_tenant
           AND classroom.school_id = p_school_id
    ), account_resolution AS (
        SELECT scoped.account_id,
               count(DISTINCT existing_seat.learner_identity_id)
                   FILTER (WHERE existing_seat.learner_identity_id IS NOT NULL) AS existing_count,
               COALESCE(
                   max(existing_account.learner_identity_id::text)::uuid,
                   CASE WHEN count(DISTINCT existing_seat.learner_identity_id)
                                  FILTER (WHERE existing_seat.learner_identity_id IS NOT NULL) <= 1
                        THEN max(existing_seat.learner_identity_id::text)::uuid END,
                   public.learning_m0_deterministic_uuid(
                       'learner:' || p_school_id || ':account:' || scoped.account_id
                   )
               ) AS learner_id
          FROM scoped_seats scoped
          LEFT JOIN public.learner_identity_links existing_account
            ON existing_account.school_id = p_school_id
           AND existing_account.account_id = scoped.account_id
          LEFT JOIN public.learner_identity_links existing_seat
            ON existing_seat.seat_id = scoped.seat_id
         WHERE scoped.account_id IS NOT NULL
         GROUP BY scoped.account_id
    ), resolved AS (
        SELECT scoped.seat_id, scoped.account_id,
               COALESCE(
                   existing_seat.learner_identity_id,
                   CASE WHEN account.existing_count <= 1 THEN account.learner_id END,
                   public.learning_m0_deterministic_uuid(
                       'learner:' || p_school_id || ':seat:' || scoped.seat_id
                   )
               ) AS learner_id
          FROM scoped_seats scoped
          LEFT JOIN account_resolution account ON account.account_id = scoped.account_id
          LEFT JOIN public.learner_identity_links existing_seat
            ON existing_seat.seat_id = scoped.seat_id
    )
    INSERT INTO public.learner_identity_links (
        id, tenant_id, school_id, learner_identity_id, link_kind,
        seat_id, account_id, status, created_by_batch_id
    )
    SELECT public.learning_m0_deterministic_uuid('seat-link:' || resolved.seat_id),
           v_tenant, p_school_id, resolved.learner_id, 'student_seat',
           resolved.seat_id, NULL, 'active', v_batch
      FROM resolved
    ON CONFLICT (seat_id) WHERE seat_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_created_seat_links = ROW_COUNT;

    WITH scoped_accounts AS (
        SELECT seat.account_id,
               count(DISTINCT link.learner_identity_id) AS learner_count,
               min(link.learner_identity_id::text)::uuid AS learner_id,
               min(seat.id::text)::uuid AS source_seat_id
          FROM public.classroom_student_seats seat
          JOIN public.classrooms classroom
            ON classroom.tenant_id = seat.tenant_id
           AND classroom.id = seat.classroom_id
          JOIN public.learner_identity_links link ON link.seat_id = seat.id
         WHERE seat.tenant_id = v_tenant
           AND classroom.school_id = p_school_id
           AND seat.account_id IS NOT NULL
         GROUP BY seat.account_id
    )
    INSERT INTO public.learner_identity_links (
        id, tenant_id, school_id, learner_identity_id, link_kind,
        seat_id, account_id, status, created_by_batch_id
    )
    SELECT public.learning_m0_deterministic_uuid(
               'account-link:' || p_school_id || ':' || scoped.account_id
           ),
           v_tenant, p_school_id, scoped.learner_id, 'account',
           NULL, scoped.account_id, 'active', v_batch
      FROM scoped_accounts scoped
     WHERE scoped.learner_count = 1
    ON CONFLICT (school_id, account_id) WHERE account_id IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_created_account_links = ROW_COUNT;

    -- Persistent provenance for identity rows and links. Re-runs reactivate the
    -- same deterministic artifact record and never duplicate it.
    INSERT INTO public.learning_migration_artifacts (
        id, tenant_id, school_id, batch_id, artifact_kind, artifact_id,
        source_table, source_id, operation_type, operation_mode, source_evidence
    )
    SELECT public.learning_m0_deterministic_uuid(
               'artifact:' || v_batch || ':learner:' || link.seat_id
           ),
           v_tenant, p_school_id, v_batch, 'learner_identity',
           link.learner_identity_id, 'classroom_student_seats', link.seat_id,
           'seed_or_reuse_learner', 'automatic',
           jsonb_build_object('seatId', link.seat_id, 'schoolId', p_school_id)
      FROM public.learner_identity_links link
     WHERE link.school_id = p_school_id AND link.seat_id IS NOT NULL
    ON CONFLICT (batch_id, artifact_kind, source_table, source_id, operation_type)
    DO UPDATE SET disabled_at = NULL;

    INSERT INTO public.learning_migration_artifacts (
        id, tenant_id, school_id, batch_id, artifact_kind, artifact_id,
        source_table, source_id, operation_type, operation_mode, source_evidence
    )
    SELECT public.learning_m0_deterministic_uuid(
               'artifact:' || v_batch || ':seat-link:' || link.seat_id
           ),
           v_tenant, p_school_id, v_batch, 'identity_link', link.id,
           'classroom_student_seats', link.seat_id, 'link_student_seat', 'automatic',
           jsonb_build_object('seatId', link.seat_id, 'learnerId', link.learner_identity_id)
      FROM public.learner_identity_links link
     WHERE link.school_id = p_school_id AND link.seat_id IS NOT NULL
    ON CONFLICT (batch_id, artifact_kind, source_table, source_id, operation_type)
    DO UPDATE SET disabled_at = NULL;

    INSERT INTO public.learning_migration_artifacts (
        id, tenant_id, school_id, batch_id, artifact_kind, artifact_id,
        source_table, source_id, operation_type, operation_mode, source_evidence
    )
    SELECT public.learning_m0_deterministic_uuid(
               'artifact:' || v_batch || ':account-link:' || link.account_id
           ),
           v_tenant, p_school_id, v_batch, 'identity_link', link.id,
           'accounts', link.account_id, 'link_verified_account', 'automatic',
           jsonb_build_object('accountId', link.account_id, 'learnerId', link.learner_identity_id)
      FROM public.learner_identity_links link
     WHERE link.school_id = p_school_id AND link.account_id IS NOT NULL
    ON CONFLICT (batch_id, artifact_kind, source_table, source_id, operation_type)
    DO UPDATE SET disabled_at = NULL;

    -- Map persisted project assignments to one immutable ActivityVersion. This
    -- never creates learner Attempts for assigned/not_started units.
    WITH sources AS (
        SELECT assignment.id AS assignment_id, assignment.tenant_id,
               COALESCE(task.owner_principal_id, run.assigned_by_principal_id) AS owner_principal_id,
               COALESCE(task.title, lesson.assignment_title) AS title,
               COALESCE(task.brief, lesson.assignment_brief) AS instructions,
               COALESCE(task.module_key, lesson.module_key) AS module_key,
               assignment.created_at
          FROM public.classroom_assignments assignment
          JOIN public.classrooms classroom
            ON classroom.tenant_id = assignment.tenant_id
           AND classroom.id = assignment.classroom_id
          LEFT JOIN public.teacher_assignments task ON task.id = assignment.assignment_id
          LEFT JOIN public.classroom_course_run_lessons lesson
            ON lesson.classroom_assignment_id = assignment.id
          LEFT JOIN public.classroom_course_runs run ON run.id = lesson.run_id
         WHERE assignment.tenant_id = v_tenant
           AND classroom.school_id = p_school_id
           AND assignment.quiz_version_id IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM public.classroom_activity_versions mapping
                WHERE mapping.classroom_assignment_id = assignment.id
           )
           AND COALESCE(task.module_key, lesson.module_key) IS NOT NULL
           AND COALESCE(task.owner_principal_id, run.assigned_by_principal_id) IS NOT NULL
    )
    INSERT INTO public.learning_activities (
        id, tenant_id, owner_principal_id, scope_kind, activity_type, title, created_at
    )
    SELECT public.learning_m0_deterministic_uuid('activity:assignment:' || source.assignment_id),
           source.tenant_id, source.owner_principal_id, 'school', 'project',
           source.title, source.created_at
      FROM sources source
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_created_activities = ROW_COUNT;

    WITH sources AS (
        SELECT assignment.id AS assignment_id, assignment.tenant_id,
               COALESCE(task.title, lesson.assignment_title) AS title,
               COALESCE(task.brief, lesson.assignment_brief) AS instructions,
               COALESCE(task.module_key, lesson.module_key) AS module_key,
               assignment.created_at
          FROM public.classroom_assignments assignment
          JOIN public.classrooms classroom
            ON classroom.tenant_id = assignment.tenant_id
           AND classroom.id = assignment.classroom_id
          LEFT JOIN public.teacher_assignments task ON task.id = assignment.assignment_id
          LEFT JOIN public.classroom_course_run_lessons lesson
            ON lesson.classroom_assignment_id = assignment.id
         WHERE assignment.tenant_id = v_tenant
           AND classroom.school_id = p_school_id
           AND assignment.quiz_version_id IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM public.classroom_activity_versions mapping
                WHERE mapping.classroom_assignment_id = assignment.id
           )
           AND COALESCE(task.module_key, lesson.module_key) IS NOT NULL
    )
    INSERT INTO public.learning_activity_versions (
        id, tenant_id, activity_id, version_number, title, instructions,
        activity_type, module_key, max_points, scoring_policy, content_digest,
        published_at
    )
    SELECT public.learning_m0_deterministic_uuid('activity-version:assignment:' || source.assignment_id),
           source.tenant_id,
           public.learning_m0_deterministic_uuid('activity:assignment:' || source.assignment_id),
           1, source.title, source.instructions, 'project', source.module_key, 100,
           '{"kind":"manual","scale":"integer","passThreshold":60}'::jsonb,
           encode(public.digest(convert_to(concat_ws(E'\n', source.title,
               source.instructions, source.module_key, '100'), 'UTF8'), 'sha256'), 'hex'),
           source.created_at
      FROM sources source
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_created_versions = ROW_COUNT;

    WITH sources AS (
        SELECT assignment.id AS assignment_id, assignment.tenant_id, assignment.created_at
          FROM public.classroom_assignments assignment
          JOIN public.classrooms classroom
            ON classroom.tenant_id = assignment.tenant_id
           AND classroom.id = assignment.classroom_id
          LEFT JOIN public.teacher_assignments task ON task.id = assignment.assignment_id
          LEFT JOIN public.classroom_course_run_lessons lesson
            ON lesson.classroom_assignment_id = assignment.id
         WHERE assignment.tenant_id = v_tenant
           AND classroom.school_id = p_school_id
           AND assignment.quiz_version_id IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM public.classroom_activity_versions mapping
                WHERE mapping.classroom_assignment_id = assignment.id
           )
           AND COALESCE(task.module_key, lesson.module_key) IS NOT NULL
    )
    INSERT INTO public.classroom_activity_versions (
        tenant_id, classroom_assignment_id, learning_activity_version_id, assigned_at
    )
    SELECT source.tenant_id, source.assignment_id,
           public.learning_m0_deterministic_uuid('activity-version:assignment:' || source.assignment_id),
           source.created_at
      FROM sources source
    ON CONFLICT (classroom_assignment_id) DO NOTHING;
    GET DIAGNOSTICS v_created_mappings = ROW_COUNT;

    INSERT INTO public.learning_migration_artifacts (
        id, tenant_id, school_id, batch_id, artifact_kind, artifact_id,
        source_table, source_id, operation_type, operation_mode, source_evidence
    )
    SELECT public.learning_m0_deterministic_uuid(
               'artifact:' || v_batch || ':activity-mapping:' || mapping.classroom_assignment_id
           ),
           v_tenant, p_school_id, v_batch, 'activity_mapping',
           mapping.classroom_assignment_id, 'classroom_assignments',
           mapping.classroom_assignment_id, 'map_activity_version', 'automatic',
           jsonb_build_object(
               'assignmentId', mapping.classroom_assignment_id,
               'activityVersionId', mapping.learning_activity_version_id
           )
      FROM public.classroom_activity_versions mapping
      JOIN public.classroom_assignments assignment
        ON assignment.id = mapping.classroom_assignment_id
      JOIN public.classrooms classroom ON classroom.id = assignment.classroom_id
     WHERE assignment.tenant_id = v_tenant AND classroom.school_id = p_school_id
       AND mapping.learning_activity_version_id = public.learning_m0_deterministic_uuid(
           'activity-version:assignment:' || mapping.classroom_assignment_id
       )
    ON CONFLICT (batch_id, artifact_kind, source_table, source_id, operation_type)
    DO UPDATE SET disabled_at = NULL;

    -- Exact immutable evidence backfill. The baseline population has no such
    -- legacy-only row; the test fixture proves the guarded path. A current
    -- mutable draft is never used and no ProjectVersion is created.
    FOR v_row IN
        SELECT work.id AS work_id, work.tenant_id, work.assignment_id,
               work.seat_id, work.project_id, work.started_at, work.submitted_at,
               assignment.classroom_id, assignment.due_at,
               mapping.learning_activity_version_id,
               project.tenant_id AS project_tenant_id,
               candidate.project_version_id, candidate.document_json,
               link.learner_identity_id
          FROM public.classroom_assignment_work work
          JOIN public.classroom_assignments assignment ON assignment.id = work.assignment_id
          JOIN public.classrooms classroom ON classroom.id = assignment.classroom_id
          JOIN public.classroom_student_seats seat ON seat.id = work.seat_id
          JOIN public.learner_identity_links link
            ON link.seat_id = work.seat_id AND link.status = 'active'
          JOIN public.classroom_activity_versions mapping
            ON mapping.classroom_assignment_id = work.assignment_id
          JOIN public.projects project ON project.id = work.project_id
          JOIN LATERAL (
              SELECT (array_agg(version.id ORDER BY version.created_at, version.id))[1]
                         AS project_version_id,
                     (array_agg(version.document_json ORDER BY version.created_at, version.id))[1]
                         AS document_json,
                     count(*) AS version_count
                FROM public.project_versions version
               WHERE version.tenant_id = project.tenant_id
                 AND version.project_id = work.project_id
                 AND version.created_at <= work.submitted_at
          ) candidate ON candidate.version_count = 1
         WHERE work.tenant_id = v_tenant
           AND classroom.school_id = p_school_id
           AND work.submitted_at IS NOT NULL
           AND work.submitted_at <= p_as_of
           AND (
               project.owner_principal_id = (
                   SELECT principal.id FROM public.principals principal
                    WHERE principal.seat_id = seat.id
               )
               OR project.owner_principal_id = (
                   SELECT principal.id FROM public.principals principal
                    WHERE principal.account_id = seat.account_id
                      AND principal.kind = 'account'
               )
           )
           AND NOT EXISTS (
               SELECT 1 FROM public.learning_attempts attempt
                WHERE attempt.classroom_assignment_id = work.assignment_id
                  AND attempt.seat_id = work.seat_id
           )
           AND NOT EXISTS (
               SELECT 1 FROM public.gradebook_entries grade
                WHERE grade.classroom_assignment_id = work.assignment_id
                  AND grade.seat_id = work.seat_id
           )
         ORDER BY work.id
    LOOP
        v_attempt := public.learning_m0_deterministic_uuid('attempt:legacy-work:' || v_row.work_id);
        v_submission := public.learning_m0_deterministic_uuid('submission:legacy-work:' || v_row.work_id);
        v_project_version := v_row.project_version_id;
        v_learner := v_row.learner_identity_id;
        v_activity_version := v_row.learning_activity_version_id;
        v_digest := encode(public.digest(convert_to(v_row.document_json::text, 'UTF8'), 'sha256'), 'hex');

        INSERT INTO public.learning_attempts (
            id, tenant_id, classroom_id, classroom_assignment_id,
            learning_activity_version_id, seat_id, learner_identity_id,
            attempt_number, state, started_at, submitted_at
        ) VALUES (
            v_attempt, v_row.tenant_id, v_row.classroom_id, v_row.assignment_id,
            v_activity_version, v_row.seat_id, v_learner, 1, 'submitted',
            LEAST(v_row.started_at, v_row.submitted_at), v_row.submitted_at
        ) ON CONFLICT (id) DO NOTHING;
        IF FOUND THEN v_created_attempts := v_created_attempts + 1; END IF;

        INSERT INTO public.learning_submissions (
            id, tenant_id, attempt_id, project_tenant_id, project_id, project_version_id,
            payload_manifest, payload_digest, client_request_id, late_state,
            submitted_at
        ) VALUES (
            v_submission, v_row.tenant_id, v_attempt, v_row.project_tenant_id,
            v_row.project_id,
            v_project_version,
            jsonb_build_object('kind', 'project', 'projectVersionId', v_project_version),
            v_digest, 'm0-006:' || v_row.work_id,
            CASE WHEN v_row.due_at IS NOT NULL AND v_row.submitted_at > v_row.due_at
                 THEN 'late' ELSE 'on_time' END,
            v_row.submitted_at
        ) ON CONFLICT (id) DO NOTHING;
        IF FOUND THEN v_created_submissions := v_created_submissions + 1; END IF;

        INSERT INTO public.learning_migration_artifacts (
            id, tenant_id, school_id, batch_id, artifact_kind, artifact_id,
            source_table, source_id, operation_type, operation_mode, source_evidence
        ) VALUES (
            public.learning_m0_deterministic_uuid('artifact:' || v_batch || ':attempt:' || v_row.work_id),
            v_tenant, p_school_id, v_batch, 'attempt', v_attempt,
            'classroom_assignment_work', v_row.work_id, 'backfill_exact_attempt', 'automatic',
            jsonb_build_object('seatId', v_row.seat_id, 'assignmentId', v_row.assignment_id,
                               'projectVersionId', v_project_version, 'submittedAt', v_row.submitted_at)
        ) ON CONFLICT (batch_id, artifact_kind, source_table, source_id, operation_type)
          DO UPDATE SET disabled_at = NULL;

        INSERT INTO public.learning_migration_artifacts (
            id, tenant_id, school_id, batch_id, artifact_kind, artifact_id,
            source_table, source_id, operation_type, operation_mode, source_evidence
        ) VALUES (
            public.learning_m0_deterministic_uuid('artifact:' || v_batch || ':submission:' || v_row.work_id),
            v_tenant, p_school_id, v_batch, 'submission', v_submission,
            'classroom_assignment_work', v_row.work_id, 'backfill_exact_submission', 'automatic',
            jsonb_build_object('attemptId', v_attempt, 'projectVersionId', v_project_version,
                               'payloadDigest', v_digest)
        ) ON CONFLICT (batch_id, artifact_kind, source_table, source_id, operation_type)
          DO UPDATE SET disabled_at = NULL;
    END LOOP;

    -- Existing exact canonical submissions are canaries: record convergence,
    -- never create a second Attempt or Submission.
    INSERT INTO public.learning_migration_artifacts (
        id, tenant_id, school_id, batch_id, artifact_kind, artifact_id,
        source_table, source_id, operation_type, operation_mode, source_evidence
    )
    SELECT public.learning_m0_deterministic_uuid(
               'artifact:' || v_batch || ':existing-submission:' || submission.id
           ),
           v_tenant, p_school_id, v_batch, 'existing_exact_submission', submission.id,
           'learning_submissions', submission.id, 'map_existing_exact_submission',
           'automatic',
           jsonb_build_object('attemptId', attempt.id, 'projectVersionId', submission.project_version_id)
      FROM public.learning_attempts attempt
      JOIN public.learning_submissions submission ON submission.attempt_id = attempt.id
      JOIN public.classrooms classroom ON classroom.id = attempt.classroom_id
      JOIN public.project_versions version ON version.id = submission.project_version_id
     WHERE attempt.tenant_id = v_tenant
       AND classroom.school_id = p_school_id
       AND (submission.project_id IS NULL OR version.project_id = submission.project_id)
    ON CONFLICT (batch_id, artifact_kind, source_table, source_id, operation_type)
    DO UPDATE SET disabled_at = NULL;
    GET DIAGNOSTICS v_exact_existing = ROW_COUNT;

    -- Any legacy submitted unit still lacking an exact immutable Submission is
    -- diagnostic only. This is intentionally not an error count of zero.
    INSERT INTO public.learning_migration_artifacts (
        id, tenant_id, school_id, batch_id, artifact_kind, artifact_id,
        source_table, source_id, operation_type, operation_mode, source_evidence
    )
    SELECT public.learning_m0_deterministic_uuid(
               'artifact:' || v_batch || ':legacy-unresolved:' || work.id
           ),
           v_tenant, p_school_id, v_batch, 'legacy_unresolved', NULL,
           'classroom_assignment_work', work.id, 'preserve_legacy_unresolved',
           'automatic',
           jsonb_build_object('assignmentId', work.assignment_id, 'seatId', work.seat_id,
                              'projectId', work.project_id, 'submittedAt', work.submitted_at)
      FROM public.classroom_assignment_work work
      JOIN public.classroom_assignments assignment ON assignment.id = work.assignment_id
      JOIN public.classrooms classroom ON classroom.id = assignment.classroom_id
     WHERE work.tenant_id = v_tenant
       AND classroom.school_id = p_school_id
       AND work.submitted_at IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM public.learning_attempts attempt
             JOIN public.learning_submissions submission ON submission.attempt_id = attempt.id
            WHERE attempt.classroom_assignment_id = work.assignment_id
              AND attempt.seat_id = work.seat_id
       )
    ON CONFLICT (batch_id, artifact_kind, source_table, source_id, operation_type)
    DO UPDATE SET disabled_at = NULL;
    GET DIAGNOSTICS v_unresolved = ROW_COUNT;

    -- Feedback remains in its legacy table. Provenance contains only IDs and
    -- the original badge; it cannot create points, percentage or displayGrade.
    INSERT INTO public.learning_migration_artifacts (
        id, tenant_id, school_id, batch_id, artifact_kind, artifact_id,
        source_table, source_id, operation_type, operation_mode, source_evidence
    )
    SELECT public.learning_m0_deterministic_uuid(
               'artifact:' || v_batch || ':feedback:' || feedback.id
           ),
           v_tenant, p_school_id, v_batch, 'legacy_feedback', feedback.id,
           'project_feedback', feedback.id, 'preserve_feedback_metadata', 'automatic',
           jsonb_build_object('projectId', feedback.project_id, 'seatId', feedback.seat_id,
                              'badge', feedback.badge,
                              'linked', work.id IS NOT NULL)
      FROM public.project_feedback feedback
      JOIN public.classroom_student_seats seat ON seat.id = feedback.seat_id
      JOIN public.classrooms classroom ON classroom.id = seat.classroom_id
      LEFT JOIN public.classroom_assignment_work work
        ON work.project_id = feedback.project_id AND work.seat_id = feedback.seat_id
     WHERE seat.tenant_id = v_tenant AND classroom.school_id = p_school_id
    ON CONFLICT (batch_id, artifact_kind, source_table, source_id, operation_type)
    DO UPDATE SET disabled_at = NULL;
    GET DIAGNOSTICS v_feedback = ROW_COUNT;

    UPDATE public.learning_migration_batches
       SET completed_at = now()
     WHERE id = v_batch;

    RETURN jsonb_build_object(
        'batchId', v_batch,
        'created', jsonb_build_object(
            'learnerIdentities', v_created_identities,
            'seatLinks', v_created_seat_links,
            'accountLinks', v_created_account_links,
            'activities', v_created_activities,
            'activityVersions', v_created_versions,
            'activityMappings', v_created_mappings,
            'attempts', v_created_attempts,
            'submissions', v_created_submissions
        ),
        'classified', jsonb_build_object(
            'existingExactSubmissions', v_exact_existing,
            'legacyUnresolved', v_unresolved,
            'feedbackPreserved', v_feedback,
            'gradeConversions', 0
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION learning_m0_convergence_rollback(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_batch record;
    v_disabled_artifacts integer := 0;
    v_disabled_links integer := 0;
    v_disabled_identities integer := 0;
    v_removed_mappings integer := 0;
BEGIN
    SELECT * INTO v_batch
      FROM public.learning_migration_batches batch
     WHERE batch.id = p_batch_id
     FOR UPDATE;
    IF v_batch.id IS NULL THEN RAISE EXCEPTION 'learning migration batch not found'; END IF;
    PERFORM set_config('app.tenant_id', v_batch.tenant_id::text, true);
    PERFORM pg_advisory_xact_lock(
        hashtextextended(v_batch.school_id::text || ':' || v_batch.batch_key, 0)
    );

    UPDATE public.learning_migration_artifacts
       SET disabled_at = COALESCE(disabled_at, now())
     WHERE batch_id = p_batch_id AND disabled_at IS NULL;
    GET DIAGNOSTICS v_disabled_artifacts = ROW_COUNT;

    UPDATE public.learner_identity_links
       SET status = 'inactive', disabled_at = COALESCE(disabled_at, now())
     WHERE created_by_batch_id = p_batch_id AND status = 'active';
    GET DIAGNOSTICS v_disabled_links = ROW_COUNT;

    UPDATE public.learner_identities identity
       SET state = 'inactive'
     WHERE identity.created_by_batch_id = p_batch_id
       AND identity.state = 'active'
       AND NOT EXISTS (
           SELECT 1 FROM public.learner_identity_links link
            WHERE link.learner_identity_id = identity.id
              AND link.status = 'active'
              AND link.created_by_batch_id IS DISTINCT FROM p_batch_id
       );
    GET DIAGNOSTICS v_disabled_identities = ROW_COUNT;

    DELETE FROM public.classroom_activity_versions mapping
     USING public.learning_migration_artifacts artifact
     WHERE artifact.batch_id = p_batch_id
       AND artifact.artifact_kind = 'activity_mapping'
       AND artifact.artifact_id = mapping.classroom_assignment_id
       AND NOT EXISTS (
           SELECT 1 FROM public.learning_attempts attempt
            WHERE attempt.learning_activity_version_id = mapping.learning_activity_version_id
       );
    GET DIAGNOSTICS v_removed_mappings = ROW_COUNT;

    UPDATE public.learning_migration_batches
       SET state = 'rolled_back', disabled_at = now()
     WHERE id = p_batch_id;

    RETURN jsonb_build_object(
        'batchId', p_batch_id,
        'disabledArtifacts', v_disabled_artifacts,
        'disabledLinks', v_disabled_links,
        'disabledIdentities', v_disabled_identities,
        'removedActivityMappings', v_removed_mappings,
        'immutableAttemptsDeleted', 0,
        'immutableSubmissionsDeleted', 0
    );
END;
$$;

CREATE OR REPLACE FUNCTION learning_m0_convergence_report(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_batch record;
BEGIN
    SELECT * INTO v_batch FROM public.learning_migration_batches WHERE id = p_batch_id;
    IF v_batch.id IS NULL THEN RAISE EXCEPTION 'learning migration batch not found'; END IF;
    PERFORM set_config('app.tenant_id', v_batch.tenant_id::text, true);
    RETURN jsonb_build_object(
        'batchId', v_batch.id,
        'state', v_batch.state,
        'learnerIdentities', (
            SELECT count(DISTINCT artifact.artifact_id)
              FROM public.learning_migration_artifacts artifact
             WHERE artifact.batch_id = p_batch_id
               AND artifact.artifact_kind = 'learner_identity'
               AND artifact.disabled_at IS NULL
        ),
        'seatLinks', (
            SELECT count(*) FROM public.learner_identity_links link
             WHERE link.school_id = v_batch.school_id AND link.seat_id IS NOT NULL
               AND link.status = 'active'
        ),
        'accountLinks', (
            SELECT count(*) FROM public.learner_identity_links link
             WHERE link.school_id = v_batch.school_id AND link.account_id IS NOT NULL
               AND link.status = 'active'
        ),
        'activityMappings', (
            SELECT count(*) FROM public.learning_migration_artifacts artifact
             WHERE artifact.batch_id = p_batch_id
               AND artifact.artifact_kind = 'activity_mapping'
               AND artifact.disabled_at IS NULL
        ),
        'attemptsBackfilled', (
            SELECT count(*) FROM public.learning_migration_artifacts artifact
             WHERE artifact.batch_id = p_batch_id AND artifact.artifact_kind = 'attempt'
               AND artifact.disabled_at IS NULL
        ),
        'submissionsBackfilled', (
            SELECT count(*) FROM public.learning_migration_artifacts artifact
             WHERE artifact.batch_id = p_batch_id AND artifact.artifact_kind = 'submission'
               AND artifact.disabled_at IS NULL
        ),
        'existingExactSubmissions', (
            SELECT count(*) FROM public.learning_migration_artifacts artifact
             WHERE artifact.batch_id = p_batch_id
               AND artifact.artifact_kind = 'existing_exact_submission'
               AND artifact.disabled_at IS NULL
        ),
        'legacyUnresolved', (
            SELECT count(*) FROM public.learning_migration_artifacts artifact
             WHERE artifact.batch_id = p_batch_id
               AND artifact.artifact_kind = 'legacy_unresolved'
               AND artifact.disabled_at IS NULL
        ),
        'feedbackPreserved', (
            SELECT count(*) FROM public.learning_migration_artifacts artifact
             WHERE artifact.batch_id = p_batch_id
               AND artifact.artifact_kind = 'legacy_feedback'
               AND artifact.disabled_at IS NULL
        ),
        'gradeConversions', 0
    );
END;
$$;

REVOKE ALL ON FUNCTION learning_m0_deterministic_uuid(text) FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION learning_m0_convergence_apply(varchar, uuid, varchar, timestamptz)
    FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION learning_m0_convergence_rollback(uuid) FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION learning_m0_convergence_report(uuid) FROM PUBLIC, asalab_app;
