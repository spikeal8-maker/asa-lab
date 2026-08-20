-- Курсы и кому что видно.
--
-- Задание — единица работы, курс — единица преподавания: «Электроника, первый
-- год» это не двадцать разрозненных заданий, а порядок, в котором их проходят.
-- Курс поэтому не папка: папка отвечает «куда я это положил», курс — «что за
-- чем идёт и кому целиком отдаётся».
--
-- Второе: у всего написанного есть круг тех, кому оно видно. По умолчанию —
-- только автору. Дальше по возрастающей: названные коллеги, вся школа, все.
-- Порядок один и тот же для задания и для курса, потому что вопрос один и тот
-- же, и разные ответы в двух местах преподаватель не удержит в голове.
--
-- Чужое к себе попадает копией, а не ссылкой. Автор правит своё, а взявший —
-- своё: иначе исправленная у автора опечатка меняет урок в чужой школе
-- посреди четверти.

CREATE TABLE IF NOT EXISTS courses (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          uuid NOT NULL REFERENCES tenants(id),
    owner_principal_id uuid NOT NULL REFERENCES principals(id),
    title              varchar(160) NOT NULL,
    summary            varchar(600),
    -- private | teachers | school | public
    visibility         varchar(16) NOT NULL DEFAULT 'private',
    age_band           varchar(16),
    cover_assignment_id uuid,
    copied_from_course_id uuid REFERENCES courses(id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CONSTRAINT courses_title_check CHECK (length(trim(title)) > 0),
    CONSTRAINT courses_visibility_check
        CHECK (visibility IN ('private', 'teachers', 'school', 'public'))
);

CREATE INDEX IF NOT EXISTS courses_owner_idx ON courses (owner_principal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS courses_public_idx ON courses (visibility) WHERE visibility = 'public';

GRANT SELECT ON courses TO asalab_app;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS courses_tenant ON courses;
-- Общедоступный курс виден и из другой школы: в этом весь смысл слова
-- «общедоступный». Всё остальное живёт по границе своей школы.
CREATE POLICY courses_tenant ON courses
    USING (visibility = 'public' OR tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

/** Что за чем идёт. */
CREATE TABLE IF NOT EXISTS course_items (
    course_id     uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    assignment_id uuid NOT NULL REFERENCES teacher_assignments(id) ON DELETE CASCADE,
    position      integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (course_id, assignment_id)
);

CREATE INDEX IF NOT EXISTS course_items_order_idx ON course_items (course_id, position);

GRANT SELECT ON course_items TO asalab_app;
ALTER TABLE course_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_items FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS course_items_visible ON course_items;
CREATE POLICY course_items_visible ON course_items
    USING (EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_id))
    WITH CHECK (EXISTS (SELECT 1 FROM public.courses c WHERE c.id = course_id));

/**
 * Кому именно открыто.
 *
 * Список нужен только для «названным преподавателям»: «моей школе» и «всем»
 * описываются самим уровнем и списка не требуют.
 */
CREATE TABLE IF NOT EXISTS content_shares (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL REFERENCES tenants(id),
    -- assignment | course
    subject_kind   varchar(16) NOT NULL,
    subject_id     uuid NOT NULL,
    -- Кому открыли: аккаунт преподавателя.
    account_id     uuid NOT NULL REFERENCES accounts(id),
    granted_by     uuid NOT NULL REFERENCES principals(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (subject_kind, subject_id, account_id),
    CONSTRAINT content_shares_kind_check CHECK (subject_kind IN ('assignment', 'course'))
);

CREATE INDEX IF NOT EXISTS content_shares_account_idx ON content_shares (account_id, subject_kind);

GRANT SELECT ON content_shares TO asalab_app;
ALTER TABLE content_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_shares FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_shares_visible ON content_shares;
-- Строку видит и тот, кто открыл доступ, и тот, кому его открыли: второй иначе
-- не узнает, что коллега поделился с ним заданием.
CREATE POLICY content_shares_visible ON content_shares
    USING (
        tenant_id = current_setting('app.tenant_id', true)::uuid
        OR account_id = NULLIF(current_setting('app.account_id', true), '')::uuid
    )
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE teacher_assignments
    ADD COLUMN IF NOT EXISTS visibility varchar(16) NOT NULL DEFAULT 'private';

ALTER TABLE teacher_assignments DROP CONSTRAINT IF EXISTS teacher_assignments_visibility_check;
ALTER TABLE teacher_assignments
    ADD CONSTRAINT teacher_assignments_visibility_check
    CHECK (visibility IN ('private', 'teachers', 'school', 'public'));

CREATE INDEX IF NOT EXISTS teacher_assignments_public_idx
    ON teacher_assignments (visibility) WHERE visibility = 'public';

/**
 * Видно ли это тому, кто спрашивает.
 *
 * Один ответ на оба вопроса — про задание и про курс, — потому что вопрос один
 * и тот же: кому открыто и кто спрашивает.
 */
CREATE OR REPLACE FUNCTION content_is_visible(
    p_kind        varchar,
    p_subject_id  uuid,
    p_visibility  varchar,
    p_owner       uuid,
    p_tenant      uuid,
    p_principal   uuid,
    p_account     uuid,
    p_viewer_tenant uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT CASE
        WHEN p_owner = p_principal THEN true
        WHEN p_visibility = 'public' THEN true
        WHEN p_visibility = 'school' THEN p_tenant = p_viewer_tenant
        WHEN p_visibility = 'teachers' THEN EXISTS (
            SELECT 1 FROM public.content_shares s
             WHERE s.subject_kind = p_kind
               AND s.subject_id = p_subject_id
               AND s.account_id = p_account
        )
        ELSE false
    END;
$$;

/** Уровень доступа задания. Только владелец. */
CREATE OR REPLACE FUNCTION teacher_assignment_visibility_set(
    p_principal_id  uuid,
    p_assignment_id uuid,
    p_visibility    varchar
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_updated integer := 0;
BEGIN
    IF p_visibility NOT IN ('private', 'teachers', 'school', 'public') THEN RETURN false; END IF;
    UPDATE public.teacher_assignments t
       SET visibility = p_visibility, updated_at = now()
     WHERE t.id = p_assignment_id AND t.owner_principal_id = p_principal_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

/**
 * Открыть доступ названному преподавателю по почте.
 *
 * Почта, а не выбор из списка всех преподавателей платформы: список чужих имён
 * — это уже справочник людей, и показывать его ради «поделиться заданием»
 * незачем.
 */
CREATE OR REPLACE FUNCTION content_share_add(
    p_principal_id uuid,
    p_kind         varchar,
    p_subject_id   uuid,
    p_email        varchar
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant  uuid;
    v_account uuid;
BEGIN
    IF p_kind = 'assignment' THEN
        SELECT t.tenant_id INTO v_tenant FROM public.teacher_assignments t
         WHERE t.id = p_subject_id AND t.owner_principal_id = p_principal_id;
    ELSIF p_kind = 'course' THEN
        SELECT c.tenant_id INTO v_tenant FROM public.courses c
         WHERE c.id = p_subject_id AND c.owner_principal_id = p_principal_id;
    ELSE
        RETURN false;
    END IF;
    IF v_tenant IS NULL THEN RETURN false; END IF;

    SELECT a.id INTO v_account
      FROM public.accounts a
     WHERE lower(a.email) = lower(trim(p_email))
     LIMIT 1;
    IF v_account IS NULL THEN RETURN false; END IF;

    INSERT INTO public.content_shares (tenant_id, subject_kind, subject_id, account_id, granted_by)
    VALUES (v_tenant, p_kind, p_subject_id, v_account, p_principal_id)
    ON CONFLICT (subject_kind, subject_id, account_id) DO NOTHING;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION content_share_remove(
    p_principal_id uuid,
    p_kind         varchar,
    p_subject_id   uuid,
    p_account_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_deleted integer := 0;
BEGIN
    DELETE FROM public.content_shares s
     WHERE s.subject_kind = p_kind
       AND s.subject_id = p_subject_id
       AND s.account_id = p_account_id
       AND s.granted_by = p_principal_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted = 1;
END;
$$;

/** Кому открыт доступ — список для окна «Кому видно». */
CREATE OR REPLACE FUNCTION content_share_list(
    p_principal_id uuid,
    p_kind         varchar,
    p_subject_id   uuid
)
RETURNS TABLE (account_id uuid, email varchar, display_name varchar, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.account_id, a.email, COALESCE(pr.display_name, a.email), s.created_at
      FROM public.content_shares s
      JOIN public.accounts a ON a.id = s.account_id
      LEFT JOIN public.profiles pr ON pr.account_id = a.id
     WHERE s.subject_kind = p_kind
       AND s.subject_id = p_subject_id
       AND s.granted_by = p_principal_id
     ORDER BY s.created_at;
$$;

-- ── Курсы ───────────────────────────────────────────────────────────────────

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

        SELECT t.tenant_id INTO v_tenant
          FROM public.teacher_assignments t
         WHERE t.owner_principal_id = p_principal_id
         LIMIT 1;
        IF v_tenant IS NULL THEN
            SELECT w.tenant_id INTO v_tenant
              FROM public.workspace_memberships m
              JOIN public.workspaces w ON w.id = m.workspace_id
             WHERE m.account_id = v_account
               AND m.state = 'active'
               AND w.kind = 'personal'
               AND w.status = 'active'
             LIMIT 1;
        END IF;
        IF v_tenant IS NULL THEN RETURN NULL; END IF;

        INSERT INTO public.courses
            (tenant_id, owner_principal_id, title, summary, age_band, visibility)
        VALUES (v_tenant, p_principal_id, trim(p_title), NULLIF(trim(p_summary), ''),
                NULLIF(trim(p_age_band), ''), COALESCE(p_visibility, 'private'))
        RETURNING id INTO v_id;
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

CREATE OR REPLACE FUNCTION course_delete(p_principal_id uuid, p_course_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_deleted integer := 0;
BEGIN
    -- Удаляется курс, а не задания: они остаются в банке.
    DELETE FROM public.courses c
     WHERE c.id = p_course_id AND c.owner_principal_id = p_principal_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted = 1;
END;
$$;

/** Задание в курс, на своё место в порядке. */
CREATE OR REPLACE FUNCTION course_item_set(
    p_principal_id  uuid,
    p_course_id     uuid,
    p_assignment_id uuid,
    p_included      boolean
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_next integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.courses c
         WHERE c.id = p_course_id AND c.owner_principal_id = p_principal_id
    ) THEN RETURN false; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.teacher_assignments t
         WHERE t.id = p_assignment_id AND t.owner_principal_id = p_principal_id
    ) THEN RETURN false; END IF;

    IF p_included THEN
        SELECT COALESCE(max(i.position), 0) + 1 INTO v_next
          FROM public.course_items i WHERE i.course_id = p_course_id;
        INSERT INTO public.course_items (course_id, assignment_id, position)
        VALUES (p_course_id, p_assignment_id, v_next)
        ON CONFLICT (course_id, assignment_id) DO NOTHING;
    ELSE
        DELETE FROM public.course_items i
         WHERE i.course_id = p_course_id AND i.assignment_id = p_assignment_id;
    END IF;
    RETURN true;
END;
$$;

/** Порядок внутри курса: шаг вверх или вниз. */
CREATE OR REPLACE FUNCTION course_item_move(
    p_principal_id  uuid,
    p_course_id     uuid,
    p_assignment_id uuid,
    p_delta         integer
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_current integer;
    v_neighbour record;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.courses c
         WHERE c.id = p_course_id AND c.owner_principal_id = p_principal_id
    ) THEN RETURN false; END IF;

    SELECT i.position INTO v_current
      FROM public.course_items i
     WHERE i.course_id = p_course_id AND i.assignment_id = p_assignment_id;
    IF v_current IS NULL THEN RETURN false; END IF;

    IF p_delta < 0 THEN
        SELECT * INTO v_neighbour FROM public.course_items i
         WHERE i.course_id = p_course_id AND i.position < v_current
         ORDER BY i.position DESC LIMIT 1;
    ELSE
        SELECT * INTO v_neighbour FROM public.course_items i
         WHERE i.course_id = p_course_id AND i.position > v_current
         ORDER BY i.position LIMIT 1;
    END IF;
    IF v_neighbour.assignment_id IS NULL THEN RETURN false; END IF;

    UPDATE public.course_items SET position = v_current
     WHERE course_id = p_course_id AND assignment_id = v_neighbour.assignment_id;
    UPDATE public.course_items SET position = v_neighbour.position
     WHERE course_id = p_course_id AND assignment_id = p_assignment_id;
    RETURN true;
END;
$$;

/** Свои курсы. */
CREATE OR REPLACE FUNCTION course_list_for_principal(p_principal_id uuid)
RETURNS TABLE (
    id uuid,
    title varchar,
    summary varchar,
    visibility varchar,
    age_band varchar,
    item_count integer,
    shared_with integer,
    copied_from_course_id uuid,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title, c.summary, c.visibility, c.age_band,
           (SELECT count(*)::integer FROM public.course_items i WHERE i.course_id = c.id),
           (SELECT count(*)::integer FROM public.content_shares s
             WHERE s.subject_kind = 'course' AND s.subject_id = c.id),
           c.copied_from_course_id, c.created_at, c.updated_at
      FROM public.courses c
     WHERE c.owner_principal_id = p_principal_id
     ORDER BY c.created_at DESC;
$$;

/**
 * Общий каталог: курсы и задания, открытые тому, кто смотрит.
 *
 * Своё сюда не попадает — это витрина чужого, и «мои же задания» в ней только
 * мешают. Кто автор, видно строкой: у преподавателя должен быть выбор, брать
 * ли работу незнакомого человека.
 */
CREATE OR REPLACE FUNCTION shared_catalogue(
    p_principal_id uuid,
    p_account_id   uuid,
    p_tenant_id    uuid
)
RETURNS TABLE (
    kind varchar,
    id uuid,
    title varchar,
    summary varchar,
    module_key varchar,
    age_band varchar,
    visibility varchar,
    sample_image varchar,
    item_count integer,
    author_name varchar,
    author_school varchar,
    created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT 'course'::varchar, c.id, c.title, c.summary, NULL::varchar, c.age_band, c.visibility,
           (SELECT t.sample_image
              FROM public.course_items i
              JOIN public.teacher_assignments t ON t.id = i.assignment_id
             WHERE i.course_id = c.id AND t.sample_image IS NOT NULL
             ORDER BY i.position LIMIT 1),
           (SELECT count(*)::integer FROM public.course_items i WHERE i.course_id = c.id),
           COALESCE(author.display_name, 'Преподаватель')::varchar, school.title, c.created_at
      FROM public.courses c
      JOIN public.principals p ON p.id = c.owner_principal_id
      LEFT JOIN public.profiles author ON author.account_id = p.account_id
      LEFT JOIN public.tenants school ON school.id = c.tenant_id
     WHERE c.owner_principal_id <> p_principal_id
       AND public.content_is_visible('course', c.id, c.visibility, c.owner_principal_id,
                                     c.tenant_id, p_principal_id, p_account_id, p_tenant_id)
    UNION ALL
    SELECT 'assignment'::varchar, t.id, t.title, t.goal, t.module_key, t.age_band, t.visibility,
           t.sample_image, 1, COALESCE(author.display_name, 'Преподаватель')::varchar,
           school.title, t.created_at
      FROM public.teacher_assignments t
      JOIN public.principals p ON p.id = t.owner_principal_id
      LEFT JOIN public.profiles author ON author.account_id = p.account_id
      LEFT JOIN public.tenants school ON school.id = t.tenant_id
     WHERE t.owner_principal_id <> p_principal_id
       AND t.archived_at IS NULL
       -- Задание, лежащее в открытом курсе, показывается курсом, а не поштучно.
       AND NOT EXISTS (
           SELECT 1 FROM public.course_items i
            JOIN public.courses c ON c.id = i.course_id
           WHERE i.assignment_id = t.id AND c.visibility <> 'private'
       )
       AND public.content_is_visible('assignment', t.id, t.visibility, t.owner_principal_id,
                                     t.tenant_id, p_principal_id, p_account_id, p_tenant_id)
     ORDER BY 12 DESC;
$$;

/** Задания открытого курса — заглянуть внутрь до того, как забирать. */
CREATE OR REPLACE FUNCTION course_contents(
    p_course_id    uuid,
    p_principal_id uuid,
    p_account_id   uuid,
    p_tenant_id    uuid
)
RETURNS TABLE (
    id uuid,
    title varchar,
    goal varchar,
    module_key varchar,
    sample_image varchar,
    step_number integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT t.id, t.title, t.goal, t.module_key, t.sample_image, i.position
      FROM public.courses c
      JOIN public.course_items i ON i.course_id = c.id
      JOIN public.teacher_assignments t ON t.id = i.assignment_id
     WHERE c.id = p_course_id
       AND public.content_is_visible('course', c.id, c.visibility, c.owner_principal_id,
                                     c.tenant_id, p_principal_id, p_account_id, p_tenant_id)
     ORDER BY i.position;
$$;

/**
 * Забрать чужое себе.
 *
 * Копией, а не ссылкой: автор правит своё, взявший — своё. Иначе исправленная
 * у автора опечатка меняет урок в чужой школе посреди четверти. Курс забирается
 * целиком — вместе со своей папкой, чтобы двадцать заданий не рассыпались по
 * банку.
 */
CREATE OR REPLACE FUNCTION course_take(
    p_principal_id uuid,
    p_course_id    uuid,
    p_account_id   uuid,
    p_tenant_id    uuid
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_source  record;
    v_folder  uuid;
    v_course  uuid;
    v_tenant  uuid;
    v_item    record;
    v_copy    uuid;
    v_position integer := 0;
BEGIN
    SELECT * INTO v_source FROM public.courses c WHERE c.id = p_course_id;
    IF v_source.id IS NULL THEN RETURN NULL; END IF;
    IF NOT public.content_is_visible('course', v_source.id, v_source.visibility,
                                     v_source.owner_principal_id, v_source.tenant_id,
                                     p_principal_id, p_account_id, p_tenant_id) THEN
        RETURN NULL;
    END IF;

    SELECT t.tenant_id INTO v_tenant
      FROM public.teacher_assignments t
     WHERE t.owner_principal_id = p_principal_id
     LIMIT 1;
    IF v_tenant IS NULL THEN
        SELECT w.tenant_id INTO v_tenant
          FROM public.workspace_memberships m
          JOIN public.workspaces w ON w.id = m.workspace_id
         WHERE m.account_id = p_account_id
           AND m.state = 'active'
           AND w.kind = 'personal'
           AND w.status = 'active'
         LIMIT 1;
    END IF;
    IF v_tenant IS NULL THEN RETURN NULL; END IF;

    INSERT INTO public.assignment_folders (tenant_id, owner_principal_id, parent_id, title)
    VALUES (v_tenant, p_principal_id, NULL, left(v_source.title, 120))
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_folder;
    IF v_folder IS NULL THEN
        SELECT f.id INTO v_folder
          FROM public.assignment_folders f
         WHERE f.owner_principal_id = p_principal_id
           AND f.parent_id IS NULL
           AND lower(f.title) = lower(left(v_source.title, 120));
    END IF;

    INSERT INTO public.courses
        (tenant_id, owner_principal_id, title, summary, age_band, visibility,
         copied_from_course_id)
    VALUES (v_tenant, p_principal_id, v_source.title, v_source.summary, v_source.age_band,
            'private', v_source.id)
    RETURNING id INTO v_course;

    FOR v_item IN
        SELECT i.assignment_id, i.position
          FROM public.course_items i
         WHERE i.course_id = p_course_id
         ORDER BY i.position
    LOOP
        INSERT INTO public.teacher_assignments
            (tenant_id, owner_principal_id, title, brief, goal, module_key, age_band,
             sample_image, sample_bytes, sample_content_type, folder_id,
             copied_from_assignment_id, visibility)
        SELECT v_tenant, p_principal_id, t.title, t.brief, t.goal, t.module_key, t.age_band,
               t.sample_image, t.sample_bytes, t.sample_content_type, v_folder, t.id, 'private'
          FROM public.teacher_assignments t
         WHERE t.id = v_item.assignment_id
        RETURNING id INTO v_copy;

        IF v_copy IS NOT NULL THEN
            UPDATE public.teacher_assignments t
               SET sample_image = '/api/assignments/' || v_copy || '/sample'
             WHERE t.id = v_copy AND t.sample_bytes IS NOT NULL;

            INSERT INTO public.teacher_assignment_images (tenant_id, assignment_id, bytes, content_type)
            SELECT v_tenant, v_copy, i.bytes, i.content_type
              FROM public.teacher_assignment_images i
             WHERE i.assignment_id = v_item.assignment_id;

            v_position := v_position + 1;
            INSERT INTO public.course_items (course_id, assignment_id, position)
            VALUES (v_course, v_copy, v_position);
        END IF;
    END LOOP;

    RETURN v_course;
END;
$$;

/** Одно чужое задание себе. */
CREATE OR REPLACE FUNCTION assignment_take(
    p_principal_id  uuid,
    p_assignment_id uuid,
    p_account_id    uuid,
    p_tenant_id     uuid
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_source record;
    v_tenant uuid;
    v_copy   uuid;
BEGIN
    SELECT * INTO v_source FROM public.teacher_assignments t WHERE t.id = p_assignment_id;
    IF v_source.id IS NULL THEN RETURN NULL; END IF;
    IF NOT public.content_is_visible('assignment', v_source.id, v_source.visibility,
                                     v_source.owner_principal_id, v_source.tenant_id,
                                     p_principal_id, p_account_id, p_tenant_id) THEN
        RETURN NULL;
    END IF;

    SELECT t.tenant_id INTO v_tenant
      FROM public.teacher_assignments t
     WHERE t.owner_principal_id = p_principal_id
     LIMIT 1;
    IF v_tenant IS NULL THEN
        SELECT w.tenant_id INTO v_tenant
          FROM public.workspace_memberships m
          JOIN public.workspaces w ON w.id = m.workspace_id
         WHERE m.account_id = p_account_id
           AND m.state = 'active'
           AND w.kind = 'personal'
           AND w.status = 'active'
         LIMIT 1;
    END IF;
    IF v_tenant IS NULL THEN RETURN NULL; END IF;

    INSERT INTO public.teacher_assignments
        (tenant_id, owner_principal_id, title, brief, goal, module_key, age_band,
         sample_image, sample_bytes, sample_content_type, copied_from_assignment_id, visibility)
    VALUES (v_tenant, p_principal_id, v_source.title, v_source.brief, v_source.goal,
            v_source.module_key, v_source.age_band, v_source.sample_image, v_source.sample_bytes,
            v_source.sample_content_type, v_source.id, 'private')
    RETURNING id INTO v_copy;

    UPDATE public.teacher_assignments t
       SET sample_image = '/api/assignments/' || v_copy || '/sample'
     WHERE t.id = v_copy AND t.sample_bytes IS NOT NULL;

    INSERT INTO public.teacher_assignment_images (tenant_id, assignment_id, bytes, content_type)
    SELECT v_tenant, v_copy, i.bytes, i.content_type
      FROM public.teacher_assignment_images i
     WHERE i.assignment_id = v_source.id;

    RETURN v_copy;
END;
$$;

/** Банк отдаёт и уровень доступа: без него список не рассказывает, кому видно. */
DROP FUNCTION IF EXISTS teacher_assignment_list(uuid);
CREATE OR REPLACE FUNCTION teacher_assignment_list(p_principal_id uuid)
RETURNS TABLE (
    id uuid,
    title varchar,
    brief varchar,
    goal varchar,
    module_key varchar,
    age_band varchar,
    sample_image varchar,
    demo_key varchar,
    folder_id uuid,
    folder_title varchar,
    archived_at timestamptz,
    copied_from_assignment_id uuid,
    copied_from_title varchar,
    visibility varchar,
    shared_with integer,
    course_titles text[],
    created_at timestamptz,
    updated_at timestamptz,
    handout_count integer,
    started_count integer,
    submitted_count integer,
    classroom_titles text[],
    academic_years text[],
    last_handed_out_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT t.id, t.title, t.brief, t.goal, t.module_key, t.age_band, t.sample_image,
           t.demo_key, t.folder_id, folder.title, t.archived_at,
           t.copied_from_assignment_id, source.title,
           t.visibility,
           (SELECT count(*)::integer FROM public.content_shares s
             WHERE s.subject_kind = 'assignment' AND s.subject_id = t.id),
           COALESCE((SELECT array_agg(c.title ORDER BY c.title)
                       FROM public.course_items i
                       JOIN public.courses c ON c.id = i.course_id
                      WHERE i.assignment_id = t.id), ARRAY[]::text[]),
           t.created_at, t.updated_at,
           (SELECT count(*)::integer FROM public.classroom_assignments h
             WHERE h.assignment_id = t.id),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
              JOIN public.classroom_assignments h ON h.id = w.assignment_id
             WHERE h.assignment_id = t.id),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
              JOIN public.classroom_assignments h ON h.id = w.assignment_id
             WHERE h.assignment_id = t.id AND w.submitted_at IS NOT NULL),
           COALESCE((SELECT array_agg(DISTINCT c.title ORDER BY c.title)
                       FROM public.classroom_assignments h
                       JOIN public.classrooms c ON c.id = h.classroom_id
                      WHERE h.assignment_id = t.id), ARRAY[]::text[]),
           COALESCE((SELECT array_agg(DISTINCT public.academic_year_label(h.created_at)
                                      ORDER BY public.academic_year_label(h.created_at) DESC)
                       FROM public.classroom_assignments h
                      WHERE h.assignment_id = t.id), ARRAY[]::text[]),
           (SELECT max(h.created_at) FROM public.classroom_assignments h
             WHERE h.assignment_id = t.id)
      FROM public.teacher_assignments t
      LEFT JOIN public.assignment_folders folder ON folder.id = t.folder_id
      LEFT JOIN public.teacher_assignments source ON source.id = t.copied_from_assignment_id
     WHERE t.owner_principal_id = p_principal_id
     ORDER BY (t.demo_key IS NOT NULL), t.created_at DESC;
$$;

REVOKE ALL ON FUNCTION content_is_visible(varchar, uuid, varchar, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_visibility_set(uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_share_add(uuid, varchar, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_share_remove(uuid, varchar, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_share_list(uuid, varchar, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_save(uuid, uuid, varchar, varchar, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_delete(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_item_set(uuid, uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_item_move(uuid, uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_list_for_principal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION shared_catalogue(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_contents(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION course_take(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assignment_take(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_is_visible(varchar, uuid, varchar, uuid, uuid, uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_visibility_set(uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION content_share_add(uuid, varchar, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION content_share_remove(uuid, varchar, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION content_share_list(uuid, varchar, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_save(uuid, uuid, varchar, varchar, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_delete(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_item_set(uuid, uuid, uuid, boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_item_move(uuid, uuid, uuid, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_list_for_principal(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION shared_catalogue(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_contents(uuid, uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION course_take(uuid, uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION assignment_take(uuid, uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_list(uuid) TO asalab_app;
