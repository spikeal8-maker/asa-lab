-- Э1 course authoring uses the current workspace, not the presence of a legacy assignment.
ALTER TABLE courses ADD COLUMN draft_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN creation_request_id varchar(128), ADD COLUMN creation_request_digest varchar(64);
CREATE UNIQUE INDEX courses_creation_request_idx ON courses(owner_principal_id,creation_request_id)
  WHERE creation_request_id IS NOT NULL;
CREATE OR REPLACE FUNCTION course_draft_revision_increment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN NEW.draft_revision:=OLD.draft_revision+1; RETURN NEW; END;
$$;
CREATE TRIGGER course_draft_revision_increment BEFORE UPDATE ON courses
FOR EACH ROW EXECUTE FUNCTION course_draft_revision_increment();
REVOKE ALL ON FUNCTION course_draft_revision_increment() FROM PUBLIC;

CREATE OR REPLACE FUNCTION course_save_v2(
  p_principal uuid,p_tenant uuid,p_course uuid,p_title varchar,p_summary varchar,p_age varchar,
  p_visibility varchar,p_expected_revision integer,p_request varchar
) RETURNS TABLE(result_code varchar,id uuid,draft_revision integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_course public.courses%ROWTYPE; v_digest text; v_id uuid;
BEGIN
 IF length(trim(coalesce(p_title,''))) NOT BETWEEN 1 AND 160 OR length(p_summary)>600
   OR p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$'
 THEN RETURN QUERY SELECT 'invalid_request'::varchar,NULL::uuid,NULL::integer; RETURN; END IF;
 v_digest:=public.learning_activity_snapshot_digest(jsonb_build_object(
   'title',p_title,'summary',p_summary,'age',p_age,'visibility',p_visibility,'tenant',p_tenant));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_principal::text||p_request,1111));
 IF p_course IS NULL THEN
   IF NOT public.learning_author_can_use_tenant(p_principal,p_tenant) OR coalesce(p_visibility,'private')<>'private'
   THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,NULL::integer; RETURN; END IF;
   SELECT * INTO v_course FROM public.courses WHERE owner_principal_id=p_principal AND creation_request_id=p_request;
   IF v_course.id IS NOT NULL THEN
     IF v_course.creation_request_digest<>v_digest THEN
       RETURN QUERY SELECT 'idempotency_conflict'::varchar,NULL::uuid,NULL::integer; RETURN; END IF;
     RETURN QUERY SELECT 'ok'::varchar,v_course.id,v_course.draft_revision; RETURN;
   END IF;
   INSERT INTO public.courses(tenant_id,owner_principal_id,title,summary,age_band,visibility,
     creation_request_id,creation_request_digest)
   VALUES(p_tenant,p_principal,trim(p_title),nullif(trim(p_summary),''),p_age,'private',p_request,v_digest)
   RETURNING * INTO v_course;
   PERFORM public.course_outline_ensure(v_course.id);
 ELSE
   SELECT * INTO v_course FROM public.courses WHERE courses.id=p_course AND owner_principal_id=p_principal FOR UPDATE;
   IF v_course.id IS NULL THEN RETURN QUERY SELECT 'forbidden'::varchar,NULL::uuid,NULL::integer; RETURN; END IF;
   IF p_expected_revision IS DISTINCT FROM v_course.draft_revision THEN
     RETURN QUERY SELECT 'draft_conflict'::varchar,NULL::uuid,v_course.draft_revision; RETURN; END IF;
   v_id:=public.course_save(p_principal,p_course,p_title,p_summary,p_age,p_visibility);
   SELECT * INTO v_course FROM public.courses WHERE courses.id=v_id;
 END IF;
 RETURN QUERY SELECT 'ok'::varchar,v_course.id,v_course.draft_revision;
END;
$$;

