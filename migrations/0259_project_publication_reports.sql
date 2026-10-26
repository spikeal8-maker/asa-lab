-- R8-03D / #713: incoming public-project reports are private signals, not moderation actions.
-- Forward successor to published 0258; earlier migration bytes remain unchanged.
-- Project Core, published revisions and existing moderation state are untouched.
CREATE TABLE public.project_publication_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    publication_id uuid NOT NULL REFERENCES public.project_publication_state(id),
    revision_id uuid NOT NULL,
    reporter_principal_id uuid NOT NULL REFERENCES public.principals(id),
    reason varchar(32) NOT NULL CHECK (reason IN (
        'spam', 'abuse', 'dangerous_content', 'personal_data', 'copyright', 'other'
    )),
    comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 500),
    request_key varchar(128) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'dismissed', 'resolved')),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (revision_id, publication_id)
        REFERENCES public.project_publication_revisions(id, publication_id),
    UNIQUE (reporter_principal_id, request_key),
    UNIQUE (reporter_principal_id, publication_id, revision_id)
);

CREATE INDEX project_publication_reports_reporter_created_idx
    ON public.project_publication_reports(reporter_principal_id, created_at DESC);
CREATE INDEX project_publication_reports_publication_created_idx
    ON public.project_publication_reports(publication_id, created_at DESC);

ALTER TABLE public.project_publication_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.project_publication_reports FROM PUBLIC, asalab_app;

-- One entry point for reports. The server resolves p_actor from the existing
-- authenticated account session; no caller-supplied reporter field is accepted.
-- Project -> state -> reporter locks serialize publication lifecycle and concurrent
-- requests by the same account without changing the underlying Project or Draft.
CREATE FUNCTION public.project_publication_report_create(
    p_actor uuid,
    p_publication uuid,
    p_revision uuid,
    p_reason text,
    p_comment text,
    p_request_key text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
    v_project uuid;
    v_current_revision uuid;
    v_state varchar;
    v_clean_comment text := COALESCE(btrim(p_comment), '');
    v_existing public.project_publication_reports%ROWTYPE;
    v_count integer;
    v_report_id uuid;
BEGIN
    IF p_actor IS NULL OR p_publication IS NULL OR p_revision IS NULL
       OR p_reason IS NULL OR p_reason NOT IN (
           'spam', 'abuse', 'dangerous_content', 'personal_data', 'copyright', 'other'
       )
       OR char_length(v_clean_comment) > 500
       OR p_request_key IS NULL
       OR p_request_key LIKE 'learning:%'
       OR p_request_key !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
        RAISE EXCEPTION 'invalid publication report' USING ERRCODE = '22023';
    END IF;

    -- Do not reveal existence of protected publications to a reporter.
    SELECT state.project_id INTO v_project
      FROM public.project_publication_state state WHERE state.id = p_publication;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'publication unavailable' USING ERRCODE = 'P5P04';
    END IF;
    PERFORM 1 FROM public.projects project WHERE project.id = v_project FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'publication unavailable' USING ERRCODE = 'P5P04';
    END IF;
    SELECT state.current_revision_id, state.state
      INTO v_current_revision, v_state
      FROM public.project_publication_state state
     WHERE state.id = p_publication FOR UPDATE;
    IF NOT FOUND OR v_state <> 'public'
       OR NOT public.project_publication_readable(p_publication) THEN
        RAISE EXCEPTION 'publication unavailable' USING ERRCODE = 'P5P04';
    END IF;
    IF v_current_revision IS DISTINCT FROM p_revision THEN
        RAISE EXCEPTION 'published revision changed' USING ERRCODE = 'P5R09';
    END IF;

    -- Lock the actual Account principal to serialize per-user throttling.
    -- StudentSeat principals and disabled Accounts have no report capability.
    PERFORM 1
      FROM public.principals principal
      JOIN public.accounts account ON account.id = principal.account_id
     WHERE principal.id = p_actor AND principal.kind = 'account'
       AND account.status = 'active'
     FOR UPDATE OF principal;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'reporter forbidden' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_existing
      FROM public.project_publication_reports report
     WHERE report.reporter_principal_id = p_actor
       AND report.request_key = p_request_key;
    IF FOUND THEN
        IF v_existing.publication_id <> p_publication
           OR v_existing.revision_id <> p_revision
           OR v_existing.reason <> p_reason
           OR v_existing.comment <> v_clean_comment THEN
            RAISE EXCEPTION 'report request replay mismatch' USING ERRCODE = 'P5R09';
        END IF;
        RETURN jsonb_build_object('reportId', v_existing.id,
                                  'status', 'received', 'duplicate', true);
    END IF;

    -- A distinct key is a distinct request. Never acknowledge an unbound alias:
    -- it could later be reused for another publication with contradictory results.
    PERFORM 1 FROM public.project_publication_reports report
     WHERE report.reporter_principal_id = p_actor
       AND report.publication_id = p_publication
       AND report.revision_id = p_revision;
    IF FOUND THEN
        RAISE EXCEPTION 'report already received' USING ERRCODE = 'P5R09';
    END IF;

    SELECT count(*)::integer INTO v_count
      FROM public.project_publication_reports report
     WHERE report.reporter_principal_id = p_actor
       AND report.created_at >= clock_timestamp() - INTERVAL '24 hours';
    IF v_count >= 10 THEN
        RAISE EXCEPTION 'report rate exceeded' USING ERRCODE = 'P5R29';
    END IF;

    INSERT INTO public.project_publication_reports
        (publication_id, revision_id, reporter_principal_id,
         reason, comment, request_key, status)
    VALUES (p_publication, p_revision, p_actor,
            p_reason, v_clean_comment, p_request_key, 'open')
    RETURNING id INTO v_report_id;

    RETURN jsonb_build_object('reportId', v_report_id,
                              'status', 'received', 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION public.project_publication_report_create(uuid,uuid,uuid,text,text,text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_publication_report_create(uuid,uuid,uuid,text,text,text)
    TO asalab_app;
