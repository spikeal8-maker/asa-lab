-- Ученик видит, на чём остановился.
--
-- Ребёнок возвращается к заданию через неделю. Карточка задания рассказывает,
-- что нужно сделать, и молчит о том, что он уже сделал: чтобы вспомнить, надо
-- открыть редактор — то есть загрузить всю среду ради одного взгляда. Поэтому
-- в задание приезжает та же картинка, по которой преподаватель проверяет
-- работы: номер снимка, сделанного редактором при сохранении.

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
    submitted_at timestamptz,
    snapshot_revision integer,
    updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT h.id, t.title, t.brief, t.goal, t.module_key, h.due_at, h.status, t.sample_image,
           w.project_id, w.submitted_at, snapshot.source_revision, draft.updated_at
      FROM public.classroom_student_seats s
      JOIN public.classroom_assignments h
        ON h.tenant_id = s.tenant_id AND h.classroom_id = s.classroom_id
      JOIN public.teacher_assignments t ON t.id = h.assignment_id
      LEFT JOIN public.classroom_assignment_work w
        ON w.assignment_id = h.id AND w.seat_id = s.id
      LEFT JOIN public.project_drafts draft ON draft.project_id = w.project_id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = w.project_id
     WHERE s.id = p_seat_id
       AND s.status = 'active'
       AND (h.status = 'open' OR w.project_id IS NOT NULL)
     ORDER BY (w.submitted_at IS NOT NULL), h.created_at;
$$;

/** То же самое взрослому, который учится по своему аккаунту. */
DROP FUNCTION IF EXISTS classroom_assignments_for_account(uuid);
CREATE OR REPLACE FUNCTION classroom_assignments_for_account(p_account_id uuid)
RETURNS TABLE (
    id uuid,
    seat_id uuid,
    classroom_title varchar,
    title varchar,
    brief varchar,
    goal varchar,
    module_key varchar,
    due_at timestamptz,
    status varchar,
    sample_image varchar,
    project_id uuid,
    submitted_at timestamptz,
    snapshot_revision integer,
    updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT work.id, s.id, c.title, work.title, work.brief, work.goal, work.module_key,
           work.due_at, work.status, work.sample_image, work.project_id, work.submitted_at,
           work.snapshot_revision, work.updated_at
      FROM public.classroom_student_seats s
      JOIN public.classrooms c ON c.id = s.classroom_id
      CROSS JOIN LATERAL public.classroom_assignments_for_seat(s.id) work
     WHERE s.account_id = p_account_id
       AND s.status = 'active'
       AND c.status = 'active';
$$;

REVOKE ALL ON FUNCTION classroom_assignments_for_seat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignments_for_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_assignments_for_seat(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignments_for_account(uuid) TO asalab_app;
