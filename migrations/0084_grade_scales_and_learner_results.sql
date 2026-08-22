-- Versioned class grading scales, auditable history and learner-visible results.

CREATE TABLE IF NOT EXISTS grading_scheme_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    school_id uuid NOT NULL,
    version_number integer NOT NULL,
    title varchar(120) NOT NULL,
    bands jsonb NOT NULL,
    published_by_principal_id uuid NOT NULL REFERENCES principals(id),
    published_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (school_id, version_number),
    FOREIGN KEY (tenant_id, school_id) REFERENCES schools(tenant_id, id),
    CONSTRAINT grading_scheme_title_check CHECK (length(trim(title)) > 0),
    CONSTRAINT grading_scheme_bands_check CHECK (
        jsonb_typeof(bands) = 'array' AND jsonb_array_length(bands) BETWEEN 2 AND 10
    )
);

CREATE TABLE IF NOT EXISTS classroom_grading_schemes (
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    classroom_id uuid PRIMARY KEY,
    grading_scheme_version_id uuid NOT NULL,
    assigned_by_principal_id uuid NOT NULL REFERENCES principals(id),
    assigned_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, classroom_id),
    FOREIGN KEY (tenant_id, classroom_id) REFERENCES classrooms(tenant_id, id),
    FOREIGN KEY (tenant_id, grading_scheme_version_id)
        REFERENCES grading_scheme_versions(tenant_id, id)
);

DROP TRIGGER IF EXISTS grading_scheme_versions_immutable ON grading_scheme_versions;
CREATE TRIGGER grading_scheme_versions_immutable
    BEFORE UPDATE OR DELETE ON grading_scheme_versions
    FOR EACH ROW EXECUTE FUNCTION learning_immutable_row();

CREATE OR REPLACE FUNCTION grading_scheme_publish(
    p_account_id uuid,
    p_principal_id uuid,
    p_classroom_id uuid,
    p_title varchar,
    p_bands jsonb
)
RETURNS TABLE (result_code varchar, grading_scheme_version_id uuid, version_number integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_access record;
    v_version integer;
    v_id uuid;
    v_school uuid;
BEGIN
    SELECT * INTO v_access FROM public.classroom_teacher_access(p_account_id, p_classroom_id);
    IF v_access.user_id IS NULL THEN
        RETURN QUERY SELECT 'classroom_not_found'::varchar, NULL::uuid, NULL::integer;
        RETURN;
    END IF;
    SELECT classroom.school_id INTO v_school
      FROM public.classrooms classroom WHERE classroom.id = p_classroom_id;
    IF length(trim(p_title)) NOT BETWEEN 1 AND 120
       OR jsonb_typeof(p_bands) <> 'array'
       OR jsonb_array_length(p_bands) NOT BETWEEN 2 AND 10
       OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(p_bands) band
            WHERE jsonb_typeof(band -> 'minBasisPoints') <> 'number'
               OR (band ->> 'minBasisPoints')::integer NOT BETWEEN 0 AND 10000
               OR length(trim(COALESCE(band ->> 'label', ''))) NOT BETWEEN 1 AND 24
       )
       OR NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(p_bands) band
            WHERE (band ->> 'minBasisPoints')::integer = 0
       )
       OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(p_bands) band
            GROUP BY (band ->> 'minBasisPoints')::integer HAVING count(*) > 1
       ) THEN
        RETURN QUERY SELECT 'invalid_scheme'::varchar, NULL::uuid, NULL::integer;
        RETURN;
    END IF;
    SELECT COALESCE(max(version.version_number), 0) + 1 INTO v_version
      FROM public.grading_scheme_versions version WHERE version.school_id = v_school;
    INSERT INTO public.grading_scheme_versions (
        tenant_id, school_id, version_number, title, bands, published_by_principal_id
    ) VALUES (
        v_access.tenant_id, v_school, v_version, trim(p_title), p_bands, p_principal_id
    ) RETURNING id INTO v_id;
    INSERT INTO public.classroom_grading_schemes (
        tenant_id, classroom_id, grading_scheme_version_id, assigned_by_principal_id
    ) VALUES (v_access.tenant_id, p_classroom_id, v_id, p_principal_id)
    ON CONFLICT (classroom_id) DO UPDATE
       SET grading_scheme_version_id = EXCLUDED.grading_scheme_version_id,
           assigned_by_principal_id = EXCLUDED.assigned_by_principal_id,
           assigned_at = now();
    RETURN QUERY SELECT 'ok'::varchar, v_id, v_version;
END;
$$;

CREATE OR REPLACE FUNCTION grading_scheme_for_classroom(
    p_account_id uuid, p_classroom_id uuid
)
RETURNS TABLE (title varchar, version_number integer, bands jsonb, published_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT version.title, version.version_number, version.bands, version.published_at
      FROM public.classroom_grading_schemes assigned
      JOIN public.grading_scheme_versions version ON version.id = assigned.grading_scheme_version_id
     WHERE assigned.classroom_id = p_classroom_id
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships membership
            WHERE membership.account_id = p_account_id
              AND membership.classroom_id = p_classroom_id
              AND membership.member_role IN ('owner', 'co_teacher')
       );
$$;

