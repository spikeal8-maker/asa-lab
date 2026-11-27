-- Private two-stage review of one exact free StudentSeat publication candidate.
-- Existing Account publication and public readers keep their existing contracts.
CREATE TABLE public.classroom_publication_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL,
    classroom_id uuid NOT NULL,
    seat_id uuid NOT NULL,
    owner_principal_id uuid NOT NULL,
    request_key uuid NOT NULL,
    request_input_digest bytea NOT NULL CHECK (octet_length(request_input_digest) = 32),
    source_revision integer NOT NULL CHECK (source_revision > 0),
    source_digest bytea NOT NULL CHECK (octet_length(source_digest) = 32),
    module_key varchar NOT NULL,
    review_artifact jsonb NOT NULL CHECK (
        jsonb_typeof(review_artifact) = 'object'
        AND octet_length(review_artifact::text) <= CASE WHEN module_key = 'blocks' THEN 5242880 ELSE 1048576 END
        AND (
            (module_key = 'three-d' AND review_artifact @> '{"schemaVersion":4,"status":"display","viewerFamily":"three-d"}')
            OR (module_key = 'electronics' AND review_artifact @> '{"schemaVersion":3,"status":"simulation","viewerFamily":"electronics"}')
            OR (module_key = 'robotics' AND review_artifact @> '{"schemaVersion":7,"status":"simulation","viewerFamily":"robotics"}')
            OR (module_key = 'blocks' AND review_artifact @> '{"schemaVersion":8,"status":"player","viewerFamily":"scratch"}'
                AND jsonb_typeof(review_artifact#>'{runtime,assets}') = 'array')
        )
        AND review_artifact @> '{"capabilities":{"readOnly":true,"interactive":true,"download":false}}'
    ),
    metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
    state varchar NOT NULL DEFAULT 'waiting_teacher'
        CHECK (state IN ('waiting_teacher','waiting_platform','approved','rejected','stale','published')),
    teacher_actor uuid,
    teacher_approved boolean,
    teacher_decided_at timestamptz,
    platform_actor uuid,
    platform_approved boolean,
    platform_decided_at timestamptz,
    publication_id uuid,
    publication_revision_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (project_id, owner_principal_id, request_key),
    CHECK ((teacher_actor IS NULL) = (teacher_approved IS NULL)
        AND (teacher_actor IS NULL) = (teacher_decided_at IS NULL)),
    CHECK ((platform_actor IS NULL) = (platform_approved IS NULL)
        AND (platform_actor IS NULL) = (platform_decided_at IS NULL)),
    CHECK (platform_actor IS NULL OR teacher_approved IS TRUE),
    CHECK (state NOT IN ('waiting_platform','approved','published') OR teacher_approved IS TRUE),
    CHECK (state NOT IN ('approved','published') OR platform_approved IS TRUE),
    CHECK ((state = 'published') = (publication_id IS NOT NULL)
        AND (state = 'published') = (publication_revision_id IS NOT NULL))
);
CREATE UNIQUE INDEX classroom_publication_request_active
    ON public.classroom_publication_requests (project_id)
    WHERE state IN ('waiting_teacher','waiting_platform','approved');
CREATE INDEX classroom_publication_request_teacher_queue
    ON public.classroom_publication_requests (classroom_id, created_at, id) WHERE state = 'waiting_teacher';
CREATE INDEX classroom_publication_request_platform_queue
    ON public.classroom_publication_requests (created_at, id) WHERE state = 'waiting_platform';
ALTER TABLE public.classroom_publication_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.classroom_publication_requests FROM PUBLIC, asalab_app;

-- Includes all renderable bytes and metadata supplied by the current snapshot.
-- Draft and preview digests stay server-side. No extra copies of source documents.
CREATE FUNCTION public.classroom_publication_source_digest(
    p_project uuid, p_tenant uuid, p_revision integer
) RETURNS bytea
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT sha256(convert_to(jsonb_build_array(
        draft.revision, sha256(convert_to(draft.document_json::text, 'UTF8')),
        sha256(snapshot.image), snapshot.content_type, snapshot.width, snapshot.height
    )::text, 'UTF8'))
    FROM public.project_drafts draft
    JOIN public.project_snapshots snapshot ON snapshot.project_id = draft.project_id
       AND snapshot.tenant_id = draft.tenant_id AND snapshot.source_revision = draft.revision
    WHERE draft.project_id = p_project AND draft.tenant_id = p_tenant AND draft.revision = p_revision;
$$;

-- Resolve all publication metadata at application time. Approvers see exactly the
-- normalized fields that the existing final publication writer will receive.
CREATE FUNCTION public.classroom_publication_candidate_metadata(p_project public.projects, p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_input jsonb := COALESCE(p_input, '{}'::jsonb);
    v_title text;
    v_description text;
    v_license text;
    v_tags text[];
BEGIN
    IF jsonb_typeof(v_input) IS DISTINCT FROM 'object'
       OR v_input - ARRAY['title','description','tags','license'] <> '{}'::jsonb
       OR (v_input ? 'title' AND jsonb_typeof(v_input->'title') <> 'string')
       OR (v_input ? 'description' AND jsonb_typeof(v_input->'description') NOT IN ('string','null'))
       OR (v_input ? 'license' AND jsonb_typeof(v_input->'license') <> 'string')
       OR (v_input ? 'tags' AND jsonb_typeof(v_input->'tags') <> 'array') THEN
        RAISE EXCEPTION 'invalid publication metadata' USING ERRCODE = 'P5P03';
    END IF;
    v_title := trim(COALESCE(v_input->>'title', p_project.title));
    v_description := NULLIF(trim(CASE WHEN v_input ? 'description'
        THEN v_input->>'description' ELSE p_project.description END), '');
    v_license := trim(COALESCE(v_input->>'license', p_project.license));
    IF v_input ? 'tags' THEN
        IF jsonb_array_length(v_input->'tags') > 10 OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_input->'tags') item
             WHERE jsonb_typeof(item) <> 'string' OR length(trim(item #>> '{}')) NOT BETWEEN 1 AND 32
        ) THEN RAISE EXCEPTION 'invalid publication tags' USING ERRCODE = 'P5P03'; END IF;
        SELECT COALESCE(array_agg(DISTINCT lower(trim(value)) ORDER BY lower(trim(value))), '{}'::text[])
          INTO v_tags FROM jsonb_array_elements_text(v_input->'tags');
    ELSE
        v_tags := p_project.tags;
    END IF;
    IF length(v_title) NOT BETWEEN 1 AND 255 OR length(v_description) > 2000
       OR v_license NOT IN ('reserved','public-domain','cc-by','cc-by-sa','cc-by-nc')
       OR cardinality(v_tags) > 10 OR EXISTS (
          SELECT 1 FROM unnest(v_tags) tag WHERE tag IS NULL OR length(trim(tag)) NOT BETWEEN 1 AND 32
       ) THEN RAISE EXCEPTION 'invalid publication metadata' USING ERRCODE = 'P5P03'; END IF;
    SELECT COALESCE(array_agg(DISTINCT lower(trim(tag)) ORDER BY lower(trim(tag))), '{}'::text[])
      INTO v_tags FROM unnest(v_tags) tag;
    RETURN jsonb_build_object('title', v_title, 'description', v_description, 'tags', v_tags, 'license', v_license);
END;
$$;

CREATE FUNCTION public.classroom_publication_scratch_assets_match(p_tenant uuid, p_artifact jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT CASE WHEN p_artifact->>'viewerFamily' IS DISTINCT FROM 'scratch' THEN true
      WHEN jsonb_typeof(p_artifact#>'{runtime,assets}') IS DISTINCT FROM 'array' THEN false
      ELSE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_artifact#>'{runtime,assets}') ref
          WHERE NOT EXISTS (
            SELECT 1 FROM public.blocks_asset_aliases alias
            JOIN public.blocks_blobs blob ON blob.tenant_id = alias.tenant_id
                 AND blob.data_format = alias.data_format AND blob.sha256 = alias.sha256
            WHERE alias.tenant_id = p_tenant AND alias.asset_id = ref->>'assetId'
              AND alias.data_format = ref->>'dataFormat' AND alias.sha256 = ref->>'sha256'
              AND blob.size_bytes::text = ref->>'sizeBytes'
              AND blob.object_key = 'tenants/' || p_tenant::text || '/blocks/assets/' ||
                  left(blob.sha256,2) || '/' || blob.sha256 || '.' || blob.data_format
          )
      ) END;
$$;

-- Both Seat-owned scopes get their originating class from the canonical Seat.
CREATE FUNCTION public.classroom_publication_eligible(
    p_project uuid, p_tenant uuid, p_class uuid, p_seat uuid, p_owner uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.projects project
        JOIN public.principals actor ON actor.id = p_owner AND actor.kind = 'student_seat' AND actor.seat_id = p_seat
        JOIN public.classroom_student_seats seat ON seat.id = p_seat AND seat.tenant_id = p_tenant
         AND seat.classroom_id = p_class AND seat.status = 'active'
        JOIN public.classrooms class ON class.id = p_class AND class.tenant_id = p_tenant AND class.status = 'active'
        WHERE project.id = p_project AND project.tenant_id = p_tenant AND project.owner_principal_id = p_owner
          AND public.project_distribution_allowed(project.id, 'publish')
          AND NOT public.classroom_gallery_project_safe_mode(project.id)
          AND NOT EXISTS (SELECT 1 FROM public.classroom_gallery_safe_mode_revocations revoked
                           WHERE revoked.project_id = project.id)
    );
$$;

CREATE FUNCTION public.classroom_publication_request_result(p_request public.classroom_publication_requests)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'requestId', p_request.id, 'state', p_request.state, 'sourceRevision', p_request.source_revision,
        'moduleKey', p_request.module_key, 'metadata', p_request.metadata, 'createdAt', p_request.created_at,
        'publicationId', p_request.publication_id, 'publicationRevisionId', p_request.publication_revision_id
    ));
$$;

-- Every writer takes School class/Seat locks before these Project->Draft->Snapshot
-- locks. The existing canonical publish writer then reuses all these row locks.
CREATE FUNCTION public.classroom_publication_lock_source(p_project uuid, p_tenant uuid, p_revision integer)
RETURNS bytea
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM 1 FROM public.projects WHERE id = p_project AND tenant_id = p_tenant FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM 1 FROM public.project_drafts
     WHERE project_id = p_project AND tenant_id = p_tenant AND revision = p_revision FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM 1 FROM public.project_snapshots
     WHERE project_id = p_project AND tenant_id = p_tenant AND source_revision = p_revision FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    RETURN public.classroom_publication_source_digest(p_project, p_tenant, p_revision);
END;
$$;

-- The author route alone needs to build the closed projection in the API.
-- A reviewer never receives the draft from SQL or the API.
CREATE FUNCTION public.classroom_publication_author_source(
    p_actor uuid, p_project uuid, p_hash varchar, p_revision integer
) RETURNS TABLE(module_key varchar, document_json jsonb, source_seal bytea)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_seat public.classroom_student_seats;
    v_digest bytea;
BEGIN
    IF NOT public.project_distribution_seat_lock(p_actor, p_project, p_hash, 'publish') THEN
        RAISE EXCEPTION 'publication_forbidden' USING ERRCODE = 'P5P01';
    END IF;
    SELECT seat.* INTO v_seat FROM public.principals actor
      JOIN public.classroom_student_seats seat ON seat.id = actor.seat_id WHERE actor.id = p_actor;
    v_digest := public.classroom_publication_lock_source(p_project, v_seat.tenant_id, p_revision);
    IF NOT public.classroom_publication_eligible(p_project, v_seat.tenant_id, v_seat.classroom_id, v_seat.id, p_actor) THEN
        RAISE EXCEPTION 'publication_forbidden' USING ERRCODE = 'P5P01';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.projects project WHERE project.id = p_project
                   AND project.module_key IN ('three-d','electronics','robotics','blocks')) THEN
        RAISE EXCEPTION 'publication review preview unsupported' USING ERRCODE = 'P5A10';
    END IF;
    IF v_digest IS NULL THEN RAISE EXCEPTION 'preview_required' USING ERRCODE = 'P5P02'; END IF;
    RETURN QUERY SELECT project.module_key, draft.document_json, v_digest
        FROM public.projects project JOIN public.project_drafts draft ON draft.project_id = project.id
        WHERE project.id = p_project AND draft.tenant_id = v_seat.tenant_id AND draft.revision = p_revision;
