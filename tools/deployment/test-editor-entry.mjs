import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertEntryConfiguration, verifyEmbeddedEntryHttp } from './editor-entry-check.mjs';

const origin = 'http://172.23.104.170:4610';
const revision = 'a'.repeat(40);

function responses() {
  return new Map([
    [
      '/health/ready',
      JSON.stringify({ status: 'ready', deployment: { revision, synchronized: true } }),
    ],
    ['/build-metadata.json', JSON.stringify({ revision })],
    [
      '/runtime-config.js',
      `globalThis.__ASA_RUNTIME_CONFIG__=${JSON.stringify({ blocksRuntimeOrigin: origin })};`,
    ],
    ['/internal/blocks/', '<html data-asa-scratch-host="m1-002a"></html>'],
    ['/internal/blocks/healthz', 'ok\n'],
  ]);
}

function fakeFetch(pages, redirect = false) {
  return async (url) => ({
    status: 200,
    url: redirect ? `${origin}/login` : url,
    text: async () => pages.get(new URL(url).pathname),
  });
}

test('Linux updater accepts one dev LAN entry and rejects mismatched or insecure origins', () => {
  assert.doesNotThrow(() => assertEntryConfiguration(origin, origin, origin, 'dev'));
  assert.doesNotThrow(() =>
    assertEntryConfiguration(
      'http://127.0.0.1:4610',
      'http://127.0.0.1:4610',
      'http://127.0.0.1:4610',
      'production',
    ),
  );
  assert.throws(() =>
    assertEntryConfiguration(origin, 'http://localhost:4610', 'http://localhost:4610', 'dev'),
  );
  assert.throws(() => assertEntryConfiguration(origin, origin, origin, 'production'));
});

test('Linux updater rejects portal fallback, wrong runtime origin and redirects', async () => {
  const pages = responses();
  await verifyEmbeddedEntryHttp(origin, revision, fakeFetch(pages));
  pages.set('/internal/blocks/', '<html>Portal SPA fallback</html>');
  await assert.rejects(verifyEmbeddedEntryHttp(origin, revision, fakeFetch(pages)));
  pages.set('/internal/blocks/', '<html data-asa-scratch-host="m1-002a"></html>');
  pages.set('/internal/blocks/healthz', '<html>Portal SPA fallback</html>');
  await assert.rejects(verifyEmbeddedEntryHttp(origin, revision, fakeFetch(pages)));
  pages.set('/internal/blocks/healthz', 'ok\n');
  pages.set(
    '/runtime-config.js',
    'globalThis.__ASA_RUNTIME_CONFIG__={"blocksRuntimeOrigin":"http://localhost:4610"};',
  );
  await assert.rejects(verifyEmbeddedEntryHttp(origin, revision, fakeFetch(pages)));
  await assert.rejects(verifyEmbeddedEntryHttp(origin, revision, fakeFetch(responses(), true)));
});
