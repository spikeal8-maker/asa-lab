-- E1 lifecycle convergence: Attempt stores lifecycle only; pedagogical decisions live in Result revisions.

-- Preserve explicit legacy pedagogical decisions before rewriting Attempt lifecycle state.
ALTER TABLE public.learning_attempts DROP CONSTRAINT learning_attempts_state_check;

-- assessment_results is append-only, including migrations: an existing result is
-- never updated in place. If its latest revision predates explicit review_decision,
-- append a compatibility revision that preserves the old score/evidence and records
-- the pedagogical decision previously stored in Attempt.state.
INSERT INTO public.assessment_results(
  tenant_id,attempt_id,raw_points,max_points,percentage_basis_points,outcome,grade_value,
  auto_points,manual_points,adjustment_points,evaluator_principal_id,feedback,published_at,
  revision_number,supersedes_result_id,review_decision,completion_value,correction_reason
)
SELECT latest.tenant_id,latest.attempt_id,latest.raw_points,latest.max_points,
  latest.percentage_basis_points,latest.outcome,latest.grade_value,latest.auto_points,
  latest.manual_points,latest.adjustment_points,latest.evaluator_principal_id,latest.feedback,
  COALESCE(attempt.evaluated_at,latest.published_at),latest.revision_number+1,latest.id,
  attempt.state,COALESCE(latest.completion_value,attempt.state='accepted'),
  'Migrated legacy Attempt decision during lifecycle convergence'
FROM public.learning_attempts attempt
JOIN LATERAL (
  SELECT result.* FROM public.assessment_results result
  WHERE result.attempt_id=attempt.id
  ORDER BY result.revision_number DESC LIMIT 1
) latest ON true
WHERE attempt.state IN ('accepted','changes_requested','incomplete','excused')
  AND latest.review_decision IS NULL;

-- A few historical changes_requested attempts can exist without an official Result.
-- Create one compatibility Result so the decision remains explicit after lifecycle
-- convergence. No score is invented when no evaluation exists.
INSERT INTO public.assessment_results(
  tenant_id,attempt_id,raw_points,max_points,percentage_basis_points,outcome,
  auto_points,manual_points,adjustment_points,evaluator_principal_id,feedback,published_at,
  revision_number,review_decision,completion_value,correction_reason
)
SELECT attempt.tenant_id,attempt.id,evaluation.points,evaluation.max_points,
  CASE WHEN evaluation.points IS NOT NULL AND evaluation.max_points IS NOT NULL AND evaluation.max_points>0
    THEN (evaluation.points::bigint*10000/evaluation.max_points)::integer END,
  CASE WHEN attempt.state='accepted' THEN 'passed' WHEN attempt.state='excused' THEN 'excused' ELSE 'incomplete' END,
  0,COALESCE(evaluation.points,0),0,evaluation.evaluator_principal_id,evaluation.feedback,
  COALESCE(attempt.evaluated_at,evaluation.created_at,attempt.submitted_at,attempt.started_at),
  1,attempt.state,attempt.state='accepted','Migrated legacy Attempt decision during lifecycle convergence'
FROM public.learning_attempts attempt
LEFT JOIN LATERAL (
  SELECT item.evaluator_principal_id,item.points,item.max_points,item.feedback,item.created_at
  FROM public.learning_evaluations item
  WHERE item.attempt_id=attempt.id
  ORDER BY item.created_at DESC,item.id DESC LIMIT 1
) evaluation ON true
WHERE attempt.state IN ('accepted','changes_requested','incomplete','excused')
  AND NOT EXISTS(SELECT 1 FROM public.assessment_results result WHERE result.attempt_id=attempt.id);

UPDATE public.learning_attempts attempt
SET state='closed',
    evaluated_at=COALESCE(attempt.evaluated_at,(
      SELECT max(result.published_at) FROM public.assessment_results result WHERE result.attempt_id=attempt.id
    ))
WHERE attempt.state IN ('accepted','changes_requested','incomplete','excused');

ALTER TABLE public.learning_attempts ADD CONSTRAINT learning_attempts_state_check CHECK (
  state IN ('in_progress','submitted','evaluating','closed','invalidated','expired')
);


