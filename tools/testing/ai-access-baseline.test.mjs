import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { URL } from 'node:url';
import { invocationPlan, runAccessBaseline, verifyCoverage } from './ai-access-baseline.mjs';

const originalCases = [
  ['first', 'access-a.spec.ts', 'ordinary account journey'],
  ['participant', 'classroom-participants.spec.ts', 'complete participants'],
  ['second', 'student-seat-access-hardening.spec.ts', 'complete NAT admission'],
];
function report(cases, executed = true) {
  return {
    config: {},
    suites: cases.map(([id, file, title]) => ({
      title: file,
      specs: [
        {
          id,
          file,
          title,
          tests: [
            {
              projectId: '',
              expectedStatus: 'passed',
              status: executed ? 'expected' : 'skipped',
              results: executed ? [{ status: 'passed', retry: 0 }] : [],
            },
          ],
        },
      ],
      suites: [],
    })),
    errors: [],
    stats: {
      expected: executed ? cases.length : 0,
      skipped: executed ? 0 : cases.length,
      unexpected: 0,
      flaky: 0,
    },
  };
}
function completeEvidence() {
  return [
    { batch: 'journeys', exitCode: 0, report: report([originalCases[0]]) },
    { batch: 'participants', exitCode: 0, report: report([originalCases[1]]) },
    { batch: 'nat', exitCode: 0, report: report([originalCases[2]]) },
  ];
}
const discovery = report(originalCases, false);

test('default plan isolates complete participants and NAT files; existing explicit CLI overrides pass through once', () => {
  assert.deepEqual(
    invocationPlan([]).map((entry) => entry.batch),
    ['discovery', 'journeys', 'participants', 'nat'],
  );
  const args = [
    'e2e/classroom-student-profile.spec.ts',
    '--config=playwright.config.ts',
    '--workers=1',
    '--reporter=list',
  ];
  assert.deepEqual(invocationPlan(args), [
    { batch: null, args: ['test', '--config', 'playwright.access-a.config.ts', ...args] },
  ]);
  assert.equal(invocationPlan(['--list']).length, 1);
  assert.equal(invocationPlan(['--help']).length, 1);
});

test('all discovered cases must execute once in their correct real process without retries', () => {
  assert.deepEqual(verifyCoverage(discovery, completeEvidence()), {
    ok: true,
    expected: 3,
    executed: 3,
    errors: [],
  });
  const corruptions = [
    (batches) => {
      batches.pop();
    },
    (batches) => {
      batches[1].batch = 'unknown';
    },
    (batches) => {
      [batches[0].report, batches[1].report] = [batches[1].report, batches[0].report];
    },
    (batches) => {
      [batches[1].report, batches[2].report] = [batches[2].report, batches[1].report];
    },
    (batches) => {
      batches[1].report.suites[0].specs[0].file = 'access-a.spec.ts';
    },
    (batches) => {
      batches.push({ ...batches[1] });
    },
    (batches) => {
      batches[1].report.suites = [];
    },
    (batches) => {
      batches[1].report = report([originalCases[0]]);
    },
    (batches) => {
      batches[1].report = report([['third', originalCases[1][1], 'extra']]);
    },
    (batches) => {
      batches[1].report.suites[0].specs.push(batches[1].report.suites[0].specs[0]);
    },
    (batches) => {
      batches[1].report.suites[0].specs[0].tests[0].results[0].status = 'skipped';
    },
    (batches) => {
      batches[1].report.suites[0].specs[0].tests[0].results[0].status = 'interrupted';
    },
    (batches) => {
      batches[1].report.suites[0].specs[0].tests[0].results.push({ status: 'passed', retry: 1 });
    },
    (batches) => {
      batches[1].report.suites[0].specs[0].tests[0].results[0].retry = 1;
    },
    (batches) => {
      batches[1].report.suites[0].specs[0].title = 'changed assertion journey';
    },
    (batches) => {
      batches[1].exitCode = 23;
    },
    (batches) => {
      batches[1].report.errors.push({ message: 'teardown failed' });
    },
    (batches) => {
      batches[1].report = null;
    },
  ];
  for (const corrupt of corruptions) {
    const batches = completeEvidence();
    corrupt(batches);
    assert.equal(verifyCoverage(discovery, batches).ok, false);
  }
  assert.equal(verifyCoverage(report([], false), []).ok, false);
  for (let missing = 0; missing < originalCases.length; missing++)
    assert.equal(
      verifyCoverage(
        report(
          originalCases.filter((_, index) => index !== missing),
          false,
        ),
        completeEvidence(),
      ).ok,
      false,
    );
});

