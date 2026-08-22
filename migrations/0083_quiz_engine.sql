-- Versioned question bank and deterministic automatic quiz grading.

CREATE TABLE IF NOT EXISTS question_bank_items (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    owner_principal_id  uuid NOT NULL REFERENCES principals(id),
    scope_kind          varchar(16) NOT NULL,
    subject             varchar(80),
    age_band            varchar(32),
    tags                text[] NOT NULL DEFAULT ARRAY[]::text[],
    language            varchar(16) NOT NULL DEFAULT 'ru',
    created_at          timestamptz NOT NULL DEFAULT now(),
    archived_at         timestamptz,
    UNIQUE (tenant_id, id),
    CONSTRAINT question_bank_scope_check CHECK (scope_kind IN ('personal', 'school')),
    CONSTRAINT question_bank_language_check CHECK (language ~ '^[a-z]{2}(-[A-Z]{2})?$')
);

CREATE TABLE IF NOT EXISTS question_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    question_id     uuid NOT NULL,
    version_number  integer NOT NULL,
    question_type   varchar(24) NOT NULL,
    prompt_blocks   jsonb NOT NULL,
    response_schema jsonb NOT NULL,
    max_points      integer NOT NULL,
    scoring_policy  jsonb NOT NULL DEFAULT '{"kind":"all_or_nothing"}'::jsonb,
    content_digest  varchar(64) NOT NULL,
    published_at    timestamptz NOT NULL DEFAULT now(),
    archived_at     timestamptz,
    UNIQUE (tenant_id, id),
    UNIQUE (question_id, version_number),
    FOREIGN KEY (tenant_id, question_id)
        REFERENCES question_bank_items(tenant_id, id),
    CONSTRAINT question_versions_number_check CHECK (version_number > 0),
    CONSTRAINT question_versions_points_check CHECK (max_points > 0),
    CONSTRAINT question_versions_type_check CHECK (
        question_type IN ('single_choice', 'multiple_choice', 'boolean',
                          'numeric', 'short_text')
    ),
    CONSTRAINT question_versions_prompt_check CHECK (
        jsonb_typeof(prompt_blocks) = 'array' AND jsonb_array_length(prompt_blocks) > 0
    )
);