END;
$$;

CREATE FUNCTION public.classroom_publication_request_create(
    p_actor uuid, p_project uuid, p_hash varchar, p_expected_revision integer, p_metadata jsonb, p_request_key uuid,
    p_source_seal bytea, p_artifact jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_project public.projects;
    v_seat public.classroom_student_seats;
    v_prior public.classroom_publication_requests;
    v_active public.classroom_publication_requests;
    v_metadata jsonb;
    v_digest bytea;
    v_input_digest bytea;
BEGIN
    IF p_request_key IS NULL OR COALESCE(p_expected_revision, 0) <= 0 THEN
        RAISE EXCEPTION 'invalid publication request' USING ERRCODE = 'P5P03';
    END IF;
    IF NOT public.project_distribution_seat_lock(p_actor, p_project, p_hash, 'publish') THEN
        RAISE EXCEPTION 'publication_forbidden' USING ERRCODE = 'P5P01';
    END IF;
    SELECT seat.* INTO v_seat FROM public.principals actor
      JOIN public.classroom_student_seats seat ON seat.id = actor.seat_id WHERE actor.id = p_actor;
    v_digest := public.classroom_publication_lock_source(p_project, v_seat.tenant_id, p_expected_revision);
    IF NOT public.classroom_publication_eligible(p_project, v_seat.tenant_id, v_seat.classroom_id, v_seat.id, p_actor) THEN
        RAISE EXCEPTION 'publication_forbidden' USING ERRCODE = 'P5P01';
    END IF;
    SELECT * INTO v_project FROM public.projects WHERE id = p_project;
    v_input_digest := sha256(convert_to(jsonb_build_array(
        p_expected_revision, COALESCE(p_metadata, '{}'::jsonb)
    )::text, 'UTF8'));

    SELECT * INTO v_prior FROM public.classroom_publication_requests candidate
     WHERE candidate.project_id = p_project AND candidate.owner_principal_id = p_actor
       AND candidate.request_key = p_request_key FOR UPDATE;
    IF FOUND THEN
        IF v_prior.request_input_digest <> v_input_digest THEN
            RAISE EXCEPTION 'publication request conflict' USING ERRCODE = 'P5A09';
        END IF;
        IF v_prior.state IN ('waiting_teacher','waiting_platform','approved')
           AND (v_prior.source_digest IS DISTINCT FROM v_digest OR v_prior.module_key <> v_project.module_key
               OR NOT public.classroom_publication_scratch_assets_match(v_prior.tenant_id, v_prior.review_artifact)) THEN
            UPDATE public.classroom_publication_requests SET state = 'stale' WHERE id = v_prior.id
             RETURNING * INTO v_prior;
        END IF;
        RETURN public.classroom_publication_request_result(v_prior);
    END IF;
    IF v_digest IS NULL THEN RAISE EXCEPTION 'preview_required' USING ERRCODE = 'P5P02'; END IF;
    IF p_source_seal IS DISTINCT FROM v_digest THEN
        RAISE EXCEPTION 'publication source changed' USING ERRCODE = 'P5A09';
    END IF;
    IF NOT public.classroom_publication_scratch_assets_match(v_seat.tenant_id, p_artifact) THEN
        RAISE EXCEPTION 'publication review assets unavailable' USING ERRCODE = 'P5A10';
    END IF;
    v_metadata := public.classroom_publication_candidate_metadata(v_project, p_metadata);

    SELECT * INTO v_active FROM public.classroom_publication_requests candidate
     WHERE candidate.project_id = p_project AND candidate.state IN ('waiting_teacher','waiting_platform','approved')
     FOR UPDATE;
    IF FOUND THEN
        IF v_active.source_revision = p_expected_revision AND v_active.source_digest = v_digest
           AND v_active.metadata = v_metadata AND v_active.module_key = v_project.module_key THEN
            RAISE EXCEPTION 'publication request pending' USING ERRCODE = 'P5A09';
        END IF;
        UPDATE public.classroom_publication_requests SET state = 'stale' WHERE id = v_active.id;
    END IF;
    INSERT INTO public.classroom_publication_requests (
        project_id, tenant_id, classroom_id, seat_id, owner_principal_id, request_key, request_input_digest,
        source_revision, source_digest, module_key, review_artifact, metadata
    ) VALUES (
        p_project, v_seat.tenant_id, v_seat.classroom_id, v_seat.id, p_actor, p_request_key, v_input_digest,
        p_expected_revision, v_digest, v_project.module_key, p_artifact, v_metadata
    ) RETURNING * INTO v_prior;
    RETURN public.classroom_publication_request_result(v_prior);
END;
$$;

-- Moderator writes share School locks with permission/Safe Mode/revocation writers.
-- The caller must recheck current source identity after taking the Project lock.
CREATE FUNCTION public.classroom_publication_reviewer_allowed(
    p_actor uuid, p_role text, p_candidate public.classroom_publication_requests
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT CASE p_role WHEN 'teacher' THEN public.classroom_games_teacher(
        p_actor, p_candidate.tenant_id, p_candidate.classroom_id
    ) WHEN 'platform' THEN p_candidate.teacher_approved IS TRUE
         AND public.admin_authorized_role(p_actor, 'platform', NULL) IS NOT DISTINCT FROM 'platform_admin'
    ELSE false END;
$$;

CREATE FUNCTION public.classroom_publication_request_review(
    p_actor uuid, p_role text, p_class uuid, p_request uuid, p_approve boolean
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_candidate public.classroom_publication_requests;
    v_digest bytea;
BEGIN
    IF p_approve IS NULL OR COALESCE(p_role, '') NOT IN ('teacher','platform') THEN
        RAISE EXCEPTION 'invalid publication decision' USING ERRCODE = 'P5P03';
    END IF;
    SELECT * INTO v_candidate FROM public.classroom_publication_requests WHERE id = p_request;
    IF NOT FOUND OR (p_role = 'teacher' AND p_class IS DISTINCT FROM v_candidate.classroom_id)
       OR (p_role = 'platform' AND p_class IS NOT NULL)
       OR NOT public.classroom_publication_reviewer_allowed(p_actor, p_role, v_candidate) THEN
        RAISE EXCEPTION 'not_available' USING ERRCODE = 'P5P04';
    END IF;

    PERFORM 1 FROM public.classrooms
      WHERE id = v_candidate.classroom_id AND tenant_id = v_candidate.tenant_id FOR SHARE;
    PERFORM 1 FROM public.classroom_student_seats
      WHERE id = v_candidate.seat_id AND tenant_id = v_candidate.tenant_id
        AND classroom_id = v_candidate.classroom_id FOR SHARE;
    PERFORM 1 FROM public.learner_identity_links link
      JOIN public.learner_identities learner ON learner.id = link.learner_identity_id
      WHERE link.seat_id = v_candidate.seat_id AND link.link_kind = 'student_seat'
        AND link.tenant_id = v_candidate.tenant_id AND link.status = 'active'
      FOR SHARE OF link, learner;
    IF p_role = 'teacher' THEN
        PERFORM 1 FROM public.principals actor
          JOIN public.accounts account ON account.id = actor.account_id AND account.status = 'active'
          JOIN public.classroom_memberships membership ON membership.account_id = account.id
           AND membership.classroom_id = v_candidate.classroom_id AND membership.member_role IN ('owner','co_teacher')
          JOIN public.capability_grants grant_row ON grant_row.account_id = account.id
           AND grant_row.capability = 'educator' AND grant_row.state IN ('verified','provisional')
          WHERE actor.id = p_actor AND actor.kind = 'account'
          FOR SHARE OF account, membership, grant_row;
    ELSE
        PERFORM 1 FROM public.principals actor
          JOIN public.accounts account ON account.id = actor.account_id AND account.status = 'active'
          JOIN public.capability_grants grant_row ON grant_row.account_id = account.id
           AND grant_row.capability = 'platform_admin' AND grant_row.state = 'verified'
          WHERE actor.id = p_actor AND actor.kind = 'account' FOR SHARE OF account, grant_row;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_available' USING ERRCODE = 'P5P04'; END IF;

    v_digest := public.classroom_publication_lock_source(
        v_candidate.project_id, v_candidate.tenant_id, v_candidate.source_revision
    );
    SELECT * INTO v_candidate FROM public.classroom_publication_requests WHERE id = p_request FOR UPDATE;
    IF NOT FOUND OR NOT public.classroom_publication_reviewer_allowed(p_actor, p_role, v_candidate)
       OR NOT public.classroom_publication_eligible(
           v_candidate.project_id, v_candidate.tenant_id, v_candidate.classroom_id,
           v_candidate.seat_id, v_candidate.owner_principal_id
       ) THEN RAISE EXCEPTION 'not_available' USING ERRCODE = 'P5P04'; END IF;
    IF v_candidate.state IN ('waiting_teacher','waiting_platform','approved')
       AND (v_candidate.source_digest IS DISTINCT FROM v_digest
           OR NOT public.classroom_publication_scratch_assets_match(v_candidate.tenant_id, v_candidate.review_artifact)
           OR NOT EXISTS (
            SELECT 1 FROM public.projects project WHERE project.id = v_candidate.project_id
             AND project.module_key = v_candidate.module_key
       )) THEN
        UPDATE public.classroom_publication_requests SET state = 'stale' WHERE id = p_request
         RETURNING * INTO v_candidate;
        RETURN jsonb_build_object('requestId', p_request, 'state', 'stale');
    END IF;
    IF p_role = 'teacher' AND v_candidate.teacher_actor = p_actor
       AND v_candidate.teacher_approved = p_approve THEN
        RETURN public.classroom_publication_request_result(v_candidate);
    ELSIF p_role = 'platform' AND v_candidate.platform_actor = p_actor
       AND v_candidate.platform_approved = p_approve THEN
        RETURN public.classroom_publication_request_result(v_candidate);
    ELSIF p_role = 'teacher' AND v_candidate.state = 'waiting_teacher' THEN
        UPDATE public.classroom_publication_requests
           SET state = CASE WHEN p_approve THEN 'waiting_platform' ELSE 'rejected' END,
               teacher_actor = p_actor, teacher_approved = p_approve, teacher_decided_at = clock_timestamp()
         WHERE id = p_request RETURNING * INTO v_candidate;
    ELSIF p_role = 'platform' AND v_candidate.state = 'waiting_platform' THEN
        UPDATE public.classroom_publication_requests
           SET state = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
               platform_actor = p_actor, platform_approved = p_approve, platform_decided_at = clock_timestamp()
         WHERE id = p_request RETURNING * INTO v_candidate;
    ELSE
        RAISE EXCEPTION 'publication request conflict' USING ERRCODE = 'P5A09';
    END IF;
    RETURN public.classroom_publication_request_result(v_candidate);
END;
$$;

CREATE FUNCTION public.classroom_publication_request_publish(
    p_actor uuid, p_project uuid, p_hash varchar, p_request uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_candidate public.classroom_publication_requests;
    v_status jsonb;
    v_digest bytea;
BEGIN
    IF NOT public.project_distribution_seat_lock(p_actor, p_project, p_hash, 'publish') THEN
        RAISE EXCEPTION 'publication_forbidden' USING ERRCODE = 'P5P01';
    END IF;
    SELECT * INTO v_candidate FROM public.classroom_publication_requests
     WHERE id = p_request AND project_id = p_project AND owner_principal_id = p_actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_available' USING ERRCODE = 'P5P04'; END IF;
    v_digest := public.classroom_publication_lock_source(p_project, v_candidate.tenant_id, v_candidate.source_revision);
    SELECT * INTO v_candidate FROM public.classroom_publication_requests
     WHERE id = p_request AND project_id = p_project AND owner_principal_id = p_actor FOR UPDATE;
    IF NOT FOUND OR NOT public.classroom_publication_eligible(
        p_project, v_candidate.tenant_id, v_candidate.classroom_id, v_candidate.seat_id, p_actor
    ) THEN RAISE EXCEPTION 'publication_forbidden' USING ERRCODE = 'P5P01'; END IF;
    IF v_candidate.state = 'published' THEN
        RETURN public.classroom_publication_request_result(v_candidate);
    END IF;
    IF v_candidate.state IN ('waiting_teacher','waiting_platform','approved')
       AND (v_candidate.source_digest IS DISTINCT FROM v_digest
           OR NOT public.classroom_publication_scratch_assets_match(v_candidate.tenant_id, v_candidate.review_artifact)
           OR NOT EXISTS (
            SELECT 1 FROM public.projects project WHERE project.id = p_project
             AND project.module_key = v_candidate.module_key
       )) THEN
        UPDATE public.classroom_publication_requests SET state = 'stale' WHERE id = p_request;
        RETURN jsonb_build_object('requestId', p_request, 'state', 'stale');
    END IF;
    IF v_candidate.state <> 'approved' THEN
        RAISE EXCEPTION 'publication approval required' USING ERRCODE = 'P5A09';
    END IF;

    -- No request body can replace the already approved publication metadata.
    v_status := public.project_publication_publish_admitted(p_actor, p_project, v_candidate.metadata);
    UPDATE public.classroom_publication_requests SET state = 'published',
        publication_id = (v_status#>>'{publication,publicationId}')::uuid,
        publication_revision_id = (v_status#>>'{publication,revisionId}')::uuid
     WHERE id = p_request RETURNING * INTO v_candidate;
    RETURN public.classroom_publication_request_result(v_candidate);
END;
$$;

-- The raw four-argument Seat command remains compatible as a denied route.
-- Account and legacy Gallery commands already admit only Account principals.
CREATE OR REPLACE FUNCTION public.project_publication_publish_seat(
    p_actor uuid, p_project uuid, p_metadata jsonb, p_hash varchar
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF public.project_distribution_seat_lock(p_actor, p_project, p_hash, 'publish') AND (
        public.classroom_gallery_project_safe_mode(p_project)
        OR EXISTS (SELECT 1 FROM public.classroom_gallery_safe_mode_revocations revoked
                    WHERE revoked.project_id = p_project)
    ) THEN RAISE EXCEPTION 'classroom_safe_mode' USING ERRCODE = 'P5S01'; END IF;
    RAISE EXCEPTION 'publication_forbidden' USING ERRCODE = 'P5P01';
END;
$$;

CREATE FUNCTION public.classroom_publication_request_owner(
    p_actor uuid, p_project uuid, p_hash varchar
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_candidate public.classroom_publication_requests;
BEGIN
    IF NOT public.project_distribution_seat_lock(p_actor, p_project, p_hash, 'publish') THEN
        RETURN NULL;
    END IF;
    SELECT * INTO v_candidate FROM public.classroom_publication_requests
     WHERE project_id = p_project AND owner_principal_id = p_actor
     ORDER BY created_at DESC, id DESC LIMIT 1;
    IF NOT FOUND OR NOT public.classroom_publication_eligible(
        p_project, v_candidate.tenant_id, v_candidate.classroom_id, v_candidate.seat_id, p_actor
    ) THEN RETURN NULL; END IF;
    IF v_candidate.state IN ('waiting_teacher','waiting_platform','approved')
       AND (v_candidate.source_digest IS DISTINCT FROM public.classroom_publication_source_digest(
           p_project, v_candidate.tenant_id, v_candidate.source_revision
       ) OR NOT public.classroom_publication_scratch_assets_match(v_candidate.tenant_id, v_candidate.review_artifact)
       OR NOT EXISTS (
            SELECT 1 FROM public.projects project WHERE project.id = p_project
             AND project.module_key = v_candidate.module_key
       )) THEN
        RETURN jsonb_build_object('requestId', v_candidate.id, 'state', 'stale');
    END IF;
    RETURN public.classroom_publication_request_result(v_candidate);
END;
$$;

-- Summaries contain only candidate metadata. No pupil identifiers, private
-- paths, source documents or content hashes are returned to either review queue.
CREATE FUNCTION public.classroom_publication_request_queue(
    p_actor uuid, p_role text, p_class uuid, p_limit integer, p_offset integer
) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT public.classroom_publication_request_result(candidate)
    FROM public.classroom_publication_requests candidate
    JOIN public.projects project ON project.id = candidate.project_id AND project.module_key = candidate.module_key
    WHERE (
        (p_role = 'teacher' AND candidate.classroom_id = p_class AND candidate.state = 'waiting_teacher')
        OR (p_role = 'platform' AND p_class IS NULL AND candidate.state = 'waiting_platform')
    )
      AND public.classroom_publication_reviewer_allowed(p_actor, p_role, candidate)
      AND public.classroom_publication_eligible(candidate.project_id, candidate.tenant_id, candidate.classroom_id,
                                               candidate.seat_id, candidate.owner_principal_id)
      AND public.classroom_publication_scratch_assets_match(candidate.tenant_id, candidate.review_artifact)
      AND candidate.source_digest = public.classroom_publication_source_digest(
          candidate.project_id, candidate.tenant_id, candidate.source_revision
      )
    ORDER BY candidate.created_at, candidate.id
    LIMIT LEAST(50, GREATEST(1, p_limit)) OFFSET LEAST(10000, GREATEST(0, p_offset));
$$;

-- Authorize the same role/stage as the corresponding queue, and return the
-- approved candidate's exact raster only while the seal still matches.
CREATE FUNCTION public.classroom_publication_request_raster(p_actor uuid, p_role text, p_class uuid, p_request uuid)
RETURNS TABLE(image bytea, content_type varchar, width integer, height integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT snapshot.image, snapshot.content_type, snapshot.width, snapshot.height
    FROM public.classroom_publication_requests candidate
    JOIN public.projects project ON project.id = candidate.project_id AND project.module_key = candidate.module_key
    JOIN public.project_snapshots snapshot ON snapshot.project_id = candidate.project_id
     AND snapshot.tenant_id = candidate.tenant_id AND snapshot.source_revision = candidate.source_revision
    WHERE candidate.id = p_request AND (
        (p_role = 'teacher' AND candidate.classroom_id = p_class AND candidate.state = 'waiting_teacher')
        OR (p_role = 'platform' AND p_class IS NULL AND candidate.state = 'waiting_platform')
    )
      AND public.classroom_publication_reviewer_allowed(p_actor, p_role, candidate)
      AND public.classroom_publication_eligible(candidate.project_id, candidate.tenant_id, candidate.classroom_id,
                                               candidate.seat_id, candidate.owner_principal_id)
      AND public.classroom_publication_scratch_assets_match(candidate.tenant_id, candidate.review_artifact)
      AND candidate.source_digest = public.classroom_publication_source_digest(
          candidate.project_id, candidate.tenant_id, candidate.source_revision
      );
$$;

CREATE FUNCTION public.classroom_publication_read_review_candidate(p_actor uuid, p_role text, p_class uuid, p_request uuid)
RETURNS SETOF public.classroom_publication_requests
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT candidate.*
    FROM public.classroom_publication_requests candidate
    JOIN public.projects project ON project.id = candidate.project_id AND project.module_key = candidate.module_key
    WHERE candidate.id = p_request AND (
        (p_role = 'teacher' AND candidate.classroom_id = p_class AND candidate.state = 'waiting_teacher')
        OR (p_role = 'platform' AND p_class IS NULL AND candidate.state = 'waiting_platform')
    )
      AND public.classroom_publication_reviewer_allowed(p_actor, p_role, candidate)
      AND public.classroom_publication_eligible(candidate.project_id, candidate.tenant_id, candidate.classroom_id,
                                               candidate.seat_id, candidate.owner_principal_id)
      AND public.classroom_publication_scratch_assets_match(candidate.tenant_id, candidate.review_artifact)
      AND candidate.source_digest = public.classroom_publication_source_digest(
          candidate.project_id, candidate.tenant_id, candidate.source_revision
      );
$$;

CREATE FUNCTION public.classroom_publication_request_artifact(p_actor uuid, p_role text, p_class uuid, p_request uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT jsonb_build_object('requestId', candidate.id, 'sourceRevision', candidate.source_revision,
        'artifact', jsonb_set(candidate.review_artifact - 'runtime', '{provenance,publicationId}', to_jsonb(candidate.id)))
    FROM public.classroom_publication_read_review_candidate(p_actor,p_role,p_class,p_request) candidate;
$$;

CREATE FUNCTION public.classroom_publication_student_scratch_source(p_actor uuid, p_role text, p_class uuid, p_request uuid)
RETURNS TABLE(source_revision integer, document_json jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT candidate.source_revision,candidate.review_artifact->'runtime'
    FROM public.classroom_publication_read_review_candidate(p_actor,p_role,p_class,p_request) candidate
    WHERE candidate.module_key = 'blocks';
$$;

CREATE FUNCTION public.classroom_publication_student_scratch_asset(
    p_actor uuid,p_role text,p_class uuid,p_request uuid,p_revision integer,p_asset text,p_format text
) RETURNS TABLE(tenant_id uuid,asset_id varchar,data_format varchar,sha256 varchar,size_bytes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT candidate.tenant_id,alias.asset_id,alias.data_format,alias.sha256,blob.size_bytes
    FROM public.classroom_publication_read_review_candidate(p_actor,p_role,p_class,p_request) candidate
    JOIN public.blocks_asset_aliases alias ON alias.tenant_id = candidate.tenant_id
         AND alias.asset_id = p_asset AND alias.data_format = p_format
    JOIN public.blocks_blobs blob ON blob.tenant_id = alias.tenant_id
         AND blob.data_format = alias.data_format AND blob.sha256 = alias.sha256
    WHERE candidate.module_key = 'blocks' AND candidate.source_revision = p_revision
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(candidate.review_artifact#>'{runtime,assets}') ref
         WHERE ref->>'assetId' = alias.asset_id AND ref->>'dataFormat' = alias.data_format
           AND ref->>'sha256' = alias.sha256 AND ref->>'sizeBytes' = blob.size_bytes::text
      );
$$;

-- Newly approved Seat Scratch publications present exactly the reviewed VM
-- projection. Historical and Account publications retain the old source path.
CREATE OR REPLACE FUNCTION public.public_scratch_player_source(p_publication uuid, p_revision uuid)
RETURNS TABLE(document_json jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT COALESCE(approved.runtime, version.document_json)
    FROM public.project_publication_state state
    JOIN public.project_publication_revisions revision
      ON revision.id = state.current_revision_id AND revision.id = p_revision
     AND revision.publication_id = state.id AND revision.project_id = state.project_id
     AND revision.tenant_id = state.tenant_id
    JOIN public.project_versions version
      ON version.id = revision.project_version_id AND version.project_id = state.project_id
     AND version.tenant_id = state.tenant_id
    LEFT JOIN LATERAL (
        SELECT candidate.review_artifact->'runtime' AS runtime
        FROM public.classroom_publication_requests candidate
        WHERE candidate.publication_id = state.id AND candidate.publication_revision_id = revision.id
          AND candidate.project_id = state.project_id AND candidate.tenant_id = state.tenant_id
          AND candidate.owner_principal_id = state.owner_principal_id
          AND candidate.module_key = 'blocks' AND candidate.state = 'published'
        ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
    ) approved ON true
    WHERE state.id = p_publication AND revision.schema_version = 2 AND revision.module_key = 'blocks'
      AND octet_length(version.document_json::text) <= 16777216
      AND public.project_publication_readable(state.id);
$$;
REVOKE ALL ON FUNCTION public.public_scratch_player_source(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_scratch_player_source(uuid,uuid) TO asalab_app;

REVOKE ALL ON FUNCTION public.classroom_publication_source_digest(uuid,uuid,integer),
    public.classroom_publication_candidate_metadata(public.projects,jsonb),
    public.classroom_publication_eligible(uuid,uuid,uuid,uuid,uuid),
    public.classroom_publication_request_result(public.classroom_publication_requests),
    public.classroom_publication_lock_source(uuid,uuid,integer),
    public.classroom_publication_reviewer_allowed(uuid,text,public.classroom_publication_requests),
    public.classroom_publication_scratch_assets_match(uuid,jsonb),
    public.classroom_publication_read_review_candidate(uuid,text,uuid,uuid)
    FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION public.classroom_publication_author_source(uuid,uuid,varchar,integer),
    public.classroom_publication_request_create(uuid,uuid,varchar,integer,jsonb,uuid,bytea,jsonb),
    public.classroom_publication_request_review(uuid,text,uuid,uuid,boolean),
    public.classroom_publication_request_publish(uuid,uuid,varchar,uuid),
    public.classroom_publication_request_owner(uuid,uuid,varchar),
    public.classroom_publication_request_queue(uuid,text,uuid,integer,integer),
    public.classroom_publication_request_raster(uuid,text,uuid,uuid),
    public.classroom_publication_request_artifact(uuid,text,uuid,uuid),
    public.classroom_publication_student_scratch_source(uuid,text,uuid,uuid),
    public.classroom_publication_student_scratch_asset(uuid,text,uuid,uuid,integer,text,text)
    FROM PUBLIC, asalab_app;
GRANT EXECUTE ON FUNCTION public.classroom_publication_author_source(uuid,uuid,varchar,integer),
    public.classroom_publication_request_create(uuid,uuid,varchar,integer,jsonb,uuid,bytea,jsonb),
    public.classroom_publication_request_review(uuid,text,uuid,uuid,boolean),
    public.classroom_publication_request_publish(uuid,uuid,varchar,uuid),
    public.classroom_publication_request_owner(uuid,uuid,varchar),
    public.classroom_publication_request_queue(uuid,text,uuid,integer,integer),
    public.classroom_publication_request_raster(uuid,text,uuid,uuid),
    public.classroom_publication_request_artifact(uuid,text,uuid,uuid),
    public.classroom_publication_student_scratch_source(uuid,text,uuid,uuid),
    public.classroom_publication_student_scratch_asset(uuid,text,uuid,uuid,integer,text,text)
    TO asalab_app;
