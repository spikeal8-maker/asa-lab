-- A task is written once and given out many times.
--
-- Until now an assignment belonged to one class. The same work in three classes
-- was three unrelated copies, editing the wording meant editing it three times,
-- and next September the whole set had to be typed again. That is not how a
-- teacher's material works: the task is theirs and outlives any one class.
--
-- So the task moves into a library the teacher owns, and what a class gets is a
-- handout of it — the same words, with its own deadline and its own open or
-- closed state. Learners' work hangs off the handout, so two classes doing the
-- same task never see each other, and a task retired from the library leaves
-- the work that was already done alone.

CREATE TABLE IF NOT EXISTS teacher_assignments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants(id),
    -- The teacher, as a principal: the library follows the person across the
    -- classes and the years, which is the whole point of having one.
    owner_principal_id uuid NOT NULL REFERENCES principals(id),
    title        varchar(255) NOT NULL,
    brief        varchar(4000),
    module_key   varchar(64) NOT NULL,
    sample_image varchar(128),
    demo_key     varchar(32),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CONSTRAINT teacher_assignments_title_check CHECK (length(trim(title)) > 0)
);
CREATE INDEX IF NOT EXISTS teacher_assignments_owner_idx
    ON teacher_assignments (owner_principal_id, created_at DESC);
-- One copy of each shipped task per teacher, however many classes they run.
CREATE UNIQUE INDEX IF NOT EXISTS teacher_assignments_demo_idx
    ON teacher_assignments (owner_principal_id, demo_key) WHERE demo_key IS NOT NULL;

GRANT SELECT ON teacher_assignments TO asalab_app;
ALTER TABLE teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_assignments FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teacher_assignments_tenant ON teacher_assignments;
CREATE POLICY teacher_assignments_tenant ON teacher_assignments
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- classroom_assignments becomes the handout: which task, to which class, by
-- when. The wording moves out; a pointer moves in.
ALTER TABLE classroom_assignments
    ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES teacher_assignments(id);

-- ── Move what exists ────────────────────────────────────────────────────────
DO $$
DECLARE
    v_row record;
    v_owner uuid;
    v_assignment uuid;
BEGIN
    FOR v_row IN
        SELECT a.*, c.created_by AS classroom_owner
          FROM public.classroom_assignments a
          JOIN public.classrooms c ON c.id = a.classroom_id
         WHERE a.assignment_id IS NULL
         ORDER BY a.created_at
    LOOP
        -- The teacher who made the class owns the task it was written for.
        SELECT p.id INTO v_owner
          FROM public.legacy_user_account_links link
          JOIN public.principals p ON p.account_id = link.account_id
         WHERE link.tenant_id = v_row.tenant_id
           AND link.user_id = v_row.classroom_owner
           AND link.migration_state = 'active'
         LIMIT 1;
        IF v_owner IS NULL THEN CONTINUE; END IF;

        -- Shipped tasks fold together by key; a teacher's own by exact wording,
        -- so the same task handed to three classes becomes one library entry.
        SELECT t.id INTO v_assignment
          FROM public.teacher_assignments t
         WHERE t.owner_principal_id = v_owner
           AND ((v_row.demo_key IS NOT NULL AND t.demo_key = v_row.demo_key)
                OR (v_row.demo_key IS NULL AND t.demo_key IS NULL
                    AND t.title = v_row.title
                    AND t.module_key = v_row.module_key
                    AND coalesce(t.brief, '') = coalesce(v_row.brief, '')))
         LIMIT 1;

        IF v_assignment IS NULL THEN
            INSERT INTO public.teacher_assignments
                (tenant_id, owner_principal_id, title, brief, module_key, sample_image,
                 demo_key, created_at)
            VALUES (v_row.tenant_id, v_owner, v_row.title, v_row.brief, v_row.module_key,
                    v_row.sample_image, v_row.demo_key, v_row.created_at)
            RETURNING id INTO v_assignment;
        END IF;

        UPDATE public.classroom_assignments
           SET assignment_id = v_assignment
         WHERE id = v_row.id;
    END LOOP;
END;
$$;

-- Anything that could not be matched to a teacher has no library entry and no
-- business being handed out; there is nothing like that in practice, and the
-- constraint says so from here on.
DELETE FROM classroom_assignment_work w
 WHERE w.assignment_id IN (SELECT id FROM classroom_assignments WHERE assignment_id IS NULL);
DELETE FROM classroom_assignments WHERE assignment_id IS NULL;

ALTER TABLE classroom_assignments ALTER COLUMN assignment_id SET NOT NULL;
-- One handout of a task per class: giving it twice means changing the deadline.
CREATE UNIQUE INDEX IF NOT EXISTS classroom_assignments_handout_idx
    ON classroom_assignments (classroom_id, assignment_id);

-- ── The library ─────────────────────────────────────────────────────────────

