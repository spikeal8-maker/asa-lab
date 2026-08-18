-- The gallery: work that was chosen to be shown, and what people say about it.
--
-- Reactions do not belong in a class. A class is thirty children doing the same
-- task at the same time, and showing them each other's work turns "look what
-- Alina made" into "copy what Alina made" — which is why a classmate cannot see
-- a classmate's work anywhere in this product. What can be reacted to is work
-- somebody deliberately published, finished, on a page that is not the lesson.
--
-- Who may publish:
--   * an account holder publishes their own work;
--   * a child on a class seat does not publish at all — their teacher chooses a
--     piece and shares it. A ten-year-old should not be deciding, mid-lesson,
--     to put their homework where the class can copy it, and a teacher should
--     be the one who looks at a picture before the school does.
--
-- What can be said: «нравится», «ого», and «выбор редакции». The first two are
-- anyone's, one of each per person, and only ever counted upward — there is no
-- dislike, and there is no comment box. A gallery of children's work with free
-- text under it needs a moderator, and a product without one should not offer
-- the field. The third is not a reaction at all: a teacher awards it.

CREATE TABLE IF NOT EXISTS project_publications (
    project_id      uuid PRIMARY KEY,
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    -- Whose work it is; not necessarily who published it.
    owner_principal_id uuid NOT NULL REFERENCES principals(id),
    -- The teacher, for a seat learner's work; the author otherwise.
    published_by_principal_id uuid NOT NULL REFERENCES principals(id),
    title           varchar(255) NOT NULL,
    module_key      varchar(64) NOT NULL,
    -- The name shown under the picture. Copied at publish time so the gallery
    -- does not read a roster across tenants on every page view.
    author_label    varchar(120) NOT NULL,
    -- Which revision's picture is being shown. The gallery is a shelf, not a
    -- window: work published in May keeps looking the way it did in May, and a
    -- learner who carries on building does not silently change what the school
    -- has already seen.
    snapshot_revision integer NOT NULL,
    editors_choice_at timestamptz,
    editors_choice_by uuid REFERENCES principals(id),
    published_at    timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
    CONSTRAINT project_publications_editors_choice_check
        CHECK ((editors_choice_at IS NULL) = (editors_choice_by IS NULL))
);

CREATE INDEX IF NOT EXISTS project_publications_recent_idx
    ON project_publications (published_at DESC);
CREATE INDEX IF NOT EXISTS project_publications_owner_idx
    ON project_publications (owner_principal_id);

CREATE TABLE IF NOT EXISTS project_reactions (
    project_id      uuid NOT NULL REFERENCES project_publications(project_id) ON DELETE CASCADE,
    reactor_principal_id uuid NOT NULL REFERENCES principals(id),
    kind            varchar(16) NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, reactor_principal_id, kind),
    CONSTRAINT project_reactions_kind_check CHECK (kind IN ('like', 'wow'))
);

CREATE INDEX IF NOT EXISTS project_reactions_project_idx ON project_reactions (project_id, kind);

-- Both tables are read across tenants on purpose: a gallery that only shows a
-- school its own work is not a gallery. Nothing here is written by the runtime
-- role directly; every change goes through the functions below, which check who
-- is asking.
GRANT SELECT ON project_publications TO asalab_app;
GRANT SELECT ON project_reactions TO asalab_app;

ALTER TABLE project_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_publications FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_publications_read ON project_publications;
CREATE POLICY project_publications_read ON project_publications FOR SELECT USING (true);

ALTER TABLE project_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_reactions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_reactions_read ON project_reactions;
CREATE POLICY project_reactions_read ON project_reactions FOR SELECT USING (true);

