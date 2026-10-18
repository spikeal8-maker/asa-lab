import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  BoundedLines,
  EXPECTED_SUITES,
  FIRST_BATCH,
  HttpCapture,
  MAX_LINE_BYTES,
  ProtocolCapture,
  TESTED_PRODUCT_SHA,
  browserArguments,
  browserEnvironment,
  childSucceeded,
  diagnosticSucceeded,
  faultSet,
  routeCategory,
  runPrivate,
} from './runner.mjs';
import MutationEvidenceReporter from './reporter.mjs';

// Synthetic sentinels only. Assertions report booleans/counts/fixed codes, never
// raw chunks or raw error objects, even if a privacy regression makes a test fail.
const PRIVATE = 'SYNTHETIC_PRIVATE_COOKIE_BODY_QUERY';
const WHEN = '2026-10-18T00:00:00.000Z';
const id = (number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
const prefix = (value) => {
  const lines = value.split('\n');
  const finalNewline = value.endsWith('\n');
  if (finalNewline) lines.pop();
  return (
    lines.map((line) => `\u001b[2m[WebServer] \u001b[22m${line}`).join('\n') +
    (finalNewline ? '\n' : '')
  );
};

function raw(kind, number = 1, extra = {}) {
  return {
    time: WHEN,
    kind,
    requestId: id(number),
    revision: 'development',
    method: 'POST',
    path: `/api/auth/login?credential=${PRIVATE}`,
    ...(kind === 'http_response' ? { status: 200 } : {}),
    headers: { cookie: PRIVATE, authorization: PRIVATE },
    body: PRIVATE,
    addressResolution: { source: PRIVATE },
    ...extra,
  };
}

function pair(capture, number = 1, extra = {}) {
  capture.webServerChunk(prefix(`${JSON.stringify(raw('http_request_started', number, extra))}\n`));
  capture.webServerChunk(prefix(`${JSON.stringify(raw('http_response', number, extra))}\n`));
}

function noLeak(value) {
  const text = JSON.stringify(value);
  assert.equal(text.includes(PRIVATE), false, 'No private sentinel may be persisted');
  for (const forbidden of [
    'authorization',
    'headers',
    'cookie',
    'body',
    '?credential=',
    'errorMessage',
  ]) {
    assert.equal(
      text.includes(forbidden),
      false,
      'Only allowlisted output fields may be persisted',
    );
  }
}

function matrixCases() {
  return Object.entries(EXPECTED_SUITES)
    .flatMap(([suite, count]) => Array.from({ length: count }, () => ({ suite })))
    .map((item, index) => ({ ordinal: index + 1, suite: item.suite }));
}

function protocolEvents({ failures = 0, login429 = false } = {}) {
  const cases = matrixCases();
  return [
    { type: 'hello', protocol: 1 },
    { type: 'matrix', cases },
    {
      type: 'http',
      method: 'POST',
      routecategory: 'auth-login',
      status: login429 ? 429 : 200,
      timestamp: WHEN,
      requestId: id(1),
    },
    ...cases.flatMap((item) => [
      { type: 'test-begin', ordinal: item.ordinal, timestamp: WHEN },
      {
        type: 'test-end',
        ordinal: item.ordinal,
        timestamp: WHEN,
        status: item.ordinal > 23 - failures ? 'failed' : 'passed',
        durationMs: 1,
        retry: 0,
        expectedStatus: 'passed',
      },
    ]),
    { type: 'end', status: failures ? 'failed' : 'passed' },
    {
      type: 'complete',
      faults: [],
      httpStarted: 1,
      httpFinished: 1,
      httpDisconnected: 0,
      globalErrors: 0,
    },
  ];
}

function feedEvents(capture, events) {
  for (const event of events) capture.lines.push(`${JSON.stringify(event)}\n`);
}

function fakeChild(events, { code = 0, signal = null, oversized = false } = {}) {
  // Spawn argv, not shell interpolation. This child never starts ASA, a browser,
  // a database, Docker or a server. The complete transport is exercised.
  return `
    const { writeSync } = require('node:fs');
    writeSync(1, ${JSON.stringify(PRIVATE + '\n')});
    writeSync(2, ${JSON.stringify('\u001b[31m' + PRIVATE + '\u001b[0m\n')});
    ${oversized ? `writeSync(3, ${JSON.stringify(PRIVATE)}.repeat(300) + '\\n');` : ''}
    for (const event of ${JSON.stringify(events)}) writeSync(3, JSON.stringify(event) + '\\n');
    ${signal ? `process.kill(process.pid, ${JSON.stringify(signal)});` : `process.exit(${code});`}
  `;
}

test('bounded UTF-8 lines reassemble split bytes and ANSI controls without retaining raw text', () => {
  const faults = faultSet();
  const lines = [];
  const stream = new BoundedLines(
    (line) => lines.push(line),
    (code) => faults.add(code),
    100,
  );
  const bytes = Buffer.from('\u001b[32mtest \u03bb\u001b[0m\r\n');
  for (const byte of bytes) stream.push(Buffer.from([byte]));
  stream.finish();
  assert.equal(lines.length, 1);
  assert.equal(lines[0] === 'test \u03bb', true);
  assert.equal(faults.list().length, 0);
});

test('HTTP parser strips per-chunk WebServer prefixes and split ANSI around exact five-field records', () => {
  const records = [];
  const capture = new HttpCapture((record) => records.push(record));
  const text =
    '\u001b[32m' +
    JSON.stringify(raw('http_request_started')) +
    '\u001b[0m\n' +
    JSON.stringify(raw('http_response', 1, { status: 429 })) +
    '\n';
  for (let offset = 0; offset < text.length; offset += 7)
    capture.webServerChunk(prefix(text.slice(offset, offset + 7)));
  const summary = capture.finish();
  assert.equal(summary.faults.length, 0);
  assert.equal(summary.httpStarted, 1);
  assert.equal(summary.httpFinished, 1);
  assert.equal(records.length, 1);
  assert.deepEqual(Object.keys(records[0]), [
    'method',
    'routecategory',
    'status',
    'timestamp',
    'requestId',
  ]);
  assert.equal(records[0].routecategory, 'auth-login');
  assert.equal(records[0].status, 429);
  noLeak({ records, summary });
});

test('actual API route families separate runtime, safe methods and common mutation observations', () => {
  const examples = [
    ['/api/auth/login', 'auth-login'],
    ['/api/diagnostics/quality', 'diagnostics-quality'],
    ['/api/diagnostics/client', 'diagnostics-client'],
    ['/api/analytics/v2/events', 'analytics-visits'],
    ['/api/analytics/v2/module-session', 'analytics-module-session'],
    ['/api/analytics/v1/module-session/touch', 'analytics-module-session'],
    ['/api/analytics/v2/quality', 'analytics-other'],
    [`/api/blocks/runtime/projects/${PRIVATE}/draft`, 'runtime'],
    [`/api/projects/${PRIVATE}/draft`, 'projects'],
    [`/api/classrooms/${PRIVATE}/students`, 'classrooms'],
    ['/api/class-join/me/assignments', 'classrooms'],
    ['/api/courses/library', 'courses'],
    [`/api/learning/activities/${PRIVATE}/publish`, 'learning'],
    ['/api/auth/session', 'auth-other'],
    ['/health/live', 'health'],
    ['/internal/blocks/index.html', 'static'],
    [`/anything/${PRIVATE}`, 'other'],
  ];
  for (const [path, expected] of examples) assert.equal(routeCategory(path), expected);
  const records = [];
  const capture = new HttpCapture((record) => records.push(record));
  for (const [index, method] of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH', 'DELETE'].entries())
    pair(capture, index + 1, { method, path: '/api/projects' });
  assert.equal(capture.finish().faults.length, 0);
  assert.equal(
    records.filter((record) => ['GET', 'HEAD', 'OPTIONS'].includes(record.method)).length,
    3,
  );
  noLeak(records);
});

test('oversize raw lines quarantine input and keep buffers bounded, including missing final newline', () => {
  const records = [];
  const capture = new HttpCapture((record) => records.push(record));
  capture.webServerChunk(prefix(PRIVATE.repeat(MAX_LINE_BYTES)));
  assert.equal(capture.lines.pending.length, 0);
  assert.equal(capture.lines.discarding, true);
  const summary = capture.finish();
  assert.equal(records.length, 0);
  assert.equal(summary.faults.includes('RAW_LINE_TOO_LONG'), true);
  assert.equal(summary.faults.includes('TRUNCATED_LINE'), true);
  noLeak(summary);
});

test('malformed, unexpected and invalid HTTP events do not leak and fail capture explicitly', () => {
  const records = [];
  const capture = new HttpCapture((record) => records.push(record));
  capture.webServerChunk(prefix(`{"kind":"http_response","body":"${PRIVATE}"\n`));
  capture.webServerChunk(prefix(`${JSON.stringify(raw('http_surprise'))}\n`));
  for (const extra of [
    { method: PRIVATE },
    { status: PRIVATE },
    { time: PRIVATE },
    { requestId: PRIVATE },
    { path: `/${PRIVATE}\nsecret` },
  ])
    capture.webServerChunk(prefix(`${JSON.stringify(raw('http_response', 1, extra))}\n`));
  const summary = capture.finish();
  assert.equal(records.length, 0);
  for (const code of ['MALFORMED_HTTP', 'UNEXPECTED_HTTP', 'INVALID_HTTP_FIELD', 'NO_HTTP_CAPTURE'])
    assert.equal(summary.faults.includes(code), true);
  noLeak(summary);
});

test('missing or truncated terminal records cannot be reported as complete capture', () => {
  for (const terminal of ['', JSON.stringify(raw('http_response')).slice(0, 100)]) {
    const capture = new HttpCapture(() => {});
    capture.webServerChunk(prefix(`${JSON.stringify(raw('http_request_started'))}\n`));
    if (terminal) capture.webServerChunk(prefix(terminal));
    const summary = capture.finish();
    assert.equal(summary.faults.includes('MISSING_TERMINAL'), true);
    if (terminal) assert.equal(summary.faults.includes('TRUNCATED_LINE'), true);
    noLeak(summary);
  }
});

test('duplicate and mismatched lifecycle records fail without double counting', () => {
  const records = [];
  const capture = new HttpCapture((record) => records.push(record));
  pair(capture);
  capture.webServerChunk(prefix(`${JSON.stringify(raw('http_response'))}\n`));
  capture.webServerChunk(prefix(`${JSON.stringify(raw('http_request_started', 2))}\n`));
  capture.webServerChunk(prefix(`${JSON.stringify(raw('http_request_started', 2))}\n`));
  capture.webServerChunk(prefix(`${JSON.stringify(raw('http_response', 2, { method: 'GET' }))}\n`));
  const summary = capture.finish();
  assert.equal(records.length, 2);
  for (const code of ['DUPLICATE_TERMINAL', 'DUPLICATE_START', 'MISMATCHED_TERMINAL'])
    assert.equal(summary.faults.includes(code), true);
  noLeak({ summary, records });
});

test('source-specific omissions and disconnects are represented without inventing HTTP success', () => {
  const records = [];
  const capture = new HttpCapture((record) => records.push(record));
  capture.webServerChunk(
    prefix(`${JSON.stringify(raw('http_response', 1, { method: 'GET', path: '/health/live' }))}\n`),
  );
  capture.webServerChunk(
    prefix(`${JSON.stringify(raw('http_response', 2, { path: '/api/diagnostics/client' }))}\n`),
  );
  capture.webServerChunk(prefix(`${JSON.stringify(raw('http_request_started', 3))}\n`));
  capture.webServerChunk(
    prefix(`${JSON.stringify(raw('http_request_ended', 3, { outcome: 'connection_closed' }))}\n`),
  );
  const summary = capture.finish();
  assert.equal(summary.faults.length, 0);
  assert.equal(summary.httpDisconnected, 1);
  assert.equal(records[2].status, null);
  noLeak({ summary, records });
  const incomplete = new HttpCapture(() => {});
  incomplete.webServerChunk(prefix(`${JSON.stringify(raw('http_response'))}\n`));
  assert.equal(incomplete.finish().faults.includes('MISSING_START'), true);
});

test('API timestamps retain request start before slow work, while unstarted routes keep terminal time', () => {
  const records = [];
  const capture = new HttpCapture((record) => records.push(record));
  const later = '2026-10-18T00:00:05.000Z';
  capture.webServerChunk(prefix(`${JSON.stringify(raw('http_request_started'))}\n`));
  capture.webServerChunk(prefix(`${JSON.stringify(raw('http_response', 1, { time: later }))}\n`));
  capture.webServerChunk(
    prefix(
      `${JSON.stringify(raw('http_response', 2, { path: '/api/diagnostics/client', time: later }))}\n`,
    ),
  );
  assert.equal(capture.finish().faults.length, 0);
  assert.equal(records[0].timestamp, WHEN);
  assert.equal(records[1].timestamp, later);
  noLeak(records);
});

test('unprefixed stdout and non-HTTP diagnostics are discarded, not trusted as HTTP evidence', () => {
  const capture = new HttpCapture(() => assert.fail('No untrusted event may reach the sink'));
  capture.webServerChunk(`${JSON.stringify(raw('http_response'))}\n`);
  capture.webServerChunk(
    prefix(`${JSON.stringify({ kind: 'client_diagnostic', body: PRIVATE })}\n`),
  );
  capture.webServerChunk(prefix(`${PRIVATE}\n`));
  const summary = capture.finish();
  assert.equal(summary.faults.includes('NO_HTTP_CAPTURE'), true);
  noLeak(summary);
});

test('private protocol preserves the original 23-case 18-pass/5-fail matrix and flags reproduction', () => {
  const records = [];
  const capture = new ProtocolCapture((record) => records.push(record));
  const bytes = Buffer.from(
    protocolEvents({ failures: 5, login429: true })
      .map((event) => JSON.stringify(event))
      .join('\n') + '\n',
  );
  for (let offset = 0; offset < bytes.length; offset += 13)
    capture.lines.push(bytes.subarray(offset, offset + 13));
  const summary = capture.finish();
  assert.equal(summary.capture, 'COMPLETE');
  assert.equal(summary.reproduction, 'REPRODUCED');
  assert.equal(summary.counts.passed, 18);
  assert.equal(summary.counts.failed, 5);
  assert.equal(summary.cases.length, 23);
  assert.equal(summary.secondBatch, 'NOT_RUN');
  assert.equal(summary.limiterState, 'NOT_OBSERVED');
  assert.equal(summary.repairAcceptance, 'NOT_EVALUATED');
  assert.equal(diagnosticSucceeded({ code: 0, signal: null, faults: [] }, summary), false);
  noLeak({ summary, records });
});

test('complete no-429 run means NOT_REPRODUCED and never claims a repaired limiter', () => {
  const capture = new ProtocolCapture();
  feedEvents(capture, protocolEvents());
  const summary = capture.finish();
  assert.equal(summary.capture, 'COMPLETE');
  assert.equal(summary.reproduction, 'NOT_REPRODUCED');
  assert.equal(summary.counts.passed, 23);
  assert.equal(summary.repairAcceptance, 'NOT_EVALUATED');
  assert.equal(diagnosticSucceeded({ code: 0, signal: null, faults: [] }, summary), true);
});

test('fake FD3 metadata, extra private fields, unknown categories and raw errors never reach artifacts', () => {
  for (const event of [
    { type: 'error', errorMessage: PRIVATE },
    { ...protocolEvents()[2], headers: PRIVATE },
    { ...protocolEvents()[2], routecategory: PRIVATE },
    { ...protocolEvents()[2], requestId: PRIVATE },
    {
      type: 'complete',
      faults: [PRIVATE],
      httpStarted: 1,
      httpFinished: 1,
      httpDisconnected: 0,
      globalErrors: 0,
    },
  ]) {
    const records = [];
    const capture = new ProtocolCapture((record) => records.push(record));
    feedEvents(capture, [{ type: 'hello', protocol: 1 }, event]);
    const summary = capture.finish();
    assert.equal(records.length, 0);
    assert.equal(summary.capture, 'FAIL');
    assert.equal(summary.faults.includes('INVALID_EVENT'), true);
    noLeak({ summary, records });
  }
});

test('missing complete, missing test result, duplicate case and omitted test all fail capture', () => {
  const valid = protocolEvents();
  const missingResult = valid.filter(
    (event) => !(event.type === 'test-end' && event.ordinal === 23),
  );
  const wrongMatrix = structuredClone(valid);
  wrongMatrix[1].cases[22].ordinal = 22;
  const omitted = structuredClone(valid);
  omitted[1].cases.pop();
  for (const events of [valid.slice(0, -1), missingResult, wrongMatrix, omitted]) {
    const capture = new ProtocolCapture();
    feedEvents(capture, events);
    const summary = capture.finish();
    assert.equal(summary.capture, 'FAIL');
    assert.equal(summary.reproduction, 'INCOMPLETE_CAPTURE');
    assert.equal(diagnosticSucceeded({ code: 0, signal: null, faults: [] }, summary), false);
    noLeak(summary);
  }
});

test('skipped tests, retries, changed expected status and post-completion events cannot manufacture acceptance', () => {
  for (const mutation of [
    (events) => {
      events[4].status = 'skipped';
    },
    (events) => {
      events[4].retry = 1;
    },
    (events) => {
      events[4].expectedStatus = 'failed';
    },
    (events) => {
      events.push(events[2]);
    },
    (events) => {
      events.at(-1).httpFinished = 2;
    },
  ]) {
    const events = protocolEvents();
    mutation(events);
    const capture = new ProtocolCapture();
    feedEvents(capture, events);
    assert.equal(capture.finish().capture, 'FAIL');
  }
});

test('reporter drops errors, attachments, test stdout and server stderr while retaining safe results', () => {
  const records = [];
  const capture = new ProtocolCapture((record) => records.push(record));
  const reporter = new MutationEvidenceReporter({
    diagnosticEmit: (event) => capture.lines.push(`${JSON.stringify(event)}\n`),
  });
  assert.equal(reporter.printsToStdio(), true);
  const tests = matrixCases().map((item) => ({
    location: { file: `/private/${PRIVATE}/${item.suite}.spec.ts` },
    expectedStatus: 'passed',
    title: PRIVATE,
  }));
  reporter.onBegin({}, { allTests: () => tests });
  reporter.onStdOut(prefix(`${JSON.stringify(raw('http_request_started'))}\n`));
  reporter.onStdOut(prefix(`${JSON.stringify(raw('http_response'))}\n`));
  for (const testCase of tests) {
    reporter.onTestBegin(testCase, { startTime: new Date(WHEN) });
    reporter.onStdOut(`${PRIVATE}\n`, testCase);
    reporter.onStdErr(`${PRIVATE}\n`, testCase);
    const result = { status: 'passed', duration: 1, retry: 0 };
    for (const key of ['error', 'errors', 'attachments', 'stdout', 'stderr'])
      Object.defineProperty(result, key, {
        get: () => assert.fail('Reporter must not read raw result fields'),
      });
    reporter.onTestEnd(testCase, result);
  }
  reporter.onEnd({ status: 'passed', error: PRIVATE });
  reporter.onExit();
  const summary = capture.finish();
  assert.equal(summary.capture, 'COMPLETE');
  assert.equal(summary.counts.passed, 23);
  noLeak({ summary, records });
});

test('reporter global errors and broken output channel fail closed without emitting raw exceptions', () => {
  const capture = new ProtocolCapture();
  const reporter = new MutationEvidenceReporter({
    diagnosticEmit: (event) => capture.lines.push(`${JSON.stringify(event)}\n`),
  });
  reporter.onError({ message: PRIVATE, stack: PRIVATE });
  reporter.onEnd({ status: 'failed' });
  reporter.onExit();
  const summary = capture.finish();
  assert.equal(summary.faults.includes('REPORTER_ERROR'), true);
  assert.equal(summary.capture, 'FAIL');
  noLeak(summary);
  const broken = new MutationEvidenceReporter({
    diagnosticEmit: () => {
      throw new Error(PRIVATE);
    },
  });
  assert.equal(broken.faults.list().includes('REPORTER_CHANNEL'), true);
  noLeak(broken.faults.list());
});

test('reporter rejects unexpected matrix field values before they enter even the private pipe', () => {
  const events = [];
  const reporter = new MutationEvidenceReporter({ diagnosticEmit: (event) => events.push(event) });
  const tests = matrixCases().map((item) => ({
    location: { file: `${item.suite}.spec.ts` },
    expectedStatus: 'passed',
  }));
  reporter.onBegin({}, { allTests: () => tests });
  reporter.onTestBegin(tests[0], { startTime: new Date('invalid') });
  reporter.onTestEnd(tests[0], { status: PRIVATE, duration: 1, retry: 0 });
  reporter.onTestEnd(tests[1], { status: 'failed', duration: PRIVATE, retry: 0 });
  reporter.onEnd({ status: PRIVATE });
  reporter.onExit();
  assert.equal(reporter.faults.list().includes('INVALID_EVENT'), true);
  noLeak(events);
});

test('real child private stdout/stderr cannot bypass the dedicated reporter channel', async () => {
  const records = [];
  const capture = new ProtocolCapture((record) => records.push(record));
  const result = await runPrivate(process.execPath, ['-e', fakeChild(protocolEvents())], {
    protocol: capture,
  });
  const summary = capture.finish();
  assert.equal(childSucceeded(result), true);
  assert.equal(result.stdoutBytes > 0 && result.stderrBytes > 0, true);
  assert.equal(diagnosticSucceeded(result, summary), true);
  assert.equal(records.length, 1);
  noLeak({ result, summary, records });
});

test('actual nonzero exit and SIGTERM fail the diagnostic even with a complete passing matrix', async () => {
  for (const options of [{ code: 7 }, { signal: 'SIGTERM' }]) {
    const capture = new ProtocolCapture();
    const result = await runPrivate(
      process.execPath,
      ['-e', fakeChild(protocolEvents(), options)],
      { protocol: capture },
    );
    const summary = capture.finish();
    assert.equal(summary.capture, 'COMPLETE');
    assert.equal(childSucceeded(result), false);
    assert.equal(diagnosticSucceeded(result, summary), false);
    if (options.code) assert.equal(result.code, options.code);
    if (options.signal) assert.equal(result.signal, options.signal);
    noLeak({ result, summary });
  }
});

test('absent/truncated/oversize FD3 data and pipe quotas remain failures after child exit zero', async () => {
  const examples = [
    { events: [] },
    { events: protocolEvents().slice(0, -1) },
    { events: protocolEvents(), oversized: true },
    { events: protocolEvents(), protocolLimit: 32 },
  ];
  for (const example of examples) {
    const records = [];
    const capture = new ProtocolCapture((record) => records.push(record));
    const result = await runPrivate(process.execPath, ['-e', fakeChild(example.events, example)], {
      protocol: capture,
      ...(example.protocolLimit ? { protocolLimit: example.protocolLimit } : {}),
    });
    result.faults.forEach((code) => capture.faults.add(code));
    const summary = capture.finish();
    assert.equal(summary.capture, 'FAIL');
    assert.equal(diagnosticSucceeded(result, summary), false);
    noLeak({ result, summary, records });
  }
});

test('subprocess spawn failure and excessive raw output fail without keeping a raw buffer', async () => {
  const absent = await runPrivate('/nonexistent-learning-diagnostic-command', []);
  assert.equal(childSucceeded(absent), false);
  assert.equal(absent.faults.includes('SPAWN_FAILED'), true);
  const excessive = await runPrivate(
    process.execPath,
    [
      '-e',
      `const {writeSync}=require('node:fs'); writeSync(1, ${JSON.stringify(PRIVATE)}.repeat(1000)); writeSync(2, ${JSON.stringify(PRIVATE)});`,
    ],
    { rawLimit: 32 },
  );
  assert.equal(childSucceeded(excessive), false);
  assert.equal(excessive.faults.includes('RAW_OUTPUT_LIMIT'), true);
  assert.equal(Object.hasOwn(excessive, 'stdout'), false);
  assert.equal(Object.hasOwn(excessive, 'stderr'), false);
  noLeak({ absent, excessive });
});

test('an artifact sink failure is reduced to a fixed failure code, never an uncaught raw exception', async () => {
  const capture = new ProtocolCapture(() => {
    throw new Error(PRIVATE);
  });
  const result = await runPrivate(process.execPath, ['-e', fakeChild(protocolEvents())], {
    protocol: capture,
  });
  result.faults.forEach((code) => capture.faults.add(code));
  const summary = capture.finish();
  assert.equal(result.faults.includes('PIPE_ERROR'), true);
  assert.equal(diagnosticSucceeded(result, summary), false);
  noLeak({ result, summary });
});

test('browser environment and CLI preserve the complete original batch without debug mode or injected reporters', () => {
  const original = {
    VITEST: PRIVATE,
    PWDEBUG: '1',
    PW_TEST_REPORTER: PRIVATE,
    NODE_OPTIONS: PRIVATE,
    NODE_V8_COVERAGE: PRIVATE,
    APP_TEST_DATABASE_URL: 'synthetic-test-url',
    CI: 'true',
    NX_SKIP_NX_CACHE: 'true',
  };
  const environment = browserEnvironment(original);
  assert.equal(environment.ASA_HTTP_LOG, '1');
  assert.equal(environment.DEBUG, 'pw:webserver');
  assert.equal(Object.hasOwn(environment, 'VITEST'), false);
  assert.equal(Object.hasOwn(environment, 'PWDEBUG'), false);
  assert.equal(Object.hasOwn(environment, 'PW_TEST_REPORTER'), false);
  assert.equal(Object.hasOwn(environment, 'NODE_OPTIONS'), false);
  assert.equal(environment.APP_TEST_DATABASE_URL, original.APP_TEST_DATABASE_URL);
  assert.equal(Object.hasOwn(original, 'VITEST'), true);
  const args = browserArguments('/diagnostic/reporter.mjs');
  assert.deepEqual(args.slice(1, 4), FIRST_BATCH);
  for (const required of [
    '--workers=1',
    '--retries=0',
    '--trace=off',
    '--reporter=/diagnostic/reporter.mjs',
  ])
    assert.equal(args.includes(required), true);
  for (const forbidden of ['--debug', '--grep', '--config'])
    assert.equal(
      args.some((arg) => arg.startsWith(forbidden)),
      false,
    );
});

test('workflow pins product separately, runs only the candidate PR/manual trigger and uploads two cleaned files', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/learning-mutation-budget-diagnostic.yml', import.meta.url),
    'utf8',
  );
  assert.equal(workflow.includes(`ref: ${TESTED_PRODUCT_SHA}`), true);
  assert.equal(
    workflow.includes('ref: ${{ github.event.pull_request.head.sha || github.sha }}'),
    true,
  );
  assert.equal(workflow.includes('path: source'), true);
  assert.equal(workflow.includes('path: diagnostic'), true);
  assert.equal(workflow.includes('cache-dependency-path: source/pnpm-lock.yaml'), true);
  assert.equal(workflow.includes("node-version: '22'"), true);
  assert.equal(workflow.includes('version: 9.15.9'), true);
  assert.equal(workflow.includes('image: postgres:16'), true);
  assert.equal(workflow.includes('group: learning-mutation-evidence-'), true);
  assert.equal(workflow.includes('if: always()'), true);
  assert.equal(workflow.includes('if-no-files-found: error'), true);
  for (const forbidden of [
    '\n  push:',
    'pull_request_target:',
    'continue-on-error:',
    '|| true',
    'reports/playwright',
    'e2e/artifacts',
    'trace.zip',
  ])
    assert.equal(workflow.includes(forbidden), false);
  assert.equal(
    workflow.match(/sanitized-learning-mutation\/(http\.jsonl|metadata\.json)/g)?.length,
    2,
  );
});
