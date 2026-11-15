-- An admitted native image may complete one exact HTML placeholder. No model/GPU retry.
CREATE TABLE public.ai_image_file_bindings (
 owner_principal_id uuid NOT NULL,
 parent_request_id uuid NOT NULL,
 child_request_id uuid NOT NULL,
 thread_id uuid NOT NULL,
 source_user_message_id uuid NOT NULL,
 file_id uuid NOT NULL,
 file_name varchar(96) NOT NULL,
 expected_version integer NOT NULL CHECK(expected_version BETWEEN 1 AND 99),
 placeholder varchar(64) NOT NULL CHECK(placeholder='ASA_GENERATED_IMAGE_PENDING'),
 operation_id uuid NOT NULL DEFAULT gen_random_uuid(),
 state varchar(16) NOT NULL DEFAULT 'waiting' CHECK(state IN('waiting','applied','superseded','cancelled','failed')),
 applied_version integer,
 PRIMARY KEY(owner_principal_id,parent_request_id),
 UNIQUE(owner_principal_id,child_request_id), UNIQUE(owner_principal_id,operation_id),
 FOREIGN KEY(owner_principal_id,child_request_id) REFERENCES public.ai_image_jobs(owner_principal_id,request_id) ON DELETE CASCADE,
 FOREIGN KEY(thread_id,owner_principal_id) REFERENCES public.ai_assistant_threads(id,owner_principal_id) ON DELETE CASCADE,
 FOREIGN KEY(file_id,owner_principal_id) REFERENCES public.ai_working_files(id,owner_principal_id) ON DELETE CASCADE
);
ALTER TABLE public.ai_image_file_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_image_file_bindings FROM PUBLIC,asalab_app;

CREATE FUNCTION public.ai_tool_image_file_begin(p_owner uuid,p_thread uuid,p_parent uuid,p_child uuid,p_prompt varchar,p_size integer,p_provider uuid,p_seed bigint,p_ready boolean,p_graph_digest varchar,p_recipe varchar,p_target jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b public.ai_image_file_bindings%ROWTYPE; f public.ai_working_files%ROWTYPE; v public.ai_working_file_versions%ROWTYPE; r public.ai_tool_image_receipts%ROWTYPE; j jsonb; n integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
 IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_target) IS DISTINCT FROM 'object' OR p_target->>'placeholder' IS DISTINCT FROM 'ASA_GENERATED_IMAGE_PENDING' OR jsonb_typeof(p_target->'name') IS DISTINCT FROM 'string' OR p_target->>'name' !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,90}\.html$' OR p_target->>'name' LIKE '%..%' OR jsonb_typeof(p_target->'expectedVersion') IS DISTINCT FROM 'number' OR p_target->>'expectedVersion' !~ '^[1-9][0-9]?$' THEN RAISE EXCEPTION 'AI_IMAGE_FILE_TARGET_INVALID' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_target))<>3 THEN RAISE EXCEPTION 'AI_IMAGE_FILE_TARGET_INVALID' USING ERRCODE='22023'; END IF;
 n:=(p_target->>'expectedVersion')::integer;
 SELECT * INTO b FROM public.ai_image_file_bindings WHERE owner_principal_id=p_owner AND parent_request_id=p_parent;
 IF FOUND THEN
  IF b.thread_id<>p_thread OR b.file_name<>p_target->>'name' OR b.expected_version<>n OR b.placeholder<>p_target->>'placeholder' THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
  RETURN public.ai_tool_image_begin(p_owner,p_thread,p_parent,p_child,p_prompt,p_size,p_provider,p_seed,p_ready,p_graph_digest,p_recipe);
 END IF;
 -- An old image receipt cannot be rebound to a new file by replaying it.
 IF EXISTS(SELECT 1 FROM public.ai_tool_image_receipts WHERE owner_principal_id=p_owner AND parent_request_id=p_parent) THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.ai_assistant_threads WHERE id=p_thread AND owner_principal_id=p_owner AND active_request_id=p_parent AND archived_at IS NULL AND busy_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_THREAD_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.ai_working_files WHERE owner_principal_id=p_owner AND thread_id=p_thread AND name=p_target->>'name';
 IF NOT FOUND OR f.head<>n THEN RAISE EXCEPTION 'AI_IMAGE_FILE_TARGET_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO STRICT v FROM public.ai_working_file_versions WHERE file_id=f.id AND owner_principal_id=p_owner AND version=n;
 IF (length(v.content)-length(replace(v.content,p_target->>'placeholder','')))/length(p_target->>'placeholder')<>1 THEN RAISE EXCEPTION 'AI_IMAGE_FILE_TARGET_INVALID' USING ERRCODE='22023'; END IF;
 j:=public.ai_tool_image_begin(p_owner,p_thread,p_parent,p_child,p_prompt,p_size,p_provider,p_seed,p_ready,p_graph_digest,p_recipe);
 SELECT * INTO STRICT r FROM public.ai_tool_image_receipts WHERE owner_principal_id=p_owner AND parent_request_id=p_parent;
 INSERT INTO public.ai_image_file_bindings(owner_principal_id,parent_request_id,child_request_id,thread_id,source_user_message_id,file_id,file_name,expected_version,placeholder)
 VALUES(p_owner,p_parent,r.child_request_id,p_thread,r.source_user_message_id,f.id,f.name,n,p_target->>'placeholder');
 RETURN j;
