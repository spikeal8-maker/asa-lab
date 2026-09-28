-- A shared legacy handout has no immutable ActivityRun-to-project origin.
-- Learner actions must remain unavailable for that assignment until exact origin exists.
CREATE OR REPLACE FUNCTION public.learning_course_activity_assignment_is_shared(p_assignment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.activity_runs run
         WHERE run.source_classroom_assignment_id = p_assignment_id
           AND run.source_kind = 'course'
           AND EXISTS (
               SELECT 1 FROM public.activity_runs sibling
                WHERE sibling.tenant_id = run.tenant_id
                  AND sibling.source_classroom_assignment_id = p_assignment_id
                  AND sibling.id <> run.id
           )
    );
$$;

REVOKE ALL ON FUNCTION public.learning_course_activity_assignment_is_shared(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_course_activity_assignment_is_shared(uuid) TO asalab_app;

-- Goal disclosure follows the exact Course ActivityRun. A legacy shared handout may own
-- multiple sibling runs while classroom_assignment_work names only the handout.
-- In that case work cannot prove which run was started. Keep that override fail closed.

CREATE OR REPLACE FUNCTION public.classroom_course_activity_occurrences_for_seat(p_seat_id uuid)
RETURNS TABLE (
    seat_id uuid,
    run_id uuid,
    lesson_id uuid,
    block_id varchar,
    activity_run_id uuid,
    classroom_assignment_id uuid,
    learning_activity_version_id uuid,
    title varchar,
    goal varchar,
    module_key varchar,
    project_id uuid,
    submitted_at timestamptz,
    snapshot_revision integer,
    work_updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT seat.id,
           visible.run_id,
           visible.lesson_id,
           runtime.source_course_block_id,
           runtime.id,
           runtime.source_classroom_assignment_id,
           runtime.learning_activity_version_id,
           version.title,
           CASE WHEN (work.project_id IS NOT NULL AND cardinality.exact_run) OR (
               visible.run_status = 'open'
               AND classroom.status = 'active'
               AND runtime.lifecycle_status = 'active'
               AND assignment.status = 'open'
               AND public.learning_course_seat_visible(seat.id, visible.run_id)
               AND
               participation.status IN ('assigned', 'active')
               AND (participation.source_course_enrollment_id IS NULL
                    OR enrollment.status IN ('assigned', 'active'))
               AND (conditions.opens_at IS NULL OR conditions.opens_at <= now())
           ) THEN version.goal ELSE NULL END,
           version.module_key,
           CASE WHEN cardinality.exact_run THEN work.project_id ELSE NULL END,
           CASE WHEN cardinality.exact_run THEN work.submitted_at ELSE NULL END,
           CASE WHEN cardinality.exact_run THEN snapshot.source_revision ELSE NULL END,
           CASE WHEN cardinality.exact_run THEN draft.updated_at ELSE NULL END
      FROM public.classroom_student_seats seat
      CROSS JOIN LATERAL public.classroom_course_runs_for_seat_v2(seat.id) visible
      JOIN public.classrooms classroom
        ON classroom.tenant_id = seat.tenant_id
       AND classroom.id = seat.classroom_id
      JOIN public.activity_runs runtime
        ON runtime.source_kind = 'course'
       AND runtime.source_course_run_id = visible.run_id
       AND runtime.source_course_lesson_id = visible.lesson_id
       AND runtime.source_course_block_id IS NOT NULL
      JOIN LATERAL jsonb_array_elements(visible.lesson_blocks)
           WITH ORDINALITY AS block(value, position)
        ON block.value ->> 'id' = runtime.source_course_block_id
       AND block.value ->> 'type' = 'activity'
       AND block.value -> 'hidden' IS DISTINCT FROM 'true'::jsonb
      JOIN public.learning_activity_versions version
        ON version.tenant_id = runtime.tenant_id
       AND version.id = runtime.learning_activity_version_id
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id = runtime.tenant_id
       AND assignment.id = runtime.source_classroom_assignment_id
      LEFT JOIN public.classroom_assignment_work work
        ON work.assignment_id = runtime.source_classroom_assignment_id
       AND work.seat_id = seat.id
      LEFT JOIN LATERAL (
          SELECT count(*) = 1 AS exact_run FROM public.activity_runs sibling
           WHERE sibling.tenant_id = runtime.tenant_id
             AND sibling.source_classroom_assignment_id = assignment.id
      ) cardinality ON true
      LEFT JOIN public.learner_identity_links link
        ON link.tenant_id = runtime.tenant_id
       AND link.school_id = runtime.school_id
       AND link.seat_id = seat.id
       AND link.link_kind = 'student_seat'
       AND link.status = 'active'
      LEFT JOIN public.activity_participations participation
        ON participation.tenant_id = runtime.tenant_id
       AND participation.school_id = runtime.school_id
       AND participation.activity_run_id = runtime.id
       AND participation.learner_identity_id = link.learner_identity_id
      LEFT JOIN public.course_enrollments enrollment
        ON enrollment.id = participation.source_course_enrollment_id
       AND enrollment.tenant_id = runtime.tenant_id
       AND enrollment.school_id = runtime.school_id
      LEFT JOIN LATERAL (
          SELECT (public.learning_effective_conditions_internal(
              runtime.id, participation.id
          )#>>'{values,opensAt}')::timestamptz AS opens_at
           WHERE participation.id IS NOT NULL
      ) conditions ON true
      LEFT JOIN public.project_drafts draft ON draft.project_id = work.project_id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = work.project_id
     WHERE seat.id = p_seat_id
       AND seat.status = 'active'
     ORDER BY visible.run_id, visible.lesson_id, block.position;
$$;
