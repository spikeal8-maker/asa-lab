import { verifyAgainstDecoy, verifyPasswordAsync } from '../domain/password.js';
import { createSessionToken, hashSessionToken } from '../domain/session-token.js';
import { isValidEmail, isValidWorkspace, normalizeEmail } from '../domain/validation.js';
import type { AccountDirectoryPort, SessionV2StorePort } from './account.ports.js';
import type { TenantLocatorPort } from './ports.js';
import { SESSION_TTL_HOURS } from './register-account.usecase.js';

export type LoginResult =
  | {
      readonly ok: true;
      readonly token: string;
      readonly accountId: string;
      readonly workspaceId: string;
    }
  | { readonly ok: false; readonly code: 'validation_error' | 'invalid_credentials' };

type OrganizationLoginAccounts = Pick<
  AccountDirectoryPort,
  'findByEmail' | 'workspaces' | 'personalWorkspace' | 'legacyActor' | 'accountForUser'
>;
type OrganizationLoginSessions = Pick<SessionV2StorePort, 'create'>;

/**
 * Organization compatibility login. The workspace slug selects an active
 * organization context, while the Account remains the sole password authority.
 */
export class LoginUseCase {
  constructor(
    private readonly tenants: TenantLocatorPort,
    private readonly accounts: OrganizationLoginAccounts,
    private readonly sessions: OrganizationLoginSessions,
  ) {}

  async execute(input: {
    workspace: unknown;
    email: unknown;
    password: unknown;
  }): Promise<LoginResult> {
    const workspace =
      typeof input.workspace === 'string' ? input.workspace.trim().toLowerCase() : input.workspace;
    const email = typeof input.email === 'string' ? normalizeEmail(input.email) : input.email;
    if (
      !isValidWorkspace(workspace) ||
      !isValidEmail(email) ||
      typeof input.password !== 'string' ||
      input.password.length === 0
    ) {
      return { ok: false, code: 'validation_error' };
    }

    const tenantId = await this.tenants.findTenantIdBySlug(workspace);
    if (tenantId === null) {
      return { ok: false, code: 'invalid_credentials' };
    }

    const account = await this.accounts.findByEmail(email);
    if (account === null) {
      await verifyAgainstDecoy(input.password);
      return { ok: false, code: 'invalid_credentials' };
    }
    if (!(await verifyPasswordAsync(input.password, account.passwordHash))) {
      return { ok: false, code: 'invalid_credentials' };
    }

    const organization = (await this.accounts.workspaces(account.id)).find(
      (candidate) => candidate.kind === 'organization' && candidate.tenantId === tenantId,
    );
    if (!organization) {
      return { ok: false, code: 'invalid_credentials' };
    }

    // The principal is account-wide. Canonical Accounts resolve it through
    // their personal workspace. A narrow compatibility fallback keeps historic
    // linked teacher rows usable without consulting their legacy password hash.
    const personal = await this.accounts.personalWorkspace(account.id);
    let principalId = personal?.principalId ?? null;
    if (principalId === null) {
      const legacy = await this.accounts.legacyActor(account.id);
      if (!legacy || legacy.tenantId !== tenantId) {
        return { ok: false, code: 'invalid_credentials' };
      }
      const linked = await this.accounts.accountForUser(legacy.tenantId, legacy.userId);
      if (
        !linked ||
        linked.accountId !== account.id ||
        linked.workspaceId !== organization.workspaceId
      ) {
        return { ok: false, code: 'invalid_credentials' };
      }
      principalId = linked.principalId;
    }

    const token = createSessionToken();
    await this.sessions.create(
      principalId,
      organization.workspaceId,
      hashSessionToken(token),
      SESSION_TTL_HOURS,
    );
    return {
      ok: true,
      token,
      accountId: account.id,
      workspaceId: organization.workspaceId,
    };
  }
}
