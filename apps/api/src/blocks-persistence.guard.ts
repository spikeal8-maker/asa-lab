import type { BlocksAssetReferenceV1 } from '@asa-lab/blocks';
import type {
  ProjectDraftPersistenceGuardPort,
  ProjectPersistenceGuardResult,
} from '@asa-lab/projects';
import {
  BlocksPersistenceValidationError,
  inspectBlocksDocument,
  BLOCKS_JSON_LIMIT,
  BLOCKS_ASSET_TOTAL_LIMIT,
} from './blocks-durable-document.js';

export interface BlocksStoredAssetMetadata extends BlocksAssetReferenceV1 {
  readonly tenantId: string;
  /** True only for a committed immutable blob/alias pair, after object persistence. */
  readonly blobCommitted: boolean;
}
export interface BlocksAssetMetadataPort {
  resolve(input: {
    readonly tenantId: string;
    readonly assetId: string;
    readonly dataFormat: BlocksAssetReferenceV1['dataFormat'];
  }): Promise<BlocksStoredAssetMetadata | null>;
}
export function persistenceFailure(
  problem: unknown,
): Exclude<ProjectPersistenceGuardResult, { ok: true }> {
  return problem instanceof BlocksPersistenceValidationError
    ? { ok: false, code: 'validation_error', message: problem.reason }
    : { ok: false, code: 'dependency_unavailable', message: 'Blocks storage is unavailable.' };
}
/** Composed into the one common SaveDraftUseCase, never a second draft writer. */
export class BlocksDraftPersistenceGuard implements ProjectDraftPersistenceGuardPort {
  constructor(
    private readonly metadata: BlocksAssetMetadataPort,
    private readonly jsonLimit = BLOCKS_JSON_LIMIT,
    private readonly assetLimit = BLOCKS_ASSET_TOTAL_LIMIT,
  ) {
    if (
      typeof metadata?.resolve !== 'function' ||
      !Number.isSafeInteger(jsonLimit) ||
      jsonLimit < 1 ||
      jsonLimit > BLOCKS_JSON_LIMIT ||
      !Number.isSafeInteger(assetLimit) ||
      assetLimit < 1 ||
      assetLimit > BLOCKS_ASSET_TOTAL_LIMIT
    )
      throw new Error('Invalid Blocks persistence configuration.');
  }
  async validate(
    input: Parameters<ProjectDraftPersistenceGuardPort['validate']>[0],
  ): Promise<ProjectPersistenceGuardResult> {
    if (input.moduleKey !== 'blocks') return { ok: true };
    const tenantId = input.tenantId;
    try {
      const document = await inspectBlocksDocument(input.document, this.jsonLimit, this.assetLimit);
      for (const ref of document.assets) {
        const metadata = await this.metadata.resolve({
          tenantId,
          assetId: ref.assetId,
          dataFormat: ref.dataFormat,
        });
        if (!metadata)
          return { ok: false, code: 'validation_error', message: 'blocks_asset_reference_missing' };
        if (
          metadata.tenantId !== tenantId ||
          metadata.assetId !== ref.assetId ||
          metadata.dataFormat !== ref.dataFormat ||
          metadata.sha256 !== ref.sha256 ||
          metadata.sizeBytes !== ref.sizeBytes ||
          metadata.blobCommitted !== true
        )
          return {
            ok: false,
            code: 'validation_error',
            message: 'blocks_asset_reference_mismatch',
          };
      }
      return { ok: true };
    } catch (problem) {
      return persistenceFailure(problem);
    }
  }
}
