-- Account admission is a request, not a grant. Seat credential login is unchanged.
CREATE TABLE classroom_account_join_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
 classroom_id uuid NOT NULL,account_id uuid NOT NULL REFERENCES accounts(id),
 status varchar(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 code_hash varchar(128) NOT NULL,requested_at timestamptz NOT NULL DEFAULT now(),
 decided_at timestamptz,decided_by_principal_id uuid REFERENCES principals(id),
 decision_reason varchar(1000),seat_id uuid REFERENCES classroom_student_seats(id),
 FOREIGN KEY(tenant_id,classroom_id) REFERENCES classrooms(tenant_id,id)
);
CREATE UNIQUE INDEX classroom_account_pending_join_idx ON classroom_account_join_requests(classroom_id,account_id) WHERE status='pending';
REVOKE ALL ON classroom_account_join_requests FROM PUBLIC,asalab_app;
ALTER TABLE classroom_account_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_account_join_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY classroom_account_join_requests_tenant ON classroom_account_join_requests
 USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::uuid);

-- Preserve the pre-E1 seat materializer under a private name. Approval uses it;
-- the rolling-deploy compatibility function below must never grant new access.
ALTER FUNCTION public.classroom_join_with_account(uuid,varchar)
  RENAME TO classroom_account_join_materialize_internal;
REVOKE ALL ON FUNCTION public.classroom_account_join_materialize_internal(uuid,varchar)
  FROM PUBLIC,asalab_app;

-- Compatibility contract for old API instances during DB-first rollout.
-- Existing active learners remain idempotent. A new Account join returns no row,
-- so the old API fails closed instead of silently bypassing teacher approval.
CREATE OR REPLACE FUNCTION classroom_join_with_account(
  p_account_id uuid,p_code_hash varchar
)
RETURNS TABLE(seat_id uuid,classroom_id uuid,classroom_title varchar,already_member boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT seat.id,classroom.id,classroom.title,true
  FROM public.classroom_join_codes code
  JOIN public.classrooms classroom
    ON classroom.tenant_id=code.tenant_id AND classroom.id=code.classroom_id
  JOIN public.classroom_student_seats seat
    ON seat.classroom_id=classroom.id AND seat.account_id=p_account_id AND seat.status='active'
  WHERE code.token_hash=p_code_hash AND code.status='active' AND classroom.status='active'
    AND NOT EXISTS(
      SELECT 1 FROM public.classroom_memberships membership
       WHERE membership.classroom_id=classroom.id AND membership.account_id=p_account_id
         AND membership.member_role IN ('owner','co_teacher')
    )
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION classroom_join_with_account(uuid,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_join_with_account(uuid,varchar) TO asalab_app;

CREATE OR REPLACE FUNCTION classroom_account_request_join(p_account uuid,p_code varchar)
RETURNS TABLE(request_id uuid,seat_id uuid,classroom_id uuid,classroom_title varchar,status varchar)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
#variable_conflict use_column
DECLARE v_class record;v_seat record;v_request uuid;
BEGIN
 SELECT c.* INTO v_class FROM public.classroom_join_codes code JOIN public.classrooms c ON c.id=code.classroom_id
 WHERE code.token_hash=p_code AND code.status='active' AND c.status='active' LIMIT 1;
 IF v_class.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_account)
   OR EXISTS(SELECT 1 FROM public.classroom_memberships m WHERE m.classroom_id=v_class.id AND m.account_id=p_account AND m.member_role IN ('owner','co_teacher')) THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_class.id::text||p_account::text,1119));
 SELECT * INTO v_seat FROM public.classroom_student_seats s WHERE s.classroom_id=v_class.id AND s.account_id=p_account;
 IF v_seat.status='active' THEN RETURN QUERY SELECT NULL::uuid,v_seat.id,v_class.id,v_class.title,'active'::varchar; RETURN; END IF;
 IF v_seat.status='suspended' THEN RETURN; END IF;
 INSERT INTO public.classroom_account_join_requests(tenant_id,classroom_id,account_id,code_hash)
 VALUES(v_class.tenant_id,v_class.id,p_account,p_code)
 ON CONFLICT(classroom_id,account_id) WHERE classroom_account_join_requests.status='pending'
 DO NOTHING RETURNING id INTO v_request;
 IF v_request IS NULL THEN SELECT r.id INTO v_request FROM public.classroom_account_join_requests r
   WHERE r.classroom_id=v_class.id AND r.account_id=p_account AND r.status='pending'; END IF;
 RETURN QUERY SELECT v_request,NULL::uuid,v_class.id,v_class.title,'pending'::varchar;
