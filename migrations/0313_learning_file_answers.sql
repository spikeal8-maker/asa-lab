ALTER TABLE public.learning_submissions
  DROP CONSTRAINT learning_submissions_payload_kind_check;
ALTER TABLE public.learning_submissions
  ADD CONSTRAINT learning_submissions_payload_kind_check CHECK (
    (project_id IS NOT NULL AND project_version_id IS NOT NULL
      AND payload_manifest->>'kind' = 'project')
    OR (project_id IS NULL AND project_version_id IS NULL
      AND payload_manifest->>'kind' = 'quiz')
    OR COALESCE((project_id IS NULL AND project_version_id IS NULL
      AND payload_manifest->>'kind'='file'
      AND jsonb_typeof(payload_manifest->'file')='object'
      AND payload_manifest#>>'{file,sha256}'=payload_digest
      AND payload_manifest#>>'{file,id}' ~ '^[a-f0-9-]{36}$'
      AND CASE WHEN jsonb_typeof(payload_manifest->'draftRevision')='number' AND (payload_manifest->>'draftRevision') ~ '^[0-9]{1,10}$' THEN (payload_manifest->>'draftRevision')::bigint BETWEEN 1 AND 2147483646 ELSE false END),false)
    OR COALESCE((project_id IS NULL AND project_version_id IS NULL
      AND payload_manifest->>'kind' = 'essay'
      AND jsonb_typeof(payload_manifest->'text') = 'string'
      AND length(payload_manifest->>'text') BETWEEN 1 AND 40000
      AND payload_manifest->>'textHash' = payload_digest
      AND encode(pg_catalog.sha256(convert_to(payload_manifest->>'text','UTF8')),'hex') = payload_digest
      AND CASE WHEN jsonb_typeof(payload_manifest->'draftRevision')='number'
        AND (payload_manifest->>'draftRevision') ~ '^[0-9]{1,10}$'
        THEN (payload_manifest->>'draftRevision')::bigint BETWEEN 0 AND 2147483646
        ELSE false END),false)
  );

