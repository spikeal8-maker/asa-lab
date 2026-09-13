-- LRN-COURSE-01: pin reusable canonical material in the existing course outline.
-- Existing legacy assignment lessons remain valid; no content roots are copied.
ALTER TABLE course_lessons ADD COLUMN learning_activity_version_id uuid
    REFERENCES learning_activity_versions(id) ON DELETE RESTRICT;
ALTER TABLE course_lessons DROP CONSTRAINT course_lessons_assignment_check;
ALTER TABLE course_lessons ADD CONSTRAINT course_lessons_assignment_check CHECK (
    (kind='material' AND assignment_id IS NULL AND learning_activity_version_id IS NULL)
    OR (kind='assignment' AND num_nonnulls(assignment_id,learning_activity_version_id)=1)
);
CREATE INDEX course_lessons_activity_version_idx ON course_lessons(learning_activity_version_id)
    WHERE learning_activity_version_id IS NOT NULL;

CREATE OR REPLACE FUNCTION course_lesson_save_v3(
    p_principal_id uuid, p_course_id uuid, p_section_id uuid, p_lesson_id uuid,
    p_title varchar, p_summary varchar, p_blocks jsonb, p_kind varchar,
    p_assignment_id uuid, p_estimated_minutes integer, p_activity_version_id uuid
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_tenant uuid; v_id uuid; v_position integer;
BEGIN
    -- Lock the root before computing outline position or changing a pin.
    SELECT course.tenant_id INTO v_tenant FROM public.courses course
     WHERE course.id=p_course_id AND course.owner_principal_id=p_principal_id FOR UPDATE;
    IF v_tenant IS NULL THEN RETURN NULL; END IF;
    IF p_activity_version_id IS NULL THEN
        -- An explicit transition away from a canonical lesson clears its pin in
        -- this transaction; delegate legacy writes without inventing source rows.
        IF p_lesson_id IS NOT NULL THEN
            UPDATE public.course_lessons SET kind='material',learning_activity_version_id=NULL
             WHERE id=p_lesson_id AND course_id=p_course_id
               AND learning_activity_version_id IS NOT NULL;
        END IF;
        v_id := public.course_lesson_save_v2(p_principal_id,p_course_id,p_section_id,
          p_lesson_id,p_title,p_summary,p_blocks,p_kind,p_assignment_id,p_estimated_minutes);
        IF v_id IS NULL THEN RAISE EXCEPTION 'invalid course lesson' USING ERRCODE='22023'; END IF;
        RETURN v_id;
    END IF;
    IF p_kind IS DISTINCT FROM 'assignment' OR p_assignment_id IS NOT NULL
       OR length(trim(coalesce(p_title,''))) NOT BETWEEN 1 AND 160
       OR NOT public.course_lesson_blocks_valid(p_blocks)
       OR (p_estimated_minutes IS NOT NULL AND p_estimated_minutes NOT BETWEEN 1 AND 600)
       OR NOT EXISTS (SELECT 1 FROM public.course_sections WHERE id=p_section_id AND course_id=p_course_id)
       OR NOT EXISTS (
         SELECT 1 FROM public.learning_activity_versions version
         JOIN public.learning_activities activity ON activity.id=version.activity_id
         WHERE version.id=p_activity_version_id AND version.canonical_contract_version=1
           AND version.canonical_kind='project' AND version.module_key IN ('electronics','three-d')
           AND activity.owner_principal_id=p_principal_id AND activity.reusable_authored_content
           AND activity.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM public.learning_migration_compatibility_activity_versions compat
                           WHERE compat.learning_activity_version_id=version.id))
    THEN RETURN NULL; END IF;
    SELECT COALESCE(max(position),0)+1 INTO v_position FROM public.course_lessons WHERE section_id=p_section_id;
    IF p_lesson_id IS NULL THEN
        INSERT INTO public.course_lessons(tenant_id,course_id,section_id,title,summary,content,blocks,
          kind,learning_activity_version_id,estimated_minutes,position)
        VALUES(v_tenant,p_course_id,p_section_id,trim(p_title),nullif(trim(p_summary),''),
          public.course_lesson_blocks_plain_text(p_blocks),p_blocks,'assignment',
          p_activity_version_id,p_estimated_minutes,v_position) RETURNING id INTO v_id;
    ELSE
        UPDATE public.course_lessons SET
          position=CASE WHEN section_id=p_section_id THEN position ELSE v_position END,
          section_id=p_section_id,title=trim(p_title),summary=nullif(trim(p_summary),''),
          content=public.course_lesson_blocks_plain_text(p_blocks),blocks=p_blocks,
          kind='assignment',assignment_id=NULL,learning_activity_version_id=p_activity_version_id,
          estimated_minutes=p_estimated_minutes,updated_at=now()
         WHERE id=p_lesson_id AND course_id=p_course_id RETURNING id INTO v_id;
    END IF;
    IF v_id IS NOT NULL THEN
        UPDATE public.courses SET updated_at=now() WHERE id=p_course_id;
    END IF;
    RETURN v_id;
END;
$$;
CREATE OR REPLACE FUNCTION course_outline_v3(
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
    learning_activity_version_id uuid,
    assignment_title varchar,
    module_key varchar,
    estimated_minutes integer,
    lesson_position integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT section.id, section.title, section.summary, section.position,
           lesson.id, lesson.title, lesson.summary, lesson.content, lesson.blocks,
           lesson.kind, lesson.assignment_id, lesson.learning_activity_version_id,
           COALESCE(version.title, task.title), COALESCE(version.module_key, task.module_key),
           lesson.estimated_minutes, lesson.position
      FROM public.courses course
      JOIN public.course_sections section ON section.course_id = course.id
      LEFT JOIN public.course_lessons lesson ON lesson.section_id = section.id
      LEFT JOIN public.teacher_assignments task ON task.id = lesson.assignment_id
      LEFT JOIN public.learning_activity_versions version ON version.id = lesson.learning_activity_version_id
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
        'schemaVersion', CASE WHEN EXISTS (
            SELECT 1 FROM public.course_lessons pin WHERE pin.course_id=p_course_id
                AND pin.learning_activity_version_id IS NOT NULL
        ) THEN 3 ELSE 2 END,
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
                                'learningActivityVersionId', lesson.learning_activity_version_id,
                                'estimatedMinutes', lesson.estimated_minutes,
                                'position', lesson.position,
                                'assignment', CASE
                                    WHEN version.id IS NOT NULL THEN jsonb_build_object(
                                        'learningActivityVersionId', version.id,
                                        'title', version.title, 'brief', version.instructions,
                                        'moduleKey', version.module_key,
                                        'resultMode', version.result_mode,
                                        'maxPoints', version.max_points)
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
                          LEFT JOIN public.learning_activity_versions version
                            ON version.id = lesson.learning_activity_version_id
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

REVOKE ALL ON FUNCTION course_lesson_save_v3(uuid,uuid,uuid,uuid,varchar,varchar,jsonb,varchar,uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION course_lesson_save_v3(uuid,uuid,uuid,uuid,varchar,varchar,jsonb,varchar,uuid,integer,uuid) TO asalab_app;
REVOKE ALL ON FUNCTION course_outline_v3(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION course_outline_v3(uuid,uuid,uuid,uuid) TO asalab_app;
