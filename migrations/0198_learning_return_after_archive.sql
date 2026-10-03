-- V4: append-only correction that restores learner attention after archival.
CREATE OR REPLACE FUNCTION learning_attempt_review_v2(
 p_account_id uuid,p_reviewer_principal_id uuid,p_classroom_id uuid,p_attempt_id uuid,
 p_decision varchar,p_points integer,p_feedback varchar,p_reason varchar,
 p_expected_result_id uuid,p_request_id varchar
)
RETURNS TABLE(result_code varchar,assessment_result_id uuid,gradebook_entry_id uuid,
 attempt_state varchar,percentage_basis_points integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_access record; v_attempt record; v_prior record; v_retry record;
 v_result uuid; v_gradebook uuid; v_percentage integer; v_digest varchar;
 v_effective jsonb;
BEGIN
 SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id,p_classroom_id);
 IF v_access.user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.principals
   WHERE id=p_reviewer_principal_id AND account_id=p_account_id AND kind='account') THEN
   RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 PERFORM set_config('app.tenant_id',v_access.tenant_id::text,true);
 -- Use the same Run -> capability -> Participation lock order as Start.
 -- A concurrent conditions/capability change must finish before we decide
 -- whether this review can create a real learner action.
 IF p_decision='changes_requested' THEN
   PERFORM 1 FROM public.learning_attempts attempt
     JOIN public.activity_participations participation
       ON participation.id=attempt.activity_participation_id
       AND participation.tenant_id=attempt.tenant_id
     JOIN public.activity_runs run ON run.id=participation.activity_run_id
       AND run.tenant_id=participation.tenant_id
     JOIN public.learning_activity_versions version
       ON version.id=run.learning_activity_version_id
       AND version.tenant_id=run.tenant_id
     JOIN public.module_learning_capabilities capability
       ON capability.module_key=version.module_key
     WHERE attempt.id=p_attempt_id AND attempt.classroom_id=p_classroom_id
       AND attempt.tenant_id=v_access.tenant_id
     FOR SHARE OF run,capability;
 END IF;
 PERFORM 1 FROM public.activity_participations participation
   JOIN public.learning_attempts attempt ON attempt.activity_participation_id=participation.id
   WHERE attempt.id=p_attempt_id AND attempt.classroom_id=p_classroom_id
     AND attempt.tenant_id=v_access.tenant_id FOR UPDATE OF participation;
 SELECT attempt.*,part.activity_run_id,version.max_points,version.result_mode,version.policy_snapshot,
   classroom.school_id,classroom.academic_period_id
 INTO v_attempt FROM public.learning_attempts attempt
 JOIN public.activity_participations part ON part.id=attempt.activity_participation_id
   AND part.tenant_id=attempt.tenant_id
 JOIN public.learning_activity_versions version ON version.id=attempt.learning_activity_version_id
 JOIN public.classrooms classroom ON classroom.id=attempt.classroom_id
 WHERE attempt.id=p_attempt_id AND attempt.classroom_id=p_classroom_id
   AND attempt.tenant_id=v_access.tenant_id AND attempt.activity_participation_id IS NOT NULL
   AND EXISTS(SELECT 1 FROM public.learning_activities activity WHERE activity.id=version.activity_id AND activity.reusable_authored_content)
   AND EXISTS(SELECT 1 FROM public.learning_submissions submission WHERE submission.attempt_id=attempt.id)
 FOR UPDATE OF attempt;
 IF v_attempt.id IS NULL THEN
   RETURN QUERY SELECT 'attempt_not_found'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM public.classroom_student_seats seat WHERE seat.id=v_attempt.seat_id AND seat.account_id=p_account_id)
 OR EXISTS(SELECT 1 FROM public.learner_identity_links link WHERE link.learner_identity_id=v_attempt.learner_identity_id
   AND link.account_id=p_account_id AND link.status='active') THEN
   RETURN QUERY SELECT 'self_review_forbidden'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$'
 OR p_decision IS NULL OR p_decision NOT IN ('accepted','changes_requested','incomplete','excused')
 OR length(COALESCE(p_feedback,''))>8000 OR length(COALESCE(p_reason,''))>1000 THEN
   RETURN QUERY SELECT 'invalid_review'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 v_digest:=encode(public.digest(convert_to(jsonb_build_array(p_attempt_id,p_reviewer_principal_id,p_decision,
   p_points,p_feedback,p_reason,p_expected_result_id)::text,'UTF8'),'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(v_access.tenant_id::text||p_request_id,1112));
 SELECT * INTO v_retry FROM public.assessment_results WHERE tenant_id=v_access.tenant_id AND client_request_id=p_request_id;
 IF v_retry.id IS NOT NULL THEN
   RETURN QUERY SELECT CASE WHEN v_retry.request_digest=v_digest THEN 'ok' ELSE 'request_conflict' END::varchar,
     CASE WHEN v_retry.request_digest=v_digest THEN v_retry.id END,NULL::uuid,
     CASE WHEN v_retry.request_digest=v_digest THEN 'closed' END::varchar,
     CASE WHEN v_retry.request_digest=v_digest THEN v_retry.percentage_basis_points END; RETURN;
 END IF;
 SELECT * INTO v_prior FROM public.assessment_results WHERE attempt_id=p_attempt_id ORDER BY revision_number DESC LIMIT 1;
 IF v_prior.id IS DISTINCT FROM p_expected_result_id THEN
   RETURN QUERY SELECT 'result_revision_conflict'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 IF v_attempt.state='invalidated'
 OR (v_prior.id IS NULL AND v_attempt.state NOT IN ('submitted','evaluating'))
 OR (v_prior.id IS NOT NULL AND p_decision='changes_requested'
     AND (v_attempt.state <> 'closed' OR v_prior.review_decision IS DISTINCT FROM 'accepted')) THEN
   RETURN QUERY SELECT 'invalid_transition'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 -- A return grants a real learner action. Correct only the current exact
 -- Attempt while its source is still open and its learner still has access.
 -- A terminal Run/Participation may still be reviewed, but cannot be reopened
 -- through a pedagogical correction or by an archived Project preference.
 IF p_decision='changes_requested' THEN
   v_effective:=public.learning_effective_conditions_internal(
     v_attempt.activity_run_id,v_attempt.activity_participation_id);
   -- Admission and Submit use these same effective conditions. A review must
   -- not surface an archived Project as actionable while Continue is closed.
   IF v_effective IS NULL
     OR (v_effective#>>'{values,opensAt}')::timestamptz>now()
     OR (v_effective#>>'{values,closesAt}')::timestamptz<now()
     OR ((v_effective#>>'{values,dueAt}')::timestamptz<now()
       AND v_effective#>>'{values,latePolicy}'='block_at_due'
       AND v_effective->>'teacherUnlocked' IS DISTINCT FROM 'true') THEN
     RETURN QUERY SELECT 'invalid_transition'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
   END IF;
 END IF;
 IF p_decision='changes_requested' AND (
   EXISTS (SELECT 1 FROM public.learning_attempts later
     WHERE later.activity_participation_id=v_attempt.activity_participation_id
       AND later.id<>p_attempt_id
       AND later.attempt_number>=v_attempt.attempt_number)
   OR NOT EXISTS (
     SELECT 1 FROM public.activity_participations part
     JOIN public.activity_runs run ON run.id=part.activity_run_id
       AND run.tenant_id=part.tenant_id AND run.school_id=part.school_id
     JOIN public.classrooms room ON room.id=run.classroom_id
       AND room.tenant_id=run.tenant_id AND room.school_id=run.school_id
     JOIN public.classroom_assignments assignment
       ON assignment.id=run.source_classroom_assignment_id
       AND assignment.tenant_id=run.tenant_id
       AND assignment.classroom_id=run.classroom_id
     JOIN public.classroom_student_seats seat
       ON seat.id=v_attempt.seat_id AND seat.tenant_id=run.tenant_id
       AND seat.classroom_id=run.classroom_id
     JOIN public.learning_activity_versions version
       ON version.id=run.learning_activity_version_id
       AND version.tenant_id=run.tenant_id
     JOIN public.module_learning_capabilities capability
       ON capability.module_key=version.module_key
     JOIN public.learner_identity_links seat_link
       ON seat_link.seat_id=seat.id AND seat_link.status='active'
       AND seat_link.link_kind='student_seat'
       AND seat_link.tenant_id=part.tenant_id AND seat_link.school_id=part.school_id
       AND seat_link.learner_identity_id=part.learner_identity_id
     WHERE part.id=v_attempt.activity_participation_id
       AND part.tenant_id=v_attempt.tenant_id
       AND part.learner_identity_id=v_attempt.learner_identity_id
       AND part.status='active' AND NOT part.excused
       AND run.lifecycle_status='active'
       AND run.classroom_id=p_classroom_id
       AND run.learning_activity_version_id=v_attempt.learning_activity_version_id
       AND run.source_classroom_assignment_id=v_attempt.classroom_assignment_id
       AND room.status='active' AND assignment.status='open'
       AND seat.status='active'
       AND capability.creatable AND capability.assignable
       AND capability.editable_evidence AND capability.submit_project_version
       -- Older first reviews may still return work without a Project origin;
       -- a correction of an accepted Attempt must have an exact Project.
       AND ((v_prior.id IS NULL AND NOT EXISTS (
              SELECT 1 FROM public.learning_project_origins origin
              WHERE origin.participation_id=part.id))
         OR EXISTS (
           SELECT 1 FROM public.learning_project_origins origin
           JOIN public.projects project ON project.id=origin.project_id
             AND project.tenant_id=origin.project_tenant_id
             AND project.owner_principal_id=origin.owner_principal_id
           JOIN public.principals owner ON owner.id=origin.owner_principal_id
           WHERE origin.participation_id=part.id AND origin.activity_run_id=run.id
             AND origin.learner_identity_id=part.learner_identity_id
             AND project.project_scope='personal' AND project.status='active'
             AND project.module_key=version.module_key
             AND ((owner.kind='student_seat' AND owner.seat_id=seat.id)
               OR (owner.kind='account' AND owner.account_id=seat.account_id
                 AND EXISTS (
                   SELECT 1 FROM public.accounts account
                   JOIN public.learner_identity_links account_link
                     ON account_link.account_id=account.id
                     AND account_link.tenant_id=part.tenant_id
                     AND account_link.school_id=part.school_id
                     AND account_link.learner_identity_id=part.learner_identity_id
                     AND account_link.link_kind='account'
                     AND account_link.status='active'
                   WHERE account.id=seat.account_id AND account.status='active')))))
       AND ((run.source_kind='direct'
             AND assignment.course_run_id IS NULL
             AND public.learning_direct_assignment_seat_visible(
               seat.id,assignment.id))
         OR (run.source_kind='course'
             AND EXISTS (
               SELECT 1 FROM public.classroom_course_runs course
               JOIN public.course_enrollments enrollment
                 ON enrollment.id=part.source_course_enrollment_id
                 AND enrollment.tenant_id=part.tenant_id
                 AND enrollment.school_id=part.school_id
                 AND enrollment.course_run_id=course.id
                 AND enrollment.learner_identity_id=part.learner_identity_id
               WHERE course.id=run.source_course_run_id
                 AND course.tenant_id=run.tenant_id
                 AND course.classroom_id=run.classroom_id
                 AND course.status='open'
                 AND assignment.course_run_id=course.id
                 AND enrollment.status IN ('assigned','active')
                 AND public.learning_course_seat_visible(seat.id,course.id)
                 AND EXISTS (
                   SELECT 1 FROM public.classroom_course_run_lessons lesson
                   WHERE lesson.id=run.source_course_lesson_id
                     AND lesson.tenant_id=run.tenant_id
                     AND lesson.run_id=course.id
                     AND ((run.source_course_block_id IS NULL
                       AND lesson.kind='assignment'
                       AND lesson.classroom_assignment_id=assignment.id
                       AND lesson.module_key=version.module_key
                       AND public.learning_course_assignment_lesson_pinned(run.id))
                     OR (run.source_course_block_id IS NOT NULL
                       AND EXISTS (
                         SELECT 1 FROM jsonb_array_elements(lesson.blocks) block
                         WHERE block->>'id'=run.source_course_block_id
                           AND block->>'type'='activity'
                           AND block->'hidden' IS DISTINCT FROM 'true'::jsonb
                           AND block->>'learningActivityVersionId'=version.id::text)))))))
   )) THEN
   RETURN QUERY SELECT 'invalid_transition'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 IF (v_prior.id IS NOT NULL OR p_decision IN ('changes_requested','incomplete','excused'))
   AND length(trim(COALESCE(p_reason,'')))=0 THEN
   RETURN QUERY SELECT 'reason_required'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 IF (p_decision='accepted' AND v_attempt.result_mode='graded'
     AND (p_points IS NULL OR p_points<0 OR p_points>v_attempt.max_points))
 OR ((v_attempt.result_mode<>'graded' OR p_decision<>'accepted') AND p_points IS NOT NULL) THEN
   RETURN QUERY SELECT 'invalid_points'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 v_percentage:=CASE WHEN p_points IS NOT NULL THEN (p_points::bigint*10000/v_attempt.max_points)::integer END;
 INSERT INTO public.learning_evaluations(tenant_id,attempt_id,evaluator_kind,evaluator_principal_id,status,
   points,max_points,feedback,evidence)
 VALUES(v_attempt.tenant_id,p_attempt_id,'teacher',p_reviewer_principal_id,'completed',p_points,
   v_attempt.max_points,p_feedback,jsonb_build_object('decision',p_decision,'requestId',p_request_id,'reason',p_reason));
 INSERT INTO public.assessment_results(tenant_id,attempt_id,raw_points,max_points,percentage_basis_points,
   outcome,manual_points,evaluator_principal_id,feedback,revision_number,supersedes_result_id,
   review_decision,completion_value,client_request_id,request_digest,correction_reason)
 VALUES(v_attempt.tenant_id,p_attempt_id,p_points,v_attempt.max_points,v_percentage,
   CASE WHEN p_decision='accepted' THEN 'passed' WHEN p_decision='excused' THEN 'excused' ELSE 'incomplete' END,
   COALESCE(p_points,0),p_reviewer_principal_id,p_feedback,COALESCE(v_prior.revision_number,0)+1,v_prior.id,
   p_decision,p_decision='accepted',p_request_id,v_digest,p_reason) RETURNING id INTO v_result;
 -- The reviewed Attempt's closing time stays immutable. A return can grant
 -- a new linked revision Attempt, but never reopens this frozen Submission.
 IF v_prior.id IS NULL THEN
   UPDATE public.learning_attempts SET state='closed',evaluated_at=now() WHERE id=p_attempt_id;
 END IF;
 IF p_decision='changes_requested' THEN
   -- A previously returned and then reaccepted Attempt keeps its existing
   -- revision allowance; changing the decision again cannot stack grants.
   IF NOT EXISTS (SELECT 1 FROM public.assessment_results earlier
       WHERE earlier.attempt_id=p_attempt_id AND earlier.id<>v_result
         AND earlier.review_decision='changes_requested') THEN
     UPDATE public.activity_participations SET extra_attempts=extra_attempts+1 WHERE id=v_attempt.activity_participation_id;
   END IF;
   UPDATE public.classroom_assignment_work SET submitted_at=NULL
     WHERE assignment_id=v_attempt.classroom_assignment_id AND seat_id=v_attempt.seat_id;
 END IF;
 SELECT public.learning_gradebook_projection_sync_internal(
   v_attempt.activity_participation_id,p_reviewer_principal_id,v_result,
   COALESCE(NULLIF(trim(p_reason),''),'Проверка работы')
 ) INTO v_gradebook;
 RETURN QUERY SELECT 'ok'::varchar,v_result,v_gradebook,
   'closed'::varchar,v_percentage;
END;
$$;
