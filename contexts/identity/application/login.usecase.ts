import { verifyAgainstDecoy, verifyPasswordAsync } from '../domain/password.js';
import { createSessionToken, hashSessionToken } from '../domain/session-token.js';
import { isValidEmail, isValidWorkspace, normalizeEmail } from '../domain/validation.js';
import type {
  SessionContext,
  SessionStorePort,
  TenantLocatorPort,
  UserDirectoryPort,
} from './ports.js';

export type LoginResult =
  | { readonly ok: true; readonly token: string; readonly context: SessionContext }
  | { readonly ok: false; readonly code: 'validation_error' | 'invalid_credentials' };

const SESSION_TTL_HOURS = 12;

/**
 * Teacher login. The workspace slug locates the tenant; afterwards the tenant
 * context comes exclusively from the stored server-side session.
 */
export class LoginUseCase {
  constructor(
    private readonly tenants: TenantLocatorPort,
    private readonly users: UserDirectoryPort,
    private readonly sessions: SessionStorePort,
  ) {}

  async execute(input: {
    workspace: unknown;
    email: unknown;
    password: unknown;
  }): Promise<LoginResult> {
    // Normalize identifiers before validation and lookup: workspace and email
    // are case-insensitive locators. The password is used verbatim (no trim)
    // and is never logged.
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
    const user = await this.users.findActiveTeacherByEmail(tenantId, email);
    // A missing user still pays for a hash, so response time does not reveal
    // whether the address belongs to anybody in this workspace.
    if (user === null) {
      await verifyAgainstDecoy(input.password);
      return { ok: false, code: 'invalid_credentials' };
    }
    if (!(await verifyPasswordAsync(input.password, user.passwordHash))) {
      return { ok: false, code: 'invalid_credentials' };
    }
    const token = createSessionToken();
    await this.sessions.create(tenantId, user.id, hashSessionToken(token), SESSION_TTL_HOURS);
    return {
      ok: true,
      token,
      context: {
        tenantId,
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        schoolId: user.schoolId,
      },
    };
  }
}