-- Deliberately no learner/runtime SELECT grant. Learner DTOs are built from
-- question_versions by allowlist and never join this table.
CREATE TABLE IF NOT EXISTS question_answer_keys (
    tenant_id          uuid NOT NULL REFERENCES tenants(id),
    question_version_id uuid PRIMARY KEY,
    answer_key         jsonb NOT NULL,
    key_digest         varchar(64) NOT NULL,
    UNIQUE (tenant_id, question_version_id),
    FOREIGN KEY (tenant_id, question_version_id)
        REFERENCES question_versions(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS quiz_versions (
    id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                    uuid NOT NULL REFERENCES tenants(id),
    owner_principal_id           uuid NOT NULL REFERENCES principals(id),
    learning_activity_version_id uuid NOT NULL,
    title                        varchar(255) NOT NULL,
    instructions                 varchar(12000),
    question_count               integer NOT NULL,
    total_points                 integer NOT NULL,
    attempt_limit                integer NOT NULL DEFAULT 1,
    time_limit_minutes           integer,
    pass_threshold_basis_points  integer NOT NULL DEFAULT 6000,
    feedback_release_policy      varchar(24) NOT NULL DEFAULT 'immediate',
    content_digest               varchar(64) NOT NULL,
    published_at                 timestamptz NOT NULL DEFAULT now(),
    archived_at                  timestamptz,
    UNIQUE (tenant_id, id),
    UNIQUE (learning_activity_version_id),
    FOREIGN KEY (tenant_id, learning_activity_version_id)
        REFERENCES learning_activity_versions(tenant_id, id),
    CONSTRAINT quiz_versions_title_check CHECK (length(trim(title)) > 0),
    CONSTRAINT quiz_versions_count_check CHECK (question_count > 0),
    CONSTRAINT quiz_versions_points_check CHECK (total_points > 0),
    CONSTRAINT quiz_versions_attempts_check CHECK (attempt_limit BETWEEN 1 AND 20),
    CONSTRAINT quiz_versions_time_check CHECK (
        time_limit_minutes IS NULL OR time_limit_minutes BETWEEN 1 AND 480
    ),
    CONSTRAINT quiz_versions_threshold_check CHECK (
        pass_threshold_basis_points BETWEEN 0 AND 10000
    ),
    CONSTRAINT quiz_versions_feedback_check CHECK (
        feedback_release_policy IN ('immediate', 'score_only', 'after_close')
    )
);

CREATE TABLE IF NOT EXISTS quiz_version_questions (
    tenant_id          uuid NOT NULL REFERENCES tenants(id),
    quiz_version_id    uuid NOT NULL,
    question_version_id uuid NOT NULL,
    position           integer NOT NULL,
    required           boolean NOT NULL DEFAULT true,
    max_points         integer NOT NULL,
    PRIMARY KEY (quiz_version_id, position),
    UNIQUE (quiz_version_id, question_version_id),
    FOREIGN KEY (tenant_id, quiz_version_id)
        REFERENCES quiz_versions(tenant_id, id),
    FOREIGN KEY (tenant_id, question_version_id)
        REFERENCES question_versions(tenant_id, id),
    CONSTRAINT quiz_version_questions_position_check CHECK (position > 0),
    CONSTRAINT quiz_version_questions_points_check CHECK (max_points > 0)
);

ALTER TABLE classroom_assignments
    ADD COLUMN IF NOT EXISTS quiz_version_id uuid REFERENCES quiz_versions(id);
ALTER TABLE classroom_assignments DROP CONSTRAINT IF EXISTS classroom_assignments_source_check;
ALTER TABLE classroom_assignments
    ADD CONSTRAINT classroom_assignments_source_check CHECK (
        num_nonnulls(assignment_id, course_run_id, quiz_version_id) = 1
    );
CREATE UNIQUE INDEX IF NOT EXISTS classroom_quiz_handout_idx
    ON classroom_assignments (classroom_id, quiz_version_id)
    WHERE quiz_version_id IS NOT NULL;

ALTER TABLE learning_submissions ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE learning_submissions ALTER COLUMN project_version_id DROP NOT NULL;
ALTER TABLE learning_submissions ADD CONSTRAINT learning_submissions_payload_kind_check CHECK (
    (project_id IS NOT NULL AND project_version_id IS NOT NULL
                            AND payload_manifest ->> 'kind' = 'project')
    OR (project_id IS NULL AND project_version_id IS NULL
                           AND payload_manifest ->> 'kind' = 'quiz')
);

CREATE TABLE IF NOT EXISTS attempt_answers (
    tenant_id          uuid NOT NULL REFERENCES tenants(id),
    attempt_id         uuid NOT NULL,
    question_version_id uuid NOT NULL,
    response           jsonb NOT NULL,
    awarded_points     integer NOT NULL,
    max_points         integer NOT NULL,
    is_correct         boolean NOT NULL,
    evaluated_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (attempt_id, question_version_id),
    FOREIGN KEY (tenant_id, attempt_id)
        REFERENCES learning_attempts(tenant_id, id),
    FOREIGN KEY (tenant_id, question_version_id)
        REFERENCES question_versions(tenant_id, id),
    CONSTRAINT attempt_answers_points_check CHECK (
        max_points > 0 AND awarded_points BETWEEN 0 AND max_points
    )
);

DROP TRIGGER IF EXISTS question_versions_immutable ON question_versions;
CREATE TRIGGER question_versions_immutable
    BEFORE UPDATE OR DELETE ON question_versions
    FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();
DROP TRIGGER IF EXISTS question_answer_keys_immutable ON question_answer_keys;
CREATE TRIGGER question_answer_keys_immutable
    BEFORE UPDATE OR DELETE ON question_answer_keys
    FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();
DROP TRIGGER IF EXISTS quiz_versions_immutable ON quiz_versions;
CREATE TRIGGER quiz_versions_immutable
    BEFORE UPDATE OR DELETE ON quiz_versions
    FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();
DROP TRIGGER IF EXISTS quiz_version_questions_immutable ON quiz_version_questions;
CREATE TRIGGER quiz_version_questions_immutable
    BEFORE UPDATE OR DELETE ON quiz_version_questions
    FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();
DROP TRIGGER IF EXISTS attempt_answers_immutable ON attempt_answers;
CREATE TRIGGER attempt_answers_immutable
    BEFORE UPDATE OR DELETE ON attempt_answers
    FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();

CREATE OR REPLACE FUNCTION learning_author_can_use_tenant(
    p_principal_id uuid,
    p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.principals principal
          JOIN public.workspace_memberships membership
            ON membership.account_id = principal.account_id
          JOIN public.workspaces workspace ON workspace.id = membership.workspace_id
         WHERE principal.id = p_principal_id
           AND workspace.tenant_id = p_tenant_id
    ) OR public.principal_home_tenant(p_principal_id) = p_tenant_id;
$$;

CREATE OR REPLACE FUNCTION question_version_create(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_scope_kind varchar,
    p_question_type varchar,
    p_prompt_blocks jsonb,
    p_response_schema jsonb,
    p_answer_key jsonb,
    p_max_points integer,
    p_subject varchar,
    p_age_band varchar,
    p_tags text[]
)
RETURNS TABLE (result_code varchar, question_id uuid, question_version_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_question uuid;
    v_version uuid;
    v_payload text;
    v_option_count integer;
BEGIN
    IF NOT public.learning_author_can_use_tenant(p_principal_id, p_tenant_id) THEN
        RETURN QUERY SELECT 'tenant_forbidden'::varchar, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    IF p_scope_kind NOT IN ('personal', 'school')
       OR p_question_type NOT IN ('single_choice', 'multiple_choice', 'boolean',
                                  'numeric', 'short_text')
       OR p_max_points NOT BETWEEN 1 AND 10000
       OR jsonb_typeof(p_prompt_blocks) <> 'array'
       OR jsonb_array_length(p_prompt_blocks) = 0 THEN
        RETURN QUERY SELECT 'invalid_question'::varchar, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    IF p_question_type IN ('single_choice', 'multiple_choice') THEN
        IF jsonb_typeof(p_response_schema -> 'options') <> 'array' THEN
            RETURN QUERY SELECT 'invalid_options'::varchar, NULL::uuid, NULL::uuid;
            RETURN;
        END IF;
        v_option_count := jsonb_array_length(p_response_schema -> 'options');
        IF v_option_count NOT BETWEEN 2 AND 12 THEN
            RETURN QUERY SELECT 'invalid_options'::varchar, NULL::uuid, NULL::uuid;
            RETURN;
        END IF;
        IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_response_schema -> 'options') option
             GROUP BY option ->> 'id' HAVING count(*) > 1
        ) OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_response_schema -> 'options') option
             WHERE COALESCE(trim(option ->> 'id'), '') = ''
                OR COALESCE(trim(option ->> 'label'), '') = ''
        ) THEN
            RETURN QUERY SELECT 'invalid_options'::varchar, NULL::uuid, NULL::uuid;
            RETURN;
        END IF;
    END IF;
    IF (p_question_type = 'single_choice'
        AND (jsonb_typeof(p_answer_key -> 'value') <> 'string'
             OR NOT EXISTS (
                 SELECT 1 FROM jsonb_array_elements(p_response_schema -> 'options') option
                  WHERE option ->> 'id' = p_answer_key ->> 'value'
             )))
       OR (p_question_type = 'boolean'
           AND jsonb_typeof(p_answer_key -> 'value') <> 'boolean')
       OR (p_question_type = 'multiple_choice'
           AND (jsonb_typeof(p_answer_key -> 'values') <> 'array'
                OR jsonb_array_length(p_answer_key -> 'values') = 0
                OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements_text(p_answer_key -> 'values') answer(value)
                     WHERE NOT EXISTS (
                         SELECT 1 FROM jsonb_array_elements(p_response_schema -> 'options') option
                          WHERE option ->> 'id' = answer.value
                     )
                )))
       OR (p_question_type = 'numeric'
           AND jsonb_typeof(p_answer_key -> 'value') <> 'number')
       OR (p_question_type = 'short_text'
           AND jsonb_typeof(p_answer_key -> 'accepted') <> 'array') THEN
        RETURN QUERY SELECT 'invalid_answer_key'::varchar, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;

    INSERT INTO public.question_bank_items (
        tenant_id, owner_principal_id, scope_kind, subject, age_band, tags
    ) VALUES (
        p_tenant_id, p_principal_id, p_scope_kind, NULLIF(trim(p_subject), ''),
        NULLIF(trim(p_age_band), ''), COALESCE(p_tags, ARRAY[]::text[])
    ) RETURNING id INTO v_question;
    v_payload := jsonb_build_object(
        'questionType', p_question_type,
        'promptBlocks', p_prompt_blocks,
        'responseSchema', p_response_schema,
        'maxPoints', p_max_points
    )::text;
    INSERT INTO public.question_versions (
        tenant_id, question_id, version_number, question_type, prompt_blocks,
        response_schema, max_points, content_digest
    ) VALUES (
        p_tenant_id, v_question, 1, p_question_type, p_prompt_blocks,
        p_response_schema, p_max_points,
        encode(sha256(convert_to(v_payload, 'UTF8')), 'hex')
    ) RETURNING id INTO v_version;
    INSERT INTO public.question_answer_keys (
        tenant_id, question_version_id, answer_key, key_digest
    ) VALUES (
        p_tenant_id, v_version, p_answer_key,
        encode(sha256(convert_to(p_answer_key::text, 'UTF8')), 'hex')
    );
    RETURN QUERY SELECT 'ok'::varchar, v_question, v_version;
