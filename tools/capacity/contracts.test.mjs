import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertIsolatedEnvironment,
  digest,
  profile,
  quantiles,
  validateProfile,
  sessionIdentity,
  baselineSlo,
  requestFailure,
  FixtureCookieJar,
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

test('baseline SLO separates latency violations, missing evidence and correctness failures', () => {
  const input = {
    correctness: 'PASS',
    observed: { loginP95Ms: 2000, readP95Ms: 400, saveP95Ms: 700 },
    targets: profile().slo,
    unexpected: 0,
    samples: 2,
    sampleErrors: 0,
  };
  assert.equal(baselineSlo(input).verdict, 'PASS');
  assert.equal(
    baselineSlo({ ...input, observed: { ...input.observed, saveP95Ms: 701 } }).verdict,
    'FAIL',
  );
  assert.equal(baselineSlo({ ...input, correctness: 'FAIL' }).verdict, 'FAIL');
  assert.equal(baselineSlo({ ...input, unexpected: 1 }).verdict, 'FAIL');
  for (const patch of [
    { samples: 0 },
    { sampleErrors: 1 },
    { observed: { ...input.observed, readP95Ms: null } },
    { observed: { ...input.observed, loginP95Ms: NaN } },
  ])
    assert.equal(baselineSlo({ ...input, ...patch }).verdict, 'INSUFFICIENT');
  assert.equal(baselineSlo({ ...input, samples: 0, unexpected: 1 }).verdict, 'FAIL');
});

test('request failures distinguish bounded timeout, transport and response failures', () => {
  assert.equal(requestFailure({ name: 'TimeoutError' }, 0), 'timeout');
  assert.equal(requestFailure({ name: 'AbortError' }, 200), 'timeout');
  assert.equal(requestFailure(new TypeError('fetch failed'), 0), 'transport');
  assert.equal(requestFailure(new Error('unexpected_fixture_status'), 503), 'response');
  assert.equal(requestFailure(new SyntaxError('invalid JSON'), 200), 'response');
});

test('fixture Account/Seat transitions delete expired authority cookies like a browser', () => {
  const jar = new FixtureCookieJar();
  const now = Date.UTC(2026, 9, 24);
  jar.receive(
    ['asa_student_session=seat; Path=/; Max-Age=43200'],
    '/api/class-join/studentseat',
    now,
  );
  jar.receive(
    [
      'asa_student_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'asa_session=account; Path=/; Max-Age=43200',
      'asa_refresh=refresh; Path=/api/auth; Max-Age=43200',
    ],
    '/api/auth/login',
    now,
  );
  assert.equal(jar.header('/api/projects', now), 'asa_session=account');
  assert.equal(jar.header('/api/auth/me', now), 'asa_refresh=refresh; asa_session=account');
  jar.receive(
    [
      'asa_session=; Path=/; Max-Age=0',
      'asa_refresh=; Path=/api/auth; Max-Age=-1',
      'asa_student_session=next-seat; Path=/; Max-Age=43200',
    ],
    '/api/class-join/studentseat',
    now,
  );
  assert.equal(jar.header('/api/projects', now), 'asa_student_session=next-seat');
  assert.deepEqual(jar.values(), ['next-seat']);
});

test('fixture cookie Max-Age overrides Expires; expiry and same-name paths remain independent', () => {
  const jar = new FixtureCookieJar();
  const now = Date.UTC(2026, 9, 24);
  jar.receive(
    [
      'x=root; Path=/; Max-Age=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'x=scoped; Path=/api/auth; Max-Age=60',
    ],
    '/api/auth/login',
    now,
  );
  assert.equal(jar.header('/api/auth/me', now), 'x=scoped; x=root');
  assert.equal(jar.header('/api/authentic', now), 'x=root');
  assert.equal(jar.header('/api/projects', now + 1000), '');
  assert.equal(jar.header('/api/auth/me', now + 1000), 'x=scoped');
  jar.receive(
    ['x=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 2099 00:00:00 GMT'],
    '/api/auth/login',
    now,
  );
  assert.equal(jar.header('/api/auth/me', now), 'x=scoped');
});
