-- Explicit own-personal review only. This grant never authorizes a foreign Account or any Seat.
ALTER TABLE public.capability_grants DROP CONSTRAINT capability_grants_capability_check;
ALTER TABLE public.capability_grants ADD CONSTRAINT capability_grants_capability_check CHECK
 (capability IN('creator','educator','registered_student','guardian','platform_admin','content_author','ai_quality_review_own'));
CREATE TABLE public.ai_own_quality_revisions(account_id uuid PRIMARY KEY REFERENCES public.accounts(id),revision bigint NOT NULL CHECK(revision>0));
CREATE TABLE public.ai_own_quality_writes(actor uuid NOT NULL REFERENCES public.principals(id),request_id uuid NOT NULL,enabled boolean NOT NULL,expected_revision bigint NOT NULL,PRIMARY KEY(actor,request_id));
ALTER TABLE public.ai_own_quality_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_own_quality_writes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_own_quality_revisions,public.ai_own_quality_writes FROM PUBLIC,asalab_app;

-- Metadata-only parent identity survives deletion of native tool receipts; no text or usage is copied.
ALTER TABLE public.ai_usage_journal ADD COLUMN parent_request_id uuid;
UPDATE public.ai_usage_journal j SET parent_request_id=r.parent_request_id FROM public.ai_tool_image_receipts r
 WHERE r.owner_principal_id=j.owner_principal_id AND r.child_request_id=j.request_id;
CREATE FUNCTION public.ai_usage_parent_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 SELECT r.parent_request_id INTO NEW.parent_request_id FROM public.ai_tool_image_receipts r WHERE r.owner_principal_id=NEW.owner_principal_id AND r.child_request_id=NEW.request_id;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION public.ai_usage_parent_identity() FROM PUBLIC,asalab_app;
CREATE TRIGGER ai_usage_parent_identity BEFORE INSERT ON public.ai_usage_journal FOR EACH ROW EXECUTE FUNCTION public.ai_usage_parent_identity();
CREATE INDEX ai_usage_own_recent_idx ON public.ai_usage_journal(owner_principal_id,admitted_at DESC,request_id DESC) WHERE parent_request_id IS NULL;

CREATE FUNCTION public.ai_own_quality_account(p_actor uuid) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a uuid;
BEGIN
 SELECT p.account_id INTO a FROM public.principals p JOIN public.accounts ac ON ac.id=p.account_id AND ac.status='active' WHERE p.id=p_actor AND p.kind='account';
 IF a IS NULL OR public.admin_authorized_role(p_actor,'platform',NULL) IS DISTINCT FROM 'platform_admin' THEN RAISE EXCEPTION 'AI_QUALITY_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 RETURN a;
