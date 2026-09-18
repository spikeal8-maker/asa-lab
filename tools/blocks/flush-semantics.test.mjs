import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';
import { URL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

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
      encodeDataURI: () => 'data:fixture',
    };
  }
  addHelper(helper) {
    this.helper = helper;
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
const project = (name, extra = {}) => ({
  targets: [{ name, costumes: [], sounds: [], ...extra }],
  monitors: [],
  extensions: [],
});

function loadStorage(fetchMock, randomUUID) {
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
  return context.AsaBlocksStorage.createReadOnlyStorage;
}

test('canonical fingerprint ignores object-key and asset ordering and unchanged FLUSH writes nothing', async () => {
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
  const bytesA = Uint8Array.from([1, 2]);
  const bytesB = Uint8Array.from([3, 4]);
  const a = asset('a'.repeat(32), 'png', bytesA);
  const b = asset('b'.repeat(32), 'wav', bytesB);
  const bootstrapJson = {
    extensions: [],
    monitors: [],
    targets: [{ sounds: [], costumes: [], name: 'Same' }],
  };
  const storage = create(standalone, {
    projectId: PROJECT_ID,
    projectJson: bootstrapJson,
    assets: [reference(b), reference(a)],
    draftRevision: 5,
    apiOrigin: API_ORIGIN,
    getRuntimeToken: () => TOKEN,
  });
  const reordered = {
    targets: [{ name: 'Same', costumes: [], sounds: [] }],
    monitors: [],
    extensions: [],
  };
  const revision = await storage.persistSnapshot({
    projectJson: reordered,
    assets: [a, b],
  });
  assert.equal(revision, 5);
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
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
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

  const storage = create(standalone, {
    projectId: PROJECT_ID,
    projectJson: null,
    assets: [],
    draftRevision: 10,
    apiOrigin: API_ORIGIN,
    getRuntimeToken: () => TOKEN,
  });
  const media = asset('d'.repeat(32), 'png', Uint8Array.from([9, 8, 7]));
  const snapshot = { projectJson: project('Changed'), assets: [media] };

  await assert.rejects(storage.persistSnapshot(snapshot), /draft_write_failed/);
  assert.equal(serverRevision, 11);
  assert.equal(assetPuts, 1);
  assert.equal(storage.getConfirmedRevision(), 10);

  const revision = await storage.persistSnapshot(snapshot);
  assert.equal(revision, 11);
  assert.equal(serverRevision, 11);
  assert.equal(assetPuts, 1, 'confirmed durable asset must not be uploaded again');
  assert.equal(draftAttempts, 2);
  assert.equal(seenDrafts[0].mutationId, seenDrafts[1].mutationId);
  assert.equal(seenDrafts[0].baseRevision, 10);
  assert.equal(seenDrafts[1].baseRevision, 10);
  assert.equal(uuidIndex, 1, 'one serialized document generation owns one mutation id');

  const callsBeforeNoop = { assetPuts, draftAttempts, uuidIndex };
  assert.equal(await storage.persistSnapshot(snapshot), 11);
  assert.deepEqual({ assetPuts, draftAttempts, uuidIndex }, callsBeforeNoop);

  const edited = { projectJson: project('Changed again'), assets: [media] };
  assert.equal(await storage.persistSnapshot(edited), 12);
  assert.equal(serverRevision, 12);
  assert.equal(assetPuts, 1);
  assert.equal(draftAttempts, 3);
  assert.notEqual(seenDrafts[2].mutationId, seenDrafts[1].mutationId);
  assert.equal(seenDrafts[2].baseRevision, 11);
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
  const storage = create(standalone, {
    projectId: PROJECT_ID,
    projectJson: null,
    assets: [],
    draftRevision: 4,
    apiOrigin: API_ORIGIN,
    getRuntimeToken: () => TOKEN,
  });
  await assert.rejects(
    storage.persistSnapshot({ projectJson: project('Conflict'), assets: [] }),
    (error) => error?.code === 'revision_conflict',
  );
  assert.equal(storage.getConfirmedRevision(), 4);
  assert.equal(calls.length, 1);
});
