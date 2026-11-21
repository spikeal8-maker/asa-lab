// Native Scratch dropdown/drag and real production Worker/controller ports.
// In-memory page only: no full app, server, installed acceptance or SaveCAS.
/* global window */
import assert from 'node:assert/strict';
import console from 'node:console';
import { URL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const alias = {
  '@asa-lab/electronics/simulation': resolve('contexts/electronics/simulation.ts'),
  '@asa-lab/electronics/engine': resolve('contexts/electronics/engine.ts'),
  '@asa-lab/electronics': resolve('contexts/electronics/index.ts'),
};
const worker = await build({
  entryPoints: ['apps/web/src/electronics/simulation.worker.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  alias,
});
if (process.argv.includes('--sustained-only')) {
  await sustainedOnly();
  process.exit(0);
}

async function sustainedOnly() {
  const output = resolve('test-results/uno-digital-pins-sustained');
  await mkdir(output, { recursive: true });
  const receipt = {
    sourceBaseline: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    fixtureSha256: createHash('sha256')
      .update(await readFile(new URL(import.meta.url)))
      .digest('hex'),
    boundary:
      'TEST ONLY production Worker + canonical 20x1kOhm/LED fixture; model time, no realtime/hardware/installed/SaveCAS claim',
    requestTimeoutMs: 30000,
    checkpoints: [],
    status: 'NOT_COMPLETED',
  };
  const entry = await build({
    stdin: {
      resolveDir: resolve('apps/web'),
      loader: 'ts',
      contents: `
import {ElectronicsSimulationWorkerClient} from './src/electronics/simulation-worker-client';
import {ElectronicsLiveSimulationWorkerController} from './src/electronics/live-simulation-worker-controller';
import {resetElectronicsTimedState} from '@asa-lab/electronics/engine';
import {unoDigitalDocument,unoDigitalSource,unoDigitalTerminals as terminals} from '../../contexts/electronics/testing/uno-digital-pins.fixture';
const even=terminals.map((_,i)=>i).filter(i=>i%2===0);
const writes=terminals.map((_,i)=>'digitalWrite('+(i<14?i:'A'+(i-14))+',phase=='+i%2+');').join('');
const source='int phase=0;'+unoDigitalSource(even).replace('void loop(){delay(100);}','void loop(){delay(250);phase=1-phase;'+writes+'}');
const documentFixture=unoDigitalDocument(source);
window.probe={requests:0,responses:0,errors:[],source};
const factory=()=>{const w=new Worker('/worker.js',{type:'module'});w.addEventListener('message',()=>window.probe.responses++);return w;};
const client=new ElectronicsSimulationWorkerClient(factory);
const generation=client.beginGeneration('twenty-sustained');
let state=resetElectronicsTimedState(),previousInput;
window.advance=async horizon=>{previousInput=JSON.parse(JSON.stringify(state));window.probe.requests++;
 const start=performance.now();const advance=await client.advance(generation,documentFixture,previousInput,horizon);
 state=JSON.parse(JSON.stringify(advance.state));return {advance,wallMs:performance.now()-start};};
window.repeat=async horizon=>{window.probe.requests++;return client.advance(generation,documentFixture,JSON.parse(JSON.stringify(previousInput)),horizon)};
window.closeLong=()=>client.dispose();
const controller=new ElectronicsLiveSimulationWorkerController(new ElectronicsSimulationWorkerClient(factory));
let running=false,committed=-1,ready=false,result=null,failure=null;
const render=()=>{window.lifecycle={running,committed,ready,result,failure};document.querySelector('output').textContent=JSON.stringify({running,committed,ready,failure})};
const callbacks={onInitialReady:()=>{ready=true;controller.update(documentFixture,100000);render()},onResult:r=>{result=r;render()},onCommittedHorizon:h=>{committed=h;render()},onFailure:f=>{failure=String(f);render()}};
document.querySelector('#run').onclick=()=>{running=true;committed=-1;ready=false;failure=null;controller.start('sustained-lifecycle',documentFixture,callbacks);render()};
document.querySelector('#reset').onclick=()=>{committed=-1;ready=false;failure=null;controller.restart(documentFixture);render()};
document.querySelector('#stop').onclick=()=>{controller.stop();running=false;render()};
window.pendingStop=()=>{controller.update(documentFixture,10000000);controller.stop();running=false;render()};
window.dispose=()=>{client.dispose();controller.dispose()};render();
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    alias,
  });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let lastAdvance;
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  function check(advance, horizon) {
    assert.equal(advance.executionStatus, 'ready');
    assert.equal(advance.committedHorizonMicroseconds, horizon);
    assert.deepEqual(advance.diagnostics, []);
    const result = advance.result;
    assert.equal(result.solved, true);
    assert.equal(result.status, 'solved');
    assert.equal(result.quality.finite, true);
    assert.equal(result.quality.passed, true);
    assert.ok(result.numericalResidual <= result.numericalTolerance);
    assert.ok(result.quality.maxKclResidualAmp <= result.quality.kclToleranceAmp);
    assert.ok(
      result.quality.maxSourceVoltageResidualVolt <= result.quality.sourceVoltageToleranceVolt,
    );
    for (const node of result.nodes) assert.ok(Number.isFinite(node.voltage));
    const runtime = JSON.parse(advance.state.continuation.serializedState).boards[0].runtime;
    assert.deepEqual(runtime.faults, []);
    const phase = Math.floor((horizon - 1000) / 250000) % 2;
    assert.equal(runtime.variables.phase, phase);
    const currents = [];
    for (let i = 0; i < 20; i++) {
      const terminal = i < 14 ? 'd' + i : 'a' + (i - 14),
        high = i % 2 === phase;
      assert.equal(runtime.pinModes[terminal], 'OUTPUT');
      assert.equal(runtime.outputVoltages[terminal], high ? 5 : 0);
      const led = result.components.find((c) => c.componentId === 'led' + i);
      const resistor = result.components.find((c) => c.componentId === 'r' + i);
      const current = Math.abs(led.current);
      assert.ok(Number.isFinite(current));
      assert.ok(Math.abs(Math.abs(resistor.voltageDrop / 1000) - current) < 1e-7);
      assert.ok(high ? current > 0.001 && current < 0.005 : current < 1e-8);
      assert.ok(high ? led.brightness > 0 : led.brightness === 0);
      currents.push(current);
    }
    assert.ok(currents.reduce((a, b) => a + b, 0) < 0.1);
    return { phase, currents, quality: result.quality };
  }
  try {
    await context.route('**/*', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/worker.js')
        return route.fulfill({ contentType: 'text/javascript', body: worker.outputFiles[0].text });
      if (path === '/')
        return route.fulfill({
          contentType: 'text/html',
          body: '<button id="run">Run</button><button id="stop">Stop</button><button id="reset">Reset</button><output></output>',
        });
      return route.abort();
    });
    await page.goto('https://asa-sustained.invalid/');
    await page.addScriptTag({ content: entry.outputFiles[0].text });
    const checkpoints = [
      100000,
      1000000,
      ...Array.from({ length: 36 }, (_, i) => 1125000 + i * 250000),
      10000000,
    ];
    for (const horizon of checkpoints) {
      const { advance, wallMs } = await page.evaluate((h) => window.advance(h), horizon);
      const observation = check(advance, horizon);
      receipt.checkpoints.push({
        horizon,
        wallMs,
        ...observation,
        stateSha256: hash(advance.state),
        resultSha256: hash(advance.result),
      });
      lastAdvance = advance;
      if (horizon === 1000000) {
        const repeated = await page.evaluate((h) => window.repeat(h), horizon);
        assert.deepEqual(repeated, advance);
        receipt.repeatedOneSecond = true;
      }
      await writeFile(resolve(output, 'progress.json'), JSON.stringify(receipt, null, 2));
      console.log(
        '20LED model=' +
          horizon +
          'us requestWall=' +
          wallMs.toFixed(1) +
          'ms phase=' +
          observation.phase,
      );
    }
    await page.evaluate(() => window.closeLong());
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.lifecycle.committed === 100000);
    const first = await page.evaluate(() => window.lifecycle);
    assert.equal(first.failure, null);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(() => window.lifecycle.committed === 100000);
    const reset = await page.evaluate(() => window.lifecycle);
    assert.equal(reset.failure, null);
    assert.deepEqual(reset.result, first.result);
    await page.evaluate(() => window.pendingStop());
    const stopped = await page.evaluate(() => window.lifecycle);
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.lifecycle), stopped);
    assert.equal(stopped.running, false);
    receipt.lifecycle = { resetResultSha256: hash(reset.result), pendingStopStable: true };
    receipt.finalAdvance = lastAdvance;
    receipt.probe = await page.evaluate(() => window.probe);
    assert.deepEqual(errors, []);
    assert.deepEqual(receipt.probe.errors, []);
    receipt.status = 'PASS';
  } catch (error) {
    receipt.status = 'BLOCKED';
    receipt.failure = String(error);
    receipt.lastCompletedModelMicroseconds = receipt.checkpoints.at(-1)?.horizon ?? 0;
    receipt.finalAdvance = lastAdvance;
    throw error;
  } finally {
    receipt.pageErrors = errors;
    await writeFile(resolve(output, '20led-sustained-783.json'), JSON.stringify(receipt, null, 2));
    await page.evaluate(() => window.dispose()).catch(() => {});
    await browser.close();
  }
  console.log(
    'PASS 20LED 10s MODEL / 250ms complementary patterns / JSON / quality / Reset / pending Stop; no realtime claim',
  );
}
const entry = await build({
  stdin: {
    resolveDir: resolve('apps/web'),
    loader: 'ts',
    contents: `
import * as S from 'scratch-blocks';
import * as A from './src/electronics/arduino-blocks';
import {ARDUINO_WORKSPACE_PLUGINS} from './src/electronics/arduino-block-ui';
import {ElectronicsSimulationWorkerClient} from './src/electronics/simulation-worker-client';
import {ElectronicsLiveSimulationWorkerController} from './src/electronics/live-simulation-worker-controller';
import {evaluateSimulationWorkerRequest} from './src/electronics/simulation-worker-evaluator';
import {ELECTRONICS_SIMULATION_WORKER_PROTOCOL as protocolVersion,ELECTRONICS_SIMULATION_ENGINE_REVISION as engineRevision} from './src/electronics/simulation-worker-protocol';
import {advanceElectronicsToHorizon,resetElectronicsTimedState} from '@asa-lab/electronics/engine';
import {unoDigitalDocument as doc,unoDigitalSource as source,unoDigitalTerminals as terminals} from '../../contexts/electronics/testing/uno-digital-pins.fixture';
A.registerArduinoBlocks();
const w=S.inject(document.querySelector('#host'),{sounds:false,scrollbars:true,trashcan:false,plugins:ARDUINO_WORKSPACE_PLUGINS,scratchTheme:S.ScratchBlocksTheme.CLASSIC,zoom:{startScale:0.7}});
const factory=()=>new Worker('/worker.js',{type:'module'});
window.proof=async()=>{
 const client=new ElectronicsSimulationWorkerClient(factory), receipts=[];
 const directPayload=(document)=>evaluateSimulationWorkerRequest({protocolVersion,engineRevision,requestId:'direct',generationId:1,projectSessionId:'direct',kind:'advance',document,state:resetElectronicsTimedState(),requestedHorizonMicroseconds:20000}).advance;
 try{
  const generation=client.beginGeneration('uno-digital-pins');
  for(const high of [...terminals.map((_,i)=>[i]),[],terminals.map((_,i)=>i),[0,2,4,6,8,10,12,14,16,18],[1,5,13,14,19]]){
   const document=doc(source(high));
   const advance=await client.advance(generation,document,resetElectronicsTimedState(),20000);
   const direct=advanceElectronicsToHorizon(document,{state:resetElectronicsTimedState(),requestedHorizonMicroseconds:20000});
   if(advance.executionStatus!=='ready'||!advance.result?.solved)throw Error('Worker not solved');
   receipts.push({high,state:advance.state,result:advance.result,direct,projected:directPayload(document)});
  }
  const document=doc(source([0,13,14,19]));
  const first=await client.advance(generation,document,resetElectronicsTimedState(),1000);
  const sliced=await client.advance(generation,document,JSON.parse(JSON.stringify(first.state)),20000);
  const whole=directPayload(document);
  return {receipts,sliced,whole};
 }finally{client.dispose()}
};
const input=document.querySelector('textarea');input.value=source([0,13,14,19]);
const controller=new ElectronicsLiveSimulationWorkerController(new ElectronicsSimulationWorkerClient(factory));
let running=false,ready=false,results=0,committed=0,failure=null;
const current=()=>doc(input.value);
const render=()=>{window.receipt={running,ready,results,committed,failure};document.querySelector('output').textContent=JSON.stringify(window.receipt)};
const callbacks={onInitialReady:()=>{ready=true;render();controller.update(current(),20000)},onResult:()=>{results++;render()},onCommittedHorizon:h=>{committed=h;render()},onFailure:f=>{failure=f;running=false;render()}};
document.querySelector('#run').onclick=()=>{running=true;ready=false;failure=null;committed=0;controller.start('uno-ports',current(),callbacks);render()};
document.querySelector('#stop').onclick=()=>{controller.stop();running=false;render()};
document.querySelector('#reset').onclick=()=>{ready=false;failure=null;committed=0;controller.restart(current());render()};
input.oninput=()=>{if(running)controller.update(current(),30000);render()};
window.fixture={S,A,w,source,dispose:()=>{controller.dispose();w.dispose()}};render();
`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  alias,
  define: { 'process.env.NODE_ENV': '"test"' },
});
const output = resolve('test-results/uno-digital-pins');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const receipts = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    let workers = 0;
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('worker', () => workers++);
    await context.route('**/*', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/worker.js')
        return route.fulfill({ contentType: 'text/javascript', body: worker.outputFiles[0].text });
      if (path === '/')
        return route.fulfill({
          contentType: 'text/html',
          body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#host{width:100vw;height:540px}textarea{width:95%;height:90px}output{display:block;overflow-wrap:anywhere}button{min-height:44px}</style><div id="host"></div><button id="run">Run</button><button id="stop">Stop</button><button id="reset">Reset</button><textarea aria-label="source"></textarea><output></output>',
        });
      return route.abort();
    });
    await page.goto('https://asa-uno-pins.invalid/');
    await page.addScriptTag({ content: entry.outputFiles[0].text });
    const { receipts: proof, sliced, whole } = await page.evaluate(() => window.proof());
    assert.deepEqual(sliced.state, whole.state);
    assert.deepEqual(sliced.result, whole.result);
    assert.equal(proof.length, 24);
    for (const { high, state, result, direct, projected } of proof) {
      assert.deepEqual(state, direct.state);
      assert.deepEqual(result, projected.result);
      for (const [key, value] of Object.entries(direct.observation))
        if (key !== 'ledTemporal') assert.deepEqual(result[key], value);
      assert.equal(result.status, 'solved');
      assert.ok(result.numericalResidual <= result.numericalTolerance);
      assert.equal(result.quality.finite, true);
      assert.equal(result.quality.passed, true);
      assert.ok(result.quality.maxKclResidualAmp <= result.quality.kclToleranceAmp);
      assert.ok(
        result.quality.maxSourceVoltageResidualVolt <= result.quality.sourceVoltageToleranceVolt,
      );
      for (let i = 0; i < 20; i++) {
        const led = result.components.find((c) => c.componentId === `led${i}`);
        assert.ok(Number.isFinite(led.current));
        assert.ok(
          high.includes(i)
            ? Math.abs(led.current) > 0.001 && Math.abs(led.current) < 0.005
            : Math.abs(led.current) < 1e-8,
        );
        assert.ok(high.includes(i) ? led.brightness > 0 : led.brightness === 0);
      }
    }
    // Exercise each real field dropdown by native mouse/menu events.
    await page.evaluate(() => {
      const { A, w } = window.fixture;
      const setup = w.newBlock('asa_setup'),
        target = w.newBlock('asa_digital_write');
      setup.getInput('DO').connection.connect(target.previousConnection);
      A.applyArduinoBlockDefaults(w);
      for (const b of w.getAllBlocks(false)) {
        b.initSvg();
        b.render();
      }
      setup.moveBy(12, 40);
      window.fixture.target = target;
    });
    const selected = [];
    for (const pin of ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']) {
      const point = await page.evaluate(() => {
        const field = window.fixture.target.getInputTargetBlock('PIN').getField('VALUE');
        const box = field.getSvgRoot().getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });
      await page.mouse.click(point.x, point.y);
      if (pin === 'A5')
        await page.screenshot({ path: resolve(output, `uno-dropdown-${width}.png`) });
      await page.getByRole('option', { name: pin, exact: true }).click();
      const code = await page.evaluate(() =>
        window.fixture.A.generateArduinoCode(window.fixture.w),
      );
      assert.ok(code.includes(`digitalWrite(${pin},`));
      selected.push(pin);
    }
    // Drag a computed variable+expression into PIN using production connection checker.
    await page.waitForTimeout(220);
    const points = await page.evaluate(() => {
      const { A, w, target } = window.fixture;
      const variable = w.getVariableMap().createVariable('port');
      const value = w.newBlock('asa_var_get');
      value.setFieldValue(variable.getId(), 'NAME');
      const dragged = w.newBlock('asa_math_add');
      dragged.getInput('A').connection.connect(value.outputConnection);
      A.applyArduinoBlockDefaults(w);
      for (const b of w.getAllBlocks(false)) {
        b.initSvg();
        b.render();
      }
      dragged.moveBy(20, 280);
      window.fixture.dragged = dragged;
      const box = dragged.getSvgRoot().getBoundingClientRect();
      const start = { x: box.left + 24, y: box.top + 2 };
      const point = w.getParentSvg().createSVGPoint();
      const position = target.getRelativeToSurfaceXY(),
        offset = target.getInput('PIN').connection.getOffsetInBlock();
      point.x = position.x + offset.x;
      point.y = position.y + offset.y;
      const end = point.matrixTransform(w.getCanvas().getScreenCTM());
      const origin = dragged.getRelativeToSurfaceXY(),
        out = dragged.outputConnection.getOffsetInBlock();
      point.x = origin.x + out.x;
      point.y = origin.y + out.y;
      const output = point.matrixTransform(w.getCanvas().getScreenCTM());
      return { start, end: { x: end.x + start.x - output.x, y: end.y + start.y - output.y } };
    });
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.start.x + 12, points.start.y + 12, { steps: 4 });
    await page.mouse.move(points.end.x, points.end.y, { steps: 24 });
    await page.mouse.up();
    await page.screenshot({ path: resolve(output, `uno-expression-${width}.png`) });
    const roundtrip = await page.evaluate(() => {
      const { S, A, w, target, dragged } = window.fixture;
      if (target.getInputTargetBlock('PIN') !== dragged)
        throw Error('Native expression drag did not connect');
      const code = A.generateArduinoCode(w),
        saved = S.serialization.workspaces.save(w);
      w.clear();
      S.serialization.workspaces.load(
        A.migrateLegacyArduinoWorkspaceState(JSON.parse(JSON.stringify(saved))),
        w,
      );
      A.applyArduinoBlockDefaults(w);
      if (A.generateArduinoCode(w) !== code) throw Error('Expression source changed after reopen');
      // Representative old analog field schema preserves its value on reopen.
      const old = {
        blocks: {
          blocks: [
            {
              type: 'asa_setup',
              inputs: {
                DO: {
                  block: {
                    type: 'asa_digital_write',
                    id: 'legacy',
                    fields: { PIN: 'A5', LEVEL: 'HIGH' },
                  },
                },
              },
            },
          ],
        },
      };
      w.clear();
      S.serialization.workspaces.load(A.migrateLegacyArduinoWorkspaceState(old), w);
      A.applyArduinoBlockDefaults(w);
      const oldCode = A.generateArduinoCode(w),
        oldSave = S.serialization.workspaces.save(w);
      if (!oldCode.includes('digitalWrite(A5, HIGH)'))
        throw Error('Legacy analog field migration failed: ' + oldCode);
      w.clear();
      S.serialization.workspaces.load(
        A.migrateLegacyArduinoWorkspaceState(JSON.parse(JSON.stringify(oldSave))),
        w,
      );
      A.applyArduinoBlockDefaults(w);
      if (A.generateArduinoCode(w) !== oldCode) throw Error('Legacy source changed after reopen');
      return { code, oldCode };
    });
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const stopped = await page.evaluate(() => window.receipt);
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.receipt), stopped);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    await page
      .getByRole('textbox', { name: 'source' })
      .fill('void setup(){unknown();}void loop(){}');
    await page.waitForFunction(() => window.receipt.failure !== null);
    const invalid = await page.evaluate(() => window.receipt);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'source' })
      .fill(await page.evaluate(() => window.fixture.source([14, 19])));
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(
      () => window.receipt.committed === 20000 && window.receipt.failure === null,
    );
    assert.deepEqual(errors, []);
    assert.ok(workers >= 5);
    await page.screenshot({ path: resolve(output, `uno-pins-${width}.png`) });
    receipts.push({
      width,
      workers,
      selected,
      roundtrip,
      stopped,
      invalid,
      actualWorkerMatchesDirectStateAndResult: true,
      serializedContinuation: true,
      patterns: proof.map(({ high, result }) => ({
        high,
        residual: result.numericalResidual,
        tolerance: result.numericalTolerance,
        leds: result.components.filter((c) => c.componentId.startsWith('led')),
      })),
    });
    await page.evaluate(() => window.fixture.dispose());
    await context.close();
  }
  await writeFile(
    resolve(output, 'receipts.json'),
    JSON.stringify(
      {
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        boundary:
          'Native Blockly and production Worker/controller ports; full app, SaveCAS and installed acceptance NOT_RUN',
        receipts,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS native Blockly A0-A5 dropdown/expression/legacy reopen, actual Worker twenty-output solver/direct/JSON continuation, controller Run/Stop/Reset/source ports at 1440/390. Full app and SaveCAS NOT_RUN.',
  );
} finally {
  await browser.close();
}