END;$$;
CREATE FUNCTION public.ai_own_quality_status(p_actor uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a uuid;
BEGIN
 a:=public.ai_own_quality_account(p_actor);
 RETURN jsonb_build_object('schemaVersion',1,'scope','own_personal','enabled',EXISTS(SELECT 1 FROM public.capability_grants WHERE account_id=a AND capability='ai_quality_review_own' AND state='verified' AND policy_version='ai-quality-own-v1'),
  'revision',coalesce((SELECT revision FROM public.ai_own_quality_revisions WHERE account_id=a),0),'maskingPolicy','quality-mask-v1');
END;$$;
CREATE FUNCTION public.ai_own_quality_set(p_actor uuid,p_enabled boolean,p_revision bigint,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a uuid;r bigint;prior public.ai_own_quality_writes%ROWTYPE;
BEGIN
 a:=public.ai_own_quality_account(p_actor);PERFORM pg_advisory_xact_lock(hashtextextended(a::text,271));
 IF p_enabled IS NULL OR p_revision IS NULL OR p_revision<0 OR p_request IS NULL THEN RAISE EXCEPTION 'AI_QUALITY_INVALID' USING ERRCODE='22023';END IF;
 SELECT * INTO prior FROM public.ai_own_quality_writes WHERE actor=p_actor AND request_id=p_request;
 IF FOUND THEN IF prior.enabled<>p_enabled OR prior.expected_revision<>p_revision THEN RAISE EXCEPTION 'AI_QUALITY_REQUEST_REUSED' USING ERRCODE='22023';END IF;RETURN public.ai_own_quality_status(p_actor);END IF;
 SELECT coalesce((SELECT revision FROM public.ai_own_quality_revisions WHERE account_id=a),0) INTO r;
 IF r<>p_revision THEN RAISE EXCEPTION 'AI_QUALITY_CHANGED' USING ERRCODE='40001';END IF;
 INSERT INTO public.capability_grants(account_id,capability,state,policy_version,granted_by) VALUES(a,'ai_quality_review_own',CASE WHEN p_enabled THEN 'verified' ELSE 'revoked' END,'ai-quality-own-v1','admin')
 ON CONFLICT(account_id,capability) DO UPDATE SET state=EXCLUDED.state,policy_version=EXCLUDED.policy_version,granted_by='admin',granted_at=clock_timestamp();
 INSERT INTO public.ai_own_quality_revisions VALUES(a,r+1) ON CONFLICT(account_id) DO UPDATE SET revision=EXCLUDED.revision;
 INSERT INTO public.ai_own_quality_writes VALUES(p_actor,p_request,p_enabled,p_revision);
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,CASE WHEN p_enabled THEN 'administration.ai.quality.own.enable' ELSE 'administration.ai.quality.own.revoke' END,'own_personal',p_actor::text,'explicit_own_quality',NULL,NULL,p_request::text,p_request::text,'succeeded',r,r+1);
 RETURN public.ai_own_quality_status(p_actor);
END;$$;
CREATE FUNCTION public.ai_own_quality_require(p_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE a uuid;
BEGIN
 a:=public.ai_own_quality_account(p_actor);
 PERFORM 1 FROM public.capability_grants WHERE account_id=a AND capability='platform_admin' AND state='verified' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_QUALITY_ADMIN_DENIED' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.capability_grants WHERE account_id=a AND capability='ai_quality_review_own' AND state='verified' AND policy_version='ai-quality-own-v1' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI_QUALITY_GRANT_REQUIRED' USING ERRCODE='42501';END IF;
END;$$;

CREATE FUNCTION public.ai_own_quality_rows(p_actor uuid,p_request uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;read_id text:=gen_random_uuid()::text;
BEGIN
 PERFORM public.ai_own_quality_require(p_actor);
 WITH recent AS MATERIALIZED (
  SELECT j.* FROM public.ai_usage_journal j WHERE j.owner_principal_id=p_actor AND j.account_id=(SELECT account_id FROM public.principals WHERE id=p_actor) AND j.seat_id IS NULL AND j.parent_request_id IS NULL
  ORDER BY j.admitted_at DESC,j.request_id DESC LIMIT 10
 ), joined AS (
  SELECT j.*,coalesce(source.content,question.content) question_text,answer.content answer_text,answer.state answer_state,p.policy_revision,
   CASE WHEN EXISTS(SELECT 1 FROM public.ai_web_search_receipts w WHERE w.owner_principal_id=j.owner_principal_id AND w.request_id=j.request_id AND w.evidence->>'status' IN('ready','empty')) THEN true ELSE NULL END search_used,
   EXISTS(SELECT 1 FROM public.ai_tool_image_receipts i WHERE i.owner_principal_id=j.owner_principal_id AND i.parent_request_id=j.request_id) tool_used
  FROM recent j
  LEFT JOIN public.ai_assistant_regenerations r ON r.owner_principal_id=j.owner_principal_id AND r.request_id=j.request_id AND (j.thread_id IS NULL OR r.thread_id=j.thread_id)
  LEFT JOIN public.ai_assistant_messages question ON question.owner_principal_id=j.owner_principal_id AND question.request_id=j.request_id AND question.role='user' AND (j.thread_id IS NULL OR question.thread_id=j.thread_id)
  LEFT JOIN public.ai_assistant_messages source ON source.id=r.source_user_message_id AND source.owner_principal_id=j.owner_principal_id AND source.thread_id=r.thread_id AND source.role='user'
  LEFT JOIN public.ai_assistant_messages answer ON answer.owner_principal_id=j.owner_principal_id AND answer.request_id=j.request_id AND answer.role='assistant' AND answer.thread_id=coalesce(j.thread_id,r.thread_id,question.thread_id)
   AND (answer.source_user_message_id IS NULL OR answer.source_user_message_id=coalesce(r.source_user_message_id,question.id))
  LEFT JOIN public.ai_generation_receipts p ON p.owner_principal_id=j.owner_principal_id AND p.request_id=j.request_id AND p.thread_id=coalesce(j.thread_id,r.thread_id,question.thread_id)
  WHERE p_request IS NULL OR j.request_id=p_request
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',request_id,'admittedAt',to_char(admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone','UTC',
  'operation',operation,'provider',provider,'requestedModel',requested_model,'actualModel',actual_model,'status',status,
  'answerState',CASE WHEN answer_text IS NOT NULL AND answer_state='complete' THEN 'complete' WHEN answer_text IS NOT NULL THEN 'partial' WHEN status IN('admitted','running') AND question_text IS NOT NULL THEN 'pending' WHEN status='failed' AND question_text IS NOT NULL THEN 'error' WHEN status IN('stopped','cancelled') AND question_text IS NOT NULL THEN 'stopped' ELSE 'unavailable' END,
  'question',question_text,'answer',answer_text,'inputTokens',input_tokens::text,'outputTokens',output_tokens::text,'policyVersion',policy_revision::text,'promptVersion',NULL,
  'searchUsed',CASE WHEN question_text IS NULL THEN NULL ELSE search_used END,'toolUsed',CASE WHEN question_text IS NULL THEN NULL WHEN tool_used OR search_used THEN true ELSE NULL END)
  ORDER BY admitted_at DESC,request_id DESC),'[]'::jsonb) INTO result FROM joined;
 PERFORM public.admin_append_audit_event(p_actor,'platform',NULL,CASE WHEN p_request IS NULL THEN 'administration.ai.quality.own.list' ELSE 'administration.ai.quality.own.detail' END,'own_personal',coalesce(p_request::text,p_actor::text),'own_quality_read',NULL,NULL,read_id,read_id,'allowed',NULL,NULL);
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.ai_own_quality_account(uuid),public.ai_own_quality_require(uuid),public.ai_own_quality_status(uuid),public.ai_own_quality_set(uuid,boolean,bigint,uuid),public.ai_own_quality_rows(uuid,uuid) FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION public.ai_own_quality_status(uuid),public.ai_own_quality_set(uuid,boolean,bigint,uuid),public.ai_own_quality_rows(uuid,uuid) TO asalab_app;
