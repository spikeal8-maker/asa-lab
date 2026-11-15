-- Encrypted installation SMTP and one-use, short-lived Account email proof.
CREATE TABLE public.smtp_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 config jsonb NOT NULL DEFAULT '{}'::jsonb,
 password_envelope jsonb,
 version integer NOT NULL DEFAULT 1,
 tested_version integer,
 delivery_verified_version integer,
 tested_at timestamptz,
 test_ok boolean NOT NULL DEFAULT false
);
INSERT INTO public.smtp_settings(singleton) VALUES(true);
ALTER TABLE public.smtp_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smtp_settings FROM PUBLIC,asalab_app;
CREATE TABLE public.account_email_intents (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 actor_id uuid NOT NULL REFERENCES public.principals(id),
 purpose varchar NOT NULL CHECK(purpose IN('change','verify')),
 request_id uuid NOT NULL,
 old_email varchar(255),
 new_email varchar(255) NOT NULL,
 reason varchar(500) NOT NULL,
 token_hash varchar(64) NOT NULL UNIQUE,
 smtp_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 minutes',
 state varchar NOT NULL DEFAULT 'sending' CHECK(state IN('sending','sent','failed','cancelled','consumed')),
 UNIQUE(actor_id,request_id)
);
CREATE INDEX account_email_intents_account_idx ON public.account_email_intents(account_id,created_at DESC);
ALTER TABLE public.account_email_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_email_intents FROM PUBLIC,asalab_app;

CREATE FUNCTION public.mail_authorize(p_actor uuid,p_account uuid,p_admin boolean)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_admin THEN
  IF public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'MAIL_DENIED' USING ERRCODE='42501'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.principals p JOIN public.accounts a ON a.id=p.account_id WHERE p.id=p_actor AND p.kind='account' AND a.id=p_account AND a.status='active') THEN RAISE EXCEPTION 'MAIL_DENIED' USING ERRCODE='42501'; END IF;
 END IF;
