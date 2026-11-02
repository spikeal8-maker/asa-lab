-- Q3a: existing Question bank and private Quiz content roots/drafts/versions.
-- Draft numbering is provisional. No learner delivery or public publication.
-- Existing immutable rows/digests are never rewritten.
ALTER TABLE quiz_versions ALTER COLUMN learning_activity_version_id DROP NOT NULL;
ALTER TABLE quiz_versions ALTER COLUMN attempt_limit DROP NOT NULL;
ALTER TABLE quiz_versions ALTER COLUMN pass_threshold_basis_points DROP NOT NULL;
ALTER TABLE quiz_versions ALTER COLUMN feedback_release_policy DROP NOT NULL;
ALTER TABLE quiz_versions ADD CONSTRAINT quiz_versions_content_contract_check CHECK (
 (learning_activity_version_id IS NOT NULL AND attempt_limit IS NOT NULL AND pass_threshold_basis_points IS NOT NULL AND feedback_release_policy IS NOT NULL)
 OR (learning_activity_version_id IS NULL AND attempt_limit IS NULL AND time_limit_minutes IS NULL AND pass_threshold_basis_points IS NULL AND feedback_release_policy IS NULL)
);
CREATE TABLE quizzes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 owner_principal_id uuid NOT NULL REFERENCES principals(id), scope_kind varchar(16) NOT NULL DEFAULT 'personal' CHECK(scope_kind IN('personal','school')),
 legacy_origin_version_id uuid, created_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
 UNIQUE(tenant_id,id), UNIQUE(legacy_origin_version_id),
 FOREIGN KEY(tenant_id,legacy_origin_version_id) REFERENCES quiz_versions(tenant_id,id)
);
CREATE TABLE question_author_drafts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), question_id uuid PRIMARY KEY,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 base_version_id uuid, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,question_id) REFERENCES question_bank_items(tenant_id,id),
 FOREIGN KEY(tenant_id,base_version_id) REFERENCES question_versions(tenant_id,id)
);
CREATE TABLE quiz_author_drafts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), quiz_id uuid PRIMARY KEY,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 base_version_id uuid, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,quiz_id) REFERENCES quizzes(tenant_id,id),
 FOREIGN KEY(tenant_id,base_version_id) REFERENCES quiz_versions(tenant_id,id)
);
CREATE TABLE quiz_version_lineage (
 tenant_id uuid NOT NULL REFERENCES tenants(id), quiz_id uuid NOT NULL, version_number integer NOT NULL CHECK(version_number>0),
 quiz_version_id uuid NOT NULL, representation varchar(16) NOT NULL CHECK(representation IN('legacy','content')),
 content_flags jsonb NOT NULL DEFAULT '{"shuffleQuestions":false,"shuffleOptions":false}'::jsonb,
 PRIMARY KEY(quiz_id,version_number), UNIQUE(quiz_version_id),
 FOREIGN KEY(tenant_id,quiz_id) REFERENCES quizzes(tenant_id,id),
 FOREIGN KEY(tenant_id,quiz_version_id) REFERENCES quiz_versions(tenant_id,id)
);
CREATE TABLE learning_content_command_receipts (
 tenant_id uuid NOT NULL REFERENCES tenants(id), owner_principal_id uuid NOT NULL REFERENCES principals(id),
 command_scope varchar(64) NOT NULL, operation varchar(32) NOT NULL,
 request_id varchar(128) NOT NULL, question_id uuid, quiz_id uuid, source_revision integer,
 expected_head_id uuid, payload_digest varchar(64) NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,owner_principal_id,command_scope,operation,request_id),
 CHECK(num_nonnulls(question_id,quiz_id)=1),
 CHECK(operation IN('question.create','question.save','question.publish','question.publish.in_quiz','quiz.create','quiz.save','quiz.publish')),
 CHECK(source_revision IS NULL OR source_revision>0),
 FOREIGN KEY(tenant_id,question_id) REFERENCES question_bank_items(tenant_id,id),
 FOREIGN KEY(tenant_id,quiz_id) REFERENCES quizzes(tenant_id,id)
);
CREATE UNIQUE INDEX question_content_published_draft_idx ON learning_content_command_receipts(question_id,source_revision)
 WHERE operation IN('question.publish','question.publish.in_quiz');
CREATE UNIQUE INDEX quiz_content_published_draft_idx ON learning_content_command_receipts(quiz_id,source_revision)
 WHERE operation='quiz.publish';
CREATE TRIGGER quiz_version_lineage_immutable BEFORE UPDATE OR DELETE ON quiz_version_lineage
 FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();
CREATE TRIGGER learning_content_command_receipts_immutable BEFORE UPDATE OR DELETE ON learning_content_command_receipts
 FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['quizzes','question_author_drafts','quiz_author_drafts','quiz_version_lineage','learning_content_command_receipts'] LOOP
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,asalab_app',t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY %I ON public.%I USING (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),)::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(app.tenant_id,true),)::uuid)',t||'_tenant',t);
 END LOOP;
END $$;
CREATE FUNCTION learning_quiz_lineage_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.quizzes r JOIN public.quiz_versions v ON v.tenant_id=r.tenant_id AND v.owner_principal_id=r.owner_principal_id
  WHERE r.id=NEW.quiz_id AND r.tenant_id=NEW.tenant_id AND v.id=NEW.quiz_version_id
   AND ((NEW.representation='legacy' AND v.learning_activity_version_id IS NOT NULL AND NEW.version_number=1 AND r.legacy_origin_version_id=v.id)
     OR (NEW.representation='content' AND v.learning_activity_version_id IS NULL))) THEN RAISE EXCEPTION 'Quiz content lineage is incoherent'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION learning_quiz_lineage_guard() FROM PUBLIC,asalab_app;
