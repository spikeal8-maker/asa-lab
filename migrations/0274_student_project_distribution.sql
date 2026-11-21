-- Class/Seat distribution controls. No implicit publication or personal Account restriction.
CREATE TABLE public.classroom_project_policies (
 classroom_id uuid PRIMARY KEY REFERENCES public.classrooms(id), tenant_id uuid NOT NULL,
 publish boolean NOT NULL DEFAULT false, download boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 UNIQUE(tenant_id,classroom_id),
 FOREIGN KEY(tenant_id,classroom_id) REFERENCES public.classrooms(tenant_id,id)
);
CREATE TABLE public.classroom_project_seat_overrides (
 seat_id uuid PRIMARY KEY REFERENCES public.classroom_student_seats(id), tenant_id uuid NOT NULL,
 classroom_id uuid NOT NULL, publish text NOT NULL CHECK(publish IN ('inherit','allow','deny')),
 download text NOT NULL CHECK(download IN ('inherit','allow','deny')),
 FOREIGN KEY(tenant_id,classroom_id) REFERENCES public.classroom_project_policies(tenant_id,classroom_id)
);
ALTER TABLE public.classroom_project_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_project_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_project_seat_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_project_seat_overrides FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.classroom_project_policies,public.classroom_project_seat_overrides FROM PUBLIC,asalab_app;

CREATE FUNCTION public.classroom_project_policy_read(p_actor uuid,p_tenant uuid,p_class uuid,p_seat uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.classroom_games_teacher(p_actor,p_tenant,p_class) THEN RETURN NULL; END IF;
 IF p_seat IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.classroom_student_seats s
 WHERE s.id=p_seat AND s.classroom_id=p_class AND s.tenant_id=p_tenant AND s.status<>'removed') THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('publish',COALESCE(p.publish,false),'download',COALESCE(p.download,false),
 'version',COALESCE(p.version,0)) INTO result FROM public.classrooms c
 LEFT JOIN public.classroom_project_policies p ON p.classroom_id=c.id AND p.tenant_id=c.tenant_id
 WHERE c.id=p_class AND c.tenant_id=p_tenant;
 IF p_seat IS NOT NULL THEN
 SELECT result||jsonb_build_object('publishOverride',COALESCE(o.publish,'inherit'),
 'downloadOverride',COALESCE(o.download,'inherit')) INTO result FROM public.classroom_student_seats s
 LEFT JOIN public.classroom_project_seat_overrides o ON o.seat_id=s.id
 AND o.classroom_id=s.classroom_id AND o.tenant_id=s.tenant_id WHERE s.id=p_seat;
 END IF;
 RETURN result;
END; $$;

