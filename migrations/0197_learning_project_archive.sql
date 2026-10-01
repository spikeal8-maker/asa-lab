-- A5-C: learner-only presentation preference for an exact immutable original.
-- Absence means active. No Project status or academic evidence is changed.
CREATE TABLE public.learning_project_archive (
    project_id uuid PRIMARY KEY REFERENCES public.learning_project_origins(project_id),
    archived_at timestamptz NOT NULL DEFAULT now(),
    archived_by_principal_id uuid NOT NULL REFERENCES public.principals(id)
);
REVOKE ALL ON public.learning_project_archive FROM PUBLIC, asalab_app;
ALTER TABLE public.learning_project_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_project_archive FORCE ROW LEVEL SECURITY;
-- Only owner-defined functions can reach this table; the runtime role has no
-- table privileges. The functions perform viewer and lineage checks.
CREATE POLICY learning_project_archive_definer ON public.learning_project_archive
  USING (true) WITH CHECK (true);

-- A later learner action/review invalidates the old presentation preference.
-- In particular a resubmission must stay visible while it awaits review.
CREATE FUNCTION public.learning_project_archive_bucket(
    p_viewer_principal_id uuid,p_project_id uuid)
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  WITH work AS (
    SELECT origin.participation_id, origin.activity_run_id,
           part.status AS participation_status, run.lifecycle_status AS run_status,
           archive.archived_at
      FROM public.learning_project_origins origin
      JOIN public.activity_participations part ON part.id = origin.participation_id
      JOIN public.activity_runs run ON run.id = origin.activity_run_id
     LEFT JOIN public.learning_project_archive archive ON archive.project_id = origin.project_id
     WHERE origin.project_id = p_project_id
       AND EXISTS (SELECT 1 FROM public.project_context_for_principal(
         p_viewer_principal_id,p_project_id))
       AND (origin.owner_principal_id = p_viewer_principal_id
         OR public.learning_linked_project_access(p_viewer_principal_id,p_project_id))
  ), latest AS (
    SELECT work.*, attempt.id AS attempt_id, attempt.state AS attempt_state,
           attempt.started_at, attempt.submitted_at,
           review.review_decision, review.review_at
      FROM work
      LEFT JOIN LATERAL (
        SELECT item.id,item.state,item.started_at,item.submitted_at
          FROM public.learning_attempts item
         WHERE item.activity_participation_id = work.participation_id
         ORDER BY item.attempt_number DESC,item.id DESC LIMIT 1
      ) attempt ON true
      LEFT JOIN LATERAL (
        SELECT item.review_decision,item.published_at AS review_at
          FROM public.assessment_results item
         WHERE item.attempt_id = attempt.id
         ORDER BY item.revision_number DESC LIMIT 1
      ) review ON true
  )
  SELECT CASE
    WHEN archived_at IS NOT NULL
      AND (started_at IS NULL OR started_at <= archived_at)
      AND (submitted_at IS NULL OR submitted_at <= archived_at)
      AND (review_at IS NULL OR review_at <= archived_at)
      AND (participation_status = 'withdrawn'
        OR run_status IN ('cancelled','archived')
        OR (attempt_state = 'closed' AND review_decision IS NOT NULL
          AND review_decision <> 'changes_requested'))
      THEN 'learning_archive'
    WHEN participation_status = 'withdrawn'
      OR run_status IN ('cancelled','archived')
      OR (attempt_state = 'closed' AND review_decision IS NOT NULL
          AND review_decision <> 'changes_requested')
      THEN 'completed'
    ELSE 'active'
  END FROM latest;
