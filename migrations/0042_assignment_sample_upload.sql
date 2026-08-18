-- A teacher's own task gets a picture too.
--
-- The ten shipped tasks arrive with a render because the task is "make this",
-- and a paragraph describing a castle is not the same as seeing one. A teacher
-- writing their own task needs the same thing and had no way to attach it.
--
-- The image is stored, not linked: a URL to somewhere else rots, and a school
-- that loses its file server should not lose its course. Small by constraint —
-- a reference picture is a thumbnail, and 400 KB of it is generous.

ALTER TABLE teacher_assignments
    ADD COLUMN IF NOT EXISTS sample_bytes bytea,
    ADD COLUMN IF NOT EXISTS sample_content_type varchar(32);

ALTER TABLE teacher_assignments DROP CONSTRAINT IF EXISTS teacher_assignments_sample_check;
ALTER TABLE teacher_assignments
    ADD CONSTRAINT teacher_assignments_sample_check
    CHECK (
        (sample_bytes IS NULL AND sample_content_type IS NULL)
        OR (sample_content_type IN ('image/png', 'image/jpeg', 'image/webp')
            AND octet_length(sample_bytes) BETWEEN 64 AND 400000)
    );

-- Attaching one, or taking it off. Only the teacher who owns the task.
CREATE OR REPLACE FUNCTION teacher_assignment_sample_set(
    p_principal_id  uuid,
    p_assignment_id uuid,
    p_bytes         bytea,
    p_content_type  varchar
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_updated integer := 0;
BEGIN
    UPDATE public.teacher_assignments t
       SET sample_bytes = p_bytes,
           sample_content_type = p_content_type,
           -- The shipped tasks point at a file that ships with the product; an
           -- uploaded one is served from here, so the pointer moves to this row.
           sample_image = CASE
               WHEN p_bytes IS NULL AND t.demo_key IS NOT NULL
                   THEN '/assets/assignments/' || t.demo_key || '.jpg'
               WHEN p_bytes IS NULL THEN NULL
               ELSE '/api/assignments/' || t.id || '/sample'
           END,
           updated_at = now()
     WHERE t.id = p_assignment_id AND t.owner_principal_id = p_principal_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

-- Reading it back, for anyone who may see the task: the teacher who owns it and
-- any learner it was given to.
CREATE OR REPLACE FUNCTION teacher_assignment_sample(
    p_assignment_id uuid
)
RETURNS TABLE (sample_bytes bytea, sample_content_type varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT t.sample_bytes, t.sample_content_type
      FROM public.teacher_assignments t
     WHERE t.id = p_assignment_id AND t.sample_bytes IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION teacher_assignment_sample_set(uuid, uuid, bytea, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_sample(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION teacher_assignment_sample_set(uuid, uuid, bytea, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_sample(uuid) TO asalab_app;
