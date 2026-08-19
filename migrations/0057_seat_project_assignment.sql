-- Задание рядом с проверяемой работой.
--
-- Преподаватель открывает работу ученика и видит модель — но не видит, что
-- было задано. Через неделю после урока он и сам не помнит формулировку, а
-- проверять «нормально ли это» без условия задачи нельзя. Условие лежит рядом,
-- в задании, к которому работа привязана, — надо просто отдать его вместе с
-- работой.

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
    awaiting_review boolean,
    assignment_title varchar,
    assignment_goal varchar,
    assignment_brief varchar,
    assignment_sample_image varchar
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
                    AND fb.updated_at >= work.submitted_at),
           task.title, task.goal, task.brief, task.sample_image
      FROM visible
      JOIN public.projects project ON project.id = visible.id
      JOIN public.project_drafts draft
        ON draft.tenant_id = project.tenant_id AND draft.project_id = project.id
      LEFT JOIN public.project_snapshots snapshot
        ON snapshot.tenant_id = project.tenant_id AND snapshot.project_id = project.id
      LEFT JOIN public.principals editor ON editor.id = draft.updated_by_principal_id
      LEFT JOIN public.classroom_assignment_work work
        ON work.project_id = project.id AND work.seat_id = p_seat_id
      LEFT JOIN public.classroom_assignments handout ON handout.id = work.assignment_id
      LEFT JOIN public.teacher_assignments task ON task.id = handout.assignment_id
     ORDER BY draft.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION classroom_seat_projects(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_seat_projects(uuid, uuid) TO asalab_app;
