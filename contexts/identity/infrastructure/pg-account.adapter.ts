import type pg from 'pg';
import type {
  AccountDirectoryPort,
  AccountAvatarRecord,
  AccountProfileRecord,
  EducatorAttestation,
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

function dateOnly(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

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

  async profile(accountId: string): Promise<AccountProfileRecord | null> {
    const result = await this.pool.query(
      `SELECT email, email_verification_state, username, display_name, bio, birth_date, country
         FROM auth_account_profile_v2($1)`,
      [accountId],
    );
    return this.toProfile(result.rows[0]);
  }

  async avatar(accountId: string): Promise<AccountAvatarRecord | null> {
    const result = await this.pool.query(`SELECT avatar_data_url FROM auth_account_avatar($1)`, [
      accountId,
    ]);
    return this.toAvatar(result.rows[0]);
  }

  async updateAvatar(
    accountId: string,
    avatarDataUrl: string | null,
  ): Promise<AccountAvatarRecord | null> {
    const result = await this.pool.query(
      `SELECT avatar_data_url FROM auth_update_account_avatar($1, $2)`,
      [accountId, avatarDataUrl],
    );
    return this.toAvatar(result.rows[0]);
  }

  async updateProfile(
    accountId: string,
    username: string,
    displayName: string,
    bio: string,
  ): Promise<AccountProfileRecord | RegistrationConflict | null> {
    try {
      const result = await this.pool.query(
        `SELECT email, email_verification_state, username, display_name, bio, birth_date, country
           FROM auth_update_account_profile_v2($1, $2, $3, $4)`,
        [accountId, username, displayName, bio],
      );
      return this.toProfile(result.rows[0]);
    } catch (error) {
      const failure = error as { code?: string; constraint?: string };
      if (failure.code === '23505' && failure.constraint === 'profiles_username_ci_idx') {
        return { conflict: 'username' };
      }
      throw error;
    }
  }

  async selfAttestEducator(accountId: string): Promise<EducatorAttestation> {
    const result = await this.pool.query(
      `SELECT eligible, grant_state, created FROM auth_self_attest_educator($1)`,
      [accountId],
    );
    const row = result.rows[0];
    return {
      eligible: row?.eligible === true,
      state: typeof row?.grant_state === 'string' ? row.grant_state : null,
      created: row?.created === true,
    };
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

  private toProfile(row: Record<string, unknown> | undefined): AccountProfileRecord | null {
    return row
      ? {
          email: row['email'] as string,
          emailVerificationState: row['email_verification_state'] as string,
          username: row['username'] as string,
          displayName: row['display_name'] as string,
          bio: typeof row['bio'] === 'string' ? row['bio'] : '',
          birthDate: dateOnly(row['birth_date']),
          country: row['country'] as string,
        }
      : null;
  }

  private toAvatar(row: Record<string, unknown> | undefined): AccountAvatarRecord | null {
    return row
      ? {
          avatarDataUrl: typeof row['avatar_data_url'] === 'string' ? row['avatar_data_url'] : null,
        }
      : null;
  }
}
