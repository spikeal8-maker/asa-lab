-- LRN-COURSE-01: materialize pinned course blocks through existing runtime.
ALTER TABLE classroom_course_runs ADD COLUMN creation_request_id varchar(80),
    ADD COLUMN creation_request_digest varchar(64);
CREATE UNIQUE INDEX classroom_course_runs_request_idx
    ON classroom_course_runs(assigned_by_principal_id,creation_request_id)
    WHERE creation_request_id IS NOT NULL;
DROP INDEX classroom_course_runs_open_version_idx;
CREATE UNIQUE INDEX classroom_course_runs_open_version_idx
    ON classroom_course_runs(classroom_id,course_version_id)
    WHERE status='open' AND creation_request_id IS NULL;

CREATE OR REPLACE FUNCTION learning_course_enrollment_children()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_run record; v_result record;
BEGIN
    PERFORM set_config('app.tenant_id',NEW.tenant_id::text,true);
    IF TG_OP='INSERT' THEN
      FOR v_run IN SELECT id FROM public.activity_runs WHERE source_course_run_id=NEW.course_run_id
      LOOP
        SELECT * INTO v_result FROM public.activity_participation_assign(
          NEW.assigned_by_principal_id,v_run.id,NEW.learner_identity_id,NEW.id);
        IF v_result.result_code<>'ok' THEN RAISE EXCEPTION 'course participation: %',v_result.result_code; END IF;
      END LOOP;
    ELSIF NEW.status='withdrawn' AND OLD.status<>'withdrawn' THEN
      -- Independently granted participations (no parent provenance) are not withdrawn.
      FOR v_run IN SELECT id FROM public.activity_participations
        WHERE source_course_enrollment_id=NEW.id AND status<>'withdrawn'
      LOOP
        SELECT * INTO v_result FROM public.activity_participation_withdraw(
          NEW.withdrawn_by_principal_id,v_run.id);
        IF v_result.result_code<>'ok' THEN RAISE EXCEPTION 'course withdrawal: %',v_result.result_code; END IF;
      END LOOP;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER course_enrollment_children AFTER INSERT OR UPDATE ON course_enrollments
FOR EACH ROW EXECUTE FUNCTION learning_course_enrollment_children();
REVOKE ALL ON FUNCTION learning_course_enrollment_children() FROM PUBLIC;

CREATE OR REPLACE FUNCTION learning_course_seat_visible(p_seat_id uuid,p_run_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.classroom_course_runs run
    JOIN public.classroom_student_seats seat ON seat.classroom_id=run.classroom_id AND seat.tenant_id=run.tenant_id
    WHERE run.id=p_run_id AND seat.id=p_seat_id AND seat.status='active'
    AND (run.creation_request_id IS NULL OR EXISTS(
      SELECT 1 FROM public.course_enrollments enrollment
      JOIN public.learner_identity_links link ON link.learner_identity_id=enrollment.learner_identity_id
       AND link.tenant_id=enrollment.tenant_id AND link.school_id=enrollment.school_id
       AND link.status='active' AND link.seat_id=seat.id
      WHERE enrollment.course_run_id=run.id AND enrollment.status IN ('assigned','active'))));
$$;
REVOKE ALL ON FUNCTION learning_course_seat_visible(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_course_seat_visible(uuid,uuid) TO asalab_app;

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

CREATE OR REPLACE FUNCTION classroom_course_runs_for_seat_v2(p_seat_id uuid)
RETURNS TABLE (
    run_id uuid, course_id uuid, course_version_id uuid, version_number integer,
    classroom_title varchar, run_title varchar, run_summary varchar,
    due_at timestamptz, run_status varchar, lesson_id uuid, source_lesson_id uuid,
    section_title varchar, section_summary varchar, section_position integer,
    lesson_title varchar, lesson_summary varchar, lesson_content varchar,
    lesson_blocks jsonb, lesson_kind varchar, estimated_minutes integer,
    lesson_position integer, classroom_assignment_id uuid, assignment_title varchar,
    assignment_goal varchar, assignment_brief varchar, module_key varchar,
    sample_image varchar, project_id uuid, submitted_at timestamptz,
    snapshot_revision integer, work_updated_at timestamptz, completed_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT run.id, run.course_id, run.course_version_id, run.version_number,
           classroom.title, run.title, run.summary, run.due_at, run.status,
           lesson.id, lesson.source_lesson_id, lesson.section_title,
           lesson.section_summary, lesson.section_position, lesson.title,
           lesson.summary, lesson.content, lesson.blocks, lesson.kind,
           lesson.estimated_minutes, lesson.lesson_position,
           lesson.classroom_assignment_id, lesson.assignment_title,
           lesson.assignment_goal, lesson.assignment_brief, lesson.module_key,
           CASE WHEN media.version_id IS NOT NULL
                THEN ('/api/class-join/course-runs/' || run.id::text || '/lessons/' ||
                      lesson.source_lesson_id::text || '/sample')::varchar
                ELSE lesson.static_sample_image END,
           work.project_id, work.submitted_at, snapshot.source_revision, draft.updated_at,
           progress.completed_at
      FROM public.classroom_student_seats seat
      JOIN public.classrooms classroom ON classroom.id = seat.classroom_id
      JOIN public.classroom_course_runs run
        ON run.tenant_id = seat.tenant_id AND run.classroom_id = seat.classroom_id
      JOIN public.classroom_course_run_lessons lesson ON lesson.run_id = run.id
      LEFT JOIN public.course_version_media media
        ON media.version_id = run.course_version_id
       AND media.source_lesson_id = lesson.source_lesson_id
      LEFT JOIN public.classroom_assignment_work work
        ON work.assignment_id = lesson.classroom_assignment_id AND work.seat_id = seat.id
      LEFT JOIN public.project_drafts draft ON draft.project_id = work.project_id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = work.project_id
      LEFT JOIN public.classroom_course_lesson_progress progress
        ON progress.run_id = run.id AND progress.lesson_id = lesson.id
       AND progress.seat_id = seat.id
     WHERE seat.id = p_seat_id
       AND public.learning_course_seat_visible(seat.id,run.id)
       AND seat.status = 'active'
       AND (
           run.status = 'open'
           OR EXISTS (
               SELECT 1
                 FROM public.classroom_course_run_lessons started_lesson
                 JOIN public.classroom_assignment_work started_work
                   ON started_work.assignment_id = started_lesson.classroom_assignment_id
                WHERE started_lesson.run_id = run.id
                  AND started_work.seat_id = seat.id
                  AND started_work.project_id IS NOT NULL
           )
           OR EXISTS (
               SELECT 1 FROM public.classroom_course_lesson_progress started_progress
                WHERE started_progress.run_id = run.id
                  AND started_progress.seat_id = seat.id
           )
       )
     ORDER BY run.created_at DESC, lesson.section_position, lesson.source_section_id,
              lesson.lesson_position, lesson.source_lesson_id;
$$;
REVOKE ALL ON FUNCTION classroom_course_run_assign_v3(uuid,uuid,uuid,timestamptz,integer,varchar,uuid[],varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_course_run_assign_v3(uuid,uuid,uuid,timestamptz,integer,varchar,uuid[],varchar) TO asalab_app;
