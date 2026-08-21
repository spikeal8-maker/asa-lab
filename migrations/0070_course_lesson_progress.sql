-- Learner progress for material lessons in a frozen classroom CourseRun.
-- Assignment completion continues to come from the existing immutable
-- classroom submission flow; this table records only explicit reading
-- completion and therefore never duplicates assignment state.

CREATE TABLE IF NOT EXISTS classroom_course_lesson_progress (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants(id),
    run_id        uuid NOT NULL,
    lesson_id     uuid NOT NULL REFERENCES classroom_course_run_lessons(id) ON DELETE CASCADE,
    seat_id       uuid NOT NULL REFERENCES classroom_student_seats(id) ON DELETE CASCADE,
    completed_at  timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, lesson_id, seat_id),
    FOREIGN KEY (tenant_id, run_id)
        REFERENCES classroom_course_runs(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS classroom_course_lesson_progress_seat_idx
    ON classroom_course_lesson_progress (seat_id, run_id, completed_at DESC);

REVOKE ALL ON classroom_course_lesson_progress FROM PUBLIC;
REVOKE ALL ON classroom_course_lesson_progress FROM asalab_app;

ALTER TABLE classroom_course_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_course_lesson_progress FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS classroom_course_lesson_progress_tenant
    ON classroom_course_lesson_progress;
CREATE POLICY classroom_course_lesson_progress_tenant
    ON classroom_course_lesson_progress
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION classroom_course_material_progress_set(
    p_seat_id    uuid,
    p_run_id     uuid,
    p_lesson_id  uuid,
    p_completed  boolean
)
RETURNS TABLE (result_code varchar, completed_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_status varchar;
    v_completed_at timestamptz;
BEGIN
    SELECT run.tenant_id, run.status
      INTO v_tenant, v_status
      FROM public.classroom_student_seats seat
      JOIN public.classroom_course_runs run
        ON run.tenant_id = seat.tenant_id
       AND run.classroom_id = seat.classroom_id
      JOIN public.classroom_course_run_lessons lesson
        ON lesson.run_id = run.id
       AND lesson.tenant_id = run.tenant_id
     WHERE seat.id = p_seat_id
       AND seat.status = 'active'
       AND run.id = p_run_id
       AND lesson.id = p_lesson_id
       AND lesson.kind = 'material';

    IF v_tenant IS NULL THEN
        RETURN QUERY SELECT 'lesson_not_found'::varchar, NULL::timestamptz;
        RETURN;
    END IF;
    IF v_status <> 'open' THEN
        RETURN QUERY SELECT 'course_closed'::varchar, NULL::timestamptz;
        RETURN;
    END IF;

    IF p_completed THEN
        INSERT INTO public.classroom_course_lesson_progress (
            tenant_id, run_id, lesson_id, seat_id
        ) VALUES (
            v_tenant, p_run_id, p_lesson_id, p_seat_id
        )
        ON CONFLICT (run_id, lesson_id, seat_id) DO UPDATE
           SET completed_at = EXCLUDED.completed_at,
               updated_at = now()
        RETURNING classroom_course_lesson_progress.completed_at INTO v_completed_at;
    ELSE
        DELETE FROM public.classroom_course_lesson_progress progress
         WHERE progress.run_id = p_run_id
           AND progress.lesson_id = p_lesson_id
           AND progress.seat_id = p_seat_id;
        v_completed_at := NULL;
    END IF;

    RETURN QUERY SELECT 'ok'::varchar, v_completed_at;
END;
$$;

DROP FUNCTION IF EXISTS classroom_course_runs_for_teacher(uuid, uuid);
CREATE FUNCTION classroom_course_runs_for_teacher(
    p_account_id   uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    run_id uuid,
    course_id uuid,
    course_version_id uuid,
    version_number integer,
    run_title varchar,
    run_summary varchar,
    due_at timestamptz,
    run_status varchar,
    published_at timestamptz,
    started_count integer,
    submitted_count integer,
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
    seat_count integer,
    lesson_started_count integer,
    lesson_submitted_count integer,
    lesson_completed_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT run.id, run.course_id, run.course_version_id, run.version_number,
           run.title, run.summary, run.due_at, run.status, version.published_at,
           (SELECT count(*)::integer
              FROM (
                  SELECT work.seat_id
                    FROM public.classroom_course_run_lessons mapped
                    JOIN public.classroom_assignment_work work
                      ON work.assignment_id = mapped.classroom_assignment_id
                   WHERE mapped.run_id = run.id
                  UNION
                  SELECT progress.seat_id
                    FROM public.classroom_course_lesson_progress progress
                   WHERE progress.run_id = run.id
              ) started),
           (SELECT count(*)::integer
              FROM public.classroom_course_run_lessons mapped
              JOIN public.classroom_assignment_work work
                ON work.assignment_id = mapped.classroom_assignment_id
             WHERE mapped.run_id = run.id AND work.submitted_at IS NOT NULL),
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
           (SELECT count(*)::integer FROM public.classroom_student_seats seat
             WHERE seat.classroom_id = run.classroom_id AND seat.status <> 'removed'),
           (SELECT count(*)::integer FROM public.classroom_assignment_work work
             WHERE work.assignment_id = lesson.classroom_assignment_id),
           (SELECT count(*)::integer FROM public.classroom_assignment_work work
             WHERE work.assignment_id = lesson.classroom_assignment_id
               AND work.submitted_at IS NOT NULL),
           (SELECT count(*)::integer
              FROM public.classroom_course_lesson_progress progress
             WHERE progress.lesson_id = lesson.id)
      FROM public.classroom_course_runs run
      JOIN public.course_versions version ON version.id = run.course_version_id
      JOIN public.classroom_course_run_lessons lesson ON lesson.run_id = run.id
      LEFT JOIN public.course_version_media media
        ON media.version_id = run.course_version_id
       AND media.source_lesson_id = lesson.source_lesson_id
     WHERE run.classroom_id = p_classroom_id
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships membership
            WHERE membership.account_id = p_account_id
              AND membership.classroom_id = p_classroom_id
              AND membership.tenant_id = run.tenant_id
              AND membership.member_role IN ('owner', 'co_teacher')
       )
     ORDER BY run.created_at DESC, lesson.section_position, lesson.source_section_id,
              lesson.lesson_position, lesson.source_lesson_id;
$$;

DROP FUNCTION IF EXISTS classroom_course_runs_for_seat(uuid);
CREATE FUNCTION classroom_course_runs_for_seat(p_seat_id uuid)
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
    work_updated_at timestamptz,
    completed_at timestamptz
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

REVOKE ALL ON FUNCTION classroom_course_material_progress_set(uuid, uuid, uuid, boolean)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_course_runs_for_teacher(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_course_runs_for_seat(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION classroom_course_material_progress_set(uuid, uuid, uuid, boolean)
    TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_course_runs_for_teacher(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_course_runs_for_seat(uuid) TO asalab_app;
