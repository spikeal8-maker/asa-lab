import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';
import { URL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx', '.css']);

function sourceFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) {
        visit(child);
        continue;
      }
      const match = /\.[^.]+$/.exec(entry.name);
      if (match && SOURCE_EXTENSIONS.has(match[0])) files.push(child);
    }
  };
  visit(root);
  return files;
}

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const API_ORIGIN = 'https://asa.example';
const TOKEN = 'header.payload.signature';

class Storage {
  AssetType = {
    Project: { name: 'Project' },
    ImageVector: { name: 'ImageVector' },
    ImageBitmap: { name: 'ImageBitmap' },
    Sound: { name: 'Sound' },
  };
  DataFormat = {
    JSON: 'json',
    SVG: 'svg',
    PNG: 'png',
    JPG: 'jpg',
    WAV: 'wav',
    MP3: 'mp3',
  };
  createAsset(assetType, dataFormat, data, assetId) {
    return {
      assetType,
      dataFormat,
      data,
      assetId,
      clean: true,
      encodeDataURI: () => 'data:fixture',
    };
  }
  addHelper(helper) {
    this.helper = helper;
  }
  addWebStore(types, get, create, update) {
    this.webStore = { types, get, create, update };
  }
  async store() {
    throw new Error('fixture_store_not_configured');
  }
}

const standalone = {
  ScratchStorage: Storage,
  buildDefaultProject: () => [
    {
      assetType: 'Project',
      dataFormat: 'JSON',
      id: 0,
      data: JSON.stringify({ targets: [], monitors: [], extensions: [] }),
    },
  ],
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const asset = (id, format, bytes) => ({
  assetId: id,
  dataFormat: format,
  bytes,
  sha256: sha256(bytes),
  sizeBytes: bytes.byteLength,
});
const reference = (value) => ({
  assetId: value.assetId,
  dataFormat: value.dataFormat,
  sha256: value.sha256,
  sizeBytes: value.sizeBytes,
});
const imageFormats = new Set(['svg', 'png', 'jpg']);
const project = (name, assets = []) => ({
  targets: [
    {
      name,
      costumes: assets
        .filter((item) => imageFormats.has(item.dataFormat))
        .map((item) => ({ assetId: item.assetId, dataFormat: item.dataFormat })),
      sounds: assets
        .filter((item) => !imageFormats.has(item.dataFormat))
        .map((item) => ({ assetId: item.assetId, dataFormat: item.dataFormat })),
    },
  ],
  monitors: [],
  extensions: [],
});

function loadStorage(fetchMock, randomUUID) {
  class FixtureStorage extends Storage {
    async store(assetType, dataFormat, data, assetId) {
      const format = dataFormat || assetType?.runtimeFormat;
      const created = this.createAsset(assetType, format, data, assetId);
      const request = this.webStore?.update?.(created);
      if (!request) throw new Error('fixture_store_not_configured');
      const response = await fetchMock(request.url, { ...request, body: data });
      if (!response.ok || response.redirected) throw new Error('asset_write_failed');
      return response.json();
    }
  }

  const context = vm.createContext({
    TextEncoder,
    TextDecoder,
    ArrayBuffer,
    Uint8Array,
    URL,
    fetch: fetchMock,
    Response: globalThis.Response,
    AbortController: globalThis.AbortController,
    crypto: { subtle: webcrypto.subtle, randomUUID },
  });
  vm.runInContext(
    fs.readFileSync(new URL('../../infra/scratch-editor/host/storage.js', import.meta.url), 'utf8'),
    context,
  );
  const runtimeStandalone = { ...standalone, ScratchStorage: FixtureStorage };
  return (options) => context.AsaBlocksStorage.createReadOnlyStorage(runtimeStandalone, options);
}

async function storeAsset(storage, value) {
  const type =
    value.dataFormat === 'svg'
      ? storage.scratchStorage.AssetType.ImageVector
      : value.dataFormat === 'png' || value.dataFormat === 'jpg'
        ? storage.scratchStorage.AssetType.ImageBitmap
        : storage.scratchStorage.AssetType.Sound;
  return storage.scratchStorage.store(
    type,
    value.dataFormat,
    value.bytes,
    value.assetId,
  );
}

test('legacy parallel persistence symbols are absent from current Scratch source and tests', () => {
  const legacySymbols = [
    ['ASA_BLOCKS_', 'FLUSH_REQUEST'].join(''),
    ['ASA_BLOCKS_', 'FLUSH_RESULT'].join(''),
    ['request', 'Flush'].join(''),
    ['flush', 'Result'].join(''),
    ['persist', 'Snapshot'].join(''),
    ['captureLive', 'Snapshot'].join(''),
    ['blocks-editor-', 'save'].join(''),
    ['editor', '.flush'].join(''),
  ];
  const roots = [
    new URL('../../infra/scratch-editor/', import.meta.url),
    new URL('../../apps/web/src/blocks/', import.meta.url),
    new URL('../../tools/blocks/', import.meta.url),
    new URL('../../e2e/', import.meta.url),
  ];

  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const content = fs.readFileSync(file, 'utf8');
      for (const symbol of legacySymbols) {
        assert.equal(
          content.includes(symbol),
          false,
          symbol + ' remains in ' + file.pathname,
        );
      }
    }
  }
});

