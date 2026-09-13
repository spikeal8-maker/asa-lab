-- Learner and teacher select from the same attempt/revision source. Mutable compatibility pointers are not authoritative for canonical runs.
CREATE OR REPLACE FUNCTION learning_results_for_seat(p_seat_id uuid)
RETURNS TABLE(classroom_title varchar,assignment_id uuid,assignment_title varchar,attempt_number integer,state varchar,
 raw_points integer,max_points integer,percentage_basis_points integer,display_grade varchar,outcome varchar,feedback varchar,published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT classroom.title,assignment.id,COALESCE(version.title,task.title,lesson.assignment_title,quiz.title),
   attempt.attempt_number,COALESCE(result.review_decision,attempt.state),result.raw_points,result.max_points,result.percentage_basis_points,
   CASE WHEN run.id IS NOT NULL THEN public.learning_grade_label_for_run(run.id,result.percentage_basis_points)
     ELSE public.grade_label_for_classroom(classroom.id,result.percentage_basis_points) END,
   result.outcome,result.feedback,result.published_at
 FROM public.classroom_student_seats seat JOIN public.classrooms classroom ON classroom.id=seat.classroom_id
 JOIN public.classroom_assignments assignment ON assignment.classroom_id=classroom.id
 LEFT JOIN public.activity_runs run ON run.source_classroom_assignment_id=assignment.id
 LEFT JOIN public.learning_activity_versions version ON version.id=run.learning_activity_version_id
 LEFT JOIN public.learner_identity_links link ON link.seat_id=seat.id AND link.status='active' AND link.school_id=run.school_id AND link.tenant_id=run.tenant_id
 LEFT JOIN public.activity_participations part ON part.activity_run_id=run.id AND part.learner_identity_id=link.learner_identity_id
 LEFT JOIN LATERAL public.learning_selected_result_internal(part.id) selected ON true
 LEFT JOIN public.gradebook_entries grade ON grade.classroom_assignment_id=assignment.id AND grade.seat_id=seat.id
 JOIN public.assessment_results result ON result.id=CASE WHEN run.id IS NOT NULL THEN selected.result_id ELSE grade.assessment_result_id END
 JOIN public.learning_attempts attempt ON attempt.id=result.attempt_id
 LEFT JOIN public.teacher_assignments task ON task.id=assignment.assignment_id
 LEFT JOIN public.classroom_course_run_lessons lesson ON lesson.classroom_assignment_id=assignment.id
 LEFT JOIN public.quiz_versions quiz ON quiz.id=assignment.quiz_version_id
 WHERE seat.id=p_seat_id AND seat.status='active' AND (run.id IS NULL OR public.learning_direct_assignment_seat_visible(seat.id,assignment.id))
 ORDER BY result.published_at DESC,assignment.id;
$$;

CREATE OR REPLACE FUNCTION grading_scheme_publish_v2(p_account uuid,p_actor uuid,p_class uuid,p_title varchar,p_bands jsonb,p_request varchar)
RETURNS TABLE(result_code varchar,grading_scheme_version_id uuid,version_number integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_class record;v_previous jsonb;v_result record;
BEGIN
 SELECT c.* INTO v_class FROM public.classrooms c WHERE c.id=p_class AND EXISTS(SELECT 1 FROM public.classroom_memberships m
   JOIN public.principals actor ON actor.account_id=m.account_id WHERE m.classroom_id=c.id AND m.account_id=p_account AND actor.id=p_actor AND m.member_role IN ('owner','co_teacher'));
 IF v_class.id IS NULL THEN RETURN QUERY SELECT 'classroom_not_found'::varchar,NULL::uuid,NULL::integer;RETURN;END IF;
 IF p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' THEN RETURN QUERY SELECT 'invalid_request'::varchar,NULL::uuid,NULL::integer;RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_class.school_id::text,1125));
 SELECT payload_json INTO v_previous FROM public.audit_events WHERE entity_id=p_class AND action='learning.grading_scheme.published'
   AND payload_json->>'requestId'=p_request AND payload_json->>'actorPrincipalId'=p_actor::text LIMIT 1;
 IF v_previous IS NOT NULL THEN
   IF v_previous->>'title'=p_title AND v_previous->'bands'=p_bands THEN
     RETURN QUERY SELECT 'ok'::varchar,(v_previous->>'versionId')::uuid,(v_previous->>'version')::integer;
   ELSE RETURN QUERY SELECT 'request_conflict'::varchar,NULL::uuid,NULL::integer; END IF;RETURN;
 END IF;
 SELECT * INTO v_result FROM public.grading_scheme_publish(p_account,p_actor,p_class,p_title,p_bands);
 IF v_result.result_code='ok' THEN
   INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
   VALUES(v_class.tenant_id,'classroom',p_class,'learning.grading_scheme.published',jsonb_build_object('requestId',p_request,
     'actorPrincipalId',p_actor,'title',p_title,'bands',p_bands,'versionId',v_result.grading_scheme_version_id,'version',v_result.version_number));
 END IF;
 RETURN QUERY SELECT v_result.result_code::varchar,v_result.grading_scheme_version_id::uuid,v_result.version_number::integer;
END;
$$;
REVOKE ALL ON FUNCTION grading_scheme_publish_v2(uuid,uuid,uuid,varchar,jsonb,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grading_scheme_publish_v2(uuid,uuid,uuid,varchar,jsonb,varchar) TO asalab_app;
