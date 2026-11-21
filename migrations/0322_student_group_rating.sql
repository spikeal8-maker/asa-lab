-- SP-04 learner-only group leaderboard. No roster grants, no modified scoring
-- formulas, no production side effects. Uses the existing 0209 calculation.
-- Private helpers must never be executable by the restricted runtime role.
CREATE FUNCTION public.personal_progress_group_member(
  p_kind text,
  p_owner uuid,
  p_principal uuid,
  p_token_hash text,
  p_class uuid
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_class_status text;
  v_modern boolean := false;
  v_authorized boolean := false;
  v_seat uuid;
  v_seats uuid[];
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('account','seat')
    OR p_owner IS NULL OR p_principal IS NULL OR p_class IS NULL
    OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'invalid group progress session' USING ERRCODE='P6S01';
  END IF;

  SELECT classroom.tenant_id,classroom.status
    INTO v_tenant,v_class_status
  FROM public.classrooms classroom WHERE classroom.id=p_class;
  IF v_tenant IS NULL OR v_class_status<>'active' THEN
    RAISE EXCEPTION 'group progress unavailable' USING ERRCODE='P6S02';
  END IF;

  IF p_kind='seat' THEN
    -- Session, credential version, idle timeout and principal must all remain
    -- valid. A confirmed Account link never enlarges Seat-scope authority.
    SELECT seat.id INTO v_seat
    FROM public.classroom_student_sessions session
    JOIN public.classroom_seat_credentials credential
      ON credential.seat_id=session.seat_id
     AND credential.version=session.credential_version
    JOIN public.classroom_student_seats seat ON seat.id=session.seat_id
    JOIN public.classrooms classroom ON classroom.id=seat.classroom_id
      AND classroom.tenant_id=seat.tenant_id AND classroom.status='active'
    WHERE session.token_hash=p_token_hash AND session.revoked_at IS NULL
      AND session.expires_at>now()
      AND session.last_seen_at>now()-interval '60 minutes'
      AND seat.status='active' AND seat.id=p_owner
      AND seat.classroom_id=p_class AND seat.tenant_id=v_tenant;
    IF v_seat IS NULL THEN
      RAISE EXCEPTION 'invalid group progress session' USING ERRCODE='P6S01';
    END IF;
    IF NOT EXISTS(
      SELECT 1 FROM public.ai_student_principal_existing(v_seat) owner
      WHERE owner.principal_id=p_principal AND owner.classroom_id=p_class
    ) THEN
      RAISE EXCEPTION 'group progress unavailable' USING ERRCODE='P6S02';
    END IF;
    RETURN v_seat;
  END IF;

  -- Match 0320's modern-vs-legacy session precedence. Group membership
  -- is separately proven by exact tenant/context identity links; changing
  -- the active workspace must not hide another legitimate school group.
  WITH modern AS MATERIALIZED (
    SELECT principal.id principal_id,account.id account_id,
      workspace.tenant_id tenant_id
    FROM public.sessions_v2 session
    JOIN public.principals principal ON principal.id=session.principal_id
      AND principal.kind='account'
    JOIN public.accounts account ON account.id=principal.account_id
      AND account.status='active'
    JOIN public.profiles profile ON profile.account_id=account.id
    JOIN public.workspaces workspace ON workspace.id=session.active_workspace_id
      AND workspace.status='active'
    JOIN public.workspace_memberships membership
      ON membership.account_id=account.id AND membership.workspace_id=workspace.id
      AND membership.state='active'
    WHERE session.token_hash=p_token_hash AND session.revoked_at IS NULL
      AND session.expires_at>now()
  )
  SELECT EXISTS(SELECT 1 FROM modern),
    EXISTS(SELECT 1 FROM modern WHERE principal_id=p_principal
      AND account_id=p_owner)
  INTO v_modern,v_authorized;

  IF NOT v_modern THEN
    SELECT EXISTS(
      SELECT 1 FROM public.auth_resolve_session(p_token_hash::varchar) session
      CROSS JOIN LATERAL public.auth_account_for_user(session.tenant_id,session.user_id) identity
      JOIN public.accounts account ON account.id=identity.account_id
        AND account.status='active'
      JOIN public.principals principal ON principal.id=identity.principal_id
        AND principal.account_id=account.id AND principal.kind='account'
      WHERE identity.account_id=p_owner AND identity.principal_id=p_principal
    ) INTO v_authorized;
  END IF;
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'invalid group progress session' USING ERRCODE='P6S01';
  END IF;

  -- A teacher role, shared name, copied avatar or stale Account/Seat link
  -- cannot establish learner membership. The 0208 helper is the final proof.
  SELECT array_agg(DISTINCT seat.id) INTO v_seats
  FROM public.classroom_student_seats seat
  JOIN public.classrooms classroom
    ON classroom.id=seat.classroom_id AND classroom.tenant_id=seat.tenant_id
    AND classroom.status='active'
  JOIN public.learner_identity_links seat_link
    ON seat_link.seat_id=seat.id AND seat_link.link_kind='student_seat'
    AND seat_link.tenant_id=seat.tenant_id
    AND seat_link.school_id IS NOT DISTINCT FROM classroom.school_id
    AND seat_link.status='active' AND seat_link.disabled_at IS NULL
  JOIN public.learner_identities learner
    ON learner.id=seat_link.learner_identity_id
    AND learner.tenant_id=seat.tenant_id
    AND learner.school_id IS NOT DISTINCT FROM classroom.school_id
    AND learner.state='active'
  JOIN public.learner_identity_links account_link
    ON account_link.learner_identity_id=learner.id
    AND account_link.link_kind='account' AND account_link.account_id=p_owner
    AND account_link.tenant_id=seat.tenant_id
    AND account_link.school_id IS NOT DISTINCT FROM classroom.school_id
    AND account_link.status='active' AND account_link.disabled_at IS NULL
  WHERE classroom.id=p_class AND classroom.tenant_id=v_tenant
    AND seat.status IN('issued','active')
    AND NOT EXISTS (
      SELECT 1 FROM public.learning_migration_batches batch
      WHERE batch.id IN(
        seat_link.created_by_batch_id,
        account_link.created_by_batch_id,
        learner.created_by_batch_id
      ) AND (batch.state<>'active' OR batch.disabled_at IS NOT NULL
        OR batch.tenant_id<>v_tenant
        OR batch.school_id IS DISTINCT FROM classroom.school_id)
    )
    AND EXISTS(
      SELECT 1 FROM public.classroom_participant_principals(seat.id) identity
      WHERE identity.id=p_principal
    );
  IF COALESCE(array_length(v_seats,1),0)<>1 THEN
    RAISE EXCEPTION 'group progress unavailable' USING ERRCODE='P6S02';
  END IF;
  RETURN v_seats[1];
END;
$$;
REVOKE ALL ON FUNCTION public.personal_progress_group_member(text,uuid,uuid,text,uuid)
  FROM PUBLIC,asalab_app;

-- Every page is one authorized statement snapshot and one canonical metrics
-- evaluation. The complete roster is never sent over HTTP; selected peer rows
-- contain only private SQL identifiers, avatar choices and score/rank. The API
-- must seal identifiers and explicitly construct its learner-safe response.
CREATE FUNCTION public.personal_progress_group_rating(
  p_kind text,
  p_owner uuid,
  p_principal uuid,
  p_token_hash text,
  p_class uuid,
  p_after_score numeric DEFAULT NULL,
  p_after_seat uuid DEFAULT NULL,
  p_limit integer DEFAULT 5
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $$
DECLARE
  v_self uuid;
  v_result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid group page' USING ERRCODE='P6S03';
  END IF;
  v_self:=public.personal_progress_group_member(
    p_kind,p_owner,p_principal,p_token_hash,p_class
  );

  WITH settings AS MATERIALIZED (
    SELECT public.classroom_participant_settings_json(p_class) value
  ),
  metrics AS MATERIALIZED (
    SELECT (item->>'seatId')::uuid seat_id,
      (item->>'score')::numeric score,
      (item->>'rank')::integer place,
      item->>'avatarUrl' avatar_url
    FROM public.classroom_participant_metrics(p_class)
  ),
  members AS MATERIALIZED (
    SELECT metric.seat_id,metric.score,metric.place,seat.avatar_key,
      -- The canonical metric already verified custom-avatar availability.
      -- Reuse that exact decision rather than recalculating its guard for
      -- every learner a second time in SP-04.
      CASE WHEN image.id IS NOT NULL AND metric.avatar_url =
        '/api/classrooms/'||p_class||'/participants/'||seat.id||'/avatars/'||image.id||'/image'
        THEN image.id ELSE NULL END avatar_id
    FROM metrics metric
    JOIN public.classroom_student_seats seat ON seat.id=metric.seat_id
      AND seat.classroom_id=p_class AND seat.status<>'removed'
    -- Set joins instead of a correlated per-peer avatar query (SQL N+1).
    LEFT JOIN public.classroom_custom_avatar_choices chosen ON chosen.seat_id=seat.id
    LEFT JOIN public.classroom_custom_avatars image
      ON image.id=chosen.avatar_id AND image.classroom_id=p_class
  ),
  fingerprint AS MATERIALIZED (
    SELECT md5(
      COALESCE((
        SELECT string_agg(
          format('%s:%s:%s:%s:%s',m.seat_id,
            COALESCE(m.score::text,'null'),COALESCE(m.place::text,'null'),
            COALESCE(m.avatar_key,''),COALESCE(m.avatar_id::text,'')),
          ';' ORDER BY m.seat_id
        ) FROM members m
      ),'empty')||':'||(SELECT value::text FROM settings)
    ) version
  ),
  peer_lookahead AS MATERIALIZED (
    SELECT m.* FROM members m WHERE m.seat_id<>v_self
      -- A disabled rating must never become a silent avatar/participant roster.
      AND EXISTS(SELECT 1 FROM jsonb_each((SELECT value->'factors' FROM settings)) factor
        WHERE factor.value='true'::jsonb)
      AND (
        p_after_seat IS NULL OR
        (p_after_score IS NULL AND m.score IS NULL AND m.seat_id>p_after_seat) OR
        (p_after_score IS NOT NULL AND
          (m.score IS NULL OR m.score<p_after_score OR
            (m.score=p_after_score AND m.seat_id>p_after_seat)))
      )
    ORDER BY m.score DESC NULLS LAST,m.seat_id
    LIMIT p_limit+1
  ),
  peer_page AS MATERIALIZED (
    SELECT * FROM peer_lookahead
    ORDER BY score DESC NULLS LAST,seat_id LIMIT p_limit
  ),
  self_result AS MATERIALIZED (
    SELECT m.score,m.place FROM members m WHERE m.seat_id=v_self
  )
  SELECT jsonb_build_object(
    'groupId',p_class,
    'periodDays',(SELECT (value->>'periodDays')::integer FROM settings),
    'version',(SELECT version FROM fingerprint),
    'asOf',statement_timestamp(),
    'own',CASE WHEN NOT EXISTS(SELECT 1 FROM self_result)
      THEN jsonb_build_object('availability','unavailable','score',NULL,'rank',NULL,'reason','source_unavailable')
      WHEN (SELECT count(*) FROM jsonb_each((SELECT value->'factors' FROM settings)) x WHERE x.value='true'::jsonb)=0
      THEN jsonb_build_object('availability','unavailable','score',NULL,'rank',NULL,'reason','rating_disabled')
      ELSE jsonb_build_object('availability','available',
        'score',(SELECT score FROM self_result),'rank',(SELECT place FROM self_result))
      END,
    'peers',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'seatId',seat_id,'score',score,'rank',place,
        'avatarKey',avatar_key,'avatarId',avatar_id)
        ORDER BY score DESC NULLS LAST,seat_id
      ) FROM peer_page
    ),'[]'::jsonb),
    'hasMore',(SELECT count(*)>p_limit FROM peer_lookahead),
    'afterSeat',CASE WHEN (SELECT count(*)>p_limit FROM peer_lookahead)
      THEN (SELECT seat_id FROM peer_page
        ORDER BY score ASC NULLS FIRST,seat_id DESC LIMIT 1)
      ELSE NULL END,
    'afterScore',CASE WHEN (SELECT count(*)>p_limit FROM peer_lookahead)
      THEN (SELECT score FROM peer_page
        ORDER BY score ASC NULLS FIRST,seat_id DESC LIMIT 1)
      ELSE NULL END
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.personal_progress_group_rating(
  text,uuid,uuid,text,uuid,numeric,uuid,integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.personal_progress_group_rating(
  text,uuid,uuid,text,uuid,numeric,uuid,integer
) TO asalab_app;

-- One bounded authorized image read per page; no per-avatar SQL N+1. The
-- API decrypts opaque session-bound peer tickets before passing seat UUIDs.
-- Each request repeats membership, tenant, principal and session checks.
CREATE FUNCTION public.personal_progress_group_avatar_batch(
  p_kind text,
  p_owner uuid,
  p_principal uuid,
  p_token_hash text,
  p_class uuid,
  p_seats uuid[]
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  v_self uuid;
  v_result jsonb;
BEGIN
  IF p_seats IS NULL OR cardinality(p_seats)>20
    OR array_position(p_seats,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'invalid avatar page' USING ERRCODE='P6S03';
  END IF;
  v_self:=public.personal_progress_group_member(
    p_kind,p_owner,p_principal,p_token_hash,p_class
  );
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('seatId',seat.id,'dataUrl',image.data_url)
    ORDER BY seat.id
  ),'[]'::jsonb) INTO v_result
  FROM (
    SELECT DISTINCT requested.id FROM unnest(p_seats) requested(id)
  ) requested
  JOIN public.classroom_student_seats seat
    ON seat.id=requested.id AND seat.classroom_id=p_class
    AND seat.status<>'removed'
  JOIN public.classroom_custom_avatar_choices chosen ON chosen.seat_id=seat.id
  JOIN public.classroom_custom_avatars image
    ON image.id=chosen.avatar_id AND image.classroom_id=p_class
  -- A ticket issued earlier must not survive removal of the peer's learner
  -- identity, even if the Seat row and custom avatar choice still exist.
  WHERE EXISTS(SELECT 1 FROM public.classroom_participant_principals(seat.id))
    -- Turning a classroom rating OFF must invalidate previously issued
    -- encrypted peer-image tickets as well as the rating page itself.
    AND EXISTS(SELECT 1 FROM jsonb_each(
      public.classroom_participant_settings_json(p_class)->'factors') factor
      WHERE factor.value='true'::jsonb)
    AND public.classroom_participant_avatar_available(seat.id,image.id);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.personal_progress_group_avatar_batch(
  text,uuid,uuid,text,uuid,uuid[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.personal_progress_group_avatar_batch(
  text,uuid,uuid,text,uuid,uuid[]
) TO asalab_app;
