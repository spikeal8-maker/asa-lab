-- Published courses are immutable releases, not aliases to an editable draft.
--
-- A class run will point at one of these versions. Editing the course or a
-- linked assignment then changes the draft, while the material already given
-- to learners remains byte-for-byte stable.

CREATE TABLE IF NOT EXISTS course_versions (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 uuid NOT NULL REFERENCES tenants(id),
    course_id                 uuid NOT NULL,
    version_number            integer NOT NULL,
    title                     varchar(160) NOT NULL,
    summary                   varchar(600),
    age_band                  varchar(16),
    outline                   jsonb NOT NULL,
    content_hash              varchar(32) NOT NULL,
    published_by_principal_id uuid NOT NULL REFERENCES principals(id),
    published_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (course_id, version_number),
    UNIQUE (tenant_id, course_id, id),
    FOREIGN KEY (tenant_id, course_id)
        REFERENCES courses(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT course_versions_number_check CHECK (version_number > 0),
    CONSTRAINT course_versions_outline_check CHECK (jsonb_typeof(outline) = 'object')
);

CREATE INDEX IF NOT EXISTS course_versions_latest_idx
    ON course_versions (course_id, version_number DESC);

-- Uploaded assignment samples live in the database and may be replaced later.
-- Keep their bytes beside the version instead of leaving a mutable URL in an
-- otherwise immutable snapshot. Static shipped assets remain referenced by URL.
CREATE TABLE IF NOT EXISTS course_version_media (
    version_id        uuid NOT NULL REFERENCES course_versions(id) ON DELETE CASCADE,
    source_lesson_id  uuid NOT NULL,
    sample_bytes      bytea NOT NULL,
    content_type      varchar(64) NOT NULL,
    content_hash      varchar(32) NOT NULL,
    PRIMARY KEY (version_id, source_lesson_id),
    CONSTRAINT course_version_media_size_check
        CHECK (octet_length(sample_bytes) BETWEEN 64 AND 400000)
);

REVOKE ALL ON course_versions FROM PUBLIC;
REVOKE ALL ON course_versions FROM asalab_app;
REVOKE ALL ON course_version_media FROM PUBLIC;
REVOKE ALL ON course_version_media FROM asalab_app;

ALTER TABLE course_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE course_version_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_version_media FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS course_versions_visible ON course_versions;
CREATE POLICY course_versions_visible ON course_versions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.courses c
             WHERE c.id = course_id
               AND (
                   c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
                   OR c.visibility = 'public'
               )
        )
    );

DROP POLICY IF EXISTS course_versions_write ON course_versions;
CREATE POLICY course_versions_write ON course_versions
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS course_version_media_visible ON course_version_media;
CREATE POLICY course_version_media_visible ON course_version_media
    FOR SELECT USING (
        EXISTS (
            SELECT 1
              FROM public.course_versions version
              JOIN public.courses course ON course.id = version.course_id
             WHERE version.id = version_id
               AND (
                   course.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
                   OR course.visibility = 'public'
               )
        )
    );

DROP POLICY IF EXISTS course_version_media_write ON course_version_media;
CREATE POLICY course_version_media_write ON course_version_media
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.course_versions version
             WHERE version.id = version_id
               AND version.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.course_versions version
             WHERE version.id = version_id
               AND version.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        )
    );

/**
 * Stable, transportable representation of the current draft.
 *
 * Assignment text is copied into the lesson. The source ids remain only as
 * provenance and as the bridge to the existing assignment work/review system.
 */
