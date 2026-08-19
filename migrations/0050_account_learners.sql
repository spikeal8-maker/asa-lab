-- Взрослые, студенты и преподаватели тоже учатся.
--
-- До сих пор в класс можно было попасть только местом без аккаунта: код класса
-- плюс выданный логин. Это правильно для ребёнка, у которого аккаунта нет и не
-- должно быть, и совершенно не годится для взрослого, который уже вошёл в
-- продукт под собой: заводить ему второй вход и вторую полку работ бессмысленно.
--
-- Поэтому место в классе остаётся тем же самым, но у него появляется хозяин.
-- Человек с аккаунтом занимает место и работает под собой. Всё, что построено
-- на местах — задания, сдача, значки, отклики — продолжает работать без единой
-- ветки «а если это взрослый».
--
-- Одно различие есть, и оно важное: у ребёнка место и есть вся его работа, она
-- живёт внутри класса. У взрослого своя полка проектов, которая была до класса
-- и останется после, и школе она не принадлежит. Поэтому преподаватель видит у
-- него только то, что сделано по заданиям этого класса.

ALTER TABLE classroom_student_seats
    ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id);

-- Один аккаунт — одно место в классе.
CREATE UNIQUE INDEX IF NOT EXISTS classroom_student_seats_account_idx
    ON classroom_student_seats (classroom_id, account_id)
    WHERE account_id IS NOT NULL;

/**
 * Занять место в классе по коду, будучи собой.
 *
 * Возвращает место:уже занятое им, если человек уже в этом классе, или новое. Логин
 * такому месту не нужен — вход происходит через аккаунт, — но поле обязательное,
 * поэтому оно заполняется значением, которым войти нельзя.
 */
