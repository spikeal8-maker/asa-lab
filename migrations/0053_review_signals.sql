-- Кто ждёт проверки, и логин без слова «student».
--
-- Преподаватель видит в списке классов, что где-то есть работа на проверку, и
-- заходит внутрь — а там ничего: список учащихся ничем не отличается от
-- вчерашнего. Отсюда две вещи: пометка у конкретного человека и числа рядом с
-- ним — сколько заданий ему выдано и сколько он сдал.
--
-- И логин. Слово «student-» перед шестью знаками дети всё равно набирали с
-- ошибками; новые места получают только цифры, а выданные раньше остаются со
-- старым именем — их и переводим.

/**
 * Перевод выданных ранее логинов на шесть цифр.
 *
 * Только те, что выглядят как «student-1a2b3c»: имя, заданное преподавателем
 * вручную, не трогается — оно могло быть роздано детям на бумаге. Уникальность
 * проверяется в пределах класса, как и требует индекс.
 */
DO $$
DECLARE
    seat record;
    candidate varchar;
    guard integer;
BEGIN
    FOR seat IN
        SELECT s.id, s.classroom_id
          FROM public.classroom_student_seats s
         WHERE s.login_handle ~ '^student-[0-9a-f]{6}$'
    LOOP
        guard := 0;
        LOOP
            candidate := (100000 + floor(random() * 900000))::integer::varchar;
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM public.classroom_student_seats other
                 WHERE other.classroom_id = seat.classroom_id
                   AND other.normalized_login_handle = candidate
            );
            guard := guard + 1;
            IF guard > 50 THEN EXIT; END IF;
        END LOOP;
        IF guard <= 50 THEN
            UPDATE public.classroom_student_seats s
               SET login_handle = candidate,
                   normalized_login_handle = candidate,
                   updated_at = now()
             WHERE s.id = seat.id;
        END IF;
    END LOOP;
END;
$$;

/**
 * Список учащихся с тем, что нужно знать о каждом до того, как открыть его
 * страницу: сколько заданий выдано, сколько сдано и ждёт ли что-то ответа.
 */
DROP FUNCTION IF EXISTS classroom_management_roster(uuid, uuid);
CREATE OR REPLACE FUNCTION classroom_management_roster(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    id uuid,
    display_label varchar,
    login_handle varchar,
    safe_mode boolean,
    status varchar,
    avatar_key varchar,
    last_active_at timestamptz,
    created_at timestamptz,
    assigned_count integer,
    submitted_count integer,
    awaiting_review integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.id, s.display_label, s.login_handle, s.safe_mode, s.status, s.avatar_key,
           s.last_active_at, s.created_at,
           -- Выдано классу: задание считается выданным каждому месту в нём.
           (SELECT count(*)::integer
              FROM public.classroom_assignments h
             WHERE h.classroom_id = s.classroom_id AND h.status = 'open'),
           (SELECT count(*)::integer
              FROM public.classroom_assignment_work w
             WHERE w.seat_id = s.id AND w.submitted_at IS NOT NULL),
           (SELECT count(*)::integer
              FROM public.classroom_assignment_work w
             WHERE w.seat_id = s.id
               AND w.submitted_at IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM public.project_feedback fb
                    WHERE fb.project_id = w.project_id
                      AND fb.updated_at >= w.submitted_at))
      FROM public.classroom_student_seats s
     WHERE s.classroom_id = p_classroom_id
       AND s.status <> 'removed'
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships m
            WHERE m.account_id = p_account_id
              AND m.classroom_id = p_classroom_id
              AND m.tenant_id = s.tenant_id
              AND m.member_role IN ('owner', 'co_teacher'))
     ORDER BY lower(s.display_label), s.id;
$$;

/**
 * Сколько работ ждёт этого преподавателя во всех его классах.
 *
 * Одно число для отметки рядом с «Классами»: продукт открывают утром именно
 * ради него, и ради него же не должно приходиться обходить классы по одному.
 */
CREATE OR REPLACE FUNCTION classroom_awaiting_review_total(p_account_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT COALESCE(count(*), 0)::integer
      FROM public.classroom_assignment_work w
      JOIN public.classroom_assignments h ON h.id = w.assignment_id
      JOIN public.classrooms c ON c.id = h.classroom_id
      JOIN public.classroom_memberships m
        ON m.classroom_id = c.id AND m.member_role IN ('owner', 'co_teacher')
     WHERE m.account_id = p_account_id
       AND c.status = 'active'
       AND w.submitted_at IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM public.project_feedback fb
            WHERE fb.project_id = w.project_id
              AND fb.updated_at >= w.submitted_at);
$$;

/**
 * Работы одного ученика с отметкой, какая ждёт ответа.
 *
 * «Ждёт ответа» — свойство конкретной работы, а не человека: преподаватель
 * открывает страницу, чтобы найти именно ту, на которую ещё не ответил.
 */
DROP FUNCTION IF EXISTS classroom_seat_projects(uuid, uuid);
CREATE OR REPLACE FUNCTION classroom_seat_projects(
    p_principal_id uuid,
    p_seat_id      uuid
)
RETURNS TABLE (
    id uuid,
    module_key varchar,
    title varchar,
    status varchar,
    created_at timestamptz,
    updated_at timestamptz,
    snapshot_revision integer,
    preview_json jsonb,
    preview_digest varchar,
    last_editor_was_teacher boolean,
    submitted_at timestamptz,
    awaiting_review boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH scope AS (
        SELECT s.seat_id, s.seat_principal_id, seat.account_id
          FROM public.teacher_seat_scope(p_principal_id) s
          JOIN public.classroom_student_seats seat ON seat.id = s.seat_id
         WHERE s.seat_id = p_seat_id
    ),
    visible AS (
        SELECT project.id
          FROM scope
          JOIN public.projects project
            ON project.owner_principal_id = scope.seat_principal_id
         WHERE scope.account_id IS NULL
           AND project.project_scope = 'personal'
        UNION
        SELECT work.project_id
          FROM scope
          JOIN public.classroom_assignment_work work ON work.seat_id = scope.seat_id
         WHERE scope.account_id IS NOT NULL
           AND work.project_id IS NOT NULL
    )
    SELECT project.id, project.module_key, project.title, project.status,
           project.created_at, draft.updated_at, snapshot.source_revision,
           draft.preview_json, draft.preview_digest,
           editor.account_id IS NOT NULL,
           work.submitted_at,
           work.submitted_at IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM public.project_feedback fb
                  WHERE fb.project_id = project.id
                    AND fb.updated_at >= work.submitted_at)
      FROM visible
      JOIN public.projects project ON project.id = visible.id
      JOIN public.project_drafts draft
        ON draft.tenant_id = project.tenant_id AND draft.project_id = project.id
      LEFT JOIN public.project_snapshots snapshot
        ON snapshot.tenant_id = project.tenant_id AND snapshot.project_id = project.id
      LEFT JOIN public.principals editor ON editor.id = draft.updated_by_principal_id
      LEFT JOIN public.classroom_assignment_work work
        ON work.project_id = project.id AND work.seat_id = p_seat_id
     ORDER BY draft.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION classroom_management_roster(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_awaiting_review_total(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_seat_projects(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_management_roster(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_awaiting_review_total(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_seat_projects(uuid, uuid) TO asalab_app;
