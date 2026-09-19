import { decodeJwt } from 'jose';
import type { ProjectActor, ProjectRepositoryPort } from '@asa-lab/projects';
import type {
  BlocksCapabilityError,
  BlocksRuntimeCapabilityService,
  BlocksRuntimeBinding,
  BlocksRuntimeGrant,
  BlocksRuntimePermission,
} from './blocks-runtime-capability.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WRITE = new Set<BlocksRuntimePermission>(['asset:write', 'draft:write', 'snapshot:write']);

type RuntimeRequestError = BlocksCapabilityError | 'unauthorized' | 'project_unavailable';
export type BlocksRuntimeRequestResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly grant: Readonly<BlocksRuntimeGrant>;
        readonly actor: ProjectActor;
      };
    }
  | { readonly ok: false; readonly code: RuntimeRequestError };

function denied(code: RuntimeRequestError): BlocksRuntimeRequestResult {
  return { ok: false, code };
}
function bearer(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(value);
  return match?.[1] ?? null;
}

function candidateBinding(token: string, projectId: string): BlocksRuntimeBinding | null {
  try {
    const payload = decodeJwt(token);
    const tenantId = payload['tenantId'];
    const principalId = payload.sub;
    const tokenProjectId = payload['projectId'];
    const mode = payload['mode'];
    const versionId = payload['versionId'];
    if (
      !UUID.test(projectId) ||
      typeof tenantId !== 'string' ||
      !UUID.test(tenantId) ||
      typeof principalId !== 'string' ||
      !UUID.test(principalId) ||
      tokenProjectId !== projectId ||
      (mode !== 'editor' && mode !== 'player') ||
      (mode === 'editor'
        ? versionId !== null
        : typeof versionId !== 'string' || !UUID.test(versionId))
    ) {
      return null;
    }
    return { tenantId, principalId, projectId, mode, versionId: versionId as string | null };
  } catch {
    return null;
  }
}
export class BlocksRuntimeRequestAuthorizer {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly capability: BlocksRuntimeCapabilityService,
    private readonly runtimeOrigin: string,
  ) {}

  async authorize(input: {
    readonly authorization: string | undefined;
    readonly origin: string | undefined;
    readonly projectId: string;
    readonly permission: BlocksRuntimePermission;
  }): Promise<BlocksRuntimeRequestResult> {
    if (input.origin !== this.runtimeOrigin) return denied('forbidden_origin');
    const token = bearer(input.authorization);
    if (!token) return denied('unauthorized');
    const binding = candidateBinding(token, input.projectId);
    if (!binding) return denied('invalid_token');
    const verified = await this.capability.verify({
      token,
      origin: input.origin,
      binding,
      permission: input.permission,
    });
    if (!verified.ok) return denied(verified.code);
    const access = WRITE.has(input.permission) ? 'edit' : 'read';
    try {
      const current = await this.projects.authorize(
        verified.value.tenantId,
        verified.value.projectId,
        verified.value.principalId,
        access,
      );
      if (
        !current ||
        current.moduleKey !== 'blocks' ||
        current.tenantId !== verified.value.tenantId ||
        current.projectId !== verified.value.projectId
      ) {
        return denied('project_unavailable');
      }
      return {
        ok: true,
        value: {
          grant: verified.value,
          actor: { principalId: verified.value.principalId, userId: current.userId },
        },
      };
    } catch {
      return denied('dependency_unavailable');
    }
  }
}