END;$$;

-- Runs in the image transition transaction: GET complete never races an outstanding file write.
-- The same path handles a verified late PUT/recovered ComfyUI result after restart.
CREATE FUNCTION public.ai_image_file_binding_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b public.ai_image_file_bindings%ROWTYPE; t public.ai_assistant_threads%ROWTYPE; f public.ai_working_files%ROWTYPE; v public.ai_working_file_versions%ROWTYPE; source_ordinal bigint; saved jsonb;
BEGIN
 SELECT * INTO b FROM public.ai_image_file_bindings WHERE owner_principal_id=NEW.owner_principal_id AND child_request_id=NEW.request_id AND state='waiting' FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF NEW.cancel_requested OR NEW.deleted_at IS NOT NULL OR NEW.state='cancelled' THEN
  UPDATE public.ai_image_file_bindings SET state='cancelled' WHERE owner_principal_id=b.owner_principal_id AND parent_request_id=b.parent_request_id; RETURN NEW;
 END IF;
 IF NEW.state='failed' THEN
  UPDATE public.ai_image_file_bindings SET state='failed' WHERE owner_principal_id=b.owner_principal_id AND parent_request_id=b.parent_request_id; RETURN NEW;
 END IF;
 IF NEW.state<>'complete' THEN RETURN NEW; END IF;
 SELECT * INTO t FROM public.ai_assistant_threads WHERE id=b.thread_id AND owner_principal_id=b.owner_principal_id FOR UPDATE;
 IF NOT FOUND OR t.archived_at IS NOT NULL OR NOT public.ai_chat_owner_valid(b.owner_principal_id) THEN
  UPDATE public.ai_image_file_bindings SET state='cancelled' WHERE owner_principal_id=b.owner_principal_id AND parent_request_id=b.parent_request_id; RETURN NEW;
 END IF;
 SELECT ordinal INTO source_ordinal FROM public.ai_assistant_messages WHERE id=b.source_user_message_id AND thread_id=b.thread_id AND owner_principal_id=b.owner_principal_id AND role='user';
 SELECT * INTO f FROM public.ai_working_files WHERE id=b.file_id AND owner_principal_id=b.owner_principal_id AND thread_id=b.thread_id;
 IF source_ordinal IS NULL OR NOT FOUND OR f.head<>b.expected_version OR t.busy_until>clock_timestamp() OR EXISTS(SELECT 1 FROM public.ai_assistant_messages WHERE thread_id=b.thread_id AND owner_principal_id=b.owner_principal_id AND role='user' AND ordinal>source_ordinal) THEN
  UPDATE public.ai_image_file_bindings SET state='superseded' WHERE owner_principal_id=b.owner_principal_id AND parent_request_id=b.parent_request_id; RETURN NEW;
 END IF;
 SELECT * INTO STRICT v FROM public.ai_working_file_versions WHERE file_id=f.id AND owner_principal_id=b.owner_principal_id AND version=b.expected_version;
 BEGIN
  saved:=public.ai_working_file_write(b.owner_principal_id,b.thread_id,b.file_name,b.expected_version,
   replace(v.content,b.placeholder,'/api/ai/threads/'||b.thread_id||'/image-generations/'||b.child_request_id||'/image'),b.operation_id,NULL,NULL,NULL,NULL,'Добавлено созданное изображение');
 EXCEPTION WHEN SQLSTATE 'P0001' OR SQLSTATE '42501' OR SQLSTATE '22023' THEN
  IF SQLERRM NOT IN('AI_FILE_CONFLICT','AI_FILE_LIMIT','AI_FILE_DENIED','AI_FILE_INVALID') THEN RAISE; END IF;
  UPDATE public.ai_image_file_bindings SET state=CASE WHEN SQLERRM='AI_FILE_CONFLICT' THEN 'superseded' ELSE 'failed' END WHERE owner_principal_id=b.owner_principal_id AND parent_request_id=b.parent_request_id;
  RETURN NEW;
 END;
 UPDATE public.ai_image_file_bindings SET state='applied',applied_version=(saved->>'version')::integer WHERE owner_principal_id=b.owner_principal_id AND parent_request_id=b.parent_request_id;
 RETURN NEW;
END;$$;
CREATE TRIGGER ai_image_file_binding_complete AFTER UPDATE OF state,cancel_requested,deleted_at ON public.ai_image_jobs FOR EACH ROW EXECUTE FUNCTION public.ai_image_file_binding_complete();
REVOKE ALL ON FUNCTION public.ai_image_file_binding_complete() FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.ai_tool_image_file_begin(uuid,uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar,varchar,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_tool_image_file_begin(uuid,uuid,uuid,uuid,varchar,integer,uuid,bigint,boolean,varchar,varchar,jsonb) TO asalab_app;
