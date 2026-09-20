-- E1-FIX-11D1: Activity occurrence identity foundation.
-- Existing course-origin ActivityRuns remain lesson-level occurrences with a NULL block identity.

ALTER TABLE activity_runs
    ADD COLUMN source_course_block_id varchar(80);

ALTER TABLE activity_runs
    ADD CONSTRAINT activity_runs_source_course_block_shape_check
    CHECK (
        source_course_block_id IS NULL
        OR (
            source_kind = 'course'
            AND source_course_block_id ~ '^[A-Za-z0-9_-]{1,80}$'
        )
    );

ALTER TABLE activity_runs
    DROP CONSTRAINT activity_runs_source_classroom_assignment_id_key;

DROP INDEX activity_runs_course_lesson_once_idx;

CREATE UNIQUE INDEX activity_runs_legacy_assignment_once_idx
    ON activity_runs (source_classroom_assignment_id)
    WHERE source_course_block_id IS NULL;

CREATE UNIQUE INDEX activity_runs_course_legacy_lesson_once_idx
    ON activity_runs (source_course_run_id, source_course_lesson_id)
    WHERE source_kind = 'course' AND source_course_block_id IS NULL;

CREATE UNIQUE INDEX activity_runs_course_block_once_idx
    ON activity_runs (
        source_course_run_id,
        source_course_lesson_id,
        source_course_block_id
    )
    WHERE source_kind = 'course' AND source_course_block_id IS NOT NULL;

CREATE OR REPLACE FUNCTION activity_run_source_course_block_identity_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.source_course_block_id IS DISTINCT FROM OLD.source_course_block_id THEN
        RAISE EXCEPTION 'activity run source course block identity is immutable';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION activity_run_source_course_block_identity_guard()
    FROM PUBLIC, asalab_app;

CREATE TRIGGER activity_runs_source_course_block_identity_guard
    BEFORE UPDATE OF source_course_block_id ON activity_runs
    FOR EACH ROW EXECUTE FUNCTION activity_run_source_course_block_identity_guard();
