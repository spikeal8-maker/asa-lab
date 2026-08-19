-- Успеваемость числами: в списке классов и внутри класса.
--
-- «Ждут проверки» отвечает на один вопрос — есть ли работа сейчас. Остальные
-- вопросы преподаватель задаёт не реже: сколько заданий выдано, сколько сдано,
-- и кто не сдал ничего. Раньше за этим приходилось открывать класс, потом
-- «Действия», потом каждое задание по очереди.
--
-- Логин ученика становится шестизначным кодом из букв и цифр. Только цифры
-- читаются как номер и подбираются перебором быстрее; буквы с цифрами при том
-- же числе знаков дают на три порядка больше вариантов. Похожие друг на друга
-- знаки (0 и O, 1 и l, I) из набора исключены — код диктуют вслух и пишут на
-- доске.

/** Классы с числами по успеваемости. */
DROP FUNCTION IF EXISTS classroom_list_for_account(uuid);
CREATE OR REPLACE FUNCTION classroom_list_for_account(p_account_id uuid)
RETURNS TABLE (
    id uuid,
    title varchar,
    status varchar,
    age_band varchar,
    topic_keys text[],
    safe_mode_default boolean,
    created_at timestamptz,
    archived_at timestamptz,
    join_code_version integer,
    join_code_status varchar,
    student_count integer,
    teacher_role varchar,
    workspace_kind varchar,
    workspace_title varchar,
    awaiting_review integer,
    assigned_count integer,
    submitted_count integer,
    behind_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title, c.status, c.age_band, c.topic_keys,
           c.safe_mode_default, c.created_at, c.archived_at, jc.version, jc.status,
           counts.seats, m.member_role, w.kind, w.title,
           counts.awaiting, counts.assigned, counts.submitted, counts.behind
      FROM public.classrooms c
      JOIN public.classroom_memberships m
        ON m.tenant_id = c.tenant_id AND m.classroom_id = c.id
      JOIN public.workspaces w ON w.tenant_id = c.tenant_id
      LEFT JOIN LATERAL (
          SELECT code.version, code.status
            FROM public.classroom_join_codes code
           WHERE code.tenant_id = c.tenant_id AND code.classroom_id = c.id
           ORDER BY code.version DESC LIMIT 1
      ) jc ON true
      LEFT JOIN LATERAL (
          SELECT
            (SELECT count(*)::integer FROM public.classroom_student_seats s
              WHERE s.classroom_id = c.id AND s.status <> 'removed') AS seats,
            -- Выдано классу: столько заданий стоит перед каждым учеником.
            (SELECT count(*)::integer FROM public.classroom_assignments h
              WHERE h.classroom_id = c.id AND h.status = 'open') AS assigned,
            (SELECT count(*)::integer
               FROM public.classroom_assignment_work w
               JOIN public.classroom_assignments h ON h.id = w.assignment_id
              WHERE h.classroom_id = c.id AND w.submitted_at IS NOT NULL) AS submitted,
            (SELECT count(*)::integer
               FROM public.classroom_assignment_work w
               JOIN public.classroom_assignments h ON h.id = w.assignment_id
              WHERE h.classroom_id = c.id
                AND w.submitted_at IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM public.project_feedback fb
                     WHERE fb.project_id = w.project_id
                       AND fb.updated_at >= w.submitted_at)) AS awaiting,
            -- Отстают: те, кто не сдал ещё ничего, хотя классу задания выданы.
            (SELECT count(*)::integer
               FROM public.classroom_student_seats s
              WHERE s.classroom_id = c.id AND s.status <> 'removed'
                AND EXISTS (SELECT 1 FROM public.classroom_assignments h
                             WHERE h.classroom_id = c.id AND h.status = 'open')
                AND NOT EXISTS (
                    SELECT 1 FROM public.classroom_assignment_work w
                     WHERE w.seat_id = s.id AND w.submitted_at IS NOT NULL)) AS behind
      ) counts ON true
     WHERE m.account_id = p_account_id
       AND m.member_role IN ('owner', 'co_teacher')
       AND c.status IN ('active', 'archived')
     ORDER BY c.created_at DESC;
$$;

/** Сводка по одному классу — то же самое, но для его собственной страницы. */
CREATE OR REPLACE FUNCTION classroom_progress_summary(
    p_account_id   uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    seat_count integer,
    assigned_count integer,
    submitted_count integer,
    awaiting_review integer,
    behind_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT counts.seats, counts.assigned, counts.submitted, counts.awaiting, counts.behind
      FROM public.classrooms c
      JOIN public.classroom_memberships m
        ON m.classroom_id = c.id AND m.account_id = p_account_id
       AND m.member_role IN ('owner', 'co_teacher')
      CROSS JOIN LATERAL (
          SELECT
            (SELECT count(*)::integer FROM public.classroom_student_seats s
              WHERE s.classroom_id = c.id AND s.status <> 'removed') AS seats,
            (SELECT count(*)::integer FROM public.classroom_assignments h
              WHERE h.classroom_id = c.id AND h.status = 'open') AS assigned,
            (SELECT count(*)::integer
               FROM public.classroom_assignment_work w
               JOIN public.classroom_assignments h ON h.id = w.assignment_id
              WHERE h.classroom_id = c.id AND w.submitted_at IS NOT NULL) AS submitted,
            (SELECT count(*)::integer
               FROM public.classroom_assignment_work w
               JOIN public.classroom_assignments h ON h.id = w.assignment_id
              WHERE h.classroom_id = c.id
                AND w.submitted_at IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM public.project_feedback fb
                     WHERE fb.project_id = w.project_id
                       AND fb.updated_at >= w.submitted_at)) AS awaiting,
            (SELECT count(*)::integer
               FROM public.classroom_student_seats s
              WHERE s.classroom_id = c.id AND s.status <> 'removed'
                AND EXISTS (SELECT 1 FROM public.classroom_assignments h
                             WHERE h.classroom_id = c.id AND h.status = 'open')
                AND NOT EXISTS (
                    SELECT 1 FROM public.classroom_assignment_work w
                     WHERE w.seat_id = s.id AND w.submitted_at IS NOT NULL)) AS behind
      ) counts
     WHERE c.id = p_classroom_id;
$$;

/**
 * Шестизначный код для входа: буквы и цифры.
 *
 * Из набора убраны знаки, которые путают на слух и на доске: 0 и O, 1 и I с l.
 * Осталось 32 знака, шесть позиций — около миллиарда вариантов вместо девятисот
 * тысяч у одних цифр.
 */
CREATE OR REPLACE FUNCTION classroom_seat_handle_new()
RETURNS varchar
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    alphabet constant text := '23456789abcdefghjkmnpqrstuvwxyz';
    result text := '';
    i integer;
BEGIN
    FOR i IN 1..6 LOOP
        result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
    END LOOP;
    RETURN result;
END;
$$;

-- Выданные ранее коды из одних цифр переводим на новый набор. Имя, заданное
-- преподавателем вручную, не трогаем: оно могло быть роздано детям на бумаге.
DO $$
DECLARE
    seat record;
    candidate varchar;
    guard integer;
BEGIN
    FOR seat IN
        SELECT s.id, s.classroom_id
          FROM public.classroom_student_seats s
         WHERE s.login_handle ~ '^[0-9]{6}$'
    LOOP
        guard := 0;
        LOOP
            candidate := public.classroom_seat_handle_new();
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

REVOKE ALL ON FUNCTION classroom_list_for_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_progress_summary(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_seat_handle_new() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_list_for_account(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_progress_summary(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_seat_handle_new() TO asalab_app;