CREATE OR REPLACE FUNCTION grade_label_for_classroom(p_classroom_id uuid, p_percentage integer)
RETURNS varchar
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT band ->> 'label'
      FROM public.classroom_grading_schemes assigned
      JOIN public.grading_scheme_versions version ON version.id = assigned.grading_scheme_version_id
      CROSS JOIN LATERAL jsonb_array_elements(version.bands) band
     WHERE assigned.classroom_id = p_classroom_id
       AND (band ->> 'minBasisPoints')::integer <= p_percentage
     ORDER BY (band ->> 'minBasisPoints')::integer DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION gradebook_history_list(
    p_account_id uuid, p_classroom_id uuid, p_assignment_id uuid, p_seat_id uuid
)
RETURNS TABLE (
    event_id uuid, event_kind varchar, reason varchar, snapshot jsonb,
    actor_display_name varchar, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT event.id, event.event_kind, event.reason, event.snapshot,
           profile.display_name, event.created_at
      FROM public.gradebook_entries grade
      JOIN public.grade_change_events event ON event.gradebook_entry_id = grade.id
      JOIN public.principals principal ON principal.id = event.actor_principal_id
      LEFT JOIN public.profiles profile ON profile.account_id = principal.account_id
     WHERE grade.classroom_id = p_classroom_id
       AND grade.classroom_assignment_id = p_assignment_id
       AND grade.seat_id = p_seat_id
       AND EXISTS (
           SELECT 1 FROM public.classroom_memberships membership
            WHERE membership.account_id = p_account_id
              AND membership.classroom_id = p_classroom_id
              AND membership.member_role IN ('owner', 'co_teacher')
       )
     ORDER BY event.created_at DESC, event.id DESC;
$$;

CREATE OR REPLACE FUNCTION learning_results_for_seat(p_seat_id uuid)
RETURNS TABLE (
    classroom_title varchar, assignment_id uuid, assignment_title varchar,
    attempt_number integer, state varchar, raw_points integer, max_points integer,
    percentage_basis_points integer, display_grade varchar, outcome varchar,
    feedback varchar, published_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT classroom.title, assignment.id,
           COALESCE(task.title, lesson.assignment_title, quiz.title),
           attempt.attempt_number, attempt.state, result.raw_points, result.max_points,
           result.percentage_basis_points,
           COALESCE(public.grade_label_for_classroom(
               assignment.classroom_id, result.percentage_basis_points
           ), CASE result.outcome WHEN 'passed' THEN 'Зачёт' WHEN 'failed' THEN 'Не зачтено' END),
           result.outcome, result.feedback, result.published_at
      FROM public.gradebook_entries grade
      JOIN public.classroom_student_seats seat ON seat.id = grade.seat_id
      JOIN public.classrooms classroom ON classroom.id = grade.classroom_id
      JOIN public.classroom_assignments assignment ON assignment.id = grade.classroom_assignment_id
      JOIN public.learning_attempts attempt ON attempt.id = grade.accepted_attempt_id
      JOIN public.assessment_results result ON result.id = grade.assessment_result_id
      LEFT JOIN public.teacher_assignments task ON task.id = assignment.assignment_id
      LEFT JOIN public.classroom_course_run_lessons lesson ON lesson.classroom_assignment_id = assignment.id
      LEFT JOIN public.quiz_versions quiz ON quiz.id = assignment.quiz_version_id
     WHERE grade.seat_id = p_seat_id AND seat.status = 'active'
     ORDER BY result.published_at DESC, assignment.id;
$$;

CREATE OR REPLACE FUNCTION learning_results_for_account(p_account_id uuid)
RETURNS TABLE (
    classroom_title varchar, assignment_id uuid, assignment_title varchar,
    attempt_number integer, state varchar, raw_points integer, max_points integer,
    percentage_basis_points integer, display_grade varchar, outcome varchar,
    feedback varchar, published_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT result.* FROM public.classroom_student_seats seat
      CROSS JOIN LATERAL public.learning_results_for_seat(seat.id) result
     WHERE seat.account_id = p_account_id AND seat.status = 'active'
     ORDER BY result.published_at DESC, result.assignment_id;
$$;

REVOKE ALL ON grading_scheme_versions, classroom_grading_schemes FROM PUBLIC, asalab_app;
ALTER TABLE grading_scheme_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_scheme_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE classroom_grading_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_grading_schemes FORCE ROW LEVEL SECURITY;
CREATE POLICY grading_scheme_versions_tenant ON grading_scheme_versions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY classroom_grading_schemes_tenant ON classroom_grading_schemes
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE ALL ON FUNCTION grading_scheme_publish(uuid, uuid, uuid, varchar, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION grading_scheme_for_classroom(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION grade_label_for_classroom(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION gradebook_history_list(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_results_for_seat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_results_for_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grading_scheme_publish(uuid, uuid, uuid, varchar, jsonb) TO asalab_app;
GRANT EXECUTE ON FUNCTION grading_scheme_for_classroom(uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION gradebook_history_list(uuid, uuid, uuid, uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_results_for_seat(uuid) TO asalab_app;
GRANT EXECUTE ON FUNCTION learning_results_for_account(uuid) TO asalab_app;
