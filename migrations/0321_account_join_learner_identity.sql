-- Ordinary Account admission must establish the same school learner as the
-- StudentCode writer, even when the class has no Learning audience.
-- Supported rollout: quiesced asa_manager update or isolated prefix upgrade.
-- Do not hot-apply while an old approval function is already executing.
-- Fail before changing functions/data if a legacy writer holds either table.
LOCK TABLE public.classroom_account_join_requests,
           public.classroom_student_seats IN EXCLUSIVE MODE NOWAIT;

-- Read-only owner helpers. No runtime grant and no change to the shared 0095
-- constructor: old writers take Seat locks before touching Account links.
CREATE FUNCTION public.classroom_account_join_identity_coherent(
  p_account uuid,p_class uuid,p_seat uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.classroom_student_seats seat
   JOIN public.classrooms classroom ON classroom.id=seat.classroom_id
     AND classroom.tenant_id=seat.tenant_id AND classroom.status='active'
   JOIN public.schools school ON school.id=classroom.school_id
     AND school.tenant_id=classroom.tenant_id
   JOIN public.accounts account ON account.id=seat.account_id AND account.status='active'
   JOIN public.principals sp ON sp.kind='student_seat' AND sp.seat_id=seat.id
   JOIN public.principals ap ON ap.kind='account' AND ap.account_id=account.id
   JOIN public.learner_identity_links sl ON sl.seat_id=seat.id
     AND sl.link_kind='student_seat' AND sl.tenant_id=seat.tenant_id
     AND sl.school_id=school.id AND sl.status='active' AND sl.disabled_at IS NULL
   JOIN public.learner_identities learner ON learner.id=sl.learner_identity_id
     AND learner.tenant_id=seat.tenant_id AND learner.school_id=school.id AND learner.state='active'
   JOIN public.learner_identity_links al ON al.account_id=account.id
     AND al.link_kind='account' AND al.tenant_id=seat.tenant_id AND al.school_id=school.id
     AND al.learner_identity_id=learner.id AND al.status='active' AND al.disabled_at IS NULL
   WHERE seat.id=p_seat AND seat.classroom_id=p_class
     AND seat.account_id=p_account AND seat.status='active'
     AND NOT EXISTS (
       SELECT 1 FROM public.learning_migration_batches batch
       WHERE batch.id IN(sl.created_by_batch_id,al.created_by_batch_id,learner.created_by_batch_id)
         AND (batch.tenant_id<>seat.tenant_id OR batch.school_id<>school.id
           OR batch.state<>'active' OR batch.disabled_at IS NOT NULL)
     )
     AND EXISTS(SELECT 1 FROM public.classroom_participant_principals(seat.id) identity
                WHERE identity.id=ap.id)
 );
$$;

