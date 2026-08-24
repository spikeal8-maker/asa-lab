-- ASA Learning M0 additive identity and migration provenance foundation.
--
-- This migration creates no learner mappings and performs no data backfill.
-- The owner-only operations are defined separately in 0087 and must be invoked
-- explicitly against an isolated/test database for LRN-M0-006 evidence.

CREATE TABLE learning_migration_batches (
    id                     uuid PRIMARY KEY,
    tenant_id              uuid NOT NULL REFERENCES tenants(id),
    school_id              uuid NOT NULL,
    batch_key              varchar(160) NOT NULL,
    operation_kind         varchar(48) NOT NULL,
    mode                   varchar(16) NOT NULL,
    state                  varchar(16) NOT NULL DEFAULT 'active',
    source_snapshot_digest varchar(64) NOT NULL,
    as_of                  timestamptz NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    completed_at           timestamptz,
    disabled_at            timestamptz,
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, school_id, id),
    UNIQUE (tenant_id, school_id, batch_key),
    FOREIGN KEY (tenant_id, school_id) REFERENCES schools(tenant_id, id),
    CONSTRAINT learning_migration_batches_operation_check
        CHECK (operation_kind = 'm0_identity_activity_convergence'),
    CONSTRAINT learning_migration_batches_mode_check
        CHECK (mode IN ('automatic', 'manual')),
    CONSTRAINT learning_migration_batches_state_check
        CHECK (state IN ('active', 'disabled', 'rolled_back')),
    CONSTRAINT learning_migration_batches_digest_check
        CHECK (source_snapshot_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT learning_migration_batches_lifecycle_check CHECK (
        (state = 'active' AND disabled_at IS NULL)
        OR (state <> 'active' AND disabled_at IS NOT NULL)
    )
);

CREATE INDEX learning_migration_batches_school_state_idx
    ON learning_migration_batches (tenant_id, school_id, state, created_at DESC);

CREATE TABLE learner_identities (
    id                  uuid PRIMARY KEY,
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    school_id           uuid NOT NULL,
    state               varchar(16) NOT NULL DEFAULT 'active',
    created_by_batch_id uuid,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, school_id) REFERENCES schools(tenant_id, id),
    FOREIGN KEY (tenant_id, created_by_batch_id)
        REFERENCES learning_migration_batches(tenant_id, id),
    CONSTRAINT learner_identities_state_check CHECK (state IN ('active', 'inactive'))
);

CREATE INDEX learner_identities_school_state_idx
    ON learner_identities (tenant_id, school_id, state, id);

