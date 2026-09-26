-- LRN-UX-01 UX1A3: learner-safe exact published-version sample delivery.
-- Reuse the existing direct-assignment audience model and existing sampleImage UI plumbing.
-- No course-activity media path is introduced here.

CREATE OR REPLACE FUNCTION learning_activity_version_sample_for_viewer(
    p_activity_version_id uuid,
    p_tenant_id uuid,
    p_account_id uuid,
    p_seat_id uuid
)
RETURNS TABLE (
    sample_bytes bytea,
    sample_content_type varchar,
    content_hash varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT media.bytes, media.content_type::varchar, media.content_hash::varchar
      FROM public.learning_activity_version_media media
      JOIN public.learning_activity_versions version
        ON version.tenant_id = media.tenant_id
       AND version.id = media.activity_version_id
       AND version.canonical_contract_version = 1
     WHERE media.tenant_id = p_tenant_id
       AND media.activity_version_id = p_activity_version_id
       AND media.role = 'sample'
       AND num_nonnulls(p_account_id, p_seat_id) = 1
       AND EXISTS (
           SELECT 1
             FROM public.classroom_assignments assignment
             JOIN public.classrooms classroom
               ON classroom.tenant_id = assignment.tenant_id
              AND classroom.id = assignment.classroom_id
              AND classroom.status = 'active'
             JOIN public.classroom_student_seats seat
               ON seat.tenant_id = assignment.tenant_id
              AND seat.classroom_id = assignment.classroom_id
              AND seat.status = 'active'
            WHERE assignment.tenant_id = p_tenant_id
              AND assignment.learning_activity_version_id = p_activity_version_id
              AND (
                  (p_seat_id IS NOT NULL AND seat.id = p_seat_id)
                  OR
                  (p_account_id IS NOT NULL AND seat.account_id = p_account_id)
              )
              AND EXISTS (
                  SELECT 1
                    FROM public.activity_runs run
                   WHERE run.tenant_id = assignment.tenant_id
                     AND run.classroom_id = assignment.classroom_id
                     AND run.source_kind = 'direct'
                     AND run.source_classroom_assignment_id = assignment.id
                     AND run.learning_activity_version_id = p_activity_version_id
              )
              AND public.learning_direct_assignment_seat_visible(seat.id, assignment.id)
              AND (
                  assignment.status = 'open'
                  OR EXISTS (
                      SELECT 1
                        FROM public.classroom_assignment_work work
                       WHERE work.assignment_id = assignment.id
                         AND work.seat_id = seat.id
                         AND work.project_id IS NOT NULL
                  )
              )
       )
     LIMIT 1;
$$;

-- Preserve the existing learner reader shape. Canonical direct assignments expose
-- only their exact immutable LearningActivityVersion sample; legacy assignments
-- keep their existing teacher_assignment sample behavior.
CREATE OR REPLACE FUNCTION public.classroom_assignments_for_seat(p_seat_id uuid)
 RETURNS TABLE(
    id uuid,
    title character varying,
    brief character varying,
    goal character varying,
    module_key character varying,
    due_at timestamp with time zone,
    status character varying,
    sample_image character varying,
    project_id uuid,
    submitted_at timestamp with time zone,
    snapshot_revision integer,
    updated_at timestamp with time zone
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
    SELECT h.id,
           COALESCE(lv.title,t.title),
           COALESCE(lv.instructions,t.brief),
           t.goal,
           COALESCE(lv.module_key,t.module_key),
           h.due_at,
           h.status,
           CASE
             WHEN h.learning_activity_version_id IS NOT NULL THEN
               CASE WHEN EXISTS (
                   SELECT 1
                     FROM public.learning_activity_version_media media
                    WHERE media.tenant_id = h.tenant_id
                      AND media.activity_version_id = h.learning_activity_version_id
                      AND media.role = 'sample'
               ) THEN (
                   '/api/assignments/activity-versions/'
                   || h.learning_activity_version_id::text
                   || '/sample'
               )::varchar ELSE NULL::varchar END
             ELSE t.sample_image
           END,
           w.project_id,
           w.submitted_at,
           snapshot.source_revision,
           draft.updated_at
      FROM public.classroom_student_seats s
      JOIN public.classroom_assignments h
        ON h.tenant_id = s.tenant_id AND h.classroom_id = s.classroom_id
      LEFT JOIN public.teacher_assignments t ON t.id = h.assignment_id
      LEFT JOIN public.learning_activity_versions lv ON lv.id = h.learning_activity_version_id
      LEFT JOIN public.classroom_assignment_work w
        ON w.assignment_id = h.id AND w.seat_id = s.id
      LEFT JOIN public.project_drafts draft ON draft.project_id = w.project_id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = w.project_id
     WHERE (t.id IS NOT NULL OR lv.id IS NOT NULL)
       AND s.id = p_seat_id
       AND s.status = 'active'
       AND (h.status = 'open' OR w.project_id IS NOT NULL)
     ORDER BY (w.submitted_at IS NOT NULL), h.created_at;
$function$;

REVOKE ALL ON FUNCTION learning_activity_version_sample_for_viewer(uuid,uuid,uuid,uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_activity_version_sample_for_viewer(uuid,uuid,uuid,uuid)
    TO asalab_app;

COMMENT ON FUNCTION learning_activity_version_sample_for_viewer(uuid,uuid,uuid,uuid) IS
    'Returns immutable version sample bytes only when the signed-in Account or StudentSeat can see a direct assignment pinned to that exact LearningActivityVersion.';
