-- Teacher-owned working copies never widen access to a pupil's source or create learning evidence.
-- Extend the private writer evidence companion without changing Project tenancy or RLS policies.
ALTER TABLE public.project_writer_evidence
    ADD COLUMN classroom_copy_source jsonb,
    DROP CONSTRAINT project_writer_evidence_writer_operation_check,
    ADD CHECK (writer_operation IN ('native', 'public_acquisition', 'ordinary_duplicate', 'classroom_private')),
    ADD CHECK ((writer_operation = 'classroom_private') = (classroom_copy_source IS NOT NULL));

CREATE FUNCTION public.classroom_teacher_copy_source(
    p_actor uuid, p_class uuid, p_seat uuid, p_project uuid,
    p_revision integer, p_attempt uuid, p_submission uuid, p_version uuid
) RETURNS TABLE(
    destination_tenant_id uuid, destination_user_id uuid,
    module_key varchar, title varchar, document_json jsonb
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_user uuid;
    v_project public.projects%ROWTYPE;
    v_target jsonb;
    v_document jsonb;
BEGIN
    IF (
        (p_revision > 0 AND p_attempt IS NULL AND p_submission IS NULL AND p_version IS NULL)
        OR (p_revision IS NULL AND p_attempt IS NOT NULL AND p_submission IS NOT NULL AND p_version IS NOT NULL)
    ) IS NOT TRUE THEN
        RETURN;
    END IF;

    PERFORM 1 FROM public.classrooms classroom
     WHERE classroom.id = p_class AND classroom.status = 'active' AND NOT classroom.safe_mode_default
     FOR SHARE;
    IF NOT FOUND THEN RETURN; END IF;

    PERFORM 1
      FROM public.principals actor
      JOIN public.accounts account ON account.id = actor.account_id AND account.status = 'active'
      JOIN public.classroom_memberships membership ON membership.account_id = account.id
       AND membership.classroom_id = p_class AND membership.member_role IN ('owner', 'co_teacher')
      JOIN public.capability_grants educator ON educator.account_id = account.id
       AND educator.capability = 'educator' AND educator.state IN ('verified', 'provisional')
     WHERE actor.id = p_actor AND actor.kind = 'account'
     FOR SHARE OF actor, account, membership, educator;
    IF NOT FOUND THEN RETURN; END IF;

    PERFORM 1 FROM public.classroom_student_seats seat
     WHERE seat.id = p_seat AND seat.classroom_id = p_class AND seat.status = 'active' AND NOT seat.safe_mode
     FOR SHARE;
    IF NOT FOUND THEN RETURN; END IF;

    -- Review writers lock Attempt before Project (0194). Preview reads alone do not grant copy.
    IF p_attempt IS NOT NULL THEN
        PERFORM 1 FROM public.learning_attempts attempt
          JOIN public.activity_participations participation
            ON participation.id = attempt.activity_participation_id AND participation.tenant_id = attempt.tenant_id
          JOIN public.activity_runs run ON run.id = participation.activity_run_id
           AND run.tenant_id = attempt.tenant_id AND run.classroom_id = p_class
           AND run.source_classroom_assignment_id = attempt.classroom_assignment_id
          JOIN public.classrooms classroom ON classroom.id = p_class AND classroom.tenant_id = attempt.tenant_id
          JOIN public.learner_identity_links link
            ON link.learner_identity_id = participation.learner_identity_id AND link.seat_id = attempt.seat_id
           AND link.tenant_id = attempt.tenant_id AND link.school_id = classroom.school_id
           AND link.status = 'active' AND link.disabled_at IS NULL
         WHERE attempt.id = p_attempt AND attempt.classroom_id = p_class AND attempt.seat_id = p_seat
           AND attempt.invalidated_at IS NULL AND attempt.state <> 'invalidated'
         FOR SHARE OF attempt, link;
        IF NOT FOUND THEN RETURN; END IF;
    END IF;

    SELECT project.* INTO v_project FROM public.projects project
     WHERE project.id = p_project AND project.status = 'active'
       AND (project.classroom_id IS NULL OR project.classroom_id = p_class)
       AND (project.module_key IN ('three-d', 'electronics')
            OR (p_revision IS NOT NULL AND project.module_key = 'robotics'))
     FOR SHARE;
    IF NOT FOUND
       OR NOT public.classroom_journal_teacher(p_actor, p_class)
       OR NOT public.classroom_participant_allowed(p_actor, p_class, p_seat)
       OR NOT EXISTS (SELECT 1 FROM public.classroom_participant_projects(p_seat) visible
                       WHERE visible.id = p_project)
       OR NOT EXISTS (SELECT 1 FROM public.project_context_for_principal(p_actor, p_project))
       OR public.classroom_gallery_project_safe_mode(p_project)
       OR EXISTS (SELECT 1 FROM public.project_writer_evidence evidence
                   WHERE evidence.project_id = p_project AND evidence.writer_operation = 'classroom_private')
    THEN RETURN; END IF;

    -- Copy only into the Account's own canonical Personal Workspace.
    SELECT workspace.tenant_id INTO v_tenant
      FROM public.principals actor
      JOIN public.workspace_memberships member ON member.account_id = actor.account_id
       AND member.state = 'active' AND member.role = 'owner'
      JOIN public.workspaces workspace ON workspace.id = member.workspace_id
       AND workspace.kind = 'personal' AND workspace.status = 'active'
     WHERE actor.id = p_actor
     ORDER BY workspace.id LIMIT 1 FOR SHARE OF workspace, member;
    IF v_tenant IS NULL THEN RETURN; END IF;
    SELECT link.user_id INTO v_user
      FROM public.legacy_user_account_links link
     WHERE link.principal_id = p_actor AND link.tenant_id = v_tenant AND link.migration_state = 'active'
     ORDER BY link.user_id LIMIT 1 FOR SHARE;

    IF p_revision IS NOT NULL THEN
        v_target := public.classroom_observation_free_project_preview(p_actor, p_class, p_seat, p_project);
        IF v_target IS NULL THEN RETURN; END IF;
        IF (v_target->>'revision')::integer IS DISTINCT FROM p_revision THEN
            RAISE EXCEPTION 'classroom_copy_revision_changed' USING ERRCODE = 'P5C02';
        END IF;
        v_document := v_target->'document';
    ELSE
        -- The selected submission may no longer be the latest. Use exactly the pinned evidence.
        SELECT version.document_json INTO v_document
          FROM public.learning_submissions submission
          JOIN public.project_versions version ON version.id = submission.project_version_id
           AND version.project_id = submission.project_id AND version.tenant_id = submission.project_tenant_id
         WHERE submission.attempt_id = p_attempt AND submission.id = p_submission
           AND submission.project_id = p_project AND submission.project_tenant_id = v_project.tenant_id
           AND version.id = p_version;
        IF NOT FOUND THEN RETURN; END IF;
    END IF;

    RETURN QUERY SELECT v_tenant, v_user, v_project.module_key, v_project.title, v_document;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_teacher_copy_source(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_teacher_copy_source(uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid) TO asalab_app;

-- Attach proof only to the Project INSERT that wrote an identical draft in this transaction.
CREATE FUNCTION public.record_classroom_private_project_copy(
    p_actor uuid, p_destination uuid, p_class uuid, p_seat uuid, p_project uuid,
    p_revision integer, p_attempt uuid, p_submission uuid, p_version uuid
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE source record;
BEGIN
    SELECT * INTO source FROM public.classroom_teacher_copy_source(
        p_actor, p_class, p_seat, p_project, p_revision, p_attempt, p_submission, p_version
    );
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.projects project
        JOIN public.project_drafts draft ON draft.project_id = project.id AND draft.tenant_id = project.tenant_id
        JOIN public.project_writer_insert_witness witness ON witness.project_id = project.id
        WHERE project.id = p_destination AND witness.inserting_xid = txid_current()
          AND project.owner_principal_id = p_actor AND project.project_scope = 'personal' AND project.classroom_id IS NULL
          AND project.tenant_id = source.destination_tenant_id
          AND project.created_by IS NOT DISTINCT FROM source.destination_user_id
          AND current_setting('app.tenant_id', true) = project.tenant_id::text
          AND project.module_key = source.module_key AND draft.document_json = source.document_json
    ) THEN
        RAISE EXCEPTION 'private classroom copy evidence forbidden' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.project_writer_evidence(project_id,writer_lineage_coverage,writer_operation,classroom_copy_source)
    VALUES(p_destination,'unknown','classroom_private',jsonb_strip_nulls(jsonb_build_object(
        'classroomId',p_class,'seatId',p_seat,'projectId',p_project,'revision',p_revision,
        'attemptId',p_attempt,'submissionId',p_submission,'projectVersionId',p_version
    )));
    DELETE FROM public.project_writer_insert_witness WHERE project_id = p_destination;
END;
$$;
REVOKE ALL ON FUNCTION public.record_classroom_private_project_copy(uuid,uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_classroom_private_project_copy(uuid,uuid,uuid,uuid,uuid,integer,uuid,uuid,uuid) TO asalab_app;

-- Editors need only a distribution flag. The source proof never leaves this ledger.
CREATE FUNCTION public.project_private_classroom_copies(p_actor uuid, p_projects uuid[])
RETURNS TABLE(project_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT project.id FROM public.projects project
      JOIN public.project_writer_evidence evidence ON evidence.project_id = project.id
     WHERE project.owner_principal_id = p_actor
       AND (p_projects IS NULL OR project.id = ANY(p_projects))
       AND evidence.writer_operation = 'classroom_private';
$$;
REVOKE ALL ON FUNCTION public.project_private_classroom_copies(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_private_classroom_copies(uuid,uuid[]) TO asalab_app;

-- An organization-session teacher still sees their teaching copies in My Projects.
CREATE FUNCTION public.project_private_classroom_copy_tenant(p_actor uuid, p_active_tenant uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT workspace.tenant_id
      FROM public.principals actor
      JOIN public.accounts account ON account.id = actor.account_id AND account.status = 'active'
      JOIN public.workspace_memberships member ON member.account_id = account.id
       AND member.state = 'active' AND member.role = 'owner'
      JOIN public.workspaces workspace ON workspace.id = member.workspace_id
       AND workspace.kind = 'personal' AND workspace.status = 'active'
     WHERE actor.id = p_actor AND actor.kind = 'account' AND workspace.tenant_id <> p_active_tenant
       AND EXISTS (
         SELECT 1 FROM public.projects project
           JOIN public.project_writer_evidence evidence ON evidence.project_id = project.id
          WHERE project.tenant_id = workspace.tenant_id AND project.owner_principal_id = p_actor
            AND evidence.writer_operation = 'classroom_private'
       )
     ORDER BY workspace.id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.project_private_classroom_copy_tenant(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_private_classroom_copy_tenant(uuid,uuid) TO asalab_app;

-- The canonical publication gate covers Gallery, public/link visibility and distribution.
CREATE OR REPLACE FUNCTION public.project_publication_policy_reason(p_project_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p record;
BEGIN
 SELECT project.*,actor.kind,account.status account_status INTO p FROM public.projects project
 JOIN public.principals actor ON actor.id=project.owner_principal_id
 LEFT JOIN public.accounts account ON account.id=actor.account_id WHERE project.id=p_project_id;
 IF NOT FOUND THEN RETURN 'not_available'; END IF;
 IF EXISTS(SELECT 1 FROM public.learning_project_origins WHERE project_id=p_project_id)
 OR EXISTS(SELECT 1 FROM public.learning_legacy_project_origins WHERE project_id=p_project_id)
 OR EXISTS(SELECT 1 FROM public.classroom_assignment_work WHERE project_id=p_project_id) THEN RETURN 'learning_work_protected'; END IF;
 IF EXISTS (SELECT 1 FROM public.project_writer_evidence evidence
            WHERE evidence.project_id = p_project_id AND evidence.writer_operation = 'classroom_private')
 THEN RETURN 'publication_forbidden'; END IF;
 IF p.status<>'active' THEN RETURN 'publication_forbidden'; END IF;
 IF p.kind='account' AND p.account_status='active' AND p.project_scope='personal' AND p.classroom_id IS NULL THEN RETURN NULL; END IF;
 IF p.kind='student_seat' AND ((p.project_scope='classroom' AND p.classroom_id IS NOT NULL) OR (p.project_scope='personal' AND p.classroom_id IS NULL)) AND p.module_key NOT IN ('chess','checkers')
 AND public.project_publication_seat_active(p.owner_principal_id,p.tenant_id,p.classroom_id) THEN RETURN NULL; END IF;
 RETURN 'publication_forbidden';
END; $$;

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
    -- Distinguish restrictions on a teacher's copy from the Learning original's lifecycle.
    IF p_action IN ('generic_duplicate', 'attach_learning') AND EXISTS (
        SELECT 1 FROM public.project_writer_evidence evidence
         WHERE evidence.project_id = p_project_id AND evidence.writer_operation = 'classroom_private'
    ) THEN
        RETURN false;
    END IF;
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
