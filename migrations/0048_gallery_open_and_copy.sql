-- Открыть работу в галерее и взять её себе.
--
-- До сих пор галерея была витриной: картинку видно, работу не открыть и не
-- взять. Смотреть на чужую модель и не иметь возможности разобрать её — это не
-- то, зачем в галерею ходят; ребёнок учится тем, что открывает чужое, видит из
-- чего оно собрано, и делает своё поверх.
--
-- Копия пересекает границу школы, и это единственное место, где документ
-- проекта переходит из одного арендатора в другой. Поэтому:
--   * копируется только опубликованная работа и только её последнее состояние;
--   * копия попадает в личные проекты того, кто её взял, и больше никуда;
--   * происхождение записывается навсегда и снять его нельзя.
--
-- Последнее — не бюрократия. Работы по учебным заданиям тоже попадают в
-- галерею, и без метки ребёнок возьмёт чужой замок и сдаст его как свой.
-- Метка не мешает учиться на чужой работе, но не даёт выдать её за свою:
-- преподаватель видит происхождение там же, где проверяет.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS copied_from_project_id uuid,
    ADD COLUMN IF NOT EXISTS copied_from_author varchar(120),
    ADD COLUMN IF NOT EXISTS copied_from_title varchar(255),
    ADD COLUMN IF NOT EXISTS copied_at timestamptz;

-- Происхождение либо есть целиком, либо его нет вовсе.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_copied_from_check;
ALTER TABLE projects
    ADD CONSTRAINT projects_copied_from_check
    CHECK (
        (copied_from_project_id IS NULL AND copied_from_author IS NULL
         AND copied_from_title IS NULL AND copied_at IS NULL)
        OR (copied_from_project_id IS NOT NULL AND copied_from_author IS NOT NULL
            AND copied_from_title IS NOT NULL AND copied_at IS NOT NULL)
    );

-- Метку нельзя снять и нельзя переписать: строка, которая один раз сказала
-- «это копия работы Х», говорит это до конца жизни проекта.
CREATE OR REPLACE FUNCTION projects_copy_origin_immutable()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.copied_from_project_id IS NOT NULL
       AND (NEW.copied_from_project_id IS DISTINCT FROM OLD.copied_from_project_id
            OR NEW.copied_from_author IS DISTINCT FROM OLD.copied_from_author
            OR NEW.copied_from_title IS DISTINCT FROM OLD.copied_from_title
            OR NEW.copied_at IS DISTINCT FROM OLD.copied_at) THEN
        RAISE EXCEPTION 'происхождение копии изменять нельзя';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_copy_origin_immutable ON projects;
CREATE TRIGGER projects_copy_origin_immutable
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION projects_copy_origin_immutable();

-- Одна опубликованная работа целиком: то, что показывает её страница.
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
    copied_from_title varchar
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
           -- Из чего собрана работа. Документ модели, а не её исходник в смысле
           -- программы: показывать его — то же, что дать разобрать чужую сборку.
           d.document_json,
           -- Если опубликована сама копия, происхождение видно и здесь.
           p.copied_from_author, p.copied_from_title
      FROM public.project_publications pub
      JOIN public.projects p ON p.id = pub.project_id
      LEFT JOIN public.project_drafts d ON d.project_id = pub.project_id
     WHERE pub.project_id = p_project_id;
$$;

-- Взять работу себе.
--
-- Возвращает id новой копии, или NULL если работа не опубликована. Копия всегда
-- личная: чужую работу нельзя положить сразу в класс, потому что классная
-- работа это то, что ученик сделал, а не то, что он принёс.
CREATE OR REPLACE FUNCTION gallery_copy_to_projects(
    p_principal_id uuid,
    p_project_id   uuid,
    p_title        varchar
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_source record;
    v_account uuid;
    v_tenant uuid;
    v_user uuid;
    v_new uuid;
    v_document jsonb;
BEGIN
    SELECT pub.project_id, pub.title, pub.module_key, pub.author_label,
           pub.owner_principal_id
      INTO v_source
      FROM public.project_publications pub
     WHERE pub.project_id = p_project_id;
    IF v_source.project_id IS NULL THEN RETURN NULL; END IF;

    -- Своё же брать незачем: оно и так есть.
    IF v_source.owner_principal_id = p_principal_id THEN RETURN NULL; END IF;

    SELECT p.account_id INTO v_account FROM public.principals p WHERE p.id = p_principal_id;
    IF v_account IS NULL THEN RETURN NULL; END IF;

    SELECT w.tenant_id INTO v_tenant
      FROM public.workspace_memberships m
      JOIN public.workspaces w ON w.id = m.workspace_id
     WHERE m.account_id = v_account AND m.state = 'active'
       AND w.kind = 'personal' AND w.status = 'active'
     LIMIT 1;
    IF v_tenant IS NULL THEN
        SELECT link.tenant_id INTO v_tenant
          FROM public.legacy_user_account_links link
         WHERE link.account_id = v_account AND link.migration_state = 'active'
         LIMIT 1;
    END IF;
    IF v_tenant IS NULL THEN RETURN NULL; END IF;

    SELECT link.user_id INTO v_user
      FROM public.legacy_user_account_links link
     WHERE link.account_id = v_account AND link.migration_state = 'active'
     LIMIT 1;

    SELECT d.document_json INTO v_document
      FROM public.project_drafts d WHERE d.project_id = p_project_id;

    INSERT INTO public.projects
        (tenant_id, module_key, title, status, created_by, project_scope,
         owner_principal_id, copied_from_project_id, copied_from_author,
         copied_from_title, copied_at)
    VALUES (v_tenant, v_source.module_key,
            COALESCE(NULLIF(trim(p_title), ''), v_source.title), 'active', v_user, 'personal',
            p_principal_id, p_project_id, v_source.author_label, v_source.title, now())
    RETURNING id INTO v_new;

    IF v_document IS NOT NULL THEN
        INSERT INTO public.project_drafts
            (tenant_id, project_id, document_json, revision, updated_by, updated_by_principal_id)
        VALUES (v_tenant, v_new, v_document, 1, v_user, p_principal_id);
    END IF;

    RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION gallery_work(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION gallery_copy_to_projects(uuid, uuid, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gallery_work(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION gallery_copy_to_projects(uuid, uuid, varchar) TO asalab_app;
