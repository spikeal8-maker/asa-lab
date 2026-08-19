-- Свойства работы: описание, теги, кому видно, под какой лицензией.
--
-- До сих пор у проекта было только имя. Этого хватает, пока работа лежит на
-- своей полке, и совершенно не хватает, как только она попадает на общую стену:
-- зритель видит картинку и не понимает, что это, автор не может сказать «это
-- урок про резьбу, вот теги», и никто не знает, можно ли брать работу за основу.
--
-- Заодно исчезает отдельный пункт «поделиться в галерее». Публикация — это не
-- действие сбоку, а состояние работы, и живёт оно там же, где имя: в свойствах.
--   частная       — видна только владельцу;
--   по ссылке     — открывается тем, кому дали адрес, но на стене не висит;
--   общедоступная — висит на стене и ищется.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS description varchar(2000),
    ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS license varchar(32) NOT NULL DEFAULT 'reserved';

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_license_check;
ALTER TABLE projects
    ADD CONSTRAINT projects_license_check
    CHECK (license IN ('reserved', 'public-domain', 'cc-by', 'cc-by-sa', 'cc-by-nc'));

-- Десять тегов — предел, за которым перечисление перестаёт помогать искать.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_tags_check;
ALTER TABLE projects
    ADD CONSTRAINT projects_tags_check
    CHECK (array_length(tags, 1) IS NULL OR array_length(tags, 1) <= 10);

-- Кому видна опубликованная работа. Строка публикации есть и у «по ссылке»:
-- её открывают по адресу, но в списке стены она не появляется.
ALTER TABLE project_publications
    ADD COLUMN IF NOT EXISTS visibility varchar(16) NOT NULL DEFAULT 'public';

ALTER TABLE project_publications DROP CONSTRAINT IF EXISTS project_publications_visibility_check;
ALTER TABLE project_publications
    ADD CONSTRAINT project_publications_visibility_check
    CHECK (visibility IN ('link', 'public'));

/**
 * Свойства работы, как их правит автор.
 *
 * Теги приходят списком и здесь же приводятся к порядку: обрезаются пробелы,
 * пустые выбрасываются, регистр опускается — иначе «Робот», «робот» и «робот »
 * станут тремя разными тегами и поиск по ним развалится.
 */