CREATE FUNCTION public.classroom_project_policy_write(p_actor uuid,p_tenant uuid,p_class uuid,p_seat uuid,p_input jsonb,p_request text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_before jsonb; v_after jsonb; v_expected integer;
BEGIN
 PERFORM 1 FROM public.classrooms c WHERE c.id=p_class AND c.tenant_id=p_tenant FOR UPDATE;
 IF NOT FOUND OR NOT public.classroom_games_teacher(p_actor,p_tenant,p_class) THEN RETURN '{"error":"forbidden"}'; END IF;
 IF p_seat IS NOT NULL THEN
 PERFORM 1 FROM public.classroom_student_seats s WHERE s.id=p_seat AND s.classroom_id=p_class
 AND s.tenant_id=p_tenant AND s.status<>'removed' FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"error":"forbidden"}'; END IF;
 END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR length(p_request) NOT BETWEEN 1 AND 120 OR p_request IS NULL
 OR jsonb_typeof(p_input->'expectedVersion') IS DISTINCT FROM 'number'
 OR (p_input->>'expectedVersion') !~ '^(0|[1-9][0-9]{0,9})$' THEN RETURN '{"error":"invalid_policy"}'; END IF;
 BEGIN v_expected:=(p_input->>'expectedVersion')::integer;
 EXCEPTION WHEN numeric_value_out_of_range THEN RETURN '{"error":"invalid_policy"}'; END;
 IF p_seat IS NULL THEN
 IF p_input-ARRAY['publish','download','expectedVersion']<>'{}'::jsonb
 OR jsonb_typeof(p_input->'publish') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(p_input->'download') IS DISTINCT FROM 'boolean' THEN RETURN '{"error":"invalid_policy"}'; END IF;
 ELSE
 IF p_input-ARRAY['publishOverride','downloadOverride','expectedVersion']<>'{}'::jsonb
 OR COALESCE(p_input->>'publishOverride','') NOT IN ('inherit','allow','deny')
 OR COALESCE(p_input->>'downloadOverride','') NOT IN ('inherit','allow','deny') THEN RETURN '{"error":"invalid_policy"}'; END IF;
 END IF;
 v_before:=public.classroom_project_policy_read(p_actor,p_tenant,p_class,p_seat);
 IF (v_before->>'version')::integer<>v_expected OR v_expected=2147483647 THEN RETURN '{"error":"version_conflict"}'; END IF;
 INSERT INTO public.classroom_project_policies(classroom_id,tenant_id) VALUES(p_class,p_tenant) ON CONFLICT DO NOTHING;
 IF p_seat IS NULL THEN
 UPDATE public.classroom_project_policies SET publish=(p_input->>'publish')::boolean,download=(p_input->>'download')::boolean WHERE classroom_id=p_class;
 ELSE
 INSERT INTO public.classroom_project_seat_overrides(seat_id,tenant_id,classroom_id,publish,download)
 VALUES(p_seat,p_tenant,p_class,p_input->>'publishOverride',p_input->>'downloadOverride')
 ON CONFLICT(seat_id) DO UPDATE SET tenant_id=excluded.tenant_id,classroom_id=excluded.classroom_id,publish=excluded.publish,download=excluded.download;
 END IF;
 UPDATE public.classroom_project_policies SET version=version+1 WHERE classroom_id=p_class;
 v_after:=public.classroom_project_policy_read(p_actor,p_tenant,p_class,p_seat);
 INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
 VALUES(p_tenant,'classroom',p_class,'classroom.projects.policy',jsonb_build_object(
 'actorId',p_actor,'seatId',p_seat,'before',v_before,'after',v_after,'requestId',p_request));
 RETURN v_after;
END; $$;

-- Safety/read eligibility excludes permission flags: disabling writes preserves explicit publications.
CREATE FUNCTION public.project_publication_seat_active(p_actor uuid,p_tenant uuid,p_class uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.principals actor
 JOIN public.classroom_student_seats s ON s.id=actor.seat_id AND s.status='active'
 JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id AND c.status='active'
 JOIN public.learner_identity_links link ON link.seat_id=s.id AND link.link_kind='student_seat'
 AND link.status='active' AND link.disabled_at IS NULL AND link.tenant_id=c.tenant_id AND link.school_id=c.school_id
 JOIN public.learner_identities learner ON learner.id=link.learner_identity_id AND learner.state='active'
 AND learner.tenant_id=c.tenant_id AND learner.school_id=c.school_id
 WHERE actor.id=p_actor AND actor.kind='student_seat'
 AND (p_class IS NULL OR c.id=p_class) AND c.tenant_id=p_tenant);
$$;