END; $$;
CREATE FUNCTION public.mail_runtime()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('config',config,'passwordEnvelope',password_envelope,'version',version,'testedVersion',tested_version,'testedAt',tested_at,'testOk',test_ok,'deliveryVerifiedVersion',delivery_verified_version) FROM public.smtp_settings WHERE singleton;
$$;
CREATE FUNCTION public.mail_admin_config(p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM public.mail_authorize(p_actor,NULL,true);
 RETURN (public.mail_runtime()-'passwordEnvelope')||jsonb_build_object('passwordConfigured',(SELECT password_envelope IS NOT NULL FROM public.smtp_settings WHERE singleton));
END; $$;
CREATE FUNCTION public.mail_config_save(p_actor uuid,p_version integer,p_config jsonb,p_secret jsonb,p_clear boolean,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_before integer;
BEGIN
 PERFORM public.mail_authorize(p_actor,NULL,true);
 SELECT version INTO v_before FROM public.smtp_settings WHERE singleton FOR UPDATE;
 IF p_version IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'MAIL_CONFLICT' USING ERRCODE='40001'; END IF;
 IF p_config IS NULL OR jsonb_typeof(p_config)<>'object' OR p_config-ARRAY['enabled','host','port','sender','username','siteOrigin']<>'{}'::jsonb OR octet_length(p_config::text)>4096 OR (p_secret IS NOT NULL AND (jsonb_typeof(p_secret)<>'object' OR octet_length(p_secret::text)>8192)) THEN RAISE EXCEPTION 'MAIL_INVALID' USING ERRCODE='22023'; END IF;
 UPDATE public.smtp_settings SET config=p_config,password_envelope=CASE WHEN p_clear THEN NULL ELSE coalesce(p_secret,password_envelope) END,version=version+1,tested_version=NULL,test_ok=false,tested_at=NULL WHERE singleton;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.smtp.update','authentication','email','admin_console','Update email delivery configuration',NULL,p_request,p_request,'succeeded',v_before,v_before+1);
 RETURN public.mail_admin_config(p_actor);
END; $$;
CREATE FUNCTION public.mail_test_result(p_actor uuid,p_version integer,p_ok boolean,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM public.mail_authorize(p_actor,NULL,true);
 UPDATE public.smtp_settings SET tested_version=p_version,tested_at=clock_timestamp(),test_ok=p_ok WHERE singleton AND version=p_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'MAIL_CONFLICT' USING ERRCODE='40001'; END IF;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,'administration.smtp.test','authentication','email','admin_console','Check email delivery connection',NULL,p_request,p_request,CASE WHEN p_ok THEN 'succeeded' ELSE 'failed' END,p_version,p_version);
 RETURN public.mail_admin_config(p_actor);
END; $$;

CREATE FUNCTION public.mail_intent_status(p_actor uuid,p_account uuid,p_admin boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_account public.accounts; v_pending jsonb;
BEGIN
 PERFORM public.mail_authorize(p_actor,p_account,p_admin);
 SELECT * INTO v_account FROM public.accounts WHERE id=p_account;
 IF NOT FOUND THEN RAISE EXCEPTION 'MAIL_DENIED' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('id',i.id,'email',i.new_email,'purpose',i.purpose,'state',CASE WHEN i.state IN('sending','sent') AND i.smtp_version<>(SELECT version FROM public.smtp_settings WHERE singleton) THEN 'cancelled' WHEN i.state IN('sending','sent') AND i.expires_at<=clock_timestamp() THEN 'expired' ELSE i.state END,'expiresAt',i.expires_at,'createdAt',i.created_at) INTO v_pending FROM public.account_email_intents i WHERE i.account_id=p_account ORDER BY i.created_at DESC,i.id DESC LIMIT 1;
 RETURN jsonb_build_object('accountId',v_account.id,'email',v_account.email,'verified',v_account.email_verification_state='verified','pending',v_pending);
END; $$;
CREATE FUNCTION public.mail_intent_create(p_actor uuid,p_account uuid,p_admin boolean,p_email varchar,p_expected varchar,p_reason varchar,p_request uuid,p_id uuid,p_hash varchar,p_smtp integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_account public.accounts; v_existing public.account_email_intents; v_purpose varchar; v_profile jsonb;
BEGIN
 PERFORM public.mail_authorize(p_actor,p_account,p_admin);
 -- Serialize with configuration changes and bind proof to the configuration used.
 PERFORM singleton FROM public.smtp_settings WHERE singleton AND version=p_smtp AND config->>'enabled'='true' AND password_envelope IS NOT NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MAIL_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text,248));
 SELECT * INTO v_account FROM public.accounts WHERE id=p_account FOR UPDATE;
 IF NOT FOUND OR v_account.status<>'active' THEN RAISE EXCEPTION 'MAIL_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_existing FROM public.account_email_intents WHERE actor_id=p_actor AND request_id=p_request;
 IF FOUND THEN
  IF v_existing.account_id<>p_account OR lower(v_existing.new_email)<>lower(p_email) OR v_existing.reason<>trim(p_reason) THEN RAISE EXCEPTION 'MAIL_CONFLICT' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('created',false,'status',public.mail_intent_status(p_actor,p_account,p_admin));
 END IF;
 IF p_admin THEN
  v_purpose:='change'; v_profile:=public.crm_profile_value('account',p_account);
  IF encode(public.digest(convert_to(v_profile::text,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'MAIL_CONFLICT' USING ERRCODE='40001'; END IF;
 ELSE v_purpose:='verify'; IF lower(p_email) IS DISTINCT FROM lower(v_account.email) OR v_account.email_verification_state='verified' THEN RAISE EXCEPTION 'MAIL_INVALID' USING ERRCODE='22023'; END IF; END IF;
 IF p_email IS NULL OR length(p_email)>254 OR p_email !~ '^[a-zA-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$' OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500 OR p_request IS NULL OR p_id IS NULL OR (v_purpose='change' AND lower(p_email)=lower(v_account.email)) THEN RAISE EXCEPTION 'MAIL_INVALID' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounts WHERE lower(email)=lower(p_email) AND id<>p_account) THEN RAISE EXCEPTION 'MAIL_EMAIL_TAKEN' USING ERRCODE='23505'; END IF;
 IF EXISTS(SELECT 1 FROM public.account_email_intents WHERE account_id=p_account AND created_at>clock_timestamp()-interval '60 seconds') OR (SELECT count(*) FROM public.account_email_intents WHERE account_id=p_account AND created_at>clock_timestamp()-interval '1 hour')>=5 OR (SELECT count(*) FROM public.account_email_intents WHERE actor_id=p_actor AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN RAISE EXCEPTION 'MAIL_COOLDOWN' USING ERRCODE='54000'; END IF;
 UPDATE public.account_email_intents SET state='cancelled' WHERE account_id=p_account AND state IN('sending','sent');
 INSERT INTO public.account_email_intents(id,account_id,actor_id,purpose,request_id,old_email,new_email,reason,token_hash,smtp_version) VALUES(p_id,p_account,p_actor,v_purpose,p_request,v_account.email,lower(p_email),trim(p_reason),p_hash,p_smtp);
 IF p_admin THEN PERFORM public.crm_audit(p_actor,'account',p_account,NULL,'crm.email.request',trim(p_reason),p_request::text,jsonb_build_object('email',v_account.email),jsonb_build_object('pendingEmail',lower(p_email))); END IF;
 RETURN jsonb_build_object('created',true,'status',public.mail_intent_status(p_actor,p_account,p_admin));
END; $$;
CREATE FUNCTION public.mail_intent_delivery(p_id uuid,p_hash varchar,p_sent boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 UPDATE public.account_email_intents SET state=CASE WHEN p_sent THEN 'sent' ELSE 'failed' END WHERE id=p_id AND token_hash=p_hash AND state='sending';
$$;
CREATE FUNCTION public.mail_intent_cancel(p_actor uuid,p_account uuid,p_admin boolean,p_id uuid,p_request varchar)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM public.mail_authorize(p_actor,p_account,p_admin);
 PERFORM id FROM public.accounts WHERE id=p_account FOR UPDATE;
 UPDATE public.account_email_intents SET state='cancelled' WHERE id=p_id AND account_id=p_account AND state IN('sending','sent');
 IF p_admin AND FOUND THEN PERFORM public.crm_audit(p_actor,'account',p_account,NULL,'crm.email.cancel','Cancel pending email request',p_request,NULL,NULL); END IF;
 RETURN public.mail_intent_status(p_actor,p_account,p_admin);
END; $$;
CREATE FUNCTION public.mail_intent_consume(p_hash varchar)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_intent public.account_email_intents; v_account public.accounts; v_target uuid; v_config integer;
BEGIN
 IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('confirmed',false); END IF;
 SELECT version INTO v_config FROM public.smtp_settings WHERE singleton FOR UPDATE;
 SELECT account_id INTO v_target FROM public.account_email_intents WHERE token_hash=p_hash;
 IF NOT FOUND THEN RETURN jsonb_build_object('confirmed',false); END IF;
 SELECT * INTO v_account FROM public.accounts WHERE id=v_target FOR UPDATE;
 SELECT * INTO v_intent FROM public.account_email_intents WHERE token_hash=p_hash FOR UPDATE;
 IF v_account.status<>'active' OR v_account.email IS DISTINCT FROM v_intent.old_email OR v_intent.state<>'sent' OR v_intent.expires_at<=clock_timestamp() OR v_intent.smtp_version<>v_config THEN RETURN jsonb_build_object('confirmed',false); END IF;
 BEGIN
  UPDATE public.accounts SET email=v_intent.new_email,email_verification_state='verified' WHERE id=v_target;
 EXCEPTION WHEN unique_violation THEN
  UPDATE public.account_email_intents SET state='failed' WHERE id=v_intent.id;
  RETURN jsonb_build_object('confirmed',false);
 END;
 UPDATE public.account_email_intents SET state='consumed' WHERE id=v_intent.id;
 UPDATE public.smtp_settings SET delivery_verified_version=v_config WHERE singleton AND version=v_config;
 IF v_intent.purpose='change' THEN
  UPDATE public.session_refresh_tokens t SET revoked_at=coalesce(t.revoked_at,clock_timestamp()) FROM public.session_refresh_families f JOIN public.sessions_v2 s ON s.id=f.session_id JOIN public.principals p ON p.id=s.principal_id WHERE t.family_id=f.id AND p.account_id=v_target;
  UPDATE public.session_refresh_families f SET revoked_at=coalesce(f.revoked_at,clock_timestamp()) FROM public.sessions_v2 s JOIN public.principals p ON p.id=s.principal_id WHERE f.session_id=s.id AND p.account_id=v_target;
  UPDATE public.sessions_v2 s SET revoked_at=coalesce(s.revoked_at,clock_timestamp()) FROM public.principals p WHERE p.id=s.principal_id AND p.account_id=v_target;
 END IF;
 INSERT INTO public.administrative_audit_events(actor_principal_id,actor_account_id,actor_role,scope_kind,action,target_type,target_id,reason_code,reason_text,request_id,result,metadata_json)
 SELECT v_intent.actor_id,p.account_id,CASE WHEN v_intent.purpose='change' THEN 'platform_admin' ELSE 'account' END,'platform','account.email.'||v_intent.purpose||'.confirmed','crm_account',v_target::text,'email_proof',v_intent.reason,v_intent.request_id::text,'succeeded',jsonb_build_object('before',jsonb_build_object('email',v_intent.old_email,'verified',v_account.email_verification_state='verified'),'after',jsonb_build_object('email',v_intent.new_email,'verified',true),'proof','email_link') FROM public.principals p WHERE p.id=v_intent.actor_id;
 RETURN jsonb_build_object('confirmed',true,'changed',v_intent.purpose='change');
END; $$;
REVOKE ALL ON FUNCTION public.mail_authorize(uuid,uuid,boolean) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.mail_runtime() FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.mail_admin_config(uuid) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.mail_config_save(uuid,integer,jsonb,jsonb,boolean,varchar) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.mail_test_result(uuid,integer,boolean,varchar) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.mail_intent_status(uuid,uuid,boolean) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.mail_intent_create(uuid,uuid,boolean,varchar,varchar,varchar,uuid,uuid,varchar,integer) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.mail_intent_delivery(uuid,varchar,boolean) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.mail_intent_cancel(uuid,uuid,boolean,uuid,varchar) FROM PUBLIC,asalab_app;
REVOKE ALL ON FUNCTION public.mail_intent_consume(varchar) FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION public.mail_runtime() TO asalab_app;
GRANT EXECUTE ON FUNCTION public.mail_admin_config(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.mail_config_save(uuid,integer,jsonb,jsonb,boolean,varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.mail_test_result(uuid,integer,boolean,varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.mail_intent_status(uuid,uuid,boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.mail_intent_create(uuid,uuid,boolean,varchar,varchar,varchar,uuid,uuid,varchar,integer) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.mail_intent_delivery(uuid,varchar,boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.mail_intent_cancel(uuid,uuid,boolean,uuid,varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.mail_intent_consume(varchar) TO asalab_app;
