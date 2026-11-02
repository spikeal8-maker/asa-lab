import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  families,
  file,
  selector,
  title,
  validateRaw,
  validateImages,
  validateReport,
} from './run-e11-stopped-fit-390.mjs';

function report() {
  return {
    errors: [],
    suites: [
      {
        specs: [
          {
            file,
            title,
            tests: [
              {
                expectedStatus: 'passed',
                status: 'expected',
                annotations: [],
                results: [{ status: 'passed', retry: 0 }],
              },
            ],
          },
        ],
      },
    ],
    stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
  };
}
function raw() {
  return {
    width: 390,
    scenario: 'stopped-fit',
    journeyComplete: true,
    lastCheckpoint: 'complete',
    lifecycleJournal: { errors: [] },
    workerJournal: { errors: [] },
    output: families.map((id) => ({
      id,
      phase: 'fit',
      beforePath: 'before.png',
      afterPath: 'after.png',
    })),
  };
}
test('literal selector discovers only the fixed leaf; source report enforces file and single case', () => {
  assert.ok(new RegExp(selector).test('electronics-selection-outline.spec.ts ' + title));
  for (const other of [
    title.replace('390', '1440'),
    title.replace('stopped-fit', 'running-controls'),
    title + ' extra',
  ]) {
    assert.equal(new RegExp(selector).test(other), false);
  }
  validateReport(report());
  validateReport(report(), true);
});
test('entrypoint refuses injected arguments before any runtime or provider access', () => {
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./run-e11-stopped-fit-390.mjs', import.meta.url)), '--grep', 'foreign'],
    { encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(child.error, undefined);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /no arguments, filters or commands/);
});
test('discovery rejects missing/duplicate/foreign cases and skip/expected-failure annotations', () => {
  for (const change of [
    (r) => r.suites[0].specs.pop(),
    (r) => r.suites[0].specs.push(structuredClone(r.suites[0].specs[0])),
    (r) => {
      r.suites[0].specs[0].file = 'foreign.spec.ts';
    },
    (r) => {
      r.suites[0].specs[0].title = title.replace('390', '320');
    },
    (r) => {
      r.suites[0].specs[0].tests[0].annotations = [{ type: 'skip' }];
    },
    (r) => {
      r.suites[0].specs[0].tests[0].expectedStatus = 'failed';
    },
    (r) => {
      r.errors = [{ message: 'hook failed' }];
    },
  ]) {
    const r = report();
    change(r);
    assert.throws(() => validateReport(r));
  }
});
test('execution rejects retries, unfinished, failed, flaky, skipped and extra attempts', () => {
  for (const change of [
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].retry = 1;
    },
    (r) => {
      r.suites[0].specs[0].tests[0].results = [];
    },
    (r) => {
      r.suites[0].specs[0].tests[0].results[0].status = 'failed';
    },
    (r) => {
      r.suites[0].specs[0].tests[0].results.push({ status: 'passed', retry: 1 });
    },
    (r) => {
      r.stats.flaky = 1;
    },
    (r) => {
      r.stats.skipped = 1;
    },
    (r) => {
      r.stats.expected = 16;
    },
  ]) {
    const r = report();
    change(r);
    assert.throws(() => validateReport(r, true));
  }
});
test('completion requires original all-nine native pairs and clean lifecycle/worker evidence', () => {
  validateRaw(raw());
  for (const change of [
    (r) => {
      r.width = 1440;
    },
    (r) => {
      r.scenario = 'running-controls';
    },
    (r) => {
      r.journeyComplete = false;
    },
    (r) => {
      r.lastCheckpoint = 'fit-led';
    },
    (r) => {
      r.primaryFailure = 'timeout';
    },
    (r) => {
      r.mandatoryEvidenceFailure = 'missing raw';
    },
    (r) => r.lifecycleJournal.errors.push('write failed'),
    (r) => r.workerJournal.errors.push('lost response'),
    (r) => r.output.pop(),
  ]) {
    const r = raw();
    change(r);
    assert.throws(() => validateRaw(r));
  }
});
test('retained image evidence binds all three built images to the exact source and base proof', () => {
  const revision = 'a'.repeat(40);
  const proofs = ['api', 'web', 'test'].map((service) => ({
    built_image: `asa-lab-${service}:${revision}`,
    source_revision: revision,
    config_digest: 'sha256:' + 'b'.repeat(64),
    base_diff_ids: ['sha256:' + 'c'.repeat(64)],
  }));
  validateImages(proofs, revision);
  for (const change of [
    (p) => p.pop(),
    (p) => {
      p[0].source_revision = 'd'.repeat(40);
    },
    (p) => {
      p[0].built_image = 'foreign:latest';
    },
    (p) => {
      p[0].base_diff_ids = [];
    },
  ]) {
    const p = structuredClone(proofs);
    change(p);
    assert.throws(() => validateImages(p, revision));
  }
});
