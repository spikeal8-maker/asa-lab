import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ElectronicsFailureReporter, {
  FAILURE_REPORT_MAX_BYTES,
  FAILURE_REPORT_PATH,
} from '../../tools/electronics-failure-reporter.mjs';

type JournalEntry = {
  event: string;
  errors?: { message: string; stack: string | null; value: string | null }[];
  truncated?: string[];
  sequence: number;
  [key: string]: unknown;
};

const directories: string[] = [];
const reporters: ElectronicsFailureReporter[] = [];
const sourceSha = '1'.repeat(40);
function directory() {
  const root = mkdtempSync(join(tmpdir(), 'asa-electronics-failures-'));
  directories.push(root);
  return root;
}
function reporter(rootDir = directory(), maximumBytes = FAILURE_REPORT_MAX_BYTES) {
  const instance = new ElectronicsFailureReporter({ rootDir, maximumBytes });
  reporters.push(instance);
  return { root: rootDir, instance };
}
const testCase = (root: string, id = 'case-one') => ({
  id,
  titlePath: () => ['Electronics', 'Actual failure'],
  location: { file: join(root, 'e2e/electronics.spec.ts'), line: 42, column: 3 },
  expectedStatus: 'passed',
});
const failedResult = () => ({
  status: 'failed',
  retry: 0,
  duration: 123,
  errors: [{ message: 'Expected 5, received 4', stack: 'Error: Expected 5\n    at sample:42' }],
  attachments: [],
});
function entries(root: string): JournalEntry[] {
  return readFileSync(join(root, FAILURE_REPORT_PATH), 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
}
afterEach(() => {
  reporters.splice(0).forEach((instance) => instance.onExit());
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('incremental Electronics failure evidence', () => {
  it('persists the failure before onEnd, preserving identity without copying attachment bodies', () => {
    vi.stubEnv('ASA_ELECTRONICS_EXPECTED_SHA', sourceSha);
    vi.stubEnv('ASA_ELECTRONICS_QUALIFICATION_PROFILE', 'strict-real-time');
    const { root, instance } = reporter();
    instance.onBegin({}, { allTests: () => [1, 2] });
    const result = {
      ...failedResult(),
      attachments: [
        {
          name: 'error context',
          contentType: 'text/markdown',
          path: join(root, 'reports/playwright/error-context.md'),
          body: Buffer.from('attachment body must not be copied'),
        },
        { name: 'outside', contentType: 'text/plain', path: '../outside.txt' },
      ],
    };
    instance.onTestEnd(testCase(root), result);
    const saved = entries(root);
    expect(saved.map((entry) => entry.event)).toEqual(['started', 'begin', 'testEnd']);
    expect(saved.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(saved[0]).toMatchObject({
      expectedSourceSha: sourceSha,
      qualificationProfile: 'strict-real-time',
      completionRequiresEndEvent: true,
      limits: { fileBytes: FAILURE_REPORT_MAX_BYTES },
    });
    expect(saved[1]).toMatchObject({ expectedTestCount: 2 });
    expect(saved[2]).toMatchObject({
      testId: 'case-one',
      titlePath: ['Electronics', 'Actual failure'],
      location: { file: 'e2e/electronics.spec.ts', line: 42, column: 3 },
      expectedStatus: 'passed',
      status: 'failed',
      retry: 0,
      durationMs: 123,
      errors: [{ ...result.errors[0], value: null }],
      errorsOmitted: 0,
      attachments: [
        {
          name: 'error context',
          contentType: 'text/markdown',
          path: 'reports/playwright/error-context.md',
        },
        { name: 'outside', contentType: 'text/plain', path: '[outside repository]' },
      ],
      attachmentsOmitted: 0,
      truncated: [],
    });
    expect(JSON.stringify(saved)).not.toContain('attachment body must not be copied');
    // No end callback is invoked: a cancelled process must not imply completion.
    expect(saved.some((entry) => entry.event === 'end')).toBe(false);
  });

  it.each(['interrupted', 'timedout'])(
    'preserves actual/expected statuses and the observed %s final result',
    (finalStatus) => {
      const { root, instance } = reporter();
      instance.onBegin({}, { allTests: () => [1, 2, 3] });
      instance.onTestEnd(testCase(root, 'pass'), {
        ...failedResult(),
        status: 'passed',
        errors: [],
      });
      instance.onTestEnd(
        { ...testCase(root, 'expected-fail'), expectedStatus: 'failed' },
        failedResult(),
      );
      instance.onTestEnd(testCase(root, 'timeout'), {
        ...failedResult(),
        status: 'timedOut',
        retry: 1,
      });
      expect(instance.onEnd({ status: finalStatus, duration: 456 })).toBeUndefined();
      const saved = entries(root);
      expect(saved.filter((entry) => entry.event === 'testEnd')[1]).toMatchObject({
        expectedStatus: 'failed',
        status: 'failed',
        retry: 0,
      });
      expect(saved.at(-1)).toMatchObject({
        event: 'end',
        status: finalStatus,
        durationMs: 456,
        observedAttemptCounts: {
          passed: 1,
          failed: 1,
          timedOut: 1,
          skipped: 0,
          interrupted: 0,
          unknown: 0,
        },
        runnerErrorCount: 0,
        dataEventsOmitted: 0,
        evidenceLimited: false,
      });
    },
  );

  it('preserves a runner error even when discovery fails before onBegin', () => {
    const { root, instance } = reporter();
    instance.onError({ message: 'Cannot load the test module', stack: 'module stack' });
    expect(instance.onEnd({ status: 'failed', duration: 4 })).toBeUndefined();
    expect(entries(root).map((entry) => entry.event)).toEqual(['started', 'runnerError', 'end']);
    expect(entries(root)[1]).toMatchObject({ error: { message: 'Cannot load the test module' } });
    expect(entries(root).at(-1)).toMatchObject({ status: 'failed', runnerErrorCount: 1 });
  });

  it('bounds UTF-8 error text without splitting characters and marks omitted fields explicitly', () => {
    const { root, instance } = reporter();
    instance.onBegin({}, { allTests: () => [1] });
    const message = 'Датчик 🤖\n'.repeat(4000);
    instance.onTestEnd(testCase(root), {
      ...failedResult(),
      errors: Array.from({ length: 7 }, () => ({ message, value: '\u0000'.repeat(9000) })),
      attachments: Array.from({ length: 11 }, (_, i) => ({
        name: `attachment ${i}`,
        contentType: 'text/plain',
      })),
    });
    const saved = entries(root).find((entry) => entry.event === 'testEnd')!;
    expect(saved.errors).toHaveLength(4);
    expect(saved).toMatchObject({ errorsOmitted: 3, attachmentsOmitted: 3 });
    for (const error of saved.errors!) {
      expect(Buffer.byteLength(error.message)).toBeLessThanOrEqual(8192);
      expect(Buffer.byteLength(error.value!)).toBeLessThanOrEqual(2048);
      expect(error.message).not.toContain('\ufffd');
      expect(error.message).toContain('[truncated]');
    }
    expect(saved.truncated).toContain('errors[0].message');
    expect(saved.truncated).toContain('errors[0].value');
  });

  it('never exceeds the byte cap, including escaped characters, and reserves a final honest summary', () => {
    const { root, instance } = reporter(directory(), 8192);
    instance.onBegin({}, { allTests: () => Array.from({ length: 30 }) });
    for (let i = 0; i < 30; i++) {
      instance.onTestEnd(testCase(root, `case-${i}`), {
        ...failedResult(),
        errors: [{ message: '\u0000'.repeat(600) }],
      });
      expect(statSync(join(root, FAILURE_REPORT_PATH)).size).toBeLessThanOrEqual(8192);
    }
    const beforeEnd = entries(root);
    expect(beforeEnd.filter((entry) => entry.event === 'capacityReached')).toHaveLength(1);
    expect(beforeEnd.at(-1)).toMatchObject({
      event: 'capacityReached',
      reason: 'byteLimit',
      subsequentDataEventsOmitted: true,
    });
    expect(beforeEnd.some((entry) => entry.event === 'end')).toBe(false);
    expect(instance.onEnd({ status: 'failed', duration: 10 })).toBeUndefined();
    const saved = entries(root);
    const completed = saved.filter((entry) => entry.event === 'testEnd').length;
    expect(saved.at(-1)).toMatchObject({
      event: 'end',
      status: 'failed',
      evidenceLimited: true,
      dataEventsOmitted: 30 - completed,
      observedAttemptCounts: { failed: 30 },
    });
    expect(statSync(join(root, FAILURE_REPORT_PATH)).size).toBeLessThanOrEqual(8192);
  });

  it.each(['directory-symlink', 'file-symlink', 'existing-file'])(
    'refuses %s without writing outside reports or overwriting evidence',
    (kind) => {
      const root = directory();
      const outside = directory();
      const untouched = join(outside, 'untouched.txt');
      writeFileSync(untouched, 'original evidence');
      if (kind === 'directory-symlink') symlinkSync(outside, join(root, 'reports'), 'junction');
      else {
        mkdirSync(join(root, 'reports'));
        if (kind === 'file-symlink') symlinkSync(untouched, join(root, FAILURE_REPORT_PATH));
        else writeFileSync(join(root, FAILURE_REPORT_PATH), 'earlier report');
      }
      const warning = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const { instance } = reporter(root);
      instance.onBegin({}, { allTests: () => [1] });
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('failure evidence is incomplete'),
      );
      expect(instance.onEnd({ status: 'passed', duration: 1 })).toEqual({ status: 'failed' });
      expect(readFileSync(untouched, 'utf8')).toBe('original evidence');
      if (kind === 'existing-file')
        expect(readFileSync(join(root, FAILURE_REPORT_PATH), 'utf8')).toBe('earlier report');
      expect(instance.onEnd({ status: 'interrupted', duration: 1 })).toBeUndefined();
    },
  );

  it('cannot disable the hard cap or select a traversal output path through options', () => {
    expect(
      () => new ElectronicsFailureReporter({ maximumBytes: FAILURE_REPORT_MAX_BYTES + 1 }),
    ).toThrow();
    expect(() => new ElectronicsFailureReporter({ maximumBytes: Infinity })).toThrow();
    expect(() => new ElectronicsFailureReporter({ outputFile: '../escape.ndjson' })).toThrow();
  });

  it('runs as a real Playwright reporter for passing and failing pure Node tests without a browser', () => {
    const root = directory();
    const require = createRequire(import.meta.url);
    const cli = join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
    const reporterPath = resolve('tools/electronics-failure-reporter.mjs');
    writeFileSync(
      join(root, 'playwright.config.cjs'),
      `module.exports = ${JSON.stringify({
        testDir: root,
        testMatch: '*.spec.cjs',
        outputDir: join(root, 'test-results'),
        workers: 1,
        retries: 0,
        reporter: [['list'], [reporterPath, { rootDir: root }]],
      })};\n`,
    );
    writeFileSync(
      join(root, 'reporter.spec.cjs'),
      `const { test, expect } = require(${JSON.stringify(require.resolve('@playwright/test'))});\n` +
        `test('pure Node pass', () => expect(4).toBe(4));\n` +
        `test('pure Node failure', () => expect('actual electronics value').toBe('expected electronics value'));\n`,
    );
    const child = spawnSync(
      process.execPath,
      [cli, 'test', '--config', join(root, 'playwright.config.cjs')],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          ASA_ELECTRONICS_EXPECTED_SHA: sourceSha,
          ASA_ELECTRONICS_QUALIFICATION_PROFILE: 'strict-real-time',
        },
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status, child.stdout + child.stderr).toBe(1);
    expect(existsSync(join(root, FAILURE_REPORT_PATH)), child.stdout + child.stderr).toBe(true);
    const saved = entries(root);
    const outcomes = saved.filter((entry) => entry.event === 'testEnd');
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({ status: 'passed', expectedStatus: 'passed', errors: [] });
    expect(outcomes[1]).toMatchObject({ status: 'failed', expectedStatus: 'passed', retry: 0 });
    const message = stripVTControlCharacters(outcomes[1].errors![0].message);
    expect(message).toContain('actual electronics value');
    expect(message).toContain('expected electronics value');
    expect(stripVTControlCharacters(child.stdout)).toContain('1 failed');
    expect(stripVTControlCharacters(child.stdout)).toContain('1 passed');
    expect(saved.at(-1)).toMatchObject({
      event: 'end',
      status: 'failed',
      observedAttemptCounts: { passed: 1, failed: 1 },
    });
  }, 25_000);
});
