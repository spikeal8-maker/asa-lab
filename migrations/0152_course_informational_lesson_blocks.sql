-- E1-FIX-11: informational lesson blocks in the existing lesson.blocks contract.
-- No new block model or runtime is introduced. This only extends the canonical
-- validator and the legacy plain-text projection used by existing course flows.

CREATE OR REPLACE FUNCTION public.course_lesson_blocks_valid(p_blocks jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF p_blocks IS NULL OR jsonb_typeof(p_blocks) <> 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(p_blocks) > 40 OR octet_length(p_blocks::text) > 60000 THEN
        RETURN false;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_blocks) block
         WHERE jsonb_typeof(block) <> 'object'
            OR coalesce(block ->> 'id', '') !~ '^[A-Za-z0-9_-]{1,80}$'
            OR coalesce(block ->> 'type', '') NOT IN (
                'paragraph', 'heading', 'callout', 'image', 'video', 'audio', 'file',
                'code', 'formula', 'table', 'divider'
            )
            OR CASE block ->> 'type'
                WHEN 'paragraph' THEN
                    block - ARRAY['id','type','text'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(block ->> 'text') > 12000
                WHEN 'heading' THEN
                    block - ARRAY['id','type','text','level'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(trim(coalesce(block ->> 'text', ''))) = 0
                    OR length(block ->> 'text') > 300
                    OR coalesce(block ->> 'level', '') NOT IN ('2', '3')
                WHEN 'callout' THEN
                    block - ARRAY['id','type','text','tone'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(trim(coalesce(block ->> 'text', ''))) = 0
                    OR length(block ->> 'text') > 3000
                    OR coalesce(block ->> 'tone', '') NOT IN ('note', 'tip', 'warning')
                WHEN 'image' THEN
                    block - ARRAY['id','type','url','alt','caption'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'url'), '') <> 'string'
                    OR (coalesce(block ->> 'url', '') !~ '^https://'
                        AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                    OR coalesce(block ->> 'url', '') LIKE '%..%'
                    OR length(block ->> 'url') > 2000
                    OR (block ? 'alt' AND coalesce(jsonb_typeof(block -> 'alt'), '') <> 'string')
                    OR length(coalesce(block ->> 'alt', '')) > 300
                    OR (block ? 'caption'
                        AND coalesce(jsonb_typeof(block -> 'caption'), '') <> 'string')
                    OR length(coalesce(block ->> 'caption', '')) > 600
                WHEN 'video' THEN
                    block - ARRAY['id','type','url','title'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'url'), '') <> 'string'
                    OR (coalesce(block ->> 'url', '') !~ '^https://'
                        AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                    OR coalesce(block ->> 'url', '') LIKE '%..%'
                    OR length(block ->> 'url') > 2000
                    OR (block ? 'title'
                        AND coalesce(jsonb_typeof(block -> 'title'), '') <> 'string')
                    OR length(coalesce(block ->> 'title', '')) > 300
                WHEN 'audio' THEN
                    block - ARRAY['id','type','url','title'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'url'), '') <> 'string'
                    OR (coalesce(block ->> 'url', '') !~ '^https://'
                        AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                    OR coalesce(block ->> 'url', '') LIKE '%..%'
                    OR length(block ->> 'url') > 2000
                    OR (block ? 'title'
                        AND coalesce(jsonb_typeof(block -> 'title'), '') <> 'string')
                    OR length(coalesce(block ->> 'title', '')) > 300
                WHEN 'file' THEN
                    block - ARRAY['id','type','url','label'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'url'), '') <> 'string'
                    OR (coalesce(block ->> 'url', '') !~ '^https://'
                        AND coalesce(block ->> 'url', '') !~ '^/assets/[A-Za-z0-9][A-Za-z0-9/_.%\-]*$')
                    OR coalesce(block ->> 'url', '') LIKE '%..%'
                    OR length(block ->> 'url') > 2000
                    OR coalesce(jsonb_typeof(block -> 'label'), '') <> 'string'
                    OR length(trim(coalesce(block ->> 'label', ''))) = 0
                    OR length(block ->> 'label') > 300
                WHEN 'code' THEN
                    block - ARRAY['id','type','text','language'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(block ->> 'text') > 20000
                    OR (
                        block ? 'language'
                        AND (
                            coalesce(jsonb_typeof(block -> 'language'), '') <> 'string'
                            OR coalesce(block ->> 'language', '') !~ '^[A-Za-z0-9][A-Za-z0-9_+.#-]{0,79}$'
                        )
                    )
                WHEN 'formula' THEN
                    block - ARRAY['id','type','text'] <> '{}'::jsonb
                    OR coalesce(jsonb_typeof(block -> 'text'), '') <> 'string'
                    OR length(trim(coalesce(block ->> 'text', ''))) = 0
                    OR length(block ->> 'text') > 4000
                WHEN 'table' THEN
                    block - ARRAY['id','type','rows'] <> '{}'::jsonb
                    OR CASE
                        WHEN coalesce(jsonb_typeof(block -> 'rows'), '') <> 'array' THEN true
                        WHEN jsonb_array_length(block -> 'rows') NOT BETWEEN 1 AND 30 THEN true
                        ELSE EXISTS (
                            SELECT 1
                              FROM jsonb_array_elements(block -> 'rows') row_value
                             WHERE coalesce(jsonb_typeof(row_value), '') <> 'array'
                                OR jsonb_array_length(row_value) NOT BETWEEN 1 AND 12
                                OR jsonb_array_length(row_value)
                                   <> jsonb_array_length((block -> 'rows') -> 0)
                                OR EXISTS (
                                    SELECT 1
                                      FROM jsonb_array_elements(row_value) cell
                                     WHERE coalesce(jsonb_typeof(cell), '') <> 'string'
                                        OR length(cell #>> '{}') > 1000
                                )
                        )
                    END
                WHEN 'divider' THEN
                    block - ARRAY['id','type'] <> '{}'::jsonb
                ELSE true
              END
    ) THEN RETURN false; END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_blocks) block
         GROUP BY block ->> 'id'
        HAVING count(*) > 1
    ) THEN RETURN false; END IF;

    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.course_lesson_blocks_plain_text(p_blocks jsonb)
RETURNS varchar
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_block jsonb;
    v_row jsonb;
    v_piece text;
    v_row_text text;
    v_text text := '';
BEGIN
    FOR v_block IN SELECT value FROM jsonb_array_elements(p_blocks)
    LOOP
        v_piece := CASE v_block ->> 'type'
            WHEN 'paragraph' THEN v_block ->> 'text'
            WHEN 'heading' THEN v_block ->> 'text'
            WHEN 'callout' THEN v_block ->> 'text'
            WHEN 'image' THEN v_block ->> 'caption'
            WHEN 'video' THEN v_block ->> 'title'
            WHEN 'audio' THEN v_block ->> 'title'
            WHEN 'file' THEN v_block ->> 'label'
            WHEN 'code' THEN v_block ->> 'text'
            WHEN 'formula' THEN v_block ->> 'text'
            ELSE NULL
        END;

        IF v_block ->> 'type' = 'table' THEN
            v_piece := '';
            FOR v_row IN SELECT value FROM jsonb_array_elements(v_block -> 'rows')
            LOOP
                SELECT string_agg(value, ' | ')
                  INTO v_row_text
                  FROM jsonb_array_elements_text(v_row);
                v_piece := concat_ws(E'\n', NULLIF(v_piece, ''), v_row_text);
            END LOOP;
        END IF;

        IF v_piece IS NOT NULL AND v_piece <> '' THEN
            v_text := concat_ws(E'\n\n', NULLIF(v_text, ''), v_piece);
        END IF;
    END LOOP;

    RETURN NULLIF(left(v_text, 12000), '')::varchar;
END;
$$;
