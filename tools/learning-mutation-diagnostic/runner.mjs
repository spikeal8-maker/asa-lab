// Read-only evidence for TASK-PROJ-PUBLICATION-LEARNING-MUTATION-EVIDENCE-001.
// This is not an abuse-protection repair. No request body or raw subprocess output
// is a deliverable. The product checkout, workflow and assertions stay unchanged.
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { constants as osConstants } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

export const TESTED_PRODUCT_SHA = '4343b88b788f02a279fd18df3789582994cb6b9e';
export const EXPECTED_SUITES = Object.freeze({
  'learning-author-preview': 7,
  'learning-course-01': 14,
  'courses-sharing': 2,
});
export const FIRST_BATCH = Object.freeze([
  'e2e/learning-author-preview.spec.ts',
  'e2e/learning-course-01.spec.ts',
  'e2e/courses-sharing.spec.ts',
]);
export const MAX_LINE_BYTES = 32 * 1024;
export const MAX_REQUESTS = 100_000;
export const ROUTE_CATEGORIES = Object.freeze([
  'auth-login',
  'auth-other',
  'diagnostics-quality',
  'diagnostics-client',
  'analytics-visits',
  'analytics-module-session',
  'analytics-other',
  'runtime',
  'projects',
  'classrooms',
  'courses',
  'learning',
  'health',
  'static',
  'other',
]);
export const FAULT_CODES = Object.freeze([
  'RAW_LINE_TOO_LONG',
  'TRUNCATED_LINE',
  'MALFORMED_HTTP',
  'UNEXPECTED_HTTP',
  'INVALID_HTTP_FIELD',
  'REQUEST_LIMIT',
  'DUPLICATE_START',
  'DUPLICATE_TERMINAL',
  'MISSING_START',
  'MISMATCHED_TERMINAL',
  'MISSING_TERMINAL',
  'NO_HTTP_CAPTURE',
  'INVALID_EVENT',
  'EVENT_AFTER_COMPLETE',
  'MISSING_HELLO',
  'MISSING_COMPLETE',
  'MATRIX_MISMATCH',
  'MATRIX_INCOMPLETE',
  'REPORTER_ERROR',
  'REPORTER_CHANNEL',
  'RAW_OUTPUT_LIMIT',
  'PROTOCOL_OUTPUT_LIMIT',
  'SPAWN_FAILED',
  'PIPE_ERROR',
  'RUNNER_INTERRUPTED',
]);
const METHODS = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'TRACE',
  'CONNECT',
]);
const TEST_STATUSES = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const RUN_STATUSES = new Set(['passed', 'failed', 'timedout', 'interrupted']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;

export function faultSet() {
  const values = new Set();
  return {
    add: (code) => values.add(FAULT_CODES.includes(code) ? code : 'INVALID_EVENT'),
    list: () => [...values].sort(),
  };
}

export function validTimestamp(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function integer(value, maximum = MAX_REQUESTS) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

// Fixed categories follow app.factory.ts, blocks-runtime-transport.ts and the
// analytics v1/v2 controllers at TESTED_PRODUCT_SHA. In particular /v2/events is
// visit.observed; runtime mutations bypass the common mutation guard. GET, HEAD
// and OPTIONS are distinguishable by method, not counted as common mutations.
export function routeCategory(rawPath) {
  if (
    typeof rawPath !== 'string' ||
    rawPath.length > 8192 ||
    !rawPath.startsWith('/') ||
    /[\u0000-\u0020\u007f]/.test(rawPath)
  ) {
    return null;
  }
  const path = rawPath.split('?')[0];
  if (path.startsWith('/api/blocks/runtime/')) return 'runtime';
  if (path === '/api/auth/login') return 'auth-login';
  if (path === '/api/diagnostics/quality') return 'diagnostics-quality';
  if (path === '/api/diagnostics/client') return 'diagnostics-client';
  if (path === '/api/analytics/v2/events') return 'analytics-visits';
  if (
    path === '/api/analytics/v2/module-session' ||
    /^\/api\/analytics\/v1\/module-session\/(?:start|touch)$/.test(path)
  ) {
    return 'analytics-module-session';
  }
  if (path.startsWith('/api/analytics/')) return 'analytics-other';
  if (/^\/api\/(?:projects|project-versions)(?:\/|$)/.test(path)) return 'projects';
  if (/^\/api\/(?:classroom[^/]*|class-join)(?:\/|$)/.test(path)) return 'classrooms';
  if (/^\/api\/courses(?:\/|$)/.test(path)) return 'courses';
  if (/^\/api\/(?:learning|assignments)(?:\/|$)/.test(path)) return 'learning';
  if (/^\/api\/(?:auth|account|session|workspaces|capabilities)(?:\/|$)/.test(path)) {
    return 'auth-other';
  }
  if (path.startsWith('/health/')) return 'health';
  if (/^\/(?:assets|internal\/blocks)(?:\/|$)/.test(path) || path === '/') return 'static';
  return 'other';
}

// No unbounded concatenation, including an oversized line without a newline.
// The decoder also handles UTF-8 bytes split across chunks. ANSI is stripped only
// after a whole line has been assembled, so split control sequences cannot leak.
export class BoundedLines {
  constructor(onLine, onFault, maximum = MAX_LINE_BYTES) {
    this.onLine = onLine;
    this.onFault = onFault;
    this.maximum = maximum;
    this.decoder = new StringDecoder('utf8');
    this.pending = '';
    this.discarding = false;
    this.ended = false;
  }

  push(chunk) {
    if (this.ended) return this.onFault('EVENT_AFTER_COMPLETE');
    const value = Buffer.isBuffer(chunk) ? this.decoder.write(chunk) : String(chunk);
    this.consume(value);
  }

  consume(value) {
    let offset = 0;
    while (offset < value.length) {
      const newline = value.indexOf('\n', offset);
      const end = newline === -1 ? value.length : newline;
      const length = end - offset;
      if (!this.discarding) {
        if (
          length > this.maximum ||
          Buffer.byteLength(this.pending) + Buffer.byteLength(value.slice(offset, end)) >
            this.maximum
        ) {
          this.pending = '';
          this.discarding = true;
          this.onFault('RAW_LINE_TOO_LONG');
        } else {
          this.pending += value.slice(offset, end);
        }
      }
      if (newline === -1) break;
      if (!this.discarding) this.onLine(stripVTControlCharacters(this.pending).replace(/\r$/, ''));
      this.pending = '';
      this.discarding = false;
      offset = newline + 1;
    }
  }

  finish() {
    if (this.ended) return;
    this.consume(this.decoder.end());
    if (this.pending.length || this.discarding) this.onFault('TRUNCATED_LINE');
    this.pending = '';
    this.ended = true;
  }
}

export class HttpCapture {
  constructor(emit) {
    this.emit = emit;
    this.faults = faultSet();
    this.pending = new Map();
    this.finished = new Set();
    this.startedCount = 0;
    this.terminalCount = 0;
    this.disconnectedCount = 0;
    this.lines = new BoundedLines(
      (line) => this.line(line),
      (code) => this.faults.add(code),
    );
  }

  webServerChunk(chunk) {
    // Playwright 1.55.1 prefixOutputLines adds this prefix to EVERY chunk and
    // every physical line, including a continuation of a split JSON record.
    const input = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    if (typeof input !== 'string') return this.faults.add('INVALID_HTTP_FIELD');
    const prefix = /^(?:\u001b\[2m)?\[WebServer\] (?:\u001b\[22m)?/gm;
    if (!/^(?:\u001b\[2m)?\[WebServer\] /.test(input)) return;
    this.lines.push(input.replace(prefix, ''));
  }

  line(line) {
    if (!line.trim()) return;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      if (line.includes('http_') || line.trimStart().startsWith('{')) {
        this.faults.add('MALFORMED_HTTP');
      }
      return;
    }
    if (!value || typeof value.kind !== 'string' || !value.kind.startsWith('http_')) return;
    if (!['http_request_started', 'http_response', 'http_request_ended'].includes(value.kind)) {
      return this.faults.add('UNEXPECTED_HTTP');
    }
    const category = routeCategory(value.path);
    if (
      !category ||
      !METHODS.has(value.method) ||
      !validTimestamp(value.time) ||
      typeof value.requestId !== 'string' ||
      !UUID.test(value.requestId)
    ) {
      return this.faults.add('INVALID_HTTP_FIELD');
    }
    const record = {
      method: value.method,
      routecategory: category,
      status: null,
      timestamp: value.time,
      requestId: value.requestId,
    };
    if (value.kind === 'http_request_started') {
      if (this.pending.has(record.requestId) || this.finished.has(record.requestId)) {
        return this.faults.add('DUPLICATE_START');
      }
      if (this.pending.size + this.finished.size >= MAX_REQUESTS) {
        return this.faults.add('REQUEST_LIMIT');
      }
      this.pending.set(record.requestId, record);
      this.startedCount++;
      return;
    }
    if (value.kind === 'http_response') {
      if (!Number.isInteger(value.status) || value.status < 100 || value.status > 599) {
        return this.faults.add('INVALID_HTTP_FIELD');
      }
      record.status = value.status;
    } else if (!['request_aborted', 'connection_closed'].includes(value.outcome)) {
      return this.faults.add('INVALID_HTTP_FIELD');
    }
    if (this.finished.has(record.requestId)) return this.faults.add('DUPLICATE_TERMINAL');
    if (this.finished.size >= MAX_REQUESTS) return this.faults.add('REQUEST_LIMIT');
    const started = this.pending.get(record.requestId);
    const path = value.path.split('?')[0];
    // app.factory intentionally omits starts for static/health and client
    // diagnostics, but it emits a terminal observation for every request.
    if (path.startsWith('/api/') && path !== '/api/diagnostics/client' && !started) {
      this.faults.add('MISSING_START');
    }
    if (
      started &&
      (started.method !== record.method ||
        started.routecategory !== record.routecategory ||
        started.timestamp > record.timestamp)
    ) {
      this.faults.add('MISMATCHED_TERMINAL');
    }
    this.pending.delete(record.requestId);
    this.finished.add(record.requestId);
    this.terminalCount++;
    if (record.status === null) this.disconnectedCount++;
    // The API start timestamp is closest to the guard's observation, before any
    // slow request work. Static/health and client diagnostics have no start log,
    // so only their terminal timestamp is available. JSONL arrival order remains
    // terminal order. A null status is a captured disconnect, not a rollback.
    if (started) record.timestamp = started.timestamp;
    this.emit(record);
  }

  finish() {
    this.lines.finish();
    if (this.pending.size) this.faults.add('MISSING_TERMINAL');
    if (!this.startedCount || !this.terminalCount) this.faults.add('NO_HTTP_CAPTURE');
    return {
      faults: this.faults.list(),
      httpStarted: this.startedCount,
      httpFinished: this.terminalCount,
      httpDisconnected: this.disconnectedCount,
    };
  }
}

export class ProtocolCapture {
  constructor(onHttp = () => {}) {
    this.onHttp = onHttp;
    this.faults = faultSet();
    this.hello = false;
    this.complete = false;
    this.matrix = [];
    this.httpIds = new Set();
    this.login429 = 0;
    this.disconnected = 0;
    this.runStatus = null;
    this.lines = new BoundedLines(
      (line) => this.line(line),
      (code) => this.faults.add(code),
      4096,
    );
  }

  line(line) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return this.faults.add('INVALID_EVENT');
    }
    if (this.complete) return this.faults.add('EVENT_AFTER_COMPLETE');
    if (!this.hello) {
      if (
        !exactKeys(event, ['type', 'protocol']) ||
        event.type !== 'hello' ||
        event.protocol !== 1
      ) {
        return this.faults.add('MISSING_HELLO');
      }
      this.hello = true;
      return;
    }
    switch (event?.type) {
      case 'http': {
        if (
          !exactKeys(event, [
            'type',
            'method',
            'routecategory',
            'status',
            'timestamp',
            'requestId',
          ]) ||
          !METHODS.has(event.method) ||
          !ROUTE_CATEGORIES.includes(event.routecategory) ||
          !(
            event.status === null ||
            (Number.isInteger(event.status) && event.status >= 100 && event.status <= 599)
          ) ||
          !validTimestamp(event.timestamp) ||
          typeof event.requestId !== 'string' ||
          !UUID.test(event.requestId)
        ) {
          return this.faults.add('INVALID_EVENT');
        }
        if (this.httpIds.has(event.requestId)) return this.faults.add('DUPLICATE_TERMINAL');
        if (this.httpIds.size >= MAX_REQUESTS) return this.faults.add('REQUEST_LIMIT');
        this.httpIds.add(event.requestId);
        if (event.routecategory === 'auth-login' && event.status === 429) this.login429++;
        if (event.status === null) this.disconnected++;
        this.onHttp({
          method: event.method,
          routecategory: event.routecategory,
          status: event.status,
          timestamp: event.timestamp,
          requestId: event.requestId,
        });
        return;
      }
      case 'matrix': {
        if (
          !exactKeys(event, ['type', 'cases']) ||
          !Array.isArray(event.cases) ||
          event.cases.length !== 23 ||
          this.matrix.length
        ) {
          return this.faults.add('MATRIX_MISMATCH');
        }
        const counts = Object.fromEntries(Object.keys(EXPECTED_SUITES).map((suite) => [suite, 0]));
        for (const [index, item] of event.cases.entries()) {
          if (
            !exactKeys(item, ['ordinal', 'suite']) ||
            item.ordinal !== index + 1 ||
            !Object.hasOwn(counts, item.suite)
          ) {
            return this.faults.add('MATRIX_MISMATCH');
          }
          counts[item.suite]++;
        }
        if (Object.keys(counts).some((suite) => counts[suite] !== EXPECTED_SUITES[suite])) {
          return this.faults.add('MATRIX_MISMATCH');
        }
        this.matrix = event.cases.map((item) => ({
          ordinal: item.ordinal,
          suite: item.suite,
          startedAt: null,
          finishedAt: null,
          status: 'NOT_RUN',
          durationMs: null,
        }));
        return;
      }
      case 'test-begin': {
        const row = this.matrix[event.ordinal - 1];
        if (
          !exactKeys(event, ['type', 'ordinal', 'timestamp']) ||
          !integer(event.ordinal, 23) ||
          !row ||
          row.startedAt ||
          !validTimestamp(event.timestamp)
        ) {
          return this.faults.add('MATRIX_MISMATCH');
        }
        row.startedAt = event.timestamp;
        return;
      }
      case 'test-end': {
        const row = this.matrix[event.ordinal - 1];
        if (
          !exactKeys(event, [
            'type',
            'ordinal',
            'timestamp',
            'status',
            'durationMs',
            'retry',
            'expectedStatus',
          ]) ||
          !integer(event.ordinal, 23) ||
          !row ||
          !row.startedAt ||
          row.finishedAt ||
          !validTimestamp(event.timestamp) ||
          event.timestamp < row.startedAt ||
          !TEST_STATUSES.has(event.status) ||
          !integer(event.durationMs, 86_400_000) ||
          event.retry !== 0 ||
          event.expectedStatus !== 'passed'
        ) {
          return this.faults.add('MATRIX_MISMATCH');
        }
        row.finishedAt = event.timestamp;
        row.status = event.status;
        row.durationMs = event.durationMs;
        return;
      }
      case 'end':
        if (
          !exactKeys(event, ['type', 'status']) ||
          !RUN_STATUSES.has(event.status) ||
          this.runStatus
        ) {
          return this.faults.add('INVALID_EVENT');
        }
        this.runStatus = event.status;
        return;
      case 'complete': {
        if (
          !exactKeys(event, [
            'type',
            'faults',
            'httpStarted',
            'httpFinished',
            'httpDisconnected',
            'globalErrors',
          ]) ||
          !Array.isArray(event.faults) ||
          event.faults.length > FAULT_CODES.length ||
          event.faults.some((code) => !FAULT_CODES.includes(code)) ||
          !integer(event.httpStarted) ||
          !integer(event.httpFinished) ||
          !integer(event.httpDisconnected) ||
          !integer(event.globalErrors)
        ) {
          return this.faults.add('INVALID_EVENT');
        }
        event.faults.forEach((code) => this.faults.add(code));
        if (!event.httpStarted || !event.httpFinished) this.faults.add('NO_HTTP_CAPTURE');
        if (
          event.httpFinished !== this.httpIds.size ||
          event.httpDisconnected !== this.disconnected
        ) {
          this.faults.add('MISSING_TERMINAL');
        }
        if (event.globalErrors) this.faults.add('REPORTER_ERROR');
        this.complete = true;
        return;
      }
      default:
        this.faults.add('INVALID_EVENT');
    }
  }

  finish() {
    this.lines.finish();
    if (!this.hello) this.faults.add('MISSING_HELLO');
    if (!this.complete || !this.runStatus) this.faults.add('MISSING_COMPLETE');
    if (
      this.matrix.length !== 23 ||
      this.matrix.some(
        (row) => !row.finishedAt || ['skipped', 'interrupted', 'NOT_RUN'].includes(row.status),
      )
    ) {
      this.faults.add('MATRIX_INCOMPLETE');
    }
    const counts = Object.fromEntries(
      ['passed', 'failed', 'timedOut', 'skipped', 'interrupted', 'NOT_RUN'].map((status) => [
        status,
        0,
      ]),
    );
    this.matrix.forEach((row) => counts[row.status]++);
    const faults = this.faults.list();
    return {
      capture: faults.length ? 'FAIL' : 'COMPLETE',
      reproduction: faults.length
        ? 'INCOMPLETE_CAPTURE'
        : this.login429
          ? 'REPRODUCED'
          : 'NOT_REPRODUCED',
      faults,
      expectedCases: 23,
      observedCases: this.matrix.length,
      counts,
      cases: this.matrix,
      reporterStatus: this.runStatus,
      httpObservations: this.httpIds.size,
      disconnectedObservations: this.disconnected,
      login429Observations: this.login429,
      countMeaning: 'OBSERVED_HTTP_ONLY',
      timestampMeaning: 'API_START_OTHER_TERMINAL',
      limiterState: 'NOT_OBSERVED',
      secondBatch: 'NOT_RUN',
      repairAcceptance: 'NOT_EVALUATED',
    };
  }
}

function safeSignal(signal) {
  return signal === null ? null : Object.hasOwn(osConstants.signals, signal) ? signal : 'OTHER';
}

export async function runPrivate(command, args, options = {}) {
  const faults = faultSet();
  const totals = { stdoutBytes: 0, stderrBytes: 0, protocolBytes: 0 };
  const rawLimit = options.rawLimit ?? 64 * 1024 * 1024;
  const protocolLimit = options.protocolLimit ?? 32 * 1024 * 1024;
  return await new Promise((resolveRun) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe', ...(options.protocol ? ['pipe'] : [])],
        shell: false,
      });
    } catch {
      return resolveRun({ code: null, signal: null, faults: ['SPAWN_FAILED'], ...totals });
    }
    const stop = (code) => {
      faults.add(code);
      child.kill('SIGTERM');
    };
    for (const [stream, key] of [
      [child.stdout, 'stdoutBytes'],
      [child.stderr, 'stderrBytes'],
    ]) {
      stream.on('data', (chunk) => {
        // Do not decode, accumulate, write, forward or include raw bytes in errors.
        totals[key] += chunk.length;
        if (totals[key] > rawLimit) stop('RAW_OUTPUT_LIMIT');
      });
      stream.on('error', () => stop('PIPE_ERROR'));
    }
    if (options.protocol) {
      child.stdio[3].on('data', (chunk) => {
        totals.protocolBytes += chunk.length;
        if (totals.protocolBytes > protocolLimit) stop('PROTOCOL_OUTPUT_LIMIT');
        else {
          try {
            options.protocol.lines.push(chunk);
          } catch {
            stop('PIPE_ERROR');
          }
        }
      });
      child.stdio[3].on('error', () => stop('PIPE_ERROR'));
    }
    const relay = (signal) => {
      faults.add('RUNNER_INTERRUPTED');
      child.kill(signal);
    };
    const interrupt = () => relay('SIGINT');
    const terminate = () => relay('SIGTERM');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    child.on('error', () => faults.add('SPAWN_FAILED'));
    child.on('close', (code, signal) => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      resolveRun({
        code: integer(code, 255) ? code : null,
        signal: safeSignal(signal),
        faults: faults.list(),
        ...totals,
      });
    });
  });
}

