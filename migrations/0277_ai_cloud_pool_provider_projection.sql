-- Pool credentials are changed under the singleton configuration lock. Keep its
-- legacy selected-provider projection aligned with the independent Cloud switch.
-- Adding a key never enables a disabled provider slot.
CREATE FUNCTION public.ai_cloud_pool_provider_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 UPDATE public.ai_assistant_config c
    SET enabled=NEW.enabled AND NEW.api_key_ciphertext IS NOT NULL,
        api_key_ciphertext=NEW.api_key_ciphertext,
        api_key_iv=NEW.api_key_iv,
        api_key_auth_tag=NEW.api_key_auth_tag,
        key_fingerprint=NEW.key_fingerprint
  WHERE c.singleton_key AND c.provider='ollama-cloud';
 RETURN NEW;
END;$$;
CREATE TRIGGER ai_cloud_pool_provider_projection
 AFTER UPDATE OF enabled,api_key_ciphertext ON public.ai_provider_settings
 FOR EACH ROW WHEN (NEW.provider='ollama-cloud')
 EXECUTE FUNCTION public.ai_cloud_pool_provider_projection();
REVOKE ALL ON FUNCTION public.ai_cloud_pool_provider_projection() FROM PUBLIC,asalab_app;
