-- Read-only participant projections. No identity, RLS, or learning writes.
CREATE FUNCTION classroom_participant_helper_classes(p_actor uuid,p_class uuid,p_seat uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'title',title) ORDER BY title,id),'[]'::jsonb)
 FROM (
   SELECT DISTINCT c.id,c.title
   FROM public.classroom_student_seats s
   JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id AND c.status='active'
   JOIN public.classroom_participant_roles role ON role.seat_id=s.id AND role.role='helper'
   WHERE s.status IN('issued','active')
   AND public.classroom_participant_allowed(p_actor,p_class,p_seat)
   AND public.classroom_participant_allowed(p_actor,c.id,s.id)
   AND (s.id=p_seat OR EXISTS (
     SELECT 1 FROM public.classroom_participant_principals(p_seat) target
     JOIN public.principals account ON account.id=target.id AND account.kind='account'
     JOIN public.classroom_participant_principals(s.id) candidate ON candidate.id=account.id
     -- A Seat credential is confined to its own class even if linked.
     WHERE NOT EXISTS(SELECT 1 FROM public.principals viewer WHERE viewer.id=p_actor AND viewer.kind='student_seat')
   ))
 ) classes;
$$;

CREATE FUNCTION classroom_participant_assignments(p_actor uuid,p_class uuid,p_seat uuid,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH scope AS MATERIALIZED (
   SELECT s.* FROM public.classroom_student_seats s
   WHERE s.id=p_seat AND s.classroom_id=p_class
     AND public.classroom_participant_allowed(p_actor,p_class,p_seat)
 ), candidates AS (
   SELECT a.id,a.created_at,COALESCE(v.title,t.title,l.assignment_title,q.title) title,
     CASE WHEN q.id IS NOT NULL THEN 'quiz' ELSE 'project' END kind,
     COALESCE(v.module_key,t.module_key,l.module_key) module_key,a.due_at,
     a.id assignment_id,a.course_run_id,run.id activity_run_id,NULL::timestamptz completed_at
   FROM scope s
   JOIN public.classroom_assignments a ON a.classroom_id=s.classroom_id AND a.tenant_id=s.tenant_id AND a.status='open'
   LEFT JOIN public.activity_runs run ON run.source_classroom_assignment_id=a.id AND run.tenant_id=a.tenant_id
   LEFT JOIN public.learning_activity_versions v ON v.id=COALESCE(run.learning_activity_version_id,a.learning_activity_version_id) AND v.tenant_id=a.tenant_id
   LEFT JOIN public.teacher_assignments t ON t.id=a.assignment_id AND t.tenant_id=a.tenant_id
   LEFT JOIN public.classroom_course_run_lessons l ON l.classroom_assignment_id=a.id AND l.tenant_id=a.tenant_id
   LEFT JOIN public.quiz_versions q ON q.id=a.quiz_version_id AND q.tenant_id=a.tenant_id
   WHERE ((run.id IS NULL AND a.learning_activity_version_id IS NULL) OR (run.lifecycle_status='active' AND EXISTS (
     SELECT 1 FROM public.activity_participations participation
     JOIN public.learner_identity_links link ON link.learner_identity_id=participation.learner_identity_id
       AND link.tenant_id=participation.tenant_id AND link.school_id=participation.school_id
       AND link.seat_id=s.id AND link.link_kind='student_seat' AND link.status='active' AND link.disabled_at IS NULL
     JOIN public.learner_identities learner ON learner.id=link.learner_identity_id AND learner.state='active'
     WHERE participation.activity_run_id=run.id AND participation.tenant_id=a.tenant_id
       AND participation.status IN('assigned','active')
       AND (participation.source_course_enrollment_id IS NULL OR EXISTS (
         SELECT 1 FROM public.course_enrollments enrollment WHERE enrollment.id=participation.source_course_enrollment_id
           AND enrollment.tenant_id=a.tenant_id AND enrollment.school_id=participation.school_id
           AND enrollment.status IN('assigned','active')))
   )))
   AND (a.course_run_id IS NULL OR EXISTS (
     SELECT 1 FROM public.classroom_course_runs course WHERE course.id=a.course_run_id
       AND course.tenant_id=a.tenant_id AND course.classroom_id=p_class AND course.status='open'
       AND public.learning_course_seat_visible(p_seat,course.id)))
   AND (a.course_run_id IS NOT NULL OR public.learning_direct_assignment_seat_visible(p_seat,a.id))
   UNION ALL
   -- Theory has no classroom handout/project: its pinned lesson is the identity.
   SELECT l.id,course.created_at,l.title,'theory',NULL,course.due_at,
     NULL,course.id,NULL,progress.completed_at
   FROM scope s
   JOIN public.classroom_course_runs course ON course.classroom_id=s.classroom_id AND course.tenant_id=s.tenant_id AND course.status='open'
   JOIN public.classroom_course_run_lessons l ON l.run_id=course.id AND l.tenant_id=course.tenant_id AND l.kind='material'
   LEFT JOIN public.classroom_course_lesson_progress progress ON progress.run_id=course.id AND progress.lesson_id=l.id AND progress.seat_id=s.id
   WHERE public.learning_course_seat_visible(p_seat,course.id)
 ), unique_items AS MATERIALIZED (
   SELECT DISTINCT ON(id) * FROM candidates ORDER BY id,created_at
 ), page AS MATERIALIZED (
   SELECT * FROM unique_items ORDER BY created_at DESC,id OFFSET p_offset LIMIT 31
 ), evidence AS MATERIALIZED (
   SELECT DISTINCT ON(e.evidence->>'classroomAssignmentId') e.evidence || jsonb_build_object('projectId',(
     SELECT origin.project_id FROM public.learning_project_origins origin
     WHERE origin.activity_run_id=page.activity_run_id AND origin.school_tenant_id=(e.evidence->>'tenantId')::uuid
       AND origin.learner_identity_id=(e.evidence->>'learnerId')::uuid
       AND EXISTS(SELECT 1 FROM public.project_context_for_principal(p_actor,origin.project_id))
     ORDER BY origin.project_id LIMIT 1
   )) evidence
   FROM public.learning_canonical_evidence_internal(p_class,p_seat,true) e
   JOIN page ON page.assignment_id=(e.evidence->>'classroomAssignmentId')::uuid
   WHERE (e.evidence->>'seatId')::uuid=p_seat
     AND EXISTS(SELECT 1 FROM public.learner_identity_links link
       WHERE link.seat_id=p_seat AND link.link_kind='student_seat'
         AND link.status='active' AND link.disabled_at IS NULL
         AND link.tenant_id=(e.evidence->>'tenantId')::uuid AND link.school_id=(e.evidence->>'schoolId')::uuid
         AND link.learner_identity_id=(e.evidence->>'learnerId')::uuid)
   ORDER BY e.evidence->>'classroomAssignmentId',e.evidence->>'learnerId' NULLS LAST
 ), visible_page AS (SELECT * FROM page ORDER BY created_at DESC,id LIMIT 30)
 SELECT jsonb_build_object('offset',p_offset,'nextOffset',CASE WHEN (SELECT count(*) FROM page)>30 THEN p_offset+30 END,
   'items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
     'id',p.id,'title',p.title,'kind',p.kind,'moduleKey',p.module_key,'dueAt',p.due_at,
     'assignmentId',p.assignment_id,'courseRunId',p.course_run_id,'activityRunId',p.activity_run_id,
     'completedAt',p.completed_at,'evidence',e.evidence
   ) ORDER BY p.created_at DESC,p.id)
   FROM visible_page p LEFT JOIN evidence e ON (e.evidence->>'classroomAssignmentId')::uuid=p.assignment_id),'[]'::jsonb))
 WHERE EXISTS(SELECT 1 FROM scope) AND p_offset BETWEEN 0 AND 100000;
