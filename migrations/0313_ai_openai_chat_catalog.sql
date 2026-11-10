-- Extend the closed OpenAI Responses catalog without publishing models to users.
CREATE OR REPLACE FUNCTION public.ai_model_provider_matches(p_provider varchar, p_model varchar)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT coalesce(CASE p_provider
        WHEN 'openai' THEN p_model IN (
            'gpt-6-luna', 'gpt-5-mini', 'gpt-4.1-mini',
            'gpt-6-astra',
            'gpt-6.1-sol',
            'gpt-6.1-terra',
            'gpt-6-sol',
            'gpt-5.6-sol',
            'gpt-5.6-terra',
            'gpt-5.6-luna',
            'gpt-5.5',
            'gpt-5.4',
            'gpt-5.4-mini',
            'gpt-5.2',
            'gpt-5.4-pro',
            'gpt-5.2-pro'
        )
        WHEN 'deepseek' THEN p_model IN ('deepseek-flash', 'deepseek-v4-pro')
        WHEN 'ollama-cloud' THEN EXISTS (
            SELECT 1 FROM public.ai_ollama_cloud_models WHERE id = p_model AND active
        )
        WHEN 'polza' THEN p_model = 'polza/unconfigured' OR EXISTS (
            SELECT 1 FROM public.ai_polza_models WHERE id = p_model AND kind = 'chat'
        )
        ELSE false
    END, false)
$$;
