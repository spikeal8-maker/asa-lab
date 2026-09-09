-- Result A: additive context parent; preserve every historical scope UUID.
-- See ADR-ACCESS-A-INDEPENDENT-CONTEXT. No academic evidence is rewritten.
CREATE TABLE learning_contexts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    kind varchar(32) NOT NULL CHECK (kind IN ('school', 'independent_teaching')),
    school_id uuid REFERENCES schools(id),
    legacy_school_id uuid REFERENCES schools(id),
    owner_account_id uuid REFERENCES accounts(id),
    workspace_id uuid REFERENCES workspaces(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),
    CHECK (
      (kind = 'school' AND school_id = id AND school_id IS NOT NULL
        AND legacy_school_id IS NULL AND owner_account_id IS NULL AND workspace_id IS NULL)
      OR (kind = 'independent_teaching' AND school_id IS NULL
        AND owner_account_id IS NOT NULL AND workspace_id IS NOT NULL)
    ),
    FOREIGN KEY (tenant_id, school_id) REFERENCES schools(tenant_id, id),
    FOREIGN KEY (tenant_id, legacy_school_id) REFERENCES schools(tenant_id, id)
);
CREATE UNIQUE INDEX learning_contexts_independent_owner_idx
  ON learning_contexts(owner_account_id) WHERE kind = 'independent_teaching';

CREATE FUNCTION access_learning_context_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.tenant_id,NEW.kind,NEW.school_id,NEW.legacy_school_id,NEW.owner_account_id,NEW.workspace_id)
    IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.kind,OLD.school_id,OLD.legacy_school_id,OLD.owner_account_id,OLD.workspace_id) THEN
    RAISE EXCEPTION 'learning_context_scope_immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='independent_teaching' AND NOT EXISTS (
    SELECT 1 FROM public.workspaces w JOIN public.workspace_memberships m ON m.workspace_id=w.id
    WHERE w.id=NEW.workspace_id AND w.tenant_id=NEW.tenant_id AND w.kind='personal'
      AND m.account_id=NEW.owner_account_id AND m.role='owner'
  ) THEN RAISE EXCEPTION 'learning_context_owner_scope_invalid' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION access_learning_context_guard() FROM PUBLIC;
CREATE TRIGGER learning_context_scope_guard BEFORE INSERT OR UPDATE ON learning_contexts
  FOR EACH ROW EXECUTE FUNCTION access_learning_context_guard();

INSERT INTO learning_contexts (id, tenant_id, kind, school_id, legacy_school_id,
                              owner_account_id, workspace_id, created_at)
SELECT school.id, school.tenant_id,
       CASE WHEN personal.account_id IS NULL THEN 'school' ELSE 'independent_teaching' END,
       CASE WHEN personal.account_id IS NULL THEN school.id ELSE NULL END,
       CASE WHEN personal.account_id IS NOT NULL THEN school.id ELSE NULL END,
       personal.account_id, personal.workspace_id, school.created_at
  FROM schools school
  LEFT JOIN personal_teaching_contexts personal ON personal.school_id = school.id;

-- Existing inserts into schools remain compatible. The runtime has no direct
-- write grant on either this function or learning_contexts.
CREATE FUNCTION access_school_context_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO public.learning_contexts (id, tenant_id, kind, school_id, created_at)
  VALUES (NEW.id, NEW.tenant_id, 'school', NEW.id, NEW.created_at);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION access_school_context_sync() FROM PUBLIC;
CREATE TRIGGER access_school_context_after_insert AFTER INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION access_school_context_sync();

-- Redirect only the verified composite foreign keys. No tenant column, null
-- policy, unique key, or row-level policy is removed or relaxed.
DO $$
DECLARE target text; constraint_name text; found_count integer;
BEGIN
  FOREACH target IN ARRAY ARRAY['academic_periods', 'users', 'classrooms',
    'personal_teaching_contexts', 'gradebook_entries', 'grading_scheme_versions',
    'learning_migration_batches', 'learner_identities'] LOOP
    found_count := 0;
    FOR constraint_name IN
      SELECT c.conname FROM pg_constraint c
      WHERE c.conrelid = ('public.' || target)::regclass AND c.contype = 'f'
        AND c.confrelid = 'public.schools'::regclass
        AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (tenant_id, school_id)%'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', target, constraint_name);
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, school_id) REFERENCES public.learning_contexts(tenant_id, id)', target, constraint_name);
      found_count := found_count + 1;
    END LOOP;
    IF found_count <> 1 THEN RAISE EXCEPTION 'Expected one school scope FK on %, found %', target, found_count; END IF;
  END LOOP;
END;
$$;

ALTER TABLE learning_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_contexts FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_contexts_tenant ON learning_contexts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
REVOKE ALL ON learning_contexts FROM PUBLIC, asalab_app;
GRANT SELECT ON learning_contexts TO asalab_app;