$$;

-- Pin the history display to the actual column scale; self reads use the same
-- canonical learner link as the existing learner journal, never a teacher API.
CREATE FUNCTION classroom_participant_manual_history(p_actor uuid,p_class uuid,p_seat uuid,p_column uuid,p_before integer DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH column_scope AS (
   SELECT col.id,scale.preset FROM public.classroom_journal_columns col
   JOIN public.classroom_journal_scales scale ON scale.id=col.scale_id AND scale.classroom_id=col.classroom_id
   WHERE col.id=p_column AND col.classroom_id=p_class AND public.classroom_participant_allowed(p_actor,p_class,p_seat)
 ), candidates AS MATERIALIZED (
   SELECT r.* FROM public.classroom_journal_revisions r JOIN column_scope col ON col.id=r.column_id
   WHERE r.classroom_id=p_class AND r.seat_id=p_seat AND (p_before IS NULL OR r.revision<p_before)
     AND EXISTS(SELECT 1 FROM public.learner_identity_links link WHERE link.seat_id=p_seat
       AND link.learner_identity_id=r.learner_identity_id AND link.tenant_id=r.tenant_id
       AND link.link_kind='student_seat' AND link.status='active' AND link.disabled_at IS NULL)
   ORDER BY r.revision DESC LIMIT 21
 ), page AS (SELECT * FROM candidates ORDER BY revision DESC LIMIT 20)
 SELECT jsonb_build_object('preset',col.preset,'items',COALESCE((
   SELECT jsonb_agg(public.classroom_journal_grade_json(r::public.classroom_journal_revisions,profile.display_name::text) ORDER BY r.revision DESC)
   FROM page r LEFT JOIN public.principals author ON author.id=r.author_id LEFT JOIN public.profiles profile ON profile.account_id=author.account_id
 ),'[]'::jsonb),'nextBeforeRevision',CASE WHEN (SELECT count(*) FROM candidates)>20 THEN (SELECT min(revision) FROM page) END)
 FROM column_scope col WHERE p_before IS NULL OR p_before BETWEEN 1 AND 999999999;
$$;

REVOKE ALL ON FUNCTION classroom_participant_helper_classes(uuid,uuid,uuid),
 classroom_participant_assignments(uuid,uuid,uuid,integer),classroom_participant_manual_history(uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_participant_helper_classes(uuid,uuid,uuid),
 classroom_participant_assignments(uuid,uuid,uuid,integer),classroom_participant_manual_history(uuid,uuid,uuid,uuid,integer) TO asalab_app;

-- Own Account/Seat grades retain the same exact-class and link checks.
CREATE FUNCTION classroom_participant_profile_grades(p_actor uuid,p_class uuid,p_seat uuid,p_offset integer DEFAULT 0,p_result_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH columns AS MATERIALIZED(SELECT col.*,scale.preset FROM public.classroom_journal_columns col JOIN public.classroom_journal_scales scale ON scale.id=col.scale_id
 WHERE col.classroom_id=p_class AND EXISTS(SELECT 1 FROM public.classroom_journal_revisions r JOIN public.learner_identity_links l ON l.learner_identity_id=r.learner_identity_id AND l.tenant_id=r.tenant_id AND l.link_kind='student_seat' AND l.seat_id=p_seat AND l.status='active' AND l.disabled_at IS NULL WHERE r.column_id=col.id AND r.seat_id=p_seat)
 ORDER BY col.lesson_date DESC,col.id OFFSET p_offset LIMIT 31),
 page AS(SELECT * FROM columns ORDER BY lesson_date DESC,id LIMIT 30),
 latest AS(SELECT DISTINCT ON(r.column_id) r.* FROM public.classroom_journal_revisions r JOIN page ON page.id=r.column_id
 WHERE r.seat_id=p_seat AND EXISTS(SELECT 1 FROM public.learner_identity_links l WHERE l.seat_id=p_seat AND l.status='active' AND l.disabled_at IS NULL AND l.learner_identity_id=r.learner_identity_id AND l.tenant_id=r.tenant_id AND l.link_kind='student_seat')
 ORDER BY r.column_id,r.revision DESC),
 results AS MATERIALIZED(SELECT result.* FROM public.learning_results_for_seat(p_seat) result ORDER BY result.published_at DESC,result.assignment_id OFFSET p_result_offset LIMIT 31),
 result_page AS(SELECT * FROM results ORDER BY published_at DESC,assignment_id LIMIT 30)
 SELECT jsonb_build_object('journal',jsonb_build_object('students','[]'::jsonb,'offset',p_offset,'nextOffset',CASE WHEN (SELECT count(*) FROM columns)>30 THEN p_offset+30 END,
 'columns',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'date',lesson_date,'category',category,'preset',preset) ORDER BY lesson_date DESC,id) FROM page),'[]'::jsonb),
 'grades',COALESCE((SELECT jsonb_agg(public.classroom_journal_grade_json(r::public.classroom_journal_revisions,profile.display_name::text) ORDER BY col.lesson_date DESC,col.id) FROM latest r JOIN page col ON col.id=r.column_id
 LEFT JOIN public.principals author ON author.id=r.author_id LEFT JOIN public.profiles profile ON profile.account_id=author.account_id),'[]'::jsonb)),
 'results',COALESCE((SELECT jsonb_agg(to_jsonb(result_page) ORDER BY published_at DESC,assignment_id) FROM result_page),'[]'::jsonb),
 'resultOffset',p_result_offset,'nextResultOffset',CASE WHEN (SELECT count(*) FROM results)>30 THEN p_result_offset+30 END)
 WHERE public.classroom_participant_allowed(p_actor,p_class,p_seat)
 AND p_offset BETWEEN 0 AND 100000 AND p_result_offset BETWEEN 0 AND 100000;
