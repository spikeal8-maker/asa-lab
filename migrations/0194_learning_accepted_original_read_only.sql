-- A5-A3: an accepted/completed original is a reader, not a generic editor.
-- All generic editor writes consult the same origin policy used by status,
-- duplicate and Gallery. A missing legacy source cannot prove edit eligibility.
CREATE OR REPLACE FUNCTION public.learning_original_project_action_allowed(
    p_project_id uuid, p_action text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_participation_id uuid;
    v_assignment_id uuid;
    v_seat_id uuid;
    v_legacy_submitted_at timestamptz;
    v_attempt record;
    v_decision varchar;
BEGIN
    IF p_action IN ('generic_status', 'gallery_publish', 'generic_duplicate') THEN
        RETURN NOT EXISTS (
            SELECT 1 FROM public.learning_project_origins origin
             WHERE origin.project_id = p_project_id
        ) AND NOT EXISTS (
            SELECT 1 FROM public.learning_legacy_project_origins origin
             WHERE origin.project_id = p_project_id
        ) AND NOT EXISTS (
            SELECT 1 FROM public.classroom_assignment_work work
             WHERE work.project_id = p_project_id
        );
    ELSIF p_action = 'attach_learning' THEN
        RETURN EXISTS (
            SELECT 1 FROM public.projects project
             WHERE project.id = p_project_id AND project.status = 'active'
        ) AND NOT EXISTS (
            SELECT 1 FROM public.project_publication_state publication
             WHERE publication.project_id = p_project_id
               AND publication.state IN ('public', 'unlisted')
        ) AND NOT EXISTS (
            SELECT 1 FROM public.project_publications publication
             WHERE publication.project_id = p_project_id
        );
    ELSIF p_action <> 'editor_write' THEN
        RETURN false;
    END IF;

    SELECT origin.participation_id INTO v_participation_id
      FROM public.learning_project_origins origin
     WHERE origin.project_id = p_project_id;
    IF v_participation_id IS NOT NULL THEN
        SELECT attempt.id, attempt.state INTO v_attempt
          FROM public.learning_attempts attempt
         WHERE attempt.activity_participation_id = v_participation_id
         ORDER BY attempt.attempt_number DESC, attempt.id DESC LIMIT 1;
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM public.learning_legacy_project_origins origin
             WHERE origin.project_id = p_project_id
        ) THEN
            -- Ordinary personal and classroom projects retain their editor.
            RETURN true;
        END IF;
        SELECT work.assignment_id, work.seat_id, work.submitted_at
          INTO v_assignment_id, v_seat_id, v_legacy_submitted_at
          FROM public.learning_legacy_project_origins origin
          JOIN public.classroom_assignment_work work
            ON work.id = origin.source_work_id AND work.project_id = origin.project_id
         WHERE origin.project_id = p_project_id;
        IF v_assignment_id IS NULL THEN RETURN false; END IF;
        SELECT attempt.id, attempt.state INTO v_attempt
          FROM public.learning_attempts attempt
         WHERE attempt.classroom_assignment_id = v_assignment_id
           AND attempt.seat_id = v_seat_id
         ORDER BY attempt.attempt_number DESC, attempt.id DESC LIMIT 1;
    END IF;

    IF v_attempt.id IS NULL THEN
        -- Atomic Start must have a canonical Attempt. Legacy compatibility is
        -- different: its proven work row is in_progress when not submitted,
        -- and submitted otherwise (LRN M0 canonical state precedence §5).
        RETURN v_participation_id IS NULL AND v_legacy_submitted_at IS NULL;
    END IF;
    IF v_attempt.state = 'in_progress' THEN RETURN true; END IF;
    IF v_attempt.state <> 'closed' THEN RETURN false; END IF;
    SELECT result.review_decision INTO v_decision
      FROM public.assessment_results result
     WHERE result.attempt_id = v_attempt.id
     ORDER BY result.revision_number DESC, result.id DESC LIMIT 1;
    RETURN COALESCE(v_decision = 'changes_requested', false);
END;
$$;

