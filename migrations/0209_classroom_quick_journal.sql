-- UI slots are never inserted by a read. A class-wide key makes first writes
-- from two teachers converge on the same column, independently of request IDs.
CREATE TABLE classroom_journal_slots (
 tenant_id uuid NOT NULL REFERENCES tenants(id), classroom_id uuid NOT NULL,
 slot_key varchar(32) NOT NULL CHECK(slot_key ~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2]):[1-9][0-9]{0,5}$'),
 column_id uuid NOT NULL, PRIMARY KEY(classroom_id,slot_key), UNIQUE(column_id),
 FOREIGN KEY(tenant_id,classroom_id,column_id) REFERENCES classroom_journal_columns(tenant_id,classroom_id,id)
);
-- Keep the original evidence immutable. Header corrections are append-only,
-- versioned separately from grades and from the column's pinned scale.
CREATE TABLE classroom_journal_headers (
 tenant_id uuid NOT NULL REFERENCES tenants(id), classroom_id uuid NOT NULL, column_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0), lesson_date date NOT NULL CHECK(lesson_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
 category varchar(80) NOT NULL CHECK(length(btrim(category)) BETWEEN 1 AND 80 AND category !~ '[[:cntrl:]]'),
 author_id uuid NOT NULL REFERENCES principals(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(column_id,revision),
 FOREIGN KEY(tenant_id,classroom_id,column_id) REFERENCES classroom_journal_columns(tenant_id,classroom_id,id)
);
CREATE TRIGGER journal_slots_immutable BEFORE UPDATE OR DELETE ON classroom_journal_slots FOR EACH ROW EXECUTE FUNCTION classroom_journal_immutable();
CREATE TRIGGER journal_headers_immutable BEFORE UPDATE OR DELETE ON classroom_journal_headers FOR EACH ROW EXECUTE FUNCTION classroom_journal_immutable();
ALTER TABLE classroom_journal_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_journal_slots FORCE ROW LEVEL SECURITY;
ALTER TABLE classroom_journal_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_journal_headers FORCE ROW LEVEL SECURITY;
CREATE POLICY journal_slots_tenant ON classroom_journal_slots USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY journal_headers_tenant ON classroom_journal_headers USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON classroom_journal_slots,classroom_journal_headers FROM PUBLIC,asalab_app;

CREATE FUNCTION classroom_journal_column_json(p_column uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',c.id,'date',COALESCE(h.lesson_date,c.lesson_date),'category',COALESCE(h.category,c.category),
 'preset',s.preset,'scaleVersion',s.version,'headerRevision',COALESCE(h.revision,0),'slotKey',slot.slot_key)
 FROM public.classroom_journal_columns c JOIN public.classroom_journal_scales s ON s.id=c.scale_id
 LEFT JOIN LATERAL (SELECT * FROM public.classroom_journal_headers WHERE column_id=c.id ORDER BY revision DESC LIMIT 1) h ON true
 LEFT JOIN public.classroom_journal_slots slot ON slot.column_id=c.id WHERE c.id=p_column;
$$;

-- Effective dates participate in the month filter and paging. No months x slots
-- expansion and no mutation: at most 51 column projections and this page's grades.
CREATE FUNCTION classroom_journal_quick_read(p_actor uuid,p_class uuid,p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,p_column uuid DEFAULT NULL,p_slot varchar DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_range jsonb; v_result jsonb;
BEGIN
 IF NOT public.classroom_journal_teacher(p_actor,p_class) THEN RETURN NULL; END IF;
 IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
 THEN RAISE EXCEPTION 'invalid journal page' USING ERRCODE='22023'; END IF;
 IF (p_column IS NOT NULL AND p_slot IS NOT NULL) OR
 (p_slot IS NOT NULL AND p_slot !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2]):[1-9][0-9]{0,5}$')
 THEN RAISE EXCEPTION 'invalid journal column selector' USING ERRCODE='22023'; END IF;
 v_range:=public.classroom_journal_range(public.classroom_journal_timezone(p_class),p_from,p_to);
 WITH candidates AS MATERIALIZED (
 SELECT c.id,c.created_at,COALESCE(h.lesson_date,c.lesson_date) AS lesson_date FROM public.classroom_journal_columns c
 LEFT JOIN LATERAL (SELECT lesson_date FROM public.classroom_journal_headers WHERE column_id=c.id ORDER BY revision DESC LIMIT 1) h ON true
 WHERE c.classroom_id=p_class AND CASE
 WHEN p_column IS NOT NULL THEN c.id=p_column
 WHEN p_slot IS NOT NULL THEN c.id=(SELECT column_id FROM public.classroom_journal_slots WHERE classroom_id=p_class AND slot_key=p_slot)
 ELSE COALESCE(h.lesson_date,c.lesson_date) BETWEEN (v_range->>'from')::date AND (v_range->>'to')::date END
 ORDER BY lesson_date,c.created_at,c.id LIMIT p_limit+1 OFFSET p_offset
 ), page AS MATERIALIZED (SELECT * FROM candidates ORDER BY lesson_date,created_at,id LIMIT p_limit),
 latest AS (SELECT DISTINCT ON(r.column_id,r.seat_id) r.* FROM public.classroom_journal_revisions r JOIN page ON page.id=r.column_id ORDER BY r.column_id,r.seat_id,r.revision DESC)
 SELECT public.classroom_journal_settings(p_actor,p_class)||jsonb_build_object('range',v_range,'offset',p_offset,
 'nextOffset',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN p_offset+p_limit END,
 'reservedSlotKeys',COALESCE((SELECT jsonb_agg(slot_key ORDER BY slot_key) FROM public.classroom_journal_slots WHERE classroom_id=p_class AND left(slot_key,7)=left(v_range->>'from',7)),'[]'::jsonb),
 'students',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.display_label,'status',s.status) ORDER BY s.display_label,s.id) FROM public.classroom_student_seats s WHERE s.classroom_id=p_class),'[]'::jsonb),
 'columns',COALESCE((SELECT jsonb_agg(public.classroom_journal_column_json(page.id) ORDER BY lesson_date,created_at,id) FROM page),'[]'::jsonb),
 'grades',COALESCE((SELECT jsonb_agg(public.classroom_journal_grade_json(r::public.classroom_journal_revisions,profile.display_name::text)) FROM latest r
 JOIN public.principals author ON author.id=r.author_id LEFT JOIN public.profiles profile ON profile.account_id=author.account_id),'[]'::jsonb)) INTO v_result;
 RETURN v_result;
