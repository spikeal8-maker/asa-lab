-- A published course becomes a classroom run.
--
-- The run points at one immutable CourseVersion. Material lessons are read in
-- the course player; assignment lessons receive ordinary classroom handouts so
-- project creation, submission, progress and teacher review keep using the
-- classroom system that already exists.

CREATE TABLE IF NOT EXISTS classroom_course_runs (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 uuid NOT NULL REFERENCES tenants(id),
    classroom_id              uuid NOT NULL,
    course_id                 uuid NOT NULL REFERENCES courses(id),
    course_version_id         uuid NOT NULL REFERENCES course_versions(id),
    title                     varchar(160) NOT NULL,
    summary                   varchar(600),
    version_number            integer NOT NULL,
    due_at                    timestamptz,
    status                    varchar(16) NOT NULL DEFAULT 'open',
    assigned_by_principal_id  uuid NOT NULL REFERENCES principals(id),
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, classroom_id)
        REFERENCES classrooms(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT classroom_course_runs_status_check CHECK (status IN ('open', 'closed')),
    CONSTRAINT classroom_course_runs_version_check CHECK (version_number > 0)
);

CREATE INDEX IF NOT EXISTS classroom_course_runs_class_idx
    ON classroom_course_runs (classroom_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS classroom_course_runs_open_version_idx
    ON classroom_course_runs (classroom_id, course_version_id) WHERE status = 'open';

-- Course handouts do not point at the editable assignment-bank row. Their
-- wording comes from the versioned lesson below, while the handout id remains
-- the existing identity used by classroom_assignment_work.
ALTER TABLE classroom_assignments
    ADD COLUMN IF NOT EXISTS course_run_id uuid
        REFERENCES classroom_course_runs(id) ON DELETE CASCADE;
ALTER TABLE classroom_assignments ALTER COLUMN assignment_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'classroom_assignments_source_check'
    ) THEN
        ALTER TABLE classroom_assignments
            ADD CONSTRAINT classroom_assignments_source_check CHECK (
                (assignment_id IS NOT NULL AND course_run_id IS NULL)
                OR (assignment_id IS NULL AND course_run_id IS NOT NULL)
            );
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS classroom_assignments_course_run_idx
    ON classroom_assignments (course_run_id) WHERE course_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS classroom_course_run_lessons (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                uuid NOT NULL REFERENCES tenants(id),
    run_id                   uuid NOT NULL,
    source_section_id        uuid NOT NULL,
    source_lesson_id         uuid NOT NULL,
    section_title            varchar(160) NOT NULL,
    section_summary          varchar(600),
    section_position         integer NOT NULL,
    title                    varchar(160) NOT NULL,
    summary                  varchar(600),
    content                  varchar(12000),
    kind                     varchar(16) NOT NULL,
    estimated_minutes        integer,
    lesson_position          integer NOT NULL,
    classroom_assignment_id  uuid REFERENCES classroom_assignments(id) ON DELETE SET NULL,
    assignment_title         varchar(255),
    assignment_goal          varchar(160),
    assignment_brief         varchar(4000),
    module_key               varchar(64),
    static_sample_image      varchar(128),
    created_at               timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, source_lesson_id),
    UNIQUE (classroom_assignment_id),
    FOREIGN KEY (tenant_id, run_id)
        REFERENCES classroom_course_runs(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT classroom_course_run_lessons_kind_check
        CHECK (kind IN ('material', 'assignment')),
    CONSTRAINT classroom_course_run_lessons_assignment_check CHECK (
        (kind = 'material' AND classroom_assignment_id IS NULL AND module_key IS NULL)
        OR (kind = 'assignment' AND classroom_assignment_id IS NOT NULL AND module_key IS NOT NULL)
    ),
    CONSTRAINT classroom_course_run_lessons_duration_check CHECK (
        estimated_minutes IS NULL OR estimated_minutes BETWEEN 1 AND 600
    )
);

CREATE INDEX IF NOT EXISTS classroom_course_run_lessons_order_idx
    ON classroom_course_run_lessons
       (run_id, section_position, source_section_id, lesson_position, source_lesson_id);

REVOKE ALL ON classroom_course_runs FROM PUBLIC;
REVOKE ALL ON classroom_course_runs FROM asalab_app;
REVOKE ALL ON classroom_course_run_lessons FROM PUBLIC;
REVOKE ALL ON classroom_course_run_lessons FROM asalab_app;

