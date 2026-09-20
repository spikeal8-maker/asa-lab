-- E1-FIX-11D3b: materialize frozen Course Activity blocks into compatibility
-- handouts plus block-aware ActivityRuns while preserving legacy lesson-level runtime.

CREATE OR REPLACE FUNCTION classroom_course_run_assign_v3(
    p_principal_id uuid,
    p_classroom_id uuid,
    p_course_id    uuid,
    p_due_at       timestamptz,
    p_version_number integer, p_audience_type varchar, p_named_seat_ids uuid[], p_request_id varchar
)
RETURNS TABLE (
    result_code varchar,
    run_id uuid,
    version_number integer,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_block jsonb;
    v_block_handout uuid;
    v_tenant uuid;
    v_user uuid;
    v_version record;
    v_existing uuid;
    v_run uuid;
    v_section jsonb;
    v_lesson jsonb;
    v_handout uuid;
    v_assignment jsonb;
    v_blocks jsonb;
    v_child uuid;
    v_activity record;
    v_audience record;
    v_learner_ids uuid[] := ARRAY[]::uuid[];
    v_digest text;
BEGIN
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,80}$'
       OR p_audience_type NOT IN ('whole_class','named_learners')
       OR (p_audience_type='whole_class' AND COALESCE(cardinality(p_named_seat_ids),0)<>0)
       OR (p_audience_type='named_learners' AND (COALESCE(cardinality(p_named_seat_ids),0)=0
         OR cardinality(p_named_seat_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_named_seat_ids) id)))
    THEN RETURN QUERY SELECT 'invalid_request'::varchar,NULL::uuid,NULL::integer,false; RETURN; END IF;
    SELECT membership.tenant_id, membership.user_id
      INTO v_tenant, v_user
      FROM public.principals principal
      JOIN public.classroom_memberships membership
        ON membership.account_id = principal.account_id
      JOIN public.classrooms classroom
        ON classroom.tenant_id = membership.tenant_id
       AND classroom.id = membership.classroom_id
     WHERE principal.id = p_principal_id
       AND membership.classroom_id = p_classroom_id
       AND membership.member_role IN ('owner', 'co_teacher')
       AND classroom.status = 'active';
    IF v_tenant IS NULL THEN
        RETURN QUERY SELECT 'classroom_not_found'::varchar, NULL::uuid, NULL::integer, false;
        RETURN;
    END IF;

    SELECT version.id, version.version_number, version.outline, version.title, version.summary
      INTO v_version
      FROM public.courses course
      JOIN public.course_versions version ON version.course_id = course.id
     WHERE course.id = p_course_id AND course.owner_principal_id = p_principal_id
       AND version.version_number=p_version_number
     ORDER BY version.version_number DESC LIMIT 1;
    IF v_version.id IS NULL THEN
        RETURN QUERY SELECT 'course_not_published'::varchar, NULL::uuid, NULL::integer, false;
        RETURN;
    END IF;

    PERFORM set_config('app.tenant_id',v_tenant::text,true);
    PERFORM pg_advisory_xact_lock(hashtextextended(p_principal_id::text||p_request_id,1109));
    v_digest:=public.learning_activity_snapshot_digest(jsonb_build_object(
      'classroom',p_classroom_id,'course',p_course_id,'version',v_version.id,'dueAt',p_due_at,
      'audience',p_audience_type,'seats',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb)
                                        FROM unnest(p_named_seat_ids) id)));
    SELECT run.id INTO v_existing FROM public.classroom_course_runs run
     WHERE run.assigned_by_principal_id=p_principal_id AND run.creation_request_id=p_request_id;
    IF v_existing IS NOT NULL THEN
      IF NOT EXISTS(SELECT 1 FROM public.classroom_course_runs WHERE id=v_existing AND creation_request_digest=v_digest) THEN
        RETURN QUERY SELECT 'idempotency_conflict'::varchar,NULL::uuid,NULL::integer,false; RETURN;
      END IF;
      RETURN QUERY SELECT 'ok'::varchar,v_existing,v_version.version_number,true; RETURN;
    END IF;
    IF EXISTS(SELECT 1 FROM unnest(p_named_seat_ids) requested(id) WHERE NOT EXISTS(
      SELECT 1 FROM public.classroom_student_seats seat WHERE seat.id=requested.id
       AND seat.classroom_id=p_classroom_id AND seat.tenant_id=v_tenant AND seat.status IN ('issued','active')))
    THEN RETURN QUERY SELECT 'audience_forbidden'::varchar,NULL::uuid,NULL::integer,false; RETURN; END IF;
    -- No invented compatibility ActivityVersion and no cross-tenant source copy.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_version.outline->'sections') section
      CROSS JOIN LATERAL jsonb_array_elements(section->'lessons') lesson
      WHERE lesson->>'kind'='assignment' AND NOT EXISTS (
        SELECT 1 FROM public.learning_activity_versions version
        JOIN public.learning_activities activity ON activity.id=version.activity_id
        WHERE version.id=(lesson->>'learningActivityVersionId')::uuid AND version.tenant_id=v_tenant
          AND version.canonical_contract_version=1 AND version.canonical_kind='project'
          AND activity.reusable_authored_content AND activity.owner_principal_id=p_principal_id))
    THEN RETURN QUERY SELECT 'canonical_material_required'::varchar,NULL::uuid,NULL::integer,false; RETURN; END IF;

    INSERT INTO public.classroom_course_runs (
        tenant_id, classroom_id, course_id, course_version_id, title, summary,
        version_number, due_at, assigned_by_principal_id, creation_request_id, creation_request_digest
    ) VALUES (
        v_tenant, p_classroom_id, p_course_id, v_version.id, v_version.title,
        v_version.summary, v_version.version_number, p_due_at, p_principal_id,p_request_id,v_digest
    ) RETURNING id INTO v_run;

    FOR v_section IN SELECT value FROM jsonb_array_elements(v_version.outline -> 'sections')
    LOOP
        FOR v_lesson IN SELECT value FROM jsonb_array_elements(v_section -> 'lessons')
        LOOP
            v_assignment := v_lesson -> 'assignment';
            v_handout := NULL;
            v_blocks := CASE
                WHEN jsonb_typeof(v_lesson -> 'blocks') = 'array'
                    THEN v_lesson -> 'blocks'
                WHEN NULLIF(trim(v_lesson ->> 'content'), '') IS NOT NULL
                    THEN jsonb_build_array(jsonb_build_object(
                        'id', 'legacy-' || replace(v_lesson ->> 'sourceLessonId', '-', ''),
                        'type', 'paragraph',
                        'text', v_lesson ->> 'content'
                    ))
                ELSE '[]'::jsonb
            END;
            IF NOT public.course_lesson_blocks_valid(v_blocks) THEN v_blocks := '[]'::jsonb; END IF;

            IF v_lesson ->> 'kind' = 'assignment' THEN
                INSERT INTO public.classroom_assignments (
                    tenant_id, classroom_id, assignment_id, due_at, status,
                    created_by, course_run_id
                ) VALUES (
                    v_tenant, p_classroom_id, NULL, p_due_at, 'open', v_user, v_run
                ) RETURNING id INTO v_handout;
            END IF;

            INSERT INTO public.classroom_course_run_lessons (
                tenant_id, run_id, source_section_id, source_lesson_id,
                section_title, section_summary, section_position,
                title, summary, content, blocks, kind, estimated_minutes, lesson_position,
                classroom_assignment_id, assignment_title, assignment_goal,
                assignment_brief, module_key, static_sample_image
            ) VALUES (
                v_tenant, v_run,
                (v_section ->> 'sourceSectionId')::uuid,
                (v_lesson ->> 'sourceLessonId')::uuid,
                v_section ->> 'title', NULLIF(v_section ->> 'summary', ''),
                (v_section ->> 'position')::integer,
                v_lesson ->> 'title', NULLIF(v_lesson ->> 'summary', ''),
                NULLIF(v_lesson ->> 'content', ''), v_blocks,
                v_lesson ->> 'kind', NULLIF(v_lesson ->> 'estimatedMinutes', '')::integer,
                (v_lesson ->> 'position')::integer, v_handout,
                CASE WHEN v_lesson ->> 'kind' = 'assignment' THEN v_assignment ->> 'title' END,
                CASE WHEN v_lesson ->> 'kind' = 'assignment'
                     THEN NULLIF(v_assignment ->> 'goal', '') END,
                CASE WHEN v_lesson ->> 'kind' = 'assignment'
                     THEN NULLIF(v_assignment ->> 'brief', '') END,
                CASE WHEN v_lesson ->> 'kind' = 'assignment' THEN v_assignment ->> 'moduleKey' END,
                CASE WHEN v_lesson ->> 'kind' = 'assignment'
                     THEN NULLIF(v_assignment ->> 'staticSampleImage', '') END
            ) RETURNING id INTO v_child;
            IF v_handout IS NOT NULL THEN
                SELECT * INTO v_activity FROM public.activity_run_create(
                  p_principal_id,v_handout,(v_lesson->>'learningActivityVersionId')::uuid,
                  'course',v_run,v_child,NULL,p_due_at,NULL,NULL,
                  (SELECT grading_scheme_version_id FROM public.classroom_grading_schemes WHERE classroom_id=p_classroom_id),'{}'::jsonb,
                  'course:'||v_run::text||':'||v_child::text);
                IF v_activity.result_code<>'ok' THEN RAISE EXCEPTION 'course activity: %',v_activity.result_code; END IF;
            END IF;

            FOR v_block IN
                SELECT value
                  FROM jsonb_array_elements(v_blocks)
                 WHERE value ->> 'type' = 'activity'
            LOOP
                INSERT INTO public.classroom_assignments (
                    tenant_id, classroom_id, assignment_id, due_at, status,
                    created_by, course_run_id
                ) VALUES (
                    v_tenant, p_classroom_id, NULL, p_due_at, 'open', v_user, v_run
                ) RETURNING id INTO v_block_handout;

                SELECT * INTO v_activity FROM public.activity_run_create(
                  p_principal_id,v_block_handout,(v_block->>'learningActivityVersionId')::uuid,
                  'course',v_run,v_child,NULL,p_due_at,NULL,NULL,
                  (SELECT grading_scheme_version_id FROM public.classroom_grading_schemes WHERE classroom_id=p_classroom_id),'{}'::jsonb,
                  'course-block:'||md5(v_run::text||':'||v_child::text||':'||(v_block->>'id')),
                  v_block->>'id');
                IF v_activity.result_code<>'ok' THEN
                    RAISE EXCEPTION 'course block activity: %',v_activity.result_code;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
    IF p_audience_type='named_learners' THEN
        PERFORM public.learning_audience_ensure_seat_identity(seat_id) FROM unnest(p_named_seat_ids) seat_id;
        SELECT array_agg(DISTINCT link.learner_identity_id ORDER BY link.learner_identity_id)
          INTO v_learner_ids FROM public.learner_identity_links link
          WHERE link.seat_id=ANY(p_named_seat_ids) AND link.status='active';
    END IF;
    SELECT * INTO v_audience FROM public.learning_audience_create(p_principal_id,'course_run',v_run,
      p_audience_type,CASE WHEN p_audience_type='whole_class' THEN 'dynamic' ELSE 'snapshot' END,
      v_learner_ids,'course-audience:'||p_request_id);
    IF v_audience.result_code<>'ok' THEN RAISE EXCEPTION 'course audience: %',v_audience.result_code; END IF;
    RETURN QUERY SELECT 'ok'::varchar, v_run, v_version.version_number, false;
END;
$$;

REVOKE ALL ON FUNCTION public.classroom_course_run_assign_v3(
    uuid,uuid,uuid,timestamptz,integer,varchar,uuid[],varchar
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_course_run_assign_v3(
    uuid,uuid,uuid,timestamptz,integer,varchar,uuid[],varchar
) TO asalab_app;