END;
$$;

CREATE FUNCTION classroom_journal_quick_write(p_actor uuid,p_class uuid,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_class public.classrooms%ROWTYPE; v_prior public.classroom_journal_receipts%ROWTYPE;
 v_column uuid; v_result jsonb; v_grade jsonb; v_payload jsonb; v_revision integer; v_error text;
BEGIN
 IF NOT public.classroom_journal_teacher(p_actor,p_class) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR length(p_input::text)>4000
 OR p_input-ARRAY['requestId','slotKey','columnId','date','category','expectedScaleVersion','expectedHeaderRevision','seatId','value','expectedRevision','reason']<>'{}'::jsonb
 OR jsonb_typeof(p_input->'requestId') IS DISTINCT FROM 'string' OR COALESCE(p_input->>'requestId','') !~ '^[A-Za-z0-9._:-]{8,110}$'
 OR COALESCE(p_input->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 OR jsonb_typeof(p_input->'date')<>'string' OR jsonb_typeof(p_input->'category')<>'string'
 OR COALESCE(length(btrim(p_input->>'category')),0) NOT BETWEEN 1 AND 80 OR length(p_input->>'category')>80 OR p_input->>'category' ~ '[[:cntrl:]]'
 OR jsonb_typeof(p_input->'expectedScaleVersion')<>'number' OR COALESCE(p_input->>'expectedScaleVersion','') !~ '^[0-9]{1,9}$'
 OR jsonb_typeof(p_input->'expectedHeaderRevision')<>'number' OR COALESCE(p_input->>'expectedHeaderRevision','') !~ '^[0-9]{1,9}$'
 THEN RETURN '{"error":"invalid_body"}'; END IF;
 BEGIN
 IF (p_input->>'date')::date NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN RETURN '{"error":"invalid_body"}'; END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN '{"error":"invalid_body"}'; END;
 IF p_input?'seatId' THEN
 IF jsonb_typeof(p_input->'seatId') IS DISTINCT FROM 'string' OR COALESCE(p_input->>'seatId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
 OR NOT(p_input?'value') OR jsonb_typeof(p_input->'expectedRevision') IS DISTINCT FROM 'number' OR COALESCE(p_input->>'expectedRevision','') !~ '^[0-9]{1,9}$'
 OR (p_input->>'value' IS NOT NULL AND (jsonb_typeof(p_input->'value') IS DISTINCT FROM 'number' OR p_input->>'value' !~ '^[0-9]{1,3}$'))
 OR (p_input->>'reason' IS NOT NULL AND (jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_input->>'reason')) NOT BETWEEN 1 AND 500 OR length(p_input->>'reason')>500 OR p_input->>'reason' ~ '[[:cntrl:]]'))
 THEN RETURN '{"error":"invalid_body"}'; END IF;
 ELSIF p_input ?| ARRAY['value','reason','expectedRevision'] THEN RETURN '{"error":"invalid_body"}'; END IF;
 IF (p_input?'columnId')=(p_input?'slotKey') THEN RETURN '{"error":"invalid_body"}'; END IF;
 IF p_input->>'columnId' IS NULL THEN
 IF jsonb_typeof(p_input->'slotKey')<>'string' OR COALESCE(p_input->>'slotKey','') !~ '^(20[0-9]{2}|2100)-(0[1-9]|1[0-2]):[1-9][0-9]{0,5}$'
 OR left(p_input->>'slotKey',7)<>left(p_input->>'date',7) THEN RETURN '{"error":"invalid_body"}'; END IF;
 ELSE
 BEGIN v_column:=(p_input->>'columnId')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RETURN '{"error":"invalid_body"}'; END;
 END IF;
 SELECT * INTO v_class FROM public.classrooms WHERE id=p_class FOR UPDATE;
 -- Recheck authority after acquiring the same class lock used by normal writes.
 IF NOT public.classroom_journal_teacher(p_actor,p_class) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF v_class.status<>'active' THEN RETURN '{"error":"classroom_archived"}'; END IF;
 v_payload:=jsonb_build_object('action','quick','input',p_input);
 SELECT * INTO v_prior FROM public.classroom_journal_receipts WHERE classroom_id=p_class AND actor_id=p_actor AND request_id=p_input->>'requestId';
 IF v_prior.actor_id IS NOT NULL THEN
 IF v_prior.payload<>v_payload THEN RETURN '{"error":"idempotency_conflict"}'; END IF;
 RETURN v_prior.result;
 END IF;
 -- This subtransaction also rolls back a new column/scale/receipt/audit when
 -- the ordinary grade writer reports a validation or concurrency error.
 BEGIN
 IF v_column IS NULL THEN
 SELECT column_id INTO v_column FROM public.classroom_journal_slots WHERE classroom_id=p_class AND slot_key=p_input->>'slotKey';
 IF v_column IS NULL THEN
 v_result:=public.classroom_journal_write(p_actor,p_class,'column',jsonb_build_object('date',p_input->>'date','category',p_input->>'category',
 'expectedRevision',p_input->'expectedScaleVersion','requestId',(p_input->>'requestId')||':column'));
 IF v_result?'error' THEN v_error:=v_result->>'error'; RAISE EXCEPTION USING ERRCODE='P2090',MESSAGE=v_error; END IF;
 v_column:=(v_result->>'id')::uuid;
 INSERT INTO public.classroom_journal_slots VALUES(v_class.tenant_id,p_class,p_input->>'slotKey',v_column);
 ELSE
 v_result:=public.classroom_journal_column_json(v_column);
 IF v_result->>'date'<>p_input->>'date' OR v_result->>'category'<>btrim(p_input->>'category')
 THEN v_error:='revision_conflict'; RAISE EXCEPTION USING ERRCODE='P2090',MESSAGE=v_error; END IF;
 END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.classroom_journal_columns WHERE id=v_column AND classroom_id=p_class AND tenant_id=v_class.tenant_id)
 THEN v_error:='not_found'; RAISE EXCEPTION USING ERRCODE='P2090',MESSAGE=v_error; END IF;
 v_result:=public.classroom_journal_column_json(v_column);
 v_revision:=(v_result->>'headerRevision')::integer;
 IF v_revision<>(p_input->>'expectedHeaderRevision')::integer
 THEN v_error:='revision_conflict'; RAISE EXCEPTION USING ERRCODE='P2090',MESSAGE=v_error; END IF;
 IF v_result->>'date'<>p_input->>'date' OR v_result->>'category'<>btrim(p_input->>'category') THEN
 INSERT INTO public.classroom_journal_headers VALUES(v_class.tenant_id,p_class,v_column,v_revision+1,(p_input->>'date')::date,btrim(p_input->>'category'),p_actor,now());
 INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
 VALUES(v_class.tenant_id,NULL,'classroom',p_class,'classroom.journal.header',jsonb_build_object('actorId',p_actor,'columnId',v_column,'revision',v_revision+1));
 END IF;
 IF p_input?'seatId' THEN
 v_grade:=public.classroom_journal_write(p_actor,p_class,'grade',jsonb_build_object('columnId',v_column,'seatId',p_input->'seatId','value',p_input->'value',
 'reason',p_input->'reason','expectedRevision',p_input->'expectedRevision','requestId',(p_input->>'requestId')||':grade'));
 IF v_grade?'error' THEN v_error:=v_grade->>'error'; RAISE EXCEPTION USING ERRCODE='P2090',MESSAGE=v_error; END IF;
 END IF;
 v_result:=jsonb_build_object('column',public.classroom_journal_column_json(v_column),'grade',v_grade,'scale',public.classroom_journal_scale_json(p_class));
 INSERT INTO public.classroom_journal_receipts(tenant_id,classroom_id,actor_id,request_id,payload,result) VALUES(v_class.tenant_id,p_class,p_actor,p_input->>'requestId',v_payload,v_result);
 RETURN v_result;
 EXCEPTION WHEN SQLSTATE 'P2090' THEN RETURN jsonb_build_object('error',v_error);
 END;
