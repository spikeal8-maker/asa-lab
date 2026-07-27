import { verifyPassword } from '../domain/password.js';
import { createSessionToken, hashSessionToken } from '../domain/session-token.js';
import { isValidEmail, normalizeEmail } from '../domain/validation.js';
import { isValidUsername } from '../domain/age-policy.js';
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
 * The one sign-in every account uses: an email address or a pseudonym, and a
 * password. No organization code, and no role asked before the answer.
 *
 * The server states the capabilities and workspaces it granted. A workspace
 * whose membership has no tenant-scoped user cannot carry a legacy session
 * yet, so that case is reported honestly instead of fabricating a teacher.
 */
export class AccountLoginUseCase {
  constructor(
    private readonly accounts: AccountDirectoryPort,
    private readonly sessions: SessionStorePort,
  ) {}

  async execute(input: { identifier: unknown; password: unknown }): Promise<AccountLoginResult> {
    if (
      typeof input.identifier !== 'string' ||
      input.identifier.trim().length === 0 ||
      typeof input.password !== 'string' ||
      input.password.length === 0
    ) {
      return { ok: false, code: 'validation_error' };
    }
    const identifier = input.identifier.trim();
    // A value with an @ is treated as an address; anything else as a pseudonym.
    const looksLikeEmail = identifier.includes('@');
    if (looksLikeEmail && !isValidEmail(normalizeEmail(identifier))) {
      return { ok: false, code: 'validation_error' };
    }
    if (!looksLikeEmail && !isValidUsername(identifier)) {
      return { ok: false, code: 'validation_error' };
    }

    const account = looksLikeEmail
      ? await this.accounts.findByEmail(normalizeEmail(identifier))
      : await this.accounts.findByUsername(identifier.toLowerCase());
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
