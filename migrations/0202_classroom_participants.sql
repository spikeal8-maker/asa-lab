-- PR527 participants. Additive; 0201 manual journal is a required predecessor.
-- Totals expose counts only. Project content continues to use the existing
-- project_context_for_principal authorization, never a new project/RLS policy.
CREATE TABLE classroom_participant_settings (
 classroom_id uuid PRIMARY KEY REFERENCES classrooms(id), period_days integer NOT NULL DEFAULT 30 CHECK(period_days IN(7,30,90)),
 factors jsonb NOT NULL DEFAULT '{"projects":true,"logins":false,"days":true,"time":false,"grades":true}',
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 CHECK(jsonb_typeof(factors)='object' AND factors ?& ARRAY['projects','logins','days','time','grades']
 AND factors-ARRAY['projects','logins','days','time','grades']='{}'::jsonb
 AND jsonb_typeof(factors->'projects')='boolean' AND jsonb_typeof(factors->'logins')='boolean'
 AND jsonb_typeof(factors->'days')='boolean' AND jsonb_typeof(factors->'time')='boolean' AND jsonb_typeof(factors->'grades')='boolean')
);
CREATE TABLE classroom_participant_roles (
 seat_id uuid PRIMARY KEY REFERENCES classroom_student_seats(id), role varchar(16) NOT NULL CHECK(role IN('student','helper'))
);
CREATE TABLE classroom_custom_merits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), classroom_id uuid NOT NULL REFERENCES classrooms(id),
 title varchar(60) NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 60 AND title !~ '[<>[:cntrl:]]' AND title !~* '(https?://|www\.)'),
 description varchar(240) NOT NULL DEFAULT '' CHECK(description !~ '[<>[:cntrl:]]' AND description !~* '(https?://|www\.)'),
 created_by uuid NOT NULL REFERENCES principals(id), UNIQUE(classroom_id,id)
);
CREATE TABLE classroom_custom_merit_grants (
 seat_id uuid NOT NULL REFERENCES classroom_student_seats(id), merit_id uuid NOT NULL REFERENCES classroom_custom_merits(id),
 granted_by uuid NOT NULL REFERENCES principals(id), granted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(seat_id,merit_id)
);
CREATE TABLE classroom_custom_avatars (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), classroom_id uuid NOT NULL REFERENCES classrooms(id),
 title varchar(60) NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 60 AND title !~ '[<>[:cntrl:]]'),
 -- Canonical PNG only: server decodes, bounds pixels/bytes and re-encodes.
 data_url text NOT NULL CHECK(length(data_url)<=300000 AND data_url ~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$'),
 secret boolean NOT NULL DEFAULT false, merit_id uuid, builtin_award varchar(32),
 created_by uuid NOT NULL REFERENCES principals(id), UNIQUE(classroom_id,id),
 FOREIGN KEY(classroom_id,merit_id) REFERENCES classroom_custom_merits(classroom_id,id),
 CHECK(builtin_award IS NULL OR builtin_award IN('first-model','bright-idea','careful-work','precision','perseverance','helper','explorer','editors-choice')),
 CHECK(NOT(merit_id IS NOT NULL AND builtin_award IS NOT NULL))
);
CREATE TABLE classroom_custom_avatar_grants (
 seat_id uuid NOT NULL REFERENCES classroom_student_seats(id), avatar_id uuid NOT NULL REFERENCES classroom_custom_avatars(id),
 PRIMARY KEY(seat_id,avatar_id)
);
CREATE TABLE classroom_custom_avatar_choices (
 seat_id uuid PRIMARY KEY REFERENCES classroom_student_seats(id), avatar_id uuid NOT NULL REFERENCES classroom_custom_avatars(id)
);
CREATE TABLE classroom_participant_receipts (
 classroom_id uuid NOT NULL REFERENCES classrooms(id), actor_id uuid NOT NULL REFERENCES principals(id), request_id varchar(128) NOT NULL,
 payload jsonb NOT NULL, result jsonb NOT NULL, PRIMARY KEY(classroom_id,actor_id,request_id)
);
-- Actual document changes, not saves of an unchanged document or tab presence.
CREATE TABLE classroom_participant_project_edits (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
 actor_id uuid NOT NULL REFERENCES principals(id), occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX participant_edits_actor_time ON classroom_participant_project_edits(actor_id,occurred_at,project_id);
CREATE INDEX participant_project_owners ON projects(owner_principal_id,created_at,id) INCLUDE(status)
 WHERE status IN('active','archived') AND module_key IN('three-d','electronics','blocks');
CREATE INDEX participant_successful_logins ON product_analytics_events(principal_id,occurred_at)
 WHERE outcome='succeeded' AND event_type IN('auth.login','auth.max','auth.class_join');
CREATE INDEX participant_session_slices ON product_module_activity_slices(session_id,started_at) INCLUDE(ended_at,active_seconds);
CREATE FUNCTION classroom_participant_record_edit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.document_json IS DISTINCT FROM OLD.document_json AND NEW.updated_by_principal_id IS NOT NULL THEN
 INSERT INTO public.classroom_participant_project_edits(project_id,actor_id) VALUES(NEW.project_id,NEW.updated_by_principal_id);
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER participant_project_edit AFTER UPDATE OF document_json ON project_drafts FOR EACH ROW EXECUTE FUNCTION classroom_participant_record_edit();

-- Use the existing identity factory for never-materialized, already admitted
-- Seats. Never revive an inactive link/identity, or invent a historical event.
CREATE FUNCTION classroom_participant_prepare(p_actor uuid,p_classes uuid[]) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s record;
BEGIN
 IF cardinality(p_classes)>200 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_classes) class_id WHERE NOT public.classroom_journal_teacher(p_actor,class_id)
 AND NOT EXISTS(SELECT 1 FROM public.principals actor JOIN public.classroom_student_seats seat
 ON (actor.kind='student_seat' AND seat.id=actor.seat_id) OR (actor.kind='account' AND seat.account_id=actor.account_id)
 WHERE actor.id=p_actor AND seat.classroom_id=class_id AND seat.status='active'
 AND (actor.kind='student_seat' OR EXISTS(SELECT 1 FROM public.accounts a WHERE a.id=actor.account_id AND a.status='active')))) THEN RETURN false; END IF;
 FOR s IN SELECT seat.id,seat.account_id,c.school_id FROM public.classroom_student_seats seat JOIN public.classrooms c ON c.id=seat.classroom_id
 WHERE c.id=ANY(p_classes) AND c.status<>'deleted' AND seat.status IN('issued','active')
 AND (public.classroom_journal_teacher(p_actor,c.id) OR EXISTS(SELECT 1 FROM public.principals actor WHERE actor.id=p_actor
 AND (actor.seat_id=seat.id OR (actor.kind='account' AND actor.account_id=seat.account_id))))
 AND NOT EXISTS(SELECT 1 FROM public.learner_identity_links l WHERE l.seat_id=seat.id)
 AND NOT EXISTS(SELECT 1 FROM public.learner_identity_links l LEFT JOIN public.learner_identities learner ON learner.id=l.learner_identity_id
 WHERE l.account_id=seat.account_id AND l.school_id=c.school_id AND (l.status<>'active' OR l.disabled_at IS NOT NULL OR learner.state<>'active')) LOOP
 PERFORM public.learning_audience_ensure_seat_identity(s.id);
 PERFORM public.student_seat_principal(s.id);
 END LOOP;
 RETURN true;
