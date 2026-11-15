-- AI-FILES-FOUNDATION-008. Private, owner-scoped storage only. This migration
-- does not enable provider file/Vision capabilities or change text generation.
CREATE TABLE ai_attachment_uploads (
    upload_id uuid PRIMARY KEY,
    owner_principal_id uuid NOT NULL REFERENCES principals(id),
    descriptor_digest bytea NOT NULL CHECK (octet_length(descriptor_digest) = 32),
    file_name varchar(180),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
    sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    extension varchar(12) NOT NULL,
    media_type varchar(40) NOT NULL,
    kind varchar(5) NOT NULL CHECK (kind IN ('image','text')),
    state varchar(12) NOT NULL DEFAULT 'reserved'
        CHECK (state IN ('reserved','uploading','unknown','ready','bound','deleting','deleted','failed')),
    held boolean NOT NULL DEFAULT true,
    width integer,
    height integer,
    extracted_text text CHECK (char_length(extracted_text) <= 200000 AND octet_length(extracted_text) <= 524288),
    validated_at timestamptz,
    attempt_id uuid,
    write_started_at timestamptz,
    delete_requested boolean NOT NULL DEFAULT false,
    error_code varchar(64),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '24 hours',
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    lease_id uuid,
    lease_until timestamptz,
    next_check_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (upload_id, owner_principal_id),
    CHECK (held = (state NOT IN ('deleted','failed'))),
    CHECK ((attempt_id IS NULL) = (write_started_at IS NULL)),
    CHECK ((lease_id IS NULL) = (lease_until IS NULL)),
    CHECK ((width IS NULL) = (height IS NULL)),
    CHECK ((width IS NULL AND height IS NULL) OR
           (width BETWEEN 1 AND 8192 AND height BETWEEN 1 AND 8192 AND width::bigint * height <= 16000000)),
    CHECK ((kind = 'image' AND extension IN ('png','jpg','webp') AND extracted_text IS NULL
              AND media_type = CASE extension WHEN 'png' THEN 'image/png' WHEN 'jpg' THEN 'image/jpeg' ELSE 'image/webp' END)
        OR (kind = 'text' AND size_bytes <= 524288 AND width IS NULL AND height IS NULL
              AND extension IN ('txt','md','markdown','js','jsx','ts','tsx','py','c','cpp','h','hpp','ino','json','css','html','xml','yaml','yml','sql','sh','java','rs','go')
              AND media_type = CASE WHEN extension IN ('md','markdown') THEN 'text/markdown' ELSE 'text/plain' END)),
    CHECK (state NOT IN ('uploading','unknown','ready','bound','deleting') OR validated_at IS NOT NULL),
    CHECK (state IN ('reserved','deleted','failed') OR attempt_id IS NOT NULL),
    CHECK (state NOT IN ('ready','bound') OR NOT delete_requested)
);
CREATE INDEX ai_attachment_owner_held_idx ON ai_attachment_uploads (owner_principal_id) WHERE held;
CREATE INDEX ai_attachment_work_idx ON ai_attachment_uploads (next_check_at, upload_id)
    WHERE state IN ('reserved','uploading','unknown','ready','deleting');
ALTER TABLE ai_attachment_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_attachment_uploads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ai_attachment_uploads FROM PUBLIC, asalab_app;

CREATE TABLE ai_attachment_message_receipts (
    owner_principal_id uuid NOT NULL REFERENCES principals(id),
    request_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    source_user_message_id uuid NOT NULL,
    source_ordinal bigint NOT NULL CHECK (source_ordinal > 0),
    source_digest bytea NOT NULL CHECK (octet_length(source_digest) = 32),
    manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'array' AND jsonb_array_length(manifest) BETWEEN 1 AND 4 AND octet_length(manifest::text) <= 4096),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (owner_principal_id, request_id),
    FOREIGN KEY (owner_principal_id, request_id) REFERENCES ai_assistant_request_quota(owner_principal_id, request_id)
);
-- The compact request tombstone deliberately survives thread deletion, just
-- like the existing non-refundable owner/platform quota. It contains no text.
ALTER TABLE ai_attachment_message_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_attachment_message_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ai_attachment_message_receipts FROM PUBLIC, asalab_app;

