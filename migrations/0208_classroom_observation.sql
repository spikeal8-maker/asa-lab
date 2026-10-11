-- Observation is read-only. Counts are separate from permission to read content.
-- No RLS/ownership changes. Internal helpers are not executable by the runtime role.
CREATE OR REPLACE FUNCTION classroom_participant_principals(p_seat uuid) RETURNS TABLE(id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH linked AS (
  SELECT sl.* FROM public.classroom_student_seats seat
  JOIN public.classrooms class ON class.id=seat.classroom_id AND class.tenant_id=seat.tenant_id AND class.status<>'deleted'
  JOIN public.learner_identity_links sl ON sl.seat_id=seat.id AND sl.link_kind='student_seat'
   AND sl.tenant_id=seat.tenant_id AND sl.school_id=class.school_id AND sl.status='active' AND sl.disabled_at IS NULL
  JOIN public.learner_identities learner ON learner.id=sl.learner_identity_id AND learner.tenant_id=sl.tenant_id AND learner.school_id=sl.school_id AND learner.state='active'
  WHERE seat.id=p_seat AND seat.status IN('issued','active','suspended')
 )
 SELECT principal.id FROM linked JOIN public.principals principal ON principal.seat_id=linked.seat_id AND principal.kind='student_seat'
 UNION
 SELECT principal.id FROM linked
 JOIN public.learner_identity_links al ON al.learner_identity_id=linked.learner_identity_id
  AND al.school_id=linked.school_id AND al.tenant_id=linked.tenant_id AND al.link_kind='account'
  AND al.status='active' AND al.disabled_at IS NULL
 JOIN public.accounts account ON account.id=al.account_id AND account.status='active'
 JOIN public.principals principal ON principal.account_id=account.id AND principal.kind='account';
$$;

-- One row per open learner obligation, never per attempt/result revision.
-- Theory completion is counted as a completed obligation; it produces no project
-- and never waits for project review. New runs never fall back to legacy work.
CREATE FUNCTION classroom_observation_obligations(p_class uuid)
RETURNS TABLE(seat_id uuid,obligation_id uuid,kind text,submitted boolean,waiting boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH seats AS (
  SELECT s.* FROM public.classroom_student_seats s WHERE s.classroom_id=p_class AND s.status IN('issued','active','suspended')
 ), candidates AS (
  SELECT DISTINCT s.id seat_id,a.id obligation_id,a.tenant_id,run.id run_id,
   participation.id participation_id,CASE WHEN a.quiz_version_id IS NULL THEN 'project' ELSE 'quiz' END kind
  FROM seats s JOIN public.classroom_assignments a ON a.classroom_id=s.classroom_id AND a.tenant_id=s.tenant_id AND a.status='open'
  LEFT JOIN public.activity_runs run ON run.source_classroom_assignment_id=a.id AND run.tenant_id=a.tenant_id
  LEFT JOIN public.learner_identity_links link ON link.seat_id=s.id AND link.tenant_id=s.tenant_id
   AND link.school_id=(SELECT school_id FROM public.classrooms WHERE id=p_class)
   AND link.link_kind='student_seat' AND link.status='active' AND link.disabled_at IS NULL
  LEFT JOIN public.learner_identities learner ON learner.id=link.learner_identity_id AND learner.tenant_id=link.tenant_id AND learner.school_id=link.school_id AND learner.state='active'
  LEFT JOIN public.activity_participations participation ON participation.activity_run_id=run.id
   AND participation.tenant_id=a.tenant_id AND participation.school_id=link.school_id AND participation.learner_identity_id=learner.id
  WHERE (
   (run.id IS NULL AND a.learning_activity_version_id IS NULL)
   OR (run.lifecycle_status='active' AND participation.status IN('assigned','active')
    AND (participation.source_course_enrollment_id IS NULL OR EXISTS(
     SELECT 1 FROM public.course_enrollments enrollment WHERE enrollment.id=participation.source_course_enrollment_id
      AND enrollment.tenant_id=a.tenant_id AND enrollment.school_id=participation.school_id AND enrollment.status IN('assigned','active'))))
  )
  AND (a.course_run_id IS NULL OR EXISTS(
   SELECT 1 FROM public.classroom_course_runs course WHERE course.id=a.course_run_id AND course.tenant_id=a.tenant_id
    AND course.classroom_id=p_class AND course.status='open'
    AND (course.creation_request_id IS NULL OR EXISTS(
     SELECT 1 FROM public.course_enrollments enrollment WHERE enrollment.course_run_id=course.id
      AND enrollment.tenant_id=course.tenant_id AND enrollment.learner_identity_id=learner.id AND enrollment.status IN('assigned','active')))))
 ), project_counts AS (
  SELECT c.seat_id,c.obligation_id,c.kind,
   CASE WHEN latest.id IS NOT NULL OR c.run_id IS NOT NULL THEN EXISTS(
    SELECT 1 FROM public.learning_attempts attempt JOIN public.learning_submissions submission
     ON submission.attempt_id=attempt.id AND submission.tenant_id=attempt.tenant_id
    WHERE attempt.tenant_id=c.tenant_id AND attempt.classroom_assignment_id=c.obligation_id AND attempt.seat_id=c.seat_id
     AND (c.run_id IS NULL OR attempt.activity_participation_id=c.participation_id)
     AND attempt.state IN('submitted','evaluating','closed')
   ) ELSE work.submitted_at IS NOT NULL END submitted,
   CASE WHEN latest.id IS NOT NULL OR c.run_id IS NOT NULL
    THEN COALESCE(latest.state IN('submitted','evaluating') AND latest.submitted_at IS NOT NULL,false)
    ELSE work.submitted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.project_feedback fb WHERE fb.project_id=work.project_id AND fb.updated_at>=work.submitted_at)
   END waiting
  FROM candidates c
  LEFT JOIN LATERAL(SELECT attempt.* FROM public.learning_attempts attempt WHERE attempt.tenant_id=c.tenant_id
   AND attempt.classroom_assignment_id=c.obligation_id AND attempt.seat_id=c.seat_id
   AND (c.run_id IS NULL OR attempt.activity_participation_id=c.participation_id)
   ORDER BY attempt.attempt_number DESC,attempt.id DESC LIMIT 1) latest ON true
  LEFT JOIN public.classroom_assignment_work work ON work.assignment_id=c.obligation_id AND work.seat_id=c.seat_id AND work.tenant_id=c.tenant_id
 ), theory AS (
  SELECT DISTINCT s.id seat_id,lesson.id obligation_id,'theory'::text kind,progress.completed_at IS NOT NULL submitted,false waiting
  FROM seats s JOIN public.classroom_course_runs course ON course.classroom_id=s.classroom_id AND course.tenant_id=s.tenant_id AND course.status='open'
  JOIN public.classroom_course_run_lessons lesson ON lesson.run_id=course.id AND lesson.tenant_id=course.tenant_id AND lesson.kind='material'
  LEFT JOIN public.classroom_course_lesson_progress progress ON progress.run_id=course.id AND progress.tenant_id=course.tenant_id AND progress.lesson_id=lesson.id AND progress.seat_id=s.id
  WHERE course.creation_request_id IS NULL OR EXISTS(
   SELECT 1 FROM public.course_enrollments enrollment JOIN public.learner_identity_links link
    ON link.learner_identity_id=enrollment.learner_identity_id AND link.tenant_id=enrollment.tenant_id AND link.school_id=enrollment.school_id
    AND link.seat_id=s.id AND link.link_kind='student_seat' AND link.status='active' AND link.disabled_at IS NULL
   JOIN public.learner_identities learner ON learner.id=link.learner_identity_id AND learner.tenant_id=link.tenant_id AND learner.school_id=link.school_id AND learner.state='active'
   WHERE enrollment.course_run_id=course.id AND enrollment.tenant_id=course.tenant_id AND enrollment.status IN('assigned','active'))
 ) SELECT * FROM project_counts UNION ALL SELECT * FROM theory;
$$;

CREATE FUNCTION classroom_observation_seat_counts(p_class uuid)
RETURNS TABLE(seat_id uuid,assigned integer,submitted integer,waiting integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT s.id,count(o.obligation_id)::integer,count(o.obligation_id) FILTER(WHERE o.submitted)::integer,
  count(o.obligation_id) FILTER(WHERE o.waiting AND o.submitted)::integer
 FROM public.classroom_student_seats s LEFT JOIN public.classroom_observation_obligations(p_class) o ON o.seat_id=s.id
 WHERE s.classroom_id=p_class AND s.status<>'removed' GROUP BY s.id;
$$;

CREATE FUNCTION classroom_observation_summary(p_actor uuid,p_classes uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH classes AS MATERIALIZED(SELECT c.id FROM public.classrooms c WHERE c.id=ANY(p_classes) AND public.classroom_journal_teacher(p_actor,c.id)),
 seats AS MATERIALIZED(SELECT s.id,s.classroom_id FROM public.classroom_student_seats s JOIN classes c ON c.id=s.classroom_id WHERE s.status<>'removed'),
 projects AS MATERIALIZED(SELECT DISTINCT s.classroom_id,p.id FROM seats s CROSS JOIN LATERAL public.classroom_participant_projects(s.id) p),
 counts AS MATERIALIZED(SELECT c.id classroom_id,m.* FROM classes c CROSS JOIN LATERAL public.classroom_observation_seat_counts(c.id) m),
 items AS(SELECT c.id,jsonb_build_object('classroomId',c.id,'students',(SELECT count(*) FROM seats s WHERE s.classroom_id=c.id),
  'works',(SELECT count(*) FROM projects p WHERE p.classroom_id=c.id),
  'assigned',COALESCE(sum(m.assigned),0),'submitted',COALESCE(sum(m.submitted),0),'waiting',COALESCE(sum(m.waiting),0),
  'notSubmitted',count(m.seat_id) FILTER(WHERE m.assigned>0 AND m.submitted=0)) item
  FROM classes c LEFT JOIN counts m ON m.classroom_id=c.id GROUP BY c.id)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(item ORDER BY id) FROM items),'[]'::jsonb),
  'totals',jsonb_build_object('students',(SELECT count(*) FROM seats),'works',(SELECT count(DISTINCT id) FROM projects),
  'assigned',COALESCE(sum(assigned),0),'submitted',COALESCE(sum(submitted),0),'waiting',COALESCE(sum(waiting),0),
  'notSubmitted',count(*) FILTER(WHERE assigned>0 AND submitted=0))) FROM counts
 HAVING cardinality(p_classes)<=200 AND cardinality(p_classes)=(SELECT count(*) FROM classes);
