import type pg from 'pg';
import type {
  AccountDirectoryPort,
  AccountProfile,
  AccountRecord,
  CapabilityRef,
  RegisterAccountInput,
  RegisteredAccount,
  WorkspaceRef,
} from '../application/account.ports.js';

/** PostgreSQL adapter for the global account identity. Like the rest of the
 * identity context it only calls the narrow SECURITY DEFINER functions. */
export class PgAccountDirectory implements AccountDirectoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async findByEmail(emailLower: string): Promise<AccountRecord | null> {
    const result = await this.pool.query(
      `SELECT id, email, password_hash, email_verification_state FROM auth_find_account($1)`,
      [emailLower],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          email: row.email,
          passwordHash: row.password_hash,
          emailVerificationState: row.email_verification_state,
        }
      : null;
  }

  async register(
    input: RegisterAccountInput,
  ): Promise<RegisteredAccount | { readonly conflict: true }> {
    try {
      const result = await this.pool.query(
        `SELECT account_id, workspace_id, tenant_id, user_id
           FROM auth_register_account($1, $2, $3, $4, $5::date, $6, $7)`,
        [
          input.email,
          input.passwordHash,
          input.displayName,
          input.username,
          input.birthDate,
          input.country,
          input.policyVersion,
        ],
      );
      const row = result.rows[0];
      return {
        accountId: row.account_id,
        workspaceId: row.workspace_id,
        tenantId: row.tenant_id,
        userId: row.user_id,
      };
    } catch (error) {
      // unique_violation: the email or username is already taken.
      if ((error as { code?: string }).code === '23505') {
        return { conflict: true };
      }
      throw error;
    }
  }

  async workspaces(accountId: string): Promise<WorkspaceRef[]> {
    const result = await this.pool.query(
      `SELECT workspace_id, tenant_id, kind, title, role, user_id FROM auth_account_workspaces($1)`,
      [accountId],
    );
    return result.rows.map((row) => ({
      workspaceId: row.workspace_id,
      tenantId: row.tenant_id,
      kind: row.kind as 'personal' | 'organization',
      title: row.title,
      role: row.role,
      userId: row.user_id ?? null,
    }));
  }

  async capabilities(accountId: string): Promise<CapabilityRef[]> {
    const result = await this.pool.query(
      `SELECT capability, state, policy_version FROM auth_account_capabilities($1)`,
      [accountId],
    );
    return result.rows.map((row) => ({
      capability: row.capability,
      state: row.state,
      policyVersion: row.policy_version,
    }));
  }

  async profile(accountId: string): Promise<AccountProfile | null> {
    const result = await this.pool.query(
      `SELECT username, display_name, email, email_verification_state, birth_date
         FROM auth_account_profile($1)`,
      [accountId],
    );
    const row = result.rows[0];
    return row
      ? {
          username: row.username,
          displayName: row.display_name,
          email: row.email,
          emailVerificationState: row.email_verification_state,
          birthDate: String(row.birth_date).slice(0, 10),
        }
      : null;
  }
}
