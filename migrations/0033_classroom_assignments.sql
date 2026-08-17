-- Work a teacher sets, and what each learner did with it.
--
-- The class page has had an "Actions" tab holding a paragraph of text since it
-- was built. This is the thing it was a placeholder for: a teacher writes what
-- to make, every learner gets their own copy to make it in, and the teacher can
-- see at a glance who has started, who has finished, and who has not opened it.
--
-- Two facts are kept about each learner's work, not one, because a class asks
-- two different questions. "Has anyone started?" is answered by the work
-- existing at all, and it answers itself — a learner who opens the assignment
-- has started it, and nothing needs pressing. "Is this ready to be marked?" is
-- a decision, and a decision needs an act: the learner presses Сдать. Deriving
-- the second from the first would mark a child's first two shapes as finished
-- work; requiring the first to be pressed would leave a teacher unable to see
-- who is stuck.
--
-- A submission is not a lock. A learner may keep working afterwards and submit
-- again — the timestamp moves, the work is theirs. Freezing a child out of
-- their own model to protect a deadline is a thing school software does and
-- should not.

CREATE TABLE IF NOT EXISTS classroom_assignments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants(id),
    classroom_id uuid NOT NULL,
    title        varchar(255) NOT NULL,
    -- What to do, in the teacher's own words. Optional: a title is often the
    -- whole brief when the lesson has just been explained out loud.
    brief        varchar(4000),
    -- Which environment the work is made in, so a learner opening it lands in
    -- the right editor rather than choosing from a menu they cannot judge.
    module_key   varchar(64) NOT NULL,
    due_at       timestamptz,
    status       varchar(16) NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'closed')),
    created_by   uuid NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms (tenant_id, id),
    FOREIGN KEY (tenant_id, created_by) REFERENCES users (tenant_id, id),
    CONSTRAINT classroom_assignments_title_check CHECK (length(trim(title)) > 0)
);
CREATE INDEX IF NOT EXISTS classroom_assignments_class_idx
    ON classroom_assignments (tenant_id, classroom_id, created_at DESC);

