-- The class side, reading from the library.
--
-- 0038 moved the wording into a task the teacher owns and left the handout
-- carrying a stale copy of it. This removes the copy, so a correction is a
-- correction everywhere the task was given out rather than in the one class the
-- teacher happened to be looking at.

ALTER TABLE classroom_assignments DROP COLUMN IF EXISTS title;
ALTER TABLE classroom_assignments DROP COLUMN IF EXISTS brief;
ALTER TABLE classroom_assignments DROP COLUMN IF EXISTS module_key;
ALTER TABLE classroom_assignments DROP COLUMN IF EXISTS demo_key;
ALTER TABLE classroom_assignments DROP COLUMN IF EXISTS sample_image;

-- Handing out no longer copies anything; it records that this class has it.
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
            (tenant_id, classroom_id, assignment_id, due_at, created_by)
        VALUES (v_tenant, p_classroom_id, p_assignment_id, p_due_at, v_user)
        ON CONFLICT (classroom_id, assignment_id) DO UPDATE SET due_at = EXCLUDED.due_at;
    ELSE
        -- Taking a task back removes it from the class. Work already started
        -- keeps its project: a learner model is theirs, not the handout's.
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

-- Writing a task from inside a class stays possible, because that is where a
-- teacher usually is standing. It writes to the library and hands it to this
-- class in one act.
DROP FUNCTION IF EXISTS classroom_assignment_create(uuid, uuid, varchar, varchar, varchar, timestamptz);
CREATE OR REPLACE FUNCTION classroom_assignment_create(
    p_principal_id uuid,
    p_classroom_id uuid,
    p_title        varchar,
    p_brief        varchar,
    p_module_key   varchar,
    p_due_at       timestamptz
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_assignment uuid;
BEGIN
    v_assignment := public.teacher_assignment_save(
        p_principal_id, NULL, p_title, p_brief, p_module_key);
    IF v_assignment IS NULL THEN RETURN NULL; END IF;
    IF NOT public.teacher_assignment_hand_out(
        p_principal_id, v_assignment, p_classroom_id, true, p_due_at) THEN
        DELETE FROM public.teacher_assignments WHERE id = v_assignment;
        RETURN NULL;
    END IF;
    RETURN v_assignment;
END;
$$;

DROP FUNCTION IF EXISTS classroom_assignment_list(uuid, uuid);
CREATE OR REPLACE FUNCTION classroom_assignment_list(
    p_account_id   uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    id uuid,
    assignment_id uuid,
    title varchar,
    brief varchar,
    module_key varchar,
    due_at timestamptz,
    status varchar,
    created_at timestamptz,
    demo_key varchar,
    sample_image varchar,
    seat_count integer,
    started_count integer,
    submitted_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT h.id, t.id, t.title, t.brief, t.module_key, h.due_at, h.status, h.created_at,
           t.demo_key, t.sample_image,
           (SELECT count(*)::integer FROM public.classroom_student_seats s
             WHERE s.tenant_id = h.tenant_id AND s.classroom_id = h.classroom_id
               AND s.status <> 'removed'),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
             WHERE w.assignment_id = h.id),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
             WHERE w.assignment_id = h.id AND w.submitted_at IS NOT NULL)
      FROM public.classroom_assignments h
      JOIN public.teacher_assignments t ON t.id = h.assignment_id
     WHERE h.classroom_id = p_classroom_id
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships m
            WHERE m.account_id = p_account_id
              AND m.classroom_id = p_classroom_id
              AND m.tenant_id = h.tenant_id
              AND m.member_role IN ('owner', 'co_teacher'))
     ORDER BY (t.demo_key IS NOT NULL), h.created_at DESC;
$$;

DROP FUNCTION IF EXISTS classroom_assignments_for_seat(uuid);
CREATE OR REPLACE FUNCTION classroom_assignments_for_seat(p_seat_id uuid)
RETURNS TABLE (
    id uuid,
    title varchar,
    brief varchar,
    module_key varchar,
    due_at timestamptz,
    status varchar,
    sample_image varchar,
    project_id uuid,
    submitted_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT h.id, t.title, t.brief, t.module_key, h.due_at, h.status, t.sample_image,
           w.project_id, w.submitted_at
      FROM public.classroom_student_seats s
      JOIN public.classroom_assignments h
        ON h.tenant_id = s.tenant_id AND h.classroom_id = s.classroom_id
      JOIN public.teacher_assignments t ON t.id = h.assignment_id
      LEFT JOIN public.classroom_assignment_work w
        ON w.assignment_id = h.id AND w.seat_id = s.id
     WHERE s.id = p_seat_id
       AND s.status = 'active'
       AND (h.status = 'open' OR w.project_id IS NOT NULL)
     ORDER BY (w.submitted_at IS NOT NULL), h.created_at;
$$;

-- How many pieces of work a learner still owes, for the dot on their class.
CREATE OR REPLACE FUNCTION classroom_seat_assignment_counts(p_seat_id uuid)
RETURNS TABLE (open_count integer, unfinished_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT count(*)::integer,
           count(*) FILTER (WHERE w.submitted_at IS NULL)::integer
      FROM public.classroom_student_seats s
      JOIN public.classroom_assignments h
        ON h.tenant_id = s.tenant_id AND h.classroom_id = s.classroom_id
      LEFT JOIN public.classroom_assignment_work w
        ON w.assignment_id = h.id AND w.seat_id = s.id
     WHERE s.id = p_seat_id AND s.status = 'active' AND h.status = 'open';
$$;

-- The shipped course, written into the library once and handed to the class. A
-- teacher running six classes gets ten tasks, not sixty.
CREATE OR REPLACE FUNCTION classroom_assignments_seed_demo(p_classroom_id uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_owner uuid;
    v_author uuid;
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

    FOR v_task IN
        SELECT t.id, t.demo_key FROM public.teacher_assignments t
         WHERE t.owner_principal_id = v_owner AND t.demo_key IS NOT NULL
    LOOP
        INSERT INTO public.classroom_assignments
            (tenant_id, classroom_id, assignment_id, created_by)
        VALUES (v_tenant, p_classroom_id, v_task.id, v_author)
        ON CONFLICT (classroom_id, assignment_id) DO NOTHING;
        IF FOUND THEN v_added := v_added + 1; END IF;
    END LOOP;

    RETURN v_added;
END;
$$;

REVOKE ALL ON FUNCTION classroom_assignment_create(uuid, uuid, varchar, varchar, varchar, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignment_list(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignments_for_seat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_seat_assignment_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_assignment_create(uuid, uuid, varchar, varchar, varchar, timestamptz) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignment_list(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignments_for_seat(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_seat_assignment_counts(uuid) TO asalab_app;
