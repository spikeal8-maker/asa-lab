-- E1 selected-result / gradebook projection convergence.
-- gradebook_entries is a compatibility projection + stable audit anchor, never academic truth.
ALTER TABLE public.gradebook_entries
  ALTER COLUMN accepted_attempt_id DROP NOT NULL,
  ALTER COLUMN assessment_result_id DROP NOT NULL;

COMMENT ON COLUMN public.gradebook_entries.accepted_attempt_id IS
  'Compatibility projection of the canonical selected Attempt; NULL when resolver selects no result.';
COMMENT ON COLUMN public.gradebook_entries.assessment_result_id IS
  'Compatibility projection of the canonical selected Result revision; NULL when resolver selects no result.';

-- Reconcile existing canonical projection rows without deleting the stable row referenced by grade_change_events.
WITH resolved AS (
  SELECT DISTINCT ON (grade.id)
    grade.id AS gradebook_entry_id,
    selected.attempt_id,
    selected.result_id
  FROM public.gradebook_entries grade
  JOIN public.activity_runs run
    ON run.source_classroom_assignment_id=grade.classroom_assignment_id
  LEFT JOIN public.learner_identity_links link
    ON link.seat_id=grade.seat_id
   AND link.tenant_id=grade.tenant_id
   AND link.school_id=grade.school_id
   AND link.link_kind='student_seat'
   -- Link status gates current access, not historical academic lineage.
  LEFT JOIN public.activity_participations part
    ON part.activity_run_id=run.id
   AND part.learner_identity_id=link.learner_identity_id
  LEFT JOIN LATERAL public.learning_selected_result_internal(part.id) selected ON true
  ORDER BY grade.id,part.id
)
UPDATE public.gradebook_entries grade
SET accepted_attempt_id=resolved.attempt_id,
    assessment_result_id=resolved.result_id,
    updated_at=now()
FROM resolved
WHERE grade.id=resolved.gradebook_entry_id
  AND (grade.accepted_attempt_id IS DISTINCT FROM resolved.attempt_id
    OR grade.assessment_result_id IS DISTINCT FROM resolved.result_id);

