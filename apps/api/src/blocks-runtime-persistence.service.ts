import type pg from 'pg';
import type { BlocksAssetFormat, BlocksAssetReferenceV1 } from '@asa-lab/blocks';
import {
  PgProjectRepository,
  type ProjectDraft,
  type SaveDraftUseCase,
  type UseCaseResult,
} from '@asa-lab/projects';
import { FixedWindowRateLimiter, type RateLimitDecision } from './rate-limit.js';
import { BlocksProjectRuntimeAuthority } from './blocks-runtime-authority.js';
import {
  BlocksRuntimeCapabilityService,
  type BlocksRuntimeGrant,
} from './blocks-runtime-capability.js';
import { readBlocksRuntimeServerConfig } from './blocks-runtime-config.js';
import {
  BlocksRuntimeRequestAuthorizer,
  type BlocksRuntimeRequestResult,
} from './blocks-runtime-request.js';
import {
  PgBlocksAssetMetadataStore,
  S3BlocksBlobStore,
  readBlocksObjectStorageConfig,
} from './blocks-asset-storage.js';
import { BlocksAssetUploadBudgetError, BlocksAssetUploadPipeline } from './blocks-asset-upload.js';
import { BlocksDraftAssetReader, type BlocksDraftAssetReadResult } from './blocks-asset-read.js';
import { BlocksRuntimeUploadBudget } from './blocks-runtime-upload-budget.js';

const RUNTIME_REQUEST_LIMIT = 2400;
const RUNTIME_REQUEST_WINDOW_MS = 10 * 60 * 1000;
interface RuntimeResources {
  readonly authorizer: BlocksRuntimeRequestAuthorizer;
  readonly upload: BlocksAssetUploadPipeline;
  readonly reader: BlocksDraftAssetReader;
}

export interface BlocksRuntimeAuthorized {
  readonly grant: Readonly<BlocksRuntimeGrant>;
  readonly actor: { readonly principalId: string; readonly userId: string | null };
}

export type BlocksRuntimeAuthorizedResult =
  | { readonly ok: true; readonly value: BlocksRuntimeAuthorized }
  | Exclude<BlocksRuntimeRequestResult, { ok: true }>;

export class BlocksRuntimePersistenceService {
  private resourcesValue: RuntimeResources | null = null;
  private readonly uploadBudget = new BlocksRuntimeUploadBudget();
  private readonly requestBudget = new FixedWindowRateLimiter({
    limit: RUNTIME_REQUEST_LIMIT,
    windowMs: RUNTIME_REQUEST_WINDOW_MS,
    maxKeys: 4096,
  });

  constructor(
    private readonly pool: pg.Pool | null,
    private readonly saveDraft: SaveDraftUseCase,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}
  private resources(): RuntimeResources {
    if (this.resourcesValue) return this.resourcesValue;
    if (!this.pool) throw new Error('blocks_runtime_dependency_unavailable');

    const runtime = readBlocksRuntimeServerConfig(this.env);
    const projects = new PgProjectRepository(this.pool);
    const authority = new BlocksProjectRuntimeAuthority(projects);
    const capability = new BlocksRuntimeCapabilityService({
      key: runtime.signingKey,
      runtimeOrigin: runtime.runtimeOrigin,
      authority,
    });
    const authorizer = new BlocksRuntimeRequestAuthorizer(
      projects,
      capability,
      runtime.runtimeOrigin,
    );

    const objectConfig = readBlocksObjectStorageConfig(this.env);
    const blobs = new S3BlocksBlobStore(objectConfig);
    const metadata = new PgBlocksAssetMetadataStore(this.pool);
    this.resourcesValue = {
      authorizer,
      upload: new BlocksAssetUploadPipeline(blobs, metadata),
      reader: new BlocksDraftAssetReader(projects, metadata, blobs),
    };
    return this.resourcesValue;
  }
  async authorize(input: {
    authorization: string | undefined;
    origin: string | undefined;
    projectId: string;
    permission: 'project:read' | 'asset:read' | 'asset:write' | 'draft:write' | 'snapshot:write';
  }): Promise<BlocksRuntimeAuthorizedResult> {
    try {
      const result = await this.resources().authorizer.authorize(input);
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          grant: result.value.grant,
          actor: { ...result.value.actor },
        },
      };
    } catch {
      return { ok: false, code: 'dependency_unavailable' };
    }
  }

  consumeRequest(grant: Readonly<BlocksRuntimeGrant>): RateLimitDecision {
    return this.requestBudget.consume(grant.tokenId);
  }

  async uploadAsset(input: {
    authorized: BlocksRuntimeAuthorized;
    assetId: string;
    dataFormat: BlocksAssetFormat;
    source: AsyncIterable<Uint8Array>;
  }): Promise<BlocksAssetReferenceV1> {
    const lease = this.uploadBudget.begin(input.authorized.grant);
    if (!lease.ok) throw new BlocksAssetUploadBudgetError(lease.code);
    try {
      return await this.resources().upload.upload({
        tenantId: input.authorized.grant.tenantId,
        assetId: input.assetId,
        dataFormat: input.dataFormat,
        source: input.source,
        uniqueByteBudget: {
          reserve: (sizeBytes) =>
            this.uploadBudget.reserveNewBytes(input.authorized.grant, sizeBytes),
        },
      });
    } finally {
      lease.value.release();
    }
  }

  async readAsset(input: {
    authorized: BlocksRuntimeAuthorized;
    assetId: string;
    dataFormat: BlocksAssetFormat;
  }): Promise<BlocksDraftAssetReadResult> {
    return this.resources().reader.read({
      tenantId: input.authorized.grant.tenantId,
      projectId: input.authorized.grant.projectId,
      actor: { ...input.authorized.actor },
      assetId: input.assetId,
      dataFormat: input.dataFormat,
    });
  }
  async save(input: {
    authorized: BlocksRuntimeAuthorized;
    projectId: string;
    document: unknown;
    baseRevision: number;
    mutationId: string;
  }): Promise<UseCaseResult<ProjectDraft>> {
    return this.saveDraft.execute({
      tenantId: input.authorized.grant.tenantId,
      projectId: input.projectId,
      actor: { ...input.authorized.actor },
      document: input.document,
      baseRevision: input.baseRevision,
      mutationId: input.mutationId,
    });
  }
}

export const BLOCKS_RUNTIME_REQUEST_LIMIT = RUNTIME_REQUEST_LIMIT;
export const BLOCKS_RUNTIME_REQUEST_WINDOW_MS = RUNTIME_REQUEST_WINDOW_MS;