$$;

CREATE FUNCTION classroom_observation_projects(p_actor uuid,p_class uuid,p_module text,p_seat uuid,p_search text,p_assignment text,p_archive boolean,p_offset integer,p_limit integer)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH seats AS MATERIALIZED(SELECT s.* FROM public.classroom_student_seats s WHERE s.classroom_id=p_class AND s.status<>'removed'
  AND public.classroom_journal_teacher(p_actor,p_class)),
 owned AS MATERIALIZED(SELECT DISTINCT ON(p.id) p.*,s.id seat_id,s.display_label,s.avatar_key,
  COALESCE(d.updated_at,p.created_at) updated_at,
  EXISTS(SELECT 1 FROM public.project_context_for_principal(p_actor,p.id)) readable,
  (EXISTS(SELECT 1 FROM public.classroom_assignment_work work JOIN public.classroom_assignments a ON a.id=work.assignment_id AND a.tenant_id=work.tenant_id
    WHERE work.project_id=p.id AND work.seat_id=s.id AND a.classroom_id=p_class
     AND a.learning_activity_version_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.activity_runs run WHERE run.source_classroom_assignment_id=a.id))
   OR EXISTS(SELECT 1 FROM public.learning_project_origins origin JOIN public.activity_runs run ON run.id=origin.activity_run_id AND run.tenant_id=origin.school_tenant_id
    WHERE origin.project_id=p.id AND run.classroom_id=p_class)) assigned
  FROM seats s CROSS JOIN LATERAL public.classroom_participant_projects(s.id) ids JOIN public.projects p ON p.id=ids.id
  LEFT JOIN public.project_drafts d ON d.project_id=p.id
  WHERE p_seat IS NULL OR s.id=p_seat ORDER BY p.id,s.id),
 filtered AS MATERIALIZED(SELECT * FROM owned WHERE readable AND (p_module IS NULL OR module_key=p_module)
  AND (p_archive OR status='active') AND (p_search IS NULL OR position(lower(p_search) IN lower(title))>0)
  AND (p_assignment IS NULL OR assigned=(p_assignment='assigned'))),
 page AS(SELECT * FROM filtered ORDER BY updated_at DESC,id DESC OFFSET p_offset LIMIT p_limit)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'title',title,'moduleKey',module_key,
  'seatId',seat_id,'student',display_label,'avatarKey',avatar_key,'updatedAt',updated_at,'status',status,'assigned',assigned)
  ORDER BY updated_at DESC,id DESC) FROM page),'[]'::jsonb),
  'total',(SELECT count(*) FROM filtered),'hidden',(SELECT count(*) FROM owned WHERE NOT readable),
  'nextOffset',CASE WHEN p_offset+p_limit<(SELECT count(*) FROM filtered) THEN p_offset+p_limit END,
  'learners',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'label',display_label) ORDER BY display_label,id) FROM seats),'[]'::jsonb))
 WHERE public.classroom_journal_teacher(p_actor,p_class) AND p_offset BETWEEN 0 AND 100000 AND p_limit IN(30,50)
  AND (p_module IS NULL OR p_module IN('three-d','electronics','blocks')) AND length(COALESCE(p_search,''))<=100
  AND (p_assignment IS NULL OR p_assignment IN('assigned','unassigned'))
  AND (p_seat IS NULL OR EXISTS(SELECT 1 FROM seats WHERE id=p_seat));
