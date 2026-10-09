-- Owner-requested manual observations are independent of assigned work/Attempts.
-- The matrix and learner screens project the same append-only observations.
CREATE TABLE classroom_journal_scales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 classroom_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 time_zone varchar(80) NOT NULL,
 preset varchar(16) NOT NULL CHECK(preset IN ('five','hundred','three_five','smileys','symbols')),
 created_by uuid NOT NULL REFERENCES principals(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,classroom_id,id), UNIQUE(classroom_id,version),
 FOREIGN KEY(tenant_id,classroom_id) REFERENCES classrooms(tenant_id,id)
);
CREATE TABLE classroom_journal_columns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 classroom_id uuid NOT NULL, lesson_date date NOT NULL CHECK(lesson_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
 category varchar(80) NOT NULL CHECK(length(btrim(category)) BETWEEN 1 AND 80 AND category !~ '[[:cntrl:]]'),
 scale_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES principals(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,classroom_id,id),
 FOREIGN KEY(tenant_id,classroom_id) REFERENCES classrooms(tenant_id,id),
 FOREIGN KEY(tenant_id,classroom_id,scale_id) REFERENCES classroom_journal_scales(tenant_id,classroom_id,id)
);
CREATE TABLE classroom_journal_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 classroom_id uuid NOT NULL, column_id uuid NOT NULL, seat_id uuid NOT NULL REFERENCES classroom_student_seats(id),
 learner_identity_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 value integer CHECK(value BETWEEN 0 AND 100), supersedes_id uuid REFERENCES classroom_journal_revisions(id),
 reason varchar(500) CHECK(reason IS NULL OR (length(btrim(reason)) BETWEEN 1 AND 500 AND reason !~ '[[:cntrl:]]')),
 author_id uuid NOT NULL REFERENCES principals(id), published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(column_id,learner_identity_id,revision), UNIQUE(column_id,seat_id,revision),
 FOREIGN KEY(tenant_id,classroom_id,column_id) REFERENCES classroom_journal_columns(tenant_id,classroom_id,id),
 FOREIGN KEY(tenant_id,learner_identity_id) REFERENCES learner_identities(tenant_id,id),
 CHECK((revision=1 AND supersedes_id IS NULL) OR (revision>1 AND supersedes_id IS NOT NULL AND reason IS NOT NULL))
);
CREATE INDEX classroom_journal_latest ON classroom_journal_revisions(column_id,seat_id,revision DESC);
CREATE INDEX classroom_journal_learner ON classroom_journal_revisions(seat_id,column_id,revision DESC);
-- Receipts retained with history; successful retries never create another event.
CREATE TABLE classroom_journal_receipts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), classroom_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES principals(id), request_id varchar(128) NOT NULL,
 payload jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(classroom_id,actor_id,request_id),
 FOREIGN KEY(tenant_id,classroom_id) REFERENCES classrooms(tenant_id,id)
);

CREATE FUNCTION classroom_journal_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'journal evidence is append-only'; END;
$$;
CREATE TRIGGER journal_scales_immutable BEFORE UPDATE OR DELETE ON classroom_journal_scales FOR EACH ROW EXECUTE FUNCTION classroom_journal_immutable();
CREATE TRIGGER journal_columns_immutable BEFORE UPDATE OR DELETE ON classroom_journal_columns FOR EACH ROW EXECUTE FUNCTION classroom_journal_immutable();
CREATE TRIGGER journal_revisions_immutable BEFORE UPDATE OR DELETE ON classroom_journal_revisions FOR EACH ROW EXECUTE FUNCTION classroom_journal_immutable();
CREATE TRIGGER journal_receipts_immutable BEFORE UPDATE OR DELETE ON classroom_journal_receipts FOR EACH ROW EXECUTE FUNCTION classroom_journal_immutable();

CREATE FUNCTION classroom_journal_teacher(p_actor uuid,p_class uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.principals actor
 JOIN public.accounts account ON account.id=actor.account_id AND account.status='active'
 JOIN public.classroom_memberships m ON m.account_id=actor.account_id AND m.classroom_id=p_class AND m.member_role IN ('owner','co_teacher')
 JOIN public.classrooms c ON c.id=m.classroom_id AND c.tenant_id=m.tenant_id AND c.status<>'deleted'
 JOIN public.capability_grants g ON g.account_id=actor.account_id AND g.capability='educator' AND g.state IN ('provisional','verified')
 WHERE actor.id=p_actor AND actor.kind='account');
