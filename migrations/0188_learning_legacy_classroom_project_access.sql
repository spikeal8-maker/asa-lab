-- Before immutable Learning origins, the Seat principal could own a classroom
-- Project claimed by classroom_assignment_work_start. Preserve only that exact
-- historical work; ordinary classroom membership remains the general policy.
-- A student membership must not turn another Seat's claimed work into a shared
-- classroom Project. Classify even malformed work so the generic branch fails
-- closed; the strict actor-specific proof below decides whether it is readable.
CREATE FUNCTION public.learning_seat_owned_classroom_assignment_work_project(
    p_project_id uuid
)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.projects project
        JOIN public.principals owner
          ON owner.id=project.owner_principal_id AND owner.kind='student_seat'
        JOIN public.classroom_assignment_work work
          ON work.tenant_id=project.tenant_id AND work.project_id=project.id
       WHERE project.id=p_project_id AND project.project_scope='classroom'
    );
$$;

REVOKE ALL ON FUNCTION public.learning_seat_owned_classroom_assignment_work_project(uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_seat_owned_classroom_assignment_work_project(uuid)
    TO asalab_app;

CREATE FUNCTION public.learning_legacy_classroom_work_access(
    p_actor_principal_id uuid, p_project_id uuid
)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.projects project
          JOIN public.classroom_assignment_work work
            ON work.tenant_id=project.tenant_id AND work.project_id=project.id
          JOIN public.classroom_assignments assignment
            ON assignment.tenant_id=work.tenant_id AND assignment.id=work.assignment_id
          JOIN public.classroom_student_seats seat
            ON seat.tenant_id=work.tenant_id AND seat.id=work.seat_id
           AND seat.classroom_id=assignment.classroom_id AND seat.status='active'
          JOIN public.classrooms classroom
            ON classroom.tenant_id=seat.tenant_id AND classroom.id=seat.classroom_id
           AND classroom.status='active'
          JOIN public.principals owner
            ON owner.id=project.owner_principal_id
           AND owner.kind='student_seat' AND owner.seat_id=seat.id
          JOIN public.principals actor ON actor.id=p_actor_principal_id
         WHERE project.id=p_project_id
           AND project.project_scope='classroom'
           AND project.classroom_id=seat.classroom_id
           AND project.status<>'trashed'
           AND assignment.learning_activity_version_id IS NULL
           AND assignment.quiz_version_id IS NULL
           AND (
             (assignment.assignment_id IS NOT NULL AND assignment.course_run_id IS NULL)
             OR (assignment.course_run_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.classroom_course_run_lessons lesson
                  WHERE lesson.tenant_id=assignment.tenant_id
                    AND lesson.run_id=assignment.course_run_id
                    AND lesson.classroom_assignment_id=assignment.id
                    AND lesson.kind='assignment'
             ) AND NOT EXISTS (
                 SELECT 1 FROM public.activity_runs run
                  WHERE run.tenant_id=assignment.tenant_id
                    AND run.source_classroom_assignment_id=assignment.id
             ))
           )
           AND public.learning_direct_assignment_seat_visible(seat.id,assignment.id)
           AND (SELECT count(*) FROM public.classroom_assignment_work duplicate
                 WHERE duplicate.project_id=project.id)=1
           AND NOT EXISTS (
               SELECT 1 FROM public.learning_project_origins origin
                WHERE origin.project_id=project.id
           )
           AND NOT EXISTS (
               SELECT 1 FROM public.learner_identity_links seat_link
               JOIN public.learning_project_origins origin
                 ON origin.school_tenant_id=seat_link.tenant_id
                AND origin.school_id=seat_link.school_id
                AND origin.learner_identity_id=seat_link.learner_identity_id
               JOIN public.activity_runs run
                 ON run.tenant_id=origin.school_tenant_id
                AND run.id=origin.activity_run_id
              WHERE seat_link.tenant_id=seat.tenant_id
                AND seat_link.seat_id=seat.id
                AND seat_link.link_kind='student_seat'
                AND run.classroom_id=seat.classroom_id
                AND run.source_classroom_assignment_id=assignment.id
           )
           AND (NOT EXISTS (
               SELECT 1 FROM public.learner_identity_links seat_link
                WHERE seat_link.tenant_id=seat.tenant_id
                  AND seat_link.seat_id=seat.id
                  AND seat_link.link_kind='student_seat'
           ) OR EXISTS (
               SELECT 1 FROM public.learner_identity_links seat_link
                WHERE seat_link.tenant_id=seat.tenant_id
                  AND seat_link.school_id=classroom.school_id
                  AND seat_link.seat_id=seat.id
                  AND seat_link.link_kind='student_seat'
                  AND seat_link.status='active'
           ))
           AND (
             (actor.kind='student_seat' AND actor.seat_id=seat.id)
             OR (actor.kind='account' AND actor.account_id=seat.account_id
                 AND EXISTS (
                     SELECT 1 FROM public.accounts account
                     JOIN public.learner_identity_links seat_link
                       ON seat_link.tenant_id=seat.tenant_id
                      AND seat_link.school_id=classroom.school_id
                      AND seat_link.seat_id=seat.id
                      AND seat_link.link_kind='student_seat'
                      AND seat_link.status='active'
                     JOIN public.learner_identity_links account_link
                       ON account_link.tenant_id=seat_link.tenant_id
                      AND account_link.school_id=seat_link.school_id
                      AND account_link.learner_identity_id=seat_link.learner_identity_id
                      AND account_link.account_id=account.id
                      AND account_link.link_kind='account'
                      AND account_link.status='active'
                    WHERE account.id=actor.account_id AND account.status='active'
                 ))
           )
    );
