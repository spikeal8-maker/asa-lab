-- Profile assignment lists must show an issued pupil's work to the teacher
-- before first sign-in. Do not change the shared learner course access check.
CREATE FUNCTION public.classroom_participant_course_visible(p_actor uuid,p_seat uuid,p_run uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.classroom_course_runs course
   JOIN public.classrooms classroom ON classroom.id=course.classroom_id AND classroom.tenant_id=course.tenant_id AND classroom.status<>'deleted'
   JOIN public.classroom_student_seats seat ON seat.classroom_id=course.classroom_id AND seat.tenant_id=course.tenant_id
   WHERE course.id=p_run AND seat.id=p_seat AND course.status='open'
   AND public.classroom_participant_allowed(p_actor,course.classroom_id,p_seat)
   AND (
     public.learning_course_seat_visible(p_seat,p_run)
     OR (seat.status='issued' AND public.classroom_journal_teacher(p_actor,course.classroom_id)
       AND (course.creation_request_id IS NULL OR EXISTS (
         SELECT 1 FROM public.course_enrollments enrollment
         JOIN public.learner_identity_links link ON link.learner_identity_id=enrollment.learner_identity_id
           AND link.tenant_id=enrollment.tenant_id AND link.school_id=enrollment.school_id
           AND link.link_kind='student_seat' AND link.seat_id=seat.id AND link.status='active' AND link.disabled_at IS NULL
         JOIN public.learner_identities learner ON learner.id=link.learner_identity_id AND learner.state='active'
         WHERE enrollment.course_run_id=course.id AND enrollment.tenant_id=course.tenant_id
           AND enrollment.school_id=classroom.school_id AND enrollment.status IN ('assigned','active')
       )))
   )
 );