$$;
-- Both subjects must resolve the exact active school identity recorded in evidence.
-- The legacy seat.account_id is admission evidence, never the read authority.
CREATE FUNCTION classroom_journal_owns_seat(p_actor uuid,p_seat uuid,p_learner uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.principals actor
 JOIN public.classroom_student_seats seat ON seat.id=p_seat AND seat.status IN ('issued','active')
 JOIN public.classrooms class ON class.id=seat.classroom_id AND class.tenant_id=seat.tenant_id AND class.status<>'deleted'
 JOIN public.learner_identities learner ON learner.id=p_learner AND learner.tenant_id=class.tenant_id
   AND learner.school_id=class.school_id AND learner.state='active'
 JOIN public.learner_identity_links sl ON sl.seat_id=seat.id AND sl.link_kind='student_seat'
   AND sl.learner_identity_id=learner.id AND sl.tenant_id=class.tenant_id AND sl.school_id=class.school_id
   AND sl.status='active' AND sl.disabled_at IS NULL
 WHERE actor.id=p_actor AND (
   (actor.kind='student_seat' AND actor.seat_id=seat.id) OR
   (actor.kind='account' AND EXISTS(SELECT 1 FROM public.accounts account
     JOIN public.learner_identity_links al ON al.account_id=account.id AND al.link_kind='account'
       AND al.learner_identity_id=learner.id AND al.tenant_id=class.tenant_id AND al.school_id=class.school_id
       AND al.status='active' AND al.disabled_at IS NULL
     WHERE account.id=actor.account_id AND account.status='active'))));
