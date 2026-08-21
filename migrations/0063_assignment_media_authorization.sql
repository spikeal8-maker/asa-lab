-- Assignment media is application data, not a bearer URL.
--
-- The original byte readers accepted only UUIDs. Because they are SECURITY
-- DEFINER functions, anyone who could reach the API route could bypass RLS and
-- read a sample or inline image after learning its identifiers. The viewer is
-- now part of the database call and access is checked before bytes are read.

CREATE OR REPLACE FUNCTION assignment_media_visible(
    p_assignment_id uuid,
    p_principal_id  uuid,
    p_account_id    uuid,
    p_tenant_id     uuid,
    p_seat_id       uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT CASE
        -- An email-free learner sees only work handed to this exact seat's
        -- active class. Public/school sharing never widens a child seat.
        WHEN p_seat_id IS NOT NULL THEN EXISTS (
            SELECT 1
              FROM public.classroom_student_seats seat
              JOIN public.classroom_assignments handout
                ON handout.tenant_id = seat.tenant_id
               AND handout.classroom_id = seat.classroom_id
             WHERE seat.id = p_seat_id
               AND seat.tenant_id = p_tenant_id
               AND seat.status IN ('issued', 'active')
               AND handout.assignment_id = p_assignment_id
        )

        -- Account users may see their own/shared catalogue items, assignments
        -- in a visible course, assignments in a class they teach, or work
        -- handed to an active learner seat linked to their account.
        WHEN p_account_id IS NOT NULL THEN EXISTS (
            SELECT 1
              FROM public.teacher_assignments task
             WHERE task.id = p_assignment_id
               AND (
                   public.content_is_visible(
                       'assignment', task.id, task.visibility,
                       task.owner_principal_id, task.tenant_id,
                       p_principal_id, p_account_id, p_tenant_id
                   )
                   OR EXISTS (
                       SELECT 1
                         FROM public.classroom_assignments handout
                         JOIN public.classroom_memberships membership
                           ON membership.tenant_id = handout.tenant_id
                          AND membership.classroom_id = handout.classroom_id
                        WHERE handout.assignment_id = task.id
                          AND membership.account_id = p_account_id
                          AND membership.member_role IN ('owner', 'co_teacher')
                   )
                   OR EXISTS (
                       SELECT 1
                         FROM public.classroom_assignments handout
                         JOIN public.classroom_student_seats seat
                           ON seat.tenant_id = handout.tenant_id
                          AND seat.classroom_id = handout.classroom_id
                        WHERE handout.assignment_id = task.id
                          AND seat.account_id = p_account_id
                          AND seat.status = 'active'
                   )
                   OR EXISTS (
                       SELECT 1
                         FROM public.course_items item
                         JOIN public.courses course ON course.id = item.course_id
                        WHERE item.assignment_id = task.id
                          AND public.content_is_visible(
                              'course', course.id, course.visibility,
                              course.owner_principal_id, course.tenant_id,
                              p_principal_id, p_account_id, p_tenant_id
                          )
                   )
               )
        )
        ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION assignment_sample_for_viewer(
    p_assignment_id uuid,
    p_principal_id  uuid,
    p_account_id    uuid,
    p_tenant_id     uuid,
    p_seat_id       uuid
)
RETURNS TABLE (sample_bytes bytea, sample_content_type varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT task.sample_bytes, task.sample_content_type
      FROM public.teacher_assignments task
     WHERE task.id = p_assignment_id
       AND task.sample_bytes IS NOT NULL
       AND public.assignment_media_visible(
           p_assignment_id, p_principal_id, p_account_id, p_tenant_id, p_seat_id
       );
$$;

CREATE OR REPLACE FUNCTION assignment_image_for_viewer(
    p_assignment_id uuid,
    p_image_id      uuid,
    p_principal_id  uuid,
    p_account_id    uuid,
    p_tenant_id     uuid,
    p_seat_id       uuid
)
RETURNS TABLE (bytes bytea, content_type varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT image.bytes, image.content_type
      FROM public.teacher_assignment_images image
     WHERE image.assignment_id = p_assignment_id
       AND image.id = p_image_id
       AND public.assignment_media_visible(
           p_assignment_id, p_principal_id, p_account_id, p_tenant_id, p_seat_id
       );
$$;

-- Remove the runtime role's ability to call the old UUID-only readers. They
-- remain defined so older migrations and an administrator's rollback tooling
-- do not break, but the application can no longer use them as a side door.
REVOKE EXECUTE ON FUNCTION teacher_assignment_sample(uuid) FROM asalab_app;
REVOKE EXECUTE ON FUNCTION teacher_assignment_image(uuid, uuid) FROM asalab_app;

REVOKE ALL ON FUNCTION assignment_media_visible(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assignment_sample_for_viewer(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assignment_image_for_viewer(uuid, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assignment_media_visible(uuid, uuid, uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION assignment_sample_for_viewer(uuid, uuid, uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION assignment_image_for_viewer(uuid, uuid, uuid, uuid, uuid, uuid) TO asalab_app;