CREATE OR REPLACE FUNCTION classroom_ensure_personal_teacher(p_account_id uuid)
RETURNS TABLE (tenant_id uuid, workspace_id uuid, school_id uuid, academic_period_id uuid, user_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_tenant uuid; v_workspace uuid; v_context uuid; v_period uuid; v_user uuid;
        v_principal uuid; v_email varchar(255); v_password_hash text;
        v_display_name varchar(255); v_year integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text, 104));
  IF NOT EXISTS (
    SELECT 1 FROM public.capability_grants g JOIN public.accounts a ON a.id = g.account_id
    WHERE g.account_id = p_account_id AND a.status = 'active'
      AND g.capability = 'educator' AND g.state IN ('provisional', 'verified')
  ) THEN RETURN; END IF;

  SELECT w.tenant_id, w.id, pr.id, a.email, a.password_hash,
         COALESCE(NULLIF(p.display_name, ''), p.username)
    INTO v_tenant, v_workspace, v_principal, v_email, v_password_hash, v_display_name
    FROM public.workspace_memberships wm
    JOIN public.workspaces w ON w.id = wm.workspace_id AND w.kind = 'personal'
    JOIN public.accounts a ON a.id = wm.account_id AND a.status = 'active'
    JOIN public.profiles p ON p.account_id = a.id
    JOIN public.principals pr ON pr.account_id = a.id
   WHERE wm.account_id = p_account_id AND wm.role = 'owner' LIMIT 1;
  IF v_tenant IS NULL THEN RETURN; END IF;

  SELECT c.school_id, c.academic_period_id, c.user_id
    INTO v_context, v_period, v_user FROM public.personal_teaching_contexts c
    WHERE c.account_id = p_account_id AND c.tenant_id = v_tenant AND c.workspace_id = v_workspace;
  IF v_user IS NOT NULL THEN
    RETURN QUERY SELECT v_tenant, v_workspace, v_context, v_period, v_user;
    RETURN;
  END IF;

  INSERT INTO public.learning_contexts (tenant_id, kind, owner_account_id, workspace_id)
    VALUES (v_tenant, 'independent_teaching', p_account_id, v_workspace) RETURNING id INTO v_context;
  v_year := extract(year FROM current_date)::integer;
  INSERT INTO public.academic_periods (tenant_id, school_id, title, starts_on, ends_on, is_active)
    VALUES (v_tenant, v_context, v_year::text, make_date(v_year,1,1), make_date(v_year,12,31), true)
    RETURNING id INTO v_period;
  INSERT INTO public.users (tenant_id, school_id, role, email, display_name, password_hash, status)
    VALUES (v_tenant, v_context, 'teacher', v_email, v_display_name, v_password_hash, 'active')
    RETURNING id INTO v_user;
  INSERT INTO public.legacy_user_account_links (tenant_id, user_id, account_id, principal_id, migration_state)
    VALUES (v_tenant, v_user, p_account_id, v_principal, 'active');
  INSERT INTO public.personal_teaching_contexts (account_id, tenant_id, workspace_id, school_id, academic_period_id, user_id)
    VALUES (p_account_id, v_tenant, v_workspace, v_context, v_period, v_user);
  INSERT INTO public.audit_events (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
    VALUES (v_tenant, v_user, 'account', p_account_id, 'classroom.personal_teaching_enabled',
      jsonb_build_object('workspaceId', v_workspace, 'learningContextId', v_context, 'kind', 'independent_teaching'));
  RETURN QUERY SELECT v_tenant, v_workspace, v_context, v_period, v_user;
END;
$$;
REVOKE ALL ON FUNCTION classroom_ensure_personal_teacher(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_ensure_personal_teacher(uuid) TO asalab_app;

COMMENT ON TABLE learning_contexts IS 'Educational scope parent. Legacy learning school_id columns retain their UUID and refer here. Independent teaching inserts no school.';

CREATE FUNCTION classroom_learning_context(p_account uuid,p_classroom uuid)
RETURNS TABLE (id uuid, kind varchar, school_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT lc.id,lc.kind,lc.school_id FROM public.classrooms c
  JOIN public.learning_contexts lc ON lc.tenant_id=c.tenant_id AND lc.id=c.school_id
  CROSS JOIN LATERAL public.classroom_teacher_access(p_account,c.id) access
  JOIN public.accounts a ON a.id=p_account AND a.status='active'
  WHERE c.id=p_classroom AND access.tenant_id=c.tenant_id AND EXISTS (
    SELECT 1 FROM public.capability_grants g WHERE g.account_id=p_account
      AND g.capability='educator' AND g.state IN ('provisional','verified'));
$$;
REVOKE ALL ON FUNCTION classroom_learning_context(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION classroom_learning_context(uuid,uuid) TO asalab_app;
