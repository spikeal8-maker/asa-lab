-- Где живут свои вещи преподавателя.
--
-- Один и тот же поиск «куда положить новое» повторялся в каждой функции, и в
-- каждой был чуть свой: где-то смотрели только личное пространство, где-то
-- сначала уже написанные задания. Преподаватель из школы, у которого личного
-- пространства нет и заданий ещё не было, не мог ни создать курс, ни забрать
-- чужой: поиск возвращал пусто, а вызов — «не найдено» на пустом месте.
--
-- Порядок теперь один и записан один раз: личное пространство, затем перенос из
-- старых аккаунтов, затем школа, где он ведёт класс, и только потом — то место,
-- где уже лежат его задания.

CREATE OR REPLACE FUNCTION principal_home_tenant(p_principal_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_account uuid;
    v_tenant  uuid;
BEGIN
    SELECT p.account_id INTO v_account FROM public.principals p WHERE p.id = p_principal_id;
    IF v_account IS NULL THEN RETURN NULL; END IF;

    SELECT w.tenant_id INTO v_tenant
      FROM public.workspace_memberships m
      JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE m.account_id = v_account
       AND m.state = 'active'
       AND w.kind = 'personal'
       AND w.status = 'active'
     LIMIT 1;
    IF v_tenant IS NOT NULL THEN RETURN v_tenant; END IF;

    SELECT link.tenant_id INTO v_tenant
      FROM public.legacy_user_account_links link
     WHERE link.account_id = v_account AND link.migration_state = 'active'
     LIMIT 1;
    IF v_tenant IS NOT NULL THEN RETURN v_tenant; END IF;

    SELECT m.tenant_id INTO v_tenant
      FROM public.classroom_memberships m
     WHERE m.account_id = v_account AND m.member_role IN ('owner', 'co_teacher')
     ORDER BY m.created_at
     LIMIT 1;
    IF v_tenant IS NOT NULL THEN RETURN v_tenant; END IF;

    -- Уже написанное лежит там же: если что-то есть, там и есть его дом.
    SELECT t.tenant_id INTO v_tenant
      FROM public.teacher_assignments t
     WHERE t.owner_principal_id = p_principal_id
     LIMIT 1;
    RETURN v_tenant;
END;
$$;

/** Курс заводится там же, где всё остальное этого преподавателя. */
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
DECLARE v_tenant uuid; v_id uuid;
BEGIN
    IF length(trim(coalesce(p_title, ''))) = 0 THEN RETURN NULL; END IF;
    IF p_visibility IS NOT NULL
       AND p_visibility NOT IN ('private', 'teachers', 'school', 'public') THEN
        RETURN NULL;
    END IF;

    IF p_course_id IS NULL THEN
        v_tenant := public.principal_home_tenant(p_principal_id);
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

/** Взять чужой курс себе: тот же дом, тот же порядок поиска. */
CREATE OR REPLACE FUNCTION course_take(
    p_principal_id uuid,
    p_course_id    uuid,
    p_account_id   uuid,
    p_tenant_id    uuid
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_source   record;
    v_folder   uuid;
    v_course   uuid;
    v_tenant   uuid;
    v_item     record;
    v_copy     uuid;
    v_position integer := 0;
BEGIN
    SELECT * INTO v_source FROM public.courses c WHERE c.id = p_course_id;
    IF v_source.id IS NULL THEN RETURN NULL; END IF;
    IF NOT public.content_is_visible('course', v_source.id, v_source.visibility,
                                     v_source.owner_principal_id, v_source.tenant_id,
                                     p_principal_id, p_account_id, p_tenant_id) THEN
        RETURN NULL;
    END IF;

    v_tenant := public.principal_home_tenant(p_principal_id);
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

            INSERT INTO public.teacher_assignment_images
                (tenant_id, assignment_id, bytes, content_type)
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

/** И одно чужое задание. */
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

    v_tenant := public.principal_home_tenant(p_principal_id);
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

/** Папка — там же. */
CREATE OR REPLACE FUNCTION assignment_folder_create(
    p_principal_id uuid,
    p_parent_id    uuid,
    p_title        varchar
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_id     uuid;
BEGIN
    IF length(trim(coalesce(p_title, ''))) = 0 THEN RETURN NULL; END IF;

    IF p_parent_id IS NOT NULL THEN
        SELECT f.tenant_id INTO v_tenant
          FROM public.assignment_folders f
         WHERE f.id = p_parent_id AND f.owner_principal_id = p_principal_id;
        IF v_tenant IS NULL THEN RETURN NULL; END IF;
        IF public.assignment_folder_depth(p_parent_id) >= 4 THEN RETURN NULL; END IF;
    ELSE
        v_tenant := public.principal_home_tenant(p_principal_id);
        IF v_tenant IS NULL THEN RETURN NULL; END IF;
    END IF;

    INSERT INTO public.assignment_folders (tenant_id, owner_principal_id, parent_id, title)
    VALUES (v_tenant, p_principal_id, p_parent_id, trim(p_title))
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION principal_home_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION principal_home_tenant(uuid) TO asalab_app;