CREATE TABLE learner_identity_links (
    id                  uuid PRIMARY KEY,
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    school_id           uuid NOT NULL,
    learner_identity_id uuid NOT NULL,
    link_kind           varchar(16) NOT NULL,
    seat_id             uuid REFERENCES classroom_student_seats(id),
    account_id          uuid REFERENCES accounts(id),
    status              varchar(16) NOT NULL DEFAULT 'active',
    created_by_batch_id uuid,
    created_at          timestamptz NOT NULL DEFAULT now(),
    disabled_at         timestamptz,
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, school_id, learner_identity_id)
        REFERENCES learner_identities(tenant_id, school_id, id),
    FOREIGN KEY (tenant_id, created_by_batch_id)
        REFERENCES learning_migration_batches(tenant_id, id),
    CONSTRAINT learner_identity_links_kind_check
        CHECK (link_kind IN ('student_seat', 'account')),
    CONSTRAINT learner_identity_links_subject_check CHECK (
        (link_kind = 'student_seat' AND seat_id IS NOT NULL AND account_id IS NULL)
        OR (link_kind = 'account' AND account_id IS NOT NULL AND seat_id IS NULL)
    ),
    CONSTRAINT learner_identity_links_status_check
        CHECK (status IN ('active', 'inactive')),
    CONSTRAINT learner_identity_links_lifecycle_check CHECK (
        (status = 'active' AND disabled_at IS NULL)
        OR (status = 'inactive' AND disabled_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX learner_identity_links_one_seat_idx
    ON learner_identity_links (seat_id) WHERE seat_id IS NOT NULL;
CREATE UNIQUE INDEX learner_identity_links_one_school_account_idx
    ON learner_identity_links (school_id, account_id) WHERE account_id IS NOT NULL;
CREATE INDEX learner_identity_links_learner_idx
    ON learner_identity_links (tenant_id, school_id, learner_identity_id, status);

CREATE TABLE learning_migration_artifacts (
    id             uuid PRIMARY KEY,
    tenant_id      uuid NOT NULL REFERENCES tenants(id),
    school_id      uuid NOT NULL,
    batch_id       uuid NOT NULL,
    artifact_kind  varchar(32) NOT NULL,
    artifact_id    uuid,
    source_table   varchar(64) NOT NULL,
    source_id      uuid NOT NULL,
    operation_type varchar(48) NOT NULL,
    operation_mode varchar(16) NOT NULL,
    source_evidence jsonb NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    disabled_at    timestamptz,
    UNIQUE (tenant_id, id),
    UNIQUE (batch_id, artifact_kind, source_table, source_id, operation_type),
    FOREIGN KEY (tenant_id, school_id, batch_id)
        REFERENCES learning_migration_batches(tenant_id, school_id, id),
    CONSTRAINT learning_migration_artifacts_kind_check CHECK (
        artifact_kind IN (
            'learner_identity', 'identity_link', 'learning_activity',
            'activity_version', 'activity_mapping', 'attempt', 'submission',
            'existing_exact_submission', 'legacy_unresolved', 'legacy_feedback'
        )
    ),
    CONSTRAINT learning_migration_artifacts_mode_check
        CHECK (operation_mode IN ('automatic', 'manual')),
    CONSTRAINT learning_migration_artifacts_source_check
        CHECK (length(trim(source_table)) > 0 AND length(trim(operation_type)) > 0),
    CONSTRAINT learning_migration_artifacts_evidence_check
        CHECK (jsonb_typeof(source_evidence) = 'object')
);

CREATE INDEX learning_migration_artifacts_batch_idx
    ON learning_migration_artifacts (tenant_id, school_id, batch_id, disabled_at);
CREATE INDEX learning_migration_artifacts_source_idx
    ON learning_migration_artifacts (source_table, source_id, artifact_kind);

ALTER TABLE learning_attempts
    ADD COLUMN learner_identity_id uuid;
ALTER TABLE learning_attempts
    ADD CONSTRAINT learning_attempts_learner_identity_fkey
    FOREIGN KEY (tenant_id, learner_identity_id)
    REFERENCES learner_identities(tenant_id, id);

CREATE INDEX learning_attempts_learner_identity_idx
    ON learning_attempts (tenant_id, learner_identity_id, classroom_assignment_id)
    WHERE learner_identity_id IS NOT NULL;

-- Classroom evidence belongs to the classroom tenant, while an Account-owned
-- personal project may remain in the Account's home tenant. Store the project
-- lineage explicitly instead of forcing it into the classroom tenant.
ALTER TABLE learning_submissions
    ADD COLUMN project_tenant_id uuid;

ALTER TABLE learning_submissions DISABLE TRIGGER learning_submissions_immutable;
UPDATE learning_submissions submission
   SET project_tenant_id = project.tenant_id
  FROM projects project
 WHERE project.id = submission.project_id;
ALTER TABLE learning_submissions ENABLE TRIGGER learning_submissions_immutable;

ALTER TABLE learning_submissions
    DROP CONSTRAINT IF EXISTS learning_submissions_tenant_id_project_id_fkey;
ALTER TABLE learning_submissions
    ADD CONSTRAINT learning_submissions_project_scope_check CHECK (
        (project_id IS NULL AND project_version_id IS NULL AND project_tenant_id IS NULL)
        OR (project_id IS NOT NULL AND project_version_id IS NOT NULL
                                   AND project_tenant_id IS NOT NULL)
    ),
    ADD CONSTRAINT learning_submissions_project_tenant_fkey
        FOREIGN KEY (project_tenant_id, project_id)
        REFERENCES projects(tenant_id, id);

CREATE OR REPLACE FUNCTION learning_submission_project_scope_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_project_tenant uuid;
BEGIN
    IF NEW.project_id IS NULL THEN
        IF NEW.project_version_id IS NOT NULL OR NEW.project_tenant_id IS NOT NULL THEN
            RAISE EXCEPTION 'submission project lineage is incomplete';
        END IF;
        RETURN NEW;
    END IF;

    SELECT project.tenant_id INTO v_project_tenant
      FROM public.projects project
     WHERE project.id = NEW.project_id;
    IF v_project_tenant IS NULL THEN
        RAISE EXCEPTION 'submission project does not exist';
    END IF;
    IF NEW.project_tenant_id IS NULL THEN
        NEW.project_tenant_id := v_project_tenant;
    ELSIF NEW.project_tenant_id <> v_project_tenant THEN
        RAISE EXCEPTION 'submission project tenant lineage is incoherent';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.project_versions version
         WHERE version.tenant_id = NEW.project_tenant_id
           AND version.project_id = NEW.project_id
           AND version.id = NEW.project_version_id
    ) THEN
        RAISE EXCEPTION 'submission project version lineage is incoherent';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER learning_submissions_project_scope_guard
    BEFORE INSERT OR UPDATE OF project_id, project_version_id, project_tenant_id
    ON learning_submissions
    FOR EACH ROW EXECUTE FUNCTION learning_submission_project_scope_guard();

CREATE OR REPLACE FUNCTION learner_identity_key_immutable()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.id <> OLD.id
       OR NEW.tenant_id <> OLD.tenant_id
       OR NEW.school_id <> OLD.school_id THEN
        RAISE EXCEPTION 'learner identity key and school lineage are immutable';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER learner_identities_key_immutable
    BEFORE UPDATE ON learner_identities
    FOR EACH ROW EXECUTE FUNCTION learner_identity_key_immutable();

CREATE OR REPLACE FUNCTION learner_identity_link_scope_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_school uuid;
BEGIN
    IF TG_OP = 'UPDATE' AND (
        NEW.id <> OLD.id
        OR NEW.tenant_id <> OLD.tenant_id
        OR NEW.school_id <> OLD.school_id
        OR NEW.learner_identity_id <> OLD.learner_identity_id
        OR NEW.link_kind <> OLD.link_kind
        OR NEW.seat_id IS DISTINCT FROM OLD.seat_id
        OR NEW.account_id IS DISTINCT FROM OLD.account_id
    ) THEN
        RAISE EXCEPTION 'learner identity link subject and lineage are immutable';
    END IF;

    IF NEW.link_kind = 'student_seat' THEN
        SELECT seat.tenant_id, classroom.school_id
          INTO v_tenant, v_school
          FROM public.classroom_student_seats seat
          JOIN public.classrooms classroom
            ON classroom.tenant_id = seat.tenant_id
           AND classroom.id = seat.classroom_id
         WHERE seat.id = NEW.seat_id;
        IF v_tenant IS NULL
           OR v_tenant <> NEW.tenant_id
           OR v_school <> NEW.school_id THEN
            RAISE EXCEPTION 'student seat does not belong to learner school scope';
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1
              FROM public.classroom_student_seats seat
              JOIN public.classrooms classroom
                ON classroom.tenant_id = seat.tenant_id
               AND classroom.id = seat.classroom_id
             WHERE seat.account_id = NEW.account_id
               AND seat.tenant_id = NEW.tenant_id
               AND classroom.school_id = NEW.school_id
        ) THEN
            RAISE EXCEPTION 'account link lacks persisted seat evidence in learner school scope';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER learner_identity_links_scope_guard
    BEFORE INSERT OR UPDATE ON learner_identity_links
    FOR EACH ROW EXECUTE FUNCTION learner_identity_link_scope_guard();