test('canonical fingerprint ignores object-key and reference ordering and unchanged save writes nothing', async () => {
  let uuidCalls = 0;
  const calls = [];
  const create = loadStorage(
    async (...args) => {
      calls.push(args);
      throw new Error('unexpected remote write');
    },
    () => {
      uuidCalls += 1;
      return 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    },
  );
  const a = asset('a'.repeat(32), 'png', Uint8Array.from([1, 2]));
  const b = asset('b'.repeat(32), 'wav', Uint8Array.from([3, 4]));
  const bootstrapJson = {
    extensions: [],
    monitors: [],
    targets: [
      {
        sounds: [{ dataFormat: b.dataFormat, assetId: b.assetId }],
        costumes: [{ dataFormat: a.dataFormat, assetId: a.assetId }],
        name: 'Same',
      },
    ],
  };
  const storage = create({
    projectId: PROJECT_ID,
    projectJson: bootstrapJson,
    assets: [reference(b), reference(a)],
    draftRevision: 5,
    apiOrigin: API_ORIGIN,
    getRuntimeToken: () => TOKEN,
    canSave: true,
  });
  const reordered = {
    targets: [
      {
        name: 'Same',
        costumes: [{ assetId: a.assetId, dataFormat: a.dataFormat }],
        sounds: [{ assetId: b.assetId, dataFormat: b.dataFormat }],
      },
    ],
    monitors: [],
    extensions: [],
  };

  const result = await storage.saveProject(PROJECT_ID, JSON.stringify(reordered));
  assert.equal(result.id, PROJECT_ID);
  assert.equal(storage.getConfirmedRevision(), 5);
  assert.equal(uuidCalls, 0);
  assert.equal(calls.length, 0);
});

