// Offline safety checks only; no PostgreSQL, containers or servers are started.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  explainMetadata,
  isolatedConfig,
  resultDigest,
  verifyConnection,
} from './learning-e1-pg-plan-probe.mjs';

const env = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  ASA_E1_PG_PLAN_PROBE: 'full-context-read-only',
  TEST_DATABASE_URL: 'postgres://asalab_admin:synthetic@postgres:5432/asalab_test',
  APP_TEST_DATABASE_URL: 'postgres://asalab_app:synthetic@postgres:5432/asalab_test',
};

test('rejects a missing diagnostic CI opt-in before returning a connection configuration', () => {
  for (const key of ['CI', 'GITHUB_ACTIONS', 'ASA_E1_PG_PLAN_PROBE']) {
    assert.throws(() => isolatedConfig({ ...env, [key]: '' }), /diagnostic_ci_flag_required/);
  }
});

test('requires matching disposable URLs, service host and the real runtime role', () => {
  assert.equal(isolatedConfig(env).database, 'asalab_test');
  for (const url of [
    'postgres://asalab_app:secret@postgres:5432/asalab',
    'postgres://asalab_app:secret@remote.invalid:5432/asalab_test',
    'postgres://asalab_app:secret@postgres:5432/another_test',
    'postgres://asalab_admin:secret@postgres:5432/asalab_test',
    'postgres://asalab_app:secret@postgres:5432/asalab_test?options=unsafe',
    'postgres://asalab_app:secret@postgres:5432/%61salab_test',
    'invalid-secret-url',
  ]) {
    assert.throws(
      () => isolatedConfig({ ...env, APP_TEST_DATABASE_URL: url }),
      /isolated_urls_required/,
    );
  }
  const actual = {
    database: 'asalab_test',
    sessionRole: 'asalab_app',
    currentRole: 'asalab_app',
    readOnly: true,
    repeatableRead: true,
    privileged: false,
    ownerMember: false,
  };
  verifyConnection(actual, 'asalab_test', true);
  for (const change of [
    { database: 'asalab' },
    { sessionRole: 'asalab_admin' },
    { currentRole: 'asalab_admin' },
    { readOnly: false },
    { repeatableRead: false },
    { privileged: true },
    { ownerMember: true },
  ]) {
    assert.throws(() => verifyConnection({ ...actual, ...change }, 'asalab_test', true));
  }
});

test('hashes compare SQL row multisets, retaining JSON array order and duplicates', () => {
  const first = [{ data: { a: 1, b: [2, 3] } }, { data: { a: 2 } }];
  const reordered = [{ data: { a: 2 } }, { data: { b: [2, 3], a: 1 } }];
  assert.equal(resultDigest(first), resultDigest(reordered));
  assert.notEqual(resultDigest(first), resultDigest([{ data: { a: 1, b: [3, 2] } }, first[1]]));
  assert.notEqual(resultDigest(first), resultDigest([...first, first[0]]));
});

test('EXPLAIN output retains only finite allowlisted numeric plan/JIT metadata', () => {
  const sentinel = 'secret-sql-id-row-password';
  const result = explainMetadata([
    {
      'Planning Time': 4.1,
      'Execution Time': 8.2,
      Plan: {
        'Node Type': sentinel,
        'Total Cost': 100,
        'Plan Rows': sentinel,
        'Actual Rows': 2,
        'Shared Read Blocks': Number.POSITIVE_INFINITY,
        Filter: sentinel,
        Output: [sentinel],
        Plans: [{ 'Total Cost': 7, 'Actual Rows': 1, 'Relation Name': sentinel }],
      },
      Settings: { role: sentinel },
      JIT: { Functions: 3, Timing: { Generation: 1, Total: 2, Secret: sentinel } },
      Query: sentinel,
    },
  ]);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.deepEqual(result, {
    planningMs: 4.1,
    executionMs: 8.2,
    nodes: [
      { index: 0, parent: -1, depth: 0, totalCost: 100, actualRows: 2 },
      { index: 1, parent: 0, depth: 1, totalCost: 7, actualRows: 1 },
    ],
    jitMetadataPresent: 1,
    jitFunctions: 3,
    jitGenerationMs: 1,
    jitTotalMs: 2,
    nestedStatementsInstrumented: 0,
  });
  assert.equal(explainMetadata([{ Plan: {} }]).jitMetadataPresent, 0);
  assert.throws(
    () => explainMetadata([{ Plan: { Plans: Array(128).fill({}) } }]),
    /explain_size_rejected/,
  );
});