CREATE OR REPLACE FUNCTION classroom_join_with_account(
    p_account_id uuid,
    p_code_hash  varchar
)
RETURNS TABLE (seat_id uuid, classroom_id uuid, classroom_title varchar, already_member boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_classroom uuid;
    v_title varchar;
    v_seat uuid;
    v_label varchar;
    v_owner_user uuid;
    v_handle varchar;
    v_existing boolean := false;
BEGIN
    SELECT c.tenant_id, c.id, c.title
      INTO v_tenant, v_classroom, v_title
      FROM public.classroom_join_codes code
      JOIN public.classrooms c
        ON c.tenant_id = code.tenant_id AND c.id = code.classroom_id
     WHERE code.token_hash = p_code_hash
       AND code.status = 'active'
       AND c.status = 'active'
     LIMIT 1;
    IF v_classroom IS NULL THEN RETURN; END IF;

    -- Преподаватель этого же класса учеником в нём быть не может.
    IF EXISTS (
        SELECT 1 FROM public.classroom_memberships m
         WHERE m.classroom_id = v_classroom
           AND m.account_id = p_account_id
           AND m.member_role IN ('owner', 'co_teacher')
    ) THEN
        RETURN;
    END IF;

    SELECT s.id INTO v_seat
      FROM public.classroom_student_seats s
     WHERE s.classroom_id = v_classroom AND s.account_id = p_account_id;

    IF v_seat IS NOT NULL THEN
        v_existing := true;
        -- Вернувшемуся вход открывается снова.
        UPDATE public.classroom_student_seats s
           SET status = 'active', updated_at = now()
         WHERE s.id = v_seat AND s.status <> 'active';
    ELSE
        SELECT COALESCE(NULLIF(trim(p.display_name), ''), 'Участник')
          INTO v_label
          FROM public.profiles p
         WHERE p.account_id = p_account_id;

        -- Логин у такого места есть только потому, что поле обязательное. Войти
        -- по нему нельзя: двоеточие не проходит проверку имени для входа, а сам
        -- человек входит своим аккаунтом. Помещается в 32 символа колонки.
        v_handle := 'acc:' || left(replace(p_account_id::text, '-', ''), 20);

        -- Место числится за владельцем класса, как и выданное вручную.
        SELECT m.user_id INTO v_owner_user
          FROM public.classroom_memberships m
         WHERE m.classroom_id = v_classroom AND m.member_role = 'owner'
         LIMIT 1;

        INSERT INTO public.classroom_student_seats
            (tenant_id, classroom_id, display_label, login_handle,
             normalized_login_handle, safe_mode, status, created_by, account_id)
        VALUES (v_tenant, v_classroom, COALESCE(v_label, 'Участник'),
                v_handle, v_handle,
                false, 'active', v_owner_user, p_account_id)
        RETURNING id INTO v_seat;

        -- Место — это principal, как и у ребёнка: на нём висят задания и значки.
        INSERT INTO public.principals (kind, seat_id)
        VALUES ('student_seat', v_seat);
    END IF;

    /*
     * Строка членства заводится только для человека из того же арендатора, что
     * и класс: она требует пользователя этого арендатора, а взрослый обычно
     * приходит из своего. Ничего не теряется — человека с классом связывает
     * место, и всё, что построено на местах, работает от него. Членство здесь
     * остаётся понятием преподавательской стороны.
     */
    IF NOT EXISTS (
        SELECT 1 FROM public.classroom_memberships m
         WHERE m.classroom_id = v_classroom AND m.account_id = p_account_id
    ) THEN
        INSERT INTO public.classroom_memberships
            (tenant_id, classroom_id, user_id, account_id, member_role)
        SELECT v_tenant, v_classroom, link.user_id, p_account_id, 'student'
          FROM public.legacy_user_account_links link
         WHERE link.account_id = p_account_id
           AND link.migration_state = 'active'
           AND link.tenant_id = v_tenant
         LIMIT 1;
    END IF;

    RETURN QUERY SELECT v_seat, v_classroom, v_title, v_existing;
END;
$$;

/** Классы, в которых этот аккаунт учится, и место в каждом. */
CREATE OR REPLACE FUNCTION classroom_account_seats(p_account_id uuid)
RETURNS TABLE (
    seat_id uuid,
    classroom_id uuid,
    classroom_title varchar,
    teacher_display_name varchar,
    open_count integer,
    unfinished_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.id, c.id, c.title,
           COALESCE(owner_profile.display_name, 'Преподаватель')::varchar,
           counts.open_count, counts.unfinished_count
      FROM public.classroom_student_seats s
      JOIN public.classrooms c ON c.id = s.classroom_id
      LEFT JOIN LATERAL (
          SELECT p.display_name
            FROM public.classroom_memberships m
            JOIN public.profiles p ON p.account_id = m.account_id
           WHERE m.classroom_id = c.id AND m.member_role = 'owner'
           LIMIT 1
      ) owner_profile ON true
      LEFT JOIN LATERAL public.classroom_seat_assignment_counts(s.id) counts ON true
     WHERE s.account_id = p_account_id
       AND s.status = 'active'
       AND c.status = 'active'
     ORDER BY c.title;
$$;

/** Задания по всем классам, где этот аккаунт учится. */
CREATE OR REPLACE FUNCTION classroom_assignments_for_account(p_account_id uuid)
RETURNS TABLE (
    id uuid,
    seat_id uuid,
    classroom_title varchar,
    title varchar,
    brief varchar,
    goal varchar,
    module_key varchar,
    due_at timestamptz,
    status varchar,
    sample_image varchar,
    project_id uuid,
    submitted_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT work.id, s.id, c.title, work.title, work.brief, work.goal, work.module_key,
           work.due_at, work.status, work.sample_image, work.project_id, work.submitted_at
      FROM public.classroom_student_seats s
      JOIN public.classrooms c ON c.id = s.classroom_id
      CROSS JOIN LATERAL public.classroom_assignments_for_seat(s.id) work
     WHERE s.account_id = p_account_id
       AND s.status = 'active'
       AND c.status = 'active';
$$;

/**
 * Работы ученика глазами преподавателя.
 *
 * У ребёнка место и есть вся его работа: она сделана в классе и там живёт.
 * У взрослого своя полка, которая школе не принадлежит, поэтому от него виден
 * ровно тот набор работ, что сделан по заданиям этого класса, — и ни одной
 * личной работы сверх того.
 */
DROP FUNCTION IF EXISTS classroom_seat_projects(uuid, uuid);
CREATE OR REPLACE FUNCTION classroom_seat_projects(
    p_principal_id uuid,
    p_seat_id      uuid
)
RETURNS TABLE (
    id uuid,
    module_key varchar,
    title varchar,
    status varchar,
    created_at timestamptz,
    updated_at timestamptz,
    snapshot_revision integer,
    preview_json jsonb,
    preview_digest varchar,
    last_editor_was_teacher boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH scope AS (
        SELECT s.seat_id, s.seat_principal_id, seat.account_id
          FROM public.teacher_seat_scope(p_principal_id) s
          JOIN public.classroom_student_seats seat ON seat.id = s.seat_id
         WHERE s.seat_id = p_seat_id
    ),
    visible AS (
        -- Место без аккаунта: всё, что на нём сделано.
        SELECT project.id
          FROM scope
          JOIN public.projects project
            ON project.owner_principal_id = scope.seat_principal_id
         WHERE scope.account_id IS NULL
           AND project.project_scope = 'personal'
        UNION
        -- Место взрослого: только работы по заданиям этого класса.
        SELECT work.project_id
          FROM scope
          JOIN public.classroom_assignment_work work ON work.seat_id = scope.seat_id
         WHERE scope.account_id IS NOT NULL
           AND work.project_id IS NOT NULL
    )
    SELECT project.id, project.module_key, project.title, project.status,
           project.created_at, draft.updated_at, snapshot.source_revision,
           draft.preview_json, draft.preview_digest,
           editor.account_id IS NOT NULL
      FROM visible
      JOIN public.projects project ON project.id = visible.id
      JOIN public.project_drafts draft
        ON draft.tenant_id = project.tenant_id AND draft.project_id = project.id
      LEFT JOIN public.project_snapshots snapshot
        ON snapshot.tenant_id = project.tenant_id AND snapshot.project_id = project.id
      LEFT JOIN public.principals editor ON editor.id = draft.updated_by_principal_id
     ORDER BY draft.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION classroom_join_with_account(uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_account_seats(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignments_for_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_seat_projects(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_join_with_account(uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_account_seats(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignments_for_account(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_seat_projects(uuid, uuid) TO asalab_app;

/**
 * Чья это работа.
 *
 * У ребёнка проект принадлежит его месту. У взрослого — его собственному
 * аккаунту: работа лежит на его полке, была там до класса и останется после.
 * Проверка «работа должна быть своей» остаётся, но своей она может быть двумя
 * способами.
 */
CREATE OR REPLACE FUNCTION classroom_assignment_work_start(
    p_seat_id       uuid,
    p_assignment_id uuid,
    p_project_id    uuid
)
RETURNS TABLE (project_id uuid, submitted_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_owner uuid;
    v_seat_principal uuid;
    v_seat_account uuid;
    v_account_principal uuid;
BEGIN
    SELECT s.tenant_id, s.account_id INTO v_tenant, v_seat_account
      FROM public.classroom_student_seats s
      JOIN public.classroom_assignments a
        ON a.tenant_id = s.tenant_id AND a.classroom_id = s.classroom_id
     WHERE s.id = p_seat_id AND s.status = 'active'
       AND a.id = p_assignment_id AND a.status = 'open';
    IF v_tenant IS NULL THEN RETURN; END IF;

    SELECT principal.id INTO v_seat_principal
      FROM public.principals principal WHERE principal.seat_id = p_seat_id;

    IF v_seat_account IS NOT NULL THEN
        SELECT principal.id INTO v_account_principal
          FROM public.principals principal
         WHERE principal.account_id = v_seat_account AND principal.kind = 'account';
    END IF;

    SELECT project.owner_principal_id INTO v_owner
      FROM public.projects project WHERE project.id = p_project_id;
    IF v_owner IS NULL
       OR (v_owner <> v_seat_principal
           AND (v_account_principal IS NULL OR v_owner <> v_account_principal)) THEN
        RETURN;
    END IF;

    INSERT INTO public.classroom_assignment_work
        (tenant_id, assignment_id, seat_id, project_id)
    VALUES (v_tenant, p_assignment_id, p_seat_id, p_project_id)
    ON CONFLICT (assignment_id, seat_id) DO NOTHING;

    RETURN QUERY
    SELECT w.project_id, w.submitted_at
      FROM public.classroom_assignment_work w
     WHERE w.assignment_id = p_assignment_id AND w.seat_id = p_seat_id;
END;
$$;

REVOKE ALL ON FUNCTION classroom_assignment_work_start(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_assignment_work_start(uuid, uuid, uuid) TO asalab_app;

-- Работа по заданию может лежать в другом арендаторе.
--
-- Строка работы принадлежит классу и потому несёт его арендатора. У ребёнка
-- проект лежит там же, и составная связь (арендатор, проект) была верна. У
-- взрослого проект лежит на его собственной полке, в его арендаторе, — и та же
-- связь становится невыполнимой: класс в одном месте, работа в другом.
--
-- Поэтому связь с проектом теперь по самому проекту. Существование работы
-- по-прежнему гарантировано, а её принадлежность проверяет
-- classroom_assignment_work_start: чужую работу к заданию не привяжешь.
ALTER TABLE classroom_assignment_work
    DROP CONSTRAINT IF EXISTS classroom_assignment_work_tenant_id_project_id_fkey;

ALTER TABLE classroom_assignment_work
    DROP CONSTRAINT IF EXISTS classroom_assignment_work_project_fkey;
ALTER TABLE classroom_assignment_work
    ADD CONSTRAINT classroom_assignment_work_project_fkey
    FOREIGN KEY (project_id) REFERENCES projects (id);

/**
 * Место, с которого этот аккаунт работает над этим заданием.
 *
 * Отдельная функция, а не запрос из приложения: таблицы мест закрыты политикой
 * арендатора, и обычное чтение из веб-процесса об неё спотыкается. Все такие
 * переходы в этом продукте идут через функции, и этот — не исключение.
 */
CREATE OR REPLACE FUNCTION classroom_seat_for_account_assignment(
    p_account_id    uuid,
    p_assignment_id uuid
)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.id
      FROM public.classroom_assignments h
      JOIN public.classroom_student_seats s
        ON s.classroom_id = h.classroom_id AND s.account_id = p_account_id
     WHERE h.id = p_assignment_id AND s.status = 'active'
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION classroom_seat_for_account_assignment(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_seat_for_account_assignment(uuid, uuid) TO asalab_app;

/**
 * Отклик преподавателя на работу взрослого ученика.
 *
 * Право отвечать проверялось так: работа должна принадлежать месту в классе,
 * который ведёт этот преподаватель. У взрослого работа принадлежит его аккаунту,
 * поэтому отклик на неё не проходил — сдать можно, ответить нельзя.
 *
 * Теперь право даёт ещё и сама сдача: работа, привязанная к заданию класса,
 * доступна преподавателю этого класса. Личные работы взрослого этим правом не
 * задеты — они ни к какому заданию не привязаны.
 */
CREATE OR REPLACE FUNCTION project_feedback_save(
    p_principal_id uuid,
    p_project_id   uuid,
    p_badge        varchar,
    p_comment      varchar
)
RETURNS TABLE (
    badge varchar,
    comment varchar,
    updated_at timestamptz,
    author_display_name varchar
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_owner  uuid;
    v_seat   uuid;
BEGIN
    SELECT project.tenant_id, project.owner_principal_id
      INTO v_tenant, v_owner
      FROM public.projects project
     WHERE project.id = p_project_id;
    IF v_tenant IS NULL THEN RETURN; END IF;

    -- Работа ребёнка: она сделана на месте в классе преподавателя.
    SELECT scope.seat_id INTO v_seat
      FROM public.teacher_seat_scope(p_principal_id) scope
     WHERE scope.seat_principal_id = v_owner;

    -- Работа взрослого: она сдана по заданию класса, который он ведёт.
    IF v_seat IS NULL THEN
        SELECT work.seat_id INTO v_seat
          FROM public.classroom_assignment_work work
          JOIN public.classroom_assignments h ON h.id = work.assignment_id
          JOIN public.classroom_memberships m
            ON m.classroom_id = h.classroom_id
           AND m.member_role IN ('owner', 'co_teacher')
          JOIN public.principals teacher ON teacher.account_id = m.account_id
         WHERE work.project_id = p_project_id
           AND teacher.id = p_principal_id
         LIMIT 1;
    END IF;

    IF v_seat IS NULL THEN RETURN; END IF;

    -- Отклик живёт в арендаторе класса: он принадлежит уроку, а не полке автора.
    SELECT s.tenant_id INTO v_tenant
      FROM public.classroom_student_seats s WHERE s.id = v_seat;

    INSERT INTO public.project_feedback
        (tenant_id, project_id, seat_id, author_principal_id, badge, comment)
    VALUES (v_tenant, p_project_id, v_seat, p_principal_id, p_badge, NULLIF(trim(p_comment), ''))
    ON CONFLICT (project_id, author_principal_id) DO UPDATE
       SET badge = EXCLUDED.badge,
           comment = EXCLUDED.comment,
           updated_at = now();

    RETURN QUERY
    SELECT feedback.badge, feedback.comment, feedback.updated_at, profile.display_name
      FROM public.project_feedback feedback
      JOIN public.principals author ON author.id = feedback.author_principal_id
      LEFT JOIN public.profiles profile ON profile.account_id = author.account_id
     WHERE feedback.project_id = p_project_id
       AND feedback.author_principal_id = p_principal_id;
END;
$$;

REVOKE ALL ON FUNCTION project_feedback_save(uuid, uuid, varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_feedback_save(uuid, uuid, varchar, varchar) TO asalab_app;

-- Отклик тоже может относиться к работе из другого арендатора: см. выше про
-- строку работы. Связь с проектом — по самому проекту, а не по паре
-- «арендатор + проект», иначе отклик на работу взрослого невозможен в принципе.
ALTER TABLE project_feedback
    DROP CONSTRAINT IF EXISTS project_feedback_tenant_id_project_id_fkey;

ALTER TABLE project_feedback DROP CONSTRAINT IF EXISTS project_feedback_project_fkey;
ALTER TABLE project_feedback
    ADD CONSTRAINT project_feedback_project_fkey
    FOREIGN KEY (project_id) REFERENCES projects (id);