$$;
-- Actor-scoped set projection for page reads; no authority lookup per revision.
CREATE FUNCTION classroom_journal_authorized_seats(p_actor uuid)
RETURNS TABLE(seat_id uuid,learner_identity_id uuid,classroom_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT seat.id,learner.id,class.id FROM public.principals actor
 JOIN public.learner_identity_links sl ON sl.link_kind='student_seat' AND sl.status='active' AND sl.disabled_at IS NULL
 AND ((actor.kind='student_seat' AND sl.seat_id=actor.seat_id) OR
 (actor.kind='account' AND EXISTS(SELECT 1 FROM public.learner_identity_links al
 WHERE al.account_id=actor.account_id AND al.link_kind='account' AND al.status='active' AND al.disabled_at IS NULL
 AND al.learner_identity_id=sl.learner_identity_id AND al.tenant_id=sl.tenant_id AND al.school_id=sl.school_id)))
 JOIN public.learner_identities learner ON learner.id=sl.learner_identity_id AND learner.state='active'
 AND learner.tenant_id=sl.tenant_id AND learner.school_id=sl.school_id
 JOIN public.classroom_student_seats seat ON seat.id=sl.seat_id AND seat.tenant_id=sl.tenant_id AND seat.status IN ('issued','active')
 JOIN public.classrooms class ON class.id=seat.classroom_id AND class.tenant_id=sl.tenant_id AND class.school_id=sl.school_id AND class.status<>'deleted'
 WHERE actor.id=p_actor AND (actor.kind='student_seat' OR EXISTS(SELECT 1 FROM public.accounts account WHERE account.id=actor.account_id AND account.status='active'));
$$;
-- Freeze the class owner's persisted IANA timezone with the first scale version.
-- A co-teacher/device/profile change never moves historical calendar dates.
CREATE FUNCTION classroom_journal_timezone(p_class uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE((SELECT time_zone FROM public.classroom_journal_scales WHERE classroom_id=p_class ORDER BY version LIMIT 1),
   (SELECT profile.time_zone FROM public.classroom_memberships m JOIN public.profiles profile ON profile.account_id=m.account_id
    JOIN pg_catalog.pg_timezone_names zone ON zone.name=profile.time_zone WHERE m.classroom_id=p_class AND m.member_role='owner' LIMIT 1),'UTC');
$$;
CREATE FUNCTION classroom_journal_range(p_zone text,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_from date; v_to date; v_today date := (now() AT TIME ZONE p_zone)::date;
BEGIN
 IF (p_from IS NULL) <> (p_to IS NULL) THEN RAISE EXCEPTION 'invalid journal date range' USING ERRCODE='22023'; END IF;
 v_from := COALESCE(p_from,date_trunc('month',v_today)::date);
 v_to := COALESCE(p_to,(date_trunc('month',v_today)+interval '1 month - 1 day')::date);
 IF v_from<DATE '2000-01-01' OR v_to>DATE '2100-12-31' OR v_to<v_from OR v_to-v_from>92
 THEN RAISE EXCEPTION 'invalid journal date range' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('from',v_from,'to',v_to,'today',v_today,'timeZone',p_zone);
END;
$$;
CREATE FUNCTION classroom_journal_scale_json(p_class uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE((SELECT jsonb_build_object('preset',s.preset,'version',s.version) FROM public.classroom_journal_scales s
 WHERE s.classroom_id=p_class ORDER BY version DESC LIMIT 1),'{"preset":"five","version":0}'::jsonb);
$$;
-- Pure formatter: page readers join author once, without a SQL lookup per cell.
CREATE FUNCTION classroom_journal_grade_json(r public.classroom_journal_revisions,p_name text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',r.id,'columnId',r.column_id,'seatId',r.seat_id,'revision',r.revision,'value',r.value,
 'reason',r.reason,'supersedesId',r.supersedes_id,'authorId',r.author_id,
 'authorName',COALESCE(p_name,'Преподаватель'),'publishedAt',r.published_at);
$$;
CREATE FUNCTION classroom_journal_revision_json(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.classroom_journal_grade_json(r,profile.display_name::text)
 FROM public.classroom_journal_revisions r JOIN public.principals actor ON actor.id=r.author_id
 LEFT JOIN public.profiles profile ON profile.account_id=actor.account_id WHERE r.id=p_id;
$$;

-- Enforce row lineage and pinned scale even for privileged migration/test callers.
CREATE FUNCTION classroom_journal_revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_preset varchar; v_prior public.classroom_journal_revisions%ROWTYPE;
BEGIN
 SELECT scale.preset INTO v_preset FROM public.classroom_journal_columns col
 JOIN public.classroom_journal_scales scale ON scale.id=col.scale_id
 JOIN public.classroom_student_seats seat ON seat.id=NEW.seat_id AND seat.classroom_id=col.classroom_id AND seat.tenant_id=col.tenant_id
 JOIN public.classrooms class ON class.id=seat.classroom_id AND class.tenant_id=seat.tenant_id
 JOIN public.learner_identities learner ON learner.id=NEW.learner_identity_id AND learner.state='active' AND learner.tenant_id=class.tenant_id AND learner.school_id=class.school_id
 JOIN public.learner_identity_links link ON link.seat_id=seat.id AND link.status='active' AND link.disabled_at IS NULL AND link.link_kind='student_seat' AND link.learner_identity_id=learner.id AND link.tenant_id=class.tenant_id AND link.school_id=class.school_id
 WHERE col.id=NEW.column_id AND col.classroom_id=NEW.classroom_id AND col.tenant_id=NEW.tenant_id;
 IF v_preset IS NULL THEN RAISE EXCEPTION 'journal lineage invalid'; END IF;
 IF NEW.value IS NOT NULL AND NOT CASE v_preset WHEN 'hundred' THEN NEW.value BETWEEN 0 AND 100
 WHEN 'three_five' THEN NEW.value IN (3,4,5) WHEN 'five' THEN NEW.value BETWEEN 0 AND 5 ELSE NEW.value BETWEEN 1 AND 5 END
 THEN RAISE EXCEPTION 'journal grade invalid'; END IF;
 IF NEW.supersedes_id IS NOT NULL THEN
 SELECT * INTO v_prior FROM public.classroom_journal_revisions WHERE id=NEW.supersedes_id;
 IF v_prior.column_id IS DISTINCT FROM NEW.column_id OR v_prior.seat_id IS DISTINCT FROM NEW.seat_id
 OR v_prior.learner_identity_id IS DISTINCT FROM NEW.learner_identity_id OR v_prior.revision+1<>NEW.revision
 THEN RAISE EXCEPTION 'journal revision lineage invalid'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER journal_revision_guard BEFORE INSERT ON classroom_journal_revisions FOR EACH ROW EXECUTE FUNCTION classroom_journal_revision_guard();

CREATE INDEX classroom_journal_dates ON classroom_journal_columns(classroom_id,lesson_date,created_at,id);
CREATE FUNCTION classroom_journal_settings(p_actor uuid,p_class uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('status',c.status,'scale',public.classroom_journal_scale_json(c.id),'timeZone',public.classroom_journal_timezone(c.id))
 FROM public.classrooms c WHERE c.id=p_class AND public.classroom_journal_teacher(p_actor,c.id);
$$;
CREATE FUNCTION classroom_journal_read(p_actor uuid,p_class uuid,p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_range jsonb; v_result jsonb;
BEGIN
 IF NOT public.classroom_journal_teacher(p_actor,p_class) THEN RETURN NULL; END IF;
 IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
 THEN RAISE EXCEPTION 'invalid journal page' USING ERRCODE='22023'; END IF;
 v_range:=public.classroom_journal_range(public.classroom_journal_timezone(p_class),p_from,p_to);
 WITH candidates AS MATERIALIZED (
   SELECT col.*,scale.preset,scale.version FROM public.classroom_journal_columns col
   JOIN public.classroom_journal_scales scale ON scale.id=col.scale_id
   WHERE col.classroom_id=p_class AND col.lesson_date BETWEEN (v_range->>'from')::date AND (v_range->>'to')::date
   ORDER BY col.lesson_date,col.created_at,col.id LIMIT p_limit+1 OFFSET p_offset
 ), page AS MATERIALIZED (SELECT * FROM candidates ORDER BY lesson_date,created_at,id LIMIT p_limit),
 latest AS (
   SELECT DISTINCT ON(r.column_id,r.seat_id) r.* FROM public.classroom_journal_revisions r JOIN page ON page.id=r.column_id
   ORDER BY r.column_id,r.seat_id,r.revision DESC
 )
 SELECT public.classroom_journal_settings(p_actor,p_class)||jsonb_build_object('range',v_range,'offset',p_offset,
 'nextOffset',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN p_offset+p_limit END,
 'students',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.display_label,'status',s.status) ORDER BY s.display_label,s.id)
 FROM public.classroom_student_seats s WHERE s.classroom_id=p_class),'[]'::jsonb),
 'columns',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',col.id,'date',col.lesson_date,'category',col.category,
 'preset',col.preset,'scaleVersion',col.version) ORDER BY col.lesson_date,col.created_at,col.id) FROM page col),'[]'::jsonb),
 'grades',COALESCE((SELECT jsonb_agg(public.classroom_journal_grade_json(r::public.classroom_journal_revisions,profile.display_name::text)) FROM latest r
 JOIN public.principals author ON author.id=r.author_id LEFT JOIN public.profiles profile ON profile.account_id=author.account_id),'[]'::jsonb)) INTO v_result;
 RETURN v_result;