-- NULL means a genuinely missing target link may be initialized. Every other
-- value is a retained/conflicting boundary, not permission to replace it.
-- p_seat=NULL is used BEFORE the private materializer's INSERT/0095 trigger.
CREATE FUNCTION public.classroom_account_join_identity_guard(
  p_account uuid,p_class uuid,p_seat uuid
) RETURNS varchar
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_tenant uuid;v_school uuid;v_learner uuid;v_account_link uuid;
BEGIN
 SELECT classroom.tenant_id,classroom.school_id INTO v_tenant,v_school
 FROM public.classrooms classroom JOIN public.schools school
   ON school.id=classroom.school_id AND school.tenant_id=classroom.tenant_id
 WHERE classroom.id=p_class AND classroom.status='active';
 IF v_tenant IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=p_account AND status='active')
   OR NOT EXISTS(SELECT 1 FROM public.principals WHERE kind='account' AND account_id=p_account)
 THEN RETURN 'inactive_or_missing_account_scope'; END IF;

 IF p_seat IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.classroom_student_seats seat
     JOIN public.principals principal ON principal.kind='student_seat' AND principal.seat_id=seat.id
     WHERE seat.id=p_seat AND seat.tenant_id=v_tenant AND seat.classroom_id=p_class
       AND seat.account_id=p_account AND seat.status='active')
   THEN RETURN 'inactive_or_missing_seat_scope'; END IF;
   IF EXISTS(SELECT 1 FROM public.learner_identity_links WHERE seat_id=p_seat)
   THEN RETURN 'retained_target_link'; END IF;
   IF EXISTS(SELECT 1 FROM public.learner_identities
     WHERE id=public.learning_m0_deterministic_uuid('learner:'||v_school||':seat:'||p_seat))
     OR EXISTS(SELECT 1 FROM public.learning_migration_artifacts
       WHERE source_table='classroom_student_seats' AND source_id=p_seat
         AND artifact_kind IN('learner_identity','identity_link'))
     OR EXISTS(SELECT 1 FROM public.learning_attempts
       WHERE seat_id=p_seat AND learner_identity_id IS NOT NULL)
     OR EXISTS(SELECT 1 FROM public.learning_audience_operations WHERE source_seat_id=p_seat)
   THEN RETURN 'retained_target_history'; END IF;
 END IF;

 SELECT link.id,link.learner_identity_id INTO v_account_link,v_learner
 FROM public.learner_identity_links link
 WHERE link.account_id=p_account AND link.school_id=v_school;
 IF v_account_link IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.learner_identity_links link
   JOIN public.learner_identities learner ON learner.id=link.learner_identity_id
   WHERE link.id=v_account_link AND link.link_kind='account' AND link.tenant_id=v_tenant
     AND link.school_id=v_school AND link.status='active' AND link.disabled_at IS NULL
     AND learner.tenant_id=v_tenant AND learner.school_id=v_school AND learner.state='active'
     AND NOT EXISTS(SELECT 1 FROM public.learning_migration_batches batch
       WHERE batch.id IN(link.created_by_batch_id,learner.created_by_batch_id)
         AND (batch.tenant_id<>v_tenant OR batch.school_id<>v_school
           OR batch.state<>'active' OR batch.disabled_at IS NOT NULL))
 ) THEN RETURN 'inactive_or_conflicting_account_link'; END IF;

 -- An existing Seat identity without the exact Account link is partial
 -- lineage. A second learner (or Account on this learner) is never merged.
 IF EXISTS (
   SELECT 1 FROM public.classroom_student_seats seat
   JOIN public.classrooms classroom ON classroom.id=seat.classroom_id
   JOIN public.learner_identity_links link ON link.seat_id=seat.id
   JOIN public.learner_identities learner ON learner.id=link.learner_identity_id
   WHERE seat.account_id=p_account AND classroom.tenant_id=v_tenant AND classroom.school_id=v_school
     AND (v_learner IS NULL OR seat.tenant_id<>v_tenant OR link.tenant_id<>v_tenant
       OR link.school_id<>v_school OR link.link_kind<>'student_seat'
       OR link.status<>'active' OR link.disabled_at IS NOT NULL
       OR learner.tenant_id<>v_tenant OR learner.school_id<>v_school OR learner.state<>'active'
       OR link.learner_identity_id<>v_learner
       OR EXISTS(SELECT 1 FROM public.learning_migration_batches batch
         WHERE batch.id IN(link.created_by_batch_id,learner.created_by_batch_id)
           AND (batch.tenant_id<>v_tenant OR batch.school_id<>v_school
             OR batch.state<>'active' OR batch.disabled_at IS NOT NULL)))
 ) OR EXISTS(SELECT 1 FROM public.learner_identity_links
   WHERE learner_identity_id=v_learner AND link_kind='account' AND account_id<>p_account)
 THEN RETURN 'conflicting_or_partial_lineage'; END IF;

 -- Deterministic M0 IDs survive erased links. A healthy M0 learner already
 -- selected by the exact active Account link is valid reuse, not a veto.
 IF EXISTS(SELECT 1 FROM public.learner_identities learner
   WHERE learner.id=public.learning_m0_deterministic_uuid('learner:'||v_school||':account:'||p_account)
     AND learner.id IS DISTINCT FROM v_learner)
   OR EXISTS(
     SELECT 1 FROM public.classroom_student_seats seat
     JOIN public.classrooms classroom ON classroom.id=seat.classroom_id
     JOIN public.learner_identities learner ON learner.id=public.learning_m0_deterministic_uuid(
       'learner:'||v_school||':seat:'||seat.id)
     WHERE seat.account_id=p_account AND classroom.tenant_id=v_tenant AND classroom.school_id=v_school
       AND learner.id IS DISTINCT FROM v_learner
   ) THEN RETURN 'retained_deterministic_learner'; END IF;

 IF EXISTS (
   SELECT 1 FROM public.learning_migration_artifacts artifact
   JOIN public.learning_migration_batches batch ON batch.id=artifact.batch_id
   WHERE artifact.tenant_id=v_tenant AND artifact.school_id=v_school
     AND artifact.artifact_kind IN('learner_identity','identity_link')
     AND ((artifact.source_table='accounts' AND artifact.source_id=p_account)
       OR (artifact.source_table='classroom_student_seats' AND EXISTS(
         SELECT 1 FROM public.classroom_student_seats seat
         JOIN public.classrooms classroom ON classroom.id=seat.classroom_id
         WHERE seat.id=artifact.source_id AND seat.account_id=p_account
           AND classroom.tenant_id=v_tenant AND classroom.school_id=v_school)))
     AND (v_learner IS NULL OR artifact.disabled_at IS NOT NULL OR batch.state<>'active'
       OR batch.disabled_at IS NOT NULL
       OR (artifact.source_evidence ? 'learnerId'
         AND artifact.source_evidence->>'learnerId' IS DISTINCT FROM v_learner::text)
       OR (artifact.artifact_kind='learner_identity' AND artifact.artifact_id IS DISTINCT FROM v_learner)
       OR (artifact.artifact_kind='identity_link' AND NOT EXISTS(
         SELECT 1 FROM public.learner_identity_links link
         WHERE link.id=artifact.artifact_id AND link.learner_identity_id=v_learner
           AND link.tenant_id=v_tenant AND link.school_id=v_school
           AND link.status='active' AND link.disabled_at IS NULL)))
 ) THEN RETURN 'retained_identity_artifact'; END IF;

 IF EXISTS (
   SELECT 1 FROM public.classroom_student_seats seat
   JOIN public.classrooms classroom ON classroom.id=seat.classroom_id
   WHERE seat.account_id=p_account AND classroom.tenant_id=v_tenant AND classroom.school_id=v_school
     AND (EXISTS(SELECT 1 FROM public.learning_attempts attempt
       WHERE attempt.seat_id=seat.id AND attempt.learner_identity_id IS NOT NULL
         AND attempt.learner_identity_id IS DISTINCT FROM v_learner)
       OR EXISTS(SELECT 1 FROM public.learning_audience_operations operation
         WHERE operation.source_seat_id=seat.id
           AND (v_learner IS NULL OR operation.learner_identity_id IS DISTINCT FROM v_learner)))
 ) THEN RETURN 'retained_learning_history'; END IF;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.classroom_account_join_identity_coherent(uuid,uuid,uuid),
 public.classroom_account_join_identity_guard(uuid,uuid,uuid) FROM PUBLIC,asalab_app;

