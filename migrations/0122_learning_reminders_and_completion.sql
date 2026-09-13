CREATE OR REPLACE FUNCTION learning_course_completion_internal(p_enrollment uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH lessons AS (
 SELECT lesson.id,CASE WHEN lesson.kind='material' THEN progress.id IS NOT NULL
   ELSE COALESCE(result.completion_value,false) END AS completed,
   CASE WHEN lesson.kind='material' THEN progress.id ELSE result.id END AS basis_id
 FROM public.course_enrollments enrollment JOIN public.classroom_course_runs course ON course.id=enrollment.course_run_id
 JOIN public.classroom_course_run_lessons lesson ON lesson.run_id=enrollment.course_run_id
 LEFT JOIN public.learner_identity_links link ON link.learner_identity_id=enrollment.learner_identity_id AND link.status='active' AND link.link_kind='student_seat'
 LEFT JOIN public.classroom_student_seats seat ON seat.id=link.seat_id
 LEFT JOIN public.classroom_course_lesson_progress progress ON progress.lesson_id=lesson.id AND progress.seat_id=seat.id
 LEFT JOIN public.activity_runs run ON run.source_course_lesson_id=lesson.id
 LEFT JOIN public.activity_participations part ON part.activity_run_id=run.id AND part.source_course_enrollment_id=enrollment.id
 LEFT JOIN LATERAL public.learning_selected_result_internal(part.id) selected ON true
 LEFT JOIN public.assessment_results result ON result.id=selected.result_id
 WHERE enrollment.id=p_enrollment AND enrollment.status IN ('assigned','active')
   AND seat.classroom_id=course.classroom_id
 ) SELECT jsonb_build_object('completed',count(*)>0 AND bool_and(completed),'total',count(*),
   'completedCount',count(*) FILTER(WHERE completed),'basisIds',jsonb_agg(basis_id ORDER BY id),'resultPolicy','no_course_grade') FROM lessons;
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
   LEFT JOIN LATERAL(SELECT attempt.state FROM public.learning_attempts attempt WHERE attempt.activity_participation_id=part.id ORDER BY attempt.attempt_number DESC LIMIT 1) latest ON true
   LEFT JOIN LATERAL public.learning_selected_result_internal(part.id) selected ON true
   LEFT JOIN public.assessment_results result ON result.id=selected.result_id
   WHERE part.status IN ('assigned','active') AND NOT part.excused AND run.lifecycle_status='active'
     AND EXISTS(SELECT 1 FROM public.learning_notifications n WHERE n.event_key='assigned:'||part.id)
     AND (course.id IS NULL OR course.status='open') AND COALESCE(result.completion_value,false)=false
     AND (latest.state IS NULL OR latest.state IN ('in_progress','changes_requested'))
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
CREATE OR REPLACE FUNCTION learning_class_reminders(p_actor uuid,p_class uuid,p_expected integer DEFAULT NULL,p_due boolean DEFAULT NULL,p_overdue boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_class public.classrooms%ROWTYPE;
BEGIN
 SELECT c.* INTO v_class FROM public.classrooms c WHERE c.id=p_class AND EXISTS(SELECT 1 FROM public.classroom_memberships m
   JOIN public.principals principal ON principal.account_id=m.account_id WHERE principal.id=p_actor AND m.classroom_id=p_class AND m.member_role IN ('owner','co_teacher')) FOR UPDATE;
 IF v_class.id IS NULL THEN RETURN NULL; END IF;
 IF p_expected IS NOT NULL THEN
   IF p_expected<>v_class.learning_reminder_revision OR p_due IS NULL OR p_overdue IS NULL THEN RETURN jsonb_build_object('error','revision_conflict'); END IF;
   UPDATE public.classrooms SET learner_due_reminders=p_due,learner_overdue_reminders=p_overdue,learning_reminder_revision=learning_reminder_revision+1
     WHERE id=p_class RETURNING * INTO v_class;
   INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
   VALUES(v_class.tenant_id,NULL,'classroom',p_class,'learning.reminder_policy.changed',jsonb_build_object('actorPrincipalId',p_actor,'due',p_due,'overdue',p_overdue));
 END IF;
 RETURN jsonb_build_object('revision',v_class.learning_reminder_revision,'due',v_class.learner_due_reminders,'overdue',v_class.learner_overdue_reminders);
END;
$$;
REVOKE ALL ON FUNCTION learning_course_completion_internal(uuid),learning_notification_sweep(),learning_class_reminders(uuid,uuid,integer,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_notification_sweep(),learning_class_reminders(uuid,uuid,integer,boolean,boolean) TO asalab_app;
