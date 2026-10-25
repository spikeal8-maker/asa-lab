-- AI attachment chat: reuse the audited atomic paid binding contract for local Ollama.
-- The only difference is the existing free ai_text_begin_local admission; do NOT
-- charge a paid platform budget or split the message/binding into two transactions.
-- This function preserves immutable manifest replay, owner/Seat isolation and
-- 1..4 validated attachments. Existing production data are not modified.
CREATE FUNCTION ai_attachment_begin_message_local(
    p_owner uuid,p_thread uuid,p_request uuid,p_text varchar,p_expected_version bigint,p_uploads uuid[]
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_receipt public.ai_attachment_message_receipts%ROWTYPE; v_source public.ai_assistant_messages%ROWTYPE;
        v_manifest jsonb; v_bytes bigint; v_count bigint; v_digest bytea;
BEGIN
    IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
    IF p_uploads IS NULL OR COALESCE(array_ndims(p_uploads),0)<>1 OR cardinality(p_uploads) NOT BETWEEN 1 AND 4
       OR EXISTS(SELECT 1 FROM unnest(p_uploads) u WHERE u IS NULL)
       OR (SELECT count(DISTINCT u) FROM unnest(p_uploads) u)<>cardinality(p_uploads)
       OR p_text IS NULL OR char_length(trim(p_text)) NOT BETWEEN 1 AND 3000 THEN
        RAISE EXCEPTION 'AI_ATTACHMENT_INVALID' USING ERRCODE='22023'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
    SELECT * INTO v_receipt FROM public.ai_attachment_message_receipts WHERE owner_principal_id=p_owner AND request_id=p_request;
    IF FOUND THEN
        SELECT * INTO v_source FROM public.ai_assistant_messages q WHERE q.id=v_receipt.source_user_message_id
            AND q.thread_id=p_thread AND q.owner_principal_id=p_owner AND q.role='user';
        IF NOT FOUND OR v_receipt.thread_id<>p_thread OR v_receipt.source_ordinal<>v_source.ordinal OR v_source.content<>trim(p_text)
           OR v_receipt.source_digest<>public.ai_text_source_digest(p_owner,p_thread,v_source.id,v_source.ordinal,v_source.content)
           OR (SELECT array_agg((item->>'uploadId')::uuid ORDER BY position) FROM jsonb_array_elements(v_receipt.manifest) WITH ORDINALITY m(item,position)) IS DISTINCT FROM p_uploads THEN
            RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
        PERFORM public.ai_attachment_bound_items(p_owner,p_thread,p_request,v_source.id,v_source.ordinal,v_receipt.source_digest,v_receipt.manifest);
        RETURN false;
    END IF;
    IF EXISTS(SELECT 1 FROM public.ai_assistant_request_quota WHERE owner_principal_id=p_owner AND request_id=p_request) THEN
        RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
    -- Existing local admission enforces owner, class policy, revision, rate and thread lock.
    -- Attachment rows come last, in UUID order. Failure below rolls back the
    -- user message and BOTH ledgers. No application-side post-send binding.
    IF NOT public.ai_text_begin_local(p_owner,p_thread,p_request,p_text,p_expected_version) THEN
        RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
    SELECT * INTO STRICT v_source FROM public.ai_assistant_messages
      WHERE owner_principal_id=p_owner AND thread_id=p_thread AND request_id=p_request AND role='user';
    PERFORM upload_id FROM public.ai_attachment_uploads WHERE owner_principal_id=p_owner AND upload_id=ANY(p_uploads) ORDER BY upload_id FOR UPDATE;
    SELECT count(*),COALESCE(sum(u.size_bytes),0),jsonb_agg(jsonb_build_object('uploadId',u.upload_id,'sha256',u.sha256,'sizeBytes',u.size_bytes,'mediaType',u.media_type) ORDER BY n.position)
      INTO v_count,v_bytes,v_manifest FROM unnest(p_uploads) WITH ORDINALITY n(id,position)
      JOIN public.ai_attachment_uploads u ON u.upload_id=n.id AND u.owner_principal_id=p_owner
      WHERE u.state='ready' AND NOT u.delete_requested AND u.expires_at>clock_timestamp() AND u.validated_at IS NOT NULL;
    IF v_count<>cardinality(p_uploads) THEN RAISE EXCEPTION 'AI_ATTACHMENT_NOT_READY' USING ERRCODE='42501'; END IF;
    IF v_bytes>20971520 THEN RAISE EXCEPTION 'AI_ATTACHMENT_QUOTA' USING ERRCODE='P0001'; END IF;
    v_digest:=public.ai_text_source_digest(p_owner,p_thread,v_source.id,v_source.ordinal,v_source.content);
    INSERT INTO public.ai_attachment_message_receipts(owner_principal_id,request_id,thread_id,source_user_message_id,source_ordinal,source_digest,manifest)
      VALUES(p_owner,p_request,p_thread,v_source.id,v_source.ordinal,v_digest,v_manifest);
    INSERT INTO public.ai_attachment_bindings(upload_id,owner_principal_id,thread_id,source_user_message_id,request_id,source_ordinal,source_digest,position)
      SELECT n.id,p_owner,p_thread,v_source.id,p_request,v_source.ordinal,v_digest,n.position FROM unnest(p_uploads) WITH ORDINALITY n(id,position);
    UPDATE public.ai_attachment_uploads SET state='bound',updated_at=clock_timestamp() WHERE upload_id=ANY(p_uploads);
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION ai_attachment_begin_message_local(uuid,uuid,uuid,varchar,bigint,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_attachment_begin_message_local(uuid,uuid,uuid,varchar,bigint,uuid[]) TO asalab_app;
