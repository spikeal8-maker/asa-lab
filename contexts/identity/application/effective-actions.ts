import type { ActiveContext, CapabilityRef, WorkspaceRef } from './account.ports.js';

/** Server projection for the current workspace, never an authorization token.
 * Resource endpoints must still check ownership/membership on every request. */
export function effectiveAccountActions(
  context: Pick<ActiveContext, 'workspaceId' | 'workspaceKind'>,
  capabilities: readonly CapabilityRef[],
  workspaces: readonly WorkspaceRef[],
): readonly string[] {
  const membership = workspaces.find((entry) => entry.workspaceId === context.workspaceId);
  if (!membership || membership.kind !== context.workspaceKind) return [];
  const active = (capability: string) =>
    capabilities.some(
      (entry) =>
        entry.capability === capability && ['verified', 'provisional'].includes(entry.state),
    );
  const personalOwner = membership.kind === 'personal' && membership.role === 'owner';
  const staffWorkspace =
    membership.kind === 'organization' &&
    ['educator', 'school_admin', 'owner'].includes(membership.role);
  const teach = active('educator') && (personalOwner || staffWorkspace);
  const author = teach || (active('content_author') && personalOwner);
  return [
    'account.profile.read',
    'account.profile.update',
    'learning.own.read',
    ...(personalOwner ? ['project.create'] : []),
    ...(author ? ['content.create.own', 'content.edit.own', 'content.publish.own'] : []),
    ...(teach ? ['class.create', 'class.read.staff', 'content.deliver'] : []),
  ];
}