$$;

-- Explicit admissions/logouts already use the analytics outbox. Never infer
-- authentication or logout from timestamps, module sessions, or tab closure.
CREATE FUNCTION classroom_observation_history(p_actor uuid,p_class uuid,p_seat uuid,p_category text,p_from timestamptz,p_to timestamptz,p_before timestamptz,p_before_id text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH seats AS MATERIALIZED(SELECT s.* FROM public.classroom_student_seats s WHERE s.classroom_id=p_class AND s.status<>'removed'
  AND public.classroom_journal_teacher(p_actor,p_class)),
 identities AS MATERIALIZED(SELECT s.id seat_id,s.created_at admitted_at,i.id principal_id FROM seats s CROSS JOIN LATERAL public.classroom_participant_principals(s.id) i),
 class_events AS MATERIALIZED(SELECT 'class:'||e.id id,e.action,e.seat_id,s.display_label student,
  COALESCE(e.actor_is_teacher_at_event,
   public.classroom_journal_teacher(e.actor_principal_id,p_class) OR (e.seat_id IS NULL AND EXISTS(SELECT 1 FROM public.principals actor WHERE actor.id=e.actor_principal_id AND actor.kind='account'))) by_teacher,
  e.project_id,p.title project_title,e.occurred_at at,e.occurrence_count count,e.actor_principal_id actor
  FROM public.classroom_activity_events e LEFT JOIN seats s ON s.id=e.seat_id
  LEFT JOIN public.projects p ON p.id=e.project_id AND EXISTS(SELECT 1 FROM public.project_context_for_principal(p_actor,p.id))
  WHERE e.classroom_id=p_class AND (e.project_id IS NULL OR p.id IS NOT NULL)
   AND (e.seat_id IS NULL OR s.id IS NOT NULL)),
 auth AS(SELECT DISTINCT ON(e.id) 'auth:'||e.id id,CASE WHEN e.event_type='auth.class_join' THEN 'seat.signed_in' ELSE 'asa.signed_in' END action,i.seat_id,s.display_label student,false by_teacher,
  NULL::uuid project_id,NULL::varchar project_title,e.occurred_at at,1 count,e.principal_id actor
  FROM identities i JOIN seats s ON s.id=i.seat_id JOIN public.product_analytics_events e ON e.principal_id=i.principal_id
  WHERE e.outcome='succeeded' AND e.event_type IN('auth.login','auth.max','auth.class_join') AND e.occurred_at>=i.admitted_at
   AND (e.event_type<>'auth.class_join' OR (e.seat_id=i.seat_id AND NOT EXISTS(
    SELECT 1 FROM class_events c WHERE c.seat_id=i.seat_id AND c.action='seat.signed_in'
     AND abs(extract(epoch FROM c.at-e.occurred_at))<600)))
  ORDER BY e.id,i.seat_id),
 edits AS(SELECT DISTINCT ON(e.id) 'edit:'||e.id id,'project.saved' action,s.id seat_id,s.display_label student,
  public.classroom_journal_teacher(e.actor_id,p_class) by_teacher,e.project_id,p.title project_title,e.occurred_at at,1 count,e.actor_id actor
  FROM seats s CROSS JOIN LATERAL public.classroom_participant_projects(s.id) ids
  JOIN public.classroom_participant_project_edits e ON e.project_id=ids.id JOIN public.projects p ON p.id=e.project_id
  WHERE EXISTS(SELECT 1 FROM public.project_context_for_principal(p_actor,p.id))
   AND (e.actor_id IN(SELECT principal_id FROM identities WHERE seat_id=s.id) OR public.classroom_journal_teacher(e.actor_id,p_class))
   AND NOT EXISTS(SELECT 1 FROM class_events c WHERE c.project_id=e.project_id AND c.actor=e.actor_id AND c.action IN('project.saved','project.updated')
    AND abs(extract(epoch FROM c.at-e.occurred_at))<600)
  ORDER BY e.id,s.id),
 submissions AS(SELECT DISTINCT ON(sub.id) 'submission:'||sub.id id,'submission.created' action,s.id seat_id,s.display_label student,
  public.classroom_journal_teacher(version.created_by_principal_id,p_class) by_teacher,sub.project_id,p.title project_title,
  sub.submitted_at at,1 count,version.created_by_principal_id actor
  FROM public.learning_submissions sub JOIN public.learning_attempts attempt ON attempt.id=sub.attempt_id AND attempt.tenant_id=sub.tenant_id
  JOIN seats s ON s.id=attempt.seat_id AND s.tenant_id=attempt.tenant_id
  JOIN public.projects p ON p.id=sub.project_id
  JOIN public.project_versions version ON version.id=sub.project_version_id
  WHERE attempt.classroom_id=p_class AND version.created_by_principal_id IS NOT NULL
   AND EXISTS(SELECT 1 FROM public.project_context_for_principal(p_actor,p.id))
   AND NOT EXISTS(SELECT 1 FROM class_events c WHERE c.project_id=sub.project_id AND c.action IN('project.submitted','assignment.submitted','submission.created')
    AND abs(extract(epoch FROM c.at-sub.submitted_at))<1)
  ORDER BY sub.id,s.id),
 events AS(SELECT * FROM class_events UNION ALL SELECT * FROM auth UNION ALL SELECT * FROM edits UNION ALL SELECT * FROM submissions),
 filtered AS(SELECT * FROM events WHERE (p_seat IS NULL OR seat_id=p_seat)
  AND (p_category='all' OR (p_category='projects' AND project_id IS NOT NULL) OR (p_category='access' AND project_id IS NULL))
  AND (p_from IS NULL OR at>=p_from) AND (p_to IS NULL OR at<p_to)
  AND (p_before IS NULL OR (at,id COLLATE "C")<(p_before,p_before_id COLLATE "C"))),
 page AS MATERIALIZED(SELECT * FROM filtered ORDER BY at DESC,id COLLATE "C" DESC LIMIT 51),
 shown AS MATERIALIZED(SELECT * FROM page ORDER BY at DESC,id COLLATE "C" DESC LIMIT 50)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'action',action,'seatId',seat_id,'student',student,
  'byTeacher',by_teacher,'projectId',project_id,'projectTitle',project_title,'at',at,'count',count) ORDER BY at DESC,id COLLATE "C" DESC) FROM shown),'[]'::jsonb),
  'nextCursor',CASE WHEN (SELECT count(*) FROM page)>50 THEN (SELECT to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||id FROM shown ORDER BY at,id COLLATE "C" LIMIT 1) END,
  'learners',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'label',display_label) ORDER BY display_label,id) FROM seats),'[]'::jsonb))
 WHERE public.classroom_journal_teacher(p_actor,p_class) AND p_category IN('all','access','projects')
  AND (p_seat IS NULL OR EXISTS(SELECT 1 FROM seats WHERE id=p_seat));
