import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLOCKS_MODULE, type BlocksAssetReferenceV1 } from '@asa-lab/blocks';
import {
  OpenProjectUseCase,
  SaveDraftUseCase,
  type Project,
  type ProjectActor,
  type ProjectDraft,
  type ProjectRepositoryPort,
  type ModuleCatalogPort,
} from '@asa-lab/projects';
import {
  BlocksProjectPersistence,
  type BlocksDurableAssetPort,
  type BlocksSaveInput,
} from './blocks-project-persistence.js';
import {
  BlocksDraftPersistenceGuard,
  type BlocksStoredAssetMetadata,
} from './blocks-persistence.guard.js';
import {
  assetKey,
  inspectBlocksDocument,
  inspectScratchProject,
  snapshotJson,
} from './blocks-durable-document.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=',
  'base64',
);
const WAV = Buffer.alloc(46);
WAV.write('RIFF');
WAV.writeUInt32LE(38, 4);
WAV.write('WAVEfmt ', 8);
WAV.writeUInt32LE(16, 16);
WAV.writeUInt16LE(1, 20);
WAV.writeUInt16LE(1, 22);
WAV.writeUInt32LE(8000, 24);
WAV.writeUInt32LE(16000, 28);
WAV.writeUInt16LE(2, 32);
WAV.writeUInt16LE(16, 34);
WAV.write('data', 36);
WAV.writeUInt32LE(2, 40);
const md5 = (b: Uint8Array) => createHash('md5').update(b).digest('hex');
const digest = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const REF_PNG: BlocksAssetReferenceV1 = {
  assetId: md5(PNG),
  dataFormat: 'png',
  sha256: digest(PNG),
  sizeBytes: PNG.length,
};
const REF_WAV: BlocksAssetReferenceV1 = {
  assetId: md5(WAV),
  dataFormat: 'wav',
  sha256: digest(WAV),
  sizeBytes: WAV.length,
};
const actor: ProjectActor = { principalId: randomUUID(), userId: randomUUID() };
const tenantId = randomUUID(),
  projectId = randomUUID();