$$;


CREATE FUNCTION classroom_participant_profile_result_history(p_actor uuid,p_class uuid,p_seat uuid,p_assignment uuid,p_offset integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH revisions AS(SELECT r.id,r.revision_number revision,r.raw_points,r.max_points,r.feedback,r.correction_reason reason,r.published_at,
 a.attempt_number,COALESCE(profile.display_name,'Преподаватель') author
 FROM public.learning_attempts a JOIN public.assessment_results r ON r.attempt_id=a.id
 LEFT JOIN public.principals reviewer ON reviewer.id=r.evaluator_principal_id LEFT JOIN public.profiles profile ON profile.account_id=reviewer.account_id
 WHERE a.classroom_id=p_class AND a.classroom_assignment_id=p_assignment AND a.seat_id=p_seat
 AND (a.learner_identity_id IS NULL OR EXISTS(SELECT 1 FROM public.learner_identity_links l WHERE l.seat_id=p_seat AND l.status='active' AND l.disabled_at IS NULL AND l.link_kind='student_seat' AND l.tenant_id=a.tenant_id AND l.learner_identity_id=a.learner_identity_id))),
 page AS(SELECT * FROM revisions ORDER BY published_at DESC,id OFFSET p_offset LIMIT 30)
 SELECT jsonb_build_object('items',COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY published_at DESC,id) FROM page),'[]'::jsonb),
 'hasMore',(SELECT count(*) FROM revisions)>p_offset+30,'offset',p_offset)
 WHERE public.classroom_participant_allowed(p_actor,p_class,p_seat)
 AND public.learning_direct_assignment_seat_visible(p_seat,p_assignment) AND p_offset BETWEEN 0 AND 100000;
$$;

REVOKE ALL ON FUNCTION classroom_participant_profile_grades(uuid,uuid,uuid,integer,integer),
 classroom_participant_profile_result_history(uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_participant_profile_grades(uuid,uuid,uuid,integer,integer),
 classroom_participant_profile_result_history(uuid,uuid,uuid,uuid,integer) TO asalab_app;
