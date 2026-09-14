-- LRN-E1-VERSION-DRAFT-01: explicit authoring state on the existing roots.
-- Backfill only facts reproducible from the current published snapshot. No runtime writes.
-- Compatibility normalization covers only schema 1 blocks and the nullable pin
-- introduced by 0107; it never changes stored immutable snapshots or their hash.
CREATE FUNCTION course_snapshot_normalize_pins(p_snapshot jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_set(CASE WHEN p_snapshot->>'schemaVersion'='1' THEN jsonb_set(p_snapshot,'{schemaVersion}','2'::jsonb) ELSE p_snapshot END,'{sections}',coalesce((SELECT jsonb_agg(
   jsonb_set(section,'{lessons}',coalesce((SELECT jsonb_agg(
     jsonb_build_object('learningActivityVersionId',NULL,'blocks',CASE WHEN NULLIF(trim(lesson->>'content'),'') IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('id','legacy-'||replace(lesson->>'sourceLessonId','-',''),'type','paragraph','text',lesson->>'content')) END)||lesson ORDER BY lesson_order)
     FROM jsonb_array_elements(section->'lessons') WITH ORDINALITY AS l(lesson,lesson_order)), '[]'::jsonb))
   ORDER BY section_order)
   FROM jsonb_array_elements(p_snapshot->'sections') WITH ORDINALITY AS s(section,section_order)), '[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION course_snapshot_normalize_pins(jsonb) FROM PUBLIC;

ALTER TABLE courses ADD COLUMN draft_active boolean NOT NULL DEFAULT true,
  ADD COLUMN draft_base_version_id uuid REFERENCES course_versions(id),
  ADD COLUMN draft_started_revision integer;
-- Preserve existing optimistic revisions during this metadata-only backfill.
ALTER TABLE courses DISABLE TRIGGER course_draft_revision_increment;
UPDATE courses c SET
  draft_active = NOT EXISTS (SELECT 1 FROM course_versions v WHERE v.course_id=c.id
    AND v.version_number=(SELECT max(version_number) FROM course_versions WHERE course_id=c.id)
    AND public.course_snapshot_normalize_pins(v.outline)=public.course_snapshot_normalize_pins(public.course_snapshot_build(c.id)));
UPDATE courses c SET draft_base_version_id=(SELECT id FROM course_versions WHERE course_id=c.id ORDER BY version_number DESC LIMIT 1),
  draft_started_revision=c.draft_revision WHERE c.draft_active;
ALTER TABLE courses ENABLE TRIGGER course_draft_revision_increment;
ALTER TABLE learning_activities ADD COLUMN draft_base_version_id uuid REFERENCES learning_activity_versions(id);

CREATE OR REPLACE FUNCTION course_draft_revision_increment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 NEW.draft_revision:=OLD.draft_revision+1;
 -- Keep old editors functional: a content write starts a draft. Metadata-only
 -- publication/visibility changes do not turn an unchanged publication into one.
 IF NOT NEW.draft_active AND NOT OLD.draft_active AND (
   NEW.title IS DISTINCT FROM OLD.title OR NEW.summary IS DISTINCT FROM OLD.summary
   OR NEW.age_band IS DISTINCT FROM OLD.age_band OR
   (NOT EXISTS (
     SELECT 1 FROM public.course_versions v WHERE v.course_id=OLD.id
       AND v.version_number=(SELECT max(version_number) FROM public.course_versions WHERE course_id=OLD.id)
       AND public.course_snapshot_normalize_pins(v.outline)=public.course_snapshot_normalize_pins(public.course_snapshot_build(OLD.id))))) THEN
   NEW.draft_active:=true;
   NEW.draft_base_version_id:=(SELECT id FROM public.course_versions WHERE course_id=OLD.id ORDER BY version_number DESC LIMIT 1);
 END IF;
 IF NEW.draft_active AND NEW.draft_started_revision IS NULL THEN
   NEW.draft_started_revision:=NEW.draft_revision;
 END IF;
 RETURN NEW;
END;
$$;

CREATE FUNCTION course_authoring_state(p_principal uuid,p_course uuid)
RETURNS TABLE(draft_active boolean,draft_base_version_id uuid,draft_base_version_number integer,draft_started_revision integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT c.draft_active,c.draft_base_version_id,v.version_number,c.draft_started_revision
 FROM public.courses c LEFT JOIN public.course_versions v ON v.id=c.draft_base_version_id
 WHERE c.id=p_course AND c.owner_principal_id=p_principal;
$$;

CREATE FUNCTION course_author_versions(p_principal uuid,p_course uuid)
RETURNS TABLE(id uuid,version_number integer,outline jsonb,published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT v.id,v.version_number,v.outline,v.published_at FROM public.course_versions v
 JOIN public.courses c ON c.id=v.course_id
 WHERE c.id=p_course AND c.owner_principal_id=p_principal ORDER BY v.version_number DESC;
$$;

CREATE FUNCTION course_draft_from_version(p_principal uuid,p_course uuid,p_version uuid,p_expected integer)
RETURNS TABLE(result_code varchar,draft_revision integer,source_version_number integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c public.courses%ROWTYPE; v public.course_versions%ROWTYPE; s jsonb; l jsonb; sid uuid;
BEGIN
 SELECT * INTO c FROM public.courses WHERE id=p_course AND owner_principal_id=p_principal FOR UPDATE;
 IF c.id IS NULL THEN RETURN QUERY SELECT 'course_not_found'::varchar,NULL::integer,NULL::integer; RETURN; END IF;
 IF c.draft_active THEN RETURN QUERY SELECT 'draft_exists'::varchar,c.draft_revision,NULL::integer; RETURN; END IF;
 IF c.draft_revision IS DISTINCT FROM p_expected THEN RETURN QUERY SELECT 'draft_conflict'::varchar,c.draft_revision,NULL::integer; RETURN; END IF;
 SELECT * INTO v FROM public.course_versions WHERE id=p_version AND course_id=c.id;
 IF v.id IS NULL THEN RETURN QUERY SELECT 'version_not_found'::varchar,c.draft_revision,NULL::integer; RETURN; END IF;
 -- A savepoint protects the current authoring tree if a legacy mutable reference
 -- can no longer reproduce the frozen source. Never substitute current content.
 BEGIN
 DELETE FROM public.course_items WHERE course_id=c.id;
 DELETE FROM public.course_sections WHERE course_id=c.id;
 FOR s IN SELECT value FROM jsonb_array_elements(v.outline->'sections') LOOP
   sid:=(s->>'sourceSectionId')::uuid;
   INSERT INTO public.course_sections(id,tenant_id,course_id,title,summary,position)
     VALUES(sid,c.tenant_id,c.id,s->>'title',s->>'summary',(s->>'position')::integer);
   FOR l IN SELECT value FROM jsonb_array_elements(s->'lessons') LOOP
     INSERT INTO public.course_lessons(id,tenant_id,course_id,section_id,title,summary,content,blocks,kind,
       assignment_id,learning_activity_version_id,estimated_minutes,position)
     VALUES((l->>'sourceLessonId')::uuid,c.tenant_id,c.id,sid,l->>'title',l->>'summary',l->>'content',
       coalesce(l->'blocks',CASE WHEN NULLIF(trim(l->>'content'),'') IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('id','legacy-'||replace(l->>'sourceLessonId','-',''),'type','paragraph','text',l->>'content')) END),l->>'kind',(l->'assignment'->>'sourceAssignmentId')::uuid,
       (l->>'learningActivityVersionId')::uuid,(l->>'estimatedMinutes')::integer,(l->>'position')::integer);
   END LOOP;
 END LOOP;
 INSERT INTO public.course_items(course_id,assignment_id,position)
   SELECT c.id,assignment_id,min(position) FROM public.course_lessons
   WHERE course_id=c.id AND assignment_id IS NOT NULL GROUP BY assignment_id;
 PERFORM public.course_items_sync_outline(c.id);
 UPDATE public.courses SET title=v.title,summary=v.summary,age_band=v.age_band,
   draft_active=true,draft_base_version_id=v.id,draft_started_revision=c.draft_revision+1
 WHERE id=c.id RETURNING courses.draft_revision INTO c.draft_revision;
 -- Schema 2 snapshots predate the nullable canonical pin field. Compare content
 -- structurally with that absent field normalized, not against mutable roots.
 IF public.course_snapshot_normalize_pins(public.course_snapshot_build(c.id)) IS DISTINCT FROM public.course_snapshot_normalize_pins(v.outline) THEN
   RAISE EXCEPTION 'source_not_restorable' USING ERRCODE='PVD01';
 END IF;
 EXCEPTION WHEN SQLSTATE 'PVD01' OR foreign_key_violation THEN
   SELECT courses.draft_revision INTO c.draft_revision FROM public.courses WHERE id=p_course;
   RETURN QUERY SELECT 'source_not_restorable'::varchar,c.draft_revision,v.version_number; RETURN;
 END;
 RETURN QUERY SELECT 'ok'::varchar,c.draft_revision,v.version_number;
END;
$$;

CREATE FUNCTION learning_activity_draft_from_version(p_principal uuid,p_tenant uuid,p_activity uuid,p_version uuid,p_expected integer)
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
     'resultMode',v.result_mode,'maxPoints',v.max_points,'policies',v.policy_snapshot,'moduleKey',v.module_key,
     'quizVersionId',v.quiz_version_id,'starterProjectVersionId',v.starter_project_version_id)
 WHERE id=a.id;
 RETURN QUERY SELECT 'ok'::varchar,a.draft_revision+1,v.version_number;
END;
$$;

CREATE OR REPLACE FUNCTION course_publish(
    p_principal_id uuid,
    p_course_id    uuid
)
RETURNS TABLE (
    result_code    varchar,
    version_id     uuid,
    version_number integer,
    published_at   timestamptz,
    reused         boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_course       record;
    v_snapshot     jsonb;
    v_hash         varchar(32);
    v_latest       record;
    v_version_id   uuid;
    v_number       integer;
    v_published_at timestamptz;
BEGIN
    SELECT course.id, course.tenant_id, course.title, course.summary, course.age_band, course.draft_base_version_id
      INTO v_course
      FROM public.courses course
     WHERE course.id = p_course_id
       AND course.owner_principal_id = p_principal_id
     FOR UPDATE;

    IF v_course.id IS NULL THEN
        RETURN QUERY SELECT 'course_not_found'::varchar, NULL::uuid, NULL::integer,
                            NULL::timestamptz, false;
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.course_lessons lesson WHERE lesson.course_id = p_course_id
    ) THEN
        RETURN QUERY SELECT 'course_empty'::varchar, NULL::uuid, NULL::integer,
                            NULL::timestamptz, false;
        RETURN;
    END IF;

    v_snapshot := public.course_snapshot_build(p_course_id);
    v_hash := md5(v_snapshot::text);

    SELECT version.id, version.version_number, version.content_hash, version.published_at, version.outline
      INTO v_latest
      FROM public.course_versions version
     WHERE version.course_id = p_course_id
     ORDER BY version.version_number DESC
     LIMIT 1;

    IF v_latest.id IS NOT NULL AND public.course_snapshot_normalize_pins(v_latest.outline)=public.course_snapshot_normalize_pins(v_snapshot) THEN
    INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
    SELECT v_course.tenant_id,'course',p_course_id,'course.draft.published',
      jsonb_build_object('sourceVersionId',v_course.draft_base_version_id,'publishedVersionId',v_latest.id)
    WHERE v_course.draft_base_version_id IS NOT NULL;
    UPDATE public.courses SET draft_active=false,draft_base_version_id=NULL,draft_started_revision=NULL
      WHERE id=p_course_id AND draft_active;
        RETURN QUERY SELECT 'ok'::varchar, v_latest.id, v_latest.version_number,
                            v_latest.published_at, true;
        RETURN;
    END IF;

    v_number := COALESCE(v_latest.version_number, 0) + 1;
    INSERT INTO public.course_versions (
        tenant_id, course_id, version_number, title, summary, age_band,
        outline, content_hash, published_by_principal_id
    ) VALUES (
        v_course.tenant_id, p_course_id, v_number, v_course.title,
        v_course.summary, v_course.age_band, v_snapshot, v_hash, p_principal_id
    )
    RETURNING id, course_versions.published_at INTO v_version_id, v_published_at;

    INSERT INTO public.course_version_media (
        version_id, source_lesson_id, sample_bytes, content_type, content_hash
    )
    SELECT v_version_id, lesson.id, task.sample_bytes, task.sample_content_type,
           md5(encode(task.sample_bytes, 'base64'))
      FROM public.course_lessons lesson
      JOIN public.teacher_assignments task ON task.id = lesson.assignment_id
     WHERE lesson.course_id = p_course_id
       AND task.sample_bytes IS NOT NULL
       AND task.sample_content_type IS NOT NULL;

    INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
    SELECT v_course.tenant_id,'course',p_course_id,'course.draft.published',
      jsonb_build_object('sourceVersionId',v_course.draft_base_version_id,'publishedVersionId',v_version_id)
    WHERE v_course.draft_base_version_id IS NOT NULL;
    UPDATE public.courses SET draft_active=false,draft_base_version_id=NULL,draft_started_revision=NULL
      WHERE id=p_course_id AND draft_active;
    RETURN QUERY SELECT 'ok'::varchar, v_version_id, v_number, v_published_at, false;
END;
$$;

CREATE OR REPLACE FUNCTION course_library_list_v2(p_principal_id uuid)
RETURNS TABLE (
    id uuid,
    title varchar,
    summary varchar,
    visibility varchar,
    age_band varchar,
    section_count integer,
    lesson_count integer,
    assignment_count integer,
    shared_with integer,
    copied_from_course_id uuid,
    publication_state varchar,
    published_version integer,
    published_at timestamptz,
    created_at timestamptz,
    updated_at timestamptz,
    draft_revision integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT course.id, course.title, course.summary, course.visibility, course.age_band,
           (SELECT count(*)::integer FROM public.course_sections section
             WHERE section.course_id = course.id),
           (SELECT count(*)::integer FROM public.course_lessons lesson
             WHERE lesson.course_id = course.id),
           (SELECT count(*)::integer FROM public.course_lessons lesson
             WHERE lesson.course_id = course.id AND lesson.kind = 'assignment'),
           (SELECT count(*)::integer FROM public.content_shares share
             WHERE share.subject_kind = 'course' AND share.subject_id = course.id),
           course.copied_from_course_id,
           CASE
               WHEN latest.id IS NULL THEN 'draft'::varchar
               WHEN NOT course.draft_active
                   THEN 'published'::varchar
               ELSE 'changed'::varchar
           END,
           latest.version_number,
           latest.published_at,
           course.created_at,
           course.updated_at, course.draft_revision
      FROM public.courses course
      LEFT JOIN LATERAL (
          SELECT version.id, version.version_number, version.content_hash, version.published_at
            FROM public.course_versions version
           WHERE version.course_id = course.id
           ORDER BY version.version_number DESC
           LIMIT 1
      ) latest ON true
     WHERE course.owner_principal_id = p_principal_id
     ORDER BY course.updated_at DESC, course.id;
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
DECLARE v_activity record; v_existing record; v_number integer; v_id uuid;
        v_snapshot jsonb; v_digest varchar;
BEGIN
    IF p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
        RETURN QUERY SELECT 'invalid_request_id'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_activity_id::text, 9001));
    SELECT * INTO v_activity FROM public.learning_activities activity
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
      INTO v_existing FROM public.learning_activity_versions version
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
      INTO v_existing FROM public.learning_activity_versions version
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
        SELECT 1 FROM public.learning_migration_compatibility_activity_versions compatibility
         WHERE compatibility.learning_activity_version_id = v_activity.current_published_version_id
            OR compatibility.classroom_assignment_id::text =
               v_activity.draft_payload ->> 'sourceClassroomAssignmentId'
    ) THEN
        RETURN QUERY SELECT 'compatibility_not_reusable'::varchar, NULL::uuid,
                            NULL::integer, NULL::varchar, false;
        RETURN;
    END IF;
    SELECT COALESCE(max(version.version_number), 0) + 1 INTO v_number
      FROM public.learning_activity_versions version
     WHERE version.activity_id = p_activity_id;
    v_snapshot := jsonb_build_object(
        'activityId', v_activity.id,
        'versionNumber', v_number,
        'kind', v_activity.draft_payload ->> 'kind',
        'title', v_activity.draft_payload ->> 'title',
        'instructions', v_activity.draft_payload -> 'instructions',
        'resultMode', v_activity.draft_payload ->> 'resultMode',
        'maxPoints', v_activity.draft_payload -> 'maxPoints',
        'policies', v_activity.draft_payload -> 'policies',
        'moduleKey', v_activity.draft_payload -> 'moduleKey',
        'quizVersionId', v_activity.draft_payload -> 'quizVersionId',
        'starterProjectVersionId', v_activity.draft_payload -> 'starterProjectVersionId',
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
        canonical_contract_version
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
        p_request_id, p_principal_id, 1
    ) RETURNING id INTO v_id;
    UPDATE public.learning_activities
       SET current_published_version_id = v_id, draft_base_version_id = NULL
     WHERE id = p_activity_id;
    RETURN QUERY SELECT 'ok'::varchar, v_id, v_number, v_digest, false;
END;
$$;

REVOKE ALL ON FUNCTION course_authoring_state(uuid,uuid),course_author_versions(uuid,uuid),
 course_draft_from_version(uuid,uuid,uuid,integer),learning_activity_draft_from_version(uuid,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION course_authoring_state(uuid,uuid),course_author_versions(uuid,uuid),
 course_draft_from_version(uuid,uuid,uuid,integer),learning_activity_draft_from_version(uuid,uuid,uuid,uuid,integer) TO asalab_app;

CREATE OR REPLACE FUNCTION course_lesson_save_v2(
    p_principal_id      uuid,
    p_course_id         uuid,
    p_section_id        uuid,
    p_lesson_id         uuid,
    p_title             varchar,
    p_summary           varchar,
    p_blocks            jsonb,
    p_kind              varchar,
    p_assignment_id     uuid,
    p_estimated_minutes integer
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_id uuid;
BEGIN
    IF NOT public.course_lesson_blocks_valid(p_blocks) THEN RETURN NULL; END IF;
    v_id := public.course_lesson_save(
        p_principal_id, p_course_id, p_section_id, p_lesson_id, p_title, p_summary,
        public.course_lesson_blocks_plain_text(p_blocks), p_kind, p_assignment_id,
        p_estimated_minutes
    );
    IF v_id IS NULL THEN RETURN NULL; END IF;
    UPDATE public.course_lessons SET blocks = p_blocks WHERE id = v_id;
    -- The legacy writer touched the root before blocks were saved. Recheck the final snapshot.
    UPDATE public.courses SET updated_at=now() WHERE id=p_course_id;
    RETURN v_id;
END;
$$;

-- Legacy course lessons read these assignment fields live. Preserve the old
-- changed-draft behavior explicitly, including revision/CAS and sample writers.
CREATE FUNCTION course_legacy_assignment_draft_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_course record;
BEGIN
 IF ROW(NEW.title,NEW.goal,NEW.brief,NEW.module_key,NEW.age_band,
        CASE WHEN NEW.sample_bytes IS NULL THEN NEW.sample_image END,
        NEW.sample_bytes,NEW.sample_content_type)
    IS NOT DISTINCT FROM
    ROW(OLD.title,OLD.goal,OLD.brief,OLD.module_key,OLD.age_band,
        CASE WHEN OLD.sample_bytes IS NULL THEN OLD.sample_image END,
        OLD.sample_bytes,OLD.sample_content_type) THEN
   RETURN NEW;
 END IF;
 FOR v_course IN
   SELECT c.id FROM public.courses c
   WHERE EXISTS (SELECT 1 FROM public.course_lessons l WHERE l.course_id=c.id AND l.assignment_id=NEW.id)
   ORDER BY c.id FOR UPDATE OF c
 LOOP
   -- The Course trigger owns activation/base/revision and preserves an active
   -- historical draft's source. Lock shared roots in a deterministic order.
   UPDATE public.courses SET updated_at=now() WHERE id=v_course.id;
 END LOOP;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION course_legacy_assignment_draft_changed() FROM PUBLIC;
CREATE TRIGGER course_legacy_assignment_draft_changed
AFTER UPDATE OF title,goal,brief,module_key,age_band,sample_image,sample_bytes,sample_content_type
ON teacher_assignments FOR EACH ROW EXECUTE FUNCTION course_legacy_assignment_draft_changed();
