import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { URL } from 'node:url';
import { TextEncoder, TextDecoder } from 'node:util';

const hash = '0123456789abcdef0123456789abcdef';
function fixture(fetch) {
  class Storage {
    AssetType = Object.fromEntries(
      ['Project', 'ImageVector', 'ImageBitmap', 'Sound'].map((name) => [name, { name }]),
    );
    DataFormat = { JSON: 'json', SVG: 'svg' };
    createAsset(assetType, dataFormat, data, assetId) {
      return { assetType, dataFormat, data, assetId, encodeDataURI: () => 'data:cached' };
    }
    addHelper(helper) {
      this.helper = helper;
    }
  }
  const context = vm.createContext({ TextEncoder, TextDecoder, fetch });
  vm.runInContext(
    fs.readFileSync(new URL('../../infra/scratch-editor/host/storage.js', import.meta.url), 'utf8'),
    context,
  );
  const result = context.AsaBlocksStorage.createFixtureStorage({
    ScratchStorage: Storage,
    buildDefaultProject: () => [
      {
        assetType: 'Project',
        dataFormat: 'JSON',
        id: 0,
        data: JSON.stringify({ targets: [{ isStage: true }, { isStage: false }] }),
      },
    ],
  });
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
    '11111111-1111-4111-8111-111111111111',
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
  assert.deepEqual(requests, []);
  for (const id of ['unknown', '../index', '%2findex', `${hash}?x=1`]) {
    assert.throws(() => storage.getLibraryAssetUrl(id, 'svg'), /fixture_asset_unavailable/);
  }
  assert.throws(() => storage.getLibraryAssetUrl(hash, 'json'), /fixture_asset_unavailable/);
  assert.equal(storage.getLibraryAssetUrl(hash, 'svg'), `/library-assets/${hash}.svg`);
  await assert.rejects(storage.saveProject(), /fixture_storage_read_only/);
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
  assert.equal(await storage.load('ImageVector', hash, 'svg'), first);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `/library-assets/${hash}.svg`);
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

test('nginx stock library misses are genuine 404s, not the host SPA', () => {
  const config = fs.readFileSync(
    new URL('../../infra/scratch-editor/nginx.conf.template', import.meta.url),
    'utf8',
  );
  assert.match(config, /location \^~ \/library-assets\/\s*\{\s*try_files \$uri =404;\s*\}/);
});
