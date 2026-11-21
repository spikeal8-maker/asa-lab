-- Preserve original owner-bound bytes and existing immutable receipts.
ALTER TABLE public.ai_attachment_uploads ALTER COLUMN media_type TYPE varchar(128);
DO $$ DECLARE r record; n integer := 0; BEGIN
 FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='public.ai_attachment_uploads'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%extension%' LOOP
  EXECUTE format('ALTER TABLE public.ai_attachment_uploads DROP CONSTRAINT %I',r.conname); n:=n+1;
 END LOOP;
 IF n<>1 THEN RAISE EXCEPTION 'Unexpected attachment format constraints'; END IF;
END $$;
ALTER TABLE public.ai_attachment_uploads ADD CONSTRAINT ai_attachment_format_v2 CHECK (((kind = 'image' AND extension IN ('png','jpg','webp') AND extracted_text IS NULL
              AND media_type = CASE extension WHEN 'png' THEN 'image/png' WHEN 'jpg' THEN 'image/jpeg' ELSE 'image/webp' END)
        OR (kind = 'text' AND size_bytes <= 524288 AND width IS NULL AND height IS NULL
              AND extension IN ('txt','md','markdown','js','jsx','ts','tsx','py','c','cpp','h','hpp','ino','json','css','html','xml','yaml','yml','sql','sh','java','rs','go')
              AND media_type = CASE WHEN extension IN ('md','markdown') THEN 'text/markdown' ELSE 'text/plain' END) OR (kind='text' AND extension IN ('pdf','docx','xlsx') AND width IS NULL AND height IS NULL AND media_type=CASE extension WHEN 'pdf' THEN 'application/pdf' WHEN 'docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ELSE 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' END)));
CREATE OR REPLACE FUNCTION ai_attachment_reserve(
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
       OR (p_kind = 'text' AND p_extension NOT IN ('pdf','docx','xlsx') AND p_size > 524288) THEN
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