CREATE OR REPLACE FUNCTION public.project_publication_policy_reason(p_project_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p record;
BEGIN
 SELECT project.*,actor.kind,account.status account_status INTO p FROM public.projects project
 JOIN public.principals actor ON actor.id=project.owner_principal_id
 LEFT JOIN public.accounts account ON account.id=actor.account_id WHERE project.id=p_project_id;
 IF NOT FOUND THEN RETURN 'not_available'; END IF;
 IF EXISTS(SELECT 1 FROM public.learning_project_origins WHERE project_id=p_project_id)
 OR EXISTS(SELECT 1 FROM public.learning_legacy_project_origins WHERE project_id=p_project_id)
 OR EXISTS(SELECT 1 FROM public.classroom_assignment_work WHERE project_id=p_project_id) THEN RETURN 'learning_work_protected'; END IF;
 IF p.status<>'active' THEN RETURN 'publication_forbidden'; END IF;
 IF p.kind='account' AND p.account_status='active' AND p.project_scope='personal' AND p.classroom_id IS NULL THEN RETURN NULL; END IF;
 IF p.kind='student_seat' AND ((p.project_scope='classroom' AND p.classroom_id IS NOT NULL) OR (p.project_scope='personal' AND p.classroom_id IS NULL)) AND p.module_key NOT IN ('chess','checkers')
 AND public.project_publication_seat_active(p.owner_principal_id,p.tenant_id,p.classroom_id) THEN RETURN NULL; END IF;
 RETURN 'publication_forbidden';
END; $$;

CREATE FUNCTION public.project_distribution_allowed(p_project uuid,p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.projects p JOIN public.principals actor ON actor.id=p.owner_principal_id
 LEFT JOIN public.classroom_student_seats seat ON seat.id=actor.seat_id AND seat.tenant_id=p.tenant_id
 LEFT JOIN public.classroom_project_policies policy ON policy.classroom_id=seat.classroom_id AND policy.tenant_id=p.tenant_id
 LEFT JOIN public.classroom_project_seat_overrides o ON o.seat_id=actor.seat_id AND o.classroom_id=seat.classroom_id AND o.tenant_id=p.tenant_id
 WHERE p.id=p_project AND p_action IN ('publish','download') AND public.project_publication_policy_reason(p.id) IS NULL
 AND (actor.kind='account' OR CASE WHEN p_action='publish' THEN
 CASE COALESCE(o.publish,'inherit') WHEN 'allow' THEN true WHEN 'deny' THEN false ELSE COALESCE(policy.publish,false) END
 ELSE CASE COALESCE(o.download,'inherit') WHEN 'allow' THEN true WHEN 'deny' THEN false ELSE COALESCE(policy.download,false) END END));
$$;

CREATE FUNCTION public.project_distribution_identity_lock(
 p_actor uuid,p_tenant uuid,p_class uuid,p_seat uuid,p_session_hash varchar
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM 1 FROM public.classrooms c
 WHERE c.id=p_class AND c.tenant_id=p_tenant AND c.status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.classroom_student_seats s
 JOIN public.principals actor ON actor.seat_id=s.id AND actor.kind='student_seat'
 WHERE actor.id=p_actor AND s.id=p_seat AND s.classroom_id=p_class
   AND s.tenant_id=p_tenant AND s.status='active' FOR SHARE OF s;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.classroom_seat_credentials credential
 JOIN public.classroom_student_sessions session
   ON session.seat_id=credential.seat_id AND session.credential_version=credential.version
 WHERE session.seat_id=p_seat AND session.token_hash=p_session_hash
   AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp()
   AND session.last_seen_at>clock_timestamp()-interval '60 minutes'
 FOR SHARE OF credential,session;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.learner_identity_links link
 JOIN public.learner_identities learner ON learner.id=link.learner_identity_id
 JOIN public.classrooms c ON c.id=p_class
 WHERE link.seat_id=p_seat AND link.link_kind='student_seat'
   AND link.status='active' AND link.disabled_at IS NULL AND learner.state='active'
   AND link.tenant_id=p_tenant AND learner.tenant_id=p_tenant
   AND link.school_id=c.school_id AND learner.school_id=c.school_id
 FOR SHARE OF link,learner;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN '{"eligible":true}'::jsonb;
END;
$$;


-- Trusted actor rights, independent of any source ownership or readability.
-- Export callers must hold this transaction open and authorize their exact source separately.
CREATE FUNCTION public.classroom_project_admission_lock(p_actor uuid,p_tenant uuid,p_class uuid,p_seat uuid,p_hash varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF public.project_distribution_identity_lock(p_actor,p_tenant,p_class,p_seat,p_hash) IS NULL THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('publish',CASE COALESCE(o.publish,'inherit') WHEN 'allow' THEN true WHEN 'deny' THEN false ELSE COALESCE(policy.publish,false) END,
 'download',CASE COALESCE(o.download,'inherit') WHEN 'allow' THEN true WHEN 'deny' THEN false ELSE COALESCE(policy.download,false) END,
 'version',COALESCE(policy.version,0)) INTO result
 FROM public.classroom_student_seats seat
 LEFT JOIN public.classroom_project_policies policy ON policy.classroom_id=seat.classroom_id AND policy.tenant_id=seat.tenant_id
 LEFT JOIN public.classroom_project_seat_overrides o ON o.seat_id=seat.id AND o.classroom_id=seat.classroom_id AND o.tenant_id=seat.tenant_id
 WHERE seat.id=p_seat AND seat.classroom_id=p_class AND seat.tenant_id=p_tenant;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.classroom_project_admission_lock(uuid,uuid,uuid,uuid,varchar) FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION public.classroom_project_admission_lock(uuid,uuid,uuid,uuid,varchar) TO asalab_app;

-- Fresh authenticated Seat admission, with shared School locks before Project.
CREATE FUNCTION public.project_distribution_seat_lock(p_actor uuid,p_project uuid,p_hash varchar,p_action text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p record; s uuid; admission jsonb;
BEGIN
 SELECT project.tenant_id,seat.classroom_id,actor.seat_id INTO p FROM public.projects project
 JOIN public.principals actor ON actor.id=project.owner_principal_id AND actor.kind='student_seat'
 JOIN public.classroom_student_seats seat ON seat.id=actor.seat_id AND seat.tenant_id=project.tenant_id
 WHERE project.id=p_project AND actor.id=p_actor;
 IF NOT FOUND THEN RETURN false; END IF;
 admission:=public.classroom_project_admission_lock(p_actor,p.tenant_id,p.classroom_id,p.seat_id,p_hash);
 IF admission IS NULL THEN RETURN false; END IF;
 IF p_action IS NULL OR p_action NOT IN ('publish','download') THEN RETURN false; END IF;
 RETURN COALESCE((admission->>p_action)::boolean,false) AND public.project_publication_policy_reason(p_project) IS NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.project_publication_status(p_principal_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_reason text; v_publication jsonb; v_moderation_reason text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.projects project
        JOIN public.principals actor ON actor.id = project.owner_principal_id
        LEFT JOIN public.accounts account ON account.id = actor.account_id
        WHERE project.id = p_project_id AND actor.id = p_principal_id
 AND ((actor.kind='account' AND account.status='active') OR public.project_publication_seat_active(actor.id,project.tenant_id,project.classroom_id))
    ) THEN RETURN NULL; END IF;

    v_reason := public.project_publication_policy_reason(p_project_id);
    IF v_reason IS NULL AND NOT public.project_distribution_allowed(p_project_id,'publish') THEN v_reason:='publication_forbidden'; END IF;
    IF v_reason IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.project_drafts draft
        JOIN public.project_snapshots snapshot
          ON snapshot.project_id = draft.project_id AND snapshot.tenant_id = draft.tenant_id
         AND snapshot.source_revision = draft.revision
        WHERE draft.project_id = p_project_id
    ) THEN v_reason := 'preview_required'; END IF;

    SELECT jsonb_build_object(
        'publicationId', state.id, 'revisionId', revision.id,
        'revisionNo', revision.revision_no, 'versionNo', version.version_no,
        'state', state.state, 'publishedAt', revision.published_at,
        'publicPath', CASE WHEN public.project_publication_readable(state.id)
                          THEN '#/public-projects/' || state.id::text ELSE NULL END
    ) INTO v_publication
    FROM public.project_publication_state state
    JOIN public.project_publication_revisions revision
      ON revision.id = state.current_revision_id AND revision.publication_id = state.id
    JOIN public.project_versions version ON version.id = revision.project_version_id
    WHERE state.project_id = p_project_id AND state.owner_principal_id = p_principal_id
      AND revision.schema_version = 2;

    v_moderation_reason := public.project_publication_owner_moderation_reason(p_principal_id, p_project_id);
    RETURN jsonb_build_object('publication', v_publication,
                              'canPublish', v_reason IS NULL, 'reasonCode', v_reason)
        || CASE WHEN v_moderation_reason IS NOT NULL
                THEN jsonb_build_object('moderationReason', v_moderation_reason)
                ELSE '{}'::jsonb END;
END;
$$;


CREATE FUNCTION public.project_publication_publish_admitted(
    p_principal_id uuid, p_project_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_project public.projects%ROWTYPE;
    v_snapshot public.project_snapshots%ROWTYPE;
    v_current public.project_publication_revisions%ROWTYPE;
    v_draft public.project_drafts%ROWTYPE;
    v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
    v_reason text; v_title varchar; v_description text; v_tags text[]; v_license varchar;
    v_author varchar; v_user uuid; v_publication_id uuid; v_revision_id uuid;
    v_version_id uuid; v_version_no integer; v_revision_no integer;
BEGIN
    -- Editor transactions without an immutable Learning origin acquire Project
    -- FOR UPDATE before Draft. Keep that order and strength, then freeze Draft
    -- + Snapshot. Protected originals are rejected below before touching Draft;
    -- their existing School writer order is not changed by publication.
    SELECT * INTO v_project FROM public.projects project
     WHERE project.id = p_project_id AND project.owner_principal_id = p_principal_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_available' USING ERRCODE = 'P5P04'; END IF;
    v_reason := public.project_publication_policy_reason(p_project_id);
    IF v_reason IS NULL AND NOT public.project_distribution_allowed(p_project_id,'publish') THEN v_reason:='publication_forbidden'; END IF;
    IF v_reason = 'learning_work_protected' THEN
        RAISE EXCEPTION 'learning_work_protected' USING ERRCODE = 'P5L01';
    ELSIF v_reason IS NOT NULL THEN
        RAISE EXCEPTION 'publication_forbidden' USING ERRCODE = 'P5P01';
    END IF;

    IF jsonb_typeof(v_metadata) IS DISTINCT FROM 'object'
       OR v_metadata - ARRAY['title','description','tags','license'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'invalid publication metadata' USING ERRCODE = 'P5P03';
    END IF;
    IF v_metadata ? 'title' AND jsonb_typeof(v_metadata->'title') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'invalid publication title' USING ERRCODE = 'P5P03';
    END IF;
    IF v_metadata ? 'description' AND jsonb_typeof(v_metadata->'description') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'invalid publication description' USING ERRCODE = 'P5P03';
    END IF;
    IF v_metadata ? 'license' AND jsonb_typeof(v_metadata->'license') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'invalid publication license' USING ERRCODE = 'P5P03';
    END IF;
    v_title := trim(CASE WHEN v_metadata ? 'title' THEN v_metadata->>'title' ELSE v_project.title END);
    v_description := NULLIF(trim(CASE WHEN v_metadata ? 'description'
        THEN v_metadata->>'description' ELSE v_project.description END), '');
    v_license := trim(CASE WHEN v_metadata ? 'license' THEN v_metadata->>'license' ELSE v_project.license END);
    v_tags := v_project.tags;
    IF v_metadata ? 'tags' THEN
        IF jsonb_typeof(v_metadata->'tags') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'invalid publication tags' USING ERRCODE = 'P5P03';
        END IF;
        IF jsonb_array_length(v_metadata->'tags') > 10 OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_metadata->'tags') item
            WHERE jsonb_typeof(item) <> 'string'
               OR length(trim(item #>> '{}')) NOT BETWEEN 1 AND 32
        ) THEN RAISE EXCEPTION 'invalid publication tags' USING ERRCODE = 'P5P03'; END IF;
        SELECT COALESCE(array_agg(tag ORDER BY tag), '{}'::text[]) INTO v_tags
        FROM (SELECT DISTINCT lower(trim(value)) AS tag
                FROM jsonb_array_elements_text(v_metadata->'tags')) normalized;
    END IF;
    IF length(v_title) NOT BETWEEN 1 AND 255 OR length(v_description) > 2000
       OR v_license NOT IN ('reserved','public-domain','cc-by','cc-by-sa','cc-by-nc') THEN
        RAISE EXCEPTION 'invalid publication metadata' USING ERRCODE = 'P5P03';
    END IF;

    SELECT * INTO v_draft FROM public.project_drafts draft
     WHERE draft.tenant_id = v_project.tenant_id AND draft.project_id = p_project_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'preview_required' USING ERRCODE = 'P5P02'; END IF;
    SELECT * INTO v_snapshot FROM public.project_snapshots snapshot
     WHERE snapshot.tenant_id = v_project.tenant_id AND snapshot.project_id = p_project_id
       AND snapshot.source_revision = v_draft.revision
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'preview_required' USING ERRCODE = 'P5P02'; END IF;

    SELECT COALESCE((
        SELECT NULLIF(left(trim(profile.display_name), 120), '')
        FROM public.profiles profile
        JOIN public.principals actor ON actor.account_id = profile.account_id
        WHERE actor.id = p_principal_id AND profile.visibility = 'public'
    ), 'Автор проекта') INTO v_author;
    SELECT link.user_id INTO v_user FROM public.legacy_user_account_links link
     WHERE link.tenant_id = v_project.tenant_id AND link.principal_id = p_principal_id
       AND link.migration_state = 'active' LIMIT 1;

    INSERT INTO public.project_publication_state AS state
        (tenant_id, project_id, owner_principal_id, created_by_principal_id)
    VALUES (v_project.tenant_id, p_project_id, p_principal_id, p_principal_id)
    ON CONFLICT (tenant_id, project_id) DO UPDATE
        SET owner_principal_id = EXCLUDED.owner_principal_id
    RETURNING state.id, state.current_revision_id INTO v_publication_id, v_revision_id;

    SELECT version.id INTO v_version_id FROM public.project_versions version
     WHERE version.tenant_id = v_project.tenant_id AND version.project_id = p_project_id
       AND version.document_json = v_draft.document_json
     ORDER BY version.version_no DESC LIMIT 1;
    IF v_version_id IS NULL THEN
        SELECT COALESCE(max(version.version_no), 0) + 1 INTO v_version_no
          FROM public.project_versions version
         WHERE version.tenant_id = v_project.tenant_id AND version.project_id = p_project_id;
        INSERT INTO public.project_versions
            (tenant_id, project_id, version_no, document_json, label, created_by, created_by_principal_id)
        VALUES (v_project.tenant_id, p_project_id, v_version_no, v_draft.document_json,
                'Публикация', v_user, p_principal_id)
        RETURNING id INTO v_version_id;
    END IF;

    SELECT * INTO v_current FROM public.project_publication_revisions revision
     WHERE revision.id = v_revision_id AND revision.publication_id = v_publication_id;
    IF v_current.id IS NULL OR v_current.schema_version <> 2
       OR v_current.project_version_id IS DISTINCT FROM v_version_id
       OR v_current.title IS DISTINCT FROM v_title
       OR v_current.description IS DISTINCT FROM v_description
       OR v_current.tags IS DISTINCT FROM v_tags
       OR v_current.license IS DISTINCT FROM v_license
       OR v_current.module_key IS DISTINCT FROM v_project.module_key
       OR v_current.author_label IS DISTINCT FROM v_author
       OR v_current.preview_snapshot_revision IS DISTINCT FROM v_snapshot.source_revision
       OR v_current.preview_image IS DISTINCT FROM v_snapshot.image
       OR v_current.preview_content_type IS DISTINCT FROM v_snapshot.content_type
       OR v_current.preview_width IS DISTINCT FROM v_snapshot.width
       OR v_current.preview_height IS DISTINCT FROM v_snapshot.height THEN
        SELECT COALESCE(max(revision.revision_no), 0) + 1 INTO v_revision_no
          FROM public.project_publication_revisions revision
         WHERE revision.publication_id = v_publication_id;
        INSERT INTO public.project_publication_revisions
            (publication_id, tenant_id, project_id, revision_no, project_version_id,
             title, summary, description, tags, license, preview_snapshot_revision,
             published_by_principal_id, schema_version, module_key, author_label,
             preview_image, preview_content_type, preview_width, preview_height)
        VALUES (v_publication_id, v_project.tenant_id, p_project_id, v_revision_no, v_version_id,
                v_title, left(v_description, 240), v_description, v_tags, v_license,
                v_snapshot.source_revision, p_principal_id, 2, v_project.module_key, v_author,
                v_snapshot.image, v_snapshot.content_type, v_snapshot.width, v_snapshot.height)
        RETURNING id INTO v_revision_id;
    END IF;
    UPDATE public.project_publication_state
       SET current_revision_id = v_revision_id, state = 'public',
           published_at = COALESCE(published_at, now()), revoked_at = NULL
     WHERE id = v_publication_id;

    -- Only an explicitly published schema-2 revision has a compatibility row.
    -- Compatibility readers below never use that row as content authority.
    INSERT INTO public.project_publications
        (project_id, tenant_id, owner_principal_id, published_by_principal_id,
         title, module_key, author_label, snapshot_revision, visibility)
    VALUES (p_project_id, v_project.tenant_id, p_principal_id, p_principal_id,
            v_title, v_project.module_key, v_author, v_snapshot.source_revision, 'public')
    ON CONFLICT (project_id) DO UPDATE
        SET owner_principal_id = EXCLUDED.owner_principal_id,
            published_by_principal_id = EXCLUDED.published_by_principal_id,
            title = EXCLUDED.title, module_key = EXCLUDED.module_key,
            author_label = EXCLUDED.author_label, snapshot_revision = EXCLUDED.snapshot_revision,
            visibility = 'public', published_at = now();
    RETURN public.project_publication_status(p_principal_id, p_project_id);
END;
$$;


CREATE OR REPLACE FUNCTION public.project_publication_publish(p_principal_id uuid,p_project_id uuid,p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.principals actor JOIN public.accounts a ON a.id=actor.account_id AND a.status='active'
 WHERE actor.id=p_principal_id AND actor.kind='account') THEN RAISE EXCEPTION 'publication_forbidden' USING ERRCODE='P5P01'; END IF;
 RETURN public.project_publication_publish_admitted(p_principal_id,p_project_id,p_metadata);
END; $$;
CREATE FUNCTION public.project_publication_publish_seat(p_actor uuid,p_project uuid,p_metadata jsonb,p_hash varchar)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT public.project_distribution_seat_lock(p_actor,p_project,p_hash,'publish') THEN RAISE EXCEPTION 'publication_forbidden' USING ERRCODE='P5P01'; END IF;
 RETURN public.project_publication_publish_admitted(p_actor,p_project,p_metadata);
END; $$;

REVOKE ALL ON FUNCTION public.classroom_project_policy_read(uuid,uuid,uuid,uuid),public.classroom_project_policy_write(uuid,uuid,uuid,uuid,jsonb,text),
public.project_publication_seat_active(uuid,uuid,uuid),public.project_distribution_allowed(uuid,text),public.project_distribution_seat_lock(uuid,uuid,varchar,text),
public.project_publication_publish_admitted(uuid,uuid,jsonb),public.project_publication_publish_seat(uuid,uuid,jsonb,varchar) FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION public.classroom_project_policy_read(uuid,uuid,uuid,uuid),public.classroom_project_policy_write(uuid,uuid,uuid,uuid,jsonb,text),
public.project_publication_publish_seat(uuid,uuid,jsonb,varchar),public.project_distribution_seat_lock(uuid,uuid,varchar,text) TO asalab_app;

CREATE OR REPLACE FUNCTION public.project_publication_revoke(p_principal_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM 1 FROM public.projects project
    JOIN public.principals actor ON actor.id = project.owner_principal_id
    LEFT JOIN public.accounts account ON account.id = actor.account_id
    WHERE project.id = p_project_id AND actor.id = p_principal_id
 AND ((actor.kind='account' AND account.status='active') OR public.project_publication_seat_active(actor.id,project.tenant_id,project.classroom_id))
    FOR NO KEY UPDATE OF project;
    IF NOT FOUND THEN RETURN false; END IF;
    UPDATE public.project_publication_state
       SET state = 'revoked', revoked_at = COALESCE(revoked_at, now())
     WHERE project_id = p_project_id;
    -- Explicit owner revoke retires its legacy projection, not Project Core or
    -- revision history. Collections reference projects since migration 0052.
    DELETE FROM public.project_publications WHERE project_id = p_project_id;
    RETURN true;
END;
$$;


REVOKE ALL ON FUNCTION public.project_distribution_identity_lock(uuid,uuid,uuid,uuid,varchar) FROM PUBLIC,asalab_app;

CREATE OR REPLACE FUNCTION public.project_publication_owner_moderation_reason(p_actor uuid, p_project uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT moderation.reason
      FROM public.projects project
      JOIN public.principals actor ON actor.id = project.owner_principal_id
      LEFT JOIN public.accounts account ON account.id = actor.account_id
      JOIN public.project_publication_state state
        ON state.project_id = project.id AND state.owner_principal_id = actor.id
       AND state.tenant_id = project.tenant_id
      JOIN public.project_publication_moderation moderation ON moderation.publication_id = state.id
     WHERE project.id = p_project AND actor.id = p_actor AND moderation.hidden
 AND ((actor.kind='account' AND account.status='active') OR public.project_publication_seat_active(actor.id,project.tenant_id,project.classroom_id));
$$;

-- Revocation remains possible after publish permission is disabled, but still
-- requires the current authenticated Seat and the same identity locks.
CREATE FUNCTION public.project_publication_revoke_seat(p_actor uuid,p_project uuid,p_hash varchar)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p record;
BEGIN
 SELECT project.tenant_id,seat.classroom_id,seat.id seat_id INTO p
 FROM public.projects project JOIN public.principals actor ON actor.id=project.owner_principal_id AND actor.kind='student_seat'
 JOIN public.classroom_student_seats seat ON seat.id=actor.seat_id AND seat.tenant_id=project.tenant_id
 WHERE project.id=p_project AND actor.id=p_actor;
 IF NOT FOUND OR public.project_distribution_identity_lock(p_actor,p.tenant_id,p.classroom_id,p.seat_id,p_hash) IS NULL THEN RETURN false; END IF;
 RETURN public.project_publication_revoke(p_actor,p_project);
END; $$;
REVOKE ALL ON FUNCTION public.project_publication_revoke_seat(uuid,uuid,varchar) FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION public.project_publication_revoke_seat(uuid,uuid,varchar) TO asalab_app;

-- Losing and restoring readable Seat/class eligibility retires an earlier
-- editorial decision just like the existing Account-status lifecycle trigger.
-- Publish/download policy changes do not affect readability or editorial epochs.
CREATE FUNCTION public.project_publication_editorial_seat_policy_bump()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 INSERT INTO public.project_publication_editorial_lifecycle AS epoch(publication_id,lifecycle_version)
 SELECT state.id,1 FROM public.project_publication_state state
 JOIN public.principals actor ON actor.id=state.owner_principal_id AND actor.kind='student_seat'
 JOIN public.classroom_student_seats seat ON seat.id=actor.seat_id
 WHERE (TG_TABLE_NAME='classrooms' AND seat.classroom_id=NEW.id)
 OR (TG_TABLE_NAME='classroom_student_seats' AND seat.id=NEW.id)
 ORDER BY state.id
 ON CONFLICT(publication_id) DO UPDATE SET lifecycle_version=epoch.lifecycle_version+1;
 RETURN NEW;
END; $$;
CREATE TRIGGER project_publication_editorial_seat_status_update
AFTER UPDATE OF status ON public.classroom_student_seats FOR EACH ROW
WHEN(OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.project_publication_editorial_seat_policy_bump();
CREATE TRIGGER project_publication_editorial_class_status_update
AFTER UPDATE OF status ON public.classrooms FOR EACH ROW
WHEN(OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.project_publication_editorial_seat_policy_bump();
REVOKE ALL ON FUNCTION public.project_publication_editorial_seat_policy_bump() FROM PUBLIC,asalab_app;

-- Learner/link eligibility is also part of Seat publication readability. A
-- disable/restore cycle must not revive editorial or pin decisions made before
-- that loss of authority. Immutable link lineage supplies the exact Seat set.
CREATE FUNCTION public.project_publication_editorial_learner_policy_bump()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_seats uuid[];
BEGIN
 IF TG_TABLE_NAME='learner_identities' THEN
   SELECT array_agg(link.seat_id) INTO v_seats FROM public.learner_identity_links link
   WHERE link.learner_identity_id=NEW.id AND link.link_kind='student_seat'
     AND link.tenant_id=NEW.tenant_id AND link.school_id=NEW.school_id;
 ELSE
   v_seats:=ARRAY[NEW.seat_id];
 END IF;
 INSERT INTO public.project_publication_editorial_lifecycle AS epoch(publication_id,lifecycle_version)
 SELECT state.id,1 FROM public.project_publication_state state
 JOIN public.principals actor ON actor.id=state.owner_principal_id AND actor.kind='student_seat'
 WHERE state.tenant_id=NEW.tenant_id AND actor.seat_id=ANY(v_seats)
 ORDER BY state.id
 ON CONFLICT(publication_id) DO UPDATE SET lifecycle_version=epoch.lifecycle_version+1;
 RETURN NEW;
END; $$;
CREATE TRIGGER project_publication_editorial_learner_state_update
AFTER UPDATE OF state ON public.learner_identities FOR EACH ROW
WHEN(OLD.state IS DISTINCT FROM NEW.state)
EXECUTE FUNCTION public.project_publication_editorial_learner_policy_bump();
CREATE TRIGGER project_publication_editorial_learner_link_update
AFTER UPDATE OF status,disabled_at ON public.learner_identity_links FOR EACH ROW
WHEN(NEW.link_kind='student_seat' AND
 (OLD.status IS DISTINCT FROM NEW.status OR OLD.disabled_at IS DISTINCT FROM NEW.disabled_at))
EXECUTE FUNCTION public.project_publication_editorial_learner_policy_bump();
REVOKE ALL ON FUNCTION public.project_publication_editorial_learner_policy_bump() FROM PUBLIC,asalab_app;
