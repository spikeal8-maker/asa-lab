-- Private virtual files, immutable versions and owner-bound idempotent writes.
-- No paths on the host filesystem, execution, provider access or public storage.
CREATE TABLE public.ai_working_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 thread_id uuid NOT NULL,
 owner_principal_id uuid NOT NULL,
 name varchar(96) NOT NULL CHECK(name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$' AND name NOT LIKE '%..%'),
 head integer NOT NULL DEFAULT 1 CHECK(head BETWEEN 1 AND 100),
 anchor_request_id uuid NOT NULL,
 source_message_id uuid,
 source_block integer CHECK(source_block BETWEEN 0 AND 19),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(thread_id,name), UNIQUE(id,owner_principal_id),
 FOREIGN KEY(thread_id,owner_principal_id) REFERENCES public.ai_assistant_threads(id,owner_principal_id) ON DELETE CASCADE,
 FOREIGN KEY(source_message_id,thread_id,owner_principal_id) REFERENCES public.ai_assistant_messages(id,thread_id,owner_principal_id) ON DELETE CASCADE
);
CREATE TABLE public.ai_working_file_versions (
 file_id uuid NOT NULL,
 owner_principal_id uuid NOT NULL,
 version integer NOT NULL CHECK(version BETWEEN 1 AND 100),
 base_version integer NOT NULL CHECK(base_version BETWEEN 0 AND 99),
 operation_id uuid NOT NULL,
 content text NOT NULL CHECK(char_length(content) BETWEEN 1 AND 96000 AND octet_length(content)<=131072),
 summary varchar(240) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(file_id,version), UNIQUE(owner_principal_id,operation_id),
 FOREIGN KEY(file_id,owner_principal_id) REFERENCES public.ai_working_files(id,owner_principal_id) ON DELETE CASCADE
);
ALTER TABLE public.ai_working_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_working_file_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_working_files,public.ai_working_file_versions FROM PUBLIC,asalab_app;

CREATE FUNCTION public.ai_working_files_list(p_owner uuid,p_thread uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner) THEN RAISE EXCEPTION 'AI_FILE_DENIED' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'version',head,'anchorRequestId',anchor_request_id,'sourceMessageId',source_message_id,'sourceBlock',source_block,'updatedAt',updated_at) ORDER BY created_at,id),'[]'::jsonb) FROM public.ai_working_files WHERE thread_id=p_thread AND owner_principal_id=p_owner);
END $$;

CREATE FUNCTION public.ai_working_file_read(p_owner uuid,p_thread uuid,p_name text,p_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE f public.ai_working_files%ROWTYPE; v public.ai_working_file_versions%ROWTYPE;
BEGIN
 IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_FILE_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.ai_working_files WHERE thread_id=p_thread AND owner_principal_id=p_owner AND name=p_name;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_FILE_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO v FROM public.ai_working_file_versions WHERE file_id=f.id AND version=coalesce(p_version,f.head);
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_FILE_DENIED' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',f.id,'name',f.name,'version',v.version,'headVersion',f.head,'content',v.content,'anchorRequestId',f.anchor_request_id,'sourceMessageId',f.source_message_id,'sourceBlock',f.source_block,'updatedAt',f.updated_at,
 'versions',(SELECT jsonb_agg(jsonb_build_object('version',version,'summary',summary,'createdAt',created_at) ORDER BY version DESC) FROM public.ai_working_file_versions WHERE file_id=f.id));
END $$;

