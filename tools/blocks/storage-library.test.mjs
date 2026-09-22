import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { URL } from 'node:url';
import { TextEncoder, TextDecoder } from 'node:util';
import { createHash, webcrypto } from 'node:crypto';

const hash = '0123456789abcdef0123456789abcdef';
function fixture(fetch, options = {}) {
  class Storage {
    AssetType = Object.fromEntries(
      ['Project', 'ImageVector', 'ImageBitmap', 'Sound'].map((name) => [name, { name }]),
    );
    DataFormat = { JSON: 'json', SVG: 'svg', PNG: 'png', JPG: 'jpg', WAV: 'wav', MP3: 'mp3' };
    createAsset(assetType, dataFormat, data, assetId) {
      return {
        assetType,
        dataFormat,
        data,
        assetId,
        clean: true,
        encodeDataURI: () => 'data:cached',
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
  const context = vm.createContext({ TextEncoder, TextDecoder, fetch, crypto: webcrypto });
  vm.runInContext(
    fs.readFileSync(new URL('../../infra/scratch-editor/host/storage.js', import.meta.url), 'utf8'),
    context,
  );
  const result = context.AsaBlocksStorage.createReadOnlyStorage(
    {
      ScratchStorage: Storage,
      buildDefaultProject: () => [
        {
          assetType: 'Project',
          dataFormat: 'JSON',
          id: 0,
          data: JSON.stringify({ targets: [], monitors: [], extensions: [] }),
        },
        ...(options.defaultAssets ?? []),
      ],
    },
    {
      projectId: '11111111-1111-4111-8111-111111111111',
      projectJson: options.projectJson ?? null,
      assets: options.assets ?? [],
      apiOrigin: 'https://asa.example',
      getRuntimeToken: () => 'fixture.runtime.token',
    },
  );
  result.load = (type, id, format) =>
    result.scratchStorage.helper.load(result.scratchStorage.AssetType[type], id, format);
  return result;
}
test('project IDs, traversal, invalid formats and type mismatches never reach fetch', async () => {
  const requests = [];
  const storage = fixture(async (url) => {
    requests.push(url);
    throw new Error('unexpected fetch');
  });
  for (const id of [
    hash,
    'unavailable-fixture',
    '../index',
    '%2e%2e%2findex',
    'https://example.com/a',
    `${hash}?x=1`,
  ]) {
    assert.equal(await storage.load('Project', id, 'json'), null);
  }
  for (const [type, id, format] of [
    ['ImageVector', '../index', 'svg'],
    ['ImageVector', hash, 'json'],
    ['ImageVector', hash, 'png'],
    ['Sound', hash, 'svg'],
    ['ImageBitmap', hash, 'svg'],
    ['ImageVector', hash, '__proto__'],
  ])
    assert.equal(await storage.load(type, id, format), null);
  assert.ok(await storage.load('Project', '11111111-1111-4111-8111-111111111111', 'json'));
  assert.ok(await storage.load('Project', '0', 'json'));
  assert.deepEqual(requests, []);
  for (const id of ['unknown', '../index', '%2findex', `${hash}?x=1`]) {
    assert.throws(() => storage.getLibraryAssetUrl(id, 'svg'), /runtime_asset_unavailable/);
  }
  assert.throws(() => storage.getLibraryAssetUrl(hash, 'json'), /runtime_asset_unavailable/);
  assert.equal(storage.getLibraryAssetUrl(hash, 'svg'), `./library-assets/${hash}.svg`);
  await assert.rejects(
    storage.saveProject('00000000-0000-4000-8000-000000000000', '{}'),
    /project_identity_mismatch/,
  );
});

test('existing project dirties an unconfirmed sound returned from the default cache on demand', async () => {
  const soundId = '8'.repeat(32);
  const soundBytes = Uint8Array.from([82, 73, 70, 70, 1, 2, 3, 4]);
  const requests = [];
  const storage = fixture(
    async (url) => {
      requests.push(url);
      throw new Error('unconfirmed default cache must not fetch');
    },
    {
      projectJson: { targets: [], monitors: [], extensions: [] },
      defaultAssets: [
        {
          assetType: 'Sound',
          dataFormat: 'WAV',
          id: soundId,
          data: soundBytes,
        },
      ],
    },
  );

  const sound = await storage.load('Sound', soundId, 'wav');

  assert.ok(sound);
  assert.equal(sound.assetId, soundId);
  assert.equal(sound.clean, false);
  assert.deepEqual(Array.from(sound.data), Array.from(soundBytes));
  assert.deepEqual(requests, []);
});

test('confirmed server sound keeps priority over same-key default cache bytes', async () => {
  const soundId = '9'.repeat(32);
  const defaultBytes = Uint8Array.from([1, 2, 3, 4]);
  const serverBytes = Uint8Array.from([9, 8, 7, 6, 5]);
  const reference = {
    assetId: soundId,
    dataFormat: 'wav',
    sha256: createHash('sha256').update(serverBytes).digest('hex'),
    sizeBytes: serverBytes.byteLength,
  };
  const calls = [];
  const storage = fixture(
    async (url) => {
      calls.push(url);
      return {
        ok: true,
        redirected: false,
        headers: { get: () => 'audio/wav' },
        arrayBuffer: async () =>
          serverBytes.buffer.slice(
            serverBytes.byteOffset,
            serverBytes.byteOffset + serverBytes.byteLength,
          ),
      };
    },
    {
      projectJson: { targets: [], monitors: [], extensions: [] },
      assets: [reference],
      defaultAssets: [
        {
          assetType: 'Sound',
          dataFormat: 'WAV',
          id: soundId,
          data: defaultBytes,
        },
      ],
    },
  );

  const sound = await storage.load('Sound', soundId, 'wav');

  assert.ok(sound);
  assert.equal(sound.clean, true);
  assert.deepEqual(Array.from(sound.data), Array.from(serverBytes));
  assert.notDeepEqual(Array.from(sound.data), Array.from(defaultBytes));
  assert.equal(calls.length, 1);
  assert.match(calls[0], new RegExp('/assets/' + soundId + '\\.wav$'));
});

test('stock media uses credential-free, redirect-free local requests and caches success', async () => {
  const calls = [];
  const storage = fixture(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      headers: { get: () => 'image/svg+xml; charset=utf-8' },
      arrayBuffer: async () => new TextEncoder().encode('<svg/>').buffer,
    };
  });
  const first = await storage.load('ImageVector', hash, 'svg');
  assert.equal(first.assetId, hash);
  assert.equal(first.clean, false);
  assert.equal(await storage.load('ImageVector', hash, 'svg'), first);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `./library-assets/${hash}.svg`);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(storage.getLibraryAssetUrl(hash, 'svg'), 'data:cached');
});

