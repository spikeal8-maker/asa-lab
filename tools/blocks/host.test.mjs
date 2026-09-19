import assert from 'node:assert/strict';
import fs from 'node:fs';
import { URL } from 'node:url';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createHash, webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { TextEncoder, TextDecoder } from 'node:util';
import test from 'node:test';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const API_ORIGIN = 'https://asa.example';
const RUNTIME_TOKEN = 'header.payload.signature';

function loadHost(name, globals = {}) {
  const context = vm.createContext({ TextEncoder, TextDecoder, ...globals });
  vm.runInContext(
    fs.readFileSync(new URL(`../../infra/scratch-editor/host/${name}.js`, import.meta.url), 'utf8'),
    context,
  );
  return context;
}

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
      encodeDataURI: () => `data:${dataFormat};base64,fixture`,
    };
  }
  addHelper(helper) {
    this.helper = helper;
  }
}

function standaloneFixture() {
  return {
    ScratchStorage: Storage,
    buildDefaultProject: () => [
      {
        assetType: 'Project',
        dataFormat: 'JSON',
        id: 0,
        data: JSON.stringify({ targets: [], monitors: [], extensions: [] }),
      },
      {
        assetType: 'ImageVector',
        dataFormat: 'SVG',
        id: 'b'.repeat(32),
        data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      },
    ],
  };
}

function runtimeReference(bytes, overrides = {}) {
  return {
    assetId: 'a'.repeat(32),
    dataFormat: 'svg',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
    ...overrides,
  };
}

function runtimeProject(reference) {
  return {
    targets: [
      {
        isStage: true,
        name: 'Stage',
        costumes: [
          {
            assetId: reference.assetId,
            name: 'Server Costume',
            bitmapResolution: 1,
            md5ext: `${reference.assetId}.${reference.dataFormat}`,
            dataFormat: reference.dataFormat,
            rotationCenterX: 50,
            rotationCenterY: 50,
          },
        ],
        sounds: [],
      },
    ],
    monitors: [],
    extensions: [],
  };
}

function createRuntimeStorage({
  status = 200,
  contentType = 'image/svg+xml',
  bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  responseBytes = bytes,
  referenceOverrides = {},
  token = RUNTIME_TOKEN,
} = {}) {
  const calls = [];
  const reference = runtimeReference(bytes, referenceOverrides);
  const fetchMock = async (url, init) => {
    calls.push({ url, init });
    return new globalThis.Response(responseBytes, {
      status,
      headers: { 'content-type': contentType },
    });
  };
  const api = loadHost('storage', {
    fetch: fetchMock,
    crypto: webcrypto,
    AbortController: globalThis.AbortController,
  }).AsaBlocksStorage;
  const storage = api.createReadOnlyStorage(standaloneFixture(), {
    projectId: PROJECT_ID,
    projectJson: runtimeProject(reference),
    assets: [reference],
    apiOrigin: API_ORIGIN,
    getRuntimeToken: () => token,
  });
  return { storage, calls, reference };
}

test('new project storage keeps the default project local and remains read-only', async () => {
  const calls = [];
  const api = loadHost('storage', {
    fetch: async (url) => {
      calls.push(url);
      return new globalThis.Response(null, { status: 404 });
    },
  }).AsaBlocksStorage;
  const storage = api.createReadOnlyStorage(standaloneFixture(), {
    projectId: PROJECT_ID,
    projectJson: null,
    assets: [],
    apiOrigin: API_ORIGIN,
    getRuntimeToken: () => RUNTIME_TOKEN,
  });
  const readProject = (id) =>
    storage.scratchStorage.helper.load(
      storage.scratchStorage.AssetType.Project,
      id,
      storage.scratchStorage.DataFormat.JSON,
    );

  assert.ok(await readProject('0'));
  assert.equal(await readProject(PROJECT_ID), null);
  assert.equal(storage.getLibraryAssetUrl('b'.repeat(32), 'svg'), 'data:svg;base64,fixture');
  assert.throws(() => storage.getLibraryAssetUrl('unknown', 'svg'), /runtime_asset_unavailable/);
  await assert.rejects(storage.saveProject(), /runtime_storage_read_only/);
  assert.equal(storage.cloudVariables, undefined);
  assert.equal(storage.backpackStorage, undefined);
  assert.deepEqual(calls, []);
});

