-- Card metadata is emitted only by the existing authorized project lists.
CREATE FUNCTION public.project_card_usage(p_project uuid, p_tenant uuid, p_owner uuid)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  WITH sessions AS MATERIALIZED (
    SELECT id FROM public.product_module_sessions
     WHERE project_id = p_project AND tenant_id = p_tenant AND principal_id = p_owner
  ), active AS (
    SELECT range_agg(tstzrange(
      slice.started_at,
      least(slice.ended_at, slice.started_at + make_interval(secs => slice.active_seconds)),
      '[)'
    )) AS segments
    FROM sessions JOIN public.product_module_activity_slices slice ON slice.session_id = sessions.id
  )
  SELECT jsonb_build_object(
    'openCount', (SELECT NULLIF(count(*), 0) FROM sessions),
    'activeSeconds', (SELECT floor(sum(extract(epoch FROM upper(segment) - lower(segment))))
                      FROM active CROSS JOIN LATERAL unnest(active.segments) segment)
  );
$$;
REVOKE ALL ON FUNCTION public.project_card_usage(uuid, uuid, uuid) FROM PUBLIC, asalab_app;

DO $migration$
DECLARE
  definition text;
  amended text;
BEGIN
  definition := pg_get_functiondef(
    'public.classroom_observation_projects(uuid,uuid,text,uuid,text,text,boolean,integer,integer)'::regprocedure
  );
  amended := replace(definition,
    $old$'updatedAt',updated_at,'status',status,'assigned',assigned)$old$,
    $new$'createdAt',created_at,'updatedAt',updated_at,'status',status,'assigned',assigned,
      'usage',public.project_card_usage(id,tenant_id,owner_principal_id))$new$);
  IF amended = definition THEN RAISE EXCEPTION 'Unexpected classroom card list projection'; END IF;
  EXECUTE amended;

  definition := pg_get_functiondef(
    'public.classroom_participant_works(uuid,uuid,uuid,varchar,boolean,boolean,integer)'::regprocedure
  );
  amended := replace(definition,
    $old$'createdAt',p.created_at,'updatedAt',COALESCE(d.updated_at,p.created_at),$old$,
    $new$'createdAt',p.created_at,'updatedAt',COALESCE(d.updated_at,p.created_at),
      'usage',public.project_card_usage(p.id,p.tenant_id,p.owner_principal_id),$new$);
  IF amended = definition THEN RAISE EXCEPTION 'Unexpected participant card list projection'; END IF;
  EXECUTE amended;

  definition := pg_get_functiondef(
    'public.crm_content_page(uuid,varchar,uuid,uuid,varchar,integer,jsonb,varchar)'::regprocedure
  );
  amended := replace(definition,
    $old$SELECT jsonb_agg(payload ORDER BY at DESC,id DESC) FROM visible$old$,
    $new$SELECT jsonb_agg(
      CASE WHEN p_category = 'projects' THEN visible.payload || (
        SELECT jsonb_build_object(
          'updatedAt', coalesce(draft.updated_at, project.created_at),
          'snapshotRevision', snapshot.source_revision,
          'usage', public.project_card_usage(project.id, project.tenant_id, project.owner_principal_id)
        )
        FROM public.projects project
        LEFT JOIN public.project_drafts draft
          ON draft.project_id = project.id AND draft.tenant_id = project.tenant_id
        LEFT JOIN public.project_snapshots snapshot
          ON snapshot.project_id = project.id AND snapshot.tenant_id = project.tenant_id
        WHERE project.id = visible.id::uuid
      ) ELSE visible.payload END ORDER BY at DESC,id DESC) FROM visible$new$);
  IF amended = definition THEN RAISE EXCEPTION 'Unexpected CRM card list projection'; END IF;
  EXECUTE amended;
END;
$migration$;

-- This route returns an image only. It rechecks existing CRM subject access and
-- project ownership on every request, including when an operator switches user.
CREATE FUNCTION public.crm_project_card_snapshot(
  p_actor uuid, p_kind varchar, p_target uuid, p_class uuid, p_project uuid, p_revision integer, p_request varchar
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT coalesce(public.crm_subject_allowed(p_actor,p_kind,p_target,p_class),false) THEN
    RAISE EXCEPTION 'CRM_DENIED' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object('contentType', snapshot.content_type, 'image', encode(snapshot.image, 'base64')) INTO result
    FROM public.projects project
    JOIN public.principals owner ON owner.id = project.owner_principal_id
    JOIN public.project_snapshots snapshot
      ON snapshot.project_id = project.id AND snapshot.tenant_id = project.tenant_id
    WHERE project.id = p_project AND snapshot.source_revision = p_revision
      AND (p_class IS NULL OR project.classroom_id = p_class)
      AND (
        (p_kind = 'account' AND owner.kind = 'account' AND owner.account_id = p_target)
        OR (p_kind = 'student' AND owner.kind = 'student_seat' AND owner.seat_id = p_target)
      )
  ;
  IF result IS NULL THEN RETURN '{}'::jsonb; END IF;
  PERFORM public.crm_audit(p_actor,p_kind,p_target,p_class,'crm.project.snapshot.read',NULL,p_request,NULL,
    jsonb_build_object('projectId',p_project,'revision',p_revision));
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_project_card_snapshot(uuid, varchar, uuid, uuid, uuid, integer, varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_project_card_snapshot(uuid, varchar, uuid, uuid, uuid, integer, varchar) TO asalab_app;
