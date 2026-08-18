-- The point of the task, said once and set apart.
--
-- A brief is a paragraph, and a child reading a paragraph does not always come
-- away knowing what the work is actually for. So the thing being learned gets
-- its own line — shown highlighted above the description, in the class list, on
-- the learner's card and on the strip over the editor.
--
-- It is separate from the brief rather than its first line so that it stays
-- one sentence: a field that holds 160 characters cannot quietly become three
-- more paragraphs.

ALTER TABLE teacher_assignments
    ADD COLUMN IF NOT EXISTS goal varchar(160);

CREATE OR REPLACE FUNCTION teacher_assignment_save(
    p_principal_id uuid,
    p_assignment_id uuid,
    p_title varchar,
    p_brief varchar,
    p_module_key varchar,
    p_goal varchar DEFAULT NULL
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
            (tenant_id, owner_principal_id, title, brief, module_key, goal)
        VALUES (v_tenant, p_principal_id, trim(p_title), NULLIF(trim(p_brief), ''),
                p_module_key, NULLIF(trim(p_goal), ''))
        RETURNING id INTO v_id;
        RETURN v_id;
    END IF;

    UPDATE public.teacher_assignments t
       SET title = trim(p_title),
           brief = NULLIF(trim(p_brief), ''),
           module_key = p_module_key,
           goal = NULLIF(trim(p_goal), ''),
           updated_at = now()
     WHERE t.id = p_assignment_id AND t.owner_principal_id = p_principal_id
    RETURNING t.id INTO v_id;
    RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS teacher_assignment_list(uuid);
CREATE OR REPLACE FUNCTION teacher_assignment_list(p_principal_id uuid)
RETURNS TABLE (
    id uuid,
    title varchar,
    brief varchar,
    goal varchar,
    module_key varchar,
    sample_image varchar,
    demo_key varchar,
    created_at timestamptz,
    handout_count integer,
    started_count integer,
    submitted_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT t.id, t.title, t.brief, t.goal, t.module_key, t.sample_image, t.demo_key, t.created_at,
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
    goal varchar,
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
    SELECT h.id, t.id, t.title, t.brief, t.goal, t.module_key, h.due_at, h.status, h.created_at,
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
    goal varchar,
    module_key varchar,
    due_at timestamptz,
    status varchar,
    sample_image varchar,
    project_id uuid,
    submitted_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT h.id, t.title, t.brief, t.goal, t.module_key, h.due_at, h.status, t.sample_image,
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

-- The shipped ten already say what they are for in their first sentence; lift it
-- onto the goal so the course reads the same way a teacher's own task will.
UPDATE teacher_assignments
   SET goal = CASE demo_key
       WHEN 'keychain'   THEN 'Научиться ставить фигуры рядом и соединять их в одну деталь'
       WHEN 'nameplate'  THEN 'Разместить объёмный текст на основе и выровнять его'
       WHEN 'cup'        THEN 'Вычесть одну фигуру из другой, чтобы получить полость'
       WHEN 'house'      THEN 'Собрать модель из простых фигур и повторить одинаковые детали'
       WHEN 'car'        THEN 'Выровнять колёса по осям, чтобы машина стояла ровно'
       WHEN 'robot'      THEN 'Соблюсти пропорции и симметрию при сборке фигуры'
       WHEN 'castle'     THEN 'Повторить одинаковые башни и расставить их по углам'
       WHEN 'phone-stand' THEN 'Рассчитать угол и устойчивость подставки'
       WHEN 'medal'      THEN 'Соединить объёмный текст, рельеф и отверстие в одной детали'
       WHEN 'organiser'  THEN 'Спроектировать вещь под свои размеры и проверить их'
       ELSE goal END
 WHERE demo_key IS NOT NULL AND goal IS NULL;

REVOKE ALL ON FUNCTION teacher_assignment_save(uuid, uuid, varchar, varchar, varchar, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_list(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignment_list(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignments_for_seat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION teacher_assignment_save(uuid, uuid, varchar, varchar, varchar, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_list(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignment_list(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignments_for_seat(uuid) TO asalab_app;

-- The five-argument form is now an overload, and a five-argument call would be
-- ambiguous against the new default. Only one of these should exist.
DROP FUNCTION IF EXISTS teacher_assignment_save(uuid, uuid, varchar, varchar, varchar);
