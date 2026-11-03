-- Complete Quiz Course vertical; reuses Q3 author drafts and existing learning core.
ALTER TABLE question_versions DROP CONSTRAINT question_versions_type_check;
ALTER TABLE question_versions ADD CONSTRAINT question_versions_type_check CHECK (question_type IN ('single_choice','multiple_choice','boolean','numeric','short_text','matching','ordering','long_text_manual'));
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
  EXECUTE format('CREATE POLICY %I ON public.%I USING (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',t||'_tenant',t);
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

CREATE FUNCTION learning_quiz_options_valid_internal(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN jsonb_typeof(p)='array' THEN jsonb_array_length(p) BETWEEN 2 AND 40
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p) x WHERE jsonb_typeof(x)<>'object'
   OR COALESCE(x->>'id','')!~'^[A-Za-z0-9_-]{1,64}$'
   OR jsonb_typeof(x->'label') IS DISTINCT FROM 'string' OR length(trim(x->>'label')) NOT BETWEEN 1 AND 2000)
 AND (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p) x)=jsonb_array_length(p)
 ELSE false END;
$$;
CREATE FUNCTION learning_question_content_validate_internal(
 p_scope_kind varchar,p_question_type varchar,p_prompt_blocks jsonb,p_response_schema jsonb,p_answer_key jsonb,p_max_points integer)
