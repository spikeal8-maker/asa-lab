-- Educational OFFLINE Chess/Checkers only. No online/chat/matchmaking authority.
-- Missing class row means allow/version 0; missing Seat row means inherit.
-- All writes, including Seat writes, advance one class-wide CAS version and audit.
CREATE TABLE public.classroom_games_policies (
  classroom_id uuid PRIMARY KEY REFERENCES public.classrooms(id),
  tenant_id uuid NOT NULL,
  mode text NOT NULL DEFAULT 'allow' CHECK (mode IN ('allow','deny','rating_threshold')),
  threshold numeric CHECK (threshold >= 0 AND threshold <= 100),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_by uuid NOT NULL REFERENCES public.principals(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,classroom_id),
  FOREIGN KEY (tenant_id,classroom_id) REFERENCES public.classrooms(tenant_id,id),
  CHECK ((mode='rating_threshold' AND threshold IS NOT NULL)
      OR (mode<>'rating_threshold' AND threshold IS NULL))
);
CREATE TABLE public.classroom_games_seat_overrides (
  seat_id uuid PRIMARY KEY REFERENCES public.classroom_student_seats(id),
  tenant_id uuid NOT NULL,
  classroom_id uuid NOT NULL,
  override text NOT NULL DEFAULT 'inherit' CHECK (override IN ('inherit','allow','deny')),
  updated_by uuid NOT NULL REFERENCES public.principals(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,classroom_id) REFERENCES public.classroom_games_policies(tenant_id,classroom_id)
);
ALTER TABLE public.classroom_games_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_games_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_games_seat_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_games_seat_overrides FORCE ROW LEVEL SECURITY;
-- No direct runtime table policies/grants: audited functions are the only writer.
REVOKE ALL ON public.classroom_games_policies,public.classroom_games_seat_overrides FROM PUBLIC,asalab_app;

-- There is no classroom_teacher_can_manage in this schema. Reuse its actual
-- principal-based journal authority plus the existing exact teacher access seam.
CREATE FUNCTION public.classroom_games_teacher(p_actor uuid,p_tenant uuid,p_class uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.principals actor
   JOIN public.accounts account ON account.id=actor.account_id AND account.status='active'
   JOIN public.classrooms c ON c.id=p_class AND c.tenant_id=p_tenant AND c.status='active'
   CROSS JOIN LATERAL public.classroom_teacher_access(account.id,c.id) access
   WHERE actor.id=p_actor AND actor.kind='account' AND access.tenant_id=c.tenant_id
     AND public.classroom_journal_teacher(actor.id,c.id)
 );
$$;

CREATE FUNCTION public.classroom_games_policy_read(p_actor uuid,p_tenant uuid,p_class uuid,p_seat uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.classroom_games_teacher(p_actor,p_tenant,p_class) THEN RETURN NULL; END IF;
 IF p_seat IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.classroom_student_seats s WHERE s.id=p_seat
   AND s.classroom_id=p_class AND s.tenant_id=p_tenant AND s.status<>'removed'
 ) THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('mode',COALESCE(p.mode,'allow'),'threshold',p.threshold,
   'state',COALESCE(p.state,'active'),'version',COALESCE(p.version,0)) INTO result
 FROM public.classrooms c LEFT JOIN public.classroom_games_policies p ON p.classroom_id=c.id
 WHERE c.id=p_class AND c.tenant_id=p_tenant;
 IF p_seat IS NOT NULL THEN
   result:=result||jsonb_build_object('override',COALESCE((SELECT o.override
     FROM public.classroom_games_seat_overrides o WHERE o.seat_id=p_seat
     AND o.classroom_id=p_class AND o.tenant_id=p_tenant),'inherit'));
 END IF;
 RETURN result;
END;
$$;

