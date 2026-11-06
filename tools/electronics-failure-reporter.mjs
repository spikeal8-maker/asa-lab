import { Buffer } from 'node:buffer';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';

export const FAILURE_REPORT_PATH = 'reports/electronics-failures.ndjson';
export const FAILURE_REPORT_MAX_BYTES = 8 * 1024 * 1024;
export const FAILURE_REPORT_CONTEXT_MAX_BYTES = 32 * 1024;
const FOOTER_RESERVE_BYTES = 4096;
const MAX_EVENTS = 4096;
const MAX_ERRORS = 4;
const MAX_ATTACHMENTS = 8;
const statuses = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];

function boundedText(value, maximumBytes, label, truncated) {
  if (typeof value !== 'string') return null;
  // Bound the temporary allocation as well as the stored text; large assertion
  // diffs must not be copied in full just to keep their first few kilobytes.
  const bytes = Buffer.from(value.slice(0, maximumBytes + 1));
  if (value.length <= maximumBytes && bytes.length <= maximumBytes) return value;
  const suffix = '…[truncated]';
  let end = maximumBytes - Buffer.byteLength(suffix);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  truncated.push(label);
  return bytes.subarray(0, end).toString('utf8') + suffix;
}

const finite = (value) => (Number.isFinite(value) && value >= 0 ? value : null);
const status = (value) => (statuses.includes(value) ? value : 'unknown');

/**
 * An opt-in diagnostic journal, not a replacement for Playwright's list reporter.
 * Only generated, confined error-context.md files from unexpected failures may be read.
 * No stdout/stderr stream, arbitrary attachment body, page or request API is read.
 * An absent end event means that final completion was not observed.
 */
export default class ElectronicsFailureReporter {
  #root;
  #maximumBytes;
  #mode;
  #fd;
  #bytes = 0;
  #sequence = 0;
  #events = 0;
  #omitted = 0;
  #saturated = false;
  #failure = false;
  #counts = Object.fromEntries([...statuses, 'unknown'].map((key) => [key, 0]));
  #runnerErrors = 0;

  constructor(options = {}) {
    if (
      !options ||
      typeof options !== 'object' ||
      Object.keys(options).some(
        (key) =>
          ![
            'rootDir',
            'maximumBytes',
            // Injected by Playwright, not configurable destinations for evidence.
            'configDir',
            '_mode',
            '_isTestServer',
            '_commandHash',
          ].includes(key),
      )
    )
      throw new TypeError('Unsupported Electronics failure reporter options');
    this.#root = resolve(options.rootDir ?? process.cwd());
    this.#maximumBytes = options.maximumBytes ?? FAILURE_REPORT_MAX_BYTES;
    this.#mode = ['test', 'list', 'merge'].includes(options._mode) ? options._mode : null;
    // Tests may lower the byte budget, but no caller can remove or raise the cap.
    if (
      !Number.isSafeInteger(this.#maximumBytes) ||
      this.#maximumBytes < 2 * FOOTER_RESERVE_BYTES ||
      this.#maximumBytes > FAILURE_REPORT_MAX_BYTES
    )
      throw new TypeError('Invalid Electronics failure reporter byte budget');
  }

  #directory(path) {
    if (!lstatSync(path).isDirectory() || realpathSync(path) !== path)
      throw new Error('Electronics failure evidence directory is not a real directory');
  }

  #open() {
    if (this.#fd !== undefined) return;
    this.#directory(this.#root);
    const reports = join(this.#root, 'reports');
    try {
      mkdirSync(reports);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    this.#directory(reports);
    // Exclusive creation preserves earlier evidence and refuses an existing symlink.
    this.#fd = openSync(
      join(this.#root, FAILURE_REPORT_PATH),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o644,
    );
    const truncated = [];
    const expectedSha = process.env.ASA_ELECTRONICS_EXPECTED_SHA ?? '';
    this.#write({
      event: 'started',
      mode: this.#mode,
      expectedSourceSha: /^[a-f0-9]{40}$/.test(expectedSha) ? expectedSha : null,
      qualificationProfile: boundedText(
        process.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE,
        128,
        'qualificationProfile',
        truncated,
      ),
      completionRequiresEndEvent: true,
      limits: {
        fileBytes: this.#maximumBytes,
        dataEvents: MAX_EVENTS,
        errorsPerEvent: MAX_ERRORS,
        attachmentsPerEvent: MAX_ATTACHMENTS,
        errorTextBytes: 8192,
        errorContextBytes: FAILURE_REPORT_CONTEXT_MAX_BYTES,
      },
      truncated,
    });
  }