CREATE TABLE ai_attachment_bindings (
    upload_id uuid PRIMARY KEY,
    owner_principal_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    source_user_message_id uuid NOT NULL,
    request_id uuid NOT NULL,
    source_ordinal bigint NOT NULL CHECK (source_ordinal > 0),
    source_digest bytea NOT NULL CHECK (octet_length(source_digest) = 32),
    position integer NOT NULL CHECK (position BETWEEN 1 AND 4),
    FOREIGN KEY (upload_id, owner_principal_id) REFERENCES ai_attachment_uploads(upload_id, owner_principal_id),
    FOREIGN KEY (source_user_message_id, thread_id, owner_principal_id)
        REFERENCES ai_assistant_messages(id, thread_id, owner_principal_id) ON DELETE CASCADE,
    FOREIGN KEY (owner_principal_id, request_id) REFERENCES ai_attachment_message_receipts(owner_principal_id, request_id),
    UNIQUE (source_user_message_id, position)
);
ALTER TABLE ai_attachment_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_attachment_bindings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ai_attachment_bindings FROM PUBLIC, asalab_app;

CREATE FUNCTION ai_attachment_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF TG_TABLE_NAME <> 'ai_attachment_uploads' THEN
        RAISE EXCEPTION 'AI_ATTACHMENT_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    IF ROW(NEW.upload_id,NEW.owner_principal_id,NEW.descriptor_digest,NEW.size_bytes,NEW.sha256,
           NEW.extension,NEW.media_type,NEW.kind,NEW.created_at,NEW.expires_at)
       IS DISTINCT FROM
       ROW(OLD.upload_id,OLD.owner_principal_id,OLD.descriptor_digest,OLD.size_bytes,OLD.sha256,
           OLD.extension,OLD.media_type,OLD.kind,OLD.created_at,OLD.expires_at)
       OR (OLD.attempt_id IS NOT NULL AND ROW(NEW.attempt_id,NEW.write_started_at) IS DISTINCT FROM ROW(OLD.attempt_id,OLD.write_started_at))
       OR (OLD.delete_requested AND NOT NEW.delete_requested)
       OR (NEW.file_name IS DISTINCT FROM OLD.file_name AND NOT (NEW.state IN ('deleted','failed') AND NEW.file_name IS NULL))
       OR (OLD.validated_at IS NOT NULL AND ROW(NEW.width,NEW.height,NEW.validated_at) IS DISTINCT FROM ROW(OLD.width,OLD.height,OLD.validated_at))
       OR (OLD.validated_at IS NOT NULL AND NEW.extracted_text IS DISTINCT FROM OLD.extracted_text
           AND NOT (NEW.state IN ('deleted','failed') AND NEW.extracted_text IS NULL)) THEN
        RAISE EXCEPTION 'AI_ATTACHMENT_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
    IF NOT (
        NEW.state = OLD.state
        OR (OLD.state = 'reserved' AND NEW.state IN ('uploading','deleted','failed'))
        OR (OLD.state IN ('uploading','unknown') AND NEW.state IN ('unknown','ready','deleting','deleted','failed'))
        OR (OLD.state = 'ready' AND NEW.state IN ('bound','deleting'))
        OR (OLD.state = 'bound' AND NEW.state = 'deleting')
        OR (OLD.state = 'deleting' AND NEW.state = 'deleted')
    ) THEN RAISE EXCEPTION 'AI_ATTACHMENT_STATE_INVALID' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ai_attachment_upload_immutable BEFORE UPDATE ON ai_attachment_uploads
    FOR EACH ROW EXECUTE FUNCTION ai_attachment_immutable();
CREATE TRIGGER ai_attachment_receipt_immutable BEFORE UPDATE ON ai_attachment_message_receipts
    FOR EACH ROW EXECUTE FUNCTION ai_attachment_immutable();
CREATE TRIGGER ai_attachment_binding_immutable BEFORE UPDATE ON ai_attachment_bindings
    FOR EACH ROW EXECUTE FUNCTION ai_attachment_immutable();
REVOKE ALL ON FUNCTION ai_attachment_immutable() FROM PUBLIC, asalab_app;

