import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
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
  FAILURE_REPORT_CONTEXT_MAX_BYTES,
  FAILURE_REPORT_MAX_BYTES,
  FAILURE_REPORT_PATH,
} from '../../tools/electronics-failure-reporter.mjs';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, openSync: vi.fn(fs.openSync), readSync: vi.fn(fs.readSync) };
});

type JournalEntry = {
  event: string;
  errors?: { message: string; stack: string | null; value: string | null }[];
  attachments?: {
    errorContext?: {
      status: string;
      text?: string;
      readBytes?: number;
      textBytes?: number;
      sourceBytes?: number;
      reason?: string;
    };
  }[];
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
function contextFile(root: string, text: string | Buffer, name = 'case-one') {
  const path = join(root, 'reports/playwright', name, 'error-context.md');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return { name: 'error-context', contentType: 'text/markdown', path };
}
afterEach(() => {
  reporters.splice(0).forEach((instance) => instance.onExit());
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  vi.restoreAllMocks();
  vi.mocked(readSync).mockClear();
  vi.mocked(openSync).mockClear();
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

  describe.skipIf(process.platform !== 'linux')('confined generated error context', () => {
    it('persists only the allowed existing file before final completion', () => {
      const { root, instance } = reporter();
      const text = '# Page snapshot\n- menu:\n  - menuitem "Удалить 6 блоки"\n';
      const attachment = contextFile(root, text);
      Object.defineProperty(attachment, 'body', {
        get: () => {
          throw new Error('Inline attachment bodies must never be read');
        },
      });
      instance.onTestEnd(testCase(root), { ...failedResult(), attachments: [attachment] });
      const saved = entries(root);
      expect(saved[0]).toMatchObject({ limits: { errorContextBytes: 32768 } });
      expect(saved[1]).toMatchObject({
        status: 'failed',
        errors: failedResult().errors,
        attachments: [
          {
            errorContext: {
              status: 'captured',
              text,
              sourceBytes: Buffer.byteLength(text),
              readBytes: Buffer.byteLength(text),
              textBytes: Buffer.byteLength(text),
            },
          },
        ],
        truncated: [],
      });
      expect(saved.some((entry) => entry.event === 'end')).toBe(false);
      expect(vi.mocked(readSync)).toHaveBeenCalledTimes(1);
    });

    it('caps allocation/read bytes and marks a multibyte UTF-8 boundary explicitly', () => {
      const { root, instance } = reporter();
      const prefix = 'Ж'.repeat(FAILURE_REPORT_CONTEXT_MAX_BYTES / 2 - 1);
      const text = prefix + '🤖' + '尾'.repeat(100_000);
      instance.onTestEnd(testCase(root), {
        ...failedResult(),
        attachments: [contextFile(root, text)],
      });
      const saved = entries(root).at(-1)!;
      expect(saved.attachments![0].errorContext).toEqual({
        status: 'truncated',
        sourceBytes: Buffer.byteLength(text),
        readBytes: FAILURE_REPORT_CONTEXT_MAX_BYTES,
        textBytes: Buffer.byteLength(prefix),
        text: prefix,
      });
      expect(saved.truncated).toContain('attachments[0].errorContext.text');
      expect(saved.attachments![0].errorContext!.text).not.toContain('\ufffd');
      for (const call of vi.mocked(readSync).mock.calls) {
        expect((call[1] as Buffer).byteLength).toBeLessThanOrEqual(32768);
        expect(call[3]).toBeLessThanOrEqual(32768);
      }
    });

    it.each(['missing', 'read-error', 'invalid-utf8'])(
      'records %s without losing the original failure or subsequent events',
      (kind) => {
        const { root, instance } = reporter();
        const attachment = contextFile(
          root,
          kind === 'invalid-utf8' ? Buffer.from([255]) : 'context',
        );
        if (kind === 'missing') rmSync(attachment.path);
        if (kind === 'read-error')
          vi.mocked(readSync).mockImplementationOnce(() => {
            throw Object.assign(new Error('simulated disk refusal'), { code: 'EIO' });
          });
        instance.onTestEnd(testCase(root, 'first'), {
          ...failedResult(),
          attachments: [attachment],
        });
        instance.onTestEnd(testCase(root, 'second'), failedResult());
        expect(instance.onEnd({ status: 'failed', duration: 5 })).toBeUndefined();
        const saved = entries(root);
        expect(saved.map((entry) => entry.event)).toEqual(['started', 'testEnd', 'testEnd', 'end']);
        expect(saved.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4]);
        expect(saved[1]).toMatchObject({
          status: 'failed',
          errors: failedResult().errors,
          attachments: [{ errorContext: { status: 'unavailable' } }],
        });
        expect(saved[1].attachments![0].errorContext).not.toHaveProperty('text');
        expect(saved[2]).toMatchObject({ testId: 'second', status: 'failed' });
        expect(saved.at(-1)).toMatchObject({
          observedAttemptCounts: { failed: 2 },
          evidenceLimited: false,
        });
      },
    );

    it.each([
      'traversal',
      'outside',
      'sibling-prefix',
      'wrong-name',
      'file-symlink',
      'parent-symlink',
      'root-symlink',
      'hardlink',
      'directory',
      'fifo',
    ])('refuses %s before reading file content', (kind) => {
      const { root, instance } = reporter();
      const outside = directory();
      const secret = join(outside, 'error-context.md');
      writeFileSync(secret, 'outside bytes must not be read');
      const attachment = contextFile(root, 'inside bytes');
      if (kind === 'traversal')
        attachment.path = join(dirname(attachment.path), 'nested') + '/../error-context.md';
      else if (kind === 'outside') attachment.path = secret;
      else if (kind === 'sibling-prefix')
        attachment.path = join(root, 'reports/playwright-other/error-context.md');
      else if (kind === 'wrong-name') attachment.path = join(dirname(attachment.path), 'trace.zip');
      else if (kind === 'parent-symlink' || kind === 'root-symlink') {
        const target =
          kind === 'parent-symlink' ? dirname(attachment.path) : join(root, 'reports/playwright');
        rmSync(target, { recursive: true });
        symlinkSync(outside, target, 'dir');
      } else {
        rmSync(attachment.path);
        if (kind === 'file-symlink') symlinkSync(secret, attachment.path);
        else if (kind === 'hardlink') linkSync(secret, attachment.path);
        else if (kind === 'directory') mkdirSync(attachment.path);
        else if (kind === 'fifo') expect(spawnSync('mkfifo', [attachment.path]).status).toBe(0);
      }
      instance.onTestEnd(testCase(root), { ...failedResult(), attachments: [attachment] });
      expect(entries(root).at(-1)).toMatchObject({
        status: 'failed',
        errors: failedResult().errors,
        attachments: [{ errorContext: { status: 'rejected' } }],
      });
      expect(vi.mocked(readSync)).not.toHaveBeenCalled();
      expect(JSON.stringify(entries(root))).not.toContain('outside bytes must not be read');
    });

    it('never reads matching contexts of passed/expected failures or nonmatching attachments', () => {
      const { root, instance } = reporter();
      const attachment = contextFile(root, 'private marker');
      for (const [actual, expected] of [
        ['passed', 'passed'],
        ['passed', 'failed'],
        ['failed', 'failed'],
        ['skipped', 'passed'],
      ]) {
        instance.onTestEnd(
          { ...testCase(root), expectedStatus: expected },
          {
            ...failedResult(),
            status: actual,
            attachments: [attachment],
          },
        );
      }
      instance.onTestEnd(testCase(root), {
        ...failedResult(),
        attachments: [
          { ...attachment, name: 'error context' },
          { ...attachment, contentType: 'text/plain' },
        ],
      });
      expect(vi.mocked(readSync)).not.toHaveBeenCalled();
      expect(JSON.stringify(entries(root))).not.toContain('private marker');
      expect(JSON.stringify(entries(root))).not.toContain('"errorContext":');
    });

    it('rejects an ancestor moved outside and replaced by a symlink between validation and open', async () => {
      const { root, instance } = reporter();
      const attachment = contextFile(root, 'context moved outside must not be read');
      const outside = directory();
      instance.onBegin({}, { allTests: () => [1] });
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      vi.mocked(openSync).mockImplementationOnce((path, flags, mode) => {
        expect(path).toBe(attachment.path);
        const moved = join(outside, 'moved-case');
        renameSync(dirname(attachment.path), moved);
        symlinkSync(moved, dirname(attachment.path), 'dir');
        return actual.openSync(path, flags, mode);
      });
      instance.onTestEnd(testCase(root), { ...failedResult(), attachments: [attachment] });
      expect(entries(root).at(-1)).toMatchObject({
        status: 'failed',
        errors: failedResult().errors,
        attachments: [{ errorContext: { status: 'rejected', reason: 'changedFile' } }],
      });
      expect(vi.mocked(readSync)).not.toHaveBeenCalled();
      expect(JSON.stringify(entries(root))).not.toContain('context moved outside must not be read');
      instance.onTestEnd(testCase(root, 'later'), failedResult());
      instance.onEnd({ status: 'failed', duration: 5 });
      expect(entries(root).at(-1)).toMatchObject({
        event: 'end',
        observedAttemptCounts: { failed: 2 },
      });
    });

    it('keeps the total cap/footer and stops context reads after saturation', () => {
      const { root, instance } = reporter(directory(), 8192);
      const attachment = contextFile(root, '\u0000'.repeat(32768));
      for (let i = 0; i < 10; i++) {
        instance.onTestEnd(testCase(root, `large-${i}`), {
          ...failedResult(),
          attachments: [attachment],
        });
        expect(statSync(join(root, FAILURE_REPORT_PATH)).size).toBeLessThanOrEqual(8192);
      }
      expect(vi.mocked(readSync)).toHaveBeenCalledTimes(1);
      instance.onEnd({ status: 'failed', duration: 10 });
      expect(entries(root).filter((entry) => entry.event === 'capacityReached')).toHaveLength(1);
      expect(entries(root).at(-1)).toMatchObject({
        event: 'end',
        evidenceLimited: true,
        dataEventsOmitted: 10,
        observedAttemptCounts: { failed: 10 },
      });
      expect(statSync(join(root, FAILURE_REPORT_PATH)).size).toBeLessThanOrEqual(8192);
    });
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
        outputDir: join(root, 'reports/playwright'),
        workers: 1,
        retries: 0,
        reporter: [['list'], [reporterPath, { rootDir: root }]],
      })};\n`,
    );
    writeFileSync(
      join(root, 'reporter.spec.cjs'),
      `const { test, expect } = require(${JSON.stringify(require.resolve('@playwright/test'))});\n` +
        `const fs = require('node:fs');\nconst path = require('node:path');\n` +
        `test('pure Node pass', () => expect(4).toBe(4));\n` +
        `test('pure Node failure', ({}, info) => {\n` +
        `  const context = info.outputPath('error-context.md');\n` +
        `  fs.mkdirSync(path.dirname(context), { recursive: true });\n` +
        `  fs.writeFileSync(context, '# Page snapshot\\n- menuitem "Удалить 6 блоки"\\n');\n` +
        `  info.attachments.push({ name: 'error-context', contentType: 'text/markdown', path: context });\n` +
        `  expect('actual electronics value').toBe('expected electronics value');\n});\n`,
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
    expect(outcomes[1].attachments![0].errorContext).toMatchObject(
      process.platform === 'linux'
        ? { status: 'captured', text: '# Page snapshot\n- menuitem "Удалить 6 блоки"\n' }
        : { status: 'unavailable', reason: 'secureReadUnsupported' },
    );
    expect(stripVTControlCharacters(child.stdout)).toContain('1 failed');
    expect(stripVTControlCharacters(child.stdout)).toContain('1 passed');
    expect(saved.at(-1)).toMatchObject({
      event: 'end',
      status: 'failed',
      observedAttemptCounts: { passed: 1, failed: 1 },
    });
  }, 25_000);
});