CREATE OR REPLACE FUNCTION course_snapshot_build(p_course_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT jsonb_build_object(
        'schemaVersion', 1,
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

CREATE OR REPLACE FUNCTION course_content_hash(p_course_id uuid)
RETURNS varchar
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT md5(public.course_snapshot_build(p_course_id)::text);
$$;

/** Publish the current draft, or reuse the latest version if nothing changed. */
CREATE OR REPLACE FUNCTION course_publish(
    p_principal_id uuid,
    p_course_id    uuid
)
RETURNS TABLE (
    result_code    varchar,
    version_id     uuid,
    version_number integer,
    published_at   timestamptz,
    reused         boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_course       record;
    v_snapshot     jsonb;
    v_hash         varchar(32);
    v_latest       record;
    v_version_id   uuid;
    v_number       integer;
    v_published_at timestamptz;
BEGIN
    SELECT course.id, course.tenant_id, course.title, course.summary, course.age_band
      INTO v_course
      FROM public.courses course
     WHERE course.id = p_course_id
       AND course.owner_principal_id = p_principal_id
     FOR UPDATE;

    IF v_course.id IS NULL THEN
        RETURN QUERY SELECT 'course_not_found'::varchar, NULL::uuid, NULL::integer,
                            NULL::timestamptz, false;
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.course_lessons lesson WHERE lesson.course_id = p_course_id
    ) THEN
        RETURN QUERY SELECT 'course_empty'::varchar, NULL::uuid, NULL::integer,
                            NULL::timestamptz, false;
        RETURN;
    END IF;

    v_snapshot := public.course_snapshot_build(p_course_id);
    v_hash := md5(v_snapshot::text);

    SELECT version.id, version.version_number, version.content_hash, version.published_at
      INTO v_latest
      FROM public.course_versions version
     WHERE version.course_id = p_course_id
     ORDER BY version.version_number DESC
     LIMIT 1;

    IF v_latest.id IS NOT NULL AND v_latest.content_hash = v_hash THEN
        RETURN QUERY SELECT 'ok'::varchar, v_latest.id, v_latest.version_number,
                            v_latest.published_at, true;
        RETURN;
    END IF;

    v_number := COALESCE(v_latest.version_number, 0) + 1;
    INSERT INTO public.course_versions (
        tenant_id, course_id, version_number, title, summary, age_band,
        outline, content_hash, published_by_principal_id
    ) VALUES (
        v_course.tenant_id, p_course_id, v_number, v_course.title,
        v_course.summary, v_course.age_band, v_snapshot, v_hash, p_principal_id
    )
    RETURNING id, course_versions.published_at INTO v_version_id, v_published_at;

    INSERT INTO public.course_version_media (
        version_id, source_lesson_id, sample_bytes, content_type, content_hash
    )
    SELECT v_version_id, lesson.id, task.sample_bytes, task.sample_content_type,
           md5(encode(task.sample_bytes, 'base64'))
      FROM public.course_lessons lesson
      JOIN public.teacher_assignments task ON task.id = lesson.assignment_id
     WHERE lesson.course_id = p_course_id
       AND task.sample_bytes IS NOT NULL
       AND task.sample_content_type IS NOT NULL;

    RETURN QUERY SELECT 'ok'::varchar, v_version_id, v_number, v_published_at, false;
END;
$$;

-- The previous function is replaced because PostgreSQL cannot alter the return
-- table shape with CREATE OR REPLACE.
DROP FUNCTION course_library_list(uuid);
CREATE FUNCTION course_library_list(p_principal_id uuid)
RETURNS TABLE (
    id uuid,
    title varchar,
    summary varchar,
    visibility varchar,
    age_band varchar,
    section_count integer,
    lesson_count integer,
    assignment_count integer,
    shared_with integer,
    copied_from_course_id uuid,
    publication_state varchar,
    published_version integer,
    published_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT course.id, course.title, course.summary, course.visibility, course.age_band,
           (SELECT count(*)::integer FROM public.course_sections section
             WHERE section.course_id = course.id),
           (SELECT count(*)::integer FROM public.course_lessons lesson
             WHERE lesson.course_id = course.id),
           (SELECT count(*)::integer FROM public.course_lessons lesson
             WHERE lesson.course_id = course.id AND lesson.kind = 'assignment'),
           (SELECT count(*)::integer FROM public.content_shares share
             WHERE share.subject_kind = 'course' AND share.subject_id = course.id),
           course.copied_from_course_id,
           CASE
               WHEN latest.id IS NULL THEN 'draft'::varchar
               WHEN latest.content_hash = public.course_content_hash(course.id)
                   THEN 'published'::varchar
               ELSE 'changed'::varchar
           END,
           latest.version_number,
           latest.published_at,
           course.created_at,
           course.updated_at
      FROM public.courses course
      LEFT JOIN LATERAL (
          SELECT version.id, version.version_number, version.content_hash, version.published_at
            FROM public.course_versions version
           WHERE version.course_id = course.id
           ORDER BY version.version_number DESC
           LIMIT 1
      ) latest ON true
     WHERE course.owner_principal_id = p_principal_id
     ORDER BY course.updated_at DESC, course.id;
$$;

REVOKE ALL ON FUNCTION course_snapshot_build(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_content_hash(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_publish(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_library_list(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION course_publish(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_library_list(uuid) TO asalab_app;