-- Retain signature, owner, grants, authorization, receipt and audit semantics.
-- Account-school precedes request/Seat locks for every new approval writer.
CREATE OR REPLACE FUNCTION public.classroom_account_join_decide(
 p_actor_account uuid,p_actor uuid,p_class uuid,p_request uuid,p_decision varchar,p_reason varchar
) RETURNS varchar LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v_request public.classroom_account_join_requests%ROWTYPE;v_join record;
 v_account uuid;v_tenant uuid;v_school uuid;v_existing uuid;
BEGIN
 IF p_decision IS NULL OR p_decision NOT IN('approved','rejected') OR length(COALESCE(p_reason,''))>1000
 THEN RETURN 'invalid_decision'; END IF;
 -- Authorize without locking a request. Recheck after acquiring its scope lock.
 SELECT r.account_id,r.tenant_id,c.school_id INTO v_account,v_tenant,v_school
 FROM public.classroom_account_join_requests r
 JOIN public.classrooms c ON c.id=r.classroom_id AND c.tenant_id=r.tenant_id
 WHERE r.id=p_request AND r.classroom_id=p_class AND EXISTS(
   SELECT 1 FROM public.classroom_memberships m
   JOIN public.principals actor ON actor.account_id=m.account_id AND actor.id=p_actor
   WHERE m.account_id=p_actor_account AND m.classroom_id=p_class AND m.member_role IN('owner','co_teacher'));
 IF v_account IS NULL THEN RETURN 'forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(
   'account-join-learner:'||v_tenant||':'||v_school||':'||v_account,0));
 SELECT r.* INTO v_request FROM public.classroom_account_join_requests r
 JOIN public.classrooms c ON c.id=r.classroom_id AND c.tenant_id=r.tenant_id
 WHERE r.id=p_request AND r.classroom_id=p_class AND r.account_id=v_account
   AND r.tenant_id=v_tenant AND c.school_id=v_school AND EXISTS(
     SELECT 1 FROM public.classroom_memberships m
     JOIN public.principals actor ON actor.account_id=m.account_id AND actor.id=p_actor
     WHERE m.account_id=p_actor_account AND m.classroom_id=p_class AND m.member_role IN('owner','co_teacher'))
 FOR UPDATE OF r;
 IF v_request.id IS NULL THEN RETURN 'forbidden'; END IF;
 IF v_request.status<>'pending' THEN
   IF v_request.status=p_decision AND v_request.decided_by_principal_id=p_actor
     AND v_request.decision_reason IS NOT DISTINCT FROM p_reason THEN RETURN 'ok'; END IF;
   RETURN 'decision_conflict';
 END IF;
 IF p_decision='approved' THEN
   IF NOT EXISTS(SELECT 1 FROM public.classrooms c WHERE c.id=p_class AND c.status='active')
     OR NOT EXISTS(SELECT 1 FROM public.classroom_join_codes code
       WHERE code.tenant_id=v_tenant AND code.classroom_id=p_class
         AND code.token_hash=v_request.code_hash AND code.status='active')
   THEN RETURN 'not_available'; END IF;
   SELECT seat.id INTO v_existing FROM public.classroom_student_seats seat
   WHERE seat.classroom_id=p_class AND seat.account_id=v_account FOR UPDATE;
   -- A coherent existing active Seat needs no repair. All other retained Seat
   -- links/history and inactive Account lineage must fail BEFORE INSERT triggers.
   IF (v_existing IS NULL OR NOT public.classroom_account_join_identity_coherent(v_account,p_class,v_existing))
     AND public.classroom_account_join_identity_guard(v_account,p_class,v_existing) IS NOT NULL
   THEN RETURN 'not_available'; END IF;
 END IF;
 UPDATE public.classroom_account_join_requests
 SET status=p_decision,decided_at=now(),decided_by_principal_id=p_actor,decision_reason=p_reason
 WHERE id=p_request;
 IF p_decision='approved' THEN
   SELECT * INTO v_join FROM public.classroom_account_join_materialize_internal(v_account,v_request.code_hash);
   IF v_join.seat_id IS NULL OR v_join.classroom_id IS DISTINCT FROM p_class
   THEN RAISE EXCEPTION 'approved join could not materialize seat'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.learner_identity_links WHERE seat_id=v_join.seat_id) THEN
     PERFORM public.learning_audience_ensure_seat_identity(v_join.seat_id);
   END IF;
   -- A RETURN here would commit a partial request/Seat/trigger side effect.
   IF public.classroom_account_join_identity_coherent(v_account,p_class,v_join.seat_id) IS NOT TRUE
   THEN RAISE EXCEPTION 'approved join has incoherent learner identity'; END IF;
   UPDATE public.classroom_account_join_requests SET seat_id=v_join.seat_id WHERE id=p_request;
 END IF;
 INSERT INTO public.audit_events(tenant_id,actor_user_id,entity_type,entity_id,action,payload_json)
 VALUES(v_request.tenant_id,NULL,'classroom_join_request',p_request,'classroom.join.decided',
   jsonb_build_object('actorPrincipalId',p_actor,'decision',p_decision,'classroomId',p_class,'reason',p_reason));
 RETURN 'ok';
