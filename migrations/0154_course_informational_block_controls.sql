-- E1-FIX-11C: informational lesson.blocks structural controls.
-- Draft keeps visible + hidden blocks. Frozen CourseVersion snapshots keep only
-- effective visible blocks and strip the author-only hidden marker.
-- Historical migrations remain untouched.

CREATE OR REPLACE FUNCTION public.course_lesson_blocks_valid(p_blocks jsonb)
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
                'paragraph', 'heading', 'callout', 'image', 'video', 'audio', 'file',
                'code', 'formula', 'table', 'divider'
            )
            OR CASE block ->> 'type'
                WHEN 'paragraph' THEN
                    block - ARRAY['id','type','text','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(block ->> 'text') > 12000
                WHEN 'heading' THEN
                    block - ARRAY['id','type','text','level','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(trim(coalesce(block ->> 'text', ''))) = 0
                    OR length(block ->> 'text') > 300
                    OR coalesce(block ->> 'level', '') NOT IN ('2', '3')
                WHEN 'callout' THEN
                    block - ARRAY['id','type','text','tone','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(trim(coalesce(block ->> 'text', ''))) = 0
                    OR length(block ->> 'text') > 3000
                    OR coalesce(block ->> 'tone', '') NOT IN ('note', 'tip', 'warning')
                WHEN 'image' THEN
                    block - ARRAY['id','type','url','alt','caption','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'url'), '') <> 'string'
                    OR (coalesce(block ->> 'url', '') !~ '^https://'
                        AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                    OR coalesce(block ->> 'url', '') LIKE '%..%'
                    OR length(block ->> 'url') > 2000
                    OR (block ? 'alt' AND coalesce(jsonb_typeof(block -> 'alt'), '') <> 'string')
                    OR length(coalesce(block ->> 'alt', '')) > 300
                    OR (block ? 'caption'
                        AND coalesce(jsonb_typeof(block -> 'caption'), '') <> 'string')
                    OR length(coalesce(block ->> 'caption', '')) > 600
                WHEN 'video' THEN
                    block - ARRAY['id','type','url','title','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'url'), '') <> 'string'
                    OR (coalesce(block ->> 'url', '') !~ '^https://'
                        AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                    OR coalesce(block ->> 'url', '') LIKE '%..%'
                    OR length(block ->> 'url') > 2000
                    OR (block ? 'title'
                        AND coalesce(jsonb_typeof(block -> 'title'), '') <> 'string')
                    OR length(coalesce(block ->> 'title', '')) > 300
                WHEN 'audio' THEN
                    block - ARRAY['id','type','url','title','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'url'), '') <> 'string'
                    OR (coalesce(block ->> 'url', '') !~ '^https://'
                        AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                    OR coalesce(block ->> 'url', '') LIKE '%..%'
                    OR length(block ->> 'url') > 2000
                    OR (block ? 'title'
                        AND coalesce(jsonb_typeof(block -> 'title'), '') <> 'string')
                    OR length(coalesce(block ->> 'title', '')) > 300
                WHEN 'file' THEN
                    block - ARRAY['id','type','url','label','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'url'), '') <> 'string'
                    OR (coalesce(block ->> 'url', '') !~ '^https://'
                        AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                    OR coalesce(block ->> 'url', '') LIKE '%..%'
                    OR length(block ->> 'url') > 2000
                    OR coalesce(jsonb_typeof(block -> 'label'), '') <> 'string'
                    OR length(trim(coalesce(block ->> 'label', ''))) = 0
                    OR length(block ->> 'label') > 300
                WHEN 'code' THEN
                    block - ARRAY['id','type','text','language','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(block ->> 'text') > 20000
                    OR (
                        block ? 'language'
                        AND (
                            coalesce(jsonb_typeof(block -> 'language'), '') <> 'string'
                            OR coalesce(block ->> 'language', '') !~ '^[A-Za-z0-9][A-Za-z0-9_+.#-]{0,79}$'
                        )
                    )
                WHEN 'formula' THEN
                    block - ARRAY['id','type','text','hidden'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(trim(coalesce(block ->> 'text', ''))) = 0
                    OR length(block ->> 'text') > 4000
                WHEN 'table' THEN
                    block - ARRAY['id','type','rows','hidden'] <> '{}'::jsonb
                    OR NOT public.course_lesson_table_rows_valid(block -> 'rows')
                WHEN 'divider' THEN
                    block - ARRAY['id','type','hidden'] <> '{}'::jsonb
                ELSE true
              END
    ) THEN RETURN false; END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_blocks) block
         GROUP BY block ->> 'id'
        HAVING count(*) > 1
    ) THEN RETURN false; END IF;

    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.course_lesson_blocks_plain_text(p_blocks jsonb)
RETURNS varchar
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_block jsonb;
    v_row jsonb;
    v_piece text;
    v_row_text text;
    v_text text := '';
BEGIN
    FOR v_block IN SELECT value FROM jsonb_array_elements(p_blocks)
    LOOP
        IF v_block ? 'hidden'
           AND jsonb_typeof(v_block -> 'hidden') = 'boolean'
           AND (v_block ->> 'hidden')::boolean THEN
            CONTINUE;
        END IF;

        v_piece := CASE v_block ->> 'type'
            WHEN 'paragraph' THEN v_block ->> 'text'
            WHEN 'heading' THEN v_block ->> 'text'
            WHEN 'callout' THEN v_block ->> 'text'
            WHEN 'image' THEN v_block ->> 'caption'
            WHEN 'video' THEN v_block ->> 'title'
            WHEN 'audio' THEN v_block ->> 'title'
            WHEN 'file' THEN v_block ->> 'label'
            WHEN 'code' THEN v_block ->> 'text'
            WHEN 'formula' THEN v_block ->> 'text'
            ELSE NULL
        END;

        IF v_block ->> 'type' = 'table' THEN
            v_piece := '';
            FOR v_row IN SELECT value FROM jsonb_array_elements(v_block -> 'rows')
            LOOP
                SELECT string_agg(value, ' | ')
                  INTO v_row_text
                  FROM jsonb_array_elements_text(v_row);
                v_piece := concat_ws(E'\n', NULLIF(v_piece, ''), v_row_text);
            END LOOP;
        END IF;

        IF v_piece IS NOT NULL AND v_piece <> '' THEN
            v_text := concat_ws(E'\n\n', NULLIF(v_text, ''), v_piece);
        END IF;
    END LOOP;

    RETURN NULLIF(left(v_text, 12000), '')::varchar;
END;
$$;

CREATE OR REPLACE FUNCTION public.course_snapshot_build(p_course_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object(
    'schemaVersion',CASE WHEN EXISTS (
      SELECT 1
        FROM public.course_lessons pin
        JOIN public.course_sections section ON section.id=pin.section_id
       WHERE pin.course_id=p_course_id
         AND NOT pin.hidden
         AND NOT section.hidden
         AND pin.learning_activity_version_id IS NOT NULL
    ) THEN 3 ELSE 2 END,
    'course',jsonb_build_object(
      'sourceCourseId',course.id,
      'title',course.title,
      'summary',course.summary,
      'ageBand',course.age_band
    ),
    'sections',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'sourceSectionId',section.id,
          'title',section.title,
          'summary',section.summary,
          'position',section.position,
          'lessons',COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'sourceLessonId',lesson.id,
                'title',lesson.title,
                'summary',lesson.summary,
                'content',public.course_lesson_blocks_plain_text(lesson.blocks),
                'blocks',COALESCE((
                  SELECT jsonb_agg(entry.value - 'hidden' ORDER BY entry.ordinality)
                    FROM jsonb_array_elements(lesson.blocks) WITH ORDINALITY
                         AS entry(value, ordinality)
                   WHERE NOT COALESCE((entry.value ->> 'hidden')::boolean,false)
                ),'[]'::jsonb),
                'kind',lesson.kind,
                'learningActivityVersionId',lesson.learning_activity_version_id,
                'estimatedMinutes',lesson.estimated_minutes,
                'position',lesson.position,
                'assignment',CASE
                  WHEN version.id IS NOT NULL THEN jsonb_build_object(
                    'learningActivityVersionId',version.id,
                    'title',version.title,
                    'brief',version.instructions,
                    'moduleKey',version.module_key,
                    'resultMode',version.result_mode,
                    'maxPoints',version.max_points
                  )
                  WHEN task.id IS NULL THEN NULL
                  ELSE jsonb_build_object(
                    'sourceAssignmentId',task.id,
                    'title',task.title,
                    'goal',task.goal,
                    'brief',task.brief,
                    'moduleKey',task.module_key,
                    'ageBand',task.age_band,
                    'staticSampleImage',CASE
                      WHEN task.sample_bytes IS NULL THEN task.sample_image ELSE NULL
                    END,
                    'hasVersionedSample',task.sample_bytes IS NOT NULL,
                    'sampleContentType',task.sample_content_type,
                    'sampleChecksum',CASE
                      WHEN task.sample_bytes IS NULL THEN NULL
                      ELSE md5(encode(task.sample_bytes,'base64'))
                    END
                  )
                END
              ) ORDER BY lesson.position,lesson.id
            )
              FROM public.course_lessons lesson
              LEFT JOIN public.teacher_assignments task ON task.id=lesson.assignment_id
              LEFT JOIN public.learning_activity_versions version
                ON version.id=lesson.learning_activity_version_id
             WHERE lesson.section_id=section.id
               AND NOT lesson.hidden
          ),'[]'::jsonb)
        ) ORDER BY section.position,section.id
      )
        FROM public.course_sections section
       WHERE section.course_id=course.id
         AND NOT section.hidden
    ),'[]'::jsonb)
  )
    FROM public.courses course
   WHERE course.id=p_course_id;
$$;

-- Preserve the existing privilege boundary. These functions are internal
-- SECURITY DEFINER helpers and are not directly executable by PUBLIC.
REVOKE ALL ON FUNCTION public.course_lesson_blocks_valid(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.course_lesson_blocks_plain_text(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.course_snapshot_build(uuid) FROM PUBLIC;