test('lost response reuses mutation identity, durable assets and commits one revision', async () => {
  const mutationIds = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  ];
  let uuidIndex = 0;
  let serverRevision = 10;
  let draftAttempts = 0;
  let assetPuts = 0;
  const mutations = new Map();
  const seenDrafts = [];
  const create = loadStorage(
    async (url, init) => {
      const href = String(url);
      if (href.includes('/assets/')) {
        assetPuts += 1;
        const bytes = new Uint8Array(init.body);
        const match = /\/([a-f0-9]{32})\.(png|wav|svg|jpg|mp3)$/.exec(href);
        const ref = {
          assetId: match[1],
          dataFormat: match[2],
          sha256: sha256(bytes),
          sizeBytes: bytes.byteLength,
        };
        return new globalThis.Response(JSON.stringify({ status: 'ok', asset: ref }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      draftAttempts += 1;
      const body = JSON.parse(init.body);
      seenDrafts.push(body);
      const previous = mutations.get(body.mutationId);
      if (previous) {
        assert.equal(body.baseRevision, previous.baseRevision);
        assert.deepEqual(body.document, previous.document);
        return new globalThis.Response(
          JSON.stringify({ status: 'ok', revision: previous.revision }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      assert.equal(body.baseRevision, serverRevision);
      serverRevision += 1;
      mutations.set(body.mutationId, {
        baseRevision: body.baseRevision,
        document: body.document,
        revision: serverRevision,
      });
      if (draftAttempts === 1) throw new TypeError('lost response after commit');
      return new globalThis.Response(JSON.stringify({ status: 'ok', revision: serverRevision }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    () => mutationIds[uuidIndex++],
  );

  const storage = create({
    projectId: PROJECT_ID,
    projectJson: null,
    assets: [],
    draftRevision: 10,
    apiOrigin: API_ORIGIN,
    getRuntimeToken: () => TOKEN,
    canSave: true,
  });
  const media = asset('d'.repeat(32), 'png', Uint8Array.from([9, 8, 7]));
  await storeAsset(storage, media);
  const generationA = project('Changed', [media]);

  await assert.rejects(
    storage.saveProject(PROJECT_ID, JSON.stringify(generationA)),
    /draft_write_failed/,
  );
  assert.equal(serverRevision, 11);
  assert.equal(assetPuts, 1);
  assert.equal(storage.getConfirmedRevision(), 10);

  const result = await storage.saveProject(PROJECT_ID, JSON.stringify(generationA));
  assert.equal(result.id, PROJECT_ID);
  assert.equal(storage.getConfirmedRevision(), 11);
  assert.equal(serverRevision, 11);
  assert.equal(assetPuts, 1, 'confirmed durable asset must not be uploaded again');
  assert.equal(draftAttempts, 2);
  assert.equal(seenDrafts[0].mutationId, seenDrafts[1].mutationId);
  assert.equal(seenDrafts[0].baseRevision, 10);
  assert.equal(seenDrafts[1].baseRevision, 10);
  assert.equal(uuidIndex, 1, 'one serialized document generation owns one mutation id');

  const callsBeforeNoop = { assetPuts, draftAttempts, uuidIndex };
  await storage.saveProject(PROJECT_ID, JSON.stringify(generationA));
  assert.deepEqual({ assetPuts, draftAttempts, uuidIndex }, callsBeforeNoop);

  const generationB = project('Changed again', [media]);
  await storage.saveProject(PROJECT_ID, JSON.stringify(generationB));
  assert.equal(storage.getConfirmedRevision(), 12);
  assert.equal(serverRevision, 12);
  assert.equal(assetPuts, 1);
  assert.equal(draftAttempts, 3);
  assert.notEqual(seenDrafts[2].mutationId, seenDrafts[1].mutationId);
  assert.equal(seenDrafts[2].baseRevision, 11);
});

for (const ambiguity of ['network', '5xx', 'malformed-2xx']) {
  test(ambiguity + ' ambiguity followed by edit reconciles A before saving generation B', async () => {
    const mutationIds = [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    ];
    let uuidIndex = 0;
    let serverRevision = 10;
    let draftAttempts = 0;
    let assetPuts = 0;
    const mutations = new Map();
    const seenDrafts = [];
    const create = loadStorage(
      async (url, init) => {
        const href = String(url);
        if (href.includes('/assets/')) {
          assetPuts += 1;
          const bytes = new Uint8Array(init.body);
          const match = /\/([a-f0-9]{32})\.(png|wav|svg|jpg|mp3)$/.exec(href);
          const ref = {
            assetId: match[1],
            dataFormat: match[2],
            sha256: sha256(bytes),
            sizeBytes: bytes.byteLength,
          };
          return new globalThis.Response(JSON.stringify({ status: 'ok', asset: ref }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        draftAttempts += 1;
        const body = JSON.parse(init.body);
        seenDrafts.push(body);
        const replay = mutations.get(body.mutationId);
        if (replay) {
          assert.equal(body.baseRevision, replay.baseRevision);
          assert.deepEqual(body.document, replay.document);
          return new globalThis.Response(
            JSON.stringify({ status: 'ok', revision: replay.revision }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }

        assert.equal(body.baseRevision, serverRevision);
        serverRevision += 1;
        mutations.set(body.mutationId, {
          baseRevision: body.baseRevision,
          document: body.document,
          revision: serverRevision,
        });

        if (draftAttempts === 1) {
          if (ambiguity === 'network') throw new TypeError('lost response after commit');
          if (ambiguity === '5xx') {
            return new globalThis.Response(
              JSON.stringify({ error: { code: 'dependency_unavailable' } }),
              { status: 503, headers: { 'content-type': 'application/json' } },
            );
          }
          return new globalThis.Response('{malformed', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        return new globalThis.Response(JSON.stringify({ status: 'ok', revision: serverRevision }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      () => mutationIds[uuidIndex++],
    );

    const storage = create({
      projectId: PROJECT_ID,
      projectJson: null,
      assets: [],
      draftRevision: 10,
      apiOrigin: API_ORIGIN,
      getRuntimeToken: () => TOKEN,
      canSave: true,
    });
    const media = asset('e'.repeat(32), 'png', Uint8Array.from([5, 4, 3]));
    await storeAsset(storage, media);
    const generationA = project('Generation A', [media]);
    const generationB = project('Generation B', [media]);

    await assert.rejects(storage.saveProject(PROJECT_ID, JSON.stringify(generationA)));
    assert.equal(storage.getConfirmedRevision(), 10);
    assert.equal(serverRevision, 11);

    await storage.saveProject(PROJECT_ID, JSON.stringify(generationB));
    assert.equal(storage.getConfirmedRevision(), 12);
    assert.equal(serverRevision, 12);
    assert.equal(assetPuts, 1, 'reconciliation must not duplicate confirmed asset PUTs');
    assert.equal(draftAttempts, 3);
    assert.equal(seenDrafts.length, 3);
    assert.equal(seenDrafts[1].mutationId, seenDrafts[0].mutationId);
    assert.equal(seenDrafts[1].baseRevision, 10);
    assert.deepEqual(seenDrafts[1].document, seenDrafts[0].document);
    assert.notEqual(seenDrafts[2].mutationId, seenDrafts[0].mutationId);
    assert.equal(seenDrafts[2].baseRevision, 11);
    assert.equal(seenDrafts[2].document.projectJson.targets[0].name, 'Generation B');
    assert.equal(uuidIndex, 2, 'A and B must own distinct mutation identities');
  });
}

test('conflict while reconciling ambiguous A blocks generation B and preserves confirmed revision', async () => {
  const mutationIds = [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ];
  let uuidIndex = 0;
  const seenDrafts = [];
  const create = loadStorage(
    async (url, init) => {
      if (String(url).includes('/assets/')) {
        const bytes = new Uint8Array(init.body);
        const match = /\/([a-f0-9]{32})\.(png|wav|svg|jpg|mp3)$/.exec(String(url));
        return new globalThis.Response(
          JSON.stringify({
            status: 'ok',
            asset: {
              assetId: match[1],
              dataFormat: match[2],
              sha256: sha256(bytes),
              sizeBytes: bytes.byteLength,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      const body = JSON.parse(init.body);
      seenDrafts.push(body);
      if (seenDrafts.length === 1) throw new TypeError('ambiguous request outcome');
      return new globalThis.Response(
        JSON.stringify({ error: { code: 'project_revision_conflict', message: 'conflict' } }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    },
    () => mutationIds[uuidIndex++],
  );

  const storage = create({
    projectId: PROJECT_ID,
    projectJson: null,
    assets: [],
    draftRevision: 7,
    apiOrigin: API_ORIGIN,
    getRuntimeToken: () => TOKEN,
    canSave: true,
  });
  const media = asset('f'.repeat(32), 'png', Uint8Array.from([1, 3, 5]));
  await storeAsset(storage, media);

  await assert.rejects(
    storage.saveProject(PROJECT_ID, JSON.stringify(project('Generation A', [media]))),
    /draft_write_failed/,
  );
  await assert.rejects(
    storage.saveProject(PROJECT_ID, JSON.stringify(project('Generation B', [media]))),
    (error) => error?.code === 'revision_conflict',
  );

  assert.equal(storage.getConfirmedRevision(), 7);
  assert.equal(seenDrafts.length, 2, 'generation B must not be sent after reconciliation conflict');
  assert.equal(seenDrafts[1].mutationId, seenDrafts[0].mutationId);
  assert.equal(seenDrafts[1].baseRevision, 7);
  assert.deepEqual(seenDrafts[1].document, seenDrafts[0].document);
  assert.equal(uuidIndex, 1, 'generation B must not allocate a mutation id');
});

test('project revision conflict is explicit and never mutates confirmed revision', async () => {
  const calls = [];
  const create = loadStorage(
    async (url, init) => {
      calls.push({ url: String(url), init });
      return new globalThis.Response(
        JSON.stringify({
          error: { code: 'project_revision_conflict', message: 'conflict' },
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    },
    () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  );
  const storage = create({
    projectId: PROJECT_ID,
    projectJson: null,
    assets: [],
    draftRevision: 4,
    apiOrigin: API_ORIGIN,
    getRuntimeToken: () => TOKEN,
    canSave: true,
  });

  await assert.rejects(
    storage.saveProject(PROJECT_ID, JSON.stringify(project('Conflict'))),
    (error) => error?.code === 'revision_conflict',
  );
  assert.equal(storage.getConfirmedRevision(), 4);
  assert.equal(calls.length, 1);
});