CREATE FUNCTION ai_attachment_value(p_row public.ai_attachment_uploads) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
    SELECT jsonb_build_object(
        'uploadId',p_row.upload_id,'ownerId',p_row.owner_principal_id,'fileName',p_row.file_name,
        'sizeBytes',p_row.size_bytes,'sha256',p_row.sha256,'extension',p_row.extension,
        'mediaType',p_row.media_type,'kind',p_row.kind,'state',p_row.state,'held',p_row.held,
        'width',p_row.width,'height',p_row.height,'text',p_row.extracted_text,'attemptId',p_row.attempt_id,
        'createdAt',p_row.created_at,'expiresAt',p_row.expires_at,'deleteRequested',p_row.delete_requested,
        'errorCode',p_row.error_code,'leaseId',p_row.lease_id)
$$;
REVOKE ALL ON FUNCTION ai_attachment_value(public.ai_attachment_uploads) FROM PUBLIC, asalab_app;

CREATE FUNCTION ai_attachment_get(p_owner uuid, p_upload uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_row public.ai_attachment_uploads%ROWTYPE;
BEGIN
    IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE = '42501'; END IF;
    SELECT * INTO v_row FROM public.ai_attachment_uploads WHERE upload_id = p_upload AND owner_principal_id = p_owner;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_ATTACHMENT_NOT_FOUND' USING ERRCODE = '42501'; END IF;
    RETURN public.ai_attachment_value(v_row);
END;
$$;

CREATE FUNCTION ai_attachment_reserve(
    p_owner uuid,p_upload uuid,p_name varchar,p_size bigint,p_sha varchar,p_extension varchar,p_media varchar,p_kind varchar
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_row public.ai_attachment_uploads%ROWTYPE; v_digest bytea; v_bytes bigint; v_count bigint; v_pending bigint;
BEGIN
    IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE = '42501'; END IF;
    IF p_upload IS NULL OR p_name IS NULL OR char_length(p_name) NOT BETWEEN 1 AND 180 OR p_name <> trim(p_name)
       OR p_name ~ '[[:cntrl:]/\\:*?"<>|]' OR left(p_name,1) = '.' OR position('..' IN p_name) > 0
       OR p_name !~ '\.[A-Za-z0-9]+$'
       OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 8388608 OR p_sha IS NULL OR p_sha !~ '^[a-f0-9]{64}$'
       OR p_kind IS NULL OR p_kind NOT IN ('image','text') OR p_extension IS NULL OR p_media IS NULL
       OR p_extension IS DISTINCT FROM (CASE lower(regexp_replace(p_name,'^.*\.',''))
            WHEN 'jpeg' THEN 'jpg' ELSE lower(regexp_replace(p_name,'^.*\.','')) END)
       OR (p_kind = 'text' AND p_size > 524288) THEN
        RAISE EXCEPTION 'AI_ATTACHMENT_INVALID' USING ERRCODE = '22023';
    END IF;
    v_digest := sha256(convert_to(jsonb_build_array(p_name,p_size,p_sha,p_extension,p_media,p_kind)::text,'UTF8'));
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
    SELECT * INTO v_row FROM public.ai_attachment_uploads WHERE upload_id = p_upload;
    IF FOUND THEN
        IF v_row.owner_principal_id <> p_owner THEN RAISE EXCEPTION 'AI_ATTACHMENT_NOT_FOUND' USING ERRCODE = '42501'; END IF;
        IF v_row.descriptor_digest <> v_digest THEN RAISE EXCEPTION 'AI_ATTACHMENT_ID_REUSED' USING ERRCODE = '22023'; END IF;
        RETURN public.ai_attachment_value(v_row);
    END IF;
    PERFORM public.ai_chat_require_generation(p_owner);
    SELECT COALESCE(sum(size_bytes),0),count(*),count(*) FILTER (WHERE state IN ('reserved','uploading','unknown','ready'))
      INTO v_bytes,v_count,v_pending FROM public.ai_attachment_uploads WHERE owner_principal_id = p_owner AND held;
    IF v_bytes + p_size > 104857600 OR v_count >= 100 OR v_pending >= 20 THEN
        RAISE EXCEPTION 'AI_ATTACHMENT_QUOTA' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.ai_attachment_uploads(upload_id,owner_principal_id,descriptor_digest,file_name,size_bytes,sha256,extension,media_type,kind)
      VALUES(p_upload,p_owner,v_digest,p_name,p_size,p_sha,p_extension,p_media,p_kind)
      ON CONFLICT (upload_id) DO NOTHING RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_ATTACHMENT_NOT_FOUND' USING ERRCODE='42501'; END IF;
    RETURN public.ai_attachment_value(v_row);
END;
$$;

CREATE FUNCTION ai_attachment_begin_upload(
    p_owner uuid,p_upload uuid,p_attempt uuid,p_width integer,p_height integer,p_text text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_row public.ai_attachment_uploads%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
    PERFORM public.ai_attachment_get(p_owner,p_upload);
    SELECT * INTO STRICT v_row FROM public.ai_attachment_uploads WHERE upload_id=p_upload FOR UPDATE;
    IF v_row.state <> 'reserved' THEN RETURN public.ai_attachment_value(v_row); END IF;
    IF v_row.expires_at <= clock_timestamp() OR v_row.delete_requested THEN
        RAISE EXCEPTION 'AI_ATTACHMENT_EXPIRED' USING ERRCODE = '22023';
    END IF;
    PERFORM public.ai_chat_require_generation(p_owner);
    IF p_attempt IS NULL OR (v_row.kind = 'image' AND (p_width IS NULL OR p_height IS NULL OR p_text IS NOT NULL))
       OR (v_row.kind = 'text' AND (p_width IS NOT NULL OR p_height IS NOT NULL OR p_text IS NULL
           OR char_length(p_text) NOT BETWEEN 1 AND 200000 OR octet_length(p_text) > 524288)) THEN
        RAISE EXCEPTION 'AI_ATTACHMENT_INVALID' USING ERRCODE = '22023';
    END IF;
    UPDATE public.ai_attachment_uploads SET state='uploading',attempt_id=p_attempt,write_started_at=clock_timestamp(),
        validated_at=clock_timestamp(),width=p_width,height=p_height,extracted_text=p_text,
        next_check_at=clock_timestamp() + interval '1 minute',updated_at=clock_timestamp()
    WHERE upload_id=p_upload RETURNING * INTO v_row;
    RETURN public.ai_attachment_value(v_row);
END;
$$;

CREATE FUNCTION ai_attachment_finish_upload(p_owner uuid,p_upload uuid,p_attempt uuid,p_outcome varchar) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_row public.ai_attachment_uploads%ROWTYPE; v_delete boolean;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
    PERFORM public.ai_attachment_get(p_owner,p_upload);
    IF p_outcome IS NULL OR p_outcome NOT IN ('persisted','not_written','unknown','integrity') THEN
        RAISE EXCEPTION 'AI_ATTACHMENT_INVALID' USING ERRCODE = '22023'; END IF;
    SELECT * INTO STRICT v_row FROM public.ai_attachment_uploads WHERE upload_id=p_upload FOR UPDATE;
    IF v_row.attempt_id IS DISTINCT FROM p_attempt OR p_attempt IS NULL THEN RAISE EXCEPTION 'AI_ATTACHMENT_ID_REUSED' USING ERRCODE = '22023'; END IF;
    IF v_row.state NOT IN ('uploading','unknown') THEN RETURN public.ai_attachment_value(v_row); END IF;
    v_delete := v_row.delete_requested OR v_row.expires_at <= clock_timestamp();
    UPDATE public.ai_attachment_uploads SET
        state=CASE WHEN p_outcome='persisted' THEN CASE WHEN v_delete THEN 'deleting' ELSE 'ready' END
                   WHEN p_outcome='not_written' THEN CASE WHEN v_delete THEN 'deleted' ELSE 'failed' END ELSE 'unknown' END,
        held=p_outcome<>'not_written',delete_requested=v_delete,
        file_name=CASE WHEN p_outcome='not_written' THEN NULL ELSE file_name END,
        extracted_text=CASE WHEN p_outcome='not_written' THEN NULL ELSE extracted_text END,
        error_code=CASE WHEN p_outcome='persisted' THEN NULL ELSE 'ai_attachment_storage_' || p_outcome END,
        lease_id=NULL,lease_until=NULL,next_check_at=clock_timestamp() + interval '1 minute',updated_at=clock_timestamp()
    WHERE upload_id=p_upload RETURNING * INTO v_row;
    RETURN public.ai_attachment_value(v_row);
END;
$$;

CREATE FUNCTION ai_attachment_reject(p_owner uuid,p_upload uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_row public.ai_attachment_uploads%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
    PERFORM public.ai_attachment_get(p_owner,p_upload);
    UPDATE public.ai_attachment_uploads SET state='failed',held=false,file_name=NULL,extracted_text=NULL,
        error_code='ai_attachment_validation_failed',updated_at=clock_timestamp()
      WHERE upload_id=p_upload AND state='reserved' AND attempt_id IS NULL;
    SELECT * INTO STRICT v_row FROM public.ai_attachment_uploads WHERE upload_id=p_upload;
    RETURN public.ai_attachment_value(v_row);
END;
$$;

CREATE FUNCTION ai_attachment_remove(p_owner uuid,p_upload uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_row public.ai_attachment_uploads%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
    PERFORM public.ai_attachment_get(p_owner,p_upload);
    SELECT * INTO STRICT v_row FROM public.ai_attachment_uploads WHERE upload_id=p_upload FOR UPDATE;
    IF v_row.state='bound' THEN RAISE EXCEPTION 'AI_ATTACHMENT_BOUND' USING ERRCODE = '22023'; END IF;
    IF v_row.state IN ('deleted','failed') THEN RETURN public.ai_attachment_value(v_row); END IF;
    UPDATE public.ai_attachment_uploads SET delete_requested=true,
        state=CASE state WHEN 'reserved' THEN 'deleted' WHEN 'ready' THEN 'deleting' ELSE state END,
        held=state<>'reserved',file_name=CASE WHEN state='reserved' THEN NULL ELSE file_name END,
        extracted_text=CASE WHEN state='reserved' THEN NULL ELSE extracted_text END,
        next_check_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE upload_id=p_upload RETURNING * INTO v_row;
    RETURN public.ai_attachment_value(v_row);
END;
$$;

-- Internal bounded maintenance claims. A lost worker releases only its lease,
-- never the storage reservation. SKIP LOCKED supports multiple API processes.
CREATE FUNCTION ai_attachment_claim_row(p_upload uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_row public.ai_attachment_uploads%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM public.ai_attachment_uploads WHERE upload_id=p_upload FOR UPDATE SKIP LOCKED;
    IF NOT FOUND OR (v_row.lease_until IS NOT NULL AND v_row.lease_until>clock_timestamp()) THEN RETURN NULL; END IF;
    IF v_row.state IN ('reserved','ready') AND v_row.expires_at<=clock_timestamp() THEN
        UPDATE public.ai_attachment_uploads SET delete_requested=true,
            state=CASE state WHEN 'reserved' THEN 'deleted' ELSE 'deleting' END,
            held=state<>'reserved',file_name=CASE WHEN state='reserved' THEN NULL ELSE file_name END,
            extracted_text=CASE WHEN state='reserved' THEN NULL ELSE extracted_text END,
            updated_at=clock_timestamp()
        WHERE upload_id=p_upload RETURNING * INTO v_row;
    END IF;
    IF v_row.state='uploading' AND v_row.write_started_at<=clock_timestamp()-interval '1 minute' THEN
        UPDATE public.ai_attachment_uploads SET state='unknown',error_code='ai_attachment_storage_unknown',updated_at=clock_timestamp()
        WHERE upload_id=p_upload RETURNING * INTO v_row;
    END IF;
    IF v_row.state NOT IN ('unknown','deleting') THEN RETURN NULL; END IF;
    UPDATE public.ai_attachment_uploads SET lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '45 seconds',updated_at=clock_timestamp()
    WHERE upload_id=p_upload RETURNING * INTO v_row;
    RETURN public.ai_attachment_value(v_row);
END;
$$;
REVOKE ALL ON FUNCTION ai_attachment_claim_row(uuid) FROM PUBLIC, asalab_app;

CREATE FUNCTION ai_attachment_claim(p_owner uuid,p_upload uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM public.ai_attachment_get(p_owner,p_upload);
    RETURN public.ai_attachment_claim_row(p_upload);
END;
$$;

CREATE FUNCTION ai_attachment_claim_batch(p_limit integer) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_id uuid; v_claim jsonb;
BEGIN
    FOR v_id IN SELECT upload_id FROM public.ai_attachment_uploads
      WHERE next_check_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<=clock_timestamp())
        AND (state IN ('unknown','deleting') OR (state IN ('reserved','ready') AND expires_at<=clock_timestamp())
             OR (state='uploading' AND write_started_at<=clock_timestamp()-interval '1 minute'))
      ORDER BY next_check_at,upload_id LIMIT LEAST(GREATEST(COALESCE(p_limit,1),1),8) FOR UPDATE SKIP LOCKED
    LOOP
        v_claim := public.ai_attachment_claim_row(v_id);
        IF v_claim IS NOT NULL THEN RETURN NEXT v_claim; END IF;
    END LOOP;
END;
$$;

CREATE FUNCTION ai_attachment_finish_claim(p_owner uuid,p_upload uuid,p_lease uuid,p_outcome varchar) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_row public.ai_attachment_uploads%ROWTYPE; v_delete boolean;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text,7312));
    SELECT * INTO v_row FROM public.ai_attachment_uploads WHERE upload_id=p_upload AND owner_principal_id=p_owner FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_ATTACHMENT_NOT_FOUND' USING ERRCODE='42501'; END IF;
    IF p_lease IS NULL OR v_row.lease_id IS DISTINCT FROM p_lease THEN RETURN public.ai_attachment_value(v_row); END IF;
    IF p_outcome IS NULL OR p_outcome NOT IN ('persisted','deleted','unknown','integrity')
       OR (p_outcome='deleted' AND v_row.state<>'deleting') THEN
        RAISE EXCEPTION 'AI_ATTACHMENT_INVALID' USING ERRCODE='22023'; END IF;
    v_delete := v_row.delete_requested OR v_row.expires_at<=clock_timestamp();
    UPDATE public.ai_attachment_uploads SET
        state=CASE WHEN p_outcome='deleted' THEN 'deleted'
                   WHEN state='unknown' AND p_outcome='persisted' THEN CASE WHEN v_delete THEN 'deleting' ELSE 'ready' END ELSE state END,
        held=p_outcome<>'deleted',delete_requested=v_delete,
        file_name=CASE WHEN p_outcome='deleted' THEN NULL ELSE file_name END,
        extracted_text=CASE WHEN p_outcome='deleted' THEN NULL ELSE extracted_text END,
        error_code=CASE WHEN p_outcome IN ('persisted','deleted') THEN NULL ELSE 'ai_attachment_storage_' || p_outcome END,
        lease_id=NULL,lease_until=NULL,next_check_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp()
    WHERE upload_id=p_upload RETURNING * INTO v_row;
    RETURN public.ai_attachment_value(v_row);
END;
$$;

-- The binding disappears only with the immutable source user message. Queue
-- deletion in that same transaction; never call S3 or refund quota in a trigger.
CREATE FUNCTION ai_attachment_source_deleted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
    UPDATE public.ai_attachment_uploads SET state='deleting',delete_requested=true,
        next_check_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE upload_id=OLD.upload_id AND owner_principal_id=OLD.owner_principal_id AND state='bound';
    RETURN OLD;
END;
$$;
CREATE TRIGGER ai_attachment_source_deleted AFTER DELETE ON ai_attachment_bindings
    FOR EACH ROW EXECUTE FUNCTION ai_attachment_source_deleted();
REVOKE ALL ON FUNCTION ai_attachment_source_deleted() FROM PUBLIC,asalab_app;

-- Verify the immutable snapshot as well as the number of rows. A request must
-- never silently pick up different uploads, order, content hashes or source.
CREATE FUNCTION ai_attachment_bound_items(
    p_owner uuid,p_thread uuid,p_request uuid,p_source uuid,p_ordinal bigint,p_digest bytea,p_manifest jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_items jsonb; v_manifest jsonb;
BEGIN
    SELECT jsonb_agg(public.ai_attachment_value(u) ORDER BY b.position),
        jsonb_agg(jsonb_build_object('uploadId',u.upload_id,'sha256',u.sha256,'sizeBytes',u.size_bytes,'mediaType',u.media_type) ORDER BY b.position)
      INTO v_items,v_manifest
      FROM public.ai_attachment_bindings b JOIN public.ai_attachment_uploads u
        ON u.upload_id=b.upload_id AND u.owner_principal_id=b.owner_principal_id
      WHERE b.owner_principal_id=p_owner AND b.thread_id=p_thread AND b.request_id=p_request
        AND b.source_user_message_id=p_source AND b.source_ordinal=p_ordinal AND b.source_digest=p_digest
        AND u.state='bound' AND u.held AND NOT u.delete_requested;
    IF v_manifest IS DISTINCT FROM p_manifest THEN
        RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
    RETURN v_items;
END;
$$;
REVOKE ALL ON FUNCTION ai_attachment_bound_items(uuid,uuid,uuid,uuid,bigint,bytea,jsonb) FROM PUBLIC,asalab_app;

CREATE FUNCTION ai_attachment_begin_message(
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
    -- Existing paid admission locks owner -> teacher policy -> config -> thread.
    -- Attachment rows come last, in UUID order. Failure below rolls back the
    -- user message and BOTH ledgers. No application-side post-send binding.
    IF NOT public.ai_text_begin_paid(p_owner,p_thread,p_request,p_text,p_expected_version) THEN
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

CREATE FUNCTION ai_attachment_request_source(p_owner uuid,p_thread uuid,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_source public.ai_assistant_messages%ROWTYPE; v_receipt public.ai_attachment_message_receipts%ROWTYPE; v_items jsonb;
BEGIN
    IF NOT public.ai_chat_owner_valid(p_owner) THEN RAISE EXCEPTION 'AI_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
    SELECT q.* INTO v_source FROM public.ai_assistant_messages q WHERE q.thread_id=p_thread AND q.owner_principal_id=p_owner AND q.role='user'
      AND (q.request_id=p_request OR EXISTS(SELECT 1 FROM public.ai_assistant_regenerations r
          WHERE r.owner_principal_id=p_owner AND r.thread_id=p_thread AND r.request_id=p_request AND r.source_user_message_id=q.id
            AND r.source_digest=public.ai_text_source_digest(p_owner,p_thread,q.id,q.ordinal,q.content)));
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_SOURCE_DENIED' USING ERRCODE='42501'; END IF;
    SELECT * INTO v_receipt FROM public.ai_attachment_message_receipts WHERE owner_principal_id=p_owner AND request_id=v_source.request_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('sourceUserMessageId',v_source.id,'items','[]'::jsonb); END IF;
    IF v_receipt.thread_id<>p_thread OR v_receipt.source_user_message_id<>v_source.id OR v_receipt.source_ordinal<>v_source.ordinal
       OR v_receipt.source_digest<>public.ai_text_source_digest(p_owner,p_thread,v_source.id,v_source.ordinal,v_source.content) THEN
        RAISE EXCEPTION 'AI_REQUEST_ID_REUSED' USING ERRCODE='22023'; END IF;
    v_items:=public.ai_attachment_bound_items(p_owner,p_thread,v_source.request_id,v_source.id,v_source.ordinal,v_receipt.source_digest,v_receipt.manifest);
    RETURN jsonb_build_object('sourceUserMessageId',v_source.id,'items',v_items);
END;
$$;

REVOKE ALL ON FUNCTION ai_attachment_get(uuid,uuid),
    ai_attachment_reserve(uuid,uuid,varchar,bigint,varchar,varchar,varchar,varchar),
    ai_attachment_begin_upload(uuid,uuid,uuid,integer,integer,text),
    ai_attachment_finish_upload(uuid,uuid,uuid,varchar), ai_attachment_reject(uuid,uuid),
    ai_attachment_remove(uuid,uuid), ai_attachment_claim(uuid,uuid), ai_attachment_claim_batch(integer),
    ai_attachment_finish_claim(uuid,uuid,uuid,varchar),
    ai_attachment_begin_message(uuid,uuid,uuid,varchar,bigint,uuid[]),
    ai_attachment_request_source(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_attachment_get(uuid,uuid),
    ai_attachment_reserve(uuid,uuid,varchar,bigint,varchar,varchar,varchar,varchar),
    ai_attachment_begin_upload(uuid,uuid,uuid,integer,integer,text),
    ai_attachment_finish_upload(uuid,uuid,uuid,varchar), ai_attachment_reject(uuid,uuid),
    ai_attachment_remove(uuid,uuid), ai_attachment_claim(uuid,uuid), ai_attachment_claim_batch(integer),
    ai_attachment_finish_claim(uuid,uuid,uuid,varchar),
    ai_attachment_begin_message(uuid,uuid,uuid,varchar,bigint,uuid[]),
    ai_attachment_request_source(uuid,uuid,uuid) TO asalab_app;
