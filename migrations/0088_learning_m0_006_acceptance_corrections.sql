-- LRN-M0-006 acceptance corrections.
--
-- 0087 is already published and therefore remains checksum-immutable. This
-- migration replaces its owner-only convergence procedure with a fail-closed
-- definition. Timestamp proximity is not submission linkage, compatibility
-- snapshots are not reusable authored content, and no legacy Attempt or
-- Submission may be created before the M0-007 reader cutover.

CREATE TABLE learning_migration_compatibility_activity_versions (
    tenant_id                    uuid NOT NULL REFERENCES tenants(id),
    classroom_assignment_id      uuid PRIMARY KEY,
    learning_activity_version_id uuid NOT NULL,
    source_batch_id               uuid NOT NULL,
    grading_semantics             varchar(16) NOT NULL DEFAULT 'unknown',
    reusable_authored_content     boolean NOT NULL DEFAULT false,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, learning_activity_version_id),
    FOREIGN KEY (tenant_id, classroom_assignment_id)
        REFERENCES classroom_assignments(tenant_id, id),
    FOREIGN KEY (tenant_id, learning_activity_version_id)
        REFERENCES learning_activity_versions(tenant_id, id),
    FOREIGN KEY (tenant_id, source_batch_id)
        REFERENCES learning_migration_batches(tenant_id, id),
    CONSTRAINT learning_migration_compatibility_grading_check
        CHECK (grading_semantics = 'unknown'),
    CONSTRAINT learning_migration_compatibility_reuse_check
        CHECK (reusable_authored_content = false)
);

ALTER TABLE learning_migration_compatibility_activity_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_migration_compatibility_activity_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON learning_migration_compatibility_activity_versions FROM PUBLIC, asalab_app;
CREATE POLICY learning_migration_compatibility_activity_versions_tenant
    ON learning_migration_compatibility_activity_versions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $migration$
DECLARE
    v_definition text;
    v_start integer;
    v_finish integer;
    v_original text;
BEGIN
    -- 0087 may already have persisted deterministic compatibility versions
    -- carrying its invented 100/60 grading policy. ActivityVersion rows are
    -- immutable, so 0088 must not merely relabel those rows in the registry.
    -- Such a database needs an explicit reader-aware remediation that replaces
    -- the mapping without rewriting immutable history.
    IF EXISTS (
        SELECT 1
          FROM classroom_activity_versions mapping
          JOIN learning_activity_versions version
            ON version.tenant_id = mapping.tenant_id
           AND version.id = mapping.learning_activity_version_id
         WHERE mapping.learning_activity_version_id = public.learning_m0_deterministic_uuid(
                   'activity-version:assignment:' || mapping.classroom_assignment_id
               )
           AND (
               version.max_points = 100
               OR version.scoring_policy @> '{"passThreshold":60}'::jsonb
               OR version.scoring_policy @> '{"kind":"manual"}'::jsonb
           )
    ) THEN
        RAISE EXCEPTION
            'M0-006 correction blocked: 0087 compatibility ActivityVersions with inferred grading semantics exist; reader-aware immutable-version remediation is required before 0088';
    END IF;

    -- A database that already ran the unsafe timestamp-only evidence branch
    -- requires an explicit, reader-aware remediation. Do not silently relabel
    -- immutable history during a schema migration.
    IF EXISTS (
        SELECT 1
          FROM learning_migration_artifacts
         WHERE operation_type IN ('backfill_exact_attempt', 'backfill_exact_submission')
    ) THEN
        RAISE EXCEPTION
            'M0-006 correction blocked: timestamp-derived Attempt/Submission artifacts exist; reader-aware remediation is required before 0088';
    END IF;

    SELECT pg_get_functiondef(
        'learning_m0_convergence_apply(character varying,uuid,character varying,timestamp with time zone)'::regprocedure
    ) INTO v_definition;
    v_original := v_definition;

    -- Direct SQL invocation is disabled unless the caller first proves that
    -- the connected database is the isolated test target verified by the
    -- migration/backfill tooling.
    v_definition := replace(
        v_definition,
        E'BEGIN\n    IF p_batch_key IS NULL',
        E'BEGIN\n    IF current_setting(''app.learning_m0_006_environment'', true) IS DISTINCT FROM ''isolated_test'' THEN\n        RAISE EXCEPTION ''LRN-M0-006 convergence is restricted to an attested isolated test database'';\n    END IF;\n    IF p_batch_key IS NULL'
    );
    IF v_definition = v_original THEN
        RAISE EXCEPTION 'M0-006 correction could not install the database environment guard';
    END IF;

    v_original := v_definition;
    v_definition := replace(
        v_definition,
        E'source.module_key, 100,\n           ''{"kind":"manual","scale":"integer","passThreshold":60}''::jsonb,',
        E'source.module_key, 1,\n           ''{"kind":"migration_compatibility","gradingSemantics":"unknown","reusableAuthoredContent":false}''::jsonb,'
    );
    IF v_definition = v_original THEN
        RAISE EXCEPTION 'M0-006 correction could not remove inferred grading semantics';
    END IF;

    v_definition := replace(
        v_definition,
        E'source.instructions, source.module_key, ''100'')',
        E'source.instructions, source.module_key, ''migration-compatibility-ungraded-v1'')'
    );

    -- Remove the 0087 timestamp-only ProjectVersion reconstruction branch.
    -- The replacement records compatibility provenance and leaves every
    -- legacy-only submitted row as legacy_unresolved.
    v_start := strpos(v_definition, '    -- Exact immutable evidence backfill.');
    v_finish := strpos(v_definition, '    -- Existing exact canonical submissions');
    IF v_start = 0 OR v_finish = 0 OR v_finish <= v_start THEN
        RAISE EXCEPTION 'M0-006 correction could not locate the unsafe exact-evidence branch';
    END IF;
    v_definition := substr(v_definition, 1, v_start - 1) || $replacement$
    -- Compatibility ActivityVersions are frozen assignment snapshots only.
    -- They carry no inferred grade scale and are not reusable authored content.
    INSERT INTO public.learning_migration_compatibility_activity_versions (
        tenant_id, classroom_assignment_id, learning_activity_version_id,
        source_batch_id, grading_semantics, reusable_authored_content
    )
    SELECT mapping.tenant_id, mapping.classroom_assignment_id,
           mapping.learning_activity_version_id, v_batch, 'unknown', false
      FROM public.classroom_activity_versions mapping
      JOIN public.classroom_assignments assignment
        ON assignment.tenant_id = mapping.tenant_id
       AND assignment.id = mapping.classroom_assignment_id
      JOIN public.classrooms classroom
        ON classroom.tenant_id = assignment.tenant_id
       AND classroom.id = assignment.classroom_id
     WHERE mapping.tenant_id = v_tenant
       AND classroom.school_id = p_school_id
       AND mapping.learning_activity_version_id = public.learning_m0_deterministic_uuid(
           'activity-version:assignment:' || mapping.classroom_assignment_id
       )
    ON CONFLICT (classroom_assignment_id) DO UPDATE
       SET source_batch_id = EXCLUDED.source_batch_id,
           grading_semantics = 'unknown',
           reusable_authored_content = false;

    -- Timestamp order, project ownership and a single ProjectVersion are only
    -- circumstantial provenance. Without a persisted submission-to-version
    -- linkage they cannot create immutable Attempt/Submission history.

$replacement$ || substr(v_definition, v_finish);

    EXECUTE v_definition;
END;
$migration$;

COMMENT ON TABLE learning_migration_compatibility_activity_versions IS
    'M0 migration-only assignment snapshots. Never canonical reusable authored content; grading semantics are unknown.';