END; $$;

-- Exact canonical active Account<->Seat links. No matching by name, stale
-- seat.account_id alone, or expansion into other classes' Seat principals.
CREATE FUNCTION classroom_participant_principals(p_seat uuid) RETURNS TABLE(id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT principal.id FROM public.classroom_student_seats seat
 JOIN public.classrooms class ON class.id=seat.classroom_id AND class.status<>'deleted'
 JOIN public.learner_identity_links sl ON sl.seat_id=seat.id AND sl.status='active' AND sl.disabled_at IS NULL AND sl.link_kind='student_seat' AND sl.tenant_id=seat.tenant_id AND sl.school_id=class.school_id
 JOIN public.learner_identities learner ON learner.id=sl.learner_identity_id AND learner.state='active'
 JOIN public.principals principal ON principal.seat_id=seat.id
 WHERE seat.id=p_seat AND seat.status IN('issued','active','suspended')
 UNION
 SELECT principal.id FROM public.classroom_student_seats seat
 JOIN public.classrooms class ON class.id=seat.classroom_id AND class.status<>'deleted'
 JOIN public.learner_identity_links sl ON sl.seat_id=seat.id AND sl.status='active' AND sl.disabled_at IS NULL AND sl.link_kind='student_seat' AND sl.tenant_id=seat.tenant_id AND sl.school_id=class.school_id
 JOIN public.learner_identities learner ON learner.id=sl.learner_identity_id AND learner.state='active'
 JOIN public.learner_identity_links al ON al.learner_identity_id=sl.learner_identity_id AND al.school_id=sl.school_id AND al.tenant_id=sl.tenant_id AND al.status='active' AND al.disabled_at IS NULL AND al.link_kind='account' AND al.account_id=seat.account_id
 JOIN public.accounts account ON account.id=al.account_id AND account.status='active'
 JOIN public.principals principal ON principal.account_id=account.id AND principal.kind='account'
 WHERE seat.id=p_seat AND seat.status IN('issued','active','suspended');
$$;
CREATE FUNCTION classroom_participant_owns(p_actor uuid,p_seat uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.classroom_participant_principals(p_seat) identity
 JOIN public.classroom_student_seats s ON s.id=p_seat AND s.status IN('issued','active') WHERE identity.id=p_actor);
$$;
CREATE FUNCTION classroom_participant_allowed(p_actor uuid,p_class uuid,p_seat uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.classroom_student_seats s WHERE s.id=p_seat AND s.classroom_id=p_class AND s.status<>'removed'
 AND EXISTS(SELECT 1 FROM public.classroom_participant_principals(s.id))
 AND (public.classroom_journal_teacher(p_actor,p_class) OR public.classroom_participant_owns(p_actor,s.id)));
$$;
CREATE FUNCTION classroom_participant_projects(p_seat uuid) RETURNS TABLE(id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT DISTINCT p.id FROM public.projects p WHERE p.owner_principal_id IN(SELECT identity.id FROM public.classroom_participant_principals(p_seat) identity)
 AND p.status IN('active','archived') AND p.module_key IN('three-d','electronics','blocks');
$$;
CREATE FUNCTION classroom_participant_settings_json(p_class uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE((SELECT jsonb_build_object('periodDays',period_days,'factors',factors,'revision',revision)
 FROM public.classroom_participant_settings WHERE classroom_id=p_class),
 '{"periodDays":30,"factors":{"projects":true,"logins":false,"days":true,"time":false,"grades":true},"revision":0}'::jsonb);
$$;
CREATE FUNCTION classroom_participant_avatar_available(p_seat uuid,p_avatar uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.classroom_custom_avatars avatar JOIN public.classroom_student_seats s ON s.classroom_id=avatar.classroom_id
 WHERE avatar.id=p_avatar AND s.id=p_seat AND s.status IN('issued','active','suspended') AND (
 NOT avatar.secret OR EXISTS(SELECT 1 FROM public.classroom_custom_avatar_grants g WHERE g.avatar_id=avatar.id AND g.seat_id=s.id)
 OR EXISTS(SELECT 1 FROM public.classroom_custom_merit_grants g WHERE g.merit_id=avatar.merit_id AND g.seat_id=s.id)
 OR EXISTS(SELECT 1 FROM public.classroom_seat_awards g WHERE g.award_key=avatar.builtin_award AND g.seat_id=s.id)));
$$;

-- One set calculation for a class. Grades select one current canonical
-- result per participation, one compatibility pointer or last manual revision.
CREATE FUNCTION classroom_participant_metrics(p_class uuid) RETURNS TABLE(item jsonb)
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
 CROSS JOIN period WHERE r.value IS NOT NULL AND col.lesson_date>=(period.since AT TIME ZONE 'UTC')::date AND col.lesson_date<=(now() AT TIME ZONE 'UTC')::date
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

CREATE FUNCTION classroom_participant_roster(p_actor uuid,p_class uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('settings',public.classroom_participant_settings_json(p_class),
 'items',COALESCE((SELECT jsonb_agg(item) FROM public.classroom_participant_metrics(p_class)),'[]'::jsonb))
 WHERE public.classroom_journal_teacher(p_actor,p_class);
$$;
CREATE FUNCTION classroom_participant_summary(p_actor uuid,p_classes uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH classes AS(SELECT DISTINCT c.id FROM public.classrooms c WHERE c.id=ANY(p_classes) AND public.classroom_journal_teacher(p_actor,c.id)),
 seats AS(SELECT s.id FROM public.classroom_student_seats s JOIN classes c ON c.id=s.classroom_id WHERE s.status<>'removed'),
 projects AS(SELECT DISTINCT p.id,p.status FROM seats s CROSS JOIN LATERAL public.classroom_participant_projects(s.id) ids JOIN public.projects p ON p.id=ids.id)
 SELECT jsonb_build_object('classCount',(SELECT count(*) FROM classes),'studentCount',(SELECT count(*) FROM seats),
 'totalWorks',count(*),'archivedWorks',count(*) FILTER(WHERE status='archived')) FROM projects
 HAVING (SELECT count(*) FROM classes)=COALESCE(cardinality(p_classes),0) AND cardinality(p_classes)<=200;
$$;
CREATE FUNCTION classroom_participant_profile(p_actor uuid,p_class uuid,p_seat uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('settings',public.classroom_participant_settings_json(p_class),'status',c.status,
 'submittedCount',COALESCE((SELECT submitted FROM public.classroom_seat_work_counts(p_seat)),0),
 'awaitingReview',COALESCE((SELECT awaiting_review FROM public.classroom_seat_work_counts(p_seat)),0),
 'student',(SELECT jsonb_build_object('id',s.id,'displayLabel',s.display_label,'avatarKey',s.avatar_key,'status',s.status,'safeMode',s.safe_mode,'lastActiveAt',s.last_active_at)
 FROM public.classroom_student_seats s WHERE s.id=p_seat),
 'builtinAwards',COALESCE((SELECT jsonb_agg(jsonb_build_object('awardKey',a.award_key,'note',a.note,'createdAt',a.created_at,'awardedBy',a.awarded_by_display_name)) FROM public.classroom_seat_awards_list(p_seat) a),'[]'::jsonb),
 'activity',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'seatId',a.seat_id,'seatLabel',a.seat_label,
 'byTeacher',public.classroom_journal_teacher(event.actor_principal_id,p_class),'projectId',a.project_id,'projectTitle',a.project_title,'count',a.occurrence_count,'firstAt',a.first_occurred_at,'at',a.occurred_at) ORDER BY a.occurred_at DESC,a.id)
 FROM public.classroom_activity_feed(p_actor,p_class,p_seat,100) a JOIN public.classroom_activity_events event ON event.id=a.id
 WHERE a.project_id IS NULL OR EXISTS(SELECT 1 FROM public.project_context_for_principal(p_actor,a.project_id))),'[]'::jsonb),
 'metrics',(SELECT item||jsonb_build_object('avatarUrl',CASE WHEN item->>'avatarUrl' IS NULL THEN NULL
 WHEN EXISTS(SELECT 1 FROM public.principals actor WHERE actor.id=p_actor AND actor.kind='student_seat')
 THEN '/api/class-join/participants/avatars/'||(SELECT avatar_id::text FROM public.classroom_custom_avatar_choices WHERE seat_id=p_seat)||'/image'
 ELSE item->>'avatarUrl' END) FROM public.classroom_participant_metrics(p_class) WHERE item->>'seatId'=p_seat::text),
 'merits',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'description',m.description,
 'granted',g.seat_id IS NOT NULL,'grantedAt',g.granted_at) ORDER BY m.title,m.id)
 FROM public.classroom_custom_merits m LEFT JOIN public.classroom_custom_merit_grants g ON g.merit_id=m.id AND g.seat_id=p_seat
 WHERE m.classroom_id=p_class AND (public.classroom_journal_teacher(p_actor,p_class) OR g.seat_id IS NOT NULL)),'[]'::jsonb),
 'avatars',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'url',CASE WHEN EXISTS(SELECT 1 FROM public.principals actor WHERE actor.id=p_actor AND actor.kind='student_seat')
 THEN '/api/class-join/participants/avatars/'||a.id||'/image' ELSE '/api/classrooms/'||p_class||'/participants/'||p_seat||'/avatars/'||a.id||'/image' END,'secret',a.secret,
 'available',public.classroom_participant_avatar_available(p_seat,a.id),'selected',choice.avatar_id=a.id,
 'permitted',EXISTS(SELECT 1 FROM public.classroom_custom_avatar_grants g WHERE g.seat_id=p_seat AND g.avatar_id=a.id)) ORDER BY a.title,a.id)
 FROM public.classroom_custom_avatars a LEFT JOIN public.classroom_custom_avatar_choices choice ON choice.seat_id=p_seat
 WHERE a.classroom_id=p_class AND (public.classroom_journal_teacher(p_actor,p_class) OR public.classroom_participant_avatar_available(p_seat,a.id))),'[]'::jsonb))
 FROM public.classrooms c WHERE c.id=p_class AND public.classroom_participant_allowed(p_actor,p_class,p_seat);
