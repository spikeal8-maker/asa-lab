import { createHash } from 'node:crypto';
import type { BlocksAssetReferenceV1, BlocksProjectDocumentV1 } from '@asa-lab/blocks';
import {
  OpenProjectUseCase,
  SaveDraftUseCase,
  type ModuleCatalogPort,
  type ProjectActor,
  type ProjectDraft,
  type ProjectRepositoryPort,
  type UseCaseResult,
} from '@asa-lab/projects';
import {
  assetByteLimit,
  BLOCKS_ASSET_TOTAL_LIMIT,
  inspectBlocksDocument,
  inspectScratchProject,
  snapshotJson,
  rejectDocument,
  type BlocksAssetIdentity,
} from './blocks-durable-document.js';
import {
  BlocksDraftPersistenceGuard,
  persistenceFailure,
  type BlocksAssetMetadataPort,
} from './blocks-persistence.guard.js';

export interface BlocksAssetSourcePort {
  /** Exact bytes from the captured VM state, independent of Scratch's clean flag. */
  read(identity: BlocksAssetIdentity): Promise<Uint8Array | null>;
}
export interface BlocksDurableAssetPort extends BlocksAssetMetadataPort {
  /** Implementer validates content and persists object before immutable metadata. */
  ensure(input: {
    tenantId: string;
    projectId: string;
    actor: ProjectActor;
    identity: BlocksAssetIdentity;
    bytes: Uint8Array;
  }): Promise<BlocksAssetReferenceV1>;
  /** Must read the exact private canonical blob; no external fallback. */
  read(input: {
    tenantId: string;
    projectId: string;
    actor: ProjectActor;
    reference: BlocksAssetReferenceV1;
  }): Promise<Uint8Array | null>;
}
export interface BlocksSaveInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly actor: ProjectActor;
  readonly projectJson: unknown;
  readonly baseRevision: number;
  readonly mutationId: string;
}
function checkedBytes(bytes: Uint8Array | null, identity: BlocksAssetIdentity): Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
    rejectDocument('blocks_asset_reference_missing');
  if (bytes.byteLength > assetByteLimit(identity.dataFormat))
    rejectDocument('blocks_project_too_large');
  const copy = Uint8Array.from(bytes);
  if (createHash('md5').update(copy).digest('hex') !== identity.assetId)
    rejectDocument('blocks_asset_identity_invalid');
  return copy;
}
function canonicalReference(
  identity: BlocksAssetIdentity,
  bytes: Uint8Array,
): BlocksAssetReferenceV1 {
  return {
    ...identity,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  };
}
function sameReference(a: BlocksAssetReferenceV1, b: BlocksAssetReferenceV1): boolean {
  return (
    a.assetId === b.assetId &&
    a.dataFormat === b.dataFormat &&
    a.sha256 === b.sha256 &&
    a.sizeBytes === b.sizeBytes
  );
}
/** Explicit asset-before-draft save/open pipeline; not a cross-store atomic transaction. */
export class BlocksProjectPersistence {
  private readonly saveDraft: SaveDraftUseCase;
  private readonly openProject: OpenProjectUseCase;
  private readonly guard: BlocksDraftPersistenceGuard;
  constructor(
    private readonly projects: ProjectRepositoryPort,
    modules: ModuleCatalogPort,
    private readonly assets: BlocksDurableAssetPort,
  ) {
    if (typeof assets?.ensure !== 'function' || typeof assets.read !== 'function')
      throw new Error('Durable Blocks asset operations are required.');
    this.guard = new BlocksDraftPersistenceGuard(assets);
    this.saveDraft = new SaveDraftUseCase(projects, modules, this.guard);
    this.openProject = new OpenProjectUseCase(projects);
  }
  async save(
    input: BlocksSaveInput,
    source: BlocksAssetSourcePort,
  ): Promise<UseCaseResult<ProjectDraft>> {
    try {
      const request = {
        tenantId: input.tenantId,
        projectId: input.projectId,
        actor: { ...input.actor },
        baseRevision: input.baseRevision,
        mutationId: input.mutationId,
      };
      if (
        !Number.isSafeInteger(request.baseRevision) ||
        request.baseRevision < 0 ||
        typeof request.mutationId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          request.mutationId,
        )
      )
        return {
          ok: false,
          code: 'validation_error',
          message: 'A valid baseRevision and mutationId are required.',
        };
      const captured = snapshotJson(input.projectJson);
      const loaded = await this.projects.load(request.tenantId, request.projectId, request.actor);
      if (!loaded || loaded.project.moduleKey !== 'blocks' || loaded.project.status === 'trashed')
        return { ok: false, code: 'project_not_found', message: 'Scratch project not found.' };
      const inspected = await inspectScratchProject(captured);
      const references: BlocksAssetReferenceV1[] = [];
      let total = 0;
      for (const identity of inspected.expectedAssets) {
        const bytes = checkedBytes(await source.read({ ...identity }), identity);
        total += bytes.byteLength;
        if (total > BLOCKS_ASSET_TOTAL_LIMIT) rejectDocument('blocks_project_too_large');
        const expected = canonicalReference(identity, bytes);
        const stored = await this.assets.ensure({
          ...request,
          actor: { ...request.actor },
          identity: { ...identity },
          bytes,
        });
        if (!stored || !sameReference(stored, expected))
          rejectDocument('blocks_asset_reference_mismatch');
        references.push(expected);
      }
      const document: BlocksProjectDocumentV1 = {
        schemaVersion: 1,
        format: 'scratch-3',
        projectJson: inspected.projectJson,
        assets: references,
      };
      // The common use case rechecks current project access and every durable reference.
      return await this.saveDraft.execute({ ...request, document });
    } catch (problem) {
      return persistenceFailure(problem);
    }
  }
  async open(input: { tenantId: string; projectId: string; actor: ProjectActor }): Promise<
    UseCaseResult<{
      draft: ProjectDraft;
      document: BlocksProjectDocumentV1;
      assets: readonly { reference: BlocksAssetReferenceV1; bytes: Uint8Array }[];
    }>
  > {
    try {
      const request = {
        tenantId: input.tenantId,
        projectId: input.projectId,
        actor: { ...input.actor },
      };
      const opened = await this.openProject.execute(
        request.tenantId,
        request.projectId,
        request.actor,
      );
      if (!opened.ok) return opened;
      if (opened.value.project.moduleKey !== 'blocks' || opened.value.project.status === 'trashed')
        return { ok: false, code: 'project_not_found', message: 'Scratch project not found.' };
      const draft = structuredClone(opened.value.draft);
      const document = await inspectBlocksDocument(draft.document);
      const valid = await this.guard.validate({ ...request, moduleKey: 'blocks', document });
      if (!valid.ok) return valid;
      const assets: { reference: BlocksAssetReferenceV1; bytes: Uint8Array }[] = [];
      for (const reference of document.assets) {
        const raw = await this.assets.read({
          ...request,
          actor: { ...request.actor },
          reference: { ...reference },
        });
        if (!raw) throw new Error('Stored asset unavailable.');
        const bytes = checkedBytes(raw, reference);
        if (!sameReference(reference, canonicalReference(reference, bytes)))
          throw new Error('Stored asset integrity failure.');
        assets.push({ reference: { ...reference }, bytes });
      }
      const current = await this.projects.load(request.tenantId, request.projectId, request.actor);
      if (
        !current ||
        current.project.moduleKey !== 'blocks' ||
        current.project.status === 'trashed'
      )
        return { ok: false, code: 'project_not_found', message: 'Scratch project not found.' };
      return { ok: true, value: { draft, document, assets } };
    } catch (problem) {
      return persistenceFailure(problem);
    }
  }
}