RETURNS varchar LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE ids jsonb; opts jsonb; key_value jsonb;
BEGIN
 IF p_scope_kind IS NULL OR p_scope_kind NOT IN('personal','school') OR p_question_type IS NULL
 OR p_question_type NOT IN('single_choice','multiple_choice','boolean','numeric','short_text','matching','ordering','long_text_manual')
 OR p_max_points IS NULL OR p_max_points NOT BETWEEN 1 AND 10000
 OR jsonb_typeof(p_prompt_blocks) IS DISTINCT FROM 'array' OR jsonb_typeof(p_response_schema) IS DISTINCT FROM 'object'
 OR jsonb_typeof(p_answer_key) IS DISTINCT FROM 'object' THEN RETURN 'invalid_question'; END IF;
 IF jsonb_array_length(p_prompt_blocks) NOT BETWEEN 1 AND 32 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_prompt_blocks) b
 WHERE b->>'type' NOT IN('text','paragraph') OR jsonb_typeof(b->'text') IS DISTINCT FROM 'string'
 OR length(trim(b->>'text')) NOT BETWEEN 1 AND 12000 OR b-ARRAY['type','text']<>'{}'::jsonb) THEN RETURN 'invalid_question'; END IF;
 IF p_question_type IN('single_choice','multiple_choice','ordering') THEN
 opts:=p_response_schema->'options'; IF NOT public.learning_quiz_options_valid_internal(opts) THEN RETURN 'invalid_options'; END IF;
 SELECT jsonb_agg(x->'id') INTO ids FROM jsonb_array_elements(opts) x;
 END IF;
 IF p_question_type='single_choice' THEN
 IF jsonb_typeof(p_answer_key->'value') IS DISTINCT FROM 'string' OR NOT ids @> jsonb_build_array(p_answer_key->'value') THEN RETURN 'invalid_answer_key'; END IF;
 ELSIF p_question_type='boolean' THEN
 IF jsonb_typeof(p_answer_key->'value') IS DISTINCT FROM 'boolean' THEN RETURN 'invalid_answer_key'; END IF;
 ELSIF p_question_type IN('multiple_choice','ordering') THEN
 key_value:=p_answer_key->'values';
 IF jsonb_typeof(key_value) IS DISTINCT FROM 'array' THEN RETURN 'invalid_answer_key'; END IF;
 IF jsonb_array_length(key_value)=0 OR NOT ids @> key_value
 OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(key_value) x)<>jsonb_array_length(key_value)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(key_value) x WHERE jsonb_typeof(x)<>'string')
 OR (p_question_type='ordering' AND NOT key_value @> ids) THEN RETURN 'invalid_answer_key'; END IF;
 ELSIF p_question_type='matching' THEN
 IF NOT public.learning_quiz_options_valid_internal(p_response_schema->'left') OR NOT public.learning_quiz_options_valid_internal(p_response_schema->'right')
 OR jsonb_typeof(p_answer_key->'values') IS DISTINCT FROM 'array' THEN RETURN 'invalid_answer_key'; END IF;
 key_value:=p_answer_key->'values';
 IF jsonb_array_length(key_value)<>jsonb_array_length(p_response_schema->'left')
 OR (SELECT count(DISTINCT split_part(x#>>'{}',':',1)) FROM jsonb_array_elements(key_value) x)<>jsonb_array_length(key_value)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(key_value) x WHERE jsonb_typeof(x)<>'string'
 OR x#>>'{}' !~ '^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$'
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_response_schema->'left') l WHERE l->>'id'=split_part(x#>>'{}',':',1))
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_response_schema->'right') r WHERE r->>'id'=split_part(x#>>'{}',':',2))) THEN RETURN 'invalid_answer_key'; END IF;
 ELSIF p_question_type='numeric' THEN
 IF jsonb_typeof(p_answer_key->'value') IS DISTINCT FROM 'number' OR
 (p_answer_key?'tolerance' AND (jsonb_typeof(p_answer_key->'tolerance') IS DISTINCT FROM 'number' OR (p_answer_key->>'tolerance')::numeric<0)) THEN RETURN 'invalid_answer_key'; END IF;
 PERFORM (p_answer_key->>'value')::double precision;
 IF p_answer_key?'tolerance' THEN PERFORM (p_answer_key->>'tolerance')::double precision; END IF;
 ELSIF p_question_type='short_text' THEN
 IF jsonb_typeof(p_answer_key->'accepted') IS DISTINCT FROM 'array' THEN RETURN 'invalid_answer_key'; END IF;
 IF jsonb_array_length(p_answer_key->'accepted') NOT BETWEEN 1 AND 40 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_answer_key->'accepted') x
 WHERE jsonb_typeof(x)<>'string' OR length(trim(x#>>'{}')) NOT BETWEEN 1 AND 12000) THEN RETURN 'invalid_answer_key'; END IF;
 ELSIF p_question_type='long_text_manual' AND p_answer_key<>'{}'::jsonb THEN RETURN 'invalid_answer_key'; END IF;
 RETURN 'ok';
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RETURN 'invalid_answer_key';
END; $$;
REVOKE ALL ON FUNCTION learning_quiz_options_valid_internal(jsonb) FROM PUBLIC,asalab_app;
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

CREATE FUNCTION learning_quiz_answer_correct_internal(p_type varchar,p_response jsonb,p_key jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE(CASE p_type
            WHEN 'single_choice' THEN p_response -> 'value' = p_key -> 'value'
            WHEN 'boolean' THEN p_response -> 'value' = p_key -> 'value'
            WHEN 'multiple_choice' THEN
                jsonb_typeof(p_response -> 'values') = 'array'
                AND (p_response -> 'values') @> (p_key -> 'values')
                AND (p_key -> 'values') @> (p_response -> 'values')
            WHEN 'numeric' THEN CASE
                WHEN COALESCE(p_response ->> 'value', '') ~ '^-?[0-9]+([.][0-9]+)?$'
                THEN abs((p_response ->> 'value')::numeric
                          - (p_key ->> 'value')::numeric)
                     <= COALESCE((p_key ->> 'tolerance')::numeric, 0)
                ELSE false
            END
            WHEN 'short_text' THEN EXISTS (
                SELECT 1 FROM jsonb_array_elements_text(
                    p_key -> 'accepted'
                ) accepted(value)
                 WHERE lower(trim(accepted.value)) = lower(trim(p_response ->> 'value'))
            )
            WHEN 'ordering' THEN p_response->'values'=p_key->'values'
            WHEN 'matching' THEN (p_response->'values') @> (p_key->'values') AND (p_key->'values') @> (p_response->'values')
            ELSE false
 END,false);
$$;
REVOKE ALL ON FUNCTION learning_quiz_answer_correct_internal(varchar,jsonb,jsonb) FROM PUBLIC,asalab_app;
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
    IF EXISTS(SELECT 1 FROM public.quiz_version_questions m JOIN public.question_versions q ON q.id=m.question_version_id
      WHERE m.quiz_version_id=v_scope.quiz_version_id AND q.question_type NOT IN('single_choice','multiple_choice','boolean','numeric','short_text')) THEN
      RETURN QUERY SELECT 'unsupported_question_type'::varchar,NULL::uuid,NULL::uuid,NULL::integer,NULL::integer,NULL::integer,NULL::integer,NULL::varchar,NULL::varchar,'[]'::jsonb,false;
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
        v_correct := public.learning_quiz_answer_correct_internal(v_question.question_type,v_response,v_question.answer_key);
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
  WHEN q.question_type='matching' THEN jsonb_build_object(
 'left',(SELECT jsonb_agg(jsonb_build_object('id',o->>'id','label',o->>'label')) FROM jsonb_array_elements(q.response_schema->'left') o),
 'right',(SELECT jsonb_agg(jsonb_build_object('id',o->>'id','label',o->>'label')) FROM jsonb_array_elements(q.response_schema->'right') o))
  WHEN q.question_type='ordering' THEN jsonb_build_object('options',(SELECT jsonb_agg(jsonb_build_object('id',o->>'id','label',o->>'label')) FROM jsonb_array_elements(q.response_schema->'options') o))
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
 encode(sha256(convert_to(jsonb_build_object('title',trim(payload->>'title'),'instructions',NULLIF(payload->>'instructions',''),'questions',resolved,'shuffleQuestions',COALESCE((payload->>'shuffleQuestions')::boolean,false),'shuffleOptions',COALESCE((payload->>'shuffleOptions')::boolean,false))::text,'UTF8')),'hex')) RETURNING id INTO v;
 FOR entry IN SELECT value FROM jsonb_array_elements(resolved) LOOP
  position:=position+1;
  INSERT INTO public.quiz_version_questions(tenant_id,quiz_version_id,question_version_id,position,required,max_points)
   VALUES(t,v,(entry->>'versionId')::uuid,position,(entry->>'required')::boolean,(entry->>'maxPoints')::integer);
 END LOOP;
 INSERT INTO public.quiz_version_lineage(tenant_id,quiz_id,version_number,quiz_version_id,representation,content_flags) VALUES(t,r,number::integer,v,'content',jsonb_build_object('shuffleQuestions',COALESCE((payload->>'shuffleQuestions')::boolean,false),'shuffleOptions',COALESCE((payload->>'shuffleOptions')::boolean,false)));
 answer:=jsonb_build_object('code','ok','id',r,'draftRevision',rev,'versionId',v,'versionNumber',number,'totalPoints',total,'reused',false);
 PERFORM public.learning_content_remember_internal(a,t,k,op,r,rev,req,digest,h,answer);
 RETURN answer;
EXCEPTION WHEN SQLSTATE 'P3001' THEN RETURN jsonb_build_object('code',SQLERRM);
END; $$;

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
    IF (p_result_mode = 'graded' AND (v_max IS NULL OR v_max <= 0) AND NOT(p_kind='quiz' AND p_quiz_version_id IS NULL))
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
    IF p_kind='essay' AND (v_module IS NOT NULL
      OR p_source_teacher_assignment_id IS NOT NULL OR p_quiz_version_id IS NOT NULL
      OR (v_policy#>>'{assessmentPolicy,mode}' IS NOT NULL
        AND v_policy#>>'{assessmentPolicy,mode}' <> 'manual')) THEN
      RETURN QUERY SELECT 'invalid_essay_definition'::varchar,NULL::jsonb,NULL::varchar;
      RETURN;
    END IF;

    IF p_kind = 'quiz' THEN
        IF v_module IS NOT NULL THEN RETURN QUERY SELECT 'invalid_quiz_definition'::varchar,NULL::jsonb,NULL::varchar; RETURN; END IF;
        SELECT quiz.id, quiz.total_points
          INTO v_quiz
          FROM public.quiz_versions quiz
         WHERE quiz.id = p_quiz_version_id
           AND quiz.tenant_id = p_tenant_id
           AND quiz.owner_principal_id = p_principal_id;
        IF v_quiz.id IS NULL AND p_quiz_version_id IS NOT NULL THEN
            RETURN QUERY SELECT 'quiz_version_forbidden'::varchar, NULL::jsonb, NULL::varchar;
            RETURN;
        END IF;
        v_origin := 'quiz_version';
        v_max := CASE WHEN p_result_mode = 'graded' THEN COALESCE(v_quiz.total_points,v_max) ELSE NULL END;
        IF v_policy#>>'{attemptPolicy,expirationPolicy}' IS NOT NULL AND v_policy#>>'{attemptPolicy,expirationPolicy}' NOT IN('auto_submit','expire_without_submission') THEN RETURN QUERY SELECT 'invalid_draft'::varchar,NULL::jsonb,NULL::varchar; RETURN; END IF;
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

CREATE OR REPLACE FUNCTION public.course_activity_blocks_authorized(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_blocks jsonb
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_block jsonb;
    v_version_id uuid;
    v_activity_id uuid;
    v_result_code varchar;
    v_module_key varchar;
    v_kind varchar;
BEGIN
    IF NOT public.course_lesson_blocks_valid(p_blocks) THEN RETURN false; END IF;

    FOR v_block IN
        SELECT value
          FROM jsonb_array_elements(p_blocks)
         WHERE value ->> 'type' = 'activity'
    LOOP
        v_version_id := (v_block ->> 'learningActivityVersionId')::uuid;
        SELECT version.activity_id,version.canonical_kind
          INTO v_activity_id,v_kind
          FROM public.learning_activity_versions version
         WHERE version.id = v_version_id
           AND version.tenant_id = p_tenant_id;

        IF v_activity_id IS NULL THEN RETURN false; END IF;

        SELECT preview.result_code, preview.module_key
          INTO v_result_code, v_module_key
          FROM public.learning_activity_preview_as_author(
            p_principal_id, p_tenant_id, v_activity_id,
            'published', v_version_id, NULL
          ) preview;

        IF v_result_code IS DISTINCT FROM 'ok'
           OR NOT ((v_kind IN('essay','quiz') AND v_module_key IS NULL)
             OR (v_kind='project' AND public.module_learning_assignable(v_module_key))) THEN
            RETURN false;
        END IF;
    END LOOP;

    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.course_author_version_pins(
  p_principal uuid, p_course uuid, p_course_version uuid
)
RETURNS TABLE (
  pointer text, pin_kind varchar, available boolean,
  activity_id uuid, version_id uuid, version_number integer,
  title varchar, instructions varchar,
  goal varchar, goal_snapshot_present boolean,
  blocks jsonb, blocks_snapshot_present boolean,
  module_key varchar, result_mode varchar, max_points integer,
  policy_snapshot jsonb, content_digest varchar
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  WITH owned AS (
    SELECT release.outline, course.tenant_id, course.owner_principal_id
      FROM public.courses course
      JOIN public.course_versions release ON release.course_id = course.id
        AND release.tenant_id = course.tenant_id
     WHERE course.id = p_course AND release.id = p_course_version
       AND course.owner_principal_id = p_principal
       AND public.learning_author_can_use_tenant(p_principal, course.tenant_id)
  ), lessons AS (
    SELECT owned.tenant_id, owned.owner_principal_id, lesson.value AS body,
      '/sections/' || (section.ordinality - 1) || '/lessons/' ||
        (lesson.ordinality - 1) AS lesson_pointer
      FROM owned
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(owned.outline->'sections') = 'array'
          THEN owned.outline->'sections' ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS section(value, ordinality)
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(section.value->'lessons') = 'array'
          THEN section.value->'lessons' ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS lesson(value, ordinality)
  ), pointers AS (
    SELECT tenant_id, owner_principal_id, lesson_pointer || '/assignment' AS pointer,
      'project'::varchar AS pin_kind,
      CASE WHEN body ? 'learningActivityVersionId'
                  AND body->'learningActivityVersionId' <> 'null'::jsonb
        THEN body->'learningActivityVersionId'
        ELSE body->'assignment'->'learningActivityVersionId' END AS raw_version
      FROM lessons
     WHERE body->>'kind' = 'assignment'
        OR jsonb_typeof(body->'assignment') = 'object'
        OR body->'learningActivityVersionId' <> 'null'::jsonb
    UNION ALL
    SELECT tenant_id, owner_principal_id,
      lesson_pointer || '/blocks/' || (block.ordinality - 1),
      CASE WHEN block.value->>'type' = 'manual-material'
        THEN 'manual' ELSE 'project' END::varchar,
      block.value->'learningActivityVersionId'
      FROM lessons
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(body->'blocks') = 'array'
          THEN body->'blocks' ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS block(value, ordinality)
     WHERE block.value->>'type' IN ('activity', 'manual-material')
  ), pins AS (
    SELECT pointers.*,
      CASE WHEN jsonb_typeof(raw_version) = 'string'
        AND (raw_version #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (raw_version #>> '{}')::uuid END AS requested_version
      FROM pointers
  )
  SELECT pin.pointer, COALESCE(exact.actual_kind,pin.pin_kind), exact.version_id IS NOT NULL,
    exact.activity_id, exact.version_id, exact.version_number,
    exact.title, exact.instructions,
    exact.goal, exact.goal_snapshot_present, exact.blocks, exact.blocks_snapshot_present,
    exact.module_key, exact.result_mode, exact.max_points,
    exact.policy_snapshot, exact.content_digest
    FROM pins pin
    LEFT JOIN LATERAL (
      SELECT version.activity_id, version.id AS version_id, version.version_number,
        version.canonical_kind AS actual_kind,
        version.title, version.instructions,
        version.goal, version.goal_snapshot_present, version.blocks, version.blocks_snapshot_present,
        version.module_key, version.result_mode, version.max_points,
        version.policy_snapshot, version.content_digest
        FROM public.learning_activity_versions version
        JOIN public.learning_activities activity ON activity.id = version.activity_id
          AND activity.tenant_id = version.tenant_id
          AND activity.owner_principal_id = pin.owner_principal_id
          AND activity.reusable_authored_content
          AND activity.authoring_origin <> 'legacy_runtime'
       WHERE version.id = pin.requested_version AND version.tenant_id = pin.tenant_id
         AND version.canonical_contract_version = 1
         AND (version.canonical_kind = pin.pin_kind
           OR (pin.pin_kind='project' AND version.canonical_kind IN('essay','quiz') AND version.module_key IS NULL))
         AND version.published_at IS NOT NULL
         AND jsonb_typeof(version.policy_snapshot) = 'object'
    ) exact ON true
   ORDER BY pin.pointer;
$$;

CREATE OR REPLACE FUNCTION learning_quiz_attempt_start(p_actor uuid,p_part uuid,p_request varchar)
RETURNS TABLE(result_code varchar,attempt jsonb,reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_scope jsonb; v_attempt uuid; v_count bigint; v_limit bigint; v_number integer;
 v_now timestamptz; v_seconds bigint; v_time_source text; v_questions jsonb; v_order jsonb;
 v_options jsonb; v_effective jsonb; v_next_number bigint;
BEGIN
 IF p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
   RETURN QUERY SELECT 'invalid_request_id'::varchar,NULL::jsonb,false; RETURN; END IF;
 v_scope:=public.learning_quiz_scope_internal(p_actor,p_part);
 IF v_scope IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb,false; RETURN; END IF;
 PERFORM 1 FROM public.activity_participations part WHERE part.id=p_part FOR UPDATE;
 -- Re-read current admission after lock acquisition, before any writes.
 v_scope:=public.learning_quiz_scope_internal(p_actor,p_part);
 IF v_scope IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb,false; RETURN; END IF;
 SELECT receipt.attempt_id INTO v_attempt FROM public.quiz_attempt_start_receipts receipt
 WHERE receipt.participation_id=p_part AND receipt.request_id=p_request;
 IF v_attempt IS NOT NULL THEN
   RETURN QUERY SELECT 'ok'::varchar,public.learning_quiz_attempt_read(p_actor,v_attempt),true; RETURN; END IF;
 SELECT a.id INTO v_attempt FROM public.learning_attempts a WHERE a.activity_participation_id=p_part
   AND a.state IN ('in_progress','submitted','evaluating') ORDER BY a.attempt_number DESC,a.id LIMIT 1;
 IF v_attempt IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.quiz_attempt_states s WHERE s.attempt_id=v_attempt) THEN
     RETURN QUERY SELECT 'not_available'::varchar,NULL::jsonb,false; RETURN; END IF;
   INSERT INTO public.quiz_attempt_start_receipts(tenant_id,participation_id,request_id,attempt_id)
   VALUES((v_scope->>'tenantId')::uuid,p_part,p_request,v_attempt);
   RETURN QUERY SELECT 'ok'::varchar,public.learning_quiz_attempt_read(p_actor,v_attempt),true; RETURN;
 END IF;
 v_now:=clock_timestamp();
 IF NOT public.learning_quiz_window_open_internal(v_scope,v_now) THEN
   RETURN QUERY SELECT 'not_available'::varchar,NULL::jsonb,false; RETURN; END IF;
 v_effective:=v_scope->'effective';
 IF v_scope#>>'{policy,attemptPolicy,timeLimitSeconds}' IS NOT NULL
   AND v_scope#>>'{policy,attemptPolicy,timeLimitMinutes}' IS NOT NULL
   AND (v_scope#>>'{policy,attemptPolicy,timeLimitSeconds}')::bigint
     <> (v_scope#>>'{policy,attemptPolicy,timeLimitMinutes}')::bigint*60 THEN
   RETURN QUERY SELECT 'invalid_policy'::varchar,NULL::jsonb,false; RETURN; END IF;
 v_limit:=(v_effective#>>'{values,attemptLimit}')::bigint;
 SELECT count(*) INTO v_count FROM public.learning_attempts a WHERE a.activity_participation_id=p_part;
 IF v_count>=2147483647 THEN
   RETURN QUERY SELECT 'attempt_limit'::varchar,NULL::jsonb,false; RETURN; END IF;
 IF v_limit IS NOT NULL AND v_count>=v_limit+COALESCE((v_effective->>'extraAttempts')::bigint,0) THEN
   RETURN QUERY SELECT 'attempt_limit'::varchar,NULL::jsonb,false; RETURN; END IF;
 IF v_scope->>'timeOverrideSeconds' IS NOT NULL THEN
   v_seconds:=(v_scope->>'timeOverrideSeconds')::bigint;v_time_source:='participation_override';
 ELSIF v_scope->>'runTimeMinutes' IS NOT NULL THEN
   v_seconds:=(v_scope->>'runTimeMinutes')::bigint*60;v_time_source:='run_pin';
 ELSIF v_scope#>>'{policy,attemptPolicy,timeLimitSeconds}' IS NOT NULL THEN
   v_seconds:=(v_scope#>>'{policy,attemptPolicy,timeLimitSeconds}')::bigint;v_time_source:='activity_version';
 ELSE
   v_seconds:=(v_scope#>>'{policy,attemptPolicy,timeLimitMinutes}')::bigint*60;v_time_source:='activity_version';
 END IF;
 v_attempt:=gen_random_uuid();
 -- Build only the learner allowlist: even extra response_schema/option keys
 -- authored in old content can never disclose an answer key through this DTO.
 SELECT jsonb_agg(jsonb_build_object('id',q.id,'type',q.question_type,'promptBlocks',q.prompt_blocks,
     'maxPoints',mapped.max_points,'responseSchema',CASE WHEN q.question_type='matching' THEN jsonb_build_object(
 'left',(SELECT jsonb_agg(jsonb_build_object('id',o->>'id','label',o->>'label')) FROM jsonb_array_elements(q.response_schema->'left') o),
 'right',(SELECT jsonb_agg(jsonb_build_object('id',o->>'id','label',o->>'label')) FROM jsonb_array_elements(q.response_schema->'right') o))
 WHEN q.question_type='ordering' THEN jsonb_build_object('options',(SELECT jsonb_agg(jsonb_build_object('id',o->>'id','label',o->>'label')) FROM jsonb_array_elements(q.response_schema->'options') o)) ELSE '{}'::jsonb END,'options',CASE WHEN q.question_type IN ('single_choice','multiple_choice')
       THEN (SELECT jsonb_agg(jsonb_build_object('id',o.value->>'id','label',o.value->>'label') ORDER BY CASE WHEN (v_scope->>'shuffleOptions')::boolean THEN NULL ELSE o.ordinality END, md5(v_attempt::text||(o.value->>'id')))
         FROM jsonb_array_elements(q.response_schema->'options') WITH ORDINALITY o(value,ordinality))
       ELSE NULL END) ORDER BY CASE WHEN (v_scope->>'shuffleQuestions')::boolean THEN NULL ELSE mapped.position END, md5(v_attempt::text||q.id::text)),
   jsonb_agg(q.id ORDER BY CASE WHEN (v_scope->>'shuffleQuestions')::boolean THEN NULL ELSE mapped.position END, md5(v_attempt::text||q.id::text)),
   COALESCE(jsonb_object_agg(q.id::text,CASE WHEN q.question_type IN ('single_choice','multiple_choice')
     THEN (SELECT jsonb_agg(o.value->>'id' ORDER BY CASE WHEN (v_scope->>'shuffleOptions')::boolean THEN NULL ELSE o.ordinality END, md5(v_attempt::text||(o.value->>'id')))
       FROM jsonb_array_elements(q.response_schema->'options') WITH ORDINALITY o(value,ordinality))
     ELSE '[]'::jsonb END),'{}'::jsonb)
 INTO v_questions,v_order,v_options
 FROM public.quiz_version_questions mapped JOIN public.question_versions q
   ON q.tenant_id=mapped.tenant_id AND q.id=mapped.question_version_id
 WHERE mapped.tenant_id=(v_scope->>'tenantId')::uuid AND mapped.quiz_version_id=(v_scope->>'quizVersionId')::uuid;
 IF v_questions IS NULL THEN RETURN QUERY SELECT 'not_available'::varchar,NULL::jsonb,false; RETURN; END IF;
 -- Preserve the compatibility handout/Seat allocator without reusing a
 -- number from this participation after Seat replacement. The exact part lock
 -- and shared handout/Seat lock protect both maxima; neither defines the budget.
 PERFORM pg_advisory_xact_lock(hashtextextended((v_scope->>'assignmentId')||':'||(v_scope->>'seatId'),0));
 SELECT GREATEST(
   (SELECT COALESCE(max(a.attempt_number),0) FROM public.learning_attempts a
     WHERE a.classroom_assignment_id=(v_scope->>'assignmentId')::uuid AND a.seat_id=(v_scope->>'seatId')::uuid),
   (SELECT COALESCE(max(a.attempt_number),0) FROM public.learning_attempts a
     WHERE a.activity_participation_id=p_part)
 )::bigint+1 INTO v_next_number;
 IF v_next_number>2147483647 THEN
   RETURN QUERY SELECT 'attempt_limit'::varchar,NULL::jsonb,false; RETURN; END IF;
 v_number:=v_next_number::integer;
 v_now:=clock_timestamp();
 IF NOT public.learning_quiz_window_open_internal(v_scope,v_now) THEN
   RETURN QUERY SELECT 'not_available'::varchar,NULL::jsonb,false; RETURN; END IF;
 PERFORM set_config('app.tenant_id',v_scope->>'tenantId',true);
 -- Admission above uses current effective conditions. The older standalone
 -- activation command rechecks raw Run windows, so it cannot decide this Start.
 -- Keep the same canonical transition and audit semantics atomically here.
 UPDATE public.activity_participations SET status='active',activated_at=v_now,
   activated_by_principal_id=p_actor,activation_source='meaningful_learner_interaction'
 WHERE id=p_part AND status='assigned';
 IF FOUND THEN
   INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
   VALUES((v_scope->>'tenantId')::uuid,NULL,'activity_participation',p_part,'participation.activated',
     jsonb_build_object('actorPrincipalId',p_actor,'source','meaningful_learner_interaction'));
 END IF;
 INSERT INTO public.learning_attempts(id,tenant_id,classroom_id,classroom_assignment_id,learning_activity_version_id,
   seat_id,learner_identity_id,activity_participation_id,attempt_number,state,started_at,expires_at,effective_conditions_at_start)
 VALUES(v_attempt,(v_scope->>'tenantId')::uuid,(v_scope->>'classroomId')::uuid,(v_scope->>'assignmentId')::uuid,
   (v_scope->>'activityVersionId')::uuid,(v_scope->>'seatId')::uuid,(v_scope->>'learnerIdentityId')::uuid,
   p_part,v_number,'in_progress',v_now,CASE WHEN v_seconds IS NULL THEN NULL ELSE v_now+make_interval(secs=>v_seconds::double precision) END,
   v_effective||jsonb_build_object('timeLimitSeconds',v_seconds,'timeLimitSource',v_time_source)) RETURNING id INTO v_attempt;
 INSERT INTO public.quiz_attempt_states(tenant_id,attempt_id,participation_attempt_number,selected_questions_jsonb,question_order_jsonb,
   option_order_jsonb,content_snapshot,policy_snapshot)
 VALUES((v_scope->>'tenantId')::uuid,v_attempt,(v_count+1)::integer,v_questions,v_order,v_options,
   jsonb_build_object('quizVersionId',v_scope->'quizVersionId','contentDigest',v_scope->'contentDigest'),
 jsonb_set(v_scope->'policy','{attemptPolicy}',COALESCE(NULLIF(v_scope#>'{policy,attemptPolicy}','null'::jsonb),'{}'::jsonb)||jsonb_build_object('expirationPolicy',COALESCE(v_scope#>>'{policy,attemptPolicy,expirationPolicy}','auto_submit'))));
 INSERT INTO public.quiz_attempt_start_receipts(tenant_id,participation_id,request_id,attempt_id)
 VALUES((v_scope->>'tenantId')::uuid,p_part,p_request,v_attempt);
 RETURN QUERY SELECT 'ok'::varchar,public.learning_quiz_attempt_read(p_actor,v_attempt),false;
END;
$$;

CREATE OR REPLACE FUNCTION learning_quiz_attempt_save(p_actor uuid,p_attempt uuid,p_expected integer,p_answers jsonb)
RETURNS TABLE(result_code varchar,attempt jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_attempt public.learning_attempts%ROWTYPE; v_state public.quiz_attempt_states%ROWTYPE;
 v_scope jsonb; v_entry record; v_question jsonb; v_value jsonb; v_now timestamptz;
BEGIN
 SELECT a.* INTO v_attempt FROM public.learning_attempts a WHERE a.id=p_attempt;
 IF v_attempt.id IS NULL OR v_attempt.activity_participation_id IS NULL THEN
   RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb; RETURN; END IF;
 v_scope:=public.learning_quiz_scope_internal(p_actor,v_attempt.activity_participation_id);
 IF v_scope IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb; RETURN; END IF;
 SELECT a.* INTO v_attempt FROM public.learning_attempts a WHERE a.id=p_attempt FOR UPDATE;
 v_scope:=public.learning_quiz_scope_internal(p_actor,v_attempt.activity_participation_id);
 IF v_scope IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb; RETURN; END IF;
 SELECT s.* INTO v_state FROM public.quiz_attempt_states s WHERE s.attempt_id=p_attempt FOR UPDATE;
 IF v_state.attempt_id IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb; RETURN; END IF;
 v_now:=clock_timestamp();
 IF v_attempt.state<>'in_progress' OR (v_attempt.expires_at IS NOT NULL AND v_attempt.expires_at<=v_now)
    OR NOT public.learning_quiz_window_open_internal(v_scope,v_now) THEN
   RETURN QUERY SELECT 'quiz_attempt_closed'::varchar,NULL::jsonb; RETURN; END IF;
 IF p_expected IS DISTINCT FROM v_state.version THEN
   RETURN QUERY SELECT 'quiz_attempt_conflict'::varchar,NULL::jsonb; RETURN; END IF;
 IF v_state.version=2147483647 THEN
   RETURN QUERY SELECT 'quiz_attempt_conflict'::varchar,NULL::jsonb; RETURN; END IF;
 IF p_answers IS NULL OR jsonb_typeof(p_answers)<>'object' OR octet_length(p_answers::text)>262144 THEN
   RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
 FOR v_entry IN SELECT key,value FROM jsonb_each(p_answers) LOOP
   SELECT q.value INTO v_question FROM jsonb_array_elements(v_state.selected_questions_jsonb) q
   WHERE q.value->>'id'=v_entry.key;
   IF v_question IS NULL OR jsonb_typeof(v_entry.value)<>'object'
     OR v_question->>'type' NOT IN ('single_choice','multiple_choice','boolean','numeric','short_text','matching','ordering','long_text_manual') THEN
     RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
   IF v_question->>'type' IN('multiple_choice','matching','ordering') THEN
     IF v_entry.value-ARRAY['values']<>'{}'::jsonb OR NOT v_entry.value?'values' THEN
       RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
     v_value:=v_entry.value->'values';
   ELSE
     IF v_entry.value-ARRAY['value']<>'{}'::jsonb OR NOT v_entry.value?'value' THEN
       RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
     v_value:=v_entry.value->'value';
   END IF;
   IF v_value='null'::jsonb THEN CONTINUE; END IF;
   IF (v_question->>'type'='single_choice' AND (jsonb_typeof(v_value)<>'string' OR NOT EXISTS(
       SELECT 1 FROM jsonb_array_elements(v_question->'options') o WHERE o->'id'=v_value)))
     OR (v_question->>'type' IN('multiple_choice','matching','ordering') AND jsonb_typeof(v_value)<>'array')
     OR (v_question->>'type'='boolean' AND jsonb_typeof(v_value)<>'boolean')
     OR (v_question->>'type'='numeric' AND jsonb_typeof(v_value)<>'number')
     OR (v_question->>'type' IN('short_text','long_text_manual') AND (jsonb_typeof(v_value)<>'string' OR length(v_value#>>'{}')>12000)) THEN
     RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
   IF v_question->>'type'='numeric' THEN
     BEGIN PERFORM (v_value#>>'{}')::double precision;
     EXCEPTION WHEN numeric_value_out_of_range THEN RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END;
   END IF;
   IF v_question->>'type' IN('ordering','matching') THEN
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_value) x WHERE jsonb_typeof(x)<>'string')
       OR jsonb_array_length(v_value)>40
       OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(v_value) x)<>jsonb_array_length(v_value) THEN
       RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
     IF v_question->>'type'='ordering' AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_value) x
       WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_question#>'{responseSchema,options}') o WHERE o->'id'=x)) THEN
       RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
     IF v_question->>'type'='matching' AND (EXISTS(SELECT 1 FROM jsonb_array_elements(v_value) x
       WHERE x#>>'{}' !~ '^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$'
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_question#>'{responseSchema,left}') o WHERE o->>'id'=split_part(x#>>'{}',':',1))
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_question#>'{responseSchema,right}') o WHERE o->>'id'=split_part(x#>>'{}',':',2)))
       OR (SELECT count(DISTINCT split_part(x#>>'{}',':',1)) FROM jsonb_array_elements(v_value) x)<>jsonb_array_length(v_value)) THEN
       RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
   END IF;
   IF v_question->>'type'='multiple_choice' THEN
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_value) selected
       WHERE jsonb_typeof(selected)<>'string' OR NOT EXISTS(
         SELECT 1 FROM jsonb_array_elements(v_question->'options') o WHERE o->'id'=selected))
       OR jsonb_array_length(v_value)<>(SELECT count(DISTINCT selected) FROM jsonb_array_elements(v_value) selected) THEN
       RETURN QUERY SELECT 'invalid_answers'::varchar,NULL::jsonb; RETURN; END IF;
   END IF;
 END LOOP;
 UPDATE public.quiz_attempt_states SET answers_jsonb=p_answers,version=version+1,last_saved_at=v_now
 WHERE attempt_id=p_attempt;
 RETURN QUERY SELECT 'ok'::varchar,public.learning_quiz_attempt_read(p_actor,p_attempt);
END;
$$;

-- Draft bridge: same Activity root/revision and same author commands, never a fake published Quiz.
CREATE FUNCTION learning_activity_quiz_create(
 a uuid,t uuid,scope varchar,visibility varchar,k varchar,title varchar,instructions varchar,
 mode varchar,points integer,policy jsonb,module varchar,qversion uuid,starter uuid,source uuid,
 req varchar,goal jsonb,blocks jsonb,qdraft uuid,qrevision integer)
RETURNS TABLE(result_code varchar,activity_id uuid,draft_revision integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result record; prior jsonb;
BEGIN
 IF qdraft IS NOT NULL AND (k<>'quiz' OR NOT public.learning_content_owned_internal(a,t,'quiz',qdraft)
   OR qrevision IS NULL OR qrevision<1 OR NOT EXISTS(SELECT 1 FROM public.quiz_author_drafts d WHERE d.quiz_id=qdraft AND d.revision=qrevision)) THEN
 RETURN QUERY SELECT 'quiz_draft_forbidden'::varchar,NULL::uuid,NULL::integer; RETURN; END IF;
 IF k='quiz' AND qversion IS NULL AND qdraft IS NULL THEN
 RETURN QUERY SELECT 'quiz_draft_required'::varchar,NULL::uuid,NULL::integer; RETURN; END IF;
 SELECT * INTO result FROM public.learning_activity_create(a,t,scope,visibility,k,title,instructions,mode,points,policy,module,qversion,starter,source,req,goal,blocks);
 IF result.result_code='ok' AND qdraft IS NOT NULL THEN
 SELECT draft_payload INTO prior FROM public.learning_activities WHERE id=result.activity_id FOR UPDATE;
 IF prior->>'quizDraftId' IS NOT NULL AND (prior->>'quizDraftId' IS DISTINCT FROM qdraft::text OR (prior->>'quizDraftRevision')::integer IS DISTINCT FROM qrevision) THEN
 RETURN QUERY SELECT 'idempotency_conflict'::varchar,NULL::uuid,NULL::integer; RETURN; END IF;
 UPDATE public.learning_activities SET draft_payload=draft_payload||jsonb_build_object('quizDraftId',qdraft,'quizDraftRevision',qrevision) WHERE id=result.activity_id;
 END IF;
 RETURN QUERY SELECT result.result_code::varchar,result.activity_id::uuid,result.draft_revision::integer;
END; $$;
CREATE FUNCTION learning_activity_quiz_draft_put(
 a uuid,t uuid,r uuid,expected integer,title varchar,instructions varchar,mode varchar,points integer,
 policy jsonb,module varchar,qversion uuid,starter uuid,goal jsonb,blocks jsonb,qdraft uuid,qrevision integer)
RETURNS TABLE(result_code varchar,draft_revision integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result record; activity record;
BEGIN
 SELECT * INTO activity FROM public.learning_activities WHERE id=r AND tenant_id=t AND owner_principal_id=a
 AND public.learning_author_can_use_tenant(a,t) FOR UPDATE;
 IF activity.id IS NULL THEN RETURN QUERY SELECT 'activity_not_found'::varchar,NULL::integer; RETURN; END IF;
 IF qdraft IS NOT NULL AND (activity.draft_payload->>'kind'<>'quiz' OR NOT public.learning_content_owned_internal(a,t,'quiz',qdraft)
 OR qrevision IS NULL OR qrevision<1 OR NOT EXISTS(SELECT 1 FROM public.quiz_author_drafts d WHERE d.quiz_id=qdraft AND d.revision=qrevision)) THEN
 RETURN QUERY SELECT 'quiz_draft_forbidden'::varchar,NULL::integer; RETURN; END IF;
 IF activity.draft_payload->>'kind'='quiz' AND qversion IS NULL AND qdraft IS NULL THEN
 RETURN QUERY SELECT 'quiz_draft_required'::varchar,NULL::integer; RETURN; END IF;
 SELECT * INTO result FROM public.learning_activity_draft_put(a,t,r,expected,title,instructions,mode,points,policy,module,qversion,starter,goal,blocks);
 IF result.result_code='ok' AND qdraft IS NOT NULL THEN
 UPDATE public.learning_activities SET draft_payload=draft_payload||jsonb_build_object('quizDraftId',qdraft,'quizDraftRevision',qrevision) WHERE id=r;
 END IF;
 RETURN QUERY SELECT result.result_code::varchar,result.draft_revision::integer;
END; $$;

ALTER FUNCTION learning_activity_publish(uuid,uuid,uuid,integer,varchar) RENAME TO learning_activity_publish_before_quiz;
REVOKE ALL ON FUNCTION learning_activity_publish_before_quiz(uuid,uuid,uuid,integer,varchar) FROM PUBLIC,asalab_app;
CREATE FUNCTION learning_activity_publish(a uuid,t uuid,r uuid,expected integer,req varchar)
RETURNS TABLE(result_code varchar,activity_version_id uuid,version_number integer,content_digest varchar,reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE activity record; content jsonb; head uuid; qversion uuid; total integer; old_payload jsonb; result record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(r::text,9001));
 SELECT * INTO activity FROM public.learning_activities WHERE id=r AND tenant_id=t AND owner_principal_id=a
 AND public.learning_author_can_use_tenant(a,t) AND archived_at IS NULL FOR UPDATE;
 IF activity.id IS NULL THEN RETURN QUERY SELECT 'activity_not_found'::varchar,NULL::uuid,NULL::integer,NULL::varchar,false; RETURN; END IF;
 IF activity.draft_payload->>'kind'='quiz' AND activity.draft_revision=expected
 AND NOT EXISTS(SELECT 1 FROM public.learning_activity_versions v WHERE v.activity_id=r AND (v.publication_request_id=req OR v.source_draft_revision=expected)) THEN
 old_payload:=activity.draft_payload;
 IF old_payload->>'quizDraftId' IS NOT NULL THEN
 SELECT l.quiz_version_id INTO head FROM public.quiz_version_lineage l WHERE l.quiz_id=(old_payload->>'quizDraftId')::uuid ORDER BY l.version_number DESC LIMIT 1;
 content:=public.learning_content_author_write(a,t,'quiz','publish',(old_payload->>'quizDraftId')::uuid,
 (old_payload->>'quizDraftRevision')::integer,req,NULL,head);
 IF content->>'code'<>'ok' THEN RETURN QUERY SELECT (content->>'code')::varchar,NULL::uuid,NULL::integer,NULL::varchar,false; RETURN; END IF;
 qversion:=(content->>'versionId')::uuid;
 ELSE qversion:=(old_payload->>'quizVersionId')::uuid; END IF;
 SELECT q.total_points INTO total FROM public.quiz_versions q WHERE q.id=qversion AND q.tenant_id=t AND q.owner_principal_id=a;
 IF total IS NULL THEN RETURN QUERY SELECT 'quiz_version_forbidden'::varchar,NULL::uuid,NULL::integer,NULL::varchar,false; RETURN; END IF;
 -- Draft-only references never enter the immutable LAV snapshot/hash.
 UPDATE public.learning_activities SET draft_payload=(draft_payload-ARRAY['quizDraftId','quizDraftRevision'])||jsonb_build_object(
 'quizVersionId',qversion,'maxPoints',CASE WHEN old_payload->>'resultMode'='graded' THEN total ELSE NULL END) WHERE id=r;
 END IF;
 SELECT * INTO result FROM public.learning_activity_publish_before_quiz(a,t,r,expected,req);
 IF result.result_code<>'ok' AND old_payload IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P3001',MESSAGE=result.result_code; END IF;
 IF old_payload IS NOT NULL THEN UPDATE public.learning_activities SET draft_payload=old_payload WHERE id=r; END IF;
 RETURN QUERY SELECT result.result_code::varchar,result.activity_version_id::uuid,result.version_number::integer,result.content_digest::varchar,result.reused::boolean;
END; $$;
REVOKE ALL ON FUNCTION learning_activity_quiz_create(uuid,uuid,varchar,varchar,varchar,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,uuid,varchar,jsonb,jsonb,uuid,integer),
 learning_activity_quiz_draft_put(uuid,uuid,uuid,integer,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,jsonb,jsonb,uuid,integer),
 learning_activity_publish(uuid,uuid,uuid,integer,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_activity_quiz_create(uuid,uuid,varchar,varchar,varchar,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,uuid,varchar,jsonb,jsonb,uuid,integer),
 learning_activity_quiz_draft_put(uuid,uuid,uuid,integer,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,jsonb,jsonb,uuid,integer),
 learning_activity_publish(uuid,uuid,uuid,integer,varchar) TO asalab_app;

CREATE FUNCTION learning_quiz_finalize_internal(p_attempt uuid,p_expected integer,p_request varchar,p_expiry boolean DEFAULT false)
RETURNS varchar LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE attempt public.learning_attempts%ROWTYPE; state public.quiz_attempt_states%ROWTYPE;
 submission public.learning_submissions%ROWTYPE; version public.learning_activity_versions%ROWTYPE;
 q jsonb; key jsonb; response jsonb; correct boolean; points integer; total bigint:=0; maximum bigint:=0;
 pending integer:=0; evidence jsonb:='[]'::jsonb; payload jsonb; digest varchar; result_id uuid;
 outcome varchar; percentage integer; publisher uuid; effective jsonb; now_at timestamptz:=clock_timestamp();
BEGIN
 IF p_request IS NULL OR p_request!~'^[A-Za-z0-9._:-]{8,128}$' OR p_expected IS NULL THEN RETURN 'invalid_request'; END IF;
 SELECT a.* INTO attempt FROM public.learning_attempts a WHERE a.id=p_attempt FOR UPDATE;
 IF attempt.id IS NULL THEN RETURN 'not_found'; END IF;
 PERFORM set_config('app.tenant_id',attempt.tenant_id::text,true);
 SELECT qstate.* INTO state FROM public.quiz_attempt_states qstate WHERE qstate.attempt_id=p_attempt FOR UPDATE;
 IF state.attempt_id IS NULL THEN RETURN 'not_found'; END IF;
 SELECT x.* INTO submission FROM public.learning_submissions x WHERE x.attempt_id=p_attempt;
 IF submission.id IS NOT NULL THEN
 IF submission.client_request_id=p_request AND (submission.payload_manifest->>'sourceRevision')::integer=p_expected THEN RETURN 'ok'; END IF;
 RETURN 'quiz_attempt_closed'; END IF;
 IF state.version IS DISTINCT FROM p_expected THEN RETURN 'quiz_attempt_conflict'; END IF;
 IF attempt.state<>'in_progress' THEN RETURN 'quiz_attempt_closed'; END IF;
 IF p_expiry AND (attempt.expires_at IS NULL OR attempt.expires_at>now_at) THEN RETURN 'not_expired'; END IF;
 IF EXISTS(SELECT 1 FROM public.learning_submissions x WHERE x.tenant_id=attempt.tenant_id AND x.client_request_id=p_request) THEN RETURN 'request_conflict'; END IF;
 SELECT v.* INTO version FROM public.learning_activity_versions v WHERE v.id=attempt.learning_activity_version_id
 AND v.tenant_id=attempt.tenant_id AND v.canonical_kind='quiz';
 IF version.id IS NULL THEN RETURN 'not_found'; END IF;
 IF p_expiry AND COALESCE(state.policy_snapshot#>>'{attemptPolicy,expirationPolicy}','auto_submit')='expire_without_submission' THEN
 UPDATE public.learning_attempts SET state='expired',evaluated_at=NULL WHERE id=p_attempt; RETURN 'ok'; END IF;
 FOR q IN SELECT value FROM jsonb_array_elements(state.selected_questions_jsonb) LOOP
 SELECT k.answer_key INTO key FROM public.question_answer_keys k WHERE k.tenant_id=attempt.tenant_id AND k.question_version_id=(q->>'id')::uuid;
 IF key IS NULL THEN RAISE EXCEPTION 'Missing frozen question key'; END IF;
 response:=COALESCE(state.answers_jsonb->(q->>'id'),'null'::jsonb);
 maximum:=maximum+(q->>'maxPoints')::integer;
 IF q->>'type'='long_text_manual' THEN pending:=pending+1; points:=NULL; correct:=NULL;
 ELSE correct:=public.learning_quiz_answer_correct_internal(q->>'type',response,key);
 points:=CASE WHEN correct THEN (q->>'maxPoints')::integer ELSE 0 END; total:=total+points;
 INSERT INTO public.attempt_answers(tenant_id,attempt_id,question_version_id,response,awarded_points,max_points,is_correct)
 VALUES(attempt.tenant_id,p_attempt,(q->>'id')::uuid,response,points,(q->>'maxPoints')::integer,correct);
 END IF;
 evidence:=evidence||jsonb_build_array(jsonb_build_object('questionVersionId',q->'id','points',points,'correct',correct,'maxPoints',q->'maxPoints','manualPending',q->>'type'='long_text_manual'));
 END LOOP;
 IF maximum NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'Invalid frozen Quiz total'; END IF;
 payload:=jsonb_build_object('kind','quiz','sourceRevision',state.version,'questions',state.selected_questions_jsonb,
 'answers',state.answers_jsonb,'scoring',evidence,'autoPoints',total,'manualPending',pending,'policy',state.policy_snapshot);
 digest:=encode(pg_catalog.sha256(convert_to(payload::text,'UTF8')),'hex');
 effective:=attempt.effective_conditions_at_start;
 INSERT INTO public.learning_submissions(tenant_id,attempt_id,project_id,project_version_id,payload_manifest,payload_digest,client_request_id,late_state)
 VALUES(attempt.tenant_id,p_attempt,NULL,NULL,payload,digest,p_request,CASE WHEN (effective#>>'{values,dueAt}')::timestamptz<now_at THEN 'late' ELSE 'on_time' END);
 UPDATE public.learning_attempts SET state='submitted',submitted_at=now_at WHERE id=p_attempt;
 INSERT INTO public.learning_evaluations(tenant_id,attempt_id,evaluator_kind,status,points,max_points,evidence)
 VALUES(attempt.tenant_id,p_attempt,'automatic','completed',total::integer,maximum::integer,jsonb_build_object('grader','quiz-v1','provisional',pending>0,'scoring',evidence,'submissionDigest',digest));
 UPDATE public.learning_attempts SET state=CASE WHEN pending>0 THEN 'evaluating' ELSE 'closed' END,
 submitted_at=now_at,evaluated_at=CASE WHEN pending=0 THEN now_at ELSE NULL END WHERE id=p_attempt;
 IF pending=0 THEN
 percentage:=(total*10000/maximum)::integer;
 outcome:=CASE WHEN percentage>=COALESCE((state.policy_snapshot#>>'{assessmentPolicy,passThresholdBasisPoints}')::integer,6000) THEN 'passed' ELSE 'failed' END;
 SELECT root.owner_principal_id INTO publisher FROM public.learning_activities root WHERE root.id=version.activity_id AND root.tenant_id=attempt.tenant_id;
 INSERT INTO public.assessment_results(tenant_id,attempt_id,raw_points,max_points,percentage_basis_points,outcome,auto_points,
 review_decision,completion_value,revision_number,evaluator_principal_id)
 VALUES(attempt.tenant_id,p_attempt,CASE WHEN version.result_mode='graded' THEN total::integer ELSE NULL END,
 CASE WHEN version.result_mode='graded' THEN maximum::integer ELSE NULL END,
 CASE WHEN version.result_mode='graded' THEN percentage ELSE NULL END,
 outcome,total::integer,'accepted',outcome='passed',1,publisher) RETURNING id INTO result_id;
 PERFORM public.learning_gradebook_projection_sync_internal(attempt.activity_participation_id,publisher,result_id,'Автоматическая проверка теста');
 END IF;
 RETURN 'ok';
END; $$;
REVOKE ALL ON FUNCTION learning_quiz_finalize_internal(uuid,integer,varchar,boolean) FROM PUBLIC,asalab_app;

CREATE FUNCTION learning_quiz_attempt_submit(p_actor uuid,p_attempt uuid,p_expected integer,p_request varchar)
RETURNS TABLE(result_code varchar,attempt jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE original public.learning_attempts%ROWTYPE; scope jsonb; code varchar; expired boolean;
BEGIN
 SELECT a.* INTO original FROM public.learning_attempts a WHERE a.id=p_attempt;
 scope:=public.learning_quiz_scope_internal(p_actor,original.activity_participation_id);
 IF scope IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb; RETURN; END IF;
 PERFORM 1 FROM public.learning_attempts a WHERE a.id=p_attempt FOR UPDATE;
 scope:=public.learning_quiz_scope_internal(p_actor,original.activity_participation_id);
 IF scope IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::jsonb; RETURN; END IF;
 expired:=original.expires_at IS NOT NULL AND original.expires_at<=clock_timestamp();
 IF NOT expired AND original.state='in_progress' AND NOT public.learning_quiz_window_open_internal(scope,clock_timestamp()) THEN
 RETURN QUERY SELECT 'quiz_attempt_closed'::varchar,NULL::jsonb; RETURN; END IF;
 code:=public.learning_quiz_finalize_internal(p_attempt,p_expected,p_request,expired);
 RETURN QUERY SELECT code,CASE WHEN code='ok' THEN public.learning_quiz_attempt_read(p_actor,p_attempt) END;
END; $$;
REVOKE ALL ON FUNCTION learning_quiz_attempt_submit(uuid,uuid,integer,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_quiz_attempt_submit(uuid,uuid,integer,varchar) TO asalab_app;

CREATE FUNCTION learning_quiz_expiry_sweep() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE row record; handled integer:=0;
BEGIN
 FOR row IN SELECT a.id,s.version FROM public.learning_attempts a JOIN public.quiz_attempt_states s ON s.attempt_id=a.id
 WHERE a.state='in_progress' AND a.expires_at<=clock_timestamp() ORDER BY a.expires_at,a.id FOR UPDATE OF a SKIP LOCKED LIMIT 32 LOOP
 IF public.learning_quiz_finalize_internal(row.id,row.version,'expiry:'||row.id::text,true)='ok' THEN handled:=handled+1; END IF;
 END LOOP;
 RETURN handled;
END; $$;
REVOKE ALL ON FUNCTION learning_quiz_expiry_sweep() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_quiz_expiry_sweep() TO asalab_app;

CREATE OR REPLACE FUNCTION learning_canonical_evidence_internal(
    p_classroom_id uuid,
    p_seat_id uuid DEFAULT NULL,
    p_include_inactive boolean DEFAULT false
)
RETURNS TABLE (evidence jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT jsonb_build_object(
        'tenantId', assignment.tenant_id,
        'schoolId', classroom.school_id,
        'classroomId', classroom.id,
        'classroomAssignmentId', assignment.id,
        'kind', CASE
            WHEN EXISTS(SELECT 1 FROM public.learning_activity_versions typed_version
              WHERE typed_version.id=run.learning_activity_version_id
                AND typed_version.canonical_kind='essay') THEN 'essay'
            WHEN assignment.quiz_version_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.learning_activity_versions typed_version WHERE typed_version.id=run.learning_activity_version_id AND typed_version.canonical_kind='quiz') THEN 'quiz'
            WHEN assignment.course_run_id IS NOT NULL THEN 'course_project'
            ELSE 'direct_project'
        END,
        'dueAt', CASE WHEN run.id IS NULL THEN to_jsonb(assignment.due_at) ELSE public.learning_effective_conditions_internal(run.id,participation.id)#>'{values,dueAt}' END,
        'activityRunId', run.id,
        'participation', CASE WHEN run.id IS NULL THEN NULL ELSE jsonb_build_object(
          'applicable',participation.id IS NOT NULL,'status',COALESCE(participation.status,'assigned'),
          'excused',COALESCE(participation.excused,false)) END,
        'assignmentStatus', assignment.status,
        'seatId', seat.id,
        'accountId', seat.account_id,
        'principalId', seat_principal.id,
        'learnerId', learner_link.learner_identity_id,
        'identityResolution', CASE
            WHEN learner_link.learner_identity_id IS NOT NULL THEN 'learner_identity'
            ELSE 'seat_compatibility'
        END,
        'seatStatus', seat.status,
        'classroomAccess', CASE WHEN classroom.status = 'active' THEN 'active' ELSE 'ended' END,
        'legacyWork', CASE WHEN work.id IS NULL THEN NULL ELSE jsonb_build_object(
            'projectId', work.project_id,
            'startedAt', work.started_at,
            'submittedAt', work.submitted_at
        ) END,
        'courseProgressPresent', assignment.course_run_id IS NOT NULL,
        'attempt', CASE WHEN attempt.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', attempt.id,
            'attemptNumber', attempt.attempt_number,
            'revisionOfAttemptId', attempt.revision_of_attempt_id,
            'state', attempt.state,
            'reviewDecision', attempt_review.review_decision,
            'startedAt', attempt.started_at,
            'submittedAt', attempt.submitted_at,
            'lateState', submission.late_state
        ) END,
        'selectedAttemptExists', CASE WHEN run.id IS NOT NULL THEN canonical_selection.attempt_id IS NOT NULL ELSE selected_attempt.id IS NOT NULL END,
        'resultSelectionSource', CASE WHEN run.id IS NOT NULL THEN 'canonical' WHEN grade.id IS NULL THEN 'none' ELSE 'gradebook_pointer' END,
        'selectedAttemptId', CASE WHEN run.id IS NOT NULL THEN canonical_selection.attempt_id ELSE grade.accepted_attempt_id END,
        'selectedRevision',CASE WHEN run.id IS NULL OR canonical_result.id IS NULL THEN NULL ELSE jsonb_build_object(
          'id',canonical_result.id,'attemptId',canonical_result.attempt_id,'rawPoints',canonical_result.raw_points,
          'maxPoints',canonical_result.max_points,'percentageBasisPoints',canonical_result.percentage_basis_points,
          'displayGrade',public.learning_grade_label_for_run(run.id,canonical_result.percentage_basis_points),'completionValue',canonical_result.completion_value,
          'outcome',canonical_result.outcome,'publishedAt',canonical_result.published_at) END,
        'selectedResult', CASE WHEN selected_result.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', selected_result.id,
            'attemptId', selected_result.attempt_id,
            'rawPoints', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE selected_result.raw_points END,
            'maxPoints', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE selected_result.max_points END,
            'percentageBasisPoints', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE selected_result.percentage_basis_points END,
            'displayGrade', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE
                COALESCE(public.grade_label_for_classroom(assignment.classroom_id, selected_result.percentage_basis_points),
                    CASE selected_result.outcome WHEN 'passed' THEN 'Зачёт' WHEN 'failed' THEN 'Не зачтено' END)
            END,
            'outcome', CASE WHEN compatibility.grading_semantics = 'unknown' THEN NULL ELSE selected_result.outcome END,
            'publishedAt', selected_result.published_at
        ) END,
        'selectionConflict', CASE
            WHEN run.id IS NOT NULL THEN CASE WHEN participation.teacher_selected_attempt_id IS NOT NULL AND canonical_selection.attempt_id IS NULL THEN 'selected_attempt_missing' ELSE NULL END
            WHEN grade.id IS NULL THEN NULL
            WHEN selected_attempt.id IS NULL THEN 'selected_attempt_missing'
            WHEN selected_result.id IS NULL THEN 'selected_result_missing'
            WHEN selected_attempt.classroom_assignment_id <> assignment.id
              OR selected_attempt.seat_id <> seat.id
              OR selected_attempt.tenant_id <> assignment.tenant_id THEN 'pointer_scope_mismatch'
            WHEN selected_result.attempt_id <> grade.accepted_attempt_id THEN 'attempt_result_mismatch'
            ELSE NULL
        END,
        'validUnselectedResultCount', CASE WHEN run.id IS NOT NULL THEN 0 ELSE (
            SELECT count(*)::integer
              FROM public.learning_attempts candidate_attempt
              JOIN public.assessment_results candidate_result
                ON candidate_result.attempt_id = candidate_attempt.id
             WHERE candidate_attempt.classroom_assignment_id = assignment.id
               AND candidate_attempt.seat_id = seat.id
               AND (grade.assessment_result_id IS NULL OR candidate_result.id <> grade.assessment_result_id)
        ) END,
        'compatibilityGradingUnknown', compatibility.grading_semantics = 'unknown',
        'reusableAuthoredContent', COALESCE(compatibility.reusable_authored_content, true)
    )
      FROM public.classroom_assignments assignment
      JOIN public.classrooms classroom ON classroom.id = assignment.classroom_id
      JOIN public.classroom_student_seats seat ON seat.classroom_id = assignment.classroom_id
      LEFT JOIN public.principals seat_principal ON seat_principal.seat_id = seat.id
      LEFT JOIN public.learner_identity_links learner_link
        ON learner_link.seat_id = seat.id
       AND learner_link.tenant_id = assignment.tenant_id
       AND learner_link.school_id = classroom.school_id
       AND learner_link.status = 'active'
      LEFT JOIN public.activity_runs run ON run.source_classroom_assignment_id=assignment.id
      LEFT JOIN public.activity_participations participation ON participation.activity_run_id=run.id
        AND participation.learner_identity_id=learner_link.learner_identity_id
      LEFT JOIN LATERAL public.learning_selected_result_internal(participation.id) canonical_selection ON true
      LEFT JOIN public.assessment_results canonical_result ON canonical_result.id=canonical_selection.result_id
      LEFT JOIN public.classroom_assignment_work work
        ON work.assignment_id = assignment.id AND work.seat_id = seat.id
      LEFT JOIN LATERAL (
          SELECT current_attempt.*
            FROM public.learning_attempts current_attempt
           WHERE current_attempt.classroom_assignment_id = assignment.id
             AND current_attempt.seat_id = seat.id
           ORDER BY current_attempt.attempt_number DESC, current_attempt.id DESC
           LIMIT 1
      ) attempt ON true
      LEFT JOIN LATERAL (
          SELECT result.review_decision
            FROM public.assessment_results result
           WHERE result.attempt_id=attempt.id
           ORDER BY result.revision_number DESC
           LIMIT 1
      ) attempt_review ON true
      LEFT JOIN public.learning_submissions submission ON submission.attempt_id = attempt.id
      LEFT JOIN public.gradebook_entries grade
        ON grade.classroom_assignment_id = assignment.id AND grade.seat_id = seat.id
      LEFT JOIN public.learning_attempts selected_attempt ON selected_attempt.id = grade.accepted_attempt_id
      LEFT JOIN public.assessment_results selected_result ON selected_result.id = grade.assessment_result_id
      LEFT JOIN public.learning_migration_compatibility_activity_versions compatibility
        ON compatibility.classroom_assignment_id = assignment.id
     WHERE assignment.classroom_id = p_classroom_id
       AND (p_seat_id IS NULL OR seat.id = p_seat_id)
       AND (p_include_inactive OR seat.status = 'active')
     ORDER BY assignment.created_at, assignment.id, seat.display_label, seat.id;
$$;

CREATE OR REPLACE FUNCTION learning_attempt_review_v2(
 p_account_id uuid,p_reviewer_principal_id uuid,p_classroom_id uuid,p_attempt_id uuid,
 p_decision varchar,p_points integer,p_feedback varchar,p_reason varchar,
 p_expected_result_id uuid,p_request_id varchar
)
RETURNS TABLE(result_code varchar,assessment_result_id uuid,gradebook_entry_id uuid,
 attempt_state varchar,percentage_basis_points integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_access record; v_attempt record; v_prior record; v_retry record;
 v_result uuid; v_gradebook uuid; v_percentage integer; v_digest varchar;
 v_effective jsonb;
BEGIN
 SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id,p_classroom_id);
 IF v_access.user_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.principals
   WHERE id=p_reviewer_principal_id AND account_id=p_account_id AND kind='account') THEN
   RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 PERFORM set_config('app.tenant_id',v_access.tenant_id::text,true);
 -- Use the same Run -> capability -> Participation lock order as Start.
 -- A concurrent conditions/capability change must finish before we decide
 -- whether this review can create a real learner action.
 IF p_decision='changes_requested' THEN
   -- Project capability locking remains below. Essay has no module, but the
   -- exact Run is still locked before its Participation and Attempt.
   PERFORM 1 FROM public.learning_attempts essay_attempt
     JOIN public.activity_participations essay_part ON essay_part.id=essay_attempt.activity_participation_id
     JOIN public.activity_runs essay_run ON essay_run.id=essay_part.activity_run_id
     JOIN public.learning_activity_versions essay_version ON essay_version.id=essay_run.learning_activity_version_id
     WHERE essay_attempt.id=p_attempt_id AND essay_attempt.classroom_id=p_classroom_id
       AND essay_attempt.tenant_id=v_access.tenant_id AND essay_version.canonical_kind IN('essay','quiz')
     FOR SHARE OF essay_run;
   PERFORM 1 FROM public.learning_attempts attempt
     JOIN public.activity_participations participation
       ON participation.id=attempt.activity_participation_id
       AND participation.tenant_id=attempt.tenant_id
     JOIN public.activity_runs run ON run.id=participation.activity_run_id
       AND run.tenant_id=participation.tenant_id
     JOIN public.learning_activity_versions version
       ON version.id=run.learning_activity_version_id
       AND version.tenant_id=run.tenant_id
     JOIN public.module_learning_capabilities capability
       ON capability.module_key=version.module_key
     WHERE attempt.id=p_attempt_id AND attempt.classroom_id=p_classroom_id
       AND attempt.tenant_id=v_access.tenant_id
     FOR SHARE OF run,capability;
 END IF;
 PERFORM 1 FROM public.activity_participations participation
   JOIN public.learning_attempts attempt ON attempt.activity_participation_id=participation.id
   WHERE attempt.id=p_attempt_id AND attempt.classroom_id=p_classroom_id
     AND attempt.tenant_id=v_access.tenant_id FOR UPDATE OF participation;
 SELECT attempt.*,part.activity_run_id,version.max_points,version.result_mode,version.policy_snapshot,
   classroom.school_id,classroom.academic_period_id
 INTO v_attempt FROM public.learning_attempts attempt
 JOIN public.activity_participations part ON part.id=attempt.activity_participation_id
   AND part.tenant_id=attempt.tenant_id
 JOIN public.learning_activity_versions version ON version.id=attempt.learning_activity_version_id
 JOIN public.classrooms classroom ON classroom.id=attempt.classroom_id
 WHERE attempt.id=p_attempt_id AND attempt.classroom_id=p_classroom_id
   AND attempt.tenant_id=v_access.tenant_id AND attempt.activity_participation_id IS NOT NULL
   AND EXISTS(SELECT 1 FROM public.learning_activities activity WHERE activity.id=version.activity_id AND activity.reusable_authored_content)
   AND EXISTS(SELECT 1 FROM public.learning_submissions submission WHERE submission.attempt_id=attempt.id)
 FOR UPDATE OF attempt;
 IF v_attempt.id IS NULL THEN
   RETURN QUERY SELECT 'attempt_not_found'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM public.classroom_student_seats seat WHERE seat.id=v_attempt.seat_id AND seat.account_id=p_account_id)
 OR EXISTS(SELECT 1 FROM public.learner_identity_links link WHERE link.learner_identity_id=v_attempt.learner_identity_id
   AND link.account_id=p_account_id AND link.status='active') THEN
   RETURN QUERY SELECT 'self_review_forbidden'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$'
 OR p_decision IS NULL OR p_decision NOT IN ('accepted','changes_requested','incomplete','excused')
 OR length(COALESCE(p_feedback,''))>8000 OR length(COALESCE(p_reason,''))>1000 THEN
   RETURN QUERY SELECT 'invalid_review'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 v_digest:=encode(pg_catalog.sha256(convert_to(jsonb_build_array(p_attempt_id,p_reviewer_principal_id,p_decision,
   p_points,p_feedback,p_reason,p_expected_result_id)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(v_access.tenant_id::text||p_request_id,1112));
 SELECT * INTO v_retry FROM public.assessment_results WHERE tenant_id=v_access.tenant_id AND client_request_id=p_request_id;
 IF v_retry.id IS NOT NULL THEN
   RETURN QUERY SELECT CASE WHEN v_retry.request_digest=v_digest THEN 'ok' ELSE 'request_conflict' END::varchar,
     CASE WHEN v_retry.request_digest=v_digest THEN v_retry.id END,NULL::uuid,
     CASE WHEN v_retry.request_digest=v_digest THEN 'closed' END::varchar,
     CASE WHEN v_retry.request_digest=v_digest THEN v_retry.percentage_basis_points END; RETURN;
 END IF;
 SELECT * INTO v_prior FROM public.assessment_results WHERE attempt_id=p_attempt_id ORDER BY revision_number DESC LIMIT 1;
 IF v_prior.id IS DISTINCT FROM p_expected_result_id THEN
   RETURN QUERY SELECT 'result_revision_conflict'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 IF v_attempt.state='invalidated'
 OR (v_prior.id IS NULL AND v_attempt.state NOT IN ('submitted','evaluating'))
 OR (v_prior.id IS NOT NULL AND p_decision='changes_requested'
     AND (v_attempt.state <> 'closed' OR v_prior.review_decision IS DISTINCT FROM 'accepted')) THEN
   RETURN QUERY SELECT 'invalid_transition'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 -- A return grants a real learner action. Correct only the current exact
 -- Attempt while its source is still open and its learner still has access.
 -- A terminal Run/Participation may still be reviewed, but cannot be reopened
 -- through a pedagogical correction or by an archived Project preference.
 IF p_decision='changes_requested' THEN
   v_effective:=public.learning_effective_conditions_internal(
     v_attempt.activity_run_id,v_attempt.activity_participation_id);
   -- Admission and Submit use these same effective conditions. A review must
   -- not surface an archived Project as actionable while Continue is closed.
   IF v_effective IS NULL
     OR (v_effective#>>'{values,opensAt}')::timestamptz>now()
     OR (v_effective#>>'{values,closesAt}')::timestamptz<now()
     OR ((v_effective#>>'{values,dueAt}')::timestamptz<now()
       AND v_effective#>>'{values,latePolicy}'='block_at_due'
       AND v_effective->>'teacherUnlocked' IS DISTINCT FROM 'true') THEN
     RETURN QUERY SELECT 'invalid_transition'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
   END IF;
 END IF;
 IF p_decision='changes_requested' AND (
   EXISTS (SELECT 1 FROM public.learning_attempts later
     WHERE later.activity_participation_id=v_attempt.activity_participation_id
       AND later.id<>p_attempt_id
       AND later.attempt_number>=v_attempt.attempt_number)
   OR NOT EXISTS (
     SELECT 1 FROM public.activity_participations part
     JOIN public.activity_runs run ON run.id=part.activity_run_id
       AND run.tenant_id=part.tenant_id AND run.school_id=part.school_id
     JOIN public.classrooms room ON room.id=run.classroom_id
       AND room.tenant_id=run.tenant_id AND room.school_id=run.school_id
     JOIN public.classroom_assignments assignment
       ON assignment.id=run.source_classroom_assignment_id
       AND assignment.tenant_id=run.tenant_id
       AND assignment.classroom_id=run.classroom_id
     JOIN public.classroom_student_seats seat
       ON seat.id=v_attempt.seat_id AND seat.tenant_id=run.tenant_id
       AND seat.classroom_id=run.classroom_id
     JOIN public.learning_activity_versions version
       ON version.id=run.learning_activity_version_id
       AND version.tenant_id=run.tenant_id
     LEFT JOIN public.module_learning_capabilities capability
       ON capability.module_key=version.module_key
     JOIN public.learner_identity_links seat_link
       ON seat_link.seat_id=seat.id AND seat_link.status='active'
       AND seat_link.link_kind='student_seat'
       AND seat_link.tenant_id=part.tenant_id AND seat_link.school_id=part.school_id
       AND seat_link.learner_identity_id=part.learner_identity_id
     WHERE part.id=v_attempt.activity_participation_id
       AND part.tenant_id=v_attempt.tenant_id
       AND part.learner_identity_id=v_attempt.learner_identity_id
       AND part.status='active' AND NOT part.excused
       AND run.lifecycle_status='active'
       AND run.classroom_id=p_classroom_id
       AND run.learning_activity_version_id=v_attempt.learning_activity_version_id
       AND run.source_classroom_assignment_id=v_attempt.classroom_assignment_id
       AND room.status='active' AND assignment.status='open'
       AND seat.status='active'
       AND ((version.canonical_kind='quiz' AND version.module_key IS NULL AND EXISTS(SELECT 1 FROM public.quiz_attempt_states quiz WHERE quiz.attempt_id=p_attempt_id AND quiz.tenant_id=v_attempt.tenant_id)) OR (version.canonical_kind='essay' AND version.module_key IS NULL
         AND EXISTS(SELECT 1 FROM public.learning_essay_drafts essay
           WHERE essay.attempt_id=p_attempt_id AND essay.tenant_id=part.tenant_id)) OR
         (version.canonical_kind NOT IN('essay','quiz')
          AND capability.creatable AND capability.assignable
       AND capability.editable_evidence AND capability.submit_project_version
       -- Older first reviews may still return work without a Project origin;
       -- a correction of an accepted Attempt must have an exact Project.
       AND ((v_prior.id IS NULL AND NOT EXISTS (
              SELECT 1 FROM public.learning_project_origins origin
              WHERE origin.participation_id=part.id))
         OR EXISTS (
           SELECT 1 FROM public.learning_project_origins origin
           JOIN public.projects project ON project.id=origin.project_id
             AND project.tenant_id=origin.project_tenant_id
             AND project.owner_principal_id=origin.owner_principal_id
           JOIN public.principals owner ON owner.id=origin.owner_principal_id
           WHERE origin.participation_id=part.id AND origin.activity_run_id=run.id
             AND origin.learner_identity_id=part.learner_identity_id
             AND project.project_scope='personal' AND project.status='active'
             AND project.module_key=version.module_key
             AND ((owner.kind='student_seat' AND owner.seat_id=seat.id)
               OR (owner.kind='account' AND owner.account_id=seat.account_id
                 AND EXISTS (
                   SELECT 1 FROM public.accounts account
                   JOIN public.learner_identity_links account_link
                     ON account_link.account_id=account.id
                     AND account_link.tenant_id=part.tenant_id
                     AND account_link.school_id=part.school_id
                     AND account_link.learner_identity_id=part.learner_identity_id
                     AND account_link.link_kind='account'
                     AND account_link.status='active'
                   WHERE account.id=seat.account_id AND account.status='active'))))))
       )
       AND ((run.source_kind='direct'
             AND assignment.course_run_id IS NULL
             AND public.learning_direct_assignment_seat_visible(
               seat.id,assignment.id))
         OR (run.source_kind='course'
             AND EXISTS (
               SELECT 1 FROM public.classroom_course_runs course
               JOIN public.course_enrollments enrollment
                 ON enrollment.id=part.source_course_enrollment_id
                 AND enrollment.tenant_id=part.tenant_id
                 AND enrollment.school_id=part.school_id
                 AND enrollment.course_run_id=course.id
                 AND enrollment.learner_identity_id=part.learner_identity_id
               WHERE course.id=run.source_course_run_id
                 AND course.tenant_id=run.tenant_id
                 AND course.classroom_id=run.classroom_id
                 AND course.status='open'
                 AND assignment.course_run_id=course.id
                 AND enrollment.status IN ('assigned','active')
                 AND public.learning_course_seat_visible(seat.id,course.id)
                 AND EXISTS (
                   SELECT 1 FROM public.classroom_course_run_lessons lesson
                   WHERE lesson.id=run.source_course_lesson_id
                     AND lesson.tenant_id=run.tenant_id
                     AND lesson.run_id=course.id
                     AND ((run.source_course_block_id IS NULL
                       AND lesson.kind='assignment'
                       AND lesson.classroom_assignment_id=assignment.id
                       AND lesson.module_key=version.module_key
                       AND public.learning_course_assignment_lesson_pinned(run.id))
                     OR (run.source_course_block_id IS NOT NULL
                       AND EXISTS (
                         SELECT 1 FROM jsonb_array_elements(lesson.blocks) block
                         WHERE block->>'id'=run.source_course_block_id
                           AND block->>'type'='activity'
                           AND block->'hidden' IS DISTINCT FROM 'true'::jsonb
                           AND block->>'learningActivityVersionId'=version.id::text)))))))
   )) THEN
   RETURN QUERY SELECT 'invalid_transition'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 IF (v_prior.id IS NOT NULL OR p_decision IN ('changes_requested','incomplete','excused'))
   AND length(trim(COALESCE(p_reason,'')))=0 THEN
   RETURN QUERY SELECT 'reason_required'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 IF (p_decision='accepted' AND v_attempt.result_mode='graded'
     AND (p_points IS NULL OR p_points<0 OR p_points>v_attempt.max_points))
 OR ((v_attempt.result_mode<>'graded' OR p_decision<>'accepted') AND p_points IS NOT NULL) THEN
   RETURN QUERY SELECT 'invalid_points'::varchar,NULL::uuid,NULL::uuid,NULL::varchar,NULL::integer; RETURN;
 END IF;
 v_percentage:=CASE WHEN p_points IS NOT NULL THEN (p_points::bigint*10000/v_attempt.max_points)::integer END;
 INSERT INTO public.learning_evaluations(tenant_id,attempt_id,evaluator_kind,evaluator_principal_id,status,
   points,max_points,feedback,evidence)
 VALUES(v_attempt.tenant_id,p_attempt_id,'teacher',p_reviewer_principal_id,'completed',p_points,
   v_attempt.max_points,p_feedback,jsonb_build_object('decision',p_decision,'requestId',p_request_id,'reason',p_reason));
 INSERT INTO public.assessment_results(tenant_id,attempt_id,raw_points,max_points,percentage_basis_points,
   outcome,manual_points,evaluator_principal_id,feedback,revision_number,supersedes_result_id,
   review_decision,completion_value,client_request_id,request_digest,correction_reason)
 VALUES(v_attempt.tenant_id,p_attempt_id,p_points,v_attempt.max_points,v_percentage,
   CASE WHEN p_decision='accepted' THEN 'passed' WHEN p_decision='excused' THEN 'excused' ELSE 'incomplete' END,
   COALESCE(p_points,0),p_reviewer_principal_id,p_feedback,COALESCE(v_prior.revision_number,0)+1,v_prior.id,
   p_decision,p_decision='accepted',p_request_id,v_digest,p_reason) RETURNING id INTO v_result;
 -- The reviewed Attempt's closing time stays immutable. A return can grant
 -- a new linked revision Attempt, but never reopens this frozen Submission.
 IF v_prior.id IS NULL THEN
   UPDATE public.learning_attempts SET state='closed',evaluated_at=now() WHERE id=p_attempt_id;
 END IF;
 IF p_decision='changes_requested' THEN
   -- A previously returned and then reaccepted Attempt keeps its existing
   -- revision allowance; changing the decision again cannot stack grants.
   IF NOT EXISTS (SELECT 1 FROM public.assessment_results earlier
       WHERE earlier.attempt_id=p_attempt_id AND earlier.id<>v_result
         AND earlier.review_decision='changes_requested') THEN
     UPDATE public.activity_participations SET extra_attempts=extra_attempts+1 WHERE id=v_attempt.activity_participation_id;
   END IF;
   UPDATE public.classroom_assignment_work SET submitted_at=NULL
     WHERE assignment_id=v_attempt.classroom_assignment_id AND seat_id=v_attempt.seat_id;
 END IF;
 SELECT public.learning_gradebook_projection_sync_internal(
   v_attempt.activity_participation_id,p_reviewer_principal_id,v_result,
   COALESCE(NULLIF(trim(p_reason),''),'Проверка работы')
 ) INTO v_gradebook;
 RETURN QUERY SELECT 'ok'::varchar,v_result,v_gradebook,
   'closed'::varchar,v_percentage;
END;
$$;

CREATE OR REPLACE FUNCTION learning_quiz_attempt_read(p_actor uuid,p_attempt uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb; feedback jsonb; release boolean; v_scope jsonb; v_attempt public.learning_attempts%ROWTYPE; v_state public.quiz_attempt_states%ROWTYPE;
BEGIN
 SELECT attempt.* INTO v_attempt FROM public.learning_attempts attempt WHERE attempt.id=p_attempt;
 IF v_attempt.id IS NULL OR v_attempt.activity_participation_id IS NULL THEN RETURN NULL; END IF;
 v_scope:=public.learning_quiz_scope_internal(p_actor,v_attempt.activity_participation_id);
 IF v_scope IS NULL THEN RETURN NULL; END IF;
 SELECT state.* INTO v_state FROM public.quiz_attempt_states state
 WHERE state.tenant_id=v_attempt.tenant_id AND state.attempt_id=v_attempt.id;
 IF v_state.attempt_id IS NULL THEN RETURN NULL; END IF;
 result:=jsonb_build_object('attemptId',v_attempt.id,'participationId',v_attempt.activity_participation_id,
   'activityRunId',v_scope->'activityRunId','activityVersionId',v_attempt.learning_activity_version_id,
   'attemptNumber',v_state.participation_attempt_number,'state',v_attempt.state,'startedAt',v_attempt.started_at,
   'expiresAt',v_attempt.expires_at,'serverNow',clock_timestamp(),'version',v_state.version,
   'answers',v_state.answers_jsonb,'questions',v_state.selected_questions_jsonb,
   'questionOrder',v_state.question_order_jsonb,'optionOrder',v_state.option_order_jsonb,
   'lastSavedAt',v_state.last_saved_at,'submittedAt',v_attempt.submitted_at);
 release:=public.learning_quiz_feedback_released_internal(p_attempt);
 IF release AND v_attempt.state IN('evaluating','closed') THEN
 SELECT jsonb_build_object('points',ar.raw_points,'maxPoints',ar.max_points,'outcome',ar.outcome,'provisional',false) INTO result
 FROM public.assessment_results ar WHERE ar.attempt_id=p_attempt ORDER BY ar.revision_number DESC LIMIT 1;
 IF result IS NULL THEN
 SELECT jsonb_build_object('points',ev.points,'maxPoints',ev.max_points,'outcome','pending','provisional',true) INTO result
 FROM public.learning_evaluations ev WHERE ev.attempt_id=p_attempt AND ev.evaluator_kind='automatic' ORDER BY ev.created_at DESC LIMIT 1;
 END IF;
 IF COALESCE(v_state.policy_snapshot#>>'{feedbackReleasePolicy,mode}','immediate')<>'score_only' THEN
 SELECT CASE WHEN result->>'provisional'='false' THEN (SELECT jsonb_agg(item||jsonb_build_object('manualPending',false)) FROM jsonb_array_elements(sub.payload_manifest->'scoring') item) ELSE sub.payload_manifest->'scoring' END INTO feedback FROM public.learning_submissions sub WHERE sub.attempt_id=p_attempt AND sub.tenant_id=v_attempt.tenant_id;
 END IF;
 RETURN jsonb_build_object('attemptId',v_attempt.id,'participationId',v_attempt.activity_participation_id,
 'activityRunId',v_scope->'activityRunId','activityVersionId',v_attempt.learning_activity_version_id,
 'attemptNumber',v_state.participation_attempt_number,'state',v_attempt.state,'startedAt',v_attempt.started_at,
 'expiresAt',v_attempt.expires_at,'serverNow',clock_timestamp(),'version',v_state.version,'answers',v_state.answers_jsonb,
 'questions',v_state.selected_questions_jsonb,'questionOrder',v_state.question_order_jsonb,'optionOrder',v_state.option_order_jsonb,
 'lastSavedAt',v_state.last_saved_at,'submittedAt',v_attempt.submitted_at,'result',result)||CASE WHEN feedback IS NOT NULL THEN jsonb_build_object('feedback',feedback) ELSE '{}'::jsonb END;
 END IF;
 RETURN result;
END;
$$;

CREATE FUNCTION learning_quiz_run_read(p_actor uuid,p_run uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE part uuid; scope jsonb; content record; latest uuid; readable boolean;
BEGIN
 SELECT p.id INTO part FROM public.activity_participations p WHERE p.activity_run_id=p_run
 AND public.learning_quiz_scope_internal(p_actor,p.id) IS NOT NULL LIMIT 1;
 IF part IS NULL THEN RETURN NULL; END IF;
 scope:=public.learning_quiz_scope_internal(p_actor,part);
 readable:=public.learning_quiz_window_open_internal(scope,clock_timestamp());
 SELECT v.* INTO content FROM public.learning_activity_versions v WHERE v.id=(scope->>'activityVersionId')::uuid AND v.tenant_id=(scope->>'tenantId')::uuid;
 SELECT a.id INTO latest FROM public.learning_attempts a JOIN public.quiz_attempt_states st ON st.attempt_id=a.id
 WHERE a.activity_participation_id=part ORDER BY a.attempt_number DESC LIMIT 1;
 RETURN jsonb_build_object('resultCode','ok','activityRunId',p_run,'activityVersionId',content.id,'participationId',part,
 'title',CASE WHEN readable OR latest IS NOT NULL THEN content.title ELSE NULL END,
 'instructions',CASE WHEN readable OR latest IS NOT NULL THEN content.instructions ELSE NULL END,
 'goal',CASE WHEN readable OR latest IS NOT NULL THEN content.goal ELSE NULL END,
 'blocks',CASE WHEN readable OR latest IS NOT NULL THEN content.blocks ELSE NULL END,
 'canStart',readable,'attempt',CASE WHEN latest IS NOT NULL THEN public.learning_quiz_attempt_read(p_actor,latest) ELSE NULL END);
END; $$;
REVOKE ALL ON FUNCTION learning_quiz_run_read(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_quiz_run_read(uuid,uuid) TO asalab_app;

CREATE FUNCTION learning_teacher_exact_quiz_submission(p_account uuid,p_class uuid,p_attempt uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('kind','quiz','submissionId',s.id,'sourceRevision',s.payload_manifest->'sourceRevision',
 'digest',s.payload_digest,'questions',s.payload_manifest->'questions','answers',s.payload_manifest->'answers',
 'autoPoints',s.payload_manifest->'autoPoints','manualPending',CASE WHEN EXISTS(SELECT 1 FROM public.assessment_results final WHERE final.attempt_id=a.id) THEN '0'::jsonb ELSE s.payload_manifest->'manualPending' END)
 FROM public.learning_attempts a JOIN public.learning_submissions s ON s.attempt_id=a.id AND s.tenant_id=a.tenant_id
 JOIN public.activity_participations p ON p.id=a.activity_participation_id AND p.tenant_id=a.tenant_id AND p.learner_identity_id=a.learner_identity_id
 JOIN public.activity_runs r ON r.id=p.activity_run_id AND r.tenant_id=a.tenant_id AND r.classroom_id=a.classroom_id AND r.learning_activity_version_id=a.learning_activity_version_id
 JOIN public.learning_activity_versions v ON v.id=r.learning_activity_version_id AND v.tenant_id=r.tenant_id AND v.canonical_kind='quiz'
 WHERE a.id=p_attempt AND a.classroom_id=p_class AND s.payload_manifest->>'kind'='quiz'
 AND s.payload_digest=encode(pg_catalog.sha256(convert_to(s.payload_manifest::text,'UTF8')),'hex')
 AND EXISTS(SELECT 1 FROM public.classroom_memberships m WHERE m.tenant_id=a.tenant_id AND m.classroom_id=p_class AND m.account_id=p_account AND m.member_role IN('owner','co_teacher'));
$$;
REVOKE ALL ON FUNCTION learning_teacher_exact_quiz_submission(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_teacher_exact_quiz_submission(uuid,uuid,uuid) TO asalab_app;

CREATE FUNCTION learning_quiz_assignment_kind(p_actor uuid,p_assignment uuid) RETURNS varchar
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN count(*)=1 THEN 'quiz'::varchar END FROM public.activity_participations p
 JOIN public.activity_runs r ON r.id=p.activity_run_id AND r.tenant_id=p.tenant_id
 WHERE r.source_kind='direct' AND r.source_classroom_assignment_id=p_assignment
 AND public.learning_quiz_scope_internal(p_actor,p.id) IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION learning_quiz_assignment_kind(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_quiz_assignment_kind(uuid,uuid) TO asalab_app;

CREATE OR REPLACE FUNCTION learning_quiz_scope_internal(p_actor uuid,p_part uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('tenantId',part.tenant_id,'participationId',part.id,
   'learnerIdentityId',part.learner_identity_id,'classroomId',run.classroom_id,
   'assignmentId',run.source_classroom_assignment_id,'activityRunId',run.id,
   'activityVersionId',version.id,'quizVersionId',quiz.id,'seatId',current_seat.id,
   'policy',version.policy_snapshot,'contentDigest',quiz.content_digest,
   'shuffleQuestions',COALESCE((SELECT (l.content_flags->>'shuffleQuestions')::boolean FROM public.quiz_version_lineage l WHERE l.quiz_version_id=quiz.id),false),
   'shuffleOptions',COALESCE((SELECT (l.content_flags->>'shuffleOptions')::boolean FROM public.quiz_version_lineage l WHERE l.quiz_version_id=quiz.id),false),
   'timeOverrideSeconds',part.time_limit_override_seconds,
   'runTimeMinutes',run.runtime_policy_snapshot#>'{explicit,timeLimitMinutes}',
   'effective',public.learning_effective_conditions_internal(run.id,part.id),
   'available',part.status IN ('assigned','active') AND NOT part.excused AND run.lifecycle_status='active'
     AND classroom.status='active' AND handout.status='open'
     AND (run.source_kind<>'course' OR course.status='open')
     AND (part.source_course_enrollment_id IS NULL OR enrollment.status='active'))
 FROM public.activity_participations part
 JOIN public.learner_identities learner ON learner.tenant_id=part.tenant_id
   AND learner.school_id=part.school_id AND learner.id=part.learner_identity_id AND learner.state='active'
 JOIN public.activity_runs run ON run.tenant_id=part.tenant_id AND run.school_id=part.school_id
   AND run.id=part.activity_run_id
 JOIN public.classrooms classroom ON classroom.tenant_id=run.tenant_id AND classroom.id=run.classroom_id
 JOIN public.classroom_assignments handout ON handout.tenant_id=run.tenant_id
   AND handout.classroom_id=run.classroom_id AND handout.id=run.source_classroom_assignment_id
 JOIN public.learning_activity_versions version ON version.tenant_id=run.tenant_id
   AND version.id=run.learning_activity_version_id AND version.canonical_kind='quiz'
 JOIN public.quiz_versions quiz ON quiz.tenant_id=version.tenant_id
   AND quiz.id=version.quiz_version_id
 LEFT JOIN public.classroom_course_runs course ON course.tenant_id=run.tenant_id AND course.id=run.source_course_run_id
 LEFT JOIN public.course_enrollments enrollment ON enrollment.tenant_id=part.tenant_id
   AND enrollment.id=part.source_course_enrollment_id AND enrollment.learner_identity_id=part.learner_identity_id
 JOIN public.principals actor ON actor.id=p_actor
 JOIN LATERAL (
   SELECT seat.id FROM public.classroom_student_seats seat
   JOIN public.learner_identity_links seat_link ON seat_link.tenant_id=part.tenant_id
     AND seat_link.school_id=part.school_id AND seat_link.learner_identity_id=part.learner_identity_id
     AND seat_link.link_kind='student_seat' AND seat_link.seat_id=seat.id AND seat_link.status='active'
   WHERE seat.tenant_id=part.tenant_id AND seat.classroom_id=run.classroom_id AND seat.status='active'
     AND ((actor.kind='student_seat' AND actor.seat_id=seat.id)
       OR (actor.kind='account' AND seat.account_id=actor.account_id
         AND EXISTS (SELECT 1 FROM public.accounts account WHERE account.id=actor.account_id AND account.status='active')
         AND EXISTS (
         SELECT 1 FROM public.learner_identity_links account_link
         WHERE account_link.tenant_id=part.tenant_id AND account_link.school_id=part.school_id
           AND account_link.learner_identity_id=part.learner_identity_id
           AND account_link.link_kind='account' AND account_link.account_id=actor.account_id
           AND account_link.status='active')))
   ORDER BY seat.id LIMIT 1
 ) current_seat ON true
 WHERE part.id=p_part;
$$;

CREATE OR REPLACE FUNCTION learning_direct_assignment_activity_list(
    p_actor_principal_id uuid, p_tenant_id uuid, p_classroom_id uuid
)
RETURNS TABLE (
    activity_id uuid, activity_version_id uuid, title varchar,
    instructions varchar, kind varchar, module_key varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT activity.id, version.id, version.title, version.instructions,
           version.canonical_kind, version.module_key
      FROM public.principals principal
      JOIN public.classroom_memberships membership
        ON membership.account_id=principal.account_id
       AND membership.classroom_id=p_classroom_id
       AND membership.member_role IN ('owner','co_teacher')
      JOIN public.classrooms classroom
        ON classroom.tenant_id=membership.tenant_id
       AND classroom.id=membership.classroom_id
       AND classroom.status='active'
      JOIN public.learning_activities activity
        ON activity.tenant_id=classroom.tenant_id
       AND activity.owner_principal_id=p_actor_principal_id
       AND activity.archived_at IS NULL
       AND activity.reusable_authored_content=true
       AND activity.current_published_version_id IS NOT NULL
      JOIN public.learning_activity_versions version
        ON version.tenant_id=activity.tenant_id
       AND version.id=activity.current_published_version_id
       AND version.activity_id=activity.id
       AND version.canonical_contract_version=1
       AND (version.canonical_kind='project' OR (version.canonical_kind='quiz' AND version.module_key IS NULL AND version.quiz_version_id IS NOT NULL))
     WHERE principal.id=p_actor_principal_id
       AND principal.kind='account'
       AND classroom.tenant_id=p_tenant_id
       AND NOT EXISTS (
         SELECT 1 FROM public.learning_migration_compatibility_activity_versions compatibility
          WHERE compatibility.learning_activity_version_id=version.id)
     ORDER BY activity.created_at DESC, activity.id;
$$;

CREATE OR REPLACE FUNCTION learning_direct_assignment_create(
    p_actor_principal_id uuid,
    p_tenant_id uuid,
    p_classroom_id uuid,
    p_learning_activity_version_id uuid,
    p_due_at timestamptz,
    p_audience_type varchar,
    p_named_seat_ids uuid[],
    p_request_id varchar
)
RETURNS TABLE (
    result_code varchar, classroom_assignment_id uuid, activity_run_id uuid,
    audience_id uuid, assigned_count integer, reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_source record;
    v_handout uuid;
    v_run record;
    v_audience record;
    v_learner_ids uuid[] := ARRAY[]::uuid[];
BEGIN
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,80}$'
       OR p_audience_type NOT IN ('whole_class','named_learners')
       OR (p_audience_type='whole_class' AND COALESCE(cardinality(p_named_seat_ids),0)<>0)
       OR (p_audience_type='named_learners' AND (
            COALESCE(cardinality(p_named_seat_ids),0)=0
            OR cardinality(p_named_seat_ids)<>(
                SELECT count(DISTINCT seat_id) FROM unnest(p_named_seat_ids) seat_id))) THEN
        RETURN QUERY SELECT 'invalid_request'::varchar,NULL::uuid,NULL::uuid,NULL::uuid,0,false;
        RETURN;
    END IF;

    SELECT classroom.tenant_id, classroom.school_id, membership.user_id,
           activity.source_teacher_assignment_id, activity.owner_principal_id,
           version.id AS version_id
      INTO v_source
      FROM public.principals principal
      JOIN public.classroom_memberships membership
        ON membership.account_id=principal.account_id
       AND membership.classroom_id=p_classroom_id
       AND membership.member_role IN ('owner','co_teacher')
      JOIN public.classrooms classroom
        ON classroom.tenant_id=membership.tenant_id
       AND classroom.id=membership.classroom_id
       AND classroom.status='active'
      JOIN public.learning_activity_versions version
        ON version.id=p_learning_activity_version_id
       AND version.tenant_id=classroom.tenant_id
       AND version.canonical_contract_version=1
       AND (version.canonical_kind='project' OR (version.canonical_kind='quiz' AND version.module_key IS NULL AND version.quiz_version_id IS NOT NULL))
      JOIN public.learning_activities activity
        ON activity.tenant_id=version.tenant_id
       AND activity.id=version.activity_id
       AND activity.owner_principal_id=p_actor_principal_id
       AND activity.reusable_authored_content=true
       AND activity.archived_at IS NULL
     WHERE principal.id=p_actor_principal_id
       AND principal.kind='account'
       AND classroom.tenant_id=p_tenant_id
       AND NOT EXISTS (
         SELECT 1 FROM public.learning_migration_compatibility_activity_versions compatibility
          WHERE compatibility.learning_activity_version_id=version.id);
    IF v_source.version_id IS NULL THEN
        RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,NULL::uuid,NULL::uuid,0,false;
        RETURN;
    END IF;

    -- The established ActivityRun/Audience commands enforce FORCE-RLS through
    -- the transaction-local tenant setting. The actor/classroom/activity join
    -- above proves this tenant before any canonical runtime write is attempted.
    PERFORM set_config('app.tenant_id',p_tenant_id::text,true);

    IF p_audience_type='named_learners' THEN
        IF EXISTS (
            SELECT 1 FROM unnest(p_named_seat_ids) requested(seat_id)
             WHERE NOT EXISTS (
               SELECT 1 FROM public.classroom_student_seats seat
                WHERE seat.id=requested.seat_id
                  AND seat.tenant_id=v_source.tenant_id
                  AND seat.classroom_id=p_classroom_id
                  AND seat.status IN ('issued','active'))
        ) THEN
            RETURN QUERY SELECT 'named_learner_ineligible'::varchar,
                                NULL::uuid,NULL::uuid,NULL::uuid,0,false;
            RETURN;
        END IF;
        PERFORM public.learning_audience_ensure_seat_identity(seat_id)
          FROM unnest(p_named_seat_ids) seat_id;
        SELECT array_agg(DISTINCT link.learner_identity_id ORDER BY link.learner_identity_id)
          INTO v_learner_ids
          FROM unnest(p_named_seat_ids) requested(seat_id)
          JOIN public.learner_identity_links link
            ON link.seat_id=requested.seat_id AND link.status='active';
    END IF;

    -- A request owns one delivery. A deliberate new request creates a new run
    -- even for the same material/class, without changing previous audiences.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_principal_id::text||p_request_id, 1108));
    SELECT run.source_classroom_assignment_id INTO v_handout FROM public.activity_runs run
     WHERE run.tenant_id=v_source.tenant_id AND run.created_by_principal_id=p_actor_principal_id
       AND run.creation_request_id='vsrun:'||p_request_id;
    IF v_handout IS NULL THEN
        INSERT INTO public.classroom_assignments(tenant_id,classroom_id,learning_activity_version_id,
          due_at,created_by)
        VALUES(v_source.tenant_id,p_classroom_id,p_learning_activity_version_id,p_due_at,v_source.user_id)
        RETURNING id INTO v_handout;
    END IF;

    SELECT * INTO v_run FROM public.activity_run_create(
      p_actor_principal_id,v_handout,p_learning_activity_version_id,'direct',
      NULL,NULL,NULL,p_due_at,NULL,NULL,
      (SELECT grading_scheme_version_id FROM public.classroom_grading_schemes WHERE classroom_id=p_classroom_id),
      '{}'::jsonb,'vsrun:'||p_request_id);
    IF v_run.result_code<>'ok' THEN
        RAISE EXCEPTION 'learning direct assignment run failed: %',v_run.result_code;
    END IF;
    SELECT * INTO v_audience FROM public.learning_audience_create(
      p_actor_principal_id,'activity_run',v_run.activity_run_id,p_audience_type,
      CASE WHEN p_audience_type='whole_class' THEN 'dynamic' ELSE 'snapshot' END,
      v_learner_ids,'vsaudience:'||p_request_id);
    IF v_audience.result_code<>'ok' THEN
        RAISE EXCEPTION 'learning direct assignment audience failed: %',v_audience.result_code;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar,v_handout,v_run.activity_run_id,
      v_audience.audience_id,v_audience.created_count+v_audience.independent_count,
      (v_run.reused AND v_audience.reused);
END;
$$;

-- One release decision is shared by all learner read models. Teacher evidence is unchanged.
CREATE FUNCTION learning_quiz_feedback_released_internal(p_attempt uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN state.attempt_id IS NULL THEN true ELSE
 COALESCE(state.policy_snapshot#>>'{feedbackReleasePolicy,mode}','immediate')<>'after_close'
 OR COALESCE((a.effective_conditions_at_start#>>'{values,closesAt}')::timestamptz<=clock_timestamp(),false)
 OR r.lifecycle_status<>'active' OR h.status='closed' END
 FROM public.learning_attempts a LEFT JOIN public.quiz_attempt_states state ON state.attempt_id=a.id AND state.tenant_id=a.tenant_id
 LEFT JOIN public.activity_participations p ON p.id=a.activity_participation_id AND p.tenant_id=a.tenant_id
 LEFT JOIN public.activity_runs r ON r.id=p.activity_run_id AND r.tenant_id=p.tenant_id
 LEFT JOIN public.classroom_assignments h ON h.id=r.source_classroom_assignment_id AND h.tenant_id=r.tenant_id
 WHERE a.id=p_attempt;
$$;
REVOKE ALL ON FUNCTION learning_quiz_feedback_released_internal(uuid) FROM PUBLIC,asalab_app;
CREATE FUNCTION learning_quiz_learner_evidence_internal(p_evidence jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE selected uuid; field text; projection jsonb:=p_evidence; hidden jsonb:='{"rawPoints":null,"maxPoints":null,"percentageBasisPoints":null,"displayGrade":null,"outcome":null}'::jsonb;
BEGIN
 IF p_evidence->>'kind' IS DISTINCT FROM 'quiz' THEN RETURN p_evidence; END IF;
 selected:=COALESCE(p_evidence->>'selectedAttemptId',p_evidence#>>'{selectedRevision,attemptId}',p_evidence#>>'{selectedResult,attemptId}')::uuid;
 IF selected IS NULL OR public.learning_quiz_feedback_released_internal(selected) THEN RETURN p_evidence; END IF;
 FOREACH field IN ARRAY ARRAY['selectedRevision','selectedResult'] LOOP
 IF jsonb_typeof(projection->field)='object' THEN projection:=jsonb_set(projection,ARRAY[field],(projection->field)||hidden); END IF;
 END LOOP;
 RETURN projection;
END; $$;
REVOKE ALL ON FUNCTION learning_quiz_learner_evidence_internal(jsonb) FROM PUBLIC,asalab_app;

CREATE OR REPLACE FUNCTION learning_canonical_evidence_for_seat(p_seat_id uuid)
RETURNS TABLE (evidence jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.learning_quiz_learner_evidence_internal(projected.evidence)
      FROM public.classroom_student_seats seat
      CROSS JOIN LATERAL public.learning_canonical_evidence_internal(
          seat.classroom_id, seat.id, false
      ) projected
     WHERE seat.id = p_seat_id AND seat.status = 'active';
$$;

CREATE OR REPLACE FUNCTION learning_canonical_evidence_for_account(p_account_id uuid)
RETURNS TABLE (evidence jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.learning_quiz_learner_evidence_internal(projected.evidence)
      FROM public.classroom_student_seats seat
      CROSS JOIN LATERAL public.learning_canonical_evidence_internal(
          seat.classroom_id, seat.id, false
      ) projected
     WHERE seat.account_id = p_account_id AND seat.status = 'active';
$$;

CREATE OR REPLACE FUNCTION learning_results_for_seat(p_seat_id uuid)
RETURNS TABLE(classroom_title varchar,assignment_id uuid,assignment_title varchar,attempt_number integer,state varchar,
 raw_points integer,max_points integer,percentage_basis_points integer,display_grade varchar,outcome varchar,feedback varchar,published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT classroom.title,assignment.id,COALESCE(version.title,task.title,lesson.assignment_title,quiz.title),
   attempt.attempt_number,COALESCE(result.review_decision,attempt.state),result.raw_points,result.max_points,result.percentage_basis_points,
   CASE WHEN run.id IS NOT NULL THEN public.learning_grade_label_for_run(run.id,result.percentage_basis_points)
     ELSE public.grade_label_for_classroom(classroom.id,result.percentage_basis_points) END,
   result.outcome,result.feedback,result.published_at
 FROM public.classroom_student_seats seat JOIN public.classrooms classroom ON classroom.id=seat.classroom_id
 JOIN public.classroom_assignments assignment ON assignment.classroom_id=classroom.id
 LEFT JOIN public.activity_runs run ON run.source_classroom_assignment_id=assignment.id
 LEFT JOIN public.learning_activity_versions version ON version.id=run.learning_activity_version_id
 LEFT JOIN public.learner_identity_links link ON link.seat_id=seat.id AND link.status='active' AND link.school_id=run.school_id AND link.tenant_id=run.tenant_id
 LEFT JOIN public.activity_participations part ON part.activity_run_id=run.id AND part.learner_identity_id=link.learner_identity_id
 LEFT JOIN LATERAL public.learning_selected_result_internal(part.id) selected ON true
 LEFT JOIN public.gradebook_entries grade ON grade.classroom_assignment_id=assignment.id AND grade.seat_id=seat.id
 JOIN public.assessment_results result ON result.id=CASE WHEN run.id IS NOT NULL THEN selected.result_id ELSE grade.assessment_result_id END
 JOIN public.learning_attempts attempt ON attempt.id=result.attempt_id
 LEFT JOIN public.teacher_assignments task ON task.id=assignment.assignment_id
 LEFT JOIN public.classroom_course_run_lessons lesson ON lesson.classroom_assignment_id=assignment.id
 LEFT JOIN public.quiz_versions quiz ON quiz.id=assignment.quiz_version_id
 WHERE public.learning_quiz_feedback_released_internal(attempt.id) AND seat.id=p_seat_id AND seat.status='active' AND (run.id IS NULL OR public.learning_direct_assignment_seat_visible(seat.id,assignment.id))
 ORDER BY result.published_at DESC,assignment.id;
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
           mapped.position, latest.state, CASE WHEN public.learning_quiz_feedback_released_internal(latest.id) THEN result.raw_points END,
           CASE WHEN public.learning_quiz_feedback_released_internal(latest.id) THEN result.percentage_basis_points END
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
