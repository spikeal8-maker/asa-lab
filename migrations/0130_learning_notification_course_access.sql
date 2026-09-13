-- Recheck course enrollment as well as class membership for persisted notifications.
CREATE OR REPLACE FUNCTION learning_notification_current_access(p_actor uuid,p_notification uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.learning_notification_resource_access(p_actor,n.classroom_id,n.assignment_id,n.join_request_id,n.recipient_kind)
 AND (n.recipient_kind<>'learner' OR n.course_run_id IS NULL OR EXISTS(
   SELECT 1 FROM public.course_enrollments enrollment
   JOIN public.learner_identity_links link ON link.learner_identity_id=enrollment.learner_identity_id AND link.status='active'
   JOIN public.classroom_student_seats seat ON seat.id=link.seat_id AND seat.classroom_id=n.classroom_id AND seat.status IN ('issued','active')
   JOIN public.principals actor ON actor.id=p_actor AND (actor.seat_id=seat.id OR actor.account_id=seat.account_id)
   WHERE enrollment.course_run_id=n.course_run_id AND enrollment.status IN ('assigned','active')))
 FROM public.learning_notifications n WHERE n.id=p_notification AND n.recipient_principal_id=p_actor;
$$;
REVOKE ALL ON FUNCTION learning_notification_current_access(uuid,uuid) FROM PUBLIC,asalab_app;

CREATE OR REPLACE FUNCTION learning_notifications_list(p_actor uuid,p_before timestamptz DEFAULT NULL)
RETURNS TABLE(item jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',n.id,'kind',n.event_kind,'category',n.category,'classroomId',n.classroom_id,'classroomTitle',c.title,
   'assignmentId',n.assignment_id,'attemptId',n.attempt_id,'courseRunId',n.course_run_id,'joinRequestId',n.join_request_id,
   'recipientKind',n.recipient_kind,'createdAt',n.created_at,'readAt',n.read_at)
   ||jsonb_build_object('seatId',(SELECT seat_id FROM public.learning_attempts WHERE id=n.attempt_id),
     'title',COALESCE((SELECT COALESCE(version.title,task.title,lesson.assignment_title,quiz.title) FROM public.classroom_assignments assignment
       LEFT JOIN public.learning_activity_versions version ON version.id=assignment.learning_activity_version_id
       LEFT JOIN public.teacher_assignments task ON task.id=assignment.assignment_id
       LEFT JOIN public.classroom_course_run_lessons lesson ON lesson.classroom_assignment_id=assignment.id
       LEFT JOIN public.quiz_versions quiz ON quiz.id=assignment.quiz_version_id WHERE assignment.id=n.assignment_id),
       (SELECT title FROM public.classroom_course_runs WHERE id=n.course_run_id),c.title))
 FROM public.learning_notifications n JOIN public.classrooms c ON c.id=n.classroom_id
 WHERE n.recipient_principal_id=p_actor AND n.delivery_state='delivered' AND (p_before IS NULL OR n.created_at<p_before)
   AND public.learning_notification_current_access(p_actor,n.id)
 ORDER BY n.created_at DESC,n.id DESC LIMIT 100;
$$;
CREATE OR REPLACE FUNCTION learning_notifications_unread(p_actor uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT count(*)::integer FROM public.learning_notifications n WHERE n.recipient_principal_id=p_actor AND n.delivery_state='delivered' AND n.read_at IS NULL
   AND public.learning_notification_current_access(p_actor,n.id);
$$;
CREATE OR REPLACE FUNCTION learning_notifications_mark_read(p_actor uuid,p_ids uuid[],p_as_of timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_count integer;
BEGIN
 IF p_as_of IS NULL OR p_as_of>now() OR cardinality(p_ids)>100 THEN RETURN 0; END IF;
 UPDATE public.learning_notifications n SET read_at=now() WHERE n.recipient_principal_id=p_actor AND n.delivery_state='delivered'
   AND n.created_at<=p_as_of AND n.read_at IS NULL AND (p_ids IS NULL OR n.id=ANY(p_ids))
   AND public.learning_notification_current_access(p_actor,n.id);
 GET DIAGNOSTICS v_count=ROW_COUNT;RETURN v_count;
END;
$$;
