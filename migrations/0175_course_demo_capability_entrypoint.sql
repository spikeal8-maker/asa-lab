-- A3b-3: the demo template uses the historical publisher internally. Keep
-- that implementation private and guard new Three-D template creation at the
-- app-callable entrypoint. Existing immutable demo versions remain reusable.
ALTER FUNCTION public.course_demo_ensure(uuid) RENAME TO course_demo_ensure_unchecked;
REVOKE EXECUTE ON FUNCTION public.course_demo_ensure_unchecked(uuid)
  FROM PUBLIC, asalab_app;

CREATE FUNCTION public.course_demo_ensure(p_principal_id uuid)
RETURNS TABLE (course_id uuid, created boolean, published_version integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    -- Match the historical per-owner serialization before checking for a
    -- reusable template. This keeps concurrent creates and replays idempotent.
    PERFORM 1 FROM public.principals p WHERE p.id = p_principal_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'course_demo_owner_not_found'; END IF;

    IF EXISTS (
        SELECT 1 FROM public.courses c
         WHERE c.owner_principal_id = p_principal_id
           AND c.template_key = 'three-d-foundations-v1'
    ) THEN
        RETURN QUERY SELECT * FROM public.course_demo_ensure_unchecked(p_principal_id);
        RETURN;
    END IF;

    -- Hold the enabled capability row through the legacy implementation's
    -- entire create/publish transaction. A concurrent revocation must wait.
    PERFORM 1 FROM public.module_learning_capabilities capability
     WHERE capability.module_key = 'three-d'
       AND capability.creatable AND capability.assignable
     FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'course_demo_capability_unavailable' USING ERRCODE = 'PZ001';
    END IF;

    RETURN QUERY SELECT * FROM public.course_demo_ensure_unchecked(p_principal_id);
END;
$$;

REVOKE ALL ON FUNCTION public.course_demo_ensure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.course_demo_ensure(uuid) TO asalab_app;