for (const failure of ['missing', 'html-fallback', 'network', 'redirect']) {
  test(`failed library response is not cached and has no external fallback: ${failure}`, async () => {
    let calls = 0;
    const storage = fixture(async () => {
      calls += 1;
      if (failure === 'network' || failure === 'redirect') throw new TypeError(failure);
      return {
        ok: failure !== 'missing',
        headers: { get: () => 'text/html' },
        arrayBuffer: async () => new TextEncoder().encode('<html>not an asset</html>').buffer,
      };
    });
    assert.equal(await storage.load('ImageVector', hash, 'svg'), null);
    assert.equal(await storage.load('ImageVector', hash, 'svg'), null);
    assert.equal(calls, 2);
  });
}

test('nginx stock library maps media types and returns genuine 404s', () => {
  const config = fs.readFileSync(
    new URL('../../infra/scratch-editor/nginx.conf.template', import.meta.url),
    'utf8',
  );
  const location = config
    .replace(/#[^\n]*/g, '')
    .match(
      /location \^~ \/library-assets\/\s*\{\s*add_header Cache-Control "public, max-age=31536000, immutable";\s*types\s*\{([^}]+)\}\s*try_files \$uri =404;\s*\}/,
    );
  assert.ok(
    location,
    'stock location must retain immutable cache, MIME mappings and a terminal 404',
  );
  assert.deepEqual(
    location[1]
      .split(';')
      .map((entry) => entry.trim().split(/\s+/))
      .filter(([type]) => type),
    [
      ['application/json', 'json'],
      ['image/svg+xml', 'svg'],
      ['image/png', 'png'],
      ['image/jpeg', 'jpg', 'jpeg'],
      ['audio/wav', 'wav'],
      ['audio/mpeg', 'mp3'],
    ],
  );
});