-- The generic mutation has already acquired (or will acquire) its Project row
-- lock. A review takes the same lock before its decision becomes visible, so a
-- concurrent write finishes before acceptance or observes the committed result.
CREATE FUNCTION public.learning_original_project_editor_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_project_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'projects' THEN
        v_project_id := NEW.id;
    ELSE
        v_project_id := NEW.project_id;
        PERFORM 1 FROM public.projects project
         WHERE project.id = v_project_id FOR UPDATE OF project;
    END IF;
    IF NOT public.learning_original_project_action_allowed(v_project_id, 'editor_write') THEN
        RAISE EXCEPTION 'learning_work_read_only' USING ERRCODE = 'P5L02';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER projects_learning_original_editor_guard
    BEFORE UPDATE OF title, description, tags, license ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.learning_original_project_editor_guard();
CREATE TRIGGER project_drafts_learning_original_editor_guard
    BEFORE UPDATE ON public.project_drafts
    FOR EACH ROW EXECUTE FUNCTION public.learning_original_project_editor_guard();
CREATE TRIGGER project_versions_learning_original_editor_guard
    BEFORE INSERT ON public.project_versions
    FOR EACH ROW EXECUTE FUNCTION public.learning_original_project_editor_guard();
CREATE TRIGGER project_snapshots_learning_original_editor_guard
    BEFORE INSERT OR UPDATE ON public.project_snapshots
    FOR EACH ROW EXECUTE FUNCTION public.learning_original_project_editor_guard();

-- Review commands lock Attempt before writing Result. Lock its Project here as
-- well, before the decision is inserted; the legacy command changes Attempt
-- state directly and uses the second trigger. These locks serialize with each
-- editor trigger without changing the review command's public contract.
CREATE FUNCTION public.learning_original_project_review_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_participation_id uuid;
    v_assignment_id uuid;
    v_seat_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'assessment_results' THEN
        SELECT attempt.activity_participation_id,
               attempt.classroom_assignment_id, attempt.seat_id
          INTO v_participation_id, v_assignment_id, v_seat_id
          FROM public.learning_attempts attempt WHERE attempt.id = NEW.attempt_id;
    ELSE
        v_participation_id := NEW.activity_participation_id;
        v_assignment_id := NEW.classroom_assignment_id;
        v_seat_id := NEW.seat_id;
    END IF;
    PERFORM 1 FROM public.projects project
     WHERE project.id IN (
        SELECT origin.project_id FROM public.learning_project_origins origin
         WHERE origin.participation_id = v_participation_id
        UNION
        SELECT origin.project_id FROM public.learning_legacy_project_origins origin
          JOIN public.classroom_assignment_work work
            ON work.id = origin.source_work_id AND work.project_id = origin.project_id
         WHERE work.assignment_id = v_assignment_id AND work.seat_id = v_seat_id
     )
     FOR UPDATE OF project;
    RETURN NEW;
END;
$$;

CREATE TRIGGER assessment_results_learning_original_review_lock
    BEFORE INSERT ON public.assessment_results
    FOR EACH ROW EXECUTE FUNCTION public.learning_original_project_review_lock();
CREATE TRIGGER learning_attempts_learning_original_review_lock
    BEFORE UPDATE OF state ON public.learning_attempts
    FOR EACH ROW WHEN (NEW.state IS DISTINCT FROM OLD.state)
    EXECUTE FUNCTION public.learning_original_project_review_lock();

-- Legacy compatibility has no Attempt yet. Its submitted_at is the workflow
-- authority, so that transition must serialize with editor writes too.
CREATE FUNCTION public.learning_legacy_work_submission_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM 1 FROM public.projects project
     WHERE project.id = NEW.project_id FOR UPDATE OF project;
    RETURN NEW;
END;
$$;
CREATE TRIGGER classroom_assignment_work_learning_submission_lock
    BEFORE UPDATE OF submitted_at ON public.classroom_assignment_work
    FOR EACH ROW WHEN (NEW.submitted_at IS DISTINCT FROM OLD.submitted_at)
    EXECUTE FUNCTION public.learning_legacy_work_submission_lock();

REVOKE ALL ON FUNCTION public.learning_original_project_editor_guard() FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION public.learning_original_project_review_lock() FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION public.learning_legacy_work_submission_lock() FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION public.learning_original_project_action_allowed(uuid,text)
    FROM PUBLIC, asalab_app;
