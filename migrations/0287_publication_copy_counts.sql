-- Successful project creation, not button clicks or physical file downloads.
-- Minimal durable receipts retain totals when the private destination is removed.
-- Serialize backfill + trigger installation with writers: no missed insertion gap.
LOCK TABLE public.projects IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public.publication_copy_events (
    destination_project_id uuid PRIMARY KEY,
    publication_id uuid NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE INDEX publication_copy_events_count_idx
    ON public.publication_copy_events(publication_id);
ALTER TABLE public.publication_copy_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_copy_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.publication_copy_events FROM PUBLIC, asalab_app;

-- Existing immutable lineage is the only provable historical source. Already
-- permanently deleted copies cannot be reconstructed and are not invented.
INSERT INTO public.publication_copy_events(destination_project_id,publication_id,created_at)
SELECT project.id,project.copied_from_publication_id,project.created_at
FROM public.projects project
JOIN public.project_publication_revisions revision
 ON revision.id=project.copied_from_revision_id
 AND revision.publication_id=project.copied_from_publication_id
 AND revision.project_id=project.copied_from_project_id
 AND revision.project_version_id=project.copied_from_version_id
WHERE project.copied_from_publication_id IS NOT NULL;

CREATE FUNCTION public.record_publication_copy_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.copied_from_publication_id IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.project_publication_revisions revision
   WHERE revision.id=NEW.copied_from_revision_id
    AND revision.publication_id=NEW.copied_from_publication_id
    AND revision.project_id=NEW.copied_from_project_id
    AND revision.project_version_id=NEW.copied_from_version_id) THEN
   RAISE EXCEPTION 'invalid publication copy origin' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.publication_copy_events(destination_project_id,publication_id,created_at)
 VALUES(NEW.id,NEW.copied_from_publication_id,NEW.created_at);
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_publication_copy_created() FROM PUBLIC,asalab_app;
CREATE TRIGGER record_publication_copy_created AFTER INSERT ON public.projects
 FOR EACH ROW WHEN (NEW.copied_from_publication_id IS NOT NULL)
 EXECUTE FUNCTION public.record_publication_copy_created();

-- Readability matches the existing public like-count boundary. No identity,
-- private project id or receipt row is returned to the public caller.
CREATE FUNCTION public.publication_copy_count(p_publication uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN public.project_publication_readable(p_publication) THEN
  (SELECT count(*) FROM public.publication_copy_events event
   WHERE event.publication_id=p_publication) ELSE 0::bigint END;
$$;
REVOKE ALL ON FUNCTION public.publication_copy_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publication_copy_count(uuid) TO asalab_app;
