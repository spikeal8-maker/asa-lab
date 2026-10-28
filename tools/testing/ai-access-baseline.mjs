import { spawn } from 'node:child_process';
import console from 'node:console';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const config = 'playwright.access-a.config.ts';
const natSpec = 'student-seat-access-hardening.spec.ts';
const participantsSpec = 'classroom-participants.spec.ts';
const executionBatches = ['journeys', 'participants', 'nat'];
function assignedBatch(file) {
  return basename(file) === natSpec
    ? 'nat'
    : basename(file) === participantsSpec
      ? 'participants'
      : 'journeys';
}
const require = createRequire(import.meta.url);

// Explicit targets/options retain Playwright's original argument order and last
// --config override. In particular the profile workflow uses another config.
export function invocationPlan(args) {
  return args.length
    ? [{ batch: null, args: ['test', '--config', config, ...args] }]
    : [
        { batch: 'discovery', args: ['test', '--config', config, '--list'] },
        { batch: 'journeys', args: ['test', '--config', config] },
        { batch: 'participants', args: ['test', '--config', config] },
        { batch: 'nat', args: ['test', '--config', config] },
      ];
}

function collectCases(report) {
  if (!Array.isArray(report?.suites) || !Array.isArray(report?.errors))
    throw new Error('Missing Playwright suites or errors');
  const cases = new Map();
  function visit(suites, ancestors = []) {
    for (const suite of suites) {
      const titles = [...ancestors, suite.title];
      for (const spec of suite.specs ?? []) {
        if (typeof spec.id !== 'string' || !spec.id || !Array.isArray(spec.tests))
          throw new Error('Invalid Playwright case identity');
        for (const test of spec.tests) {
          if (typeof test.projectId !== 'string') throw new Error('Missing project identity');
          const key = `${spec.id}/${test.projectId}`;
          if (cases.has(key)) throw new Error(`Duplicate case: ${key}`);
          cases.set(key, {
            key,
            file: spec.file,
            title: [...titles, spec.title],
            expectedStatus: test.expectedStatus,
            test,
          });
        }
      }
      visit(suite.suites ?? [], titles);
    }
  }
  visit(report.suites);
  return cases;
}

export function verifyCoverage(discovery, batches) {
  const errors = [];
  if (
    batches.length !== executionBatches.length ||
    new Set(batches.map((entry) => entry.batch)).size !== executionBatches.length ||
    batches.some((entry) => !executionBatches.includes(entry.batch))
  )
    errors.push('Exactly one journeys, participants and NAT invocation are required');
  let expected;
  try {
    expected = collectCases(discovery);
    if (discovery.errors.length) throw new Error('Discovery reported errors');
    if (!expected.size) throw new Error('Discovery collected no cases');
    for (const item of expected.values()) {
      if (item.test.results.length !== 0 || item.expectedStatus !== 'passed')
        throw new Error('Discovery must contain the original, unexecuted passing cases');
    }
    for (const batch of executionBatches) {
      if (![...expected.values()].some((item) => assignedBatch(item.file) === batch))
        throw new Error(`Discovery must contain the complete ${batch} batch`);
    }
  } catch (error) {
    return { ok: false, expected: 0, executed: 0, errors: [error.message] };
  }
  const observed = new Set();
  for (const batch of executionBatches) {
    const result = batches.find((entry) => entry.batch === batch);
    if (!result) {
      errors.push(`${batch}: invocation is missing`);
      continue;
    }
    if (result.exitCode !== 0 || result.signal)
      errors.push(`${batch}: process exited ${result.exitCode ?? result.signal ?? 'unknown'}`);
    try {
      const actual = collectCases(result.report);
      if (result.report.errors.length) errors.push(`${batch}: Playwright reported errors`);
      for (const [key, item] of actual) {
        if (observed.has(key)) errors.push(`Case executed more than once: ${key}`);
        observed.add(key);
        const original = expected.get(key);
        if (!original) errors.push(`Unexpected case: ${key}`);
        else if (
          item.file !== original.file ||
          JSON.stringify(item.title) !== JSON.stringify(original.title) ||
          item.expectedStatus !== original.expectedStatus
        )
          errors.push(`Case identity changed after discovery: ${key}`);
        if (assignedBatch(item.file) !== batch)
          errors.push(`Case ran in the wrong process: ${key}`);
        const runs = item.test.results;
        if (
          item.test.status !== 'expected' ||
          !Array.isArray(runs) ||
          runs.length !== 1 ||
          runs[0].status !== 'passed' ||
          runs[0].retry !== 0
        )
          errors.push(`Case did not pass exactly once without retry: ${key}`);
      }
    } catch (error) {
      errors.push(`${batch}: ${error.message}`);
    }
  }
  for (const key of expected.keys()) if (!observed.has(key)) errors.push(`Unexecuted case: ${key}`);
  return { ok: errors.length === 0, expected: expected.size, executed: observed.size, errors };
}

async function readReport(path) {
  try {
    const bytes = await readFile(path);
    return {
      report: JSON.parse(bytes.toString('utf8')),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      error: null,
    };
  } catch (error) {
    return { report: null, sha256: null, error: error.message };
  }
}

