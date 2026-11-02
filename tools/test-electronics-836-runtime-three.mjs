import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import {
  expectedCases,
  selector,
  validateImages,
  validateReport,
} from './run-electronics-836-runtime-three.mjs';

const { structuredClone } = globalThis;

function report() {
  return {
    errors: [],
    stats: { expected: 3, unexpected: 0, skipped: 0, flaky: 0 },
    suites: expectedCases.map(({ file, suites, title }) => {
      const spec = {
        file,
        title,
        tests: [
          {
            expectedStatus: 'passed',
            annotations: [],
            status: 'expected',
            results: [{ status: 'passed', retry: 0 }],
          },
        ],
      };
      return suites.length
        ? { title: file, specs: [], suites: [{ title: suites[0], specs: [spec] }] }
        : { title: file, specs: [spec] };
    }),
  };
}
const first = (r) => r.suites[0].specs[0].tests[0];

test('only the three original literal identities are selected', () => {
  assert.equal(expectedCases.length, 3);
  const grep = new RegExp(selector);
  for (const c of expectedCases) assert.ok(grep.test(c.file + ' ' + c.title));
  for (const title of [
    expectedCases[0].title.replace('1440', '390'),
    expectedCases[0].title + ' altered',
    'arbitrary-command',
  ])
    assert.ok(!grep.test(title));
  assert.equal(validateReport(report()).length, 3);
  assert.equal(validateReport(report(), true).length, 3);
});

test('missing, duplicate, foreign, renamed and skipped discovery cannot green', () => {
  for (const mutate of [
    (r) => r.suites.pop(),
    (r) => r.suites.push(structuredClone(r.suites[0])),
    (r) => (r.suites[0].specs[0].file = 'foreign.spec.ts'),
    (r) => (r.suites[2].suites[0].title = 'foreign describe'),
    (r) => (first(r).expectedStatus = 'failed'),
    (r) => first(r).annotations.push({ type: 'skip' }),
    (r) => r.errors.push({ message: 'hook failed' }),
    (r) => r.suites[0].specs[0].tests.push(structuredClone(first(r))),
  ]) {
    const r = report();
    mutate(r);
    assert.throws(() => validateReport(r));
  }
});

test('partial, retry, timeout, flaky or wrong-total execution cannot green', () => {
  for (const mutate of [
    (r) => (first(r).results = []),
    (r) => (first(r).results[0].status = 'timedOut'),
    (r) => (first(r).results[0].retry = 1),
    (r) => first(r).results.push({ status: 'passed', retry: 1 }),
    (r) => (first(r).status = 'unexpected'),
    (r) => (r.stats.expected = 2),
    (r) => (r.stats.flaky = 1),
    (r) => (r.stats.skipped = 1),
  ]) {
    const r = report();
    mutate(r);
    assert.throws(() => validateReport(r, true));
  }
});

test('fixed entrypoint rejects arguments before runtime/evidence I/O', () => {
  for (const args of [['--grep', 'foreign'], ['--retries=7'], ['arbitrary-command']]) {
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./run-electronics-836-runtime-three.mjs', import.meta.url)), ...args],
      { encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(child.error, undefined);
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /no arguments, filters or commands/);
  }
});

test('image receipts must bind all exact sources, original bases and PostgreSQL content', () => {
  const revision = 'a'.repeat(40),
    digest = 'sha256:' + 'b'.repeat(64),
    layers = [digest];
  const source = {
    revision,
    images: {
      node: { rootfs_diff_ids: layers },
      caddy: { rootfs_diff_ids: layers },
      postgres: {
        reference: 'mirror/postgres@' + digest,
        rootfs_diff_ids: layers,
        config: { digest },
        manifest_digest: digest,
      },
    },
  };
  const proofs = ['api', 'web', 'test'].map((s) => ({
    built_image: 'asa-lab-' + s + ':' + revision,
    source_revision: revision,
    config_digest: digest,
    base_diff_ids: layers,
  }));
  const postgres = {
    pulled_image: source.images.postgres.reference,
    rootfs_diff_ids: layers,
    config_digest: digest,
  };
  validateImages(proofs, postgres, source);
  for (const mutate of [
    (p) => p.pop(),
    (p) => (p[0].source_revision = 'c'.repeat(40)),
    (p) => (p[0].base_diff_ids = []),
    (p) => (p[0].built_image = 'foreign:latest'),
  ]) {
    const p = structuredClone(proofs);
    mutate(p);
    assert.throws(() => validateImages(p, postgres, source));
  }
  for (const value of [
    { ...postgres, pulled_image: 'postgres:latest' },
    { ...postgres, rootfs_diff_ids: [] },
  ])
    assert.throws(() => validateImages(proofs, value, source));
});

test('runner retains original worker/time budgets and literal zero-retry trace command', () => {
  const source = readFileSync(
    new URL('./run-electronics-836-runtime-three.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /--workers|--timeout|--repeat-each|--max-failures/);
  assert.match(source, /'--retries=0', '--trace=on'/);
  assert.match(source, /'FAIL_OR_INCOMPLETE' : 'PASS'/);
  assert.match(source, /fullElectronicsQualification: false/);
});