$$;
CREATE FUNCTION classroom_participant_avatar_read(p_actor uuid,p_class uuid,p_seat uuid,p_avatar uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT a.data_url FROM public.classroom_custom_avatars a WHERE a.id=p_avatar AND a.classroom_id=p_class
 AND public.classroom_participant_allowed(p_actor,p_class,p_seat)
 AND (public.classroom_journal_teacher(p_actor,p_class) OR public.classroom_participant_avatar_available(p_seat,p_avatar));
$$;
-- Staff profile lists only the intersection of current viewer and staff
-- teacher scopes. No global role, no unrelated class names/grades/rosters.
CREATE FUNCTION classroom_participant_staff_classes(p_actor uuid,p_account uuid) RETURNS TABLE(id uuid,title varchar,role varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT c.id,c.title,m.member_role FROM public.classroom_memberships m JOIN public.classrooms c ON c.id=m.classroom_id AND c.status<>'deleted'
 WHERE m.account_id=p_account AND m.member_role IN('owner','co_teacher') AND public.classroom_journal_teacher(p_actor,c.id)
 AND EXISTS(SELECT 1 FROM public.principals candidate WHERE candidate.kind='account' AND candidate.account_id=p_account AND public.classroom_journal_teacher(candidate.id,c.id))
 UNION
 SELECT c.id,c.title,CASE WHEN m.role='owner' THEN 'organization_owner' ELSE 'school_admin' END::varchar
 FROM public.workspace_memberships m JOIN public.workspaces w ON w.id=m.workspace_id AND w.kind='organization' AND w.status='active'
 JOIN public.classrooms c ON c.tenant_id=w.tenant_id AND c.status<>'deleted'
 WHERE m.account_id=p_account AND m.state='active' AND m.role IN('owner','school_admin') AND public.classroom_journal_teacher(p_actor,c.id);
$$;
CREATE FUNCTION classroom_participant_staff(p_actor uuid,p_class uuid,p_account uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('name',profile.display_name,'avatarUrl',profile.avatar_data_url,
 'classes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'role',m.member_role) ORDER BY c.title,c.id)
 FROM public.classroom_participant_staff_classes(p_actor,p_account) c CROSS JOIN LATERAL(SELECT c.role member_role) m),'[]'::jsonb))
 FROM public.profiles profile JOIN public.accounts account ON account.id=profile.account_id AND account.status='active'
 WHERE profile.account_id=p_account AND public.classroom_journal_teacher(p_actor,p_class)
 AND EXISTS(SELECT 1 FROM public.classroom_participant_staff_classes(p_actor,p_account) c WHERE c.id=p_class);
$$;
CREATE FUNCTION classroom_participant_managers(p_actor uuid,p_class uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('accountId',account.id,'name',profile.display_name,'role',m.role) ORDER BY profile.display_name,account.id),'[]'::jsonb)
 FROM public.classrooms c JOIN public.workspaces w ON w.tenant_id=c.tenant_id AND w.kind='organization' AND w.status='active'
 JOIN public.workspace_memberships m ON m.workspace_id=w.id AND m.state='active' AND m.role IN('owner','school_admin')
 JOIN public.accounts account ON account.id=m.account_id AND account.status='active' JOIN public.profiles profile ON profile.account_id=account.id
 WHERE c.id=p_class AND public.classroom_journal_teacher(p_actor,c.id)
 HAVING public.classroom_journal_teacher(p_actor,p_class);
