-- Follow-up hardening for CourseRun creation.
--
-- The assignment handout must exist before the versioned lesson row is checked,
-- and a closed run with already-started work must remain readable as a whole.

CREATE OR REPLACE FUNCTION classroom_course_run_assign(
    p_principal_id uuid,
    p_classroom_id uuid,
    p_course_id    uuid,
    p_due_at       timestamptz
)
RETURNS TABLE (
    result_code    varchar,
    run_id         uuid,
    version_number integer,
    reused         boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant       uuid;
    v_user         uuid;
    v_version      record;
    v_existing     uuid;
    v_run          uuid;
    v_section      jsonb;
    v_lesson       jsonb;
    v_handout      uuid;
    v_assignment   jsonb;
BEGIN
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

    SELECT version.id, version.version_number, version.outline,
           version.title, version.summary
      INTO v_version
      FROM public.courses course
      JOIN public.course_versions version ON version.course_id = course.id
     WHERE course.id = p_course_id
       AND course.owner_principal_id = p_principal_id
     ORDER BY version.version_number DESC
     LIMIT 1;
    IF v_version.id IS NULL THEN
        RETURN QUERY SELECT 'course_not_published'::varchar, NULL::uuid, NULL::integer, false;
        RETURN;
    END IF;

    SELECT run.id INTO v_existing
      FROM public.classroom_course_runs run
     WHERE run.classroom_id = p_classroom_id
       AND run.course_version_id = v_version.id
       AND run.status = 'open'
     LIMIT 1;
    IF v_existing IS NOT NULL THEN
        UPDATE public.classroom_course_runs
           SET due_at = p_due_at, updated_at = now()
         WHERE id = v_existing;
        UPDATE public.classroom_assignments
           SET due_at = p_due_at
         WHERE course_run_id = v_existing;
        RETURN QUERY SELECT 'ok'::varchar, v_existing, v_version.version_number, true;
        RETURN;
    END IF;

    INSERT INTO public.classroom_course_runs (
        tenant_id, classroom_id, course_id, course_version_id, title, summary,
        version_number, due_at, assigned_by_principal_id
    ) VALUES (
        v_tenant, p_classroom_id, p_course_id, v_version.id, v_version.title,
        v_version.summary, v_version.version_number, p_due_at, p_principal_id
    ) RETURNING id INTO v_run;

    FOR v_section IN
        SELECT value FROM jsonb_array_elements(v_version.outline -> 'sections')
    LOOP
        FOR v_lesson IN
            SELECT value FROM jsonb_array_elements(v_section -> 'lessons')
        LOOP
            v_assignment := v_lesson -> 'assignment';
            v_handout := NULL;
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
                title, summary, content, kind, estimated_minutes, lesson_position,
                classroom_assignment_id, assignment_title, assignment_goal,
                assignment_brief, module_key, static_sample_image
            ) VALUES (
                v_tenant,
                v_run,
                (v_section ->> 'sourceSectionId')::uuid,
                (v_lesson ->> 'sourceLessonId')::uuid,
                v_section ->> 'title',
                NULLIF(v_section ->> 'summary', ''),
                (v_section ->> 'position')::integer,
                v_lesson ->> 'title',
                NULLIF(v_lesson ->> 'summary', ''),
                NULLIF(v_lesson ->> 'content', ''),
                v_lesson ->> 'kind',
                NULLIF(v_lesson ->> 'estimatedMinutes', '')::integer,
                (v_lesson ->> 'position')::integer,
                v_handout,
                CASE WHEN v_lesson ->> 'kind' = 'assignment'
                     THEN v_assignment ->> 'title' ELSE NULL END,
                CASE WHEN v_lesson ->> 'kind' = 'assignment'
                     THEN NULLIF(v_assignment ->> 'goal', '') ELSE NULL END,
                CASE WHEN v_lesson ->> 'kind' = 'assignment'
                     THEN NULLIF(v_assignment ->> 'brief', '') ELSE NULL END,
                CASE WHEN v_lesson ->> 'kind' = 'assignment'
                     THEN v_assignment ->> 'moduleKey' ELSE NULL END,
                CASE WHEN v_lesson ->> 'kind' = 'assignment'
                     THEN NULLIF(v_assignment ->> 'staticSampleImage', '') ELSE NULL END
            );
        END LOOP;
    END LOOP;

    RETURN QUERY SELECT 'ok'::varchar, v_run, v_version.version_number, false;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_course_runs_for_seat(p_seat_id uuid)
RETURNS TABLE (
    run_id uuid,
    course_id uuid,
    course_version_id uuid,
    version_number integer,
    classroom_title varchar,
    run_title varchar,
    run_summary varchar,
    due_at timestamptz,
    run_status varchar,
    lesson_id uuid,
    source_lesson_id uuid,
    section_title varchar,
    section_summary varchar,
    section_position integer,
    lesson_title varchar,
    lesson_summary varchar,
    lesson_content varchar,
    lesson_kind varchar,
    estimated_minutes integer,
    lesson_position integer,
    classroom_assignment_id uuid,
    assignment_title varchar,
    assignment_goal varchar,
    assignment_brief varchar,
    module_key varchar,
    sample_image varchar,
    project_id uuid,
    submitted_at timestamptz,
    snapshot_revision integer,
    work_updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT run.id, run.course_id, run.course_version_id, run.version_number,
           classroom.title, run.title, run.summary, run.due_at, run.status,
           lesson.id, lesson.source_lesson_id, lesson.section_title,
           lesson.section_summary, lesson.section_position, lesson.title,
           lesson.summary, lesson.content, lesson.kind, lesson.estimated_minutes,
           lesson.lesson_position, lesson.classroom_assignment_id,
           lesson.assignment_title, lesson.assignment_goal, lesson.assignment_brief,
           lesson.module_key,
           CASE WHEN media.version_id IS NOT NULL
                THEN ('/api/class-join/course-runs/' || run.id::text || '/lessons/' ||
                      lesson.source_lesson_id::text || '/sample')::varchar
                ELSE lesson.static_sample_image END,
           work.project_id, work.submitted_at, snapshot.source_revision, draft.updated_at
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
     WHERE seat.id = p_seat_id
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
       )
     ORDER BY run.created_at DESC, lesson.section_position, lesson.source_section_id,
              lesson.lesson_position, lesson.source_lesson_id;
$$;

REVOKE ALL ON FUNCTION classroom_course_run_assign(uuid, uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_course_runs_for_seat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_course_run_assign(uuid, uuid, uuid, timestamptz) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_course_runs_for_seat(uuid) TO asalab_app;
