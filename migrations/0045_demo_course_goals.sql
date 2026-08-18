-- Goals for the ten shipped tasks.
--
-- 0043 tried to backfill these and matched nothing: it guessed at demo keys
-- ('house', 'castle') when the real ones are prefixed ('demo-house'). So the
-- goal stayed null on every demo task, in every class, and the field that was
-- supposed to say what the work is for said nothing on the ten tasks a teacher
-- actually starts with.
--
-- The goal now lives in the catalogue beside the brief, so a class seeded
-- tomorrow gets it without another backfill.

DROP FUNCTION IF EXISTS classroom_demo_course();
CREATE OR REPLACE FUNCTION classroom_demo_course()
RETURNS TABLE (demo_key varchar, title varchar, goal varchar, brief varchar)
LANGUAGE sql IMMUTABLE AS $$
    SELECT course.demo_key::varchar, course.title::varchar, course.goal::varchar,
           (E'Создайте одну законченную трёхмерную модель по образцу. Полностью копировать образец не нужно: размеры, цвета и пропорции выбирайте сами, но все обязательные элементы должны быть на месте. Сложные округлые детали можно упрощать простыми фигурами.\n\n'
            || course.brief
            || E'\n\nПеред сдачей проверьте: все обязательные элементы на месте; одинаковые детали одного размера; детали соприкасаются там, где соединены; лишних фигур не осталось; модель верно выглядит спереди, сбоку и сверху.')::varchar
      FROM (VALUES
        ('demo-house', 'Домик',
         'Собрать модель из простых фигур и сделать одинаковые детали одинаковыми',
         E'Создайте модель небольшого одноэтажного дома из простых фигур: прямоугольный корпус и крыша сверху.\n\nОбязательные элементы: корпус, двухскатная крыша, входная дверь, четыре одинаковых окна, дымоход, две ступеньки.\n\nТребования: два окна на передней стене и два на боковой; все окна одного размера; окна на одной стене на одинаковой высоте; ступеньки точно перед дверью; дымоход выходит из крыши.'),
        ('demo-snowman', 'Снеговик',
         'Поставить фигуры точно друг над другом и выдержать разные размеры',
         E'Создайте модель снеговика из трёх шаров разного размера.\n\nОбязательные элементы: три шара, два глаза, нос, три пуговицы, две руки, шляпа.\n\nТребования: самый большой шар снизу, средний над ним, самый маленький — голова; шары стоят друг над другом; нос — конус; руки — два одинаковых цилиндра; пуговицы расположены вертикально; шляпа собрана минимум из двух деталей.'),
        ('demo-kettlebell', 'Спортивная гиря',
         'Сделать модель устойчивой и оставить в ней настоящий просвет',
         E'Создайте модель спортивной гири: округлый корпус и ручка сверху.\n\nОбязательные элементы: округлый корпус, плоское основание, ручка, круглая площадка спереди, число 16.\n\nТребования: гиря устойчиво стоит на плоском низе; между корпусом и верхом ручки остаётся свободное пространство; ручку можно собрать из трёх деталей — двух стоек и перекладины; площадка по центру передней части; число 16 на площадке.'),
        ('demo-robot', 'Робот',
         'Держать симметрию: сделать одну руку и скопировать её на другую сторону',
         E'Создайте модель робота из простых фигур: сначала голова и туловище, затем симметричные руки и ноги.\n\nОбязательные элементы: голова, туловище, две руки, две ноги, две ступни, два глаза, три кнопки, антенна.\n\nТребования: голова над центром туловища; сделайте одну руку и скопируйте её для второй стороны, так же с ногами; ступни одинаковые; глаза одного размера и на одной высоте; кнопки на передней стороне; антенна сверху головы. Кисти можно заменить шарами или блоками.'),
        ('demo-car', 'Автомобиль',
         'Выровнять четыре одинаковых колеса по высоте и друг напротив друга',
         E'Создайте модель небольшого легкового автомобиля: сначала кузов и кабина, затем колёса и детали.\n\nОбязательные элементы: кузов, кабина, четыре колеса, переднее стекло, два боковых стекла, две фары, передний и задний бамперы.\n\nТребования: все колёса одинаковые и на одной высоте; передние друг напротив друга, задние тоже; фары одного размера; кабина сверху кузова; стёкла — тонкие плоские детали другого цвета.'),
        ('demo-rocket', 'Ракета',
         'Собрать вертикальную модель и расставить одинаковые детали по кругу',
         E'Создайте модель космической ракеты: корпус — цилиндр, верх — конус.\n\nОбязательные элементы: корпус, носовой конус, два иллюминатора, три стабилизатора, три сопла.\n\nТребования: ракета стоит вертикально; конус точно над корпусом; иллюминаторы одного размера и один над другим; стабилизаторы в нижней части корпуса; сопла под корпусом. Стабилизаторы можно упростить.'),
        ('demo-keyring', 'Именной брелок',
         'Сделать настоящее сквозное отверстие и разместить на детали надпись',
         E'Создайте именной брелок: на плоской основе имя или короткое слово и настоящее сквозное отверстие.\n\nОбязательные элементы: основа, круглое сквозное отверстие, имя или слово, декоративный элемент.\n\nТребования: основа вытянутая; отверстие у края, но между ним и краем остаётся стенка; отверстие проходит основу насквозь; надпись полностью помещается на поверхности; буквы на одной линии. Декоративный элемент — сердце, звезда или другая простая фигура.'),
        ('demo-sailboat', 'Парусный корабль',
         'Собрать вытянутый корпус из нескольких простых деталей',
         E'Создайте модель небольшого парусного корабля.\n\nОбязательные элементы: корпус, верхняя часть корпуса, мачта, большой парус, флаг.\n\nТребования: корпус вытянутый, его можно собрать из двух и более простых деталей; округление корпуса с образца повторять не нужно; мачта вертикальная и нижней частью входит в корпус; парус рядом с мачтой и треугольной формы; флаг в верхней части мачты.'),
        ('demo-plane', 'Самолёт',
         'Скопировать крылья зеркально, чтобы модель была симметричной',
         E'Создайте модель одномоторного самолёта с воздушным винтом. Корпус вытянутый, по бокам одинаковые крылья.\n\nОбязательные элементы: корпус, два основных крыла, кабина, вертикальный хвост, два горизонтальных хвостовых крыла, воздушный винт.\n\nТребования: сделайте одно крыло и скопируйте его на другую сторону, так же с хвостовыми; вертикальный хвост сверху задней части; кабина сверху ближе к носу; винт по центру носовой части, его можно собрать из двух тонких пересекающихся деталей; сверху самолёт симметричен.'),
        ('demo-castle', 'Средневековый замок',
         'Собрать сложную модель из копий: стены, одинаковые башни и двор',
         E'Итоговое задание. Создайте замок с крепостной стеной и внутренним двором — оно объединяет навыки предыдущих моделей.\n\nОбязательные элементы: основание, стена по всему периметру, четыре угловые башни, входные ворота, внутренний двор, главное здание внутри двора, крыша главного здания, зубцы на передней стене, окна или бойницы, флаг.\n\nТребования: стена полностью окружает двор; в каждом углу по башне; башни одного основного размера; в передней стене сквозной проём для ворот; главное здание стоит внутри стены, а не вместо неё, и между ними остаётся двор; сделайте один зубец и используйте копии. Повторять множество мелких зубцов и окон не нужно.')
      ) AS course(demo_key, title, goal, brief);