END;
$$;

-- Historical upgrade is deliberately bounded by persisted approval and audit.
-- Take ALL nonblocking Account locks before the first identity write. The table
-- fence excludes legacy Seat-first writers; try-lock avoids waiting on a new
-- approval that already owns its Account lock and is waiting for this fence.
DO $$
DECLARE v_scope record;v_request record;v_reason varchar;v_repaired integer:=0;v_skipped integer:=0;
 v_skip_reasons jsonb:='{}';
BEGIN
 FOR v_scope IN
   SELECT DISTINCT r.tenant_id,c.school_id,r.account_id
   FROM public.classroom_account_join_requests r
   JOIN public.classrooms c ON c.id=r.classroom_id AND c.tenant_id=r.tenant_id
   WHERE r.status='approved' AND r.seat_id IS NOT NULL
   ORDER BY r.tenant_id,c.school_id,r.account_id
 LOOP
   IF NOT pg_try_advisory_xact_lock(hashtextextended(
     'account-join-learner:'||v_scope.tenant_id||':'||v_scope.school_id||':'||v_scope.account_id,0))
   THEN RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='Account join identity upgrade requires quiesced admission writers'; END IF;
 END LOOP;
 FOR v_request IN
   SELECT r.* FROM public.classroom_account_join_requests r
   JOIN public.classrooms classroom ON classroom.id=r.classroom_id AND classroom.tenant_id=r.tenant_id
   WHERE r.status='approved' AND r.seat_id IS NOT NULL
     AND r.decided_at IS NOT NULL AND r.decided_by_principal_id IS NOT NULL
     AND EXISTS(SELECT 1 FROM public.audit_events audit
       WHERE audit.tenant_id=r.tenant_id AND audit.entity_type='classroom_join_request'
         AND audit.entity_id=r.id AND audit.action='classroom.join.decided'
         AND audit.payload_json->>'decision'='approved'
         AND audit.payload_json->>'actorPrincipalId'=r.decided_by_principal_id::text
         AND audit.payload_json->>'classroomId'=r.classroom_id::text)
   ORDER BY r.tenant_id,r.account_id,r.classroom_id,r.id
   FOR UPDATE OF r
 LOOP
   PERFORM 1 FROM public.classroom_student_seats WHERE id=v_request.seat_id FOR UPDATE;
   v_reason:=public.classroom_account_join_identity_guard(
     v_request.account_id,v_request.classroom_id,v_request.seat_id);
   IF v_reason IS NOT NULL THEN
     v_skipped:=v_skipped+1;
     v_skip_reasons:=jsonb_set(v_skip_reasons,ARRAY[v_reason],
       to_jsonb(COALESCE((v_skip_reasons->>v_reason)::integer,0)+1));
     CONTINUE;
   END IF;
   PERFORM public.learning_audience_ensure_seat_identity(v_request.seat_id);
   IF public.classroom_account_join_identity_coherent(
     v_request.account_id,v_request.classroom_id,v_request.seat_id) IS NOT TRUE
   THEN RAISE EXCEPTION 'historical approved join has incoherent learner identity'; END IF;
   v_repaired:=v_repaired+1;
 END LOOP;
 RAISE NOTICE '0321 approved Account joins: repaired %, preserved/skipped %, reasons %',
   v_repaired,v_skipped,v_skip_reasons;
END;
$$;
