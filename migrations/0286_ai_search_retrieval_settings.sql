-- Additive search controls; preserve all existing settings, credentials and owner receipts.
ALTER TABLE public.ai_web_search_settings
 ADD COLUMN results_limit integer NOT NULL DEFAULT 8 CHECK(results_limit BETWEEN 1 AND 12),
 ADD COLUMN pages_limit integer NOT NULL DEFAULT 2 CHECK(pages_limit BETWEEN 0 AND 2),
 ADD COLUMN page_char_limit integer NOT NULL DEFAULT 4500 CHECK(page_char_limit BETWEEN 500 AND 8000);

CREATE FUNCTION public.ai_web_search_retrieval_set(
 p_actor uuid,p_enabled boolean,p_weather boolean,p_limit integer,p_revision bigint,p_request varchar,
 p_allowed jsonb,p_blocked jsonb,p_instructions varchar,p_results integer,p_pages integer,p_chars integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_results IS NULL OR p_results NOT BETWEEN 1 AND 12 OR p_pages IS NULL OR p_pages NOT BETWEEN 0 AND 2
    OR p_chars IS NULL OR p_chars NOT BETWEEN 500 AND 8000 THEN
  RAISE EXCEPTION 'AI_WEB_CONFIG_INVALID' USING ERRCODE='22023';
 END IF;
 -- Existing platform-admin authorization, row lock, revision CAS and audit remain mandatory.
 PERFORM public.ai_web_search_policy_set(p_actor,p_enabled,p_weather,p_limit,p_revision,p_request,p_allowed,p_blocked,p_instructions);
 UPDATE public.ai_web_search_settings SET results_limit=p_results,pages_limit=p_pages,page_char_limit=p_chars WHERE singleton_key;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.ai_web_search.retrieval.update','integration','searxng',
  'admin_console',format('Search retrieval: %s results, %s pages, %s characters',p_results,p_pages,p_chars),NULL,p_request,p_request,'succeeded',p_revision,p_revision+1);
END;
$$;
REVOKE ALL ON FUNCTION public.ai_web_search_retrieval_set(uuid,boolean,boolean,integer,bigint,varchar,jsonb,jsonb,varchar,integer,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_web_search_retrieval_set(uuid,boolean,boolean,integer,bigint,varchar,jsonb,jsonb,varchar,integer,integer,integer) TO asalab_app;
