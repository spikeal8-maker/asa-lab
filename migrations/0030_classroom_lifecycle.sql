-- A class has a life beyond the school year.
--
-- Until now a class could only be created. A teacher who runs six classes a
-- year accumulates them forever, cannot rename one after a typo, and cannot put
-- last year's away — the register grows until the page is useless. This adds
-- the three things that were missing: edit, archive, remove.
--
-- Removal is a state, not a DELETE. A class holds children's work and an audit
-- trail of who did what; erasing rows would take a learner's model with it and
-- leave the record lying. A removed class disappears from every list, its join
-- code stops working and its seats are suspended, which is what "delete" means
-- to the person clicking it — and the work survives.
--
-- The timezone lives here too, on the profile, because it is what makes the
-- dates in a class mean anything: a teacher checking the register from a phone
-- in another region should still read the times of their own school.

ALTER TABLE classrooms
    ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE classrooms DROP CONSTRAINT IF EXISTS classrooms_status_check;
ALTER TABLE classrooms
    ADD CONSTRAINT classrooms_status_check
    CHECK (status IN ('active', 'archived', 'deleted'));

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS time_zone varchar(64);

-- IANA names only, and only ones this server can actually resolve. A stored
-- zone that Postgres cannot read would make every date on the page throw.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_time_zone_check;
ALTER TABLE profiles
    ADD CONSTRAINT profiles_time_zone_check
    CHECK (time_zone IS NULL OR time_zone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+){0,2}$');

