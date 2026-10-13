-- Course-first Library: exact viewed release, recipient-owned pins and durable replay.
CREATE TABLE public.course_catalogue_copy_receipts (
  actor_principal_id uuid NOT NULL REFERENCES public.principals(id),
  request_id varchar(128) NOT NULL,
  request_digest varchar(64) NOT NULL,
  destination_tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  source_course_id uuid NOT NULL REFERENCES public.courses(id),
  source_version_id uuid NOT NULL REFERENCES public.course_versions(id),
  source_version_number integer NOT NULL,
  source_content_hash varchar(32) NOT NULL,
  target_course_id uuid NOT NULL REFERENCES public.courses(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_principal_id,request_id)
);
ALTER TABLE public.course_catalogue_copy_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_catalogue_copy_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_catalogue_copy_receipts FROM PUBLIC,asalab_app;
CREATE FUNCTION public.course_catalogue_receipt_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Library copy receipts are immutable'; END;
$$;
CREATE TRIGGER course_catalogue_receipt_immutable BEFORE UPDATE OR DELETE
  ON public.course_catalogue_copy_receipts FOR EACH ROW
  EXECUTE FUNCTION public.course_catalogue_receipt_immutable();
REVOKE ALL ON FUNCTION public.course_catalogue_receipt_immutable() FROM PUBLIC;

-- No draft, Project document, assessment policy or history is returned by these readers.
CREATE FUNCTION public.course_catalogue_version_v2(
  p_course uuid,p_version uuid,p_principal uuid,p_account uuid,p_tenant uuid
) RETURNS SETOF public.course_versions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT version.* FROM public.courses course
  JOIN public.course_versions version ON version.course_id=course.id
  WHERE course.id=p_course AND course.owner_principal_id<>p_principal
    AND course.archived_at IS NULL
    AND (p_version IS NULL OR version.id=p_version)
    AND public.content_is_visible('course',course.id,course.visibility,
      course.owner_principal_id,course.tenant_id,p_principal,p_account,p_tenant)
  ORDER BY version.version_number DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.course_catalogue_version_v2(uuid,uuid,uuid,uuid,uuid)
  FROM PUBLIC,asalab_app;

CREATE FUNCTION public.course_catalogue_pins(p_outline jsonb)
RETURNS TABLE(version_id uuid,pin_kind varchar)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  WITH lessons AS (
    SELECT lesson.value AS body FROM jsonb_array_elements(p_outline->'sections') section
    CROSS JOIN LATERAL jsonb_array_elements(section.value->'lessons') lesson
  )
  SELECT DISTINCT (body->>'learningActivityVersionId')::uuid,'project'::varchar
    FROM lessons WHERE body->>'learningActivityVersionId' IS NOT NULL
  UNION
  SELECT DISTINCT (block.value->>'learningActivityVersionId')::uuid,
    CASE WHEN block.value->>'type'='manual-material' THEN 'manual' ELSE 'project' END::varchar
    FROM lessons CROSS JOIN LATERAL jsonb_array_elements(body->'blocks') block
   WHERE block.value->>'type' IN ('activity','manual-material');
$$;
REVOKE ALL ON FUNCTION public.course_catalogue_pins(jsonb) FROM PUBLIC,asalab_app;