$$;

REVOKE ALL ON FUNCTION public.learning_legacy_classroom_work_access(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_legacy_classroom_work_access(uuid,uuid) TO asalab_app;

-- Retain every pre-existing 0179 access branch and add only the exact legacy
-- classroom work proof. A Seat has no classroom membership user_id.
CREATE OR REPLACE FUNCTION public.project_context_for_principal(
    p_principal_id uuid, p_project_id uuid
)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT project.tenant_id,
           CASE WHEN project.project_scope='classroom' THEN membership.user_id
                ELSE legacy_link.user_id END
      FROM public.principals principal
      JOIN public.projects project ON project.id=p_project_id
      LEFT JOIN public.classroom_memberships membership
        ON membership.tenant_id=project.tenant_id
       AND membership.classroom_id=project.classroom_id
       AND membership.account_id=principal.account_id
      LEFT JOIN public.legacy_user_account_links legacy_link
        ON legacy_link.tenant_id=project.tenant_id
       AND legacy_link.account_id=principal.account_id
       AND legacy_link.migration_state='active'
     WHERE principal.id=p_principal_id
       AND ((project.project_scope='personal' AND project.owner_principal_id=p_principal_id)
         OR (project.project_scope='classroom' AND membership.user_id IS NOT NULL
             AND (membership.member_role IN ('owner','co_teacher')
                  OR NOT public.learning_seat_owned_classroom_assignment_work_project(
                      project.id)))
         OR (project.project_scope='personal' AND project.owner_principal_id IN (
             SELECT scope.seat_principal_id FROM public.teacher_seat_scope(p_principal_id) scope))
         OR (project.project_scope='personal' AND public.learning_linked_project_access(
             p_principal_id,p_project_id))
         OR (project.project_scope='classroom' AND public.learning_legacy_classroom_work_access(
             p_principal_id,p_project_id)))
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.project_context_for_principal(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_context_for_principal(uuid,uuid) TO asalab_app;

-- Preserve historical Direct/Course provenance while admitting the exact
-- Seat-owned classroom Project, including a pre-link Start candidate.
-- Historical teacher handouts have neither a pinned ActivityRun nor a Learning
-- Activity Version. This viewer-scoped proof is intentionally boolean: denied
-- immutable origins and projects must never be exposed through a legacy list.
CREATE OR REPLACE FUNCTION public.learning_legacy_direct_provenance(
    p_viewer_principal_id uuid, p_seat_id uuid,
    p_assignment_id uuid, p_project_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_seat record;
    v_actor record;
    v_assignment record;
    v_has_link boolean;
    v_link_active boolean;
    v_origin_present boolean;
    v_run_present boolean;
    v_work_present boolean;
    v_work_project_id uuid;
    v_project_access boolean;
    v_classroom_project_valid boolean;
    v_legacy_direct boolean;
    v_legacy_course_lesson boolean;
    v_course_open boolean;
    v_legacy_submit_supported boolean;
BEGIN
    SELECT seat.id, seat.tenant_id, seat.classroom_id, seat.account_id,
           seat.status
      INTO v_seat FROM public.classroom_student_seats seat
     WHERE seat.id = p_seat_id;
    SELECT principal.kind, principal.seat_id, principal.account_id
      INTO v_actor FROM public.principals principal
     WHERE principal.id = p_viewer_principal_id;
    SELECT assignment.id, assignment.tenant_id, assignment.classroom_id,
           assignment.status, assignment.assignment_id,
           assignment.course_run_id, assignment.quiz_version_id,
           assignment.learning_activity_version_id
      INTO v_assignment FROM public.classroom_assignments assignment
     WHERE assignment.id = p_assignment_id;
    SELECT EXISTS (
        SELECT 1 FROM public.activity_runs run
         WHERE run.tenant_id = v_seat.tenant_id
           AND run.classroom_id = v_seat.classroom_id
           AND run.source_classroom_assignment_id = p_assignment_id
    ) INTO v_run_present;
    SELECT v_assignment.learning_activity_version_id IS NULL
      AND NOT v_run_present AND EXISTS (
        SELECT 1 FROM public.classroom_course_run_lessons lesson
        JOIN public.classroom_course_runs course
          ON course.tenant_id = lesson.tenant_id AND course.id = lesson.run_id
         WHERE lesson.classroom_assignment_id = p_assignment_id
           AND lesson.kind = 'assignment'
           AND lesson.run_id = v_assignment.course_run_id
           AND course.tenant_id = v_seat.tenant_id
           AND course.classroom_id = v_seat.classroom_id
    ) INTO v_legacy_course_lesson;
    SELECT v_legacy_course_lesson AND EXISTS (
        SELECT 1 FROM public.classroom_course_run_lessons lesson
        JOIN public.classroom_course_runs course
          ON course.tenant_id = lesson.tenant_id AND course.id = lesson.run_id
         WHERE lesson.classroom_assignment_id = p_assignment_id
           AND lesson.kind = 'assignment'
           AND lesson.run_id = v_assignment.course_run_id
           AND course.tenant_id = v_seat.tenant_id
           AND course.classroom_id = v_seat.classroom_id
           AND course.status = 'open'
    ) INTO v_course_open;
    v_legacy_direct := COALESCE(
        v_assignment.assignment_id IS NOT NULL
        AND v_assignment.course_run_id IS NULL
        AND v_assignment.quiz_version_id IS NULL
        AND v_assignment.learning_activity_version_id IS NULL
        AND NOT v_legacy_course_lesson,
        false);
    IF v_seat.id IS NULL OR v_actor.kind IS NULL OR v_assignment.id IS NULL
       OR v_seat.status <> 'active'
       OR v_assignment.tenant_id <> v_seat.tenant_id
       OR v_assignment.classroom_id <> v_seat.classroom_id
       OR NOT (v_legacy_direct OR v_legacy_course_lesson)
       OR NOT public.learning_direct_assignment_seat_visible(p_seat_id,p_assignment_id)
       OR NOT (
           (v_actor.kind = 'student_seat' AND v_actor.seat_id = p_seat_id)
           OR (v_actor.kind = 'account' AND v_actor.account_id = v_seat.account_id
               AND EXISTS (SELECT 1 FROM public.accounts account
                            WHERE account.id = v_actor.account_id
                              AND account.status = 'active'))
       ) THEN
        RETURN jsonb_build_object('legacyDirect',v_legacy_direct,
            'legacyCourseLesson',v_legacy_course_lesson,
            'legacyProjectReadable',false,
            'startAllowed',false,'submitAllowed',false);
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.learner_identity_links link
         WHERE link.tenant_id = v_seat.tenant_id
           AND link.seat_id = p_seat_id AND link.link_kind = 'student_seat'
    ) INTO v_has_link;
    SELECT work.project_id INTO v_work_project_id
      FROM public.classroom_assignment_work work
     WHERE work.tenant_id = v_seat.tenant_id
       AND work.seat_id = p_seat_id
       AND work.assignment_id = p_assignment_id
       AND (p_project_id IS NULL OR work.project_id = p_project_id);
    SELECT EXISTS (
        SELECT 1 FROM public.learner_identity_links seat_link
         WHERE seat_link.tenant_id = v_seat.tenant_id
           AND seat_link.seat_id = p_seat_id
           AND seat_link.link_kind = 'student_seat'
           AND seat_link.status = 'active'
           AND (v_actor.kind = 'student_seat' OR EXISTS (
               SELECT 1 FROM public.learner_identity_links account_link
                WHERE account_link.tenant_id = seat_link.tenant_id
                  AND account_link.school_id = seat_link.school_id
                  AND account_link.learner_identity_id = seat_link.learner_identity_id
                  AND account_link.account_id = v_actor.account_id
                  AND account_link.link_kind = 'account'
                  AND account_link.status = 'active'))
    ) INTO v_link_active;
    IF v_has_link AND NOT v_link_active THEN
        RETURN jsonb_build_object('legacyDirect',v_legacy_direct,
            'legacyCourseLesson',v_legacy_course_lesson,
            'legacyProjectReadable',false,
            'startAllowed',false,'submitAllowed',false);
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.learner_identity_links seat_link
        JOIN public.learning_project_origins origin
          ON origin.school_tenant_id = seat_link.tenant_id
         AND origin.school_id = seat_link.school_id
         AND origin.learner_identity_id = seat_link.learner_identity_id
        JOIN public.activity_runs run
          ON run.tenant_id = origin.school_tenant_id
         AND run.id = origin.activity_run_id
         WHERE seat_link.tenant_id = v_seat.tenant_id
           AND seat_link.seat_id = p_seat_id
           AND seat_link.link_kind = 'student_seat'
           AND run.classroom_id = v_seat.classroom_id
           AND run.source_classroom_assignment_id = p_assignment_id
    ) OR (COALESCE(p_project_id,v_work_project_id) IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.learning_project_origins origin
         WHERE origin.project_id = COALESCE(p_project_id,v_work_project_id)
    )) INTO v_origin_present;
    v_work_present := v_work_project_id IS NOT NULL;
    v_project_access := COALESCE(p_project_id,v_work_project_id) IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.project_context_for_principal(
            p_viewer_principal_id,COALESCE(p_project_id,v_work_project_id)))
        OR (v_actor.kind='student_seat' AND NOT v_work_present AND EXISTS (
            SELECT 1 FROM public.projects project
            JOIN public.principals owner ON owner.id=project.owner_principal_id
             WHERE project.id=p_project_id AND project.tenant_id=v_seat.tenant_id
               AND project.project_scope='classroom'
               AND project.classroom_id=v_seat.classroom_id
               AND owner.kind='student_seat' AND owner.seat_id=p_seat_id
               AND NOT EXISTS (SELECT 1 FROM public.classroom_assignment_work work
                                WHERE work.project_id=project.id)
               AND NOT EXISTS (SELECT 1 FROM public.learning_project_origins origin
                                WHERE origin.project_id=project.id)
        ))
    );
    SELECT EXISTS (
        SELECT 1 FROM public.projects project
         WHERE project.id=COALESCE(p_project_id,v_work_project_id)
           AND (project.project_scope<>'classroom'
                OR public.learning_legacy_classroom_work_access(
                    p_viewer_principal_id,project.id))
    ) INTO v_classroom_project_valid;
    -- The existing compatibility submission function accepts only same-tenant
    -- projects owned by the Seat principal. Do not advertise Submit otherwise.
    SELECT EXISTS (
        SELECT 1 FROM public.projects project
        JOIN public.principals owner
          ON owner.id = project.owner_principal_id
         AND owner.kind = 'student_seat'
         AND owner.seat_id = p_seat_id
        JOIN public.project_drafts draft
          ON draft.tenant_id = project.tenant_id
         AND draft.project_id = project.id
         WHERE project.id = v_work_project_id
           AND project.tenant_id = v_seat.tenant_id
    ) INTO v_legacy_submit_supported;
    RETURN jsonb_build_object(
        'legacyDirect',v_legacy_direct,
        'legacyCourseLesson',v_legacy_course_lesson,
        'legacyProjectReadable',v_work_present AND v_project_access
            AND v_classroom_project_valid AND NOT v_origin_present,
        'startAllowed',v_assignment.status = 'open'
            AND v_actor.kind = 'student_seat'
            AND (NOT v_legacy_course_lesson OR v_course_open)
            AND (v_legacy_course_lesson OR NOT v_run_present)
            AND NOT v_origin_present
            AND NOT EXISTS (
                SELECT 1 FROM public.classroom_assignment_work work
                 WHERE work.tenant_id = v_seat.tenant_id
                   AND work.seat_id = p_seat_id
                   AND work.assignment_id = p_assignment_id)
            AND (p_project_id IS NULL OR (v_project_access AND EXISTS (
                SELECT 1 FROM public.projects project
                JOIN public.principals owner
                  ON owner.id = project.owner_principal_id
                 AND owner.kind = 'student_seat'
                 AND owner.seat_id = p_seat_id
                 WHERE project.id = p_project_id
                   AND project.tenant_id = v_seat.tenant_id))),
        'submitAllowed',v_assignment.status = 'open'
            AND (NOT v_legacy_course_lesson OR v_course_open)
            AND v_work_present AND v_project_access
            AND v_legacy_submit_supported AND v_classroom_project_valid
            AND NOT v_origin_present
    );
END;
$$;

REVOKE ALL ON FUNCTION public.learning_legacy_direct_provenance(uuid,uuid,uuid,uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_legacy_direct_provenance(uuid,uuid,uuid,uuid)
    TO asalab_app;
