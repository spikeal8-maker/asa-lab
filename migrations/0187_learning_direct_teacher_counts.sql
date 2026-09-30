-- Current teacher counters for canonical Direct delivery. The audience claim,
-- active Seat link, participation and latest Attempt must all belong to the
-- same exact ActivityRun. Historical handouts without a Run use their existing
-- classroom_assignment_list fallback.

CREATE OR REPLACE FUNCTION learning_direct_assignment_teacher_counts(
    p_actor_principal_id uuid, p_tenant_id uuid, p_classroom_id uuid
)
RETURNS TABLE (
    classroom_assignment_id uuid, audience_type varchar,
    assigned_count integer, started_count integer, submitted_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH authorized AS (
        SELECT run.id AS run_id, run.source_classroom_assignment_id AS assignment_id,
               audience.id AS audience_id, audience.audience_type
          FROM public.principals principal
          JOIN public.classroom_memberships membership
            ON membership.account_id=principal.account_id
           AND membership.tenant_id=p_tenant_id
           AND membership.classroom_id=p_classroom_id
           AND membership.member_role IN ('owner','co_teacher')
          JOIN public.activity_runs run
            ON run.tenant_id=membership.tenant_id
           AND run.classroom_id=membership.classroom_id
           AND run.source_kind='direct'
          JOIN public.learning_audience_definitions audience
            ON audience.target_activity_run_id=run.id
           AND audience.tenant_id=run.tenant_id
           AND audience.school_id=run.school_id
           AND audience.classroom_id=run.classroom_id
           AND audience.status='active'
         WHERE principal.id=p_actor_principal_id
           AND principal.kind='account'
    ), participants AS (
        SELECT authorized.run_id, authorized.assignment_id,
               seat.id AS seat_id, participation.id AS participation_id
          FROM authorized
          JOIN public.learning_audience_membership_claims claim
            ON claim.audience_id=authorized.audience_id
           AND claim.tenant_id=p_tenant_id
           AND claim.ended_at IS NULL
          JOIN public.activity_participations participation
            ON participation.id=claim.activity_participation_id
           AND participation.tenant_id=claim.tenant_id
           AND participation.school_id=claim.school_id
           AND participation.activity_run_id=authorized.run_id
           AND participation.learner_identity_id=claim.learner_identity_id
           AND participation.status IN ('assigned','active')
          JOIN public.learner_identity_links link
            ON link.learner_identity_id=participation.learner_identity_id
           AND link.tenant_id=participation.tenant_id
           AND link.school_id=participation.school_id
           AND link.link_kind='student_seat'
           AND link.status='active'
          JOIN public.classroom_student_seats seat
            ON seat.id=link.seat_id
           AND seat.classroom_id=p_classroom_id
           AND seat.tenant_id=p_tenant_id
           AND seat.status IN ('issued','active')
    )
    SELECT authorized.assignment_id, authorized.audience_type,
           count(DISTINCT participant.seat_id)::integer,
           count(DISTINCT participant.seat_id)
             FILTER (WHERE latest.id IS NOT NULL)::integer,
           count(DISTINCT participant.seat_id)
             FILTER (WHERE latest.state IN ('submitted','evaluating','closed'))::integer
      FROM authorized
      LEFT JOIN participants participant ON participant.run_id=authorized.run_id
      LEFT JOIN LATERAL (
          SELECT attempt.id, attempt.state
            FROM public.learning_attempts attempt
           WHERE attempt.activity_participation_id=participant.participation_id
             AND attempt.seat_id=participant.seat_id
             AND attempt.classroom_assignment_id=authorized.assignment_id
           ORDER BY attempt.attempt_number DESC, attempt.id DESC
           LIMIT 1
      ) latest ON true
     GROUP BY authorized.assignment_id, authorized.audience_type;
$$;

REVOKE ALL ON FUNCTION learning_direct_assignment_teacher_counts(uuid,uuid,uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_direct_assignment_teacher_counts(uuid,uuid,uuid)
    TO asalab_app;