CREATE OR REPLACE FUNCTION learning_attempt_learner_scope_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.learner_identity_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM public.classrooms classroom
          JOIN public.learner_identities learner
            ON learner.tenant_id = classroom.tenant_id
           AND learner.school_id = classroom.school_id
           AND learner.id = NEW.learner_identity_id
         WHERE classroom.tenant_id = NEW.tenant_id
           AND classroom.id = NEW.classroom_id
    ) THEN
        RAISE EXCEPTION 'attempt learner does not belong to classroom school scope';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER learning_attempts_learner_scope_guard
    BEFORE INSERT OR UPDATE OF tenant_id, classroom_id, learner_identity_id
    ON learning_attempts
    FOR EACH ROW EXECUTE FUNCTION learning_attempt_learner_scope_guard();

REVOKE ALL ON learning_migration_batches, learner_identities,
    learner_identity_links, learning_migration_artifacts FROM PUBLIC, asalab_app;

ALTER TABLE learning_migration_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_migration_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE learner_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE learner_identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_identity_links FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_migration_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_migration_artifacts FORCE ROW LEVEL SECURITY;

CREATE POLICY learning_migration_batches_tenant ON learning_migration_batches
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY learner_identities_tenant ON learner_identities
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY learner_identity_links_tenant ON learner_identity_links
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY learning_migration_artifacts_tenant ON learning_migration_artifacts
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE ALL ON FUNCTION learner_identity_key_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION learner_identity_link_scope_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_attempt_learner_scope_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION learning_submission_project_scope_guard() FROM PUBLIC;