export function childSucceeded(result) {
  return result.code === 0 && result.signal === null && result.faults.length === 0;
}

export function diagnosticSucceeded(result, evidence) {
  return (
    childSucceeded(result) &&
    evidence.capture === 'COMPLETE' &&
    evidence.reporterStatus === 'passed' &&
    evidence.counts.passed === 23
  );
}

export function browserEnvironment(environment) {
  const result = { ...environment, ASA_HTTP_LOG: '1', DEBUG: 'pw:webserver' };
  // PW_TEST_REPORTER can inject another reporter; NODE_OPTIONS can inject code
  // before our reporter loads. None are needed by the pinned original command.
  for (const key of ['VITEST', 'PWDEBUG', 'PW_TEST_REPORTER', 'NODE_OPTIONS', 'NODE_V8_COVERAGE'])
    delete result[key];
  return result;
}

export function browserArguments(reporterPath) {
  return [
    'test',
    ...FIRST_BATCH,
    '--workers=1',
    '--retries=0',
    '--trace=off',
    `--reporter=${reporterPath}`,
  ];
}

function checkedGit(directory, args, expected) {
  const result = spawnSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    maxBuffer: 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || result.signal || result.error || result.stdout.trim() !== expected)
    throw new Error('IDENTITY_FAILED');
  return expected;
}