$$;

CREATE FUNCTION classroom_participant_works(p_actor uuid,p_class uuid,p_seat uuid,p_module varchar,p_archive boolean,p_assignments boolean,p_offset integer)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH owned AS(SELECT p.* FROM public.classroom_participant_projects(p_seat) ids JOIN public.projects p ON p.id=ids.id
 WHERE public.classroom_participant_allowed(p_actor,p_class,p_seat)),
 visible AS(SELECT p.* FROM owned p WHERE EXISTS(SELECT 1 FROM public.project_context_for_principal(p_actor,p.id))),
 legacy AS MATERIALIZED(SELECT DISTINCT ON(w.id) w.* FROM public.classroom_seat_projects(p_actor,p_seat) w ORDER BY w.id,w.submitted_at DESC NULLS LAST),
 filtered AS(SELECT * FROM visible p WHERE (p_module IS NULL OR module_key=p_module) AND (p_archive OR status='active')
 AND (NOT p_assignments OR EXISTS(SELECT 1 FROM public.classroom_assignment_work w JOIN public.classroom_assignments a ON a.id=w.assignment_id
 WHERE w.project_id=p.id AND w.seat_id=p_seat AND a.classroom_id=p_class)
 OR EXISTS(SELECT 1 FROM public.learning_project_origins origin JOIN public.activity_runs run ON run.id=origin.activity_run_id
 WHERE origin.project_id=p.id AND run.classroom_id=p_class))),
 page AS(SELECT p.* FROM filtered p LEFT JOIN public.project_drafts d ON d.project_id=p.id
 ORDER BY COALESCE(d.updated_at,p.created_at) DESC,p.id OFFSET greatest(0,least(100000,p_offset)) LIMIT 30)
 SELECT jsonb_build_object('totalWorks',(SELECT count(*) FROM owned),'visibleWorks',(SELECT count(*) FROM visible),
 'filteredWorks',(SELECT count(*) FROM filtered),'offset',p_offset,'hasMore',(SELECT count(*) FROM filtered)>p_offset+30,
 'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'moduleKey',p.module_key,'title',p.title,'status',p.status,
 'createdAt',p.created_at,'updatedAt',COALESCE(d.updated_at,p.created_at),'snapshotRevision',snap.source_revision,
 'preview',CASE WHEN d.preview_json IS NOT NULL AND d.preview_digest IS NOT NULL THEN jsonb_build_object('digest',d.preview_digest,'descriptor',d.preview_json) ELSE NULL END,
 'lastEditedByTeacher',public.classroom_journal_teacher(editor.id,p_class),'submittedAt',work.submitted_at,
 'awaitingReview',work.submitted_at IS NOT NULL AND (feedback.updated_at IS NULL OR feedback.updated_at<work.submitted_at),
 'canonicalState',NULL,'assignment',CASE WHEN work.assignment_title IS NULL THEN NULL ELSE jsonb_build_object('title',work.assignment_title,
 'goal',work.assignment_goal,'brief',work.assignment_brief,'sampleImage',work.assignment_sample_image) END,
 'feedback',CASE WHEN feedback.project_id IS NULL THEN NULL ELSE jsonb_build_object('badge',feedback.badge,'comment',feedback.comment,
 'updatedAt',feedback.updated_at,'author',COALESCE(profile.display_name,'Педагог')) END)
 ORDER BY COALESCE(d.updated_at,p.created_at) DESC,p.id)
 FROM page p LEFT JOIN public.project_drafts d ON d.project_id=p.id
 LEFT JOIN public.project_snapshots snap ON snap.project_id=p.id
 LEFT JOIN public.principals editor ON editor.id=d.updated_by_principal_id
 LEFT JOIN legacy work ON work.id=p.id
 LEFT JOIN LATERAL(SELECT f.* FROM public.project_feedback f WHERE f.project_id=p.id ORDER BY f.updated_at DESC,f.author_principal_id LIMIT 1) feedback ON true
 LEFT JOIN public.principals author ON author.id=feedback.author_principal_id LEFT JOIN public.profiles profile ON profile.account_id=author.account_id),'[]'::jsonb))
 WHERE public.classroom_participant_allowed(p_actor,p_class,p_seat) AND (p_module IS NULL OR p_module IN('three-d','electronics','blocks'))
 AND p_offset BETWEEN 0 AND 100000;
