-- Presentation is independent of identity, access, timezone and editor documents.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS presentation jsonb NOT NULL
 DEFAULT '{"motion":"system","sidebar":"expanded","revision":0}'::jsonb;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='profiles_presentation_valid' AND conrelid='public.profiles'::regclass) THEN
 ALTER TABLE public.profiles ADD CONSTRAINT profiles_presentation_valid CHECK ((
  jsonb_typeof(presentation)='object' AND presentation ?& ARRAY['motion','sidebar','revision'] AND
  presentation - ARRAY['motion','sidebar','revision']='{}'::jsonb AND
  jsonb_typeof(presentation->'motion')='string' AND presentation->>'motion' IN ('system','reduce') AND
  jsonb_typeof(presentation->'sidebar')='string' AND presentation->>'sidebar' IN ('expanded','collapsed') AND
  CASE WHEN jsonb_typeof(presentation->'revision')='number' THEN
   (presentation->>'revision')::numeric BETWEEN 0 AND 9007199254740991 AND
   trunc((presentation->>'revision')::numeric)=(presentation->>'revision')::numeric ELSE false END
 ) IS TRUE);
 END IF;
END; $$;
CREATE TABLE IF NOT EXISTS public.account_presentation_receipts (
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 request_id uuid NOT NULL,
 command jsonb NOT NULL,
 snapshot jsonb NOT NULL,
 PRIMARY KEY(account_id,request_id)
);
REVOKE ALL ON public.account_presentation_receipts FROM PUBLIC, asalab_app;
CREATE OR REPLACE FUNCTION public.account_presentation_read(p_account uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT presentation FROM public.profiles WHERE account_id=p_account;
$$;
CREATE OR REPLACE FUNCTION public.account_presentation_write(p_account uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_current jsonb; v_receipt public.account_presentation_receipts%ROWTYPE; v_request uuid; v_next jsonb;
BEGIN
 IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' THEN
 RAISE EXCEPTION 'invalid presentation command' USING ERRCODE='22023';
 END IF;
 IF
    NOT (p_command ?& ARRAY['motion','sidebar','revision','requestId']) OR
    (SELECT count(*) FROM jsonb_object_keys(p_command)) <> 4 OR
    jsonb_typeof(p_command->'motion') IS DISTINCT FROM 'string' OR jsonb_typeof(p_command->'sidebar') IS DISTINCT FROM 'string' OR
    p_command->>'motion' NOT IN ('system','reduce') OR p_command->>'sidebar' NOT IN ('expanded','collapsed') OR
    jsonb_typeof(p_command->'revision') IS DISTINCT FROM 'number' OR
    (CASE WHEN jsonb_typeof(p_command->'revision')='number' THEN
     (p_command->>'revision')::numeric < 0 OR (p_command->>'revision')::numeric >= 9007199254740991 OR
     trunc((p_command->>'revision')::numeric) <> (p_command->>'revision')::numeric ELSE true END) OR
    coalesce(p_command->>'requestId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
   RAISE EXCEPTION 'invalid presentation command' USING ERRCODE='22023';
 END IF;
 v_request := (p_command->>'requestId')::uuid;
 SELECT presentation INTO v_current FROM public.profiles WHERE account_id=p_account FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('code','not_found'); END IF;
 SELECT * INTO v_receipt FROM public.account_presentation_receipts WHERE account_id=p_account AND request_id=v_request;
 IF FOUND THEN
   IF v_receipt.command <> p_command THEN RETURN jsonb_build_object('code','request_conflict'); END IF;
   RETURN jsonb_build_object('code','ok','snapshot',v_current);
 END IF;
 IF (v_current->>'revision')::numeric::bigint <> (p_command->>'revision')::numeric::bigint THEN RETURN jsonb_build_object('code','conflict'); END IF;
 v_next := jsonb_build_object('motion',p_command->>'motion','sidebar',p_command->>'sidebar','revision',(v_current->>'revision')::numeric::bigint+1);
 UPDATE public.profiles SET presentation=v_next WHERE account_id=p_account;
 INSERT INTO public.account_presentation_receipts VALUES(p_account,v_request,p_command,v_next);
 RETURN jsonb_build_object('code','ok','snapshot',v_next);
END;
$$;
REVOKE ALL ON FUNCTION public.account_presentation_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.account_presentation_write(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_presentation_read(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION public.account_presentation_write(uuid,jsonb) TO asalab_app;