function cleanCheckout(directory, expected) {
  const actual = checkedGit(directory, ['rev-parse', 'HEAD'], expected);
  checkedGit(directory, ['status', '--porcelain', '--untracked-files=no'], '');
  return actual;
}

const STAGES = [
  'identities',
  'install',
  'harness',
  'chromium-install',
  'build',
  'migrations',
  'restricted-role',
  'learning-unit-pg',
  'scratch-build',
  'scratch-start',
  'scratch-ready',
  'browser-first-batch',
  'scratch-cleanup',
];

export async function main(argv = process.argv.slice(2)) {
  let output;
  let report;
  let httpFd;
  let cleanup = false;
  let source;
  let env;
  let exitCode = 1;
  const emitStage = (stage, status) =>
    process.stdout.write(`${JSON.stringify({ stage, status })}\n`);
  const save = () => {
    if (report && output)
      writeFileSync(join(output, 'metadata.json'), `${JSON.stringify(report, null, 2)}\n`, {
        mode: 0o600,
      });
  };
  const stage = async (name, command, args, extra = {}) => {
    const row = report.stages.find((item) => item.stage === name);
    row.status = 'RUNNING';
    save();
    emitStage(name, row.status);
    const result = await runPrivate(command, args, { cwd: source, env, ...extra });
    Object.assign(row, result, { status: childSucceeded(result) ? 'PASS' : 'FAIL' });
    save();
    emitStage(name, row.status);
    return result;
  };
  try {
    if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('CI_ONLY');
    const names = ['--source', '--diagnostic', '--diagnostic-sha', '--output'];
    if (argv.length !== 8 || names.some((name, index) => argv[index * 2] !== name))
      throw new Error('ARGUMENTS_INVALID');
    source = realpathSync(argv[1]);
    const diagnostic = realpathSync(argv[3]);
    const diagnosticSha = argv[5];
    output = resolve(argv[7]);
    const workspace = realpathSync(process.env.GITHUB_WORKSPACE);
    if (
      !SHA.test(diagnosticSha) ||
      source === diagnostic ||
      output !== join(workspace, 'sanitized-learning-mutation') ||
      !isAbsolute(output)
    )
      throw new Error('ARGUMENTS_INVALID');
    for (const checkout of [source, diagnostic]) {
      const within = relative(workspace, checkout);
      if (!within || within.startsWith('..') || isAbsolute(within))
        throw new Error('ARGUMENTS_INVALID');
    }
    mkdirSync(output, { mode: 0o700 });
    httpFd = openSync(join(output, 'http.jsonl'), 'wx', 0o600);
    report = {
      format: 'asa-learning-mutation-evidence-v1',
      expectedProductSha: TESTED_PRODUCT_SHA,
      expectedDiagnosticSha: diagnosticSha,
      testedProductSha: null,
      diagnosticSha: null,
      status: 'RUNNING',
      stages: STAGES.map((name) => ({ stage: name, status: 'NOT_RUN' })),
      browser: { capture: 'NOT_RUN', secondBatch: 'NOT_RUN', repairAcceptance: 'NOT_EVALUATED' },
    };
    save();
    const identity = report.stages[0];
    identity.status = 'RUNNING';
    emitStage('identities', 'RUNNING');
    report.testedProductSha = cleanCheckout(source, TESTED_PRODUCT_SHA);
    report.diagnosticSha = cleanCheckout(diagnostic, diagnosticSha);
    if (process.versions.node.split('.')[0] !== '22') throw new Error('IDENTITY_FAILED');
    const pnpmVersion = spawnSync('pnpm', ['--version'], {
      cwd: source,
      encoding: 'utf8',
      maxBuffer: 128,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (
      pnpmVersion.status !== 0 ||
      pnpmVersion.signal ||
      pnpmVersion.error ||
      pnpmVersion.stdout.trim() !== '9.15.9'
    )
      throw new Error('IDENTITY_FAILED');
    for (const [key, user] of [
      ['TEST_DATABASE_URL', 'postgres'],
      ['MIGRATION_DATABASE_URL', 'postgres'],
      ['APP_TEST_DATABASE_URL', 'asalab_app'],
    ]) {
      const url = new URL(process.env[key]);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        url.port !== '5432' ||
        url.pathname !== '/asa_learning_e1_test' ||
        url.username !== user
      )
        throw new Error('IDENTITY_FAILED');
    }
    identity.status = 'PASS';
    emitStage('identities', 'PASS');
    env = { ...process.env };
    delete env.PWDEBUG;
    const requireFromSource = createRequire(join(source, 'package.json'));
    const preparation = [
      ['install', 'pnpm', ['install', '--frozen-lockfile']],
      [
        'harness',
        process.execPath,
        ['--test', join(diagnostic, 'tools/learning-mutation-diagnostic/harness.spec.mjs')],
        // The integration regression must load the real pinned Playwright from
        // the distinct tested-product checkout, after its frozen install.
        { env: { ...env, ASA_LEARNING_DIAGNOSTIC_SOURCE: source } },
      ],
      ['chromium-install', 'pnpm', ['exec', 'playwright', 'install', '--with-deps', 'chromium']],
      ['build', 'pnpm', ['build']],
      ['migrations', 'pnpm', ['db:migrate']],
      [
        'restricted-role',
        'psql',
        [
          env.TEST_DATABASE_URL,
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          "ALTER ROLE asalab_app WITH LOGIN PASSWORD 'learning-e1-ci-isolated-test'",
        ],
      ],
      ['learning-unit-pg', 'pnpm', ['test:learning-e1']],
      [
        'scratch-build',
        'docker',
        [
          'build',
          '-f',
          'infra/scratch-editor/Dockerfile',
          '--build-arg',
          `ASA_BUILD_REVISION=${TESTED_PRODUCT_SHA}`,
          '--build-arg',
          'ASA_BLOCKS_PARENT_ORIGIN=http://127.0.0.1:4612',
          '-t',
          'asa-lab-scratch-editor:learning-mutation-diagnostic',
          '.',
        ],
      ],
    ];
    for (const [name, command, args, extra] of preparation) {
      if (!childSucceeded(await stage(name, command, args, extra))) throw new Error('STAGE_FAILED');
    }
    cleanup = true;
    if (
      !childSucceeded(
        await stage('scratch-start', 'docker', [
          'run',
          '-d',
          '--name',
          'asa-lab-scratch-editor-learning-mutation-diagnostic',
          '--user',
          '101:101',
          '--read-only',
          '--tmpfs',
          '/var/cache/nginx:uid=101,gid=101,mode=0700,size=64m',
          '--tmpfs',
          '/var/run:uid=101,gid=101,mode=0700,size=8m',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges:true',
          '-p',
          '127.0.0.1:4613:8080',
          'asa-lab-scratch-editor:learning-mutation-diagnostic',
        ]),
      )
    )
      throw new Error('STAGE_FAILED');
    // Preserve the original workflow's 30 one-second readiness probes. No
    // browser retry, test timeout, limiter setting or server config is changed.
    const health =
      'for attempt in $(seq 1 30); do if curl --fail --silent --show-error http://127.0.0.1:4613/healthz; then break; fi; sleep 1; done; curl --fail --silent --show-error http://127.0.0.1:4613/healthz';
    if (!childSucceeded(await stage('scratch-ready', 'bash', ['-c', health])))
      throw new Error('STAGE_FAILED');
    cleanCheckout(source, TESTED_PRODUCT_SHA);
    cleanCheckout(diagnostic, diagnosticSha);
    const packagePath = requireFromSource.resolve('@playwright/test/package.json');
    if (JSON.parse(readFileSync(packagePath, 'utf8')).version !== '1.55.1')
      throw new Error('IDENTITY_FAILED');
    const capture = new ProtocolCapture((record) =>
      writeSync(httpFd, `${JSON.stringify(record)}\n`),
    );
    // Invoke exactly the locally installed Playwright CLI. pnpm exec is a
    // wrapper that need not preserve FD3; direct node retains the private pipe.
    const result = await stage(
      'browser-first-batch',
      process.execPath,
      [
        join(dirname(packagePath), 'cli.js'),
        ...browserArguments(join(diagnostic, 'tools/learning-mutation-diagnostic/reporter.mjs')),
      ],
      {
        env: browserEnvironment({
          ...env,
          ASA_WEB_PORT: '4612',
          ASA_WEB_ORIGIN: 'http://127.0.0.1:4612',
          ASA_BLOCKS_RUNTIME_ORIGIN: 'http://127.0.0.1:4612',
          ASA_BLOCKS_UPSTREAM_ORIGIN: 'http://127.0.0.1:4613',
        }),
        protocol: capture,
      },
    );
    result.faults.forEach((code) => capture.faults.add(code));
    report.browser = capture.finish();
    save();
    exitCode = diagnosticSucceeded(result, report.browser) ? 0 : 1;
  } catch {
    // Never serialize the thrown error, its message, command, arguments or stack.
    if (report) for (const row of report.stages) if (row.status === 'RUNNING') row.status = 'FAIL';
    exitCode = 1;
  } finally {
    if (cleanup) {
      const result = await stage('scratch-cleanup', 'docker', [
        'rm',
        '-f',
        'asa-lab-scratch-editor-learning-mutation-diagnostic',
      ]);
      if (!childSucceeded(result)) exitCode = 1;
    }
    if (report) {
      report.status = exitCode === 0 ? 'COMPLETE' : 'FAIL';
      report.exitCode = exitCode;
      save();
    }
    if (httpFd !== undefined) closeSync(httpFd);
    emitStage('diagnostic', exitCode === 0 ? 'COMPLETE' : 'FAIL');
  }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.stdout.write('{"stage":"diagnostic","status":"FAIL"}\n');
      process.exitCode = 1;
    });
}
