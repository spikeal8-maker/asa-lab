-- A5-A1: one server policy for destructive generic mutations of an original
-- learner Project. A canonical origin or a proven legacy assignment-work link
-- is proof; classroom scope, title and owner kind are not. Legacy handouts may
-- be withdrawn, so preserve each existing/future link before its source row
-- can be deleted. Links deleted before this migration cannot be inferred.
CREATE TABLE public.learning_legacy_project_origins (
    project_id uuid PRIMARY KEY,
    project_tenant_id uuid NOT NULL,
    school_tenant_id uuid NOT NULL,
    source_work_id uuid NOT NULL,
    claimed_at timestamptz NOT NULL,
    FOREIGN KEY (project_tenant_id, project_id)
        REFERENCES public.projects(tenant_id, id) ON DELETE RESTRICT
);

REVOKE ALL ON public.learning_legacy_project_origins FROM PUBLIC, asalab_app;

CREATE FUNCTION public.learning_legacy_project_origin_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'legacy learning project origin is immutable';
END;
$$;

CREATE TRIGGER learning_legacy_project_origins_immutable_guard
    BEFORE UPDATE OR DELETE ON public.learning_legacy_project_origins
    FOR EACH ROW EXECUTE FUNCTION public.learning_legacy_project_origin_immutable_guard();
REVOKE ALL ON FUNCTION public.learning_legacy_project_origin_immutable_guard()
    FROM PUBLIC, asalab_app;

