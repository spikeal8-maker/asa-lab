-- INT-E1-15 / LRN-UX-02. Reading is evidence, not completion of child practices.
-- Forward-only; requires the accepted common prefix 0226-0235. No data or
-- published policy is rewritten. The strict migration runner stays unchanged.
-- Current CourseVersion schemas 1-3 have no optional/required selector: their
-- pinned lessons/visible activity blocks are the all-required contract. An
-- explicit withdrawn or excused Participation removes that child's requirement.
-- Unknown/missing/ambiguous pins never manufacture a completed lesson.

CREATE OR REPLACE FUNCTION public.learning_course_completion_internal(p_enrollment uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
WITH scope AS (
  SELECT enrollment.*, course.course_version_id, course.classroom_id,
         course.status AS course_status, version.outline
    FROM public.course_enrollments enrollment
    JOIN public.classroom_course_runs course ON course.id=enrollment.course_run_id
      AND course.tenant_id=enrollment.tenant_id
    JOIN public.course_versions version ON version.id=course.course_version_id
   WHERE enrollment.id=p_enrollment AND enrollment.status IN ('assigned','active')
), lessons AS (
  SELECT scope.*, lesson.id AS lesson_id, lesson.kind,
         lesson.section_position, lesson.lesson_position,
         CASE WHEN pin.pin_count=1 AND pin.value->>'kind'=lesson.kind
           THEN pin.value END AS pinned_lesson,
         reading.id AS reading_id, reading.completed_at AS material_read_at
    FROM scope
    JOIN public.classroom_course_run_lessons lesson
      ON lesson.run_id=scope.course_run_id AND lesson.tenant_id=scope.tenant_id
    LEFT JOIN LATERAL (
      SELECT entry.value, count(*) OVER () AS pin_count
        FROM jsonb_array_elements(scope.outline->'sections') section
        CROSS JOIN LATERAL jsonb_array_elements(section->'lessons') entry(value)
       WHERE entry.value->>'sourceLessonId'=lesson.source_lesson_id::text
         AND section->>'sourceSectionId'=lesson.source_section_id::text
       LIMIT 1
    ) pin ON true
    LEFT JOIN LATERAL (
      SELECT progress.id, progress.completed_at
        FROM public.classroom_course_lesson_progress progress
        JOIN public.classroom_student_seats seat ON seat.id=progress.seat_id
          AND seat.tenant_id=scope.tenant_id AND seat.classroom_id=scope.classroom_id
       WHERE progress.run_id=scope.course_run_id AND progress.lesson_id=lesson.id
         AND EXISTS (
           SELECT 1 FROM public.learner_identity_links link
            WHERE link.learner_identity_id=scope.learner_identity_id
              AND link.tenant_id=scope.tenant_id AND link.school_id=scope.school_id
              AND link.link_kind='student_seat' AND link.seat_id=seat.id
              AND link.status='active'
         )
       ORDER BY progress.completed_at, progress.id LIMIT 1
    ) reading ON true
), pins AS (
  SELECT lesson.*, block.value->>'id' AS block_id,
         block.value->>'learningActivityVersionId' AS version_id,
         block.ordinality AS position
    FROM lessons lesson
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(lesson.pinned_lesson->'blocks')='array'
        THEN lesson.pinned_lesson->'blocks' ELSE '[]'::jsonb END
    ) WITH ORDINALITY block(value,ordinality)
   WHERE block.value->>'type'='activity'
     AND block.value->'hidden' IS DISTINCT FROM 'true'::jsonb
  UNION ALL
  SELECT lesson.*, NULL::text,
         lesson.pinned_lesson->>'learningActivityVersionId', 0::bigint
    FROM lessons lesson WHERE lesson.kind='assignment'
), evidence AS (
  SELECT pin.lesson_id, pin.block_id, pin.position, pin.course_status,
         runtime.id AS activity_run_id, runtime.lifecycle_status,
         runtime.run_count, part.id AS participation_id, part.status,
         COALESCE(part.excused,false) AS excused,
         version.policy_snapshot,
         selected.result_id, result.review_decision,
         COALESCE(result.completion_value,false) AS selected_completed,
         conditions.value AS conditions
    FROM pins pin
    LEFT JOIN LATERAL (
      SELECT run.id, run.lifecycle_status, run.learning_activity_version_id,
             count(*) OVER () AS run_count
        FROM public.activity_runs run
       WHERE run.tenant_id=pin.tenant_id AND run.source_kind='course'
         AND run.source_course_run_id=pin.course_run_id
         AND run.source_course_lesson_id=pin.lesson_id
         AND run.source_course_block_id IS NOT DISTINCT FROM pin.block_id
         AND run.learning_activity_version_id::text=pin.version_id
       ORDER BY run.id LIMIT 1
    ) runtime ON true
    LEFT JOIN public.learning_activity_versions version
      ON version.id=runtime.learning_activity_version_id
    LEFT JOIN public.activity_participations part
      ON part.activity_run_id=runtime.id
      AND part.learner_identity_id=pin.learner_identity_id
      AND part.source_course_enrollment_id=pin.id
    LEFT JOIN LATERAL public.learning_selected_result_internal(part.id) selected ON true
    LEFT JOIN public.assessment_results result ON result.id=selected.result_id
    LEFT JOIN LATERAL (
      SELECT public.learning_effective_conditions_internal(runtime.id,part.id) AS value
    ) conditions ON true
), practices AS (
  SELECT evidence.*,
         (run_count IS DISTINCT FROM 1) AS unresolved,
         (run_count IS DISTINCT FROM 1 OR
          (participation_id IS NOT NULL AND status IN ('assigned','active')
           AND NOT excused AND lifecycle_status<>'cancelled')) AS required,
         -- Completion comes from the one selected-result resolver. In the
         -- existing project/manual contract even an old `submission` policy
         -- never turns submitted/evaluating into an accepted result. Automatic
         -- evaluators keep their existing selected completion_value authority.
         (run_count=1 AND selected_completed AND
          (policy_snapshot#>>'{assessmentPolicy,mode}' IS DISTINCT FROM 'manual'
           OR review_decision='accepted')) AS completed,
         CASE
           WHEN run_count IS DISTINCT FROM 1 THEN 'unresolved_origin'
           WHEN participation_id IS NULL OR status='withdrawn' THEN 'not_assigned'
           WHEN excused THEN 'excused'
           WHEN course_status<>'open' OR lifecycle_status<>'active' THEN 'closed'
           WHEN (conditions#>>'{values,opensAt}')::timestamptz>now() THEN 'not_open'
           WHEN (conditions#>>'{values,closesAt}')::timestamptz<now() THEN 'closed'
           WHEN conditions#>>'{values,latePolicy}'='block_at_due'
             AND (conditions#>>'{values,dueAt}')::timestamptz<now()
             AND NOT COALESCE((conditions->>'teacherUnlocked')::boolean,false)
             THEN 'after_due'
           ELSE NULL
         END AS blocked_reason
    FROM evidence
), lesson_states AS (
  SELECT lesson.lesson_id, lesson.section_position, lesson.lesson_position,
         lesson.kind='material' AS reading_required,
         lesson.material_read_at, lesson.reading_id,
         lesson.pinned_lesson IS NULL OR COALESCE(bool_or(practice.unresolved),false)
           OR EXISTS (
             SELECT 1 FROM public.activity_runs extra
             JOIN public.activity_participations participation
               ON participation.activity_run_id=extra.id
               AND participation.source_course_enrollment_id=lesson.id
               AND participation.status IN ('assigned','active') AND NOT participation.excused
             WHERE extra.source_course_lesson_id=lesson.lesson_id
               AND extra.source_course_run_id=lesson.course_run_id
               AND extra.lifecycle_status<>'cancelled'
               AND NOT EXISTS (
                 SELECT 1 FROM pins expected WHERE expected.lesson_id=lesson.lesson_id
                   AND expected.block_id IS NOT DISTINCT FROM extra.source_course_block_id
                   AND expected.version_id=extra.learning_activity_version_id::text
               )
           )
           AS unresolved,
         lesson.kind='material' OR count(*) FILTER(WHERE practice.required)>0 AS required,
         lesson.kind<>'material' AND count(practice.lesson_id)>0
           AND count(*) FILTER(WHERE practice.excused)=count(practice.lesson_id) AS excused,
         count(*) FILTER(WHERE practice.required) AS practice_total,
         count(*) FILTER(WHERE practice.required AND practice.completed) AS practice_completed,
         count(*) FILTER(WHERE practice.excused) AS excused_practice_count,
         (lesson.kind<>'material' OR lesson.material_read_at IS NOT NULL)
           AND lesson.pinned_lesson IS NOT NULL
           AND COALESCE(bool_and(COALESCE(practice.completed,false))
             FILTER(WHERE practice.required),true) AS completed,
         COALESCE(jsonb_agg(jsonb_build_object(
           'activityRunId',practice.activity_run_id,'blockId',practice.block_id,
           'required',practice.required,'completed',COALESCE(practice.completed,false),
           'excused',practice.excused,'unresolved',practice.unresolved,
           'reviewRequired',COALESCE(practice.policy_snapshot#>>'{assessmentPolicy,mode}'='manual',true),
           'completionPolicy',practice.policy_snapshot->'completionPolicy',
           'blockedReason',practice.blocked_reason
         ) ORDER BY practice.position,practice.activity_run_id)
           FILTER(WHERE practice.lesson_id IS NOT NULL),'[]'::jsonb) AS practices,
         COALESCE(jsonb_agg(practice.result_id ORDER BY practice.position)
           FILTER(WHERE practice.required AND practice.result_id IS NOT NULL),'[]'::jsonb)
           || CASE WHEN lesson.reading_id IS NULL THEN '[]'::jsonb
                   ELSE jsonb_build_array(lesson.reading_id) END AS basis_ids
    FROM lessons lesson LEFT JOIN practices practice ON practice.lesson_id=lesson.lesson_id
   GROUP BY lesson.id,lesson.course_run_id,lesson.lesson_id,lesson.section_position,lesson.lesson_position,lesson.kind,
            lesson.material_read_at,lesson.reading_id,lesson.pinned_lesson
), summary AS (
  SELECT count(*) FILTER(WHERE required) AS total,
         count(*) AS lesson_count, count(*) FILTER(WHERE excused) AS excused_count,
         count(*) FILTER(WHERE required AND completed AND NOT unresolved) AS completed_count,
         COALESCE(bool_or(unresolved),false) AS unresolved,
         COALESCE(jsonb_agg(jsonb_build_object(
           'lessonId',lesson_id,'required',required,'excused',excused,
           'completed',required AND completed AND NOT unresolved,
           'readingRequired',reading_required,'materialReadAt',material_read_at,
           'practiceTotal',practice_total,'practiceCompleted',practice_completed,
           'excusedPracticeCount',excused_practice_count,'unresolved',unresolved,
           'practices',practices
         ) ORDER BY section_position,lesson_position,lesson_id),'[]'::jsonb) AS lessons
    FROM lesson_states
)
SELECT jsonb_build_object(
  'completed',total>0 AND total=completed_count AND NOT unresolved,
  'total',total,'lessonCount',lesson_count,'excusedCount',excused_count,
  'completedCount',completed_count,'lessons',lessons,
  'basisIds',COALESCE((SELECT jsonb_agg(DISTINCT basis.value)
    FROM lesson_states CROSS JOIN LATERAL jsonb_array_elements(basis_ids) basis(value)
    WHERE required),'[]'::jsonb),
  'reason',CASE WHEN unresolved THEN 'completion_unresolved'
    WHEN total=0 THEN 'no_required_lessons'
    WHEN total=completed_count THEN 'required_lessons_completed'
    ELSE 'required_lessons_pending' END,
  'resultPolicy','no_course_grade'
) FROM summary;
$$;

REVOKE ALL ON FUNCTION public.learning_course_completion_internal(uuid) FROM PUBLIC,asalab_app;

-- Public reads reuse the same audience/identity proof as existing course reads.
-- Do not expose enrollment ids or internal result/basis ids to the browser.
CREATE FUNCTION public.learning_course_completions_for_seat(p_seat uuid)
RETURNS TABLE(run_id uuid, completion jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT enrollment.course_run_id,
         public.learning_course_completion_internal(enrollment.id)-'basisIds'
    FROM public.classroom_student_seats seat
    JOIN public.classrooms classroom ON classroom.id=seat.classroom_id
      AND classroom.tenant_id=seat.tenant_id
    JOIN public.learner_identity_links link ON link.seat_id=seat.id
      AND link.tenant_id=seat.tenant_id AND link.school_id=classroom.school_id
      AND link.link_kind='student_seat' AND link.status='active'
    JOIN public.learner_identities learner ON learner.id=link.learner_identity_id
      AND learner.tenant_id=link.tenant_id AND learner.school_id=link.school_id
      AND learner.state='active'
    JOIN public.course_enrollments enrollment
      ON enrollment.learner_identity_id=link.learner_identity_id
      AND enrollment.tenant_id=link.tenant_id AND enrollment.school_id=link.school_id
      AND enrollment.status IN ('assigned','active')
    JOIN public.classroom_course_runs course ON course.id=enrollment.course_run_id
      AND course.tenant_id=seat.tenant_id AND course.classroom_id=seat.classroom_id
   WHERE seat.id=p_seat AND seat.status='active'
     AND public.learning_course_seat_visible(seat.id,course.id);
$$;

CREATE FUNCTION public.learning_course_completions_for_account(p_account uuid)
RETURNS TABLE(run_id uuid, completion jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT progress.run_id, progress.completion
    FROM public.accounts account
    JOIN public.classroom_student_seats seat ON seat.account_id=account.id AND seat.status='active'
    JOIN public.classrooms classroom ON classroom.id=seat.classroom_id
      AND classroom.tenant_id=seat.tenant_id
    CROSS JOIN LATERAL public.learning_course_completions_for_seat(seat.id) progress
   WHERE account.id=p_account AND account.status='active'
     AND EXISTS (
       SELECT 1 FROM public.learner_identity_links seat_link
       JOIN public.learner_identity_links account_link
         ON account_link.learner_identity_id=seat_link.learner_identity_id
         AND account_link.tenant_id=seat_link.tenant_id
         AND account_link.school_id=seat_link.school_id
         AND account_link.link_kind='account' AND account_link.status='active'
         AND account_link.account_id=account.id
       WHERE seat_link.seat_id=seat.id AND seat_link.link_kind='student_seat'
         AND seat_link.status='active' AND seat_link.tenant_id=seat.tenant_id
         AND seat_link.school_id=classroom.school_id
     );
$$;

REVOKE ALL ON FUNCTION public.learning_course_completions_for_seat(uuid),
  public.learning_course_completions_for_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_course_completions_for_seat(uuid),
  public.learning_course_completions_for_account(uuid) TO asalab_app;

COMMENT ON COLUMN public.classroom_course_lesson_progress.completed_at IS
  'Explicit reading acknowledgement. Mixed lesson/course completion is derived by learning_course_completion_internal, never by this timestamp alone.';