CREATE TABLE public.learning_file_versions (
  tenant_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 255 AND octet_length(name)<=1020),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND CASE
    WHEN content_type='application/pdf' THEN 25000000
    WHEN content_type LIKE 'image/%' THEN 20000000 ELSE 50000000 END),
  content_type varchar(80) NOT NULL CHECK (content_type IN (
    'application/pdf','text/plain','text/csv','image/png','image/jpeg','image/webp',
    'application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/x.scratch.sb3','model/stl')),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,attempt_id,id),
  FOREIGN KEY (tenant_id,attempt_id) REFERENCES public.learning_attempts(tenant_id,id)
);
CREATE TABLE public.learning_file_drafts (
  tenant_id uuid NOT NULL,
  attempt_id uuid PRIMARY KEY,
  revision integer NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 2147483646),
  file_id uuid,
  saved_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,attempt_id) REFERENCES public.learning_attempts(tenant_id,id),
  FOREIGN KEY (tenant_id,attempt_id,file_id) REFERENCES public.learning_file_versions(tenant_id,attempt_id,id)
);
CREATE TABLE public.learning_file_command_receipts (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  actor_principal_id uuid NOT NULL REFERENCES public.principals(id),
  request_id varchar(128) NOT NULL CHECK (request_id ~ '^[A-Za-z0-9._:-]{8,128}$'),
  request_digest varchar(64) NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  activity_run_id uuid NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY(actor_principal_id,request_id),
  FOREIGN KEY(tenant_id,activity_run_id) REFERENCES public.activity_runs(tenant_id,id)
);
CREATE TRIGGER learning_file_versions_immutable BEFORE UPDATE OR DELETE ON public.learning_file_versions
FOR EACH ROW EXECUTE FUNCTION public.learning_immutable_row();
CREATE TRIGGER learning_file_receipts_immutable BEFORE UPDATE OR DELETE ON public.learning_file_command_receipts
FOR EACH ROW EXECUTE FUNCTION public.learning_immutable_row();
DO $$
DECLARE item text;
BEGIN
  FOREACH item IN ARRAY ARRAY['learning_file_versions','learning_file_drafts','learning_file_command_receipts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',item);
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=NULLIF(current_setting(''app.tenant_id'',true),'''')::uuid)',item);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,asalab_app',item);
  END LOOP;
END $$;
CREATE FUNCTION public.learning_response_access_internal(p_actor uuid,p_run uuid,p_kind varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE a record; r record; s record; p record; e jsonb; writable boolean; direct_file_closed boolean;
BEGIN
  SELECT run.*,version.canonical_kind,version.module_key,
    room.status AS room_status,handout.status AS handout_status,
    handout.course_run_id AS handout_course_run_id,course.status AS course_status
    INTO r FROM public.activity_runs run
    JOIN public.learning_activity_versions version ON version.tenant_id=run.tenant_id
      AND version.id=run.learning_activity_version_id
    JOIN public.classrooms room ON room.tenant_id=run.tenant_id AND room.id=run.classroom_id
    JOIN public.classroom_assignments handout ON handout.tenant_id=run.tenant_id
      AND handout.id=run.source_classroom_assignment_id AND handout.classroom_id=run.classroom_id
    LEFT JOIN public.classroom_course_runs course ON course.tenant_id=run.tenant_id
      AND course.id=run.source_course_run_id
    WHERE run.id=p_run FOR SHARE OF run;
  IF r.id IS NULL OR r.canonical_kind IS DISTINCT FROM p_kind OR r.module_key IS NOT NULL THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.tenant_id',r.tenant_id::text,true);
  SELECT actor.* INTO a FROM public.principals actor WHERE actor.id=p_actor FOR SHARE;
  IF a.kind IS NULL OR a.kind NOT IN ('student_seat','account') THEN RETURN NULL; END IF;
  IF a.kind='account' THEN
    PERFORM 1 FROM public.accounts account WHERE account.id=a.account_id
      AND account.status='active' FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  IF (SELECT count(*) FROM public.classroom_student_seats seat
      WHERE seat.tenant_id=r.tenant_id AND seat.classroom_id=r.classroom_id
        AND seat.status='active' AND ((a.kind='student_seat' AND seat.id=a.seat_id)
          OR (a.kind='account' AND seat.account_id=a.account_id))) <> 1 THEN RETURN NULL; END IF;
  SELECT seat.* INTO s FROM public.classroom_student_seats seat
    WHERE seat.tenant_id=r.tenant_id AND seat.classroom_id=r.classroom_id
      AND seat.status='active' AND ((a.kind='student_seat' AND seat.id=a.seat_id)
        OR (a.kind='account' AND seat.account_id=a.account_id)) FOR SHARE;
  -- Lock both links so revocation cannot race a read or command.
  PERFORM 1 FROM public.learner_identity_links link WHERE link.tenant_id=r.tenant_id
    AND link.school_id=r.school_id AND link.status='active'
    AND ((link.link_kind='student_seat' AND link.seat_id=s.id)
      OR (a.kind='account' AND link.link_kind='account' AND link.account_id=a.account_id))
    ORDER BY link.id FOR SHARE;
  -- Course withdrawal takes enrollment before participation. A file command
  -- follows that order after the actor's exact Seat/learner link is established.
  IF p_kind='file' AND r.source_kind='course' THEN
    PERFORM 1 FROM public.course_enrollments enrollment
    JOIN public.activity_participations part ON part.source_course_enrollment_id=enrollment.id
      AND part.tenant_id=enrollment.tenant_id AND part.school_id=enrollment.school_id
      AND part.learner_identity_id=enrollment.learner_identity_id
    JOIN public.learner_identity_links link ON link.tenant_id=part.tenant_id
      AND link.school_id=part.school_id AND link.learner_identity_id=part.learner_identity_id
      AND link.link_kind='student_seat' AND link.seat_id=s.id AND link.status='active'
    WHERE part.activity_run_id=p_run AND enrollment.tenant_id=r.tenant_id
      AND enrollment.school_id=r.school_id AND enrollment.course_run_id=r.source_course_run_id
      AND (a.kind='student_seat' OR EXISTS(SELECT 1 FROM public.learner_identity_links linked
        WHERE linked.tenant_id=part.tenant_id AND linked.school_id=part.school_id
          AND linked.learner_identity_id=part.learner_identity_id
          AND linked.link_kind='account' AND linked.account_id=a.account_id AND linked.status='active'))
    FOR UPDATE OF enrollment;
  END IF;
  SELECT part.* INTO p FROM public.activity_participations part
    JOIN public.learner_identity_links seat_link ON seat_link.tenant_id=part.tenant_id
      AND seat_link.school_id=part.school_id AND seat_link.learner_identity_id=part.learner_identity_id
      AND seat_link.link_kind='student_seat' AND seat_link.seat_id=s.id AND seat_link.status='active'
    WHERE part.tenant_id=r.tenant_id AND part.school_id=r.school_id AND part.activity_run_id=p_run
      AND (a.kind='student_seat' OR EXISTS(SELECT 1 FROM public.learner_identity_links account_link
        WHERE account_link.tenant_id=part.tenant_id AND account_link.school_id=part.school_id
          AND account_link.learner_identity_id=part.learner_identity_id
          AND account_link.link_kind='account' AND account_link.account_id=a.account_id
          AND account_link.status='active')) FOR UPDATE OF part;
  IF p.id IS NULL THEN RETURN NULL; END IF;
  IF r.source_kind='course' THEN
    IF p.source_course_enrollment_id IS NULL
      OR r.handout_course_run_id IS DISTINCT FROM r.source_course_run_id
      OR NOT public.learning_course_seat_visible(s.id,r.source_course_run_id)
      OR NOT EXISTS(SELECT 1 FROM public.classroom_course_run_lessons lesson
        WHERE lesson.tenant_id=r.tenant_id AND lesson.run_id=r.source_course_run_id
          AND lesson.id=r.source_course_lesson_id
          AND r.source_course_block_id IS NOT NULL
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(lesson.blocks) block
            WHERE block->>'id'=r.source_course_block_id AND block->>'type'='activity'
              AND block->'hidden' IS DISTINCT FROM 'true'::jsonb
              AND block->>'learningActivityVersionId'=r.learning_activity_version_id::text))
      THEN RETURN NULL; END IF;
  ELSIF r.source_kind='direct' THEN
    IF NOT public.learning_direct_assignment_seat_visible(s.id,r.source_classroom_assignment_id)
      THEN RETURN NULL; END IF;
  ELSE RETURN NULL; END IF;
  direct_file_closed:=p_kind='file' AND r.source_kind='direct' AND r.handout_status='closed';
  IF direct_file_closed AND (r.room_status<>'active' OR NOT EXISTS(
    SELECT 1 FROM public.learning_attempts attempt
    WHERE attempt.tenant_id=r.tenant_id AND attempt.activity_participation_id=p.id
      AND public.learning_file_submitted_at(attempt.tenant_id,attempt.id) IS NOT NULL
  )) THEN RETURN NULL; END IF;
  e:=public.learning_effective_conditions_internal(p_run,p.id);
  writable:=p.status IN ('assigned','active') AND NOT p.excused
    AND r.lifecycle_status='active' AND r.room_status='active' AND r.handout_status='open'
    AND (r.source_kind<>'course' OR (r.course_status='open' AND EXISTS(
      SELECT 1 FROM public.course_enrollments enrollment
      WHERE enrollment.id=p.source_course_enrollment_id AND enrollment.tenant_id=r.tenant_id
        AND enrollment.school_id=r.school_id AND enrollment.course_run_id=r.source_course_run_id
        AND enrollment.learner_identity_id=p.learner_identity_id
        AND enrollment.status IN ('assigned','active'))))
    AND e IS NOT NULL
    AND ((e#>>'{values,opensAt}')::timestamptz IS NULL OR (e#>>'{values,opensAt}')::timestamptz<=now())
    AND ((e#>>'{values,closesAt}')::timestamptz IS NULL OR (e#>>'{values,closesAt}')::timestamptz>=now())
    AND NOT (COALESCE((e#>>'{values,dueAt}')::timestamptz<now(),false)
      AND e#>>'{values,latePolicy}'='block_at_due' AND NOT p.teacher_unlocked);
  RETURN jsonb_build_object('tenantId',r.tenant_id,'schoolId',r.school_id,
    'classroomId',r.classroom_id,'assignmentId',r.source_classroom_assignment_id,
    'activityRunId',r.id,'versionId',r.learning_activity_version_id,'participationId',p.id,
    'learnerId',p.learner_identity_id,'seatId',s.id,'enrollmentId',p.source_course_enrollment_id,
    'writable',COALESCE(writable,false),'effective',e,'extraAttempts',p.extra_attempts,
    'directFileClosed',direct_file_closed);
END;
$$;
CREATE OR REPLACE FUNCTION public.learning_essay_access(p_actor uuid,p_run uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT public.learning_response_access_internal(p_actor,p_run,'essay');
$$;
REVOKE ALL ON FUNCTION public.learning_essay_access(uuid,uuid) FROM PUBLIC,asalab_app;
CREATE OR REPLACE FUNCTION public.learning_file_access(p_actor uuid,p_run uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT public.learning_response_access_internal(p_actor,p_run,'file');
$$;
REVOKE ALL ON FUNCTION public.learning_file_access(uuid,uuid) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.learning_response_access_internal(uuid,uuid,varchar) FROM PUBLIC,asalab_app;

CREATE FUNCTION public.learning_file_descriptor(p_file public.learning_file_versions)
RETURNS jsonb LANGUAGE sql STABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object('id',p_file.id,'name',p_file.name,'sizeBytes',p_file.size_bytes,
    'contentType',p_file.content_type,'sha256',p_file.sha256);
$$;
REVOKE ALL ON FUNCTION public.learning_file_descriptor(public.learning_file_versions) FROM PUBLIC,asalab_app;
CREATE FUNCTION public.learning_file_submitted_at(p_tenant uuid,p_attempt uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT attempt.submitted_at
  FROM public.learning_attempts attempt
  JOIN public.learning_submissions submission ON submission.tenant_id=attempt.tenant_id
    AND submission.attempt_id=attempt.id AND submission.payload_manifest->>'kind'='file'
  JOIN public.learning_file_versions file ON file.tenant_id=attempt.tenant_id AND file.attempt_id=attempt.id
    AND file.id::text=submission.payload_manifest#>>'{file,id}'
    AND submission.payload_manifest->'file'=public.learning_file_descriptor(file)
    AND submission.payload_digest=file.sha256
  WHERE attempt.tenant_id=p_tenant AND attempt.id=p_attempt;
$$;
REVOKE ALL ON FUNCTION public.learning_file_submitted_at(uuid,uuid) FROM PUBLIC,asalab_app;

CREATE FUNCTION public.learning_file_attempt_read(p_actor uuid,p_run uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE scope jsonb; current_attempt record; version record; response jsonb; content_visible boolean; task_blocks jsonb;
BEGIN
  scope:=public.learning_file_access(p_actor,p_run);
  IF scope IS NULL THEN RETURN jsonb_build_object('resultCode','forbidden'); END IF;
  content_visible:=(scope#>>'{effective,values,opensAt}')::timestamptz IS NULL
    OR (scope#>>'{effective,values,opensAt}')::timestamptz<=now();
  SELECT * INTO version FROM public.learning_activity_versions WHERE id=(scope->>'versionId')::uuid;
  IF content_visible THEN
    SELECT COALESCE(jsonb_agg(CASE WHEN entry.value->>'type' IN ('image','file')
      THEN entry.value||jsonb_build_object('src','/api/learning/file/runs/'||p_run::text||
        '/media/'||(entry.value->>'type')||'/'||(entry.value->>'contentHash'))
      ELSE entry.value END ORDER BY entry.position),'[]'::jsonb) INTO task_blocks
    FROM jsonb_array_elements(CASE WHEN version.blocks_snapshot_present THEN version.blocks
      ELSE public.learning_activity_task_blocks(NULL,version.instructions) END)
      WITH ORDINALITY AS entry(value,position);
  END IF;
  SELECT attempt.*,draft.revision,public.learning_file_descriptor(f) AS file,draft.saved_at,
    submission.id AS submission_id,submission.payload_digest,
    review.review_decision,review.feedback
    INTO current_attempt FROM public.learning_attempts attempt
    JOIN public.learning_file_drafts draft ON draft.attempt_id=attempt.id AND draft.tenant_id=attempt.tenant_id
    LEFT JOIN public.learning_file_versions f ON f.tenant_id=draft.tenant_id AND f.attempt_id=draft.attempt_id AND f.id=draft.file_id
    LEFT JOIN public.learning_submissions submission ON submission.attempt_id=attempt.id
      AND submission.tenant_id=attempt.tenant_id
    LEFT JOIN LATERAL(SELECT result.review_decision,result.feedback
      FROM public.assessment_results result WHERE result.attempt_id=attempt.id AND result.tenant_id=attempt.tenant_id
      ORDER BY result.revision_number DESC LIMIT 1) review ON true
    WHERE attempt.activity_participation_id=(scope->>'participationId')::uuid
      AND attempt.tenant_id=(scope->>'tenantId')::uuid
      AND (NOT(scope->>'directFileClosed')::boolean OR
        public.learning_file_submitted_at(attempt.tenant_id,attempt.id) IS NOT NULL)
    ORDER BY attempt.attempt_number DESC LIMIT 1;
  response:=jsonb_build_object('resultCode','ok','activityRunId',p_run,
    'participationId',scope->'participationId','activityVersionId',version.id,
    'title',version.title,
    'instructions',CASE WHEN content_visible THEN version.instructions END,
    'goal',CASE WHEN content_visible THEN version.goal END,
    'blocks',task_blocks,
    'resultMode',version.result_mode,'maxPoints',version.max_points,
    'canStart',(scope->>'writable')::boolean AND (current_attempt.id IS NULL
      OR (current_attempt.state='closed' AND current_attempt.review_decision='changes_requested')),
    'canEdit',COALESCE((scope->>'writable')::boolean AND current_attempt.state='in_progress',false),
    'attempt',CASE WHEN current_attempt.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',current_attempt.id,'number',current_attempt.attempt_number,'state',current_attempt.state,
      'revisionOfAttemptId',current_attempt.revision_of_attempt_id,'revision',current_attempt.revision,
      'file',current_attempt.file,'savedAt',current_attempt.saved_at,
      'submittedAt',current_attempt.submitted_at,'submissionId',current_attempt.submission_id,
      'digest',current_attempt.payload_digest,'reviewDecision',current_attempt.review_decision,
      'feedback',current_attempt.feedback) END);
  RETURN response;
END;
$$;
CREATE FUNCTION public.learning_file_receipt_view(p_scope jsonb,p_response jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT p_response || jsonb_build_object('canStart',false,'canEdit',
    (p_scope->>'writable')::boolean AND EXISTS(SELECT 1 FROM public.learning_attempts attempt
      WHERE attempt.id=(p_response#>>'{attempt,id}')::uuid
        AND attempt.tenant_id=(p_scope->>'tenantId')::uuid
        AND attempt.activity_participation_id=(p_scope->>'participationId')::uuid
        AND attempt.state='in_progress')) || CASE
      WHEN (p_scope#>>'{effective,values,opensAt}')::timestamptz>now()
      THEN jsonb_build_object('instructions',NULL,'goal',NULL,'blocks',NULL)
      ELSE '{}'::jsonb END;
$$;
CREATE FUNCTION public.learning_file_attempt_start(p_actor uuid,p_run uuid,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE scope jsonb; prior record; receipt record; activation record;
  fingerprint varchar; next_number bigint; limit_count bigint; attempt_id uuid; response jsonb;
BEGIN
  IF p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    RETURN jsonb_build_object('resultCode','invalid_request'); END IF;
  scope:=public.learning_file_access(p_actor,p_run);
  IF scope IS NULL THEN RETURN jsonb_build_object('resultCode','forbidden'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_request,302));
  fingerprint:=encode(pg_catalog.sha256(convert_to(jsonb_build_array('start',p_run)::text,'UTF8')),'hex');
  SELECT * INTO receipt FROM public.learning_file_command_receipts
    WHERE actor_principal_id=p_actor AND request_id=p_request;
  IF receipt.request_digest IS NOT NULL THEN
    IF receipt.request_digest<>fingerprint THEN RETURN jsonb_build_object('resultCode','request_conflict'); END IF;
    RETURN public.learning_file_receipt_view(scope,receipt.response);
  END IF;
  IF NOT (scope->>'writable')::boolean THEN RETURN jsonb_build_object('resultCode','not_available'); END IF;
  SELECT attempt.*,review.review_decision INTO prior
    FROM public.learning_attempts attempt
    JOIN public.learning_file_drafts draft ON draft.attempt_id=attempt.id
    LEFT JOIN LATERAL(SELECT result.review_decision FROM public.assessment_results result
      WHERE result.attempt_id=attempt.id ORDER BY result.revision_number DESC LIMIT 1) review ON true
    WHERE attempt.activity_participation_id=(scope->>'participationId')::uuid
    ORDER BY attempt.attempt_number DESC LIMIT 1 FOR UPDATE OF attempt;
  IF prior.id IS NOT NULL AND prior.state<>'in_progress'
    AND NOT(prior.state='closed' AND prior.review_decision='changes_requested') THEN
    RETURN jsonb_build_object('resultCode','not_available'); END IF;
  IF prior.id IS NULL OR prior.state='closed' THEN
    SELECT COALESCE(max(attempt.attempt_number),0)::bigint+1 INTO next_number
      FROM public.learning_attempts attempt WHERE attempt.activity_participation_id=(scope->>'participationId')::uuid;
    limit_count:=COALESCE((scope#>>'{effective,values,attemptLimit}')::bigint,1)+(scope->>'extraAttempts')::bigint;
    IF next_number>limit_count OR next_number>2147483647 THEN
      RETURN jsonb_build_object('resultCode','attempt_limit_reached'); END IF;
    IF scope->>'enrollmentId' IS NOT NULL THEN
      SELECT * INTO activation FROM public.course_enrollment_activate(p_actor,(scope->>'enrollmentId')::uuid);
      IF activation.result_code<>'ok' THEN RETURN jsonb_build_object('resultCode','not_available'); END IF;
    END IF;
    SELECT * INTO activation FROM public.activity_participation_activate(p_actor,(scope->>'participationId')::uuid);
    IF activation.result_code<>'ok' THEN RETURN jsonb_build_object('resultCode','not_available'); END IF;
    INSERT INTO public.learning_attempts(tenant_id,classroom_id,classroom_assignment_id,
      learning_activity_version_id,seat_id,learner_identity_id,activity_participation_id,
      attempt_number,state,revision_of_attempt_id,effective_conditions_at_start)
    VALUES((scope->>'tenantId')::uuid,(scope->>'classroomId')::uuid,(scope->>'assignmentId')::uuid,
      (scope->>'versionId')::uuid,(scope->>'seatId')::uuid,(scope->>'learnerId')::uuid,
      (scope->>'participationId')::uuid,next_number::integer,'in_progress',prior.id,scope->'effective')
    RETURNING id INTO attempt_id;
    INSERT INTO public.learning_file_drafts(tenant_id,attempt_id)
      VALUES((scope->>'tenantId')::uuid,attempt_id);
  END IF;
  response:=public.learning_file_attempt_read(p_actor,p_run);
  INSERT INTO public.learning_file_command_receipts VALUES(
    (scope->>'tenantId')::uuid,p_actor,p_request,fingerprint,p_run,response);
  RETURN response;
END;
$$;
CREATE FUNCTION public.learning_file_draft_save(p_actor uuid,p_run uuid,p_attempt uuid,
  p_expected integer,p_name text,p_size integer,p_type varchar,p_sha varchar,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE scope jsonb; attempt record; draft record; receipt record; fingerprint varchar; response jsonb; new_file uuid;
BEGIN
  IF p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' OR p_expected IS NULL
    OR p_expected<0 OR p_expected>=2147483646 OR p_name IS NULL OR p_size IS NULL OR p_type IS NULL OR p_sha IS NULL THEN RETURN jsonb_build_object('resultCode','invalid_request'); END IF;
  scope:=public.learning_file_access(p_actor,p_run);
  IF scope IS NULL THEN RETURN jsonb_build_object('resultCode','forbidden'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_request,302));
  fingerprint:=encode(pg_catalog.sha256(convert_to(jsonb_build_array('save',p_run,p_attempt,p_expected,p_name,p_size,p_type,p_sha)::text,'UTF8')),'hex');
  SELECT * INTO receipt FROM public.learning_file_command_receipts
    WHERE actor_principal_id=p_actor AND request_id=p_request;
  IF receipt.request_digest IS NOT NULL THEN
    IF receipt.request_digest<>fingerprint THEN RETURN jsonb_build_object('resultCode','request_conflict'); END IF;
    RETURN public.learning_file_receipt_view(scope,receipt.response);
  END IF;
  SELECT * INTO attempt FROM public.learning_attempts item WHERE item.id=p_attempt
    AND item.activity_participation_id=(scope->>'participationId')::uuid
    AND item.tenant_id=(scope->>'tenantId')::uuid FOR UPDATE;
  IF attempt.id IS NULL THEN RETURN jsonb_build_object('resultCode','forbidden'); END IF;
  IF NOT(scope->>'writable')::boolean OR attempt.state<>'in_progress' THEN
    RETURN jsonb_build_object('resultCode','not_available'); END IF;
  SELECT * INTO draft FROM public.learning_file_drafts item WHERE item.attempt_id=p_attempt FOR UPDATE;
  IF draft.revision IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('resultCode','draft_revision_conflict'); END IF;
  INSERT INTO public.learning_file_versions(tenant_id,attempt_id,name,size_bytes,content_type,sha256)
  VALUES((scope->>'tenantId')::uuid,p_attempt,p_name,p_size,p_type,p_sha) RETURNING id INTO new_file;
  UPDATE public.learning_file_drafts SET file_id=new_file,revision=revision+1,saved_at=clock_timestamp()
    WHERE attempt_id=p_attempt;
  response:=public.learning_file_attempt_read(p_actor,p_run);
  INSERT INTO public.learning_file_command_receipts VALUES(
    (scope->>'tenantId')::uuid,p_actor,p_request,fingerprint,p_run,response);
  RETURN response;
END;
$$;
CREATE FUNCTION public.learning_file_submission_create(p_actor uuid,p_run uuid,p_attempt uuid,
  p_expected integer,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE scope jsonb; attempt record; draft record; receipt record; fingerprint varchar;
  file_descriptor jsonb; late_state varchar; response jsonb;
BEGIN
  IF p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' OR p_expected IS NULL
    OR p_expected<0 THEN RETURN jsonb_build_object('resultCode','invalid_request'); END IF;
  scope:=public.learning_file_access(p_actor,p_run);
  IF scope IS NULL THEN RETURN jsonb_build_object('resultCode','forbidden'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||':'||p_request,302));
  fingerprint:=encode(pg_catalog.sha256(convert_to(jsonb_build_array('submit',p_run,p_attempt,p_expected)::text,'UTF8')),'hex');
  SELECT * INTO receipt FROM public.learning_file_command_receipts
    WHERE actor_principal_id=p_actor AND request_id=p_request;
  IF receipt.request_digest IS NOT NULL THEN
    IF receipt.request_digest<>fingerprint THEN RETURN jsonb_build_object('resultCode','request_conflict'); END IF;
    RETURN public.learning_file_receipt_view(scope,receipt.response);
  END IF;
  SELECT * INTO attempt FROM public.learning_attempts item WHERE item.id=p_attempt
    AND item.activity_participation_id=(scope->>'participationId')::uuid
    AND item.tenant_id=(scope->>'tenantId')::uuid FOR UPDATE;
  IF attempt.id IS NULL THEN RETURN jsonb_build_object('resultCode','forbidden'); END IF;
  IF NOT(scope->>'writable')::boolean OR attempt.state<>'in_progress' THEN
    RETURN jsonb_build_object('resultCode','not_available'); END IF;
  SELECT * INTO draft FROM public.learning_file_drafts item WHERE item.attempt_id=p_attempt FOR UPDATE;
  IF draft.revision IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('resultCode','draft_revision_conflict'); END IF;
  IF draft.file_id IS NULL THEN RETURN jsonb_build_object('resultCode','response_required'); END IF;
  IF EXISTS(SELECT 1 FROM public.learning_submissions WHERE tenant_id=(scope->>'tenantId')::uuid
    AND client_request_id=p_request) THEN RETURN jsonb_build_object('resultCode','request_conflict'); END IF;
  SELECT public.learning_file_descriptor(file) INTO file_descriptor
    FROM public.learning_file_versions file
    WHERE file.tenant_id=draft.tenant_id AND file.attempt_id=p_attempt AND file.id=draft.file_id;
  late_state:=CASE WHEN (scope#>>'{effective,values,dueAt}')::timestamptz<now() THEN 'late' ELSE 'on_time' END;
  INSERT INTO public.learning_submissions(tenant_id,attempt_id,project_id,project_version_id,
    payload_manifest,payload_digest,client_request_id,late_state)
  VALUES((scope->>'tenantId')::uuid,p_attempt,NULL,NULL,jsonb_build_object('kind','file',
    'file',file_descriptor,'draftRevision',draft.revision),file_descriptor->>'sha256',p_request,late_state);
  UPDATE public.learning_attempts SET state='submitted',submitted_at=now() WHERE id=p_attempt;
  response:=public.learning_file_attempt_read(p_actor,p_run);
  INSERT INTO public.learning_file_command_receipts VALUES(
    (scope->>'tenantId')::uuid,p_actor,p_request,fingerprint,p_run,response);
  RETURN response;
END;
$$;
CREATE FUNCTION public.learning_file_media_read(p_actor uuid,p_run uuid,p_role varchar,p_hash varchar)
RETURNS TABLE(media_bytes bytea,content_type varchar)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE scope jsonb;
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('image','file') OR p_hash IS NULL
    OR p_hash !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
  scope:=public.learning_file_access(p_actor,p_run);
  IF scope IS NULL OR (scope#>>'{effective,values,opensAt}')::timestamptz>now() THEN RETURN; END IF;
  RETURN QUERY SELECT media.bytes,media.content_type::varchar
    FROM public.learning_activity_version_media media
    JOIN public.learning_activity_versions version ON version.id=media.activity_version_id
      AND version.tenant_id=media.tenant_id AND version.canonical_kind='file'
    WHERE media.tenant_id=(scope->>'tenantId')::uuid AND version.id=(scope->>'versionId')::uuid
      AND media.role=CASE WHEN p_role='image' THEN 'task-image' ELSE 'task-file' END
      AND media.content_hash=p_hash AND version.blocks_snapshot_present
      AND version.blocks @> jsonb_build_array(jsonb_build_object('type',p_role,'contentHash',p_hash));
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
           OR NOT ((v_kind IN('essay','quiz','file') AND v_module_key IS NULL)
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
           OR (pin.pin_kind='project' AND version.canonical_kind IN('essay','quiz','file') AND version.module_key IS NULL))
         AND version.published_at IS NOT NULL
         AND jsonb_typeof(version.policy_snapshot) = 'object'
    ) exact ON true
   ORDER BY pin.pointer;
$$;
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
    IF p_kind IN ('essay','file') AND (v_module IS NOT NULL
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
            WHEN file_version.id IS NOT NULL THEN 'file'
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
      LEFT JOIN public.learning_activity_versions file_version
        ON file_version.tenant_id=run.tenant_id AND file_version.id=run.learning_activity_version_id
       AND file_version.canonical_kind='file' AND file_version.module_key IS NULL
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
             AND (file_version.id IS NULL OR (
               current_attempt.tenant_id=run.tenant_id
               AND current_attempt.activity_participation_id=participation.id
               AND (run.source_kind<>'direct' OR assignment.status<>'closed' OR
                 public.learning_file_submitted_at(current_attempt.tenant_id,current_attempt.id) IS NOT NULL)
             ))
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
       AND essay_attempt.tenant_id=v_access.tenant_id AND essay_version.canonical_kind IN('essay','quiz','file')
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
       AND ((version.canonical_kind='file' AND version.module_key IS NULL
         AND EXISTS(SELECT 1 FROM public.learning_file_drafts file
           WHERE file.attempt_id=p_attempt_id AND file.tenant_id=part.tenant_id)) OR (version.canonical_kind='quiz' AND version.module_key IS NULL AND EXISTS(SELECT 1 FROM public.quiz_attempt_states quiz WHERE quiz.attempt_id=p_attempt_id AND quiz.tenant_id=v_attempt.tenant_id)) OR (version.canonical_kind='essay' AND version.module_key IS NULL
         AND EXISTS(SELECT 1 FROM public.learning_essay_drafts essay
           WHERE essay.attempt_id=p_attempt_id AND essay.tenant_id=part.tenant_id)) OR
         (version.canonical_kind NOT IN('essay','quiz','file')
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
       AND (version.canonical_kind='project' OR (version.canonical_kind='file' AND version.module_key IS NULL) OR (version.canonical_kind='quiz' AND version.module_key IS NULL AND version.quiz_version_id IS NOT NULL))
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
       AND (version.canonical_kind='project' OR (version.canonical_kind='file' AND version.module_key IS NULL) OR (version.canonical_kind='quiz' AND version.module_key IS NULL AND version.quiz_version_id IS NOT NULL))
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

CREATE FUNCTION public.learning_file_upload_scope(p_actor uuid,p_run uuid,p_attempt uuid,
  p_expected integer,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE scope jsonb; attempt record; draft_revision integer;
BEGIN
  scope:=public.learning_file_access(p_actor,p_run);
  IF scope IS NULL THEN RETURN jsonb_build_object('resultCode','forbidden'); END IF;
  SELECT item.id,item.state INTO attempt FROM public.learning_attempts item
  WHERE item.id=p_attempt AND item.activity_participation_id=(scope->>'participationId')::uuid
    AND item.tenant_id=(scope->>'tenantId')::uuid FOR UPDATE;
  IF attempt.id IS NULL THEN RETURN jsonb_build_object('resultCode','forbidden'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.learning_file_command_receipts receipt
    WHERE receipt.actor_principal_id=p_actor AND receipt.request_id=p_request
      AND receipt.activity_run_id=p_run AND receipt.tenant_id=(scope->>'tenantId')::uuid) THEN
    IF NOT(scope->>'writable')::boolean OR attempt.state<>'in_progress' THEN
      RETURN jsonb_build_object('resultCode','not_available'); END IF;
    SELECT revision INTO draft_revision FROM public.learning_file_drafts WHERE attempt_id=p_attempt;
    IF draft_revision IS DISTINCT FROM p_expected THEN
      RETURN jsonb_build_object('resultCode','draft_revision_conflict'); END IF;
  END IF;
  RETURN jsonb_build_object('resultCode','ok','tenantId',scope->>'tenantId');
END;
$$;

CREATE FUNCTION public.learning_teacher_exact_file_submission(p_account uuid,p_class uuid,p_attempt uuid)
RETURNS TABLE(submission_id uuid,payload_digest varchar,file_descriptor jsonb,draft_revision integer,tenant_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE authorized_tenant uuid;
BEGIN
  SELECT access.tenant_id INTO authorized_tenant
  FROM public.classroom_teacher_access(p_account,p_class) access;
  IF authorized_tenant IS NULL THEN RETURN; END IF;
  PERFORM set_config('app.tenant_id',authorized_tenant::text,true);
  RETURN QUERY SELECT submission.id,submission.payload_digest,public.learning_file_descriptor(file),
    (submission.payload_manifest->>'draftRevision')::integer,attempt.tenant_id
  FROM public.learning_attempts attempt
  JOIN public.learning_submissions submission ON submission.attempt_id=attempt.id
    AND submission.tenant_id=attempt.tenant_id
  JOIN public.activity_participations participation ON participation.id=attempt.activity_participation_id
    AND participation.tenant_id=attempt.tenant_id
    AND participation.learner_identity_id=attempt.learner_identity_id
  JOIN public.activity_runs run ON run.id=participation.activity_run_id
    AND run.tenant_id=attempt.tenant_id AND run.classroom_id=attempt.classroom_id
    AND run.learning_activity_version_id=attempt.learning_activity_version_id
  JOIN public.learning_activity_versions version ON version.id=run.learning_activity_version_id
    AND version.tenant_id=run.tenant_id AND version.canonical_kind='file' AND version.module_key IS NULL
  JOIN public.learning_file_versions file ON file.tenant_id=attempt.tenant_id AND file.attempt_id=attempt.id
    AND file.id::text=submission.payload_manifest#>>'{file,id}'
  WHERE attempt.id=p_attempt AND attempt.classroom_id=p_class AND attempt.tenant_id=authorized_tenant
    AND submission.payload_manifest->>'kind'='file'
    AND submission.payload_manifest->'file'=public.learning_file_descriptor(file)
    AND submission.payload_digest=file.sha256;
END;
$$;

CREATE FUNCTION public.learning_file_download(p_actor uuid,p_run uuid,p_file uuid)
RETURNS TABLE(tenant_id uuid,attempt_id uuid,file_descriptor jsonb)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE scope jsonb;
BEGIN
  scope:=public.learning_file_access(p_actor,p_run);
  IF scope IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT file.tenant_id,file.attempt_id,public.learning_file_descriptor(file)
  FROM public.learning_attempts attempt
  JOIN public.learning_file_versions file ON file.tenant_id=attempt.tenant_id AND file.attempt_id=attempt.id
  WHERE attempt.tenant_id=(scope->>'tenantId')::uuid
    AND attempt.activity_participation_id=(scope->>'participationId')::uuid AND file.id=p_file
    AND ((NOT(scope->>'directFileClosed')::boolean AND EXISTS(
      SELECT 1 FROM public.learning_file_drafts draft WHERE draft.attempt_id=attempt.id
        AND draft.tenant_id=attempt.tenant_id AND draft.file_id=file.id))
      OR EXISTS(SELECT 1 FROM public.learning_submissions submission WHERE submission.attempt_id=attempt.id
        AND submission.tenant_id=attempt.tenant_id AND submission.payload_manifest->>'kind'='file'
        AND submission.payload_manifest->'file'=public.learning_file_descriptor(file)
        AND submission.payload_digest=file.sha256));
END;
$$;

CREATE FUNCTION public.learning_file_assignment_view(p_actor uuid,p_assignment uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE run_id uuid; run_count integer; scope jsonb; submitted_at timestamptz;
BEGIN
  SELECT count(*),(array_agg(run.id))[1] INTO run_count,run_id FROM public.activity_runs run
  JOIN public.learning_activity_versions version ON version.tenant_id=run.tenant_id
    AND version.id=run.learning_activity_version_id AND version.canonical_kind='file'
    AND version.module_key IS NULL
  WHERE run.source_kind='direct' AND run.source_classroom_assignment_id=p_assignment;
  IF run_count=0 THEN RETURN NULL; END IF;
  IF run_count<>1 THEN RETURN '{}'::jsonb; END IF;
  scope:=public.learning_file_access(p_actor,run_id);
  IF scope IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT max(public.learning_file_submitted_at(attempt.tenant_id,attempt.id)) INTO submitted_at
    FROM public.learning_attempts attempt WHERE attempt.tenant_id=(scope->>'tenantId')::uuid
      AND attempt.activity_participation_id=(scope->>'participationId')::uuid;
  RETURN jsonb_build_object('activityRunId',run_id,'submittedAt',submitted_at);
END;
$$;

CREATE FUNCTION public.learning_file_assignment_kind(p_actor uuid,p_assignment uuid) RETURNS varchar
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT CASE WHEN public.learning_file_assignment_view(p_actor,p_assignment) ? 'activityRunId'
    THEN 'file'::varchar END;
$$;

REVOKE ALL ON FUNCTION public.learning_file_assignment_view(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_file_assignment_view(uuid,uuid) TO asalab_app;

REVOKE ALL ON FUNCTION public.learning_response_access_internal(uuid,uuid,varchar),
  public.learning_file_access(uuid,uuid), public.learning_file_descriptor(public.learning_file_versions),
  public.learning_file_receipt_view(jsonb,jsonb) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.learning_file_attempt_read(uuid,uuid),
  public.learning_file_attempt_start(uuid,uuid,varchar),
  public.learning_file_upload_scope(uuid,uuid,uuid,integer,varchar),
  public.learning_file_draft_save(uuid,uuid,uuid,integer,text,integer,varchar,varchar,varchar),
  public.learning_file_submission_create(uuid,uuid,uuid,integer,varchar),
  public.learning_file_media_read(uuid,uuid,varchar,varchar),
  public.learning_teacher_exact_file_submission(uuid,uuid,uuid),
  public.learning_file_download(uuid,uuid,uuid),public.learning_file_assignment_kind(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_file_attempt_read(uuid,uuid),
  public.learning_file_attempt_start(uuid,uuid,varchar),
  public.learning_file_upload_scope(uuid,uuid,uuid,integer,varchar),
  public.learning_file_draft_save(uuid,uuid,uuid,integer,text,integer,varchar,varchar,varchar),
  public.learning_file_submission_create(uuid,uuid,uuid,integer,varchar),
  public.learning_file_media_read(uuid,uuid,varchar,varchar),
  public.learning_teacher_exact_file_submission(uuid,uuid,uuid),
  public.learning_file_download(uuid,uuid,uuid),public.learning_file_assignment_kind(uuid,uuid) TO asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_assignments_for_seat(p_seat_id uuid)
 RETURNS TABLE(
    id uuid,
    title character varying,
    brief character varying,
    goal character varying,
    module_key character varying,
    due_at timestamp with time zone,
    status character varying,
    sample_image character varying,
    project_id uuid,
    submitted_at timestamp with time zone,
    snapshot_revision integer,
    updated_at timestamp with time zone
 )
 LANGUAGE sql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
    SELECT h.id,
           COALESCE(lv.title,t.title),
           COALESCE(lv.instructions,t.brief),
           CASE
             WHEN lv.goal_snapshot_present THEN
               CASE
                 WHEN w.project_id IS NOT NULL THEN lv.goal
                 WHEN EXISTS (
                   SELECT 1
                     FROM public.activity_runs runtime
                     JOIN public.classrooms classroom
                       ON classroom.tenant_id = runtime.tenant_id
                      AND classroom.id = runtime.classroom_id
                      AND classroom.status = 'active'
                     JOIN public.learner_identity_links link
                       ON link.tenant_id = runtime.tenant_id
                      AND link.school_id = runtime.school_id
                      AND link.seat_id = s.id
                      AND link.link_kind = 'student_seat'
                      AND link.status = 'active'
                     JOIN public.activity_participations participation
                       ON participation.tenant_id = runtime.tenant_id
                      AND participation.school_id = runtime.school_id
                      AND participation.activity_run_id = runtime.id
                      AND participation.learner_identity_id = link.learner_identity_id
                    WHERE runtime.tenant_id = h.tenant_id
                      AND runtime.source_classroom_assignment_id = h.id
                      AND runtime.learning_activity_version_id = lv.id
                      AND runtime.lifecycle_status = 'active'
                      AND h.status = 'open'
                      AND participation.status IN ('assigned', 'active')
                      AND (
                        (runtime.source_kind = 'direct'
                         AND public.learning_direct_assignment_seat_visible(s.id, h.id))
                        OR (runtime.source_kind = 'course'
                            AND public.learning_course_seat_visible(s.id, runtime.source_course_run_id)
                            AND EXISTS (
                              SELECT 1 FROM public.classroom_course_runs course
                               WHERE course.id = runtime.source_course_run_id
                                 AND course.tenant_id = runtime.tenant_id
                                 AND course.status = 'open'
                            )
                            AND (participation.source_course_enrollment_id IS NULL OR EXISTS (
                              SELECT 1 FROM public.course_enrollments enrollment
                               WHERE enrollment.id = participation.source_course_enrollment_id
                                 AND enrollment.tenant_id = runtime.tenant_id
                                 AND enrollment.school_id = runtime.school_id
                                 AND enrollment.status IN ('assigned', 'active')
                            )))
                      )
                      AND COALESCE((
                        public.learning_effective_conditions_internal(
                          runtime.id, participation.id
                        ) #>> '{values,opensAt}'
                      )::timestamptz, '-infinity'::timestamptz) <= now()
                 ) THEN lv.goal
                 ELSE NULL
               END
             ELSE t.goal
           END,
           COALESCE(lv.module_key,t.module_key),
           h.due_at,
           h.status,
           CASE
             WHEN h.learning_activity_version_id IS NOT NULL THEN
               CASE WHEN EXISTS (
                   SELECT 1
                     FROM public.learning_activity_version_media media
                    WHERE media.tenant_id = h.tenant_id
                      AND media.activity_version_id = h.learning_activity_version_id
                      AND media.role = 'sample'
               ) THEN (
                   '/api/assignments/activity-versions/'
                   || h.learning_activity_version_id::text
                   || '/sample'
               )::varchar ELSE NULL::varchar END
             ELSE t.sample_image
           END,
           w.project_id,
           w.submitted_at,
           snapshot.source_revision,
           draft.updated_at
      FROM public.classroom_student_seats s
      JOIN public.classroom_assignments h
        ON h.tenant_id = s.tenant_id AND h.classroom_id = s.classroom_id
      LEFT JOIN public.teacher_assignments t ON t.id = h.assignment_id
      LEFT JOIN public.learning_activity_versions lv ON lv.id = h.learning_activity_version_id
      LEFT JOIN public.classroom_assignment_work w
        ON w.assignment_id = h.id AND w.seat_id = s.id
      LEFT JOIN public.project_drafts draft ON draft.project_id = w.project_id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = w.project_id
     WHERE (t.id IS NOT NULL OR lv.id IS NOT NULL)
       AND s.id = p_seat_id
       AND s.status = 'active'
       AND (h.status = 'open' OR w.project_id IS NOT NULL OR
         CASE WHEN lv.canonical_kind='file' THEN
           public.learning_file_assignment_view(public.principal_for_seat(s.id),h.id) ? 'activityRunId'
         ELSE false END OR EXISTS (
           SELECT 1 FROM public.learning_project_origins origin
           JOIN public.activity_runs run
             ON run.id = origin.activity_run_id
            AND run.tenant_id = origin.school_tenant_id
            AND run.source_kind = 'direct'
            AND run.source_classroom_assignment_id = h.id
           JOIN public.learner_identity_links link
             ON link.tenant_id = origin.school_tenant_id
            AND link.school_id = origin.school_id
            AND link.learner_identity_id = origin.learner_identity_id
            AND link.link_kind = 'student_seat'
            AND link.seat_id = s.id
            AND link.status = 'active'
          WHERE origin.school_tenant_id = h.tenant_id
            AND run.classroom_id = s.classroom_id
       ))
     ORDER BY (w.submitted_at IS NOT NULL), h.created_at;
$function$;
CREATE OR REPLACE FUNCTION public.classroom_assignments_for_account(p_account_id uuid)
 RETURNS TABLE(id uuid, seat_id uuid, classroom_title character varying, title character varying, brief character varying, goal character varying, module_key character varying, due_at timestamp with time zone, status character varying, sample_image character varying, project_id uuid, submitted_at timestamp with time zone, snapshot_revision integer, updated_at timestamp with time zone)
 LANGUAGE sql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
    SELECT work.id, s.id, c.title, work.title, work.brief, work.goal, work.module_key,
           work.due_at, work.status, work.sample_image, work.project_id, work.submitted_at,
           work.snapshot_revision, work.updated_at
      FROM public.classroom_student_seats s
      JOIN public.classrooms c ON c.id = s.classroom_id
      CROSS JOIN LATERAL public.classroom_assignments_for_seat(s.id) work
     WHERE s.account_id = p_account_id
       AND s.status = 'active'
       AND c.status = 'active'
       AND (work.status='open' OR COALESCE(
         public.learning_file_assignment_view(
           (SELECT principal.id FROM public.principals principal
             WHERE principal.account_id=p_account_id AND principal.kind='account'),
           work.id
         ) ? 'activityRunId',true)
       );
$function$;
