import { writeSync } from 'node:fs';
import { basename } from 'node:path';
import { EXPECTED_SUITES, HttpCapture, faultSet, validTimestamp } from './runner.mjs';

// Playwright 1.55.1 WebServerPlugin forwards prefixed stdout when
// DEBUG=pw:webserver. Its own debug output bypasses reporters, so runner.mjs
// captures BOTH ordinary pipes as well as this dedicated, revalidated FD3.
export default class MutationEvidenceReporter {
  constructor(options = {}) {
    this.send = options.diagnosticEmit ?? ((event) => writeSync(3, `${JSON.stringify(event)}\n`));
    this.faults = faultSet();
    this.ordinals = new WeakMap();
    this.globalErrors = 0;
    this.ended = false;
    this.capture = new HttpCapture((record) => this.emit({ type: 'http', ...record }));
    this.emit({ type: 'hello', protocol: 1 });
  }

  emit(event) {
    try {
      this.send(event);
    } catch {
      this.faults.add('REPORTER_CHANNEL');
    }
  }

  printsToStdio() {
    // Returning false makes Playwright automatically add a raw dot reporter.
    // Claim the output role while emitting exclusively into the private FD3.
    return true;
  }

  version() {
    // Playwright's V1 adapter retains raw stdout/stderr/errors until onBegin.
    // Opt into V2 so even web-server startup output reaches our bounded sink
    // immediately, before test discovery completes.
    return 'v2';
  }

  onBegin(suite) {
    const tests = suite.allTests();
    if (tests.length !== 23) this.faults.add('MATRIX_MISMATCH');
    const cases = tests.slice(0, 23).map((test, index) => {
      const suiteName = basename(test.location.file).replace(/\.spec\.ts$/, '');
      const ordinal = index + 1;
      this.ordinals.set(test, ordinal);
      if (!Object.hasOwn(EXPECTED_SUITES, suiteName)) this.faults.add('MATRIX_MISMATCH');
      return { ordinal, suite: Object.hasOwn(EXPECTED_SUITES, suiteName) ? suiteName : 'unknown' };
    });
    this.emit({ type: 'matrix', cases });
  }

  onTestBegin(test, result) {
    const ordinal = this.ordinals.get(test);
    if (!ordinal) return this.faults.add('MATRIX_MISMATCH');
    const timestamp =
      result.startTime instanceof Date && Number.isFinite(result.startTime.getTime())
        ? result.startTime.toISOString()
        : null;
    if (!validTimestamp(timestamp)) return this.faults.add('INVALID_EVENT');
    this.emit({ type: 'test-begin', ordinal, timestamp });
  }

  onTestEnd(test, result) {
    const ordinal = this.ordinals.get(test);
    if (!ordinal) return this.faults.add('MATRIX_MISMATCH');
    if (
      !['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(result.status) ||
      !Number.isSafeInteger(result.duration) ||
      result.duration < 0 ||
      result.duration > 86_400_000 ||
      result.retry !== 0 ||
      test.expectedStatus !== 'passed'
    )
      return this.faults.add('INVALID_EVENT');
    // Never inspect result.error(s), attachments, steps, stdout/stderr, title or
    // the full test ID. The parent accepts only the fixed matrix schema below.
    this.emit({
      type: 'test-end',
      ordinal,
      timestamp: new Date().toISOString(),
      status: result.status,
      durationMs: result.duration,
      retry: result.retry,
      expectedStatus: test.expectedStatus,
    });
  }

  onStdOut(chunk, test) {
    if (!test) this.capture.webServerChunk(chunk);
  }

  onStdErr() {
    // Raw server/test error text is intentionally neither retained nor emitted.
  }

  onError() {
    this.globalErrors = Math.min(this.globalErrors + 1, 100_000);
    this.faults.add('REPORTER_ERROR');
  }

  onEnd(result) {
    this.ended = true;
    if (!['passed', 'failed', 'timedout', 'interrupted'].includes(result.status)) {
      return this.faults.add('INVALID_EVENT');
    }
    this.emit({ type: 'end', status: result.status });
    // Never replace the test runner's failed status with success.
  }

  onExit() {
    if (!this.ended) this.faults.add('MISSING_COMPLETE');
    const summary = this.capture.finish();
    this.faults.list().forEach((code) => this.capture.faults.add(code));
    this.emit({
      type: 'complete',
      ...summary,
      faults: this.capture.faults.list(),
      globalErrors: this.globalErrors,
    });
  }
}