$$;
REVOKE ALL ON FUNCTION public.classroom_participant_course_visible(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_participant_course_visible(uuid,uuid,uuid) TO asalab_app;

CREATE OR REPLACE FUNCTION classroom_participant_assignments(p_actor uuid,p_class uuid,p_seat uuid,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH scope AS MATERIALIZED (
   SELECT s.* FROM public.classroom_student_seats s
   WHERE s.id=p_seat AND s.classroom_id=p_class
     AND public.classroom_participant_allowed(p_actor,p_class,p_seat)
 ), candidates AS (
   SELECT a.id,a.created_at,COALESCE(v.title,t.title,l.assignment_title,q.title) title,
     CASE WHEN q.id IS NOT NULL THEN 'quiz' ELSE 'project' END kind,
     COALESCE(v.module_key,t.module_key,l.module_key) module_key,a.due_at,
     a.id assignment_id,a.course_run_id,run.id activity_run_id,NULL::timestamptz completed_at
   FROM scope s
   JOIN public.classroom_assignments a ON a.classroom_id=s.classroom_id AND a.tenant_id=s.tenant_id AND a.status='open'
   LEFT JOIN public.activity_runs run ON run.source_classroom_assignment_id=a.id AND run.tenant_id=a.tenant_id
   LEFT JOIN public.learning_activity_versions v ON v.id=COALESCE(run.learning_activity_version_id,a.learning_activity_version_id) AND v.tenant_id=a.tenant_id
   LEFT JOIN public.teacher_assignments t ON t.id=a.assignment_id AND t.tenant_id=a.tenant_id
   LEFT JOIN public.classroom_course_run_lessons l ON l.classroom_assignment_id=a.id AND l.tenant_id=a.tenant_id
   LEFT JOIN public.quiz_versions q ON q.id=a.quiz_version_id AND q.tenant_id=a.tenant_id
   WHERE ((run.id IS NULL AND a.learning_activity_version_id IS NULL) OR (run.lifecycle_status='active' AND EXISTS (
     SELECT 1 FROM public.activity_participations participation
     JOIN public.learner_identity_links link ON link.learner_identity_id=participation.learner_identity_id
       AND link.tenant_id=participation.tenant_id AND link.school_id=participation.school_id
       AND link.seat_id=s.id AND link.link_kind='student_seat' AND link.status='active' AND link.disabled_at IS NULL
     JOIN public.learner_identities learner ON learner.id=link.learner_identity_id AND learner.state='active'
     WHERE participation.activity_run_id=run.id AND participation.tenant_id=a.tenant_id
       AND participation.status IN('assigned','active')
       AND (participation.source_course_enrollment_id IS NULL OR EXISTS (
         SELECT 1 FROM public.course_enrollments enrollment WHERE enrollment.id=participation.source_course_enrollment_id
           AND enrollment.tenant_id=a.tenant_id AND enrollment.school_id=participation.school_id
           AND enrollment.status IN('assigned','active')))
   )))
   AND (a.course_run_id IS NULL OR EXISTS (
     SELECT 1 FROM public.classroom_course_runs course WHERE course.id=a.course_run_id
       AND course.tenant_id=a.tenant_id AND course.classroom_id=p_class AND course.status='open'
       AND public.classroom_participant_course_visible(p_actor,p_seat,course.id)))
   AND (a.course_run_id IS NOT NULL OR public.learning_direct_assignment_seat_visible(p_seat,a.id))
   UNION ALL
   -- Theory has no classroom handout/project: its pinned lesson is the identity.
   SELECT l.id,course.created_at,l.title,'theory',NULL,course.due_at,
     NULL,course.id,NULL,progress.completed_at
   FROM scope s
   JOIN public.classroom_course_runs course ON course.classroom_id=s.classroom_id AND course.tenant_id=s.tenant_id AND course.status='open'
   JOIN public.classroom_course_run_lessons l ON l.run_id=course.id AND l.tenant_id=course.tenant_id AND l.kind='material'
   LEFT JOIN public.classroom_course_lesson_progress progress ON progress.run_id=course.id AND progress.lesson_id=l.id AND progress.seat_id=s.id
   WHERE public.classroom_participant_course_visible(p_actor,p_seat,course.id)
 ), unique_items AS MATERIALIZED (
   SELECT DISTINCT ON(id) * FROM candidates ORDER BY id,created_at
 ), page AS MATERIALIZED (
   SELECT * FROM unique_items ORDER BY created_at DESC,id OFFSET p_offset LIMIT 31
 ), evidence AS MATERIALIZED (
   SELECT DISTINCT ON(e.evidence->>'classroomAssignmentId') e.evidence || jsonb_build_object('projectId',(
     SELECT origin.project_id FROM public.learning_project_origins origin
     WHERE origin.activity_run_id=page.activity_run_id AND origin.school_tenant_id=(e.evidence->>'tenantId')::uuid
       AND origin.learner_identity_id=(e.evidence->>'learnerId')::uuid
       AND EXISTS(SELECT 1 FROM public.project_context_for_principal(p_actor,origin.project_id))
     ORDER BY origin.project_id LIMIT 1
   )) evidence
   FROM public.learning_canonical_evidence_internal(p_class,p_seat,true) e
   JOIN page ON page.assignment_id=(e.evidence->>'classroomAssignmentId')::uuid
   WHERE (e.evidence->>'seatId')::uuid=p_seat
     AND EXISTS(SELECT 1 FROM public.learner_identity_links link
       WHERE link.seat_id=p_seat AND link.link_kind='student_seat'
         AND link.status='active' AND link.disabled_at IS NULL
         AND link.tenant_id=(e.evidence->>'tenantId')::uuid AND link.school_id=(e.evidence->>'schoolId')::uuid
         AND link.learner_identity_id=(e.evidence->>'learnerId')::uuid)
   ORDER BY e.evidence->>'classroomAssignmentId',e.evidence->>'learnerId' NULLS LAST
 ), visible_page AS (SELECT * FROM page ORDER BY created_at DESC,id LIMIT 30)
 SELECT jsonb_build_object('offset',p_offset,'nextOffset',CASE WHEN (SELECT count(*) FROM page)>30 THEN p_offset+30 END,
   'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
     'id',p.id,'title',p.title,'kind',p.kind,'moduleKey',p.module_key,'dueAt',p.due_at,
     'assignmentId',p.assignment_id,'courseRunId',p.course_run_id,'activityRunId',p.activity_run_id,
     'completedAt',p.completed_at,'evidence',e.evidence
   ) ORDER BY p.created_at DESC,p.id)
   FROM visible_page p LEFT JOIN evidence e ON (e.evidence->>'classroomAssignmentId')::uuid=p.assignment_id),'[]'::jsonb))
 WHERE EXISTS(SELECT 1 FROM scope) AND p_offset BETWEEN 0 AND 100000;
$$;
