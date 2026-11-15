-- Administrator-selected private ComfyUI origin. Null preserves the installation's environment default.
ALTER TABLE public.ai_image_settings ADD COLUMN comfy_base_url varchar(256), ADD COLUMN comfy_revision bigint NOT NULL DEFAULT 1;

CREATE FUNCTION public.ai_comfyui_runtime() RETURNS varchar LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
 SELECT comfy_base_url FROM public.ai_image_settings WHERE singleton_key
$$;
REVOKE ALL ON FUNCTION public.ai_comfyui_runtime() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_comfyui_runtime() TO asalab_app;

CREATE FUNCTION public.ai_comfyui_config(p_actor uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN
  RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';
 END IF;
 RETURN (SELECT jsonb_build_object('configurationVersion',comfy_revision,'baseUrl',comfy_base_url) FROM public.ai_image_settings WHERE singleton_key);
END;$$;
REVOKE ALL ON FUNCTION public.ai_comfyui_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_comfyui_config(uuid) TO asalab_app;

CREATE FUNCTION public.ai_comfyui_config_set(p_actor uuid,p_expected bigint,p_url varchar,p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old public.ai_image_settings%ROWTYPE;payload jsonb;prior jsonb;host text;ip inet;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN
  RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';
 END IF;
 -- Same closed origin policy as the server parser: no DNS, path, credentials or metadata host.
 IF p_url IS NULL OR char_length(p_url)>256 OR p_url!~'^http://(localhost|host[.]docker[.]internal|[0-9]{1,3}([.][0-9]{1,3}){3}):[0-9]{1,5}$'
 OR split_part(p_url,':',3)::integer NOT BETWEEN 1 AND 65535 OR p_request IS NULL THEN
  RAISE EXCEPTION 'AI_COMFY_URL_INVALID' USING ERRCODE='22023';
 END IF;
 host:=split_part(substr(p_url,8),':',1);
 IF host NOT IN('localhost','host.docker.internal') THEN
  ip:=host::inet;
  IF NOT(ip<<inet '10.0.0.0/8' OR ip<<inet '127.0.0.0/8' OR ip<<inet '172.16.0.0/12' OR ip<<inet '192.168.0.0/16' OR ip<<inet '100.64.0.0/10') THEN
   RAISE EXCEPTION 'AI_COMFY_URL_INVALID' USING ERRCODE='22023';
  END IF;
 END IF;
 SELECT * INTO STRICT old FROM public.ai_image_settings WHERE singleton_key FOR UPDATE;
 payload:=jsonb_build_object('kind','comfy_endpoint','configurationVersion',p_expected,'baseUrl',p_url);
 SELECT w.payload INTO prior FROM public.ai_image_settings_writes w WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN
  IF prior IS DISTINCT FROM payload THEN RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='40001';END IF;
  RETURN;
 END IF;
 IF old.comfy_revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 -- Image admission locks this same settings row before inserting a durable GPU job.
 IF old.comfy_base_url IS DISTINCT FROM p_url AND EXISTS(
  SELECT 1 FROM public.ai_image_jobs WHERE state IN('admitted','submitting','unknown','running','storing')
 ) THEN RAISE EXCEPTION 'AI_COMFY_JOBS_ACTIVE' USING ERRCODE='55000';END IF;
 UPDATE public.ai_image_settings SET comfy_base_url=p_url,comfy_revision=comfy_revision+1 WHERE singleton_key;
 INSERT INTO public.ai_image_settings_writes VALUES(p_actor,p_request,payload);
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.comfyui.endpoint','integration','comfyui','admin_console','Private image server changed',NULL,p_request::text,p_request::text,'succeeded',old.comfy_revision,old.comfy_revision+1);
END;$$;
REVOKE ALL ON FUNCTION public.ai_comfyui_config_set(uuid,bigint,varchar,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_comfyui_config_set(uuid,bigint,varchar,uuid) TO asalab_app;