CREATE FUNCTION public.ai_working_file_write(p_owner uuid,p_thread uuid,p_name text,p_expected integer,p_content text,p_operation uuid,p_request uuid,p_anchor uuid,p_source uuid,p_block integer,p_summary text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE t public.ai_assistant_threads%ROWTYPE; f public.ai_working_files%ROWTYPE; prior public.ai_working_file_versions%ROWTYPE; n integer;
BEGIN
 IF p_operation IS NULL OR p_expected IS NULL OR p_expected<0 OR p_expected>=100 OR p_content IS NULL OR char_length(p_content) NOT BETWEEN 1 AND 96000 OR octet_length(p_content)>131072 OR p_name IS NULL OR p_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$' OR p_name LIKE '%..%' OR p_name !~* '\.(html|svg|css|js|ts|json|txt|md|py|csv|xml|yaml|yml|sql)$' OR p_summary IS NULL OR char_length(p_summary)>240 THEN RAISE EXCEPTION 'AI_FILE_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner AND public.ai_chat_owner_valid(p_owner) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_FILE_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO prior FROM public.ai_working_file_versions WHERE owner_principal_id=p_owner AND operation_id=p_operation;
 IF FOUND THEN
  SELECT * INTO f FROM public.ai_working_files WHERE id=prior.file_id AND thread_id=p_thread AND owner_principal_id=p_owner AND name=p_name;
  IF NOT FOUND OR prior.base_version<>p_expected OR prior.content<>p_content THEN RAISE EXCEPTION 'AI_FILE_CONFLICT' USING ERRCODE='P0001'; END IF;
  RETURN public.ai_working_file_read(p_owner,p_thread,p_name,prior.version);
 END IF;
 IF t.archived_at IS NOT NULL THEN RAISE EXCEPTION 'AI_FILE_DENIED' USING ERRCODE='42501'; END IF;
 IF p_request IS NOT NULL THEN
  IF t.active_request_id IS DISTINCT FROM p_request OR t.busy_until IS NULL OR t.busy_until<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_messages WHERE thread_id=p_thread AND owner_principal_id=p_owner AND request_id=p_request AND role='user') THEN RAISE EXCEPTION 'AI_FILE_DENIED' USING ERRCODE='42501'; END IF;
 ELSE
  IF p_expected=0 OR t.busy_until>clock_timestamp() THEN RAISE EXCEPTION 'AI_FILE_CONFLICT' USING ERRCODE='P0001'; END IF;
 END IF;
 SELECT * INTO f FROM public.ai_working_files WHERE thread_id=p_thread AND owner_principal_id=p_owner AND name=p_name;
 IF FOUND THEN
  IF f.head<>p_expected THEN RAISE EXCEPTION 'AI_FILE_CONFLICT' USING ERRCODE='P0001'; END IF;
 ELSE
  IF p_expected<>0 THEN RAISE EXCEPTION 'AI_FILE_CONFLICT' USING ERRCODE='P0001'; END IF;
  IF (SELECT count(*) FROM public.ai_working_files WHERE thread_id=p_thread)>=20 THEN RAISE EXCEPTION 'AI_FILE_LIMIT' USING ERRCODE='P0001'; END IF;
  IF p_source IS NOT NULL THEN
   IF p_block IS NULL OR p_block NOT BETWEEN 0 AND 19 OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_messages WHERE id=p_source AND thread_id=p_thread AND owner_principal_id=p_owner AND request_id=p_anchor AND role='assistant' AND state='complete') THEN RAISE EXCEPTION 'AI_FILE_DENIED' USING ERRCODE='42501'; END IF;
  ELSIF p_anchor IS DISTINCT FROM p_request OR p_block IS NOT NULL THEN RAISE EXCEPTION 'AI_FILE_DENIED' USING ERRCODE='42501'; END IF;
  INSERT INTO public.ai_working_files(thread_id,owner_principal_id,name,anchor_request_id,source_message_id,source_block) VALUES(p_thread,p_owner,p_name,p_anchor,p_source,p_block) RETURNING * INTO f;
 END IF;
 IF (SELECT coalesce(sum(octet_length(v.content)),0) FROM public.ai_working_file_versions v JOIN public.ai_working_files a ON a.id=v.file_id WHERE a.thread_id=p_thread)+octet_length(p_content)>8388608 THEN RAISE EXCEPTION 'AI_FILE_LIMIT' USING ERRCODE='P0001'; END IF;
 n:=p_expected+1;
 INSERT INTO public.ai_working_file_versions(file_id,owner_principal_id,version,base_version,operation_id,content,summary) VALUES(f.id,p_owner,n,p_expected,p_operation,p_content,p_summary);
 UPDATE public.ai_working_files SET head=n,updated_at=clock_timestamp() WHERE id=f.id;
 RETURN public.ai_working_file_read(p_owner,p_thread,p_name,n);
END $$;
REVOKE ALL ON FUNCTION public.ai_working_files_list(uuid,uuid),public.ai_working_file_read(uuid,uuid,text,integer),public.ai_working_file_write(uuid,uuid,text,integer,text,uuid,uuid,uuid,uuid,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_working_files_list(uuid,uuid),public.ai_working_file_read(uuid,uuid,text,integer),public.ai_working_file_write(uuid,uuid,text,integer,text,uuid,uuid,uuid,uuid,integer,text) TO asalab_app;
