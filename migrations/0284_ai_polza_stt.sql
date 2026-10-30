-- Polza AI is independent of the closed text-provider catalog and existing credentials.
-- All secrets live in a singleton, with no direct app-role table access.
CREATE TABLE public.ai_polza_settings (
  singleton_key boolean PRIMARY KEY DEFAULT true CHECK (singleton_key),
  enabled boolean NOT NULL DEFAULT false,
  transcription_enabled boolean NOT NULL DEFAULT false,
  daily_seconds_limit integer NOT NULL DEFAULT 600 CHECK (daily_seconds_limit BETWEEN 60 AND 3600),
  global_daily_seconds_limit integer NOT NULL DEFAULT 7200 CHECK (global_daily_seconds_limit BETWEEN 600 AND 86400),
  max_audio_seconds integer NOT NULL DEFAULT 20 CHECK (max_audio_seconds BETWEEN 5 AND 30),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  api_key_ciphertext varchar(4096),
  api_key_iv varchar(64),
  api_key_auth_tag varchar(64),
  key_fingerprint varchar(16),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (api_key_ciphertext IS NULL AND api_key_iv IS NULL AND api_key_auth_tag IS NULL AND key_fingerprint IS NULL)
    OR
    (api_key_ciphertext IS NOT NULL AND api_key_iv IS NOT NULL AND api_key_auth_tag IS NOT NULL AND key_fingerprint IS NOT NULL)
  )
);
INSERT INTO public.ai_polza_settings (singleton_key) VALUES (true);
ALTER TABLE public.ai_polza_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_polza_settings FROM PUBLIC, asalab_app;

CREATE TABLE public.ai_polza_daily_usage (
  owner_principal_id uuid NOT NULL,
  utc_day date NOT NULL,
  reserved_seconds integer NOT NULL DEFAULT 0 CHECK (reserved_seconds >= 0),
  PRIMARY KEY (owner_principal_id, utc_day)
);
CREATE TABLE public.ai_polza_stt_attempts (
  request_id uuid PRIMARY KEY,
  owner_principal_id uuid NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ai_polza_stt_attempts_owner_at ON public.ai_polza_stt_attempts (owner_principal_id, admitted_at DESC);
ALTER TABLE public.ai_polza_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_polza_stt_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_polza_daily_usage, public.ai_polza_stt_attempts FROM PUBLIC, asalab_app;

CREATE FUNCTION public.ai_polza_admin_config(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF public.admin_authorized_role(p_actor, 'platform', NULL) IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'configurationVersion', revision, 'enabled', enabled,
      'transcriptionEnabled', transcription_enabled,
      'dailySecondsLimit', daily_seconds_limit,
      'globalDailySecondsLimit', global_daily_seconds_limit,
      'maxAudioSeconds', max_audio_seconds,
      'apiKeyConfigured', api_key_ciphertext IS NOT NULL,
      'keyFingerprint', key_fingerprint,
      'updatedAt', updated_at
    ) FROM public.ai_polza_settings WHERE singleton_key
  );
END;
$$;
REVOKE ALL ON FUNCTION public.ai_polza_admin_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_polza_admin_config(uuid) TO asalab_app;

