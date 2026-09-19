import {
  BLOCKS_MODULE,
  type BlocksAssetFormat,
  type BlocksAssetReferenceV1,
} from '@asa-lab/blocks';
import type { ProjectActor, ProjectRepositoryPort } from '@asa-lab/projects';
import type { BlocksAssetMetadataPort } from './blocks-persistence.guard.js';
import type { BlocksBlobReadable, BlocksBlobStorePort } from './blocks-asset-storage.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_ID = /^[a-f0-9]{32}$/;
const FORMATS = new Set<BlocksAssetFormat>(['svg', 'png', 'jpg', 'wav', 'mp3']);

export type BlocksDraftAssetReadResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly reference: BlocksAssetReferenceV1;
        readonly body: BlocksBlobReadable;
      };
    }
  | {
      readonly ok: false;
      readonly code:
        'invalid_request' | 'project_not_found' | 'asset_not_found' | 'dependency_unavailable';
    };

function denied(code: Exclude<BlocksDraftAssetReadResult, { ok: true }>['code']) {
  return { ok: false as const, code };
}
function sameReference(a: BlocksAssetReferenceV1, b: BlocksAssetReferenceV1): boolean {
  return (
    a.assetId === b.assetId &&
    a.dataFormat === b.dataFormat &&
    a.sha256 === b.sha256 &&
    a.sizeBytes === b.sizeBytes
  );
}

export class BlocksDraftAssetReader {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly metadata: BlocksAssetMetadataPort,
    private readonly blobs: BlocksBlobStorePort,
  ) {}

  async read(input: {
    readonly tenantId: string;
    readonly projectId: string;
    readonly actor: ProjectActor;
    readonly assetId: string;
    readonly dataFormat: BlocksAssetFormat;
  }): Promise<BlocksDraftAssetReadResult> {
    const tenantId = input.tenantId;
    const projectId = input.projectId;
    const actor = { ...input.actor };
    const assetId = input.assetId;
    const dataFormat = input.dataFormat;
    if (
      !UUID.test(tenantId) ||
      !UUID.test(projectId) ||
      !UUID.test(actor.principalId) ||
      (actor.userId !== null && !UUID.test(actor.userId)) ||
      !ASSET_ID.test(assetId) ||
      !FORMATS.has(dataFormat)
    ) {
      return denied('invalid_request');
    }
    try {
      const loaded = await this.projects.load(tenantId, projectId, actor);
      if (!loaded || loaded.project.moduleKey !== 'blocks' || loaded.project.status === 'trashed') {
        return denied('project_not_found');
      }
      const validated = BLOCKS_MODULE.provider!.validate(loaded.draft.document);
      if (!validated.ok) return denied('dependency_unavailable');
      const matches = validated.payload.assets.filter(
        (ref) => ref.assetId === assetId && ref.dataFormat === dataFormat,
      );
      if (matches.length === 0) return denied('asset_not_found');
      if (matches.length !== 1) return denied('dependency_unavailable');
      const reference = { ...matches[0]! };
      const stored = await this.metadata.resolve({ tenantId, assetId, dataFormat });
      if (
        !stored ||
        stored.tenantId !== tenantId ||
        stored.blobCommitted !== true ||
        !sameReference(reference, stored)
      ) {
        return denied('dependency_unavailable');
      }
      const body = await this.blobs.open({
        tenantId,
        sha256: reference.sha256,
        dataFormat,
      });
      if (!body) return denied('dependency_unavailable');
      return { ok: true, value: { reference, body } };
    } catch {
      return denied('dependency_unavailable');
    }
  }
}
