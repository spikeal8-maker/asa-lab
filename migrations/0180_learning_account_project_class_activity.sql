-- A4-3a1: route edits of an Account-owned Learning Project to its exact
-- school classroom and linked learner Seat. Earlier personal Account Projects
-- without an immutable origin remain outside the classroom activity feed.
ALTER TABLE public.classroom_activity_events
    ADD COLUMN actor_is_teacher_at_event boolean;

-- Snapshot the actor's role in the exact class at event time. Historical rows
-- remain NULL; new events never fold into an old or differently classified row.
CREATE OR REPLACE FUNCTION public.classroom_activity_record(
    p_tenant_id uuid,
    p_classroom_id uuid,
    p_seat_id uuid,
    p_principal_id uuid,
    p_action varchar,
    p_project_id uuid,
    p_project_title varchar,
    p_window interval DEFAULT interval '10 minutes'
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_id uuid;
    v_previous_teacher boolean;
    v_actor_is_teacher boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
          FROM public.principals actor
          JOIN public.classroom_memberships membership
            ON membership.account_id = actor.account_id
           AND membership.tenant_id = p_tenant_id
           AND membership.classroom_id = p_classroom_id
           AND membership.member_role IN ('owner', 'co_teacher')
         WHERE actor.id = p_principal_id
         FOR SHARE OF membership
    ) INTO v_actor_is_teacher;

    SELECT event.id, event.actor_is_teacher_at_event
      INTO v_id, v_previous_teacher
      FROM public.classroom_activity_events event
     WHERE event.tenant_id = p_tenant_id
       AND event.classroom_id = p_classroom_id
       AND event.actor_principal_id = p_principal_id
       AND event.action = p_action
       AND event.project_id IS NOT DISTINCT FROM p_project_id
       AND event.occurred_at > now() - p_window
     ORDER BY event.occurred_at DESC, event.id DESC
     LIMIT 1 FOR UPDATE OF event;

    IF v_id IS NOT NULL
       AND v_previous_teacher IS NOT DISTINCT FROM v_actor_is_teacher THEN
        UPDATE public.classroom_activity_events
           SET occurrence_count = occurrence_count + 1,
               occurred_at = now(),
               project_title = COALESCE(p_project_title, project_title)
         WHERE id = v_id;
        RETURN v_id;
    END IF;

    INSERT INTO public.classroom_activity_events
        (tenant_id, classroom_id, seat_id, actor_principal_id, action,
         project_id, project_title, actor_is_teacher_at_event)
    VALUES (p_tenant_id, p_classroom_id, p_seat_id, p_principal_id, p_action,
            p_project_id, p_project_title, v_actor_is_teacher)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.classroom_activity_record(
    uuid,uuid,uuid,uuid,varchar,uuid,varchar,interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_activity_record(
    uuid,uuid,uuid,uuid,varchar,uuid,varchar,interval) TO asalab_app;

CREATE OR REPLACE FUNCTION public.classroom_activity_record_project(
    p_actor_principal_id uuid,
    p_project_id uuid,
    p_action varchar
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_event_tenant uuid;
    v_scope varchar;
    v_owner uuid;
    v_class uuid;
    v_title varchar;
    v_seat uuid;
    v_actorseat uuid;
    v_prior_tenant text;
    v_event_id uuid;
BEGIN
    SELECT project.tenant_id, project.project_scope, project.owner_principal_id,
           project.classroom_id, project.title
      INTO v_tenant, v_scope, v_owner, v_class, v_title
      FROM public.projects project
     WHERE project.id = p_project_id;
    IF v_tenant IS NULL THEN
        RETURN NULL;
    END IF;
    v_event_tenant := v_tenant;

    -- Preserve the Seat-owned and shared-class paths from 0028.
    SELECT seat_principal.seat_id INTO v_seat
      FROM public.principals seat_principal
     WHERE seat_principal.id = v_owner
       AND seat_principal.seat_id IS NOT NULL;
    IF v_seat IS NOT NULL THEN
        SELECT seat.classroom_id INTO v_class
          FROM public.classroom_student_seats seat
         WHERE seat.id = v_seat;
    ELSIF v_scope = 'personal' THEN
        -- The Account Project may live in a personal tenant. Only an exact
        -- immutable Learning origin and today's active bilateral links permit
        -- an event in the school tenant. A linked Seat may be the editor.
        SELECT origin.school_tenant_id, run.classroom_id, seat.id
          INTO v_event_tenant, v_class, v_seat
          FROM public.learning_project_origins origin
          JOIN public.activity_participations participation
            ON participation.id = origin.participation_id
           AND participation.tenant_id = origin.school_tenant_id
           AND participation.school_id = origin.school_id
           AND participation.learner_identity_id = origin.learner_identity_id
           AND participation.activity_run_id = origin.activity_run_id
          JOIN public.activity_runs run
            ON run.id = origin.activity_run_id
           AND run.tenant_id = origin.school_tenant_id
           AND run.school_id = origin.school_id
          JOIN public.learner_identities learner
            ON learner.id = origin.learner_identity_id
           AND learner.tenant_id = origin.school_tenant_id
           AND learner.school_id = origin.school_id
           AND learner.state = 'active'
          JOIN public.principals owner
            ON owner.id = origin.owner_principal_id
           AND owner.kind = 'account'
          JOIN public.accounts account
            ON account.id = owner.account_id AND account.status = 'active'
          JOIN public.classroom_student_seats seat
            ON seat.tenant_id = origin.school_tenant_id
           AND seat.classroom_id = run.classroom_id
           AND seat.account_id = account.id
           AND seat.status = 'active'
          JOIN public.learner_identity_links seat_link
            ON seat_link.tenant_id = origin.school_tenant_id
           AND seat_link.school_id = origin.school_id
           AND seat_link.learner_identity_id = origin.learner_identity_id
           AND seat_link.link_kind = 'student_seat'
           AND seat_link.seat_id = seat.id
           AND seat_link.status = 'active'
          JOIN public.learner_identity_links account_link
            ON account_link.tenant_id = origin.school_tenant_id
           AND account_link.school_id = origin.school_id
           AND account_link.learner_identity_id = origin.learner_identity_id
           AND account_link.link_kind = 'account'
           AND account_link.account_id = account.id
           AND account_link.status = 'active'
         WHERE origin.project_id = p_project_id
           AND origin.project_tenant_id = v_tenant
           AND origin.owner_principal_id = v_owner
           AND (p_actor_principal_id = v_owner
                OR public.learning_linked_project_access(
                    p_actor_principal_id, p_project_id))
         FOR SHARE OF run, learner, account, seat, seat_link, account_link;
        IF v_seat IS NULL THEN
            RETURN NULL;
        END IF;
    ELSIF v_scope <> 'classroom' THEN
        RETURN NULL;
    ELSE
        SELECT actor.seat_id INTO v_actorseat
          FROM public.principals actor
         WHERE actor.id = p_actor_principal_id;
        v_seat := v_actorseat;
    END IF;

    IF v_class IS NULL THEN
        RETURN NULL;
    END IF;

    -- classroom_activity_events is school-tenant RLS protected. Restore the
    -- caller's Project tenant after the nested insert, including NULL/reset.
    v_prior_tenant := current_setting('app.tenant_id', true);
    IF v_event_tenant::text IS DISTINCT FROM v_prior_tenant THEN
        PERFORM set_config('app.tenant_id', v_event_tenant::text, true);
    END IF;
    v_event_id := public.classroom_activity_record(
        v_event_tenant, v_class, v_seat, p_actor_principal_id,
        p_action, p_project_id, v_title);
    IF v_event_tenant::text IS DISTINCT FROM v_prior_tenant THEN
        PERFORM set_config('app.tenant_id', v_prior_tenant, true);
    END IF;
    RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.classroom_activity_record_project(uuid,uuid,varchar)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_activity_record_project(uuid,uuid,varchar)
    TO asalab_app;

-- New events retain their event-time role. Keep 0028's Account-based display
-- for historical rows whose role was never recorded; no history is rewritten.
CREATE OR REPLACE FUNCTION public.classroom_activity_feed(
    p_principal_id uuid,
    p_classroom_id uuid,
    p_seat_id uuid DEFAULT NULL,
    p_limit integer DEFAULT 100
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
           COALESCE(event.actor_is_teacher_at_event,
                    actor.account_id IS NOT NULL),
           event.project_id, event.project_title,
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

REVOKE ALL ON FUNCTION public.classroom_activity_feed(uuid,uuid,uuid,integer)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_activity_feed(uuid,uuid,uuid,integer)
    TO asalab_app;
