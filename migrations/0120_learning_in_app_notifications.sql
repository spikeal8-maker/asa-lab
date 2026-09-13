-- One persisted in-app channel. Academic queues remain independent of unread/preferences.
CREATE TABLE learning_notification_preferences (
 principal_id uuid PRIMARY KEY REFERENCES principals(id),revision integer NOT NULL DEFAULT 1,
 master_enabled boolean NOT NULL DEFAULT true,categories jsonb NOT NULL DEFAULT '{}'::jsonb,
 class_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE learning_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
 recipient_principal_id uuid NOT NULL REFERENCES principals(id),classroom_id uuid NOT NULL,
 assignment_id uuid REFERENCES classroom_assignments(id),attempt_id uuid REFERENCES learning_attempts(id),
 join_request_id uuid REFERENCES classroom_account_join_requests(id),course_run_id uuid REFERENCES classroom_course_runs(id),
 category varchar(4) NOT NULL,event_kind varchar(4) NOT NULL,event_key varchar(240) NOT NULL,
 recipient_kind varchar(12) NOT NULL CHECK(recipient_kind IN ('teacher','learner','requester')),
 delivery_state varchar(12) NOT NULL CHECK(delivery_state IN ('delivered','suppressed')),
 created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz,
 UNIQUE(recipient_principal_id,event_key),FOREIGN KEY(tenant_id,classroom_id) REFERENCES classrooms(tenant_id,id)
);
CREATE INDEX learning_notifications_inbox_idx ON learning_notifications(recipient_principal_id,created_at DESC) WHERE delivery_state='delivered';
REVOKE ALL ON learning_notification_preferences,learning_notifications FROM PUBLIC,asalab_app;
ALTER TABLE learning_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_notification_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_notification_preferences_own ON learning_notification_preferences
 USING(principal_id=NULLIF(current_setting('app.principal_id',true),'')::uuid)
 WITH CHECK(principal_id=NULLIF(current_setting('app.principal_id',true),'')::uuid);
CREATE POLICY learning_notifications_tenant ON learning_notifications
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE classrooms ADD COLUMN learner_due_reminders boolean NOT NULL DEFAULT false,
 ADD COLUMN learner_overdue_reminders boolean NOT NULL DEFAULT false,
 ADD COLUMN learning_reminder_revision integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION learning_notification_class_access(p_principal uuid,p_class uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.principals actor WHERE actor.id=p_principal AND (
   EXISTS(SELECT 1 FROM public.classroom_memberships m WHERE m.account_id=actor.account_id AND m.classroom_id=p_class AND m.member_role IN ('owner','co_teacher'))
   OR EXISTS(SELECT 1 FROM public.classroom_student_seats seat WHERE seat.classroom_id=p_class AND seat.status IN ('issued','active')
     AND (seat.id=actor.seat_id OR seat.account_id=actor.account_id))));
$$;
CREATE OR REPLACE FUNCTION learning_notification_resource_access(p_principal uuid,p_class uuid,p_assignment uuid,p_join uuid,p_kind varchar)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.principals actor WHERE actor.id=p_principal AND (
   (p_kind='teacher' AND EXISTS(SELECT 1 FROM public.classroom_memberships m WHERE m.classroom_id=p_class
     AND m.account_id=actor.account_id AND m.member_role IN ('owner','co_teacher')))
   OR (p_kind='requester' AND EXISTS(SELECT 1 FROM public.classroom_account_join_requests r WHERE r.id=p_join AND r.account_id=actor.account_id))
   OR (p_kind='learner' AND EXISTS(SELECT 1 FROM public.classroom_student_seats seat
     WHERE seat.classroom_id=p_class AND seat.status IN ('issued','active') AND (seat.id=actor.seat_id OR seat.account_id=actor.account_id)
       AND (p_assignment IS NULL OR public.learning_direct_assignment_seat_visible(seat.id,p_assignment))))));
