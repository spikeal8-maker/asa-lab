import type { ProjectRepositoryPort } from '@asa-lab/projects';
import type {
  BlocksRuntimeAuthorityPort,
  BlocksRuntimePermission,
} from './blocks-runtime-capability.js';

const WRITE = new Set<BlocksRuntimePermission>(['asset:write', 'draft:write', 'snapshot:write']);

export class BlocksProjectRuntimeAuthority implements BlocksRuntimeAuthorityPort {
  constructor(private readonly projects: ProjectRepositoryPort) {}

  async allows(input: Parameters<BlocksRuntimeAuthorityPort['allows']>[0]): Promise<boolean> {
    const access = input.permissions.some((permission) => WRITE.has(permission)) ? 'edit' : 'read';
    const authorized = await this.projects.authorize(
      input.tenantId,
      input.projectId,
      input.principalId,
      access,
    );
    if (
      !authorized ||
      authorized.tenantId !== input.tenantId ||
      authorized.projectId !== input.projectId ||
      authorized.moduleKey !== 'blocks'
    ) {
      return false;
    }
    if (input.mode === 'editor') return input.versionId === null;
    if (input.versionId === null || input.permissions.some((permission) => WRITE.has(permission))) {
      return false;
    }
    const versions = await this.projects.listVersions(authorized.tenantId, authorized.projectId, {
      principalId: input.principalId,
      userId: authorized.userId,
    });
    return versions?.some((version) => version.id === input.versionId) === true;
  }
}
