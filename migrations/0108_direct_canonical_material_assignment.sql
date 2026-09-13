-- LRN-COURSE-01: the existing handout is a route adapter, not an authored root.
-- Canonical direct deliveries pin the same LAV as their ActivityRun.
ALTER TABLE classroom_assignments ADD COLUMN learning_activity_version_id uuid
    REFERENCES learning_activity_versions(id) ON DELETE RESTRICT;
ALTER TABLE classroom_assignments DROP CONSTRAINT classroom_assignments_source_check;
ALTER TABLE classroom_assignments ADD CONSTRAINT classroom_assignments_source_check
    CHECK(num_nonnulls(assignment_id,course_run_id,quiz_version_id,learning_activity_version_id)=1);
CREATE OR REPLACE FUNCTION learning_direct_assignment_activity_list(
    p_actor_principal_id uuid, p_tenant_id uuid, p_classroom_id uuid
)
RETURNS TABLE (
    activity_id uuid, activity_version_id uuid, title varchar,
    instructions varchar, kind varchar, module_key varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT activity.id, version.id, version.title, version.instructions,
           version.canonical_kind, version.module_key
      FROM public.principals principal
      JOIN public.classroom_memberships membership
        ON membership.account_id=principal.account_id
       AND membership.classroom_id=p_classroom_id
       AND membership.member_role IN ('owner','co_teacher')
      JOIN public.classrooms classroom
        ON classroom.tenant_id=membership.tenant_id
       AND classroom.id=membership.classroom_id
       AND classroom.status='active'
      JOIN public.learning_activities activity
        ON activity.tenant_id=classroom.tenant_id
       AND activity.owner_principal_id=p_actor_principal_id
       AND activity.archived_at IS NULL
       AND activity.reusable_authored_content=true
       AND activity.current_published_version_id IS NOT NULL
      JOIN public.learning_activity_versions version
        ON version.tenant_id=activity.tenant_id
       AND version.id=activity.current_published_version_id
       AND version.activity_id=activity.id
       AND version.canonical_contract_version=1
       AND version.canonical_kind='project'
     WHERE principal.id=p_actor_principal_id
       AND principal.kind='account'
       AND classroom.tenant_id=p_tenant_id
       AND NOT EXISTS (
         SELECT 1 FROM public.learning_migration_compatibility_activity_versions compatibility
          WHERE compatibility.learning_activity_version_id=version.id)
     ORDER BY activity.created_at DESC, activity.id;
$$;
CREATE OR REPLACE FUNCTION learning_direct_assignment_create(
    p_actor_principal_id uuid,
    p_tenant_id uuid,
    p_classroom_id uuid,
    p_learning_activity_version_id uuid,
    p_due_at timestamptz,
    p_audience_type varchar,
    p_named_seat_ids uuid[],
    p_request_id varchar
)
RETURNS TABLE (
    result_code varchar, classroom_assignment_id uuid, activity_run_id uuid,
    audience_id uuid, assigned_count integer, reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_source record;
    v_handout uuid;
    v_run record;
    v_audience record;
    v_learner_ids uuid[] := ARRAY[]::uuid[];
BEGIN
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,80}$'
       OR p_audience_type NOT IN ('whole_class','named_learners')
       OR (p_audience_type='whole_class' AND COALESCE(cardinality(p_named_seat_ids),0)<>0)
       OR (p_audience_type='named_learners' AND (
            COALESCE(cardinality(p_named_seat_ids),0)=0
            OR cardinality(p_named_seat_ids)<>(
                SELECT count(DISTINCT seat_id) FROM unnest(p_named_seat_ids) seat_id))) THEN
        RETURN QUERY SELECT 'invalid_request'::varchar,NULL::uuid,NULL::uuid,NULL::uuid,0,false;
        RETURN;
    END IF;

    SELECT classroom.tenant_id, classroom.school_id, membership.user_id,
           activity.source_teacher_assignment_id, activity.owner_principal_id,
           version.id AS version_id
      INTO v_source
      FROM public.principals principal
      JOIN public.classroom_memberships membership
        ON membership.account_id=principal.account_id
       AND membership.classroom_id=p_classroom_id
       AND membership.member_role IN ('owner','co_teacher')
      JOIN public.classrooms classroom
        ON classroom.tenant_id=membership.tenant_id
       AND classroom.id=membership.classroom_id
       AND classroom.status='active'
      JOIN public.learning_activity_versions version
        ON version.id=p_learning_activity_version_id
       AND version.tenant_id=classroom.tenant_id
       AND version.canonical_contract_version=1
       AND version.canonical_kind='project'
      JOIN public.learning_activities activity
        ON activity.tenant_id=version.tenant_id
       AND activity.id=version.activity_id
       AND activity.owner_principal_id=p_actor_principal_id
       AND activity.reusable_authored_content=true
       AND activity.archived_at IS NULL
     WHERE principal.id=p_actor_principal_id
       AND principal.kind='account'
       AND classroom.tenant_id=p_tenant_id
       AND NOT EXISTS (
         SELECT 1 FROM public.learning_migration_compatibility_activity_versions compatibility
          WHERE compatibility.learning_activity_version_id=version.id);
    IF v_source.version_id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,NULL::uuid,NULL::uuid,0,false;
        RETURN;
    END IF;

    -- The established ActivityRun/Audience commands enforce FORCE-RLS through
    -- the transaction-local tenant setting. The actor/classroom/activity join
    -- above proves this tenant before any canonical runtime write is attempted.
    PERFORM set_config('app.tenant_id',p_tenant_id::text,true);

    IF p_audience_type='named_learners' THEN
        IF EXISTS (
            SELECT 1 FROM unnest(p_named_seat_ids) requested(seat_id)
             WHERE NOT EXISTS (
               SELECT 1 FROM public.classroom_student_seats seat
                WHERE seat.id=requested.seat_id
                  AND seat.tenant_id=v_source.tenant_id
                  AND seat.classroom_id=p_classroom_id
                  AND seat.status IN ('issued','active'))
        ) THEN
            RETURN QUERY SELECT 'named_learner_ineligible'::varchar,
                                NULL::uuid,NULL::uuid,NULL::uuid,0,false;
            RETURN;
        END IF;
        PERFORM public.learning_audience_ensure_seat_identity(seat_id)
          FROM unnest(p_named_seat_ids) seat_id;
        SELECT array_agg(DISTINCT link.learner_identity_id ORDER BY link.learner_identity_id)
          INTO v_learner_ids
          FROM unnest(p_named_seat_ids) requested(seat_id)
          JOIN public.learner_identity_links link
            ON link.seat_id=requested.seat_id AND link.status='active';
    END IF;

    -- A request owns one delivery. A deliberate new request creates a new run
    -- even for the same material/class, without changing previous audiences.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_principal_id::text||p_request_id, 1108));
    SELECT run.source_classroom_assignment_id INTO v_handout FROM public.activity_runs run
     WHERE run.tenant_id=v_source.tenant_id AND run.created_by_principal_id=p_actor_principal_id
       AND run.creation_request_id='vsrun:'||p_request_id;
    IF v_handout IS NULL THEN
        INSERT INTO public.classroom_assignments(tenant_id,classroom_id,learning_activity_version_id,
          due_at,created_by)
        VALUES(v_source.tenant_id,p_classroom_id,p_learning_activity_version_id,p_due_at,v_source.user_id)
        RETURNING id INTO v_handout;
    END IF;

    SELECT * INTO v_run FROM public.activity_run_create(
      p_actor_principal_id,v_handout,p_learning_activity_version_id,'direct',
      NULL,NULL,NULL,p_due_at,NULL,NULL,
      (SELECT grading_scheme_version_id FROM public.classroom_grading_schemes WHERE classroom_id=p_classroom_id),
      '{}'::jsonb,'vsrun:'||p_request_id);
    IF v_run.result_code<>'ok' THEN
        RAISE EXCEPTION 'learning direct assignment run failed: %',v_run.result_code;
    END IF;
    SELECT * INTO v_audience FROM public.learning_audience_create(
      p_actor_principal_id,'activity_run',v_run.activity_run_id,p_audience_type,
      CASE WHEN p_audience_type='whole_class' THEN 'dynamic' ELSE 'snapshot' END,
      v_learner_ids,'vsaudience:'||p_request_id);
    IF v_audience.result_code<>'ok' THEN
        RAISE EXCEPTION 'learning direct assignment audience failed: %',v_audience.result_code;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar,v_handout,v_run.activity_run_id,
      v_audience.audience_id,v_audience.created_count+v_audience.independent_count,
      (v_run.reused AND v_audience.reused);