  #serialize(record) {
    return Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        sequence: this.#sequence + 1,
        recordedAtUtc: new Date().toISOString(),
        ...record,
      }) + '\n',
    );
  }

  #write(record, dataEvent = false) {
    if (dataEvent && this.#saturated) {
      this.#omitted++;
      return;
    }
    const bytes = this.#serialize(record);
    if (
      dataEvent &&
      (this.#events >= MAX_EVENTS ||
        this.#bytes + bytes.length > this.#maximumBytes - FOOTER_RESERVE_BYTES)
    ) {
      this.#saturated = true;
      this.#omitted++;
      this.#write({
        event: 'capacityReached',
        reason: this.#events >= MAX_EVENTS ? 'eventLimit' : 'byteLimit',
        omittedAtLeast: 1,
        subsequentDataEventsOmitted: true,
        finalEndEventMayStillBeWritten: true,
      });
      return;
    }
    if (this.#bytes + bytes.length > this.#maximumBytes)
      throw new Error('Electronics failure evidence exceeded its reserved byte budget');
    this.#directory(this.#root);
    this.#directory(join(this.#root, 'reports'));
    for (let offset = 0; offset < bytes.length;) {
      const written = writeSync(this.#fd, bytes, offset, bytes.length - offset);
      if (!written) throw new Error('Electronics failure evidence write made no progress');
      offset += written;
    }
    fsyncSync(this.#fd);
    this.#bytes += bytes.length;
    this.#sequence++;
    if (dataEvent) this.#events++;
  }

  #close() {
    if (this.#fd === undefined) return;
    const fd = this.#fd;
    this.#fd = undefined;
    closeSync(fd);
  }

  #guard(action) {
    if (this.#failure) return;
    try {
      action();
    } catch (error) {
      this.#failure = true;
      try {
        this.#close();
      } catch {
        // The original write failure remains the diagnostic cause.
      }
      process.stderr.write(`Electronics failure evidence is incomplete: ${String(error)}\n`);
    }
  }

  #path(value, label, truncated) {
    if (typeof value !== 'string') return null;
    const path = relative(this.#root, resolve(this.#root, value));
    if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
      return '[outside repository]';
    return boundedText(path.split(sep).join('/'), 1024, label, truncated);
  }

  #error(error, label, truncated) {
    return {
      message: boundedText(error?.message, 8192, `${label}.message`, truncated),
      stack: boundedText(error?.stack, 8192, `${label}.stack`, truncated),
      value: boundedText(error?.value, 2048, `${label}.value`, truncated),
    };
  }

  #errorContext(value, label, truncated) {
    if (
      typeof value !== 'string' ||
      value.length > 4096 ||
      value.includes('\0') ||
      value.split(/[\\/]+/).includes('..')
    )
      return { status: 'rejected', reason: 'invalidPath' };
    const path = resolve(this.#root, value);
    if (basename(path) !== 'error-context.md')
      return { status: 'rejected', reason: 'unexpectedFileName' };
    const inside = relative(join(this.#root, 'reports', 'playwright'), path);
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
      return { status: 'rejected', reason: 'outsideContextDirectory' };
    // The Linux CI reader checks the opened descriptor's real destination too.
    // If this guard is unavailable, omit context instead of following a pathname race.
    if (process.platform !== 'linux' || !constants.O_NOFOLLOW || !constants.O_NONBLOCK)
      return { status: 'unavailable', reason: 'secureReadUnsupported' };
    try {
      let directory = this.#root;
      for (const segment of ['', ...relative(this.#root, dirname(path)).split(sep)]) {
        directory = join(directory, segment);
        if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory)
          return { status: 'rejected', reason: 'unsafeDirectory' };
      }
      const before = lstatSync(path);
      if (!before.isFile() || before.nlink !== 1 || !Number.isSafeInteger(before.size))
        return { status: 'rejected', reason: 'unsafeFile' };
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const opened = fstatSync(fd);
        const descriptorPath = `/proc/self/fd/${fd}`;
        if (
          !opened.isFile() ||
          opened.nlink !== 1 ||
          opened.dev !== before.dev ||
          opened.ino !== before.ino ||
          realpathSync(descriptorPath) !== path
        )
          return { status: 'rejected', reason: 'changedFile' };
        const bytes = Buffer.alloc(Math.min(opened.size, FAILURE_REPORT_CONTEXT_MAX_BYTES));
        let readBytes = 0;
        while (readBytes < bytes.length) {
          const count = readSync(fd, bytes, readBytes, bytes.length - readBytes, readBytes);
          if (!count) break;
          readBytes += count;
        }
        const after = fstatSync(fd);
        if (
          after.nlink !== 1 ||
          after.size !== opened.size ||
          after.mtimeMs !== opened.mtimeMs ||
          realpathSync(descriptorPath) !== path ||
          readBytes !== bytes.length
        )
          return { status: 'unavailable', reason: 'changedDuringRead' };
        const limited = opened.size > readBytes;
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: limited });
        if (limited) truncated.push(label);
        return {
          status: limited ? 'truncated' : 'captured',
          sourceBytes: opened.size,
          readBytes,
          textBytes: Buffer.byteLength(text),
          text,
        };
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      return {
        status: 'unavailable',
        reason: error.code === 'ENOENT' ? 'notFound' : 'readError',
        errorCode: typeof error.code === 'string' ? error.code.slice(0, 64) : null,
      };
    }
  }

  onBegin(_config, suite) {
    this.#guard(() => {
      this.#open();
      this.#write({ event: 'begin', expectedTestCount: suite.allTests().length }, true);
    });
  }

  onTestEnd(test, result) {
    this.#guard(() => {
      this.#open();
      this.#counts[status(result.status)]++;
      const truncated = [];
      const titles = test.titlePath();
      const errors = result.errors ?? [];
      const attachments = result.attachments ?? [];
      const unexpectedFailure =
        ['failed', 'timedOut', 'interrupted'].includes(result.status) &&
        result.status !== test.expectedStatus;
      this.#write(
        {
          event: 'testEnd',
          testId: boundedText(test.id, 512, 'testId', truncated),
          titlePath: titles
            .slice(0, 12)
            .map((title, index) => boundedText(title, 1024, `titlePath[${index}]`, truncated)),
          titleSegmentsOmitted: Math.max(0, titles.length - 12),
          location: {
            file: this.#path(test.location.file, 'location.file', truncated),
            line: finite(test.location.line),
            column: finite(test.location.column),
          },
          expectedStatus: status(test.expectedStatus),
          status: status(result.status),
          retry: finite(result.retry),
          durationMs: finite(result.duration),
          errors: errors
            .slice(0, MAX_ERRORS)
            .map((error, index) => this.#error(error, `errors[${index}]`, truncated)),
          errorsOmitted: Math.max(0, errors.length - MAX_ERRORS),
          attachments: attachments.slice(0, MAX_ATTACHMENTS).map((attachment, index) => ({
            name: boundedText(attachment.name, 256, `attachments[${index}].name`, truncated),
            contentType: boundedText(
              attachment.contentType,
              128,
              `attachments[${index}].contentType`,
              truncated,
            ),
            path: this.#path(attachment.path, `attachments[${index}].path`, truncated),
            ...(unexpectedFailure &&
            !this.#saturated &&
            attachment.name === 'error-context' &&
            attachment.contentType === 'text/markdown'
              ? {
                  errorContext: this.#errorContext(
                    attachment.path,
                    `attachments[${index}].errorContext.text`,
                    truncated,
                  ),
                }
              : {}),
          })),
          attachmentsOmitted: Math.max(0, attachments.length - MAX_ATTACHMENTS),
          truncated,
        },
        true,
      );
    });
  }

  onError(error) {
    this.#guard(() => {
      this.#open();
      this.#runnerErrors++;
      const truncated = [];
      this.#write(
        { event: 'runnerError', error: this.#error(error, 'error', truncated), truncated },
        true,
      );
    });
  }

  onEnd(result) {
    this.#guard(() => {
      this.#open();
      this.#write({
        event: 'end',
        status: ['passed', 'failed', 'timedout', 'interrupted'].includes(result.status)
          ? result.status
          : 'unknown',
        durationMs: finite(result.duration),
        observedAttemptCounts: this.#counts,
        runnerErrorCount: this.#runnerErrors,
        dataEventsOmitted: this.#omitted,
        evidenceLimited: this.#saturated,
      });
      this.#close();
    });
    // Playwright otherwise logs reporter exceptions without failing a green run.
    // Never replace an existing failed/timed-out/interrupted test outcome.
    if (this.#failure && result.status === 'passed') return { status: 'failed' };
  }

  onExit() {
    this.#guard(() => this.#close());
  }

  printsToStdio() {
    return false;
  }
}
