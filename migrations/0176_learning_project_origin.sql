-- A4-1: durable, append-preserved origin for new canonical learner projects.
-- Historical projects are deliberately not inferred or backfilled.
CREATE TABLE learning_project_origins (
    project_id                   uuid PRIMARY KEY,
    project_tenant_id            uuid NOT NULL,
    participation_id            uuid NOT NULL UNIQUE,
    school_tenant_id             uuid NOT NULL,
    school_id                    uuid NOT NULL,
    learner_identity_id          uuid NOT NULL,
    activity_run_id              uuid NOT NULL,
    learning_activity_version_id uuid NOT NULL,
    source_kind                  varchar(16) NOT NULL,
    source_course_run_id         uuid,
    source_course_lesson_id      uuid,
    source_course_block_id       varchar(80),
    owner_principal_id           uuid NOT NULL,
    created_at                   timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (project_tenant_id, project_id)
        REFERENCES projects(tenant_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (school_tenant_id, school_id, participation_id)
        REFERENCES activity_participations(tenant_id, school_id, id),
    FOREIGN KEY (school_tenant_id, school_id, activity_run_id)
        REFERENCES activity_runs(tenant_id, school_id, id),
    FOREIGN KEY (school_tenant_id, school_id, learner_identity_id)
        REFERENCES learner_identities(tenant_id, school_id, id),
    FOREIGN KEY (school_tenant_id, learning_activity_version_id)
        REFERENCES learning_activity_versions(tenant_id, id),
    FOREIGN KEY (owner_principal_id) REFERENCES principals(id),
    CONSTRAINT learning_project_origins_source_kind_check
        CHECK (source_kind IN ('direct', 'course')),
    CONSTRAINT learning_project_origins_source_shape_check CHECK (
        (source_kind = 'direct' AND source_course_run_id IS NULL
         AND source_course_lesson_id IS NULL AND source_course_block_id IS NULL)
        OR (source_kind = 'course' AND source_course_run_id IS NOT NULL
            AND source_course_lesson_id IS NOT NULL)
    )
);

CREATE INDEX learning_project_origins_participation_scope_idx
    ON learning_project_origins(school_tenant_id, school_id, learner_identity_id);

CREATE FUNCTION learning_project_origin_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_project record;
    v_participation record;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'learning project origin is immutable';
    END IF;

    SELECT project.tenant_id, project.owner_principal_id, project.module_key,
           project.project_scope, project.copied_from_project_id
      INTO v_project
      FROM public.projects project WHERE project.id = NEW.project_id;
    IF v_project.tenant_id IS NULL OR v_project.tenant_id <> NEW.project_tenant_id
       OR v_project.owner_principal_id IS DISTINCT FROM NEW.owner_principal_id
       OR v_project.project_scope <> 'personal'
       OR v_project.copied_from_project_id IS NOT NULL THEN
        RAISE EXCEPTION 'learning project origin project lineage is incoherent';
    END IF;

    SELECT participation.tenant_id, participation.school_id,
           participation.learner_identity_id, participation.activity_run_id,
           run.classroom_id, run.learning_activity_version_id,
           run.source_kind, run.source_course_run_id,
           run.source_course_lesson_id, run.source_course_block_id,
           version.module_key
      INTO v_participation
      FROM public.activity_participations participation
      JOIN public.activity_runs run
        ON run.tenant_id = participation.tenant_id
       AND run.school_id = participation.school_id
       AND run.id = participation.activity_run_id
      JOIN public.learning_activity_versions version
        ON version.tenant_id = run.tenant_id
       AND version.id = run.learning_activity_version_id
     WHERE participation.id = NEW.participation_id;
    IF v_participation.tenant_id IS NULL
       OR v_participation.tenant_id <> NEW.school_tenant_id
       OR v_participation.school_id <> NEW.school_id
       OR v_participation.learner_identity_id <> NEW.learner_identity_id
       OR v_participation.activity_run_id <> NEW.activity_run_id
       OR v_participation.learning_activity_version_id <> NEW.learning_activity_version_id
       OR v_participation.source_kind <> NEW.source_kind
       OR v_participation.source_course_run_id IS DISTINCT FROM NEW.source_course_run_id
       OR v_participation.source_course_lesson_id IS DISTINCT FROM NEW.source_course_lesson_id
       OR v_participation.source_course_block_id IS DISTINCT FROM NEW.source_course_block_id
       OR v_participation.module_key <> v_project.module_key THEN
        RAISE EXCEPTION 'learning project origin participation/run/version lineage is incoherent';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.principals principal
          JOIN public.classroom_student_seats seat
            ON (principal.kind = 'student_seat' AND principal.seat_id = seat.id)
            OR (principal.kind = 'account' AND principal.account_id = seat.account_id)
          JOIN public.learner_identity_links link
            ON link.seat_id = seat.id AND link.link_kind = 'student_seat'
           AND link.status = 'active'
         WHERE principal.id = NEW.owner_principal_id
           AND seat.tenant_id = NEW.school_tenant_id
           AND seat.classroom_id = v_participation.classroom_id
           AND seat.status = 'active'
           AND link.tenant_id = NEW.school_tenant_id
           AND link.school_id = NEW.school_id
           AND link.learner_identity_id = NEW.learner_identity_id
    ) THEN
        RAISE EXCEPTION 'learning project origin owner/learner lineage is incoherent';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER learning_project_origins_guard
    BEFORE INSERT OR UPDATE OR DELETE ON learning_project_origins
    FOR EACH ROW EXECUTE FUNCTION learning_project_origin_guard();

CREATE FUNCTION learning_project_origin_project_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF (NEW.tenant_id, NEW.owner_principal_id, NEW.module_key,
        NEW.project_scope, NEW.copied_from_project_id)
       IS DISTINCT FROM
       (OLD.tenant_id, OLD.owner_principal_id, OLD.module_key,
        OLD.project_scope, OLD.copied_from_project_id)
       AND EXISTS (SELECT 1 FROM public.learning_project_origins origin
                   WHERE origin.project_id = OLD.id) THEN
        RAISE EXCEPTION 'learning project origin project identity is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER projects_learning_origin_identity_guard
    BEFORE UPDATE OF tenant_id, owner_principal_id, module_key,
                     project_scope, copied_from_project_id ON projects
    FOR EACH ROW EXECUTE FUNCTION learning_project_origin_project_guard();

REVOKE ALL ON learning_project_origins FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION learning_project_origin_guard() FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION learning_project_origin_project_guard() FROM PUBLIC, asalab_app;
ALTER TABLE learning_project_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_project_origins FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_project_origins_tenant ON learning_project_origins
    USING (school_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
           OR project_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (school_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