ALTER TABLE classroom_course_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_course_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE classroom_course_run_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_course_run_lessons FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS classroom_course_runs_tenant ON classroom_course_runs;
CREATE POLICY classroom_course_runs_tenant ON classroom_course_runs
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS classroom_course_run_lessons_tenant ON classroom_course_run_lessons;
CREATE POLICY classroom_course_run_lessons_tenant ON classroom_course_run_lessons
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

/** Assign the latest published version owned by the teacher. */
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
    v_run_lesson   uuid;
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
            INSERT INTO public.classroom_course_run_lessons (
                tenant_id, run_id, source_section_id, source_lesson_id,
                section_title, section_summary, section_position,
                title, summary, content, kind, estimated_minutes, lesson_position,
                assignment_title, assignment_goal, assignment_brief, module_key,
                static_sample_image
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
            ) RETURNING id INTO v_run_lesson;

            IF v_lesson ->> 'kind' = 'assignment' THEN
                INSERT INTO public.classroom_assignments (
                    tenant_id, classroom_id, assignment_id, due_at, status,
                    created_by, course_run_id
                ) VALUES (
                    v_tenant, p_classroom_id, NULL, p_due_at, 'open', v_user, v_run
                ) RETURNING id INTO v_handout;
                UPDATE public.classroom_course_run_lessons
                   SET classroom_assignment_id = v_handout
                 WHERE id = v_run_lesson;
            END IF;
        END LOOP;
    END LOOP;

    RETURN QUERY SELECT 'ok'::varchar, v_run, v_version.version_number, false;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_course_runs_for_teacher(
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
    lesson_submitted_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT run.id, run.course_id, run.course_version_id, run.version_number,
           run.title, run.summary, run.due_at, run.status, version.published_at,
           (SELECT count(*)::integer
              FROM public.classroom_course_run_lessons mapped
              JOIN public.classroom_assignment_work work
                ON work.assignment_id = mapped.classroom_assignment_id
             WHERE mapped.run_id = run.id),
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
               AND work.submitted_at IS NOT NULL)
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
       AND (run.status = 'open' OR work.project_id IS NOT NULL)
     ORDER BY run.created_at DESC, lesson.section_position, lesson.source_section_id,
              lesson.lesson_position, lesson.source_lesson_id;
$$;

