-- Classify video separately from other provider entries. Existing selections are preserved.
ALTER TABLE public.ai_polza_models DROP CONSTRAINT ai_polza_models_kind_check;
ALTER TABLE public.ai_polza_models ADD CONSTRAINT ai_polza_models_kind_check
    CHECK (kind IN ('chat', 'stt', 'image', 'video', 'other'));

CREATE OR REPLACE FUNCTION public.ai_polza_catalog_apply(p_actor uuid,p_revision bigint,p_models jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE s public.ai_polza_settings%ROWTYPE;m jsonb;old_version bigint;event_id text:=gen_random_uuid()::text;
BEGIN
 IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.ai_assistant_config WHERE singleton_key FOR UPDATE;
 SELECT * INTO STRICT s FROM public.ai_polza_settings WHERE singleton_key FOR UPDATE;
 IF s.revision IS DISTINCT FROM p_revision OR s.api_key_ciphertext IS NULL THEN RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE='40001';END IF;
 IF jsonb_typeof(p_models) IS DISTINCT FROM 'array' OR jsonb_array_length(p_models)>1200 OR
  (SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(p_models)) THEN RAISE EXCEPTION 'AI_POLZA_INVALID' USING ERRCODE='22023';END IF;
 SELECT revision INTO old_version FROM public.ai_polza_catalog_state WHERE singleton_key;
 -- Validate all rows before retiring existing metadata. No key or endpoint comes from the catalogue.
 FOR m IN SELECT value FROM jsonb_array_elements(p_models) LOOP
  IF m->>'id' IS NULL OR m->>'upstream' IS NULL OR m->>'id'<>'polza/'||(m->>'upstream') OR
    (m->>'upstream')!~'^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$' OR position('://' IN (m->>'upstream'))>0 OR length(m->>'label') NOT BETWEEN 1 AND 120 OR
    m->>'kind' NOT IN('chat','stt','image','video','other') OR jsonb_typeof(m->'vision') IS DISTINCT FROM 'boolean' OR
    jsonb_typeof(m->'tools') IS DISTINCT FROM 'boolean' OR jsonb_typeof(m->'maxOutputTokens') IS DISTINCT FROM 'number' OR
    (m->>'maxOutputTokens')::numeric<>trunc((m->>'maxOutputTokens')::numeric) OR (m->>'maxOutputTokens')::numeric NOT BETWEEN 1 AND 8192
    THEN RAISE EXCEPTION 'AI_POLZA_INVALID' USING ERRCODE='22023';END IF;
 END LOOP;
 UPDATE public.ai_polza_models SET active=false;
 FOR m IN SELECT value FROM jsonb_array_elements(p_models) LOOP
  INSERT INTO public.ai_polza_models(id,upstream,label,kind,vision,tools,max_output_tokens,active,selected)
   VALUES(m->>'id',m->>'upstream',m->>'label',m->>'kind',(m->>'vision')::boolean,(m->>'tools')::boolean,(m->>'maxOutputTokens')::integer,true,false)
   ON CONFLICT(id) DO UPDATE SET label=excluded.label,kind=excluded.kind,vision=excluded.vision,tools=excluded.tools,
    max_output_tokens=excluded.max_output_tokens,active=true,selected=ai_polza_models.selected AND excluded.kind='chat';
 END LOOP;
 UPDATE public.ai_polza_catalog_state SET revision=revision+1,checked_at=clock_timestamp(),credential_fingerprint=s.key_fingerprint WHERE singleton_key;
 UPDATE public.ai_assistant_config SET configuration_version=configuration_version+1 WHERE singleton_key;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_configuration.update','integration','polza_catalog','admin_console','Обновление каталога Polza',NULL,event_id,event_id,'succeeded',old_version,old_version+1);
END;$$;
