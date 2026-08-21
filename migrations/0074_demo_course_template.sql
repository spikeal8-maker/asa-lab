-- A real, reusable course template for a teacher's library.
--
-- The historical "demo course" was ten independent classroom assignments.
-- This template turns the same proven activities into one published course
-- with an introduction, sections and an immutable version. It is created only
-- when the educator asks for it; it is never assigned to a class implicitly.

ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS template_key varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS courses_owner_template_idx
    ON courses (owner_principal_id, template_key)
    WHERE template_key IS NOT NULL;

CREATE OR REPLACE FUNCTION course_demo_ensure(p_principal_id uuid)
RETURNS TABLE (course_id uuid, created boolean, published_version integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_course          uuid;
    v_tenant          uuid;
    v_intro           uuid;
    v_models          uuid;
    v_details         uuid;
    v_final           uuid;
    v_target_section  uuid;
    v_assignment      uuid;
    v_saved           uuid;
    v_publish         record;
    v_task            record;
BEGIN
    -- Serialize creation per educator so a double click cannot leave one
    -- request failing against the unique template key.
    PERFORM 1
      FROM public.principals p
     WHERE p.id = p_principal_id
     FOR UPDATE;

    SELECT c.id INTO v_course
      FROM public.courses c
     WHERE c.owner_principal_id = p_principal_id
       AND c.template_key = 'three-d-foundations-v1';

    IF v_course IS NOT NULL THEN
        RETURN QUERY
        SELECT v_course, false,
               COALESCE((SELECT max(v.version_number) FROM public.course_versions v
                          WHERE v.course_id = v_course), 0)::integer;
        RETURN;
    END IF;

    v_tenant := public.principal_home_tenant(p_principal_id);
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'course_demo_owner_not_found';
    END IF;

    INSERT INTO public.courses
        (tenant_id, owner_principal_id, title, summary, age_band, visibility, template_key)
    VALUES (
        v_tenant,
        p_principal_id,
        'Основы 3D-моделирования: от формы к проекту',
        'Готовый маршрут из коротких объяснений и десяти практических моделей. Можно изучить, изменить под свой класс и назначить ученикам.',
        '10-14',
        'private',
        'three-d-foundations-v1'
    )
    RETURNING id INTO v_course;

    v_intro := public.course_outline_ensure(v_course);
    v_intro := public.course_section_save(
        p_principal_id,
        v_course,
        v_intro,
        'Старт: как работать с курсом',
        'Короткая подготовка перед первой моделью.'
    );
    IF v_intro IS NULL THEN RAISE EXCEPTION 'course_demo_intro_failed'; END IF;

    v_saved := public.course_lesson_save(
        p_principal_id, v_course, v_intro, NULL,
        'Как устроен маршрут',
        'Сначала простые формы, затем симметрия, детали и итоговая работа.',
        E'Каждый практический урок открывает отдельное задание в редакторе. Не стремитесь буквально повторить образец: важнее выполнить обязательные элементы, проверить модель с разных сторон и сохранить законченную версию.\n\nПеред началом убедитесь, что понимаете цель урока и критерии готовности.',
        'material', NULL, 7
    );
    IF v_saved IS NULL THEN RAISE EXCEPTION 'course_demo_lesson_failed'; END IF;

    v_saved := public.course_lesson_save(
        p_principal_id, v_course, v_intro, NULL,
        'Формы, размеры и аккуратное соединение',
        'Три правила, которые пригодятся в каждой работе.',
        E'1. Начинайте с крупных форм и только потом добавляйте детали.\n2. Одинаковые детали создавайте копированием и проверяйте их размеры.\n3. Рассматривайте модель спереди, сбоку и сверху: детали должны соприкасаться там, где они соединены, и не должны случайно проходить друг сквозь друга.',
        'material', NULL, 8
    );
    IF v_saved IS NULL THEN RAISE EXCEPTION 'course_demo_lesson_failed'; END IF;

    v_models := public.course_section_save(
        p_principal_id, v_course, NULL,
        'Базовые формы',
        'Учимся собирать цельную модель из простых геометрических тел.'
    );
    v_details := public.course_section_save(
        p_principal_id, v_course, NULL,
        'Симметрия и детали',
        'Копирование, выравнивание и работа с небольшими элементами.'
    );
    v_final := public.course_section_save(
        p_principal_id, v_course, NULL,
        'Итоговые проекты',
        'Более сложные работы, объединяющие навыки всего курса.'
    );
    IF v_models IS NULL OR v_details IS NULL OR v_final IS NULL THEN
        RAISE EXCEPTION 'course_demo_sections_failed';
    END IF;

    FOR v_task IN SELECT * FROM public.classroom_demo_course() LOOP
        SELECT t.id INTO v_assignment
          FROM public.teacher_assignments t
         WHERE t.owner_principal_id = p_principal_id
           AND t.demo_key = v_task.demo_key;

        IF v_assignment IS NULL THEN
            INSERT INTO public.teacher_assignments
                (tenant_id, owner_principal_id, title, brief, module_key,
                 sample_image, demo_key, goal, age_band)
            VALUES
                (v_tenant, p_principal_id, v_task.title, v_task.brief, 'three-d',
                 '/assets/assignments/' || v_task.demo_key || '.jpg', v_task.demo_key,
                 v_task.goal,
                 '10-14')
            RETURNING id INTO v_assignment;
        END IF;

        v_target_section := CASE
            WHEN v_task.demo_key IN ('demo-house', 'demo-snowman', 'demo-kettlebell')
                THEN v_models
            WHEN v_task.demo_key IN ('demo-robot', 'demo-car', 'demo-rocket', 'demo-keyring')
                THEN v_details
            ELSE v_final
        END;

        v_saved := public.course_lesson_save(
            p_principal_id, v_course, v_target_section, NULL,
            v_task.title,
            'Практическая модель с понятным набором обязательных элементов.',
            'Откройте задание, прочитайте требования и соберите собственную версию модели. Перед сдачей проверьте размеры, соединения и вид с трёх сторон.',
            'assignment', v_assignment, 35
        );
        IF v_saved IS NULL THEN RAISE EXCEPTION 'course_demo_assignment_failed'; END IF;
    END LOOP;

    SELECT * INTO v_publish
      FROM public.course_publish(p_principal_id, v_course);
    IF v_publish.result_code <> 'ok' OR v_publish.version_number IS NULL THEN
        RAISE EXCEPTION 'course_demo_publish_failed';
    END IF;

    RETURN QUERY SELECT v_course, true, v_publish.version_number::integer;
END;
$$;

REVOKE ALL ON FUNCTION course_demo_ensure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION course_demo_ensure(uuid) TO asalab_app;
