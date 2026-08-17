-- The list has to say which assignments a class was given.
--
-- 0035 added the column and the ten demo rows; the reader that the class page
-- calls was left returning the old shape, so asking it for demo_key failed and
-- the page showed "no assignments yet" over a class that had eleven. Postgres
-- will not widen a function's result in place, so it is dropped and rebuilt.

DROP FUNCTION IF EXISTS classroom_assignment_list(uuid, uuid);

CREATE OR REPLACE FUNCTION classroom_assignment_list(
    p_account_id   uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    id uuid,
    title varchar,
    brief varchar,
    module_key varchar,
    due_at timestamptz,
    status varchar,
    created_at timestamptz,
    demo_key varchar,
    seat_count integer,
    started_count integer,
    submitted_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.id, a.title, a.brief, a.module_key, a.due_at, a.status, a.created_at, a.demo_key,
           (SELECT count(*)::integer FROM public.classroom_student_seats s
             WHERE s.tenant_id = a.tenant_id AND s.classroom_id = a.classroom_id
               AND s.status <> 'removed'),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
             WHERE w.assignment_id = a.id),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
             WHERE w.assignment_id = a.id AND w.submitted_at IS NOT NULL)
      FROM public.classroom_assignments a
     WHERE a.classroom_id = p_classroom_id
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships m
            WHERE m.account_id = p_account_id
              AND m.classroom_id = p_classroom_id
              AND m.tenant_id = a.tenant_id
              AND m.member_role IN ('owner', 'co_teacher'))
     -- A teacher's own work first, then the ten they were given: the list is
     -- read from the top, and what somebody wrote outranks what shipped.
     ORDER BY (a.demo_key IS NOT NULL), a.created_at DESC;
$$;

REVOKE ALL ON FUNCTION classroom_assignment_list(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_assignment_list(uuid, uuid) TO asalab_app;