async function fakeWorkspace(t) {
  const parent = join(process.cwd(), 'reports');
  await mkdir(parent, { recursive: true });
  const cwd = await mkdtemp(join(parent, 'access-launcher-contract-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const cli = join(cwd, 'fake-playwright.mjs');
  await writeFile(
    cli,
    `
    import { appendFile, mkdir, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    const batch = process.env.ASA_ACCESS_A_BATCH ?? null;
    await appendFile('invocations.jsonl', JSON.stringify({ batch, args: process.argv.slice(2), pid: process.pid }) + '\\n');
    if (batch === process.env.FAKE_PAUSE_BATCH) {
      process.on('SIGTERM', () => { process.exitCode = 143; clearInterval(timer); });
      const timer = setInterval(() => {}, 1000);
      await writeFile('waiting-for-signal', batch);
    } else if (batch) {
      const all = ${JSON.stringify(discovery)};
      const journeys = ${JSON.stringify(report([originalCases[0]]))};
      const participants = ${JSON.stringify(report([originalCases[1]]))};
      const nat = ${JSON.stringify(report([originalCases[2]]))};
      const folder = join('reports/playwright/access-a/runs', process.env.ASA_ACCESS_A_RUN_ID, batch);
      await mkdir(folder, { recursive: true });
      if (batch !== process.env.FAKE_MISSING_REPORT)
        await writeFile(join(folder, 'results.json'), JSON.stringify(batch === 'discovery' ? all : batch === 'journeys' ? journeys : batch === 'participants' ? participants : nat));
    }
    if (batch === process.env.FAKE_FAILURE_BATCH) process.exitCode = 23;
  `,
  );
  return { cwd, cli };
}
async function invocations(cwd) {
  return (await readFile(join(cwd, 'invocations.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

for (const failedBatch of ['journeys', 'participants']) {
  test(`${failedBatch} child failure retains failure and still executes later batches in distinct processes`, async (t) => {
    const context = await fakeWorkspace(t);
    const code = await runAccessBaseline([], {
      ...context,
      env: { ...process.env, FAKE_FAILURE_BATCH: failedBatch },
    });
    assert.equal(code, 1);
    const calls = await invocations(context.cwd);
    assert.deepEqual(
      calls.map((entry) => entry.batch),
      ['discovery', 'journeys', 'participants', 'nat'],
    );
    assert.equal(new Set(calls.map((entry) => entry.pid)).size, 4);
    const result = JSON.parse(
      await readFile(join(context.cwd, 'reports/playwright/access-a-summary.json'), 'utf8'),
    );
    assert.equal(result.asaAccessA.coverage.ok, false);
    assert.equal(
      result.asaAccessA.invocations.find((entry) => entry.batch === failedBatch).exitCode,
      23,
    );
    assert.equal(result.asaAccessA.invocations[3].exitCode, 0);
    assert.equal(result.suites.length, 3);
  });
}

test('missing raw evidence cannot be replaced by stale aggregate success', async (t) => {
  const context = await fakeWorkspace(t);
  await mkdir(join(context.cwd, 'reports/playwright'), { recursive: true });
  await writeFile(
    join(context.cwd, 'reports/playwright/access-a-summary.json'),
    JSON.stringify({ stale: true, success: true }),
  );
  const code = await runAccessBaseline([], {
    ...context,
    env: { ...process.env, FAKE_MISSING_REPORT: 'nat' },
  });
  assert.equal(code, 1);
  const result = JSON.parse(
    await readFile(join(context.cwd, 'reports/playwright/access-a-summary.json'), 'utf8'),
  );
  assert.equal(result.stale, undefined);
  assert.equal(result.asaAccessA.coverage.ok, false);
  assert.equal(result.asaAccessA.invocations[3].sha256, null);
});

test('success preserves all raw reports and a complete compatible aggregate', async (t) => {
  const context = await fakeWorkspace(t);
  assert.equal(await runAccessBaseline([], context), 0);
  const result = JSON.parse(
    await readFile(join(context.cwd, 'reports/playwright/access-a-summary.json'), 'utf8'),
  );
  assert.equal(result.asaAccessA.coverage.ok, true);
  assert.equal(result.stats.expected, 3);
  for (const entry of result.asaAccessA.invocations) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.equal(JSON.parse(await readFile(entry.path, 'utf8')).errors.length, 0);
  }
});

test('discovery failure starts no server batch and explicit caller overrides are not rewritten', async (t) => {
  const failed = await fakeWorkspace(t);
  assert.equal(
    await runAccessBaseline([], {
      ...failed,
      env: { ...process.env, FAKE_FAILURE_BATCH: 'discovery' },
    }),
    1,
  );
  assert.deepEqual(
    (await invocations(failed.cwd)).map((entry) => entry.batch),
    ['discovery'],
  );
  const explicit = await fakeWorkspace(t);
  const args = [
    'e2e/classroom-student-profile.spec.ts',
    '--config=playwright.config.ts',
    '--workers=1',
    '--reporter=list',
  ];
  assert.equal(
    await runAccessBaseline(args, {
      ...explicit,
      env: { ...process.env, ASA_ACCESS_A_BATCH: 'nat', ASA_ACCESS_A_RUN_ID: 'stale' },
    }),
    0,
  );
  const calls = await invocations(explicit.cwd);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].batch, null);
  assert.deepEqual(calls[0].args, invocationPlan(args)[0].args);
});

test(
  'termination reaches the active child, is reported and never starts the next batch',
  { timeout: 10000 },
  async (t) => {
    const context = await fakeWorkspace(t);
    const driver = join(context.cwd, 'driver.mjs');
    await writeFile(
      driver,
      `import { runAccessBaseline } from ${JSON.stringify(new URL('./ai-access-baseline.mjs', import.meta.url).href)}; process.exitCode = await runAccessBaseline([], { cli: ${JSON.stringify(context.cli)} });`,
    );
    const child = spawn(process.execPath, [driver], {
      cwd: context.cwd,
      env: { ...process.env, FAKE_PAUSE_BATCH: 'journeys' },
      stdio: 'ignore',
    });
    const ended = once(child, 'exit');
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        ready = (await readFile(join(context.cwd, 'waiting-for-signal'), 'utf8')) === 'journeys';
      } catch {
        /* Wait for the owned child only. */
      }
      if (ready) break;
      await setTimeout(30);
    }
    assert.equal(ready, true);
    child.kill('SIGTERM');
    assert.deepEqual(await ended, [143, null]);
    assert.deepEqual(
      (await invocations(context.cwd)).map((entry) => entry.batch),
      ['discovery', 'journeys'],
    );
    const result = JSON.parse(
      await readFile(join(context.cwd, 'reports/playwright/access-a-summary.json'), 'utf8'),
    );
    assert.equal(result.asaAccessA.interrupted, 'SIGTERM');
    assert.equal(result.asaAccessA.coverage.ok, false);
  },
);
