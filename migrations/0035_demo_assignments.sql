-- Ten assignments, in every class, from the first minute.
--
-- A teacher who opens a new class and finds an empty "Assignments" tab has to
-- imagine what one looks like before they can want one. These are real
-- assignments — the owner's own ten-task 3D course — inserted into every class
-- so the feature explains itself: open the tab, see the work, see who has
-- started it, delete the ones you do not want.
--
-- They are rows, not templates. A teacher can edit or delete them like anything
-- else, and a class that has deleted them stays deleted: the seed only ever
-- inserts what is missing by key, and the key is removed with the row, so a
-- deleted demo does not come back the next time a class is touched.

ALTER TABLE classroom_assignments
    ADD COLUMN IF NOT EXISTS demo_key varchar(32);

-- One of each demo per class, and a marker the client can show so a teacher
-- knows which assignments they were given rather than wrote.
CREATE UNIQUE INDEX IF NOT EXISTS classroom_assignments_demo_idx
    ON classroom_assignments (classroom_id, demo_key) WHERE demo_key IS NOT NULL;

-- Deleting one. Assignments were previously only openable and closeable, which
-- is right for work a teacher set and wrong for work they never asked for.
CREATE OR REPLACE FUNCTION classroom_assignment_delete(
    p_account_id    uuid,
    p_classroom_id  uuid,
    p_assignment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_access record; v_removed integer := 0;
BEGIN
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;

    -- Work a learner has already started is not deleted out from under them:
    -- the link goes, the project stays theirs, and it keeps its own history.
    DELETE FROM public.classroom_assignment_work w
     WHERE w.tenant_id = v_access.tenant_id AND w.assignment_id = p_assignment_id;
    DELETE FROM public.classroom_assignments a
     WHERE a.tenant_id = v_access.tenant_id
       AND a.classroom_id = p_classroom_id
       AND a.id = p_assignment_id;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    IF v_removed = 1 THEN
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (v_access.tenant_id, v_access.user_id, 'classroom_assignment', p_assignment_id,
             'classroom.assignment_deleted',
             jsonb_build_object('classroomId', p_classroom_id));
    END IF;
    RETURN v_removed = 1;
END;
$$;

-- The course itself. Held in one function so a class made tomorrow gets the
-- same ten as a class made today, and so the text lives in one place.
CREATE OR REPLACE FUNCTION classroom_assignments_seed_demo(p_classroom_id uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_author uuid;
    v_added integer := 0;
    v_rules text := E'Создайте одну законченную трёхмерную модель по образцу. Полностью копировать образец не нужно: размеры, цвета и пропорции выбирайте сами, но все обязательные элементы должны быть на месте. Сложные округлые детали можно упрощать простыми фигурами.\n\n';
    v_check text := E'\n\nПеред сдачей проверьте: все обязательные элементы на месте; одинаковые детали одного размера; детали соприкасаются там, где соединены; лишних фигур не осталось; модель верно выглядит спереди, сбоку и сверху.';
    v_task record;
BEGIN
    SELECT c.tenant_id, c.created_by INTO v_tenant, v_author
      FROM public.classrooms c
     WHERE c.id = p_classroom_id AND c.status = 'active';
    IF v_tenant IS NULL THEN RETURN 0; END IF;

    FOR v_task IN
        SELECT * FROM (VALUES
            ('demo-house', 'Домик',
             E'Создайте модель небольшого одноэтажного дома из простых фигур: прямоугольный корпус и крыша сверху.\n\nОбязательные элементы: корпус, двухскатная крыша, входная дверь, четыре одинаковых окна, дымоход, две ступеньки.\n\nТребования: два окна на передней стене и два на боковой; все окна одного размера; окна на одной стене на одинаковой высоте; ступеньки точно перед дверью; дымоход выходит из крыши.'),
            ('demo-snowman', 'Снеговик',
             E'Создайте модель снеговика из трёх шаров разного размера.\n\nОбязательные элементы: три шара, два глаза, нос, три пуговицы, две руки, шляпа.\n\nТребования: самый большой шар снизу, средний над ним, самый маленький — голова; шары стоят друг над другом; нос — конус; руки — два одинаковых цилиндра; пуговицы расположены вертикально; шляпа собрана минимум из двух деталей.'),
            ('demo-kettlebell', 'Спортивная гиря',
             E'Создайте модель спортивной гири: округлый корпус и ручка сверху.\n\nОбязательные элементы: округлый корпус, плоское основание, ручка, круглая площадка спереди, число 16.\n\nТребования: гиря устойчиво стоит на плоском низе; между корпусом и верхом ручки остаётся свободное пространство; ручку можно собрать из трёх деталей — двух стоек и перекладины; площадка по центру передней части; число 16 на площадке.'),
            ('demo-robot', 'Робот',
             E'Создайте модель робота из простых фигур: сначала голова и туловище, затем симметричные руки и ноги.\n\nОбязательные элементы: голова, туловище, две руки, две ноги, две ступни, два глаза, три кнопки, антенна.\n\nТребования: голова над центром туловища; сделайте одну руку и скопируйте её для второй стороны, так же с ногами; ступни одинаковые; глаза одного размера и на одной высоте; кнопки на передней стороне; антенна сверху головы. Кисти можно заменить шарами или блоками.'),
            ('demo-car', 'Автомобиль',
             E'Создайте модель небольшого легкового автомобиля: сначала кузов и кабина, затем колёса и детали.\n\nОбязательные элементы: кузов, кабина, четыре колеса, переднее стекло, два боковых стекла, две фары, передний и задний бамперы.\n\nТребования: все колёса одинаковые и на одной высоте; передние друг напротив друга, задние тоже; фары одного размера; кабина сверху кузова; стёкла — тонкие плоские детали другого цвета.'),
            ('demo-rocket', 'Ракета',
             E'Создайте модель космической ракеты: корпус — цилиндр, верх — конус.\n\nОбязательные элементы: корпус, носовой конус, два иллюминатора, три стабилизатора, три сопла.\n\nТребования: ракета стоит вертикально; конус точно над корпусом; иллюминаторы одного размера и один над другим; стабилизаторы в нижней части корпуса; сопла под корпусом. Стабилизаторы можно упростить.'),
            ('demo-keyring', 'Именной брелок',
             E'Создайте именной брелок: на плоской основе имя или короткое слово и настоящее сквозное отверстие.\n\nОбязательные элементы: основа, круглое сквозное отверстие, имя или слово, декоративный элемент.\n\nТребования: основа вытянутая; отверстие у края, но между ним и краем остаётся стенка; отверстие проходит основу насквозь; надпись полностью помещается на поверхности; буквы на одной линии. Декоративный элемент — сердце, звезда или другая простая фигура.'),
            ('demo-sailboat', 'Парусный корабль',
             E'Создайте модель небольшого парусного корабля.\n\nОбязательные элементы: корпус, верхняя часть корпуса, мачта, большой парус, флаг.\n\nТребования: корпус вытянутый, его можно собрать из двух и более простых деталей; округление корпуса с образца повторять не нужно; мачта вертикальная и нижней частью входит в корпус; парус рядом с мачтой и треугольной формы; флаг в верхней части мачты.'),
            ('demo-plane', 'Самолёт',
             E'Создайте модель одномоторного самолёта с воздушным винтом. Корпус вытянутый, по бокам одинаковые крылья.\n\nОбязательные элементы: корпус, два основных крыла, кабина, вертикальный хвост, два горизонтальных хвостовых крыла, воздушный винт.\n\nТребования: сделайте одно крыло и скопируйте его на другую сторону, так же с хвостовыми; вертикальный хвост сверху задней части; кабина сверху ближе к носу; винт по центру носовой части, его можно собрать из двух тонких пересекающихся деталей; сверху самолёт симметричен.'),
            ('demo-castle', 'Средневековый замок',
             E'Итоговое задание. Создайте замок с крепостной стеной и внутренним двором — оно объединяет навыки предыдущих моделей.\n\nОбязательные элементы: основание, стена по всему периметру, четыре угловые башни, входные ворота, внутренний двор, главное здание внутри двора, крыша главного здания, зубцы на передней стене, окна или бойницы, флаг.\n\nТребования: стена полностью окружает двор; в каждом углу по башне; башни одного основного размера; в передней стене сквозной проём для ворот; главное здание стоит внутри стены, а не вместо неё, и между ними остаётся двор; сделайте один зубец и используйте копии. Повторять множество мелких зубцов и окон не нужно.')
        ) AS course(demo_key, title, brief)
    LOOP
        INSERT INTO public.classroom_assignments
            (tenant_id, classroom_id, title, brief, module_key, created_by, demo_key)
        VALUES (v_tenant, p_classroom_id, v_task.title,
                v_rules || v_task.brief || v_check,
                '3d', v_author, v_task.demo_key)
        ON CONFLICT (classroom_id, demo_key) WHERE demo_key IS NOT NULL DO NOTHING;
        IF FOUND THEN v_added := v_added + 1; END IF;
    END LOOP;

    RETURN v_added;
END;
$$;

REVOKE ALL ON FUNCTION classroom_assignment_delete(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignments_seed_demo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_assignment_delete(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignments_seed_demo(uuid) TO asalab_app;

-- Classes that already exist get them too: a teacher should not have to make a
-- new class to find out what the tab is for.
DO $$
DECLARE v_classroom uuid;
BEGIN
    FOR v_classroom IN SELECT id FROM public.classrooms WHERE status = 'active'
    LOOP
        PERFORM public.classroom_assignments_seed_demo(v_classroom);
    END LOOP;
END;
$$;
