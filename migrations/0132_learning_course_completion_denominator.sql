-- Exemption changes required work, never an academic result or historical evidence.
CREATE OR REPLACE FUNCTION learning_course_completion_internal(p_enrollment uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH lessons AS (
 SELECT lesson.id,COALESCE(part.excused,false) AS excused,
   CASE WHEN lesson.kind='material' THEN progress.id IS NOT NULL
     ELSE COALESCE(result.completion_value,false) END AS completed,
   CASE WHEN lesson.kind='material' THEN progress.id ELSE result.id END AS basis_id
 FROM public.course_enrollments enrollment
 JOIN public.classroom_course_runs course ON course.id=enrollment.course_run_id
 JOIN public.classroom_course_run_lessons lesson ON lesson.run_id=course.id
 LEFT JOIN public.learner_identity_links link ON link.learner_identity_id=enrollment.learner_identity_id
   AND link.status='active' AND link.link_kind='student_seat'
 LEFT JOIN public.classroom_student_seats seat ON seat.id=link.seat_id
 LEFT JOIN public.classroom_course_lesson_progress progress ON progress.lesson_id=lesson.id AND progress.seat_id=seat.id
 LEFT JOIN public.activity_runs run ON run.source_course_lesson_id=lesson.id
 LEFT JOIN public.activity_participations part ON part.activity_run_id=run.id AND part.source_course_enrollment_id=enrollment.id
 LEFT JOIN LATERAL public.learning_selected_result_internal(part.id) selected ON true
 LEFT JOIN public.assessment_results result ON result.id=selected.result_id
 WHERE enrollment.id=p_enrollment AND enrollment.status IN ('assigned','active')
   AND seat.classroom_id=course.classroom_id
 ) SELECT jsonb_build_object(
   'completed',count(*) FILTER(WHERE NOT excused)>0 AND COALESCE(bool_and(completed) FILTER(WHERE NOT excused),false),
   'total',count(*) FILTER(WHERE NOT excused),'lessonCount',count(*),
   'excusedCount',count(*) FILTER(WHERE excused),
   'completedCount',count(*) FILTER(WHERE completed AND NOT excused),
   'basisIds',COALESCE(jsonb_agg(basis_id ORDER BY id) FILTER(WHERE NOT excused),'[]'::jsonb),
   'reason',CASE WHEN count(*) FILTER(WHERE NOT excused)=0 THEN 'no_required_lessons'
     WHEN bool_and(completed) FILTER(WHERE NOT excused) THEN 'required_lessons_completed' ELSE 'required_lessons_pending' END,
   'resultPolicy','no_course_grade') FROM lessons;
$$;
REVOKE ALL ON FUNCTION learning_course_completion_internal(uuid) FROM PUBLIC,asalab_app;