CREATE TRIGGER quiz_version_lineage_scope BEFORE INSERT ON quiz_version_lineage FOR EACH ROW EXECUTE FUNCTION learning_quiz_lineage_guard();
CREATE FUNCTION learning_quiz_legacy_bridge() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r uuid;
BEGIN
 IF NEW.learning_activity_version_id IS NULL THEN RETURN NEW; END IF;
 INSERT INTO public.quizzes(tenant_id,owner_principal_id,legacy_origin_version_id,created_at,archived_at)
 VALUES(NEW.tenant_id,NEW.owner_principal_id,NEW.id,NEW.published_at,NEW.archived_at)
 ON CONFLICT(legacy_origin_version_id) DO NOTHING RETURNING id INTO r;
 IF r IS NULL THEN SELECT id INTO r FROM public.quizzes WHERE legacy_origin_version_id=NEW.id; END IF;
 INSERT INTO public.quiz_version_lineage(tenant_id,quiz_id,version_number,quiz_version_id,representation)
 VALUES(NEW.tenant_id,r,1,NEW.id,'legacy') ON CONFLICT DO NOTHING;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION learning_quiz_legacy_bridge() FROM PUBLIC,asalab_app;
INSERT INTO quizzes(tenant_id,owner_principal_id,legacy_origin_version_id,created_at,archived_at)
 SELECT tenant_id,owner_principal_id,id,published_at,archived_at FROM quiz_versions;
INSERT INTO quiz_version_lineage(tenant_id,quiz_id,version_number,quiz_version_id,representation)
 SELECT tenant_id,id,1,legacy_origin_version_id,'legacy' FROM quizzes;
CREATE TRIGGER quiz_versions_legacy_content_bridge AFTER INSERT ON quiz_versions
 FOR EACH ROW EXECUTE FUNCTION learning_quiz_legacy_bridge();

CREATE FUNCTION learning_question_content_validate_internal(
 p_scope_kind varchar,p_question_type varchar,p_prompt_blocks jsonb,p_response_schema jsonb,p_answer_key jsonb,p_max_points integer)
RETURNS varchar LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_option_count integer;
BEGIN
    IF p_scope_kind NOT IN ('personal', 'school')
       OR p_question_type NOT IN ('single_choice', 'multiple_choice', 'boolean',
                                  'numeric', 'short_text')
       OR p_max_points NOT BETWEEN 1 AND 10000
       OR jsonb_typeof(p_prompt_blocks) <> 'array'
       OR jsonb_array_length(p_prompt_blocks) = 0 THEN
        RETURN 'invalid_question'::varchar;
    END IF;
    IF p_question_type IN ('single_choice', 'multiple_choice') THEN
        IF jsonb_typeof(p_response_schema -> 'options') <> 'array' THEN
            RETURN 'invalid_options'::varchar;
        END IF;
        v_option_count := jsonb_array_length(p_response_schema -> 'options');
        IF v_option_count NOT BETWEEN 2 AND 12 THEN
            RETURN 'invalid_options'::varchar;
        END IF;
        IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_response_schema -> 'options') option
             GROUP BY option ->> 'id' HAVING count(*) > 1
        ) OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_response_schema -> 'options') option
             WHERE COALESCE(trim(option ->> 'id'), '') = ''
                OR COALESCE(trim(option ->> 'label'), '') = ''
        ) THEN
            RETURN 'invalid_options'::varchar;
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
        RETURN 'invalid_answer_key'::varchar;
    END IF;

    RETURN 'ok'::varchar;
END;
$$;
REVOKE ALL ON FUNCTION learning_question_content_validate_internal(varchar,varchar,jsonb,jsonb,jsonb,integer) FROM PUBLIC,asalab_app;

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
    v_validation varchar;
