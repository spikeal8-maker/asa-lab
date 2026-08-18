-- Сданную работу должно быть видно, не заходя в задание.
--
-- Ученик нажимает «Сдать» и не понимает, случилось ли что-нибудь. Учитель не
-- узнаёт о сдаче вообще: чтобы выяснить, кто сдал, надо открыть класс, открыть
-- «Действия», открыть задание и прочитать список — четыре шага ради ответа на
-- вопрос «есть ли что проверять».
--
-- Поэтому число ждущих проверки работ считается там, где учитель и так смотрит:
-- в списке классов и в списке учеников. Ждущая проверки — это сданная, на
-- которую ещё нет отклика; как только отклик написан, она из счётчика уходит.

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
    awaiting_review integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title, c.status, c.age_band, c.topic_keys,
           c.safe_mode_default, c.created_at, c.archived_at, jc.version, jc.status,
           count(s.id) FILTER (WHERE s.status <> 'removed')::integer,
           m.member_role, w.kind, w.title,
           COALESCE(pending.count, 0)::integer
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
          -- Сдано и ещё не отвечено.
          SELECT count(*) AS count
            FROM public.classroom_assignment_work work
            JOIN public.classroom_assignments h ON h.id = work.assignment_id
           WHERE h.classroom_id = c.id
             AND work.submitted_at IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM public.project_feedback fb
                  WHERE fb.project_id = work.project_id
                    AND fb.updated_at >= work.submitted_at)
      ) pending ON true
      LEFT JOIN public.classroom_student_seats s
        ON s.tenant_id = c.tenant_id AND s.classroom_id = c.id
     WHERE m.account_id = p_account_id
       AND m.member_role IN ('owner', 'co_teacher')
       AND c.status IN ('active', 'archived')
     GROUP BY c.id, jc.version, jc.status, m.member_role, w.kind, w.title, pending.count
     ORDER BY c.created_at DESC;
$$;

-- То же самое по каждому ученику: сколько он сдал и сколько ждёт проверки.
CREATE OR REPLACE FUNCTION classroom_seat_work_counts(p_seat_id uuid)
RETURNS TABLE (submitted integer, awaiting_review integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT count(*) FILTER (WHERE work.submitted_at IS NOT NULL)::integer,
           count(*) FILTER (
               WHERE work.submitted_at IS NOT NULL
                 AND NOT EXISTS (
                     SELECT 1 FROM public.project_feedback fb
                      WHERE fb.project_id = work.project_id
                        AND fb.updated_at >= work.submitted_at))::integer
      FROM public.classroom_assignment_work work
     WHERE work.seat_id = p_seat_id;
$$;

REVOKE ALL ON FUNCTION classroom_list_for_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_seat_work_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_list_for_account(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_seat_work_counts(uuid) TO asalab_app;
