-- Two things the demo course needed to actually work.
--
-- First, the environment. I wrote '3d' into the seed by hand; the module is
-- called 'three-d'. Every one of the ten therefore refused to start: pressing
-- "Начать" asked the server to make a project in an environment that does not
-- exist, and nothing happened. The end-to-end test missed it because the
-- assignment it presses was made through the picker, which cannot get the key
-- wrong. Fixed here for the rows already sown and in the seed for the next.
--
-- Second, the picture. These tasks are "make this", and the image is half the
-- brief — a paragraph describing a castle is not the same as seeing one. The
-- ten renders now ship with the product, and the assignment points at its own.

ALTER TABLE classroom_assignments
    ADD COLUMN IF NOT EXISTS sample_image varchar(128);

UPDATE classroom_assignments
   SET module_key = 'three-d'
 WHERE demo_key IS NOT NULL AND module_key = '3d';

UPDATE classroom_assignments
   SET sample_image = '/assets/assignments/' || demo_key || '.jpg'
 WHERE demo_key IS NOT NULL AND sample_image IS NULL;

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
            (tenant_id, classroom_id, title, brief, module_key, created_by, demo_key, sample_image)
        VALUES (v_tenant, p_classroom_id, v_task.title,
                v_rules || v_task.brief || v_check,
                'three-d', v_author, v_task.demo_key,
                '/assets/assignments/' || v_task.demo_key || '.jpg')
        ON CONFLICT (classroom_id, demo_key) WHERE demo_key IS NOT NULL DO NOTHING;
        IF FOUND THEN v_added := v_added + 1; END IF;
    END LOOP;

    RETURN v_added;
END;
$$;

DROP FUNCTION IF EXISTS classroom_assignment_list(uuid, uuid);
CREATE OR REPLACE FUNCTION classroom_assignment_list(
    p_account_id   uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    id uuid,
    title varchar,
    brief varchar,
    module_key varchar,
    due_at timestamptz,
    status varchar,
    created_at timestamptz,
    demo_key varchar,
    sample_image varchar,
    seat_count integer,
    started_count integer,
    submitted_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.id, a.title, a.brief, a.module_key, a.due_at, a.status, a.created_at,
           a.demo_key, a.sample_image,
           (SELECT count(*)::integer FROM public.classroom_student_seats s
             WHERE s.tenant_id = a.tenant_id AND s.classroom_id = a.classroom_id
               AND s.status <> 'removed'),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
             WHERE w.assignment_id = a.id),
           (SELECT count(*)::integer FROM public.classroom_assignment_work w
             WHERE w.assignment_id = a.id AND w.submitted_at IS NOT NULL)
      FROM public.classroom_assignments a
     WHERE a.classroom_id = p_classroom_id
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships m
            WHERE m.account_id = p_account_id
              AND m.classroom_id = p_classroom_id
              AND m.tenant_id = a.tenant_id
              AND m.member_role IN ('owner', 'co_teacher'))
     ORDER BY (a.demo_key IS NOT NULL), a.created_at DESC;
$$;

DROP FUNCTION IF EXISTS classroom_assignments_for_seat(uuid);
CREATE OR REPLACE FUNCTION classroom_assignments_for_seat(p_seat_id uuid)
RETURNS TABLE (
    id uuid,
    title varchar,
    brief varchar,
    module_key varchar,
    due_at timestamptz,
    status varchar,
    sample_image varchar,
    project_id uuid,
    submitted_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.id, a.title, a.brief, a.module_key, a.due_at, a.status, a.sample_image,
           w.project_id, w.submitted_at
      FROM public.classroom_student_seats s
      JOIN public.classroom_assignments a
        ON a.tenant_id = s.tenant_id AND a.classroom_id = s.classroom_id
      LEFT JOIN public.classroom_assignment_work w
        ON w.assignment_id = a.id AND w.seat_id = s.id
     WHERE s.id = p_seat_id
       AND s.status = 'active'
       AND (a.status = 'open' OR w.project_id IS NOT NULL)
     -- Unfinished first: a learner opening this wants what is still to do.
     ORDER BY (w.submitted_at IS NOT NULL), a.created_at;
$$;

REVOKE ALL ON FUNCTION classroom_assignment_list(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignments_for_seat(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_assignment_list(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignments_for_seat(uuid) TO asalab_app;