$$;

CREATE FUNCTION classroom_participant_grades(p_actor uuid,p_class uuid,p_seat uuid,p_offset integer DEFAULT 0,p_result_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH columns AS MATERIALIZED(SELECT col.*,scale.preset FROM public.classroom_journal_columns col JOIN public.classroom_journal_scales scale ON scale.id=col.scale_id
 WHERE col.classroom_id=p_class AND EXISTS(SELECT 1 FROM public.classroom_journal_revisions r JOIN public.learner_identity_links l ON l.learner_identity_id=r.learner_identity_id AND l.seat_id=p_seat AND l.status='active' AND l.disabled_at IS NULL WHERE r.column_id=col.id AND r.seat_id=p_seat)
 ORDER BY col.lesson_date DESC,col.id OFFSET p_offset LIMIT 31),
 page AS(SELECT * FROM columns ORDER BY lesson_date DESC,id LIMIT 30),
 latest AS(SELECT DISTINCT ON(r.column_id) r.* FROM public.classroom_journal_revisions r JOIN page ON page.id=r.column_id
 WHERE r.seat_id=p_seat AND EXISTS(SELECT 1 FROM public.learner_identity_links l WHERE l.seat_id=p_seat AND l.status='active' AND l.disabled_at IS NULL AND l.learner_identity_id=r.learner_identity_id)
 ORDER BY r.column_id,r.revision DESC),
 results AS MATERIALIZED(SELECT result.* FROM public.learning_results_for_seat(p_seat) result ORDER BY result.published_at DESC,result.assignment_id OFFSET p_result_offset LIMIT 31),
 result_page AS(SELECT * FROM results ORDER BY published_at DESC,assignment_id LIMIT 30)
 SELECT jsonb_build_object('journal',jsonb_build_object('students','[]'::jsonb,'offset',p_offset,'nextOffset',CASE WHEN (SELECT count(*) FROM columns)>30 THEN p_offset+30 END,
 'columns',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'date',lesson_date,'category',category,'preset',preset) ORDER BY lesson_date DESC,id) FROM page),'[]'::jsonb),
 'grades',COALESCE((SELECT jsonb_agg(public.classroom_journal_grade_json(r::public.classroom_journal_revisions,profile.display_name::text)) FROM latest r
 LEFT JOIN public.principals author ON author.id=r.author_id LEFT JOIN public.profiles profile ON profile.account_id=author.account_id),'[]'::jsonb)),
 'results',COALESCE((SELECT jsonb_agg(to_jsonb(result_page) ORDER BY published_at DESC,assignment_id) FROM result_page),'[]'::jsonb),
 'resultOffset',p_result_offset,'nextResultOffset',CASE WHEN (SELECT count(*) FROM results)>30 THEN p_result_offset+30 END)
 WHERE public.classroom_journal_teacher(p_actor,p_class) AND public.classroom_participant_allowed(p_actor,p_class,p_seat)
 AND p_offset BETWEEN 0 AND 100000 AND p_result_offset BETWEEN 0 AND 100000;
