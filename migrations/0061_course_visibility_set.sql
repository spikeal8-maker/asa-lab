-- Уровень доступа курса ставится функцией, а не чтением таблицы.
--
-- Прежний путь читал `courses` напрямую и уходил в никуда: рабочая роль видит
-- строки только по границе своей школы, а границу задаёт транзакция, которой у
-- одиночного запроса нет. Уровень молча оставался прежним, и общий каталог
-- пустовал при верно нажатой кнопке.

CREATE OR REPLACE FUNCTION course_visibility_set(
    p_principal_id uuid,
    p_course_id    uuid,
    p_visibility   varchar
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_updated integer := 0;
BEGIN
    IF p_visibility NOT IN ('private', 'teachers', 'school', 'public') THEN RETURN false; END IF;
    UPDATE public.courses c
       SET visibility = p_visibility, updated_at = now()
     WHERE c.id = p_course_id AND c.owner_principal_id = p_principal_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION course_visibility_set(uuid, uuid, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION course_visibility_set(uuid, uuid, varchar) TO asalab_app;
