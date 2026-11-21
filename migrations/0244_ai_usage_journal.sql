-- Current admissions only: do not invent historic provider/model/token facts.
-- No conversation FK: deleting a conversation cannot erase usage or refund quota.
CREATE TABLE public.ai_usage_journal (
    owner_principal_id uuid NOT NULL,
    request_id uuid NOT NULL,
    account_id uuid,
    seat_id uuid,
    thread_id uuid,
    admitted_at timestamptz NOT NULL,
    started_at timestamptz,
    finished_at timestamptz,
    duration_ms bigint CHECK (duration_ms >= 0),
    operation varchar(16) CHECK (operation IN ('chat','regeneration')),
    transport varchar(8) CHECK (transport IN ('json','sse')),
    provider varchar(12) CHECK (provider IN ('openai','deepseek','ollama')),
    requested_model varchar(200),
    actual_model varchar(200),
    status varchar(16) NOT NULL DEFAULT 'admitted' CHECK (status IN ('admitted','running','succeeded','stopped','cancelled','failed')),
    error_code varchar(64),
    input_tokens bigint CHECK (input_tokens BETWEEN 0 AND 9007199254740991),
    output_tokens bigint CHECK (output_tokens BETWEEN 0 AND 9007199254740991),
    PRIMARY KEY (owner_principal_id, request_id),
    CHECK ((account_id IS NOT NULL) <> (seat_id IS NOT NULL))
);
CREATE INDEX ai_usage_owner_time_idx ON public.ai_usage_journal(owner_principal_id,admitted_at DESC,request_id);
ALTER TABLE public.ai_usage_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_journal FROM PUBLIC,asalab_app;

CREATE FUNCTION public.ai_usage_admission_record()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
    INSERT INTO public.ai_usage_journal(owner_principal_id,request_id,account_id,seat_id,admitted_at)
    SELECT NEW.owner_principal_id,NEW.request_id,p.account_id,p.seat_id,NEW.created_at
      FROM public.principals p WHERE p.id=NEW.owner_principal_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_USAGE_OWNER_INVALID' USING ERRCODE='42501'; END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_usage_admission_record() FROM PUBLIC,asalab_app;
CREATE TRIGGER ai_usage_admission AFTER INSERT ON public.ai_assistant_request_quota
FOR EACH ROW EXECUTE FUNCTION public.ai_usage_admission_record();

CREATE FUNCTION public.ai_usage_begin(p_owner uuid,p_thread uuid,p_request uuid,p_operation varchar,p_transport varchar,p_provider varchar,p_model varchar)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_operation varchar;
BEGIN
    IF p_operation IS NULL OR p_operation NOT IN ('chat','regeneration') OR p_transport IS NULL OR p_transport NOT IN ('json','sse')
       OR p_provider IS NULL OR p_provider NOT IN ('openai','deepseek','ollama') OR p_model IS NULL
       OR p_model !~ '^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,199}$' OR position('://' IN p_model)>0 THEN
        RAISE EXCEPTION 'AI_USAGE_INVALID' USING ERRCODE='22023';
    END IF;
    -- Canonical admission, exact owner, and current thread lease are mandatory.
    PERFORM 1 FROM public.ai_assistant_threads t JOIN public.ai_assistant_request_quota q
      ON q.owner_principal_id=t.owner_principal_id AND q.request_id=t.active_request_id
     WHERE t.id=p_thread AND t.owner_principal_id=p_owner AND t.active_request_id=p_request FOR UPDATE OF t;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_USAGE_DENIED' USING ERRCODE='42501'; END IF;
    IF EXISTS(SELECT 1 FROM public.ai_assistant_regenerations r WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND r.request_id=p_request) THEN
        v_operation:='regeneration';
    ELSIF EXISTS(SELECT 1 FROM public.ai_assistant_messages m WHERE m.owner_principal_id=p_owner AND m.thread_id=p_thread AND m.request_id=p_request AND m.role='user') THEN
        v_operation:='chat';
    END IF;
    IF v_operation IS DISTINCT FROM p_operation THEN RAISE EXCEPTION 'AI_USAGE_DENIED' USING ERRCODE='42501'; END IF;
    UPDATE public.ai_usage_journal SET thread_id=p_thread,operation=p_operation,transport=p_transport,
      provider=p_provider,requested_model=p_model,started_at=clock_timestamp(),status='running'
     WHERE owner_principal_id=p_owner AND request_id=p_request AND status='admitted';
    RETURN FOUND;
