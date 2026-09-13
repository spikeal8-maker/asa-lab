CREATE OR REPLACE FUNCTION learning_notification_preferences_get(p_actor uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('revision',COALESCE(pref.revision,0),'masterEnabled',COALESCE(pref.master_enabled,true),
   'categories','{"NC01":true,"NC02":true,"NC03":true,"NC04":false,"NC05":false,"NC06":false,"NC08":true}'::jsonb||COALESCE(pref.categories,'{}'),
   'classOverrides',COALESCE((SELECT jsonb_object_agg(entry.key,entry.value) FROM jsonb_each(COALESCE(pref.class_overrides,'{}')) entry
     WHERE public.learning_notification_class_access(p_actor,entry.key::uuid)),'{}'),
   'classes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title) ORDER BY c.title)
     FROM public.classrooms c WHERE public.learning_notification_class_access(p_actor,c.id)),'[]'))
 FROM public.principals actor LEFT JOIN public.learning_notification_preferences pref ON pref.principal_id=actor.id WHERE actor.id=p_actor;
$$;
CREATE OR REPLACE FUNCTION learning_notification_preferences_save(p_actor uuid,p_expected integer,p_master boolean,p_categories jsonb,p_classes jsonb,p_request varchar)
RETURNS varchar LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_pref public.learning_notification_preferences%ROWTYPE;v_entry record;v_category record;v_prior jsonb;v_tenant uuid;
BEGIN
 IF p_actor IS NULL OR p_expected IS NULL OR p_master IS NULL OR jsonb_typeof(p_categories)<>'object' OR p_categories IS NULL
   OR p_categories-ARRAY['NC01','NC02','NC03','NC04','NC05','NC06','NC08']<>'{}'::jsonb
   OR jsonb_typeof(p_classes)<>'object' OR p_classes IS NULL OR length(p_classes::text)>50000
   OR p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' THEN RETURN 'invalid_preferences'; END IF;
 FOR v_category IN SELECT * FROM jsonb_each(p_categories) LOOP
   IF jsonb_typeof(v_category.value)<>'boolean' THEN RETURN 'invalid_category'; END IF;
 END LOOP;
 FOR v_entry IN SELECT * FROM jsonb_each(p_classes) LOOP
   IF v_entry.key !~ '^[0-9a-f-]{36}$' OR NOT public.learning_notification_class_access(p_actor,v_entry.key::uuid) THEN RETURN 'forbidden'; END IF;
   IF jsonb_typeof(v_entry.value)<>'object' OR v_entry.value-ARRAY['mode','categories']<>'{}'::jsonb
      OR v_entry.value->>'mode' IS NULL OR v_entry.value->>'mode' NOT IN ('off','custom') THEN RETURN 'invalid_class_rule'; END IF;
   IF v_entry.value?'categories' THEN
     IF jsonb_typeof(v_entry.value->'categories')<>'object' OR (v_entry.value->'categories')-ARRAY['NC01','NC02','NC03','NC04','NC05','NC06','NC08']<>'{}'::jsonb THEN RETURN 'invalid_category'; END IF;
     FOR v_category IN SELECT * FROM jsonb_each(v_entry.value->'categories') LOOP
       IF v_category.value NOT IN ('"inherit"'::jsonb,'"on"'::jsonb,'"off"'::jsonb) THEN RETURN 'invalid_category'; END IF;
     END LOOP;
   END IF;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text,1120));
 SELECT * INTO v_pref FROM public.learning_notification_preferences WHERE principal_id=p_actor FOR UPDATE;
 SELECT payload_json INTO v_prior FROM public.audit_events WHERE entity_id=p_actor AND action='learning.notification_preferences.changed'
   AND payload_json->>'requestId'=p_request LIMIT 1;
 IF v_prior IS NOT NULL THEN
   IF v_prior->'categories'=p_categories AND v_prior->'classOverrides'=p_classes AND (v_prior->>'masterEnabled')::boolean=p_master
     AND (v_prior->>'expectedRevision')::integer=p_expected THEN RETURN 'ok'; END IF;
   RETURN 'request_conflict';
 END IF;
 IF COALESCE(v_pref.revision,0)<>p_expected THEN RETURN 'preferences_conflict'; END IF;
 SELECT tenant_id INTO v_tenant FROM public.classrooms c WHERE public.learning_notification_class_access(p_actor,c.id) LIMIT 1;
 IF v_tenant IS NULL THEN SELECT workspace.tenant_id INTO v_tenant FROM public.principals actor
   JOIN public.workspace_memberships membership ON membership.account_id=actor.account_id
   JOIN public.workspaces workspace ON workspace.id=membership.workspace_id AND workspace.kind='personal'
   WHERE actor.id=p_actor AND membership.role='owner' LIMIT 1; END IF;
 -- Preferences can exist for an author with no class. Audit tenant uses their existing workspace lineage.
 IF v_tenant IS NULL THEN RETURN 'workspace_not_found'; END IF;
 INSERT INTO public.learning_notification_preferences(principal_id,master_enabled,categories,class_overrides)
 VALUES(p_actor,p_master,p_categories,p_classes)
 ON CONFLICT(principal_id) DO UPDATE SET master_enabled=p_master,categories=p_categories,class_overrides=p_classes,
   revision=learning_notification_preferences.revision+1,updated_at=now();
 INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
 VALUES(v_tenant,NULL,'principal',p_actor,'learning.notification_preferences.changed',jsonb_build_object('requestId',p_request,
   'expectedRevision',p_expected,'masterEnabled',p_master,'categories',p_categories,'classOverrides',p_classes));
 RETURN 'ok';
END;
$$;

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
   AND public.learning_notification_resource_access(p_actor,n.classroom_id,n.assignment_id,n.join_request_id,n.recipient_kind)
 ORDER BY n.created_at DESC,n.id DESC LIMIT 100;
$$;
CREATE OR REPLACE FUNCTION learning_notifications_unread(p_actor uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT count(*)::integer FROM public.learning_notifications n WHERE n.recipient_principal_id=p_actor AND n.delivery_state='delivered' AND n.read_at IS NULL
   AND public.learning_notification_resource_access(p_actor,n.classroom_id,n.assignment_id,n.join_request_id,n.recipient_kind);
$$;
CREATE OR REPLACE FUNCTION learning_notifications_mark_read(p_actor uuid,p_ids uuid[],p_as_of timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_count integer;
BEGIN
 IF p_as_of IS NULL OR p_as_of>now() OR cardinality(p_ids)>100 THEN RETURN 0; END IF;
 UPDATE public.learning_notifications n SET read_at=now() WHERE n.recipient_principal_id=p_actor AND n.delivery_state='delivered'
   AND n.created_at<=p_as_of AND n.read_at IS NULL AND (p_ids IS NULL OR n.id=ANY(p_ids))
   AND public.learning_notification_resource_access(p_actor,n.classroom_id,n.assignment_id,n.join_request_id,n.recipient_kind);
 GET DIAGNOSTICS v_count=ROW_COUNT;RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION learning_notification_preferences_get(uuid),learning_notification_preferences_save(uuid,integer,boolean,jsonb,jsonb,varchar),
 learning_notifications_list(uuid,timestamptz),learning_notifications_unread(uuid),learning_notifications_mark_read(uuid,uuid[],timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_notification_preferences_get(uuid),learning_notification_preferences_save(uuid,integer,boolean,jsonb,jsonb,varchar),
 learning_notifications_list(uuid,timestamptz),learning_notifications_unread(uuid),learning_notifications_mark_read(uuid,uuid[],timestamptz) TO asalab_app;