-- Called on the SAME transaction/connection as the existing outline command.
CREATE OR REPLACE FUNCTION course_draft_lock(p_principal uuid,p_course uuid,p_expected integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_revision integer;
BEGIN
 SELECT draft_revision INTO v_revision FROM public.courses WHERE id=p_course AND owner_principal_id=p_principal FOR UPDATE;
 RETURN v_revision IS NOT NULL AND v_revision=p_expected;
END;
$$;
CREATE OR REPLACE FUNCTION course_draft_revision(p_principal uuid,p_course uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT draft_revision FROM public.courses WHERE id=p_course AND owner_principal_id=p_principal;
$$;

CREATE OR REPLACE FUNCTION course_publish_v2(p_principal uuid,p_course uuid,p_expected integer,p_request varchar)
RETURNS TABLE(result_code varchar,version_id uuid,version_number integer,published_at timestamptz,reused boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_course public.courses%ROWTYPE; v_receipt jsonb; v_result record;
BEGIN
 SELECT * INTO v_course FROM public.courses WHERE id=p_course AND owner_principal_id=p_principal FOR UPDATE;
 IF v_course.id IS NULL THEN RETURN QUERY SELECT 'course_not_found'::varchar,NULL::uuid,NULL::integer,NULL::timestamptz,false; RETURN; END IF;
 IF p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
 RETURN QUERY SELECT 'invalid_request'::varchar,NULL::uuid,NULL::integer,NULL::timestamptz,false; RETURN; END IF;
 SELECT payload_json INTO v_receipt FROM public.audit_events WHERE entity_id=p_course AND action='course.publication.confirmed'
  AND payload_json->>'actorPrincipalId'=p_principal::text AND payload_json->>'requestId'=p_request LIMIT 1;
 IF v_receipt IS NOT NULL THEN
   IF (v_receipt->>'draftRevision')::integer IS DISTINCT FROM p_expected THEN
   RETURN QUERY SELECT 'idempotency_conflict'::varchar,NULL::uuid,NULL::integer,NULL::timestamptz,false; RETURN; END IF;
   RETURN QUERY SELECT 'ok'::varchar,(v_receipt->>'versionId')::uuid,(v_receipt->>'versionNumber')::integer,
     (v_receipt->>'publishedAt')::timestamptz,true; RETURN;
 END IF;
 IF v_course.draft_revision IS DISTINCT FROM p_expected THEN
 RETURN QUERY SELECT 'draft_conflict'::varchar,NULL::uuid,NULL::integer,NULL::timestamptz,false; RETURN; END IF;
 SELECT * INTO v_result FROM public.course_publish(p_principal,p_course);
 IF v_result.result_code='ok' THEN
 INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
 VALUES(v_course.tenant_id,'course',p_course,'course.publication.confirmed',
   jsonb_build_object('actorPrincipalId',p_principal,'requestId',p_request,'draftRevision',p_expected,
   'versionId',v_result.version_id,'versionNumber',v_result.version_number,'publishedAt',v_result.published_at));
 END IF;
 RETURN QUERY SELECT v_result.result_code,v_result.version_id,v_result.version_number,v_result.published_at,v_result.reused;
END;
$$;
CREATE FUNCTION course_library_list_v2(p_principal_id uuid)
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
               WHEN latest.content_hash = public.course_content_hash(course.id)
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
REVOKE ALL ON FUNCTION course_save_v2(uuid,uuid,uuid,varchar,varchar,varchar,varchar,integer,varchar),
 course_draft_lock(uuid,uuid,integer),course_draft_revision(uuid,uuid),
 course_publish_v2(uuid,uuid,integer,varchar),course_library_list_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION course_save_v2(uuid,uuid,uuid,varchar,varchar,varchar,varchar,integer,varchar),
 course_draft_lock(uuid,uuid,integer),course_draft_revision(uuid,uuid),
 course_publish_v2(uuid,uuid,integer,varchar),course_library_list_v2(uuid) TO asalab_app;