END;
$$;
CREATE FUNCTION classroom_journal_history(p_actor uuid,p_class uuid,p_column uuid,p_seat uuid,p_before integer DEFAULT NULL,p_limit integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
 IF NOT public.classroom_journal_teacher(p_actor,p_class) THEN RETURN NULL; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR (p_before IS NOT NULL AND p_before NOT BETWEEN 1 AND 999999999)
 THEN RAISE EXCEPTION 'invalid journal history page' USING ERRCODE='22023'; END IF;
 WITH candidates AS MATERIALIZED (
 SELECT r.* FROM public.classroom_journal_revisions r WHERE r.classroom_id=p_class AND r.column_id=p_column AND r.seat_id=p_seat
 AND (p_before IS NULL OR r.revision<p_before) ORDER BY r.revision DESC LIMIT p_limit+1
 ), page AS MATERIALIZED (SELECT * FROM candidates ORDER BY revision DESC LIMIT p_limit)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(public.classroom_journal_grade_json(r::public.classroom_journal_revisions,profile.display_name::text) ORDER BY r.revision DESC)
 FROM page r JOIN public.principals author ON author.id=r.author_id LEFT JOIN public.profiles profile ON profile.account_id=author.account_id),'[]'::jsonb),
 'nextBeforeRevision',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT min(revision) FROM page) END) INTO v_result;
 RETURN v_result;
