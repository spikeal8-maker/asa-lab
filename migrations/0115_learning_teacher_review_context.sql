-- Authorized detail reads of existing runtime, not a second grade engine.
CREATE OR REPLACE FUNCTION learning_teacher_review_context(p_account uuid,p_class uuid,p_seat uuid,p_assignment uuid)
RETURNS TABLE(detail jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('participationId',part.id,'activityRunId',run.id,
   'resultMode',version.result_mode,'maxPoints',version.max_points,'title',version.title,
   'instructions',version.instructions,'moduleKey',version.module_key,
   'selectionPolicy',CASE WHEN version.result_mode='graded' THEN version.policy_snapshot#>>'{resultSelectionPolicy,mode}' ELSE 'latest_accepted' END,
   'teacherSelectedAttemptId',part.teacher_selected_attempt_id,
   'gradingScheme',(SELECT jsonb_build_object('id',scheme.id,'title',scheme.title,'version',scheme.version_number,'bands',scheme.bands,'source','run_pin')
     FROM public.grading_scheme_versions scheme WHERE scheme.id=run.grading_scheme_version_id),
   'attempts',COALESCE((SELECT jsonb_agg(jsonb_build_object(
     'id',a.id,'number',a.attempt_number,'state',a.state,'closedAt',a.evaluated_at,
     'revisionOfAttemptId',a.revision_of_attempt_id,'submissionId',s.id,
     'projectVersionId',s.project_version_id,'submittedAt',s.submitted_at,
     'results',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision_number,
       'supersedesId',r.supersedes_result_id,'decision',r.review_decision,'points',r.raw_points,
       'maxPoints',r.max_points,'feedback',r.feedback,'reason',r.correction_reason,
       'publishedAt',r.published_at) ORDER BY r.revision_number DESC)
       FROM public.assessment_results r WHERE r.attempt_id=a.id),'[]'::jsonb)) ORDER BY a.attempt_number DESC)
     FROM public.learning_attempts a LEFT JOIN public.learning_submissions s ON s.attempt_id=a.id
     WHERE a.activity_participation_id=part.id),'[]'::jsonb))
 FROM public.activity_runs run
 JOIN public.learning_activity_versions version ON version.id=run.learning_activity_version_id
 JOIN public.activity_participations part ON part.activity_run_id=run.id
 JOIN public.learner_identity_links link ON link.learner_identity_id=part.learner_identity_id
   AND link.seat_id=p_seat AND link.status='active'
 WHERE run.classroom_id=p_class AND run.source_classroom_assignment_id=p_assignment
   AND EXISTS(SELECT 1 FROM public.classroom_memberships m WHERE m.classroom_id=p_class
     AND m.account_id=p_account AND m.member_role IN ('owner','co_teacher'));
$$;
CREATE OR REPLACE FUNCTION learning_teacher_exact_submission(p_account uuid,p_class uuid,p_attempt uuid)
RETURNS TABLE(submission_id uuid,project_version_id uuid,payload_digest varchar,
 source_revision integer,module_key varchar,document_json jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT submission.id,submission.project_version_id,submission.payload_digest,
   (submission.payload_manifest->>'sourceRevision')::integer,project.module_key,version.document_json
 FROM public.learning_attempts attempt
 JOIN public.learning_submissions submission ON submission.attempt_id=attempt.id
 JOIN public.project_versions version ON version.id=submission.project_version_id
   AND version.project_id=submission.project_id AND version.tenant_id=submission.project_tenant_id
 JOIN public.projects project ON project.id=submission.project_id
 WHERE attempt.id=p_attempt AND attempt.classroom_id=p_class
   AND EXISTS(SELECT 1 FROM public.classroom_memberships m WHERE m.classroom_id=p_class
     AND m.account_id=p_account AND m.member_role IN ('owner','co_teacher'));
$$;
CREATE OR REPLACE FUNCTION learning_teacher_select_attempt(p_account uuid,p_principal uuid,p_class uuid,
 p_participation uuid,p_attempt uuid,p_expected uuid,p_reason varchar,p_request varchar)
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
 IF NOT EXISTS(SELECT 1 FROM public.learning_attempts attempt WHERE attempt.id=p_attempt
   AND attempt.activity_participation_id=p_participation AND attempt.state IN ('accepted','incomplete','excused','changes_requested')
   AND attempt.evaluated_at IS NOT NULL AND attempt.invalidated_at IS NULL) THEN RETURN 'invalid_attempt'; END IF;
 UPDATE public.activity_participations SET teacher_selected_attempt_id=p_attempt WHERE id=p_participation;
 INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
 VALUES(v_part.tenant_id,NULL,'activity_participation',p_participation,'learning.result.selected',
   jsonb_build_object('actorPrincipalId',p_principal,'attemptId',p_attempt,'expectedAttemptId',p_expected,'reason',p_reason,'requestId',p_request));
 RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION learning_teacher_review_context(uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_teacher_exact_submission(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_teacher_select_attempt(uuid,uuid,uuid,uuid,uuid,uuid,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_teacher_review_context(uuid,uuid,uuid,uuid),learning_teacher_exact_submission(uuid,uuid,uuid),
 learning_teacher_select_attempt(uuid,uuid,uuid,uuid,uuid,uuid,varchar,varchar) TO asalab_app;
