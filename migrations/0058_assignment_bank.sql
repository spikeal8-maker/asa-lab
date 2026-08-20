-- Банк заданий: папки, признаки, копии, архив.
--
-- Заданий у преподавателя за три года набирается двести, и лежат они одним
-- списком. Найти в нём «то, про светодиод, которое я давал восьмым в прошлом
-- году» невозможно — проще написать заново, что и происходит каждый сентябрь.
--
-- Хранилище становится двухслойным. Папки — одно дерево, задание лежит в одной
-- папке, как файл на диске: понятно без объяснений. Признаки — среда, возраст,
-- классы, учебные годы, происхождение — не папки, потому что пересекаются:
-- задание про светодиод это и «электроника», и «8 класс», и «2024/25». Их не
-- надо расставлять руками, они уже известны из самого задания и его выдач.
--
-- Старые годы убираются в архив, а не удаляются: вместе с заданием исчезли бы
-- выдачи и работы учеников за тот год.

CREATE TABLE IF NOT EXISTS assignment_folders (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          uuid NOT NULL REFERENCES tenants(id),
    owner_principal_id uuid NOT NULL REFERENCES principals(id),
    parent_id          uuid REFERENCES assignment_folders(id) ON DELETE CASCADE,
    title              varchar(120) NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CONSTRAINT assignment_folders_title_check CHECK (length(trim(title)) > 0)
);

-- Две «Электроники» рядом друг с другом — это не порядок, а его отсутствие.
CREATE UNIQUE INDEX IF NOT EXISTS assignment_folders_sibling_idx
    ON assignment_folders (owner_principal_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(title));
CREATE INDEX IF NOT EXISTS assignment_folders_owner_idx
    ON assignment_folders (owner_principal_id, parent_id);

GRANT SELECT ON assignment_folders TO asalab_app;
ALTER TABLE assignment_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_folders FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assignment_folders_tenant ON assignment_folders;
CREATE POLICY assignment_folders_tenant ON assignment_folders
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE teacher_assignments
    ADD COLUMN IF NOT EXISTS folder_id uuid,
    ADD COLUMN IF NOT EXISTS age_band varchar(16),
    ADD COLUMN IF NOT EXISTS archived_at timestamptz,
    ADD COLUMN IF NOT EXISTS copied_from_assignment_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'teacher_assignments_folder_fk'
    ) THEN
        -- Составной ключ: папка чужой полки не может забрать чужое задание.
        ALTER TABLE teacher_assignments
            ADD CONSTRAINT teacher_assignments_folder_fk
            FOREIGN KEY (tenant_id, folder_id)
            REFERENCES assignment_folders(tenant_id, id) ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS teacher_assignments_folder_idx
    ON teacher_assignments (owner_principal_id, folder_id);

/**
 * Учебный год по дате.
 *
 * Учебный год идёт с сентября по август: и сентябрьская, и мартовская выдача
 * относятся к одному году. Календарный год ответил бы, что это разные.
 */
CREATE OR REPLACE FUNCTION academic_year_label(p_at timestamptz)
RETURNS varchar
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_at IS NULL THEN NULL
        WHEN extract(month FROM p_at) >= 9
            THEN to_char(p_at, 'YYYY') || '/' || to_char(p_at + interval '1 year', 'YY')
        ELSE to_char(p_at - interval '1 year', 'YYYY') || '/' || to_char(p_at, 'YY')
    END::varchar;
$$;

