import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertIsolatedEnvironment,
  digest,
  profile,
  quantiles,
  validateProfile,
  sessionIdentity,
} from './contracts.mjs';

const env = {
  ASA_BLOCKS_RUNTIME_ORIGIN: 'http://127.0.0.1:4612',
  ASA_OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:19000',
  ASA_CAPACITY_BASELINE: '1',
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: '1234',
  GITHUB_SHA: 'a'.repeat(40),
  TEST_DATABASE_URL: 'postgresql://postgres:synthetic@127.0.0.1:5432/asa_capacity_test',
  APP_TEST_DATABASE_URL: 'postgresql://asalab_app:synthetic@127.0.0.1:5432/asa_capacity_test',
};
test('guard refuses production, external/mismatched targets and unselected generic CI', () => {
  assert.equal(assertIsolatedEnvironment(env), true);
  for (const patch of [
    { GITHUB_ACTIONS: '' },
    { ASA_OBJECT_STORAGE_ENDPOINT: 'https://school.example' },
    { ASA_BLOCKS_RUNTIME_ORIGIN: 'https://school.example' },
    { ASA_CAPACITY_BASELINE: '' },
    { GITHUB_SHA: 'main' },
    { GITHUB_RUN_ID: '../x' },
    { TEST_DATABASE_URL: env.TEST_DATABASE_URL.replace('127.0.0.1', 'school.example') },
    { APP_TEST_DATABASE_URL: env.APP_TEST_DATABASE_URL.replace('capacity_test', 'live') },
    { APP_TEST_DATABASE_URL: env.TEST_DATABASE_URL },
    { APP_TEST_DATABASE_URL: env.APP_TEST_DATABASE_URL + '?host=school.example' },
  ])
    assert.throws(() => assertIsolatedEnvironment({ ...env, ...patch }));
});

test('HTTP200 unauthenticated or changed identity cannot pass a continuity probe', () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  for (const kind of ['account', 'seat']) {
    const body = { authenticated: true, user: { id }, student: { seatId: id } };
    const expected = `${kind}:${id}`;
    assert.equal(sessionIdentity(kind, body, expected), expected);
    assert.throws(() => sessionIdentity(kind, { authenticated: false }, expected));
    assert.throws(() => sessionIdentity(kind, { ...body, authenticated: false }, expected));
    assert.throws(() => sessionIdentity(kind, body, `${kind}:different`));
  }
});
test('versioned workload has complete distributions and separates API30 from full capacity', () => {
  const p = profile();
  assert.equal(validateProfile(p), p);
  assert.equal(p.backendBaseline.sessions, 30);
  assert.ok(p.backendBaseline.missingLayers.includes('browser-ui-vm'));
  for (const mutate of [
    (v) => {
      v.identityPercent.account = 49;
    },
    (v) => {
      v.documentSizes[0].percent = 59;
    },
    (v) => {
      v.stages = [30, 3000, 100];
    },
    (v) => {
      v.backendBaseline.sessions = 1;
    },
  ]) {
    const invalid = JSON.parse(JSON.stringify(p));
    mutate(invalid);
    assert.throws(() => validateProfile(invalid));
  }
});
test('nearest-rank tails include real failures and empty samples never become zero latency', () => {
  assert.deepEqual(quantiles([]), { count: 0, p50: null, p95: null, p99: null, max: null });
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.deepEqual(quantiles(values), { count: 100, p50: 50, p95: 95, p99: 99, max: 100 });
  assert.equal(quantiles([1, 2, 10000]).p95, 10000);
  assert.throws(() => quantiles([NaN]));
  assert.equal(values[0], 1);
});
test('semantic document digest survives PostgreSQL JSONB property order but detects changed values', () => {
  assert.equal(
    digest({ z: [1, { y: 2, x: 3 }], a: true }),
    digest({ a: true, z: [1, { x: 3, y: 2 }] }),
  );
  assert.notEqual(digest({ a: [1, 2] }), digest({ a: [2, 1] }));
});