$$;

REVOKE ALL ON FUNCTION classroom_observation_obligations(uuid),classroom_observation_seat_counts(uuid) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION classroom_observation_summary(uuid,uuid[]),classroom_observation_projects(uuid,uuid,text,uuid,text,text,boolean,integer,integer),
 classroom_observation_history(uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_observation_summary(uuid,uuid[]),classroom_observation_projects(uuid,uuid,text,uuid,text,text,boolean,integer,integer),
 classroom_observation_history(uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz,text) TO asalab_app;

-- Compatibility routes consume the same units; no second metrics engine.
CREATE OR REPLACE FUNCTION classroom_list_for_account(p_account_id uuid)
RETURNS TABLE (
    id uuid,
    title varchar,
    status varchar,
    age_band varchar,
    topic_keys text[],
    safe_mode_default boolean,
    created_at timestamptz,
    archived_at timestamptz,
    join_code_version integer,
    join_code_status varchar,
    student_count integer,
    teacher_role varchar,
    workspace_kind varchar,
    workspace_title varchar,
    awaiting_review integer,
    assigned_count integer,
    submitted_count integer,
    behind_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title, c.status, c.age_band, c.topic_keys,
           c.safe_mode_default, c.created_at, c.archived_at, jc.version, jc.status,
           counts.seats, m.member_role, w.kind, w.title,
           counts.awaiting, counts.assigned, counts.submitted, counts.behind
      FROM public.classrooms c
      JOIN public.classroom_memberships m
        ON m.tenant_id = c.tenant_id AND m.classroom_id = c.id
      JOIN public.workspaces w ON w.tenant_id = c.tenant_id
      LEFT JOIN LATERAL (
          SELECT code.version, code.status
            FROM public.classroom_join_codes code
           WHERE code.tenant_id = c.tenant_id AND code.classroom_id = c.id
           ORDER BY code.version DESC LIMIT 1
      ) jc ON true
      LEFT JOIN LATERAL (
          SELECT count(*)::integer seats,COALESCE(sum(assigned),0)::integer assigned,
           COALESCE(sum(submitted),0)::integer submitted,COALESCE(sum(waiting),0)::integer awaiting,
           count(*) FILTER(WHERE assigned>0 AND submitted=0)::integer behind
          FROM public.classroom_observation_seat_counts(c.id)
      ) counts ON true
     WHERE m.account_id = p_account_id
       AND m.member_role IN ('owner', 'co_teacher')
       AND c.status IN ('active', 'archived')
     ORDER BY c.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION classroom_progress_summary(
    p_account_id   uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    seat_count integer,
    assigned_count integer,
    submitted_count integer,
    awaiting_review integer,
    behind_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT counts.seats, counts.assigned, counts.submitted, counts.awaiting, counts.behind
      FROM public.classrooms c
      JOIN public.classroom_memberships m
        ON m.classroom_id = c.id AND m.account_id = p_account_id
       AND m.member_role IN ('owner', 'co_teacher')
      CROSS JOIN LATERAL (
          SELECT count(*)::integer seats,COALESCE(sum(assigned),0)::integer assigned,
           COALESCE(sum(submitted),0)::integer submitted,COALESCE(sum(waiting),0)::integer awaiting,
           count(*) FILTER(WHERE assigned>0 AND submitted=0)::integer behind
          FROM public.classroom_observation_seat_counts(c.id)
      ) counts
     WHERE c.id = p_classroom_id;
$$;

CREATE OR REPLACE FUNCTION classroom_management_roster(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    id uuid,
    display_label varchar,
    login_handle varchar,
    safe_mode boolean,
    status varchar,
    avatar_key varchar,
    last_active_at timestamptz,
    created_at timestamptz,
    assigned_count integer,
    submitted_count integer,
    awaiting_review integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.id, s.display_label, s.login_handle, s.safe_mode, s.status, s.avatar_key,
           s.last_active_at, s.created_at,
           counts.assigned,counts.submitted,counts.waiting
      FROM public.classroom_student_seats s
      JOIN public.classroom_observation_seat_counts(p_classroom_id) counts ON counts.seat_id=s.id
     WHERE s.classroom_id = p_classroom_id
       AND s.status <> 'removed'
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships m
            WHERE m.account_id = p_account_id
              AND m.classroom_id = p_classroom_id
              AND m.tenant_id = s.tenant_id
              AND m.member_role IN ('owner', 'co_teacher'))
     ORDER BY lower(s.display_label), s.id;
$$;


CREATE OR REPLACE FUNCTION classroom_seat_work_counts(p_seat_id uuid)
RETURNS TABLE(submitted integer,awaiting_review integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT counts.submitted,counts.waiting FROM public.classroom_student_seats seat
 CROSS JOIN LATERAL public.classroom_observation_seat_counts(seat.classroom_id) counts
 WHERE seat.id=p_seat_id AND counts.seat_id=seat.id;
$$;
ALTER FUNCTION classroom_participant_profile(uuid,uuid,uuid) RENAME TO classroom_participant_profile_before_observation;
REVOKE ALL ON FUNCTION classroom_participant_profile_before_observation(uuid,uuid,uuid) FROM PUBLIC,asalab_app;
CREATE FUNCTION classroom_participant_profile(p_actor uuid,p_class uuid,p_seat uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.classroom_participant_profile_before_observation(p_actor,p_class,p_seat)||
  jsonb_build_object('assignedCount',counts.assigned,'submittedCount',counts.submitted,'awaitingReview',counts.waiting,
   'notSubmitted',CASE WHEN counts.assigned>0 AND counts.submitted=0 THEN 1 ELSE 0 END)
 FROM public.classroom_observation_seat_counts(p_class) counts
 WHERE counts.seat_id=p_seat AND public.classroom_participant_allowed(p_actor,p_class,p_seat);
$$;
REVOKE ALL ON FUNCTION classroom_participant_profile(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_participant_profile(uuid,uuid,uuid) TO asalab_app;

-- Future first admission: only the real issued->active transition in the same
-- transaction as a successful Seat session. Existing rows are never backfilled.
CREATE FUNCTION classroom_observation_record_activation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 IF OLD.status='issued' AND NEW.status='active' AND EXISTS(
  SELECT 1 FROM public.classroom_student_sessions session WHERE session.seat_id=NEW.id
   AND session.created_at=now() AND session.revoked_at IS NULL) THEN
  SELECT id INTO actor FROM public.principals WHERE seat_id=NEW.id AND kind='student_seat';
  IF actor IS NULL THEN
   SELECT principal_id INTO actor FROM public.student_seat_principal(NEW.id);
  END IF;
  IF actor IS NOT NULL THEN
   BEGIN
    PERFORM public.classroom_activity_record(NEW.tenant_id,NEW.classroom_id,NEW.id,actor,'seat.activated',NULL,NULL,interval '0 seconds');
   EXCEPTION WHEN OTHERS THEN
    -- Optional observation failure cannot cancel an already successful admission.
    RAISE LOG 'classroom_observation_activation_record_failed';
   END;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION classroom_observation_record_activation() FROM PUBLIC,asalab_app;
CREATE TRIGGER classroom_observation_activation AFTER UPDATE OF status ON classroom_student_seats
FOR EACH ROW EXECUTE FUNCTION classroom_observation_record_activation();

CREATE OR REPLACE FUNCTION classroom_awaiting_review_total(p_account_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE(sum(awaiting_review),0)::integer FROM public.classroom_list_for_account(p_account_id) WHERE status='active';
$$;

-- Existing explicit prepare also accepts the proven canonical owner when the
-- legacy seat.account_id is stale. Its no-revival guards remain unchanged.
CREATE OR REPLACE FUNCTION classroom_participant_prepare(p_actor uuid,p_classes uuid[]) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s record;
BEGIN
 IF cardinality(p_classes)>200 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_classes) class_id WHERE NOT public.classroom_journal_teacher(p_actor,class_id)
 AND NOT EXISTS(SELECT 1 FROM public.principals actor JOIN public.classroom_student_seats seat
 ON (actor.kind='student_seat' AND seat.id=actor.seat_id) OR ((actor.kind='account' AND seat.account_id=actor.account_id) OR public.classroom_participant_owns(p_actor,seat.id))
 WHERE actor.id=p_actor AND seat.classroom_id=class_id AND seat.status='active'
 AND (actor.kind='student_seat' OR EXISTS(SELECT 1 FROM public.accounts a WHERE a.id=actor.account_id AND a.status='active')))) THEN RETURN false; END IF;
 FOR s IN SELECT seat.id,seat.account_id,c.school_id FROM public.classroom_student_seats seat JOIN public.classrooms c ON c.id=seat.classroom_id
 WHERE c.id=ANY(p_classes) AND c.status<>'deleted' AND seat.status IN('issued','active')
 AND (public.classroom_journal_teacher(p_actor,c.id) OR EXISTS(SELECT 1 FROM public.principals actor WHERE actor.id=p_actor
 AND (actor.seat_id=seat.id OR ((actor.kind='account' AND actor.account_id=seat.account_id) OR public.classroom_participant_owns(p_actor,seat.id)))))
 AND NOT EXISTS(SELECT 1 FROM public.learner_identity_links l WHERE l.seat_id=seat.id)
 AND NOT EXISTS(SELECT 1 FROM public.learner_identity_links l LEFT JOIN public.learner_identities learner ON learner.id=l.learner_identity_id
 WHERE l.account_id=seat.account_id AND l.school_id=c.school_id AND (l.status<>'active' OR l.disabled_at IS NOT NULL OR learner.state<>'active')) LOOP
 PERFORM public.learning_audience_ensure_seat_identity(s.id);
 PERFORM public.student_seat_principal(s.id);
 END LOOP;
 RETURN true;
END; $$;