/** Глубина папки: корень — 1. */
CREATE OR REPLACE FUNCTION assignment_folder_depth(p_folder_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH RECURSIVE up AS (
        SELECT f.id, f.parent_id, 1 AS depth
          FROM public.assignment_folders f WHERE f.id = p_folder_id
        UNION ALL
        SELECT f.id, f.parent_id, up.depth + 1
          FROM public.assignment_folders f
          JOIN up ON up.parent_id = f.id
    )
    SELECT COALESCE(max(depth), 0)::integer FROM up;
$$;

/**
 * Новая папка.
 *
 * Глубже четырёх уровней дерево перестаёт помогать и начинает прятать, поэтому
 * пятый не создаётся. Имя, уже занятое соседом, отклоняется.
 */
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
        -- Полка преподавателя там же, где его задания.
        SELECT t.tenant_id INTO v_tenant
          FROM public.teacher_assignments t
         WHERE t.owner_principal_id = p_principal_id
         LIMIT 1;
        IF v_tenant IS NULL THEN
            SELECT w.tenant_id INTO v_tenant
              FROM public.principals p
              JOIN public.workspace_memberships m ON m.account_id = p.account_id
              JOIN public.workspaces w ON w.id = m.workspace_id
             WHERE p.id = p_principal_id
               AND m.state = 'active'
               AND w.kind = 'personal'
               AND w.status = 'active'
             LIMIT 1;
        END IF;
        IF v_tenant IS NULL THEN RETURN NULL; END IF;
    END IF;

    INSERT INTO public.assignment_folders (tenant_id, owner_principal_id, parent_id, title)
    VALUES (v_tenant, p_principal_id, p_parent_id, trim(p_title))
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION assignment_folder_rename(
    p_principal_id uuid,
    p_folder_id    uuid,
    p_title        varchar
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_updated integer := 0;
BEGIN
    IF length(trim(coalesce(p_title, ''))) = 0 THEN RETURN false; END IF;
    UPDATE public.assignment_folders f
       SET title = trim(p_title), updated_at = now()
     WHERE f.id = p_folder_id AND f.owner_principal_id = p_principal_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

/** Перенос папки. Внутрь себя папка не переносится — дерево осталось бы без корня. */
CREATE OR REPLACE FUNCTION assignment_folder_move(
    p_principal_id uuid,
    p_folder_id    uuid,
    p_parent_id    uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_updated integer := 0;
    v_cycle   boolean;
BEGIN
    IF p_folder_id = p_parent_id THEN RETURN false; END IF;
    IF p_parent_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.assignment_folders f
             WHERE f.id = p_parent_id AND f.owner_principal_id = p_principal_id
        ) THEN RETURN false; END IF;

        WITH RECURSIVE down AS (
            SELECT f.id FROM public.assignment_folders f WHERE f.id = p_folder_id
            UNION ALL
            SELECT child.id
              FROM public.assignment_folders child
              JOIN down ON child.parent_id = down.id
        )
        SELECT EXISTS (SELECT 1 FROM down WHERE down.id = p_parent_id) INTO v_cycle;
        IF v_cycle THEN RETURN false; END IF;

        IF public.assignment_folder_depth(p_parent_id) >= 4 THEN RETURN false; END IF;
    END IF;

    UPDATE public.assignment_folders f
       SET parent_id = p_parent_id, updated_at = now()
     WHERE f.id = p_folder_id AND f.owner_principal_id = p_principal_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

/**
 * Удаление папки.
 *
 * Всё, что внутри, поднимается на уровень выше: потерять работу за три года,
 * промахнувшись по кнопке, нельзя. Удаляется именно папка, а не содержимое.
 */
CREATE OR REPLACE FUNCTION assignment_folder_delete(
    p_principal_id uuid,
    p_folder_id    uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_parent  uuid;
    v_exists  boolean;
    v_deleted integer := 0;
BEGIN
    SELECT true, f.parent_id INTO v_exists, v_parent
      FROM public.assignment_folders f
     WHERE f.id = p_folder_id AND f.owner_principal_id = p_principal_id;
    IF v_exists IS NOT TRUE THEN RETURN false; END IF;

    UPDATE public.teacher_assignments t
       SET folder_id = v_parent, updated_at = now()
     WHERE t.folder_id = p_folder_id;

    UPDATE public.assignment_folders f
       SET parent_id = v_parent, updated_at = now()
     WHERE f.parent_id = p_folder_id;

    DELETE FROM public.assignment_folders f WHERE f.id = p_folder_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted = 1;
END;
$$;

/**
 * Дерево папок со счётчиками.
 *
 * `direct_count` — заданий в самой папке, `total_count` — вместе с вложенными:
 * свёрнутая папка должна говорить, сколько в ней всего, иначе её незачем
 * сворачивать. `sort_path` держит порядок обхода — родитель перед детьми.
 */
CREATE OR REPLACE FUNCTION assignment_folder_tree(p_principal_id uuid)
RETURNS TABLE (
    id uuid,
    parent_id uuid,
    title varchar,
    depth integer,
    sort_path text,
    direct_count integer,
    total_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH RECURSIVE tree AS (
        SELECT f.id, f.parent_id, f.title, 1 AS depth,
               lower(f.title) || '/' AS sort_path
          FROM public.assignment_folders f
         WHERE f.owner_principal_id = p_principal_id AND f.parent_id IS NULL
        UNION ALL
        SELECT child.id, child.parent_id, child.title, tree.depth + 1,
               tree.sort_path || lower(child.title) || '/'
          FROM public.assignment_folders child
          JOIN tree ON child.parent_id = tree.id
    ),
    descendants AS (
        SELECT tree.id AS root_id, down.id AS folder_id
          FROM tree
          CROSS JOIN LATERAL (
              WITH RECURSIVE down AS (
                  SELECT tree.id AS id
                  UNION ALL
                  SELECT child.id
                    FROM public.assignment_folders child
                    JOIN down ON child.parent_id = down.id
              )
              SELECT down.id FROM down
          ) down
    )
    SELECT tree.id, tree.parent_id, tree.title, tree.depth, tree.sort_path,
           (SELECT count(*)::integer FROM public.teacher_assignments t
             WHERE t.owner_principal_id = p_principal_id
               AND t.folder_id = tree.id
               AND t.archived_at IS NULL),
           (SELECT count(*)::integer FROM public.teacher_assignments t
             WHERE t.owner_principal_id = p_principal_id
               AND t.archived_at IS NULL
               AND t.folder_id IN (SELECT d.folder_id FROM descendants d WHERE d.root_id = tree.id))
      FROM tree
     ORDER BY tree.sort_path;
$$;

/** Задание переезжает в папку. NULL — в корень полки. */
CREATE OR REPLACE FUNCTION teacher_assignment_move(
    p_principal_id  uuid,
    p_assignment_id uuid,
    p_folder_id     uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_updated integer := 0;
BEGIN
    IF p_folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.assignment_folders f
         WHERE f.id = p_folder_id AND f.owner_principal_id = p_principal_id
    ) THEN RETURN false; END IF;

    UPDATE public.teacher_assignments t
       SET folder_id = p_folder_id, updated_at = now()
     WHERE t.id = p_assignment_id AND t.owner_principal_id = p_principal_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

/**
 * В архив и обратно.
 *
 * Задание прошлого года уходит из списка, но остаётся в базе: вместе с ним
 * удалились бы выдачи и работы учеников за тот год.
 */
CREATE OR REPLACE FUNCTION teacher_assignment_archive(
    p_principal_id  uuid,
    p_assignment_id uuid,
    p_archived      boolean
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_updated integer := 0;
BEGIN
    UPDATE public.teacher_assignments t
       SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END,
           updated_at = now()
     WHERE t.id = p_assignment_id AND t.owner_principal_id = p_principal_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

/**
 * Своя версия задания.
 *
 * Правка на месте меняет задание всем классам, которым оно выдано, — это верно,
 * когда исправляют опечатку, и неверно, когда переделывают под один класс.
 * Копия ложится в ту же папку, помнит источник и живёт своей жизнью; готовый
 * курс остаётся готовым курсом.
 */
CREATE OR REPLACE FUNCTION teacher_assignment_copy(
    p_principal_id  uuid,
    p_assignment_id uuid,
    p_title         varchar DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_source record;
    v_id     uuid;
BEGIN
    SELECT * INTO v_source
      FROM public.teacher_assignments t
     WHERE t.id = p_assignment_id AND t.owner_principal_id = p_principal_id;
    IF v_source.id IS NULL THEN RETURN NULL; END IF;

    INSERT INTO public.teacher_assignments
        (tenant_id, owner_principal_id, title, brief, goal, module_key, age_band,
         sample_image, sample_bytes, sample_content_type, folder_id,
         copied_from_assignment_id)
    VALUES (v_source.tenant_id, p_principal_id,
            COALESCE(NULLIF(trim(p_title), ''), v_source.title || ' — моя версия'),
            v_source.brief, v_source.goal, v_source.module_key, v_source.age_band,
            v_source.sample_image, v_source.sample_bytes, v_source.sample_content_type,
            v_source.folder_id, v_source.id)
    RETURNING id INTO v_id;

    -- Копия образца указывает на исходное задание, пока у копии нет своих байтов.
    IF v_source.sample_bytes IS NOT NULL THEN
        UPDATE public.teacher_assignments t
           SET sample_image = '/api/assignments/' || v_id || '/sample'
         WHERE t.id = v_id;
    END IF;

    INSERT INTO public.teacher_assignment_images (tenant_id, assignment_id, bytes, content_type)
    SELECT i.tenant_id, v_id, i.bytes, i.content_type
      FROM public.teacher_assignment_images i
     WHERE i.assignment_id = v_source.id;

    RETURN v_id;
END;
$$;

/** Сохранение задания знает про папку и возраст. */
DROP FUNCTION IF EXISTS teacher_assignment_save(uuid, uuid, varchar, varchar, varchar, varchar);
CREATE OR REPLACE FUNCTION teacher_assignment_save(
    p_principal_id  uuid,
    p_assignment_id uuid,
    p_title         varchar,
    p_brief         varchar,
    p_module_key    varchar,
    p_goal          varchar DEFAULT NULL,
    p_folder_id     uuid DEFAULT NULL,
    p_age_band      varchar DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_account uuid; v_tenant uuid; v_id uuid; v_folder uuid;
BEGIN
    -- Чужая папка не принимает задание, даже если её номер прислали.
    SELECT f.id INTO v_folder
      FROM public.assignment_folders f
     WHERE f.id = p_folder_id AND f.owner_principal_id = p_principal_id;

    IF p_assignment_id IS NULL THEN
        SELECT p.account_id INTO v_account
          FROM public.principals p
         WHERE p.id = p_principal_id;
        IF v_account IS NULL THEN RETURN NULL; END IF;

        SELECT w.tenant_id INTO v_tenant
          FROM public.workspace_memberships m
          JOIN public.workspaces w ON w.id = m.workspace_id
         WHERE m.account_id = v_account
           AND m.state = 'active'
           AND w.kind = 'personal'
           AND w.status = 'active'
         LIMIT 1;

        IF v_tenant IS NULL THEN
            SELECT link.tenant_id INTO v_tenant
              FROM public.legacy_user_account_links link
             WHERE link.account_id = v_account AND link.migration_state = 'active'
             LIMIT 1;
        END IF;

        IF v_tenant IS NULL THEN
            SELECT m.tenant_id INTO v_tenant
              FROM public.classroom_memberships m
             WHERE m.account_id = v_account AND m.member_role = 'owner'
             ORDER BY m.created_at
             LIMIT 1;
        END IF;

        IF v_tenant IS NULL THEN RETURN NULL; END IF;

        INSERT INTO public.teacher_assignments
            (tenant_id, owner_principal_id, title, brief, module_key, goal,
             folder_id, age_band)
        VALUES (v_tenant, p_principal_id, trim(p_title), NULLIF(trim(p_brief), ''),
                p_module_key, NULLIF(trim(p_goal), ''), v_folder,
                NULLIF(trim(p_age_band), ''))
        RETURNING id INTO v_id;
        RETURN v_id;
    END IF;

    UPDATE public.teacher_assignments t
       SET title = trim(p_title),
           brief = NULLIF(trim(p_brief), ''),
           module_key = p_module_key,
           goal = NULLIF(trim(p_goal), ''),
           folder_id = v_folder,
           age_band = NULLIF(trim(p_age_band), ''),
           updated_at = now()
     WHERE t.id = p_assignment_id AND t.owner_principal_id = p_principal_id
    RETURNING t.id INTO v_id;
    RETURN v_id;
END;
$$;

/**
 * Банк заданий.
 *
 * К каждому заданию — папка, признаки и то, что известно из выдач: каким
 * классам выдавалось и в какие учебные годы. По этим строкам и отбирают.
 */
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

-- ── Готовый курс переезжает в свою папку ────────────────────────────────────
-- Пример, который нельзя тронуть, — не пример, а мебель: это обычная папка, её
-- можно переименовать, разобрать по своим или удалить целиком.
DO $$
DECLARE
    v_owner record;
    v_folder uuid;
BEGIN
    FOR v_owner IN
        SELECT DISTINCT t.owner_principal_id, t.tenant_id
          FROM public.teacher_assignments t
         WHERE t.demo_key IS NOT NULL AND t.folder_id IS NULL
    LOOP
        SELECT f.id INTO v_folder
          FROM public.assignment_folders f
         WHERE f.owner_principal_id = v_owner.owner_principal_id
           AND f.parent_id IS NULL
           AND lower(f.title) = 'готовый курс';
        IF v_folder IS NULL THEN
            INSERT INTO public.assignment_folders
                (tenant_id, owner_principal_id, parent_id, title)
            VALUES (v_owner.tenant_id, v_owner.owner_principal_id, NULL, 'Готовый курс')
            RETURNING id INTO v_folder;
        END IF;
        UPDATE public.teacher_assignments t
           SET folder_id = v_folder
         WHERE t.owner_principal_id = v_owner.owner_principal_id
           AND t.demo_key IS NOT NULL
           AND t.folder_id IS NULL;
    END LOOP;
END;
$$;

/** И новый класс кладёт готовый курс туда же. */
CREATE OR REPLACE FUNCTION classroom_assignments_seed_demo(p_classroom_id uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_author uuid;
    v_owner uuid;
    v_folder uuid;
    v_assignment uuid;
    v_added integer := 0;
    v_task record;
BEGIN
    SELECT c.tenant_id, c.created_by INTO v_tenant, v_author
      FROM public.classrooms c WHERE c.id = p_classroom_id AND c.status = 'active';
    IF v_tenant IS NULL THEN RETURN 0; END IF;

    SELECT p.id INTO v_owner
      FROM public.legacy_user_account_links link
      JOIN public.principals p ON p.account_id = link.account_id
     WHERE link.tenant_id = v_tenant
       AND link.user_id = v_author
       AND link.migration_state = 'active'
     LIMIT 1;
    IF v_owner IS NULL THEN RETURN 0; END IF;

    SELECT f.id INTO v_folder
      FROM public.assignment_folders f
     WHERE f.owner_principal_id = v_owner
       AND f.parent_id IS NULL
       AND lower(f.title) = 'готовый курс';
    IF v_folder IS NULL THEN
        INSERT INTO public.assignment_folders (tenant_id, owner_principal_id, parent_id, title)
        VALUES (v_tenant, v_owner, NULL, 'Готовый курс')
        RETURNING id INTO v_folder;
    END IF;

    FOR v_task IN SELECT * FROM public.classroom_demo_course() LOOP
        SELECT t.id INTO v_assignment
          FROM public.teacher_assignments t
         WHERE t.owner_principal_id = v_owner AND t.demo_key = v_task.demo_key;

        IF v_assignment IS NULL THEN
            INSERT INTO public.teacher_assignments
                (tenant_id, owner_principal_id, title, brief, goal, module_key,
                 sample_image, demo_key, folder_id)
            VALUES (v_tenant, v_owner, v_task.title, v_task.brief, v_task.goal, 'three-d',
                    '/assets/assignments/' || v_task.demo_key || '.jpg', v_task.demo_key,
                    v_folder)
            RETURNING id INTO v_assignment;
        END IF;

        INSERT INTO public.classroom_assignments
            (tenant_id, classroom_id, assignment_id, created_by)
        VALUES (v_tenant, p_classroom_id, v_assignment, v_author)
        ON CONFLICT (classroom_id, assignment_id) DO NOTHING;
        v_added := v_added + 1;
    END LOOP;

    RETURN v_added;
END;
$$;

REVOKE ALL ON FUNCTION academic_year_label(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION assignment_folder_depth(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assignment_folder_create(uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION assignment_folder_rename(uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION assignment_folder_move(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assignment_folder_delete(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assignment_folder_tree(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_move(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_archive(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_copy(uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_save(uuid, uuid, varchar, varchar, varchar, varchar, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION academic_year_label(timestamptz) TO asalab_app;
GRANT EXECUTE ON FUNCTION assignment_folder_depth(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION assignment_folder_create(uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION assignment_folder_rename(uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION assignment_folder_move(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION assignment_folder_delete(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION assignment_folder_tree(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_move(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_archive(uuid, uuid, boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_copy(uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_save(uuid, uuid, varchar, varchar, varchar, varchar, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_list(uuid) TO asalab_app;
