-- A1: resolve one already-started learner work from its project. This reader is
-- deliberately keyed by both the viewer and the project: application-level
-- project access is checked first, and direct calls cannot enumerate work.
CREATE FUNCTION learning_work_context_for_project(
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
        'goal', CASE WHEN run.source_course_block_id IS NOT NULL THEN NULL
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

REVOKE ALL ON FUNCTION learning_work_context_for_project(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_work_context_for_project(uuid, uuid) TO asalab_app;

-- Used only after the normal project access gate. A teacher may be allowed to
-- open a learner's project for review without becoming that learner; such a
-- project must never be misreported as a personal project.
CREATE FUNCTION learning_work_project_origin_exists(
    p_viewer_principal_id uuid, p_project_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.classroom_assignment_work work
         WHERE work.project_id = p_project_id
           AND EXISTS (
               SELECT 1 FROM public.project_context_for_principal(
                   p_viewer_principal_id, p_project_id
               )
           )
    );
$$;

REVOKE ALL ON FUNCTION learning_work_project_origin_exists(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_work_project_origin_exists(uuid, uuid) TO asalab_app;
