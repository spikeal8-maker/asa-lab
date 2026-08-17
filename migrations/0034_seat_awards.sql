-- Badges a teacher gives a learner.
--
-- A verdict on one piece of work says whether that model was any good. This is
-- a different thing: it is about the person, it lasts, and it is the reason a
-- child opens the app again on a Saturday. "Помог соседу" is not a mark for a
-- model — it is a fact about who somebody is in that class, and there was
-- nowhere to record it.
--
-- The vocabulary is fixed, and deliberately small. Every badge has to mean the
-- same thing in every class or it means nothing across them, and a teacher
-- choosing from eight in a lesson will actually give them, where a teacher
-- composing one will not. They are also all positive: this is a place to notice
-- children doing well, and a database of who was careless would be a different
-- product with different obligations.
--
-- One of each per learner. A badge given twice is not twice as true, and a
-- teacher who gives it again means "still", which is what the timestamp says.

CREATE TABLE IF NOT EXISTS classroom_seat_awards (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants(id),
    seat_id      uuid NOT NULL REFERENCES classroom_student_seats(id),
    award_key    varchar(32) NOT NULL
                 CHECK (award_key IN (
                     'first-model',      -- первая работа
                     'bright-idea',      -- своя идея
                     'careful-work',     -- аккуратность
                     'precision',        -- точность
                     'perseverance',     -- довёл до конца
                     'helper',           -- помог другим
                     'explorer',         -- пробует новое
                     'editors-choice'    -- выбор преподавателя
                 )),
    -- A note in the teacher's own words: "за мост, который выдержал книгу".
    -- What makes a badge land is the reason, not the icon.
    note         varchar(280),
    awarded_by   uuid NOT NULL REFERENCES principals(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (seat_id, award_key)
);
CREATE INDEX IF NOT EXISTS classroom_seat_awards_seat_idx
    ON classroom_seat_awards (tenant_id, seat_id, created_at DESC);

GRANT SELECT ON classroom_seat_awards TO asalab_app;

ALTER TABLE classroom_seat_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_seat_awards FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS classroom_seat_awards_tenant ON classroom_seat_awards;
CREATE POLICY classroom_seat_awards_tenant ON classroom_seat_awards
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Giving one, and taking it back. Both belong to a teacher of that learner's
-- class; the check lives here so no caller can leave it out.
CREATE OR REPLACE FUNCTION classroom_seat_award_set(
    p_principal_id uuid,
    p_seat_id      uuid,
    p_award_key    varchar,
    p_note         varchar,
    p_granted      boolean
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_tenant uuid;
BEGIN
    SELECT s.tenant_id INTO v_tenant
      FROM public.teacher_seat_scope(p_principal_id) scope
      JOIN public.classroom_student_seats s ON s.id = scope.seat_id
     WHERE scope.seat_id = p_seat_id;
    IF v_tenant IS NULL THEN RETURN false; END IF;

    IF p_granted THEN
        INSERT INTO public.classroom_seat_awards
            (tenant_id, seat_id, award_key, note, awarded_by)
        VALUES (v_tenant, p_seat_id, p_award_key, NULLIF(trim(p_note), ''), p_principal_id)
        ON CONFLICT (seat_id, award_key) DO UPDATE
           SET note = EXCLUDED.note,
               awarded_by = EXCLUDED.awarded_by,
               created_at = now();
    ELSE
        DELETE FROM public.classroom_seat_awards a
         WHERE a.seat_id = p_seat_id AND a.award_key = p_award_key;
    END IF;
    RETURN true;
END;
$$;

-- What a learner has been given. Readable by their teachers and by the learner
-- themselves, which is the whole point: a badge nobody sees is a row.
CREATE OR REPLACE FUNCTION classroom_seat_awards_list(p_seat_id uuid)
RETURNS TABLE (
    award_key varchar,
    note varchar,
    created_at timestamptz,
    awarded_by_display_name varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.award_key, a.note, a.created_at,
           COALESCE(profile.display_name, 'Педагог')
      FROM public.classroom_seat_awards a
      JOIN public.principals author ON author.id = a.awarded_by
      LEFT JOIN public.profiles profile ON profile.account_id = author.account_id
     WHERE a.seat_id = p_seat_id
     ORDER BY a.created_at DESC;
$$;

-- The badge count for every learner in a class, so the register can show them
-- without asking thirty separate questions.
CREATE OR REPLACE FUNCTION classroom_seat_award_keys(
    p_account_id   uuid,
    p_classroom_id uuid
)
RETURNS TABLE (seat_id uuid, award_key varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.seat_id, a.award_key
      FROM public.classroom_seat_awards a
      JOIN public.classroom_student_seats s ON s.id = a.seat_id
     WHERE s.classroom_id = p_classroom_id
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships m
            WHERE m.account_id = p_account_id
              AND m.classroom_id = p_classroom_id
              AND m.tenant_id = s.tenant_id
              AND m.member_role IN ('owner', 'co_teacher'))
     ORDER BY a.created_at;
$$;

REVOKE ALL ON FUNCTION classroom_seat_award_set(uuid, uuid, varchar, varchar, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_seat_awards_list(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_seat_award_keys(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION classroom_seat_award_set(uuid, uuid, varchar, varchar, boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_seat_awards_list(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_seat_award_keys(uuid, uuid) TO asalab_app;
