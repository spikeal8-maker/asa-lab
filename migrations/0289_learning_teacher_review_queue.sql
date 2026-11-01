-- Exact teacher queue metadata. Read only: existing canonical result selection and
-- review commands remain authoritative; no Project document is exposed here.
CREATE FUNCTION public.learning_teacher_review_queue(p_account uuid,p_class uuid,p_assignment uuid)
RETURNS TABLE(detail jsonb,evidence jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 WITH canonical AS MATERIALIZED (
   SELECT item.evidence FROM public.learning_canonical_evidence_for_teacher(p_account,p_class) item
    WHERE item.evidence->>'classroomAssignmentId'=p_assignment::text
 ), runs AS (
   SELECT run.*,row_number() OVER(ORDER BY run.created_at,run.id) AS distribution_number
     FROM public.activity_runs run
     JOIN public.classroom_assignments assignment ON assignment.id=run.source_classroom_assignment_id
       AND assignment.tenant_id=run.tenant_id AND assignment.classroom_id=run.classroom_id
    WHERE run.classroom_id=p_class AND assignment.id=p_assignment
      AND EXISTS(SELECT 1 FROM public.classroom_memberships membership
        WHERE membership.account_id=p_account AND membership.classroom_id=p_class
          AND membership.member_role IN ('owner','co_teacher'))
 )
 SELECT jsonb_build_object(
   'seatId',seat.id,'displayLabel',seat.display_label,'assignmentId',p_assignment,
   'activityRunId',run.id,'activityVersionId',run.learning_activity_version_id,
   'title',version.title,'createdAt',run.created_at,
   'originAvailable',run.source_kind='direct' OR (course.id IS NOT NULL AND lesson.id IS NOT NULL
     AND (run.source_course_block_id IS NULL OR block.matches=1)),
   'originLabel',CASE WHEN run.source_kind='direct' THEN
      'Отдельная выдача '||run.distribution_number||' · '||to_char(run.created_at AT TIME ZONE 'UTC','DD.MM.YYYY HH24:MI:SS')||' UTC'
     WHEN course.id IS NOT NULL AND lesson.id IS NOT NULL
       AND (run.source_course_block_id IS NULL OR block.matches=1) THEN
       course.title||' / '||lesson.section_title||' / '||lesson.title||' / '||
       CASE WHEN run.source_course_block_id IS NULL THEN 'Задание урока'
         ELSE 'Блок '||block.position END
     ELSE 'Происхождение практики недоступно' END),
   canonical.evidence || jsonb_build_object('legacyWork',NULL,'projectId',NULL,'courseProgressPresent',false,'attempt',
     CASE WHEN attempt.id IS NULL THEN NULL ELSE jsonb_build_object(
       'id',attempt.id,'attemptNumber',attempt.attempt_number,
       'revisionOfAttemptId',attempt.revision_of_attempt_id,'state',attempt.state,
       'reviewDecision',review.review_decision,'startedAt',attempt.started_at,
       'submittedAt',attempt.submitted_at,'lateState',submission.late_state) END)
 FROM runs run
 JOIN public.learning_activity_versions version ON version.id=run.learning_activity_version_id
   AND version.tenant_id=run.tenant_id AND version.kind='project'
 JOIN public.activity_participations part ON part.activity_run_id=run.id
   AND part.tenant_id=run.tenant_id AND part.school_id=run.school_id
 JOIN public.learner_identity_links link ON link.learner_identity_id=part.learner_identity_id
   AND link.tenant_id=run.tenant_id AND link.school_id=run.school_id AND link.status='active'
 JOIN public.classroom_student_seats seat ON seat.id=link.seat_id
   AND seat.tenant_id=run.tenant_id AND seat.classroom_id=p_class
 JOIN canonical ON canonical.evidence->>'seatId'=seat.id::text
   AND canonical.evidence->>'activityRunId'=run.id::text
 LEFT JOIN public.classroom_course_runs course ON course.id=run.source_course_run_id
   AND course.tenant_id=run.tenant_id AND course.classroom_id=p_class
 LEFT JOIN public.classroom_course_run_lessons lesson ON lesson.id=run.source_course_lesson_id
   AND lesson.tenant_id=run.tenant_id AND lesson.run_id=course.id
 LEFT JOIN LATERAL (
   SELECT count(*) AS matches,min(item.ordinality) AS position
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(lesson.blocks)='array'
     THEN lesson.blocks ELSE '[]'::jsonb END) WITH ORDINALITY item(value,ordinality)
   WHERE item.value->>'id'=run.source_course_block_id AND item.value->>'type'='activity'
     AND item.value->>'learningActivityVersionId'=run.learning_activity_version_id::text
 ) block ON true
 LEFT JOIN LATERAL (
   SELECT item.* FROM public.learning_attempts item
    WHERE item.activity_participation_id=part.id AND item.tenant_id=run.tenant_id
      AND item.learner_identity_id=part.learner_identity_id AND item.classroom_id=p_class
      AND item.classroom_assignment_id=p_assignment
      AND item.learning_activity_version_id=run.learning_activity_version_id
    ORDER BY item.attempt_number DESC,item.id DESC LIMIT 1
 ) attempt ON true
 LEFT JOIN LATERAL (
   SELECT item.review_decision FROM public.assessment_results item WHERE item.attempt_id=attempt.id
    ORDER BY item.revision_number DESC LIMIT 1
 ) review ON true
 LEFT JOIN public.learning_submissions submission ON submission.attempt_id=attempt.id
   AND submission.tenant_id=run.tenant_id
 ORDER BY run.created_at,run.id,seat.id;
$$;
REVOKE ALL ON FUNCTION public.learning_teacher_review_queue(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_teacher_review_queue(uuid,uuid,uuid) TO asalab_app;
