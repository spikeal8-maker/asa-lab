-- UTC instants plus the actual source IANA zone. Historical unknown zones remain NULL.
ALTER TABLE classroom_course_runs ADD COLUMN assignment_timezone varchar(80);
CREATE OR REPLACE FUNCTION learning_direct_assignment_create_v2(p_actor uuid,p_tenant uuid,p_class uuid,p_version uuid,p_due timestamptz,
 p_audience varchar,p_seats uuid[],p_request varchar,p_zone varchar)
RETURNS TABLE(result_code varchar,classroom_assignment_id uuid,activity_run_id uuid,audience_id uuid,assigned_count integer,reused boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_result record;v_zone varchar;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_zone) THEN
   RETURN QUERY SELECT 'invalid_timezone'::varchar,NULL::uuid,NULL::uuid,NULL::uuid,NULL::integer,false;RETURN; END IF;
 SELECT * INTO v_result FROM public.learning_direct_assignment_create(p_actor,p_tenant,p_class,p_version,p_due,p_audience,p_seats,p_request);
 IF v_result.result_code='ok' THEN
   SELECT assignment_timezone INTO v_zone FROM public.activity_runs WHERE id=v_result.activity_run_id FOR UPDATE;
   IF v_result.reused AND v_zone IS DISTINCT FROM p_zone THEN
     RETURN QUERY SELECT 'request_conflict'::varchar,NULL::uuid,NULL::uuid,NULL::uuid,NULL::integer,false;RETURN; END IF;
   IF NOT v_result.reused THEN UPDATE public.activity_runs SET assignment_timezone=p_zone WHERE id=v_result.activity_run_id; END IF;
 END IF;
 RETURN QUERY SELECT v_result.result_code::varchar,v_result.classroom_assignment_id::uuid,v_result.activity_run_id::uuid,
   v_result.audience_id::uuid,v_result.assigned_count::integer,v_result.reused::boolean;
END;
$$;
CREATE OR REPLACE FUNCTION classroom_course_run_assign_v4(p_actor uuid,p_class uuid,p_course uuid,p_due timestamptz,p_version integer,
 p_audience varchar,p_seats uuid[],p_request varchar,p_zone varchar)
RETURNS TABLE(result_code varchar,run_id uuid,version_number integer,reused boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_result record;v_zone varchar;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_zone) THEN
   RETURN QUERY SELECT 'invalid_timezone'::varchar,NULL::uuid,NULL::integer,false;RETURN;END IF;
 SELECT * INTO v_result FROM public.classroom_course_run_assign_v3(p_actor,p_class,p_course,p_due,p_version,p_audience,p_seats,p_request);
 IF v_result.result_code='ok' THEN
   SELECT assignment_timezone INTO v_zone FROM public.classroom_course_runs WHERE id=v_result.run_id FOR UPDATE;
   IF v_result.reused AND v_zone IS DISTINCT FROM p_zone THEN
     RETURN QUERY SELECT 'request_conflict'::varchar,NULL::uuid,NULL::integer,false;RETURN;END IF;
   IF NOT v_result.reused THEN
     UPDATE public.classroom_course_runs SET assignment_timezone=p_zone WHERE id=v_result.run_id;
     UPDATE public.activity_runs SET assignment_timezone=p_zone WHERE source_course_run_id=v_result.run_id;
   END IF;
 END IF;
 RETURN QUERY SELECT v_result.result_code::varchar,v_result.run_id::uuid,v_result.version_number::integer,v_result.reused::boolean;
END;
$$;
REVOKE ALL ON FUNCTION learning_direct_assignment_create_v2(uuid,uuid,uuid,uuid,timestamptz,varchar,uuid[],varchar,varchar),
 classroom_course_run_assign_v4(uuid,uuid,uuid,timestamptz,integer,varchar,uuid[],varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION learning_direct_assignment_create_v2(uuid,uuid,uuid,uuid,timestamptz,varchar,uuid[],varchar,varchar),
 classroom_course_run_assign_v4(uuid,uuid,uuid,timestamptz,integer,varchar,uuid[],varchar,varchar) TO asalab_app;