-- One learner's copy of one assignment. The project is theirs — the same kind
-- of personal project they make on their own — so everything already built for
-- a learner's work applies without a second path: previews, snapshots, the
-- class record, and a teacher's response.
CREATE TABLE IF NOT EXISTS classroom_assignment_work (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants(id),
    assignment_id uuid NOT NULL,
    seat_id       uuid NOT NULL REFERENCES classroom_student_seats(id),
    project_id    uuid NOT NULL,
    started_at    timestamptz NOT NULL DEFAULT now(),
    submitted_at  timestamptz,
    UNIQUE (assignment_id, seat_id),
    UNIQUE (project_id),
    FOREIGN KEY (tenant_id, assignment_id) REFERENCES classroom_assignments (tenant_id, id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS classroom_assignment_work_assignment_idx
    ON classroom_assignment_work (tenant_id, assignment_id);

GRANT SELECT ON classroom_assignments TO asalab_app;
GRANT SELECT ON classroom_assignment_work TO asalab_app;

ALTER TABLE classroom_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_assignments FORCE  ROW LEVEL SECURITY;
ALTER TABLE classroom_assignment_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_assignment_work FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS classroom_assignments_tenant ON classroom_assignments;
CREATE POLICY classroom_assignments_tenant ON classroom_assignments
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS classroom_assignment_work_tenant ON classroom_assignment_work;
CREATE POLICY classroom_assignment_work_tenant ON classroom_assignment_work
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── The teacher's side ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION classroom_assignment_create(
    p_account_id   uuid,
    p_classroom_id uuid,
    p_title        varchar,
    p_brief        varchar,
    p_module_key   varchar,
    p_due_at       timestamptz
)
RETURNS TABLE (
    id uuid, title varchar, brief varchar, module_key varchar,
    due_at timestamptz, status varchar, created_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_access record; v_id uuid;
BEGIN
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
    INSERT INTO public.classroom_assignments
        (tenant_id, classroom_id, title, brief, module_key, due_at, created_by)
    VALUES (v_access.tenant_id, p_classroom_id, trim(p_title), NULLIF(trim(p_brief), ''),
            p_module_key, p_due_at, v_access.user_id)
    RETURNING classroom_assignments.id INTO v_id;
    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_access.tenant_id, v_access.user_id, 'classroom_assignment', v_id,
         'classroom.assignment_created',
         jsonb_build_object('classroomId', p_classroom_id, 'moduleKey', p_module_key));
    RETURN QUERY
    SELECT a.id, a.title, a.brief, a.module_key, a.due_at, a.status, a.created_at
      FROM public.classroom_assignments a WHERE a.id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_assignment_set_status(
    p_account_id   uuid,
    p_classroom_id uuid,
    p_assignment_id uuid,
    p_status       varchar
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_access record; v_updated integer := 0;
BEGIN
    IF p_status NOT IN ('open', 'closed') THEN RAISE EXCEPTION 'unknown assignment status'; END IF;
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
    UPDATE public.classroom_assignments a
       SET status = p_status, updated_at = now()
     WHERE a.tenant_id = v_access.tenant_id
       AND a.classroom_id = p_classroom_id
       AND a.id = p_assignment_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

-- The assignments of a class with, for each, how the class is getting on.
-- Counted here rather than in the client so a teacher with six assignments and
-- thirty learners reads one answer instead of a hundred and eighty.
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
    seat_count integer,
    started_count integer,
    submitted_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.id, a.title, a.brief, a.module_key, a.due_at, a.status, a.created_at,
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
     ORDER BY a.created_at DESC;
$$;

-- Every learner in the class against one assignment, including the ones who
-- have not opened it — the row that is missing is the one a teacher needs.
CREATE OR REPLACE FUNCTION classroom_assignment_progress(
    p_account_id    uuid,
    p_classroom_id  uuid,
    p_assignment_id uuid
)
RETURNS TABLE (
    seat_id uuid,
    display_label varchar,
    avatar_key varchar,
    project_id uuid,
    started_at timestamptz,
    submitted_at timestamptz,
    badge varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT s.id, s.display_label, s.avatar_key,
           w.project_id, w.started_at, w.submitted_at, feedback.badge
      FROM public.classroom_student_seats s
      LEFT JOIN public.classroom_assignment_work w
        ON w.seat_id = s.id AND w.assignment_id = p_assignment_id
      LEFT JOIN public.project_feedback feedback
        ON feedback.project_id = w.project_id
     WHERE s.classroom_id = p_classroom_id
       AND s.status <> 'removed'
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships m
            WHERE m.account_id = p_account_id
              AND m.classroom_id = p_classroom_id
              AND m.tenant_id = s.tenant_id
              AND m.member_role IN ('owner', 'co_teacher'))
     ORDER BY lower(s.display_label), s.id;
$$;

-- ── The learner's side ──────────────────────────────────────────────────────

-- What has been set for this seat, and what they have done about it. Closed
-- assignments still appear if the learner has work in them: a class moving on
-- should not delete what a child made.
CREATE OR REPLACE FUNCTION classroom_assignments_for_seat(p_seat_id uuid)
RETURNS TABLE (
    id uuid,
    title varchar,
    brief varchar,
    module_key varchar,
    due_at timestamptz,
    status varchar,
    project_id uuid,
    submitted_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.id, a.title, a.brief, a.module_key, a.due_at, a.status,
           w.project_id, w.submitted_at
      FROM public.classroom_student_seats s
      JOIN public.classroom_assignments a
        ON a.tenant_id = s.tenant_id AND a.classroom_id = s.classroom_id
      LEFT JOIN public.classroom_assignment_work w
        ON w.assignment_id = a.id AND w.seat_id = s.id
     WHERE s.id = p_seat_id
       AND s.status = 'active'
       AND (a.status = 'open' OR w.project_id IS NOT NULL)
     ORDER BY a.created_at DESC;
$$;

-- Claims a project as this learner's copy of an assignment. The project is
-- created through the ordinary route first, so module validation, idempotency
-- and everything else a project gets are not reimplemented here; this only
-- records that the two belong together, and only for the learner's own work.
CREATE OR REPLACE FUNCTION classroom_assignment_work_start(
    p_seat_id       uuid,
    p_assignment_id uuid,
    p_project_id    uuid
)
RETURNS TABLE (project_id uuid, submitted_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_tenant uuid; v_owner uuid; v_seat_principal uuid;
BEGIN
    SELECT s.tenant_id INTO v_tenant
      FROM public.classroom_student_seats s
      JOIN public.classroom_assignments a
        ON a.tenant_id = s.tenant_id AND a.classroom_id = s.classroom_id
     WHERE s.id = p_seat_id AND s.status = 'active'
       AND a.id = p_assignment_id AND a.status = 'open';
    IF v_tenant IS NULL THEN RETURN; END IF;

    SELECT principal.id INTO v_seat_principal
      FROM public.principals principal WHERE principal.seat_id = p_seat_id;
    SELECT project.owner_principal_id INTO v_owner
      FROM public.projects project WHERE project.id = p_project_id;
    -- The work being claimed must be the learner's own.
    IF v_owner IS NULL OR v_owner <> v_seat_principal THEN RETURN; END IF;

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

-- Handing it in, and taking it back. Both are the learner's to do: a child who
-- pressed the button too early should not have to ask permission to keep
-- working, and the teacher sees the timestamp move either way.
CREATE OR REPLACE FUNCTION classroom_assignment_work_submit(
    p_seat_id       uuid,
    p_assignment_id uuid,
    p_submitted     boolean
)
RETURNS TABLE (project_id uuid, submitted_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    UPDATE public.classroom_assignment_work w
       SET submitted_at = CASE WHEN p_submitted THEN now() ELSE NULL END
      FROM public.classroom_student_seats s
     WHERE w.seat_id = s.id
       AND s.id = p_seat_id AND s.status = 'active'
       AND w.assignment_id = p_assignment_id;
    RETURN QUERY
    SELECT w.project_id, w.submitted_at
      FROM public.classroom_assignment_work w
     WHERE w.assignment_id = p_assignment_id AND w.seat_id = p_seat_id;
END;
$$;

REVOKE ALL ON FUNCTION classroom_assignment_create(uuid, uuid, varchar, varchar, varchar, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignment_set_status(uuid, uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignment_list(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignment_progress(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignments_for_seat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignment_work_start(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_assignment_work_submit(uuid, uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION classroom_assignment_create(uuid, uuid, varchar, varchar, varchar, timestamptz) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignment_set_status(uuid, uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignment_list(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignment_progress(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignments_for_seat(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignment_work_start(uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_assignment_work_submit(uuid, uuid, boolean) TO asalab_app;
