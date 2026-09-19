import { BLOCKS_MODULE, type BlocksAssetReferenceV1 } from '@asa-lab/blocks';
import type { ProjectRepositoryPort } from '@asa-lab/projects';
import type { BlocksRuntimeCapabilityService } from './blocks-runtime-capability.js';

export interface BlocksRuntimeParentActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly userId: string | null;
}

export type BlocksRuntimeSessionFailure =
  'project_unavailable' | 'project_invalid' | 'dependency_unavailable';

export type BlocksRuntimeSessionResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly runtimeOrigin: string;
        readonly runtimeToken: string;
        readonly expiresAt: number;
        readonly draftRevision: number;
        readonly projectJson: Record<string, unknown> | null;
        readonly assets: readonly BlocksAssetReferenceV1[];
      };
    }
  | { readonly ok: false; readonly code: BlocksRuntimeSessionFailure };
export class BlocksRuntimeSessionService {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly capability: BlocksRuntimeCapabilityService,
    private readonly runtimeOrigin: string,
  ) {}

  async issueEditor(
    actor: BlocksRuntimeParentActor,
    projectId: string,
  ): Promise<BlocksRuntimeSessionResult> {
    try {
      const authority = await this.projects.authorize(
        actor.tenantId,
        projectId,
        actor.principalId,
        'edit',
      );
      if (
        !authority ||
        authority.moduleKey !== 'blocks' ||
        authority.tenantId !== actor.tenantId ||
        authority.projectId !== projectId
      ) {
        return { ok: false, code: 'project_unavailable' };
      }
      const issued = await this.capability.issue({
        tenantId: authority.tenantId,
        principalId: actor.principalId,
        projectId,
        mode: 'editor',
        versionId: null,
      });
      if (!issued.ok) {
        return {
          ok: false,
          code:
            issued.code === 'authority_denied' ? 'project_unavailable' : 'dependency_unavailable',
        };
      }
      const opened = await this.projects.load(authority.tenantId, projectId, {
        principalId: actor.principalId,
        userId: authority.userId,
      });
      if (!opened || opened.project.moduleKey !== 'blocks' || opened.project.status === 'trashed') {
        return { ok: false, code: 'project_unavailable' };
      }
      const validation = BLOCKS_MODULE.provider?.validate(opened.draft.document);
      if (!validation?.ok) return { ok: false, code: 'project_invalid' };
      const confirmed = await this.projects.authorize(
        authority.tenantId,
        projectId,
        actor.principalId,
        'edit',
      );
      if (!confirmed || confirmed.moduleKey !== 'blocks') {
        return { ok: false, code: 'project_unavailable' };
      }
      return {
        ok: true,
        value: {
          runtimeOrigin: this.runtimeOrigin,
          runtimeToken: issued.value.token,
          expiresAt: issued.value.expiresAt,
          draftRevision: opened.draft.revision,
          projectJson: validation.payload.projectJson,
          assets: Object.freeze([...validation.payload.assets]),
        },
      };
    } catch {
      return { ok: false, code: 'dependency_unavailable' };
    }
  }
}
