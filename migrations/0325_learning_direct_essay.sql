-- Direct classroom handouts use the existing canonical essay response runtime.
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
       AND (version.canonical_kind='project' OR (version.canonical_kind IN ('file','essay') AND version.module_key IS NULL) OR (version.canonical_kind='quiz' AND version.module_key IS NULL AND version.quiz_version_id IS NOT NULL))
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
       AND (version.canonical_kind='project' OR (version.canonical_kind IN ('file','essay') AND version.module_key IS NULL) OR (version.canonical_kind='quiz' AND version.module_key IS NULL AND version.quiz_version_id IS NOT NULL))
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

CREATE FUNCTION public.learning_essay_assignment_view(p_actor uuid,p_assignment uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE run_id uuid; version_id uuid; run_count integer; response jsonb;
BEGIN
  SELECT count(*),(array_agg(run.id))[1],(array_agg(version.id))[1]
    INTO run_count,run_id,version_id
  FROM public.activity_runs run
  JOIN public.learning_activity_versions version ON version.tenant_id=run.tenant_id
    AND version.id=run.learning_activity_version_id AND version.canonical_kind='essay'
    AND version.module_key IS NULL
  WHERE run.source_kind='direct' AND run.source_classroom_assignment_id=p_assignment;
  IF run_count=0 THEN RETURN NULL; END IF;
  IF run_count<>1 THEN RETURN '{}'::jsonb; END IF;
  response:=public.learning_essay_attempt_read(p_actor,run_id);
  IF response->>'resultCode' IS DISTINCT FROM 'ok' THEN RETURN '{}'::jsonb; END IF;
  RETURN jsonb_build_object('activityRunId',run_id,'activityVersionId',version_id,
    'submittedAt',response#>'{attempt,submittedAt}');
END;
$$;
REVOKE ALL ON FUNCTION public.learning_essay_assignment_view(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_essay_assignment_view(uuid,uuid) TO asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_assignments_for_seat(p_seat_id uuid)
 RETURNS TABLE(
    id uuid,
    title character varying,
    brief character varying,
    goal character varying,
    module_key character varying,
    due_at timestamp with time zone,
    status character varying,
    sample_image character varying,
    project_id uuid,
    submitted_at timestamp with time zone,
    snapshot_revision integer,
    updated_at timestamp with time zone
 )
 LANGUAGE sql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
    SELECT h.id,
           COALESCE(lv.title,t.title),
           COALESCE(lv.instructions,t.brief),
           CASE
             WHEN lv.goal_snapshot_present THEN
               CASE
                 WHEN w.project_id IS NOT NULL THEN lv.goal
                 WHEN EXISTS (
                   SELECT 1
                     FROM public.activity_runs runtime
                     JOIN public.classrooms classroom
                       ON classroom.tenant_id = runtime.tenant_id
                      AND classroom.id = runtime.classroom_id
                      AND classroom.status = 'active'
                     JOIN public.learner_identity_links link
                       ON link.tenant_id = runtime.tenant_id
                      AND link.school_id = runtime.school_id
                      AND link.seat_id = s.id
                      AND link.link_kind = 'student_seat'
                      AND link.status = 'active'
                     JOIN public.activity_participations participation
                       ON participation.tenant_id = runtime.tenant_id
                      AND participation.school_id = runtime.school_id
                      AND participation.activity_run_id = runtime.id
                      AND participation.learner_identity_id = link.learner_identity_id
                    WHERE runtime.tenant_id = h.tenant_id
                      AND runtime.source_classroom_assignment_id = h.id
                      AND runtime.learning_activity_version_id = lv.id
                      AND runtime.lifecycle_status = 'active'
                      AND h.status = 'open'
                      AND participation.status IN ('assigned', 'active')
                      AND (
                        (runtime.source_kind = 'direct'
                         AND public.learning_direct_assignment_seat_visible(s.id, h.id))
                        OR (runtime.source_kind = 'course'
                            AND public.learning_course_seat_visible(s.id, runtime.source_course_run_id)
                            AND EXISTS (
                              SELECT 1 FROM public.classroom_course_runs course
                               WHERE course.id = runtime.source_course_run_id
                                 AND course.tenant_id = runtime.tenant_id
                                 AND course.status = 'open'
                            )
                            AND (participation.source_course_enrollment_id IS NULL OR EXISTS (
                              SELECT 1 FROM public.course_enrollments enrollment
                               WHERE enrollment.id = participation.source_course_enrollment_id
                                 AND enrollment.tenant_id = runtime.tenant_id
                                 AND enrollment.school_id = runtime.school_id
                                 AND enrollment.status IN ('assigned', 'active')
                            )))
                      )
                      AND COALESCE((
                        public.learning_effective_conditions_internal(
                          runtime.id, participation.id
                        ) #>> '{values,opensAt}'
                      )::timestamptz, '-infinity'::timestamptz) <= now()
                 ) THEN lv.goal
                 ELSE NULL
               END
             ELSE t.goal
           END,
           COALESCE(lv.module_key,t.module_key),
           h.due_at,
           h.status,
           CASE
             WHEN h.learning_activity_version_id IS NOT NULL THEN
               CASE WHEN EXISTS (
                   SELECT 1
                     FROM public.learning_activity_version_media media
                    WHERE media.tenant_id = h.tenant_id
                      AND media.activity_version_id = h.learning_activity_version_id
                      AND media.role = 'sample'
               ) THEN (
                   '/api/assignments/activity-versions/'
                   || h.learning_activity_version_id::text
                   || '/sample'
               )::varchar ELSE NULL::varchar END
             ELSE t.sample_image
           END,
           w.project_id,
           w.submitted_at,
           snapshot.source_revision,
           draft.updated_at
      FROM public.classroom_student_seats s
      JOIN public.classroom_assignments h
        ON h.tenant_id = s.tenant_id AND h.classroom_id = s.classroom_id
      LEFT JOIN public.teacher_assignments t ON t.id = h.assignment_id
      LEFT JOIN public.learning_activity_versions lv ON lv.id = h.learning_activity_version_id
      LEFT JOIN public.classroom_assignment_work w
        ON w.assignment_id = h.id AND w.seat_id = s.id
      LEFT JOIN public.project_drafts draft ON draft.project_id = w.project_id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = w.project_id
     WHERE (t.id IS NOT NULL OR lv.id IS NOT NULL)
       AND s.id = p_seat_id
       AND s.status = 'active'
       AND (h.status = 'open' OR w.project_id IS NOT NULL OR
         CASE WHEN lv.canonical_kind='file' THEN
           public.learning_file_assignment_view(public.principal_for_seat(s.id),h.id) ? 'activityRunId'
         WHEN lv.canonical_kind='essay' THEN
           public.learning_essay_assignment_view(public.principal_for_seat(s.id),h.id) ->> 'submittedAt' IS NOT NULL
         ELSE false END OR EXISTS (
           SELECT 1 FROM public.learning_project_origins origin
           JOIN public.activity_runs run
             ON run.id = origin.activity_run_id
            AND run.tenant_id = origin.school_tenant_id
            AND run.source_kind = 'direct'
            AND run.source_classroom_assignment_id = h.id
           JOIN public.learner_identity_links link
             ON link.tenant_id = origin.school_tenant_id
            AND link.school_id = origin.school_id
            AND link.learner_identity_id = origin.learner_identity_id
            AND link.link_kind = 'student_seat'
            AND link.seat_id = s.id
            AND link.status = 'active'
          WHERE origin.school_tenant_id = h.tenant_id
            AND run.classroom_id = s.classroom_id
       ))
     ORDER BY (w.submitted_at IS NOT NULL), h.created_at;
$function$;