CREATE OR REPLACE FUNCTION learning_gradebook_projection_sync_internal(
  p_participation_id uuid,
  p_actor_principal_id uuid,
  p_trigger_result_id uuid,
  p_reason varchar
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_scope record;
  v_selected record;
  v_grade record;
  v_gradebook_id uuid;
  v_event_result_id uuid;
  v_changed boolean:=false;
  v_created boolean:=false;
BEGIN
  SELECT part.tenant_id,part.school_id,run.classroom_id,
         run.source_classroom_assignment_id AS assignment_id,
         classroom.academic_period_id,seat.id AS seat_id
    INTO v_scope
    FROM public.activity_participations part
    JOIN public.activity_runs run ON run.id=part.activity_run_id
    JOIN public.classrooms classroom ON classroom.id=run.classroom_id
    JOIN public.learner_identity_links link
      ON link.tenant_id=part.tenant_id
     AND link.school_id=part.school_id
     AND link.learner_identity_id=part.learner_identity_id
     AND link.link_kind='student_seat'
     -- Link status gates current access, not historical academic lineage.
    JOIN public.classroom_student_seats seat
      ON seat.id=link.seat_id AND seat.classroom_id=run.classroom_id
   WHERE part.id=p_participation_id
     AND run.source_classroom_assignment_id IS NOT NULL
   ORDER BY CASE WHEN seat.status='active' THEN 0 ELSE 1 END,seat.id
   LIMIT 1;
  IF v_scope.assignment_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_selected
    FROM public.learning_selected_result_internal(p_participation_id);
  SELECT * INTO v_grade
    FROM public.gradebook_entries grade
   WHERE grade.classroom_assignment_id=v_scope.assignment_id
     AND grade.seat_id=v_scope.seat_id
   FOR UPDATE;

  IF v_selected.result_id IS NOT NULL THEN
    IF v_grade.id IS NULL THEN
      INSERT INTO public.gradebook_entries(
        tenant_id,school_id,academic_period_id,classroom_id,
        classroom_assignment_id,seat_id,accepted_attempt_id,
        assessment_result_id,published_by_principal_id)
      VALUES(v_scope.tenant_id,v_scope.school_id,v_scope.academic_period_id,v_scope.classroom_id,
        v_scope.assignment_id,v_scope.seat_id,v_selected.attempt_id,v_selected.result_id,p_actor_principal_id)
      RETURNING id INTO v_gradebook_id;
      v_created:=true; v_changed:=true;
    ELSE
      v_gradebook_id:=v_grade.id;
      IF v_grade.accepted_attempt_id IS DISTINCT FROM v_selected.attempt_id
         OR v_grade.assessment_result_id IS DISTINCT FROM v_selected.result_id THEN
        UPDATE public.gradebook_entries
           SET accepted_attempt_id=v_selected.attempt_id,
               assessment_result_id=v_selected.result_id,
               published_by_principal_id=p_actor_principal_id,
               updated_at=now()
         WHERE id=v_grade.id;
        v_changed:=true;
      END IF;
    END IF;
  ELSE
    IF v_grade.id IS NULL THEN RETURN NULL; END IF;
    v_gradebook_id:=v_grade.id;
    IF v_grade.accepted_attempt_id IS NOT NULL OR v_grade.assessment_result_id IS NOT NULL THEN
      UPDATE public.gradebook_entries
         SET accepted_attempt_id=NULL,
             assessment_result_id=NULL,
             published_by_principal_id=p_actor_principal_id,
             updated_at=now()
       WHERE id=v_grade.id;
      v_changed:=true;
    END IF;
  END IF;

  v_event_result_id:=COALESCE(p_trigger_result_id,v_selected.result_id);
  IF v_changed AND v_event_result_id IS NOT NULL THEN
    INSERT INTO public.grade_change_events(
      tenant_id,gradebook_entry_id,assessment_result_id,actor_principal_id,event_kind,reason,snapshot)
    VALUES(v_scope.tenant_id,v_gradebook_id,v_event_result_id,p_actor_principal_id,
      CASE WHEN v_created THEN 'published' ELSE 'corrected' END,
      COALESCE(NULLIF(trim(p_reason),''),'????????????? ?????????? ??????????'),
      jsonb_build_object(
        'participationId',p_participation_id,
        'triggerResultRevisionId',p_trigger_result_id,
        'selectedAttemptId',v_selected.attempt_id,
        'selectedResultRevisionId',v_selected.result_id,
        'policy',v_selected.policy,
        'projectionCleared',v_selected.result_id IS NULL));
  END IF;
  RETURN v_gradebook_id;
END;
$$;
REVOKE ALL ON FUNCTION learning_gradebook_projection_sync_internal(uuid,uuid,uuid,varchar) FROM PUBLIC,asalab_app;


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
BEGIN
 SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id,p_classroom_id);
 IF v_access.user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.principals
   WHERE id=p_reviewer_principal_id AND account_id=p_account_id AND kind='account') THEN
   RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 PERFORM set_config('app.tenant_id',v_access.tenant_id::text,true);
 PERFORM 1 FROM public.activity_participations participation
   JOIN public.learning_attempts attempt ON attempt.activity_participation_id=participation.id
   WHERE attempt.id=p_attempt_id AND attempt.classroom_id=p_classroom_id
     AND attempt.tenant_id=v_access.tenant_id FOR UPDATE OF participation;
 SELECT attempt.*,version.max_points,version.result_mode,version.policy_snapshot,
   classroom.school_id,classroom.academic_period_id
 INTO v_attempt FROM public.learning_attempts attempt
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
 OR (v_prior.id IS NOT NULL AND p_decision='changes_requested') THEN
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
 -- Closing time is immutable across corrections; this is NOT a new learner action.
 IF v_prior.id IS NULL THEN
   UPDATE public.learning_attempts SET state='closed',evaluated_at=now() WHERE id=p_attempt_id;
   IF p_decision='changes_requested' THEN
     UPDATE public.activity_participations SET extra_attempts=extra_attempts+1 WHERE id=v_attempt.activity_participation_id;
     UPDATE public.classroom_assignment_work SET submitted_at=NULL
       WHERE assignment_id=v_attempt.classroom_assignment_id AND seat_id=v_attempt.seat_id;
   END IF;
 END IF;
 SELECT public.learning_gradebook_projection_sync_internal(
   v_attempt.activity_participation_id,p_reviewer_principal_id,v_result,
   COALESCE(NULLIF(trim(p_reason),''),'????????? ????????')
 ) INTO v_gradebook;
 RETURN QUERY SELECT 'ok'::varchar,v_result,v_gradebook,
   'closed'::varchar,v_percentage;
