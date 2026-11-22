-- P0 CLASSROOM-LEARNING-FINAL-MERGE-008: additive, persistent Safe Mode
-- This version follows canonical 0327. Do not rewrite historical 0214.
-- Neither previously published content nor its immutable revisions are deleted.

-- One rule serves the write guard and every public reader. An Account's
-- personal project is not classroom work merely because the Account is linked
-- to a pupil; explicit classroom scope is required for Account-owned work.
CREATE FUNCTION public.classroom_gallery_project_safe_mode(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.projects project
      LEFT JOIN public.principals owner_identity
        ON owner_identity.id = project.owner_principal_id
      LEFT JOIN public.classroom_student_seats seat
        ON seat.id = owner_identity.seat_id
       AND seat.tenant_id = project.tenant_id
      LEFT JOIN public.classrooms seat_class
        ON seat_class.id = seat.classroom_id
       AND seat_class.tenant_id = project.tenant_id
      LEFT JOIN public.classrooms project_class
        ON project_class.id = project.classroom_id
       AND project_class.tenant_id = project.tenant_id
     WHERE project.id = p_project_id
       AND (
         COALESCE(seat.safe_mode, false)
         OR COALESCE(seat_class.safe_mode_default, false)
         OR COALESCE(project_class.safe_mode_default, false)
         OR EXISTS (
           SELECT 1 FROM public.classroom_student_seats linked
            WHERE linked.classroom_id = project.classroom_id
              AND linked.tenant_id = project.tenant_id
              AND linked.account_id = owner_identity.account_id
              AND linked.status <> 'removed'
              AND linked.safe_mode
         )
       )
  );
$$;
REVOKE ALL ON FUNCTION public.classroom_gallery_project_safe_mode(uuid)
  FROM PUBLIC, asalab_app;

