-- A course is an outline, not a flat bag of assignments.
--
-- Existing courses remain valid: every legacy course receives one section and
-- one lesson per course_item. New authoring can then mix explanatory lessons
-- and assignment lessons without changing or deleting the old rows.

CREATE TABLE IF NOT EXISTS course_sections (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenants(id),
    course_id  uuid NOT NULL,
    title      varchar(160) NOT NULL,
    summary    varchar(600),
    position   integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, course_id, id),
    FOREIGN KEY (tenant_id, course_id)
        REFERENCES courses(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT course_sections_title_check CHECK (length(trim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS course_sections_order_idx
    ON course_sections (course_id, position, id);

CREATE TABLE IF NOT EXISTS course_lessons (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL REFERENCES tenants(id),
    course_id         uuid NOT NULL,
    section_id        uuid NOT NULL,
    title             varchar(160) NOT NULL,
    summary           varchar(600),
    content           varchar(12000),
    kind              varchar(16) NOT NULL DEFAULT 'material',
    assignment_id     uuid REFERENCES teacher_assignments(id) ON DELETE RESTRICT,
    estimated_minutes integer,
    position          integer NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, course_id, section_id)
        REFERENCES course_sections(tenant_id, course_id, id) ON DELETE CASCADE,
    CONSTRAINT course_lessons_title_check CHECK (length(trim(title)) > 0),
    CONSTRAINT course_lessons_kind_check CHECK (kind IN ('material', 'assignment')),
    CONSTRAINT course_lessons_assignment_check CHECK (
        (kind = 'material' AND assignment_id IS NULL)
        OR (kind = 'assignment' AND assignment_id IS NOT NULL)
    ),
    CONSTRAINT course_lessons_duration_check CHECK (
        estimated_minutes IS NULL OR estimated_minutes BETWEEN 1 AND 600
    )
);

CREATE INDEX IF NOT EXISTS course_lessons_order_idx
    ON course_lessons (course_id, section_id, position, id);
CREATE INDEX IF NOT EXISTS course_lessons_assignment_idx
    ON course_lessons (assignment_id) WHERE assignment_id IS NOT NULL;

REVOKE ALL ON course_sections FROM PUBLIC;
REVOKE ALL ON course_lessons FROM PUBLIC;
REVOKE ALL ON course_sections FROM asalab_app;
REVOKE ALL ON course_lessons FROM asalab_app;

ALTER TABLE course_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_sections FORCE ROW LEVEL SECURITY;
ALTER TABLE course_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_lessons FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS course_sections_visible ON course_sections;
CREATE POLICY course_sections_visible ON course_sections
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
DROP POLICY IF EXISTS course_sections_write ON course_sections;
CREATE POLICY course_sections_write ON course_sections
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.courses c
             WHERE c.id = course_id
               AND c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.courses c
             WHERE c.id = course_id
               AND c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        )
    );

DROP POLICY IF EXISTS course_lessons_visible ON course_lessons;
CREATE POLICY course_lessons_visible ON course_lessons
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
DROP POLICY IF EXISTS course_lessons_write ON course_lessons;
CREATE POLICY course_lessons_write ON course_lessons
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.courses c
             WHERE c.id = course_id
               AND c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.courses c
             WHERE c.id = course_id
               AND c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        )
    );