$$;

CREATE FUNCTION classroom_participant_builtin_awards(p_actor uuid,p_class uuid,p_seat uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(jsonb_build_object('awardKey',a.award_key,'note',a.note,
 'createdAt',a.created_at,'awardedBy',a.awarded_by_display_name)) FROM public.classroom_seat_awards_list(p_seat) a),'[]'::jsonb))
 WHERE public.classroom_participant_allowed(p_actor,p_class,p_seat);
$$;
CREATE FUNCTION classroom_participant_result_history(p_actor uuid,p_class uuid,p_seat uuid,p_assignment uuid,p_offset integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH revisions AS(SELECT r.id,r.revision_number revision,r.raw_points,r.max_points,r.feedback,r.correction_reason reason,r.published_at,
 a.attempt_number,COALESCE(profile.display_name,'Преподаватель') author
 FROM public.learning_attempts a JOIN public.assessment_results r ON r.attempt_id=a.id
 LEFT JOIN public.principals reviewer ON reviewer.id=r.evaluator_principal_id LEFT JOIN public.profiles profile ON profile.account_id=reviewer.account_id
 WHERE a.classroom_id=p_class AND a.classroom_assignment_id=p_assignment AND a.seat_id=p_seat
 AND (a.learner_identity_id IS NULL OR EXISTS(SELECT 1 FROM public.learner_identity_links l WHERE l.seat_id=p_seat AND l.status='active' AND l.learner_identity_id=a.learner_identity_id))),
 page AS(SELECT * FROM revisions ORDER BY published_at DESC,id OFFSET p_offset LIMIT 30)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY published_at DESC,id) FROM page),'[]'::jsonb),
 'hasMore',(SELECT count(*) FROM revisions)>p_offset+30,'offset',p_offset)
 WHERE public.classroom_journal_teacher(p_actor,p_class) AND public.classroom_participant_allowed(p_actor,p_class,p_seat)
 AND public.learning_direct_assignment_seat_visible(p_seat,p_assignment) AND p_offset BETWEEN 0 AND 100000;