-- A durable revocation means switching Safe Mode back OFF cannot silently
-- re-expose a work that was public when protection was enabled.
CREATE TABLE public.classroom_gallery_safe_mode_revocations (
  publication_id uuid PRIMARY KEY REFERENCES public.project_publication_state(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  reason varchar(64) NOT NULL DEFAULT 'classroom_safe_mode',
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.classroom_gallery_safe_mode_revocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.classroom_gallery_safe_mode_revocations FROM PUBLIC, asalab_app;

-- The historical project_publications table had a permissive SELECT-true
-- RLS policy. A legacy-only row without a canonical publication can never
-- become publicly readable, including after Safe Mode is switched OFF:
-- it has no canonical publication_id to record in the revocation ledger.
-- Keep these rows for authorized administrative history, but require the
-- exact canonical public predicate for every runtime SQL read.
-- The restrictive policy below composes with existing permissive policies.
CREATE FUNCTION public.classroom_gallery_legacy_safe_readable(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
       SELECT 1 FROM public.project_publication_state state
        WHERE state.project_id = p_project_id
          AND public.project_publication_readable(state.id)
     )
     AND NOT public.classroom_gallery_project_safe_mode(p_project_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.classroom_gallery_safe_mode_revocations revoked
        WHERE revoked.project_id = p_project_id
     );
$$;
REVOKE ALL ON FUNCTION public.classroom_gallery_legacy_safe_readable(uuid)
  FROM PUBLIC, asalab_app;
GRANT EXECUTE ON FUNCTION public.classroom_gallery_legacy_safe_readable(uuid)
  TO asalab_app;
CREATE POLICY classroom_gallery_safe_mode_legacy_read
  ON public.project_publications AS RESTRICTIVE
  FOR SELECT TO asalab_app
  USING (public.classroom_gallery_legacy_safe_readable(project_id));


CREATE FUNCTION public.classroom_gallery_mark_safe_mode_revoked(p_project_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.classroom_gallery_safe_mode_revocations
    (publication_id, project_id, reason)
  SELECT state.id, state.project_id, 'classroom_safe_mode'
    FROM public.project_publication_state state
   WHERE state.project_id = p_project_id
     AND state.state IN ('public','unlisted')
     AND public.classroom_gallery_project_safe_mode(state.project_id)
  ON CONFLICT (publication_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_gallery_mark_safe_mode_revoked(uuid)
  FROM PUBLIC, asalab_app;

-- Initial upgrade shields every old public/unlisted protected publication.
-- This is additive and never changes state, version, image or project bytes.
INSERT INTO public.classroom_gallery_safe_mode_revocations(publication_id,project_id,reason)
SELECT state.id,state.project_id,'migration_backfill'
FROM public.project_publication_state state
WHERE state.state IN ('public','unlisted')
  AND public.classroom_gallery_project_safe_mode(state.project_id)
ON CONFLICT (publication_id) DO NOTHING;

CREATE FUNCTION public.classroom_gallery_safe_mode_class_changed()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.safe_mode_default THEN
    PERFORM public.classroom_gallery_mark_safe_mode_revoked(state.project_id)
      FROM public.project_publication_state state
      JOIN public.projects project ON project.id = state.project_id
      LEFT JOIN public.principals owner_identity
        ON owner_identity.id = project.owner_principal_id
      LEFT JOIN public.classroom_student_seats seat
        ON seat.id = owner_identity.seat_id
       AND seat.tenant_id = project.tenant_id
     WHERE state.state IN ('public','unlisted')
       AND project.tenant_id = NEW.tenant_id
       AND (project.classroom_id = NEW.id OR seat.classroom_id = NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_gallery_safe_mode_class_changed()
  FROM PUBLIC, asalab_app;
CREATE TRIGGER classroom_gallery_safe_mode_class_revoke
AFTER INSERT OR UPDATE OF safe_mode_default ON public.classrooms
FOR EACH ROW EXECUTE FUNCTION public.classroom_gallery_safe_mode_class_changed();

CREATE FUNCTION public.classroom_gallery_safe_mode_seat_changed()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.classroom_gallery_mark_safe_mode_revoked(state.project_id)
    FROM public.project_publication_state state
    JOIN public.projects project ON project.id = state.project_id
    LEFT JOIN public.principals owner_identity
      ON owner_identity.id = project.owner_principal_id
   WHERE state.state IN ('public','unlisted')
     AND project.tenant_id = NEW.tenant_id
     AND (
       owner_identity.seat_id = NEW.id
       OR (
         NEW.account_id IS NOT NULL
         AND NEW.status <> 'removed'
         AND project.classroom_id = NEW.classroom_id
         AND owner_identity.account_id = NEW.account_id
       )
     );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_gallery_safe_mode_seat_changed()
  FROM PUBLIC, asalab_app;
CREATE TRIGGER classroom_gallery_safe_mode_seat_revoke
AFTER INSERT OR UPDATE OF safe_mode, account_id, classroom_id, status
ON public.classroom_student_seats
FOR EACH ROW EXECUTE FUNCTION public.classroom_gallery_safe_mode_seat_changed();

CREATE FUNCTION public.classroom_gallery_safe_mode_project_changed()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM public.classroom_gallery_mark_safe_mode_revoked(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_gallery_safe_mode_project_changed()
  FROM PUBLIC, asalab_app;
CREATE TRIGGER classroom_gallery_safe_mode_project_revoke
AFTER INSERT OR UPDATE OF classroom_id, owner_principal_id, tenant_id, project_scope, status
ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.classroom_gallery_safe_mode_project_changed();

-- An UPDATE must also evaluate the OLD protected lineage. Otherwise a
-- single direct change to a project's scope could evade the retroactive
-- revocation trigger by removing the association before the AFTER trigger.
CREATE TRIGGER classroom_gallery_safe_mode_project_prior_revoke
BEFORE UPDATE OF classroom_id, owner_principal_id, tenant_id, project_scope, status
ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.classroom_gallery_safe_mode_project_changed();

-- Block new writes at both canonical and legacy persistence boundaries.
CREATE FUNCTION public.classroom_gallery_safe_mode_publish_guard()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- Serialize the publication boundary against concurrent class/Seat policy
  -- changes and project-scope edits. Otherwise an ON/OFF race could leave a
  -- public link without a durable revocation receipt.
  PERFORM 1 FROM public.projects project
   WHERE project.id=NEW.project_id FOR SHARE;
  PERFORM 1 FROM public.classrooms classroom
   WHERE classroom.id IN (
      SELECT project.classroom_id FROM public.projects project
       WHERE project.id=NEW.project_id
      UNION
      SELECT seat.classroom_id
        FROM public.projects project
        JOIN public.principals owner_identity
          ON owner_identity.id=project.owner_principal_id
        JOIN public.classroom_student_seats seat
          ON seat.id=owner_identity.seat_id
         AND seat.tenant_id=project.tenant_id
       WHERE project.id=NEW.project_id
   ) FOR SHARE;
  PERFORM 1 FROM public.classroom_student_seats seat
   JOIN public.projects project ON project.id=NEW.project_id
   JOIN public.principals owner_identity
     ON owner_identity.id=project.owner_principal_id
   WHERE seat.tenant_id=project.tenant_id
     AND (
       seat.id=owner_identity.seat_id
       OR (
         project.classroom_id=seat.classroom_id
         AND seat.account_id=owner_identity.account_id
       )
     ) FOR SHARE OF seat;
  -- Trigger records are different on canonical and legacy tables. Never read
  -- NEW.state or NEW.id from the legacy compatibility row.
  IF TG_TABLE_NAME = 'project_publication_state' THEN
    IF NEW.state NOT IN ('public','unlisted') THEN
      RETURN NEW;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.classroom_gallery_safe_mode_revocations revoked
       WHERE revoked.publication_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'classroom Safe Mode forbids restoring a revoked publication'
        USING ERRCODE = 'P5S01';
    END IF;
  ELSE
    IF NEW.visibility NOT IN ('public','link') THEN
      RETURN NEW;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.classroom_gallery_safe_mode_revocations revoked
       WHERE revoked.project_id=NEW.project_id
    ) THEN
      RAISE EXCEPTION 'classroom Safe Mode forbids restoring a legacy publication'
        USING ERRCODE='P5S01';
    END IF;
  END IF;
  IF public.classroom_gallery_project_safe_mode(NEW.project_id) THEN
    RAISE EXCEPTION 'classroom Safe Mode forbids external publication'
      USING ERRCODE = 'P5S01';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_gallery_safe_mode_publish_guard()
  FROM PUBLIC, asalab_app;
CREATE TRIGGER classroom_gallery_safe_mode_state_publish
BEFORE INSERT OR UPDATE ON public.project_publication_state
FOR EACH ROW EXECUTE FUNCTION public.classroom_gallery_safe_mode_publish_guard();
CREATE TRIGGER classroom_gallery_safe_mode_legacy_publish
BEFORE INSERT OR UPDATE ON public.project_publications
FOR EACH ROW EXECUTE FUNCTION public.classroom_gallery_safe_mode_publish_guard();

-- Every new Public Projects, Gallery, Scratch, artifact, image and copy endpoint
-- uses this canonical policy gate. Read-time evaluation prevents old-link access
-- immediately; the durable revocation blocks accidental restoration after OFF.
CREATE OR REPLACE FUNCTION public.project_publication_readable(p_publication_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_publication_state state
    JOIN public.project_publication_revisions revision
      ON revision.id = state.current_revision_id AND revision.publication_id = state.id
    JOIN public.projects project
      ON project.id = state.project_id AND project.tenant_id = state.tenant_id
     AND project.owner_principal_id = state.owner_principal_id
    WHERE state.id = p_publication_id AND state.state = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM public.project_publication_moderation moderation
         WHERE moderation.publication_id = state.id AND moderation.hidden
      )
      AND revision.schema_version = 2
      AND public.project_publication_policy_reason(state.project_id) IS NULL
      AND NOT public.classroom_gallery_project_safe_mode(state.project_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.classroom_gallery_safe_mode_revocations revoked
         WHERE revoked.publication_id = state.id
      )
  );
$$;
REVOKE ALL ON FUNCTION public.project_publication_readable(uuid)
  FROM PUBLIC, asalab_app;
-- P0 Safe Mode publication status projection: the UI may never offer a write
-- that the canonical Safe Mode triggers will reject.
CREATE OR REPLACE FUNCTION public.project_publication_status(p_principal_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_reason text; v_publication jsonb; v_moderation_reason text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.projects project
        JOIN public.principals actor ON actor.id = project.owner_principal_id
        LEFT JOIN public.accounts account ON account.id = actor.account_id
        WHERE project.id = p_project_id AND actor.id = p_principal_id
 AND ((actor.kind='account' AND account.status='active') OR public.project_publication_seat_active(actor.id,project.tenant_id,project.classroom_id))
    ) THEN RETURN NULL; END IF;

    v_reason := public.project_publication_policy_reason(p_project_id);
    -- Report the same eligibility as the canonical publication write guard.
    -- Existing revoked publications cannot be silently republished after OFF.
    IF v_reason IS NULL AND (
        public.classroom_gallery_project_safe_mode(p_project_id)
        OR EXISTS (
            SELECT 1 FROM public.classroom_gallery_safe_mode_revocations revoked
            WHERE revoked.project_id = p_project_id
        )
    ) THEN v_reason := 'classroom_safe_mode'; END IF;
    IF v_reason IS NULL AND NOT public.project_distribution_allowed(p_project_id,'publish') THEN v_reason:='publication_forbidden'; END IF;
    IF v_reason IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.project_drafts draft
        JOIN public.project_snapshots snapshot
          ON snapshot.project_id = draft.project_id AND snapshot.tenant_id = draft.tenant_id
         AND snapshot.source_revision = draft.revision
        WHERE draft.project_id = p_project_id
    ) THEN v_reason := 'preview_required'; END IF;

    SELECT jsonb_build_object(
        'publicationId', state.id, 'revisionId', revision.id,
        'revisionNo', revision.revision_no, 'versionNo', version.version_no,
        'state', state.state, 'publishedAt', revision.published_at,
        'publicPath', CASE WHEN public.project_publication_readable(state.id)
                          THEN '#/public-projects/' || state.id::text ELSE NULL END
    ) INTO v_publication
    FROM public.project_publication_state state
    JOIN public.project_publication_revisions revision
      ON revision.id = state.current_revision_id AND revision.publication_id = state.id
    JOIN public.project_versions version ON version.id = revision.project_version_id
    WHERE state.project_id = p_project_id AND state.owner_principal_id = p_principal_id
      AND revision.schema_version = 2;

    v_moderation_reason := public.project_publication_owner_moderation_reason(p_principal_id, p_project_id);
    RETURN jsonb_build_object('publication', v_publication,
                              'canPublish', v_reason IS NULL, 'reasonCode', v_reason)
        || CASE WHEN v_publication IS NOT NULL THEN jsonb_build_object('acquisition', (SELECT jsonb_build_object('allowed',s.acquisition_allowed,'version',s.acquisition_version) FROM public.project_publication_state s WHERE s.project_id=p_project_id AND s.owner_principal_id=p_principal_id)) ELSE '{}'::jsonb END
        || CASE WHEN v_moderation_reason IS NOT NULL
                THEN jsonb_build_object('moderationReason', v_moderation_reason)
                ELSE '{}'::jsonb END;
END;
$$;
