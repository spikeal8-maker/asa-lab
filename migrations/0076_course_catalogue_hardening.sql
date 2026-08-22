-- Make the course catalogue a shelf of immutable publications, not a window
-- into somebody else's editable draft. New classes also start honestly empty:
-- the reference course remains an explicit teacher action.

CREATE OR REPLACE FUNCTION classroom_assignments_seed_demo(p_classroom_id uuid)
RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT 0;
$$;

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
                    WHEN 'paragraph' THEN length(coalesce(block ->> 'text', '')) > 12000
                    WHEN 'heading' THEN
                        length(trim(coalesce(block ->> 'text', ''))) = 0
                        OR length(block ->> 'text') > 300
                        OR coalesce(block ->> 'level', '') NOT IN ('2', '3')
                    WHEN 'callout' THEN
                        length(trim(coalesce(block ->> 'text', ''))) = 0
                        OR length(block ->> 'text') > 3000
                        OR coalesce(block ->> 'tone', '') NOT IN ('note', 'tip', 'warning')
                    WHEN 'image' THEN
                        coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$'
                        OR coalesce(block ->> 'url', '') LIKE '%..%'
                        OR length(block ->> 'url') > 2000
                        OR length(coalesce(block ->> 'alt', '')) > 300
                        OR length(coalesce(block ->> 'caption', '')) > 600
                    WHEN 'video' THEN
                        coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$'
                        OR coalesce(block ->> 'url', '') LIKE '%..%'
                        OR length(block ->> 'url') > 2000
                        OR length(coalesce(block ->> 'title', '')) > 300
                    WHEN 'audio' THEN
                        coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$'
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

