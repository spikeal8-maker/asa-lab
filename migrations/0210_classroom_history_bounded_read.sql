-- Keep the existing read-only history contract, event provenance and actor gates.
-- Materialization fences bind expensive content authorization to this class's
-- candidate IDs, not an optimizer-selected scan of all projects in the database.
-- JIT is local to this interactive projection (and restores the caller setting);
-- compiling its many permission expressions must not dominate a small response.
-- No data rewrite, privilege change, global setting or timeout increase.
CREATE OR REPLACE FUNCTION classroom_observation_history(p_actor uuid,p_class uuid,p_seat uuid,p_category text,p_from timestamptz,p_to timestamptz,p_before timestamptz,p_before_id text)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET jit=off AS $$
 WITH seats AS MATERIALIZED(SELECT s.* FROM public.classroom_student_seats s WHERE s.classroom_id=p_class AND s.status<>'removed'
  AND public.classroom_journal_teacher(p_actor,p_class)),
 identities AS MATERIALIZED(SELECT s.id seat_id,s.created_at admitted_at,i.id principal_id FROM seats s CROSS JOIN LATERAL public.classroom_participant_principals(s.id) i),
 -- Authorize event candidates before looking up titles; no all-tenant predicate.
 seat_projects AS MATERIALIZED(
  SELECT s.id seat_id,p.id project_id FROM seats s
  CROSS JOIN LATERAL public.classroom_participant_projects(s.id) p),
 scoped_class_events AS MATERIALIZED(
  SELECT e.* FROM public.classroom_activity_events e
  WHERE e.classroom_id=p_class
   AND(e.seat_id IS NULL OR EXISTS(SELECT 1 FROM seats s WHERE s.id=e.seat_id))),
 scoped_edits AS MATERIALIZED(
  SELECT e.id,e.project_id,e.actor_id,e.occurred_at,sp.seat_id
  FROM seat_projects sp
  JOIN public.classroom_participant_project_edits e ON e.project_id=sp.project_id),
 scoped_submissions AS MATERIALIZED(
  SELECT sub.id,sub.project_id,sub.submitted_at,attempt.seat_id,
   version.created_by_principal_id actor
  FROM public.learning_submissions sub
  JOIN public.learning_attempts attempt ON attempt.id=sub.attempt_id AND attempt.tenant_id=sub.tenant_id
  JOIN seats s ON s.id=attempt.seat_id AND s.tenant_id=attempt.tenant_id
  JOIN public.project_versions version ON version.id=sub.project_version_id
  WHERE attempt.classroom_id=p_class AND version.created_by_principal_id IS NOT NULL),
 candidate_projects AS MATERIALIZED(
  SELECT project_id FROM scoped_class_events WHERE project_id IS NOT NULL
  UNION SELECT project_id FROM scoped_edits
  UNION SELECT project_id FROM scoped_submissions),
 readable_project_ids AS MATERIALIZED(
  SELECT candidate.project_id FROM candidate_projects candidate
  WHERE EXISTS(SELECT 1 FROM public.project_context_for_principal(p_actor,candidate.project_id))),
 readable_projects AS MATERIALIZED(
  SELECT p.id,p.title FROM readable_project_ids allowed
  JOIN public.projects p ON p.id=allowed.project_id),
 class_events AS MATERIALIZED(
  SELECT 'class:'||e.id id,e.action,e.seat_id,s.display_label student,
   COALESCE(e.actor_is_teacher_at_event,
    public.classroom_journal_teacher(e.actor_principal_id,p_class)
    OR(e.seat_id IS NULL AND EXISTS(SELECT 1 FROM public.principals actor WHERE actor.id=e.actor_principal_id AND actor.kind='account'))) by_teacher,
   e.project_id,p.title project_title,e.occurred_at at,e.occurrence_count count,e.actor_principal_id actor
  FROM scoped_class_events e LEFT JOIN seats s ON s.id=e.seat_id
  LEFT JOIN readable_projects p ON p.id=e.project_id
  WHERE e.project_id IS NULL OR p.id IS NOT NULL),
 auth AS(SELECT DISTINCT ON(e.id) 'auth:'||e.id id,CASE WHEN e.event_type='auth.class_join' THEN 'seat.signed_in' ELSE 'asa.signed_in' END action,i.seat_id,s.display_label student,false by_teacher,
  NULL::uuid project_id,NULL::varchar project_title,e.occurred_at at,1 count,e.principal_id actor
  FROM identities i JOIN seats s ON s.id=i.seat_id JOIN public.product_analytics_events e ON e.principal_id=i.principal_id
  WHERE e.outcome='succeeded' AND e.event_type IN('auth.login','auth.max','auth.class_join') AND e.occurred_at>=i.admitted_at
   AND (e.event_type<>'auth.class_join' OR (e.seat_id=i.seat_id AND NOT EXISTS(
    SELECT 1 FROM class_events c WHERE c.seat_id=i.seat_id AND c.action='seat.signed_in'
     AND abs(extract(epoch FROM c.at-e.occurred_at))<600)))
  ORDER BY e.id,i.seat_id),
 edits AS(
  SELECT DISTINCT ON(e.id) 'edit:'||e.id id,'project.saved' action,s.id seat_id,s.display_label student,
   public.classroom_journal_teacher(e.actor_id,p_class) by_teacher,e.project_id,p.title project_title,e.occurred_at at,1 count,e.actor_id actor
  FROM scoped_edits e JOIN seats s ON s.id=e.seat_id
  JOIN readable_projects p ON p.id=e.project_id
  WHERE(e.actor_id IN(SELECT principal_id FROM identities WHERE seat_id=s.id) OR public.classroom_journal_teacher(e.actor_id,p_class))
   AND NOT EXISTS(SELECT 1 FROM class_events c WHERE c.project_id=e.project_id AND c.actor=e.actor_id AND c.action IN('project.saved','project.updated') AND abs(extract(epoch FROM c.at-e.occurred_at))<600)
  ORDER BY e.id,s.id),
 submissions AS(
  SELECT DISTINCT ON(sub.id) 'submission:'||sub.id id,'submission.created' action,s.id seat_id,s.display_label student,
   public.classroom_journal_teacher(sub.actor,p_class) by_teacher,
   sub.project_id,p.title project_title,sub.submitted_at at,1 count,sub.actor
  FROM scoped_submissions sub JOIN seats s ON s.id=sub.seat_id
  JOIN readable_projects p ON p.id=sub.project_id
  WHERE NOT EXISTS(SELECT 1 FROM class_events c WHERE c.project_id=sub.project_id
   AND c.action IN('project.submitted','assignment.submitted','submission.created') AND abs(extract(epoch FROM c.at-sub.submitted_at))<1)
  ORDER BY sub.id,s.id),
 activations AS(SELECT 'activation:'||o.seat_id id,'seat.activated' action,s.id seat_id,s.display_label student,false by_teacher,
   NULL::uuid project_id,NULL::varchar project_title,o.occurred_at at,1 count,NULL::uuid actor
   FROM public.classroom_activation_observations o JOIN seats s ON s.id=o.seat_id AND s.classroom_id=o.classroom_id AND s.tenant_id=o.tenant_id
   WHERE o.classroom_id=p_class),
 events AS(SELECT * FROM class_events UNION ALL SELECT * FROM auth UNION ALL SELECT * FROM edits UNION ALL SELECT * FROM submissions UNION ALL SELECT * FROM activations),
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
