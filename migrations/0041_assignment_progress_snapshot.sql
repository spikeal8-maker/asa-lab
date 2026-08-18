-- Whether there is anything to look at yet.
--
-- The preview asks the server for the picture the editor saved. A learner who
-- opened the task and has not built anything has no picture, so the request is
-- a 404 and the teacher gets a broken image — for exactly the learner they are
-- most likely to be checking on. The progress row now says whether a picture
-- exists, so the preview can say "nothing saved yet" instead of asking.

DROP FUNCTION IF EXISTS classroom_assignment_progress(uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION classroom_assignment_progress(
    p_account_id    uuid,
    p_classroom_id  uuid,
    p_assignment_id uuid
)
RETURNS TABLE (
    seat_id uuid,
    display_label varchar,
    avatar_key varchar,
    project_id uuid,
    snapshot_revision integer,
    started_at timestamptz,
    submitted_at timestamptz,
    badge varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.id, s.display_label, s.avatar_key,
           w.project_id, snapshot.source_revision, w.started_at, w.submitted_at, feedback.badge
      FROM public.classroom_student_seats s
      LEFT JOIN public.classroom_assignment_work w
        ON w.seat_id = s.id AND w.assignment_id = p_assignment_id
      LEFT JOIN public.project_snapshots snapshot
        ON snapshot.tenant_id = s.tenant_id AND snapshot.project_id = w.project_id
      LEFT JOIN public.project_feedback feedback
        ON feedback.project_id = w.project_id
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

REVOKE ALL ON FUNCTION classroom_assignment_progress(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_assignment_progress(uuid, uuid, uuid) TO asalab_app;