test('declared runtime asset GET uses current Bearer without cookies or URL capability and preserves bytes', async () => {
  const bytes = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
  );
  const { storage, calls, reference } = createRuntimeStorage({ bytes });
  await storage.prepareProjectAssets();

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `${API_ORIGIN}/api/blocks/runtime/projects/${PROJECT_ID}/assets/${reference.assetId}.svg`,
  );
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${RUNTIME_TOKEN}`);
  assert.equal(calls[0].url.includes(RUNTIME_TOKEN), false);
  assert.equal('cookie' in calls[0].init.headers, false);

  const loaded = await storage.scratchStorage.helper.load(
    storage.scratchStorage.AssetType.ImageVector,
    reference.assetId,
    'svg',
  );
  assert.deepEqual(Buffer.from(loaded.data), Buffer.from(bytes));
  assert.equal(calls.length, 1, 'verified runtime bytes are cached without a second GET');
});

test('confirmed stock/default identity with missing durable object fails closed without stock fallback', async () => {
  const stockId = 'b'.repeat(32);
  const { storage, calls } = createRuntimeStorage({
    status: 404,
    referenceOverrides: { assetId: stockId },
  });
  assert.throws(() => storage.getLibraryAssetUrl(stockId, 'svg'), /runtime_asset_unavailable/);
  await assert.rejects(storage.prepareProjectAssets(), /runtime_asset_unavailable/);
  assert.equal(calls.length, 1, 'confirmed stock identity must still perform runtime GET');
  assert.throws(() => storage.getLibraryAssetUrl(stockId, 'svg'), /runtime_asset_unavailable/);
});

test('confirmed stock/default identity with corrupt same-size runtime bytes fails SHA verification closed', async () => {
  const stockId = 'b'.repeat(32);
  const bytes = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9"/></svg>',
  );
  const corrupt = Uint8Array.from(bytes);
  corrupt[corrupt.length - 2] ^= 1;
  const { storage, calls } = createRuntimeStorage({
    bytes,
    responseBytes: corrupt,
    referenceOverrides: { assetId: stockId },
  });
  await assert.rejects(storage.prepareProjectAssets(), /runtime_asset_unavailable/);
  assert.equal(calls.length, 1);
  assert.throws(() => storage.getLibraryAssetUrl(stockId, 'svg'), /runtime_asset_unavailable/);
});

test('confirmed stock/default identity verifies runtime bytes once then reuses only verified runtime cache', async () => {
  const stockId = 'b'.repeat(32);
  const bytes = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="7" r="3"/></svg>',
  );
  const { storage, calls } = createRuntimeStorage({
    bytes,
    referenceOverrides: { assetId: stockId },
  });
  assert.throws(() => storage.getLibraryAssetUrl(stockId, 'svg'), /runtime_asset_unavailable/);
  await storage.prepareProjectAssets();
  assert.equal(calls.length, 1, 'fresh confirmed asset must be verified through runtime GET');

  const loaded = await storage.scratchStorage.helper.load(
    storage.scratchStorage.AssetType.ImageVector,
    stockId,
    'svg',
  );
  assert.deepEqual(Buffer.from(loaded.data), Buffer.from(bytes));
  assert.equal(calls.length, 1, 'verified runtime asset may be reused inside the same session');
  assert.equal(storage.getLibraryAssetUrl(stockId, 'svg'), 'data:svg;base64,fixture');
});

for (const status of [401, 403, 404, 503]) {
  test(`runtime asset HTTP ${status} fails project preparation closed`, async () => {
    const { storage } = createRuntimeStorage({ status });
    await assert.rejects(storage.prepareProjectAssets(), /runtime_asset_unavailable/);
  });
}

for (const [name, options] of [
  ['sha mismatch', { referenceOverrides: { sha256: '0'.repeat(64) } }],
  ['size mismatch', { referenceOverrides: { sizeBytes: 1 } }],
  ['content-type mismatch', { contentType: 'text/html' }],
]) {
  test(`runtime asset ${name} fails project preparation closed`, async () => {
    const { storage } = createRuntimeStorage(options);
    await assert.rejects(storage.prepareProjectAssets(), /runtime_asset_unavailable/);
  });
}

test('non-declared asset never receives a runtime asset URL and may only use the local stock path', async () => {
  const calls = [];
  const api = loadHost('storage', {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new globalThis.Response(null, { status: 404 });
    },
  }).AsaBlocksStorage;
  const storage = api.createReadOnlyStorage(standaloneFixture(), {
    projectId: PROJECT_ID,
    projectJson: null,
    assets: [],
    apiOrigin: API_ORIGIN,
    getRuntimeToken: () => RUNTIME_TOKEN,
  });
  const unknown = 'c'.repeat(32);
  const loaded = await storage.scratchStorage.helper.load(
    storage.scratchStorage.AssetType.ImageVector,
    unknown,
    'svg',
  );
  assert.equal(loaded, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `/library-assets/${unknown}.svg`);
  assert.equal(String(calls[0].url).startsWith(API_ORIGIN), false);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.headers, undefined);
});

async function editorFixture(hasProjectJson = false, mode = 'editor') {
  const machine = new EventEmitter();
  let stops = 0;
  let quits = 0;
  let unmounts = 0;
  let ready = 0;
  let prepared = 0;
  let disposedStorage = 0;
  let props;
  let params;
  let requestedId;
  const storage = {
    async prepareProjectAssets() {
      prepared++;
    },
    dispose() {
      disposedStorage++;
    },
  };
  machine.stopAll = () => {
    stops++;
  };
  machine.quit = () => {
    quits++;
  };
  const standalone = {
    EditorState: class {
      constructor(options, factory) {
        params = options;
        assert.equal(factory().storage, storage);
      }
      dispatch(action) {
        requestedId = action.projectId;
      }
    },
    setProjectId: (projectId) => ({ projectId }),
    setAppElement() {},
    createStandaloneRoot: () => ({
      render(value) {
        props = value;
        value.onVmInit(machine);
      },
      unmount() {
        unmounts++;
      },
    }),
  };
  const shell = { dataset: {} };
  const api = loadHost('editor', {
    AsaBlocksStorage: {
      createReadOnlyStorage: () => storage,
    },
  }).AsaBlocksEditor;
  const bootstrap = {
    apiOrigin: API_ORIGIN,
    draftRevision: 7,
    projectJson: hasProjectJson ? { targets: [], monitors: [], extensions: [] } : null,
    hasProjectJson,
    assets: [],
  };
  const editor = api.mountEditor({
    standalone,
    container: {},
    shell,
    session: { mode, projectId: PROJECT_ID },
    bootstrap,
    getRuntimeToken: () => RUNTIME_TOKEN,
    onReady() {
      ready++;
    },
  });
  await editor.startup;
  return {
    machine,
    shell,
    editor,
    props,
    params,
    requestedId,
    counts: () => ({ stops, quits, unmounts, ready, prepared, disposedStorage }),
  };
}

test('new project mount uses Scratch default project and preserves native editor events', async () => {
  const fixture = await editorFixture();
  assert.equal('projectId' in fixture.props, false);
  assert.equal(fixture.props.canSave, false);
  assert.equal(fixture.props.logo, '/asa-lab-scratch-wordmark.svg');
  assert.equal(fixture.requestedId, '0');
  assert.equal(fixture.shell.dataset.projectSource, 'new-default');
  assert.equal(fixture.shell.dataset.draftRevision, '7');
  assert.equal(fixture.params.isEmbedded, undefined);
  assert.equal(fixture.params.locale, undefined);
  fixture.machine.emit('PROJECT_CHANGED');
  assert.equal(fixture.shell.dataset.projectChanges, '0');
  fixture.props.onProjectLoaded();
  fixture.machine.emit('PROJECT_CHANGED');
  assert.equal(fixture.shell.dataset.projectChanges, '1');
  fixture.machine.emit('PROJECT_RUN_START');
  assert.equal(fixture.shell.dataset.projectRunning, 'true');
  fixture.machine.emit('PROJECT_RUN_STOP');
  assert.equal(fixture.shell.dataset.projectRunning, 'false');
  assert.equal(fixture.counts().prepared, 0);
});

test('existing project mount preloads runtime assets and uses the real ASA projectId, never a fixture ID', async () => {
  const fixture = await editorFixture(true, 'player');
  assert.equal(fixture.props.projectId, PROJECT_ID);
  assert.equal(fixture.params.isPlayerOnly, true);
  assert.equal(fixture.shell.dataset.projectSource, 'runtime-session');
  assert.equal(fixture.counts().prepared, 1);
  fixture.editor.dispose();
  fixture.editor.dispose();
  fixture.props.onProjectLoaded();
  fixture.machine.emit('PROJECT_CHANGED');
  assert.equal(fixture.shell.dataset.editorState, 'disposed');
  assert.equal(fixture.shell.dataset.projectChanges, '0');
  assert.equal(fixture.machine.listenerCount('PROJECT_CHANGED'), 0);
  assert.deepEqual(fixture.counts(), {
    stops: 2,
    quits: 2,
    unmounts: 1,
    ready: 0,
    prepared: 1,
    disposedStorage: 1,
  });
});

function snapshotAsset(assetId, dataFormat, bytes) {
  return {
    assetId,
    dataFormat,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  };
}

function createPersistenceStorage({
  bootstrapAssets = [],
  assetStatus = 200,
  draftStatus = 200,
  assetPayload,
  draftPayload,
  assetNetworkFailure = false,
  draftNetworkFailure = false,
} = {}) {
  const calls = [];
  const fetchMock = async (url, init) => {
    const href = String(url);
    if (href.endsWith('/draft')) {
      calls.push({ kind: 'draft', url: href, init, body: JSON.parse(init.body) });
      if (draftNetworkFailure) throw new TypeError('draft network');
      const responseBody =
        typeof draftPayload === 'function'
          ? draftPayload(calls.at(-1))
          : (draftPayload ?? { status: 'ok', revision: 8 });
      return new globalThis.Response(JSON.stringify(responseBody), {
        status: draftStatus,
        headers: { 'content-type': 'application/json' },
      });
    }
    calls.push({ kind: 'asset', url: href, init });
    if (assetNetworkFailure) throw new TypeError('asset network');
    const match = /\/assets\/([a-f0-9]{32})\.(svg|png|jpg|wav|mp3)$/.exec(href);
    const bytes = new Uint8Array(init.body);
    const reference = {
      assetId: match?.[1],
      dataFormat: match?.[2],
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.byteLength,
    };
    const responseBody =
      typeof assetPayload === 'function'
        ? assetPayload(reference)
        : (assetPayload ?? { status: 'ok', asset: reference });
    return new globalThis.Response(JSON.stringify(responseBody), {
      status: assetStatus,
      headers: { 'content-type': 'application/json' },
    });
  };
  const api = loadHost('storage', {
    fetch: fetchMock,
    crypto: webcrypto,
    AbortController: globalThis.AbortController,
  }).AsaBlocksStorage;
  const storage = api.createReadOnlyStorage(standaloneFixture(), {
    projectId: PROJECT_ID,
    projectJson: null,
    assets: bootstrapAssets,
    draftRevision: 7,
    apiOrigin: API_ORIGIN,
    getRuntimeToken: () => RUNTIME_TOKEN,
  });
  return { storage, calls };
}

test('explicit persistence uploads only changed assets before canonical draft and confirms revision', async () => {
  const unchangedBytes = Uint8Array.from([1, 2, 3]);
  const newBytes = Uint8Array.from([4, 5, 6, 7]);
  const staleBytes = Uint8Array.from([8, 9]);
  const unchanged = snapshotAsset('a'.repeat(32), 'png', unchangedBytes);
  const added = snapshotAsset('b'.repeat(32), 'wav', newBytes);
  const stale = snapshotAsset('c'.repeat(32), 'svg', staleBytes);
  const { storage, calls } = createPersistenceStorage({
    bootstrapAssets: [
      {
        assetId: unchanged.assetId,
        dataFormat: unchanged.dataFormat,
        sha256: unchanged.sha256,
        sizeBytes: unchanged.sizeBytes,
      },
      {
        assetId: stale.assetId,
        dataFormat: stale.dataFormat,
        sha256: stale.sha256,
        sizeBytes: stale.sizeBytes,
      },
    ],
  });
  const projectJson = {
    targets: [{ name: 'Live VM', costumes: [], sounds: [] }],
    monitors: [],
    extensions: [],
  };

  const revision = await storage.persistSnapshot({
    projectJson,
    assets: [unchanged, added],
  });

  assert.equal(revision, 8);
  assert.equal(storage.getConfirmedRevision(), 8);
  assert.deepEqual(
    calls.map((call) => call.kind),
    ['asset', 'draft'],
    'all required assets must be durable before draft PUT',
  );
  const assetCall = calls[0];
  assert.match(assetCall.url, new RegExp(`/${added.assetId}\\.wav$`));
  assert.equal(assetCall.init.credentials, 'omit');
  assert.equal(assetCall.init.redirect, 'error');
  assert.equal(assetCall.init.headers.authorization, `Bearer ${RUNTIME_TOKEN}`);
  assert.equal(assetCall.init.headers['content-type'], 'audio/wav');
  assert.equal(assetCall.url.includes(RUNTIME_TOKEN), false);
  assert.equal('cookie' in assetCall.init.headers, false);
  assert.deepEqual(Buffer.from(assetCall.init.body), Buffer.from(newBytes));

  const draftCall = calls[1];
  assert.equal(draftCall.init.credentials, 'omit');
  assert.equal(draftCall.init.redirect, 'error');
  assert.equal(draftCall.init.headers.authorization, `Bearer ${RUNTIME_TOKEN}`);
  assert.equal(draftCall.init.headers['content-type'], 'application/vnd.asa.blocks-draft+json');
  assert.equal(draftCall.url.includes(RUNTIME_TOKEN), false);
  assert.equal(draftCall.body.baseRevision, 7);
  assert.match(draftCall.body.mutationId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(draftCall.body.document.projectJson, projectJson);
  assert.deepEqual(draftCall.body.document.assets, [
    {
      assetId: unchanged.assetId,
      dataFormat: unchanged.dataFormat,
      sha256: unchanged.sha256,
      sizeBytes: unchanged.sizeBytes,
    },
    {
      assetId: added.assetId,
      dataFormat: added.dataFormat,
      sha256: added.sha256,
      sizeBytes: added.sizeBytes,
    },
  ]);
  assert.equal(
    draftCall.body.document.assets.some((reference) => reference.assetId === stale.assetId),
    false,
    'bootstrap assets no longer referenced by live JSON must not survive the draft',
  );
});

for (const status of [400, 401, 403, 409, 429, 503]) {
  test(`asset PUT HTTP ${status} fails closed before draft PUT`, async () => {
    const asset = snapshotAsset('d'.repeat(32), 'png', Uint8Array.from([10, 11, 12]));
    const { storage, calls } = createPersistenceStorage({ assetStatus: status });
    await assert.rejects(
      storage.persistSnapshot({ projectJson: { targets: [] }, assets: [asset] }),
      /asset_write_failed/,
    );
    assert.equal(calls.filter((call) => call.kind === 'draft').length, 0);
    assert.equal(storage.getConfirmedRevision(), 7);
  });
}

test('asset PUT network and canonical-reference mismatch fail closed before draft PUT', async () => {
  const asset = snapshotAsset('e'.repeat(32), 'svg', new TextEncoder().encode('<svg/>'));
  for (const options of [
    { assetNetworkFailure: true },
    {
      assetPayload: (reference) => ({
        status: 'ok',
        asset: { ...reference, sha256: '0'.repeat(64) },
      }),
    },
    { assetPayload: { status: 'ok' } },
  ]) {
    const { storage, calls } = createPersistenceStorage(options);
    await assert.rejects(
      storage.persistSnapshot({ projectJson: { targets: [] }, assets: [asset] }),
      /asset_write_failed|asset_reference_mismatch/,
    );
    assert.equal(calls.filter((call) => call.kind === 'draft').length, 0);
    assert.equal(storage.getConfirmedRevision(), 7);
  }
});

for (const status of [400, 401, 403, 409, 429, 503]) {
  test(`draft PUT HTTP ${status} never advances confirmed revision`, async () => {
    const asset = snapshotAsset('f'.repeat(32), 'png', Uint8Array.from([13, 14, 15]));
    const { storage, calls } = createPersistenceStorage({ draftStatus: status });
    await assert.rejects(
      storage.persistSnapshot({ projectJson: { targets: [] }, assets: [asset] }),
      /draft_write_failed/,
    );
    assert.equal(calls.filter((call) => call.kind === 'asset').length, 1);
    assert.equal(calls.filter((call) => call.kind === 'draft').length, 1);
    assert.equal(storage.getConfirmedRevision(), 7);
  });
}

test('draft network and malformed success never advance confirmed revision', async () => {
  const asset = snapshotAsset('1'.repeat(32), 'png', Uint8Array.from([16, 17, 18]));
  for (const options of [
    { draftNetworkFailure: true },
    { draftPayload: { status: 'ok' } },
    { draftPayload: { status: 'ok', revision: 7 } },
    { draftPayload: { status: 'nope', revision: 8 } },
  ]) {
    const { storage } = createPersistenceStorage(options);
    await assert.rejects(
      storage.persistSnapshot({ projectJson: { targets: [] }, assets: [asset] }),
      /draft_write_failed|draft_revision_invalid/,
    );
    assert.equal(storage.getConfirmedRevision(), 7);
  }
});

test('editor FLUSH captures current vm.toJSON and exact referenced vm asset bytes', async () => {
  const bytes = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>',
  );
  const assetId = '2'.repeat(32);
  let props;
  let captured;
  let resolveSave;
  const saveResult = new Promise((resolve) => {
    resolveSave = resolve;
  });
  const storage = {
    async prepareProjectAssets() {},
    async persistSnapshot(snapshot) {
      captured = snapshot;
      return saveResult;
    },
    dispose() {},
  };
  const machine = new EventEmitter();
  machine.assets = [{ assetId, dataFormat: 'svg', data: bytes }];
  machine.toJSON = () =>
    JSON.stringify({
      targets: [
        {
          name: 'Live Changed Sprite',
          costumes: [
            {
              assetId,
              dataFormat: 'svg',
              md5ext: `${assetId}.svg`,
            },
          ],
          sounds: [],
        },
      ],
      monitors: [],
      extensions: [],
    });
  machine.stopAll = () => {};
  machine.quit = () => {};
  const standalone = {
    EditorState: class {
      dispatch() {}
    },
    setProjectId: (projectId) => ({ projectId }),
    setAppElement() {},
    createStandaloneRoot: () => ({
      render(value) {
        props = value;
        value.onVmInit(machine);
      },
      unmount() {},
    }),
  };
  const shell = { dataset: {} };
  const api = loadHost('editor', {
    crypto: webcrypto,
    AsaBlocksStorage: { createReadOnlyStorage: () => storage },
  }).AsaBlocksEditor;
  const editor = api.mountEditor({
    standalone,
    container: {},
    shell,
    session: { mode: 'editor', projectId: PROJECT_ID },
    bootstrap: {
      apiOrigin: API_ORIGIN,
      draftRevision: 7,
      projectJson: null,
      hasProjectJson: false,
      assets: [],
    },
    getRuntimeToken: () => RUNTIME_TOKEN,
    onReady() {},
  });
  await editor.startup;
  props.onProjectLoaded();

  const first = editor.flush();
  const concurrent = await editor.flush();
  assert.equal(concurrent.ok, false);
  assert.equal(concurrent.reason, 'save_in_progress');
  resolveSave(8);
  const saved = await first;
  assert.equal(saved.ok, true);
  assert.equal(saved.revision, 8);
  assert.equal(shell.dataset.draftRevision, '8');
  assert.equal(captured.projectJson.targets[0].name, 'Live Changed Sprite');
  assert.equal(captured.assets.length, 1);
  assert.equal(captured.assets[0].assetId, assetId);
  assert.equal(captured.assets[0].dataFormat, 'svg');
  assert.deepEqual(Buffer.from(captured.assets[0].bytes), Buffer.from(bytes));
  assert.equal(captured.assets[0].sizeBytes, bytes.byteLength);
  assert.equal(captured.assets[0].sha256, createHash('sha256').update(bytes).digest('hex'));
});

test('editor FLUSH fails when live project references bytes unavailable from the VM', async () => {
  const assetId = '3'.repeat(32);
  let props;
  let persisted = false;
  const machine = new EventEmitter();
  machine.assets = [];
  machine.toJSON = () =>
    JSON.stringify({
      targets: [
        {
          costumes: [{ assetId, dataFormat: 'png', md5ext: `${assetId}.png` }],
          sounds: [],
        },
      ],
      monitors: [],
      extensions: [],
    });
  machine.stopAll = () => {};
  machine.quit = () => {};
  const api = loadHost('editor', {
    crypto: webcrypto,
    AsaBlocksStorage: {
      createReadOnlyStorage: () => ({
        async prepareProjectAssets() {},
        async persistSnapshot() {
          persisted = true;
          return 8;
        },
        dispose() {},
      }),
    },
  }).AsaBlocksEditor;
  const editor = api.mountEditor({
    standalone: {
      EditorState: class {
        dispatch() {}
      },
      setProjectId: (projectId) => ({ projectId }),
      setAppElement() {},
      createStandaloneRoot: () => ({
        render(value) {
          props = value;
          value.onVmInit(machine);
        },
        unmount() {},
      }),
    },
    container: {},
    shell: { dataset: {} },
    session: { mode: 'editor', projectId: PROJECT_ID },
    bootstrap: {
      apiOrigin: API_ORIGIN,
      draftRevision: 7,
      projectJson: null,
      hasProjectJson: false,
      assets: [],
    },
    getRuntimeToken: () => RUNTIME_TOKEN,
    onReady() {},
  });
  await editor.startup;
  props.onProjectLoaded();
  const failed = await editor.flush();
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'asset_capture_failed');
  assert.equal(persisted, false);
});

function protocolHarness() {
  const handlers = new Map();
  const parent = {};
  const calls = [];
  const rejections = [];
  const api = loadHost('protocol', {
    URL,
    window: {
      addEventListener: (event, handler) => handlers.set(event, handler),
      removeEventListener: (event) => handlers.delete(event),
    },
  }).AsaBlocksProtocol;
  const protocol = api.createChildProtocol({
    parentWindow: parent,
    expectedParentOrigin: API_ORIGIN,
    onInit: (...args) => calls.push(args),
    onRejected: (reason) => rejections.push(reason),
  });
  protocol.start();
  return { handlers, parent, calls, rejections, protocol };
}

function validInitMessage(overrides = {}) {
  return {
    messageType: 'ASA_BLOCKS_INIT',
    protocolVersion: 1,
    mode: 'editor',
    projectId: PROJECT_ID,
    sessionNonce: 'nonce',
    runtimeToken: RUNTIME_TOKEN,
    draftRevision: 4,
    projectJson: {
      targets: [{ costumes: [], sounds: [] }],
      monitors: [],
      extensions: [],
    },
    hasProjectJson: true,
    assets: [],
    apiOrigin: API_ORIGIN,
    recoveryNamespace: 'fixture-c',
    ...overrides,
  };
}

test('accepted child INIT exposes validated bootstrap but keeps capability protocol-owned memory only', () => {
  const { handlers, parent, calls, protocol } = protocolHarness();
  const message = validInitMessage();
  handlers.get('message')({ source: {}, origin: API_ORIGIN, data: message });
  assert.equal(calls.length, 0);
  handlers.get('message')({ source: parent, origin: API_ORIGIN, data: message });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].runtimeToken, undefined);
  assert.equal(calls[0][1].apiOrigin, API_ORIGIN);
  assert.equal(calls[0][1].draftRevision, 4);
  assert.equal(calls[0][1].hasProjectJson, true);
  assert.equal(JSON.stringify(calls[0]).includes(RUNTIME_TOKEN), false);
  assert.equal(protocol.getRuntimeToken(), RUNTIME_TOKEN);

  handlers.get('message')({
    source: parent,
    origin: API_ORIGIN,
    data: {
      messageType: 'ASA_BLOCKS_TOKEN_UPDATE',
      protocolVersion: 1,
      projectId: PROJECT_ID,
      sessionNonce: 'nonce',
      runtimeToken: 'rotated.payload.signature',
    },
  });
  assert.equal(protocol.getRuntimeToken(), 'rotated.payload.signature');
  protocol.dispose();
  assert.equal(protocol.getRuntimeToken(), null);
});

for (const [name, override] of [
  ['untrusted api origin', { apiOrigin: 'https://evil.example' }],
  ['hasProjectJson mismatch', { projectJson: null, hasProjectJson: true }],
  ['malformed assets', { assets: [{ assetId: 'bad' }] }],
  [
    'undeclared project media',
    {
      projectJson: {
        targets: [
          {
            costumes: [
              {
                assetId: 'd'.repeat(32),
                dataFormat: 'svg',
                md5ext: `${'d'.repeat(32)}.svg`,
              },
            ],
            sounds: [],
          },
        ],
        monitors: [],
        extensions: [],
      },
      assets: [],
    },
  ],
]) {
  test(`child INIT rejects ${name} fail closed`, () => {
    const { handlers, parent, calls, rejections } = protocolHarness();
    handlers.get('message')({
      source: parent,
      origin: API_ORIGIN,
      data: validInitMessage(override),
    });
    assert.equal(calls.length, 0);
    assert.ok(rejections.includes('bootstrap'));
  });
}

for (const [query, mode, delegated] of [
  ['?asaStatus=parent', 'editor', true],
  ['', 'editor', false],
  ['?asaStatus=unknown', 'editor', false],
  ['?asaStatus=parent', 'player', false],
]) {
  test(`status delegation is opt-in after trusted INIT: ${query} / ${mode}`, async () => {
    const shell = { dataset: {} };
    const status = { hidden: false, textContent: '' };
    let handlers;
    const root = {};
    loadHost('main', {
      URL,
      window: {
        parent: {},
        location: { href: `https://scratch.example/${query}` },
        addEventListener() {},
      },
      document: {
        querySelector: (selector) =>
          selector === '[data-asa-host-shell]' ? shell : { getAttribute: () => API_ORIGIN },
        getElementById: (id) => (id === 'runtime-status' ? status : root),
      },
      GUI: Object.fromEntries(
        [
          'EditorState',
          'createStandaloneRoot',
          'setAppElement',
          'ScratchStorage',
          'buildDefaultProject',
          'setProjectId',
        ].map((name) => [name, () => {}]),
      ),
      AsaBlocksProtocol: {
        createChildProtocol: (options) => {
          handlers = options;
          return {
            start() {},
            getBinding() {
              return {};
            },
            getRuntimeToken() {
              return RUNTIME_TOKEN;
            },
          };
        },
      },
      AsaBlocksStatus: { createStatusReporter: () => ({ status() {} }) },
      AsaBlocksEditor: {
        mountEditor: ({ onReady }) => {
          onReady();
          return { dispose() {}, startup: Promise.resolve() };
        },
      },
    });
    assert.equal(status.hidden, false, 'URL alone must not hide setup/error messages');
    handlers.onInit(
      { mode },
      {
        apiOrigin: API_ORIGIN,
        draftRevision: 0,
        projectJson: null,
        hasProjectJson: false,
        assets: [],
      },
    );
    await Promise.resolve();
    assert.equal(status.hidden, delegated);
    assert.match(status.textContent, /Учебный проект готов/);
  });
}
