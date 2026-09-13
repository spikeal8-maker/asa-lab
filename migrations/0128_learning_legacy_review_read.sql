-- Retain existing legacy quiz/manual review without treating unknown migration defaults as grades.
CREATE OR REPLACE FUNCTION learning_teacher_legacy_review_context(p_account uuid,p_class uuid,p_assignment uuid,p_seat uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('attemptId',attempt.id,'state',attempt.state,'maxPoints',version.max_points,
   'submission',submission.payload_manifest,'feedback',result.feedback)
 FROM public.learning_attempts attempt JOIN public.learning_activity_versions version ON version.id=attempt.learning_activity_version_id
 LEFT JOIN public.learning_submissions submission ON submission.attempt_id=attempt.id
 LEFT JOIN public.assessment_results result ON result.attempt_id=attempt.id
 WHERE attempt.classroom_id=p_class AND attempt.classroom_assignment_id=p_assignment AND attempt.seat_id=p_seat
   AND attempt.activity_participation_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM public.learning_migration_compatibility_activity_versions compatibility
     WHERE compatibility.learning_activity_version_id=version.id AND compatibility.grading_semantics='unknown')
   AND EXISTS(SELECT 1 FROM public.classroom_memberships m WHERE m.classroom_id=p_class AND m.account_id=p_account AND m.member_role IN ('owner','co_teacher'))
 ORDER BY attempt.attempt_number DESC,result.revision_number DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION learning_teacher_legacy_review_context(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_teacher_legacy_review_context(uuid,uuid,uuid,uuid) TO asalab_app;