END;
$$;
CREATE FUNCTION classroom_journal_results(p_actor uuid,p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 20,p_column uuid DEFAULT NULL) RETURNS jsonb
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
 JOIN allowed ON allowed.seat_id=r.seat_id AND allowed.learner_identity_id=r.learner_identity_id
 WHERE col.lesson_date BETWEEN (v_range->>'from')::date AND (v_range->>'to')::date
 AND (p_column IS NULL OR r.column_id=p_column)
 ORDER BY r.column_id,r.seat_id,r.revision DESC
 ), candidates AS MATERIALIZED (
 SELECT r.*,col.lesson_date,col.category,scale.preset,scale.version,scale.time_zone,c.title FROM latest r
 JOIN public.classroom_journal_columns col ON col.id=r.column_id
 JOIN public.classroom_journal_scales scale ON scale.id=col.scale_id JOIN public.classrooms c ON c.id=col.classroom_id
 ORDER BY col.lesson_date DESC,r.published_at DESC,r.id LIMIT p_limit+1 OFFSET p_offset
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

ALTER TABLE learning_notifications ADD COLUMN journal_revision_id uuid REFERENCES classroom_journal_revisions(id);
CREATE FUNCTION classroom_journal_notification_emit(p_recipient uuid,p_revision uuid,p_event varchar) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_grade public.classroom_journal_revisions%ROWTYPE; v_enabled boolean;
BEGIN
 SELECT * INTO STRICT v_grade FROM public.classroom_journal_revisions WHERE id=p_revision;
 IF NOT public.classroom_journal_owns_seat(p_recipient,v_grade.seat_id,v_grade.learner_identity_id)
 THEN RAISE EXCEPTION 'journal notification recipient unavailable'; END IF;
 -- Same lock, NC03 preference evaluation and delivery policy as learning_notification_emit.
 -- Its legacy resource check cannot represent a canonical-only Account link, so
 -- this narrow emitter checks the exact journal resource before inserting there.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_recipient::text,1120));
 v_enabled:=public.learning_notification_enabled(p_recipient,v_grade.classroom_id,'NC03');
 INSERT INTO public.learning_notifications(tenant_id,recipient_principal_id,classroom_id,recipient_kind,event_kind,category,event_key,delivery_state,journal_revision_id)
 VALUES(v_grade.tenant_id,p_recipient,v_grade.classroom_id,'learner',p_event,'NC03','journal:'||p_revision,
 CASE WHEN v_enabled THEN 'delivered' ELSE 'suppressed' END,p_revision)
 ON CONFLICT(recipient_principal_id,event_key) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.learning_notifications WHERE recipient_principal_id=p_recipient
 AND event_key='journal:'||p_revision AND journal_revision_id=p_revision)
 THEN RAISE EXCEPTION 'journal notification was not persisted'; END IF;