END;
$$;
CREATE OR REPLACE FUNCTION public.classroom_assignment_list(p_account_id uuid, p_classroom_id uuid)
 RETURNS TABLE(id uuid, assignment_id uuid, title character varying, brief character varying, goal character varying, module_key character varying, due_at timestamp with time zone, status character varying, created_at timestamp with time zone, demo_key character varying, sample_image character varying, seat_count integer, started_count integer, submitted_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
    SELECT h.id, t.id, COALESCE(lv.title,t.title), COALESCE(lv.instructions,t.brief), t.goal, COALESCE(lv.module_key,t.module_key), h.due_at, h.status, h.created_at,
           t.demo_key, t.sample_image,
           (SELECT count(*)::integer FROM public.classroom_student_seats s
             WHERE s.tenant_id = h.tenant_id AND s.classroom_id = h.classroom_id
               AND s.status <> 'removed'),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
             WHERE w.assignment_id = h.id),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
             WHERE w.assignment_id = h.id AND w.submitted_at IS NOT NULL)
      FROM public.classroom_assignments h
      LEFT JOIN public.teacher_assignments t ON t.id = h.assignment_id
      LEFT JOIN public.learning_activity_versions lv ON lv.id=h.learning_activity_version_id
     WHERE h.classroom_id = p_classroom_id AND (t.id IS NOT NULL OR lv.id IS NOT NULL)
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships m
            WHERE m.account_id = p_account_id
              AND m.classroom_id = p_classroom_id
              AND m.tenant_id = h.tenant_id
              AND m.member_role IN ('owner', 'co_teacher'))
     ORDER BY (t.demo_key IS NOT NULL), h.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.classroom_assignments_for_seat(p_seat_id uuid)
 RETURNS TABLE(id uuid, title character varying, brief character varying, goal character varying, module_key character varying, due_at timestamp with time zone, status character varying, sample_image character varying, project_id uuid, submitted_at timestamp with time zone, snapshot_revision integer, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
    SELECT h.id, COALESCE(lv.title,t.title), COALESCE(lv.instructions,t.brief), t.goal, COALESCE(lv.module_key,t.module_key), h.due_at, h.status, t.sample_image,
           w.project_id, w.submitted_at, snapshot.source_revision, draft.updated_at
      FROM public.classroom_student_seats s
      JOIN public.classroom_assignments h
        ON h.tenant_id = s.tenant_id AND h.classroom_id = s.classroom_id
      LEFT JOIN public.teacher_assignments t ON t.id = h.assignment_id
      LEFT JOIN public.learning_activity_versions lv ON lv.id=h.learning_activity_version_id
      LEFT JOIN public.classroom_assignment_work w
        ON w.assignment_id = h.id AND w.seat_id = s.id
      LEFT JOIN public.project_drafts draft ON draft.project_id = w.project_id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = w.project_id
     WHERE (t.id IS NOT NULL OR lv.id IS NOT NULL)
       AND s.id = p_seat_id
       AND s.status = 'active'
       AND (h.status = 'open' OR w.project_id IS NOT NULL)
     ORDER BY (w.submitted_at IS NOT NULL), h.created_at;
$function$;

CREATE OR REPLACE FUNCTION public.classroom_assignments_for_account(p_account_id uuid)
 RETURNS TABLE(id uuid, seat_id uuid, classroom_title character varying, title character varying, brief character varying, goal character varying, module_key character varying, due_at timestamp with time zone, status character varying, sample_image character varying, project_id uuid, submitted_at timestamp with time zone, snapshot_revision integer, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
    SELECT work.id, s.id, c.title, work.title, work.brief, work.goal, work.module_key,
           work.due_at, work.status, work.sample_image, work.project_id, work.submitted_at,
           work.snapshot_revision, work.updated_at
      FROM public.classroom_student_seats s
      JOIN public.classrooms c ON c.id = s.classroom_id
      CROSS JOIN LATERAL public.classroom_assignments_for_seat(s.id) work
     WHERE s.account_id = p_account_id
       AND s.status = 'active'
       AND c.status = 'active';
$function$;