CREATE OR REPLACE FUNCTION classroom_course_run_set_status(
    p_principal_id uuid,
    p_classroom_id uuid,
    p_run_id       uuid,
    p_status       varchar
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_updated integer := 0;
BEGIN
    IF p_status NOT IN ('open', 'closed') THEN RETURN false; END IF;
    UPDATE public.classroom_course_runs run
       SET status = p_status, updated_at = now()
     WHERE run.id = p_run_id
       AND run.classroom_id = p_classroom_id
       AND EXISTS (
           SELECT 1
             FROM public.principals principal
             JOIN public.classroom_memberships membership
               ON membership.account_id = principal.account_id
            WHERE principal.id = p_principal_id
              AND membership.classroom_id = p_classroom_id
              AND membership.tenant_id = run.tenant_id
              AND membership.member_role IN ('owner', 'co_teacher')
       );
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN
        UPDATE public.classroom_assignments
           SET status = p_status
         WHERE course_run_id = p_run_id;
    END IF;
    RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_course_run_media(
    p_run_id           uuid,
    p_source_lesson_id uuid,
    p_seat_id          uuid,
    p_account_id       uuid
)
RETURNS TABLE (sample_bytes bytea, content_type varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT media.sample_bytes, media.content_type
      FROM public.classroom_course_runs run
      JOIN public.course_version_media media ON media.version_id = run.course_version_id
     WHERE run.id = p_run_id
       AND media.source_lesson_id = p_source_lesson_id
       AND (
           EXISTS (
               SELECT 1 FROM public.classroom_student_seats seat
                WHERE seat.id = p_seat_id
                  AND seat.classroom_id = run.classroom_id
                  AND seat.tenant_id = run.tenant_id
                  AND seat.status = 'active'
           )
           OR EXISTS (
               SELECT 1 FROM public.classroom_memberships membership
                WHERE membership.account_id = p_account_id
                  AND membership.classroom_id = run.classroom_id
                  AND membership.tenant_id = run.tenant_id
                  AND membership.member_role IN ('owner', 'co_teacher', 'student')
           )
       );
$$;

-- Teacher review keeps showing the exact versioned task next to a learner's
-- project, even if the draft course or assignment bank changed afterwards.
CREATE OR REPLACE FUNCTION classroom_seat_projects(
    p_principal_id uuid,
    p_seat_id      uuid
)
RETURNS TABLE (
    id uuid,
    module_key varchar,
    title varchar,
    status varchar,
    created_at timestamptz,
    updated_at timestamptz,
    snapshot_revision integer,
    preview_json jsonb,
    preview_digest varchar,
    last_editor_was_teacher boolean,
    submitted_at timestamptz,
    awaiting_review boolean,
    assignment_title varchar,
    assignment_goal varchar,
    assignment_brief varchar,
    assignment_sample_image varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH scope AS (
        SELECT visible.seat_id, visible.seat_principal_id, seat.account_id
          FROM public.teacher_seat_scope(p_principal_id) visible
          JOIN public.classroom_student_seats seat ON seat.id = visible.seat_id
         WHERE visible.seat_id = p_seat_id
    ),
    visible AS (
        SELECT project.id
          FROM scope
          JOIN public.projects project ON project.owner_principal_id = scope.seat_principal_id
         WHERE scope.account_id IS NULL AND project.project_scope = 'personal'
        UNION
        SELECT work.project_id
          FROM scope
          JOIN public.classroom_assignment_work work ON work.seat_id = scope.seat_id
         WHERE scope.account_id IS NOT NULL AND work.project_id IS NOT NULL
    )
    SELECT project.id, project.module_key, project.title, project.status,
           project.created_at, draft.updated_at, snapshot.source_revision,
           draft.preview_json, draft.preview_digest, editor.account_id IS NOT NULL,
           work.submitted_at,
           work.submitted_at IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM public.project_feedback feedback
                WHERE feedback.project_id = project.id
                  AND feedback.updated_at >= work.submitted_at
           ),
           COALESCE(task.title, run_lesson.assignment_title, run_lesson.title),
           COALESCE(task.goal, run_lesson.assignment_goal),
           COALESCE(task.brief, run_lesson.assignment_brief),
           COALESCE(
               task.sample_image,
               CASE WHEN media.version_id IS NOT NULL
                    THEN ('/api/class-join/course-runs/' || run.id::text || '/lessons/' ||
                          run_lesson.source_lesson_id::text || '/sample')::varchar
                    ELSE run_lesson.static_sample_image END
           )
      FROM visible
      JOIN public.projects project ON project.id = visible.id
      JOIN public.project_drafts draft
        ON draft.tenant_id = project.tenant_id AND draft.project_id = project.id
      LEFT JOIN public.project_snapshots snapshot
        ON snapshot.tenant_id = project.tenant_id AND snapshot.project_id = project.id
      LEFT JOIN public.principals editor ON editor.id = draft.updated_by_principal_id
      LEFT JOIN public.classroom_assignment_work work
        ON work.project_id = project.id AND work.seat_id = p_seat_id
      LEFT JOIN public.classroom_assignments handout ON handout.id = work.assignment_id
      LEFT JOIN public.teacher_assignments task ON task.id = handout.assignment_id
      LEFT JOIN public.classroom_course_run_lessons run_lesson
        ON run_lesson.classroom_assignment_id = handout.id
      LEFT JOIN public.classroom_course_runs run ON run.id = run_lesson.run_id
      LEFT JOIN public.course_version_media media
        ON media.version_id = run.course_version_id
       AND media.source_lesson_id = run_lesson.source_lesson_id
     ORDER BY draft.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION classroom_course_run_assign(uuid, uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_course_runs_for_teacher(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_course_runs_for_seat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_course_run_set_status(uuid, uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_course_run_media(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_seat_projects(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION classroom_course_run_assign(uuid, uuid, uuid, timestamptz) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_course_runs_for_teacher(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_course_runs_for_seat(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_course_run_set_status(uuid, uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_course_run_media(uuid, uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_seat_projects(uuid, uuid) TO asalab_app;