CREATE OR REPLACE FUNCTION learning_selected_result_internal(p_participation_id uuid)
RETURNS TABLE(attempt_id uuid,result_id uuid,policy varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  WITH settings AS (
    SELECT participation.id,participation.teacher_selected_attempt_id,
      CASE WHEN version.result_mode='graded'
        THEN COALESCE(version.policy_snapshot#>>'{resultSelectionPolicy,mode}','latest_accepted')
        ELSE 'latest_accepted' END AS policy
    FROM public.activity_participations participation
    JOIN public.activity_runs run ON run.id=participation.activity_run_id
    JOIN public.learning_activity_versions version ON version.id=run.learning_activity_version_id
    WHERE participation.id=p_participation_id
  ), candidates AS (
    SELECT attempt.id,attempt.attempt_number,attempt.evaluated_at,result.id AS result_id,
      result.percentage_basis_points,result.review_decision AS decision,
      settings.policy,settings.teacher_selected_attempt_id
    FROM settings
    JOIN public.learning_attempts attempt ON attempt.activity_participation_id=settings.id
    LEFT JOIN LATERAL (SELECT revision.* FROM public.assessment_results revision
      WHERE revision.attempt_id=attempt.id ORDER BY revision.revision_number DESC LIMIT 1) result ON true
    WHERE attempt.state='closed'
      AND attempt.invalidated_at IS NULL AND attempt.evaluated_at IS NOT NULL
      AND result.id IS NOT NULL
  )
  SELECT id,result_id,policy::varchar FROM candidates
  WHERE (policy IN ('first','latest'))
     OR (policy='latest_accepted' AND decision='accepted')
     OR (policy='best' AND decision='accepted' AND percentage_basis_points IS NOT NULL)
     OR (policy='teacher_selected' AND id=teacher_selected_attempt_id)
  ORDER BY CASE WHEN policy='first' THEN evaluated_at END ASC,
    CASE WHEN policy='first' THEN attempt_number END ASC,
    CASE WHEN policy='best' THEN percentage_basis_points END DESC NULLS LAST,
    evaluated_at DESC,attempt_number DESC,id DESC LIMIT 1;
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
 INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
 VALUES(v_part.tenant_id,NULL,'activity_participation',p_participation,'learning.result.selected',
   jsonb_build_object('actorPrincipalId',p_principal,'attemptId',p_attempt,'expectedAttemptId',p_expected,'reason',p_reason,'requestId',p_request));
 RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION learning_teacher_select_attempt(uuid,uuid,uuid,uuid,uuid,uuid,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_teacher_select_attempt(uuid,uuid,uuid,uuid,uuid,uuid,varchar,varchar) TO asalab_app;

CREATE OR REPLACE FUNCTION learning_attempt_review_v2(
 p_account_id uuid,p_reviewer_principal_id uuid,p_classroom_id uuid,p_attempt_id uuid,
 p_decision varchar,p_points integer,p_feedback varchar,p_reason varchar,
 p_expected_result_id uuid,p_request_id varchar
)
RETURNS TABLE(result_code varchar,assessment_result_id uuid,gradebook_entry_id uuid,
 attempt_state varchar,percentage_basis_points integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_access record; v_attempt record; v_prior record; v_retry record;
 v_result uuid; v_gradebook uuid; v_percentage integer; v_digest varchar; v_selected record;
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
 SELECT * INTO v_selected FROM public.learning_selected_result_internal(v_attempt.activity_participation_id);
 IF v_selected.result_id IS NOT NULL THEN
   INSERT INTO public.gradebook_entries(tenant_id,school_id,academic_period_id,classroom_id,
     classroom_assignment_id,seat_id,accepted_attempt_id,assessment_result_id,published_by_principal_id)
   VALUES(v_attempt.tenant_id,v_attempt.school_id,v_attempt.academic_period_id,p_classroom_id,
     v_attempt.classroom_assignment_id,v_attempt.seat_id,v_selected.attempt_id,v_selected.result_id,p_reviewer_principal_id)
   ON CONFLICT(classroom_assignment_id,seat_id) DO UPDATE SET accepted_attempt_id=EXCLUDED.accepted_attempt_id,
     assessment_result_id=EXCLUDED.assessment_result_id,published_by_principal_id=EXCLUDED.published_by_principal_id,
     updated_at=now() RETURNING id INTO v_gradebook;
   INSERT INTO public.grade_change_events(tenant_id,gradebook_entry_id,assessment_result_id,actor_principal_id,event_kind,reason,snapshot)
   VALUES(v_attempt.tenant_id,v_gradebook,v_result,p_reviewer_principal_id,
     CASE WHEN v_prior.id IS NULL THEN 'published' ELSE 'corrected' END,
     COALESCE(NULLIF(trim(p_reason),''),'Первичная проверка'),
     jsonb_build_object('attemptId',p_attempt_id,'resultRevisionId',v_result,'selectedAttemptId',v_selected.attempt_id,
       'selectedResultRevisionId',v_selected.result_id,'policy',v_selected.policy));
 END IF;
 RETURN QUERY SELECT 'ok'::varchar,v_result,v_gradebook,
   'closed'::varchar,v_percentage;
END;
$$;

CREATE OR REPLACE FUNCTION learning_direct_project_attempt_start(
    p_actor_principal_id uuid,
    p_seat_id uuid,
    p_assignment_id uuid,
    p_project_id uuid
)
RETURNS TABLE (
    result_code varchar,
    participation_id uuid,
    attempt_id uuid,
    attempt_number integer,
    attempt_state varchar,
    project_id uuid,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_run record;
    v_participation record;
    v_activation record;
    v_work record;
    v_attempt record;
    v_attempt_number integer;
    v_attempt_limit integer;
    v_revision_of uuid;
    v_effective jsonb;
BEGIN
    SELECT run.tenant_id, run.school_id, run.classroom_id,
           run.id AS activity_run_id, run.learning_activity_version_id,
           COALESCE((run.runtime_policy_snapshot#>>'{explicit,attemptLimit}')::integer,
             (version.policy_snapshot#>>'{attemptPolicy,maxAttempts}')::integer,1) AS attempt_limit
      INTO v_run
      FROM public.activity_runs run
      JOIN public.learning_activity_versions version ON version.id=run.learning_activity_version_id
     WHERE run.source_classroom_assignment_id = p_assignment_id;
    IF v_run.activity_run_id IS NULL THEN
        RETURN QUERY SELECT 'not_canonical'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, NULL::varchar, NULL::uuid, false;
        RETURN;
    END IF;

    PERFORM set_config('app.tenant_id', v_run.tenant_id::text, true);

    SELECT participation.id, participation.learner_identity_id,
           participation.status, participation.extra_attempts, participation.excused, participation.source_course_enrollment_id
      INTO v_participation
      FROM public.classroom_student_seats seat
      JOIN public.learner_identity_links link
        ON link.tenant_id = v_run.tenant_id
       AND link.school_id = v_run.school_id
       AND link.link_kind = 'student_seat'
       AND link.seat_id = seat.id
       AND link.status = 'active'
      JOIN public.activity_participations participation
        ON participation.tenant_id = v_run.tenant_id
       AND participation.school_id = v_run.school_id
       AND participation.activity_run_id = v_run.activity_run_id
       AND participation.learner_identity_id = link.learner_identity_id
     WHERE seat.id = p_seat_id
       AND seat.tenant_id = v_run.tenant_id
       AND seat.classroom_id = v_run.classroom_id
       AND seat.status = 'active';
    IF v_participation.id IS NULL OR v_participation.excused THEN
        RETURN QUERY SELECT 'forbidden'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, NULL::varchar, NULL::uuid, false;
        RETURN;
    END IF;

    IF v_participation.source_course_enrollment_id IS NOT NULL THEN
        SELECT * INTO v_activation FROM public.course_enrollment_activate(
            p_actor_principal_id,v_participation.source_course_enrollment_id);
        IF v_activation.result_code<>'ok' THEN
            RETURN QUERY SELECT v_activation.result_code::varchar, v_participation.id,
              NULL::uuid,NULL::integer,NULL::varchar,NULL::uuid,false; RETURN;
        END IF;
    END IF;
    SELECT * INTO v_activation
      FROM public.activity_participation_activate(
        p_actor_principal_id, v_participation.id
      );
    IF v_activation.result_code <> 'ok' THEN
        RETURN QUERY SELECT v_activation.result_code::varchar,
            v_participation.id, NULL::uuid, NULL::integer,
            v_participation.status::varchar, NULL::uuid, false;
        RETURN;
    END IF;

    SELECT * INTO v_work
      FROM public.classroom_assignment_work_start(
        p_seat_id, p_assignment_id, p_project_id
      );
    IF v_work.project_id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar, v_participation.id,
            NULL::uuid, NULL::integer, NULL::varchar, NULL::uuid, false;
        RETURN;
    END IF;

    -- One row lock serializes retry/concurrent start for this participation.
    PERFORM 1 FROM public.activity_participations participation
     WHERE participation.id = v_participation.id FOR UPDATE;

    SELECT attempt.id, attempt.attempt_number, attempt.state
      INTO v_attempt
      FROM public.learning_attempts attempt
     WHERE attempt.activity_participation_id = v_participation.id
       AND attempt.state IN ('in_progress', 'submitted', 'evaluating')
     ORDER BY attempt.attempt_number DESC, attempt.id DESC
     LIMIT 1;
    IF v_attempt.id IS NOT NULL THEN
        RETURN QUERY SELECT 'ok'::varchar, v_participation.id, v_attempt.id,
            v_attempt.attempt_number, v_attempt.state::varchar,
            v_work.project_id, true;
        RETURN;
    END IF;

    SELECT COALESCE(max(attempt.attempt_number), 0) + 1
      INTO v_attempt_number
      FROM public.learning_attempts attempt
     WHERE attempt.classroom_assignment_id = p_assignment_id
       AND attempt.seat_id = p_seat_id;

    v_effective:=public.learning_effective_conditions_internal(v_run.activity_run_id,v_participation.id);
    v_attempt_limit:=(v_effective#>>'{values,attemptLimit}')::integer+v_participation.extra_attempts;
    IF v_attempt_number>v_attempt_limit THEN
      RETURN QUERY SELECT 'attempt_limit_reached'::varchar,v_participation.id,NULL::uuid,
        NULL::integer,NULL::varchar,v_work.project_id,false; RETURN;
    END IF;
    SELECT prior.id INTO v_revision_of
      FROM public.learning_attempts prior
      JOIN LATERAL (
        SELECT result.review_decision
          FROM public.assessment_results result
         WHERE result.attempt_id=prior.id
         ORDER BY result.revision_number DESC
         LIMIT 1
      ) review ON true
     WHERE prior.activity_participation_id=v_participation.id
       AND prior.state='closed'
       AND review.review_decision='changes_requested'
     ORDER BY prior.attempt_number DESC LIMIT 1;
    INSERT INTO public.learning_attempts (
        tenant_id, classroom_id, classroom_assignment_id,
        learning_activity_version_id, seat_id, learner_identity_id,
        activity_participation_id, attempt_number, state, revision_of_attempt_id, effective_conditions_at_start
    ) VALUES (
        v_run.tenant_id, v_run.classroom_id, p_assignment_id,
        v_run.learning_activity_version_id, p_seat_id,
        v_participation.learner_identity_id, v_participation.id,
        v_attempt_number, 'in_progress', v_revision_of, v_effective
    )
    RETURNING learning_attempts.id, learning_attempts.attempt_number,
              learning_attempts.state
         INTO v_attempt;

    RETURN QUERY SELECT 'ok'::varchar, v_participation.id, v_attempt.id,
        v_attempt.attempt_number, v_attempt.state::varchar,
        v_work.project_id, false;
END;
$$;

CREATE OR REPLACE FUNCTION learning_canonical_evidence_internal(
    p_classroom_id uuid,
    p_seat_id uuid DEFAULT NULL,
    p_include_inactive boolean DEFAULT false
)
RETURNS TABLE (evidence jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT jsonb_build_object(
        'tenantId', assignment.tenant_id,
        'schoolId', classroom.school_id,
        'classroomId', classroom.id,
        'classroomAssignmentId', assignment.id,
        'kind', CASE
            WHEN assignment.quiz_version_id IS NOT NULL THEN 'quiz'
            WHEN assignment.course_run_id IS NOT NULL THEN 'course_project'
            ELSE 'direct_project'
        END,
        'dueAt', CASE WHEN run.id IS NULL THEN to_jsonb(assignment.due_at) ELSE public.learning_effective_conditions_internal(run.id,participation.id)#>'{values,dueAt}' END,
        'activityRunId', run.id,
        'participation', CASE WHEN run.id IS NULL THEN NULL ELSE jsonb_build_object(
          'applicable',participation.id IS NOT NULL,'status',COALESCE(participation.status,'assigned'),
          'excused',COALESCE(participation.excused,false)) END,
        'assignmentStatus', assignment.status,
        'seatId', seat.id,
        'accountId', seat.account_id,
        'principalId', seat_principal.id,
        'learnerId', learner_link.learner_identity_id,
        'identityResolution', CASE
            WHEN learner_link.learner_identity_id IS NOT NULL THEN 'learner_identity'
            ELSE 'seat_compatibility'
        END,
        'seatStatus', seat.status,
        'classroomAccess', CASE WHEN classroom.status = 'active' THEN 'active' ELSE 'ended' END,
        'legacyWork', CASE WHEN work.id IS NULL THEN NULL ELSE jsonb_build_object(
            'projectId', work.project_id,
            'startedAt', work.started_at,
            'submittedAt', work.submitted_at
        ) END,
        'courseProgressPresent', assignment.course_run_id IS NOT NULL,
        'attempt', CASE WHEN attempt.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', attempt.id,
            'attemptNumber', attempt.attempt_number,
            'state', attempt.state,
            'reviewDecision', attempt_review.review_decision,
            'startedAt', attempt.started_at,
            'submittedAt', attempt.submitted_at,
            'lateState', submission.late_state
        ) END,
        'selectedAttemptExists', CASE WHEN run.id IS NOT NULL THEN canonical_selection.attempt_id IS NOT NULL ELSE selected_attempt.id IS NOT NULL END,
        'resultSelectionSource', CASE WHEN run.id IS NOT NULL THEN 'canonical' WHEN grade.id IS NULL THEN 'none' ELSE 'gradebook_pointer' END,
        'selectedAttemptId', CASE WHEN run.id IS NOT NULL THEN canonical_selection.attempt_id ELSE grade.accepted_attempt_id END,
        'selectedRevision',CASE WHEN run.id IS NULL OR canonical_result.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id',canonical_result.id,'attemptId',canonical_result.attempt_id,'rawPoints',canonical_result.raw_points,
          'maxPoints',canonical_result.max_points,'percentageBasisPoints',canonical_result.percentage_basis_points,
          'displayGrade',public.learning_grade_label_for_run(run.id,canonical_result.percentage_basis_points),'completionValue',canonical_result.completion_value,
          'outcome',canonical_result.outcome,'publishedAt',canonical_result.published_at) END,
        'selectedResult', CASE WHEN selected_result.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', selected_result.id,
            'attemptId', selected_result.attempt_id,
            'rawPoints', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE selected_result.raw_points END,
            'maxPoints', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE selected_result.max_points END,
            'percentageBasisPoints', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE selected_result.percentage_basis_points END,
            'displayGrade', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE
                COALESCE(public.grade_label_for_classroom(assignment.classroom_id, selected_result.percentage_basis_points),
                    CASE selected_result.outcome WHEN 'passed' THEN 'Зачёт' WHEN 'failed' THEN 'Не зачтено' END)
            END,
            'outcome', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE selected_result.outcome END,
            'publishedAt', selected_result.published_at
        ) END,
        'selectionConflict', CASE
            WHEN run.id IS NOT NULL THEN CASE WHEN participation.teacher_selected_attempt_id IS NOT NULL AND canonical_selection.attempt_id IS NULL THEN 'selected_attempt_missing' ELSE NULL END
            WHEN grade.id IS NULL THEN NULL
            WHEN selected_attempt.id IS NULL THEN 'selected_attempt_missing'
            WHEN selected_result.id IS NULL THEN 'selected_result_missing'
            WHEN selected_attempt.classroom_assignment_id <> assignment.id
              OR selected_attempt.seat_id <> seat.id
              OR selected_attempt.tenant_id <> assignment.tenant_id THEN 'pointer_scope_mismatch'
            WHEN selected_result.attempt_id <> grade.accepted_attempt_id THEN 'attempt_result_mismatch'
            ELSE NULL
        END,
        'validUnselectedResultCount', CASE WHEN run.id IS NOT NULL THEN 0 ELSE (
            SELECT count(*)::integer
              FROM public.learning_attempts candidate_attempt
              JOIN public.assessment_results candidate_result
                ON candidate_result.attempt_id = candidate_attempt.id
             WHERE candidate_attempt.classroom_assignment_id = assignment.id
               AND candidate_attempt.seat_id = seat.id
               AND (grade.assessment_result_id IS NULL OR candidate_result.id <> grade.assessment_result_id)
        ) END,
        'compatibilityGradingUnknown', compatibility.grading_semantics = 'unknown',
        'reusableAuthoredContent', COALESCE(compatibility.reusable_authored_content, true)
    )
      FROM public.classroom_assignments assignment
      JOIN public.classrooms classroom ON classroom.id = assignment.classroom_id
      JOIN public.classroom_student_seats seat ON seat.classroom_id = assignment.classroom_id
      LEFT JOIN public.principals seat_principal ON seat_principal.seat_id = seat.id
      LEFT JOIN public.learner_identity_links learner_link
        ON learner_link.seat_id = seat.id
       AND learner_link.tenant_id = assignment.tenant_id
       AND learner_link.school_id = classroom.school_id
       AND learner_link.status = 'active'
      LEFT JOIN public.activity_runs run ON run.source_classroom_assignment_id=assignment.id
      LEFT JOIN public.activity_participations participation ON participation.activity_run_id=run.id
        AND participation.learner_identity_id=learner_link.learner_identity_id
      LEFT JOIN LATERAL public.learning_selected_result_internal(participation.id) canonical_selection ON true
      LEFT JOIN public.assessment_results canonical_result ON canonical_result.id=canonical_selection.result_id
      LEFT JOIN public.classroom_assignment_work work
        ON work.assignment_id = assignment.id AND work.seat_id = seat.id
      LEFT JOIN LATERAL (
          SELECT current_attempt.*
            FROM public.learning_attempts current_attempt
           WHERE current_attempt.classroom_assignment_id = assignment.id
             AND current_attempt.seat_id = seat.id
           ORDER BY current_attempt.attempt_number DESC, current_attempt.id DESC
           LIMIT 1
      ) attempt ON true
      LEFT JOIN LATERAL (
          SELECT result.review_decision
            FROM public.assessment_results result
           WHERE result.attempt_id=attempt.id
           ORDER BY result.revision_number DESC
           LIMIT 1
      ) attempt_review ON true
      LEFT JOIN public.learning_submissions submission ON submission.attempt_id = attempt.id
      LEFT JOIN public.gradebook_entries grade
        ON grade.classroom_assignment_id = assignment.id AND grade.seat_id = seat.id
      LEFT JOIN public.learning_attempts selected_attempt ON selected_attempt.id = grade.accepted_attempt_id
      LEFT JOIN public.assessment_results selected_result ON selected_result.id = grade.assessment_result_id
      LEFT JOIN public.learning_migration_compatibility_activity_versions compatibility
        ON compatibility.classroom_assignment_id = assignment.id
     WHERE assignment.classroom_id = p_classroom_id
       AND (p_seat_id IS NULL OR seat.id = p_seat_id)
       AND (p_include_inactive OR seat.status = 'active')
     ORDER BY assignment.created_at, assignment.id, seat.display_label, seat.id;
$$;

CREATE OR REPLACE FUNCTION learning_notification_sweep()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_row record;v_actor uuid;v_due timestamptz;v_event varchar;v_category varchar;v_effective jsonb;
 v_completion jsonb;v_previous jsonb;v_count integer:=0;v_evidence bigint;
BEGIN
 -- Multiple API instances may run the same sweep. Only one works at a time.
 IF NOT pg_try_advisory_xact_lock(1122,1) THEN RETURN 0; END IF;
 FOR v_row IN SELECT part.id,run.id AS run_id,run.classroom_id,run.source_classroom_assignment_id AS assignment_id,seat.id AS seat_id
   FROM public.activity_participations part JOIN public.activity_runs run ON run.id=part.activity_run_id
   JOIN public.classrooms classroom ON classroom.id=run.classroom_id AND classroom.status='active'
   JOIN public.classroom_assignments assignment ON assignment.id=run.source_classroom_assignment_id AND assignment.status='open'
   JOIN public.learner_identity_links link ON link.learner_identity_id=part.learner_identity_id AND link.status='active' AND link.link_kind='student_seat'
   JOIN public.classroom_student_seats seat ON seat.id=link.seat_id AND seat.classroom_id=run.classroom_id AND seat.status='active'
   LEFT JOIN public.classroom_course_runs course ON course.id=run.source_course_run_id
   LEFT JOIN LATERAL(
     SELECT attempt.state,
       (SELECT result.review_decision FROM public.assessment_results result
         WHERE result.attempt_id=attempt.id ORDER BY result.revision_number DESC LIMIT 1) AS review_decision
       FROM public.learning_attempts attempt
      WHERE attempt.activity_participation_id=part.id
      ORDER BY attempt.attempt_number DESC LIMIT 1
   ) latest ON true
   LEFT JOIN LATERAL public.learning_selected_result_internal(part.id) selected ON true
   LEFT JOIN public.assessment_results result ON result.id=selected.result_id
   WHERE part.status IN ('assigned','active') AND NOT part.excused AND run.lifecycle_status='active'
     AND EXISTS(SELECT 1 FROM public.learning_notifications n WHERE n.event_key='assigned:'||part.id)
     AND (course.id IS NULL OR course.status='open') AND COALESCE(result.completion_value,false)=false
     AND (latest.state IS NULL OR latest.state='in_progress'
       OR (latest.state='closed' AND latest.review_decision='changes_requested'))
 LOOP
   v_effective:=public.learning_effective_conditions_internal(v_row.run_id,v_row.id);
   v_due:=(v_effective#>>'{values,dueAt}')::timestamptz;
   IF v_due IS NULL OR (v_effective#>>'{values,closesAt}')::timestamptz<now()
     OR (v_effective#>>'{values,opensAt}')::timestamptz>now() OR v_due>now()+interval '24 hours' THEN CONTINUE; END IF;
   v_event:=CASE WHEN v_due<now() THEN 'NF14' ELSE 'NF13' END;
   v_category:=CASE WHEN v_event='NF14' THEN 'NC05' ELSE 'NC04' END;
   PERFORM public.learning_notification_emit(public.learning_notification_learner_actor(v_row.seat_id),v_row.classroom_id,v_row.assignment_id,NULL,NULL,NULL,
     'learner',v_event,v_category,v_event||':'||v_row.id||':'||extract(epoch FROM v_due)::text);
   FOR v_actor IN SELECT actor.id FROM public.classroom_memberships m JOIN public.principals actor ON actor.account_id=m.account_id AND actor.kind='account'
     WHERE m.classroom_id=v_row.classroom_id AND m.member_role IN ('owner','co_teacher') LOOP
     PERFORM public.learning_notification_emit(v_actor,v_row.classroom_id,v_row.assignment_id,NULL,NULL,NULL,
       'teacher',v_event,v_category,v_event||':'||v_row.id||':'||extract(epoch FROM v_due)::text);
   END LOOP;
   v_count:=v_count+1;
 END LOOP;
 FOR v_row IN SELECT enrollment.*,course.classroom_id,seat.id AS seat_id FROM public.course_enrollments enrollment
   JOIN public.classroom_course_runs course ON course.id=enrollment.course_run_id AND course.creation_request_id IS NOT NULL
   JOIN public.learner_identity_links link ON link.learner_identity_id=enrollment.learner_identity_id AND link.status='active' AND link.link_kind='student_seat'
   JOIN public.classroom_student_seats seat ON seat.id=link.seat_id AND seat.classroom_id=course.classroom_id AND seat.status='active'
   WHERE enrollment.status IN ('assigned','active')
 LOOP
   v_completion:=public.learning_course_completion_internal(v_row.id);
   SELECT payload_json INTO v_previous FROM public.audit_events WHERE entity_id=v_row.id AND action='learning.course.completion.changed'
     ORDER BY created_at DESC,id DESC LIMIT 1;
   IF COALESCE((v_completion->>'completed')::boolean,false)=COALESCE((v_previous->>'completed')::boolean,false) THEN CONTINUE; END IF;
   INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
   VALUES(v_row.tenant_id,NULL,'course_enrollment',v_row.id,'learning.course.completion.changed',v_completion) RETURNING id INTO v_evidence;
   IF v_completion->>'completed'='true' THEN
     PERFORM public.learning_notification_emit(public.learning_notification_learner_actor(v_row.seat_id),v_row.classroom_id,NULL,NULL,NULL,v_row.course_run_id,
       'learner','NF15','NC06','course-complete:'||v_evidence);
     FOR v_actor IN SELECT actor.id FROM public.classroom_memberships m JOIN public.principals actor ON actor.account_id=m.account_id AND actor.kind='account'
       WHERE m.classroom_id=v_row.classroom_id AND m.member_role IN ('owner','co_teacher')
       AND NOT EXISTS(SELECT 1 FROM public.assessment_results result WHERE result.id::text IN
         (SELECT jsonb_array_elements_text(v_completion->'basisIds')) AND result.evaluator_principal_id=actor.id)
     LOOP
       PERFORM public.learning_notification_emit(v_actor,v_row.classroom_id,NULL,NULL,NULL,v_row.course_run_id,
         'teacher','NF15','NC06','course-complete:'||v_evidence);
     END LOOP;
   END IF;
 END LOOP;
 RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION quiz_submission_create(
    p_seat_id uuid,
    p_assignment_id uuid,
    p_answers jsonb,
    p_client_request_id varchar
)
RETURNS TABLE (
    result_code varchar,
    attempt_id uuid,
    submission_id uuid,
    attempt_number integer,
    raw_points integer,
    max_points integer,
    percentage_basis_points integer,
    outcome varchar,
    late_state varchar,
    question_results jsonb,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_scope record;
    v_existing record;
    v_attempt uuid;
    v_submission uuid;
    v_attempt_number integer;
    v_question record;
    v_answer jsonb;
    v_response jsonb;
    v_correct boolean;
    v_points integer;
    v_total integer := 0;
    v_percentage integer;
    v_outcome varchar;
    v_late varchar;
    v_results jsonb := '[]'::jsonb;
    v_digest varchar;
    v_result uuid;
    v_gradebook uuid;
BEGIN
    IF p_client_request_id IS NULL
       OR p_client_request_id !~ '^[A-Za-z0-9._:-]{8,128}$'
       OR jsonb_typeof(p_answers) <> 'array' THEN
        RETURN QUERY SELECT 'invalid_submission'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, NULL::integer, NULL::integer, NULL::integer,
            NULL::varchar, NULL::varchar, '[]'::jsonb, false;
        RETURN;
    END IF;
    SELECT submission.id, attempt.id AS attempt_id, attempt.attempt_number,
           result.raw_points, result.max_points, result.percentage_basis_points,
           result.outcome, submission.late_state
      INTO v_existing
      FROM public.learning_submissions submission
      JOIN public.learning_attempts attempt ON attempt.id = submission.attempt_id
      JOIN public.assessment_results result ON result.attempt_id = attempt.id
     WHERE submission.client_request_id = p_client_request_id
       AND attempt.seat_id = p_seat_id
       AND attempt.classroom_assignment_id = p_assignment_id;
    IF v_existing.id IS NOT NULL THEN
        RETURN QUERY SELECT 'ok'::varchar, v_existing.attempt_id, v_existing.id,
            v_existing.attempt_number, v_existing.raw_points, v_existing.max_points,
            v_existing.percentage_basis_points, v_existing.outcome,
            v_existing.late_state, '[]'::jsonb, true;
        RETURN;
    END IF;

    SELECT assignment.tenant_id, assignment.classroom_id, assignment.due_at,
           classroom.school_id, classroom.academic_period_id,
           quiz.id AS quiz_version_id, quiz.learning_activity_version_id,
           quiz.owner_principal_id, quiz.total_points, quiz.attempt_limit,
           quiz.pass_threshold_basis_points, quiz.feedback_release_policy
      INTO v_scope
      FROM public.classroom_student_seats seat
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id = seat.tenant_id
       AND assignment.classroom_id = seat.classroom_id
      JOIN public.classrooms classroom ON classroom.id = assignment.classroom_id
      JOIN public.quiz_versions quiz ON quiz.id = assignment.quiz_version_id
     WHERE seat.id = p_seat_id AND seat.status = 'active'
       AND assignment.id = p_assignment_id AND assignment.status = 'open'
     FOR UPDATE OF assignment;
    IF v_scope.tenant_id IS NULL THEN
        RETURN QUERY SELECT 'assignment_unavailable'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, NULL::integer, NULL::integer, NULL::integer,
            NULL::varchar, NULL::varchar, '[]'::jsonb, false;
        RETURN;
    END IF;
    SELECT count(*)::integer + 1 INTO v_attempt_number
      FROM public.learning_attempts attempt
     WHERE attempt.classroom_assignment_id = p_assignment_id
       AND attempt.seat_id = p_seat_id;
    IF v_attempt_number > v_scope.attempt_limit THEN
        RETURN QUERY SELECT 'attempt_limit_reached'::varchar, NULL::uuid, NULL::uuid,
            v_attempt_number - 1, NULL::integer, v_scope.total_points,
            NULL::integer, NULL::varchar, NULL::varchar, '[]'::jsonb, false;
        RETURN;
    END IF;

    INSERT INTO public.learning_attempts (
        tenant_id, classroom_id, classroom_assignment_id,
        learning_activity_version_id, seat_id, attempt_number,
        state, submitted_at, evaluated_at
    ) VALUES (
        v_scope.tenant_id, v_scope.classroom_id, p_assignment_id,
        v_scope.learning_activity_version_id, p_seat_id, v_attempt_number,
        'closed', now(), now()
    ) RETURNING id INTO v_attempt;

    FOR v_question IN
        SELECT mapped.question_version_id, mapped.max_points,
               question.question_type, key.answer_key
          FROM public.quiz_version_questions mapped
          JOIN public.question_versions question ON question.id = mapped.question_version_id
          JOIN public.question_answer_keys key
            ON key.question_version_id = mapped.question_version_id
         WHERE mapped.quiz_version_id = v_scope.quiz_version_id
         ORDER BY mapped.position
    LOOP
        SELECT answer INTO v_answer
          FROM jsonb_array_elements(p_answers) answer
         WHERE answer ->> 'questionVersionId' = v_question.question_version_id::text
         LIMIT 1;
        v_response := COALESCE(v_answer -> 'answer', 'null'::jsonb);
        v_correct := CASE v_question.question_type
            WHEN 'single_choice' THEN v_response -> 'value' = v_question.answer_key -> 'value'
            WHEN 'boolean' THEN v_response -> 'value' = v_question.answer_key -> 'value'
            WHEN 'multiple_choice' THEN
                jsonb_typeof(v_response -> 'values') = 'array'
                AND (v_response -> 'values') @> (v_question.answer_key -> 'values')
                AND (v_question.answer_key -> 'values') @> (v_response -> 'values')
            WHEN 'numeric' THEN CASE
                WHEN COALESCE(v_response ->> 'value', '') ~ '^-?[0-9]+([.][0-9]+)?$'
                THEN abs((v_response ->> 'value')::numeric
                          - (v_question.answer_key ->> 'value')::numeric)
                     <= COALESCE((v_question.answer_key ->> 'tolerance')::numeric, 0)
                ELSE false
            END
            WHEN 'short_text' THEN EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(
                    v_question.answer_key -> 'accepted'
                ) accepted(value)
                 WHERE lower(trim(accepted.value)) = lower(trim(v_response ->> 'value'))
            )
            ELSE false
        END;
        v_points := CASE WHEN v_correct THEN v_question.max_points ELSE 0 END;
        v_total := v_total + v_points;
        INSERT INTO public.attempt_answers (
            tenant_id, attempt_id, question_version_id, response,
            awarded_points, max_points, is_correct
        ) VALUES (
            v_scope.tenant_id, v_attempt, v_question.question_version_id,
            v_response, v_points, v_question.max_points, v_correct
        );
        v_results := v_results || jsonb_build_array(jsonb_build_object(
            'questionVersionId', v_question.question_version_id,
            'correct', v_correct, 'points', v_points,
            'maxPoints', v_question.max_points
        ));
        v_answer := NULL;
    END LOOP;

    v_percentage := (v_total * 10000) / v_scope.total_points;
    v_outcome := CASE WHEN v_percentage >= v_scope.pass_threshold_basis_points
                      THEN 'passed' ELSE 'failed' END;
    v_late := CASE WHEN v_scope.due_at IS NOT NULL AND now() > v_scope.due_at
                   THEN 'late' ELSE 'on_time' END;
    v_digest := encode(sha256(convert_to(p_answers::text, 'UTF8')), 'hex');
    INSERT INTO public.learning_submissions (
        tenant_id, attempt_id, project_id, project_version_id,
        payload_manifest, payload_digest, client_request_id, late_state
    ) VALUES (
        v_scope.tenant_id, v_attempt, NULL, NULL,
        jsonb_build_object('kind', 'quiz', 'answers', p_answers),
        v_digest, p_client_request_id, v_late
    ) RETURNING id INTO v_submission;
    INSERT INTO public.learning_evaluations (
        tenant_id, attempt_id, evaluator_kind, status,
        points, max_points, evidence
    ) VALUES (
        v_scope.tenant_id, v_attempt, 'automatic', 'completed',
        v_total, v_scope.total_points,
        jsonb_build_object('grader', 'quiz-v1', 'submissionDigest', v_digest)
    );
    INSERT INTO public.assessment_results (
        tenant_id, attempt_id, raw_points, max_points,
        percentage_basis_points, outcome, auto_points, review_decision
    ) VALUES (
        v_scope.tenant_id, v_attempt, v_total, v_scope.total_points,
        v_percentage, v_outcome, v_total, 'accepted'
    ) RETURNING id INTO v_result;
    INSERT INTO public.gradebook_entries (
        tenant_id, school_id, academic_period_id, classroom_id,
        classroom_assignment_id, seat_id, accepted_attempt_id,
        assessment_result_id, published_by_principal_id
    ) VALUES (
        v_scope.tenant_id, v_scope.school_id, v_scope.academic_period_id,
        v_scope.classroom_id, p_assignment_id, p_seat_id, v_attempt,
        v_result, v_scope.owner_principal_id
    )
    ON CONFLICT (classroom_assignment_id, seat_id) DO UPDATE
       SET accepted_attempt_id = EXCLUDED.accepted_attempt_id,
           assessment_result_id = EXCLUDED.assessment_result_id,
           published_by_principal_id = EXCLUDED.published_by_principal_id,
           published_at = now(), updated_at = now()
    RETURNING id INTO v_gradebook;
    INSERT INTO public.grade_change_events (
        tenant_id, gradebook_entry_id, assessment_result_id,
        actor_principal_id, event_kind, reason, snapshot
    ) VALUES (
        v_scope.tenant_id, v_gradebook, v_result, v_scope.owner_principal_id,
        'published', 'Автоматическая проверка теста',
        jsonb_build_object('points', v_total, 'maxPoints', v_scope.total_points,
                           'percentageBasisPoints', v_percentage, 'outcome', v_outcome)
    );
    RETURN QUERY SELECT 'ok'::varchar, v_attempt, v_submission, v_attempt_number,
        v_total, v_scope.total_points, v_percentage, v_outcome, v_late,
        CASE WHEN v_scope.feedback_release_policy = 'immediate'
             THEN v_results ELSE '[]'::jsonb END,
        false;
END;
$$;

CREATE OR REPLACE FUNCTION learning_project_submission_create(
    p_seat_id uuid,
    p_assignment_id uuid,
    p_client_request_id varchar
)
RETURNS TABLE (
    result_code varchar,
    attempt_id uuid,
    submission_id uuid,
    attempt_number integer,
    attempt_state varchar,
    project_id uuid,
    project_version_id uuid,
    submitted_at timestamptz,
    late_state varchar,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_scope record;
    v_activity uuid;
    v_version uuid;
    v_attempt uuid;
    v_attempt_number integer;
    v_project_version uuid;
    v_submission uuid;
    v_digest varchar;
    v_late varchar;
    v_submitted_at timestamptz;
    v_existing record;
BEGIN
    IF p_client_request_id IS NULL
       OR p_client_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request_id'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, NULL::varchar, NULL::uuid, NULL::uuid,
            NULL::timestamptz, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT submission.id, submission.attempt_id, attempt.attempt_number,
           attempt.state, submission.project_id, submission.project_version_id,
           submission.submitted_at, submission.late_state
      INTO v_existing
      FROM public.learning_submissions submission
      JOIN public.learning_attempts attempt ON attempt.id = submission.attempt_id
     WHERE submission.client_request_id = p_client_request_id
       AND attempt.seat_id = p_seat_id
       AND attempt.classroom_assignment_id = p_assignment_id;
    IF v_existing.id IS NOT NULL THEN
        RETURN QUERY SELECT 'ok'::varchar, v_existing.attempt_id, v_existing.id,
            v_existing.attempt_number, v_existing.state, v_existing.project_id,
            v_existing.project_version_id, v_existing.submitted_at,
            v_existing.late_state, true;
        RETURN;
    END IF;

    SELECT work.tenant_id, assignment.classroom_id, classroom.school_id,
           classroom.academic_period_id,
           COALESCE(task.title, lesson.assignment_title) AS title,
           COALESCE(task.brief, lesson.assignment_brief) AS instructions,
           COALESCE(task.module_key, lesson.module_key) AS module_key,
           assignment.due_at, assignment.status, work.project_id,
           project.owner_principal_id, draft.document_json, draft.updated_by
      INTO v_scope
      FROM public.classroom_assignment_work work
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id = work.tenant_id AND assignment.id = work.assignment_id
      JOIN public.classrooms classroom
        ON classroom.tenant_id = assignment.tenant_id
       AND classroom.id = assignment.classroom_id
      JOIN public.classroom_student_seats seat ON seat.id = work.seat_id
      JOIN public.projects project
        ON project.tenant_id = work.tenant_id AND project.id = work.project_id
      JOIN public.project_drafts draft
        ON draft.tenant_id = project.tenant_id AND draft.project_id = project.id
      LEFT JOIN public.classroom_course_run_lessons lesson
        ON lesson.classroom_assignment_id = assignment.id
      LEFT JOIN public.teacher_assignments task ON task.id = assignment.assignment_id
     WHERE work.seat_id = p_seat_id
       AND work.assignment_id = p_assignment_id
       AND seat.status = 'active'
       AND assignment.status = 'open'
       AND project.owner_principal_id = (
           SELECT principal.id FROM public.principals principal
            WHERE principal.seat_id = p_seat_id
       )
     FOR UPDATE OF work, draft;
    IF v_scope.tenant_id IS NULL THEN
        RETURN QUERY SELECT 'assignment_unavailable'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, NULL::varchar, NULL::uuid, NULL::uuid,
            NULL::timestamptz, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT mapping.learning_activity_version_id
      INTO v_version
      FROM public.classroom_activity_versions mapping
     WHERE mapping.classroom_assignment_id = p_assignment_id;
    IF v_version IS NULL THEN
        INSERT INTO public.learning_activities (
            tenant_id, owner_principal_id, scope_kind, activity_type, title
        ) VALUES (
            v_scope.tenant_id,
            COALESCE(
                (SELECT task.owner_principal_id FROM public.teacher_assignments task
                  WHERE task.id = (SELECT assignment_id FROM public.classroom_assignments
                                    WHERE id = p_assignment_id)),
                (SELECT run.assigned_by_principal_id
                   FROM public.classroom_course_run_lessons lesson
                   JOIN public.classroom_course_runs run ON run.id = lesson.run_id
                  WHERE lesson.classroom_assignment_id = p_assignment_id),
                v_scope.owner_principal_id
            ),
            'school', 'project', v_scope.title
        ) RETURNING id INTO v_activity;
        v_digest := encode(digest(convert_to(
            concat_ws(E'\n', v_scope.title, v_scope.instructions, v_scope.module_key, '100'),
            'UTF8'), 'sha256'), 'hex');
        INSERT INTO public.learning_activity_versions (
            tenant_id, activity_id, version_number, title, instructions,
            activity_type, module_key, max_points, scoring_policy, content_digest
        ) VALUES (
            v_scope.tenant_id, v_activity, 1, v_scope.title, v_scope.instructions,
            'project', v_scope.module_key, 100,
            '{"kind":"manual","scale":"integer","passThreshold":60}'::jsonb,
            v_digest
        ) RETURNING id INTO v_version;
        INSERT INTO public.classroom_activity_versions (
            tenant_id, classroom_assignment_id, learning_activity_version_id
        ) VALUES (v_scope.tenant_id, p_assignment_id, v_version);
    END IF;

    SELECT attempt.state, review.review_decision
      INTO v_existing
      FROM public.learning_attempts attempt
      LEFT JOIN LATERAL (
        SELECT result.review_decision
          FROM public.assessment_results result
         WHERE result.attempt_id=attempt.id
         ORDER BY result.revision_number DESC
         LIMIT 1
      ) review ON true
     WHERE attempt.classroom_assignment_id = p_assignment_id
       AND attempt.seat_id = p_seat_id
     ORDER BY attempt.attempt_number DESC
     LIMIT 1;
    IF v_existing.state IS NOT NULL
       AND NOT (v_existing.state='closed' AND v_existing.review_decision='changes_requested') THEN
        RETURN QUERY SELECT 'attempt_already_submitted'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, v_existing.state::varchar, v_scope.project_id, NULL::uuid,
            NULL::timestamptz, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT COALESCE(max(attempt.attempt_number), 0) + 1
      INTO v_attempt_number
      FROM public.learning_attempts attempt
     WHERE attempt.classroom_assignment_id = p_assignment_id
       AND attempt.seat_id = p_seat_id;

    INSERT INTO public.project_versions (
        tenant_id, project_id, version_no, document_json, label,
        created_by, created_by_principal_id
    ) SELECT v_scope.tenant_id, v_scope.project_id,
             COALESCE(max(version.version_no), 0) + 1,
             v_scope.document_json,
             'Сдача, попытка ' || v_attempt_number,
             v_scope.updated_by, v_scope.owner_principal_id
        FROM public.project_versions version
       WHERE version.tenant_id = v_scope.tenant_id
         AND version.project_id = v_scope.project_id
    RETURNING id INTO v_project_version;

    INSERT INTO public.learning_attempts (
        tenant_id, classroom_id, classroom_assignment_id,
        learning_activity_version_id, seat_id, attempt_number,
        state, submitted_at
    ) VALUES (
        v_scope.tenant_id, v_scope.classroom_id, p_assignment_id,
        v_version, p_seat_id, v_attempt_number, 'evaluating', now()
    ) RETURNING id INTO v_attempt;

    v_digest := encode(digest(convert_to(v_scope.document_json::text, 'UTF8'), 'sha256'), 'hex');
    v_late := CASE WHEN v_scope.due_at IS NOT NULL AND now() > v_scope.due_at
                   THEN 'late' ELSE 'on_time' END;
    INSERT INTO public.learning_submissions (
        tenant_id, attempt_id, project_id, project_version_id,
        payload_manifest, payload_digest, client_request_id, late_state
    ) VALUES (
        v_scope.tenant_id, v_attempt, v_scope.project_id, v_project_version,
        jsonb_build_object('kind', 'project', 'projectVersionId', v_project_version),
        v_digest, p_client_request_id, v_late
    ) RETURNING id, learning_submissions.submitted_at INTO v_submission, v_submitted_at;

    INSERT INTO public.learning_evaluations (
        tenant_id, attempt_id, evaluator_kind, status, max_points, evidence
    ) VALUES (
        v_scope.tenant_id, v_attempt, 'automatic', 'needs_review', 100,
        jsonb_build_object('submissionDigest', v_digest)
    );

    -- Compatibility only. Canonical readers use learning_attempts/submissions.
    UPDATE public.classroom_assignment_work
       SET submitted_at = v_submitted_at
     WHERE assignment_id = p_assignment_id AND seat_id = p_seat_id;

    RETURN QUERY SELECT 'ok'::varchar, v_attempt, v_submission,
        v_attempt_number, 'evaluating'::varchar, v_scope.project_id,
        v_project_version, v_submitted_at, v_late, false;
END;
$$;

CREATE OR REPLACE FUNCTION learning_attempt_review(
    p_account_id uuid,
    p_reviewer_principal_id uuid,
    p_classroom_id uuid,
    p_attempt_id uuid,
    p_decision varchar,
    p_points integer,
    p_feedback varchar,
    p_reason varchar
)
RETURNS TABLE (
    result_code varchar,
    assessment_result_id uuid,
    gradebook_entry_id uuid,
    attempt_state varchar,
    percentage_basis_points integer
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_access record;
    v_attempt record;
    v_result uuid;
    v_gradebook uuid;
    v_percentage integer;
    v_outcome varchar;
BEGIN
    SELECT * INTO v_access
      FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN
        RETURN QUERY SELECT 'classroom_not_found'::varchar, NULL::uuid, NULL::uuid,
            NULL::varchar, NULL::integer;
        RETURN;
    END IF;
    IF p_decision NOT IN ('accepted', 'changes_requested', 'incomplete', 'excused') THEN
        RETURN QUERY SELECT 'invalid_decision'::varchar, NULL::uuid, NULL::uuid,
            NULL::varchar, NULL::integer;
        RETURN;
    END IF;
    IF p_feedback IS NOT NULL AND length(p_feedback) > 8000 THEN
        RETURN QUERY SELECT 'invalid_feedback'::varchar, NULL::uuid, NULL::uuid,
            NULL::varchar, NULL::integer;
        RETURN;
    END IF;

    SELECT attempt.*, version.max_points, classroom.school_id,
           classroom.academic_period_id, principal.id AS reviewer_principal_id
      INTO v_attempt
      FROM public.learning_attempts attempt
      JOIN public.learning_activity_versions version
        ON version.id = attempt.learning_activity_version_id
      JOIN public.classrooms classroom ON classroom.id = attempt.classroom_id
      JOIN public.principals principal
        ON principal.id = p_reviewer_principal_id
       AND principal.account_id = p_account_id
     WHERE attempt.id = p_attempt_id
       AND attempt.classroom_id = p_classroom_id
       AND attempt.tenant_id = v_access.tenant_id
     FOR UPDATE OF attempt;
    IF v_attempt.id IS NULL THEN
        RETURN QUERY SELECT 'attempt_not_found'::varchar, NULL::uuid, NULL::uuid,
            NULL::varchar, NULL::integer;
        RETURN;
    END IF;
    IF v_attempt.activity_participation_id IS NOT NULL THEN
        RETURN QUERY SELECT 'review_request_required'::varchar,NULL::uuid,NULL::uuid,v_attempt.state::varchar,NULL::integer;
        RETURN;
    END IF;
    IF v_attempt.state <> 'evaluating' THEN
        RETURN QUERY SELECT 'invalid_transition'::varchar, NULL::uuid, NULL::uuid,
            v_attempt.state::varchar, NULL::integer;
        RETURN;
    END IF;

    IF p_decision = 'changes_requested' THEN
        UPDATE public.learning_attempts
           SET state = 'closed', evaluated_at = now()
         WHERE id = p_attempt_id;
        INSERT INTO public.learning_evaluations (
            tenant_id, attempt_id, evaluator_kind, evaluator_principal_id,
            status, points, max_points, feedback
        ) VALUES (
            v_attempt.tenant_id, p_attempt_id, 'teacher',
            v_attempt.reviewer_principal_id, 'completed', NULL,
            v_attempt.max_points, p_feedback
        );
        INSERT INTO public.assessment_results (
            tenant_id, attempt_id, raw_points, max_points,
            percentage_basis_points, outcome, manual_points,
            evaluator_principal_id, feedback, review_decision,
            completion_value, correction_reason
        ) VALUES (
            v_attempt.tenant_id, p_attempt_id, NULL, v_attempt.max_points,
            NULL, 'incomplete', 0, v_attempt.reviewer_principal_id,
            p_feedback, 'changes_requested', false, p_reason
        ) RETURNING id INTO v_result;
        UPDATE public.classroom_assignment_work
           SET submitted_at = NULL
         WHERE assignment_id = v_attempt.classroom_assignment_id
           AND seat_id = v_attempt.seat_id;
        RETURN QUERY SELECT 'ok'::varchar, v_result, NULL::uuid,
            'closed'::varchar, NULL::integer;
        RETURN;
    END IF;

    IF p_decision = 'accepted' AND
       (p_points IS NULL OR p_points < 0 OR p_points > v_attempt.max_points) THEN
        RETURN QUERY SELECT 'invalid_points'::varchar, NULL::uuid, NULL::uuid,
            v_attempt.state::varchar, NULL::integer;
        RETURN;
    END IF;
    IF p_decision IN ('incomplete', 'excused') AND p_reason IS NULL THEN
        RETURN QUERY SELECT 'reason_required'::varchar, NULL::uuid, NULL::uuid,
            v_attempt.state::varchar, NULL::integer;
        RETURN;
    END IF;

    v_outcome := CASE
        WHEN p_decision = 'accepted' AND p_points * 100 >= v_attempt.max_points * 60
            THEN 'passed'
        WHEN p_decision = 'accepted' THEN 'failed'
        ELSE p_decision
    END;
    v_percentage := CASE WHEN p_points IS NULL THEN NULL
                         ELSE (p_points * 10000) / v_attempt.max_points END;

    INSERT INTO public.learning_evaluations (
        tenant_id, attempt_id, evaluator_kind, evaluator_principal_id,
        status, points, max_points, feedback
    ) VALUES (
        v_attempt.tenant_id, p_attempt_id, 'teacher',
        v_attempt.reviewer_principal_id, 'completed', p_points,
        v_attempt.max_points, p_feedback
    );
    INSERT INTO public.assessment_results (
        tenant_id, attempt_id, raw_points, max_points,
        percentage_basis_points, outcome, manual_points,
        evaluator_principal_id, feedback, review_decision, completion_value,
        correction_reason
    ) VALUES (
        v_attempt.tenant_id, p_attempt_id, p_points, v_attempt.max_points,
        v_percentage, v_outcome, COALESCE(p_points, 0),
        v_attempt.reviewer_principal_id, p_feedback, p_decision,
        p_decision='accepted', p_reason
    ) RETURNING id INTO v_result;
    UPDATE public.learning_attempts
       SET state = 'closed', evaluated_at = now()
     WHERE id = p_attempt_id;

    INSERT INTO public.gradebook_entries (
        tenant_id, school_id, academic_period_id, classroom_id,
        classroom_assignment_id, seat_id, accepted_attempt_id,
        assessment_result_id, published_by_principal_id
    ) VALUES (
        v_attempt.tenant_id, v_attempt.school_id, v_attempt.academic_period_id,
        p_classroom_id, v_attempt.classroom_assignment_id, v_attempt.seat_id,
        p_attempt_id, v_result, v_attempt.reviewer_principal_id
    )
    ON CONFLICT (classroom_assignment_id, seat_id) DO UPDATE
       SET accepted_attempt_id = EXCLUDED.accepted_attempt_id,
           assessment_result_id = EXCLUDED.assessment_result_id,
           published_by_principal_id = EXCLUDED.published_by_principal_id,
           published_at = now(), updated_at = now()
    RETURNING id INTO v_gradebook;
    INSERT INTO public.grade_change_events (
        tenant_id, gradebook_entry_id, assessment_result_id,
        actor_principal_id, event_kind, reason, snapshot
    ) VALUES (
        v_attempt.tenant_id, v_gradebook, v_result,
        v_attempt.reviewer_principal_id, 'published',
        COALESCE(NULLIF(trim(p_reason), ''), 'Первичная публикация результата'),
        jsonb_build_object('points', p_points, 'maxPoints', v_attempt.max_points,
                           'percentageBasisPoints', v_percentage, 'outcome', v_outcome)
    );

    RETURN QUERY SELECT 'ok'::varchar, v_result, v_gradebook,
        'closed'::varchar, v_percentage;
END;
$$;

-- 0079 established the compatibility alias in public; redefining the legacy writer above
-- must preserve that lookup path instead of silently reintroducing pgcrypto dependency.
ALTER FUNCTION learning_project_submission_create(uuid,uuid,varchar)
  SET search_path = pg_catalog, public, pg_temp;
