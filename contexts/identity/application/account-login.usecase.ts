import { verifyPassword } from '../domain/password.js';
import { createSessionToken, hashSessionToken } from '../domain/session-token.js';
import { isValidEmail, normalizeEmail } from '../domain/validation.js';
import type { AccountDirectoryPort, WorkspaceRef } from './account.ports.js';
import type { SessionStorePort } from './ports.js';

export type AccountLoginResult =
  | {
      readonly ok: true;
      readonly token: string;
      readonly accountId: string;
      readonly workspace: WorkspaceRef;
      readonly workspaces: readonly WorkspaceRef[];
    }
  | {
      readonly ok: false;
      readonly code: 'validation_error' | 'invalid_credentials' | 'no_workspace';
    };

const SESSION_TTL_HOURS = 12;

/**
 * Sign in with email and password only. No organization code is required: the
 * server resolves the workspaces the account may act in and starts the session
 * in the personal one by default.
 */
export class AccountLoginUseCase {
  constructor(
    private readonly accounts: AccountDirectoryPort,
    private readonly sessions: SessionStorePort,
  ) {}

  async execute(input: { email: unknown; password: unknown }): Promise<AccountLoginResult> {
    const email = typeof input.email === 'string' ? normalizeEmail(input.email) : input.email;
    if (!isValidEmail(email) || typeof input.password !== 'string' || input.password.length === 0) {
      return { ok: false, code: 'validation_error' };
    }
    const account = await this.accounts.findByEmail(email);
    if (account === null || !verifyPassword(input.password, account.passwordHash)) {
      return { ok: false, code: 'invalid_credentials' };
    }
    const workspaces = await this.accounts.workspaces(account.id);
    const active = workspaces.find((workspace) => workspace.kind === 'personal') ?? workspaces[0];
    if (!active || active.userId === null) {
      return { ok: false, code: 'no_workspace' };
    }
    const token = createSessionToken();
    await this.sessions.create(
      active.tenantId,
      active.userId,
      hashSessionToken(token),
      SESSION_TTL_HOURS,
    );
    return { ok: true, token, accountId: account.id, workspace: active, workspaces };
  }
}
