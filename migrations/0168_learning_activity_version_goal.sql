-- A2b: immutable authored goal and exact learner delivery.
-- Historical versions keep their original digest and an explicit legacy fallback.
ALTER TABLE learning_activity_versions
    ADD COLUMN goal varchar(160),
    ADD COLUMN goal_snapshot_present boolean NOT NULL DEFAULT false;
ALTER TABLE learning_activity_versions
    ADD CONSTRAINT learning_activity_versions_goal_snapshot_check
    CHECK (NOT goal_snapshot_present OR canonical_contract_version = 1);

-- The JSONB overload distinguishes an omitted goal (SQL NULL) from an
-- explicitly cleared goal (JSON null). Keep the old signatures below.
CREATE OR REPLACE FUNCTION learning_activity_create(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_scope_kind varchar,
    p_visibility_policy varchar,
    p_kind varchar,
    p_title varchar,
    p_instructions varchar,
    p_result_mode varchar,
    p_max_points integer,
    p_policy_snapshot jsonb,
    p_module_key varchar,
    p_quiz_version_id uuid,
    p_starter_project_version_id uuid,
    p_source_teacher_assignment_id uuid,
    p_request_id varchar,
    p_goal jsonb
)
RETURNS TABLE (result_code varchar, activity_id uuid, draft_revision integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_normalized record; v_id uuid; v_existing record;
        v_request_snapshot jsonb; v_request_digest varchar;
BEGIN
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request_id'::varchar, NULL::uuid, NULL::integer;
        RETURN;
    END IF;
    IF p_scope_kind NOT IN ('personal', 'school')
       OR p_visibility_policy NOT IN ('private', 'school')
       OR (p_scope_kind = 'personal' AND p_visibility_policy = 'school') THEN
        RETURN QUERY SELECT 'invalid_scope'::varchar, NULL::uuid, NULL::integer;
        RETURN;
    END IF;
    SELECT * INTO v_normalized FROM public.learning_activity_normalize_draft(
        p_principal_id, p_tenant_id, p_kind, p_title, p_instructions,
        p_result_mode, p_max_points, p_policy_snapshot, p_module_key,
        p_quiz_version_id, p_starter_project_version_id,
        p_source_teacher_assignment_id
    );
    IF v_normalized.result_code <> 'ok' THEN
        RETURN QUERY SELECT v_normalized.result_code::varchar, NULL::uuid, NULL::integer;
        RETURN;
    END IF;
    IF p_goal IS NOT NULL AND
       (jsonb_typeof(p_goal) NOT IN ('string', 'null') OR
        length(trim(p_goal #>> '{}')) > 160) THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::uuid, NULL::integer;
        RETURN;
    END IF;
    IF p_goal IS NOT NULL THEN
        v_normalized.draft_payload := v_normalized.draft_payload ||
            jsonb_build_object('goal', NULLIF(trim(p_goal #>> '{}'), ''));
    END IF;
    v_request_snapshot := jsonb_build_object(
        'tenantId', p_tenant_id,
        'ownerPrincipalId', p_principal_id,
        'scope', p_scope_kind,
        'visibility', p_visibility_policy,
        'draft', v_normalized.draft_payload
    );
    v_request_digest := public.learning_activity_snapshot_digest(v_request_snapshot);
    PERFORM pg_advisory_xact_lock(hashtextextended(
        COALESCE(p_source_teacher_assignment_id::text,
                 p_tenant_id::text || ':' || p_principal_id::text || ':' || p_request_id),
        9000
    ));
    SELECT activity.id, activity.creation_request_digest
      INTO v_existing
      FROM public.learning_activities activity
     WHERE activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND activity.creation_request_id = p_request_id;
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.creation_request_digest <> v_request_digest THEN
            RETURN QUERY SELECT 'idempotency_conflict'::varchar, NULL::uuid, NULL::integer;
        ELSE
            RETURN QUERY SELECT 'ok'::varchar, v_existing.id, 1;
        END IF;
        RETURN;
    END IF;
    IF p_source_teacher_assignment_id IS NOT NULL THEN
        SELECT activity.id, activity.creation_request_digest
          INTO v_existing
          FROM public.learning_activities activity
         WHERE source_teacher_assignment_id = p_source_teacher_assignment_id;
        IF v_existing.id IS NOT NULL THEN
            IF v_existing.creation_request_digest <> v_request_digest THEN
                RETURN QUERY SELECT 'source_conflict'::varchar, NULL::uuid, NULL::integer;
            ELSE
                RETURN QUERY SELECT 'ok'::varchar, v_existing.id, 1;
            END IF;
            RETURN;
        END IF;
    END IF;
    INSERT INTO public.learning_activities (
        tenant_id, owner_principal_id, scope_kind, activity_type, title,
        visibility_policy, authoring_origin, reusable_authored_content,
        draft_revision, draft_payload, source_teacher_assignment_id,
        creation_request_id, creation_request_digest
    ) VALUES (
        p_tenant_id, p_principal_id, p_scope_kind, p_kind,
        v_normalized.draft_payload ->> 'title', p_visibility_policy,
        v_normalized.authoring_origin, true, 1, v_normalized.draft_payload,
        p_source_teacher_assignment_id, p_request_id, v_request_digest
    ) RETURNING id INTO v_id;
    RETURN QUERY SELECT 'ok'::varchar, v_id, 1;
END;
$$;

CREATE OR REPLACE FUNCTION learning_activity_draft_put(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid,
    p_expected_revision integer,
    p_title varchar,
    p_instructions varchar,
    p_result_mode varchar,
    p_max_points integer,
    p_policy_snapshot jsonb,
    p_module_key varchar,
    p_quiz_version_id uuid,
    p_starter_project_version_id uuid,
    p_goal jsonb
)
RETURNS TABLE (result_code varchar, draft_revision integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_activity record; v_normalized record; v_revision integer;
BEGIN
    SELECT * INTO v_activity FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
       AND activity.reusable_authored_content = true
       AND activity.archived_at IS NULL;
    IF v_activity.id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::integer;
        RETURN;
    END IF;
    IF v_activity.draft_revision <> p_expected_revision THEN
        RETURN QUERY SELECT 'revision_conflict'::varchar, v_activity.draft_revision;
        RETURN;
    END IF;
    SELECT * INTO v_normalized FROM public.learning_activity_normalize_draft(
        p_principal_id, v_activity.tenant_id, v_activity.activity_type,
        p_title, p_instructions, p_result_mode, p_max_points,
        p_policy_snapshot, p_module_key, p_quiz_version_id,
        p_starter_project_version_id, v_activity.source_teacher_assignment_id
    );
    IF v_normalized.result_code <> 'ok' THEN
        RETURN QUERY SELECT v_normalized.result_code::varchar, NULL::integer;
        RETURN;
    END IF;
    IF p_goal IS NOT NULL AND
       (jsonb_typeof(p_goal) NOT IN ('string', 'null') OR
        length(trim(p_goal #>> '{}')) > 160) THEN
        RETURN QUERY SELECT 'invalid_draft'::varchar, NULL::integer;
        RETURN;
    END IF;
    IF p_goal IS NOT NULL THEN
        v_normalized.draft_payload := v_normalized.draft_payload ||
            jsonb_build_object('goal', NULLIF(trim(p_goal #>> '{}'), ''));
    ELSIF v_activity.draft_payload ? 'goal' THEN
        v_normalized.draft_payload := v_normalized.draft_payload ||
            jsonb_build_object('goal', v_activity.draft_payload -> 'goal');
    END IF;
    UPDATE public.learning_activities activity
       SET title = v_normalized.draft_payload ->> 'title',
           draft_payload = v_normalized.draft_payload,
           draft_revision = activity.draft_revision + 1
     WHERE activity.id = p_activity_id
       AND activity.draft_revision = p_expected_revision
     RETURNING activity.draft_revision INTO v_revision;
    IF v_revision IS NULL THEN
        RETURN QUERY SELECT 'revision_conflict'::varchar, NULL::integer;
    ELSE
        RETURN QUERY SELECT 'ok'::varchar, v_revision;
    END IF;
END;
$$;

-- Existing direct SQL callers pass a varchar goal. Preserve that entry point
-- while routing them through the same validation and normalization logic.
CREATE OR REPLACE FUNCTION learning_activity_create(
    p_principal_id uuid, p_tenant_id uuid, p_scope_kind varchar,
    p_visibility_policy varchar, p_kind varchar, p_title varchar,
    p_instructions varchar, p_result_mode varchar, p_max_points integer,
    p_policy_snapshot jsonb, p_module_key varchar, p_quiz_version_id uuid,
    p_starter_project_version_id uuid, p_source_teacher_assignment_id uuid,
    p_request_id varchar, p_goal varchar
)
RETURNS TABLE (result_code varchar, activity_id uuid, draft_revision integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT * FROM public.learning_activity_create(
        p_principal_id, p_tenant_id, p_scope_kind, p_visibility_policy,
        p_kind, p_title, p_instructions, p_result_mode, p_max_points,
        p_policy_snapshot, p_module_key, p_quiz_version_id,
        p_starter_project_version_id, p_source_teacher_assignment_id,
        p_request_id,
        CASE WHEN p_goal IS NULL THEN NULL::jsonb ELSE to_jsonb(p_goal) END
    );
$$;

CREATE OR REPLACE FUNCTION learning_activity_draft_put(
    p_principal_id uuid, p_tenant_id uuid, p_activity_id uuid,
    p_expected_revision integer, p_title varchar, p_instructions varchar,
    p_result_mode varchar, p_max_points integer, p_policy_snapshot jsonb,
    p_module_key varchar, p_quiz_version_id uuid,
    p_starter_project_version_id uuid, p_goal varchar
)
RETURNS TABLE (result_code varchar, draft_revision integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT * FROM public.learning_activity_draft_put(
        p_principal_id, p_tenant_id, p_activity_id, p_expected_revision,
        p_title, p_instructions, p_result_mode, p_max_points,
        p_policy_snapshot, p_module_key, p_quiz_version_id,
        p_starter_project_version_id,
        CASE WHEN p_goal IS NULL THEN NULL::jsonb ELSE to_jsonb(p_goal) END
    );
$$;

-- The pre-goal edit signature also means "no goal field supplied". Retain the
-- current draft value (or absence) when a legacy caller edits other fields.
CREATE OR REPLACE FUNCTION learning_activity_draft_put(
    p_principal_id uuid, p_tenant_id uuid, p_activity_id uuid,
    p_expected_revision integer, p_title varchar, p_instructions varchar,
    p_result_mode varchar, p_max_points integer, p_policy_snapshot jsonb,
    p_module_key varchar, p_quiz_version_id uuid,
    p_starter_project_version_id uuid
)
RETURNS TABLE (result_code varchar, draft_revision integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT * FROM public.learning_activity_draft_put(
        p_principal_id, p_tenant_id, p_activity_id, p_expected_revision,
        p_title, p_instructions, p_result_mode, p_max_points,
        p_policy_snapshot, p_module_key, p_quiz_version_id,
        p_starter_project_version_id, NULL::jsonb
    );
$$;

CREATE OR REPLACE FUNCTION learning_activity_publish(
    p_principal_id uuid,
    p_tenant_id uuid,
    p_activity_id uuid,
    p_expected_revision integer,
    p_request_id varchar
)
RETURNS TABLE (
    result_code varchar,
    activity_version_id uuid,
    version_number integer,
    content_digest varchar,
    reused boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_activity record;
    v_existing record;
    v_number integer;
    v_id uuid;
    v_snapshot jsonb;
    v_digest varchar;
    v_sample_content_type varchar;
    v_sample_bytes bytea;
    v_sample_content_hash varchar;
    v_goal varchar;
BEGIN
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request_id'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_activity_id::text, 9001));

    SELECT * INTO v_activity
      FROM public.learning_activities activity
     WHERE activity.id = p_activity_id
       AND activity.tenant_id = p_tenant_id
       AND activity.owner_principal_id = p_principal_id
       AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id)
       AND activity.reusable_authored_content = true
       AND activity.authoring_origin <> 'legacy_runtime'
       AND activity.archived_at IS NULL
     FOR UPDATE;

    IF v_activity.id IS NULL THEN
        RETURN QUERY SELECT 'activity_not_found'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT version.id, version.version_number, version.content_digest,
           version.source_draft_revision
      INTO v_existing
      FROM public.learning_activity_versions version
     WHERE version.activity_id = p_activity_id
       AND version.publication_request_id = p_request_id;

    IF v_existing.id IS NOT NULL THEN
        IF v_existing.source_draft_revision <> p_expected_revision THEN
            RETURN QUERY SELECT 'idempotency_conflict'::varchar, NULL::uuid,
                                NULL::integer, NULL::varchar, false;
        ELSE
            RETURN QUERY SELECT 'ok'::varchar, v_existing.id, v_existing.version_number,
                                v_existing.content_digest, true;
        END IF;
        RETURN;
    END IF;

    SELECT version.id, version.version_number, version.content_digest,
           version.source_draft_revision
      INTO v_existing
      FROM public.learning_activity_versions version
     WHERE version.activity_id = p_activity_id
       AND version.source_draft_revision = p_expected_revision
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
        RETURN QUERY SELECT 'ok'::varchar, v_existing.id, v_existing.version_number,
                            v_existing.content_digest, true;
        RETURN;
    END IF;

    IF v_activity.draft_revision <> p_expected_revision THEN
        RETURN QUERY SELECT 'revision_conflict'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.learning_migration_compatibility_activity_versions compatibility
         WHERE compatibility.learning_activity_version_id = v_activity.current_published_version_id
            OR compatibility.classroom_assignment_id::text =
               v_activity.draft_payload ->> 'sourceClassroomAssignmentId'
    ) THEN
        RETURN QUERY SELECT 'compatibility_not_reusable'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;

    SELECT media.content_type, media.bytes, media.content_hash
      INTO v_sample_content_type, v_sample_bytes, v_sample_content_hash
      FROM public.learning_activity_draft_media media
     WHERE media.tenant_id = p_tenant_id
       AND media.activity_id = p_activity_id
       AND media.role = 'sample';

    SELECT COALESCE(max(version.version_number), 0) + 1
      INTO v_number
      FROM public.learning_activity_versions version
     WHERE version.activity_id = p_activity_id;

    -- Pre-goal drafts can still be published. Freeze their teacher source goal
    -- once, at publication; an explicit null in a new draft stays null.
    v_goal := CASE WHEN v_activity.draft_payload ? 'goal'
        THEN NULLIF(v_activity.draft_payload ->> 'goal', '')
        ELSE (
            SELECT teacher.goal
              FROM public.teacher_assignments teacher
             WHERE teacher.tenant_id = p_tenant_id
               AND teacher.id = v_activity.source_teacher_assignment_id
        )
    END;

    v_snapshot := jsonb_build_object(
        'activityId', v_activity.id,
        'versionNumber', v_number,
        'kind', v_activity.draft_payload ->> 'kind',
        'title', v_activity.draft_payload ->> 'title',
        'instructions', v_activity.draft_payload -> 'instructions',
        'goal', v_goal,
        'resultMode', v_activity.draft_payload ->> 'resultMode',
        'maxPoints', v_activity.draft_payload -> 'maxPoints',
        'policies', v_activity.draft_payload -> 'policies',
        'moduleKey', v_activity.draft_payload -> 'moduleKey',
        'quizVersionId', v_activity.draft_payload -> 'quizVersionId',
        'starterProjectVersionId', v_activity.draft_payload -> 'starterProjectVersionId',
        'sample', CASE
            WHEN v_sample_content_hash IS NULL THEN NULL::jsonb
            ELSE jsonb_build_object(
                'contentType', v_sample_content_type,
                'contentHash', v_sample_content_hash
            )
        END,
        'provenance', jsonb_build_object(
            'authoringOrigin', v_activity.authoring_origin,
            'sourceVersionId', v_activity.draft_base_version_id,
            'sourceTeacherAssignmentId', v_activity.source_teacher_assignment_id,
            'sourceDraftRevision', v_activity.draft_revision
        )
    );

    v_digest := public.learning_activity_snapshot_digest(v_snapshot);

    INSERT INTO public.learning_activity_versions (
        tenant_id, activity_id, version_number, title, instructions,
        activity_type, module_key, max_points, scoring_policy, content_digest,
        canonical_kind, result_mode, policy_snapshot, quiz_version_id,
        starter_project_version_id, provenance, source_draft_revision,
        publication_request_id, published_by_principal_id,
        canonical_contract_version, goal, goal_snapshot_present
    ) VALUES (
        v_activity.tenant_id, v_activity.id, v_number,
        v_activity.draft_payload ->> 'title',
        NULLIF(v_activity.draft_payload ->> 'instructions', ''),
        v_activity.draft_payload ->> 'kind',
        NULLIF(v_activity.draft_payload ->> 'moduleKey', ''),
        NULLIF(v_activity.draft_payload ->> 'maxPoints', '')::integer,
        jsonb_build_object('kind', 'canonical',
                           'resultMode', v_activity.draft_payload ->> 'resultMode'),
        v_digest,
        v_activity.draft_payload ->> 'kind',
        v_activity.draft_payload ->> 'resultMode',
        v_activity.draft_payload -> 'policies',
        NULLIF(v_activity.draft_payload ->> 'quizVersionId', '')::uuid,
        NULLIF(v_activity.draft_payload ->> 'starterProjectVersionId', '')::uuid,
        v_snapshot -> 'provenance', v_activity.draft_revision,
        p_request_id, p_principal_id, 1,
        v_goal, true
    ) RETURNING id INTO v_id;

    IF v_sample_content_hash IS NOT NULL THEN
        INSERT INTO public.learning_activity_version_media (
            tenant_id, activity_version_id, role, content_type, bytes, content_hash
        ) VALUES (
            p_tenant_id, v_id, 'sample',
            v_sample_content_type, v_sample_bytes, v_sample_content_hash
        );
    END IF;

    UPDATE public.learning_activities
       SET current_published_version_id = v_id, draft_base_version_id = NULL
     WHERE id = p_activity_id;

    RETURN QUERY SELECT 'ok'::varchar, v_id, v_number, v_digest, false;
END;
$$;

CREATE OR REPLACE FUNCTION learning_activity_draft_from_version(p_principal uuid,p_tenant uuid,p_activity uuid,p_version uuid,p_expected integer)
RETURNS TABLE(result_code varchar,draft_revision integer,source_version_number integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a public.learning_activities%ROWTYPE; v public.learning_activity_versions%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_activity::text,9001));
 SELECT * INTO a FROM public.learning_activities WHERE id=p_activity AND tenant_id=p_tenant
   AND owner_principal_id=p_principal AND reusable_authored_content AND archived_at IS NULL
   AND public.learning_author_can_use_tenant(p_principal,p_tenant) FOR UPDATE;
 IF a.id IS NULL THEN RETURN QUERY SELECT 'activity_not_found'::varchar,NULL::integer,NULL::integer; RETURN; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.learning_activity_versions WHERE id=a.current_published_version_id
   AND source_draft_revision=a.draft_revision) THEN
   RETURN QUERY SELECT 'draft_exists'::varchar,a.draft_revision,NULL::integer; RETURN;
 END IF;
 IF a.draft_revision IS DISTINCT FROM p_expected THEN RETURN QUERY SELECT 'revision_conflict'::varchar,a.draft_revision,NULL::integer; RETURN; END IF;
 SELECT * INTO v FROM public.learning_activity_versions WHERE id=p_version AND activity_id=a.id AND canonical_contract_version=1;
 IF v.id IS NULL THEN RETURN QUERY SELECT 'version_not_found'::varchar,a.draft_revision,NULL::integer; RETURN; END IF;
 UPDATE public.learning_activities SET title=v.title,draft_revision=a.draft_revision+1,draft_base_version_id=v.id,
   draft_payload=jsonb_build_object('kind',v.canonical_kind,'title',v.title,'instructions',v.instructions,
     'goal',CASE WHEN v.goal_snapshot_present THEN v.goal ELSE NULL END,
     'resultMode',v.result_mode,'maxPoints',v.max_points,'policies',v.policy_snapshot,'moduleKey',v.module_key,
     'quizVersionId',v.quiz_version_id,'starterProjectVersionId',v.starter_project_version_id)
 WHERE id=a.id;
 RETURN QUERY SELECT 'ok'::varchar,a.draft_revision+1,v.version_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.learning_activity_preview_with_goal_as_author(
  p_principal_id uuid,
  p_tenant_id uuid,
  p_activity_id uuid,
  p_source_kind varchar,
  p_source_id uuid,
  p_expected_draft_revision integer
)
RETURNS TABLE (
  result_code varchar,
  activity_id uuid,
  source_kind varchar,
  source_id uuid,
  draft_revision integer,
  version_number integer,
  title varchar,
  instructions varchar,
  module_key varchar,
  result_mode varchar,
  max_points integer,
  policy_snapshot jsonb,
  content_digest varchar,
  goal varchar
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_activity public.learning_activities%ROWTYPE;
  v_version public.learning_activity_versions%ROWTYPE;
BEGIN
  SELECT activity.* INTO v_activity
    FROM public.learning_activities activity
   WHERE activity.id = p_activity_id
     AND activity.tenant_id = p_tenant_id
     AND activity.owner_principal_id = p_principal_id
     AND activity.reusable_authored_content = true
     AND activity.authoring_origin <> 'legacy_runtime'
     AND public.learning_author_can_use_tenant(p_principal_id, p_tenant_id);
  IF v_activity.id IS NULL THEN
    RETURN QUERY SELECT 'activity_not_found'::varchar,NULL::uuid,NULL::varchar,NULL::uuid,
      NULL::integer,NULL::integer,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,
      NULL::integer,NULL::jsonb,NULL::varchar,NULL::varchar;
    RETURN;
  END IF;

  IF p_source_kind = 'draft' THEN
    IF p_source_id IS NOT NULL OR p_expected_draft_revision IS NULL THEN
      RETURN QUERY SELECT 'invalid_source'::varchar,v_activity.id,'draft'::varchar,NULL::uuid,
        v_activity.draft_revision,NULL::integer,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,
        NULL::integer,NULL::jsonb,NULL::varchar,NULL::varchar;
      RETURN;
    END IF;
    IF v_activity.draft_revision <> p_expected_draft_revision THEN
      RETURN QUERY SELECT 'revision_conflict'::varchar,v_activity.id,'draft'::varchar,NULL::uuid,
        v_activity.draft_revision,NULL::integer,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,
        NULL::integer,NULL::jsonb,NULL::varchar,NULL::varchar;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar,v_activity.id,'draft'::varchar,NULL::uuid,
      v_activity.draft_revision,NULL::integer,
      (v_activity.draft_payload->>'title')::varchar,
      NULLIF(v_activity.draft_payload->>'instructions','')::varchar,
      NULLIF(v_activity.draft_payload->>'moduleKey','')::varchar,
      (v_activity.draft_payload->>'resultMode')::varchar,
      NULLIF(v_activity.draft_payload->>'maxPoints','')::integer,
      v_activity.draft_payload->'policies',
      encode(public.digest(convert_to(v_activity.draft_payload::text,'UTF8'),'sha256'),'hex')::varchar,
      CASE WHEN v_activity.draft_payload ? 'goal'
        THEN NULLIF(v_activity.draft_payload->>'goal','')
        ELSE (
          SELECT teacher.goal
            FROM public.teacher_assignments teacher
           WHERE teacher.tenant_id = p_tenant_id
             AND teacher.id = v_activity.source_teacher_assignment_id
        )
      END::varchar;
    RETURN;
  END IF;

  IF p_source_kind = 'published' THEN
    IF p_source_id IS NULL OR p_expected_draft_revision IS NOT NULL THEN
      RETURN QUERY SELECT 'invalid_source'::varchar,v_activity.id,'published'::varchar,p_source_id,
        NULL::integer,NULL::integer,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,
        NULL::integer,NULL::jsonb,NULL::varchar,NULL::varchar;
      RETURN;
    END IF;
    SELECT version.* INTO v_version
      FROM public.learning_activity_versions version
     WHERE version.id = p_source_id
       AND version.tenant_id = p_tenant_id
       AND version.activity_id = p_activity_id
       AND version.canonical_contract_version = 1;
    IF v_version.id IS NULL THEN
      RETURN QUERY SELECT 'version_not_found'::varchar,v_activity.id,'published'::varchar,p_source_id,
        NULL::integer,NULL::integer,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,
        NULL::integer,NULL::jsonb,NULL::varchar,NULL::varchar;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'ok'::varchar,v_activity.id,'published'::varchar,v_version.id,
      v_version.source_draft_revision,v_version.version_number,v_version.title,v_version.instructions,
      v_version.module_key,v_version.result_mode,v_version.max_points,v_version.policy_snapshot,
      v_version.content_digest,
      CASE WHEN v_version.goal_snapshot_present THEN v_version.goal ELSE NULL END::varchar;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'invalid_source'::varchar,v_activity.id,p_source_kind,p_source_id,
    NULL::integer,NULL::integer,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,
    NULL::integer,NULL::jsonb,NULL::varchar,NULL::varchar;
END;
$$;
REVOKE ALL ON FUNCTION learning_activity_create(uuid,uuid,varchar,varchar,varchar,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,uuid,varchar,varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_create(uuid,uuid,varchar,varchar,varchar,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,uuid,varchar,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_draft_put(uuid,uuid,uuid,integer,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_draft_put(uuid,uuid,uuid,integer,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_activity_preview_with_goal_as_author(uuid,uuid,uuid,varchar,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_activity_create(uuid,uuid,varchar,varchar,varchar,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,uuid,varchar,varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_activity_create(uuid,uuid,varchar,varchar,varchar,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,uuid,varchar,jsonb) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_activity_draft_put(uuid,uuid,uuid,integer,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_activity_draft_put(uuid,uuid,uuid,integer,varchar,varchar,varchar,integer,jsonb,varchar,uuid,uuid,jsonb) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_activity_preview_with_goal_as_author(uuid,uuid,uuid,varchar,uuid,integer) TO asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_assignment_list(p_account_id uuid, p_classroom_id uuid)
 RETURNS TABLE(id uuid, assignment_id uuid, title character varying, brief character varying, goal character varying, module_key character varying, due_at timestamp with time zone, status character varying, created_at timestamp with time zone, demo_key character varying, sample_image character varying, seat_count integer, started_count integer, submitted_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
    SELECT h.id, t.id, COALESCE(lv.title,t.title), COALESCE(lv.instructions,t.brief), CASE WHEN lv.goal_snapshot_present THEN lv.goal ELSE t.goal END, COALESCE(lv.module_key,t.module_key), h.due_at, h.status, h.created_at,
           t.demo_key, t.sample_image,
           (SELECT count(*)::integer FROM public.classroom_student_seats s
             WHERE s.tenant_id = h.tenant_id AND s.classroom_id = h.classroom_id
               AND s.status <> 'removed'),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
             WHERE w.assignment_id = h.id),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
             WHERE w.assignment_id = h.id AND w.submitted_at IS NOT NULL)
      FROM public.classroom_assignments h
      LEFT JOIN public.teacher_assignments t ON t.id = h.assignment_id
      LEFT JOIN public.learning_activity_versions lv ON lv.id=h.learning_activity_version_id
     WHERE h.classroom_id = p_classroom_id AND (t.id IS NOT NULL OR lv.id IS NOT NULL)
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships m
            WHERE m.account_id = p_account_id
              AND m.classroom_id = p_classroom_id
              AND m.tenant_id = h.tenant_id
              AND m.member_role IN ('owner', 'co_teacher'))
     ORDER BY (t.demo_key IS NOT NULL), h.created_at DESC;
$function$;

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
 STABLE SECURITY DEFINER
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
       AND (h.status = 'open' OR w.project_id IS NOT NULL)
     ORDER BY (w.submitted_at IS NOT NULL), h.created_at;
$function$;

-- An occurrence carries the goal only after the effective opening (or for
-- historical bound work). The exact version ID still comes from ActivityRun.
DROP FUNCTION classroom_course_activity_occurrences_for_account(uuid);
DROP FUNCTION classroom_course_activity_occurrences_for_seat(uuid);
-- E1-FIX-11D4b: expose block-aware Course Activity runtime occurrences to learner reads.
-- Existing classroom_course_runs_*_v2 readers remain unchanged.

CREATE FUNCTION classroom_course_activity_occurrences_for_seat(p_seat_id uuid)
RETURNS TABLE (
    seat_id uuid,
    run_id uuid,
    lesson_id uuid,
    block_id varchar,
    activity_run_id uuid,
    classroom_assignment_id uuid,
    learning_activity_version_id uuid,
    title varchar,
    goal varchar,
    module_key varchar,
    project_id uuid,
    submitted_at timestamptz,
    snapshot_revision integer,
    work_updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT seat.id,
           visible.run_id,
           visible.lesson_id,
           runtime.source_course_block_id,
           runtime.id,
           runtime.source_classroom_assignment_id,
           runtime.learning_activity_version_id,
           version.title,
           CASE WHEN work.project_id IS NOT NULL OR (
               visible.run_status = 'open'
               AND classroom.status = 'active'
               AND runtime.lifecycle_status = 'active'
               AND assignment.status = 'open'
               AND public.learning_course_seat_visible(seat.id, visible.run_id)
               AND
               participation.status IN ('assigned', 'active')
               AND (participation.source_course_enrollment_id IS NULL
                    OR enrollment.status IN ('assigned', 'active'))
               AND (conditions.opens_at IS NULL OR conditions.opens_at <= now())
           ) THEN version.goal ELSE NULL END,
           version.module_key,
           work.project_id,
           work.submitted_at,
           snapshot.source_revision,
           draft.updated_at
      FROM public.classroom_student_seats seat
      CROSS JOIN LATERAL public.classroom_course_runs_for_seat_v2(seat.id) visible
      JOIN public.classrooms classroom
        ON classroom.tenant_id = seat.tenant_id
       AND classroom.id = seat.classroom_id
      JOIN public.activity_runs runtime
        ON runtime.source_kind = 'course'
       AND runtime.source_course_run_id = visible.run_id
       AND runtime.source_course_lesson_id = visible.lesson_id
       AND runtime.source_course_block_id IS NOT NULL
      JOIN LATERAL jsonb_array_elements(visible.lesson_blocks)
           WITH ORDINALITY AS block(value, position)
        ON block.value ->> 'id' = runtime.source_course_block_id
       AND block.value ->> 'type' = 'activity'
       AND block.value -> 'hidden' IS DISTINCT FROM 'true'::jsonb
      JOIN public.learning_activity_versions version
        ON version.tenant_id = runtime.tenant_id
       AND version.id = runtime.learning_activity_version_id
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id = runtime.tenant_id
       AND assignment.id = runtime.source_classroom_assignment_id
      LEFT JOIN public.classroom_assignment_work work
        ON work.assignment_id = runtime.source_classroom_assignment_id
       AND work.seat_id = seat.id
      LEFT JOIN public.learner_identity_links link
        ON link.tenant_id = runtime.tenant_id
       AND link.school_id = runtime.school_id
       AND link.seat_id = seat.id
       AND link.link_kind = 'student_seat'
       AND link.status = 'active'
      LEFT JOIN public.activity_participations participation
        ON participation.tenant_id = runtime.tenant_id
       AND participation.school_id = runtime.school_id
       AND participation.activity_run_id = runtime.id
       AND participation.learner_identity_id = link.learner_identity_id
      LEFT JOIN public.course_enrollments enrollment
        ON enrollment.id = participation.source_course_enrollment_id
       AND enrollment.tenant_id = runtime.tenant_id
       AND enrollment.school_id = runtime.school_id
      LEFT JOIN LATERAL (
          SELECT (public.learning_effective_conditions_internal(
              runtime.id, participation.id
          )#>>'{values,opensAt}')::timestamptz AS opens_at
           WHERE participation.id IS NOT NULL
      ) conditions ON true
      LEFT JOIN public.project_drafts draft ON draft.project_id = work.project_id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = work.project_id
     WHERE seat.id = p_seat_id
       AND seat.status = 'active'
     ORDER BY visible.run_id, visible.lesson_id, block.position;
$$;

CREATE FUNCTION classroom_course_activity_occurrences_for_account(p_account_id uuid)
RETURNS TABLE (
    seat_id uuid,
    run_id uuid,
    lesson_id uuid,
    block_id varchar,
    activity_run_id uuid,
    classroom_assignment_id uuid,
    learning_activity_version_id uuid,
    title varchar,
    goal varchar,
    module_key varchar,
    project_id uuid,
    submitted_at timestamptz,
    snapshot_revision integer,
    work_updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT occurrence.*
      FROM public.classroom_student_seats seat
      CROSS JOIN LATERAL public.classroom_course_activity_occurrences_for_seat(seat.id) occurrence
     WHERE seat.account_id = p_account_id
       AND seat.status = 'active'
     ORDER BY occurrence.run_id, occurrence.lesson_id, occurrence.block_id;
$$;


REVOKE ALL ON FUNCTION classroom_course_activity_occurrences_for_seat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_course_activity_occurrences_for_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_course_activity_occurrences_for_seat(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_course_activity_occurrences_for_account(uuid) TO asalab_app;

CREATE OR REPLACE FUNCTION learning_work_context_for_project(
    p_viewer_principal_id uuid, p_project_id uuid
)
RETURNS TABLE (context jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT jsonb_build_object(
        'projectId', work.project_id,
        'seatId', seat.id,
        'classroomAssignmentId', assignment.id,
        'activityRunId', run.id,
        'participationId', participation.id,
        'learningActivityVersionId', version.id,
        'assignmentVersionId', assignment.learning_activity_version_id,
        'runVersionId', run.learning_activity_version_id,
        'versionNumber', version.version_number,
        'contentDigest', version.content_digest,
        'sourceKind', CASE WHEN assignment.course_run_id IS NULL THEN 'direct' ELSE 'course' END,
        'courseRunId', course.id,
        'courseLessonId', lesson.id,
        'courseBlockId', run.source_course_block_id,
        'title', COALESCE(version.title, lesson.assignment_title, teacher.title),
        'brief', CASE WHEN run.source_course_block_id IS NOT NULL THEN version.instructions
                      ELSE COALESCE(version.instructions, lesson.assignment_brief, teacher.brief) END,
        'goal', CASE WHEN version.goal_snapshot_present THEN version.goal
                     WHEN run.source_course_block_id IS NOT NULL THEN NULL
                     ELSE COALESCE(lesson.assignment_goal, teacher.goal) END,
        'moduleKey', CASE WHEN run.source_course_block_id IS NOT NULL THEN version.module_key
                         ELSE COALESCE(version.module_key, lesson.module_key, teacher.module_key) END,
        'sampleImage', CASE
            WHEN run.source_course_block_id IS NOT NULL THEN NULL
            WHEN assignment.course_run_id IS NULL
                 AND assignment.learning_activity_version_id = version.id
                 AND version.canonical_contract_version = 1
                 AND EXISTS (
                    SELECT 1 FROM public.learning_activity_version_media media
                     WHERE media.activity_version_id = version.id AND media.role = 'sample'
                )
                THEN '/api/assignments/activity-versions/' || version.id::text || '/sample'
            WHEN assignment.course_run_id IS NULL
                 AND assignment.learning_activity_version_id IS NOT NULL THEN NULL
            WHEN run.source_course_block_id IS NULL AND course_media.version_id IS NOT NULL
                THEN '/api/class-join/course-runs/' || course.id::text || '/lessons/' || lesson.source_lesson_id::text || '/sample'
            WHEN assignment.course_run_id IS NOT NULL THEN lesson.static_sample_image
            ELSE teacher.sample_image
        END,
        'dueAt', assignment.due_at,
        'assignmentStatus', assignment.status,
        'runStatus', run.lifecycle_status,
        'courseStatus', course.status,
        'classroomStatus', classroom.status,
        'seatStatus', seat.status,
        'participationStatus', participation.status,
        'participationExcused', participation.excused,
        'effectiveConditions', CASE WHEN run.id IS NULL THEN NULL
            ELSE public.learning_effective_conditions_internal(run.id, participation.id) END,
        'submittedAt', work.submitted_at,
        'snapshotRevision', snapshot.source_revision,
        'updatedAt', draft.updated_at,
        'attemptId', attempt.id,
        'attemptNumber', attempt.attempt_number,
        'submissionId', submission.id,
        'submittedProjectVersionId', submission.project_version_id,
        'classroomTitle', classroom.title,
        'courseTitle', course.title,
        'lessonTitle', lesson.title
    )
      FROM public.classroom_assignment_work work
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id = work.tenant_id AND assignment.id = work.assignment_id
      JOIN public.classrooms classroom
        ON classroom.tenant_id = assignment.tenant_id AND classroom.id = assignment.classroom_id
      JOIN public.classroom_student_seats seat
        ON seat.id = work.seat_id AND seat.classroom_id = assignment.classroom_id
      JOIN public.principals viewer ON viewer.id = p_viewer_principal_id
      LEFT JOIN public.teacher_assignments teacher ON teacher.id = assignment.assignment_id
      LEFT JOIN public.classroom_course_runs course ON course.id = assignment.course_run_id
      LEFT JOIN public.activity_runs run
        ON run.source_classroom_assignment_id = assignment.id
      LEFT JOIN public.classroom_course_run_lessons lesson
        ON lesson.run_id = assignment.course_run_id
       AND ((run.id IS NOT NULL AND lesson.id = run.source_course_lesson_id)
            OR (run.id IS NULL AND lesson.classroom_assignment_id = assignment.id))
      LEFT JOIN public.course_version_media course_media
        ON course_media.version_id = course.course_version_id
       AND course_media.source_lesson_id = lesson.source_lesson_id
      LEFT JOIN public.learner_identity_links link
        ON link.tenant_id = assignment.tenant_id
       AND link.school_id = classroom.school_id
       AND link.seat_id = seat.id AND link.status = 'active'
       AND link.link_kind = 'student_seat'
      LEFT JOIN public.activity_participations participation
        ON participation.activity_run_id = run.id
       AND participation.learner_identity_id = link.learner_identity_id
      LEFT JOIN public.classroom_activity_versions compatibility
        ON compatibility.classroom_assignment_id = assignment.id
      LEFT JOIN public.learning_activity_versions version
        ON version.id = COALESCE(run.learning_activity_version_id,
                                 assignment.learning_activity_version_id,
                                 compatibility.learning_activity_version_id)
      LEFT JOIN public.project_drafts draft ON draft.project_id = work.project_id
      LEFT JOIN public.project_snapshots snapshot ON snapshot.project_id = work.project_id
      LEFT JOIN LATERAL (
          SELECT item.* FROM public.learning_attempts item
           WHERE item.classroom_assignment_id = assignment.id AND item.seat_id = seat.id
           ORDER BY item.attempt_number DESC, item.id DESC LIMIT 1
      ) attempt ON true
      LEFT JOIN public.learning_submissions submission ON submission.attempt_id = attempt.id
     WHERE work.project_id = p_project_id
       AND ((viewer.kind = 'student_seat' AND viewer.seat_id = seat.id)
            OR (viewer.kind = 'account' AND viewer.account_id = seat.account_id))
       AND EXISTS (
           SELECT 1 FROM public.project_context_for_principal(p_viewer_principal_id, p_project_id)
       );
$$;