-- Publications made before same-origin media enforcement remain readable. An
-- external embed becomes an ordinary explicit link when a colleague copies it;
-- it is never silently loaded in a learner page.
CREATE OR REPLACE FUNCTION course_lesson_blocks_sanitized(p_blocks jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_block jsonb;
    v_result jsonb := '[]'::jsonb;
    v_label varchar;
BEGIN
    IF p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'array' THEN RETURN '[]'::jsonb; END IF;
    FOR v_block IN SELECT value FROM jsonb_array_elements(p_blocks)
    LOOP
        IF v_block ->> 'type' IN ('image', 'video', 'audio')
           AND coalesce(v_block ->> 'url', '') !~ '^/assets/' THEN
            v_label := coalesce(
                NULLIF(v_block ->> 'title', ''), NULLIF(v_block ->> 'caption', ''),
                NULLIF(v_block ->> 'alt', ''), 'Внешний материал'
            );
            v_result := v_result || jsonb_build_array(jsonb_build_object(
                'id', v_block ->> 'id', 'type', 'file',
                'url', v_block ->> 'url', 'label', left(v_label, 300)
            ));
        ELSE
            v_result := v_result || jsonb_build_array(v_block);
        END IF;
    END LOOP;
    IF NOT public.course_lesson_blocks_valid(v_result) THEN RETURN '[]'::jsonb; END IF;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION shared_catalogue(
    p_principal_id uuid,
    p_account_id   uuid,
    p_tenant_id    uuid
)
RETURNS TABLE (
    kind varchar, id uuid, title varchar, summary varchar, module_key varchar,
    age_band varchar, visibility varchar, sample_image varchar, item_count integer,
    author_name varchar, author_school varchar, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT 'course'::varchar, course.id, latest.title, latest.summary, NULL::varchar,
           latest.age_band, course.visibility,
           (
               SELECT lesson -> 'assignment' ->> 'staticSampleImage'
                 FROM jsonb_array_elements(latest.outline -> 'sections') section,
                      jsonb_array_elements(section -> 'lessons') lesson
                WHERE NULLIF(lesson -> 'assignment' ->> 'staticSampleImage', '') IS NOT NULL
                ORDER BY (section ->> 'position')::integer, (lesson ->> 'position')::integer
                LIMIT 1
           )::varchar,
           (
               SELECT count(*)::integer
                 FROM jsonb_array_elements(latest.outline -> 'sections') section,
                      jsonb_array_elements(section -> 'lessons') lesson
           ),
           COALESCE(author.display_name, 'Преподаватель')::varchar,
           school.title, latest.published_at
      FROM public.courses course
      JOIN LATERAL (
          SELECT version.title, version.summary, version.age_band,
                 version.outline, version.published_at
            FROM public.course_versions version
           WHERE version.course_id = course.id
           ORDER BY version.version_number DESC
           LIMIT 1
      ) latest ON true
      JOIN public.principals principal ON principal.id = course.owner_principal_id
      LEFT JOIN public.profiles author ON author.account_id = principal.account_id
      LEFT JOIN public.tenants school ON school.id = course.tenant_id
     WHERE course.owner_principal_id <> p_principal_id
       AND public.content_is_visible(
           'course', course.id, course.visibility, course.owner_principal_id,
           course.tenant_id, p_principal_id, p_account_id, p_tenant_id
       )
    UNION ALL
    SELECT 'assignment'::varchar, task.id, task.title, task.goal, task.module_key,
           task.age_band, task.visibility, task.sample_image, 1,
           COALESCE(author.display_name, 'Преподаватель')::varchar,
           school.title, task.created_at
      FROM public.teacher_assignments task
      JOIN public.principals principal ON principal.id = task.owner_principal_id
      LEFT JOIN public.profiles author ON author.account_id = principal.account_id
      LEFT JOIN public.tenants school ON school.id = task.tenant_id
     WHERE task.owner_principal_id <> p_principal_id
       AND task.archived_at IS NULL
       AND NOT EXISTS (
           SELECT 1
             FROM public.course_items item
             JOIN public.courses course ON course.id = item.course_id
            WHERE item.assignment_id = task.id
              AND course.visibility <> 'private'
              AND EXISTS (SELECT 1 FROM public.course_versions version
                           WHERE version.course_id = course.id)
       )
       AND public.content_is_visible(
           'assignment', task.id, task.visibility, task.owner_principal_id,
           task.tenant_id, p_principal_id, p_account_id, p_tenant_id
       )
     ORDER BY 12 DESC;
$$;

CREATE OR REPLACE FUNCTION course_catalogue_preview(
    p_course_id uuid,
    p_principal_id uuid,
    p_account_id uuid,
    p_tenant_id uuid
)
RETURNS TABLE (
    version_number integer, title varchar, summary varchar,
    outline jsonb, published_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT version.version_number, version.title, version.summary,
           version.outline, version.published_at
      FROM public.courses course
      JOIN LATERAL (
          SELECT candidate.* FROM public.course_versions candidate
           WHERE candidate.course_id = course.id
           ORDER BY candidate.version_number DESC LIMIT 1
      ) version ON true
     WHERE course.id = p_course_id
       AND course.owner_principal_id <> p_principal_id
       AND public.content_is_visible(
           'course', course.id, course.visibility, course.owner_principal_id,
           course.tenant_id, p_principal_id, p_account_id, p_tenant_id
       );
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
    v_source record;
    v_target_tenant uuid;
    v_folder uuid;
    v_target uuid;
    v_target_section uuid;
    v_target_task uuid;
    v_section jsonb;
    v_lesson jsonb;
    v_assignment jsonb;
    v_blocks jsonb;
    v_sample_bytes bytea;
    v_sample_content_type varchar;
    v_item_position integer := 0;
BEGIN
    SELECT course.*, version.id AS version_id, version.title AS version_title,
           version.summary AS version_summary, version.age_band AS version_age_band,
           version.outline
      INTO v_source
      FROM public.courses course
      JOIN LATERAL (
          SELECT candidate.* FROM public.course_versions candidate
           WHERE candidate.course_id = course.id
           ORDER BY candidate.version_number DESC LIMIT 1
      ) version ON true
     WHERE course.id = p_course_id;
    IF v_source.id IS NULL THEN RETURN NULL; END IF;
    IF NOT public.content_is_visible(
        'course', v_source.id, v_source.visibility, v_source.owner_principal_id,
        v_source.tenant_id, p_principal_id, p_account_id, p_tenant_id
    ) THEN RETURN NULL; END IF;

    v_target_tenant := public.principal_home_tenant(p_principal_id);
    IF v_target_tenant IS NULL THEN RETURN NULL; END IF;

    INSERT INTO public.assignment_folders (tenant_id, owner_principal_id, parent_id, title)
    VALUES (v_target_tenant, p_principal_id, NULL, left(v_source.version_title, 120))
    ON CONFLICT DO NOTHING RETURNING id INTO v_folder;
    IF v_folder IS NULL THEN
        SELECT folder.id INTO v_folder FROM public.assignment_folders folder
         WHERE folder.owner_principal_id = p_principal_id
           AND folder.parent_id IS NULL
           AND lower(folder.title) = lower(left(v_source.version_title, 120));
    END IF;

    INSERT INTO public.courses (
        tenant_id, owner_principal_id, title, summary, age_band, visibility,
        copied_from_course_id
    ) VALUES (
        v_target_tenant, p_principal_id, v_source.version_title,
        v_source.version_summary, v_source.version_age_band, 'private', v_source.id
    ) RETURNING id INTO v_target;

    FOR v_section IN SELECT value FROM jsonb_array_elements(v_source.outline -> 'sections')
    LOOP
        INSERT INTO public.course_sections (tenant_id, course_id, title, summary, position)
        VALUES (
            v_target_tenant, v_target, v_section ->> 'title',
            NULLIF(v_section ->> 'summary', ''), (v_section ->> 'position')::integer
        ) RETURNING id INTO v_target_section;

        FOR v_lesson IN SELECT value FROM jsonb_array_elements(v_section -> 'lessons')
        LOOP
            v_assignment := v_lesson -> 'assignment';
            v_target_task := NULL;
            v_sample_bytes := NULL;
            v_sample_content_type := NULL;
            IF v_lesson ->> 'kind' = 'assignment' AND jsonb_typeof(v_assignment) = 'object' THEN
                SELECT media.sample_bytes, media.content_type
                  INTO v_sample_bytes, v_sample_content_type
                  FROM public.course_version_media media
                 WHERE media.version_id = v_source.version_id
                   AND media.source_lesson_id = (v_lesson ->> 'sourceLessonId')::uuid;

                INSERT INTO public.teacher_assignments (
                    tenant_id, owner_principal_id, title, brief, goal, module_key, age_band,
                    sample_image, sample_bytes, sample_content_type, folder_id,
                    copied_from_assignment_id, visibility
                ) VALUES (
                    v_target_tenant, p_principal_id, v_assignment ->> 'title',
                    NULLIF(v_assignment ->> 'brief', ''), NULLIF(v_assignment ->> 'goal', ''),
                    v_assignment ->> 'moduleKey', NULLIF(v_assignment ->> 'ageBand', ''),
                    NULLIF(v_assignment ->> 'staticSampleImage', ''),
                    v_sample_bytes, v_sample_content_type, v_folder,
                    (v_assignment ->> 'sourceAssignmentId')::uuid, 'private'
                ) RETURNING id INTO v_target_task;

                IF v_sample_bytes IS NOT NULL THEN
                    UPDATE public.teacher_assignments
                       SET sample_image = '/api/assignments/' || v_target_task || '/sample'
                     WHERE id = v_target_task;
                END IF;
                v_item_position := v_item_position + 1;
                INSERT INTO public.course_items (course_id, assignment_id, position)
                VALUES (v_target, v_target_task, v_item_position);
            END IF;

            v_blocks := public.course_lesson_blocks_sanitized(v_lesson -> 'blocks');
            INSERT INTO public.course_lessons (
                tenant_id, course_id, section_id, title, summary, content, blocks, kind,
                assignment_id, estimated_minutes, position
            ) VALUES (
                v_target_tenant, v_target, v_target_section, v_lesson ->> 'title',
                NULLIF(v_lesson ->> 'summary', ''), NULLIF(v_lesson ->> 'content', ''),
                v_blocks,
                CASE WHEN v_lesson ->> 'kind' = 'assignment' AND v_target_task IS NOT NULL
                     THEN 'assignment' ELSE 'material' END,
                v_target_task, NULLIF(v_lesson ->> 'estimatedMinutes', '')::integer,
                (v_lesson ->> 'position')::integer
            );
        END LOOP;
    END LOOP;
    PERFORM public.course_outline_ensure(v_target);
    PERFORM public.course_items_sync_outline(v_target);
    RETURN v_target;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_course_runs_for_account_v2(p_account_id uuid)
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
    SELECT visible.*
      FROM public.classroom_student_seats seat
      CROSS JOIN LATERAL public.classroom_course_runs_for_seat_v2(seat.id) visible
     WHERE seat.account_id = p_account_id
       AND seat.status = 'active'
     ORDER BY visible.classroom_title, visible.run_id,
              visible.section_position, visible.lesson_position, visible.source_lesson_id;
$$;

CREATE OR REPLACE FUNCTION classroom_course_material_progress_set_for_account(
    p_account_id uuid,
    p_run_id uuid,
    p_lesson_id uuid,
    p_completed boolean
)
RETURNS TABLE (result_code varchar, completed_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_seat_id uuid;
BEGIN
    SELECT seat.id INTO v_seat_id
      FROM public.classroom_student_seats seat
      JOIN public.classroom_course_runs run
        ON run.tenant_id = seat.tenant_id AND run.classroom_id = seat.classroom_id
     WHERE seat.account_id = p_account_id
       AND seat.status = 'active'
       AND run.id = p_run_id
     LIMIT 1;
    IF v_seat_id IS NULL THEN
        RETURN QUERY SELECT 'lesson_not_found'::varchar, NULL::timestamptz;
        RETURN;
    END IF;
    RETURN QUERY SELECT progress.result_code, progress.completed_at
      FROM public.classroom_course_material_progress_set(
          v_seat_id, p_run_id, p_lesson_id, p_completed
      ) progress;
END;
$$;

REVOKE ALL ON FUNCTION course_lesson_blocks_sanitized(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_catalogue_preview(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_take_with_outline(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_course_runs_for_account_v2(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_course_material_progress_set_for_account(
    uuid, uuid, uuid, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION course_catalogue_preview(uuid, uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_take_with_outline(uuid, uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_course_runs_for_account_v2(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_course_material_progress_set_for_account(
    uuid, uuid, uuid, boolean
) TO asalab_app;