$$;

-- Every teacher who already has the ten gets the goals on them.
UPDATE teacher_assignments t
   SET goal = course.goal
  FROM classroom_demo_course() AS course
 WHERE t.demo_key = course.demo_key
   AND t.goal IS NULL;

-- And a class seeded from here on gets them written in.
CREATE OR REPLACE FUNCTION classroom_assignments_seed_demo(p_classroom_id uuid)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_author uuid;
    v_owner uuid;
    v_assignment uuid;
    v_added integer := 0;
    v_task record;
BEGIN
    SELECT c.tenant_id, c.created_by INTO v_tenant, v_author
      FROM public.classrooms c WHERE c.id = p_classroom_id AND c.status = 'active';
    IF v_tenant IS NULL THEN RETURN 0; END IF;

    SELECT p.id INTO v_owner
      FROM public.legacy_user_account_links link
      JOIN public.principals p ON p.account_id = link.account_id
     WHERE link.tenant_id = v_tenant
       AND link.user_id = v_author
       AND link.migration_state = 'active'
     LIMIT 1;
    IF v_owner IS NULL THEN RETURN 0; END IF;

    FOR v_task IN SELECT * FROM public.classroom_demo_course() LOOP
        SELECT t.id INTO v_assignment
          FROM public.teacher_assignments t
         WHERE t.owner_principal_id = v_owner AND t.demo_key = v_task.demo_key;

        IF v_assignment IS NULL THEN
            INSERT INTO public.teacher_assignments
                (tenant_id, owner_principal_id, title, brief, goal, module_key,
                 sample_image, demo_key)
            VALUES (v_tenant, v_owner, v_task.title, v_task.brief, v_task.goal, 'three-d',
                    '/assets/assignments/' || v_task.demo_key || '.jpg', v_task.demo_key)
            RETURNING id INTO v_assignment;
        END IF;

        INSERT INTO public.classroom_assignments
            (tenant_id, classroom_id, assignment_id, created_by)
        VALUES (v_tenant, p_classroom_id, v_assignment, v_author)
        ON CONFLICT (classroom_id, assignment_id) DO NOTHING;
        v_added := v_added + 1;
    END LOOP;

    RETURN v_added;
END;
$$;

REVOKE ALL ON FUNCTION classroom_assignments_seed_demo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_assignments_seed_demo(uuid) TO asalab_app;

-- 0043 wrote nothing, but say so rather than leave a wrong-looking backfill in
-- the history: those keys never existed.