END;
$$;

CREATE OR REPLACE FUNCTION classroom_account_join_requests_for_actor(p_account uuid,p_class uuid DEFAULT NULL)
RETURNS TABLE(id uuid,classroom_id uuid,classroom_title varchar,display_label varchar,status varchar,requested_at timestamptz,reason varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT r.id,r.classroom_id,c.title,COALESCE(profile.display_name,'Участник')::varchar,r.status,r.requested_at,r.decision_reason
 FROM public.classroom_account_join_requests r JOIN public.classrooms c ON c.id=r.classroom_id
 LEFT JOIN public.profiles profile ON profile.account_id=r.account_id
 WHERE (p_class IS NULL AND r.account_id=p_account)
 OR (p_class=r.classroom_id AND EXISTS(SELECT 1 FROM public.classroom_memberships m WHERE m.account_id=p_account
   AND m.classroom_id=p_class AND m.member_role IN ('owner','co_teacher')))
 ORDER BY r.requested_at DESC LIMIT 200;
$$;

CREATE OR REPLACE FUNCTION classroom_account_join_decide(p_actor_account uuid,p_actor uuid,p_class uuid,p_request uuid,p_decision varchar,p_reason varchar)
RETURNS varchar LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_request public.classroom_account_join_requests%ROWTYPE;v_join record;
BEGIN
 IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected') OR length(COALESCE(p_reason,''))>1000 THEN RETURN 'invalid_decision'; END IF;
 SELECT r.* INTO v_request FROM public.classroom_account_join_requests r
 WHERE r.id=p_request AND r.classroom_id=p_class AND EXISTS(SELECT 1 FROM public.classroom_memberships m
   JOIN public.principals actor ON actor.account_id=m.account_id AND actor.id=p_actor
   WHERE m.account_id=p_actor_account AND m.classroom_id=p_class AND m.member_role IN ('owner','co_teacher')) FOR UPDATE;
 IF v_request.id IS NULL THEN RETURN 'forbidden'; END IF;
 IF v_request.status<>'pending' THEN
   IF v_request.status=p_decision AND v_request.decided_by_principal_id=p_actor AND v_request.decision_reason IS NOT DISTINCT FROM p_reason THEN RETURN 'ok'; END IF;
   RETURN 'decision_conflict';
 END IF;
 IF p_decision='approved' AND (
   NOT EXISTS(SELECT 1 FROM public.classrooms c WHERE c.id=p_class AND c.status='active')
   OR NOT EXISTS(SELECT 1 FROM public.classroom_join_codes code WHERE code.classroom_id=p_class AND code.token_hash=v_request.code_hash AND code.status='active')
   OR EXISTS(SELECT 1 FROM public.classroom_student_seats seat WHERE seat.classroom_id=p_class AND seat.account_id=v_request.account_id AND seat.status='suspended')
 ) THEN RETURN 'not_available'; END IF;
 UPDATE public.classroom_account_join_requests SET status=p_decision,decided_at=now(),decided_by_principal_id=p_actor,decision_reason=p_reason WHERE id=p_request;
 IF p_decision='approved' THEN
   SELECT * INTO v_join FROM public.classroom_account_join_materialize_internal(v_request.account_id,v_request.code_hash);
   IF v_join.seat_id IS NULL THEN RAISE EXCEPTION 'approved join could not materialize seat'; END IF;
   UPDATE public.classroom_account_join_requests SET seat_id=v_join.seat_id WHERE id=p_request;
 END IF;
 INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
 VALUES(v_request.tenant_id,NULL,'classroom_join_request',p_request,'classroom.join.decided',
   jsonb_build_object('actorPrincipalId',p_actor,'decision',p_decision,'classroomId',p_class,'reason',p_reason));
 RETURN 'ok';
END;
$$;
REVOKE ALL ON FUNCTION classroom_account_request_join(uuid,varchar),classroom_account_join_requests_for_actor(uuid,uuid),
 classroom_account_join_decide(uuid,uuid,uuid,uuid,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_account_request_join(uuid,varchar),classroom_account_join_requests_for_actor(uuid,uuid),
 classroom_account_join_decide(uuid,uuid,uuid,uuid,varchar,varchar) TO asalab_app;
-- Private materializer is never callable by the runtime role. The old public name
-- remains a non-mutating bridge until all pre-E1 API instances have been drained.
REVOKE ALL ON FUNCTION classroom_account_join_materialize_internal(uuid,varchar) FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION classroom_join_with_account(uuid,varchar) TO asalab_app;
