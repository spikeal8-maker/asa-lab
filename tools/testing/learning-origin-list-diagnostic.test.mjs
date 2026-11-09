import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  base,
  branch,
  definitions,
  validateEnvironment,
  sourceBody,
  bindBody,
  sanitized,
  removeDiagnosticAdditions,
  verifyGeneratedChanges,
} from './learning-origin-list-diagnostic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const valid = () => ({
  GITHUB_ACTIONS: 'true',
  RUNNER_OS: 'Linux',
  RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_REPOSITORY: 'spikeal8-maker/asa-lab',
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_HEAD_REF: branch,
  ASA_DIAGNOSTIC_SOURCE_SHA: base,
  GITHUB_RUN_ID: '42187703384',
  GITHUB_RUN_ATTEMPT: '1',
  ASA_DIAGNOSTIC_BROWSER_OUTCOME: 'failure',
  ASA_DIAGNOSTIC_BATCH: 'first',
  TEST_DATABASE_URL:
    'postgresql://postgres:synthetic-ci-password@127.0.0.1:5432/asa_learning_e1_test',
  APP_TEST_DATABASE_URL:
    'postgresql://asalab_app:synthetic-ci-password@127.0.0.1:5432/asa_learning_e1_test',
});

test('accepts only the explicit disposable CI role pair', () => {
  const env = valid();
  assert.deepEqual(validateEnvironment(env), {
    admin: env.TEST_DATABASE_URL,
    app: env.APP_TEST_DATABASE_URL,
  });
});

for (const [key, value] of [
  ['GITHUB_ACTIONS', 'false'],
  ['RUNNER_OS', 'Windows'],
  ['RUNNER_ENVIRONMENT', 'self-hosted'],
  ['GITHUB_REPOSITORY', 'another/asa-lab'],
  ['GITHUB_EVENT_NAME', 'push'],
  ['GITHUB_HEAD_REF', 'main'],
  ['ASA_DIAGNOSTIC_SOURCE_SHA', 'main'],
  ['GITHUB_RUN_ID', '0'],
  ['GITHUB_RUN_ATTEMPT', '0'],
  ['ASA_DIAGNOSTIC_BROWSER_OUTCOME', 'success'],
  ['ASA_DIAGNOSTIC_BATCH', 'second'],
]) {
  test('refuses altered execution context: ' + key, () => {
    assert.throws(() => validateEnvironment({ ...valid(), [key]: value }));
  });
}

for (const address of [
  'postgresql://postgres:synthetic-ci-password@asa-lab.ru:5432/asa_learning_e1_test',
  'postgresql://postgres:synthetic-ci-password@127.0.0.1:5432/asalab',
  'postgresql://postgres:synthetic-ci-password@127.0.0.1:5432/another_test',
  'postgresql://postgres:synthetic-ci-password@127.0.0.1:5433/asa_learning_e1_test',
  'postgresql://asalab_app:synthetic-ci-password@127.0.0.1:5432/asa_learning_e1_test',
  'postgresql://postgres@127.0.0.1:5432/asa_learning_e1_test',
  'postgresql://postgres:synthetic-ci-password@127.0.0.1:5432/asa_learning_e1_test?options=-c%20jit=off',
  'postgresql://postgres:synthetic-ci-password@127.0.0.1:5432/asa_learning_e1_test#other',
  'invalid connection string',
]) {
  test('refuses database boundary drift: ' + address.split('@').at(-1), () => {
    assert.throws(() => validateEnvironment({ ...valid(), TEST_DATABASE_URL: address }));
  });
}

test('refuses an administrative application connection', () => {
  const env = valid();
  assert.throws(() =>
    validateEnvironment({ ...env, APP_TEST_DATABASE_URL: env.TEST_DATABASE_URL }),
  );
});

test('canonical workload, limits, matrix and assertions remain byte-identical', () => {
  const filename = '.github/workflows/learning-e1-focused.yml';
  const original = execFileSync('git', ['show', base + ':' + filename], {
    cwd: root,
    encoding: 'utf8',
  });
  const current = fs.readFileSync(path.join(root, filename), 'utf8');
  assert.equal(removeDiagnosticAdditions(current), original);
  assert.match(
    current,
    /failure\(\) && matrix\.batch == 'first' && steps\.browser\.outcome == 'failure'/,
  );
  assert.equal(
    (current.match(/continue-on-error/g) ?? []).length,
    (original.match(/continue-on-error/g) ?? []).length,
  );
});

test('allows only the unchanged E1 generated screenshot outputs after failure', () => {
  verifyGeneratedChanges('');
  verifyGeneratedChanges(
    ' M e2e/artifacts/courses/demo-course-published-desktop.png\0' +
      '?? e2e/artifacts/learning/course-01/account-course-three-d-completed.png\0',
  );
  verifyGeneratedChanges('?? e2e/artifacts/learning/course-document-editor/measurements.json\0');
  verifyGeneratedChanges(
    '?? e2e/artifacts/learning/course-document-editor/native-zoom-trace-ownership.json\0',
  );
});

for (const status of [
  ' M apps/api/src/learning-origin-list.ts\0',
  '?? e2e/artifacts/courses/injected.mjs\0',
  '?? e2e/artifacts/learning/course-document-editor/other.json\0',
  '?? e2e/artifacts/other/image.png\0',
  ' D e2e/artifacts/courses/demo-course-published-desktop.png\0',
  'M  e2e/artifacts/courses/demo-course-published-desktop.png\0',
  'R  e2e/artifacts/courses/renamed.png\0e2e/artifacts/courses/old.png\0',
  '?? e2e/artifacts/courses/image.png',
]) {
  test('refuses source drift or noncanonical generated status: ' + JSON.stringify(status), () => {
    assert.throws(() => verifyGeneratedChanges(status));
  });
}

test('extracts the four exact existing SQL bodies with their locks intact', () => {
  for (const [name, filename, names] of definitions) {
    const body = sourceBody(fs.readFileSync(path.join(root, 'migrations', filename), 'utf8'), name);
    const bound = bindBody(body, names);
    assert.ok(bound.includes('$1::uuid'));
    assert.ok(bound.includes('$2::uuid'));
    assert.doesNotMatch(bound, /\bp_[a-z0-9_]+\b/);
    if (name === 'learning_linked_project_access') {
      assert.ok(bound.includes('FOR SHARE OF learner, seat, account, seat_link, account_link'));
    }
  }
});

test('unknown SQL function or argument never becomes an arbitrary probe', () => {
  assert.throws(() => sourceBody('SELECT 1;', 'unknown'));
  assert.throws(() => bindBody('SELECT p_unreviewed;', ['p_seat_id', 'p_account_id']));
});

test('artifact sanitizer removes only synthetic UUID values, preserving plan metrics', () => {
  const result = sanitized({
    Plan: {
      'Actual Loops': 121,
      'Total Cost': 5000,
      Filter: "(id = '4f8169ad-08e6-4adb-9ecb-d27e6c5c50c2'::uuid)",
    },
  });
  assert.equal(result.Plan['Actual Loops'], 121);
  assert.equal(result.Plan['Total Cost'], 5000);
  assert.equal(result.Plan.Filter, "(id = 'synthetic-uuid'::uuid)");
});