async function atomicJson(path, value, runId) {
  const temporary = `${path}.${runId}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, path);
}

export async function runAccessBaseline(
  args,
  { cwd = process.cwd(), env = process.env, cli = require.resolve('@playwright/test/cli') } = {},
) {
  const plan = invocationPlan(args);
  const inherited = { ...env };
  delete inherited.ASA_ACCESS_A_BATCH;
  delete inherited.ASA_ACCESS_A_RUN_ID;
  let interrupted = null;
  let activeChild = null;
  const stop = (signal) => {
    interrupted = signal;
    activeChild?.kill(signal);
  };
  const onInterrupt = () => stop('SIGINT');
  const onTerminate = () => stop('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  const invoke = (entry, runId) =>
    new Promise((done) => {
      if (interrupted) return done({ exitCode: null, signal: interrupted });
      const child = spawn(process.execPath, [cli, ...entry.args], {
        cwd,
        env: entry.batch
          ? { ...inherited, ASA_ACCESS_A_BATCH: entry.batch, ASA_ACCESS_A_RUN_ID: runId }
          : inherited,
        stdio: 'inherit',
        shell: false,
      });
      activeChild = child;
      child.once('error', (error) => {
        if (activeChild === child) activeChild = null;
        done({ exitCode: 1, signal: null, error: error.message });
      });
      child.once('close', (exitCode, signal) => {
        if (activeChild === child) activeChild = null;
        done({ exitCode, signal });
      });
    });
  try {
    if (plan.length === 1) {
      const result = await invoke(plan[0]);
      return result.exitCode ?? (result.signal === 'SIGINT' ? 130 : 143);
    }
    const runId = randomUUID();
    const root = join(cwd, 'reports/playwright/access-a/runs', runId);
    await mkdir(join(cwd, 'reports/playwright/access-a/runs'), { recursive: true });
    await mkdir(root);
    const started = new Date();
    const results = [];
    for (const entry of plan) {
      if (interrupted) break;
      // This is a new normal Playwright process, with the unchanged real API
      // webServer and reuseExistingServer:false. The NAT case stays whole.
      const outcome = await invoke(entry, runId);
      const path = join(root, entry.batch, 'results.json');
      const saved = await readReport(path);
      results.push({ ...entry, ...outcome, path, ...saved });
      if (entry.batch === 'discovery') {
        try {
          const cases = collectCases(saved.report);
          if (outcome.exitCode !== 0 || outcome.signal || saved.report.errors.length || !cases.size)
            break;
        } catch {
          break;
        }
      }
      // A failed batch does not suppress later participants or NAT evidence. Its
      // nonzero status is retained and still fails the complete command.
    }
    const discovery = results.find((entry) => entry.batch === 'discovery');
    const batches = results.filter((entry) => entry.batch !== 'discovery');
    const coverage = verifyCoverage(discovery?.report, batches);
    if (discovery?.exitCode !== 0 || discovery?.signal || interrupted) {
      coverage.ok = false;
      coverage.errors.push(
        `Discovery or runner interrupted: ${interrupted ?? discovery?.signal ?? discovery?.exitCode}`,
      );
    }
    const receipt = {
      schemaVersion: 1,
      runId,
      startedAt: started.toISOString(),
      finishedAt: new Date().toISOString(),
      interrupted,
      coverage,
      invocations: results.map((entry) => ({
        batch: entry.batch,
        args: entry.args,
        exitCode: entry.exitCode,
        signal: entry.signal,
        path: entry.path,
        sha256: entry.sha256,
        error: entry.error,
      })),
    };
    const stats = {
      startTime: started.toISOString(),
      duration: Date.now() - started.getTime(),
      expected: 0,
      skipped: 0,
      unexpected: 0,
      flaky: 0,
    };
    for (const batch of batches)
      for (const key of ['expected', 'skipped', 'unexpected', 'flaky'])
        stats[key] += batch.report?.stats?.[key] ?? 0;
    const combined = {
      config: discovery?.report?.config ?? {},
      suites: batches.flatMap((batch) => batch.report?.suites ?? []),
      errors: [
        ...batches.flatMap((batch) => batch.report?.errors ?? []),
        ...coverage.errors.map((message) => ({ message })),
      ],
      stats,
      asaAccessA: receipt,
    };
    await atomicJson(join(root, 'receipt.json'), receipt, runId);
    await atomicJson(join(root, 'combined.json'), combined, runId);
    // Preserve the existing consumer path; raw reports and traces remain in
    // distinct owned run directories, so no stale report can satisfy this run.
    await atomicJson(join(cwd, 'reports/playwright/access-a-summary.json'), combined, runId);
    console.log(
      `Access A: ${coverage.executed}/${coverage.expected} cases; ${coverage.ok ? 'PASS' : 'FAIL'}; evidence ${root}`,
    );
    for (const message of coverage.errors) console.error(message);
    return interrupted === 'SIGINT' ? 130 : interrupted ? 143 : coverage.ok ? 0 : 1;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runAccessBaseline(process.argv.slice(2));
  } catch (error) {
    console.error(`Access A launcher failed: ${error.message}`);
    process.exitCode = 1;
  }
}
