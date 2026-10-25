-- Courses E1 P0: a frozen lesson is one completion unit, even with multiple
-- required Activity blocks. Read receipts never substitute for canonical practice results.
-- This is an additive function-only correction; historical CourseVersions, results,
-- audit events and published migrations 0132/0133 remain untouched.
CREATE OR REPLACE FUNCTION public.learning_course_completion_internal(p_enrollment uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_identity_id uuid;
    v_run_id uuid;
    v_classroom_id uuid;
    v_seat_id uuid;
    v_seat_count integer;
    v_lesson record;
    v_block record;
    v_progress_id uuid;
    v_runtime_id uuid;
    v_runtime_count bigint;
    v_version_matches boolean;
    v_participation_id uuid;
    v_participation_status varchar;
    v_participation_excused boolean;
    v_result_id uuid;
    v_result_completed boolean;
    v_root_excused boolean;
    v_lesson_completed boolean;
    v_lesson_excused boolean;
    v_block_count integer;
    v_excused_block_count integer;
    v_lesson_bases jsonb;
    v_basis_ids jsonb := '[]'::jsonb;
    v_lesson_count integer := 0;
    v_total integer := 0;
    v_completed_count integer := 0;
    v_excused_count integer := 0;
BEGIN
    SELECT enrollment.learner_identity_id, course.id, course.classroom_id
      INTO v_identity_id, v_run_id, v_classroom_id
      FROM public.course_enrollments enrollment
      JOIN public.classroom_course_runs course ON course.id = enrollment.course_run_id
     WHERE enrollment.id = p_enrollment AND enrollment.status IN ('assigned', 'active');

    IF v_run_id IS NULL THEN
        RETURN jsonb_build_object(
            'completed', false, 'total', 0, 'lessonCount', 0,
            'excusedCount', 0, 'completedCount', 0, 'basisIds', '[]'::jsonb,
            'reason', 'no_required_lessons', 'resultPolicy', 'no_course_grade'
        );
    END IF;

    -- An ambiguous or absent active Seat cannot prove completion. Do not expand
    -- one CourseEnrollment into duplicate lesson rows through identity links.
    SELECT count(DISTINCT seat.id), min(seat.id::text)::uuid
      INTO v_seat_count, v_seat_id
      FROM public.learner_identity_links link
      JOIN public.classroom_student_seats seat
        ON seat.id = link.seat_id AND seat.classroom_id = v_classroom_id
     WHERE link.learner_identity_id = v_identity_id
       AND link.status = 'active' AND link.link_kind = 'student_seat';

    FOR v_lesson IN
        SELECT lesson.id, lesson.kind, lesson.blocks, lesson.classroom_assignment_id
          FROM public.classroom_course_run_lessons lesson
         WHERE lesson.run_id = v_run_id
         ORDER BY lesson.section_position, lesson.lesson_position, lesson.id
    LOOP
        v_lesson_count := v_lesson_count + 1;
        v_lesson_bases := '[]'::jsonb;
        v_root_excused := false;
        v_block_count := 0;
        v_excused_block_count := 0;
        v_lesson_completed := (v_seat_count = 1);

        IF v_lesson.kind = 'material' THEN
            SELECT progress.id INTO v_progress_id
              FROM public.classroom_course_lesson_progress progress
             WHERE progress.run_id = v_run_id
               AND progress.lesson_id = v_lesson.id
               AND progress.seat_id = v_seat_id;
            v_lesson_completed := v_lesson_completed AND v_progress_id IS NOT NULL;
            IF v_progress_id IS NOT NULL THEN
                v_lesson_bases := v_lesson_bases || jsonb_build_array(v_progress_id);
            END IF;
        ELSIF v_lesson.kind = 'assignment' THEN
            -- Legacy standalone practice, not an Activity block. Historic course
            -- lessons retain their single lesson-level ActivityRun and excusal.
            SELECT count(*), min(run.id::text)::uuid
              INTO v_runtime_count, v_runtime_id
              FROM public.activity_runs run
             WHERE run.source_kind = 'course'
               AND run.source_course_run_id = v_run_id
               AND run.source_course_lesson_id = v_lesson.id
               AND run.source_course_block_id IS NULL
               AND run.source_classroom_assignment_id = v_lesson.classroom_assignment_id;

            v_lesson_completed := v_lesson_completed AND v_runtime_count = 1;
            IF v_runtime_count = 1 THEN
                SELECT part.id, part.status, part.excused
                  INTO v_participation_id, v_participation_status, v_participation_excused
                  FROM public.activity_participations part
                 WHERE part.activity_run_id = v_runtime_id
                   AND part.source_course_enrollment_id = p_enrollment
                   AND part.learner_identity_id = v_identity_id;

                IF v_participation_id IS NULL
                   OR v_participation_status NOT IN ('assigned', 'active') THEN
                    v_lesson_completed := false;
                ELSIF v_participation_excused THEN
                    v_root_excused := true;
                ELSE
                    SELECT selected.result_id, result.completion_value
                      INTO v_result_id, v_result_completed
                      FROM public.learning_selected_result_internal(v_participation_id) selected
                      LEFT JOIN public.assessment_results result
                        ON result.id = selected.result_id;
                    v_lesson_completed := v_lesson_completed
                                          AND COALESCE(v_result_completed, false);
                    IF v_result_completed IS TRUE AND v_result_id IS NOT NULL THEN
                        v_lesson_bases := v_lesson_bases || jsonb_build_array(v_result_id);
                    END IF;
                END IF;
            END IF;
        ELSE
            v_lesson_completed := false;
        END IF;

        -- A malformed historical snapshot must not be mistaken for zero work.
        IF v_lesson.blocks IS NOT NULL
           AND jsonb_typeof(v_lesson.blocks) <> 'array' THEN
            v_lesson_completed := false;
        END IF;

        FOR v_block IN
            SELECT block.value
              FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(v_lesson.blocks) = 'array'
                    THEN v_lesson.blocks ELSE '[]'::jsonb END
              ) block
             WHERE block.value ->> 'type' = 'activity'
               AND block.value ->> 'hidden' IS DISTINCT FROM 'true'
        LOOP
            v_block_count := v_block_count + 1;

            -- Exactly one occurrence for this FROZEN block ID and version.
            -- Match by ActivityRun, not by handout: historic handouts may be shared.
            SELECT count(*), min(run.id::text)::uuid,
                   bool_and(run.learning_activity_version_id::text =
                            v_block.value ->> 'learningActivityVersionId')
              INTO v_runtime_count, v_runtime_id, v_version_matches
              FROM public.activity_runs run
             WHERE run.source_kind = 'course'
               AND run.source_course_run_id = v_run_id
               AND run.source_course_lesson_id = v_lesson.id
               AND run.source_course_block_id = v_block.value ->> 'id';

            IF v_runtime_count <> 1 OR v_version_matches IS DISTINCT FROM true THEN
                v_lesson_completed := false;
                CONTINUE;
            END IF;

            SELECT part.id, part.status, part.excused
              INTO v_participation_id, v_participation_status, v_participation_excused
              FROM public.activity_participations part
             WHERE part.activity_run_id = v_runtime_id
               AND part.source_course_enrollment_id = p_enrollment
               AND part.learner_identity_id = v_identity_id;

            IF v_participation_id IS NULL
               OR v_participation_status NOT IN ('assigned', 'active') THEN
                v_lesson_completed := false;
            ELSIF v_participation_excused THEN
                v_excused_block_count := v_excused_block_count + 1;
            ELSE
                SELECT selected.result_id, result.completion_value
                  INTO v_result_id, v_result_completed
                  FROM public.learning_selected_result_internal(v_participation_id) selected
                  LEFT JOIN public.assessment_results result
                    ON result.id = selected.result_id;
                v_lesson_completed := v_lesson_completed
                                      AND COALESCE(v_result_completed, false);
                IF v_result_completed IS TRUE AND v_result_id IS NOT NULL THEN
                    v_lesson_bases := v_lesson_bases || jsonb_build_array(v_result_id);
                END IF;
            END IF;
        END LOOP;

        -- Duplicated block IDs or extra unpinned occurrences are ambiguous.
        IF EXISTS (
            SELECT 1
              FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(v_lesson.blocks) = 'array'
                    THEN v_lesson.blocks ELSE '[]'::jsonb END
              ) block
             WHERE block ->> 'type' = 'activity'
               AND block ->> 'hidden' IS DISTINCT FROM 'true'
             GROUP BY block ->> 'id'
            HAVING count(*) > 1
        ) OR EXISTS (
            SELECT 1 FROM public.activity_runs run
             WHERE run.source_kind = 'course'
               AND run.source_course_run_id = v_run_id
               AND run.source_course_lesson_id = v_lesson.id
               AND (
                   (run.source_course_block_id IS NULL AND v_lesson.kind = 'material')
                   OR
                   (run.source_course_block_id IS NOT NULL AND NOT EXISTS (
                       SELECT 1
                         FROM jsonb_array_elements(
                             CASE WHEN jsonb_typeof(v_lesson.blocks) = 'array'
                               THEN v_lesson.blocks ELSE '[]'::jsonb END
                         ) block
                        WHERE block ->> 'type' = 'activity'
                          AND block ->> 'id' = run.source_course_block_id
                   ))
               )
        ) THEN
            v_lesson_completed := false;
        END IF;

        -- An excused standalone assignment contributes no required lesson.
        -- A mixed material lesson still requires reading even if all its
        -- practices are excused.
        v_lesson_excused := v_lesson.kind = 'assignment'
                           AND v_root_excused
                           AND v_block_count = v_excused_block_count;
        IF v_lesson_excused THEN
            v_excused_count := v_excused_count + 1;
        ELSE
            v_total := v_total + 1;
            IF v_lesson_completed THEN
                v_completed_count := v_completed_count + 1;
            END IF;
            v_basis_ids := v_basis_ids || v_lesson_bases;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'completed', v_total > 0 AND v_completed_count = v_total,
        'total', v_total,
        'lessonCount', v_lesson_count,
        'excusedCount', v_excused_count,
        'completedCount', v_completed_count,
        'basisIds', v_basis_ids,
        'reason', CASE WHEN v_total = 0 THEN 'no_required_lessons'
                       WHEN v_completed_count = v_total THEN 'required_lessons_completed'
                       ELSE 'required_lessons_pending' END,
        'resultPolicy', 'no_course_grade'
    );
END;
$$;
REVOKE ALL ON FUNCTION public.learning_course_completion_internal(uuid) FROM PUBLIC, asalab_app;