END;
$$;

CREATE OR REPLACE FUNCTION learning_teacher_select_attempt(
  p_account uuid,p_principal uuid,p_class uuid,p_participation uuid,
  p_attempt uuid,p_expected uuid,p_reason varchar,p_request varchar
)
RETURNS varchar LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_part record; v_prior jsonb;
BEGIN
 SELECT part.*,run.classroom_id,version.result_mode,version.policy_snapshot INTO v_part
 FROM public.activity_participations part JOIN public.activity_runs run ON run.id=part.activity_run_id
 JOIN public.learning_activity_versions version ON version.id=run.learning_activity_version_id
 WHERE part.id=p_participation AND run.classroom_id=p_class
   AND EXISTS(SELECT 1 FROM public.classroom_memberships m JOIN public.principals actor ON actor.account_id=m.account_id
     WHERE m.classroom_id=p_class AND m.account_id=p_account AND m.member_role IN ('owner','co_teacher') AND actor.id=p_principal)
 FOR UPDATE OF part;
 IF v_part.id IS NULL THEN RETURN 'forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM public.learner_identity_links link WHERE link.learner_identity_id=v_part.learner_identity_id
   AND link.account_id=p_account AND link.status='active') THEN RETURN 'self_review_forbidden'; END IF;
 IF v_part.result_mode<>'graded' OR v_part.policy_snapshot#>>'{resultSelectionPolicy,mode}'<>'teacher_selected'
   OR p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$'
   OR length(trim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 1000 THEN RETURN 'invalid_selection'; END IF;
 SELECT payload_json INTO v_prior FROM public.audit_events WHERE entity_id=p_participation
   AND action='learning.result.selected' AND payload_json->>'requestId'=p_request LIMIT 1;
 IF v_prior IS NOT NULL THEN
   IF v_prior->>'attemptId'=p_attempt::text AND v_prior->>'actorPrincipalId'=p_principal::text
     AND v_prior->>'reason'=p_reason AND (v_prior->>'expectedAttemptId') IS NOT DISTINCT FROM p_expected::text THEN RETURN 'ok'; END IF;
   RETURN 'request_conflict';
 END IF;
 IF v_part.teacher_selected_attempt_id IS DISTINCT FROM p_expected THEN RETURN 'selection_conflict'; END IF;
 IF NOT EXISTS(
   SELECT 1 FROM public.learning_attempts attempt
   JOIN LATERAL (
     SELECT result.id,result.review_decision FROM public.assessment_results result
      WHERE result.attempt_id=attempt.id ORDER BY result.revision_number DESC LIMIT 1
   ) latest ON true
   WHERE attempt.id=p_attempt AND attempt.activity_participation_id=p_participation
     AND attempt.state='closed' AND attempt.evaluated_at IS NOT NULL
     AND attempt.invalidated_at IS NULL AND latest.id IS NOT NULL AND latest.review_decision IS NOT NULL
 ) THEN RETURN 'invalid_attempt'; END IF;
 UPDATE public.activity_participations SET teacher_selected_attempt_id=p_attempt WHERE id=p_participation;
 PERFORM public.learning_gradebook_projection_sync_internal(p_participation,p_principal,NULL,p_reason);
 INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
 VALUES(v_part.tenant_id,NULL,'activity_participation',p_participation,'learning.result.selected',
   jsonb_build_object('actorPrincipalId',p_principal,'attemptId',p_attempt,'expectedAttemptId',p_expected,'reason',p_reason,'requestId',p_request));
 RETURN 'ok';
END;
$$;
