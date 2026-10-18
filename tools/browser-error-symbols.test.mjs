import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  encryptSymbols,
  decryptSymbols,
  digest,
  symbolize,
  originalPosition,
} from './browser-error-symbols.mjs';

const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const revision = 'a'.repeat(40),
  script = '/assets/probe-1234abcd.js';
const map = { version: 3, sources: ['apps/web/src/probe.ts'], mappings: 'AAAA,KACC;AACA' };
const archive = {
  format: 'asa-web-symbols-v1',
  revision,
  assets: { [script]: { generated: 'throw Error()', sha256: digest('throw Error()'), map } },
};
const event = { revision, exception: { frames: [{ script, line: 1, column: 6 }] } };
test('owner encryption authenticates the archive and omits plaintext source paths', () => {
  const envelope = JSON.parse(encryptSymbols(archive, keys.publicKey));
  assert.equal(JSON.stringify(envelope).includes('probe.ts'), false);
  assert.deepEqual(decryptSymbols(envelope, keys.privateKey), archive);
  const bytes = Buffer.from(envelope.data, 'base64');
  bytes[0] ^= 1;
  assert.throws(() =>
    decryptSymbols({ ...envelope, data: bytes.toString('base64') }, keys.privateKey),
  );
  assert.throws(() => decryptSymbols({ ...envelope, format: 'other' }, keys.privateKey));
});
test('offline lookup verifies exact revision/JS digest and returns source coordinates only', () => {
  assert.deepEqual(symbolize(archive, event)[0].original, {
    source: 'apps/web/src/probe.ts',
    line: 2,
    column: 2,
  });
  assert.throws(() => symbolize(archive, { ...event, revision: 'b'.repeat(40) }), /revision/);
  assert.throws(() => symbolize(archive, { ...event, revision: 'unknown' }), /revision/);
  assert.throws(
    () =>
      symbolize(
        { ...archive, assets: { [script]: { ...archive.assets[script], generated: 'other' } } },
        event,
      ),
    /digest/,
  );
  assert.throws(
    () =>
      symbolize(archive, {
        ...event,
        exception: { frames: [{ script: '/assets/unknown-1234abcd.js', line: 1, column: 1 }] },
      }),
    /Unknown/,
  );
  assert.throws(
    () =>
      symbolize(archive, { ...event, exception: { frames: [{ script, line: 1, column: 9999 }] } }),
    /outside/,
  );
});
test('VLQ carries source deltas across lines and respects unmapped segments', () => {
  assert.deepEqual(originalPosition(map, 2, 1), {
    source: 'apps/web/src/probe.ts',
    line: 3,
    column: 2,
  });
  assert.throws(() => originalPosition({ ...map, mappings: 'AAAA,K' }, 1, 6), /Unmapped/);
  assert.throws(() => originalPosition(map, 10, 1), /Unmapped/);
  assert.throws(() => originalPosition(map, 1, 0), /Invalid/);
});
