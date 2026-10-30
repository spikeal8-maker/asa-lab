// Real mounted editor/Worker/Stage. API/assets are fixture ports, no listening server.
/* global window, URL, console */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const output = resolve('test-results/mixed-servo-862/native');
await mkdir(output, { recursive: true });
const opts = {
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  alias: Object.fromEntries(
    ['', '/rendering', '/simulation', '/engine'].map((s) => [
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
const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(){super(URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'})));window.fixture.worker=this;this.addEventListener('message',e=>{window.fixture.responses.push(e.data);if(window.fixture.holdNext&&e.data.kind==='advance'){window.fixture.holdNext=false;window.fixture.held=e.data;e.stopImmediatePropagation();}});}postMessage(m){window.fixture.requests.push(m);super.postMessage(m);}};
let saved={"schemaVersion":4,"components":[{"id":"uno","kind":"visual","componentTypeId":"arduino-uno","electricalModelId":"arduino-uno","electricalModelVersion":1,"modelProfileId":"arduino-uno-r3","modelProfileVersion":1,"position":{"x":20,"y":200},"value":5,"stateProperties":{"arduinoSource":"#include <Servo.h>\\nServo motor;int k=0;void setup(){Serial.begin(9600);motor.attach(3);pinMode(13,OUTPUT);pinMode(2,INPUT_PULLUP);pinMode(4,OUTPUT);pinMode(6,OUTPUT);pinMode(7,OUTPUT);pinMode(8,OUTPUT);pinMode(9,OUTPUT);pinMode(10,OUTPUT);pinMode(11,OUTPUT);pinMode(12,OUTPUT);}void loop(){digitalWrite(4,HIGH);digitalWrite(6,HIGH);digitalWrite(7,HIGH);digitalWrite(8,HIGH);digitalWrite(9,HIGH);digitalWrite(10,HIGH);digitalWrite(11,HIGH);digitalWrite(12,LOW);digitalWrite(13,k);motor.write(k?135:45);Serial.println(k);Serial.println(digitalRead(2));if(Serial.available()){Serial.println(Serial.read());}k=1-k;delay(20);}"},"pinIds":["d4","d6","d7","d8","d9","d10","d11","d12","d13","power-gnd-1","power-5v","power-3v3","d2","d3"],"variantId":"arduino-uno"},{"id":"display","kind":"seven-segment","componentTypeId":"seven-segment-display","variantId":"seven-segment-display","electricalModelId":"seven-segment","electricalModelVersion":1,"modelProfileId":"single-digit-seven-segment-10pin","modelProfileVersion":2,"position":{"x":570,"y":20},"value":0,"stateProperties":{"commonMode":"common-cathode","segmentColor":"red"},"pinIds":["top-1","top-2","top-3","top-4","top-5","bottom-1","bottom-2","bottom-3","bottom-4","bottom-5"],"internalConnections":[["top-3","bottom-3"]]},{"id":"r-a","kind":"resistor","componentTypeId":"resistor-axial","electricalModelId":"resistor","electricalModelVersion":1,"modelProfileId":"axial-resistor","modelProfileVersion":1,"position":{"x":300,"y":100},"value":330,"pinIds":["lead-1","lead-2"],"variantId":"resistor-axial","stateProperties":{"tolerancePercent":5,"resistanceUnit":"Ω","powerRatingWatt":0.25}},{"id":"r-b","kind":"resistor","componentTypeId":"resistor-axial","electricalModelId":"resistor","electricalModelVersion":1,"modelProfileId":"axial-resistor","modelProfileVersion":1,"position":{"x":300,"y":140},"value":330,"pinIds":["lead-1","lead-2"],"variantId":"resistor-axial","stateProperties":{"tolerancePercent":5,"resistanceUnit":"Ω","powerRatingWatt":0.25}},{"id":"r-c","kind":"resistor","componentTypeId":"resistor-axial","electricalModelId":"resistor","electricalModelVersion":1,"modelProfileId":"axial-resistor","modelProfileVersion":1,"position":{"x":300,"y":180},"value":330,"pinIds":["lead-1","lead-2"],"variantId":"resistor-axial","stateProperties":{"tolerancePercent":5,"resistanceUnit":"Ω","powerRatingWatt":0.25}},{"id":"r-d","kind":"resistor","componentTypeId":"resistor-axial","electricalModelId":"resistor","electricalModelVersion":1,"modelProfileId":"axial-resistor","modelProfileVersion":1,"position":{"x":300,"y":220},"value":330,"pinIds":["lead-1","lead-2"],"variantId":"resistor-axial","stateProperties":{"tolerancePercent":5,"resistanceUnit":"Ω","powerRatingWatt":0.25}},{"id":"r-e","kind":"resistor","componentTypeId":"resistor-axial","electricalModelId":"resistor","electricalModelVersion":1,"modelProfileId":"axial-resistor","modelProfileVersion":1,"position":{"x":300,"y":260},"value":330,"pinIds":["lead-1","lead-2"],"variantId":"resistor-axial","stateProperties":{"tolerancePercent":5,"resistanceUnit":"Ω","powerRatingWatt":0.25}},{"id":"r-f","kind":"resistor","componentTypeId":"resistor-axial","electricalModelId":"resistor","electricalModelVersion":1,"modelProfileId":"axial-resistor","modelProfileVersion":1,"position":{"x":300,"y":300},"value":330,"pinIds":["lead-1","lead-2"],"variantId":"resistor-axial","stateProperties":{"tolerancePercent":5,"resistanceUnit":"Ω","powerRatingWatt":0.25}},{"id":"r-g","kind":"resistor","componentTypeId":"resistor-axial","electricalModelId":"resistor","electricalModelVersion":1,"modelProfileId":"axial-resistor","modelProfileVersion":1,"position":{"x":300,"y":340},"value":330,"pinIds":["lead-1","lead-2"],"variantId":"resistor-axial","stateProperties":{"tolerancePercent":5,"resistanceUnit":"Ω","powerRatingWatt":0.25}},{"id":"r-dp","kind":"resistor","componentTypeId":"resistor-axial","electricalModelId":"resistor","electricalModelVersion":1,"modelProfileId":"axial-resistor","modelProfileVersion":1,"position":{"x":300,"y":380},"value":330,"pinIds":["lead-1","lead-2"],"variantId":"resistor-axial","stateProperties":{"tolerancePercent":5,"resistanceUnit":"Ω","powerRatingWatt":0.25}},{"id":"servo","kind":"visual","componentTypeId":"servo-motor","variantId":"servo-motor","value":0,"position":{"x":750,"y":160},"pinIds":["gnd","vcc","signal"],"stateProperties":{}},{"id":"led","kind":"led","componentTypeId":"led-5mm","value":2,"position":{"x":570,"y":300},"pinIds":["anode","cathode"],"stateProperties":{"ledColour":"red","ledBrightness":0,"ledFault":"none"},"variantId":"led-5mm"},{"id":"led-r","kind":"resistor","value":330,"position":{"x":420,"y":300},"componentTypeId":"resistor-axial","variantId":"resistor-axial","stateProperties":{"tolerancePercent":5,"resistanceUnit":"Ω","powerRatingWatt":0.25},"pinIds":["lead-1","lead-2"]},{"id":"button","kind":"button","componentTypeId":"button-tactile-6mm","value":0,"state":false,"position":{"x":640,"y":400},"pinIds":["SW-A1","SW-A2","SW-B1","SW-B2"],"internalConnections":[["SW-A1","SW-A2"],["SW-B1","SW-B2"]],"variantId":"button-tactile-6mm","stateProperties":{"contactState":"released"}}],"connections":[{"id":"pin-a","from":{"componentId":"uno","terminal":"d4"},"to":{"componentId":"r-a","terminal":"lead-1"}},{"id":"segment-a","from":{"componentId":"r-a","terminal":"lead-2"},"to":{"componentId":"display","terminal":"top-4"}},{"id":"pin-b","from":{"componentId":"uno","terminal":"d6"},"to":{"componentId":"r-b","terminal":"lead-1"}},{"id":"segment-b","from":{"componentId":"r-b","terminal":"lead-2"},"to":{"componentId":"display","terminal":"top-5"}},{"id":"pin-c","from":{"componentId":"uno","terminal":"d7"},"to":{"componentId":"r-c","terminal":"lead-1"}},{"id":"segment-c","from":{"componentId":"r-c","terminal":"lead-2"},"to":{"componentId":"display","terminal":"bottom-4"}},{"id":"pin-d","from":{"componentId":"uno","terminal":"d8"},"to":{"componentId":"r-d","terminal":"lead-1"}},{"id":"segment-d","from":{"componentId":"r-d","terminal":"lead-2"},"to":{"componentId":"display","terminal":"bottom-2"}},{"id":"pin-e","from":{"componentId":"uno","terminal":"d9"},"to":{"componentId":"r-e","terminal":"lead-1"}},{"id":"segment-e","from":{"componentId":"r-e","terminal":"lead-2"},"to":{"componentId":"display","terminal":"bottom-1"}},{"id":"pin-f","from":{"componentId":"uno","terminal":"d10"},"to":{"componentId":"r-f","terminal":"lead-1"}},{"id":"segment-f","from":{"componentId":"r-f","terminal":"lead-2"},"to":{"componentId":"display","terminal":"top-2"}},{"id":"pin-g","from":{"componentId":"uno","terminal":"d11"},"to":{"componentId":"r-g","terminal":"lead-1"}},{"id":"segment-g","from":{"componentId":"r-g","terminal":"lead-2"},"to":{"componentId":"display","terminal":"top-1"}},{"id":"pin-dp","from":{"componentId":"uno","terminal":"d12"},"to":{"componentId":"r-dp","terminal":"lead-1"}},{"id":"segment-dp","from":{"componentId":"r-dp","terminal":"lead-2"},"to":{"componentId":"display","terminal":"bottom-5"}},{"id":"common","from":{"componentId":"display","terminal":"top-3"},"to":{"componentId":"uno","terminal":"power-gnd-1"}},{"id":"extra17","from":{"componentId":"uno","terminal":"power-5v"},"to":{"componentId":"servo","terminal":"vcc"}},{"id":"extra18","from":{"componentId":"uno","terminal":"power-gnd-1"},"to":{"componentId":"servo","terminal":"gnd"}},{"id":"extra19","from":{"componentId":"uno","terminal":"d3"},"to":{"componentId":"servo","terminal":"signal"}},{"id":"extra20","from":{"componentId":"uno","terminal":"d13"},"to":{"componentId":"led-r","terminal":"lead-1"}},{"id":"extra21","from":{"componentId":"led-r","terminal":"lead-2"},"to":{"componentId":"led","terminal":"anode"}},{"id":"extra22","from":{"componentId":"led","terminal":"cathode"},"to":{"componentId":"uno","terminal":"power-gnd-1"}},{"id":"extra23","from":{"componentId":"uno","terminal":"d2"},"to":{"componentId":"button","terminal":"SW-A1"}},{"id":"extra24","from":{"componentId":"button","terminal":"SW-B1"},"to":{"componentId":"uno","terminal":"power-gnd-1"}}],"viewport":{"x":0,"y":0,"zoom":1},"simulation":{"running":true,"maxIterations":24}};
const expectedAngle=Number(new URL(window.location.href).searchParams.get("angle"));
window.fixture.expectedAngle=expectedAngle;
saved.components.find(c=>c.id==="uno").stateProperties.arduinoSource=saved.components.find(c=>c.id==="uno").stateProperties.arduinoSource.replace("motor.write(k?135:45)","motor.write("+expectedAngle+")").replace("digitalWrite(13,k)","digitalWrite(13,HIGH)");
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
const receipt = [];
try {
  for (const [width, angle] of [
    [1440, 45],
    [1440, 135],
    [390, 45],
    [390, 135],
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
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
      await page.goto('https://speed-fixture.invalid/?angle=' + angle);
      await page.waitForFunction(() => window.fixture.wb?.status === 'ready');
      await page.evaluate(() => window.fixture.wb.setLibraryOpen(false));
      await page.waitForTimeout(100);
      await page.evaluate(() => window.fixture.wb.fitScene());
      const start = page.getByRole('button', { name: 'Начать моделирование', exact: true });
      if (width === 390) await start.tap();
      else await start.click();
      await page.waitForFunction(
        () => {
          if (!window.fixture.live) return false;
          const s = window.fixture.snapshot();
          return (
            s.P >= 26000 &&
            s.result?.components.find((c) => c.componentId === 'servo')?.servoAngleDegrees ===
              window.fixture.expectedAngle
          );
        },
        { timeout: 30000 },
      );
      const trigger = page.getByRole('button', {
        name: 'Изменить скорость моделирования',
        exact: true,
      });
      if (width === 390) await trigger.tap();
      else await trigger.click();
      await page.getByRole('slider', { name: 'Скорость моделирования' }).press('Home');
      await page.waitForFunction(
        () => window.fixture.wb.simulationPacing.read().phase === 'paused',
      );
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.fixture.wb.fitScene());
      await page.waitForTimeout(100);
      const snapshot = await page.evaluate(() => window.fixture.snapshot());
      const physical = JSON.parse(snapshot.state.continuation.serializedState).servoMotors.find(
        (m) => m.componentId === 'servo',
      ).runtime;
      const measured = snapshot.result.components.find((c) => c.componentId === 'servo');
      assert.equal(snapshot.state.continuation.clockProfileId, 'electrothermal-v1');
      assert.equal(physical.powered, true);
      assert.equal(physical.angleDegrees, angle);
      assert.ok(Number.isFinite(physical.lastValidPulseWidthMicroseconds));
      assert.equal(measured.servoAngleDegrees, physical.angleDegrees);
      assert.equal(snapshot.horn, 'rotate(' + (angle - 90) + ' 114.5 314)');
      assert.equal(snapshot.result.solved, true);
      assert.equal(snapshot.result.quality.finite, true);
      assert.equal(snapshot.result.quality.passed, true);
      assert.ok(snapshot.frame.led.led > 0);
      const segments = snapshot.frame.segments.display;
      for (const segment of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) assert.ok(segments[segment] > 0);
      assert.equal(segments.dp, 0);
      const bounds = await page
        .locator('[data-testid="schematic-component"][data-component-id="servo"]')
        .boundingBox();
      assert.ok(
        bounds &&
          bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= width &&
          bounds.y + bounds.height <= 900,
        'full Servo body in viewport',
      );
      await page.screenshot({ path: resolve(output, `mixed-${width}-${angle}.png`) });
      await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
      assert.deepEqual(errors, []);
      receipt.push({
        width,
        angle,
        bounds,
        snapshot,
        errors,
        requests: await page.evaluate(() => window.fixture.requests),
        responses: await page.evaluate(() => window.fixture.responses),
      });
    } catch (error) {
      await writeFile(
        resolve(output, `failure-${width}-${angle}.json`),
        JSON.stringify(
          {
            error: String(error),
            errors,
            snapshot: await page.evaluate(() =>
              window.fixture.live ? window.fixture.snapshot() : null,
            ),
            requests: await page.evaluate(() => window.fixture.requests),
            responses: await page.evaluate(() => window.fixture.responses),
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
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(
    'PASS four real mixed Arduino/Servo/LED/seven-segment journeys: decoded 45/135 at 1440/390, full native horn and live segment/LED output.',
  );
} finally {
  await browser.close();
}
