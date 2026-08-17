-- A teacher's response to a piece of work.
--
-- Two things, because they answer two different questions. A badge is the
-- verdict a learner reads at a glance and a teacher gives thirty times in a
-- lesson; a comment is the part that says why, and takes as long to write as it
-- deserves. Forcing one to carry the other makes the quick case slow and the
-- careful case shallow.
--
-- The vocabulary is fixed rather than free text. A badge that means the same
-- thing in every class can be counted, sorted and understood by a learner who
-- has met it before; free text cannot, and would quietly become a second
-- comment field.

CREATE TABLE IF NOT EXISTS project_feedback (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          uuid NOT NULL REFERENCES tenants(id),
    project_id         uuid NOT NULL,
    -- Whose work it is. Kept beside the project so a learner's page can gather
    -- their feedback without walking every project they own.
    seat_id            uuid REFERENCES classroom_student_seats(id),
    author_principal_id uuid NOT NULL REFERENCES principals(id),
    badge              varchar(16),
    comment            varchar(1000),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    -- One response per teacher per work, revised rather than repeated: a
    -- learner reads the current verdict, not a history of a teacher changing
    -- their mind.
    UNIQUE (project_id, author_principal_id),
    FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id),
    CONSTRAINT project_feedback_badge_check
        CHECK (badge IS NULL OR badge IN ('excellent', 'good', 'progress', 'redo')),
    -- A response with neither a badge nor a comment says nothing.
    CONSTRAINT project_feedback_content_check
        CHECK (badge IS NOT NULL OR (comment IS NOT NULL AND length(trim(comment)) > 0))
);

CREATE INDEX IF NOT EXISTS project_feedback_seat_idx
    ON project_feedback (tenant_id, seat_id, updated_at DESC) WHERE seat_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON project_feedback TO asalab_app;

ALTER TABLE project_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_feedback FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_feedback_tenant ON project_feedback;
CREATE POLICY project_feedback_tenant ON project_feedback
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Writes a teacher's response, and refuses one from anybody who is not a
-- teacher of the learner whose work it is. The check lives here so no caller
-- can leave it out.
CREATE OR REPLACE FUNCTION project_feedback_save(
    p_principal_id uuid,
    p_project_id   uuid,
    p_badge        varchar,
    p_comment      varchar
)
RETURNS TABLE (
    badge varchar,
    comment varchar,
    updated_at timestamptz,
    author_display_name varchar
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_tenant uuid;
    v_owner  uuid;
    v_seat   uuid;
BEGIN
    SELECT project.tenant_id, project.owner_principal_id
      INTO v_tenant, v_owner
      FROM public.projects project
     WHERE project.id = p_project_id;
    IF v_tenant IS NULL THEN
        RETURN;
    END IF;

    SELECT scope.seat_id INTO v_seat
      FROM public.teacher_seat_scope(p_principal_id) scope
     WHERE scope.seat_principal_id = v_owner;
    IF v_seat IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO public.project_feedback
        (tenant_id, project_id, seat_id, author_principal_id, badge, comment)
    VALUES (v_tenant, p_project_id, v_seat, p_principal_id, p_badge, NULLIF(trim(p_comment), ''))
    ON CONFLICT (project_id, author_principal_id) DO UPDATE
       SET badge = EXCLUDED.badge,
           comment = EXCLUDED.comment,
           updated_at = now();

    RETURN QUERY
    SELECT feedback.badge, feedback.comment, feedback.updated_at, profile.display_name
      FROM public.project_feedback feedback
      JOIN public.principals author ON author.id = feedback.author_principal_id
      LEFT JOIN public.profiles profile ON profile.account_id = author.account_id
     WHERE feedback.project_id = p_project_id
       AND feedback.author_principal_id = p_principal_id;
END;
$$;

REVOKE ALL ON FUNCTION project_feedback_save(uuid, uuid, varchar, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_feedback_save(uuid, uuid, varchar, varchar) TO asalab_app;

-- The responses on a work, for anyone who may already open that work: its
-- owner, and the teachers of that owner's class.
CREATE OR REPLACE FUNCTION project_feedback_list(
    p_principal_id uuid,
    p_project_id   uuid
)
RETURNS TABLE (
    badge varchar,
    comment varchar,
    updated_at timestamptz,
    author_display_name varchar
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT feedback.badge, feedback.comment, feedback.updated_at,
           COALESCE(profile.display_name, 'Педагог')
      FROM public.project_feedback feedback
      JOIN public.projects project ON project.id = feedback.project_id
      JOIN public.principals author ON author.id = feedback.author_principal_id
      LEFT JOIN public.profiles profile ON profile.account_id = author.account_id
     WHERE feedback.project_id = p_project_id
       AND (
         project.owner_principal_id = p_principal_id
         OR project.owner_principal_id IN (
              SELECT scope.seat_principal_id FROM public.teacher_seat_scope(p_principal_id) scope)
       )
     ORDER BY feedback.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION project_feedback_list(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_feedback_list(uuid, uuid) TO asalab_app;