-- Publishing. Returns false rather than raising when the asker is not entitled:
-- the caller has already decided what to tell them.
CREATE OR REPLACE FUNCTION gallery_publish(
    p_principal_id uuid,
    p_project_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_owner uuid;
    v_title varchar;
    v_module varchar;
    v_label varchar;
    v_revision integer;
    v_allowed boolean := false;
BEGIN
    SELECT p.tenant_id, p.owner_principal_id, p.title, p.module_key
      INTO v_tenant, v_owner, v_title, v_module
      FROM public.projects p
     WHERE p.id = p_project_id AND p.status <> 'deleted';
    IF v_tenant IS NULL THEN RETURN false; END IF;

    -- The author, publishing their own.
    IF v_owner = p_principal_id THEN
        v_allowed := true;
    ELSE
        -- Or the teacher of the class the author sits in. A seat learner's work
        -- reaches the gallery this way and no other.
        SELECT true INTO v_allowed
          FROM public.principals author
          JOIN public.classroom_student_seats s ON s.id = author.seat_id
          JOIN public.classroom_memberships m
            ON m.classroom_id = s.classroom_id AND m.tenant_id = s.tenant_id
          JOIN public.principals teacher ON teacher.account_id = m.account_id
         WHERE author.id = v_owner
           AND s.status <> 'removed'
           AND m.member_role IN ('owner', 'co_teacher')
           AND teacher.id = p_principal_id
         LIMIT 1;
    END IF;
    IF v_allowed IS NOT true THEN RETURN false; END IF;

    -- A gallery entry is a picture. Without one there is nothing to show, and a
    -- row of grey placeholders is worse than an empty shelf.
    SELECT s.source_revision INTO v_revision
      FROM public.project_snapshots s WHERE s.project_id = p_project_id;
    IF v_revision IS NULL THEN RETURN false; END IF;

    -- The name under the picture: what the roster already shows for a seat, the
    -- account's display name otherwise. Never an email, never a login handle.
    SELECT COALESCE(
             (SELECT s.display_label
                FROM public.principals author
                JOIN public.classroom_student_seats s ON s.id = author.seat_id
               WHERE author.id = v_owner AND s.status <> 'removed'),
             (SELECT pr.display_name
                FROM public.principals author
                JOIN public.profiles pr ON pr.account_id = author.account_id
               WHERE author.id = v_owner),
             'Автор')
      INTO v_label;

    INSERT INTO public.project_publications
        (project_id, tenant_id, owner_principal_id, published_by_principal_id,
         title, module_key, author_label, snapshot_revision)
    VALUES (p_project_id, v_tenant, v_owner, p_principal_id,
            v_title, v_module, v_label, v_revision)
    ON CONFLICT (project_id) DO UPDATE
        SET title = EXCLUDED.title,
            author_label = EXCLUDED.author_label,
            snapshot_revision = EXCLUDED.snapshot_revision,
            published_at = now();
    RETURN true;
END;
$$;

-- Taking it down: the author, whoever put it up, or a teacher of the author's
-- class. Reactions go with it — they were about a picture that is no longer on
-- the wall, and keeping them would resurrect a count if it were ever reposted.
CREATE OR REPLACE FUNCTION gallery_unpublish(
    p_principal_id uuid,
    p_project_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_removed integer := 0;
BEGIN
    DELETE FROM public.project_publications pub
     WHERE pub.project_id = p_project_id
       AND (pub.owner_principal_id = p_principal_id
            OR pub.published_by_principal_id = p_principal_id
            OR EXISTS (
                SELECT 1
                  FROM public.principals author
                  JOIN public.classroom_student_seats s ON s.id = author.seat_id
                  JOIN public.classroom_memberships m
                    ON m.classroom_id = s.classroom_id AND m.tenant_id = s.tenant_id
                  JOIN public.principals teacher ON teacher.account_id = m.account_id
                 WHERE author.id = pub.owner_principal_id
                   AND m.member_role IN ('owner', 'co_teacher')
                   AND teacher.id = p_principal_id));
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    RETURN v_removed = 1;
END;
$$;

-- The wall. Sorted newest first, or by how much people liked it.
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
     WHERE p_module_key IS NULL OR pub.module_key = p_module_key
     ORDER BY
       CASE WHEN p_sort = 'popular' THEN
         (SELECT count(*) FROM public.project_reactions r WHERE r.project_id = pub.project_id)
       END DESC NULLS LAST,
       pub.published_at DESC
     LIMIT greatest(1, least(coalesce(p_limit, 24), 60))
    OFFSET greatest(0, coalesce(p_offset, 0));
$$;

-- One of each per person, on or off. Nobody reacts to their own work: it is a
-- gallery, not a scoreboard to run up.
CREATE OR REPLACE FUNCTION gallery_react(
    p_principal_id uuid,
    p_project_id   uuid,
    p_kind         varchar,
    p_on           boolean
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_owner uuid;
BEGIN
    IF p_kind NOT IN ('like', 'wow') THEN RETURN false; END IF;
    SELECT pub.owner_principal_id INTO v_owner
      FROM public.project_publications pub WHERE pub.project_id = p_project_id;
    IF v_owner IS NULL OR v_owner = p_principal_id THEN RETURN false; END IF;

    IF p_on THEN
        INSERT INTO public.project_reactions (project_id, reactor_principal_id, kind)
        VALUES (p_project_id, p_principal_id, p_kind)
        ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM public.project_reactions r
         WHERE r.project_id = p_project_id
           AND r.reactor_principal_id = p_principal_id
           AND r.kind = p_kind;
    END IF;
    RETURN true;
END;
$$;

-- «Выбор редакции» is awarded, not felt. Only a teacher, and the caller has
-- already established that this principal holds the educator capability.
CREATE OR REPLACE FUNCTION gallery_editors_choice(
    p_principal_id uuid,
    p_project_id   uuid,
    p_on           boolean
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_updated integer := 0;
BEGIN
    UPDATE public.project_publications pub
       SET editors_choice_at = CASE WHEN p_on THEN now() END,
           editors_choice_by = CASE WHEN p_on THEN p_principal_id END
     WHERE pub.project_id = p_project_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

-- The picture of a published work, for anyone signed in. project_snapshots is
-- tenant-scoped and must stay that way; this is the one door that reads across
-- tenants, and it opens only for a project that is on the wall.
CREATE OR REPLACE FUNCTION gallery_snapshot(p_project_id uuid)
RETURNS TABLE (image bytea, content_type varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.image, s.content_type
      FROM public.project_snapshots s
      JOIN public.project_publications pub ON pub.project_id = s.project_id
     WHERE s.project_id = p_project_id;
$$;

-- Whether one project is on the wall, for the button on its own page.
CREATE OR REPLACE FUNCTION gallery_state(
    p_principal_id uuid,
    p_project_id   uuid
)
RETURNS TABLE (published boolean, published_at timestamptz, like_count integer, wow_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT true, pub.published_at,
           (SELECT count(*)::integer FROM public.project_reactions r
             WHERE r.project_id = pub.project_id AND r.kind = 'like'),
           (SELECT count(*)::integer FROM public.project_reactions r
             WHERE r.project_id = pub.project_id AND r.kind = 'wow')
      FROM public.project_publications pub
     WHERE pub.project_id = p_project_id
       AND (pub.owner_principal_id = p_principal_id
            OR pub.published_by_principal_id = p_principal_id);
$$;

REVOKE ALL ON FUNCTION gallery_publish(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION gallery_unpublish(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION gallery_list(uuid, varchar, varchar, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION gallery_react(uuid, uuid, varchar, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION gallery_editors_choice(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION gallery_snapshot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION gallery_state(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gallery_publish(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION gallery_unpublish(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION gallery_list(uuid, varchar, varchar, integer, integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION gallery_react(uuid, uuid, varchar, boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION gallery_editors_choice(uuid, uuid, boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION gallery_snapshot(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION gallery_state(uuid, uuid) TO asalab_app;
