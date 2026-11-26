-- Read one saved revision of a free project already visible to this teacher.
-- A missing or invalidated submission must not turn a learning original into free work.
CREATE INDEX learning_submissions_project_preview_idx
    ON public.learning_submissions (project_id, project_tenant_id)
    WHERE project_id IS NOT NULL;

CREATE FUNCTION public.classroom_observation_free_project_preview(
    p_actor uuid, p_class uuid, p_seat uuid, p_project uuid
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT jsonb_build_object(
        'projectId', project.id,
        'moduleKey', project.module_key,
        'revision', draft.revision,
        'document', draft.document_json
    )
      FROM public.projects project
      JOIN public.project_drafts draft
        ON draft.project_id = project.id AND draft.tenant_id = project.tenant_id
     WHERE project.id = p_project
       AND project.module_key IN ('three-d', 'electronics', 'robotics')
       AND public.classroom_journal_teacher(p_actor, p_class)
       AND public.classroom_participant_allowed(p_actor, p_class, p_seat)
       AND EXISTS (SELECT 1 FROM public.classroom_participant_projects(p_seat) visible
                    WHERE visible.id = project.id)
       AND EXISTS (SELECT 1 FROM public.project_context_for_principal(p_actor, project.id))
       AND public.learning_original_project_action_allowed(project.id, 'generic_status')
       AND NOT EXISTS (
           SELECT 1 FROM public.learning_submissions submission
            WHERE submission.project_id = project.id AND submission.project_tenant_id = project.tenant_id
       );
$$;

REVOKE ALL ON FUNCTION public.classroom_observation_free_project_preview(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_observation_free_project_preview(uuid,uuid,uuid,uuid) TO asalab_app;

-- Keep class and profile project lists and their module filters in sync. The
-- existing principal, seat and project-visibility predicates still authorize
-- each row. Replacing the definitions preserves function ownership and grants.
DO $migration$
DECLARE
    target regprocedure;
    definition text;
    expanded text;
BEGIN
    FOREACH target IN ARRAY ARRAY[
        'public.classroom_participant_projects(uuid)'::regprocedure,
        'public.classroom_participant_works(uuid,uuid,uuid,varchar,boolean,boolean,integer)'::regprocedure,
        'public.classroom_observation_projects(uuid,uuid,text,uuid,text,text,boolean,integer,integer)'::regprocedure
    ] LOOP
        definition := pg_get_functiondef(target);
        expanded := replace(definition,
            $old$IN('three-d','electronics','blocks')$old$,
            $new$IN('three-d','electronics','blocks','robotics')$new$);
        IF definition = expanded THEN
            RAISE EXCEPTION 'Unexpected classroom project allowlist in %', target;
        END IF;
        EXECUTE expanded;
    END LOOP;
END;
$migration$;

-- The profile lists both free and assigned projects. Its legacy assignment text
-- can be empty for work started from an Activity Run. Identify that work from
-- the same classroom origin as the class project list, on the authorized page.
DO $migration$
DECLARE
    definition text := pg_get_functiondef(
        'public.classroom_participant_works(uuid,uuid,uuid,varchar,boolean,boolean,integer)'::regprocedure
    );
    expanded text;
BEGIN
    expanded := replace(definition,
        $old$'canonicalState',NULL,'assignment',$old$,
        $new$'originActivityRunId',(
            SELECT run.id FROM public.learning_project_origins origin
              JOIN public.activity_runs run
                ON run.id=origin.activity_run_id AND run.tenant_id=origin.school_tenant_id
             WHERE origin.project_id=p.id AND origin.project_tenant_id=p.tenant_id
               AND run.classroom_id=p_class
        ),'canonicalState',NULL,'assignment',$new$);
    IF expanded = definition THEN
        RAISE EXCEPTION 'Unexpected classroom participant works projection';
    END IF;
    EXECUTE expanded;
END;
$migration$;