function graph() {
  const target = (isStage: boolean) => ({
    isStage,
    name: isStage ? 'Stage' : 'Sprite1',
    variables: { counter: ['counter', 7] },
    lists: {},
    broadcasts: {},
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [
      {
        name: 'image',
        assetId: REF_PNG.assetId,
        dataFormat: 'png',
        md5ext: assetKey(REF_PNG),
        bitmapResolution: 1,
        rotationCenterX: 0,
        rotationCenterY: 0,
      },
    ],
    sounds: [
      {
        name: 'sound',
        assetId: REF_WAV.assetId,
        dataFormat: 'wav',
        md5ext: assetKey(REF_WAV),
        rate: 8000,
        sampleCount: 1,
      },
    ],
    volume: 100,
    layerOrder: isStage ? 0 : 1,
    ...(isStage
      ? { tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null }
      : {
          visible: true,
          x: 12,
          y: -8,
          size: 100,
          direction: 90,
          draggable: false,
          rotationStyle: 'all around',
        }),
  });
  const targets = [target(true), target(false)];
  Object.assign(targets[1]!.blocks, {
    hat: {
      opcode: 'event_whenflagclicked',
      next: 'move',
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 100,
      y: 100,
    },
    move: {
      opcode: 'motion_changexby',
      next: null,
      parent: 'hat',
      inputs: { DX: [1, [4, 10]] },
      fields: {},
      shadow: false,
      topLevel: false,
    },
  });
  return {
    targets,
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: '15.1.1', agent: 'ASA isolated test' },
  };
}
const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
interface DiskState {
  project: Project;
  draft: ProjectDraft;
  lastMutation: string | null;
}
/** File-backed TEST adapters exercise fresh-reader roundtrips; not PostgreSQL/RLS or S3 proof. */
function harness(reuse?: string) {
  const dir = reuse ?? mkdtempSync(join(tmpdir(), 'asa-scratch-save-test-'));
  if (!reuse) directories.push(dir);
  const statePath = join(dir, 'draft.json'),
    metadataPath = join(dir, 'metadata.json');
  const readState = (): DiskState => JSON.parse(readFileSync(statePath, 'utf8')) as DiskState;
  const writeState = (state: DiskState) => writeFileSync(statePath, JSON.stringify(state));
  if (!reuse) {
    writeState({
      project: {
        id: projectId,
        scope: 'personal',
        classroomId: null,
        moduleKey: 'blocks',
        title: 'Program',
        status: 'active',
        createdAt: 'now',
        updatedAt: 'now',
        preview: null,
        snapshotRevision: null,
        description: null,
        tags: [],
        license: 'CC-BY-4.0',
        copiedFrom: null,
      },
      draft: {
        projectId,
        document: { schemaVersion: 1, format: 'scratch-3', projectJson: null, assets: [] },
        revision: 1,
        updatedAt: 'now',
        preview: null,
      },
      lastMutation: null,
    });
    writeFileSync(metadataPath, '{}');
  }
  let permitted = true;
  const order: string[] = [];
  const load = vi.fn(async (tenant: string, id: string, principal: ProjectActor) => {
    if (
      !permitted ||
      tenant !== tenantId ||
      id !== projectId ||
      principal.principalId !== actor.principalId
    )
      return null;
    const state = readState();
    return { project: state.project, draft: state.draft, versions: [] };
  });
  const saveDraft = vi.fn(async (input: Parameters<ProjectRepositoryPort['saveDraft']>[0]) => {
    if (!(await load(input.tenantId, input.projectId, input.actor))) return null;
    const state = readState();
    if (
      state.draft.revision === input.baseRevision + 1 &&
      state.lastMutation === input.mutationId &&
      JSON.stringify(state.draft.document) === JSON.stringify(input.document)
    )
      return state.draft;
    if (state.draft.revision !== input.baseRevision) return null;
    order.push('draft');
    state.draft = {
      ...state.draft,
      document: input.document,
      revision: state.draft.revision + 1,
      preview: input.preview,
    };
    state.lastMutation = input.mutationId;
    writeState(state);
    return state.draft;
  });
  const projects = { load, saveDraft } as unknown as ProjectRepositoryPort;
  const readMetadata = (): Record<string, BlocksStoredAssetMetadata> =>
    JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, BlocksStoredAssetMetadata>;
  const assets: BlocksDurableAssetPort = {
    ensure: vi.fn(async (input) => {
      expect(input.tenantId).toBe(tenantId);
      expect(input.actor.principalId).toBe(actor.principalId);
      const ref = {
        ...input.identity,
        sha256: digest(input.bytes),
        sizeBytes: input.bytes.byteLength,
      };
      const metadata = readMetadata(),
        key = assetKey(ref),
        existing = metadata[key];
      if (existing && existing.sha256 !== ref.sha256) throw new Error('immutable alias conflict');
      writeFileSync(join(dir, ref.sha256 + '.blob'), input.bytes);
      order.push('asset:' + key);
      metadata[key] = { ...ref, tenantId: input.tenantId, blobCommitted: true };
      writeFileSync(metadataPath, JSON.stringify(metadata));
      return ref;
    }),
    resolve: vi.fn(async (input) =>
      input.tenantId === tenantId ? (readMetadata()[assetKey(input)] ?? null) : null,
    ),
    read: vi.fn(async (input) => {
      const path = join(dir, input.reference.sha256 + '.blob');
      return input.tenantId === tenantId && existsSync(path) ? readFileSync(path) : null;
    }),
  };
  const provider = BLOCKS_MODULE.provider!;
  const module = {
    moduleKey: 'blocks',
    defaultProjectTitlePrefix: 'Program',
    createEmptyProject: () => provider.createEmptyProject(),
    describePreview: () => null,
    validateDocument: (value: unknown) => {
      const r = provider.validate(value);
      return r.ok
        ? { ok: true as const, document: r.payload }
        : { ok: false as const, message: 'invalid Blocks envelope' };
    },
  };
  const modules: ModuleCatalogPort = {
    get: (key) => (key === 'blocks' ? module : null),
    getCreatable: (key) => (key === 'blocks' ? module : null),
  };
  const source = {
    read: vi.fn(async (id: { assetId: string }) =>
      id.assetId === REF_PNG.assetId
        ? Uint8Array.from(PNG)
        : id.assetId === REF_WAV.assetId
          ? Uint8Array.from(WAV)
          : null,
    ),
  };
  const service = new BlocksProjectPersistence(projects, modules, assets);
  const input = (): BlocksSaveInput => ({
    tenantId,
    projectId,
    actor: { ...actor },
    projectJson: graph(),
    baseRevision: 1,
    mutationId: randomUUID(),
  });
  return {
    dir,
    statePath,
    metadataPath,
    readState,
    writeState,
    readMetadata,
    source,
    service,
    input,
    assets,
    modules,
    projects,
    saveDraft,
    order,
    revoke: () => {
      permitted = false;
    },
  };
}
describe('Scratch manual save → existing Project Core → fresh-reader open', () => {
  it('persists edited program, deduplicates shared costume/sound and opens exact bytes in a fresh instance', async () => {
    const h = harness(),
      input = h.input();
    const saved = await h.service.save(input, h.source);
    expect(saved).toMatchObject({ ok: true, value: { revision: 2 } });
    expect(h.source.read).toHaveBeenCalledTimes(2);
    expect(h.order).toHaveLength(3);
    expect(h.order.at(-1)).toBe('draft');
    const next = harness(h.dir);
    const opened = await next.service.open({ tenantId, projectId, actor });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('open failed');
    expect(opened.value.document.projectJson).toEqual(input.projectJson);
    expect(opened.value.document.assets).toHaveLength(2);
    expect(
      opened.value.assets.map((item) => Buffer.from(item.bytes).toString('base64')).sort(),
    ).toEqual([PNG.toString('base64'), WAV.toString('base64')].sort());
    expect(readFileSync(h.statePath, 'utf8')).not.toContain('objectKey');
    expect(readFileSync(h.statePath, 'utf8')).not.toContain(PNG.toString('base64'));
    expect(next.source.read).not.toHaveBeenCalled();
  });
  it('preserves the same mutation/revision for lost-response retries, not a guessed latest revision', async () => {
    const h = harness(),
      input = h.input();
    const first = await h.service.save(input, h.source);
    expect(await h.service.save(input, h.source)).toEqual(first);
    expect(h.readState().draft.revision).toBe(2);
    const changedGraph = graph();
    Object.assign(changedGraph.targets[1]!, { x: 13 });
    const changed = { ...input, projectJson: changedGraph };
    expect(await h.service.save(changed, h.source)).toMatchObject({
      ok: false,
      code: 'project_revision_conflict',
    });
    expect(h.readState().draft.document).toEqual(first.ok ? first.value.document : null);
    expect(
      h.saveDraft.mock.calls.every(
        ([call]) => call.baseRevision === 1 && call.mutationId === input.mutationId,
      ),
    ).toBe(true);
  });
  it('opens an uninitialised project without fetching any asset', async () => {
    const h = harness();
    expect(await h.service.open({ tenantId, projectId, actor })).toMatchObject({
      ok: true,
      value: { assets: [], document: { projectJson: null } },
    });
    expect(h.assets.read).not.toHaveBeenCalled();
  });
  it.each(['missing', 'digest', 'throw'] as const)(
    'never writes a draft when source is %s',
    async (mode) => {
      const h = harness();
      h.source.read.mockImplementation(async () => {
        if (mode === 'throw') throw new Error('secret dependency detail');
        return mode === 'missing' ? null : Uint8Array.from([1, 2, 3]);
      });
      const result = await h.service.save(h.input(), h.source);
      expect(result.ok).toBe(false);
      expect(h.saveDraft).not.toHaveBeenCalled();
      expect(h.readState().draft.revision).toBe(1);
      expect(JSON.stringify(result)).not.toContain('secret');
    },
  );
  it('keeps the old draft when one upload fails; accepted earlier bytes may remain orphaned', async () => {
    const h = harness(),
      ensure = vi.mocked(h.assets.ensure).getMockImplementation()!;
    vi.mocked(h.assets.ensure)
      .mockImplementationOnce(ensure)
      .mockRejectedValueOnce(new Error('storage failed'));
    expect(await h.service.save(h.input(), h.source)).toMatchObject({
      ok: false,
      code: 'dependency_unavailable',
    });
    expect(h.saveDraft).not.toHaveBeenCalled();
    expect(h.readState().draft.revision).toBe(1);
  });
  it('refuses a mismatched upload receipt and never writes physical storage paths', async () => {
    const h = harness();
    vi.mocked(h.assets.ensure).mockResolvedValue({ ...REF_PNG, sha256: 'a'.repeat(64) });
    expect(await h.service.save(h.input(), h.source)).toMatchObject({
      ok: false,
      code: 'validation_error',
    });
    expect(h.saveDraft).not.toHaveBeenCalled();
  });
  it.each(['tenant', 'principal', 'project'] as const)(
    'refuses a foreign %s before reading or writing resources',
    async (kind) => {
      const h = harness(),
        request = h.input();
      const bad =
        kind === 'tenant'
          ? { ...request, tenantId: randomUUID() }
          : kind === 'project'
            ? { ...request, projectId: randomUUID() }
            : { ...request, actor: { ...actor, principalId: randomUUID() } };
      expect(await h.service.save(bad, h.source)).toMatchObject({
        ok: false,
        code: 'project_not_found',
      });
      expect(h.source.read).not.toHaveBeenCalled();
      expect(h.assets.ensure).not.toHaveBeenCalled();
    },
  );
  it('rechecks access before committing after resource upload', async () => {
    const h = harness(),
      ensure = vi.mocked(h.assets.ensure).getMockImplementation()!;
    vi.mocked(h.assets.ensure).mockImplementation(async (value) => {
      const ref = await ensure(value);
      h.revoke();
      return ref;
    });
    expect(await h.service.save(h.input(), h.source)).toMatchObject({
      ok: false,
      code: 'project_not_found',
    });
    expect(h.saveDraft).not.toHaveBeenCalled();
    expect(h.readState().draft.revision).toBe(1);
  });
  it('snapshots graph, actor and mutation before asynchronous work', async () => {
    const h = harness(),
      input = { ...h.input(), projectJson: graph(), actor: { ...actor } };
    const original = structuredClone(input);
    const pending = h.service.save(input, h.source);
    Object.assign(input.projectJson.targets[1]!, { x: 999 });
    input.actor.principalId = randomUUID();
    input.mutationId = randomUUID();
    expect((await pending).ok).toBe(true);
    const call = h.saveDraft.mock.calls[0]![0];
    expect(call.actor).toEqual(original.actor);
    expect(call.mutationId).toBe(original.mutationId);
    expect((call.document as { projectJson: unknown }).projectJson).toEqual(original.projectJson);
  });
  it.each([{ baseRevision: -1 }, { baseRevision: 1.5 }, { mutationId: 'invalid' }])(
    'rejects bad mutation identity before asset work %#',
    async (override) => {
      const h = harness();
      expect(await h.service.save({ ...h.input(), ...override }, h.source)).toMatchObject({
        ok: false,
        code: 'validation_error',
      });
      expect(h.source.read).not.toHaveBeenCalled();
    },
  );
  it.each(['missing', 'corrupt'] as const)(
    'fails to open rather than silently dropping a %s saved file',
    async (kind) => {
      const h = harness();
      expect((await h.service.save(h.input(), h.source)).ok).toBe(true);
      if (kind === 'missing') rmSync(join(h.dir, REF_WAV.sha256 + '.blob'));
      else writeFileSync(join(h.dir, REF_WAV.sha256 + '.blob'), Buffer.from('wrong'));
      const fresh = harness(h.dir);
      expect((await fresh.service.open({ tenantId, projectId, actor })).ok).toBe(false);
      expect(fresh.source.read).not.toHaveBeenCalled();
      expect(fresh.assets.ensure).not.toHaveBeenCalled();
    },
  );
});

