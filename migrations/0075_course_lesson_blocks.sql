-- Structured lesson content for compact course authoring and rich learner playback.
--
-- `content` remains as a plain-text compatibility field for old clients and
-- assignment handouts. `blocks` is the canonical authored representation and
-- is frozen into every CourseVersion and ClassroomCourseRun.

CREATE OR REPLACE FUNCTION course_lesson_blocks_valid(p_blocks jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(p_blocks) > 40 OR octet_length(p_blocks::text) > 60000 THEN
        RETURN false;
    END IF;
    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_blocks) block
         WHERE jsonb_typeof(block) <> 'object'
               OR coalesce(block ->> 'id', '') !~ '^[A-Za-z0-9_-]{1,80}$'
               OR coalesce(block ->> 'type', '') NOT IN (
                   'paragraph', 'heading', 'callout', 'image', 'video', 'audio', 'file'
               )
               OR CASE block ->> 'type'
                    WHEN 'paragraph' THEN
                        length(coalesce(block ->> 'text', '')) > 12000
                    WHEN 'heading' THEN
                        length(trim(coalesce(block ->> 'text', ''))) = 0
                        OR length(block ->> 'text') > 300
                        OR coalesce(block ->> 'level', '') NOT IN ('2', '3')
                    WHEN 'callout' THEN
                        length(trim(coalesce(block ->> 'text', ''))) = 0
                        OR length(block ->> 'text') > 3000
                        OR coalesce(block ->> 'tone', '') NOT IN ('note', 'tip', 'warning')
                    WHEN 'image' THEN
                        (coalesce(block ->> 'url', '') !~ '^https://'
                         AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                        OR coalesce(block ->> 'url', '') LIKE '%..%'
                        OR length(block ->> 'url') > 2000
                        OR length(coalesce(block ->> 'alt', '')) > 300
                        OR length(coalesce(block ->> 'caption', '')) > 600
                    WHEN 'video' THEN
                        (coalesce(block ->> 'url', '') !~ '^https://'
                         AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                        OR coalesce(block ->> 'url', '') LIKE '%..%'
                        OR length(block ->> 'url') > 2000
                        OR length(coalesce(block ->> 'title', '')) > 300
                    WHEN 'audio' THEN
                        (coalesce(block ->> 'url', '') !~ '^https://'
                         AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                        OR coalesce(block ->> 'url', '') LIKE '%..%'
                        OR length(block ->> 'url') > 2000
                        OR length(coalesce(block ->> 'title', '')) > 300
                    WHEN 'file' THEN
                        (coalesce(block ->> 'url', '') !~ '^https://'
                         AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                        OR coalesce(block ->> 'url', '') LIKE '%..%'
                        OR length(block ->> 'url') > 2000
                        OR length(trim(coalesce(block ->> 'label', ''))) = 0
                        OR length(block ->> 'label') > 300
                    ELSE true
                  END
    ) THEN RETURN false; END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_blocks) block
         GROUP BY block ->> 'id' HAVING count(*) > 1
    ) THEN RETURN false; END IF;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION course_lesson_blocks_plain_text(p_blocks jsonb)
RETURNS varchar
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
    SELECT NULLIF(left(string_agg(
        CASE block ->> 'type'
            WHEN 'paragraph' THEN NULLIF(trim(block ->> 'text'), '')
            WHEN 'heading' THEN NULLIF(trim(block ->> 'text'), '')
            WHEN 'callout' THEN NULLIF(trim(block ->> 'text'), '')
            WHEN 'image' THEN NULLIF(trim(block ->> 'caption'), '')
            WHEN 'video' THEN NULLIF(trim(block ->> 'title'), '')
            WHEN 'audio' THEN NULLIF(trim(block ->> 'title'), '')
            WHEN 'file' THEN NULLIF(trim(block ->> 'label'), '')
            ELSE NULL
        END,
        E'\n\n' ORDER BY ordinal
    ), 12000), '')::varchar
      FROM jsonb_array_elements(p_blocks) WITH ORDINALITY AS entry(block, ordinal);
$$;

ALTER TABLE course_lessons
    ADD COLUMN IF NOT EXISTS blocks jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE classroom_course_run_lessons
    ADD COLUMN IF NOT EXISTS blocks jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE course_lessons
   SET blocks = jsonb_build_array(jsonb_build_object(
       'id', 'legacy-' || replace(id::text, '-', ''),
       'type', 'paragraph',
       'text', content
   ))
 WHERE blocks = '[]'::jsonb
   AND NULLIF(trim(content), '') IS NOT NULL;

UPDATE classroom_course_run_lessons
   SET blocks = jsonb_build_array(jsonb_build_object(
       'id', 'legacy-' || replace(id::text, '-', ''),
       'type', 'paragraph',
       'text', content
   ))
 WHERE blocks = '[]'::jsonb
   AND NULLIF(trim(content), '') IS NOT NULL;

ALTER TABLE course_lessons
    DROP CONSTRAINT IF EXISTS course_lessons_blocks_check;
ALTER TABLE course_lessons
    ADD CONSTRAINT course_lessons_blocks_check
        CHECK (course_lesson_blocks_valid(blocks));
ALTER TABLE classroom_course_run_lessons
    DROP CONSTRAINT IF EXISTS classroom_course_run_lessons_blocks_check;
ALTER TABLE classroom_course_run_lessons
    ADD CONSTRAINT classroom_course_run_lessons_blocks_check
        CHECK (course_lesson_blocks_valid(blocks));

CREATE OR REPLACE FUNCTION course_lesson_save_v2(
    p_principal_id      uuid,
    p_course_id         uuid,
    p_section_id        uuid,
    p_lesson_id         uuid,
    p_title             varchar,
    p_summary           varchar,
    p_blocks            jsonb,
    p_kind              varchar,
    p_assignment_id     uuid,
    p_estimated_minutes integer
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_id uuid;
BEGIN
    IF NOT public.course_lesson_blocks_valid(p_blocks) THEN RETURN NULL; END IF;
    v_id := public.course_lesson_save(
        p_principal_id, p_course_id, p_section_id, p_lesson_id, p_title, p_summary,
        public.course_lesson_blocks_plain_text(p_blocks), p_kind, p_assignment_id,
        p_estimated_minutes
    );
    IF v_id IS NULL THEN RETURN NULL; END IF;
    UPDATE public.course_lessons SET blocks = p_blocks WHERE id = v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION course_outline_v2(
    p_course_id    uuid,
    p_principal_id uuid,
    p_account_id   uuid,
    p_tenant_id    uuid
)
RETURNS TABLE (
    section_id uuid,
    section_title varchar,
    section_summary varchar,
    section_position integer,
    lesson_id uuid,
    lesson_title varchar,
    lesson_summary varchar,
    lesson_content varchar,
    lesson_blocks jsonb,
    lesson_kind varchar,
    lesson_assignment_id uuid,
    assignment_title varchar,
    module_key varchar,
    estimated_minutes integer,
    lesson_position integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT section.id, section.title, section.summary, section.position,
           lesson.id, lesson.title, lesson.summary, lesson.content, lesson.blocks,
           lesson.kind, lesson.assignment_id, task.title, task.module_key,
           lesson.estimated_minutes, lesson.position
      FROM public.courses course
      JOIN public.course_sections section ON section.course_id = course.id
      LEFT JOIN public.course_lessons lesson ON lesson.section_id = section.id
      LEFT JOIN public.teacher_assignments task ON task.id = lesson.assignment_id
     WHERE course.id = p_course_id
       AND public.content_is_visible(
           'course', course.id, course.visibility, course.owner_principal_id, course.tenant_id,
           p_principal_id, p_account_id, p_tenant_id
       )
     ORDER BY section.position, section.id, lesson.position, lesson.id;
$$;

CREATE OR REPLACE FUNCTION course_snapshot_build(p_course_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT jsonb_build_object(
        'schemaVersion', 2,
        'course', jsonb_build_object(
            'sourceCourseId', course.id,
            'title', course.title,
            'summary', course.summary,
            'ageBand', course.age_band
        ),
        'sections', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'sourceSectionId', section.id,
                    'title', section.title,
                    'summary', section.summary,
                    'position', section.position,
                    'lessons', COALESCE((
                        SELECT jsonb_agg(
                            jsonb_build_object(
                                'sourceLessonId', lesson.id,
                                'title', lesson.title,
                                'summary', lesson.summary,
                                'content', lesson.content,
                                'blocks', lesson.blocks,
                                'kind', lesson.kind,
                                'estimatedMinutes', lesson.estimated_minutes,
                                'position', lesson.position,
                                'assignment', CASE
                                    WHEN task.id IS NULL THEN NULL
                                    ELSE jsonb_build_object(
                                        'sourceAssignmentId', task.id,
                                        'title', task.title,
                                        'goal', task.goal,
                                        'brief', task.brief,
                                        'moduleKey', task.module_key,
                                        'ageBand', task.age_band,
                                        'staticSampleImage', CASE
                                            WHEN task.sample_bytes IS NULL THEN task.sample_image
                                            ELSE NULL
                                        END,
                                        'hasVersionedSample', task.sample_bytes IS NOT NULL,
                                        'sampleContentType', task.sample_content_type,
                                        'sampleChecksum', CASE
                                            WHEN task.sample_bytes IS NULL THEN NULL
                                            ELSE md5(encode(task.sample_bytes, 'base64'))
                                        END
                                    )
                                END
                            ) ORDER BY lesson.position, lesson.id
                        )
                          FROM public.course_lessons lesson
                          LEFT JOIN public.teacher_assignments task
                            ON task.id = lesson.assignment_id
                         WHERE lesson.section_id = section.id
                    ), '[]'::jsonb)
                ) ORDER BY section.position, section.id
            )
              FROM public.course_sections section
             WHERE section.course_id = course.id
        ), '[]'::jsonb)
    )
      FROM public.courses course
     WHERE course.id = p_course_id;
