import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { BLOCKS_MODULE, type BlocksProjectDocumentV1 } from '../../contexts/blocks/index';
import {
  OpenProjectUseCase,
  SaveDraftUseCase,
  type ModuleCatalogPort,
  type Project,
  type ProjectActor,
  type ProjectDraft,
  type ProjectRepositoryPort,
} from '../../contexts/projects/index';
import {
  BlocksAssetUploadPipeline,
  type BlocksAssetMetadataCommitPort,
} from '../../apps/api/src/blocks-asset-upload';
import type { BlocksBlobStorePort } from '../../apps/api/src/blocks-asset-storage';
import {
  BlocksDraftPersistenceGuard,
  type BlocksStoredAssetMetadata,
} from '../../apps/api/src/blocks-persistence.guard';
import { BlocksDraftAssetReader } from '../../apps/api/src/blocks-asset-read';

describe('Scratch library SVG through real upload, guarded Project Core save/open and asset read', () => {
  it('retains original library bytes, references, code and revisions without relaxing tenant access', async () => {
    const root = mkdtempSync(join(tmpdir(), 'asa-scratch-svg-roundtrip-'));
    if (dirname(root) !== tmpdir() || !basename(root).startsWith('asa-scratch-svg-roundtrip-'))
      throw new Error('Unexpected test directory');
    try {
      const tenantId = randomUUID(),
        projectId = randomUUID();
      const actor: ProjectActor = { principalId: randomUUID(), userId: randomUUID() };
      const bytes = readFileSync(
        resolve(
          'apps/api/src/testing/fixtures/scratch-library/1e2c3987e4cdb1f317b1773662719b13.svg',
        ),
      );
      const assetId = createHash('md5').update(bytes).digest('hex');
      const blobs = new Map<string, Buffer>();
      const aliases = new Map<string, BlocksStoredAssetMetadata>();
      const objectKey = (input: { tenantId: string; sha256: string; dataFormat: string }) =>
        `${input.tenantId}/${input.sha256}.${input.dataFormat}`;
      const aliasKey = (input: { tenantId: string; assetId: string; dataFormat: string }) =>
        `${input.tenantId}/${input.assetId}.${input.dataFormat}`;
      const blobPort: BlocksBlobStorePort = {
        exists: async (input) => blobs.has(objectKey(input)),
        putImmutable: async (input) => {
          const key = objectKey(input);
          const source = readFileSync(input.sourcePath);
          const existing = blobs.get(key);
          if (existing) expect(existing).toEqual(source);
          else blobs.set(key, Buffer.from(source));
          return { objectKey: key, created: !existing };
        },
        open: async (input) => {
          const found = blobs.get(objectKey(input));
          return found ? Readable.from([Buffer.from(found)]) : null;
        },
      };
      const metadata: BlocksAssetMetadataCommitPort = {
        resolve: async (input) => aliases.get(aliasKey(input)) ?? null,
        commit: async (input) => {
          const value = { ...input.reference, tenantId: input.tenantId, blobCommitted: true };
          const key = aliasKey(value);
          const existing = aliases.get(key);
          if (existing) expect(existing).toEqual(value);
          else aliases.set(key, structuredClone(value));
          return structuredClone(value);
        },
      };
      const upload = () =>
        new BlocksAssetUploadPipeline(blobPort, metadata, root).upload({
          tenantId,
          assetId,
          dataFormat: 'svg',
          source: Readable.from([bytes]),
        });
      const reference = await upload();
      expect(reference).toEqual({
        assetId: '1e2c3987e4cdb1f317b1773662719b13',
        dataFormat: 'svg',
        sha256: '56a5e1d10eefec3ee23ca969e01d809d8488bf57f56733c36f57639f548fb93b',
        sizeBytes: 586,
      });
      expect(await upload()).toEqual(reference);
      expect(blobs.size).toBe(1);
      expect(aliases.size).toBe(1);
      expect(readdirSync(join(root, 'asa-blocks-uploads'))).toEqual([]);

      const project = {
        id: projectId,
        moduleKey: 'blocks',
        scope: 'personal',
        status: 'active',
        title: 'Library SVG roundtrip',
      } as Project;
      let draft: ProjectDraft = {
        projectId,
        document: BLOCKS_MODULE.provider!.createEmptyProject(),
        revision: 1,
        updatedAt: 'now',
        preview: null,
      };
      const load = vi.fn(async (tenant: string, id: string, currentActor: ProjectActor) =>
        tenant === tenantId && id === projectId && currentActor.principalId === actor.principalId
          ? structuredClone({ project, draft, versions: [] })
          : null,
      );
      const saveDraft = vi.fn(async (input: Parameters<ProjectRepositoryPort['saveDraft']>[0]) => {
        if (
          !(await load(input.tenantId, input.projectId, input.actor)) ||
          input.baseRevision !== draft.revision
        )
          return null;
        draft = {
          ...draft,
          document: structuredClone(input.document),
          preview: input.preview,
          revision: draft.revision + 1,
        };
        return structuredClone(draft);
      });
      const repository = { load, saveDraft } as unknown as ProjectRepositoryPort;
      const provider = BLOCKS_MODULE.provider!;
      const module = {
        moduleKey: 'blocks',
        defaultProjectTitlePrefix: 'Scratch',
        describePreview: () => null,
        createEmptyProject: () => provider.createEmptyProject(),
        validateDocument: (value: unknown) => {
          const result = provider.validate(value);
          return result.ok
            ? { ok: true as const, document: result.payload }
            : { ok: false as const, message: 'invalid Blocks envelope' };
        },
      };
      const modules: ModuleCatalogPort = {
        get: (key) => (key === 'blocks' ? module : null),
        getCreatable: () => null,
      };
      const document: BlocksProjectDocumentV1 = {
        schemaVersion: 1,
        format: 'scratch-3',
        assets: [reference],
        projectJson: {
          targets: [
            {
              isStage: true,
              name: 'Stage',
              variables: { counter: ['counter', 7] },
              lists: {},
              broadcasts: {},
              blocks: {
                start: {
                  opcode: 'event_whenflagclicked',
                  next: null,
                  parent: null,
                  inputs: {},
                  fields: {},
                  shadow: false,
                  topLevel: true,
                  x: 20,
                  y: 30,
                },
              },
              comments: {},
              currentCostume: 0,
              costumes: [
                {
                  name: 'Library shape',
                  assetId,
                  md5ext: `${assetId}.svg`,
                  dataFormat: 'svg',
                  bitmapResolution: 1,
                  rotationCenterX: 25,
                  rotationCenterY: 25,
                },
              ],
              sounds: [],
              volume: 100,
              layerOrder: 0,
              tempo: 60,
              videoTransparency: 50,
              videoState: 'on',
              textToSpeechLanguage: null,
            },
          ],
          monitors: [],
          extensions: [],
          meta: { semver: '3.0.0', vm: '15.1.1', agent: 'ASA compatibility fixture' },
        },
      };
      const save = new SaveDraftUseCase(
        repository,
        modules,
        new BlocksDraftPersistenceGuard(metadata),
      );
      expect(
        await save.execute({
          tenantId,
          projectId,
          actor,
          document,
          baseRevision: 1,
          mutationId: randomUUID(),
        }),
      ).toMatchObject({ ok: true, value: { revision: 2, document } });
      const opened = await new OpenProjectUseCase(repository).execute(tenantId, projectId, actor);
      expect(opened).toMatchObject({ ok: true, value: { draft: { revision: 2, document } } });
      // Fresh reader, actual reference authorization, exact bytes; no cached upload result.
      const read = await new BlocksDraftAssetReader(repository, metadata, blobPort).read({
        tenantId,
        projectId,
        actor,
        assetId,
        dataFormat: 'svg',
      });
      expect(read.ok).toBe(true);
      if (!read.ok) throw new Error(read.code);
      const returned: Buffer[] = [];
      for await (const chunk of read.value.body) returned.push(Buffer.from(chunk));
      expect(Buffer.concat(returned)).toEqual(bytes);
      expect(read.value.reference).toEqual(reference);

      const input = {
        tenantId,
        projectId,
        actor,
        document,
        baseRevision: 2,
        mutationId: randomUUID(),
      };
      aliases.clear();
      expect(await save.execute(input)).toMatchObject({
        ok: false,
        message: 'blocks_asset_reference_missing',
      });
      expect(saveDraft).toHaveBeenCalledTimes(1);
      expect(draft.revision).toBe(2);
      expect(
        (await new OpenProjectUseCase(repository).execute(randomUUID(), projectId, actor)).ok,
      ).toBe(false);
      expect(
        await new BlocksDraftAssetReader(repository, metadata, blobPort).read({
          tenantId: randomUUID(),
          projectId,
          actor,
          assetId,
          dataFormat: 'svg',
        }),
      ).toEqual({ ok: false, code: 'project_not_found' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