END;
$$;

CREATE FUNCTION public.ai_usage_finish(p_owner uuid,p_request uuid,p_status varchar,p_error varchar,p_input bigint,p_output bigint,p_model varchar)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_row public.ai_usage_journal%ROWTYPE; v_end timestamptz;
BEGIN
    IF p_status IS NULL OR p_status NOT IN ('succeeded','stopped','cancelled','failed')
       OR (p_error IS NOT NULL AND p_error NOT IN ('ai_provider_error','ai_response_incomplete','ai_response_invalid','ai_response_empty',
         'ai_stream_invalid','ai_stream_interrupted','ai_provider_timeout','ai_provider_unavailable','ai_provider_rate_limit',
         'ai_provider_authentication_failed','ai_provider_invalid_request','ai_provider_access_denied','ai_provider_insufficient_balance',
         'ai_provider_invalid_parameters','ai_provider_model_unavailable','ai_ollama_unreachable',
         'ai_ollama_timeout','ai_ollama_interrupted','ai_ollama_invalid','ai_ollama_upstream_error','ai_ollama_empty',
         'ai_generation_failed')) OR p_input<0 OR p_output<0 OR p_input>9007199254740991 OR p_output>9007199254740991
       OR (p_model IS NOT NULL AND (p_model !~ '^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{0,199}$' OR position('://' IN p_model)>0)) THEN
        RAISE EXCEPTION 'AI_USAGE_INVALID' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_row FROM public.ai_usage_journal WHERE owner_principal_id=p_owner AND request_id=p_request FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_USAGE_DENIED' USING ERRCODE='42501'; END IF;
    IF v_row.status NOT IN ('admitted','running') THEN
        IF v_row.status IS DISTINCT FROM p_status OR v_row.error_code IS DISTINCT FROM p_error
           OR v_row.input_tokens IS DISTINCT FROM p_input OR v_row.output_tokens IS DISTINCT FROM p_output
           OR v_row.actual_model IS DISTINCT FROM p_model THEN
            RAISE EXCEPTION 'AI_USAGE_CONFLICT' USING ERRCODE='22023';
        END IF;
        RETURN true;
    END IF;
    IF v_row.status <> 'running' OR NOT EXISTS(SELECT 1 FROM public.ai_assistant_request_quota q WHERE q.owner_principal_id=p_owner AND q.request_id=p_request) THEN
        RAISE EXCEPTION 'AI_USAGE_DENIED' USING ERRCODE='42501';
    END IF;
    v_end:=clock_timestamp();
    UPDATE public.ai_usage_journal SET status=p_status,error_code=p_error,finished_at=v_end,
      duration_ms=greatest(0,floor(extract(epoch FROM (v_end-started_at))*1000)::bigint),
      input_tokens=p_input,output_tokens=p_output,actual_model=p_model
     WHERE owner_principal_id=p_owner AND request_id=p_request;
    RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_usage_begin(uuid,uuid,uuid,varchar,varchar,varchar,varchar),
  public.ai_usage_finish(uuid,uuid,varchar,varchar,bigint,bigint,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_usage_begin(uuid,uuid,uuid,varchar,varchar,varchar,varchar),
  public.ai_usage_finish(uuid,uuid,varchar,varchar,bigint,bigint,varchar) TO asalab_app;
