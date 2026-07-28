import { verifyPassword } from '../domain/password.js';
import { createSessionToken, hashSessionToken } from '../domain/session-token.js';
import { isValidEmail, normalizeEmail } from '../domain/validation.js';
import { isValidUsername } from '../domain/account-policy.js';
import type { AccountDirectoryPort, SessionV2StorePort } from './account.ports.js';
import { SESSION_TTL_HOURS } from './register-account.usecase.js';

export type AccountLoginResult =
  | { readonly ok: true; readonly token: string; readonly accountId: string }
  | { readonly ok: false; readonly code: 'validation_error' | 'invalid_credentials' };

/**
 * The one sign-in every account uses: an email address or a username, and a
 * password.
 *
 * No organization code and no role is asked for. The session is opened in the
 * account's own Personal Workspace, which is the context the server will
 * derive every later request from.
 */
export class AccountLoginUseCase {
  constructor(
    private readonly accounts: AccountDirectoryPort,
    private readonly sessions: SessionV2StorePort,
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
    // A value with an @ is treated as an address, anything else as a pseudonym.
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
    const personal = await this.accounts.personalWorkspace(account.id);
    if (personal === null) {
      // Every account is created with one; a missing workspace is a defect, not
      // a state to paper over with a guessed context.
      return { ok: false, code: 'invalid_credentials' };
    }
    const token = createSessionToken();
    await this.sessions.create(
      personal.principalId,
      personal.workspaceId,
      hashSessionToken(token),
      SESSION_TTL_HOURS,
    );
    return { ok: true, token, accountId: account.id };
  }
}
