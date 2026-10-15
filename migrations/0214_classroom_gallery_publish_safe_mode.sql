-- Block *new* publication of protected classroom work at the persistence boundary.
-- A StudentSeat cannot publish through the Gallery controller, but a teacher can
-- publish on its behalf. That teacher path and the project-properties path both
-- end in gallery_publish(), so a UI-only check is not sufficient.
--
-- Do not mutate existing publications, projects, revisions, reactions or school
-- policies in this migration. Read-time shielding/revocation of *already*
-- published works is a separate, explicitly required follow-up before this
-- feature can be represented as comprehensive Safe Mode enforcement.

CREATE FUNCTION public.classroom_gallery_safe_mode_publish_guard()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- A revoke must always remain possible, even when protection is enabled.
  IF TG_TABLE_NAME = 'project_publication_state' THEN
    IF NEW.state NOT IN ('public', 'unlisted') THEN
      RETURN NEW;
    END IF;
  END IF;

  IF EXISTS (
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
     WHERE project.id = NEW.project_id
       AND (
         COALESCE(seat.safe_mode, false)
         OR COALESCE(seat_class.safe_mode_default, false)
         OR COALESCE(project_class.safe_mode_default, false)
         -- A linked Account may own an explicitly classroom-scoped project.
         -- Its own personal projects are *not* reclassified as school work.
         OR EXISTS (
           SELECT 1
             FROM public.classroom_student_seats linked
            WHERE linked.classroom_id = project.classroom_id
              AND linked.tenant_id = project.tenant_id
              AND linked.account_id = owner_identity.account_id
              AND linked.status <> 'removed'
              AND linked.safe_mode
         )
       )
  ) THEN
    RAISE EXCEPTION 'classroom Safe Mode forbids external publication'
      USING ERRCODE = 'P5S01';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.classroom_gallery_safe_mode_publish_guard()
  FROM PUBLIC, asalab_app;

-- The canonical publication record is written before a Gallery listing row.
-- Deny it first so a failed publication cannot create an immutable revision.
CREATE TRIGGER classroom_gallery_safe_mode_state_publish
BEFORE INSERT OR UPDATE ON public.project_publication_state
FOR EACH ROW
EXECUTE FUNCTION public.classroom_gallery_safe_mode_publish_guard();

-- Also cover direct legacy/publication-projection writes. Both ordinary Gallery
-- POST and Project Properties / link or public visibility share this boundary.
CREATE TRIGGER classroom_gallery_safe_mode_legacy_publish
BEFORE INSERT OR UPDATE ON public.project_publications
FOR EACH ROW
EXECUTE FUNCTION public.classroom_gallery_safe_mode_publish_guard();