-- Access to a class that is not active. Archiving is reversible, so restoring
-- one has to be possible from a state the ordinary access check rejects; a
-- removed class is closed to everybody, including its owner.
CREATE OR REPLACE FUNCTION classroom_teacher_access_any(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (tenant_id uuid, user_id uuid, teacher_role varchar, status varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT m.tenant_id, m.user_id, m.member_role, c.status
      FROM public.classroom_memberships m
      JOIN public.classrooms c
        ON c.tenant_id = m.tenant_id AND c.id = m.classroom_id
     WHERE m.account_id = p_account_id
       AND m.classroom_id = p_classroom_id
       AND m.member_role IN ('owner', 'co_teacher')
       AND c.status <> 'deleted'
     LIMIT 1;
$$;

-- The list now carries archived classes as well, so the archive tab has
-- something to show, and reports the state so the client can tell them apart.
-- Both readers gain a column, which Postgres will not do in place.
DROP FUNCTION IF EXISTS classroom_list_for_account(uuid);
DROP FUNCTION IF EXISTS classroom_management_summary(uuid, uuid);

CREATE OR REPLACE FUNCTION classroom_list_for_account(p_account_id uuid)
RETURNS TABLE (
    id uuid,
    title varchar,
    status varchar,
    age_band varchar,
    topic_keys text[],
    safe_mode_default boolean,
    created_at timestamptz,
    archived_at timestamptz,
    join_code_version integer,
    join_code_status varchar,
    student_count integer,
    teacher_role varchar,
    workspace_kind varchar,
    workspace_title varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title, c.status, c.age_band, c.topic_keys,
           c.safe_mode_default, c.created_at, c.archived_at, jc.version, jc.status,
           count(s.id) FILTER (WHERE s.status <> 'removed')::integer,
           m.member_role, w.kind, w.title
      FROM public.classrooms c
      JOIN public.classroom_memberships m
        ON m.tenant_id = c.tenant_id AND m.classroom_id = c.id
      JOIN public.workspaces w ON w.tenant_id = c.tenant_id
      LEFT JOIN LATERAL (
          SELECT code.version, code.status
            FROM public.classroom_join_codes code
           WHERE code.tenant_id = c.tenant_id AND code.classroom_id = c.id
           ORDER BY code.version DESC LIMIT 1
      ) jc ON true
      LEFT JOIN public.classroom_student_seats s
        ON s.tenant_id = c.tenant_id AND s.classroom_id = c.id
     WHERE m.account_id = p_account_id
       AND m.member_role IN ('owner', 'co_teacher')
       AND c.status IN ('active', 'archived')
     GROUP BY c.id, jc.version, jc.status, m.member_role, w.kind, w.title
     ORDER BY c.created_at DESC;
$$;

-- An archived class still opens: a teacher looks up what last year's group made
-- without bringing the class back to life first. The mutation functions keep
-- their own 'active' check, so what opens is a record, not a working class.
CREATE OR REPLACE FUNCTION classroom_management_summary(
    p_account_id uuid,
    p_classroom_id uuid
)
RETURNS TABLE (
    id uuid,
    title varchar,
    status varchar,
    age_band varchar,
    topic_keys text[],
    safe_mode_default boolean,
    created_at timestamptz,
    archived_at timestamptz,
    join_code_version integer,
    join_code_status varchar,
    student_count integer,
    teacher_role varchar,
    workspace_kind varchar,
    workspace_title varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT c.id, c.title, c.status, c.age_band, c.topic_keys,
           c.safe_mode_default, c.created_at, c.archived_at, jc.version, jc.status,
           count(s.id) FILTER (WHERE s.status <> 'removed')::integer,
           m.member_role, w.kind, w.title
      FROM public.classrooms c
      JOIN public.classroom_memberships m
        ON m.tenant_id = c.tenant_id AND m.classroom_id = c.id
      JOIN public.workspaces w ON w.tenant_id = c.tenant_id
      LEFT JOIN LATERAL (
          SELECT code.version, code.status
            FROM public.classroom_join_codes code
           WHERE code.tenant_id = c.tenant_id AND code.classroom_id = c.id
           ORDER BY code.version DESC LIMIT 1
      ) jc ON true
      LEFT JOIN public.classroom_student_seats s
        ON s.tenant_id = c.tenant_id AND s.classroom_id = c.id
     WHERE m.account_id = p_account_id
       AND m.classroom_id = p_classroom_id
       AND m.member_role IN ('owner', 'co_teacher')
       AND c.status <> 'deleted'
     GROUP BY c.id, jc.version, jc.status, m.member_role, w.kind, w.title;
$$;

-- Everything a teacher can change about a class without entering it. One
-- function rather than four: renaming a class and correcting its age band are
-- the same act — fixing what was typed in a hurry when the class was made.
CREATE OR REPLACE FUNCTION classroom_management_update_details(
    p_account_id uuid,
    p_classroom_id uuid,
    p_title varchar,
    p_age_band varchar,
    p_topic_keys text[],
    p_safe_mode_default boolean
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_access record; v_updated integer := 0;
BEGIN
    SELECT * INTO v_access FROM public.classroom_teacher_access_any(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
    UPDATE public.classrooms
       SET title = p_title,
           age_band = p_age_band,
           topic_keys = p_topic_keys,
           safe_mode_default = p_safe_mode_default
     WHERE tenant_id = v_access.tenant_id AND id = p_classroom_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN
        INSERT INTO public.audit_events
            (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
        VALUES
            (v_access.tenant_id, v_access.user_id, 'classroom', p_classroom_id,
             'classroom.details_updated',
             jsonb_build_object('title', p_title, 'ageBand', p_age_band,
                                'topicKeys', to_jsonb(p_topic_keys),
                                'safeModeDefault', p_safe_mode_default,
                                'teacherRole', v_access.teacher_role));
    END IF;
    RETURN v_updated = 1;
END;
$$;

-- Archive, restore, remove. Removal is the owner's decision alone: a colleague
-- invited to help teach a class does not get to end it.
CREATE OR REPLACE FUNCTION classroom_management_set_status(
    p_account_id uuid,
    p_classroom_id uuid,
    p_status varchar
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_access record; v_updated integer := 0;
BEGIN
    IF p_status NOT IN ('active', 'archived', 'deleted') THEN
        RAISE EXCEPTION 'unknown classroom status';
    END IF;
    SELECT * INTO v_access FROM public.classroom_teacher_access_any(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN RAISE EXCEPTION 'classroom unavailable'; END IF;
    IF p_status = 'deleted' AND v_access.teacher_role <> 'owner' THEN
        RAISE EXCEPTION 'owner required';
    END IF;

    UPDATE public.classrooms
       SET status = p_status,
           archived_at = CASE WHEN p_status = 'active' THEN NULL ELSE now() END
     WHERE tenant_id = v_access.tenant_id AND id = p_classroom_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 1 THEN RETURN false; END IF;

    -- A class that is not running lets nobody in. Restoring it opens the door
    -- again only if a teacher issues a new code, which is the safe direction:
    -- a code that circulated last year should not still work.
    IF p_status <> 'active' THEN
        UPDATE public.classroom_join_codes
           SET status = 'revoked', revoked_at = now()
         WHERE tenant_id = v_access.tenant_id
           AND classroom_id = p_classroom_id
           AND status = 'active';
    END IF;

    -- Removal also ends the seats, so a learner holding a saved link is signed
    -- out rather than left in a class that no longer exists.
    IF p_status = 'deleted' THEN
        UPDATE public.classroom_student_seats
           SET status = 'suspended', updated_at = now()
         WHERE tenant_id = v_access.tenant_id
           AND classroom_id = p_classroom_id
           AND status <> 'removed';
        UPDATE public.classroom_student_sessions ss SET revoked_at = now()
          FROM public.classroom_student_seats s
         WHERE ss.seat_id = s.id
           AND s.tenant_id = v_access.tenant_id
           AND s.classroom_id = p_classroom_id
           AND ss.revoked_at IS NULL;
    END IF;

    INSERT INTO public.audit_events
        (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES
        (v_access.tenant_id, v_access.user_id, 'classroom', p_classroom_id,
         'classroom.status_changed',
         jsonb_build_object('status', p_status, 'from', v_access.status,
                            'teacherRole', v_access.teacher_role));
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION account_time_zone(p_account_id uuid)
RETURNS varchar
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT time_zone FROM public.profiles WHERE account_id = p_account_id;
$$;

-- Where the teacher is. Detected once by the browser and then left alone: a
-- teacher marking work from a hotel should still read the times of their own
-- school, so this is a setting, not a reading of the current device.
CREATE OR REPLACE FUNCTION account_time_zone_set(
    p_account_id uuid,
    p_time_zone varchar,
    p_only_if_unset boolean
)
RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_zone varchar;
BEGIN
    UPDATE public.profiles
       SET time_zone = p_time_zone,
           updated_at = now()
     WHERE account_id = p_account_id
       AND (p_only_if_unset = false OR time_zone IS NULL);
    SELECT time_zone INTO v_zone FROM public.profiles WHERE account_id = p_account_id;
    RETURN v_zone;
END;
$$;

REVOKE ALL ON FUNCTION classroom_teacher_access_any(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_management_update_details(uuid, uuid, varchar, varchar, text[], boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION classroom_management_set_status(uuid, uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_time_zone(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_time_zone_set(uuid, varchar, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION classroom_teacher_access_any(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_management_update_details(uuid, uuid, varchar, varchar, text[], boolean) TO asalab_app;
GRANT EXECUTE ON FUNCTION classroom_management_set_status(uuid, uuid, varchar) TO asalab_app;
GRANT EXECUTE ON FUNCTION account_time_zone(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION account_time_zone_set(uuid, varchar, boolean) TO asalab_app;
