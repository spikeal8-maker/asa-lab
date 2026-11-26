-- Include the current effective Safe Mode in the learner's existing class list.
-- The return type grows by one boolean. Preserve the existing read boundary.
DROP FUNCTION public.classroom_account_seats(uuid);

CREATE FUNCTION public.classroom_account_seats(p_account_id uuid)
RETURNS TABLE (
    seat_id uuid,
    classroom_id uuid,
    classroom_title varchar,
    teacher_display_name varchar,
    open_count integer,
    unfinished_count integer,
    safe_mode boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT seat.id, classroom.id, classroom.title,
           COALESCE(owner_profile.display_name, 'Преподаватель')::varchar,
           counts.open_count, counts.unfinished_count,
           (classroom.safe_mode_default OR seat.safe_mode)
      FROM public.classroom_student_seats seat
      JOIN public.classrooms classroom ON classroom.id = seat.classroom_id
      LEFT JOIN LATERAL (
          SELECT profile.display_name
            FROM public.classroom_memberships member
            JOIN public.profiles profile ON profile.account_id = member.account_id
           WHERE member.classroom_id = classroom.id AND member.member_role = 'owner'
           LIMIT 1
      ) owner_profile ON true
      LEFT JOIN LATERAL public.classroom_seat_assignment_counts(seat.id) counts ON true
     WHERE seat.account_id = p_account_id
       AND seat.status = 'active'
       AND classroom.status = 'active'
     ORDER BY classroom.title;
$$;

REVOKE ALL ON FUNCTION public.classroom_account_seats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_account_seats(uuid) TO asalab_app;
