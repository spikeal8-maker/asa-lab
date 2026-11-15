-- Rehydrate persisted source attachments for a new answer variant.
-- Reads are scoped to the verified Account/StudentSeat and the original user
-- message; the audited ai_attachment_request_source checks immutable manifests.
-- Additive helper only: existing files, receipts, ledgers and quotas are unchanged.

CREATE FUNCTION public.ai_attachment_source_by_message(
    p_owner uuid, p_thread uuid, p_source uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_request uuid;
BEGIN
    IF NOT public.ai_chat_owner_valid(p_owner) THEN
        RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE = '42501';
    END IF;
    SELECT m.request_id INTO v_request
      FROM public.ai_assistant_messages m
     WHERE m.id = p_source
       AND m.thread_id = p_thread
       AND m.owner_principal_id = p_owner
       AND m.role = 'user';
    IF NOT FOUND OR v_request IS NULL THEN
        RAISE EXCEPTION 'AI_SOURCE_DENIED' USING ERRCODE = '42501';
    END IF;
    RETURN public.ai_attachment_request_source(p_owner, p_thread, v_request);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_attachment_source_by_message(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_attachment_source_by_message(uuid,uuid,uuid) TO asalab_app;
