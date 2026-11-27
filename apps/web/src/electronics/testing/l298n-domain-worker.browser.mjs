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

function externalSquareCircuit(amplitudeVpp, frequencyHz = 1000) {
  const base = circuit({ signA: 1, signB: -1, dutyA: 255, dutyB: 255 });
  const wire = (id, from, terminal, pin) => ({
    id,
    from: { componentId: from, terminal },
    to: { componentId: 'driver', terminal: pin },
  });
  return {
    ...base,
    components: [
      ...base.components
        .filter((part) => part.id !== 'uno')
        .map((part) =>
          part.id === 'vs' ? { ...part, stateProperties: { maxContinuousCurrentAmp: 3 } } : part,
        ),
      { id: 'logic', kind: 'source', value: 5, position: { x: 0, y: 100 } },
      { id: 'return', kind: 'resistor', value: 10, position: { x: 180, y: 200 } },
      {
        id: 'generator',
        kind: 'source',
        componentTypeId: 'signal-generator',
        pinIds: ['signal', 'ground'],
        value: frequencyHz,
        position: { x: 0, y: 200 },
        stateProperties: {
          waveform: 'square',
          frequencyHz,
          amplitudeVpp,
          dcOffsetVolt: amplitudeVpp ? 2.5 : 5,
          outputEnabled: true,
        },
      },
    ],
    connections: [
      ...base.connections.filter((part) => part.from.componentId !== 'uno'),
      wire('logic', 'logic', 'a', '+5V'),
      wire('logic-return', 'logic', 'b', 'GND'),
      wire('in1', 'logic', 'a', 'IN1'),
      wire('in2', 'logic', 'b', 'IN2'),
      wire('in3', 'logic', 'b', 'IN3'),
      wire('in4', 'logic', 'a', 'IN4'),
      wire('ena', 'generator', 'signal', 'ENA'),
      wire('enb', 'generator', 'signal', 'ENB'),
      {
        id: 'generator-return',
        from: { componentId: 'generator', terminal: 'ground' },
        to: { componentId: 'return', terminal: 'a' },
      },
      wire('driver-return', 'return', 'b', 'GND'),
    ],
  };
}

function withMotorSupply(document, battery = false) {
  const pinIds = battery ? ['BAT+', 'BAT-'] : ['positive', 'negative'];
  return {
    ...document,
    components: document.components.map((part) =>
      part.id === 'vs'
        ? {
            ...part,
            componentTypeId: battery ? 'battery-holder-aa-4' : 'regulated-power-supply',
            pinIds,
            stateProperties: battery
              ? { cells: 4, internalResistanceOhm: 0.3, maxContinuousCurrentAmp: 2 }
              : { outputEnabled: true, voltageSetpointVolt: 6, currentLimitAmp: 2 },
          }
        : part,
    ),
    connections: document.connections.map((connection) =>
      connection.from.componentId === 'vs'
        ? {
            ...connection,
            from: {
              ...connection.from,
              terminal: connection.from.terminal === 'a' ? pinIds[0] : pinIds[1],
            },
          }
        : connection,
    ),
  };
}

function standaloneWithSwitches() {
  const base = withMotorSupply(externalSquareCircuit(0), true);
  const switches = [
    ['in1', 'IN1', true],
    ['in2', 'IN2', false],
    ['ena', 'ENA', true],
    ['enb', 'ENB', true],
  ];
  const wire = (id, fromId, fromPin, toId, toPin) => ({
    id,
    from: { componentId: fromId, terminal: fromPin },
    to: { componentId: toId, terminal: toPin },
  });
  return {
    ...base,
    components: [
      ...base.components
        .filter((part) => !['generator', 'return'].includes(part.id))
        .map((part) =>
          part.id === 'logic'
            ? {
                ...part,
                componentTypeId: 'regulated-power-supply',
                pinIds: ['positive', 'negative'],
                stateProperties: {
                  outputEnabled: true,
                  voltageSetpointVolt: 5,
                  currentLimitAmp: 0.5,
                },
              }
            : part,
        ),
      ...switches.map(([id, , state], index) => ({
        id,
        kind: 'switch',
        componentTypeId: 'switch-spdt',
        value: 0,
        position: { x: 100, y: 300 + index * 25 },
        pinIds: ['throw-left', 'common', 'throw-right'],
        state,
      })),
    ],
    connections: [
      ...base.connections
        .filter(
          (connection) =>
            !['in1', 'in2', 'ena', 'enb', 'generator-return', 'driver-return'].includes(
              connection.id,
            ),
        )
        .map((connection) =>
          connection.from.componentId === 'logic'
            ? {
                ...connection,
                from: {
                  ...connection.from,
                  terminal: connection.from.terminal === 'a' ? 'positive' : 'negative',
                },
              }
            : connection,
        ),
      ...switches.flatMap(([id, terminal]) => [
        wire(id + '-low', 'logic', 'negative', id, 'throw-left'),
        wire(id + '-high', 'logic', 'positive', id, 'throw-right'),
        wire(id + '-out', id, 'common', 'driver', terminal),
      ]),
    ],
  };
}