CREATE FUNCTION public.learning_original_project_action_allowed(
    p_project_id uuid, p_action text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF p_action IN ('generic_status', 'gallery_publish') THEN
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
    END IF;
    RETURN false;
END;
$$;

-- A SQL trigger is required because the runtime role has column-level UPDATE
-- on projects. The row lock acquired by UPDATE serializes with the immutable
-- origin insert, whose own guard locks the same Project row.
CREATE FUNCTION public.learning_original_project_status_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status IN ('archived', 'trashed')
       AND NOT public.learning_original_project_action_allowed(
           OLD.id, 'generic_status') THEN
        RAISE EXCEPTION 'learning_work_protected' USING ERRCODE = 'P5L01';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER projects_learning_original_status_guard
    BEFORE UPDATE OF status ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.learning_original_project_status_guard();

-- The reverse order of the race matters as well: a generic archive that
-- commits first must not acquire a new canonical origin afterward.
CREATE FUNCTION public.learning_origin_project_status_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    PERFORM 1 FROM public.projects project
     WHERE project.id = NEW.project_id
     FOR UPDATE OF project;
    IF NOT public.learning_original_project_action_allowed(
        NEW.project_id, 'attach_learning') THEN
        RAISE EXCEPTION 'learning origin requires an active unpublished project';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER learning_project_origins_status_guard
    BEFORE INSERT ON public.learning_project_origins
    FOR EACH ROW EXECUTE FUNCTION public.learning_origin_project_status_guard();

-- gallery_publish is SECURITY DEFINER and writes this state only after its
-- author/teacher authorization and Project row lock. Guarding the first write
-- gives both the API and direct function callers the same protected denial.
CREATE FUNCTION public.learning_original_project_publish_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.state = 'public'
       AND NOT public.learning_original_project_action_allowed(
           NEW.project_id, 'gallery_publish') THEN
        RAISE EXCEPTION 'learning_work_protected' USING ERRCODE = 'P5L01';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER project_publication_state_learning_original_guard
    BEFORE INSERT OR UPDATE ON public.project_publication_state
    FOR EACH ROW EXECUTE FUNCTION public.learning_original_project_publish_guard();

-- The old Gallery command returns false before any write when a draft snapshot
-- is absent. Keep its implementation for ordinary projects, but put an
-- authorization-aware Learning guard before that early return. The Project
-- lock also serializes this decision with new origin/legacy work claims.
ALTER FUNCTION public.gallery_publish(uuid,uuid)
    RENAME TO gallery_publish_unprotected;
REVOKE ALL ON FUNCTION public.gallery_publish_unprotected(uuid,uuid)
    FROM PUBLIC, asalab_app;

CREATE FUNCTION public.gallery_publish(
    p_principal_id uuid, p_project_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_owner uuid;
    v_allowed boolean := false;
BEGIN
    SELECT project.owner_principal_id INTO v_owner
      FROM public.projects project
     WHERE project.id = p_project_id AND project.status <> 'deleted'
     FOR UPDATE OF project;
    IF v_owner IS NULL THEN RETURN false; END IF;

    IF v_owner = p_principal_id THEN
        v_allowed := true;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM public.principals author
            JOIN public.classroom_student_seats seat ON seat.id = author.seat_id
            JOIN public.classroom_memberships membership
              ON membership.classroom_id = seat.classroom_id
             AND membership.tenant_id = seat.tenant_id
            JOIN public.principals teacher ON teacher.account_id = membership.account_id
           WHERE author.id = v_owner
             AND seat.status <> 'removed'
             AND membership.member_role IN ('owner', 'co_teacher')
             AND teacher.id = p_principal_id
        ) INTO v_allowed;
    END IF;
    IF v_allowed AND NOT public.learning_original_project_action_allowed(
        p_project_id, 'gallery_publish') THEN
        RAISE EXCEPTION 'learning_work_protected' USING ERRCODE = 'P5L01';
    END IF;
    RETURN public.gallery_publish_unprotected(p_principal_id, p_project_id);
END;
$$;

REVOKE ALL ON FUNCTION public.gallery_publish(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gallery_publish(uuid,uuid) TO asalab_app;

-- Recompile the existing visibility command against the guarded public name.
-- It must never retain a cached call to the renamed implementation.
CREATE OR REPLACE FUNCTION public.project_visibility_set(
    p_principal_id uuid, p_project_id uuid, p_visibility varchar
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_ok boolean;
BEGIN
    IF p_visibility NOT IN ('private', 'link', 'public') THEN RETURN false; END IF;
    IF p_visibility = 'private' THEN
        RETURN public.gallery_unpublish(p_principal_id, p_project_id);
    END IF;
    v_ok := public.gallery_publish(p_principal_id, p_project_id);
    IF NOT v_ok THEN RETURN false; END IF;
    UPDATE public.project_publications publication
       SET visibility = p_visibility
     WHERE publication.project_id = p_project_id;
    RETURN true;
END;
$$;

-- A legacy work claim also serializes with status changes. It cannot turn an
-- already archived or trashed personal Project into a protected original.
CREATE FUNCTION public.learning_legacy_work_project_status_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN
            RETURN NEW;
        END IF;
    END IF;
    PERFORM 1 FROM public.projects project
     WHERE project.id = NEW.project_id
     FOR UPDATE OF project;
    IF NOT public.learning_original_project_action_allowed(
        NEW.project_id, 'attach_learning') THEN
        RAISE EXCEPTION 'learning work requires an active unpublished project';
    END IF;
    INSERT INTO public.learning_legacy_project_origins
        (project_id, project_tenant_id, school_tenant_id, source_work_id, claimed_at)
    SELECT project.id, project.tenant_id, NEW.tenant_id, NEW.id, NEW.started_at
      FROM public.projects project WHERE project.id = NEW.project_id
    ON CONFLICT (project_id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER classroom_assignment_work_project_status_guard
    BEFORE INSERT OR UPDATE OF project_id ON public.classroom_assignment_work
    FOR EACH ROW EXECUTE FUNCTION public.learning_legacy_work_project_status_guard();

INSERT INTO public.learning_legacy_project_origins
    (project_id, project_tenant_id, school_tenant_id, source_work_id, claimed_at)
SELECT work.project_id, project.tenant_id, work.tenant_id, work.id, work.started_at
  FROM public.classroom_assignment_work work
  JOIN public.projects project ON project.id = work.project_id
ON CONFLICT (project_id) DO NOTHING;

ALTER TABLE public.learning_legacy_project_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_legacy_project_origins FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_legacy_project_origins_tenant
    ON public.learning_legacy_project_origins
    USING (school_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
           OR project_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (school_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

REVOKE ALL ON FUNCTION public.learning_original_project_action_allowed(uuid,text)
    FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION public.learning_original_project_status_guard()
    FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION public.learning_origin_project_status_guard()
    FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION public.learning_original_project_publish_guard()
    FROM PUBLIC, asalab_app;
REVOKE ALL ON FUNCTION public.learning_legacy_work_project_status_guard()
    FROM PUBLIC, asalab_app;