$$;
CREATE FUNCTION classroom_participant_write(p_actor uuid,p_class uuid,p_action varchar,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_class public.classrooms%ROWTYPE; v_prior public.classroom_participant_receipts%ROWTYPE;
 v_seat uuid; v_id uuid; v_result jsonb; v_settings jsonb; v_teacher boolean; v_payload jsonb;
BEGIN
 v_teacher:=public.classroom_journal_teacher(p_actor,p_class);
 IF p_action NOT IN('settings','role','merit','merit_grant','builtin_grant','avatar','avatar_grant','avatar_choose') OR p_action IS NULL
 OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR length(p_input::text)>310000
 OR jsonb_typeof(p_input->'requestId') IS DISTINCT FROM 'string' OR COALESCE(p_input->>'requestId','') !~ '^[A-Za-z0-9._:-]{8,128}$'
 THEN RETURN '{"error":"invalid_body"}'; END IF;
 IF p_action IN('role','merit_grant','builtin_grant','avatar_grant','avatar_choose') THEN
 BEGIN v_seat:=(p_input->>'seatId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN '{"error":"invalid_body"}'; END;
 IF NOT public.classroom_participant_allowed(p_actor,p_class,v_seat) THEN RETURN '{"error":"forbidden"}'; END IF;
 END IF;
 IF NOT v_teacher AND (p_action<>'avatar_choose' OR NOT public.classroom_participant_owns(p_actor,v_seat)) THEN RETURN '{"error":"forbidden"}'; END IF;
 SELECT * INTO v_class FROM public.classrooms WHERE id=p_class FOR UPDATE;
 IF v_class.status IS DISTINCT FROM 'active' THEN RETURN '{"error":"classroom_archived"}'; END IF;
 v_payload:=jsonb_build_object('action',p_action,'input',p_input);
 SELECT * INTO v_prior FROM public.classroom_participant_receipts WHERE classroom_id=p_class AND actor_id=p_actor AND request_id=p_input->>'requestId';
 IF FOUND THEN
 IF v_prior.payload<>v_payload THEN RETURN '{"error":"idempotency_conflict"}'; END IF;
 RETURN v_prior.result;
 END IF;
 IF p_action='settings' THEN
 v_settings:=public.classroom_participant_settings_json(p_class);
 IF p_input-ARRAY['requestId','expectedRevision','periodDays','factors']<>'{}'::jsonb
 OR jsonb_typeof(p_input->'expectedRevision') IS DISTINCT FROM 'number' OR COALESCE(p_input->>'expectedRevision','') !~ '^[0-9]{1,9}$'
 OR jsonb_typeof(p_input->'periodDays') IS DISTINCT FROM 'number' OR COALESCE(p_input->>'periodDays','') NOT IN('7','30','90')
 OR jsonb_typeof(p_input->'factors') IS DISTINCT FROM 'object' THEN RETURN '{"error":"invalid_settings"}'; END IF;
 IF NOT((p_input->'factors') ?& ARRAY['projects','logins','days','time','grades'])
 OR (p_input->'factors')-ARRAY['projects','logins','days','time','grades']<>'{}'::jsonb
 OR EXISTS(SELECT 1 FROM jsonb_each(p_input->'factors') f WHERE jsonb_typeof(f.value)<>'boolean') THEN RETURN '{"error":"invalid_settings"}'; END IF;
 IF (p_input->>'expectedRevision')::integer<>(v_settings->>'revision')::integer THEN RETURN '{"error":"revision_conflict"}'; END IF;
 INSERT INTO public.classroom_participant_settings(classroom_id,period_days,factors,revision)
 VALUES(p_class,(p_input->>'periodDays')::integer,p_input->'factors',1)
 ON CONFLICT(classroom_id) DO UPDATE SET period_days=excluded.period_days,factors=excluded.factors,revision=classroom_participant_settings.revision+1;
 v_result:=public.classroom_participant_settings_json(p_class);
 ELSIF p_action='builtin_grant' THEN
 IF p_input-ARRAY['requestId','seatId','awardKey','note','granted']<>'{}'::jsonb
 OR COALESCE(p_input->>'awardKey','') NOT IN('first-model','bright-idea','careful-work','precision','perseverance','helper','explorer','editors-choice')
 OR jsonb_typeof(p_input->'granted') IS DISTINCT FROM 'boolean'
 OR (p_input->>'note' IS NOT NULL AND (jsonb_typeof(p_input->'note')<>'string' OR length(p_input->>'note')>280 OR p_input->>'note' ~ '[<>[:cntrl:]]')) THEN RETURN '{"error":"invalid_merit"}'; END IF;
 IF NOT public.classroom_seat_award_set(p_actor,v_seat,p_input->>'awardKey',p_input->>'note',(p_input->>'granted')::boolean) THEN RETURN '{"error":"forbidden"}'; END IF;
 v_result:=public.classroom_participant_builtin_awards(p_actor,p_class,v_seat);
 ELSIF p_action='role' THEN
 IF p_input-ARRAY['requestId','seatId','role']<>'{}'::jsonb OR COALESCE(p_input->>'role','') NOT IN('student','helper') THEN RETURN '{"error":"invalid_role"}'; END IF;
 INSERT INTO public.classroom_participant_roles(seat_id,role) VALUES(v_seat,p_input->>'role') ON CONFLICT(seat_id) DO UPDATE SET role=excluded.role;
 v_result:=jsonb_build_object('role',p_input->>'role');
 ELSIF p_action IN('merit','avatar') THEN
 IF jsonb_typeof(p_input->'title') IS DISTINCT FROM 'string' OR COALESCE(length(btrim(p_input->>'title')),0) NOT BETWEEN 1 AND 60
 OR p_input->>'title' ~ '[<>[:cntrl:]]' OR p_input->>'title' ~* '(https?://|www\.)' THEN RETURN '{"error":"invalid_title"}'; END IF;
 IF p_action='merit' THEN
 IF p_input-ARRAY['requestId','title','description']<>'{}'::jsonb OR jsonb_typeof(p_input->'description') IS DISTINCT FROM 'string'
 OR length(p_input->>'description')>240 OR p_input->>'description' ~ '[<>[:cntrl:]]' OR p_input->>'description' ~* '(https?://|www\.)' THEN RETURN '{"error":"invalid_merit"}'; END IF;
 IF (SELECT count(*) FROM public.classroom_custom_merits WHERE classroom_id=p_class)>=24 THEN RETURN '{"error":"limit_reached"}'; END IF;
 INSERT INTO public.classroom_custom_merits(classroom_id,title,description,created_by) VALUES(p_class,btrim(p_input->>'title'),p_input->>'description',p_actor) RETURNING id INTO v_id;
 ELSE
 IF p_input-ARRAY['requestId','title','dataUrl','secret','meritId','builtinAward']<>'{}'::jsonb
 OR jsonb_typeof(p_input->'secret') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_input->'dataUrl') IS DISTINCT FROM 'string'
 OR COALESCE(length(p_input->>'dataUrl'),0) NOT BETWEEN 32 AND 300000 OR p_input->>'dataUrl' !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$'
 THEN RETURN '{"error":"invalid_avatar"}'; END IF;
 IF (SELECT count(*) FROM public.classroom_custom_avatars WHERE classroom_id=p_class)>=24 THEN RETURN '{"error":"limit_reached"}'; END IF;
 BEGIN v_id:=(p_input->>'meritId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN '{"error":"invalid_merit"}'; END;
 IF v_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.classroom_custom_merits WHERE id=v_id AND classroom_id=p_class) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF p_input->>'builtinAward' IS NOT NULL AND (v_id IS NOT NULL OR p_input->>'builtinAward' NOT IN('first-model','bright-idea','careful-work','precision','perseverance','helper','explorer','editors-choice')) THEN RETURN '{"error":"invalid_merit"}'; END IF;
 INSERT INTO public.classroom_custom_avatars(classroom_id,title,data_url,secret,merit_id,builtin_award,created_by)
 VALUES(p_class,btrim(p_input->>'title'),p_input->>'dataUrl',(p_input->>'secret')::boolean,v_id,p_input->>'builtinAward',p_actor) RETURNING id INTO v_id;
 END IF;
 v_result:=jsonb_build_object('id',v_id);
 ELSE
 IF p_input-ARRAY['requestId','seatId','id','granted']<>'{}'::jsonb THEN RETURN '{"error":"invalid_body"}'; END IF;
 BEGIN v_id:=(p_input->>'id')::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN '{"error":"invalid_body"}'; END;
 IF p_action='merit_grant' THEN
 IF jsonb_typeof(p_input->'granted') IS DISTINCT FROM 'boolean' THEN RETURN '{"error":"invalid_body"}'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.classroom_custom_merits WHERE id=v_id AND classroom_id=p_class) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF (p_input->>'granted')::boolean THEN
 INSERT INTO public.classroom_custom_merit_grants(seat_id,merit_id,granted_by) VALUES(v_seat,v_id,p_actor) ON CONFLICT DO NOTHING;
 ELSE DELETE FROM public.classroom_custom_merit_grants WHERE seat_id=v_seat AND merit_id=v_id; END IF;
 ELSIF p_action='avatar_grant' THEN
 IF jsonb_typeof(p_input->'granted') IS DISTINCT FROM 'boolean' THEN RETURN '{"error":"invalid_body"}'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.classroom_custom_avatars WHERE id=v_id AND classroom_id=p_class) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF (p_input->>'granted')::boolean THEN INSERT INTO public.classroom_custom_avatar_grants(seat_id,avatar_id) VALUES(v_seat,v_id) ON CONFLICT DO NOTHING;
 ELSE DELETE FROM public.classroom_custom_avatar_grants WHERE seat_id=v_seat AND avatar_id=v_id; END IF;
 ELSE
 IF p_input?'granted' THEN RETURN '{"error":"invalid_body"}'; END IF;
 IF v_id IS NULL THEN DELETE FROM public.classroom_custom_avatar_choices WHERE seat_id=v_seat;
 ELSE
 IF NOT public.classroom_participant_avatar_available(v_seat,v_id) THEN RETURN '{"error":"forbidden"}'; END IF;
 INSERT INTO public.classroom_custom_avatar_choices(seat_id,avatar_id) VALUES(v_seat,v_id) ON CONFLICT(seat_id) DO UPDATE SET avatar_id=excluded.avatar_id;
 END IF;
 END IF;
 v_result:='{"saved":true}';
 END IF;
 INSERT INTO public.classroom_participant_receipts(classroom_id,actor_id,request_id,payload,result) VALUES(p_class,p_actor,p_input->>'requestId',v_payload,v_result);
 INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
 VALUES(v_class.tenant_id,'classroom',p_class,'classroom.participant.'||p_action,jsonb_build_object('actorId',p_actor,'seatId',v_seat,'evidenceId',v_id,'requestId',p_input->>'requestId'));
 RETURN v_result;