-- Write a task, or correct one. Correcting it corrects it everywhere it was
-- given out, which is the reason the library exists.
CREATE OR REPLACE FUNCTION teacher_assignment_save(
    p_principal_id uuid,
    p_assignment_id uuid,
    p_title varchar,
    p_brief varchar,
    p_module_key varchar
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_tenant uuid; v_id uuid;
BEGIN
    IF p_assignment_id IS NULL THEN
        -- A personal library needs a tenant to live in; the teacher's own.
        SELECT link.tenant_id INTO v_tenant
          FROM public.principals p
          JOIN public.legacy_user_account_links link ON link.account_id = p.account_id
         WHERE p.id = p_principal_id AND link.migration_state = 'active'
         LIMIT 1;
        IF v_tenant IS NULL THEN RETURN NULL; END IF;
        INSERT INTO public.teacher_assignments
            (tenant_id, owner_principal_id, title, brief, module_key)
        VALUES (v_tenant, p_principal_id, trim(p_title), NULLIF(trim(p_brief), ''), p_module_key)
        RETURNING id INTO v_id;
        RETURN v_id;
    END IF;

    UPDATE public.teacher_assignments t
       SET title = trim(p_title),
           brief = NULLIF(trim(p_brief), ''),
           module_key = p_module_key,
           updated_at = now()
     WHERE t.id = p_assignment_id AND t.owner_principal_id = p_principal_id
    RETURNING t.id INTO v_id;
    RETURN v_id;
END;
$$;

-- Everything this teacher has written, with where it has been given out. The
-- counts are what makes a library usable a year later: "the castle one, the
-- one I gave to three classes".
CREATE OR REPLACE FUNCTION teacher_assignment_list(p_principal_id uuid)
RETURNS TABLE (
    id uuid,
    title varchar,
    brief varchar,
    module_key varchar,
    sample_image varchar,
    demo_key varchar,
    created_at timestamptz,
    handout_count integer,
    started_count integer,
    submitted_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT t.id, t.title, t.brief, t.module_key, t.sample_image, t.demo_key, t.created_at,
           (SELECT count(*)::integer FROM public.classroom_assignments h
             WHERE h.assignment_id = t.id),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
              JOIN public.classroom_assignments h ON h.id = w.assignment_id
             WHERE h.assignment_id = t.id),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
              JOIN public.classroom_assignments h ON h.id = w.assignment_id
             WHERE h.assignment_id = t.id AND w.submitted_at IS NOT NULL)
      FROM public.teacher_assignments t
     WHERE t.owner_principal_id = p_principal_id
     ORDER BY (t.demo_key IS NOT NULL), t.created_at DESC;
$$;

-- Which classes have it, so the hand-out dialog can show ticks rather than ask
-- a teacher to remember.
CREATE OR REPLACE FUNCTION teacher_assignment_classrooms(
    p_principal_id uuid,
    p_assignment_id uuid
)
RETURNS TABLE (classroom_id uuid, classroom_title varchar, handed_out boolean, due_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title, h.id IS NOT NULL, h.due_at
      FROM public.principals p
      JOIN public.classroom_memberships m ON m.account_id = p.account_id
      JOIN public.classrooms c ON c.tenant_id = m.tenant_id AND c.id = m.classroom_id
      LEFT JOIN public.classroom_assignments h
        ON h.classroom_id = c.id AND h.assignment_id = p_assignment_id
     WHERE p.id = p_principal_id
       AND m.member_role IN ('owner', 'co_teacher')
       AND c.status = 'active'
     ORDER BY lower(c.title);
$$;

-- Give it out, or take it back. Taking it back leaves any work already started
-- with the learner who did it: their model is theirs.
CREATE OR REPLACE FUNCTION teacher_assignment_hand_out(
    p_principal_id  uuid,
    p_assignment_id uuid,
    p_classroom_id  uuid,
    p_given         boolean,
    p_due_at        timestamptz
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_tenant uuid; v_user uuid;
BEGIN
    SELECT m.tenant_id, m.user_id INTO v_tenant, v_user
      FROM public.principals p
      JOIN public.classroom_memberships m ON m.account_id = p.account_id
     WHERE p.id = p_principal_id
       AND m.classroom_id = p_classroom_id
       AND m.member_role IN ('owner', 'co_teacher');
    IF v_tenant IS NULL THEN RETURN false; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.teacher_assignments t
                    WHERE t.id = p_assignment_id AND t.owner_principal_id = p_principal_id) THEN
        RETURN false;
    END IF;

    IF p_given THEN
        INSERT INTO public.classroom_assignments
            (tenant_id, classroom_id, assignment_id, title, brief, module_key, due_at, created_by)
        SELECT v_tenant, p_classroom_id, t.id, t.title, t.brief, t.module_key, p_due_at, v_user
          FROM public.teacher_assignments t WHERE t.id = p_assignment_id
        ON CONFLICT (classroom_id, assignment_id) DO UPDATE SET due_at = EXCLUDED.due_at;
    ELSE
        DELETE FROM public.classroom_assignment_work w
         WHERE w.assignment_id IN (
            SELECT h.id FROM public.classroom_assignments h
             WHERE h.classroom_id = p_classroom_id AND h.assignment_id = p_assignment_id);
        DELETE FROM public.classroom_assignments h
         WHERE h.classroom_id = p_classroom_id AND h.assignment_id = p_assignment_id;
    END IF;
    RETURN true;
END;
$$;

-- Retiring a task. The handouts go with it; the work does not.
CREATE OR REPLACE FUNCTION teacher_assignment_delete(
    p_principal_id uuid,
    p_assignment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_removed integer := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.teacher_assignments t
                    WHERE t.id = p_assignment_id AND t.owner_principal_id = p_principal_id) THEN
        RETURN false;
    END IF;
    DELETE FROM public.classroom_assignment_work w
     WHERE w.assignment_id IN (SELECT h.id FROM public.classroom_assignments h
                                WHERE h.assignment_id = p_assignment_id);
    DELETE FROM public.classroom_assignments WHERE assignment_id = p_assignment_id;
    DELETE FROM public.teacher_assignments WHERE id = p_assignment_id;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    RETURN v_removed = 1;
END;
$$;

REVOKE ALL ON FUNCTION teacher_assignment_save(uuid, uuid, varchar, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_list(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_classrooms(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_hand_out(uuid, uuid, uuid, boolean, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_delete(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION teacher_assignment_save(uuid, uuid, varchar, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_list(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_classrooms(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_hand_out(uuid, uuid, uuid, boolean, timestamptz) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_delete(uuid, uuid) TO asalab_app;