END;
$$;
REVOKE ALL ON FUNCTION classroom_journal_column_json(uuid),classroom_journal_quick_read(uuid,uuid,date,date,integer,integer,uuid,varchar),classroom_journal_quick_write(uuid,uuid,jsonb) FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION classroom_journal_quick_read(uuid,uuid,date,date,integer,integer,uuid,varchar),classroom_journal_quick_write(uuid,uuid,jsonb) TO asalab_app;

-- Header corrections project consistently in both authorized learner inboxes
-- and result month filters; original evidence and authorization stay unchanged.
CREATE OR REPLACE FUNCTION classroom_journal_results(p_actor uuid,p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 20,p_column uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_range jsonb; v_zone text; v_result jsonb;
BEGIN
 IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
 THEN RAISE EXCEPTION 'invalid journal results page' USING ERRCODE='22023'; END IF;
 -- For several classes, the first accessible class supplies the initial month.
 SELECT public.classroom_journal_timezone(allowed.classroom_id) INTO v_zone
 FROM public.classroom_journal_authorized_seats(p_actor) allowed ORDER BY allowed.classroom_id LIMIT 1;
 v_range:=public.classroom_journal_range(COALESCE(v_zone,'UTC'),p_from,p_to);
 WITH allowed AS MATERIALIZED (
 SELECT seat_id,learner_identity_id FROM public.classroom_journal_authorized_seats(p_actor)
 ), latest AS (
 SELECT DISTINCT ON(r.column_id,r.seat_id) r.* FROM public.classroom_journal_revisions r
 JOIN public.classroom_journal_columns col ON col.id=r.column_id
 LEFT JOIN LATERAL (SELECT lesson_date,category FROM public.classroom_journal_headers WHERE column_id=col.id ORDER BY revision DESC LIMIT 1) header ON true
 JOIN allowed ON allowed.seat_id=r.seat_id AND allowed.learner_identity_id=r.learner_identity_id
 WHERE COALESCE(header.lesson_date,col.lesson_date) BETWEEN (v_range->>'from')::date AND (v_range->>'to')::date
 AND (p_column IS NULL OR r.column_id=p_column)
 ORDER BY r.column_id,r.seat_id,r.revision DESC
 ), candidates AS MATERIALIZED (
 SELECT r.*,COALESCE(header.lesson_date,col.lesson_date) AS lesson_date,COALESCE(header.category,col.category) AS category,scale.preset,scale.version,scale.time_zone,c.title FROM latest r
 JOIN public.classroom_journal_columns col ON col.id=r.column_id
 LEFT JOIN LATERAL (SELECT lesson_date,category FROM public.classroom_journal_headers WHERE column_id=col.id ORDER BY revision DESC LIMIT 1) header ON true
 JOIN public.classroom_journal_scales scale ON scale.id=col.scale_id JOIN public.classrooms c ON c.id=col.classroom_id
 ORDER BY COALESCE(header.lesson_date,col.lesson_date) DESC,r.published_at DESC,r.id LIMIT p_limit+1 OFFSET p_offset
 ), page AS MATERIALIZED (SELECT * FROM candidates ORDER BY lesson_date DESC,published_at DESC,id LIMIT p_limit)
 SELECT jsonb_build_object('range',v_range,'offset',p_offset,'nextOffset',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN p_offset+p_limit END,
 'items',COALESCE((SELECT jsonb_agg(public.classroom_journal_grade_json(evidence,profile.display_name::text)||jsonb_build_object('classroomId',r.classroom_id,
 'classroomTitle',r.title,'date',r.lesson_date,'category',r.category,'preset',r.preset,'scaleVersion',r.version,'timeZone',r.time_zone)
 ORDER BY r.lesson_date DESC,r.published_at DESC,r.id) FROM page r
 JOIN public.classroom_journal_revisions evidence ON evidence.id=r.id
 JOIN public.principals author ON author.id=r.author_id LEFT JOIN public.profiles profile ON profile.account_id=author.account_id),'[]'::jsonb)) INTO v_result;
 RETURN v_result;
END;
$$;
CREATE OR REPLACE FUNCTION learning_notifications_list(p_actor uuid,p_before timestamptz DEFAULT NULL)
RETURNS TABLE(item jsonb) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',n.id,'kind',n.event_kind,'category',n.category,'classroomId',n.classroom_id,'classroomTitle',c.title,
 'assignmentId',n.assignment_id,'attemptId',n.attempt_id,'courseRunId',n.course_run_id,'joinRequestId',n.join_request_id,
 'journalRevisionId',n.journal_revision_id,'journalColumnId',journal.column_id,'journalDate',COALESCE(header.lesson_date,journal_col.lesson_date),'recipientKind',n.recipient_kind,'createdAt',n.created_at,'readAt',n.read_at)
 ||jsonb_build_object('seatId',(SELECT seat_id FROM public.learning_attempts WHERE id=n.attempt_id),
 'title',COALESCE(COALESCE(header.lesson_date,journal_col.lesson_date)::text||' · '||COALESCE(header.category,journal_col.category),
 (SELECT COALESCE(version.title,task.title,lesson.assignment_title,quiz.title) FROM public.classroom_assignments assignment
 LEFT JOIN public.learning_activity_versions version ON version.id=assignment.learning_activity_version_id
 LEFT JOIN public.teacher_assignments task ON task.id=assignment.assignment_id
 LEFT JOIN public.classroom_course_run_lessons lesson ON lesson.classroom_assignment_id=assignment.id
 LEFT JOIN public.quiz_versions quiz ON quiz.id=assignment.quiz_version_id WHERE assignment.id=n.assignment_id),
 (SELECT title FROM public.classroom_course_runs WHERE id=n.course_run_id),c.title))
 FROM public.learning_notifications n JOIN public.classrooms c ON c.id=n.classroom_id
 LEFT JOIN public.classroom_journal_revisions journal ON journal.id=n.journal_revision_id
 LEFT JOIN public.classroom_journal_columns journal_col ON journal_col.id=journal.column_id
 LEFT JOIN LATERAL (SELECT lesson_date,category FROM public.classroom_journal_headers WHERE column_id=journal_col.id ORDER BY revision DESC LIMIT 1) header ON true
 WHERE n.recipient_principal_id=p_actor AND n.delivery_state='delivered' AND (p_before IS NULL OR n.created_at<p_before)
 AND public.learning_notification_current_access(p_actor,n.id) ORDER BY n.created_at DESC,n.id DESC LIMIT 100;