$$;

CREATE OR REPLACE FUNCTION classroom_course_run_assign_v2(
    p_principal_id uuid,
    p_classroom_id uuid,
    p_course_id    uuid,
    p_due_at       timestamptz
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

    SELECT version.id, version.version_number, version.outline, version.title, version.summary
      INTO v_version
      FROM public.courses course
      JOIN public.course_versions version ON version.course_id = course.id
     WHERE course.id = p_course_id AND course.owner_principal_id = p_principal_id
     ORDER BY version.version_number DESC LIMIT 1;
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
        UPDATE public.classroom_course_runs SET due_at = p_due_at, updated_at = now()
         WHERE id = v_existing;
        UPDATE public.classroom_assignments SET due_at = p_due_at
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
            );
        END LOOP;
    END LOOP;
    RETURN QUERY SELECT 'ok'::varchar, v_run, v_version.version_number, false;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_course_runs_for_teacher_v2(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    run_id uuid, course_id uuid, course_version_id uuid, version_number integer,
    run_title varchar, run_summary varchar, due_at timestamptz, run_status varchar,
    published_at timestamptz, started_count integer, submitted_count integer,
    lesson_id uuid, source_lesson_id uuid, section_title varchar, section_summary varchar,
    section_position integer, lesson_title varchar, lesson_summary varchar,
    lesson_content varchar, lesson_blocks jsonb, lesson_kind varchar,
    estimated_minutes integer, lesson_position integer, classroom_assignment_id uuid,
    assignment_title varchar, assignment_goal varchar, assignment_brief varchar,
    module_key varchar, sample_image varchar, seat_count integer,
    lesson_started_count integer, lesson_submitted_count integer,
    lesson_completed_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT run.id, run.course_id, run.course_version_id, run.version_number,
           run.title, run.summary, run.due_at, run.status, version.published_at,
           (SELECT count(*)::integer FROM (
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
           lesson.summary, lesson.content, lesson.blocks, lesson.kind,
           lesson.estimated_minutes, lesson.lesson_position,
           lesson.classroom_assignment_id, lesson.assignment_title,
           lesson.assignment_goal, lesson.assignment_brief, lesson.module_key,
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
           (SELECT count(*)::integer FROM public.classroom_course_lesson_progress progress
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

CREATE OR REPLACE FUNCTION course_take_with_outline(
    p_principal_id uuid,
    p_course_id uuid,
    p_account_id uuid,
    p_tenant_id uuid
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_target uuid;
    v_target_tenant uuid;
    v_source_section record;
    v_target_section uuid;
    v_source_lesson record;
    v_target_task uuid;
BEGIN
    v_target := public.course_take(p_principal_id, p_course_id, p_account_id, p_tenant_id);
    IF v_target IS NULL THEN RETURN NULL; END IF;
    SELECT course.tenant_id INTO v_target_tenant
      FROM public.courses course WHERE course.id = v_target;

    FOR v_source_section IN
        SELECT section.* FROM public.course_sections section
         WHERE section.course_id = p_course_id ORDER BY section.position, section.id
    LOOP
        INSERT INTO public.course_sections (tenant_id, course_id, title, summary, position)
        VALUES (v_target_tenant, v_target, v_source_section.title,
                v_source_section.summary, v_source_section.position)
        RETURNING id INTO v_target_section;

        FOR v_source_lesson IN
            SELECT lesson.* FROM public.course_lessons lesson
             WHERE lesson.section_id = v_source_section.id ORDER BY lesson.position, lesson.id
        LOOP
            v_target_task := NULL;
            IF v_source_lesson.assignment_id IS NOT NULL THEN
                SELECT task.id INTO v_target_task
                  FROM public.teacher_assignments task
                  JOIN public.course_items item ON item.assignment_id = task.id
                 WHERE item.course_id = v_target
                   AND task.owner_principal_id = p_principal_id
                   AND task.copied_from_assignment_id = v_source_lesson.assignment_id
                 LIMIT 1;
            END IF;
            INSERT INTO public.course_lessons (
                tenant_id, course_id, section_id, title, summary, content, blocks, kind,
                assignment_id, estimated_minutes, position
            ) VALUES (
                v_target_tenant, v_target, v_target_section, v_source_lesson.title,
                v_source_lesson.summary, v_source_lesson.content, v_source_lesson.blocks,
                CASE WHEN v_source_lesson.kind = 'assignment' AND v_target_task IS NULL
                     THEN 'material' ELSE v_source_lesson.kind END,
                v_target_task, v_source_lesson.estimated_minutes, v_source_lesson.position
            );
        END LOOP;
    END LOOP;
    PERFORM public.course_outline_ensure(v_target);
    RETURN v_target;
END;
$$;

REVOKE ALL ON FUNCTION course_lesson_blocks_valid(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_lesson_blocks_plain_text(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_lesson_save_v2(
    uuid, uuid, uuid, uuid, varchar, varchar, jsonb, varchar, uuid, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_outline_v2(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_course_run_assign_v2(uuid, uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_course_runs_for_teacher_v2(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_course_runs_for_seat_v2(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION course_lesson_save_v2(
    uuid, uuid, uuid, uuid, varchar, varchar, jsonb, varchar, uuid, integer
) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_outline_v2(uuid, uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_course_run_assign_v2(uuid, uuid, uuid, timestamptz)
    TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_course_runs_for_teacher_v2(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_course_runs_for_seat_v2(uuid) TO asalab_app;
