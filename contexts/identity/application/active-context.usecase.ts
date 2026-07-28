import { hashSessionToken } from '../domain/session-token.js';
import type { ActiveContext, LinkedAccount, SessionV2StorePort } from './account.ports.js';
import type { SessionContext, SessionStorePort } from './ports.js';

/**
 * Resolves the ActiveContext of a request.
 *
 * A principal-bound session answers first. A session from the legacy table —
 * the one a teacher opened through the organization form — still answers, and
 * is described in the same shape, so the rest of the application never has to
 * ask which kind of session it is holding.
 */
export class ActiveContextUseCase {
  constructor(
    private readonly sessionsV2: SessionV2StorePort,
    private readonly legacySessions: SessionStorePort,
    private readonly accounts: {
      accountForUser(tenantId: string, userId: string): Promise<LinkedAccount | null>;
    },
  ) {}

  async resolve(token: string | undefined): Promise<ActiveContext | null> {
    if (!token) {
      return null;
    }
    const hash = hashSessionToken(token);
    const modern = await this.sessionsV2.resolve(hash);
    if (modern !== null) {
      return modern;
    }
    const legacy = await this.legacySessions.resolve(hash);
    return legacy === null ? null : this.fromLegacy(legacy);
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const hash = hashSessionToken(token);
    // A token belongs to one of the two stores; revoking both is harmless and
    // means signing out never depends on guessing which.
    await this.sessionsV2.revoke(hash);
    await this.legacySessions.revoke(hash);
  }

  private async fromLegacy(legacy: SessionContext): Promise<ActiveContext | null> {
    const linked = await this.accounts.accountForUser(legacy.tenantId, legacy.userId);
    if (linked === null) {
      return null;
    }
    return {
      principalId: linked.principalId,
      accountId: linked.accountId,
      workspaceId: linked.workspaceId,
      workspaceKind: 'organization',
      tenantId: legacy.tenantId,
      userId: legacy.userId,
      email: legacy.email,
      displayName: legacy.displayName,
      schoolId: legacy.schoolId,
    };
  }
}
