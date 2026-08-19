-- Коллекции: избранное из галереи.
--
-- Раздел был статической заглушкой и стоял в меню рядом с галереей, отчего обе
-- двери выглядели одинаково непонятно. Теперь у него есть смысл, не пересекающийся
-- ни с чем: подборка ссылок на чужие работы, отложенных себе.
--
-- Преподаватель увидел на стене хороший замок — «в коллекцию», в подборку
-- «Примеры для 6 класса», и на уроке показал всё сразу. Ученик сохранил то, что
-- его зацепило. Ни то, ни другое не копирует работу и ничего не забирает у
-- автора: в подборке лежит ссылка, и если автор снял работу со стены, она
-- пропадает и из подборок.
--
-- Чем коллекции не являются: складом собственных материалов преподавателя —
-- это Задания, и второй такой раздел только развёл бы правду по двум местам.

CREATE TABLE IF NOT EXISTS collections (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_principal_id uuid NOT NULL REFERENCES principals(id),
    title       varchar(120) NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT collections_title_check CHECK (length(trim(title)) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS collections_owner_idx ON collections (owner_principal_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collection_items (
    collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    -- Ссылка на публикацию, а не на проект: коллекция собирается из того, что
    -- висит на стене. Снятая со стены работа уходит и отсюда.
    project_id  uuid NOT NULL REFERENCES project_publications(project_id) ON DELETE CASCADE,
    added_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (collection_id, project_id)
);

GRANT SELECT ON collections TO asalab_app;
GRANT SELECT ON collection_items TO asalab_app;

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collections_read ON collections;
CREATE POLICY collections_read ON collections FOR SELECT USING (true);

ALTER TABLE collection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_items FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collection_items_read ON collection_items;
CREATE POLICY collection_items_read ON collection_items FOR SELECT USING (true);

/** Подборки этого человека и сколько в каждой работ. */
CREATE OR REPLACE FUNCTION collection_list(p_principal_id uuid)
RETURNS TABLE (id uuid, title varchar, item_count integer, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title,
           (SELECT count(*)::integer FROM public.collection_items i WHERE i.collection_id = c.id),
           c.created_at
      FROM public.collections c
     WHERE c.owner_principal_id = p_principal_id
     ORDER BY c.created_at DESC;
$$;

/** Что лежит в подборке — с картинкой и автором, как на стене. */
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
    added_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT pub.project_id, pub.title, pub.module_key, pub.author_label,
           pub.snapshot_revision, pub.editors_choice_at IS NOT NULL, i.added_at
      FROM public.collections c
      JOIN public.collection_items i ON i.collection_id = c.id
      JOIN public.project_publications pub ON pub.project_id = i.project_id
     WHERE c.id = p_collection_id AND c.owner_principal_id = p_principal_id
     ORDER BY i.added_at DESC;
$$;

CREATE OR REPLACE FUNCTION collection_create(
    p_principal_id uuid,
    p_title        varchar
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
    IF length(trim(coalesce(p_title, ''))) = 0 THEN RETURN NULL; END IF;
    INSERT INTO public.collections (owner_principal_id, title)
    VALUES (p_principal_id, trim(p_title))
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION collection_rename(
    p_principal_id  uuid,
    p_collection_id uuid,
    p_title         varchar
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_updated integer := 0;
BEGIN
    IF length(trim(coalesce(p_title, ''))) = 0 THEN RETURN false; END IF;
    UPDATE public.collections c
       SET title = trim(p_title), updated_at = now()
     WHERE c.id = p_collection_id AND c.owner_principal_id = p_principal_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION collection_delete(
    p_principal_id  uuid,
    p_collection_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_removed integer := 0;
BEGIN
    DELETE FROM public.collections c
     WHERE c.id = p_collection_id AND c.owner_principal_id = p_principal_id;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    RETURN v_removed = 1;
END;
$$;

/** Положить работу в подборку или вынуть её оттуда. */
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
        -- Только то, что действительно висит на стене.
        IF NOT EXISTS (
            SELECT 1 FROM public.project_publications pub WHERE pub.project_id = p_project_id
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

/** В каких подборках уже лежит эта работа — для кнопки на карточке. */
CREATE OR REPLACE FUNCTION collections_holding(
    p_principal_id uuid,
    p_project_id   uuid
)
RETURNS TABLE (collection_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT i.collection_id
      FROM public.collection_items i
      JOIN public.collections c ON c.id = i.collection_id
     WHERE c.owner_principal_id = p_principal_id AND i.project_id = p_project_id;
$$;

REVOKE ALL ON FUNCTION collection_list(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION collection_items_list(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION collection_create(uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION collection_rename(uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION collection_delete(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION collection_set_item(uuid, uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION collections_holding(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collection_list(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION collection_items_list(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION collection_create(uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION collection_rename(uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION collection_delete(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION collection_set_item(uuid, uuid, uuid, boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION collections_holding(uuid, uuid) TO asalab_app;