/** Make sure a course has a place where a first lesson can be written. */
CREATE OR REPLACE FUNCTION course_outline_ensure(p_course_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant  uuid;
    v_section uuid;
BEGIN
    SELECT s.id INTO v_section
      FROM public.course_sections s
     WHERE s.course_id = p_course_id
     ORDER BY s.position, s.id
     LIMIT 1;
    IF v_section IS NOT NULL THEN RETURN v_section; END IF;

    SELECT c.tenant_id INTO v_tenant FROM public.courses c WHERE c.id = p_course_id;
    IF v_tenant IS NULL THEN RETURN NULL; END IF;

    INSERT INTO public.course_sections (tenant_id, course_id, title, position)
    VALUES (v_tenant, p_course_id, 'Первый раздел', 1)
    RETURNING id INTO v_section;
    RETURN v_section;
END;
$$;

/** Keep the legacy flat index in the same order as assignment lessons. */
CREATE OR REPLACE FUNCTION course_items_sync_outline(p_course_id uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH first_lessons AS (
        SELECT DISTINCT ON (l.assignment_id)
               l.assignment_id,
               s.position AS section_position,
               l.position AS lesson_position,
               l.id AS lesson_id
          FROM public.course_lessons l
          JOIN public.course_sections s ON s.id = l.section_id
         WHERE l.course_id = p_course_id
           AND l.assignment_id IS NOT NULL
         ORDER BY l.assignment_id, s.position, s.id, l.position, l.id
    ), ranked AS (
        SELECT assignment_id,
               row_number() OVER (
                   ORDER BY section_position, lesson_position, lesson_id
               )::integer AS position
          FROM first_lessons
    )
    UPDATE public.course_items item
       SET position = ranked.position
      FROM ranked
     WHERE item.course_id = p_course_id
       AND item.assignment_id = ranked.assignment_id;
$$;

-- Backfill is idempotent. It never edits or removes the legacy course_items.
DO $$
DECLARE
    v_course  record;
    v_section uuid;
    v_item    record;
BEGIN
    FOR v_course IN
        SELECT c.id, c.tenant_id FROM public.courses c
         WHERE NOT EXISTS (
             SELECT 1 FROM public.course_sections s WHERE s.course_id = c.id
         )
    LOOP
        INSERT INTO public.course_sections (tenant_id, course_id, title, position)
        VALUES (
            v_course.tenant_id,
            v_course.id,
            CASE WHEN EXISTS (
                SELECT 1 FROM public.course_items i WHERE i.course_id = v_course.id
            ) THEN 'Материалы курса' ELSE 'Первый раздел' END,
            1
        )
        RETURNING id INTO v_section;

        FOR v_item IN
            SELECT i.assignment_id, i.position, t.title, t.goal
              FROM public.course_items i
              JOIN public.teacher_assignments t ON t.id = i.assignment_id
             WHERE i.course_id = v_course.id
             ORDER BY i.position, i.assignment_id
        LOOP
            INSERT INTO public.course_lessons
                (tenant_id, course_id, section_id, title, summary, kind,
                 assignment_id, position)
            VALUES
                (v_course.tenant_id, v_course.id, v_section, v_item.title,
                 v_item.goal, 'assignment', v_item.assignment_id, v_item.position);
        END LOOP;
    END LOOP;
END;
$$;

/** Course list with honest outline counts. */
CREATE OR REPLACE FUNCTION course_library_list(p_principal_id uuid)
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
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title, c.summary, c.visibility, c.age_band,
           (SELECT count(*)::integer FROM public.course_sections s WHERE s.course_id = c.id),
           (SELECT count(*)::integer FROM public.course_lessons l WHERE l.course_id = c.id),
           (SELECT count(*)::integer FROM public.course_lessons l
             WHERE l.course_id = c.id AND l.kind = 'assignment'),
           (SELECT count(*)::integer FROM public.content_shares share
             WHERE share.subject_kind = 'course' AND share.subject_id = c.id),
           c.copied_from_course_id, c.created_at, c.updated_at
      FROM public.courses c
     WHERE c.owner_principal_id = p_principal_id
     ORDER BY c.updated_at DESC, c.id;
$$;

/** Flat transport shape; the API groups it into sections and lessons. */
CREATE OR REPLACE FUNCTION course_outline(
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
    lesson_kind varchar,
    lesson_assignment_id uuid,
    assignment_title varchar,
    module_key varchar,
    estimated_minutes integer,
    lesson_position integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.id, s.title, s.summary, s.position,
           l.id, l.title, l.summary, l.content, l.kind, l.assignment_id,
           task.title, task.module_key, l.estimated_minutes, l.position
      FROM public.courses c
      JOIN public.course_sections s ON s.course_id = c.id
      LEFT JOIN public.course_lessons l ON l.section_id = s.id
      LEFT JOIN public.teacher_assignments task ON task.id = l.assignment_id
     WHERE c.id = p_course_id
       AND public.content_is_visible(
           'course', c.id, c.visibility, c.owner_principal_id, c.tenant_id,
           p_principal_id, p_account_id, p_tenant_id
       )
     ORDER BY s.position, s.id, l.position, l.id;
$$;

CREATE OR REPLACE FUNCTION course_section_save(
    p_principal_id uuid,
    p_course_id    uuid,
    p_section_id   uuid,
    p_title        varchar,
    p_summary      varchar
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant   uuid;
    v_position integer;
    v_id       uuid;
BEGIN
    IF length(trim(coalesce(p_title, ''))) = 0 THEN RETURN NULL; END IF;
    SELECT c.tenant_id INTO v_tenant
      FROM public.courses c
     WHERE c.id = p_course_id AND c.owner_principal_id = p_principal_id;
    IF v_tenant IS NULL THEN RETURN NULL; END IF;

    IF p_section_id IS NULL THEN
        SELECT COALESCE(max(s.position), 0) + 1 INTO v_position
          FROM public.course_sections s WHERE s.course_id = p_course_id;
        INSERT INTO public.course_sections
            (tenant_id, course_id, title, summary, position)
        VALUES
            (v_tenant, p_course_id, trim(p_title), NULLIF(trim(p_summary), ''), v_position)
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.course_sections s
           SET title = trim(p_title),
               summary = NULLIF(trim(p_summary), ''),
               updated_at = now()
         WHERE s.id = p_section_id AND s.course_id = p_course_id
        RETURNING id INTO v_id;
    END IF;

    IF v_id IS NOT NULL THEN
        UPDATE public.courses SET updated_at = now() WHERE id = p_course_id;
    END IF;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION course_section_move(
    p_principal_id uuid,
    p_course_id    uuid,
    p_section_id   uuid,
    p_delta        integer
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_current   integer;
    v_neighbour record;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.courses c
         WHERE c.id = p_course_id AND c.owner_principal_id = p_principal_id
    ) THEN RETURN false; END IF;

    SELECT s.position INTO v_current
      FROM public.course_sections s
     WHERE s.id = p_section_id AND s.course_id = p_course_id;
    IF v_current IS NULL THEN RETURN false; END IF;

    IF p_delta < 0 THEN
        SELECT s.id, s.position INTO v_neighbour
          FROM public.course_sections s
         WHERE s.course_id = p_course_id AND s.position < v_current
         ORDER BY s.position DESC, s.id DESC LIMIT 1;
    ELSE
        SELECT s.id, s.position INTO v_neighbour
          FROM public.course_sections s
         WHERE s.course_id = p_course_id AND s.position > v_current
         ORDER BY s.position, s.id LIMIT 1;
    END IF;
    IF v_neighbour.id IS NULL THEN RETURN false; END IF;

    UPDATE public.course_sections SET position = v_current, updated_at = now()
     WHERE id = v_neighbour.id;
    UPDATE public.course_sections SET position = v_neighbour.position, updated_at = now()
     WHERE id = p_section_id;
    PERFORM public.course_items_sync_outline(p_course_id);
    UPDATE public.courses SET updated_at = now() WHERE id = p_course_id;
    RETURN true;
END;
$$;

/** An empty section may be removed; lessons must be dealt with explicitly. */
CREATE OR REPLACE FUNCTION course_section_delete(
    p_principal_id uuid,
    p_course_id    uuid,
    p_section_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_deleted integer := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.courses c
         WHERE c.id = p_course_id AND c.owner_principal_id = p_principal_id
    ) THEN RETURN false; END IF;
    IF EXISTS (
        SELECT 1 FROM public.course_lessons l WHERE l.section_id = p_section_id
    ) THEN RETURN false; END IF;
    IF (SELECT count(*) FROM public.course_sections s WHERE s.course_id = p_course_id) <= 1 THEN
        RETURN false;
    END IF;

    DELETE FROM public.course_sections s
     WHERE s.id = p_section_id AND s.course_id = p_course_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted = 1 THEN
        UPDATE public.courses SET updated_at = now() WHERE id = p_course_id;
    END IF;
    RETURN v_deleted = 1;
END;
$$;

CREATE OR REPLACE FUNCTION course_lesson_save(
    p_principal_id    uuid,
    p_course_id       uuid,
    p_section_id      uuid,
    p_lesson_id       uuid,
    p_title           varchar,
    p_summary         varchar,
    p_content         varchar,
    p_kind            varchar,
    p_assignment_id   uuid,
    p_estimated_minutes integer
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant         uuid;
    v_position       integer;
    v_id             uuid;
    v_old_assignment uuid;
    v_old_section    uuid;
BEGIN
    IF length(trim(coalesce(p_title, ''))) = 0 THEN RETURN NULL; END IF;
    IF p_kind NOT IN ('material', 'assignment') THEN RETURN NULL; END IF;
    IF (p_kind = 'material' AND p_assignment_id IS NOT NULL)
       OR (p_kind = 'assignment' AND p_assignment_id IS NULL) THEN RETURN NULL; END IF;
    IF p_estimated_minutes IS NOT NULL
       AND (p_estimated_minutes < 1 OR p_estimated_minutes > 600) THEN RETURN NULL; END IF;

    SELECT c.tenant_id INTO v_tenant
      FROM public.courses c
      JOIN public.course_sections s ON s.course_id = c.id
     WHERE c.id = p_course_id
       AND c.owner_principal_id = p_principal_id
       AND s.id = p_section_id;
    IF v_tenant IS NULL THEN RETURN NULL; END IF;
    IF p_assignment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.teacher_assignments task
         WHERE task.id = p_assignment_id AND task.owner_principal_id = p_principal_id
    ) THEN RETURN NULL; END IF;

    IF p_lesson_id IS NULL THEN
        SELECT COALESCE(max(l.position), 0) + 1 INTO v_position
          FROM public.course_lessons l WHERE l.section_id = p_section_id;
        INSERT INTO public.course_lessons
            (tenant_id, course_id, section_id, title, summary, content, kind,
             assignment_id, estimated_minutes, position)
        VALUES
            (v_tenant, p_course_id, p_section_id, trim(p_title),
             NULLIF(trim(p_summary), ''), NULLIF(trim(p_content), ''), p_kind,
             p_assignment_id, p_estimated_minutes, v_position)
        RETURNING id INTO v_id;
    ELSE
        SELECT l.assignment_id, l.section_id INTO v_old_assignment, v_old_section
          FROM public.course_lessons l
         WHERE l.id = p_lesson_id AND l.course_id = p_course_id;
        IF v_old_section IS DISTINCT FROM p_section_id THEN
            SELECT COALESCE(max(l.position), 0) + 1 INTO v_position
              FROM public.course_lessons l WHERE l.section_id = p_section_id;
        END IF;
        UPDATE public.course_lessons l
           SET section_id = p_section_id,
               position = CASE
                   WHEN v_old_section IS DISTINCT FROM p_section_id THEN v_position
                   ELSE l.position
               END,
               title = trim(p_title),
               summary = NULLIF(trim(p_summary), ''),
               content = NULLIF(trim(p_content), ''),
               kind = p_kind,
               assignment_id = p_assignment_id,
               estimated_minutes = p_estimated_minutes,
               updated_at = now()
         WHERE l.id = p_lesson_id AND l.course_id = p_course_id
        RETURNING id INTO v_id;
    END IF;

    -- course_items remains a compatibility index for old catalogue/API readers.
    IF v_id IS NOT NULL AND p_assignment_id IS NOT NULL THEN
        INSERT INTO public.course_items (course_id, assignment_id, position)
        SELECT p_course_id, p_assignment_id, COALESCE(max(i.position), 0) + 1
          FROM public.course_items i WHERE i.course_id = p_course_id
        ON CONFLICT (course_id, assignment_id) DO NOTHING;
    END IF;
    IF v_old_assignment IS NOT NULL AND v_old_assignment IS DISTINCT FROM p_assignment_id
       AND NOT EXISTS (
           SELECT 1 FROM public.course_lessons l
            WHERE l.course_id = p_course_id AND l.assignment_id = v_old_assignment
       ) THEN
        DELETE FROM public.course_items i
         WHERE i.course_id = p_course_id AND i.assignment_id = v_old_assignment;
    END IF;

    IF v_id IS NOT NULL THEN
        PERFORM public.course_items_sync_outline(p_course_id);
        UPDATE public.courses SET updated_at = now() WHERE id = p_course_id;
    END IF;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION course_lesson_move(
    p_principal_id uuid,
    p_course_id    uuid,
    p_lesson_id   uuid,
    p_delta        integer
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_section   uuid;
    v_current   integer;
    v_neighbour record;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.courses c
         WHERE c.id = p_course_id AND c.owner_principal_id = p_principal_id
    ) THEN RETURN false; END IF;
    SELECT l.section_id, l.position INTO v_section, v_current
      FROM public.course_lessons l
     WHERE l.id = p_lesson_id AND l.course_id = p_course_id;
    IF v_current IS NULL THEN RETURN false; END IF;

    IF p_delta < 0 THEN
        SELECT l.id, l.position INTO v_neighbour
          FROM public.course_lessons l
         WHERE l.section_id = v_section AND l.position < v_current
         ORDER BY l.position DESC, l.id DESC LIMIT 1;
    ELSE
        SELECT l.id, l.position INTO v_neighbour
          FROM public.course_lessons l
         WHERE l.section_id = v_section AND l.position > v_current
         ORDER BY l.position, l.id LIMIT 1;
    END IF;
    IF v_neighbour.id IS NULL THEN RETURN false; END IF;

    UPDATE public.course_lessons SET position = v_current, updated_at = now()
     WHERE id = v_neighbour.id;
    UPDATE public.course_lessons SET position = v_neighbour.position, updated_at = now()
     WHERE id = p_lesson_id;
    PERFORM public.course_items_sync_outline(p_course_id);
    UPDATE public.courses SET updated_at = now() WHERE id = p_course_id;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION course_lesson_delete(
    p_principal_id uuid,
    p_course_id    uuid,
    p_lesson_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_assignment uuid;
    v_deleted    integer := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.courses c
         WHERE c.id = p_course_id AND c.owner_principal_id = p_principal_id
    ) THEN RETURN false; END IF;
    SELECT l.assignment_id INTO v_assignment
      FROM public.course_lessons l
     WHERE l.id = p_lesson_id AND l.course_id = p_course_id;
    DELETE FROM public.course_lessons l
     WHERE l.id = p_lesson_id AND l.course_id = p_course_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    IF v_deleted = 1 AND v_assignment IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.course_lessons l
         WHERE l.course_id = p_course_id AND l.assignment_id = v_assignment
    ) THEN
        DELETE FROM public.course_items i
         WHERE i.course_id = p_course_id AND i.assignment_id = v_assignment;
    END IF;
    IF v_deleted = 1 THEN
        PERFORM public.course_items_sync_outline(p_course_id);
        UPDATE public.courses SET updated_at = now() WHERE id = p_course_id;
    END IF;
    RETURN v_deleted = 1;
END;
$$;

-- New courses start with a real outline. Existing callers keep the same
-- signature and therefore remain compatible.
CREATE OR REPLACE FUNCTION course_save(
    p_principal_id uuid,
    p_course_id    uuid,
    p_title        varchar,
    p_summary      varchar,
    p_age_band     varchar DEFAULT NULL,
    p_visibility   varchar DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_tenant uuid; v_id uuid;
BEGIN
    IF length(trim(coalesce(p_title, ''))) = 0 THEN RETURN NULL; END IF;
    IF p_visibility IS NOT NULL
       AND p_visibility NOT IN ('private', 'teachers', 'school', 'public') THEN
        RETURN NULL;
    END IF;

    IF p_course_id IS NULL THEN
        SELECT p.account_id INTO v_account FROM public.principals p WHERE p.id = p_principal_id;
        IF v_account IS NULL THEN RETURN NULL; END IF;
        SELECT task.tenant_id INTO v_tenant
          FROM public.teacher_assignments task
         WHERE task.owner_principal_id = p_principal_id LIMIT 1;
        IF v_tenant IS NULL THEN
            SELECT w.tenant_id INTO v_tenant
              FROM public.workspace_memberships m
              JOIN public.workspaces w ON w.id = m.workspace_id
             WHERE m.account_id = v_account AND m.state = 'active'
               AND w.kind = 'personal' AND w.status = 'active' LIMIT 1;
        END IF;
        IF v_tenant IS NULL THEN RETURN NULL; END IF;

        INSERT INTO public.courses
            (tenant_id, owner_principal_id, title, summary, age_band, visibility)
        VALUES
            (v_tenant, p_principal_id, trim(p_title), NULLIF(trim(p_summary), ''),
             NULLIF(trim(p_age_band), ''), COALESCE(p_visibility, 'private'))
        RETURNING id INTO v_id;
        PERFORM public.course_outline_ensure(v_id);
        RETURN v_id;
    END IF;

    UPDATE public.courses c
       SET title = trim(p_title),
           summary = NULLIF(trim(p_summary), ''),
           age_band = NULLIF(trim(p_age_band), ''),
           visibility = COALESCE(p_visibility, c.visibility),
           updated_at = now()
     WHERE c.id = p_course_id AND c.owner_principal_id = p_principal_id
    RETURNING c.id INTO v_id;
    RETURN v_id;
END;
$$;

-- Legacy "add assignment" callers also receive a lesson in the first section.
CREATE OR REPLACE FUNCTION course_item_set(
    p_principal_id  uuid,
    p_course_id     uuid,
    p_assignment_id uuid,
    p_included      boolean
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_next    integer;
    v_section uuid;
    v_tenant  uuid;
    v_task    record;
BEGIN
    SELECT c.tenant_id INTO v_tenant FROM public.courses c
     WHERE c.id = p_course_id AND c.owner_principal_id = p_principal_id;
    IF v_tenant IS NULL THEN RETURN false; END IF;
    SELECT task.title, task.goal INTO v_task
      FROM public.teacher_assignments task
     WHERE task.id = p_assignment_id AND task.owner_principal_id = p_principal_id;
    IF v_task.title IS NULL THEN RETURN false; END IF;

    IF p_included THEN
        SELECT COALESCE(max(i.position), 0) + 1 INTO v_next
          FROM public.course_items i WHERE i.course_id = p_course_id;
        INSERT INTO public.course_items (course_id, assignment_id, position)
        VALUES (p_course_id, p_assignment_id, v_next)
        ON CONFLICT (course_id, assignment_id) DO NOTHING;

        v_section := public.course_outline_ensure(p_course_id);
        IF NOT EXISTS (
            SELECT 1 FROM public.course_lessons l
             WHERE l.course_id = p_course_id AND l.assignment_id = p_assignment_id
        ) THEN
            SELECT COALESCE(max(l.position), 0) + 1 INTO v_next
              FROM public.course_lessons l WHERE l.section_id = v_section;
            INSERT INTO public.course_lessons
                (tenant_id, course_id, section_id, title, summary, kind,
                 assignment_id, position)
            VALUES
                (v_tenant, p_course_id, v_section, v_task.title, v_task.goal,
                 'assignment', p_assignment_id, v_next);
        END IF;
        PERFORM public.course_items_sync_outline(p_course_id);
    ELSE
        DELETE FROM public.course_lessons l
         WHERE l.course_id = p_course_id AND l.assignment_id = p_assignment_id;
        DELETE FROM public.course_items i
         WHERE i.course_id = p_course_id AND i.assignment_id = p_assignment_id;
    END IF;
    UPDATE public.courses SET updated_at = now() WHERE id = p_course_id;
    RETURN true;
END;
$$;

/** Copy the new outline after the legacy function has copied its assignments. */
CREATE OR REPLACE FUNCTION course_take_with_outline(
    p_principal_id uuid,
    p_course_id    uuid,
    p_account_id   uuid,
    p_tenant_id    uuid
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_target         uuid;
    v_target_tenant  uuid;
    v_source_section record;
    v_target_section uuid;
    v_source_lesson  record;
    v_target_task    uuid;
BEGIN
    v_target := public.course_take(p_principal_id, p_course_id, p_account_id, p_tenant_id);
    IF v_target IS NULL THEN RETURN NULL; END IF;
    SELECT c.tenant_id INTO v_target_tenant FROM public.courses c WHERE c.id = v_target;

    FOR v_source_section IN
        SELECT s.* FROM public.course_sections s
         WHERE s.course_id = p_course_id ORDER BY s.position, s.id
    LOOP
        INSERT INTO public.course_sections
            (tenant_id, course_id, title, summary, position)
        VALUES
            (v_target_tenant, v_target, v_source_section.title,
             v_source_section.summary, v_source_section.position)
        RETURNING id INTO v_target_section;

        FOR v_source_lesson IN
            SELECT l.* FROM public.course_lessons l
             WHERE l.section_id = v_source_section.id ORDER BY l.position, l.id
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
            INSERT INTO public.course_lessons
                (tenant_id, course_id, section_id, title, summary, content, kind,
                 assignment_id, estimated_minutes, position)
            VALUES
                (v_target_tenant, v_target, v_target_section, v_source_lesson.title,
                 v_source_lesson.summary, v_source_lesson.content,
                 CASE WHEN v_source_lesson.kind = 'assignment' AND v_target_task IS NULL
                      THEN 'material' ELSE v_source_lesson.kind END,
                 v_target_task, v_source_lesson.estimated_minutes,
                 v_source_lesson.position);
        END LOOP;
    END LOOP;
    PERFORM public.course_outline_ensure(v_target);
    RETURN v_target;
END;
$$;

REVOKE ALL ON FUNCTION course_outline_ensure(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_items_sync_outline(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_library_list(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_outline(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_section_save(uuid, uuid, uuid, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_section_move(uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_section_delete(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_lesson_save(
    uuid, uuid, uuid, uuid, varchar, varchar, varchar, varchar, uuid, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_lesson_move(uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_lesson_delete(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_take_with_outline(uuid, uuid, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION course_library_list(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_outline(uuid, uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_section_save(uuid, uuid, uuid, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_section_move(uuid, uuid, uuid, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_section_delete(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_lesson_save(
    uuid, uuid, uuid, uuid, varchar, varchar, varchar, varchar, uuid, integer
) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_lesson_move(uuid, uuid, uuid, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_lesson_delete(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_take_with_outline(uuid, uuid, uuid, uuid) TO asalab_app;