CREATE OR REPLACE FUNCTION project_properties_save(
    p_principal_id uuid,
    p_project_id   uuid,
    p_title        varchar,
    p_description  varchar,
    p_tags         text[],
    p_license      varchar
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_updated integer := 0;
    v_tags text[];
BEGIN
    SELECT array_agg(DISTINCT tag)
      INTO v_tags
      FROM (
          SELECT left(lower(trim(value)), 32) AS tag
            FROM unnest(COALESCE(p_tags, '{}')) AS value
           WHERE length(trim(value)) > 0
           LIMIT 10
      ) cleaned;

    UPDATE public.projects p
       SET title = COALESCE(NULLIF(trim(p_title), ''), p.title),
           description = NULLIF(trim(COALESCE(p_description, '')), ''),
           tags = COALESCE(v_tags, '{}'),
           license = COALESCE(NULLIF(trim(p_license), ''), p.license)
     WHERE p.id = p_project_id
       AND p.owner_principal_id = p_principal_id
       AND p.status <> 'deleted';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

/**
 * Кому видна работа.
 *
 * «Частная» снимает публикацию совсем — вместе с реакциями, потому что они были
 * о работе, которой на стене больше нет. Остальные два состояния публикацию
 * заводят или переводят одно в другое.
 */
CREATE OR REPLACE FUNCTION project_visibility_set(
    p_principal_id uuid,
    p_project_id   uuid,
    p_visibility   varchar
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_ok boolean;
BEGIN
    IF p_visibility NOT IN ('private', 'link', 'public') THEN RETURN false; END IF;

    IF p_visibility = 'private' THEN
        RETURN public.gallery_unpublish(p_principal_id, p_project_id);
    END IF;

    v_ok := public.gallery_publish(p_principal_id, p_project_id);
    IF NOT v_ok THEN RETURN false; END IF;

    UPDATE public.project_publications pub
       SET visibility = p_visibility
     WHERE pub.project_id = p_project_id;
    RETURN true;
END;
$$;

-- Стена показывает только общедоступное. Работа «по ссылке» открывается по
-- своему адресу и в перечислении не участвует.
CREATE OR REPLACE FUNCTION gallery_list(
    p_principal_id uuid,
    p_sort         varchar,
    p_module_key   varchar,
    p_limit        integer,
    p_offset       integer
)
RETURNS TABLE (
    project_id uuid,
    title varchar,
    module_key varchar,
    author_label varchar,
    published_at timestamptz,
    snapshot_revision integer,
    editors_choice boolean,
    like_count integer,
    wow_count integer,
    viewer_liked boolean,
    viewer_wowed boolean,
    viewer_may_remove boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT pub.project_id, pub.title, pub.module_key, pub.author_label, pub.published_at,
           pub.snapshot_revision,
           pub.editors_choice_at IS NOT NULL,
           (SELECT count(*)::integer FROM public.project_reactions r
             WHERE r.project_id = pub.project_id AND r.kind = 'like'),
           (SELECT count(*)::integer FROM public.project_reactions r
             WHERE r.project_id = pub.project_id AND r.kind = 'wow'),
           EXISTS (SELECT 1 FROM public.project_reactions r
                    WHERE r.project_id = pub.project_id AND r.kind = 'like'
                      AND r.reactor_principal_id = p_principal_id),
           EXISTS (SELECT 1 FROM public.project_reactions r
                    WHERE r.project_id = pub.project_id AND r.kind = 'wow'
                      AND r.reactor_principal_id = p_principal_id),
           pub.owner_principal_id = p_principal_id
             OR pub.published_by_principal_id = p_principal_id
      FROM public.project_publications pub
     WHERE pub.visibility = 'public'
       AND (p_module_key IS NULL OR pub.module_key = p_module_key)
     ORDER BY
       CASE WHEN p_sort = 'popular' THEN
         (SELECT count(*) FROM public.project_reactions r WHERE r.project_id = pub.project_id)
       END DESC NULLS LAST,
       pub.published_at DESC
     LIMIT greatest(1, least(coalesce(p_limit, 24), 60))
    OFFSET greatest(0, coalesce(p_offset, 0));
$$;

-- Страница одной работы отдаёт и описание с тегами: зритель должен понимать,
-- что перед ним, а не угадывать по картинке.
DROP FUNCTION IF EXISTS gallery_work(uuid, uuid);
CREATE OR REPLACE FUNCTION gallery_work(
    p_principal_id uuid,
    p_project_id   uuid
)
RETURNS TABLE (
    project_id uuid,
    title varchar,
    module_key varchar,
    author_label varchar,
    published_at timestamptz,
    snapshot_revision integer,
    editors_choice boolean,
    like_count integer,
    wow_count integer,
    viewer_liked boolean,
    viewer_wowed boolean,
    viewer_may_remove boolean,
    viewer_is_author boolean,
    document_json jsonb,
    copied_from_author varchar,
    copied_from_title varchar,
    description varchar,
    tags text[],
    license varchar,
    visibility varchar,
    copy_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT pub.project_id, pub.title, pub.module_key, pub.author_label, pub.published_at,
           pub.snapshot_revision,
           pub.editors_choice_at IS NOT NULL,
           (SELECT count(*)::integer FROM public.project_reactions r
             WHERE r.project_id = pub.project_id AND r.kind = 'like'),
           (SELECT count(*)::integer FROM public.project_reactions r
             WHERE r.project_id = pub.project_id AND r.kind = 'wow'),
           EXISTS (SELECT 1 FROM public.project_reactions r
                    WHERE r.project_id = pub.project_id AND r.kind = 'like'
                      AND r.reactor_principal_id = p_principal_id),
           EXISTS (SELECT 1 FROM public.project_reactions r
                    WHERE r.project_id = pub.project_id AND r.kind = 'wow'
                      AND r.reactor_principal_id = p_principal_id),
           pub.owner_principal_id = p_principal_id
             OR pub.published_by_principal_id = p_principal_id,
           pub.owner_principal_id = p_principal_id,
           d.document_json,
           p.copied_from_author, p.copied_from_title,
           p.description, p.tags, p.license, pub.visibility,
           -- Сколько раз работу взяли за основу. Число, ради которого автор
           -- вообще выкладывает: его работой воспользовались столько раз.
           (SELECT count(*)::integer FROM public.projects copy
             WHERE copy.copied_from_project_id = pub.project_id)
      FROM public.project_publications pub
      JOIN public.projects p ON p.id = pub.project_id
      LEFT JOIN public.project_drafts d ON d.project_id = pub.project_id
     WHERE pub.project_id = p_project_id;
$$;

REVOKE ALL ON FUNCTION project_properties_save(uuid, uuid, varchar, varchar, text[], varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION project_visibility_set(uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION gallery_list(uuid, varchar, varchar, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION gallery_work(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_properties_save(uuid, uuid, varchar, varchar, text[], varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION project_visibility_set(uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION gallery_list(uuid, varchar, varchar, integer, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION gallery_work(uuid, uuid) TO asalab_app;

-- Коллекции принимают и свои работы, не только чужие со стены: в референсе
-- «Добавить в коллекцию» стоит в меню собственного проекта.
ALTER TABLE collection_items
    DROP CONSTRAINT IF EXISTS collection_items_project_id_fkey;
ALTER TABLE collection_items
    ADD CONSTRAINT collection_items_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION collection_set_item(
    p_principal_id  uuid,
    p_collection_id uuid,
    p_project_id    uuid,
    p_inside        boolean
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.collections c
         WHERE c.id = p_collection_id AND c.owner_principal_id = p_principal_id
    ) THEN
        RETURN false;
    END IF;

    IF p_inside THEN
        -- Своя работа или та, что висит на стене. Чужую непубличную в подборку
        -- не положишь — её и увидеть нельзя.
        IF NOT EXISTS (
            SELECT 1 FROM public.project_publications pub WHERE pub.project_id = p_project_id
        ) AND NOT EXISTS (
            SELECT 1 FROM public.projects p
             WHERE p.id = p_project_id AND p.owner_principal_id = p_principal_id
        ) THEN
            RETURN false;
        END IF;
        INSERT INTO public.collection_items (collection_id, project_id)
        VALUES (p_collection_id, p_project_id)
        ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM public.collection_items i
         WHERE i.collection_id = p_collection_id AND i.project_id = p_project_id;
    END IF;
    RETURN true;
END;
$$;

-- Содержимое подборки: своя работа показывается своей картинкой, чужая — той,
-- что висит на стене.
DROP FUNCTION IF EXISTS collection_items_list(uuid, uuid);
CREATE OR REPLACE FUNCTION collection_items_list(
    p_principal_id uuid,
    p_collection_id uuid
)
RETURNS TABLE (
    project_id uuid,
    title varchar,
    module_key varchar,
    author_label varchar,
    snapshot_revision integer,
    editors_choice boolean,
    published boolean,
    added_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT p.id, p.title, p.module_key,
           COALESCE(pub.author_label, 'Ваша работа')::varchar,
           COALESCE(pub.snapshot_revision, snapshot.source_revision, 0),
           pub.editors_choice_at IS NOT NULL,
           pub.project_id IS NOT NULL,
           i.added_at
      FROM public.collections c
      JOIN public.collection_items i ON i.collection_id = c.id
      JOIN public.projects p ON p.id = i.project_id
      LEFT JOIN public.project_publications pub ON pub.project_id = p.id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = p.id
     WHERE c.id = p_collection_id AND c.owner_principal_id = p_principal_id
     ORDER BY i.added_at DESC;
$$;

REVOKE ALL ON FUNCTION collection_set_item(uuid, uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION collection_items_list(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collection_set_item(uuid, uuid, uuid, boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION collection_items_list(uuid, uuid) TO asalab_app;

-- Состояние публикации теперь включает и то, кому работа видна: диалогу свойств
-- нужно показать выбранное, а не гадать.
DROP FUNCTION IF EXISTS gallery_state(uuid, uuid);
CREATE OR REPLACE FUNCTION gallery_state(
    p_principal_id uuid,
    p_project_id   uuid
)
RETURNS TABLE (
    published boolean,
    visibility varchar,
    published_at timestamptz,
    like_count integer,
    wow_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT true, pub.visibility, pub.published_at,
           (SELECT count(*)::integer FROM public.project_reactions r
             WHERE r.project_id = pub.project_id AND r.kind = 'like'),
           (SELECT count(*)::integer FROM public.project_reactions r
             WHERE r.project_id = pub.project_id AND r.kind = 'wow')
      FROM public.project_publications pub
     WHERE pub.project_id = p_project_id
       AND (pub.owner_principal_id = p_principal_id
            OR pub.published_by_principal_id = p_principal_id);
$$;

REVOKE ALL ON FUNCTION gallery_state(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gallery_state(uuid, uuid) TO asalab_app;