function singleMotorBatteryCircuit({ batteryVolt, logic, reversed }) {
  const base = circuit({ signA: 1, signB: -1, dutyA: 255, dutyB: 255 });
  const arduino = logic === 'arduino';
  const onboard = logic === 'regulator';
  const batteryPins = batteryVolt === 9 ? ['positive', 'negative'] : ['BAT+', 'BAT-'];
  const [positive, negative] = batteryPins;
  const wire = (id, from, terminal, pin) => ({
    id,
    from: { componentId: from, terminal },
    to: { componentId: 'driver', terminal: pin },
  });
  const components = base.components.filter(
    (part) => part.id !== 'motor-b' && (arduino || part.id !== 'uno'),
  );
  const driveSource = logic === 'bench' ? 'logic-supply' : 'driver';
  const highPin = logic === 'bench' ? 'positive' : '+5V';
  const directInputs = [
    wire('direct-high', driveSource, highPin, reversed ? 'IN2' : 'IN1'),
    wire('direct-low', 'vs', negative, reversed ? 'IN1' : 'IN2'),
  ];
  return {
    ...base,
    components: components
      .map((part) => {
        if (part.id === 'driver') {
          return {
            ...part,
            stateProperties: {
              enaJumperInstalled: true,
              enbJumperInstalled: true,
              regulatorJumperInstalled: onboard,
            },
          };
        }
        if (part.id === 'vs') {
          return {
            ...part,
            componentTypeId: batteryVolt === 9 ? 'battery-9v' : 'battery-holder-aa-4',
            pinIds: batteryPins,
            value: batteryVolt,
          };
        }
        if (part.id === 'uno') {
          return {
            ...part,
            stateProperties: {
              arduinoSource:
                'void setup(){pinMode(2,OUTPUT);pinMode(4,OUTPUT);}' +
                'void loop(){digitalWrite(2,HIGH);digitalWrite(4,LOW);delay(250);' +
                'digitalWrite(2,LOW);digitalWrite(4,HIGH);delay(500);}',
            },
          };
        }
        return part;
      })
      .concat(
        logic === 'bench'
          ? [
              {
                id: 'logic-supply',
                kind: 'source',
                componentTypeId: 'regulated-power-supply',
                pinIds: ['positive', 'negative'],
                value: 5,
                position: { x: 0, y: 200 },
                stateProperties: {
                  outputEnabled: true,
                  voltageSetpointVolt: 5,
                  currentLimitAmp: 0.5,
                },
              },
            ]
          : [],
      ),
    connections: [
      wire('battery-positive', 'vs', positive, '+12V'),
      wire('battery-ground', 'vs', negative, 'GND'),
      ...base.connections.filter((connection) =>
        (arduino
          ? ['logic', 'logic-ground', 'in1', 'in2', 'out1', 'out2']
          : ['out1', 'out2']
        ).includes(connection.id),
      ),
      ...(arduino ? [] : directInputs),
      ...(logic === 'bench'
        ? [
            wire('logic-positive', 'logic-supply', 'positive', '+5V'),
            wire('logic-ground', 'logic-supply', 'negative', 'GND'),
          ]
        : []),
    ],
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
function frameSummary(advance, includeMotorB = true) {
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
    ...(includeMotorB ? { motorB: motor('motor-b') } : {}),
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
  async function preflight(label, document, controllerRuntime = 'arduino') {
    const response = await rpc(label, { kind: 'preflight', document });
    solved(response.result, label + ' preflight');
    assert.equal(response.result.analysis.controllerRuntime, controllerRuntime);
    return {
      topologySignature: response.result.topologySignature,
      simulationInputDigest: response.result.simulationInputDigest,
      modelSetDigest: response.result.modelSetDigest,
      quality: response.result.quality,
    };
  }
  async function advance(label, document, state, horizon, previousHorizon, inputEvents) {
    const response = await rpc(label, {
      kind: 'advance',
      document,
      state,
      requestedHorizonMicroseconds: horizon,
      ...(inputEvents ? { inputEvents } : {}),
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

  const batteryCases = [
    { id: 'single-motor-pp3-forward', batteryVolt: 9, logic: 'regulator', steps: [[200_000, 1]] },
    {
      id: 'single-motor-pp3-reverse',
      batteryVolt: 9,
      logic: 'regulator',
      reversed: true,
      steps: [[200_000, -1]],
    },
    {
      id: 'single-motor-aa-onboard-undervoltage',
      batteryVolt: 6,
      logic: 'regulator',
      steps: [[200_000, 0]],
    },
    {
      id: 'single-motor-aa-external-5v-forward',
      batteryVolt: 6,
      logic: 'bench',
      steps: [[200_000, 1]],
    },
    {
      id: 'single-motor-aa-external-5v-reverse',
      batteryVolt: 6,
      logic: 'bench',
      reversed: true,
      steps: [[200_000, -1]],
    },
    {
      id: 'single-motor-aa-arduino-live-reversal',
      batteryVolt: 6,
      logic: 'arduino',
      steps: [
        [200_000, 1],
        [500_000, -1],
      ],
    },
  ];
  for (const spec of batteryCases) {
    const document = singleMotorBatteryCircuit(spec);
    const record = { id: spec.id, documentSha256: sha256(JSON.stringify(document)), frames: [] };
    receipt.cases.push(record);
    await openWorker(spec.id);
    record.preflight = await preflight(
      spec.id,
      document,
      spec.logic === 'arduino' ? 'arduino' : 'none',
    );
    let state = identity.initialState;
    let previousHorizon = 0;
    for (const [horizon, sign] of [[0, null], ...spec.steps]) {
      const sample = await advance(spec.id, document, state, horizon, previousHorizon);
      state = JSON.parse(JSON.stringify(sample.state));
      previousHorizon = horizon;
      const driver = component(sample.result, 'driver');
      const frame = frameSummary(sample, false);
      const { GND: ground, '+12V': vs, '+5V': logic, OUT1, OUT2 } = driver.terminalVoltages;
      const motorSupplyVolt = vs - ground;
      const logicVolt = logic - ground;
      record.frames.push({ ...frame, motorSupplyVolt, logicVolt });
      if (sign === null) continue;
      assert.ok(
        motorSupplyVolt > spec.batteryVolt - 2 && motorSupplyVolt <= spec.batteryVolt + 0.01,
      );
      assert.ok(Math.abs(driver.terminalCurrents.OUT3) < 1e-8);
      assert.ok(Math.abs(driver.terminalCurrents.OUT4) < 1e-8);
      assert.ok(Math.abs(frame.motorA.voltageDrop - (OUT1 - OUT2)) < 1e-8);
      if (sign === 0) {
        assert.ok(logicVolt < 4.5);
        assert.equal(frame.logicLit, false);
        assert.ok(Math.abs(frame.motorA.current) < 1e-8);
        assert.ok(Math.abs(frame.motorA.outputRpm) < 1e-8);
        assert.ok(frame.diagnostics.some(({ code }) => code === 'l298n_logic_supply'));
      } else {
        assert.ok(logicVolt > 4.5 && logicVolt < 5.5);
        assert.equal(frame.logicLit, true);
        assert.ok(frame.motorA.voltageDrop * sign > 0.5, 'Output voltage polarity');
        assert.ok(frame.motorA.current * sign > 0.01, 'Winding current direction');
        assert.ok(frame.motorA.outputRpm * sign > 0, 'Actual shaft rotation');
      }
    }
    await closeWorker(spec.id);
    record.status = 'pass';
    await persistReceipt();
    console.log(
      'L298N_DOMAIN_WORKER_CASE_PASS',
      JSON.stringify({ id: spec.id, frames: record.frames.length }),
    );
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

  const standalone = {
    id: 'standalone-external-square-1khz',
    frames: [],
  };
  receipt.cases.push(standalone);
  const pwmDocument = externalSquareCircuit(5);
  await openWorker(standalone.id);
  standalone.preflight = await preflight(standalone.id, pwmDocument, 'none');
  let pwmState = identity.initialState;
  let pwmHorizon = 0;
  for (const [horizon, expectedVolt] of [
    [499, 5],
    [500, 0],
    [999, 0],
    [1000, 5],
    [40000, 5],
  ]) {
    const sample = await advance(standalone.id, pwmDocument, pwmState, horizon, pwmHorizon);
    assert.equal(component(sample.result, 'generator').signalInstantaneousVolt, expectedVolt);
    const summary = frameSummary(sample);
    assert.ok(Math.abs(summary.enaVolt - expectedVolt) < 1e-6);
    assert.ok(Math.abs(summary.enbVolt - expectedVolt) < 1e-6);
    standalone.frames.push(summary);
    pwmState = JSON.parse(JSON.stringify(sample.state));
    pwmHorizon = horizon;
  }
  await closeWorker(standalone.id);

  const alwaysHighId = 'standalone-constant-high';
  const highDocument = externalSquareCircuit(0);
  await openWorker(alwaysHighId);
  await preflight(alwaysHighId, highDocument, 'none');
  const alwaysHigh = frameSummary(
    await advance(alwaysHighId, highDocument, identity.initialState, 40000, 0),
  );
  await closeWorker(alwaysHighId);
  standalone.constantHigh = alwaysHigh;
  const pwm = standalone.frames.at(-1);
  for (const [motor, sign] of [
    ['motorA', 1],
    ['motorB', -1],
  ]) {
    assert.ok(pwm[motor].motorRpm * sign > 0);
    assert.ok(Math.abs(pwm[motor].motorRpm) < Math.abs(alwaysHigh[motor].motorRpm) * 0.75);
  }
  standalone.status = 'pass';
  await persistReceipt();
  console.log(
    'L298N_DOMAIN_WORKER_CASE_PASS',
    JSON.stringify({
      id: standalone.id,
      frames: standalone.frames.length,
      pwmRpm: [pwm.motorA.motorRpm, pwm.motorB.motorRpm],
      constantHighRpm: [alwaysHigh.motorA.motorRpm, alwaysHigh.motorB.motorRpm],
    }),
  );

  const fastPwm = { id: 'standalone-external-square-20khz', frames: [] };
  const fastDocument = externalSquareCircuit(5, 20_000);
  receipt.cases.push(fastPwm);
  await openWorker(fastPwm.id);
  fastPwm.preflight = await preflight(fastPwm.id, fastDocument, 'none');
  let fastState = identity.initialState;
  let fastHorizon = 0;
  for (const [horizon, expectedVolt] of [
    [24, 5],
    [25, 0],
    [49, 0],
    [50, 5],
    [109975, 0],
    [110000, 5],
  ]) {
    const sample = await advance(fastPwm.id, fastDocument, fastState, horizon, fastHorizon);
    assert.equal(component(sample.result, 'generator').signalInstantaneousVolt, expectedVolt);
    const frame = frameSummary(sample);
    assert.ok(Math.abs(frame.enaVolt - expectedVolt) < 1e-6);
    assert.ok(Math.abs(frame.enbVolt - expectedVolt) < 1e-6);
    fastPwm.frames.push(frame);
    fastState = JSON.parse(JSON.stringify(sample.state));
    fastHorizon = horizon;
  }
  await closeWorker(fastPwm.id);
  const fastFinal = fastPwm.frames.at(-1);
  assert.ok(fastFinal.motorA.motorRpm > 0);
  assert.ok(fastFinal.motorB.motorRpm < 0);
  fastPwm.status = 'pass';
  await persistReceipt();
  console.log(
    'L298N_DOMAIN_WORKER_CASE_PASS',
    JSON.stringify({
      id: fastPwm.id,
      finalHorizonMicroseconds: fastHorizon,
      frames: fastPwm.frames.length,
      pwmRpm: [fastFinal.motorA.motorRpm, fastFinal.motorB.motorRpm],
    }),
  );

  const bench = { id: 'arduino-regulated-motor-supply', frames: [] };
  const benchDocument = withMotorSupply(circuit(specs[0]));
  receipt.cases.push(bench);
  await openWorker(bench.id);
  bench.preflight = await preflight(bench.id, benchDocument);
  let benchState = identity.initialState;
  let benchHorizon = 0;
  for (const horizon of [0, 250, 1000, 10_000]) {
    const sample = await advance(bench.id, benchDocument, benchState, horizon, benchHorizon);
    const supply = component(sample.result, 'vs');
    assert.equal(supply.regulationMode, 'cv');
    if (horizon === 250) {
      assert.ok(supply.current > 0 && supply.current < 2);
      assert.ok(supply.terminalVoltages.positive > 5.8 && supply.terminalVoltages.positive < 6);
    }
    bench.frames.push(frameSummary(sample));
    benchState = JSON.parse(JSON.stringify(sample.state));
    benchHorizon = horizon;
  }
  await closeWorker(bench.id);
  bench.status = 'pass';
  await persistReceipt();
  console.log('L298N_DOMAIN_WORKER_CASE_PASS', JSON.stringify({ id: bench.id, frames: 4 }));

  const switches = { id: 'standalone-aa-switches', frames: [] };
  const switchesDocument = standaloneWithSwitches();
  receipt.cases.push(switches);
  await openWorker(switches.id);
  switches.preflight = await preflight(switches.id, switchesDocument, 'none');
  let switchState = identity.initialState;
  let switchHorizon = 0;
  const framesByHorizon = new Map();
  for (const [horizon, targetId, payload] of [
    [0],
    [250],
    [199_999],
    [200_000, 'in1', false],
    [350_000, 'in2', true],
    [549_999],
    [550_000, 'ena', false],
    [700_000, 'enb', false],
    [850_000],
  ]) {
    const events = targetId
      ? [{ atMicroseconds: horizon, targetId, operation: 'state', payload }]
      : undefined;
    const sample = await advance(
      switches.id,
      switchesDocument,
      switchState,
      horizon,
      switchHorizon,
      events,
    );
    const summary = frameSummary(sample);
    const driver = component(sample.result, 'driver');
    framesByHorizon.set(horizon, { summary, driver });
    switches.frames.push(summary);
    switchState = JSON.parse(JSON.stringify(sample.state));
    switchHorizon = horizon;
  }
  await closeWorker(switches.id);
  const loaded = framesByHorizon.get(250);
  assert.ok(
    loaded.driver.terminalVoltages['+12V'] > 5 && loaded.driver.terminalVoltages['+12V'] < 6,
  );
  assert.ok(loaded.summary.motorA.motorRpm > 0 && loaded.summary.motorB.motorRpm < 0);
  const braking = framesByHorizon.get(200_000);
  assert.ok(braking.driver.terminalVoltages.IN1 < 0.1 && braking.driver.terminalVoltages.IN2 < 0.1);
  assert.ok(braking.summary.enaVolt > 4.5);
  const reverse = framesByHorizon.get(549_999);
  assert.ok(reverse.summary.motorA.motorRpm < 0);
  const coast = framesByHorizon.get(550_000);
  assert.ok(coast.summary.enaVolt < 0.1 && coast.summary.enbVolt > 4.5);
  assert.ok(Math.abs(coast.summary.motorA.current - reverse.summary.motorA.current) < 0.01);
  assert.ok(
    Math.abs(coast.driver.terminalCurrents.OUT1) > 0.1,
    'Flyback carries the held winding current',
  );
  assert.ok(Math.abs(coast.driver.terminalCurrents.OUT1 + coast.summary.motorA.current) < 1e-8);
  const stopped = framesByHorizon.get(850_000);
  assert.equal(stopped.summary.logicLit, true);
  assert.ok(
    Math.abs(stopped.summary.motorA.current) < 1e-8 &&
      Math.abs(stopped.summary.motorB.current) < 1e-8,
  );
  switches.status = 'pass';
  await persistReceipt();
  console.log(
    'L298N_DOMAIN_WORKER_CASE_PASS',
    JSON.stringify({ id: switches.id, frames: switches.frames.length }),
  );

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
