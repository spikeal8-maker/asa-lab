-- A3b-2: v3 is the only direct Course publication command callable by the app.
-- v3 is SECURITY DEFINER and may continue its internal v2 -> legacy delegation;
-- the restricted runtime role must not invoke either unvalidated command directly.
REVOKE EXECUTE ON FUNCTION public.course_publish(uuid,uuid),
    public.course_publish_v2(uuid,uuid,integer,varchar)
  FROM PUBLIC, asalab_app;
