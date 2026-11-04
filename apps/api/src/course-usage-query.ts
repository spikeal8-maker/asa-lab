/** Read existing delivery metadata through the same authorized class/run readers.
 * Content ownership alone never grants access to a class using that content.
 * The outer row distinguishes an owned, unused course from an inaccessible ID.
 */
export const COURSE_USAGE_SQL = `
WITH owned_course AS MATERIALIZED (
  SELECT id FROM course_library_list_v3($1) WHERE id=$3
)
SELECT usage.*
FROM owned_course
LEFT JOIN LATERAL (
  SELECT DISTINCT classroom.id AS classroom_id, classroom.title AS classroom_title,
    classroom.status AS classroom_status, run.run_id, run.course_version_id,
    run.version_number, run.run_title, run.run_status,
    learning_audience_for_teacher($2,classroom.id,NULL,run.run_id)->>'type' AS audience_type
  FROM classroom_list_for_account($2) classroom
  CROSS JOIN LATERAL classroom_course_runs_for_teacher_v2($2,classroom.id) run
  WHERE run.course_id=owned_course.id
) usage ON true
ORDER BY usage.classroom_title, usage.classroom_id, usage.version_number, usage.run_id
`;