END;
$$;

CREATE OR REPLACE FUNCTION question_bank_list(
    p_principal_id uuid,
    p_tenant_id uuid
)
RETURNS TABLE (
    question_id uuid,
    question_version_id uuid,
    question_type varchar,
    prompt_blocks jsonb,
    response_schema jsonb,
    max_points integer,
    scope_kind varchar,
    subject varchar,
    age_band varchar,
    tags text[],
    published_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT item.id, version.id, version.question_type, version.prompt_blocks,
           version.response_schema, version.max_points, item.scope_kind,
           item.subject, item.age_band, item.tags, version.published_at
      FROM public.question_bank_items item
      JOIN public.question_versions version ON version.question_id = item.id
     WHERE item.tenant_id = p_tenant_id
       AND item.archived_at IS NULL
       AND version.archived_at IS NULL
       AND (item.owner_principal_id = p_principal_id OR item.scope_kind = 'school')
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
     ORDER BY version.published_at DESC, item.id;
$$;

CREATE OR REPLACE FUNCTION quiz_version_create(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_title varchar,
    p_instructions varchar,
    p_question_version_ids jsonb,
    p_attempt_limit integer,
    p_time_limit_minutes integer,
    p_pass_threshold_basis_points integer,
    p_feedback_release_policy varchar
)
RETURNS TABLE (
    result_code varchar,
    quiz_version_id uuid,
    learning_activity_version_id uuid,
    total_points integer
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_activity uuid;
    v_activity_version uuid;
    v_quiz uuid;
    v_total integer;
    v_count integer;
    v_id_text text;
    v_question record;
    v_position integer := 0;
    v_digest varchar;
BEGIN
    IF NOT public.learning_author_can_use_tenant(p_principal_id, p_tenant_id) THEN
        RETURN QUERY SELECT 'tenant_forbidden'::varchar, NULL::uuid, NULL::uuid, NULL::integer;
        RETURN;
    END IF;
    IF length(trim(p_title)) NOT BETWEEN 1 AND 255
       OR jsonb_typeof(p_question_version_ids) <> 'array'
       OR jsonb_array_length(p_question_version_ids) NOT BETWEEN 1 AND 100
       OR p_attempt_limit NOT BETWEEN 1 AND 20
       OR (p_time_limit_minutes IS NOT NULL AND p_time_limit_minutes NOT BETWEEN 1 AND 480)
       OR p_pass_threshold_basis_points NOT BETWEEN 0 AND 10000
       OR p_feedback_release_policy NOT IN ('immediate', 'score_only', 'after_close') THEN
        RETURN QUERY SELECT 'invalid_quiz'::varchar, NULL::uuid, NULL::uuid, NULL::integer;
        RETURN;
    END IF;
    SELECT count(*)::integer, sum(version.max_points)::integer
      INTO v_count, v_total
      FROM jsonb_array_elements_text(p_question_version_ids) requested(id)
      JOIN public.question_versions version ON version.id = requested.id::uuid
      JOIN public.question_bank_items item ON item.id = version.question_id
     WHERE version.tenant_id = p_tenant_id
       AND (item.owner_principal_id = p_principal_id OR item.scope_kind = 'school');
    IF v_count <> jsonb_array_length(p_question_version_ids) OR v_total IS NULL THEN
        RETURN QUERY SELECT 'question_not_found'::varchar, NULL::uuid, NULL::uuid, NULL::integer;
        RETURN;
    END IF;

    INSERT INTO public.learning_activities (
        tenant_id, owner_principal_id, scope_kind, activity_type, title
    ) VALUES (p_tenant_id, p_principal_id, 'school', 'quiz', trim(p_title))
    RETURNING id INTO v_activity;
    v_digest := encode(sha256(convert_to(jsonb_build_object(
        'title', trim(p_title), 'instructions', p_instructions,
        'questions', p_question_version_ids, 'attemptLimit', p_attempt_limit,
        'timeLimitMinutes', p_time_limit_minutes,
        'passThresholdBasisPoints', p_pass_threshold_basis_points,
        'feedbackReleasePolicy', p_feedback_release_policy
    )::text, 'UTF8')), 'hex');
    INSERT INTO public.learning_activity_versions (
        tenant_id, activity_id, version_number, title, instructions,
        activity_type, max_points, scoring_policy, content_digest
    ) VALUES (
        p_tenant_id, v_activity, 1, trim(p_title), NULLIF(trim(p_instructions), ''),
        'quiz', v_total,
        jsonb_build_object('kind', 'automatic',
                           'passThresholdBasisPoints', p_pass_threshold_basis_points),
        v_digest
    ) RETURNING id INTO v_activity_version;
    INSERT INTO public.quiz_versions (
        tenant_id, owner_principal_id, learning_activity_version_id,
        title, instructions, question_count, total_points, attempt_limit,
        time_limit_minutes, pass_threshold_basis_points,
        feedback_release_policy, content_digest
    ) VALUES (
        p_tenant_id, p_principal_id, v_activity_version, trim(p_title),
        NULLIF(trim(p_instructions), ''), v_count, v_total, p_attempt_limit,
        p_time_limit_minutes, p_pass_threshold_basis_points,
        p_feedback_release_policy, v_digest
    ) RETURNING id INTO v_quiz;
    FOR v_id_text IN SELECT value FROM jsonb_array_elements_text(p_question_version_ids)
    LOOP
        SELECT version.id, version.max_points INTO v_question
          FROM public.question_versions version WHERE version.id = v_id_text::uuid;
        v_position := v_position + 1;
        INSERT INTO public.quiz_version_questions (
            tenant_id, quiz_version_id, question_version_id,
            position, required, max_points
        ) VALUES (
            p_tenant_id, v_quiz, v_question.id,
            v_position, true, v_question.max_points
        );
    END LOOP;
    RETURN QUERY SELECT 'ok'::varchar, v_quiz, v_activity_version, v_total;
END;
$$;

CREATE OR REPLACE FUNCTION quiz_version_list(
    p_principal_id uuid,
    p_tenant_id uuid
)
RETURNS TABLE (
    quiz_version_id uuid,
    title varchar,
    instructions varchar,
    question_count integer,
    total_points integer,
    attempt_limit integer,
    time_limit_minutes integer,
    pass_threshold_basis_points integer,
    feedback_release_policy varchar,
    published_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT quiz.id, quiz.title, quiz.instructions, quiz.question_count,
           quiz.total_points, quiz.attempt_limit, quiz.time_limit_minutes,
           quiz.pass_threshold_basis_points, quiz.feedback_release_policy,
           quiz.published_at
      FROM public.quiz_versions quiz
     WHERE quiz.tenant_id = p_tenant_id
       AND quiz.owner_principal_id = p_principal_id
       AND quiz.archived_at IS NULL
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
     ORDER BY quiz.published_at DESC, quiz.id;
$$;

CREATE OR REPLACE FUNCTION classroom_quiz_assign(
    p_account_id uuid,
    p_principal_id uuid,
    p_classroom_id uuid,
    p_quiz_version_id uuid,
    p_due_at timestamptz
)
RETURNS TABLE (result_code varchar, classroom_assignment_id uuid, reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_access record;
    v_quiz record;
    v_assignment uuid;
BEGIN
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN
        RETURN QUERY SELECT 'classroom_not_found'::varchar, NULL::uuid, false;
        RETURN;
    END IF;
    SELECT quiz.*, activity.id AS activity_version_id INTO v_quiz
      FROM public.quiz_versions quiz
      JOIN public.learning_activity_versions activity
        ON activity.id = quiz.learning_activity_version_id
     WHERE quiz.id = p_quiz_version_id
       AND quiz.tenant_id = v_access.tenant_id
       AND quiz.owner_principal_id = p_principal_id
       AND quiz.archived_at IS NULL;
    IF v_quiz.id IS NULL THEN
        RETURN QUERY SELECT 'quiz_not_found'::varchar, NULL::uuid, false;
        RETURN;
    END IF;
    SELECT assignment.id INTO v_assignment
      FROM public.classroom_assignments assignment
     WHERE assignment.classroom_id = p_classroom_id
       AND assignment.quiz_version_id = p_quiz_version_id;
    IF v_assignment IS NOT NULL THEN
        UPDATE public.classroom_assignments SET due_at = p_due_at, status = 'open'
         WHERE id = v_assignment;
        RETURN QUERY SELECT 'ok'::varchar, v_assignment, true;
        RETURN;
    END IF;
    INSERT INTO public.classroom_assignments (
        tenant_id, classroom_id, assignment_id, course_run_id,
        quiz_version_id, due_at, status, created_by
    ) VALUES (
        v_access.tenant_id, p_classroom_id, NULL, NULL,
        p_quiz_version_id, p_due_at, 'open', v_access.user_id
    ) RETURNING id INTO v_assignment;
    INSERT INTO public.classroom_activity_versions (
        tenant_id, classroom_assignment_id, learning_activity_version_id
    ) VALUES (v_access.tenant_id, v_assignment, v_quiz.activity_version_id);
    RETURN QUERY SELECT 'ok'::varchar, v_assignment, false;
END;
$$;

CREATE OR REPLACE FUNCTION quiz_assignments_for_seat(p_seat_id uuid)
RETURNS TABLE (
    classroom_assignment_id uuid,
    classroom_title varchar,
    quiz_version_id uuid,
    quiz_title varchar,
    quiz_instructions varchar,
    due_at timestamptz,
    assignment_status varchar,
    attempt_limit integer,
    attempts_used integer,
    time_limit_minutes integer,
    total_points integer,
    pass_threshold_basis_points integer,
    question_version_id uuid,
    question_type varchar,
    prompt_blocks jsonb,
    response_schema jsonb,
    question_max_points integer,
    question_position integer,
    latest_state varchar,
    latest_points integer,
    latest_percentage_basis_points integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT assignment.id, classroom.title, quiz.id, quiz.title, quiz.instructions,
           assignment.due_at, assignment.status, quiz.attempt_limit,
           (SELECT count(*)::integer FROM public.learning_attempts counted
             WHERE counted.classroom_assignment_id = assignment.id
               AND counted.seat_id = seat.id),
           quiz.time_limit_minutes, quiz.total_points,
           quiz.pass_threshold_basis_points, question.id, question.question_type,
           question.prompt_blocks, question.response_schema, mapped.max_points,
           mapped.position, latest.state, result.raw_points,
           result.percentage_basis_points
      FROM public.classroom_student_seats seat
      JOIN public.classrooms classroom ON classroom.id = seat.classroom_id
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id = seat.tenant_id
       AND assignment.classroom_id = seat.classroom_id
       AND assignment.quiz_version_id IS NOT NULL
      JOIN public.quiz_versions quiz ON quiz.id = assignment.quiz_version_id
      JOIN public.quiz_version_questions mapped ON mapped.quiz_version_id = quiz.id
      JOIN public.question_versions question ON question.id = mapped.question_version_id
      LEFT JOIN LATERAL (
          SELECT attempt.* FROM public.learning_attempts attempt
           WHERE attempt.classroom_assignment_id = assignment.id
             AND attempt.seat_id = seat.id
           ORDER BY attempt.attempt_number DESC LIMIT 1
      ) latest ON true
      LEFT JOIN public.assessment_results result ON result.attempt_id = latest.id
     WHERE seat.id = p_seat_id
       AND seat.status = 'active'
       AND (assignment.status = 'open' OR latest.id IS NOT NULL)
     ORDER BY assignment.created_at DESC, mapped.position;
$$;

CREATE OR REPLACE FUNCTION quiz_assignments_for_account(p_account_id uuid)
RETURNS TABLE (
    classroom_assignment_id uuid,
    classroom_title varchar,
    quiz_version_id uuid,
    quiz_title varchar,
    quiz_instructions varchar,
    due_at timestamptz,
    assignment_status varchar,
    attempt_limit integer,
    attempts_used integer,
    time_limit_minutes integer,
    total_points integer,
    pass_threshold_basis_points integer,
    question_version_id uuid,
    question_type varchar,
    prompt_blocks jsonb,
    response_schema jsonb,
    question_max_points integer,
    question_position integer,
    latest_state varchar,
    latest_points integer,
    latest_percentage_basis_points integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT visible.*
      FROM public.classroom_student_seats seat
      CROSS JOIN LATERAL public.quiz_assignments_for_seat(seat.id) visible
     WHERE seat.account_id = p_account_id AND seat.status = 'active'
     ORDER BY visible.classroom_title, visible.classroom_assignment_id,
              visible.question_position;
$$;

CREATE OR REPLACE FUNCTION quiz_submission_create(
    p_seat_id uuid,
    p_assignment_id uuid,
    p_answers jsonb,
    p_client_request_id varchar
)
RETURNS TABLE (
    result_code varchar,
    attempt_id uuid,
    submission_id uuid,
    attempt_number integer,
    raw_points integer,
    max_points integer,
    percentage_basis_points integer,
    outcome varchar,
    late_state varchar,
    question_results jsonb,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_scope record;
    v_existing record;
    v_attempt uuid;
    v_submission uuid;
    v_attempt_number integer;
    v_question record;
    v_answer jsonb;
    v_response jsonb;
    v_correct boolean;
    v_points integer;
    v_total integer := 0;
    v_percentage integer;
    v_outcome varchar;
    v_late varchar;
    v_results jsonb := '[]'::jsonb;
    v_digest varchar;
    v_result uuid;
    v_gradebook uuid;
BEGIN
    IF p_client_request_id IS NULL
       OR p_client_request_id !~ '^[A-Za-z0-9._:-]{8,128}$'
       OR jsonb_typeof(p_answers) <> 'array' THEN
        RETURN QUERY SELECT 'invalid_submission'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, NULL::integer, NULL::integer, NULL::integer,
            NULL::varchar, NULL::varchar, '[]'::jsonb, false;
        RETURN;
    END IF;
    SELECT submission.id, attempt.id AS attempt_id, attempt.attempt_number,
           result.raw_points, result.max_points, result.percentage_basis_points,
           result.outcome, submission.late_state
      INTO v_existing
      FROM public.learning_submissions submission
      JOIN public.learning_attempts attempt ON attempt.id = submission.attempt_id
      JOIN public.assessment_results result ON result.attempt_id = attempt.id
     WHERE submission.client_request_id = p_client_request_id
       AND attempt.seat_id = p_seat_id
       AND attempt.classroom_assignment_id = p_assignment_id;
    IF v_existing.id IS NOT NULL THEN
        RETURN QUERY SELECT 'ok'::varchar, v_existing.attempt_id, v_existing.id,
            v_existing.attempt_number, v_existing.raw_points, v_existing.max_points,
            v_existing.percentage_basis_points, v_existing.outcome,
            v_existing.late_state, '[]'::jsonb, true;
        RETURN;
    END IF;

    SELECT assignment.tenant_id, assignment.classroom_id, assignment.due_at,
           classroom.school_id, classroom.academic_period_id,
           quiz.id AS quiz_version_id, quiz.learning_activity_version_id,
           quiz.owner_principal_id, quiz.total_points, quiz.attempt_limit,
           quiz.pass_threshold_basis_points, quiz.feedback_release_policy
      INTO v_scope
      FROM public.classroom_student_seats seat
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id = seat.tenant_id
       AND assignment.classroom_id = seat.classroom_id
      JOIN public.classrooms classroom ON classroom.id = assignment.classroom_id
      JOIN public.quiz_versions quiz ON quiz.id = assignment.quiz_version_id
     WHERE seat.id = p_seat_id AND seat.status = 'active'
       AND assignment.id = p_assignment_id AND assignment.status = 'open'
     FOR UPDATE OF assignment;
    IF v_scope.tenant_id IS NULL THEN
        RETURN QUERY SELECT 'assignment_unavailable'::varchar, NULL::uuid, NULL::uuid,
            NULL::integer, NULL::integer, NULL::integer, NULL::integer,
            NULL::varchar, NULL::varchar, '[]'::jsonb, false;
        RETURN;
    END IF;
    SELECT count(*)::integer + 1 INTO v_attempt_number
      FROM public.learning_attempts attempt
     WHERE attempt.classroom_assignment_id = p_assignment_id
       AND attempt.seat_id = p_seat_id;
    IF v_attempt_number > v_scope.attempt_limit THEN
        RETURN QUERY SELECT 'attempt_limit_reached'::varchar, NULL::uuid, NULL::uuid,
            v_attempt_number - 1, NULL::integer, v_scope.total_points,
            NULL::integer, NULL::varchar, NULL::varchar, '[]'::jsonb, false;
        RETURN;
    END IF;

    INSERT INTO public.learning_attempts (
        tenant_id, classroom_id, classroom_assignment_id,
        learning_activity_version_id, seat_id, attempt_number,
        state, submitted_at, evaluated_at
    ) VALUES (
        v_scope.tenant_id, v_scope.classroom_id, p_assignment_id,
        v_scope.learning_activity_version_id, p_seat_id, v_attempt_number,
        'accepted', now(), now()
    ) RETURNING id INTO v_attempt;

    FOR v_question IN
        SELECT mapped.question_version_id, mapped.max_points,
               question.question_type, key.answer_key
          FROM public.quiz_version_questions mapped
          JOIN public.question_versions question ON question.id = mapped.question_version_id
          JOIN public.question_answer_keys key
            ON key.question_version_id = mapped.question_version_id
         WHERE mapped.quiz_version_id = v_scope.quiz_version_id
         ORDER BY mapped.position
    LOOP
        SELECT answer INTO v_answer
          FROM jsonb_array_elements(p_answers) answer
         WHERE answer ->> 'questionVersionId' = v_question.question_version_id::text
         LIMIT 1;
        v_response := COALESCE(v_answer -> 'answer', 'null'::jsonb);
        v_correct := CASE v_question.question_type
            WHEN 'single_choice' THEN v_response -> 'value' = v_question.answer_key -> 'value'
            WHEN 'boolean' THEN v_response -> 'value' = v_question.answer_key -> 'value'
            WHEN 'multiple_choice' THEN
                jsonb_typeof(v_response -> 'values') = 'array'
                AND (v_response -> 'values') @> (v_question.answer_key -> 'values')
                AND (v_question.answer_key -> 'values') @> (v_response -> 'values')
            WHEN 'numeric' THEN CASE
                WHEN COALESCE(v_response ->> 'value', '') ~ '^-?[0-9]+([.][0-9]+)?$'
                THEN abs((v_response ->> 'value')::numeric
                          - (v_question.answer_key ->> 'value')::numeric)
                     <= COALESCE((v_question.answer_key ->> 'tolerance')::numeric, 0)
                ELSE false
            END
            WHEN 'short_text' THEN EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(
                    v_question.answer_key -> 'accepted'
                ) accepted(value)
                 WHERE lower(trim(accepted.value)) = lower(trim(v_response ->> 'value'))
            )
            ELSE false
        END;
        v_points := CASE WHEN v_correct THEN v_question.max_points ELSE 0 END;
        v_total := v_total + v_points;
        INSERT INTO public.attempt_answers (
            tenant_id, attempt_id, question_version_id, response,
            awarded_points, max_points, is_correct
        ) VALUES (
            v_scope.tenant_id, v_attempt, v_question.question_version_id,
            v_response, v_points, v_question.max_points, v_correct
        );
        v_results := v_results || jsonb_build_array(jsonb_build_object(
            'questionVersionId', v_question.question_version_id,
            'correct', v_correct, 'points', v_points,
            'maxPoints', v_question.max_points
        ));
        v_answer := NULL;
    END LOOP;

    v_percentage := (v_total * 10000) / v_scope.total_points;
    v_outcome := CASE WHEN v_percentage >= v_scope.pass_threshold_basis_points
                      THEN 'passed' ELSE 'failed' END;
    v_late := CASE WHEN v_scope.due_at IS NOT NULL AND now() > v_scope.due_at
                   THEN 'late' ELSE 'on_time' END;
    v_digest := encode(sha256(convert_to(p_answers::text, 'UTF8')), 'hex');
    INSERT INTO public.learning_submissions (
        tenant_id, attempt_id, project_id, project_version_id,
        payload_manifest, payload_digest, client_request_id, late_state
    ) VALUES (
        v_scope.tenant_id, v_attempt, NULL, NULL,
        jsonb_build_object('kind', 'quiz', 'answers', p_answers),
        v_digest, p_client_request_id, v_late
    ) RETURNING id INTO v_submission;
    INSERT INTO public.learning_evaluations (
        tenant_id, attempt_id, evaluator_kind, status,
        points, max_points, evidence
    ) VALUES (
        v_scope.tenant_id, v_attempt, 'automatic', 'completed',
        v_total, v_scope.total_points,
        jsonb_build_object('grader', 'quiz-v1', 'submissionDigest', v_digest)
    );
    INSERT INTO public.assessment_results (
        tenant_id, attempt_id, raw_points, max_points,
        percentage_basis_points, outcome, auto_points
    ) VALUES (
        v_scope.tenant_id, v_attempt, v_total, v_scope.total_points,
        v_percentage, v_outcome, v_total
    ) RETURNING id INTO v_result;
    INSERT INTO public.gradebook_entries (
        tenant_id, school_id, academic_period_id, classroom_id,
        classroom_assignment_id, seat_id, accepted_attempt_id,
        assessment_result_id, published_by_principal_id
    ) VALUES (
        v_scope.tenant_id, v_scope.school_id, v_scope.academic_period_id,
        v_scope.classroom_id, p_assignment_id, p_seat_id, v_attempt,
        v_result, v_scope.owner_principal_id
    )
    ON CONFLICT (classroom_assignment_id, seat_id) DO UPDATE
       SET accepted_attempt_id = EXCLUDED.accepted_attempt_id,
           assessment_result_id = EXCLUDED.assessment_result_id,
           published_by_principal_id = EXCLUDED.published_by_principal_id,
           published_at = now(), updated_at = now()
    RETURNING id INTO v_gradebook;
    INSERT INTO public.grade_change_events (
        tenant_id, gradebook_entry_id, assessment_result_id,
        actor_principal_id, event_kind, reason, snapshot
    ) VALUES (
        v_scope.tenant_id, v_gradebook, v_result, v_scope.owner_principal_id,
        'published', 'Автоматическая проверка теста',
        jsonb_build_object('points', v_total, 'maxPoints', v_scope.total_points,
                           'percentageBasisPoints', v_percentage, 'outcome', v_outcome)
    );
    RETURN QUERY SELECT 'ok'::varchar, v_attempt, v_submission, v_attempt_number,
        v_total, v_scope.total_points, v_percentage, v_outcome, v_late,
        CASE WHEN v_scope.feedback_release_policy = 'immediate'
             THEN v_results ELSE '[]'::jsonb END,
        false;
END;
$$;

-- Include automatic tests in the same compact class matrix as projects and
-- course lessons. The gradebook remains the canonical read model.
CREATE OR REPLACE FUNCTION classroom_gradebook_list(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    seat_id uuid,
    display_label varchar,
    assignment_id uuid,
    assignment_title varchar,
    attempt_id uuid,
    attempt_number integer,
    attempt_state varchar,
    submitted_at timestamptz,
    raw_points integer,
    max_points integer,
    percentage_basis_points integer,
    outcome varchar,
    feedback varchar,
    published_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT seat.id, seat.display_label, assignment.id,
           COALESCE(task.title, lesson.assignment_title, quiz.title),
           attempt.id, attempt.attempt_number, attempt.state,
           submission.submitted_at, result.raw_points, result.max_points,
           result.percentage_basis_points, result.outcome, result.feedback,
           result.published_at
      FROM public.classroom_student_seats seat
      CROSS JOIN public.classroom_assignments assignment
      LEFT JOIN public.classroom_course_run_lessons lesson
        ON lesson.classroom_assignment_id = assignment.id
      LEFT JOIN public.teacher_assignments task ON task.id = assignment.assignment_id
      LEFT JOIN public.quiz_versions quiz ON quiz.id = assignment.quiz_version_id
      LEFT JOIN LATERAL (
          SELECT latest.* FROM public.learning_attempts latest
           WHERE latest.classroom_assignment_id = assignment.id
             AND latest.seat_id = seat.id
           ORDER BY latest.attempt_number DESC LIMIT 1
      ) attempt ON true
      LEFT JOIN public.learning_submissions submission ON submission.attempt_id = attempt.id
      LEFT JOIN public.gradebook_entries grade
        ON grade.classroom_assignment_id = assignment.id AND grade.seat_id = seat.id
      LEFT JOIN public.assessment_results result ON result.id = grade.assessment_result_id
     WHERE assignment.classroom_id = p_classroom_id
       AND seat.classroom_id = p_classroom_id
       AND seat.status <> 'removed'
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships membership
            WHERE membership.account_id = p_account_id
              AND membership.classroom_id = p_classroom_id
              AND membership.tenant_id = assignment.tenant_id
              AND membership.member_role IN ('owner', 'co_teacher')
       )
     ORDER BY assignment.created_at, seat.display_label, seat.id;
$$;

REVOKE ALL ON question_bank_items, question_versions, question_answer_keys,
    quiz_versions, quiz_version_questions, attempt_answers FROM PUBLIC, asalab_app;

ALTER TABLE question_bank_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_bank_items FORCE ROW LEVEL SECURITY;
ALTER TABLE question_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE question_answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_answer_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE quiz_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE quiz_version_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_version_questions FORCE ROW LEVEL SECURITY;
ALTER TABLE attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE attempt_answers FORCE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'question_bank_items', 'question_versions', 'question_answer_keys',
        'quiz_versions', 'quiz_version_questions', 'attempt_answers'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON public.%I', table_name, table_name);
        EXECUTE format(
            'CREATE POLICY %I_tenant ON public.%I USING '
            || '(tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
            || 'WITH CHECK '
            || '(tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
            table_name, table_name
        );
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION learning_author_can_use_tenant(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION question_version_create(
    uuid, uuid, varchar, varchar, jsonb, jsonb, jsonb, integer, varchar, varchar, text[]
) FROM PUBLIC;
REVOKE ALL ON FUNCTION question_bank_list(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quiz_version_create(
    uuid, uuid, varchar, varchar, jsonb, integer, integer, integer, varchar
) FROM PUBLIC;
REVOKE ALL ON FUNCTION quiz_version_list(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_quiz_assign(
    uuid, uuid, uuid, uuid, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION quiz_assignments_for_seat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quiz_assignments_for_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quiz_submission_create(uuid, uuid, jsonb, varchar) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION question_version_create(
    uuid, uuid, varchar, varchar, jsonb, jsonb, jsonb, integer, varchar, varchar, text[]
) TO asalab_app;
GRANT EXECUTE ON FUNCTION question_bank_list(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION quiz_version_create(
    uuid, uuid, varchar, varchar, jsonb, integer, integer, integer, varchar
) TO asalab_app;
GRANT EXECUTE ON FUNCTION quiz_version_list(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_quiz_assign(
    uuid, uuid, uuid, uuid, timestamptz
) TO asalab_app;
GRANT EXECUTE ON FUNCTION quiz_assignments_for_seat(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION quiz_assignments_for_account(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION quiz_submission_create(uuid, uuid, jsonb, varchar) TO asalab_app;
