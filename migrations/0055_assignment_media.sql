-- Картинки внутри текста задания.
--
-- Задание — это не абзац прозы. «Соедини две детали» показывают, а не
-- описывают: шаг с картинкой понимают с первого раза, шаг без картинки
-- переспрашивают весь урок. Одна картинка-образец у задания уже была, но она
-- отвечает на вопрос «что должно получиться», а не «как дойти до шага 3».
--
-- Картинки хранятся, а не ссылаются наружу: ссылка на чужой сайт протухает, а
-- школа, потерявшая файловый сервер, не должна терять курс. Размер ограничен
-- конструкцией — иллюстрация к шагу это не фотоальбом.

CREATE TABLE IF NOT EXISTS teacher_assignment_images (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants(id),
    assignment_id uuid NOT NULL,
    content_type  varchar(32) NOT NULL,
    bytes         bytea NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, assignment_id)
        REFERENCES teacher_assignments(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT teacher_assignment_images_bytes_check
        CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')
               AND octet_length(bytes) BETWEEN 64 AND 400000)
);

CREATE INDEX IF NOT EXISTS teacher_assignment_images_assignment_idx
    ON teacher_assignment_images (assignment_id, created_at);

GRANT SELECT ON teacher_assignment_images TO asalab_app;
ALTER TABLE teacher_assignment_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_assignment_images FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teacher_assignment_images_tenant ON teacher_assignment_images;
CREATE POLICY teacher_assignment_images_tenant ON teacher_assignment_images
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

/** Добавить картинку к заданию. Только владелец задания. */
CREATE OR REPLACE FUNCTION teacher_assignment_image_add(
    p_principal_id  uuid,
    p_assignment_id uuid,
    p_bytes         bytea,
    p_content_type  varchar
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_image  uuid;
BEGIN
    SELECT t.tenant_id INTO v_tenant
      FROM public.teacher_assignments t
     WHERE t.id = p_assignment_id AND t.owner_principal_id = p_principal_id;
    IF v_tenant IS NULL THEN RETURN NULL; END IF;
    INSERT INTO public.teacher_assignment_images (tenant_id, assignment_id, bytes, content_type)
    VALUES (v_tenant, p_assignment_id, p_bytes, p_content_type)
    RETURNING id INTO v_image;
    RETURN v_image;
END;
$$;

/**
 * Прочитать картинку.
 *
 * Как и образец: её видит любой, кому видно само задание, — учитель, который
 * его написал, и ученик, которому его выдали.
 */
CREATE OR REPLACE FUNCTION teacher_assignment_image(
    p_assignment_id uuid,
    p_image_id      uuid
)
RETURNS TABLE (bytes bytea, content_type varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT i.bytes, i.content_type
      FROM public.teacher_assignment_images i
     WHERE i.assignment_id = p_assignment_id AND i.id = p_image_id;
$$;

REVOKE ALL ON FUNCTION teacher_assignment_image_add(uuid, uuid, bytea, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION teacher_assignment_image(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION teacher_assignment_image_add(uuid, uuid, bytea, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION teacher_assignment_image(uuid, uuid) TO asalab_app;
