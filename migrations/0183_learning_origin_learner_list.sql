-- A4 residual: learner lists read new work from immutable origin, never from
-- the handout-keyed compatibility row. The exact project reader is the access
-- boundary for both Seat and linked Account, including revocation.
CREATE FUNCTION public.learning_origin_learner_list(
    p_seat_id uuid, p_account_id uuid
)
RETURNS TABLE (context jsonb, evidence jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT reader.context, reader.evidence
      FROM public.classroom_student_seats seat
      JOIN public.principals actor
        ON (p_seat_id IS NOT NULL AND actor.kind = 'student_seat'
            AND actor.seat_id = seat.id)
        OR (p_account_id IS NOT NULL AND actor.kind = 'account'
            AND actor.account_id = seat.account_id)
      JOIN public.learner_identity_links seat_link
        ON seat_link.tenant_id = seat.tenant_id
       AND seat_link.seat_id = seat.id
       AND seat_link.link_kind = 'student_seat'
       AND seat_link.status = 'active'
      JOIN public.learning_project_origins origin
        ON origin.school_tenant_id = seat.tenant_id
       AND origin.school_id = seat_link.school_id
       AND origin.learner_identity_id = seat_link.learner_identity_id
      JOIN public.activity_runs run
        ON run.id = origin.activity_run_id
       AND run.tenant_id = origin.school_tenant_id
       AND run.classroom_id = seat.classroom_id
      CROSS JOIN LATERAL public.learning_origin_work_context_for_project(
          actor.id, origin.project_id) reader
     WHERE num_nonnulls(p_seat_id, p_account_id) = 1
       AND seat.status = 'active'
       AND ((p_seat_id IS NOT NULL AND seat.id = p_seat_id)
            OR (p_account_id IS NOT NULL AND seat.account_id = p_account_id))
       AND reader.context->>'seatId' = seat.id::text
       AND reader.context->>'participationId' = origin.participation_id::text
       AND reader.context->>'activityRunId' = origin.activity_run_id::text;
$$;

REVOKE ALL ON FUNCTION public.learning_origin_learner_list(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_origin_learner_list(uuid,uuid) TO asalab_app;

-- Authorization to read a Project may be revoked while a compatibility work
-- row still points at it. Preserve the historical Seat->identity link for
-- suppression even when that link is inactive. Return only its source key;
-- never return the denied Project ID or evidence.
CREATE FUNCTION public.learning_origin_learner_presence(
    p_seat_id uuid, p_account_id uuid
)
RETURNS TABLE (
    seat_id uuid, source_kind varchar, classroom_assignment_id uuid,
    activity_run_id uuid, course_block_id varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT seat.id, origin.source_kind, run.source_classroom_assignment_id,
           origin.activity_run_id, origin.source_course_block_id
      FROM public.classroom_student_seats seat
      JOIN public.learner_identity_links seat_link
        ON seat_link.tenant_id = seat.tenant_id
       AND seat_link.seat_id = seat.id
       AND seat_link.link_kind = 'student_seat'
      JOIN public.learning_project_origins origin
        ON origin.school_tenant_id = seat.tenant_id
       AND origin.school_id = seat_link.school_id
       AND origin.learner_identity_id = seat_link.learner_identity_id
      JOIN public.activity_runs run
        ON run.id = origin.activity_run_id
       AND run.tenant_id = origin.school_tenant_id
       AND run.classroom_id = seat.classroom_id
     WHERE num_nonnulls(p_seat_id, p_account_id) = 1
       AND seat.status = 'active'
       AND ((p_seat_id IS NOT NULL AND seat.id = p_seat_id)
            OR (p_account_id IS NOT NULL AND seat.account_id = p_account_id));
$$;

REVOKE ALL ON FUNCTION public.learning_origin_learner_presence(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_origin_learner_presence(uuid,uuid) TO asalab_app;

-- A direct assignment needs its exact run ID before the first Start. Course
-- activity blocks already expose their exact ActivityRun in the occurrence API.
CREATE FUNCTION public.learning_direct_learner_runs(
    p_seat_id uuid, p_account_id uuid
)
RETURNS TABLE (seat_id uuid, classroom_assignment_id uuid, activity_run_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT seat.id, run.source_classroom_assignment_id, run.id
      FROM public.classroom_student_seats seat
      JOIN public.principals actor
        ON (p_seat_id IS NOT NULL AND actor.kind = 'student_seat'
            AND actor.seat_id = seat.id)
        OR (p_account_id IS NOT NULL AND actor.kind = 'account'
            AND actor.account_id = seat.account_id)
      JOIN public.learner_identity_links seat_link
        ON seat_link.tenant_id = seat.tenant_id
       AND seat_link.seat_id = seat.id
       AND seat_link.link_kind = 'student_seat'
       AND seat_link.status = 'active'
      JOIN public.activity_participations participation
        ON participation.tenant_id = seat.tenant_id
       AND participation.school_id = seat_link.school_id
       AND participation.learner_identity_id = seat_link.learner_identity_id
       AND participation.status IN ('assigned', 'active')
      JOIN public.activity_runs run
        ON run.id = participation.activity_run_id
       AND run.tenant_id = participation.tenant_id
       AND run.classroom_id = seat.classroom_id
       AND run.source_kind = 'direct'
       AND run.lifecycle_status = 'active'
      JOIN public.classroom_assignments assignment
        ON assignment.id = run.source_classroom_assignment_id
       AND assignment.tenant_id = run.tenant_id
       AND assignment.classroom_id = seat.classroom_id
       AND assignment.status = 'open'
     WHERE num_nonnulls(p_seat_id, p_account_id) = 1
       AND seat.status = 'active'
       AND ((p_seat_id IS NOT NULL AND seat.id = p_seat_id)
            OR (p_account_id IS NOT NULL AND seat.account_id = p_account_id))
       AND public.learning_direct_assignment_seat_visible(
           seat.id, run.source_classroom_assignment_id)
       AND (actor.kind = 'student_seat' OR EXISTS (
           SELECT 1 FROM public.accounts account
           JOIN public.learner_identity_links account_link
             ON account_link.account_id = account.id
            AND account_link.tenant_id = run.tenant_id
            AND account_link.school_id = run.school_id
            AND account_link.learner_identity_id = seat_link.learner_identity_id
            AND account_link.link_kind = 'account'
            AND account_link.status = 'active'
           WHERE account.id = seat.account_id AND account.status = 'active'));
$$;

REVOKE ALL ON FUNCTION public.learning_direct_learner_runs(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_direct_learner_runs(uuid,uuid) TO asalab_app;

-- Preserve a started origin work item after handout/Course closure. Project
-- identity remains supplied only by the authorized origin list function.
CREATE OR REPLACE FUNCTION public.classroom_assignments_for_seat(p_seat_id uuid)
 RETURNS TABLE(
    id uuid,
    title character varying,
    brief character varying,
    goal character varying,
    module_key character varying,
    due_at timestamp with time zone,
    status character varying,
    sample_image character varying,
    project_id uuid,
    submitted_at timestamp with time zone,
    snapshot_revision integer,
    updated_at timestamp with time zone
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
    SELECT h.id,
           COALESCE(lv.title,t.title),
           COALESCE(lv.instructions,t.brief),
           CASE
             WHEN lv.goal_snapshot_present THEN
               CASE
                 WHEN w.project_id IS NOT NULL THEN lv.goal
                 WHEN EXISTS (
                   SELECT 1
                     FROM public.activity_runs runtime
                     JOIN public.classrooms classroom
                       ON classroom.tenant_id = runtime.tenant_id
                      AND classroom.id = runtime.classroom_id
                      AND classroom.status = 'active'
                     JOIN public.learner_identity_links link
                       ON link.tenant_id = runtime.tenant_id
                      AND link.school_id = runtime.school_id
                      AND link.seat_id = s.id
                      AND link.link_kind = 'student_seat'
                      AND link.status = 'active'
                     JOIN public.activity_participations participation
                       ON participation.tenant_id = runtime.tenant_id
                      AND participation.school_id = runtime.school_id
                      AND participation.activity_run_id = runtime.id
                      AND participation.learner_identity_id = link.learner_identity_id
                    WHERE runtime.tenant_id = h.tenant_id
                      AND runtime.source_classroom_assignment_id = h.id
                      AND runtime.learning_activity_version_id = lv.id
                      AND runtime.lifecycle_status = 'active'
                      AND h.status = 'open'
                      AND participation.status IN ('assigned', 'active')
                      AND (
                        (runtime.source_kind = 'direct'
                         AND public.learning_direct_assignment_seat_visible(s.id, h.id))
                        OR (runtime.source_kind = 'course'
                            AND public.learning_course_seat_visible(s.id, runtime.source_course_run_id)
                            AND EXISTS (
                              SELECT 1 FROM public.classroom_course_runs course
                               WHERE course.id = runtime.source_course_run_id
                                 AND course.tenant_id = runtime.tenant_id
                                 AND course.status = 'open'
                            )
                            AND (participation.source_course_enrollment_id IS NULL OR EXISTS (
                              SELECT 1 FROM public.course_enrollments enrollment
                               WHERE enrollment.id = participation.source_course_enrollment_id
                                 AND enrollment.tenant_id = runtime.tenant_id
                                 AND enrollment.school_id = runtime.school_id
                                 AND enrollment.status IN ('assigned', 'active')
                            )))
                      )
                      AND COALESCE((
                        public.learning_effective_conditions_internal(
                          runtime.id, participation.id
                        ) #>> '{values,opensAt}'
                      )::timestamptz, '-infinity'::timestamptz) <= now()
                 ) THEN lv.goal
                 ELSE NULL
               END
             ELSE t.goal
           END,
           COALESCE(lv.module_key,t.module_key),
           h.due_at,
           h.status,
           CASE
             WHEN h.learning_activity_version_id IS NOT NULL THEN
               CASE WHEN EXISTS (
                   SELECT 1
                     FROM public.learning_activity_version_media media
                    WHERE media.tenant_id = h.tenant_id
                      AND media.activity_version_id = h.learning_activity_version_id
                      AND media.role = 'sample'
               ) THEN (
                   '/api/assignments/activity-versions/'
                   || h.learning_activity_version_id::text
                   || '/sample'
               )::varchar ELSE NULL::varchar END
             ELSE t.sample_image
           END,
           w.project_id,
           w.submitted_at,
           snapshot.source_revision,
           draft.updated_at
      FROM public.classroom_student_seats s
      JOIN public.classroom_assignments h
        ON h.tenant_id = s.tenant_id AND h.classroom_id = s.classroom_id
      LEFT JOIN public.teacher_assignments t ON t.id = h.assignment_id
      LEFT JOIN public.learning_activity_versions lv ON lv.id = h.learning_activity_version_id
      LEFT JOIN public.classroom_assignment_work w
        ON w.assignment_id = h.id AND w.seat_id = s.id
      LEFT JOIN public.project_drafts draft ON draft.project_id = w.project_id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = w.project_id
     WHERE (t.id IS NOT NULL OR lv.id IS NOT NULL)
       AND s.id = p_seat_id
       AND s.status = 'active'
       AND (h.status = 'open' OR w.project_id IS NOT NULL OR EXISTS (
           SELECT 1 FROM public.learning_project_origins origin
           JOIN public.activity_runs run
             ON run.id = origin.activity_run_id
            AND run.tenant_id = origin.school_tenant_id
            AND run.source_kind = 'direct'
            AND run.source_classroom_assignment_id = h.id
           JOIN public.learner_identity_links link
             ON link.tenant_id = origin.school_tenant_id
            AND link.school_id = origin.school_id
            AND link.learner_identity_id = origin.learner_identity_id
            AND link.link_kind = 'student_seat'
            AND link.seat_id = s.id
            AND link.status = 'active'
          WHERE origin.school_tenant_id = h.tenant_id
            AND run.classroom_id = s.classroom_id
       ))
     ORDER BY (w.submitted_at IS NOT NULL), h.created_at;
$function$;
CREATE OR REPLACE FUNCTION classroom_course_runs_for_seat_v2(p_seat_id uuid)
RETURNS TABLE (
    run_id uuid, course_id uuid, course_version_id uuid, version_number integer,
    classroom_title varchar, run_title varchar, run_summary varchar,
    due_at timestamptz, run_status varchar, lesson_id uuid, source_lesson_id uuid,
    section_title varchar, section_summary varchar, section_position integer,
    lesson_title varchar, lesson_summary varchar, lesson_content varchar,
    lesson_blocks jsonb, lesson_kind varchar, estimated_minutes integer,
    lesson_position integer, classroom_assignment_id uuid, assignment_title varchar,
    assignment_goal varchar, assignment_brief varchar, module_key varchar,
    sample_image varchar, project_id uuid, submitted_at timestamptz,
    snapshot_revision integer, work_updated_at timestamptz, completed_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT run.id, run.course_id, run.course_version_id, run.version_number,
           classroom.title, run.title, run.summary, run.due_at, run.status,
           lesson.id, lesson.source_lesson_id, lesson.section_title,
           lesson.section_summary, lesson.section_position, lesson.title,
           lesson.summary, lesson.content, lesson.blocks, lesson.kind,
           lesson.estimated_minutes, lesson.lesson_position,
           lesson.classroom_assignment_id, lesson.assignment_title,
           lesson.assignment_goal, lesson.assignment_brief, lesson.module_key,
           CASE WHEN media.version_id IS NOT NULL
                THEN ('/api/class-join/course-runs/' || run.id::text || '/lessons/' ||
                      lesson.source_lesson_id::text || '/sample')::varchar
                ELSE lesson.static_sample_image END,
           work.project_id, work.submitted_at, snapshot.source_revision, draft.updated_at,
           progress.completed_at
      FROM public.classroom_student_seats seat
      JOIN public.classrooms classroom ON classroom.id = seat.classroom_id
      JOIN public.classroom_course_runs run
        ON run.tenant_id = seat.tenant_id AND run.classroom_id = seat.classroom_id
      JOIN public.classroom_course_run_lessons lesson ON lesson.run_id = run.id
      LEFT JOIN public.course_version_media media
        ON media.version_id = run.course_version_id
       AND media.source_lesson_id = lesson.source_lesson_id
      LEFT JOIN public.classroom_assignment_work work
        ON work.assignment_id = lesson.classroom_assignment_id AND work.seat_id = seat.id
      LEFT JOIN public.project_drafts draft ON draft.project_id = work.project_id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = work.project_id
      LEFT JOIN public.classroom_course_lesson_progress progress
        ON progress.run_id = run.id AND progress.lesson_id = lesson.id
       AND progress.seat_id = seat.id
     WHERE seat.id = p_seat_id
       AND public.learning_course_seat_visible(seat.id,run.id)
       AND seat.status = 'active'
       AND (
           run.status = 'open'
           OR EXISTS (
               SELECT 1
                 FROM public.classroom_course_run_lessons started_lesson
                 JOIN public.classroom_assignment_work started_work
                   ON started_work.assignment_id = started_lesson.classroom_assignment_id
                WHERE started_lesson.run_id = run.id
                  AND started_work.seat_id = seat.id
                  AND started_work.project_id IS NOT NULL
           )
           OR EXISTS (
               SELECT 1 FROM public.classroom_course_lesson_progress started_progress
                WHERE started_progress.run_id = run.id
                  AND started_progress.seat_id = seat.id
            )
            OR EXISTS (
                SELECT 1 FROM public.learning_project_origins origin
                JOIN public.activity_runs activity
                  ON activity.id = origin.activity_run_id
                 AND activity.tenant_id = origin.school_tenant_id
                 AND activity.source_kind = 'course'
                 AND activity.source_course_run_id = run.id
                JOIN public.learner_identity_links link
                  ON link.tenant_id = origin.school_tenant_id
                 AND link.school_id = origin.school_id
                 AND link.learner_identity_id = origin.learner_identity_id
                 AND link.link_kind = 'student_seat'
                 AND link.seat_id = seat.id
                 AND link.status = 'active'
               WHERE origin.school_tenant_id = run.tenant_id
            )
       )
     ORDER BY run.created_at DESC, lesson.section_position, lesson.source_section_id,
              lesson.lesson_position, lesson.source_lesson_id;
$$;
