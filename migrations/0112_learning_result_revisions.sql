-- E1 extends the existing assessment runtime. No historical result is rewritten.
ALTER TABLE assessment_results
  ALTER COLUMN max_points DROP NOT NULL,
  ADD COLUMN revision_number integer NOT NULL DEFAULT 1 CHECK (revision_number>0),
  ADD COLUMN supersedes_result_id uuid,
  ADD COLUMN review_decision varchar(24),
  ADD COLUMN completion_value boolean,
  ADD COLUMN client_request_id varchar(128),
  ADD COLUMN request_digest varchar(64),
  ADD COLUMN correction_reason varchar(1000),
  ADD CONSTRAINT assessment_results_supersedes_fk FOREIGN KEY (tenant_id,supersedes_result_id)
    REFERENCES assessment_results(tenant_id,id),
  DROP CONSTRAINT assessment_results_attempt_id_key,
  ADD CONSTRAINT assessment_results_attempt_revision_key UNIQUE(attempt_id,revision_number),
  ADD CONSTRAINT assessment_results_request_key UNIQUE(tenant_id,client_request_id);
ALTER TABLE learning_evaluations ALTER COLUMN max_points DROP NOT NULL;
ALTER TABLE learning_attempts ADD COLUMN revision_of_attempt_id uuid,
  ADD CONSTRAINT learning_attempts_revision_of_fk FOREIGN KEY(tenant_id,revision_of_attempt_id)
    REFERENCES learning_attempts(tenant_id,id);
ALTER TABLE activity_participations ADD COLUMN teacher_selected_attempt_id uuid,
  ADD CONSTRAINT activity_participations_selected_attempt_fk FOREIGN KEY(tenant_id,teacher_selected_attempt_id)
    REFERENCES learning_attempts(tenant_id,id);

-- Internal, used by the existing batched evidence projection and official review.
-- A missing/invalid explicit pointer never falls back to another attempt.
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
      result.percentage_basis_points,COALESCE(result.review_decision,attempt.state) AS decision,
      settings.policy,settings.teacher_selected_attempt_id
    FROM settings
    JOIN public.learning_attempts attempt ON attempt.activity_participation_id=settings.id
    LEFT JOIN LATERAL (SELECT revision.* FROM public.assessment_results revision
      WHERE revision.attempt_id=attempt.id ORDER BY revision.revision_number DESC LIMIT 1) result ON true
    WHERE attempt.state IN ('accepted','changes_requested','incomplete','excused')
      AND attempt.invalidated_at IS NULL AND attempt.evaluated_at IS NOT NULL
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
REVOKE ALL ON FUNCTION learning_selected_result_internal(uuid) FROM PUBLIC,asalab_app;

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
     CASE WHEN v_retry.request_digest=v_digest THEN v_retry.review_decision END::varchar,
     CASE WHEN v_retry.request_digest=v_digest THEN v_retry.percentage_basis_points END; RETURN;
 END IF;
 SELECT * INTO v_prior FROM public.assessment_results WHERE attempt_id=p_attempt_id ORDER BY revision_number DESC LIMIT 1;
 IF v_prior.id IS DISTINCT FROM p_expected_result_id THEN
   RETURN QUERY SELECT 'result_revision_conflict'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 IF v_attempt.state='invalidated'
 OR (v_prior.id IS NULL AND v_attempt.state NOT IN ('submitted','evaluating'))
 OR (v_prior.id IS NOT NULL AND (p_decision='changes_requested' OR v_attempt.state='changes_requested')) THEN
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
   UPDATE public.learning_attempts SET state=p_decision,evaluated_at=now() WHERE id=p_attempt_id;
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
   CASE WHEN v_prior.id IS NULL THEN p_decision ELSE v_attempt.state END::varchar,v_percentage;
END;
$$;
REVOKE ALL ON FUNCTION learning_attempt_review_v2(uuid,uuid,uuid,uuid,varchar,integer,varchar,varchar,uuid,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_attempt_review_v2(uuid,uuid,uuid,uuid,varchar,integer,varchar,varchar,uuid,varchar) TO asalab_app;
