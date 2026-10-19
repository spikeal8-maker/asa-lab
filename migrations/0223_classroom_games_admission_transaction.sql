-- Integration of 0222. Preserve its policy, audit, rating and identity contracts.
-- The class row is also locked by classroom_games_policy_write. A game mutation
-- holds SHARE until its own transaction ends; a policy change therefore cannot
-- commit between admission and Project commit. No new table access is granted.
CREATE FUNCTION public.classroom_games_admission_lock(
 p_actor uuid,p_tenant uuid,p_class uuid,p_seat uuid,p_session_hash varchar
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM 1 FROM public.classrooms c
 WHERE c.id=p_class AND c.tenant_id=p_tenant AND c.status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.classroom_student_seats s
 JOIN public.principals actor ON actor.seat_id=s.id AND actor.kind='student_seat'
 WHERE actor.id=p_actor AND s.id=p_seat AND s.classroom_id=p_class
   AND s.tenant_id=p_tenant AND s.status='active' FOR SHARE OF s;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.classroom_seat_credentials credential
 JOIN public.classroom_student_sessions session
   ON session.seat_id=credential.seat_id AND session.credential_version=credential.version
 WHERE session.seat_id=p_seat AND session.token_hash=p_session_hash
   AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp()
   AND session.last_seen_at>clock_timestamp()-interval '60 minutes'
 FOR SHARE OF credential,session;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM 1 FROM public.learner_identity_links link
 JOIN public.learner_identities learner ON learner.id=link.learner_identity_id
 JOIN public.classrooms c ON c.id=p_class
 WHERE link.seat_id=p_seat AND link.link_kind='student_seat'
   AND link.status='active' AND link.disabled_at IS NULL AND learner.state='active'
   AND link.tenant_id=p_tenant AND learner.tenant_id=p_tenant
   AND link.school_id=c.school_id AND learner.school_id=c.school_id
 FOR SHARE OF link,learner;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN public.classroom_games_admission_snapshot(p_actor,p_tenant,p_class,p_seat,p_session_hash);
END;
$$;

-- A teacher can inspect the effective policy for the exact authorized Seat.
-- This does not mint a student session or permission and exposes no extra roster.
CREATE FUNCTION public.classroom_games_teacher_seat_snapshot(
 p_actor uuid,p_tenant uuid,p_class uuid,p_seat uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE policy jsonb; eligible boolean; rating numeric;
BEGIN
 IF p_seat IS NULL THEN RETURN NULL; END IF;
 policy:=public.classroom_games_policy_read(p_actor,p_tenant,p_class,p_seat);
 IF policy IS NULL THEN RETURN NULL; END IF;
 SELECT EXISTS (
   SELECT 1 FROM public.classroom_student_seats s
   JOIN public.classrooms c ON c.id=s.classroom_id AND c.tenant_id=s.tenant_id AND c.status='active'
   JOIN public.principals principal ON principal.seat_id=s.id AND principal.kind='student_seat'
   JOIN public.learner_identity_links link ON link.seat_id=s.id AND link.link_kind='student_seat'
     AND link.status='active' AND link.disabled_at IS NULL
     AND link.tenant_id=c.tenant_id AND link.school_id=c.school_id
   JOIN public.learner_identities learner ON learner.id=link.learner_identity_id AND learner.state='active'
     AND learner.tenant_id=c.tenant_id AND learner.school_id=c.school_id
   WHERE s.id=p_seat AND s.classroom_id=p_class AND s.tenant_id=p_tenant AND s.status='active'
 ) INTO eligible;
 IF eligible AND policy->>'state'='active' AND policy->>'mode'='rating_threshold'
   AND policy->>'override'='inherit' THEN
   SELECT (metric.item->>'score')::numeric INTO rating
   FROM public.classroom_participant_metrics(p_class) metric
   WHERE metric.item->>'seatId'=p_seat::text;
 END IF;
 RETURN jsonb_build_object('eligible',eligible,'state',policy->>'state','mode',policy->>'mode',
   'threshold',policy->'threshold','override',policy->>'override','rating',rating);
END;
$$;

REVOKE ALL ON FUNCTION public.classroom_games_admission_lock(uuid,uuid,uuid,uuid,varchar),
 public.classroom_games_teacher_seat_snapshot(uuid,uuid,uuid,uuid) FROM PUBLIC,asalab_app;
GRANT EXECUTE ON FUNCTION public.classroom_games_admission_lock(uuid,uuid,uuid,uuid,varchar),
 public.classroom_games_teacher_seat_snapshot(uuid,uuid,uuid,uuid) TO asalab_app;
