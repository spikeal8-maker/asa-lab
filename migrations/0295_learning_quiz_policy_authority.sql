-- E2-Q1 draft: canonical Quiz ActivityVersion owns runtime policy.
-- Provisional number: reconcile with other unmerged 0289 candidates before integration.
-- No historical rows, legacy Quiz writers, ACLs or published digests are changed.

CREATE OR REPLACE FUNCTION learning_activity_normalize_draft(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_kind varchar,
    p_title varchar,
    p_instructions varchar,
    p_result_mode varchar,
    p_max_points integer,
    p_policy_snapshot jsonb,
    p_module_key varchar,
    p_quiz_version_id uuid,
    p_starter_project_version_id uuid,
    p_source_teacher_assignment_id uuid
)
RETURNS TABLE (result_code varchar, draft_payload jsonb, authoring_origin varchar)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_title varchar := NULLIF(trim(p_title), '');
    v_instructions varchar := NULLIF(trim(p_instructions), '');
    v_module varchar := NULLIF(trim(p_module_key), '');
    v_max integer := p_max_points;
    v_policy jsonb := p_policy_snapshot;
    v_quiz record;
    v_check record;
    v_assignment record;
    v_origin varchar := 'canonical';
BEGIN
    IF NOT public.learning_author_can_use_tenant(p_principal_id, p_tenant_id) THEN
        RETURN QUERY SELECT 'tenant_forbidden'::varchar, NULL::jsonb, NULL::varchar;
        RETURN;
    END IF;
    IF p_kind NOT IN ('quiz', 'project', 'essay', 'file', 'manual')
       OR p_result_mode NOT IN ('ungraded', 'completion', 'graded')
       OR v_title IS NULL OR length(v_title) > 255
       OR (v_instructions IS NOT NULL AND length(v_instructions) > 12000)
       OR jsonb_typeof(v_policy) IS DISTINCT FROM 'object'
       OR NOT (v_policy ?& ARRAY[
           'attemptPolicy', 'resultSelectionPolicy', 'completionPolicy',
           'latePolicy', 'assessmentPolicy', 'feedbackReleasePolicy'
       ])
       OR (v_policy - ARRAY[
           'attemptPolicy', 'resultSelectionPolicy', 'completionPolicy',
           'latePolicy', 'assessmentPolicy', 'feedbackReleasePolicy'
       ]) <> '{}'::jsonb
       OR jsonb_typeof(v_policy -> 'attemptPolicy') NOT IN ('object', 'null')
       OR jsonb_typeof(v_policy -> 'resultSelectionPolicy') NOT IN ('object', 'null')
       OR jsonb_typeof(v_policy -> 'completionPolicy') NOT IN ('object', 'null')
       OR jsonb_typeof(v_policy -> 'latePolicy') NOT IN ('object', 'null')
       OR jsonb_typeof(v_policy -> 'assessmentPolicy') NOT IN ('object', 'null')
       OR jsonb_typeof(v_policy -> 'feedbackReleasePolicy') NOT IN ('object', 'null') THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::jsonb, NULL::varchar;
        RETURN;
    END IF;
    IF (p_result_mode = 'graded' AND (v_max IS NULL OR v_max <= 0))
       OR (p_result_mode IN ('ungraded', 'completion') AND v_max IS NOT NULL) THEN
        RETURN QUERY SELECT 'invalid_result_mode'::varchar, NULL::jsonb, NULL::varchar;
        RETURN;
    END IF;
    IF p_starter_project_version_id IS NOT NULL THEN
        -- CURRENT ProjectVersion has no authoring-starter provenance. A learner
        -- submission checkpoint cannot silently become reusable source content.
        RETURN QUERY SELECT 'starter_project_unprovenanced'::varchar,
                            NULL::jsonb, NULL::varchar;
        RETURN;
    END IF;
    IF p_source_teacher_assignment_id IS NOT NULL THEN
        SELECT assignment.title, assignment.brief, assignment.module_key
          INTO v_assignment
          FROM public.teacher_assignments assignment
         WHERE assignment.id = p_source_teacher_assignment_id
           AND assignment.tenant_id = p_tenant_id
           AND assignment.owner_principal_id = p_principal_id;
        IF v_assignment.title IS NULL OR p_kind <> 'project' THEN
            RETURN QUERY SELECT 'teacher_assignment_forbidden'::varchar,
                                NULL::jsonb, NULL::varchar;
            RETURN;
        END IF;
        v_title := v_assignment.title;
        v_instructions := v_assignment.brief;
        v_module := v_assignment.module_key;
        v_origin := 'teacher_assignment';
    END IF;
    IF p_kind = 'project' AND v_module IS NULL THEN
        RETURN QUERY SELECT 'project_module_required'::varchar, NULL::jsonb, NULL::varchar;
        RETURN;
    END IF;
    IF p_kind = 'quiz' THEN
        SELECT quiz.id, quiz.total_points
          INTO v_quiz
          FROM public.quiz_versions quiz
         WHERE quiz.id = p_quiz_version_id
           AND quiz.tenant_id = p_tenant_id
           AND quiz.owner_principal_id = p_principal_id;
        IF v_quiz.id IS NULL THEN
            RETURN QUERY SELECT 'quiz_version_forbidden'::varchar, NULL::jsonb, NULL::varchar;
            RETURN;
        END IF;
        v_origin := 'quiz_version';
        v_max := CASE WHEN p_result_mode = 'graded' THEN v_quiz.total_points ELSE NULL END;
        -- QuizVersion supplies immutable content/points, never runtime policy.
        -- Preserve the existing six-key object-or-null contract. Optional numeric
        -- settings stay absent/null; there is no undocumented numeric default.
        -- Positive integral limits fit the existing integer readers; no new
        -- pedagogical attempt/time cap is introduced by this authoring change.
        FOR v_check IN
            SELECT v_policy #> '{attemptPolicy,maxAttempts}' AS value, 1 AS minimum, 2147483647 AS maximum
            UNION ALL
            SELECT v_policy #> '{attemptPolicy,timeLimitMinutes}', 1, 2147483647
            UNION ALL
            SELECT v_policy #> '{attemptPolicy,timeLimitSeconds}', 1, 2147483647
            UNION ALL
            SELECT v_policy #> '{assessmentPolicy,passThresholdBasisPoints}', 0, 10000
        LOOP
            IF v_check.value IS NULL OR v_check.value = 'null'::jsonb THEN CONTINUE; END IF;
            IF jsonb_typeof(v_check.value) <> 'number'
               OR v_check.value #>> '{}' !~ '^[0-9]+$' THEN
                RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::jsonb, NULL::varchar;
                RETURN;
            END IF;
            IF (v_check.value #>> '{}')::numeric NOT BETWEEN v_check.minimum AND v_check.maximum THEN
                RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::jsonb, NULL::varchar;
                RETURN;
            END IF;
        END LOOP;
        IF v_policy #>> '{feedbackReleasePolicy,mode}' IS NOT NULL
           AND v_policy #>> '{feedbackReleasePolicy,mode}' NOT IN ('immediate', 'score_only', 'after_close') THEN
            RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::jsonb, NULL::varchar;
            RETURN;
        END IF;
        IF v_policy #>> '{latePolicy,mode}' IS NOT NULL
           AND v_policy #>> '{latePolicy,mode}' NOT IN ('allow_mark_late', 'block_at_due', 'allow_until_close') THEN
            RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::jsonb, NULL::varchar;
            RETURN;
        END IF;
        IF p_result_mode = 'graded' THEN
            -- ASM-SEL-002: best is the Quiz default. No legacy Quiz policy is read.
            IF v_policy -> 'resultSelectionPolicy' = 'null'::jsonb
               OR v_policy #>> '{resultSelectionPolicy,mode}' IS NULL THEN
                v_policy := jsonb_set(v_policy, '{resultSelectionPolicy}',
                    COALESCE(NULLIF(v_policy -> 'resultSelectionPolicy', 'null'::jsonb), '{}'::jsonb)
                    || jsonb_build_object('mode','best'));
            END IF;
            IF v_policy #>> '{resultSelectionPolicy,mode}' NOT IN ('first','latest','best','latest_accepted','teacher_selected') THEN
                RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::jsonb, NULL::varchar;
                RETURN;
            END IF;
        END IF;
    ELSIF p_quiz_version_id IS NOT NULL THEN
        RETURN QUERY SELECT 'quiz_reference_wrong_kind'::varchar, NULL::jsonb, NULL::varchar;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'ok'::varchar, jsonb_build_object(
        'kind', p_kind,
        'title', v_title,
        'instructions', v_instructions,
        'resultMode', p_result_mode,
        'maxPoints', v_max,
        'policies', v_policy,
        'moduleKey', v_module,
        'quizVersionId', p_quiz_version_id,
        'starterProjectVersionId', p_starter_project_version_id,
        'sourceTeacherAssignmentId', p_source_teacher_assignment_id
    ), v_origin;
END;
$$;
