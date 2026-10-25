import type { SessionPayload } from '../api';
import type { AdminProfile } from './admin-api';

/** Identity of one verified shell; never an authorization cache across actors/scopes. */
export function adminSessionIdentity(session: SessionPayload | null): string | null {
  if (!session) return null;
  return JSON.stringify([
    session.account.id,
    session.user.id,
    session.activeWorkspace.workspaceId,
    session.activeWorkspace.kind,
    session.capabilities.map((entry) => `${entry.capability}:${entry.state}`).sort(),
    session.workspaces.map((entry) => `${entry.workspaceId}:${entry.kind}:${entry.role}`).sort(),
    session.verification
      ? [
          session.verification.required,
          session.verification.policyEnabled,
          session.verification.reason,
          session.verification.dueAt,
          session.verification.verifiedProvider,
          session.verification.providers.map((entry) => [
            entry.id,
            entry.available,
            entry.enforcementEligible,
          ]),
        ]
      : null,
  ]);
}

export function adminProfileMatchesSession(
  profile: AdminProfile,
  session: SessionPayload,
): boolean {
  return (
    profile.accountId === session.account.id &&
    profile.activeWorkspaceId === session.activeWorkspace.workspaceId
  );
}
