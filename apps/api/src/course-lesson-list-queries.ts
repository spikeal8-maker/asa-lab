// Kept as shared SQL so the PostgreSQL integration test exercises the exact
// Account and StudentSeat list queries used by the controller.
export const ACCOUNT_COURSE_LESSON_LIST_SQL = `SELECT run_id, course_id, course_version_id, version_number, classroom_title,
              run_title, run_summary, due_at, run_status, lesson_id, source_lesson_id,
              section_title, section_summary, section_position, lesson_title, lesson_summary,
              lesson_content, lesson_blocks, lesson_kind, estimated_minutes, lesson_position,
              classroom_assignment_id, assignment_title, assignment_goal, assignment_brief,
              module_key, sample_image, project_id, submitted_at, snapshot_revision,
              work_updated_at, completed_at,
              CASE WHEN lesson_kind = 'assignment' AND classroom_assignment_id IS NOT NULL
                THEN learning_legacy_direct_provenance(
                  $2, classroom_seat_for_account_assignment($1,classroom_assignment_id),
                  classroom_assignment_id,project_id)
                ELSE NULL END AS legacy_provenance,
              classroom_seat_for_account_assignment($1,classroom_assignment_id) AS viewer_seat_id,
              modern_run.activity_run_id AS modern_activity_run_id,
              CASE WHEN lesson_kind = 'assignment' AND classroom_assignment_id IS NOT NULL
                THEN learning_course_modern_provenance(
                  $2, classroom_seat_for_account_assignment($1,classroom_assignment_id),
                  modern_run.activity_run_id,project_id)
                ELSE NULL END AS modern_provenance
         FROM classroom_course_runs_for_account_v2($1) lesson
         LEFT JOIN LATERAL (
           SELECT learning_course_lesson_unique_run(
             $2, classroom_seat_for_account_assignment($1,lesson.classroom_assignment_id),
             lesson.run_id,lesson.lesson_id,lesson.classroom_assignment_id
           ) AS activity_run_id
         ) modern_run ON true`;

export const SEAT_COURSE_LESSON_LIST_SQL = `SELECT run_id, course_id, course_version_id, version_number, classroom_title,
              run_title, run_summary, due_at, run_status, lesson_id, source_lesson_id,
              section_title, section_summary, section_position, lesson_title, lesson_summary,
              lesson_content, lesson_blocks, lesson_kind, estimated_minutes, lesson_position,
              classroom_assignment_id, assignment_title, assignment_goal, assignment_brief,
              module_key, sample_image, project_id, submitted_at, snapshot_revision,
              work_updated_at, completed_at,
              CASE WHEN lesson_kind = 'assignment' AND classroom_assignment_id IS NOT NULL
                THEN learning_legacy_direct_provenance(
                  principal_for_seat($1),$1,classroom_assignment_id,project_id)
                ELSE NULL END AS legacy_provenance,
              $1::uuid AS viewer_seat_id,
              modern_run.activity_run_id AS modern_activity_run_id,
              CASE WHEN lesson_kind = 'assignment' AND classroom_assignment_id IS NOT NULL
                THEN learning_course_modern_provenance(
                  principal_for_seat($1),$1,modern_run.activity_run_id,project_id)
                ELSE NULL END AS modern_provenance
         FROM classroom_course_runs_for_seat_v2($1) lesson
         LEFT JOIN LATERAL (
           SELECT learning_course_lesson_unique_run(
             principal_for_seat($1),$1,
             lesson.run_id,lesson.lesson_id,lesson.classroom_assignment_id
           ) AS activity_run_id
         ) modern_run ON true`;