END;
$$;
CREATE FUNCTION classroom_journal_write(p_actor uuid,p_class uuid,p_action varchar,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_class public.classrooms%ROWTYPE; v_prior public.classroom_journal_receipts%ROWTYPE;
 v_scale public.classroom_journal_scales%ROWTYPE; v_column public.classroom_journal_columns%ROWTYPE;
 v_latest public.classroom_journal_revisions%ROWTYPE; v_id uuid; v_seat uuid; v_learner uuid;
 v_expected integer; v_value integer; v_result jsonb; v_payload jsonb; v_recipient uuid; v_emitted integer:=0;
BEGIN
 IF NOT public.classroom_journal_teacher(p_actor,p_class) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF p_action NOT IN ('scale','column','grade') OR p_action IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object'
 OR length(p_input::text)>4000 OR jsonb_typeof(p_input->'requestId')<>'string' OR COALESCE(p_input->>'requestId','') !~ '^[A-Za-z0-9._:-]{8,128}$'
 THEN RETURN '{"error":"invalid_body"}'; END IF;
 SELECT * INTO v_class FROM public.classrooms WHERE id=p_class FOR UPDATE;
 v_payload:=jsonb_build_object('action',p_action,'input',p_input);
 SELECT * INTO v_prior FROM public.classroom_journal_receipts WHERE classroom_id=p_class AND actor_id=p_actor AND request_id=p_input->>'requestId';
 IF v_prior.actor_id IS NOT NULL THEN
 IF v_prior.payload<>v_payload THEN RETURN '{"error":"idempotency_conflict"}'; END IF;
 RETURN v_prior.result;
 END IF;
 IF v_class.status<>'active' THEN RETURN '{"error":"classroom_archived"}'; END IF;
 SELECT * INTO v_scale FROM public.classroom_journal_scales WHERE classroom_id=p_class ORDER BY version DESC LIMIT 1;
 IF p_action='scale' THEN
 IF p_input-ARRAY['requestId','expectedRevision','preset']<>'{}'::jsonb OR jsonb_typeof(p_input->'preset')<>'string' OR jsonb_typeof(p_input->'expectedRevision')<>'number' OR COALESCE(p_input->>'expectedRevision','') !~ '^[0-9]{1,9}$'
 OR COALESCE(p_input->>'preset','') NOT IN ('five','hundred','three_five','smileys','symbols') THEN RETURN '{"error":"invalid_scale"}'; END IF;
 IF (p_input->>'expectedRevision')::integer<>COALESCE(v_scale.version,0) THEN RETURN '{"error":"revision_conflict"}'; END IF;
 INSERT INTO public.classroom_journal_scales(tenant_id,classroom_id,version,preset,time_zone,created_by)
 VALUES(v_class.tenant_id,p_class,COALESCE(v_scale.version,0)+1,p_input->>'preset',public.classroom_journal_timezone(p_class),p_actor) RETURNING id INTO v_id;
 v_result:=public.classroom_journal_scale_json(p_class);
 ELSIF p_action='column' THEN
 IF p_input-ARRAY['requestId','expectedRevision','date','category']<>'{}'::jsonb
 OR jsonb_typeof(p_input->'expectedRevision')<>'number' OR jsonb_typeof(p_input->'date')<>'string' OR jsonb_typeof(p_input->'category')<>'string'
 OR COALESCE(p_input->>'expectedRevision','') !~ '^[0-9]{1,9}$'
 OR COALESCE(p_input->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 OR COALESCE(length(btrim(p_input->>'category')),0) NOT BETWEEN 1 AND 80 OR p_input->>'category' ~ '[[:cntrl:]]'
 THEN RETURN '{"error":"invalid_column"}'; END IF;
 BEGIN
 IF (p_input->>'date')::date NOT BETWEEN DATE '2000-01-01' AND DATE '2100-12-31' THEN RETURN '{"error":"invalid_date"}'; END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN '{"error":"invalid_date"}'; END;
 IF (p_input->>'expectedRevision')::integer<>COALESCE(v_scale.version,0) THEN RETURN '{"error":"revision_conflict"}'; END IF;
 IF v_scale.id IS NULL THEN
 INSERT INTO public.classroom_journal_scales(tenant_id,classroom_id,version,preset,time_zone,created_by)
 VALUES(v_class.tenant_id,p_class,1,'five',public.classroom_journal_timezone(p_class),p_actor) RETURNING * INTO v_scale;
 END IF;
 INSERT INTO public.classroom_journal_columns(tenant_id,classroom_id,lesson_date,category,scale_id,created_by)
 VALUES(v_class.tenant_id,p_class,(p_input->>'date')::date,btrim(p_input->>'category'),v_scale.id,p_actor) RETURNING id INTO v_id;
 v_result:=jsonb_build_object('id',v_id);
 ELSE
 IF p_input-ARRAY['requestId','expectedRevision','columnId','seatId','value','reason']<>'{}'::jsonb
 OR jsonb_typeof(p_input->'expectedRevision')<>'number' OR jsonb_typeof(p_input->'columnId')<>'string' OR jsonb_typeof(p_input->'seatId')<>'string'
 OR COALESCE(p_input->>'expectedRevision','') !~ '^[0-9]{1,9}$'
 OR COALESCE(p_input->>'columnId','') !~ '^[0-9a-fA-F-]{36}$' OR COALESCE(p_input->>'seatId','') !~ '^[0-9a-fA-F-]{36}$'
 OR NOT(p_input?'value') OR (p_input->>'value' IS NOT NULL AND (jsonb_typeof(p_input->'value')<>'number' OR p_input->>'value' !~ '^[0-9]{1,3}$'))
 OR (p_input->>'reason' IS NOT NULL AND (jsonb_typeof(p_input->'reason')<>'string' OR length(btrim(p_input->>'reason')) NOT BETWEEN 1 AND 500 OR p_input->>'reason' ~ '[[:cntrl:]]'))
 THEN RETURN '{"error":"invalid_grade"}'; END IF;
 BEGIN v_seat:=(p_input->>'seatId')::uuid; v_id:=(p_input->>'columnId')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RETURN '{"error":"invalid_grade"}'; END;
 SELECT * INTO v_column FROM public.classroom_journal_columns WHERE id=v_id AND classroom_id=p_class;
 IF v_column.id IS NULL THEN RETURN '{"error":"not_found"}'; END IF;
 PERFORM 1 FROM public.classroom_student_seats WHERE id=v_seat AND classroom_id=p_class AND status IN ('issued','active') FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 SELECT * INTO v_scale FROM public.classroom_journal_scales WHERE id=v_column.scale_id;
 v_value:=(p_input->>'value')::integer;
 IF v_value IS NOT NULL AND NOT CASE v_scale.preset WHEN 'hundred' THEN v_value BETWEEN 0 AND 100
 WHEN 'three_five' THEN v_value IN (3,4,5) WHEN 'five' THEN v_value BETWEEN 0 AND 5 ELSE v_value BETWEEN 1 AND 5 END
 THEN RETURN '{"error":"invalid_grade"}'; END IF;
 SELECT * INTO v_latest FROM public.classroom_journal_revisions WHERE column_id=v_column.id AND seat_id=v_seat ORDER BY revision DESC LIMIT 1;
 IF v_latest.id IS NULL AND v_value IS NULL THEN RETURN '{"error":"invalid_grade"}'; END IF;
 v_expected:=(p_input->>'expectedRevision')::integer;
 IF v_expected<>COALESCE(v_latest.revision,0) THEN RETURN '{"error":"revision_conflict"}'; END IF;
 IF v_latest.id IS NOT NULL AND COALESCE(length(btrim(p_input->>'reason')),0)=0 THEN RETURN '{"error":"reason_required"}'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.learner_identity_links WHERE seat_id=v_seat) THEN
 PERFORM public.learning_audience_ensure_seat_identity(v_seat); END IF;
 SELECT learner_identity_id INTO v_learner FROM public.learner_identity_links
 WHERE seat_id=v_seat AND link_kind='student_seat' AND status='active' AND disabled_at IS NULL FOR SHARE;
 IF v_learner IS NULL OR (v_latest.id IS NOT NULL AND v_latest.learner_identity_id<>v_learner) THEN RETURN '{"error":"not_found"}'; END IF;
 PERFORM 1 FROM public.learner_identities WHERE id=v_learner AND state='active'
 AND tenant_id=v_class.tenant_id AND school_id=v_class.school_id FOR SHARE;
 IF NOT FOUND THEN RETURN '{"error":"not_found"}'; END IF;
 INSERT INTO public.classroom_journal_revisions(tenant_id,classroom_id,column_id,seat_id,learner_identity_id,revision,value,supersedes_id,reason,author_id)
 VALUES(v_class.tenant_id,p_class,v_column.id,v_seat,v_learner,v_expected+1,v_value,v_latest.id,NULLIF(btrim(p_input->>'reason'),''),p_actor) RETURNING id INTO v_id;
 v_result:=public.classroom_journal_revision_json(v_id);
 -- Transactional inbox creation: failure rolls back grade, receipt and audit.
 -- Canonical Account and Seat each get one event in their existing inbox.
 PERFORM public.student_seat_principal(v_seat);
 FOR v_recipient IN
 SELECT actor.id FROM public.principals actor WHERE actor.kind='student_seat' AND actor.seat_id=v_seat
 UNION
 SELECT actor.id FROM public.learner_identity_links link
 JOIN public.accounts account ON account.id=link.account_id AND account.status='active'
 JOIN public.principals actor ON actor.account_id=account.id AND actor.kind='account'
 WHERE link.link_kind='account' AND link.status='active' AND link.disabled_at IS NULL
 AND link.learner_identity_id=v_learner AND link.tenant_id=v_class.tenant_id AND link.school_id=v_class.school_id
 ORDER BY 1 LOOP
 PERFORM public.classroom_journal_notification_emit(v_recipient,v_id,CASE WHEN v_latest.id IS NULL THEN 'NF04' ELSE 'NF05' END);
 v_emitted:=v_emitted+1;
 END LOOP;
 IF v_emitted=0 THEN RAISE EXCEPTION 'journal notification recipient unavailable'; END IF;
 END IF;
 INSERT INTO public.classroom_journal_receipts(tenant_id,classroom_id,actor_id,request_id,payload,result)
 VALUES(v_class.tenant_id,p_class,p_actor,p_input->>'requestId',v_payload,v_result);
 INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
 VALUES(v_class.tenant_id,NULL,'classroom',p_class,'classroom.journal.'||p_action,
 jsonb_build_object('actorId',p_actor,'requestId',p_input->>'requestId','evidenceId',v_id));
 RETURN v_result;
END;
$$;

-- Reuse the latest inbox projection and access rules, enriching journal events.
CREATE OR REPLACE FUNCTION learning_notification_current_access(p_actor uuid,p_notification uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN n.journal_revision_id IS NOT NULL THEN
 n.recipient_kind='learner' AND n.assignment_id IS NULL AND n.attempt_id IS NULL AND n.course_run_id IS NULL AND n.join_request_id IS NULL
 AND EXISTS(SELECT 1 FROM public.classroom_journal_revisions r WHERE r.id=n.journal_revision_id AND r.classroom_id=n.classroom_id
   AND r.tenant_id=n.tenant_id AND public.classroom_journal_owns_seat(p_actor,r.seat_id,r.learner_identity_id))
 ELSE
 public.learning_notification_resource_access(p_actor,n.classroom_id,n.assignment_id,n.join_request_id,n.recipient_kind)
 AND (n.recipient_kind<>'learner' OR n.course_run_id IS NULL OR EXISTS(
   SELECT 1 FROM public.course_enrollments enrollment
   JOIN public.learner_identity_links link ON link.learner_identity_id=enrollment.learner_identity_id AND link.status='active'
   JOIN public.classroom_student_seats seat ON seat.id=link.seat_id AND seat.classroom_id=n.classroom_id AND seat.status IN ('issued','active')
   JOIN public.principals actor ON actor.id=p_actor AND (actor.seat_id=seat.id OR actor.account_id=seat.account_id)
   WHERE enrollment.course_run_id=n.course_run_id AND enrollment.status IN ('assigned','active')))
 END
 FROM public.learning_notifications n WHERE n.id=p_notification AND n.recipient_principal_id=p_actor;
$$;
CREATE OR REPLACE FUNCTION learning_notifications_list(p_actor uuid,p_before timestamptz DEFAULT NULL)
RETURNS TABLE(item jsonb) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',n.id,'kind',n.event_kind,'category',n.category,'classroomId',n.classroom_id,'classroomTitle',c.title,
 'assignmentId',n.assignment_id,'attemptId',n.attempt_id,'courseRunId',n.course_run_id,'joinRequestId',n.join_request_id,
 'journalRevisionId',n.journal_revision_id,'journalColumnId',journal.column_id,'journalDate',journal_col.lesson_date,'recipientKind',n.recipient_kind,'createdAt',n.created_at,'readAt',n.read_at)
 ||jsonb_build_object('seatId',(SELECT seat_id FROM public.learning_attempts WHERE id=n.attempt_id),
 'title',COALESCE(journal_col.lesson_date::text||' · '||journal_col.category,
 (SELECT COALESCE(version.title,task.title,lesson.assignment_title,quiz.title) FROM public.classroom_assignments assignment
 LEFT JOIN public.learning_activity_versions version ON version.id=assignment.learning_activity_version_id
 LEFT JOIN public.teacher_assignments task ON task.id=assignment.assignment_id
 LEFT JOIN public.classroom_course_run_lessons lesson ON lesson.classroom_assignment_id=assignment.id
 LEFT JOIN public.quiz_versions quiz ON quiz.id=assignment.quiz_version_id WHERE assignment.id=n.assignment_id),
 (SELECT title FROM public.classroom_course_runs WHERE id=n.course_run_id),c.title))
 FROM public.learning_notifications n JOIN public.classrooms c ON c.id=n.classroom_id
 LEFT JOIN public.classroom_journal_revisions journal ON journal.id=n.journal_revision_id
 LEFT JOIN public.classroom_journal_columns journal_col ON journal_col.id=journal.column_id
 WHERE n.recipient_principal_id=p_actor AND n.delivery_state='delivered' AND (p_before IS NULL OR n.created_at<p_before)
 AND public.learning_notification_current_access(p_actor,n.id) ORDER BY n.created_at DESC,n.id DESC LIMIT 100;
$$;

-- Runtime tables stay inaccessible directly; only authorized narrow functions.
ALTER TABLE classroom_journal_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_journal_scales FORCE ROW LEVEL SECURITY;
ALTER TABLE classroom_journal_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_journal_columns FORCE ROW LEVEL SECURITY;
ALTER TABLE classroom_journal_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_journal_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE classroom_journal_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_journal_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY journal_scales_tenant ON classroom_journal_scales USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY journal_columns_tenant ON classroom_journal_columns USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY journal_revisions_tenant ON classroom_journal_revisions USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY journal_receipts_tenant ON classroom_journal_receipts USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);
REVOKE ALL ON classroom_journal_scales,classroom_journal_columns,classroom_journal_revisions,classroom_journal_receipts FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION classroom_journal_immutable(),classroom_journal_teacher(uuid,uuid),classroom_journal_owns_seat(uuid,uuid,uuid),
 classroom_journal_authorized_seats(uuid),classroom_journal_timezone(uuid),classroom_journal_range(text,date,date),classroom_journal_grade_json(classroom_journal_revisions,text),
 classroom_journal_notification_emit(uuid,uuid,varchar),classroom_journal_settings(uuid,uuid),classroom_journal_scale_json(uuid),classroom_journal_revision_json(uuid),classroom_journal_revision_guard(),
 classroom_journal_read(uuid,uuid,date,date,integer,integer),classroom_journal_history(uuid,uuid,uuid,uuid,integer,integer),classroom_journal_results(uuid,date,date,integer,integer,uuid),classroom_journal_write(uuid,uuid,varchar,jsonb) FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION classroom_journal_settings(uuid,uuid),classroom_journal_read(uuid,uuid,date,date,integer,integer),classroom_journal_history(uuid,uuid,uuid,uuid,integer,integer),classroom_journal_results(uuid,date,date,integer,integer,uuid),classroom_journal_write(uuid,uuid,varchar,jsonb) TO asalab_app;