const envelope = () => ({
  schemaVersion: 1,
  format: 'scratch-3',
  projectJson: graph(),
  assets: [{ ...REF_PNG }, { ...REF_WAV }],
});
describe('durability validation uses the pinned Scratch parser and exact reference set', () => {
  it('accepts a real Scratch3 shape and deduplicates repeated graph references', async () => {
    const inspected = await inspectScratchProject(graph());
    expect(inspected.expectedAssets).toHaveLength(2);
    expect(inspected.projectJson).toEqual(graph());
    expect(await inspectBlocksDocument(envelope())).toMatchObject({ projectJson: graph() });
  });
  it.each([
    [
      'missing',
      (d: ReturnType<typeof envelope>) => {
        d.assets.pop();
      },
    ],
    [
      'duplicate',
      (d: ReturnType<typeof envelope>) => {
        d.assets.push({ ...REF_PNG });
      },
    ],
    [
      'extra',
      (d: ReturnType<typeof envelope>) => {
        d.assets.push({ ...REF_PNG, assetId: 'a'.repeat(32) });
      },
    ],
    [
      'format',
      (d: ReturnType<typeof envelope>) => {
        d.assets[0]!.dataFormat = 'jpg';
      },
    ],
    [
      'identity',
      (d: ReturnType<typeof envelope>) => {
        d.projectJson.targets[0]!.costumes[0]!.md5ext = 'wrong.png';
      },
    ],
    [
      'empty-with-assets',
      (d: ReturnType<typeof envelope>) => {
        (d as { projectJson: unknown }).projectJson = null;
      },
    ],
    [
      'inline-object-key',
      (d: ReturnType<typeof envelope>) => {
        Object.assign(d.assets[0]!, { objectKey: 'private/key' });
      },
    ],
  ] as const)('rejects %s references', async (_name, mutate) => {
    const document = envelope();
    mutate(document);
    await expect(inspectBlocksDocument(document)).rejects.toThrow();
  });
  it('rejects a shallow-looking graph which fails the official parser', async () => {
    await expect(
      inspectScratchProject({ targets: [{ isStage: true }], monitors: [], extensions: [] }),
    ).rejects.toThrow('blocks_project_invalid');
  });
  it('does not silently save the different source when parser repairs backspace characters', async () => {
    const value = graph();
    value.targets[1]!.name = 'sprite\bname';
    await expect(inspectScratchProject(value)).rejects.toThrow('blocks_project_invalid');
  });
  it('checks the aggregate over unique canonical assets and enforces JSON limits', async () => {
    await expect(
      inspectBlocksDocument(envelope(), 16 * 1024 * 1024, PNG.length + WAV.length - 1),
    ).rejects.toThrow('blocks_project_too_large');
    await expect(inspectScratchProject(graph(), 20)).rejects.toThrow('blocks_project_too_large');
  });
  it.each([undefined, NaN, Infinity, new Date(), { value: undefined }, { value: () => true }])(
    'rejects non-JSON values without silently deleting them %#',
    (value) => {
      expect(() => snapshotJson(value)).toThrow();
    },
  );
  it('rejects cycles and accessors without executing a getter', () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => snapshotJson(value)).toThrow();
    const getter = vi.fn(() => 'data');
    const x = Object.defineProperty({}, 'x', { get: getter, enumerable: true });
    expect(() => snapshotJson(x)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
describe('one common SaveDraftUseCase enforces durable references before any write', () => {
  it.each([
    ['tenant', { tenantId: randomUUID() }],
    ['digest', { sha256: 'f'.repeat(64) }],
    ['size', { sizeBytes: 999 }],
    ['format', { dataFormat: 'mp3' }],
    ['asset-id', { assetId: 'f'.repeat(32) }],
    ['uncommitted', { blobCommitted: false }],
  ])(
    'rejects server metadata %s mismatch through the generic save use case',
    async (_name, change) => {
      const h = harness();
      await h.service.save(h.input(), h.source);
      h.saveDraft.mockClear();
      const resolve = vi.mocked(h.assets.resolve).getMockImplementation()!;
      vi.mocked(h.assets.resolve).mockImplementation(
        async (input) => ({ ...(await resolve(input))!, ...change }) as BlocksStoredAssetMetadata,
      );
      const guard = new BlocksDraftPersistenceGuard(h.assets);
      const result = await new SaveDraftUseCase(h.projects, h.modules, guard).execute({
        ...h.input(),
        baseRevision: 2,
        document: envelope(),
      });
      expect(result).toMatchObject({ ok: false, code: 'validation_error' });
      expect(h.saveDraft).not.toHaveBeenCalled();
      expect(h.readState().draft.revision).toBe(2);
    },
  );
  it.each(['missing', 'unavailable'])(
    'refuses %s metadata without a saved revision',
    async (mode) => {
      const h = harness();
      if (mode === 'missing') vi.mocked(h.assets.resolve).mockResolvedValue(null);
      else
        vi.mocked(h.assets.resolve).mockRejectedValue(new Error('secret connection information'));
      const save = new SaveDraftUseCase(
        h.projects,
        h.modules,
        new BlocksDraftPersistenceGuard(h.assets),
      );
      const result = await save.execute({ ...h.input(), document: envelope() });
      expect(result).toMatchObject({
        ok: false,
        code: mode === 'missing' ? 'validation_error' : 'dependency_unavailable',
      });
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(h.saveDraft).not.toHaveBeenCalled();
    },
  );
  it('validates the pre-VM empty document without a metadata dependency call', async () => {
    const h = harness(),
      guard = new BlocksDraftPersistenceGuard(h.assets);
    expect(
      await guard.validate({
        tenantId,
        projectId,
        actor,
        moduleKey: 'blocks',
        document: { schemaVersion: 1, format: 'scratch-3', projectJson: null, assets: [] },
      }),
    ).toEqual({ ok: true });
    expect(h.assets.resolve).not.toHaveBeenCalled();
  });
  it.each(['electronics', 'chess', 'checkers', 'three-d'])(
    'keeps %s save behavior outside the Blocks validator',
    async (moduleKey) => {
      const h = harness(),
        state = h.readState();
      state.project = { ...state.project, moduleKey };
      h.writeState(state);
      const module = {
        moduleKey,
        defaultProjectTitlePrefix: 'Project',
        validateDocument: (document: unknown) => ({ ok: true as const, document }),
        describePreview: () => null,
      };
      const catalog: ModuleCatalogPort = { get: () => module, getCreatable: () => null };
      const result = await new SaveDraftUseCase(
        h.projects,
        catalog,
        new BlocksDraftPersistenceGuard(h.assets),
      ).execute({ ...h.input(), document: { module: moduleKey, valid: true } });
      expect(result).toMatchObject({
        ok: true,
        value: { revision: 2, document: { module: moduleKey } },
      });
      expect(h.assets.resolve).not.toHaveBeenCalled();
    },
  );
  it('does not let a guard mutate the document it approved or leak thrown errors', async () => {
    const h = harness();
    const document = { schemaVersion: 1, format: 'scratch-3', projectJson: null, assets: [] };
    const save = new SaveDraftUseCase(h.projects, h.modules, {
      validate: async (input) => {
        (input.document as { format: string }).format = 'corrupt';
        return { ok: true };
      },
    });
    expect((await save.execute({ ...h.input(), document })).ok).toBe(true);
    expect(h.readState().draft.document).toEqual(document);
    h.saveDraft.mockClear();
    const broken = new SaveDraftUseCase(h.projects, h.modules, {
      validate: async () => {
        throw new Error('private database detail');
      },
    });
    expect(await broken.execute({ ...h.input(), document })).toEqual({
      ok: false,
      code: 'dependency_unavailable',
      message: 'Project storage validation is unavailable.',
    });
    expect(h.saveDraft).not.toHaveBeenCalled();
  });
  it('the existing OpenProjectUseCase sees the same saved document, not a parallel Blocks draft', async () => {
    const h = harness();
    await h.service.save(h.input(), h.source);
    expect(
      await new OpenProjectUseCase(h.projects).execute(tenantId, projectId, actor),
    ).toMatchObject({
      ok: true,
      value: { draft: { revision: 2, document: { format: 'scratch-3', projectJson: graph() } } },
    });
  });
});

describe('save/open cancellation and shared writer regressions', () => {
  it('preserves one winner and rejects the other concurrent draft without overwriting', async () => {
    const h = harness();
    const first = h.input();
    const otherGraph = graph();
    Object.assign(otherGraph.targets[1]!, { x: 25 });
    const second = { ...h.input(), projectJson: otherGraph };
    const results = await Promise.all([
      h.service.save(first, h.source),
      h.service.save(second, h.source),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      expect.objectContaining({ code: 'project_revision_conflict' }),
    ]);
    const winner = results.find((r) => r.ok)!;
    expect(h.readState().draft).toEqual(winner.ok ? winner.value : null);
    expect(h.readState().draft.revision).toBe(2);
  });
  it('does not return a project trashed while its assets were being read', async () => {
    const h = harness();
    await h.service.save(h.input(), h.source);
    const read = vi.mocked(h.assets.read).getMockImplementation()!;
    vi.mocked(h.assets.read).mockImplementation(async (input) => {
      const bytes = await read(input),
        state = h.readState();
      state.project = { ...state.project, status: 'trashed' };
      h.writeState(state);
      return bytes;
    });
    expect(await h.service.open({ tenantId, projectId, actor })).toMatchObject({
      ok: false,
      code: 'project_not_found',
    });
  });
  it('denies an already-trashed project before touching resource storage', async () => {
    const h = harness(),
      state = h.readState();
    state.project = { ...state.project, status: 'trashed' };
    h.writeState(state);
    expect(await h.service.save(h.input(), h.source)).toMatchObject({ ok: false });
    expect(await h.service.open({ tenantId, projectId, actor })).toMatchObject({ ok: false });
    expect(h.assets.ensure).not.toHaveBeenCalled();
    expect(h.assets.read).not.toHaveBeenCalled();
  });
  it('preserves validation order before snapshotting or calling the guard', async () => {
    const h = harness(),
      validate = vi.fn(async () => ({ ok: true as const }));
    const save = new SaveDraftUseCase(h.projects, h.modules, { validate });
    const result = await save.execute({ ...h.input(), document: () => true, baseRevision: -1 });
    expect(result).toEqual({
      ok: false,
      code: 'validation_error',
      message: 'baseRevision must be a non-negative integer',
    });
    expect(validate).not.toHaveBeenCalled();
    expect(h.saveDraft).not.toHaveBeenCalled();
  });
  it('snapshots generic draft inputs while the async guard is pending', async () => {
    const h = harness();
    const document = { schemaVersion: 1, format: 'scratch-3', projectJson: null, assets: [] };
    const input = { ...h.input(), actor: { ...actor }, document };
    const original = structuredClone(input);
    const save = new SaveDraftUseCase(h.projects, h.modules, {
      validate: async () => ({ ok: true }),
    });
    const pending = save.execute(input);
    input.actor.principalId = randomUUID();
    input.baseRevision = 999;
    input.mutationId = randomUUID();
    input.document.format = 'mutated';
    expect((await pending).ok).toBe(true);
    expect(h.saveDraft.mock.calls[0]![0]).toMatchObject({
      actor: original.actor,
      baseRevision: original.baseRevision,
      mutationId: original.mutationId,
      document: original.document,
    });
  });
  it('never treats a non-boolean guard reply as approval', async () => {
    const h = harness();
    const save = new SaveDraftUseCase(h.projects, h.modules, {
      validate: async () => ({ ok: 'yes' as unknown as true }),
    });
    expect(await save.execute({ ...h.input(), document: envelope() })).toMatchObject({
      ok: false,
      code: 'dependency_unavailable',
    });
    expect(h.saveDraft).not.toHaveBeenCalled();
  });
});
