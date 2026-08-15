-- Keep Checkers classroom membership compatible with account-based classes.
-- The legacy Checkers enrolment function inserts a user-based membership;
-- this trigger fills the account identity before constraints and access checks
-- evaluate the row. Project context remains read-only for students while edit
-- access is enforced by the application repository for owner/co-teacher roles.

CREATE OR REPLACE FUNCTION classroom_membership_fill_account_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF NEW.account_id IS NULL THEN
        SELECT link.account_id
          INTO NEW.account_id
          FROM public.legacy_user_account_links link
         WHERE link.tenant_id = NEW.tenant_id
           AND link.user_id = NEW.user_id
           AND link.migration_state = 'active'
         LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION classroom_membership_fill_account_id() FROM PUBLIC;

DROP TRIGGER IF EXISTS classroom_membership_fill_account_id_trigger
    ON classroom_memberships;
CREATE TRIGGER classroom_membership_fill_account_id_trigger
BEFORE INSERT OR UPDATE OF user_id, account_id ON classroom_memberships
FOR EACH ROW EXECUTE FUNCTION classroom_membership_fill_account_id();

UPDATE classroom_memberships membership
   SET account_id = link.account_id
  FROM legacy_user_account_links link
 WHERE membership.account_id IS NULL
   AND link.tenant_id = membership.tenant_id
   AND link.user_id = membership.user_id
   AND link.migration_state = 'active';

CREATE OR REPLACE FUNCTION project_context_for_principal(
    p_principal_id uuid,
    p_project_id uuid
)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT project.tenant_id,
           CASE
             WHEN project.project_scope = 'classroom' THEN membership.user_id
             ELSE legacy_link.user_id
           END
      FROM public.principals principal
      JOIN public.projects project ON project.id = p_project_id
      LEFT JOIN public.classroom_memberships membership
        ON membership.tenant_id = project.tenant_id
       AND membership.classroom_id = project.classroom_id
       AND membership.account_id = principal.account_id
      LEFT JOIN public.legacy_user_account_links legacy_link
        ON legacy_link.tenant_id = project.tenant_id
       AND legacy_link.account_id = principal.account_id
       AND legacy_link.migration_state = 'active'
     WHERE principal.id = p_principal_id
       AND (
         (project.project_scope = 'personal'
          AND project.owner_principal_id = p_principal_id)
         OR
         (project.project_scope = 'classroom' AND membership.user_id IS NOT NULL)
       )
     LIMIT 1;
$$;

REVOKE ALL ON FUNCTION project_context_for_principal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_context_for_principal(uuid, uuid) TO asalab_app;
