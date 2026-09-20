import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { TextDecoder, TextEncoder } from 'node:util';
import { URL } from 'node:url';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL_A = '33333333-3333-4333-8333-333333333333';
const PRINCIPAL_B = '44444444-4444-4444-8444-444444444444';

function loadRecovery(globals = {}) {
  const context = vm.createContext({
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    ...globals,
  });
  vm.runInContext(
    fs.readFileSync(
      new URL('../../infra/scratch-editor/host/recovery.js', import.meta.url),
      'utf8',
    ),
    context,
  );
  return context.AsaBlocksRecovery;
}

function createFakeIndexedDb(options = {}) {
  const databases = new Map();
  const microtask = (callback) => void Promise.resolve().then(callback);
  let putCount = 0;
  const clone = (value) => {
    if (typeof value === 'undefined' || value === null || typeof value !== 'object') return value;
    if (value instanceof Uint8Array) return Uint8Array.from(value);
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (Array.isArray(value)) return value.map(clone);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  };

  const createDatabase = () => {
    const stores = new Map();
    const database = {
      objectStoreNames: { contains: (name) => stores.has(name) },
      createObjectStore(name) {
        if (!stores.has(name)) stores.set(name, new Map());
      },
      transaction(name) {
        const data = stores.get(name);
        if (!data) throw new Error('missing_store');
        let pending = 0;
        let finished = false;
        const transaction = {
          error: null,
          oncomplete: null,
          onabort: null,
          onerror: null,
        };
        const finish = () => {
          microtask(() => {
            if (!finished && pending === 0) {
              finished = true;
              transaction.oncomplete?.();
            }
          });
        };
        const request = (operation) => {
          pending += 1;
          const result = { result: undefined, error: null, onsuccess: null, onerror: null };
          microtask(() => {
            try {
              result.result = operation();
              result.onsuccess?.();
            } catch (error) {
              result.error = error;
              transaction.error = error;
              result.onerror?.();
              transaction.onerror?.();
            } finally {
              pending -= 1;
              finish();
            }
          });
          return result;
        };
        transaction.objectStore = () => ({
          get(key) {
            return request(() => clone(data.get(key)));
          },
          put(value) {
            return request(() => {
              putCount += 1;
              if (putCount > (options.quotaAfter ?? Number.POSITIVE_INFINITY)) {
                const error = new Error('quota exceeded');
                error.name = 'QuotaExceededError';
                throw error;
              }
              data.set(value.key, clone(value));
              return value.key;
            });
          },
          delete(key) {
            return request(() => data.delete(key));
          },
          openCursor() {
            pending += 1;
            const cursorRequest = {
              result: undefined,
              error: null,
              onsuccess: null,
              onerror: null,
            };
            const keys = [...data.keys()];
            let index = 0;
            const advance = () => {
              microtask(() => {
                if (index >= keys.length) {
                  cursorRequest.result = null;
                  cursorRequest.onsuccess?.();
                  pending -= 1;
                  finish();
                  return;
                }
                const key = keys[index];
                cursorRequest.result = {
                  value: clone(data.get(key)),
                  delete: () => data.delete(key),
                  continue: () => {
                    index += 1;
                    advance();
                  },
                };
                cursorRequest.onsuccess?.();
              });
            };
            advance();
            return cursorRequest;
          },
        });
        return transaction;
      },
      close() {},
    };
    return database;
  };

  return {
    open(name) {
      const request = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };
      microtask(() => {
        let database = databases.get(name);
        const created = !database;
        if (!database) {
          database = createDatabase();
          databases.set(name, database);
        }
        request.result = database;
        if (created) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function project(marker) {
  return { targets: [], monitors: [], extensions: [], marker };
}
function recoveryRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    principalKey: PRINCIPAL_A,
    projectId: PROJECT_ID,
    baseRevision: 5,
    projectJson: project(73),
    generation: 3,
    capturedAt: 1_000,
    expiresAt: 1_000 + 7 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

function mediaAsset(overrides = {}) {
  const bytes = overrides.bytes ?? Uint8Array.from([1, 2, 3, 4]);
  return {
    assetId: 'a'.repeat(32),
    dataFormat: 'png',
    sha256: 'b'.repeat(64),
    sizeBytes: bytes.byteLength,
    bytes,
    ...overrides,
  };
}

function mediaRecoveryRecord(overrides = {}) {
  return recoveryRecord({
    schemaVersion: 2,
    assets: [mediaAsset()],
    ...overrides,
  });
}

test('IndexedDB recovery store creates, reads, replaces and deletes one principal/project record', async () => {
  const api = loadRecovery();
  const store = api.createRecoveryStore({ indexedDB: createFakeIndexedDb(), now: () => 1_000 });
  assert.ok(store);

  await store.put(recoveryRecord({ generation: 1, projectJson: project(20) }));
  assert.equal((await store.get(PRINCIPAL_A, PROJECT_ID)).generation, 1);
  assert.equal(await store.get(PRINCIPAL_B, PROJECT_ID), null);

  await store.put(recoveryRecord({ generation: 4, projectJson: project(73) }));
  const latest = await store.get(PRINCIPAL_A, PROJECT_ID);
  assert.equal(latest.generation, 4);
  assert.equal(latest.projectJson.marker, 73);
  assert.equal(JSON.stringify(latest).includes('Bearer'), false);
  assert.equal(JSON.stringify(latest).includes('runtimeToken'), false);

  assert.equal(await store.delete(PRINCIPAL_A, PROJECT_ID), true);
  assert.equal(await store.get(PRINCIPAL_A, PROJECT_ID), null);
});

test('legacy v1 recovery remains readable as schema v2 with no embedded assets', async () => {
  const api = loadRecovery();
  const store = api.createRecoveryStore({ indexedDB: createFakeIndexedDb(), now: () => 1_000 });
  await store.put(recoveryRecord());
  const record = await store.get(PRINCIPAL_A, PROJECT_ID);
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.assets.length, 0);
});

test('schema v2 stores exact binary media as Uint8Array structured-clone values', async () => {
  const api = loadRecovery();
  const store = api.createRecoveryStore({ indexedDB: createFakeIndexedDb(), now: () => 1_000 });
  const bytes = Uint8Array.from([9, 8, 7, 6, 5]);
  await store.put(
    mediaRecoveryRecord({ assets: [mediaAsset({ bytes, sizeBytes: bytes.byteLength })] }),
  );
  bytes[0] = 0;

  const record = await store.get(PRINCIPAL_A, PROJECT_ID);
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.assets.length, 1);
  assert.ok(record.assets[0].bytes instanceof Uint8Array);
  assert.deepEqual([...record.assets[0].bytes], [9, 8, 7, 6, 5]);
});

test('quota failure keeps the previous valid media recovery intact', async () => {
  const api = loadRecovery();
  const store = api.createRecoveryStore({
    indexedDB: createFakeIndexedDb({ quotaAfter: 1 }),
    now: () => 1_000,
  });
  await store.put(mediaRecoveryRecord({ generation: 1, projectJson: project(20) }));
  const states = [];
  const controller = api.createRecoveryController({
    store,
    principalKey: PRINCIPAL_A,
    projectId: PROJECT_ID,
    debounceMs: 5,
    now: () => 1_100,
    captureRecoverySnapshot: async () => ({
      projectJson: project(73),
      assets: [mediaAsset({ assetId: 'c'.repeat(32) })],
    }),
    getBaseRevision: () => 5,
    onState: (state) => states.push(state.state),
  });

  controller.schedule(2);
  await delay(20);
  const retained = await store.get(PRINCIPAL_A, PROJECT_ID);
  assert.equal(retained.generation, 1);
  assert.equal(retained.projectJson.marker, 20);
  assert.ok(states.includes('quota_exceeded'));
  controller.dispose();
});

test('media checkpoint coalesces to the latest generation and durable save removes bytes with record', async () => {
  const api = loadRecovery();
  const store = api.createRecoveryStore({ indexedDB: createFakeIndexedDb(), now: () => 1_000 });
  let marker = 10;
  let assetId = 'a'.repeat(32);
  const controller = api.createRecoveryController({
    store,
    principalKey: PRINCIPAL_A,
    projectId: PROJECT_ID,
    debounceMs: 5,
    now: () => 1_000,
    captureRecoverySnapshot: async () => ({
      projectJson: project(marker),
      assets: [mediaAsset({ assetId, bytes: Uint8Array.from([marker]) })],
    }),
    getBaseRevision: () => 5,
  });

  marker = 20;
  assetId = 'a'.repeat(32);
  controller.schedule(1);
  marker = 73;
  assetId = 'd'.repeat(32);
  controller.schedule(2);
  await delay(20);

  const record = await store.get(PRINCIPAL_A, PROJECT_ID);
  assert.equal(record.generation, 2);
  assert.equal(record.projectJson.marker, 73);
  assert.equal(record.assets.length, 1);
  assert.equal(record.assets[0].assetId, 'd'.repeat(32));
  assert.deepEqual([...record.assets[0].bytes], [73]);
  assert.equal(await controller.durable(2), true);
  assert.equal(await store.get(PRINCIPAL_A, PROJECT_ID), null);
  controller.dispose();
});

test('TTL GC removes expired recovery without a background daemon', async () => {
  let now = 1_000;
  const api = loadRecovery();
  const store = api.createRecoveryStore({ indexedDB: createFakeIndexedDb(), now: () => now });
  await store.put(recoveryRecord({ capturedAt: 100, expiresAt: 900 }));
  now = 1_001;
  assert.equal(await store.gcExpired(), 1);
  assert.equal(await store.get(PRINCIPAL_A, PROJECT_ID), null);
});
test('selection cleans stale server-equivalent recovery and retains server-ahead conflict', async () => {
  const api = loadRecovery();
  const store = api.createRecoveryStore({ indexedDB: createFakeIndexedDb(), now: () => 1_000 });

  await store.put(recoveryRecord({ projectJson: project(73) }));
  const stale = await api.selectRecovery({
    store,
    principalKey: PRINCIPAL_A,
    projectId: PROJECT_ID,
    serverRevision: 5,
    serverProjectJson: project(73),
    now: () => 1_000,
  });
  assert.equal(stale.kind, 'stale');
  assert.equal(await store.get(PRINCIPAL_A, PROJECT_ID), null);

  await store.put(recoveryRecord({ baseRevision: 5, projectJson: project(73) }));
  const conflict = await api.selectRecovery({
    store,
    principalKey: PRINCIPAL_A,
    projectId: PROJECT_ID,
    serverRevision: 6,
    serverProjectJson: project(99),
    now: () => 1_000,
  });
  assert.equal(conflict.kind, 'conflict');
  assert.equal((await store.get(PRINCIPAL_A, PROJECT_ID)).projectJson.marker, 73);
});

test('debounce coalesces rapid dirty generations and durable save clears only the latest generation', async () => {
  const api = loadRecovery();
  const store = api.createRecoveryStore({ indexedDB: createFakeIndexedDb(), now: () => 1_000 });
  let marker = 10;
  const controller = api.createRecoveryController({
    store,
    principalKey: PRINCIPAL_A,
    projectId: PROJECT_ID,
    debounceMs: 5,
    now: () => 1_000,
    captureProjectJson: () => project(marker),
    canRecoverProject: () => true,
    getBaseRevision: () => 5,
  });

  for (const [generation, value] of [
    [1, 20],
    [2, 30],
    [3, 73],
  ]) {
    marker = value;
    controller.schedule(generation);
  }
  await delay(20);
  const record = await store.get(PRINCIPAL_A, PROJECT_ID);
  assert.equal(record.generation, 3);
  assert.equal(record.projectJson.marker, 73);
  assert.equal(await controller.durable(2), false);
  assert.equal((await store.get(PRINCIPAL_A, PROJECT_ID)).generation, 3);
  assert.equal(await controller.durable(3), true);
  assert.equal(await store.get(PRINCIPAL_A, PROJECT_ID), null);
  controller.dispose();
});
test('001A refuses a checkpoint when referenced media is not already recoverable', async () => {
  const api = loadRecovery();
  const store = api.createRecoveryStore({ indexedDB: createFakeIndexedDb(), now: () => 1_000 });
  const states = [];
  const controller = api.createRecoveryController({
    store,
    principalKey: PRINCIPAL_A,
    projectId: PROJECT_ID,
    debounceMs: 5,
    now: () => 1_000,
    captureProjectJson: () => project(73),
    canRecoverProject: () => false,
    getBaseRevision: () => 5,
    onState: (state) => states.push(state.state),
  });

  controller.schedule(1);
  await delay(20);
  assert.equal(await store.get(PRINCIPAL_A, PROJECT_ID), null);
  assert.ok(states.includes('media_recovery_required'));
  controller.dispose();
});
