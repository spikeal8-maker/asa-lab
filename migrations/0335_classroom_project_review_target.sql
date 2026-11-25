-- Resolve a visible classroom project to the exact submission behind its card.
-- The project and snapshot still use their existing, independent read boundaries.
CREATE FUNCTION public.classroom_observation_project_review(
    p_actor uuid, p_class uuid, p_seat uuid, p_project uuid
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT jsonb_build_object(
        'assignmentId', run.source_classroom_assignment_id,
        'activityRunId', run.id,
        'attemptId', attempt.id,
        'submissionId', submission.id,
        'projectVersionId', version.id,
        'canReview', project.status = 'active' AND classroom.status = 'active'
    )
      FROM public.classroom_student_seats seat
      JOIN public.classrooms classroom
        ON classroom.id = seat.classroom_id AND classroom.tenant_id = seat.tenant_id
      JOIN public.learning_attempts attempt
        ON attempt.seat_id = seat.id AND attempt.classroom_id = classroom.id
       AND attempt.tenant_id = classroom.tenant_id
      JOIN public.activity_participations participation
        ON participation.id = attempt.activity_participation_id
       AND participation.tenant_id = attempt.tenant_id
      JOIN public.activity_runs run
        ON run.id = participation.activity_run_id
       AND run.tenant_id = classroom.tenant_id AND run.classroom_id = classroom.id
       AND run.source_classroom_assignment_id = attempt.classroom_assignment_id
      JOIN public.learner_identity_links link
        ON link.learner_identity_id = participation.learner_identity_id
       AND link.seat_id = seat.id AND link.tenant_id = classroom.tenant_id
       AND link.school_id = classroom.school_id AND link.status = 'active'
       AND link.disabled_at IS NULL
      JOIN public.learning_submissions submission
        ON submission.attempt_id = attempt.id AND submission.tenant_id = attempt.tenant_id
       AND submission.project_id = p_project
      JOIN public.projects project
        ON project.id = submission.project_id AND project.tenant_id = submission.project_tenant_id
      JOIN public.project_versions version
        ON version.id = submission.project_version_id AND version.project_id = project.id
       AND version.tenant_id = project.tenant_id
     WHERE classroom.id = p_class AND seat.id = p_seat AND seat.status <> 'removed'
       AND attempt.invalidated_at IS NULL AND attempt.state <> 'invalidated'
       AND public.classroom_journal_teacher(p_actor, p_class)
       AND public.classroom_participant_allowed(p_actor, p_class, p_seat)
       AND EXISTS (SELECT 1 FROM public.classroom_participant_projects(p_seat) visible
                    WHERE visible.id = project.id)
       AND EXISTS (SELECT 1 FROM public.project_context_for_principal(p_actor, project.id))
     ORDER BY submission.submitted_at DESC, attempt.attempt_number DESC, attempt.id DESC
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.classroom_observation_project_review(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_observation_project_review(uuid,uuid,uuid,uuid) TO asalab_app;