CREATE FUNCTION public.ai_polza_admin_set(p_actor uuid, p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  old_row public.ai_polza_settings%ROWTYPE;
  key_action text;
  next_enabled boolean;
  next_stt boolean;
  next_limit integer;
  next_global_limit integer;
  next_max integer;
  request_id uuid;
BEGIN
  IF public.admin_authorized_role(p_actor, 'platform', NULL) IS DISTINCT FROM 'platform_admin' THEN
    RAISE EXCEPTION 'AI_ADMIN_DENIED' USING ERRCODE = '42501';
  END IF;
  IF p_body IS NULL OR jsonb_typeof(p_body) <> 'object' THEN
    RAISE EXCEPTION 'AI_POLZA_INVALID' USING ERRCODE = '22023';
  END IF;
  key_action := p_body->>'action';
  next_enabled := (p_body->>'enabled')::boolean;
  next_stt := (p_body->>'transcriptionEnabled')::boolean;
  next_limit := (p_body->>'dailySecondsLimit')::integer;
  next_global_limit := (p_body->>'globalDailySecondsLimit')::integer;
  next_max := (p_body->>'maxAudioSeconds')::integer;
  request_id := (p_body->>'requestId')::uuid;
  IF key_action NOT IN ('keep', 'replace', 'clear')
     OR next_enabled IS NULL OR next_stt IS NULL
     OR next_limit NOT BETWEEN 60 AND 3600 OR next_global_limit NOT BETWEEN 600 AND 86400
     OR next_max NOT BETWEEN 5 AND 30
     OR request_id IS NULL OR (next_stt AND NOT next_enabled)
     OR (key_action = 'replace' AND (
       length(p_body->>'ciphertext') NOT BETWEEN 8 AND 4096
       OR length(p_body->>'iv') NOT BETWEEN 12 AND 64
       OR length(p_body->>'tag') NOT BETWEEN 16 AND 64
       OR length(p_body->>'fingerprint') NOT BETWEEN 8 AND 16
     )) THEN
    RAISE EXCEPTION 'AI_POLZA_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO STRICT old_row FROM public.ai_polza_settings WHERE singleton_key FOR UPDATE;
  IF (p_body->>'configurationVersion')::bigint IS DISTINCT FROM old_row.revision THEN
    RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE = '40001';
  END IF;
  IF next_enabled AND key_action <> 'replace' AND
     (key_action = 'clear' OR old_row.api_key_ciphertext IS NULL) THEN
    RAISE EXCEPTION 'AI_KEY_REQUIRED' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ai_polza_settings SET
    enabled = next_enabled,
    transcription_enabled = next_stt,
    daily_seconds_limit = next_limit,
    global_daily_seconds_limit = next_global_limit,
    max_audio_seconds = next_max,
    api_key_ciphertext = CASE key_action WHEN 'replace' THEN p_body->>'ciphertext'
      WHEN 'clear' THEN NULL ELSE old_row.api_key_ciphertext END,
    api_key_iv = CASE key_action WHEN 'replace' THEN p_body->>'iv'
      WHEN 'clear' THEN NULL ELSE old_row.api_key_iv END,
    api_key_auth_tag = CASE key_action WHEN 'replace' THEN p_body->>'tag'
      WHEN 'clear' THEN NULL ELSE old_row.api_key_auth_tag END,
    key_fingerprint = CASE key_action WHEN 'replace' THEN p_body->>'fingerprint'
      WHEN 'clear' THEN NULL ELSE old_row.key_fingerprint END,
    revision = old_row.revision + 1,
    updated_at = clock_timestamp()
  WHERE singleton_key;
  PERFORM public.admin_append_audit_event(
    p_actor, 'platform', NULL, 'administration.ai_configuration.update',
    'integration', 'polza', 'admin_console', 'Настройка Polza AI',
    NULL, request_id::text, request_id::text, 'succeeded', old_row.revision, old_row.revision + 1
  );
  RETURN public.ai_polza_admin_config(p_actor);
END;
$$;
REVOKE ALL ON FUNCTION public.ai_polza_admin_set(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_polza_admin_set(uuid,jsonb) TO asalab_app;

CREATE FUNCTION public.ai_polza_runtime()
RETURNS TABLE (
  enabled boolean, transcription_enabled boolean,
  daily_seconds_limit integer, global_daily_seconds_limit integer, max_audio_seconds integer,
  api_key_ciphertext varchar, api_key_iv varchar,
  api_key_auth_tag varchar, revision bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT enabled, transcription_enabled, daily_seconds_limit, global_daily_seconds_limit, max_audio_seconds,
         api_key_ciphertext, api_key_iv, api_key_auth_tag, revision
  FROM public.ai_polza_settings WHERE singleton_key
$$;
REVOKE ALL ON FUNCTION public.ai_polza_runtime() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_polza_runtime() TO asalab_app;

CREATE FUNCTION public.ai_polza_stt_admit(p_owner uuid, p_request uuid, p_expected_revision bigint)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  cfg public.ai_polza_settings%ROWTYPE;
  changed integer;
  today_utc date := (statement_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
  IF p_owner IS NULL OR p_request IS NULL THEN
    RAISE EXCEPTION 'AI_POLZA_INVALID' USING ERRCODE = '22023';
  END IF;
  -- Exclusive lock serializes the global daily budget across all app replicas.
  SELECT * INTO STRICT cfg FROM public.ai_polza_settings WHERE singleton_key FOR UPDATE;
  -- Bind duration validation and reserved budget to the exact runtime settings
  -- inspected before queueing. A concurrent admin change must not undercharge STT.
  IF cfg.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'AI_CONFIG_CHANGED' USING ERRCODE = '40001';
  END IF;
  IF NOT cfg.enabled OR NOT cfg.transcription_enabled OR cfg.api_key_ciphertext IS NULL THEN
    RAISE EXCEPTION 'AI_STT_DISABLED' USING ERRCODE = '55000';
  END IF;
  -- A duplicate/uncertain request never initiates a second potentially billable dispatch.
  INSERT INTO public.ai_polza_stt_attempts(request_id,owner_principal_id) VALUES(p_request,p_owner)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'AI_STT_REPLAY_BLOCKED' USING ERRCODE = '40001'; END IF;
  IF (SELECT COALESCE(SUM(reserved_seconds),0) FROM public.ai_polza_daily_usage WHERE utc_day = today_utc)
       + cfg.max_audio_seconds > cfg.global_daily_seconds_limit THEN
    RAISE EXCEPTION 'AI_STT_DAILY_LIMIT' USING ERRCODE = '55000';
  END IF;
  -- Charge the configured MAX duration, not client-reported audio length, to prevent forged durations
  -- from bypassing the per-owner admission budget. This is reserved allowance, not billed seconds.
  INSERT INTO public.ai_polza_daily_usage(owner_principal_id,utc_day,reserved_seconds)
  VALUES(p_owner,today_utc,cfg.max_audio_seconds)
  ON CONFLICT(owner_principal_id,utc_day) DO UPDATE
    SET reserved_seconds = public.ai_polza_daily_usage.reserved_seconds + EXCLUDED.reserved_seconds
    WHERE public.ai_polza_daily_usage.reserved_seconds + EXCLUDED.reserved_seconds <= cfg.daily_seconds_limit;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN
    RAISE EXCEPTION 'AI_STT_DAILY_LIMIT' USING ERRCODE = '55000';
  END IF;
  RETURN cfg.max_audio_seconds;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_polza_stt_admit(uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_polza_stt_admit(uuid,uuid,bigint) TO asalab_app;
