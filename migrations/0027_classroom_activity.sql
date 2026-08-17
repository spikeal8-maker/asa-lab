-- What happened in a class, and who may look at a learner's work.
--
-- Two owner decisions are written down here. A teacher opens and edits the work
-- of the learners in their own class, the way the reference product does. And
-- the class keeps a record of what its learners did — sign-ins included — so a
-- teacher can see how someone is getting on rather than only what they finished.
--
-- Both are deliberately narrow. The access rule reaches exactly the personal
-- projects of seats in classes the teacher runs, and nothing else. The record
-- is per class, so leaving a class ends the trail rather than following the
-- child around the product.

CREATE TABLE IF NOT EXISTS classroom_activity_events (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          uuid NOT NULL REFERENCES tenants(id),
    classroom_id       uuid NOT NULL,
    -- Null when a teacher acted; a learner is always a seat.
    seat_id            uuid REFERENCES classroom_student_seats(id),
    actor_principal_id uuid NOT NULL REFERENCES principals(id),
    action             varchar(48) NOT NULL,
    project_id         uuid,
    project_title      varchar(255),
    -- Repeated work on one project inside a short window is one line with a
    -- count, not a hundred identical lines. Saving is continuous — an editor
    -- autosaves while a learner thinks — and a feed that records each one
    -- answers "what did they do" with noise. The count keeps the detail.
    occurrence_count   integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
    first_occurred_at  timestamptz NOT NULL DEFAULT now(),
    occurred_at        timestamptz NOT NULL DEFAULT now(),
    payload_json       jsonb NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS classroom_activity_feed_idx
    ON classroom_activity_events (tenant_id, classroom_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS classroom_activity_seat_idx
    ON classroom_activity_events (tenant_id, seat_id, occurred_at DESC)
    WHERE seat_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON classroom_activity_events TO asalab_app;

ALTER TABLE classroom_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_activity_events FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS classroom_activity_events_tenant ON classroom_activity_events;
CREATE POLICY classroom_activity_events_tenant ON classroom_activity_events
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Records an event, folding it into the most recent matching one when that is
-- still inside the window. Returns the row that now represents it.
CREATE OR REPLACE FUNCTION classroom_activity_record(
    p_tenant_id     uuid,
    p_classroom_id  uuid,
    p_seat_id       uuid,
    p_principal_id  uuid,
    p_action        varchar,
    p_project_id    uuid,
    p_project_title varchar,
    p_window        interval DEFAULT interval '10 minutes'
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_id uuid;
BEGIN
    UPDATE public.classroom_activity_events
       SET occurrence_count = occurrence_count + 1,
           occurred_at = now(),
           project_title = COALESCE(p_project_title, project_title)
     WHERE tenant_id = p_tenant_id
       AND classroom_id = p_classroom_id
       AND actor_principal_id = p_principal_id
       AND action = p_action
       AND project_id IS NOT DISTINCT FROM p_project_id
       AND occurred_at > now() - p_window
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        INSERT INTO public.classroom_activity_events
            (tenant_id, classroom_id, seat_id, actor_principal_id, action,
             project_id, project_title)
        VALUES (p_tenant_id, p_classroom_id, p_seat_id, p_principal_id, p_action,
                p_project_id, p_project_title)
        RETURNING id INTO v_id;
    END IF;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION classroom_activity_record(uuid, uuid, uuid, uuid, varchar, uuid, varchar, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_activity_record(uuid, uuid, uuid, uuid, varchar, uuid, varchar, interval) TO asalab_app;

-- The classes a principal teaches, and the seats inside them. Both the project
-- access rule and the activity feed ask the same question, so it is answered in
-- one place.
CREATE OR REPLACE FUNCTION teacher_seat_scope(p_principal_id uuid)
RETURNS TABLE (classroom_id uuid, seat_principal_id uuid, seat_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT membership.classroom_id, seat_principal.id, seat.id
      FROM public.principals teacher
      JOIN public.classroom_memberships membership
        ON membership.account_id = teacher.account_id
       AND membership.member_role IN ('owner', 'co_teacher')
      JOIN public.classroom_student_seats seat
        ON seat.tenant_id = membership.tenant_id
       AND seat.classroom_id = membership.classroom_id
      JOIN public.principals seat_principal
        ON seat_principal.seat_id = seat.id
     WHERE teacher.id = p_principal_id
       AND teacher.account_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION teacher_seat_scope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION teacher_seat_scope(uuid) TO asalab_app;

-- Project access, extended with the owner's decision: a teacher reaches the
-- personal projects of the learners in their own classes.
--
-- This is 0023's definition with one branch added. 0023 widened the classroom
-- branch to every member of a class rather than only its teachers, and that
-- must be carried forward: rewriting from 0022 would silently take shared class
-- projects away from the learners who work in them.
CREATE OR REPLACE FUNCTION project_context_for_principal(
    p_principal_id uuid,
    p_project_id uuid
)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT project.tenant_id,
           CASE
             WHEN project.project_scope = 'classroom' THEN membership.user_id
             ELSE legacy_link.user_id
           END
      FROM public.principals principal
      JOIN public.projects project ON project.id = p_project_id
      LEFT JOIN public.classroom_memberships membership
        ON membership.tenant_id = project.tenant_id
       AND membership.classroom_id = project.classroom_id
       AND membership.account_id = principal.account_id
      LEFT JOIN public.legacy_user_account_links legacy_link
        ON legacy_link.tenant_id = project.tenant_id
       AND legacy_link.account_id = principal.account_id
       AND legacy_link.migration_state = 'active'
     WHERE principal.id = p_principal_id
       AND (
         (project.project_scope = 'personal'
          AND project.owner_principal_id = p_principal_id)
         OR
         (project.project_scope = 'classroom' AND membership.user_id IS NOT NULL)
         OR
         (project.project_scope = 'personal'
          AND project.owner_principal_id IN (
                SELECT scope.seat_principal_id FROM public.teacher_seat_scope(p_principal_id) scope))
       )
     LIMIT 1;
$$;
