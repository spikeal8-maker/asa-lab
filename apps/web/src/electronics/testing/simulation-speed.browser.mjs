// Real mounted editor/Worker/Stage. API/assets are fixture ports, no listening server.
/* global window, document, URL, MessageEvent, console */
import process from 'node:process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const overload = process.argv.includes('--overload');
const output = resolve(
  overload ? 'reports/electronics-overload' : 'test-results/simulation-speed-861/native',
);
await mkdir(output, { recursive: true });
const opts = {
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  alias: Object.fromEntries(
    ['', '/rendering', '/simulation', '/engine', '/timed-state'].map((s) => [
      '@asa-lab/electronics' + s,
      resolve('contexts/electronics/' + (s.slice(1) || 'index') + '.ts'),
    ]),
  ),
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '{}',
    'import.meta.url': '"https://speed-fixture.invalid/fixture.js"',
  },
};
const worker = (
  await build({ ...opts, entryPoints: ['apps/web/src/electronics/simulation.worker.ts'] })
).outputFiles[0].text;
const catalog = await readFile(
  'apps/web/public/assets/electronics/component-database/catalog.json',
  'utf8',
);
const css = await readFile('apps/web/src/electronics/workbench.css', 'utf8');
const source = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {api} from './src/api';import {SchematicEditor} from './src/pages/SchematicEditor';
import {configureProductionLibrary} from './src/electronics/production-manifest-adapter';
import {rawDisplayCircuit,RAW_DISPLAY_PINS} from '../../contexts/electronics/testing/fixtures/raw-seven-segment';
import {parseElectronicsDocument,analyseCircuit} from '@asa-lab/electronics';
configureProductionLibrary(${catalog});window.fixture={requests:[],responses:[]};
const NativeWorker=window.Worker;
const workerURL=URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'}));
window.Worker=class extends NativeWorker {
  constructor(){
    super(workerURL);
    window.fixture.worker=this;
    this.addEventListener('message', e=>{
      if(e.isTrusted) window.fixture.responses.push(e.data);
      if(window.fixture.holdNext && e.data.kind==='advance'){
        window.fixture.holdNext=false;
        window.fixture.held=e.data;
        e.stopImmediatePropagation();
      }
    });
  }
  postMessage(message){
    window.fixture.requests.push(message);
    super.postMessage(message);
  }
};
window.fixture.replay=async presented=>{
  const {requests,responses,live}=window.fixture;
  const outcomes=new Map(responses.map(reply=>[reply.requestId, reply]));
  const committed=live.committedHorizonMicroseconds;
  const control=new NativeWorker(workerURL);
  const inputs=[];
  const horizons=[];
  const ledLevels=new Set();
  let positiveWindows=0;
  let ledEdges=0;
  let visiblePhase=null;
  let last;
  let previous;
  let preflight=0;
  try {
    for(const req of [...requests]){
      const actual=outcomes.get(req.requestId);
      if (!actual || (actual.kind==='advance' && actual.advance.committedHorizonMicroseconds>committed)) break;
      const state=req.kind==='advance'&&previous ? previous : req.state;
      if(req.kind==='advance' && JSON.stringify(state)!==JSON.stringify(req.state))
        throw Error('Control predecessor differs for '+req.requestId);
      const baseline=await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(Error('Control Worker did not answer '+req.requestId)),10000);
        control.onmessage=({data})=>{clearTimeout(timeout);resolve(data);};
        control.onerror=(error)=>{clearTimeout(timeout);reject(Error(error.message));};
        control.postMessage(req.kind==='advance'?{...req,state}:req);
      });
      const canonical=({metrics,...message})=>message;
      if(!actual.ok||JSON.stringify(canonical(actual))!==JSON.stringify(canonical(baseline)))
        throw Error('Control Worker result differs for '+req.requestId);
      if(baseline.kind==='preflight'){
        preflight++;
        continue;
      }
      const {advance}=baseline;
      if(advance.executionStatus!=='ready'||!advance.result?.quality.passed)
        throw Error('Non-ready or unchecked physical result at '+req.requestId);
      previous=advance.state;
      const time=advance.committedHorizonMicroseconds;
      const prior=horizons.at(-1)??0;
      if(time!==req.requestedHorizonMicroseconds||time<prior)
        throw Error('Non-canonical horizon at '+req.requestId);
      horizons.push(time);
      if(time>prior) positiveWindows++;
      for(const e of req.inputEvents??[]){
        if(e.atMicroseconds<prior || e.atMicroseconds>time)
          throw Error('Input outside its physical interval '+req.requestId);
        inputs.push(e);
      }
      const led=advance.ledTemporal?.components.find(c=>c.componentId==='led');
      if(!led || led.truncated) throw Error('Missing complete LED history at '+req.requestId);
      ledEdges+=led.transitionCount;
      for(const sample of led.samples){
        const lit=sample.brightness>0;
        ledLevels.add(lit);
        if(sample.atMicroseconds<=presented) visiblePhase=lit;
      }
      last=advance;
    }
  } finally {
    control.terminate();
  }
  if(last?.committedHorizonMicroseconds!==committed)
    throw Error('Control replay did not cover the accepted UI horizon');
  const {physicalState,thermalEpochs,reachedMicroseconds}=JSON.parse(last.state.continuation.serializedState);
  return {preflight,horizons,positiveWindows,inputs,ledLevels:[...ledLevels],ledEdges,visiblePhase,thermalEntries:physicalState.thermal.length,
    thermalEpochs:thermalEpochs?.length??0,reachedMicroseconds,committed,fullRepliesEqual:true};
};
const pins=RAW_DISPLAY_PINS.map(p=>'pinMode('+p+',OUTPUT);').join('');
const writes=RAW_DISPLAY_PINS.map((p,i)=>'digitalWrite('+p+','+(i===7?'LOW':'HIGH')+');').join('');
const servoMode=new URL(window.location.href).searchParams.get('fixture')==='servo';
const code=(servoMode?'#include <Servo.h>\\nServo motor;':'')+'int k=0;void setup(){Serial.begin(9600);'+(servoMode?'motor.attach(3);':'pinMode(13,OUTPUT);'+pins)+'pinMode(2,INPUT_PULLUP);}void loop(){'+(servoMode?'motor.write(k?135:45);':writes+'digitalWrite(13,k);')+'Serial.println(k);Serial.println(digitalRead(2));if(Serial.available()){Serial.println(Serial.read());}k=1-k;delay(20);}';
let saved=rawDisplayCircuit({source:code});
saved.components[0].pinIds.push('d2','d3');
saved.components.forEach((c,i)=>c.position=c.id==='uno'?{x:20,y:200}:c.id==='display'?{x:570,y:20}:{x:300,y:20+i*40});
saved.components.push({id:'servo',kind:'visual',componentTypeId:'servo-motor',variantId:'servo-motor',value:0,position:{x:750,y:160},pinIds:['gnd','vcc','signal']},{id:'led',kind:'led',componentTypeId:'led-5mm',value:2,position:{x:570,y:300},pinIds:['anode','cathode'],stateProperties:{ledColour:'red'}},{id:'led-r',kind:'resistor',value:330,position:{x:420,y:300}},{id:'button',kind:'button',componentTypeId:'button-tactile-6mm',value:0,state:false,position:{x:640,y:400},pinIds:['SW-A1','SW-A2','SW-B1','SW-B2'],internalConnections:[['SW-A1','SW-A2'],['SW-B1','SW-B2']]});
for(const [a,b,c,d] of [['uno','power-5v','servo','vcc'],['uno','power-gnd-1','servo','gnd'],['uno','d3','servo','signal'],['uno','d13','led-r','a'],['led-r','b','led','anode'],['led','cathode','uno','power-gnd-1'],['uno','d2','button','SW-A1'],['button','SW-B1','uno','power-gnd-1']])saved.connections.push({id:'extra'+saved.connections.length,from:{componentId:a,terminal:b},to:{componentId:c,terminal:d}});
saved.components=saved.components.filter(c=>servoMode?['uno','servo','button'].includes(c.id):c.id!=='servo');
const ids=new Set(saved.components.map(c=>c.id));saved.connections=saved.connections.filter(w=>ids.has(w.from.componentId)&&ids.has(w.to.componentId));
saved.simulation.running=false;let revision=1;
api.me=async()=>({ok:true,status:200,data:{authenticated:true,user:{id:'owner',displayName:'Owner'}}});
api.openProject=async id=>({ok:true,status:200,data:{project:{id,moduleKey:'electronics',title:'Скорость моделирования',scope:'personal',classroomId:null,status:'active'},draft:{projectId:id,document:saved,revision,updatedAt:''},versions:[],result:null}});
api.saveDraft=async(id,document)=>{const parsed=parseElectronicsDocument(JSON.parse(JSON.stringify(document)));if(!parsed.ok)throw Error(parsed.message);saved=parsed.document;return{ok:true,status:200,data:{draft:{projectId:id,document:saved,revision:++revision,updatedAt:''},result:analyseCircuit(parsed.document)}}};
window.fixture.snapshot=()=>{const wb=window.fixture.wb,live=window.fixture.live,s=wb.nativeOpticalPresentation.getSnapshot().committed;return {pace:wb.simulationPacing.read(),C:live.committedHorizonMicroseconds,P:s?.frame.atMicroseconds,clock:wb.committedSimulationTimeMs,serial:wb.arduinoSerialByBoard,state:live.timedState,generation:live.generationId,requests:window.fixture.requests.length,result:s?.result,frame:s?{atMicroseconds:s.frame.atMicroseconds,led:Object.fromEntries(s.frame.brightness),segments:Object.fromEntries(s.frame.sevenSegmentBrightness??[])}:null,horn:document.querySelector('[data-component-id="servo"] [data-testid="servo-motor-horn"]')?.getAttribute('transform')};};
createRoot(document.getElementById('app')).render(<SchematicEditor projectId="speed-project" user={{id:'owner',email:'',displayName:'Owner'}} onBack={()=>{}}/>);
`;
const ui = (
  await build({
    ...opts,
    stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: source },
    plugins: [
      {
        name: 'readonly-test-observers',
        setup(builder) {
          builder.onLoad({ filter: /pages[\\/]SchematicEditor\.tsx$/ }, async (args) => ({
            loader: 'tsx',
            contents: (await readFile(args.path, 'utf8')).replace(
              'const controller = useElectronicsWorkbench(projectId, user.id, seatLearner);',
              'const controller = useElectronicsWorkbench(projectId, user.id, seatLearner); window.fixture.wb=controller;',
            ),
          }));
          builder.onLoad({ filter: /live-simulation-worker-controller\.ts$/ }, async (args) => ({
            loader: 'ts',
            contents: (await readFile(args.path, 'utf8')).replace(
              'this.projectSessionId = projectSessionId;',
              'window.fixture.live=this;this.projectSessionId = projectSessionId;',
            ),
          }));
        },
      },
    ],
  })
).outputFiles[0].text;
const browser = await chromium.launch({ headless: true });
const receipts = [];
try {
  for (const [width, fixture] of [
    [1440, 'display'],
    [1440, 'servo'],
    [390, 'display'],
    [390, 'servo'],
  ].slice(0, overload ? 1 : undefined)) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await context.route('https://speed-fixture.invalid/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/assets/'))
        await route.fulfill({
          body: await readFile(resolve('apps/web/public', '.' + path)),
          contentType: path.endsWith('.json') ? 'application/json' : 'image/svg+xml',
        });
      else if (path.startsWith('/api/')) await route.fulfill({ status: 200, json: {} });
      else
        await route.fulfill({
          contentType: 'text/html',
          body:
            '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}' +
            css +
            '</style><div id="app"></div><script>' +
            ui +
            '</script>',
        });
    });
    try {
      await page.goto('https://speed-fixture.invalid/?fixture=' + fixture);
      await page.waitForFunction(() => window.fixture.wb?.status === 'ready');
      if (overload) {
        receipts.push(await verifyOverload(page));
        assert.deepEqual(errors, []);
        continue;
      }
      // Zero selected before Run proves preflight/H0 still completes without positive work.
      await page.evaluate(() => {
        window.fixture.wb.setLibraryOpen(false);
        window.fixture.wb.fitScene();
        window.fixture.wb.setSimulationRate(0);
        return window.fixture.wb.toggleSimulation();
      });
      await page.waitForFunction(
        () =>
          window.fixture.live &&
          window.fixture.wb.simulationPacing.read().phase === 'paused' &&
          window.fixture.snapshot().P === 0,
        { timeout: 30000 },
      );
      const initial = await page.evaluate(() => window.fixture.snapshot());
      assert.equal(initial.C, 0);
      assert.equal(initial.P, 0);
      const trigger = page.getByRole('button', {
        name: 'Изменить скорость моделирования',
        exact: true,
      });
      if (width === 390) await trigger.tap();
      else await trigger.click();
      const panel = page.getByRole('dialog', { name: 'Скорость моделирования', exact: true });
      const bounds = await panel.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      const slider = panel.getByRole('slider');
      await slider.focus();
      await slider.press('End');
      await page.waitForFunction(() => window.fixture.snapshot().P >= 20000, { timeout: 30000 });
      const fast = await page.evaluate(() => window.fixture.snapshot());
      assert.equal(fast.pace.rate, 10);
      assert.equal(fast.generation, initial.generation);
      assert.equal(fast.result.quality.passed, true);
      if (fixture === 'servo') {
        const angle = fast.result.components.find(
          (c) => c.componentId === 'servo',
        ).servoAngleDegrees;
        assert.ok(Number.isFinite(angle));
        assert.equal(fast.horn, 'rotate(' + (angle - 90) + ' 114.5 314)');
      } else {
        assert.ok(fast.frame.segments.display);
        assert.ok(fast.frame.led.led >= 0);
      }
      await page.evaluate(() => {
        window.fixture.holdNext = true;
      });
      await page.waitForFunction(() => !!window.fixture.held, { timeout: 30000 });
      await slider.press('Home');
      await page.waitForFunction(
        () => window.fixture.wb.simulationPacing.read().phase === 'paused',
      );
      const paused = await page.evaluate(() => window.fixture.snapshot());
      await page.evaluate(() => {
        window.fixture.wb.toggleComponentState('button');
        window.fixture.wb.sendArduinoSerialRx('uno', 'Z');
        const held = window.fixture.held;
        window.fixture.held = null;
        window.fixture.worker.dispatchEvent(new MessageEvent('message', { data: held }));
      });
      await page.waitForTimeout(300);
      const held = await page.evaluate(() => window.fixture.snapshot());
      for (const key of ['C', 'P', 'clock', 'state', 'serial', 'requests', 'generation', 'horn'])
        assert.deepEqual(held[key], paused[key], key + ' changed on pause');
      await page.screenshot({ path: resolve(output, `paused-${fixture}-${width}.png`) });
      await panel.getByRole('button', { name: 'Продолжить ×10', exact: true }).click();
      await page.waitForFunction(
        () =>
          Object.values(window.fixture.wb.arduinoSerialByBoard).some((s) =>
            s.tx.some((t) => t.text.includes('90')),
          ),
        { timeout: 30000 },
      );
      const resumed = await page.evaluate(() => window.fixture.snapshot());
      assert.equal(resumed.generation, initial.generation);
      assert.ok(resumed.C >= paused.C);
      assert.ok(resumed.P >= paused.P);
      const rxEvents = await page.evaluate(() =>
        window.fixture.requests
          .filter((r) => r.kind === 'advance')
          .flatMap((r) => r.inputEvents ?? [])
          .filter((e) => e.operation === 'serialRx'),
      );
      assert.equal(rxEvents.length, 1);
      assert.equal(rxEvents[0].payload, 'Z');
      assert.ok(rxEvents[0].atMicroseconds > paused.C);
      const rates = [];
      for (const rate of [0.1, 1, 2, 10]) {
        const start = await page.evaluate(() => window.fixture.snapshot());
        const wall = Date.now();
        await page.evaluate((r) => window.fixture.wb.setSimulationRate(r), rate);
        await page.waitForFunction((c) => window.fixture.snapshot().C > c, start.C, {
          timeout: 30000,
        });
        const end = await page.evaluate(() => window.fixture.snapshot());
        assert.equal(end.pace.rate, rate);
        assert.equal(end.generation, initial.generation);
        assert.ok(end.P >= start.P);
        assert.equal(end.result.quality.passed, true);
        rates.push({
          rate,
          wallMs: Date.now() - wall,
          fromC: start.C,
          toC: end.C,
          fromP: start.P,
          toP: end.P,
        });
      }
      await slider.press('Escape');
      assert.equal(await panel.count(), 0);
      if (width === 390) await trigger.tap();
      else await trigger.click();
      const normalButton = page
        .getByRole('dialog', { name: 'Скорость моделирования', exact: true })
        .getByRole('button', { name: '×1', exact: true });
      if (width === 390) await normalButton.tap();
      else await normalButton.click();
      await page.screenshot({ path: resolve(output, `running-${fixture}-${width}.png`) });
      await page.evaluate(() => window.fixture.wb.toggleSimulation());
      await page.waitForFunction(() => !window.fixture.wb.simulationRunning);
      assert.equal(await trigger.count(), 0);
      assert.deepEqual(errors, []);
      receipts.push({
        width,
        fixture,
        initial,
        fast,
        paused,
        held,
        resumed,
        rates,
        rxEvents,
        errors,
      });
    } catch (error) {
      await writeFile(
        resolve(output, overload ? 'failure.json' : `failure-${fixture}-${width}.json`),
        JSON.stringify(
          {
            error: String(error),
            errors,
            document: await page.evaluate(() => window.fixture.wb?.document),
            requests: await page.evaluate(() => window.fixture.requests),
            responses: await page.evaluate(() => window.fixture.responses),
            snapshot: await page.evaluate(() =>
              window.fixture.wb && window.fixture.live ? window.fixture.snapshot() : null,
            ),
          },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify(receipts, null, 2));
  console.log(
    overload
      ? 'PASS native overload: committed result, LED edges, heat, numerical quality and timestamped input match the control Worker.'
      : 'PASS real speed/pause/queued GPIO and Serial/default generation/native LED Servo seven-segment 1440/390; pacing demand is not throughput acceptance.',
  );
} finally {
  await browser.close();
}

async function verifyOverload(page) {
  await page.evaluate(() => {
    window.fixture.wb.setLibraryOpen(false);
    window.fixture.wb.fitScene();
  });
  await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
  const trigger = page.getByRole('button', {
    name: 'Изменить скорость моделирования',
    exact: true,
  });
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'Скорость моделирования', exact: true });
  await panel.getByRole('button', { name: '×1', exact: true }).click();
  const slider = panel.getByRole('slider');
  await slider.press('ArrowRight');
  assert.equal(await slider.getAttribute('aria-valuetext'), '×2');

  const readRate = () =>
    page.evaluate(() => {
      const raw = document
        .querySelector('.workbench-simulation-rate')
        ?.getAttribute('data-actual-rate');
      return raw == null ? null : Number(raw);
    });
  const waitForProgress = () =>
    page.waitForFunction((readRateInBrowser) => {
      const field = document.querySelector(readRateInBrowser)?.getAttribute('data-actual-rate');
      return Number(field) > 0;
    }, '.workbench-simulation-rate');
  await waitForProgress();
  const before = await page.evaluate(() => window.fixture.snapshot());
  assert.equal(before.pace.rate, 2);
  assert.ok(before.P > 0 && before.result.quality.passed);
  const beforeRate = await readRate();

  await page.evaluate(() => {
    window.fixture.holdNext = true;
  });
  await page.waitForFunction(() => Boolean(window.fixture.held));
  const held = await page.evaluate(() => {
    const fixture = window.fixture;
    fixture.wb.sendArduinoSerialRx('uno', 'Z');
    fixture.wb.toggleComponentState('button');
    return {
      at: window.performance.now(),
      C: fixture.snapshot().C,
      requestId: fixture.held.requestId,
    };
  });
  await page.waitForFunction(
    () =>
      document.querySelector('.workbench-simulation-rate')?.getAttribute('data-actual-rate') ===
      '0',
  );
  assert.equal(await readRate(), 0);
  assert.match(await panel.textContent(), /Фактически: ×0 · Медленнее выбранной/);
  assert.equal(await slider.getAttribute('aria-valuetext'), '×2');
  const stall = await page.evaluate(() => window.fixture.snapshot());
  assert.equal(stall.C, held.C);
  assert.ok(stall.P <= stall.C);

  const delivery = await page.evaluate(() => {
    const { worker, held } = window.fixture;
    window.fixture.held = null;
    worker.dispatchEvent(new MessageEvent('message', { data: held }));
    return window.performance.now();
  });
  await waitForProgress();
  await page.waitForFunction(() =>
    Object.values(window.fixture.wb.arduinoSerialByBoard).some((s) =>
      s.tx.some((t) => t.text.includes('90')),
    ),
  );
  const recoveredRate = await readRate();
  const { recovered, replay, rendered } = await page.evaluate(async () => {
    const { snapshot } = window.fixture;
    const recovered = snapshot();
    const element = document.querySelector(
      '[data-component-id="led"][data-led-brightness], [data-component-id="led"] [data-led-brightness]',
    );
    const rendered = element?.getAttribute('data-led-brightness') ?? null;
    const replay = window.fixture.replay(recovered.P);
    window.fixture.wb.setSimulationRate(0);
    return { recovered, replay: await replay, rendered };
  });
  assert.ok(recoveredRate > 0);
  assert.ok(recovered.C > held.C && recovered.P > stall.P);
  assert.equal(recovered.generation, before.generation);
  assert.equal(recovered.pace.rate, 2);
  assert.ok(recovered.result.quality.passed);
  assert.ok(recovered.frame.segments.display);
  assert.notEqual(rendered, null);
  assert.equal(Number(rendered) > 0, recovered.frame.led.led > 0);
  assert.equal(Number(rendered) > 0, replay.visiblePhase);
  assert.equal(replay.preflight, 1);
  assert.equal(replay.horizons[0], 0);
  assert.equal(replay.reachedMicroseconds, recovered.C);
  assert.ok(replay.positiveWindows >= 2 && replay.thermalEntries > 0);
  assert.deepEqual(new Set(replay.ledLevels), new Set([true, false]));
  assert.ok(replay.ledEdges >= 2);
  assert.deepEqual(
    replay.inputs.map(({ targetId, operation, payload }) => [targetId, operation, payload]),
    [
      ['uno', 'serialRx', 'Z'],
      ['button', 'state', true],
    ],
  );
  assert.ok(
    replay.inputs.every(
      (event, index, inputs) =>
        event.atMicroseconds > held.C &&
        (index === 0 || event.atMicroseconds >= inputs[index - 1].atMicroseconds),
    ),
  );
  return {
    selectedRate: 2,
    beforeRate,
    stalledRate: 0,
    recoveredRate,
    heldRequestId: held.requestId,
    deliveryDelayMs: delivery - held.at,
    stalledCommittedMicroseconds: stall.C,
    recoveredPresentedMicroseconds: recovered.P,
    renderedLedBrightness: Number(rendered),
    ...replay,
  };
}
