import type pg from 'pg';
import type {
  AccountDirectoryPort,
  RegistrationConflict,
  AccountRecord,
  CapabilityRef,
  LinkedAccount,
  LegacyActor,
  PersonalWorkspaceRef,
  RegisterAccountInput,
  RegisteredAccount,
  WorkspaceRef,
} from '../application/account.ports.js';

export class PgAccountDirectory implements AccountDirectoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async register(input: RegisterAccountInput): Promise<RegisteredAccount | RegistrationConflict> {
    try {
      const result = await this.pool.query(
        `SELECT account_id, principal_id, workspace_id, tenant_id
           FROM auth_register_account($1, $2, $3, $4, $5::date, $6, $7, $8, $9)`,
        [
          input.email,
          input.passwordHash,
          input.displayName,
          input.username,
          input.birthDate,
          input.country,
          input.policyVersion,
          input.tokenHash,
          input.ttlHours,
        ],
      );
      const row = result.rows[0];
      return {
        accountId: row.account_id,
        principalId: row.principal_id,
        workspaceId: row.workspace_id,
        tenantId: row.tenant_id,
      };
    } catch (error) {
      const failure = error as { code?: string; constraint?: string };
      if (failure.code === '23505') {
        return {
          conflict: failure.constraint === 'profiles_username_ci_idx' ? 'username' : 'email',
        };
      }
      throw error;
    }
  }

  async findByEmail(emailLower: string): Promise<AccountRecord | null> {
    const result = await this.pool.query(
      `SELECT id, email, password_hash FROM auth_find_account($1)`,
      [emailLower],
    );
    return this.toAccount(result.rows[0]);
  }

  async findByUsername(usernameLower: string): Promise<AccountRecord | null> {
    const result = await this.pool.query(
      `SELECT id, email, password_hash FROM auth_find_account_by_username($1)`,
      [usernameLower],
    );
    return this.toAccount(result.rows[0]);
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    const result = await this.pool.query(`SELECT auth_username_available($1) AS available`, [
      username,
    ]);
    return result.rows[0]?.available === true;
  }

  async personalWorkspace(accountId: string): Promise<PersonalWorkspaceRef | null> {
    const result = await this.pool.query(
      `SELECT workspace_id, tenant_id, principal_id FROM auth_personal_workspace($1)`,
      [accountId],
    );
    const row = result.rows[0];
    return row
      ? {
          workspaceId: row.workspace_id,
          tenantId: row.tenant_id,
          principalId: row.principal_id,
        }
      : null;
  }

  async capabilities(accountId: string): Promise<CapabilityRef[]> {
    const result = await this.pool.query(
      `SELECT capability, state FROM auth_account_capabilities($1)`,
      [accountId],
    );
    return result.rows.map((row) => ({ capability: row.capability, state: row.state }));
  }

  async workspaces(accountId: string): Promise<WorkspaceRef[]> {
    const result = await this.pool.query(
      `SELECT workspace_id, tenant_id, kind, title, role FROM auth_account_workspaces($1)`,
      [accountId],
    );
    return result.rows.map((row) => ({
      workspaceId: row.workspace_id,
      tenantId: row.tenant_id,
      kind: row.kind,
      title: row.title,
      role: row.role,
    }));
  }

  async accountForUser(tenantId: string, userId: string): Promise<LinkedAccount | null> {
    const result = await this.pool.query(
      `SELECT account_id, principal_id, workspace_id FROM auth_account_for_user($1, $2)`,
      [tenantId, userId],
    );
    const row = result.rows[0];
    return row
      ? {
          accountId: row.account_id,
          principalId: row.principal_id,
          workspaceId: row.workspace_id,
        }
      : null;
  }

  async legacyActor(accountId: string): Promise<LegacyActor | null> {
    const result = await this.pool.query(
      `SELECT tenant_id, user_id FROM auth_legacy_actor_for_account($1)`,
      [accountId],
    );
    const row = result.rows[0];
    return row ? { tenantId: row.tenant_id, userId: row.user_id } : null;
  }

  private toAccount(row: Record<string, unknown> | undefined): AccountRecord | null {
    return row
      ? {
          id: row['id'] as string,
          email: row['email'] as string,
          passwordHash: row['password_hash'] as string,
        }
      : null;
  }
}
