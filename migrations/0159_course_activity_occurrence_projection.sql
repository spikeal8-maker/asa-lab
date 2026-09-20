-- E1-FIX-11D4b: expose block-aware Course Activity runtime occurrences to learner reads.
-- Existing classroom_course_runs_*_v2 readers remain unchanged.

CREATE OR REPLACE FUNCTION classroom_course_activity_occurrences_for_seat(p_seat_id uuid)
RETURNS TABLE (
    seat_id uuid,
    run_id uuid,
    lesson_id uuid,
    block_id varchar,
    activity_run_id uuid,
    classroom_assignment_id uuid,
    learning_activity_version_id uuid,
    title varchar,
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
           version.module_key,
           work.project_id,
           work.submitted_at,
           snapshot.source_revision,
           draft.updated_at
      FROM public.classroom_student_seats seat
      CROSS JOIN LATERAL public.classroom_course_runs_for_seat_v2(seat.id) visible
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
      LEFT JOIN public.classroom_assignment_work work
        ON work.assignment_id = runtime.source_classroom_assignment_id
       AND work.seat_id = seat.id
      LEFT JOIN public.project_drafts draft ON draft.project_id = work.project_id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = work.project_id
     WHERE seat.id = p_seat_id
       AND seat.status = 'active'
     ORDER BY visible.run_id, visible.lesson_id, block.position;
$$;

CREATE OR REPLACE FUNCTION classroom_course_activity_occurrences_for_account(p_account_id uuid)
RETURNS TABLE (
    seat_id uuid,
    run_id uuid,
    lesson_id uuid,
    block_id varchar,
    activity_run_id uuid,
    classroom_assignment_id uuid,
    learning_activity_version_id uuid,
    title varchar,
    module_key varchar,
    project_id uuid,
    submitted_at timestamptz,
    snapshot_revision integer,
    work_updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT occurrence.*
      FROM public.classroom_student_seats seat
      CROSS JOIN LATERAL public.classroom_course_activity_occurrences_for_seat(seat.id) occurrence
     WHERE seat.account_id = p_account_id
       AND seat.status = 'active'
     ORDER BY occurrence.run_id, occurrence.lesson_id, occurrence.block_id;
$$;

REVOKE ALL ON FUNCTION public.classroom_course_activity_occurrences_for_seat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.classroom_course_activity_occurrences_for_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_course_activity_occurrences_for_seat(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.classroom_course_activity_occurrences_for_account(uuid) TO asalab_app;
