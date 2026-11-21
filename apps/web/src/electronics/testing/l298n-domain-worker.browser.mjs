/* global window, document, process, URL, Worker, clearTimeout, setTimeout, console */
// Native Chromium evidence for P1 only: the actual simulation.worker.ts,
// protocol, engine and DC/TT models. No editor, catalog activation, API or server.
// Run from the repository root: node apps/web/src/electronics/testing/l298n-domain-worker.browser.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.L298N_REPOSITORY_ROOT ?? process.cwd());
const require = createRequire(resolve(root, 'package.json'));
const { chromium } = require('@playwright/test');
const { build } = createRequire(require.resolve('vite'))('esbuild');
const origin = 'https://l298n-domain-worker.invalid';
const sourcePaths = [
  'apps/web/src/electronics/simulation.worker.ts',
  'apps/web/src/electronics/simulation-worker-protocol.ts',
  'apps/web/src/electronics/simulation-worker-evaluator.ts',
  'contexts/electronics/engine.ts',
  'contexts/electronics/domain/arduino-circuit-scheduler.ts',
  'contexts/electronics/domain/solver.ts',
  'contexts/electronics/domain/simulation.ts',
  'contexts/electronics/domain/model-identity.ts',
  'contexts/electronics/domain/models/l298n-dc-model.ts',
  'contexts/electronics/domain/models/l298n-input-network.ts',
  'contexts/electronics/domain/models/l298n-pwm-model.ts',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const worktree = execFileSync('git', ['status', '--porcelain'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(root, 'test-results/l298n-domain-worker', runId + '-' + head.slice(0, 12));
await mkdir(out, { recursive: true });
const receipt = {
  status: 'running',
  runId,
  head,
  worktree,
  scope:
    'P1 native domain Worker; no Workbench, real API, database or installed application acceptance',
  sourceHashes: {},
  harnessSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
  cases: [],
  pageErrors: [],
  consoleErrors: [],
  unexpectedRequests: [],
};
const persistReceipt = () =>
  writeFile(resolve(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');

const pins = ['+12V', 'GND', '+5V', 'OUT1', 'OUT2', 'OUT3', 'OUT4', 'IN1', 'IN2', 'IN3', 'IN4'];
function circuit(spec) {
  const edge = (id, fromId, fromPin, toId, toPin) => ({
    id,
    from: { componentId: fromId, terminal: fromPin },
    to: { componentId: toId, terminal: toPin },
  });
  // Both native motors use their explicit existing reference profiles at 6 V.
  // The labelled VS terminal is variable, not a hard-coded ideal 12 V source.
  const directionA = spec.signA > 0 ? ['HIGH', 'LOW'] : ['LOW', 'HIGH'];
  const directionB = spec.signB > 0 ? ['HIGH', 'LOW'] : ['LOW', 'HIGH'];
  const source =
    'void setup(){' +
    'pinMode(2,OUTPUT);pinMode(3,OUTPUT);pinMode(4,OUTPUT);' +
    'pinMode(5,OUTPUT);pinMode(7,OUTPUT);pinMode(8,OUTPUT);' +
    'digitalWrite(2,' +
    directionA[0] +
    ');digitalWrite(4,' +
    directionA[1] +
    ');' +
    'digitalWrite(7,' +
    directionB[0] +
    ');digitalWrite(8,' +
    directionB[1] +
    ');' +
    'analogWrite(3,' +
    spec.dutyA +
    ');analogWrite(5,' +
    spec.dutyB +
    ');' +
    '}void loop(){delay(1000);}';
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'driver',
        kind: 'visual',
        componentTypeId: 'l298n-motor-driver',
        value: 0,
        position: { x: 300, y: 100 },
        pinIds: [...pins, 'ENA', 'ENB'],
        stateProperties: {
          enaJumperInstalled: false,
          enbJumperInstalled: false,
          regulatorJumperInstalled: false,
        },
      },
      {
        id: 'uno',
        kind: 'visual',
        componentTypeId: 'arduino-uno',
        value: 5,
        position: { x: 0, y: 0 },
        pinIds: ['d13', 'd2', 'd3', 'd4', 'd5', 'd7', 'd8', 'power-5v', 'power-3v3', 'power-gnd-1'],
        stateProperties: { arduinoSource: source },
      },
      {
        id: 'vs',
        kind: 'source',
        value: 6,
        position: { x: 600, y: 0 },
      },
      {
        id: 'motor-a',
        kind: 'visual',
        componentTypeId: 'dc-motor',
        value: 6,
        position: { x: 600, y: 150 },
        pinIds: ['positive', 'negative'],
        stateProperties: { motorAssemblyProfileId: 'pololu-1117-130-6v' },
      },
      {
        id: 'motor-b',
        kind: 'visual',
        componentTypeId: 'gearmotor',
        value: 6,
        position: { x: 600, y: 400 },
        pinIds: ['positive', 'negative'],
        stateProperties: { motorAssemblyProfileId: 'adafruit-3777-tt-48to1' },
      },
    ],
    connections: [
      edge('vs-positive', 'vs', 'a', 'driver', '+12V'),
      edge('vs-ground', 'vs', 'b', 'driver', 'GND'),
      edge('logic', 'uno', 'power-5v', 'driver', '+5V'),
      edge('logic-ground', 'uno', 'power-gnd-1', 'driver', 'GND'),
      edge('in1', 'uno', 'd2', 'driver', 'IN1'),
      edge('in2', 'uno', 'd4', 'driver', 'IN2'),
      edge('in3', 'uno', 'd7', 'driver', 'IN3'),
      edge('in4', 'uno', 'd8', 'driver', 'IN4'),
      edge('ena', 'uno', 'd3', 'driver', 'ENA'),
      edge('enb', 'uno', 'd5', 'driver', 'ENB'),
      edge('out1', 'driver', 'OUT1', 'motor-a', 'positive'),
      edge('out2', 'driver', 'OUT2', 'motor-a', 'negative'),
      edge('out3', 'driver', 'OUT3', 'motor-b', 'positive'),
      edge('out4', 'driver', 'OUT4', 'motor-b', 'negative'),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function finiteTree(value, path = 'result') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), path + ' is finite');
  else if (Array.isArray(value)) value.forEach((item, i) => finiteTree(item, path + '[' + i + ']'));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) finiteTree(item, path + '.' + key);
  }
}
function solved(result, label) {
  assert.ok(result, label + ': committed result exists');
  assert.equal(result.status, 'solved', label + ': ' + JSON.stringify(result.diagnostics));
  assert.equal(result.solved, true, label + ': solved flag');
  assert.equal(result.quality?.finite, true, label + ': all quality values finite');
  assert.equal(result.quality?.passed, true, label + ': ' + JSON.stringify(result.quality));
  const quality = result.quality;
  assert.ok(quality.maxKclResidualAmp <= quality.kclToleranceAmp, label + ': KCL');
  assert.ok(
    quality.maxSourceVoltageResidualVolt <= quality.sourceVoltageToleranceVolt,
    label + ': source constraints',
  );
  assert.ok(
    quality.powerBalanceResidualWatt <= quality.powerBalanceToleranceWatt,
    label + ': power balance',
  );
  assert.ok(result.numericalResidual <= result.numericalTolerance, label + ': numerical residual');
  finiteTree(result);
}
function component(result, id) {
  const found = result.components.find((item) => item.componentId === id);
  assert.ok(found, 'Missing native component result: ' + id);
  return found;
}
function projection(advance) {
  // Wall-clock metrics and request identity are transport concerns. These fields
  // are the complete committed domain state and published result.
  return {
    executionStatus: advance.executionStatus,
    requestedHorizonMicroseconds: advance.requestedHorizonMicroseconds,
    committedHorizonMicroseconds: advance.committedHorizonMicroseconds,
    state: advance.state,
    result: advance.result,
    serial: advance.serial,
    diagnostics: advance.diagnostics,
  };
}
function frameSummary(advance) {
  const driver = component(advance.result, 'driver');
  const motor = (id) => {
    const value = component(advance.result, id);
    return {
      componentId: id,
      voltageDrop: value.voltageDrop,
      current: value.current,
      motorRpm: value.motorRpm,
      outputRpm: value.outputRpm,
      direction: value.direction,
      mode: value.motorOperatingMode,
    };
  };
  return {
    atMicroseconds: advance.committedHorizonMicroseconds,
    enaVolt: driver.terminalVoltages.ENA,
    enbVolt: driver.terminalVoltages.ENB,
    logicLit: driver.lit,
    motorA: motor('motor-a'),
    motorB: motor('motor-b'),
    quality: advance.result.quality,
    diagnostics: advance.result.diagnostics,
    continuationSha256: sha256(advance.state.continuation.serializedState),
  };
}