CREATE FUNCTION public.classroom_games_policy_write(
 p_actor uuid,p_tenant uuid,p_class uuid,p_seat uuid,p_action text,p_input jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_version integer; v_expected integer; v_threshold numeric; v_before jsonb; v_after jsonb;
BEGIN
 -- Lock the existing class even before its first policy row. Prevent initial
 -- insert races and serialize class/Seat updates under the same expectedVersion.
 PERFORM 1 FROM public.classrooms c WHERE c.id=p_class AND c.tenant_id=p_tenant FOR UPDATE;
 IF NOT FOUND OR NOT public.classroom_games_teacher(p_actor,p_tenant,p_class) THEN
   RETURN '{"error":"forbidden"}';
 END IF;
 IF p_action IS NULL OR p_action NOT IN ('class','seat','revoke')
   OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RETURN '{"error":"invalid_policy"}'; END IF;
 IF (p_action='seat') IS DISTINCT FROM (p_seat IS NOT NULL) THEN RETURN '{"error":"invalid_policy"}'; END IF;
 IF p_seat IS NOT NULL THEN
   PERFORM 1 FROM public.classroom_student_seats s WHERE s.id=p_seat
     AND s.classroom_id=p_class AND s.tenant_id=p_tenant AND s.status<>'removed' FOR UPDATE;
   IF NOT FOUND THEN RETURN '{"error":"forbidden"}'; END IF;
 END IF;
 IF jsonb_typeof(p_input->'expectedVersion') IS DISTINCT FROM 'number'
   OR (p_input->>'expectedVersion') !~ '^(0|[1-9][0-9]{0,9})$' THEN RETURN '{"error":"invalid_policy"}'; END IF;
 BEGIN v_expected:=(p_input->>'expectedVersion')::integer;
 EXCEPTION WHEN numeric_value_out_of_range THEN RETURN '{"error":"invalid_policy"}'; END;
 IF p_action='class' THEN
   IF p_input-ARRAY['mode','threshold','expectedVersion']<>'{}'::jsonb
     OR COALESCE(p_input->>'mode','') NOT IN ('allow','deny','rating_threshold')
     OR NOT (p_input ? 'threshold') THEN RETURN '{"error":"invalid_policy"}'; END IF;
   IF p_input->>'mode'='rating_threshold' THEN
     IF jsonb_typeof(p_input->'threshold') IS DISTINCT FROM 'number' THEN RETURN '{"error":"invalid_policy"}'; END IF;
     v_threshold:=(p_input->>'threshold')::numeric;
     IF NOT (v_threshold>=0 AND v_threshold<=100) THEN RETURN '{"error":"invalid_policy"}'; END IF;
   ELSIF p_input->'threshold'<>'null'::jsonb THEN RETURN '{"error":"invalid_policy"}'; END IF;
 ELSIF p_action='seat' THEN
   IF p_input-ARRAY['override','expectedVersion']<>'{}'::jsonb
     OR COALESCE(p_input->>'override','') NOT IN ('inherit','allow','deny') THEN RETURN '{"error":"invalid_policy"}'; END IF;
 ELSIF p_input-ARRAY['expectedVersion']<>'{}'::jsonb THEN RETURN '{"error":"invalid_policy"}'; END IF;
 v_before:=public.classroom_games_policy_read(p_actor,p_tenant,p_class,p_seat);
 v_version:=(v_before->>'version')::integer;
 IF v_version<>v_expected OR v_version=2147483647 THEN RETURN '{"error":"version_conflict"}'; END IF;
 INSERT INTO public.classroom_games_policies(classroom_id,tenant_id,updated_by)
 VALUES(p_class,p_tenant,p_actor) ON CONFLICT(classroom_id) DO NOTHING;
 IF p_action='class' THEN
   UPDATE public.classroom_games_policies SET mode=p_input->>'mode',threshold=v_threshold,state='active'
   WHERE classroom_id=p_class;
 ELSIF p_action='revoke' THEN
   UPDATE public.classroom_games_policies SET state='revoked' WHERE classroom_id=p_class;
 ELSE
   INSERT INTO public.classroom_games_seat_overrides(seat_id,tenant_id,classroom_id,override,updated_by)
   VALUES(p_seat,p_tenant,p_class,p_input->>'override',p_actor)
   ON CONFLICT(seat_id) DO UPDATE SET override=excluded.override,updated_by=p_actor,updated_at=now();
 END IF;
 UPDATE public.classroom_games_policies SET version=version+1,updated_by=p_actor,updated_at=now() WHERE classroom_id=p_class;
 v_after:=public.classroom_games_policy_read(p_actor,p_tenant,p_class,p_seat);
 INSERT INTO public.audit_events(tenant_id,entity_type,entity_id,action,payload_json)
 VALUES(p_tenant,'classroom',p_class,'classroom.games.'||p_action,
   jsonb_build_object('actorId',p_actor,'seatId',p_seat,'before',v_before,'after',v_after));
 RETURN v_after;
END;
$$;

-- Internal snapshot for the pure evaluator. Runtime actor arguments come only
-- from trusted session resolution, never from learner query/body/project IDs.
-- Recheck cookie/credential version after resolver, so rotation/revocation cannot
-- reuse a stale resolved Seat. This function has no identity/heartbeat writes.
CREATE FUNCTION public.classroom_games_admission_snapshot(
 p_actor uuid,p_tenant uuid,p_class uuid,p_seat uuid,p_session_hash varchar
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_policy record; v_override text; v_rating numeric;
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM public.principals actor
   JOIN public.classroom_student_seats s ON s.id=actor.seat_id AND s.status='active'
   JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id AND c.status='active'
   JOIN public.classroom_student_sessions session ON session.seat_id=s.id
     AND session.token_hash=p_session_hash AND session.revoked_at IS NULL
     AND session.expires_at>now() AND session.last_seen_at>now()-interval '60 minutes'
   JOIN public.classroom_seat_credentials credential ON credential.seat_id=s.id AND credential.version=session.credential_version
   JOIN public.learner_identity_links sl ON sl.seat_id=s.id AND sl.link_kind='student_seat'
     AND sl.tenant_id=c.tenant_id AND sl.school_id=c.school_id AND sl.status='active' AND sl.disabled_at IS NULL
   JOIN public.learner_identities learner ON learner.id=sl.learner_identity_id AND learner.state='active'
     AND learner.tenant_id=c.tenant_id AND learner.school_id=c.school_id
   WHERE actor.id=p_actor AND actor.kind='student_seat' AND s.id=p_seat
     AND c.id=p_class AND c.tenant_id=p_tenant
 ) THEN RETURN NULL; END IF;
 SELECT COALESCE(p.mode,'allow') mode,p.threshold,COALESCE(p.state,'active') state INTO v_policy
 FROM public.classrooms c LEFT JOIN public.classroom_games_policies p ON p.classroom_id=c.id WHERE c.id=p_class;
 SELECT COALESCE((SELECT o.override FROM public.classroom_games_seat_overrides o
   WHERE o.seat_id=p_seat AND o.tenant_id=p_tenant AND o.classroom_id=p_class),'inherit') INTO v_override;
 IF v_policy.state='active' AND v_policy.mode='rating_threshold' AND v_override='inherit' THEN
   -- Canonical ClassroomParticipant metrics.score, already computed for the
   -- current class factors/period. No mean/Elo/client score or extra rounding.
   SELECT (metric.item->>'score')::numeric INTO v_rating
   FROM public.classroom_participant_metrics(p_class) metric WHERE metric.item->>'seatId'=p_seat::text;
 END IF;
 RETURN jsonb_build_object('eligible',true,'state',v_policy.state,'mode',v_policy.mode,
   'threshold',v_policy.threshold,'override',v_override,'rating',v_rating);
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_games_teacher(uuid,uuid,uuid),
 public.classroom_games_policy_read(uuid,uuid,uuid,uuid),
 public.classroom_games_policy_write(uuid,uuid,uuid,uuid,text,jsonb),
 public.classroom_games_admission_snapshot(uuid,uuid,uuid,uuid,varchar) FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION public.classroom_games_policy_read(uuid,uuid,uuid,uuid),
 public.classroom_games_policy_write(uuid,uuid,uuid,uuid,text,jsonb),
 public.classroom_games_admission_snapshot(uuid,uuid,uuid,uuid,varchar) TO asalab_app;