$$;
REVOKE ALL ON FUNCTION public.learning_project_archive_bucket(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_project_archive_bucket(uuid,uuid) TO asalab_app;

-- The caller never writes the preference table. This command is serialized on
-- the Project row, checks the exact viewer-scoped origin reader, and rechecks
-- the terminal policy inside the same transaction before any change.
CREATE FUNCTION public.learning_project_archive_set(
    p_viewer_principal_id uuid,p_project_id uuid,p_archive boolean)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_context jsonb;
  v_evidence jsonb;
  v_bucket text;
BEGIN
  PERFORM 1 FROM public.projects project
   WHERE project.id = p_project_id AND project.status = 'active'
   FOR UPDATE OF project;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  -- Official review locks Participation before Attempt. Read the exact state
  -- after those locks, so archive cannot be acknowledged from stale review.
  PERFORM 1 FROM public.activity_participations participation
    JOIN public.learning_project_origins origin
      ON origin.participation_id = participation.id
   WHERE origin.project_id = p_project_id FOR UPDATE OF participation;
  PERFORM 1 FROM public.learning_attempts attempt
    JOIN public.learning_project_origins origin
      ON origin.participation_id = attempt.activity_participation_id
   WHERE origin.project_id = p_project_id
   ORDER BY attempt.attempt_number DESC,attempt.id DESC LIMIT 1
   FOR UPDATE OF attempt;
  SELECT exact.context,exact.evidence INTO v_context,v_evidence
    FROM public.learning_origin_work_context_for_project(
      p_viewer_principal_id,p_project_id) exact;
  IF v_context IS NULL OR v_evidence IS NULL
     OR v_context->>'seatStatus' <> 'active'
     OR v_context->>'classroomStatus' <> 'active'
     OR v_evidence->'attempt' IS NULL
     OR v_evidence->'attempt' = 'null'::jsonb THEN
    RETURN 'denied';
  END IF;
  v_bucket := public.learning_project_archive_bucket(
    p_viewer_principal_id,p_project_id);
  IF p_archive THEN
    IF v_bucket NOT IN ('completed','learning_archive') OR v_bucket IS NULL
       OR v_bucket = 'learning_archive' THEN
      RETURN CASE WHEN v_bucket = 'learning_archive' THEN 'learning_archive' ELSE 'denied' END;
    END IF;
    INSERT INTO public.learning_project_archive(project_id,archived_at,archived_by_principal_id)
      VALUES(p_project_id,clock_timestamp(),p_viewer_principal_id)
      ON CONFLICT(project_id) DO UPDATE SET
        archived_at = EXCLUDED.archived_at,
        archived_by_principal_id = EXCLUDED.archived_by_principal_id;
    RETURN 'learning_archive';
  END IF;
  DELETE FROM public.learning_project_archive WHERE project_id = p_project_id;
  RETURN 'active';
END;
$$;
REVOKE ALL ON FUNCTION public.learning_project_archive_set(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_project_archive_set(uuid,uuid,boolean) TO asalab_app;

-- Keep the original reader signature for historical callers. The list API
-- uses this ten-argument form so the collection predicate precedes LIMIT.
-- A5-B: an Account may list a linked Seat's exact immutable-origin Project,
-- even when its Project tenant differs from the Account's active workspace.
-- This reader returns only card fields and reuses the exact linked access
-- predicate; the app role has no direct origin-table privilege.
CREATE FUNCTION public.learning_linked_account_project_list(
    p_viewer_principal_id uuid, p_status text, p_module text,
    p_search text, p_exclude_games boolean, p_sort text,
    p_after_id uuid, p_after_value text, p_limit integer, p_collection text
)
RETURNS TABLE (project jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    WITH linked AS MATERIALIZED (
      SELECT DISTINCT origin.project_id
        FROM public.learning_project_origins origin
        JOIN public.principals actor ON actor.id = p_viewer_principal_id
          AND actor.kind = 'account'
        JOIN public.learner_identity_links account_link
          ON account_link.account_id = actor.account_id
         AND account_link.tenant_id = origin.school_tenant_id
         AND account_link.school_id = origin.school_id
         AND account_link.learner_identity_id = origin.learner_identity_id
         AND account_link.link_kind = 'account'
         AND account_link.status = 'active'
       WHERE public.learning_linked_project_access(
         p_viewer_principal_id, origin.project_id)
    )
    SELECT jsonb_build_object(
        'id', p.id,
        'project_scope', p.project_scope,
        'classroom_id', p.classroom_id,
        'module_key', p.module_key,
        'title', p.title,
        'status', p.status,
        'created_at', p.created_at,
        'updated_at', d.updated_at,
        'preview_json', d.preview_json,
        'preview_digest', d.preview_digest,
        'snapshot_revision', s.source_revision,
        'copied_from_project_id', p.copied_from_project_id,
        'copied_from_author', p.copied_from_author,
        'copied_from_title', p.copied_from_title,
        'copied_at', p.copied_at,
        'description', p.description,
        'tags', p.tags,
        'license', p.license
    )
      FROM linked
      JOIN public.projects p ON p.id = linked.project_id
      JOIN public.project_drafts d ON d.tenant_id = p.tenant_id
        AND d.project_id = p.id
      LEFT JOIN public.project_snapshots s ON s.tenant_id = p.tenant_id
        AND s.project_id = p.id
     WHERE EXISTS (
         SELECT 1 FROM public.project_context_for_principal(
           p_viewer_principal_id, p.id))
       AND p.project_scope = 'personal'
       AND p.status = p_status
       AND ((p_collection IS NULL AND COALESCE(public.learning_project_archive_bucket(p_viewer_principal_id,p.id),'active') <> 'learning_archive')
            OR (p_collection IS NOT NULL AND public.learning_project_archive_bucket(p_viewer_principal_id,p.id) = p_collection))
       AND (p_module IS NULL OR p.module_key = p_module)
       AND (p_search IS NULL OR strpos(lower(p.title),lower(p_search)) > 0)
       AND (NOT p_exclude_games OR p.module_key NOT IN ('chess','checkers'))
       AND (p_after_id IS NULL OR CASE p_sort
            WHEN 'title' THEN (p.title COLLATE "C",p.id) >
              (p_after_value COLLATE "C",p_after_id)
            WHEN 'oldest' THEN
              (date_trunc('milliseconds',d.updated_at),p.id) >
              (p_after_value::timestamptz,p_after_id)
            WHEN 'recent' THEN
              (date_trunc('milliseconds',d.updated_at),p.id) <
              (p_after_value::timestamptz,p_after_id)
            ELSE false END)
       AND p_sort IN ('recent','oldest','title')
       AND p_limit BETWEEN 1 AND 100
     ORDER BY
       CASE WHEN p_sort = 'title' THEN p.title COLLATE "C" END ASC,
       CASE WHEN p_sort = 'oldest' THEN date_trunc('milliseconds',d.updated_at) END ASC,
       CASE WHEN p_sort = 'recent' THEN date_trunc('milliseconds',d.updated_at) END DESC,
       CASE WHEN p_sort IN ('title','oldest') THEN p.id END ASC,
       CASE WHEN p_sort = 'recent' THEN p.id END DESC
     LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.learning_linked_account_project_list(
    uuid,text,text,text,boolean,text,uuid,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.learning_linked_account_project_list(
    uuid,text,text,text,boolean,text,uuid,text,integer,text) TO asalab_app;