END;
$$;

-- Tables cannot be accessed by runtime directly. Every exposed projection or
-- mutation checks the principal and exact class. Helper is display/task duty
-- only and is deliberately absent from all teacher authorization predicates.
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['classroom_participant_settings','classroom_participant_roles','classroom_custom_merits','classroom_custom_merit_grants',
 'classroom_custom_avatars','classroom_custom_avatar_grants','classroom_custom_avatar_choices','classroom_participant_receipts','classroom_participant_project_edits'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,asalab_app',name);
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION classroom_participant_record_edit(),classroom_participant_principals(uuid),classroom_participant_owns(uuid,uuid),
 classroom_participant_allowed(uuid,uuid,uuid),classroom_participant_projects(uuid),classroom_participant_settings_json(uuid),
 classroom_participant_avatar_available(uuid,uuid),classroom_participant_metrics(uuid),classroom_participant_roster(uuid,uuid),
 classroom_participant_summary(uuid,uuid[]),classroom_participant_profile(uuid,uuid,uuid),classroom_participant_staff(uuid,uuid,uuid),
 classroom_participant_works(uuid,uuid,uuid,varchar,boolean,boolean,integer),classroom_participant_write(uuid,uuid,varchar,jsonb) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION classroom_participant_grades(uuid,uuid,uuid,integer,integer) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION classroom_participant_prepare(uuid,uuid[]) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION classroom_participant_avatar_read(uuid,uuid,uuid,uuid) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION classroom_participant_builtin_awards(uuid,uuid,uuid) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION classroom_participant_result_history(uuid,uuid,uuid,uuid,integer) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION classroom_participant_staff_classes(uuid,uuid),classroom_participant_managers(uuid,uuid) FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION classroom_participant_roster(uuid,uuid),classroom_participant_summary(uuid,uuid[]),
 classroom_participant_profile(uuid,uuid,uuid),classroom_participant_staff(uuid,uuid,uuid),
 classroom_participant_works(uuid,uuid,uuid,varchar,boolean,boolean,integer),classroom_participant_write(uuid,uuid,varchar,jsonb) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_participant_grades(uuid,uuid,uuid,integer,integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_participant_prepare(uuid,uuid[]) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_participant_avatar_read(uuid,uuid,uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_participant_builtin_awards(uuid,uuid,uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_participant_result_history(uuid,uuid,uuid,uuid,integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_participant_managers(uuid,uuid) TO asalab_app;