let browser;
let context;
let page;
try {
  await persistReceipt();
  for (const path of sourcePaths) {
    receipt.sourceHashes[path] = sha256(await readFile(resolve(root, path)));
  }
  const options = {
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    alias: Object.fromEntries(
      ['/timed-state', '/rendering', '/simulation', '/engine', ''].map((suffix) => [
        '@asa-lab/electronics' + suffix,
        resolve(root, 'contexts/electronics/' + (suffix.slice(1) || 'index') + '.ts'),
      ]),
    ),
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.env': '{}',
      'import.meta.url': JSON.stringify(origin + '/simulation.worker.js'),
    },
  };
  const workerBundle = (
    await build({ ...options, entryPoints: ['apps/web/src/electronics/simulation.worker.ts'] })
  ).outputFiles[0].text;
  const bootstrap = (
    await build({
      ...options,
      stdin: {
        sourcefile: 'l298n-domain-worker-bootstrap.ts',
        resolveDir: root,
        contents:
          "import { resetElectronicsTimedState } from '@asa-lab/electronics/timed-state';" +
          'import { ELECTRONICS_SIMULATION_WORKER_PROTOCOL, ELECTRONICS_SIMULATION_ENGINE_REVISION }' +
          " from './apps/web/src/electronics/simulation-worker-protocol';" +
          'window.l298nNative = {' +
          ' protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,' +
          ' engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,' +
          ' initialState: resetElectronicsTimedState(), workers: new Map(), errors: []' +
          '};',
      },
    })
  ).outputFiles[0].text;
  receipt.workerBundleSha256 = sha256(workerBundle);
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  page = await context.newPage();
  page.on('pageerror', (error) => receipt.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') receipt.consoleErrors.push(message.text());
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname === '/simulation.worker.js') {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: workerBundle });
    }
    if (url.origin === origin && url.pathname === '/') {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body:
          '<!doctype html><meta charset="utf-8"><title>L298N native domain Worker evidence</title>' +
          '<style>body{font:17px system-ui;margin:32px;color:#183044;background:#f7fafc}' +
          'pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px monospace}</style>' +
          '<h1>L298N: native domain Worker</h1>' +
          '<p>No Workbench, server, API or database. Assertions run against the real Worker.</p>' +
          '<pre id="evidence">Running preflight and physical advances...</pre>',
      });
    }
    if (url.origin === origin && url.pathname === '/favicon.ico') {
      return route.fulfill({ status: 204, body: '' });
    }
    receipt.unexpectedRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  await page.goto(origin + '/');
  await page.addScriptTag({ content: bootstrap });
  const identity = await page.evaluate(() => ({
    protocolVersion: window.l298nNative.protocolVersion,
    engineRevision: window.l298nNative.engineRevision,
    initialState: window.l298nNative.initialState,
  }));
  receipt.protocolVersion = identity.protocolVersion;
  receipt.engineRevision = identity.engineRevision;
  let requestNumber = 0;

  async function openWorker(label) {
    await page.evaluate((name) => {
      const host = window.l298nNative;
      const worker = new Worker('/simulation.worker.js');
      const pending = new Map();
      const entry = { worker, pending };
      worker.onmessage = (event) => {
        const response = event.data;
        const request = pending.get(response.requestId);
        if (!request) {
          host.errors.push('Unexpected response from ' + name + ': ' + response.requestId);
          return;
        }
        pending.delete(response.requestId);
        clearTimeout(request.timer);
        request.resolve(response);
      };
      const fail = (message) => {
        host.errors.push(name + ': ' + message);
        for (const request of pending.values()) {
          clearTimeout(request.timer);
          request.reject(new Error(message));
        }
        pending.clear();
      };
      worker.onerror = (event) => fail(event.message || 'Native Worker error');
      worker.onmessageerror = () => fail('Native Worker structured-clone response error');
      host.workers.set(name, entry);
    }, label);
  }
  async function closeWorker(label) {
    await page.evaluate((name) => {
      const entry = window.l298nNative.workers.get(name);
      if (!entry) return;
      entry.worker.terminate();
      window.l298nNative.workers.delete(name);
    }, label);
  }
  async function rpc(label, body) {
    const request = {
      protocolVersion: identity.protocolVersion,
      engineRevision: identity.engineRevision,
      requestId: label + '-' + ++requestNumber,
      generationId: 1,
      projectSessionId: 'l298n-p1-native-' + label,
      ...body,
    };
    const response = await page.evaluate(
      ({ name, message }) =>
        new Promise((resolveResponse, rejectResponse) => {
          const entry = window.l298nNative.workers.get(name);
          if (!entry) throw new Error('Native Worker is not registered: ' + name);
          // Timeout bounds the test transport only; it never advances physical time.
          const timer = setTimeout(() => {
            entry.pending.delete(message.requestId);
            rejectResponse(new Error('Native Worker timeout: ' + message.requestId));
          }, 30000);
          entry.pending.set(message.requestId, {
            resolve: resolveResponse,
            reject: rejectResponse,
            timer,
          });
          entry.worker.postMessage(message);
        }),
      { name: label, message: request },
    );
    receipt.lastResponse = {
      requestId: response.requestId,
      ok: response.ok,
      kind: response.kind,
      code: response.code,
      message: response.message,
      metrics: response.metrics,
      executionStatus: response.advance?.executionStatus,
      diagnostics: response.advance?.diagnostics ?? response.result?.diagnostics,
      result: response.advance?.result ?? response.result,
    };
    assert.equal(response.protocolVersion, request.protocolVersion);
    assert.equal(response.requestId, request.requestId);
    assert.equal(response.generationId, request.generationId);
    assert.equal(response.projectSessionId, request.projectSessionId);
    assert.equal(response.ok, true, JSON.stringify(receipt.lastResponse));
    assert.equal(response.kind, request.kind);
    assert.ok(Number.isFinite(response.metrics.computeMs));
    assert.equal(response.metrics.solverRevision, identity.engineRevision);
    return response;
  }
  async function preflight(label, document) {
    const response = await rpc(label, { kind: 'preflight', document });
    solved(response.result, label + ' preflight');
    assert.equal(response.result.analysis.controllerRuntime, 'arduino');
    return {
      topologySignature: response.result.topologySignature,
      simulationInputDigest: response.result.simulationInputDigest,
      modelSetDigest: response.result.modelSetDigest,
      quality: response.result.quality,
    };
  }
  async function advance(label, document, state, horizon, previousHorizon) {
    const response = await rpc(label, {
      kind: 'advance',
      document,
      state,
      requestedHorizonMicroseconds: horizon,
    });
    const payload = response.advance;
    assert.equal(payload.executionStatus, 'ready', JSON.stringify(receipt.lastResponse));
    assert.equal(payload.requestedHorizonMicroseconds, horizon);
    assert.equal(payload.committedHorizonMicroseconds, horizon);
    assert.ok(horizon >= previousHorizon, label + ': physical horizon never rewinds');
    assert.equal(payload.state.lifecycle, 'running');
    assert.equal(payload.state.continuation?.committedHorizonMicroseconds, horizon);
    assert.equal(typeof payload.state.continuation?.serializedState, 'string');
    assert.ok(payload.state.continuation.serializedState.length > 0);
    assert.equal(response.metrics.executionStatus, 'ready');
    assert.equal(response.metrics.committedHorizonMicroseconds, horizon);
    assert.ok(
      !payload.diagnostics.some((item) => item.code === 'physical_advance_failed'),
      label + ': physical advance must succeed',
    );
    solved(payload.result, label + ' @ ' + horizon + ' us');
    return payload;
  }

  const specs = [
    { id: 'a-forward-b-reverse', signA: 1, signB: -1, dutyA: 128, dutyB: 192 },
    { id: 'a-reverse-b-forward', signA: -1, signB: 1, dutyA: 192, dutyB: 128 },
  ];
  const sampleHorizons = Array.from({ length: 43 }, (_, i) => 100000 + i * 100);
  const horizons = [0, 100, 1000, 5000, 10000, 25000, 50000, ...sampleHorizons, 150000, 200000];
  for (const spec of specs) {
    const document = circuit(spec);
    const documentBytes = JSON.stringify(document);
    const record = {
      id: spec.id,
      signA: spec.signA,
      signB: spec.signB,
      dutyA: spec.dutyA,
      dutyB: spec.dutyB,
      documentSha256: sha256(documentBytes),
      frames: [],
    };
    receipt.cases.push(record);
    const primary = spec.id + '-json-run';
    await openWorker(primary);
    record.preflight = await preflight(primary, document);
    let state = identity.initialState;
    let previousHorizon = 0;
    let final;
    let checkpoint;
    for (const horizon of horizons) {
      // Explicit JSON round-trip at every boundary, in addition to the native
      // postMessage structured clone. No private continuation fields are edited.
      final = await advance(
        primary,
        JSON.parse(documentBytes),
        JSON.parse(JSON.stringify(state)),
        horizon,
        previousHorizon,
      );
      if (horizon > previousHorizon) {
        assert.ok(
          final.state.continuation.committedHorizonMicroseconds > previousHorizon,
          'Every nonzero Run step makes real physical progress',
        );
      }
      state = final.state;
      previousHorizon = horizon;
      const frame = frameSummary(final);
      record.frames.push(frame);
      assert.equal(frame.logicLit, true, 'LED truth comes from solved logic supply');
      if (horizon >= 25000) {
        assert.equal(Math.sign(frame.motorA.motorRpm), spec.signA, 'DC motor direction');
        assert.equal(Math.sign(frame.motorB.motorRpm), spec.signB, 'TT motor direction');
        assert.ok(Math.abs(frame.motorA.outputRpm) > 0, 'DC shaft is moving');
        assert.ok(Math.abs(frame.motorB.outputRpm) > 0, 'TT shaft is moving');
      }
      if (horizon === 100000) checkpoint = JSON.parse(JSON.stringify(state));
    }
    const samples = record.frames.filter((frame) => sampleHorizons.includes(frame.atMicroseconds));
    const digital = (voltage, pin) => {
      assert.ok(Number.isFinite(voltage), pin + ': voltage exists');
      assert.ok(
        Math.abs(voltage) < 0.05 || Math.abs(voltage - 5) < 0.05,
        pin + ': actual PWM level must be near 0/5 V, not the mean voltage',
      );
      return voltage > 2.5 ? 1 : 0;
    };
    const levels = samples.map((frame) => ({
      a: digital(frame.enaVolt, 'ENA'),
      b: digital(frame.enbVolt, 'ENB'),
    }));
    assert.deepEqual([...new Set(levels.map((sample) => sample.a))].sort(), [0, 1]);
    assert.deepEqual([...new Set(levels.map((sample) => sample.b))].sort(), [0, 1]);
    assert.ok(
      levels.some((sample) => sample.a !== sample.b),
      'The two enable signals are independent',
    );
    const highA = levels.filter((sample) => sample.a === 1).length;
    const highB = levels.filter((sample) => sample.b === 1).length;
    assert.equal(
      Math.sign(highA - highB),
      Math.sign(spec.dutyA - spec.dutyB),
      'Distinct PWM duties have the correct ordering in the observation window',
    );
    record.pwm = { samples: levels.length, highA, highB, distinctEnableLevels: true };
    const canonical = JSON.stringify(projection(final));
    record.finalProjectionSha256 = sha256(canonical);
    assert.equal(JSON.stringify(document), documentBytes, 'Original document remains unchanged');
    await closeWorker(primary);

    // A fresh Worker has no cached private runtime from the first run.
    const replay = spec.id + '-structured-clone-replay';
    await openWorker(replay);
    await preflight(replay, document);
    let replayState = identity.initialState;
    let replayFinal;
    previousHorizon = 0;
    for (const horizon of horizons) {
      replayFinal = await advance(replay, document, replayState, horizon, previousHorizon);
      replayState = replayFinal.state;
      previousHorizon = horizon;
    }
    assert.equal(
      JSON.stringify(projection(replayFinal)),
      canonical,
      'JSON and structured-clone continuations agree exactly',
    );
    record.freshWorkerReplay = 'pass';
    await closeWorker(replay);

    const resumed = spec.id + '-checkpoint-handoff';
    await openWorker(resumed);
    await preflight(resumed, document);
    const resumedFinal = await advance(resumed, document, checkpoint, 200000, 100000);
    assert.equal(
      JSON.stringify(projection(resumedFinal)),
      canonical,
      'JSON checkpoint handed to a fresh Worker preserves exact state across different Run partitions',
    );
    record.jsonCheckpointHandoff = 'pass';
    await closeWorker(resumed);

    const oneShot = spec.id + '-single-horizon';
    await openWorker(oneShot);
    await preflight(oneShot, document);
    const oneShotFinal = await advance(oneShot, document, identity.initialState, 200000, 0);
    assert.equal(
      JSON.stringify(projection(oneShotFinal)),
      canonical,
      'One horizon and many Run observations converge exactly; UI cadence is not a physical clock',
    );
    record.partitionIndependence = 'pass';
    await closeWorker(oneShot);
    record.status = 'pass';
    await persistReceipt();
    console.log(
      'L298N_DOMAIN_WORKER_CASE_PASS',
      JSON.stringify({
        id: spec.id,
        frames: record.frames.length,
        finalHorizonMicroseconds: final.committedHorizonMicroseconds,
        finalProjectionSha256: record.finalProjectionSha256,
        pwm: record.pwm,
      }),
    );
  }

  receipt.workerErrors = await page.evaluate(() => window.l298nNative.errors);
  assert.deepEqual(receipt.workerErrors, [], 'No native Worker errors or unexpected responses');
  assert.deepEqual(receipt.pageErrors, [], 'No page runtime errors');
  assert.deepEqual(receipt.consoleErrors, [], 'No browser console errors');
  assert.deepEqual(receipt.unexpectedRequests, [], 'No external API, assets or server requests');
  receipt.status = 'pass';
  receipt.requestCount = requestNumber;
  delete receipt.lastResponse;
  await page.evaluate(
    (summary) => {
      document.getElementById('evidence').textContent = JSON.stringify(summary, null, 2);
    },
    {
      status: receipt.status,
      head: receipt.head,
      engineRevision: receipt.engineRevision,
      requestCount: receipt.requestCount,
      scope: receipt.scope,
      cases: receipt.cases.map((item) => ({
        id: item.id,
        frames: item.frames.length,
        pwm: item.pwm,
        finalProjectionSha256: item.finalProjectionSha256,
        freshWorkerReplay: item.freshWorkerReplay,
        jsonCheckpointHandoff: item.jsonCheckpointHandoff,
        partitionIndependence: item.partitionIndependence,
      })),
    },
  );
  await page.screenshot({ path: resolve(out, 'native-worker-domain.png'), fullPage: true });
  await persistReceipt();
  console.log(
    'L298N_DOMAIN_WORKER_ALL_PASS',
    JSON.stringify({
      head,
      cases: receipt.cases.length,
      requestCount: receipt.requestCount,
      receipt: resolve(out, 'receipt.json'),
    }),
  );
} catch (error) {
  receipt.status = 'fail';
  receipt.failure = { message: error.message, stack: error.stack };
  if (page) {
    receipt.workerErrors = await page
      .evaluate(() => window.l298nNative?.errors ?? [])
      .catch(() => []);
    await page
      .evaluate(
        (failure) => {
          const output = document.getElementById('evidence');
          if (output) output.textContent = JSON.stringify(failure, null, 2);
        },
        { status: 'fail', failure: receipt.failure, lastResponse: receipt.lastResponse },
      )
      .catch(() => {});
    await page
      .screenshot({ path: resolve(out, 'native-worker-failure.png'), fullPage: true })
      .catch(() => {});
  }
  await persistReceipt();
  console.error(
    'L298N_DOMAIN_WORKER_FAIL',
    JSON.stringify({
      failure: receipt.failure,
      receipt: resolve(out, 'receipt.json'),
    }),
  );
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
}