CREATE FUNCTION public.course_catalogue_pin_v2(
  p_course uuid,p_version uuid,p_pin uuid,p_principal uuid,p_account uuid,p_tenant uuid
) RETURNS TABLE(version_id uuid,version_number integer,title varchar,instructions varchar,
                goal varchar,blocks jsonb,module_key varchar,sample_hash varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT version.id,version.version_number,version.title,version.instructions,version.goal,
    version.blocks,version.module_key,sample.content_hash::varchar
  FROM public.course_catalogue_version_v2(p_course,p_version,p_principal,p_account,p_tenant) release
  JOIN public.courses course ON course.id=release.course_id
  CROSS JOIN LATERAL public.course_catalogue_pins(release.outline) pin
  JOIN public.learning_activity_versions version ON version.id=pin.version_id
    AND version.tenant_id=course.tenant_id AND version.canonical_contract_version=1
    AND version.canonical_kind=pin.pin_kind
  JOIN public.learning_activities activity ON activity.id=version.activity_id
    AND activity.tenant_id=version.tenant_id AND activity.owner_principal_id=course.owner_principal_id
    AND activity.reusable_authored_content AND activity.authoring_origin='canonical'
  LEFT JOIN public.learning_activity_version_media sample ON sample.activity_version_id=version.id
    AND sample.tenant_id=version.tenant_id AND sample.role='sample'
  WHERE version.id=p_pin AND public.learning_safe_task_blocks_valid(version.blocks);
$$;
REVOKE ALL ON FUNCTION public.course_catalogue_pin_v2(uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_catalogue_pin_v2(uuid,uuid,uuid,uuid,uuid,uuid) TO asalab_app;

CREATE FUNCTION public.course_catalogue_preview_v2(
  p_course uuid,p_principal uuid,p_account uuid,p_tenant uuid
) RETURNS TABLE(version_id uuid,version_number integer,title varchar,summary varchar,
                outline jsonb,published_at timestamptz,content_hash varchar,pins jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT release.id,release.version_number,release.title,release.summary,release.outline,
    release.published_at,release.content_hash,
    COALESCE((SELECT jsonb_agg(to_jsonb(safe)) FROM public.course_catalogue_pins(release.outline) pin
      CROSS JOIN LATERAL public.course_catalogue_pin_v2(
        p_course,release.id,pin.version_id,p_principal,p_account,p_tenant) safe),'[]'::jsonb)
  FROM public.course_catalogue_version_v2(p_course,NULL,p_principal,p_account,p_tenant) release;
$$;
REVOKE ALL ON FUNCTION public.course_catalogue_preview_v2(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_catalogue_preview_v2(uuid,uuid,uuid,uuid) TO asalab_app;

CREATE FUNCTION public.course_catalogue_media_v2(
  p_course uuid,p_version uuid,p_pin uuid,p_role varchar,p_hash varchar,
  p_principal uuid,p_account uuid,p_tenant uuid
) RETURNS TABLE(media_bytes bytea,content_type varchar,content_hash varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT media.bytes,media.content_type::varchar,media.content_hash::varchar
  FROM public.course_catalogue_pin_v2(p_course,p_version,p_pin,p_principal,p_account,p_tenant) pin
  JOIN public.learning_activity_version_media media ON media.activity_version_id=pin.version_id
  WHERE media.role=p_role AND media.content_hash=p_hash
    AND (p_role='sample' AND pin.sample_hash=p_hash
      OR p_role IN ('task-image','task-file') AND pin.blocks @> jsonb_build_array(jsonb_build_object(
        'type',CASE WHEN p_role='task-image' THEN 'image' ELSE 'file' END,'contentHash',p_hash)));
$$;
REVOKE ALL ON FUNCTION public.course_catalogue_media_v2(uuid,uuid,uuid,varchar,varchar,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_catalogue_media_v2(uuid,uuid,uuid,varchar,varchar,uuid,uuid,uuid) TO asalab_app;

-- Internal clone: the caller already authorized this exact pin through a visible release.
-- No grants: accepting an arbitrary private version here would reveal source content.
CREATE FUNCTION public.course_catalogue_clone_pin(
  p_source uuid,p_principal uuid,p_tenant uuid,p_request varchar
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE source public.learning_activity_versions%ROWTYPE; created record; saved record;
        published record; block jsonb; media record; snapshot jsonb; draft_blocks jsonb;
BEGIN
  SELECT * INTO source FROM public.learning_activity_versions WHERE id=p_source;
  IF source.id IS NULL OR source.canonical_contract_version<>1
    OR NOT EXISTS (SELECT 1 FROM public.learning_activities activity WHERE activity.id=source.activity_id
      AND activity.reusable_authored_content AND activity.authoring_origin='canonical' AND activity.archived_at IS NULL)
    OR source.canonical_kind NOT IN ('manual','project')
    OR source.starter_project_version_id IS NOT NULL OR source.quiz_version_id IS NOT NULL
    OR source.canonical_kind='project' AND NOT public.module_learning_assignable(source.module_key)
    OR source.canonical_kind='manual' AND source.module_key IS NOT NULL
    OR NOT source.blocks_snapshot_present OR NOT source.goal_snapshot_present
    OR NOT public.learning_safe_task_blocks_valid(source.blocks)
  THEN RAISE EXCEPTION 'unsupported exact Library pin' USING ERRCODE='PZ201'; END IF;
  FOR block IN SELECT value FROM jsonb_array_elements(source.blocks)
    WHERE value->>'type' IN ('image','file') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.learning_activity_version_media item
      WHERE item.activity_version_id=source.id AND item.tenant_id=source.tenant_id
        AND item.role=CASE WHEN block->>'type'='image' THEN 'task-image' ELSE 'task-file' END
        AND item.content_hash=block->>'contentHash') THEN
      RAISE EXCEPTION 'missing exact Library media' USING ERRCODE='PZ201';
    END IF;
  END LOOP;
  -- Reconstruct the published digest, including sample metadata. A missing sample
  -- must fail rather than becoming a new empty-sample publication in the copy.
  snapshot:=jsonb_build_object('activityId',source.activity_id,'versionNumber',source.version_number,
    'kind',source.canonical_kind,'title',source.title,'instructions',source.instructions,
    'goal',source.goal,'blocks',source.blocks,'resultMode',source.result_mode,'maxPoints',source.max_points,
    'policies',source.policy_snapshot,'moduleKey',source.module_key,'quizVersionId',source.quiz_version_id,
    'starterProjectVersionId',source.starter_project_version_id,'provenance',source.provenance,
    'sample',(SELECT jsonb_build_object('contentType',content_type,'contentHash',content_hash)
      FROM public.learning_activity_version_media WHERE activity_version_id=source.id AND role='sample'));
  SELECT * INTO media FROM public.learning_activity_version_media
    WHERE activity_version_id=source.id AND role='task-image';
  IF media.content_hash IS NOT NULL THEN snapshot:=snapshot||jsonb_build_object('taskImage',
    jsonb_build_object('contentType',media.content_type,'contentHash',media.content_hash)); END IF;
  IF public.learning_activity_snapshot_digest(snapshot)<>source.content_digest THEN
    RAISE EXCEPTION 'incomplete exact Library snapshot' USING ERRCODE='PZ201';
  END IF;
  -- Published blocks already contain the leading instructions paragraph. The
  -- normal publisher adds it again from the draft instructions, so unwrap only
  -- that proven prefix before putting the recipient draft.
  draft_blocks:=source.blocks;
  IF length(trim(COALESCE(source.instructions,'')))>0 THEN
    IF source.blocks->0<>jsonb_build_object('type','paragraph','text',source.instructions) THEN
      RAISE EXCEPTION 'invalid exact Library instructions prefix' USING ERRCODE='PZ201';
    END IF;
    draft_blocks:=source.blocks-0;
  END IF;
  SELECT * INTO created FROM public.learning_activity_create(p_principal,p_tenant,
    CASE WHEN EXISTS (SELECT 1 FROM public.workspaces workspace WHERE workspace.tenant_id=p_tenant
      AND workspace.kind='personal') THEN 'personal' ELSE 'school' END::varchar,'private',
    source.canonical_kind,source.title,source.instructions,source.result_mode,source.max_points,
    source.policy_snapshot,source.module_key,NULL,NULL,NULL,p_request,to_jsonb(source.goal),'[]'::jsonb);
  IF created.result_code<>'ok' THEN RAISE EXCEPTION 'Library root unavailable' USING ERRCODE='PZ201'; END IF;
  FOR media IN SELECT * FROM public.learning_activity_version_media WHERE activity_version_id=source.id LOOP
    IF media.tenant_id<>source.tenant_id OR media.content_hash<>
      encode(public.digest(media.bytes,'sha256'),'hex') THEN
      RAISE EXCEPTION 'Library media integrity failed' USING ERRCODE='PZ201';
    END IF;
    INSERT INTO public.learning_activity_draft_media(tenant_id,activity_id,role,content_type,bytes,content_hash)
    VALUES(p_tenant,created.activity_id,media.role,media.content_type,media.bytes,media.content_hash);
  END LOOP;
  SELECT * INTO saved FROM public.learning_activity_draft_put(p_principal,p_tenant,created.activity_id,
    created.draft_revision,source.title,source.instructions,source.result_mode,source.max_points,
    source.policy_snapshot,source.module_key,NULL,NULL,to_jsonb(source.goal),draft_blocks);
  IF saved.result_code<>'ok' THEN RAISE EXCEPTION 'Library draft unavailable' USING ERRCODE='PZ201'; END IF;
  SELECT * INTO published FROM public.learning_activity_publish(p_principal,p_tenant,created.activity_id,
    saved.draft_revision,p_request||':publish');
  IF published.result_code<>'ok' THEN RAISE EXCEPTION 'Library publication unavailable' USING ERRCODE='PZ201'; END IF;
  RETURN published.activity_version_id;
END;
$$;
REVOKE ALL ON FUNCTION public.course_catalogue_clone_pin(uuid,uuid,uuid,varchar) FROM PUBLIC,asalab_app;

CREATE FUNCTION public.course_catalogue_take_v2(
  p_principal uuid,p_account uuid,p_tenant uuid,p_course uuid,p_version uuid,
  p_hash varchar,p_request varchar,p_destination uuid
) RETURNS TABLE(result_code varchar,id uuid,source_version_id uuid,source_version_number integer,
                source_content_hash varchar,reused boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE receipt public.course_catalogue_copy_receipts%ROWTYPE; release public.course_versions%ROWTYPE;
  digest varchar; target uuid; target_section uuid; target_task uuid; target_pin uuid;
  folder uuid; section jsonb; lesson jsonb; block jsonb; blocks jsonb;
  assignment jsonb; pin record; mapping jsonb:='{}'; item_position integer:=0;
  sample record;
BEGIN
  IF p_request IS NULL OR p_request !~ '^[A-Za-z0-9._:-]{8,128}$'
    OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{32}$' OR p_version IS NULL
    OR NOT public.learning_author_can_use_tenant(p_principal,p_destination) THEN
    RETURN QUERY SELECT 'invalid_request'::varchar,NULL::uuid,NULL::uuid,NULL::integer,NULL::varchar,false;
    RETURN;
  END IF;
  digest:=public.learning_activity_snapshot_digest(jsonb_build_object('course',p_course,
    'version',p_version,'hash',p_hash,'destination',p_destination));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_principal::text||':'||p_request,201));
  SELECT * INTO receipt FROM public.course_catalogue_copy_receipts
    WHERE actor_principal_id=p_principal AND request_id=p_request;
  IF receipt.target_course_id IS NOT NULL THEN
    IF receipt.request_digest<>digest THEN
      RETURN QUERY SELECT 'idempotency_conflict'::varchar,NULL::uuid,NULL::uuid,NULL::integer,NULL::varchar,false;
    ELSE
      RETURN QUERY SELECT 'ok'::varchar,receipt.target_course_id,receipt.source_version_id,
        receipt.source_version_number,receipt.source_content_hash,true;
    END IF;
    RETURN;
  END IF;
  SELECT * INTO release FROM public.course_catalogue_version_v2(p_course,p_version,p_principal,p_account,p_tenant);
  IF release.id IS NULL OR release.content_hash<>p_hash THEN
    RETURN QUERY SELECT 'not_available'::varchar,NULL::uuid,NULL::uuid,NULL::integer,NULL::varchar,false;
    RETURN;
  END IF;
  -- Exception subtransaction rolls back every generated root/media/lesson/receipt.
  BEGIN
    FOR pin IN SELECT * FROM public.course_catalogue_pins(release.outline) ORDER BY version_id LOOP
      IF NOT EXISTS (SELECT 1 FROM public.course_catalogue_pin_v2(
        p_course,p_version,pin.version_id,p_principal,p_account,p_tenant)) THEN
        RAISE EXCEPTION 'foreign Library pin' USING ERRCODE='PZ201';
      END IF;
      IF mapping->>pin.version_id::text IS NULL THEN
        target_pin:=public.course_catalogue_clone_pin(pin.version_id,p_principal,p_destination,
          'library:'||public.learning_activity_snapshot_digest(jsonb_build_object(
            'request',p_request,'version',pin.version_id)));
        mapping:=mapping||jsonb_build_object(pin.version_id::text,target_pin);
      END IF;
    END LOOP;
    INSERT INTO public.courses(tenant_id,owner_principal_id,title,summary,age_band,visibility,copied_from_course_id)
      VALUES(p_destination,p_principal,release.title,release.summary,release.age_band,'private',p_course)
      RETURNING courses.id INTO target;
    FOR section IN SELECT value FROM jsonb_array_elements(release.outline->'sections') LOOP
      INSERT INTO public.course_sections(tenant_id,course_id,title,summary,position)
      VALUES(p_destination,target,section->>'title',section->>'summary',(section->>'position')::integer)
      RETURNING course_sections.id INTO target_section;
      FOR lesson IN SELECT value FROM jsonb_array_elements(section->'lessons') LOOP
        target_task:=NULL; target_pin:=NULL; assignment:=lesson->'assignment';
        IF lesson->>'learningActivityVersionId' IS NOT NULL THEN
          target_pin:=(mapping->>(lesson->>'learningActivityVersionId'))::uuid;
        ELSIF lesson->>'kind'='assignment' AND jsonb_typeof(assignment)='object' THEN
          -- Preserve the existing legacy template/assignment copy path separately.
          IF folder IS NULL THEN
            INSERT INTO public.assignment_folders(tenant_id,owner_principal_id,parent_id,title)
              VALUES(p_destination,p_principal,NULL,left(release.title,120)) ON CONFLICT DO NOTHING
              RETURNING assignment_folders.id INTO folder;
            IF folder IS NULL THEN SELECT f.id INTO folder FROM public.assignment_folders f
              WHERE f.owner_principal_id=p_principal AND f.parent_id IS NULL
                AND lower(f.title)=lower(left(release.title,120)); END IF;
          END IF;
          SELECT * INTO sample FROM public.course_version_media
            WHERE version_id=release.id AND source_lesson_id=(lesson->>'sourceLessonId')::uuid;
          IF COALESCE((assignment->>'hasVersionedSample')::boolean,false) AND sample.sample_bytes IS NULL THEN
            RAISE EXCEPTION 'missing legacy sample' USING ERRCODE='PZ201'; END IF;
          INSERT INTO public.teacher_assignments(tenant_id,owner_principal_id,title,brief,goal,module_key,
            age_band,sample_image,sample_bytes,sample_content_type,folder_id,copied_from_assignment_id,visibility)
          VALUES(p_destination,p_principal,assignment->>'title',assignment->>'brief',assignment->>'goal',
            assignment->>'moduleKey',assignment->>'ageBand',assignment->>'staticSampleImage',
            sample.sample_bytes,sample.content_type,folder,(assignment->>'sourceAssignmentId')::uuid,'private')
          RETURNING teacher_assignments.id INTO target_task;
          IF sample.sample_bytes IS NOT NULL THEN UPDATE public.teacher_assignments
            SET sample_image='/api/assignments/'||target_task||'/sample' WHERE teacher_assignments.id=target_task; END IF;
          item_position:=item_position+1;
          INSERT INTO public.course_items(course_id,assignment_id,position) VALUES(target,target_task,item_position);
        END IF;
        blocks:='[]';
        FOR block IN SELECT value FROM jsonb_array_elements(lesson->'blocks') LOOP
          IF block->>'type' IN ('activity','manual-material') THEN
            block:=jsonb_set(block,'{learningActivityVersionId}',mapping->(block->>'learningActivityVersionId'));
          END IF;
          blocks:=blocks||jsonb_build_array(block);
        END LOOP;
        INSERT INTO public.course_lessons(tenant_id,course_id,section_id,title,summary,content,blocks,kind,
          assignment_id,learning_activity_version_id,estimated_minutes,position)
        VALUES(p_destination,target,target_section,lesson->>'title',lesson->>'summary',lesson->>'content',blocks,
          CASE WHEN target_task IS NOT NULL OR target_pin IS NOT NULL THEN 'assignment' ELSE 'material' END,
          target_task,target_pin,NULLIF(lesson->>'estimatedMinutes','')::integer,(lesson->>'position')::integer);
      END LOOP;
    END LOOP;
    PERFORM public.course_outline_ensure(target);
    PERFORM public.course_items_sync_outline(target);
    INSERT INTO public.course_catalogue_copy_receipts VALUES(p_principal,p_request,digest,p_destination,
      p_course,p_version,release.version_number,release.content_hash,target,now());
  EXCEPTION WHEN SQLSTATE 'PZ201' OR check_violation OR foreign_key_violation THEN
    RETURN QUERY SELECT 'copy_unavailable'::varchar,NULL::uuid,NULL::uuid,NULL::integer,NULL::varchar,false;
    RETURN;
  END;
  RETURN QUERY SELECT 'ok'::varchar,target,p_version,release.version_number,release.content_hash,false;
END;
$$;
REVOKE ALL ON FUNCTION public.course_catalogue_take_v2(uuid,uuid,uuid,uuid,uuid,varchar,varchar,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_catalogue_take_v2(uuid,uuid,uuid,uuid,uuid,varchar,varchar,uuid) TO asalab_app;
