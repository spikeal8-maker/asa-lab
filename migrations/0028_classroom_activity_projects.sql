-- Project work in the class record.
--
-- The caller knows who acted and which project; which class the event belongs
-- to, and whose seat it concerns, follows from the project itself. Resolving it
-- here rather than in application code keeps one answer to the question and
-- keeps the repository call to a single line on paths that are already writing.

CREATE OR REPLACE FUNCTION classroom_activity_record_project(
    p_actor_principal_id uuid,
    p_project_id         uuid,
    p_action             varchar
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant    uuid;
    v_scope     varchar;
    v_owner     uuid;
    v_class     uuid;
    v_title     varchar;
    v_seat      uuid;
    v_actorseat uuid;
BEGIN
    SELECT project.tenant_id, project.project_scope, project.owner_principal_id,
           project.classroom_id, project.title
      INTO v_tenant, v_scope, v_owner, v_class, v_title
      FROM public.projects project
     WHERE project.id = p_project_id;
    IF v_tenant IS NULL THEN
        RETURN NULL;
    END IF;

    -- Whose work is this? A personal project owned by a seat belongs to that
    -- learner's class, whoever is acting on it — which is what puts a teacher's
    -- correction on the learner's own record rather than nowhere.
    SELECT seat_principal.seat_id INTO v_seat
      FROM public.principals seat_principal
     WHERE seat_principal.id = v_owner
       AND seat_principal.seat_id IS NOT NULL;

    IF v_seat IS NOT NULL THEN
        SELECT seat.classroom_id INTO v_class
          FROM public.classroom_student_seats seat
         WHERE seat.id = v_seat;
    ELSIF v_scope <> 'classroom' THEN
        -- A teacher's own personal project has no class to belong to.
        RETURN NULL;
    ELSE
        -- Work inside a shared class project: the actor may still be a learner.
        SELECT actor.seat_id INTO v_actorseat
          FROM public.principals actor
         WHERE actor.id = p_actor_principal_id;
        v_seat := v_actorseat;
    END IF;

    IF v_class IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN public.classroom_activity_record(
        v_tenant, v_class, v_seat, p_actor_principal_id, p_action, p_project_id, v_title);
END;
$$;

REVOKE ALL ON FUNCTION classroom_activity_record_project(uuid, uuid, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_activity_record_project(uuid, uuid, varchar) TO asalab_app;

-- The record a teacher reads. Only a teacher of the class sees it, and the
-- seat filter is applied here so a caller cannot ask for a learner in someone
-- else's class.
CREATE OR REPLACE FUNCTION classroom_activity_feed(
    p_principal_id uuid,
    p_classroom_id uuid,
    p_seat_id      uuid DEFAULT NULL,
    p_limit        integer DEFAULT 100
)
RETURNS TABLE (
    id uuid,
    action varchar,
    seat_id uuid,
    seat_label varchar,
    actor_is_teacher boolean,
    project_id uuid,
    project_title varchar,
    occurrence_count integer,
    first_occurred_at timestamptz,
    occurred_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT event.id, event.action, event.seat_id, seat.display_label,
           actor.account_id IS NOT NULL, event.project_id, event.project_title,
           event.occurrence_count, event.first_occurred_at, event.occurred_at
      FROM public.classroom_activity_events event
      JOIN public.principals teacher ON teacher.id = p_principal_id
      JOIN public.classroom_memberships membership
        ON membership.tenant_id = event.tenant_id
       AND membership.classroom_id = event.classroom_id
       AND membership.account_id = teacher.account_id
       AND membership.member_role IN ('owner', 'co_teacher')
      JOIN public.principals actor ON actor.id = event.actor_principal_id
      LEFT JOIN public.classroom_student_seats seat ON seat.id = event.seat_id
     WHERE event.classroom_id = p_classroom_id
       AND (p_seat_id IS NULL OR event.seat_id = p_seat_id)
     ORDER BY event.occurred_at DESC
     LIMIT LEAST(GREATEST(p_limit, 1), 300);
$$;

REVOKE ALL ON FUNCTION classroom_activity_feed(uuid, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_activity_feed(uuid, uuid, uuid, integer) TO asalab_app;

-- The works of one learner, for the teacher of that learner's class. Personal
-- projects only: a seat has no other kind.
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
    SELECT project.id, project.module_key, project.title, project.status,
           project.created_at, draft.updated_at, snapshot.source_revision,
           draft.preview_json, draft.preview_digest,
           editor.account_id IS NOT NULL
      FROM public.teacher_seat_scope(p_principal_id) scope
      JOIN public.projects project
        ON project.owner_principal_id = scope.seat_principal_id
      JOIN public.project_drafts draft
        ON draft.tenant_id = project.tenant_id AND draft.project_id = project.id
      LEFT JOIN public.project_snapshots snapshot
        ON snapshot.tenant_id = project.tenant_id AND snapshot.project_id = project.id
      LEFT JOIN public.principals editor ON editor.id = draft.updated_by_principal_id
     WHERE scope.seat_id = p_seat_id
       AND project.project_scope = 'personal'
     ORDER BY draft.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION classroom_seat_projects(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_seat_projects(uuid, uuid) TO asalab_app;