$$;
CREATE OR REPLACE FUNCTION learning_notification_enabled(p_principal uuid,p_class uuid,p_category varchar)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE((SELECT master_enabled AND COALESCE(class_overrides#>>ARRAY[p_class::text,'mode'],'inherit')<>'off'
   AND CASE WHEN class_overrides#>>ARRAY[p_class::text,'mode']='custom'
     AND class_overrides#>>ARRAY[p_class::text,'categories',p_category] IN ('on','off')
     THEN class_overrides#>>ARRAY[p_class::text,'categories',p_category]='on'
     ELSE COALESCE((categories->>p_category)::boolean,p_category IN ('NC01','NC02','NC03','NC08')) END
   FROM public.learning_notification_preferences WHERE principal_id=p_principal),p_category IN ('NC01','NC02','NC03','NC08'));
$$;
CREATE OR REPLACE FUNCTION learning_notification_emit(p_principal uuid,p_class uuid,p_assignment uuid,p_attempt uuid,p_join uuid,
 p_course uuid,p_kind varchar,p_event varchar,p_category varchar,p_key varchar)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_tenant uuid;v_enabled boolean;
BEGIN
 IF p_principal IS NULL OR NOT public.learning_notification_resource_access(p_principal,p_class,p_assignment,p_join,p_kind) THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_principal::text,1120));
 SELECT tenant_id INTO v_tenant FROM public.classrooms WHERE id=p_class;
 v_enabled:=public.learning_notification_enabled(p_principal,p_class,p_category);
 IF p_kind='learner' AND p_event IN ('NF13','NF14') THEN
   v_enabled:=v_enabled AND EXISTS(SELECT 1 FROM public.classrooms WHERE id=p_class
     AND CASE WHEN p_event='NF13' THEN learner_due_reminders ELSE learner_overdue_reminders END);
 END IF;
 INSERT INTO public.learning_notifications(tenant_id,recipient_principal_id,classroom_id,assignment_id,attempt_id,join_request_id,course_run_id,
   recipient_kind,event_kind,category,event_key,delivery_state)
 VALUES(v_tenant,p_principal,p_class,p_assignment,p_attempt,p_join,p_course,p_kind,p_event,p_category,p_key,
   CASE WHEN v_enabled THEN 'delivered' ELSE 'suppressed' END)
 ON CONFLICT(recipient_principal_id,event_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION learning_notification_learner_actor(p_seat uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_actor uuid;v_account uuid;
BEGIN
 SELECT account_id INTO v_account FROM public.classroom_student_seats WHERE id=p_seat;
 IF v_account IS NOT NULL THEN SELECT id INTO v_actor FROM public.principals WHERE kind='account' AND account_id=v_account;
 ELSE SELECT principal_id INTO v_actor FROM public.student_seat_principal(p_seat); END IF;
 RETURN v_actor;
END;
$$;

CREATE OR REPLACE FUNCTION learning_notification_on_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_scope record;v_actor uuid;v_event varchar;v_recipient record;
BEGIN
 IF TG_TABLE_NAME='activity_participations' THEN
   SELECT run.classroom_id,run.source_classroom_assignment_id AS assignment_id,run.source_course_run_id AS course_id,link.seat_id
   INTO v_scope FROM public.activity_runs run JOIN public.learner_identity_links link ON link.learner_identity_id=NEW.learner_identity_id
     AND link.link_kind='student_seat' AND link.status='active' JOIN public.classroom_student_seats seat ON seat.id=link.seat_id AND seat.classroom_id=run.classroom_id
   WHERE run.id=NEW.activity_run_id LIMIT 1;
   v_actor:=public.learning_notification_learner_actor(v_scope.seat_id);
   PERFORM public.learning_notification_emit(v_actor,v_scope.classroom_id,v_scope.assignment_id,NULL,NULL,v_scope.course_id,
     'learner','NF01','NC01','assigned:'||NEW.id);
 ELSIF TG_TABLE_NAME='learning_submissions' THEN
   SELECT * INTO v_scope FROM public.learning_attempts WHERE id=NEW.attempt_id;
   IF v_scope.activity_participation_id IS NULL THEN RETURN NEW; END IF;
   FOR v_actor IN SELECT actor.id FROM public.classroom_memberships m JOIN public.principals actor ON actor.account_id=m.account_id AND actor.kind='account'
     WHERE m.classroom_id=v_scope.classroom_id AND m.member_role IN ('owner','co_teacher')
   LOOP
     PERFORM public.learning_notification_emit(v_actor,v_scope.classroom_id,v_scope.classroom_assignment_id,NEW.attempt_id,NULL,NULL,
       'teacher','NF02','NC02','submitted:'||NEW.id);
   END LOOP;
 ELSIF TG_TABLE_NAME='assessment_results' THEN
   SELECT * INTO v_scope FROM public.learning_attempts WHERE id=NEW.attempt_id;
   IF NEW.review_decision IS NULL THEN RETURN NEW; END IF;
   v_actor:=public.learning_notification_learner_actor(v_scope.seat_id);
   v_event:=CASE WHEN NEW.supersedes_result_id IS NOT NULL THEN 'NF05' WHEN NEW.review_decision='changes_requested' THEN 'NF03' ELSE 'NF04' END;
   PERFORM public.learning_notification_emit(v_actor,v_scope.classroom_id,v_scope.classroom_assignment_id,NEW.attempt_id,NULL,NULL,
     'learner',v_event,'NC03','result:'||NEW.id);
 ELSIF TG_TABLE_NAME='classroom_account_join_requests' THEN
   IF TG_OP='INSERT' THEN
     FOR v_actor IN SELECT actor.id FROM public.classroom_memberships m JOIN public.principals actor ON actor.account_id=m.account_id AND actor.kind='account'
       WHERE m.classroom_id=NEW.classroom_id AND m.member_role IN ('owner','co_teacher') LOOP
       PERFORM public.learning_notification_emit(v_actor,NEW.classroom_id,NULL,NULL,NEW.id,NULL,'teacher','NF06','NC08','join-request:'||NEW.id);
     END LOOP;
   ELSIF NEW.status<>OLD.status THEN
     SELECT id INTO v_actor FROM public.principals WHERE kind='account' AND account_id=NEW.account_id;
     PERFORM public.learning_notification_emit(v_actor,NEW.classroom_id,NULL,NULL,NEW.id,NULL,'requester','NF07','NC08','join-decision:'||NEW.id);
   END IF;
 ELSIF TG_TABLE_NAME='audit_events' AND NEW.action='learning.conditions.changed' THEN
   FOR v_recipient IN SELECT part.id,run.classroom_id,run.source_classroom_assignment_id AS assignment_id,seat.id AS seat_id
     FROM public.activity_runs run JOIN public.activity_participations part ON part.activity_run_id=run.id
     JOIN public.learner_identity_links link ON link.learner_identity_id=part.learner_identity_id AND link.status='active'
     JOIN public.classroom_student_seats seat ON seat.id=link.seat_id AND seat.classroom_id=run.classroom_id
     WHERE (run.id=NEW.entity_id OR part.id=NEW.entity_id) AND part.status IN ('assigned','active') LOOP
     PERFORM public.learning_notification_emit(public.learning_notification_learner_actor(v_recipient.seat_id),v_recipient.classroom_id,
       v_recipient.assignment_id,NULL,NULL,NULL,'learner','NF08','NC01','conditions:'||NEW.id||':'||v_recipient.id);
   END LOOP;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER learning_notification_assignment AFTER INSERT ON activity_participations FOR EACH ROW EXECUTE FUNCTION learning_notification_on_evidence();
CREATE TRIGGER learning_notification_submission AFTER INSERT ON learning_submissions FOR EACH ROW EXECUTE FUNCTION learning_notification_on_evidence();
CREATE TRIGGER learning_notification_result AFTER INSERT ON assessment_results FOR EACH ROW EXECUTE FUNCTION learning_notification_on_evidence();
CREATE TRIGGER learning_notification_join AFTER INSERT OR UPDATE ON classroom_account_join_requests FOR EACH ROW EXECUTE FUNCTION learning_notification_on_evidence();
CREATE TRIGGER learning_notification_conditions AFTER INSERT ON audit_events FOR EACH ROW WHEN(NEW.action='learning.conditions.changed') EXECUTE FUNCTION learning_notification_on_evidence();

REVOKE ALL ON FUNCTION learning_notification_class_access(uuid,uuid),learning_notification_resource_access(uuid,uuid,uuid,uuid,varchar),
 learning_notification_enabled(uuid,uuid,varchar),learning_notification_emit(uuid,uuid,uuid,uuid,uuid,uuid,varchar,varchar,varchar,varchar),
 learning_notification_learner_actor(uuid),learning_notification_on_evidence() FROM PUBLIC,asalab_app;