$$;


-- Current profile metadata is projected before ordering and pagination.
CREATE OR REPLACE FUNCTION classroom_participant_profile_grades(p_actor uuid,p_class uuid,p_seat uuid,p_offset integer DEFAULT 0,p_result_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH columns AS MATERIALIZED(SELECT col.id,COALESCE(header.lesson_date,col.lesson_date) lesson_date,COALESCE(header.category,col.category) category,scale.preset FROM public.classroom_journal_columns col JOIN public.classroom_journal_scales scale ON scale.id=col.scale_id
 LEFT JOIN LATERAL(SELECT lesson_date,category FROM public.classroom_journal_headers WHERE column_id=col.id ORDER BY revision DESC LIMIT 1) header ON true
 WHERE col.classroom_id=p_class AND EXISTS(SELECT 1 FROM public.classroom_journal_revisions r JOIN public.learner_identity_links l ON l.learner_identity_id=r.learner_identity_id AND l.tenant_id=r.tenant_id AND l.link_kind='student_seat' AND l.seat_id=p_seat AND l.status='active' AND l.disabled_at IS NULL WHERE r.column_id=col.id AND r.seat_id=p_seat)
 ORDER BY lesson_date DESC,col.id OFFSET p_offset LIMIT 31),
 page AS(SELECT * FROM columns ORDER BY lesson_date DESC,id LIMIT 30),
 latest AS(SELECT DISTINCT ON(r.column_id) r.* FROM public.classroom_journal_revisions r JOIN page ON page.id=r.column_id
 WHERE r.seat_id=p_seat AND EXISTS(SELECT 1 FROM public.learner_identity_links l WHERE l.seat_id=p_seat AND l.status='active' AND l.disabled_at IS NULL AND l.learner_identity_id=r.learner_identity_id AND l.tenant_id=r.tenant_id AND l.link_kind='student_seat')
 ORDER BY r.column_id,r.revision DESC),
 results AS MATERIALIZED(SELECT result.* FROM public.learning_results_for_seat(p_seat) result ORDER BY result.published_at DESC,result.assignment_id OFFSET p_result_offset LIMIT 31),
 result_page AS(SELECT * FROM results ORDER BY published_at DESC,assignment_id LIMIT 30)
 SELECT jsonb_build_object('journal',jsonb_build_object('students','[]'::jsonb,'offset',p_offset,'nextOffset',CASE WHEN (SELECT count(*) FROM columns)>30 THEN p_offset+30 END,
 'columns',COALESCE((SELECT jsonb_agg(public.classroom_journal_column_json(id) ORDER BY lesson_date DESC,id) FROM page),'[]'::jsonb),
 'grades',COALESCE((SELECT jsonb_agg(public.classroom_journal_grade_json(r::public.classroom_journal_revisions,profile.display_name::text) ORDER BY col.lesson_date DESC,col.id) FROM latest r JOIN page col ON col.id=r.column_id
 LEFT JOIN public.principals author ON author.id=r.author_id LEFT JOIN public.profiles profile ON profile.account_id=author.account_id),'[]'::jsonb)),
 'results',COALESCE((SELECT jsonb_agg(to_jsonb(result_page) ORDER BY published_at DESC,assignment_id) FROM result_page),'[]'::jsonb),
 'resultOffset',p_result_offset,'nextResultOffset',CASE WHEN (SELECT count(*) FROM results)>30 THEN p_result_offset+30 END)
 WHERE public.classroom_participant_allowed(p_actor,p_class,p_seat)
 AND p_offset BETWEEN 0 AND 100000 AND p_result_offset BETWEEN 0 AND 100000;
$$;

-- Only the manual grade period uses the effective header date; scoring,
-- evidence, pinned scales and UTC boundaries retain their existing semantics.
CREATE OR REPLACE FUNCTION classroom_participant_metrics(p_class uuid) RETURNS TABLE(item jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $$
 WITH config AS(SELECT public.classroom_participant_settings_json(p_class) settings),
 period AS(SELECT settings,(settings->>'periodDays')::integer days,
 now()-make_interval(days=>(settings->>'periodDays')::integer) since FROM config),
 seats AS(SELECT s.* FROM public.classroom_student_seats s WHERE s.classroom_id=p_class AND s.status<>'removed'
 AND EXISTS(SELECT 1 FROM public.classroom_participant_principals(s.id))),
 identities AS(SELECT s.id seat_id,identity.id principal_id FROM seats s CROSS JOIN LATERAL public.classroom_participant_principals(s.id) identity),
 projects AS(SELECT DISTINCT i.seat_id,p.id,p.status,p.created_at FROM identities i JOIN public.projects p ON p.owner_principal_id=i.principal_id
 WHERE p.status IN('active','archived') AND p.module_key IN('three-d','electronics','blocks')),
 totals AS(SELECT seat_id,count(*) total,count(*) FILTER(WHERE status='archived') archived,
 count(*) FILTER(WHERE created_at>=period.since AND created_at<=now()) recent FROM projects CROSS JOIN period GROUP BY seat_id),
 logins AS(SELECT i.seat_id,count(DISTINCT (e.occurred_at AT TIME ZONE 'UTC')::date) days
 FROM identities i JOIN public.product_analytics_events e ON e.principal_id=i.principal_id CROSS JOIN period
 WHERE e.outcome='succeeded' AND e.event_type IN('auth.login','auth.max','auth.class_join') AND e.occurred_at>=period.since AND e.occurred_at<=now() GROUP BY i.seat_id),
 edits AS(SELECT i.seat_id,e.actor_id,e.project_id,e.occurred_at FROM identities i
 JOIN public.classroom_participant_project_edits e ON e.actor_id=i.principal_id JOIN projects p ON p.id=e.project_id AND p.seat_id=i.seat_id
 CROSS JOIN period WHERE e.occurred_at>=period.since AND e.occurred_at<=now()),
 active_days AS(SELECT seat_id,count(DISTINCT (occurred_at AT TIME ZONE 'UTC')::date) days FROM edits GROUP BY seat_id),
 -- Union intervals across simultaneous tabs before summing; only intervals
 -- with a real document edit are eligible. No opening/visibility bonus.
 intervals AS(SELECT i.seat_id,range_agg(tstzrange(greatest(slice.started_at,period.since),least(slice.ended_at,slice.started_at+make_interval(secs=>slice.active_seconds),now()),'[)')) ranges
 FROM identities i JOIN public.product_module_sessions session ON session.principal_id=i.principal_id
 JOIN projects p ON p.id=session.project_id AND p.seat_id=i.seat_id
 JOIN public.product_module_activity_slices slice ON slice.session_id=session.id CROSS JOIN period
 WHERE slice.ended_at>period.since AND slice.started_at<now()
 AND greatest(slice.started_at,period.since)<least(slice.ended_at,slice.started_at+make_interval(secs=>slice.active_seconds),now())
 AND EXISTS(SELECT 1 FROM edits e WHERE e.seat_id=i.seat_id AND e.actor_id=i.principal_id AND e.project_id=session.project_id
 AND e.occurred_at BETWEEN slice.started_at-interval '90 seconds' AND slice.ended_at+interval '90 seconds') GROUP BY i.seat_id),
 per_day AS(SELECT seat_id,(day AT TIME ZONE 'UTC')::date date,
 least(3600,sum(extract(epoch FROM least(upper(r),day+interval '1 day')-greatest(lower(r),day)))) seconds
 FROM intervals CROSS JOIN LATERAL unnest(ranges) r
 CROSS JOIN LATERAL generate_series(date_trunc('day',lower(r) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',upper(r),interval '1 day') day
 WHERE least(upper(r),day+interval '1 day')>greatest(lower(r),day) GROUP BY seat_id,(day AT TIME ZONE 'UTC')::date),
 seconds AS(SELECT seat_id,sum(seconds) seconds FROM per_day GROUP BY seat_id),
 manual AS(SELECT DISTINCT ON(r.column_id,r.seat_id) r.* FROM public.classroom_journal_revisions r
 WHERE r.classroom_id=p_class ORDER BY r.column_id,r.seat_id,r.revision DESC),
 grade_values AS(
 SELECT r.seat_id,CASE scale.preset WHEN 'hundred' THEN r.value::numeric WHEN 'three_five' THEN (r.value-3)*50::numeric
 WHEN 'smileys' THEN (r.value-1)*25::numeric WHEN 'symbols' THEN (r.value-1)*25::numeric ELSE r.value*20::numeric END score
 FROM manual r JOIN public.classroom_journal_columns col ON col.id=r.column_id JOIN public.classroom_journal_scales scale ON scale.id=col.scale_id
 LEFT JOIN LATERAL(SELECT lesson_date FROM public.classroom_journal_headers WHERE column_id=col.id ORDER BY revision DESC LIMIT 1) header ON true
 CROSS JOIN LATERAL(SELECT COALESCE(header.lesson_date,col.lesson_date) lesson_date) effectiveheader
 CROSS JOIN period WHERE r.value IS NOT NULL AND effectiveheader.lesson_date>=(period.since AT TIME ZONE 'UTC')::date AND effectiveheader.lesson_date<=(now() AT TIME ZONE 'UTC')::date
 AND EXISTS(SELECT 1 FROM public.learner_identity_links l JOIN public.learner_identities learner ON learner.id=l.learner_identity_id AND learner.state='active'
 WHERE l.seat_id=r.seat_id AND l.learner_identity_id=r.learner_identity_id AND l.status='active' AND l.disabled_at IS NULL)
 UNION ALL
 SELECT (e.evidence->>'seatId')::uuid,(result.value->>'percentageBasisPoints')::numeric/100
 FROM public.learning_canonical_evidence_internal(p_class) e
 CROSS JOIN LATERAL(SELECT CASE WHEN e.evidence->>'activityRunId' IS NOT NULL THEN e.evidence->'selectedRevision' ELSE e.evidence->'selectedResult' END value) result
 CROSS JOIN period WHERE result.value->>'percentageBasisPoints' IS NOT NULL
 AND (result.value->>'publishedAt')::timestamptz BETWEEN period.since AND now()
 AND e.evidence->>'selectionConflict' IS NULL AND COALESCE((e.evidence->>'compatibilityGradingUnknown')::boolean,false)=false
 AND public.learning_direct_assignment_seat_visible((e.evidence->>'seatId')::uuid,(e.evidence->>'classroomAssignmentId')::uuid)
 ), grades AS(SELECT seat_id,avg(score) score,count(*) count FROM grade_values GROUP BY seat_id),
 raw AS(SELECT s.id,s.display_label,period.settings,
 COALESCE(t.total,0) total,COALESCE(t.archived,0) archived,
 jsonb_build_object('projects',least(100,COALESCE(t.recent,0)*100::numeric/(ceil(period.days/7::numeric)*5)),
 'logins',least(100,COALESCE(l.days,0)*100::numeric/period.days),
 'days',least(100,COALESCE(d.days,0)*100::numeric/period.days),
 'time',least(100,COALESCE(sec.seconds,0)*100::numeric/(period.days*600)),
 'grades',least(100,greatest(0,COALESCE(g.score,0)))) factors,
 jsonb_build_object('projects',COALESCE(t.recent,0),'logins',COALESCE(l.days,0),'days',COALESCE(d.days,0),'time',COALESCE(sec.seconds,0),'grades',COALESCE(g.count,0)) sources
 FROM seats s CROSS JOIN period LEFT JOIN totals t ON t.seat_id=s.id LEFT JOIN logins l ON l.seat_id=s.id
 LEFT JOIN active_days d ON d.seat_id=s.id LEFT JOIN seconds sec ON sec.seat_id=s.id LEFT JOIN grades g ON g.seat_id=s.id),
 scored AS(SELECT raw.*,(SELECT round(avg((factors->>enabled.key)::numeric),2) FROM jsonb_each(settings->'factors') enabled WHERE enabled.value='true'::jsonb) score FROM raw),
 ranked AS(SELECT scored.*,rank() OVER(ORDER BY score DESC NULLS LAST) place FROM scored)
 SELECT jsonb_build_object('seatId',id,'totalWorks',total,'archivedWorks',archived,'score',score,'rank',CASE WHEN score IS NULL THEN NULL ELSE place END,
 'factors',factors,'sources',sources,'role',COALESCE((SELECT role FROM public.classroom_participant_roles WHERE seat_id=ranked.id),'student'),
 'avatarUrl',(SELECT '/api/classrooms/'||p_class||'/participants/'||ranked.id||'/avatars/'||avatar.id||'/image' FROM public.classroom_custom_avatar_choices choice JOIN public.classroom_custom_avatars avatar ON avatar.id=choice.avatar_id
 WHERE choice.seat_id=ranked.id AND public.classroom_participant_avatar_available(ranked.id,avatar.id)))
 FROM ranked ORDER BY score DESC NULLS LAST,lower(display_label) COLLATE "C",id;
$$;
