-- The response, delivered.
--
-- A teacher could already give a verdict and write why. Nothing showed it to
-- the learner: the badge lived on the teacher's copy of the card and the
-- comment lived in a dialog only a teacher could open. A mark nobody reads is
-- not a mark — it is a note a teacher made to themselves.
--
-- Reading was never the part that was restricted: project_feedback_list has
-- always let a work's owner read what was said about it. What was missing was a
-- way to ask for all of it at once. A learner opening their projects should not
-- cost one request per project, so this answers for every work they own.

CREATE OR REPLACE FUNCTION project_feedback_for_owner(p_principal_id uuid)
RETURNS TABLE (
    project_id uuid,
    badge varchar,
    comment varchar,
    updated_at timestamptz,
    author_display_name varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    -- One response per work: the most recent, from whichever teacher gave it.
    -- A learner reads the current verdict on their model, not a history of
    -- their teachers disagreeing about it.
    SELECT DISTINCT ON (feedback.project_id)
           feedback.project_id,
           feedback.badge,
           feedback.comment,
           feedback.updated_at,
           COALESCE(profile.display_name, 'Педагог')
      FROM public.project_feedback feedback
      JOIN public.projects project ON project.id = feedback.project_id
      JOIN public.principals author ON author.id = feedback.author_principal_id
      LEFT JOIN public.profiles profile ON profile.account_id = author.account_id
     WHERE project.owner_principal_id = p_principal_id
     ORDER BY feedback.project_id, feedback.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION project_feedback_for_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_feedback_for_owner(uuid) TO asalab_app;