BEGIN
    IF NOT public.learning_author_can_use_tenant(p_principal_id, p_tenant_id) THEN
        RETURN QUERY SELECT 'tenant_forbidden'::varchar, NULL::uuid, NULL::uuid;
        RETURN;
    END IF;
    v_validation := public.learning_question_content_validate_internal(p_scope_kind,p_question_type,p_prompt_blocks,p_response_schema,p_answer_key,p_max_points);
    IF v_validation <> 'ok' THEN
        RETURN QUERY SELECT v_validation,NULL::uuid,NULL::uuid;
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
       AND quiz.learning_activity_version_id IS NOT NULL
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
     ORDER BY quiz.published_at DESC, quiz.id;
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
       AND quiz.learning_activity_version_id IS NOT NULL
       AND (assignment.status = 'open' OR latest.id IS NOT NULL)
     ORDER BY assignment.created_at DESC, mapped.position;
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
       AND quiz.learning_activity_version_id IS NOT NULL
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
        'closed', now(), now()
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
        percentage_basis_points, outcome, auto_points, review_decision
    ) VALUES (
        v_scope.tenant_id, v_attempt, v_total, v_scope.total_points,
        v_percentage, v_outcome, v_total, 'accepted'
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

CREATE FUNCTION learning_content_json_valid_internal(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE nodes jsonb[]:=ARRAY[p]; levels integer[]:=ARRAY[0]; n jsonb; d integer; c jsonb; visited integer:=0;
BEGIN
 IF p IS NULL OR octet_length(p::text)>262144 THEN RETURN false; END IF;
 WHILE cardinality(nodes)>0 LOOP
  n:=nodes[cardinality(nodes)]; d:=levels[cardinality(levels)];
  nodes:=nodes[1:cardinality(nodes)-1]; levels:=levels[1:cardinality(levels)-1]; visited:=visited+1;
  IF d>64 OR visited>100000 THEN RETURN false; END IF;
  IF jsonb_typeof(n)='number' THEN PERFORM (n#>>'{}')::double precision;
  ELSIF jsonb_typeof(n)='object' THEN
   FOR c IN SELECT value FROM jsonb_each(n) LOOP nodes:=array_append(nodes,c); levels:=array_append(levels,d+1); END LOOP;
  ELSIF jsonb_typeof(n)='array' THEN
   FOR c IN SELECT value FROM jsonb_array_elements(n) LOOP nodes:=array_append(nodes,c); levels:=array_append(levels,d+1); END LOOP;
  END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN numeric_value_out_of_range THEN RETURN false;
END; $$;
CREATE FUNCTION learning_content_draft_valid_internal(k varchar,p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE e jsonb;
BEGIN
 IF NOT public.learning_content_json_valid_internal(p) OR jsonb_typeof(p)<>'object' THEN RETURN false; END IF;
 IF k='question' THEN
  IF p-ARRAY['questionType','promptBlocks','responseSchema','answerKey','maxPoints','subject','ageBand','tags']<>'{}'::jsonb THEN RETURN false; END IF;
  IF p?'questionType' AND jsonb_typeof(p->'questionType') NOT IN('string','null') THEN RETURN false; END IF;
  IF p?'promptBlocks' AND jsonb_typeof(p->'promptBlocks') NOT IN('array','null') THEN RETURN false; END IF;
  IF p?'responseSchema' AND jsonb_typeof(p->'responseSchema') NOT IN('object','null') THEN RETURN false; END IF;
  IF p?'answerKey' AND jsonb_typeof(p->'answerKey') NOT IN('object','null') THEN RETURN false; END IF;
  IF p?'maxPoints' AND jsonb_typeof(p->'maxPoints') NOT IN('number','null') THEN RETURN false; END IF;
  IF p?'subject' AND jsonb_typeof(p->'subject') NOT IN('string','null') THEN RETURN false; END IF;
  IF length(p->>'subject')>80 OR length(p->>'ageBand')>32 THEN RETURN false; END IF;
  IF p?'ageBand' AND jsonb_typeof(p->'ageBand') NOT IN('string','null') THEN RETURN false; END IF;
  IF p?'tags' THEN
   IF jsonb_typeof(p->'tags')<>'array' THEN RETURN false; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'tags') x WHERE jsonb_typeof(x)<>'string' OR length(x#>>'{}')>40) THEN RETURN false; END IF;
  END IF;
 ELSIF k='quiz' THEN
  IF p-ARRAY['title','instructions','questions','shuffleQuestions','shuffleOptions']<>'{}'::jsonb THEN RETURN false; END IF;
  IF p?'title' AND (jsonb_typeof(p->'title') NOT IN('string','null') OR length(p->>'title')>255) THEN RETURN false; END IF;
  IF p?'instructions' AND (jsonb_typeof(p->'instructions') NOT IN('string','null') OR length(p->>'instructions')>12000) THEN RETURN false; END IF;
  IF p?'questions' THEN
   IF jsonb_typeof(p->'questions')<>'array' THEN RETURN false; END IF;
   FOR e IN SELECT value FROM jsonb_array_elements(p->'questions') LOOP
    IF jsonb_typeof(e)<>'object' OR e-ARRAY['questionVersionId','questionId','questionDraftRevision','required','maxPoints']<>'{}'::jsonb THEN RETURN false; END IF;
   END LOOP;
  END IF;
  IF p?'shuffleQuestions' AND jsonb_typeof(p->'shuffleQuestions')<>'boolean' THEN RETURN false; END IF;
  IF p?'shuffleOptions' AND jsonb_typeof(p->'shuffleOptions')<>'boolean' THEN RETURN false; END IF;
 ELSE RETURN false;
 END IF;
 RETURN true;
END; $$;
CREATE FUNCTION learning_question_publishable_internal(scope varchar,p jsonb) RETURNS varchar
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT public.learning_content_draft_valid_internal('question',p)
  OR p->>'questionType' IS NULL OR p->'promptBlocks' IS NULL OR p->'promptBlocks'='null'::jsonb
  OR jsonb_typeof(p->'responseSchema')<>'object' OR jsonb_typeof(p->'answerKey')<>'object'
  OR p->>'maxPoints' IS NULL OR p->>'maxPoints' !~ '^[0-9]+$' THEN RETURN 'invalid_question'; END IF;
 IF (p->>'maxPoints')::numeric NOT BETWEEN 1 AND 10000 THEN RETURN 'invalid_question'; END IF;
 RETURN public.learning_question_content_validate_internal(scope,p->>'questionType',p->'promptBlocks',p->'responseSchema',p->'answerKey',(p->>'maxPoints')::integer);
END; $$;
CREATE FUNCTION learning_content_owned_internal(a uuid,t uuid,k varchar,r uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT public.learning_author_can_use_tenant(a,t) AND
 CASE WHEN k='question' THEN EXISTS(SELECT 1 FROM public.question_bank_items q WHERE q.id=r AND q.tenant_id=t AND q.owner_principal_id=a)
 WHEN k='quiz' THEN EXISTS(SELECT 1 FROM public.quizzes q WHERE q.id=r AND q.tenant_id=t AND q.owner_principal_id=a) ELSE false END;
$$;
CREATE FUNCTION learning_question_safe_definition_internal(v uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',q.id,'questionId',q.question_id,'versionNumber',q.version_number,'type',q.question_type,
  'promptBlocks',q.prompt_blocks,'maxPoints',q.max_points,'contentDigest',q.content_digest,
  'responseSchema',CASE WHEN q.question_type IN('single_choice','multiple_choice') THEN jsonb_build_object('options',
   COALESCE((SELECT jsonb_agg(jsonb_build_object('id',o.value->>'id','label',o.value->>'label') ORDER BY o.ordinality)
    FROM jsonb_array_elements(q.response_schema->'options') WITH ORDINALITY o(value,ordinality)),'[]'::jsonb))
  WHEN q.question_type='numeric' THEN '{"input":"number"}'::jsonb
  WHEN q.question_type='short_text' THEN '{"input":"text"}'::jsonb ELSE '{}'::jsonb END)
 FROM public.question_versions q WHERE q.id=v;
$$;
CREATE FUNCTION learning_content_author_read(a uuid,t uuid,k varchar,r uuid DEFAULT NULL,v uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE root_id uuid:=r; payload jsonb; rev integer; base uuid; head uuid; versions jsonb; composition jsonb; details jsonb; archived timestamptz;
BEGIN
 IF NOT public.learning_author_can_use_tenant(a,t) THEN RETURN NULL; END IF;
 IF v IS NOT NULL THEN
  IF k='quiz' THEN SELECT l.quiz_id INTO root_id FROM public.quiz_version_lineage l WHERE l.quiz_version_id=v AND l.tenant_id=t;
  ELSE SELECT q.question_id INTO root_id FROM public.question_versions q WHERE q.id=v AND q.tenant_id=t AND (r IS NULL OR q.question_id=r); END IF;
 END IF;
 IF root_id IS NULL AND v IS NOT NULL THEN RETURN NULL; END IF;
 IF root_id IS NULL THEN
  IF k='question' THEN RETURN jsonb_build_object('items',COALESCE((SELECT jsonb_agg(item ORDER BY created_at DESC,id) FROM (
   SELECT q.id,q.created_at,jsonb_build_object('id',q.id,'kind','question','scope',q.scope_kind,'archived',q.archived_at IS NOT NULL,
    'draftRevision',COALESCE(d.revision,0),'latestVersionId',h.id,'versionNumber',h.version_number,'type',h.question_type,
    'subject',q.subject,'ageBand',q.age_band,'tags',q.tags) item
   FROM public.question_bank_items q LEFT JOIN public.question_author_drafts d ON d.tenant_id=q.tenant_id AND d.question_id=q.id
   LEFT JOIN LATERAL(SELECT x.id,x.version_number,x.question_type FROM public.question_versions x WHERE x.question_id=q.id AND x.tenant_id=q.tenant_id ORDER BY x.version_number DESC LIMIT 1) h ON true
   WHERE q.tenant_id=t AND q.owner_principal_id=a) listed),'[]'::jsonb));
  ELSIF k='quiz' THEN RETURN jsonb_build_object('items',COALESCE((SELECT jsonb_agg(item ORDER BY created_at DESC,id) FROM (
   SELECT q.id,q.created_at,jsonb_build_object('id',q.id,'kind','quiz','scope',q.scope_kind,'archived',q.archived_at IS NOT NULL,
    'draftRevision',COALESCE(d.revision,0),'latestVersionId',h.quiz_version_id,'versionNumber',h.version_number,
    'title',COALESCE(NULLIF(d.payload->>'title',''),h.title,''),'questionCount',h.question_count,'totalPoints',h.total_points) item
   FROM public.quizzes q LEFT JOIN public.quiz_author_drafts d ON d.tenant_id=q.tenant_id AND d.quiz_id=q.id
   LEFT JOIN LATERAL(SELECT l.quiz_version_id,l.version_number,x.title,x.question_count,x.total_points FROM public.quiz_version_lineage l JOIN public.quiz_versions x ON x.id=l.quiz_version_id WHERE l.quiz_id=q.id ORDER BY l.version_number DESC LIMIT 1) h ON true
   WHERE q.tenant_id=t AND q.owner_principal_id=a) listed),'[]'::jsonb)); END IF;
  RETURN NULL;
 END IF;
 IF NOT public.learning_content_owned_internal(a,t,k,root_id) THEN RETURN NULL; END IF;
 IF k='question' THEN
  SELECT q.archived_at INTO archived FROM public.question_bank_items q WHERE q.id=root_id;
  SELECT q.id INTO head FROM public.question_versions q WHERE q.question_id=root_id ORDER BY q.version_number DESC LIMIT 1;
  IF v IS NOT NULL THEN
   RETURN public.learning_question_safe_definition_internal(v)||jsonb_build_object('answerKey',(SELECT key.answer_key FROM public.question_answer_keys key WHERE key.tenant_id=t AND key.question_version_id=v));
  END IF;
  SELECT d.payload,d.revision,d.base_version_id INTO payload,rev,base FROM public.question_author_drafts d WHERE d.question_id=root_id AND d.tenant_id=t;
  IF payload IS NULL THEN
   SELECT jsonb_build_object('questionType',q.question_type,'promptBlocks',q.prompt_blocks,'responseSchema',q.response_schema,'answerKey',key.answer_key,'maxPoints',q.max_points,
    'subject',item.subject,'ageBand',item.age_band,'tags',item.tags) INTO payload
   FROM public.question_versions q JOIN public.question_bank_items item ON item.id=q.question_id JOIN public.question_answer_keys key ON key.question_version_id=q.id WHERE q.id=head;
   rev:=0; base:=head;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',q.id,'versionNumber',q.version_number,'contentDigest',q.content_digest,'publishedAt',q.published_at) ORDER BY q.version_number DESC),'[]'::jsonb) INTO versions
   FROM public.question_versions q WHERE q.question_id=root_id AND q.tenant_id=t;
 ELSE
  SELECT q.archived_at INTO archived FROM public.quizzes q WHERE q.id=root_id;
  SELECT l.quiz_version_id INTO head FROM public.quiz_version_lineage l WHERE l.quiz_id=root_id ORDER BY l.version_number DESC LIMIT 1;
  IF v IS NOT NULL THEN
   SELECT COALESCE(jsonb_agg(public.learning_question_safe_definition_internal(m.question_version_id)||jsonb_build_object('position',m.position,'required',m.required,'maxPoints',m.max_points,
    'editableQuestion',EXISTS(SELECT 1 FROM public.question_bank_items item JOIN public.question_versions q ON q.question_id=item.id WHERE q.id=m.question_version_id AND item.owner_principal_id=a)) ORDER BY m.position),'[]'::jsonb)
    INTO composition FROM public.quiz_version_questions m WHERE m.tenant_id=t AND m.quiz_version_id=v;
   SELECT jsonb_build_object('id',q.id,'quizId',root_id,'versionNumber',l.version_number,'title',q.title,'instructions',q.instructions,'questionCount',q.question_count,'totalPoints',q.total_points,'contentDigest',q.content_digest,'questions',composition,
     'shuffleQuestions',l.content_flags->'shuffleQuestions','shuffleOptions',l.content_flags->'shuffleOptions') INTO details
    FROM public.quiz_versions q JOIN public.quiz_version_lineage l ON l.quiz_version_id=q.id WHERE q.id=v AND q.tenant_id=t;
   RETURN details;
  END IF;
  SELECT d.payload,d.revision,d.base_version_id INTO payload,rev,base FROM public.quiz_author_drafts d WHERE d.quiz_id=root_id AND d.tenant_id=t;
  IF payload IS NULL THEN
   SELECT jsonb_build_object('title',q.title,'instructions',q.instructions,'questions',COALESCE((SELECT jsonb_agg(jsonb_build_object('questionVersionId',m.question_version_id,'required',m.required,'maxPoints',m.max_points) ORDER BY m.position) FROM public.quiz_version_questions m WHERE m.quiz_version_id=q.id),'[]'::jsonb),'shuffleQuestions',false,'shuffleOptions',false)
    INTO payload FROM public.quiz_versions q WHERE q.id=head;
   rev:=0; base:=head;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',q.id,'versionNumber',l.version_number,'contentDigest',q.content_digest,'publishedAt',q.published_at) ORDER BY l.version_number DESC),'[]'::jsonb) INTO versions
   FROM public.quiz_version_lineage l JOIN public.quiz_versions q ON q.id=l.quiz_version_id WHERE l.quiz_id=root_id AND l.tenant_id=t;
 END IF;
 RETURN jsonb_build_object('id',root_id,'kind',k,'archived',archived IS NOT NULL,'draftRevision',rev,'latestVersionId',head,
  'draft',payload,'baseVersionId',base,'versions',versions);
END; $$;

CREATE FUNCTION learning_content_request_digest_internal(k text,op text,r uuid,rev integer,p jsonb,h uuid) RETURNS varchar
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('kind',k,'operation',op,'root',r,'revision',rev,'payload',p,'head',h)::text,'UTF8')),'hex')::varchar;
$$;
CREATE FUNCTION learning_content_remember_internal(a uuid,t uuid,k varchar,op varchar,r uuid,rev integer,req varchar,digest varchar,h uuid,response jsonb) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 INSERT INTO public.learning_content_command_receipts(tenant_id,owner_principal_id,command_scope,operation,request_id,question_id,quiz_id,source_revision,expected_head_id,payload_digest,response)
 VALUES(t,a,CASE WHEN op IN('question.create','quiz.create') THEN k||':new' ELSE k||':'||r::text END,op,req,
 CASE WHEN k='question' THEN r ELSE NULL END,CASE WHEN k='quiz' THEN r ELSE NULL END,rev,h,digest,response);
$$;
CREATE FUNCTION learning_question_publish_internal(a uuid,t uuid,r uuid,expected integer,req varchar,h uuid,in_quiz boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE item public.question_bank_items%ROWTYPE; d public.question_author_drafts%ROWTYPE; prior public.learning_content_command_receipts%ROWTYPE;
 head uuid; n bigint; v uuid; code varchar; digest varchar; answer jsonb; op varchar:=CASE WHEN in_quiz THEN 'question.publish.in_quiz' ELSE 'question.publish' END;
BEGIN
 IF NOT public.learning_content_owned_internal(a,t,'question',r) THEN RETURN jsonb_build_object('code','not_found'); END IF;
 SELECT q.* INTO item FROM public.question_bank_items q WHERE q.id=r AND q.tenant_id=t FOR UPDATE;
 IF item.archived_at IS NOT NULL THEN RETURN jsonb_build_object('code','archived'); END IF;
 digest:=public.learning_content_request_digest_internal('question',op,r,expected,NULL,h);
 SELECT x.* INTO prior FROM public.learning_content_command_receipts x WHERE x.tenant_id=t AND x.owner_principal_id=a AND x.command_scope='question:'||r::text AND x.operation=op AND x.request_id=req;
 IF prior.request_id IS NOT NULL THEN
  IF prior.payload_digest<>digest THEN RETURN jsonb_build_object('code','idempotency_conflict'); END IF;
  RETURN prior.response||'{"reused":true}'::jsonb;
 END IF;
 SELECT x.* INTO d FROM public.question_author_drafts x WHERE x.question_id=r AND x.tenant_id=t FOR UPDATE;
 IF d.revision IS NULL OR d.revision IS DISTINCT FROM expected THEN RETURN jsonb_build_object('code','revision_conflict'); END IF;
 SELECT x.* INTO prior FROM public.learning_content_command_receipts x WHERE x.question_id=r AND x.source_revision=expected AND x.operation IN('question.publish','question.publish.in_quiz');
 IF prior.request_id IS NOT NULL THEN
  IF prior.expected_head_id IS DISTINCT FROM h THEN RETURN jsonb_build_object('code','head_conflict'); END IF;
  RETURN prior.response||'{"reused":true}'::jsonb;
 END IF;
 SELECT q.id INTO head FROM public.question_versions q WHERE q.question_id=r AND q.tenant_id=t ORDER BY q.version_number DESC LIMIT 1;
 IF head IS DISTINCT FROM h OR d.base_version_id IS DISTINCT FROM h THEN RETURN jsonb_build_object('code','head_conflict'); END IF;
 code:=public.learning_question_publishable_internal(item.scope_kind,d.payload);
 IF code<>'ok' THEN RETURN jsonb_build_object('code',code); END IF;
 SELECT COALESCE(max(q.version_number),0)::bigint+1 INTO n FROM public.question_versions q WHERE q.question_id=r;
 IF n>2147483647 THEN RETURN jsonb_build_object('code','version_limit'); END IF;
 INSERT INTO public.question_versions(tenant_id,question_id,version_number,question_type,prompt_blocks,response_schema,max_points,content_digest)
 VALUES(t,r,n::integer,d.payload->>'questionType',d.payload->'promptBlocks',d.payload->'responseSchema',(d.payload->>'maxPoints')::integer,
 encode(sha256(convert_to(jsonb_build_object('questionType',d.payload->>'questionType','promptBlocks',d.payload->'promptBlocks','responseSchema',d.payload->'responseSchema','maxPoints',(d.payload->>'maxPoints')::integer)::text,'UTF8')),'hex')) RETURNING id INTO v;
 INSERT INTO public.question_answer_keys(tenant_id,question_version_id,answer_key,key_digest)
 VALUES(t,v,d.payload->'answerKey',encode(sha256(convert_to((d.payload->'answerKey')::text,'UTF8')),'hex'));
 UPDATE public.question_bank_items SET subject=NULLIF(d.payload->>'subject',''),age_band=NULLIF(d.payload->>'ageBand',''),
 tags=COALESCE(ARRAY(SELECT jsonb_array_elements_text(d.payload->'tags')),ARRAY[]::text[]) WHERE id=r;
 answer:=jsonb_build_object('code','ok','id',r,'draftRevision',d.revision,'versionId',v,'versionNumber',n,'reused',false);
 PERFORM public.learning_content_remember_internal(a,t,'question',op,r,d.revision,req,digest,h,answer);
 RETURN answer;
END; $$;
CREATE FUNCTION learning_content_author_write(a uuid,t uuid,k varchar,action varchar,r uuid,expected integer,req varchar,p jsonb,h uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE root_id uuid:=r; op varchar; scope text; digest varchar; prior public.learning_content_command_receipts%ROWTYPE;
 payload jsonb:=p; rev integer; head uuid; archived timestamptz; answer jsonb; v uuid; number bigint; total bigint:=0;
 e jsonb; resolved jsonb:='[]'::jsonb; entry jsonb; q public.question_versions%ROWTYPE; qroot public.question_bank_items%ROWTYPE;
 qdraft public.question_author_drafts%ROWTYPE; qhead uuid; qrev integer; qid uuid; qversion uuid; points bigint; required boolean; code varchar;
 seen_versions uuid[]:=ARRAY[]::uuid[]; seen_drafts uuid[]:=ARRAY[]::uuid[]; position integer:=0;
BEGIN
 IF k IS NULL OR k NOT IN('question','quiz') OR action IS NULL OR action NOT IN('create','save','publish')
  OR req IS NULL OR req !~ '^[A-Za-z0-9._:-]{8,128}$' THEN RETURN jsonb_build_object('code','invalid_request'); END IF;
 IF NOT public.learning_author_can_use_tenant(a,t) THEN RETURN jsonb_build_object('code','not_found'); END IF;
 PERFORM set_config('app.tenant_id',t::text,true);
 op:=k||'.'||action; scope:=CASE WHEN action='create' THEN k||':new' ELSE k||':'||r::text END;
 IF scope IS NULL THEN RETURN jsonb_build_object('code','invalid_request'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':'||a::text||':'||scope||':'||op||':'||req,297));
 IF action<>'publish' THEN
  payload:=CASE WHEN k='question' THEN '{"questionType":null,"promptBlocks":[],"responseSchema":{},"answerKey":{},"maxPoints":null,"subject":null,"ageBand":null,"tags":[]}'::jsonb
   ELSE '{"title":"","instructions":null,"questions":[],"shuffleQuestions":false,"shuffleOptions":false}'::jsonb END || COALESCE(p,'{}'::jsonb);
  IF NOT public.learning_content_draft_valid_internal(k,payload) THEN RETURN jsonb_build_object('code','invalid_draft'); END IF;
 END IF;
 IF action<>'create' AND NOT public.learning_content_owned_internal(a,t,k,r) THEN RETURN jsonb_build_object('code','not_found'); END IF;
 digest:=public.learning_content_request_digest_internal(k,op,r,expected,payload,h);
 SELECT x.* INTO prior FROM public.learning_content_command_receipts x WHERE x.tenant_id=t AND x.owner_principal_id=a AND x.command_scope=scope AND x.operation=op AND x.request_id=req;
 IF prior.request_id IS NOT NULL THEN
  IF prior.payload_digest<>digest THEN RETURN jsonb_build_object('code','idempotency_conflict'); END IF;
  IF NOT public.learning_content_owned_internal(a,t,k,COALESCE(prior.question_id,prior.quiz_id)) THEN RETURN jsonb_build_object('code','not_found'); END IF;
  RETURN prior.response||'{"reused":true}'::jsonb;
 END IF;
 IF action='create' THEN
  IF r IS NOT NULL OR expected IS NOT NULL OR h IS NOT NULL THEN RETURN jsonb_build_object('code','invalid_request'); END IF;
  IF k='question' THEN
   INSERT INTO public.question_bank_items(tenant_id,owner_principal_id,scope_kind) VALUES(t,a,'personal') RETURNING id INTO root_id;
   INSERT INTO public.question_author_drafts(tenant_id,question_id,revision,payload) VALUES(t,root_id,1,payload);
  ELSE
   INSERT INTO public.quizzes(tenant_id,owner_principal_id) VALUES(t,a) RETURNING id INTO root_id;
   INSERT INTO public.quiz_author_drafts(tenant_id,quiz_id,revision,payload) VALUES(t,root_id,1,payload);
  END IF;
  answer:=jsonb_build_object('code','ok','id',root_id,'draftRevision',1,'latestVersionId',NULL,'reused',false);
  PERFORM public.learning_content_remember_internal(a,t,k,op,root_id,NULL,req,digest,NULL,answer);
  RETURN answer;
 END IF;
 IF expected IS NULL OR expected<0 THEN RETURN jsonb_build_object('code','invalid_request'); END IF;
 IF k='question' THEN
  SELECT item.archived_at INTO archived FROM public.question_bank_items item WHERE item.id=r AND item.tenant_id=t FOR UPDATE;
  SELECT x.id INTO head FROM public.question_versions x WHERE x.question_id=r AND x.tenant_id=t ORDER BY x.version_number DESC LIMIT 1;
  SELECT x.revision INTO rev FROM public.question_author_drafts x WHERE x.question_id=r AND x.tenant_id=t FOR UPDATE;
 ELSE
  SELECT item.archived_at INTO archived FROM public.quizzes item WHERE item.id=r AND item.tenant_id=t FOR UPDATE;
  SELECT x.quiz_version_id INTO head FROM public.quiz_version_lineage x WHERE x.quiz_id=r ORDER BY x.version_number DESC LIMIT 1;
  SELECT x.revision INTO rev FROM public.quiz_author_drafts x WHERE x.quiz_id=r AND x.tenant_id=t FOR UPDATE;
 END IF;
 IF archived IS NOT NULL THEN RETURN jsonb_build_object('code','archived'); END IF;
 IF action='save' THEN
  IF COALESCE(rev,0)<>expected THEN RETURN jsonb_build_object('code','revision_conflict'); END IF;
  IF head IS DISTINCT FROM h THEN RETURN jsonb_build_object('code','head_conflict'); END IF;
  IF expected=2147483647 THEN RETURN jsonb_build_object('code','revision_limit'); END IF;
  IF k='question' THEN
   INSERT INTO public.question_author_drafts(tenant_id,question_id,revision,payload,base_version_id) VALUES(t,r,1,payload,h)
   ON CONFLICT(question_id) DO UPDATE SET revision=question_author_drafts.revision+1,payload=EXCLUDED.payload,base_version_id=h,updated_at=clock_timestamp() RETURNING revision INTO rev;
  ELSE
   INSERT INTO public.quiz_author_drafts(tenant_id,quiz_id,revision,payload,base_version_id) VALUES(t,r,1,payload,h)
   ON CONFLICT(quiz_id) DO UPDATE SET revision=quiz_author_drafts.revision+1,payload=EXCLUDED.payload,base_version_id=h,updated_at=clock_timestamp() RETURNING revision INTO rev;
  END IF;
  answer:=jsonb_build_object('code','ok','id',r,'draftRevision',rev,'latestVersionId',head,'reused',false);
  PERFORM public.learning_content_remember_internal(a,t,k,op,r,NULL,req,digest,h,answer);
  RETURN answer;
 END IF;
 IF k='question' THEN RETURN public.learning_question_publish_internal(a,t,r,expected,req,h); END IF;
 SELECT x.* INTO prior FROM public.learning_content_command_receipts x WHERE x.quiz_id=r AND x.source_revision=expected AND x.operation='quiz.publish';
 IF prior.request_id IS NOT NULL THEN
  IF prior.expected_head_id IS DISTINCT FROM h THEN RETURN jsonb_build_object('code','head_conflict'); END IF;
  RETURN prior.response||'{"reused":true}'::jsonb;
 END IF;
 IF rev IS NULL OR rev<>expected THEN RETURN jsonb_build_object('code','revision_conflict'); END IF;
 IF head IS DISTINCT FROM h THEN RETURN jsonb_build_object('code','head_conflict'); END IF;
 SELECT x.payload INTO payload FROM public.quiz_author_drafts x WHERE x.quiz_id=r;
 IF NULLIF(trim(payload->>'title'),'') IS NULL OR jsonb_array_length(COALESCE(payload->'questions','[]'::jsonb))=0 THEN RETURN jsonb_build_object('code','invalid_quiz'); END IF;
 IF COALESCE((payload->>'shuffleQuestions')::boolean,false) OR COALESCE((payload->>'shuffleOptions')::boolean,false) THEN RETURN jsonb_build_object('code','unsupported_content_feature'); END IF;
 -- Lock every own Question root in sorted order before validating or publishing
 -- any child. Other-owner school references never acquire edit/key privileges.
 FOR qid IN SELECT DISTINCT (x.value->>'questionId')::uuid FROM jsonb_array_elements(payload->'questions') x
  WHERE COALESCE(x.value->>'questionId','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' ORDER BY 1 LOOP
  PERFORM 1 FROM public.question_bank_items item WHERE item.id=qid AND item.tenant_id=t AND item.owner_principal_id=a FOR UPDATE;
 END LOOP;
 FOR e IN SELECT value FROM jsonb_array_elements(payload->'questions') LOOP
  qversion:=NULL; qid:=NULL; qrev:=NULL; qhead:=NULL;
  IF num_nonnulls(e->>'questionVersionId',e->>'questionId')<>1 THEN RETURN jsonb_build_object('code','invalid_question_reference'); END IF;
  IF e->>'questionVersionId' IS NOT NULL THEN
   IF e->>'questionVersionId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' OR e->>'questionDraftRevision' IS NOT NULL THEN RETURN jsonb_build_object('code','invalid_question_reference'); END IF;
   SELECT x.* INTO q FROM public.question_versions x JOIN public.question_bank_items item ON item.id=x.question_id
    WHERE x.id=(e->>'questionVersionId')::uuid AND x.tenant_id=t AND item.tenant_id=t AND item.archived_at IS NULL AND x.archived_at IS NULL
     AND (item.owner_principal_id=a OR item.scope_kind='school');
   IF q.id IS NULL THEN RETURN jsonb_build_object('code','question_not_found'); END IF;
   qversion:=q.id; points:=q.max_points;
  ELSE
   IF e->>'questionId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    OR COALESCE(e->>'questionDraftRevision','') !~ '^[0-9]+$' OR (e->>'questionDraftRevision')::numeric NOT BETWEEN 1 AND 2147483647 THEN RETURN jsonb_build_object('code','invalid_question_reference'); END IF;
   qid:=(e->>'questionId')::uuid; qrev:=(e->>'questionDraftRevision')::integer;
   SELECT item.* INTO qroot FROM public.question_bank_items item WHERE item.id=qid AND item.tenant_id=t AND item.owner_principal_id=a AND item.archived_at IS NULL;
   IF qroot.id IS NULL THEN RETURN jsonb_build_object('code','question_not_found'); END IF;
   SELECT x.* INTO qdraft FROM public.question_author_drafts x WHERE x.question_id=qid AND x.tenant_id=t FOR UPDATE;
   IF qdraft.revision IS DISTINCT FROM qrev THEN RETURN jsonb_build_object('code','question_revision_conflict'); END IF;
   code:=public.learning_question_publishable_internal(qroot.scope_kind,qdraft.payload);
   IF code<>'ok' THEN RETURN jsonb_build_object('code',code); END IF;
   points:=(qdraft.payload->>'maxPoints')::integer; qhead:=qdraft.base_version_id;
   SELECT (x.response->>'versionId')::uuid INTO qversion FROM public.learning_content_command_receipts x WHERE x.question_id=qid AND x.source_revision=qrev AND x.operation IN('question.publish','question.publish.in_quiz');
   IF qid=ANY(seen_drafts) THEN RETURN jsonb_build_object('code','duplicate_question'); END IF;
   seen_drafts:=array_append(seen_drafts,qid);
   IF qversion IS NULL THEN
    SELECT x.id INTO v FROM public.question_versions x WHERE x.question_id=qid ORDER BY x.version_number DESC LIMIT 1;
    IF v IS DISTINCT FROM qhead THEN RETURN jsonb_build_object('code','question_head_conflict'); END IF;
   END IF;
  END IF;
  IF qversion IS NOT NULL THEN
   IF qversion=ANY(seen_versions) THEN RETURN jsonb_build_object('code','duplicate_question'); END IF;
   seen_versions:=array_append(seen_versions,qversion);
  END IF;
  IF e->>'maxPoints' IS NOT NULL THEN
   IF e->>'maxPoints' !~ '^[0-9]+$' OR (e->>'maxPoints')::numeric NOT BETWEEN 1 AND 2147483647 THEN RETURN jsonb_build_object('code','invalid_points'); END IF;
   points:=(e->>'maxPoints')::bigint;
  END IF;
  IF e?'required' AND jsonb_typeof(e->'required')<>'boolean' THEN RETURN jsonb_build_object('code','invalid_question_reference'); END IF;
  required:=COALESCE((e->>'required')::boolean,true); total:=total+points;
  IF total>2147483647 THEN RETURN jsonb_build_object('code','invalid_points'); END IF;
  resolved:=resolved||jsonb_build_array(jsonb_build_object('versionId',qversion,'questionId',qid,'revision',qrev,'head',qhead,'maxPoints',points,'required',required));
 END LOOP;
 SELECT COALESCE(max(l.version_number),0)::bigint+1 INTO number FROM public.quiz_version_lineage l WHERE l.quiz_id=r;
 IF number>2147483647 THEN RETURN jsonb_build_object('code','version_limit'); END IF;
 -- All definition/reference validation is complete before the first immutable
 -- insert. A concurrent author revocation below raises a rollback-only signal.
 FOR entry IN SELECT value FROM jsonb_array_elements(resolved) LOOP
  IF entry->>'versionId' IS NULL THEN
   answer:=public.learning_question_publish_internal(a,t,(entry->>'questionId')::uuid,(entry->>'revision')::integer,
    'quiz:'||r::text||':'||(entry->>'revision'),(entry->>'head')::uuid,true);
   IF answer->>'code'<>'ok' THEN RAISE EXCEPTION USING ERRCODE='P3001',MESSAGE=answer->>'code'; END IF;
   entry:=entry||jsonb_build_object('versionId',answer->>'versionId');
  END IF;
 END LOOP;
 -- Resolve the now-published child IDs without changing saved draft references.
 SELECT COALESCE(jsonb_agg(CASE WHEN x.value->>'versionId' IS NOT NULL THEN x.value ELSE x.value||jsonb_build_object('versionId',
  (SELECT z.response->'versionId' FROM public.learning_content_command_receipts z WHERE z.question_id=(x.value->>'questionId')::uuid AND z.source_revision=(x.value->>'revision')::integer AND z.operation IN('question.publish','question.publish.in_quiz'))) END ORDER BY x.ordinality),'[]'::jsonb)
  INTO resolved FROM jsonb_array_elements(resolved) WITH ORDINALITY x(value,ordinality);
 INSERT INTO public.quiz_versions(tenant_id,owner_principal_id,learning_activity_version_id,title,instructions,question_count,total_points,attempt_limit,time_limit_minutes,pass_threshold_basis_points,feedback_release_policy,content_digest)
 VALUES(t,a,NULL,trim(payload->>'title'),NULLIF(payload->>'instructions',''),jsonb_array_length(resolved),total::integer,NULL,NULL,NULL,NULL,
 encode(sha256(convert_to(jsonb_build_object('title',trim(payload->>'title'),'instructions',NULLIF(payload->>'instructions',''),'questions',resolved,'shuffleQuestions',false,'shuffleOptions',false)::text,'UTF8')),'hex')) RETURNING id INTO v;
 FOR entry IN SELECT value FROM jsonb_array_elements(resolved) LOOP
  position:=position+1;
  INSERT INTO public.quiz_version_questions(tenant_id,quiz_version_id,question_version_id,position,required,max_points)
   VALUES(t,v,(entry->>'versionId')::uuid,position,(entry->>'required')::boolean,(entry->>'maxPoints')::integer);
 END LOOP;
 INSERT INTO public.quiz_version_lineage(tenant_id,quiz_id,version_number,quiz_version_id,representation) VALUES(t,r,number::integer,v,'content');
 answer:=jsonb_build_object('code','ok','id',r,'draftRevision',rev,'versionId',v,'versionNumber',number,'totalPoints',total,'reused',false);
 PERFORM public.learning_content_remember_internal(a,t,k,op,r,rev,req,digest,h,answer);
 RETURN answer;
EXCEPTION WHEN SQLSTATE 'P3001' THEN RETURN jsonb_build_object('code',SQLERRM);
END; $$;
