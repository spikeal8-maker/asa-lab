import { verifyPassword } from '../domain/password.js';
import { createSessionToken, hashSessionToken } from '../domain/session-token.js';
import { isValidEmail, normalizeEmail } from '../domain/validation.js';
import type { AccountDirectoryPort, CapabilityRef, WorkspaceRef } from './account.ports.js';
import type { SessionStorePort } from './ports.js';

export type AccountLoginResult =
  | {
      readonly ok: true;
      readonly token: string;
      readonly accountId: string;
      readonly workspace: WorkspaceRef;
      readonly workspaces: readonly WorkspaceRef[];
      readonly capabilities: readonly CapabilityRef[];
    }
  | {
      readonly ok: false;
      readonly code: 'validation_error' | 'invalid_credentials' | 'context_unavailable';
    };

const SESSION_TTL_HOURS = 12;

/**
 * Sign in with email and password only — no organization code.
 *
 * The server answers with the capabilities and workspaces it granted; the
 * client never states a role. A workspace whose membership has no
 * tenant-scoped user cannot carry a legacy session yet, so that case is
 * reported honestly instead of fabricating a teacher record.
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
    const capabilities = await this.accounts.capabilities(account.id);
    const active = workspaces.find((workspace) => workspace.userId !== null);
    if (!active || active.userId === null) {
      // Personal workspaces have no tenant-scoped user by design; a session for
      // them needs principal-aware sessions (sessions_v2).
      return { ok: false, code: 'context_unavailable' };
    }
    const token = createSessionToken();
    await this.sessions.create(
      active.tenantId,
      active.userId,
      hashSessionToken(token),
      SESSION_TTL_HOURS,
    );
    return { ok: true, token, accountId: account.id, workspace: active, workspaces, capabilities };
  }
}
