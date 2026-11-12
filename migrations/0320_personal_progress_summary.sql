-- Own statistics and bounded own groups. No writes, backfill, grants to tables,
-- new score formula, roster response or Account authority through a Seat.
-- The API performs the existing optional session heartbeat before this call.
-- All revalidation and projection below use this STABLE call's single snapshot.
CREATE FUNCTION public.personal_progress_summary(
 p_kind text, p_owner uuid, p_principal uuid, p_token_hash text, p_after uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $$
DECLARE
 v_modern boolean;
 v_authorized boolean;
 v_class uuid;
 v_result jsonb;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('account','seat') OR p_owner IS NULL
  OR p_principal IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'invalid progress session' USING ERRCODE='P6S01';
 END IF;

 IF p_kind='account' THEN
  -- Same modern authority joins as session_v2_context (0216), without its
  -- optional heartbeat. A valid modern identity takes precedence over legacy.
  WITH modern AS MATERIALIZED (
   SELECT principal.id principal_id,account.id account_id
   FROM public.sessions_v2 session
   JOIN public.principals principal ON principal.id=session.principal_id
   JOIN public.accounts account ON account.id=principal.account_id AND account.status='active'
   JOIN public.profiles profile ON profile.account_id=account.id
   JOIN public.workspaces workspace ON workspace.id=session.active_workspace_id AND workspace.status='active'
   JOIN public.workspace_memberships membership ON membership.account_id=account.id
    AND membership.workspace_id=workspace.id AND membership.state='active'
   WHERE session.token_hash=p_token_hash AND session.revoked_at IS NULL AND session.expires_at>now()
  ) SELECT EXISTS(SELECT 1 FROM modern),
    EXISTS(SELECT 1 FROM modern WHERE principal_id=p_principal AND account_id=p_owner)
   INTO v_modern,v_authorized;
  IF NOT v_modern THEN
   SELECT EXISTS(
    SELECT 1 FROM public.auth_resolve_session(p_token_hash::varchar) session
    CROSS JOIN LATERAL public.auth_account_for_user(session.tenant_id,session.user_id) identity
    JOIN public.accounts account ON account.id=identity.account_id AND account.status='active'
    JOIN public.principals principal ON principal.id=identity.principal_id
     AND principal.account_id=account.id AND principal.kind='account'
    WHERE identity.account_id=p_owner AND identity.principal_id=p_principal
   ) INTO v_authorized;
  END IF;
  IF NOT v_authorized THEN
   RAISE EXCEPTION 'invalid progress session' USING ERRCODE='P6S01';
  END IF;
 ELSE
  -- Same credentials, idle, expiry and active-state authority as 0237.
  SELECT classroom.id INTO v_class
  FROM public.classroom_student_sessions session
  JOIN public.classroom_seat_credentials credential
   ON credential.seat_id=session.seat_id AND credential.version=session.credential_version
  JOIN public.classroom_student_seats seat ON seat.id=session.seat_id
  JOIN public.classrooms classroom ON classroom.id=seat.classroom_id AND classroom.tenant_id=seat.tenant_id
  WHERE session.token_hash=p_token_hash AND session.revoked_at IS NULL
   AND session.expires_at>now() AND session.last_seen_at>now()-interval '60 minutes'
   AND seat.status='active' AND classroom.status='active' AND seat.id=p_owner;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'invalid progress session' USING ERRCODE='P6S01';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ai_student_principal_existing(p_owner) owner
    WHERE owner.principal_id=p_principal AND owner.classroom_id=v_class) THEN
   RAISE EXCEPTION 'progress owner unavailable' USING ERRCODE='P6S02';
  END IF;
 END IF;

 WITH account_seats AS MATERIALIZED (
  -- Candidate links narrow the lookup; the existing 0208 principal helper is
  -- the final proof. It retains archived class / suspended Seat own history.
  SELECT DISTINCT seat.id,seat.classroom_id,seat.status,classroom.title,classroom.status class_status
  FROM public.learner_identity_links account_link
  JOIN public.learner_identity_links seat_link
   ON seat_link.learner_identity_id=account_link.learner_identity_id
   AND seat_link.tenant_id=account_link.tenant_id AND seat_link.school_id=account_link.school_id
   AND seat_link.link_kind='student_seat' AND seat_link.status='active' AND seat_link.disabled_at IS NULL
  JOIN public.classroom_student_seats seat ON seat.id=seat_link.seat_id
  JOIN public.classrooms classroom ON classroom.id=seat.classroom_id AND classroom.tenant_id=seat.tenant_id
  WHERE p_kind='account' AND account_link.account_id=p_owner AND account_link.link_kind='account'
   AND account_link.status='active' AND account_link.disabled_at IS NULL
   AND EXISTS(SELECT 1 FROM public.classroom_participant_principals(seat.id) identity WHERE identity.id=p_principal)
 ), owners AS MATERIALIZED (
  SELECT p_principal id
  UNION
  SELECT principal.id FROM account_seats seat
  JOIN public.principals principal ON principal.seat_id=seat.id AND principal.kind='student_seat'
 ), publications AS MATERIALIZED (
  SELECT state.id,state.current_revision_id
  FROM public.project_publication_state state JOIN owners owner ON owner.id=state.owner_principal_id
  WHERE EXISTS(SELECT 1 FROM public.project_publication_revisions revision
   WHERE revision.publication_id=state.id AND revision.tenant_id=state.tenant_id AND revision.project_id=state.project_id)
 ), likes AS (
  SELECT reaction.publication_id,count(*) n FROM public.project_reactions reaction
  JOIN publications publication ON publication.id=reaction.publication_id
  WHERE reaction.kind='like' GROUP BY reaction.publication_id
 ), copies AS (
  SELECT event.publication_id,count(*) n FROM public.publication_copy_events event
  JOIN publications publication ON publication.id=event.publication_id
  GROUP BY event.publication_id
 ), totals AS (
  SELECT count(*) works,COALESCE(sum(likes.n),0) likes,COALESCE(sum(copies.n),0) copies
  FROM publications publication LEFT JOIN likes ON likes.publication_id=publication.id
  LEFT JOIN copies ON copies.publication_id=publication.id
 ), active_public AS (
  -- Exact unfiltered catalogue eligibility (0306), not owner-history eligibility.
  SELECT count(*) n FROM publications publication
  JOIN public.project_publication_revisions revision ON revision.id=publication.current_revision_id
   AND revision.publication_id=publication.id
  JOIN public.project_versions version ON version.id=revision.project_version_id
  WHERE public.project_publication_readable(publication.id)
   AND revision.module_key IN('three-d','electronics','blocks','robotics')
 ), own_seats AS (
  SELECT id,classroom_id,title FROM account_seats WHERE class_status='active' AND status IN('issued','active')
  UNION
  SELECT p_owner,classroom.id,classroom.title FROM public.classrooms classroom
   WHERE p_kind='seat' AND classroom.id=v_class
 ), own_groups AS (
  SELECT classroom_id id,title,count(DISTINCT id) seat_count,
   CASE WHEN count(DISTINCT id)=1 THEN (array_agg(DISTINCT id))[1] ELSE NULL END seat_id
  FROM own_seats GROUP BY classroom_id,title
 ), lookahead AS MATERIALIZED (
  SELECT * FROM own_groups WHERE p_after IS NULL OR id>p_after ORDER BY id LIMIT 21
 ), page AS MATERIALIZED (
  SELECT * FROM lookahead ORDER BY id LIMIT 20
 ), results AS MATERIALIZED (
  -- One canonical calculation per bounded unique class, never per card/peer.
  -- Only a proven single own Seat is matched; ambiguity cannot pick a winner.
  SELECT page.*,metric.item,
   (public.classroom_participant_settings_json(page.id)->>'periodDays')::integer period_days
  FROM page LEFT JOIN LATERAL (
   SELECT item FROM public.classroom_participant_metrics(page.id)
   WHERE page.seat_count=1 AND item->>'seatId'=page.seat_id::text
  ) metric ON true
 ), group_items AS MATERIALIZED (
  SELECT id,(seat_count<>1 OR item IS NULL) unavailable,
   jsonb_build_object('groupId',id,'title',title,'periodDays',period_days,'own',
    CASE WHEN seat_count<>1 THEN jsonb_build_object('availability','unavailable','score',NULL,'rank',NULL,'reason','ambiguous_self_participant')
     WHEN item IS NULL THEN jsonb_build_object('availability','unavailable','score',NULL,'rank',NULL,'reason','source_unavailable')
     ELSE jsonb_build_object('availability','available','score',item->'score','rank',item->'rank') END) item
  FROM results
 ), group_data AS (
  SELECT COALESCE(jsonb_agg(item ORDER BY id),'[]'::jsonb) items,
   CASE WHEN COALESCE(bool_or(unavailable),false) THEN 'partial' ELSE 'available' END availability
  FROM group_items
 )
 SELECT jsonb_build_object(
  'scope',CASE WHEN p_kind='account' THEN jsonb_build_object('kind','account','accountId',p_owner)
   ELSE jsonb_build_object('kind','seat','seatId',p_owner,'classroomId',v_class) END,
  'asOf',statement_timestamp(),'availability',group_data.availability,
  'metrics',jsonb_build_object(
   'everPublishedWorks',jsonb_build_object('availability','available','value',totals.works),
   'currentLikes',jsonb_build_object('availability','available','value',totals.likes),
   'createdCopies',jsonb_build_object('availability','available','value',totals.copies),
   'activePublicWorks',jsonb_build_object('availability','available','value',active_public.n)),
  'coverage',jsonb_build_object(
   'everPublishedWorks',jsonb_build_object('basis','confirmed_publication_revisions','completeness','unknown','knownSince',NULL,
    'limitations',jsonb_build_array('history_before_canonical_records_unknown')),
   'currentLikes',jsonb_build_object('basis','current_publication_likes','completeness','complete','knownSince',NULL,'limitations','[]'::jsonb),
   'createdCopies',jsonb_build_object('basis','durable_publication_copy_receipts','completeness','unknown','knownSince',NULL,
    'limitations',jsonb_build_array('history_before_canonical_records_unknown','copies_not_supported_by_all_modules')),
   'activePublicWorks',jsonb_build_object('basis','current_catalog_visibility','completeness','complete','knownSince',NULL,'limitations','[]'::jsonb)),
  'personalRating',jsonb_build_object('availability','not_enabled','value',NULL),
  'groups',jsonb_build_object('availability',group_data.availability,'items',group_data.items,
   'hasMore',(SELECT count(*)>20 FROM lookahead),
   'nextGroupId',CASE WHEN (SELECT count(*)>20 FROM lookahead) THEN (SELECT id FROM page ORDER BY id DESC LIMIT 1) ELSE NULL END)
 ) INTO v_result FROM totals CROSS JOIN active_public CROSS JOIN group_data;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.personal_progress_summary(text,uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.personal_progress_summary(text,uuid,uuid,text,uuid) TO asalab_app;
