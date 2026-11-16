/* global URL, window, document, console */
// Native Chromium qualification: actual ASA Lab editor and Worker without DB/production.
// All API and SVG assets use local fixture responses; no listening server.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const out = resolve('test-results/l298n-p3-browser');
await mkdir(out, { recursive: true });
const opts = {
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  alias: Object.fromEntries(
    ['/timed-state', '/rendering', '/simulation', '/engine', ''].map((s) => [
      '@asa-lab/electronics' + s,
      resolve('contexts/electronics/' + (s.slice(1) || 'index') + '.ts'),
    ]),
  ),
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '{}',
    'import.meta.url': '"https://l298n-fixture.invalid/fixture.js"',
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
const pinIds = [
  '+12V',
  'GND',
  '+5V',
  'OUT1',
  'OUT2',
  'OUT3',
  'OUT4',
  'IN1',
  'IN2',
  'IN3',
  'IN4',
  'ENA',
];
const source = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './src/api';
import { SchematicEditor } from './src/pages/SchematicEditor';
import { configureProductionLibrary } from './src/electronics/production-manifest-adapter';
import { parseElectronicsDocument, analyseCircuit } from '@asa-lab/electronics';

configureProductionLibrary(${catalog});
const edge = (id, fromId, fromPin, toId, toPin) => ({
  id, from: {componentId: fromId, terminal: fromPin},
  to: {componentId: toId, terminal: toPin}, vertices: [],
});
let saved = {
  schemaVersion: 4,
  components: [
    {
      id:'driver', kind:'visual', componentTypeId:'l298n-motor-driver',
      variantId:'red-43mm',name:'Драйвер L298N',
      position:{x:490,y:190},rotation:0,value:0,
      pinIds:${JSON.stringify(pinIds)},
      stateProperties:{enaJumperInstalled:false,enbJumperInstalled:true,regulatorJumperInstalled:false},
    },
    {
      id:'uno',kind:'visual',componentTypeId:'arduino-uno',variantId:'arduino-uno',
      name:'Arduino Uno',position:{x:55,y:40},rotation:0,value:5,
      pinIds:['d2','d3','d4','d7','d8','d13','power-5v','power-3v3','power-gnd-1'],
      stateProperties:{
        arduinoSource:
          'void setup(){pinMode(2,OUTPUT);pinMode(3,OUTPUT);pinMode(4,OUTPUT);' +
          'pinMode(7,OUTPUT);pinMode(8,OUTPUT);digitalWrite(2,HIGH);' +
          'digitalWrite(4,LOW);digitalWrite(7,LOW);digitalWrite(8,HIGH);' +
          'analogWrite(3,128);}' +
          'void loop(){delay(1000);}',
      },
    },
    {
      id:'power',kind:'source',componentTypeId:'battery-holder-aa-4',
      variantId:'battery-holder-aa-4',name:'Питание 6 В',
      value:6,position:{x:950,y:70},rotation:0,
      pinIds:['BAT+','BAT-'],stateProperties:{cells:4,internalResistanceOhm:0.3,maxContinuousCurrentAmp:2},
    },
    {
      id:'motor-a',kind:'visual',componentTypeId:'dc-motor',variantId:'dc-motor',
      name:'DC двигатель A',value:6,position:{x:790,y:185},
      rotation:0,pinIds:['positive','negative'],stateProperties:{},
    },
    {
      id:'motor-b',kind:'visual',componentTypeId:'gearmotor',variantId:'gearmotor',
      name:'Мотор-редуктор B',value:6,position:{x:790,y:425},
      rotation:0,pinIds:['positive','negative'],stateProperties:{},
    },
  ],
  connections: [
    edge('w1','power','BAT+','driver','+12V'),
    edge('w2','power','BAT-','driver','GND'),
    edge('w3','uno','power-5v','driver','+5V'),
    edge('w4','uno','power-gnd-1','driver','GND'),
    edge('w5','uno','d2','driver','IN1'),
    edge('w6','uno','d4','driver','IN2'),
    edge('w7','uno','d7','driver','IN3'),
    edge('w8','uno','d8','driver','IN4'),
    edge('w9','uno','d3','driver','ENA'),
    edge('w10','driver','OUT1','motor-a','positive'),
    edge('w11','driver','OUT2','motor-a','negative'),
    edge('w12','driver','OUT3','motor-b','positive'),
    edge('w13','driver','OUT4','motor-b','negative'),
  ],
  viewport:{x:0,y:0,zoom:1},
  simulation:{running:false,maxIterations:24},
};
let revision=1;
window.fixture={
  get saved(){return saved;},
  get revision(){return revision;},
  workerRequests:[],workerResponses:[],
};
const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker {
  constructor(){
    super(URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'})));
    window.fixture.worker=this;
    this.addEventListener('message',event=>window.fixture.workerResponses.push(event.data));
  }
  postMessage(message){window.fixture.workerRequests.push(message);super.postMessage(message);}
};
api.me=async()=>({ok:true,status:200,data:{authenticated:true,user:{id:'owner',displayName:'Owner'}}});
api.openProject=async(id)=>({ok:true,status:200,data:{
  project:{id,moduleKey:'electronics',title:'Проверка L298N',scope:'personal',classroomId:null,status:'active'},
  draft:{projectId:id,document:saved,revision,updatedAt:''},versions:[],result:null,
}});
api.saveDraft=async(id,document)=>{
  const parsed=parseElectronicsDocument(JSON.parse(JSON.stringify(document)));
  if(!parsed.ok)throw Error(parsed.message);
  saved=parsed.document;
  revision+=1;
  return {ok:true,status:200,data:{
    draft:{projectId:id,document:saved,revision,updatedAt:''},
    result:analyseCircuit(saved),
  }};
};
const editorRoot = createRoot(document.getElementById('app'));
window.fixture.unmountEditor = () => {
  window.fixture.wb = null;
  editorRoot.render(null);
};
window.fixture.remountEditor = () => editorRoot.render(
  <SchematicEditor projectId="l298n-test-project"
    user={{id:'owner',email:'',displayName:'Owner'}} onBack={()=>{}} />
);
window.fixture.remountEditor();
`;
const ui = (
  await build({
    ...opts,
    stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: source },
    plugins: [
      {
        name: 'l298n-p3-readonly-controller-evidence',
        setup(builder) {
          builder.onLoad({ filter: /pages[\\/]SchematicEditor\.tsx$/ }, async (args) => ({
            loader: 'tsx',
            contents: (await readFile(args.path, 'utf8')).replace(
              'const controller = useElectronicsWorkbench(projectId, user.id, seatLearner);',
              'const controller = useElectronicsWorkbench(projectId, user.id, seatLearner); window.fixture.wb=controller;',
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
  for (const width of [1440, 1024, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
      hasTouch: width <= 390,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await context.route('https://l298n-fixture.invalid/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/assets/')) {
        try {
          const data = await readFile(resolve('apps/web/public', '.' + path));
          return route.fulfill({
            status: 200,
            body: data,
            contentType: path.endsWith('.json') ? 'application/json' : 'image/svg+xml',
          });
        } catch {
          return route.fulfill({ status: 404, body: 'Missing local asset' });
        }
      }
      if (path.startsWith('/api/')) return route.fulfill({ status: 200, json: {} });
      return route.fulfill({
        contentType: 'text/html',
        body:
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<style>body{margin:0}' +
          css +
          '</style><div id="app"></div>',
      });
    });
    try {
      await page.goto('https://l298n-fixture.invalid/');
      await page.addScriptTag({ content: ui });
      await page.waitForFunction(() => window.fixture?.wb?.status === 'ready', null, {
        timeout: 30000,
      });
      await page.evaluate(() => {
        window.fixture.wb.setLibraryOpen(false);
        window.fixture.wb.fitScene();
      });
      await page.locator('[data-l298n-led="driver"]').waitFor({ timeout: 10000 });
      const led = page.locator('[data-l298n-led="driver"]');
      assert.equal(await led.getAttribute('data-l298n-led-state'), 'off');
      const boardHtml = await page.locator('[data-component-id="driver"]').count();
      assert.ok(boardHtml > 0, 'L298N board in stage');
      const imageCount = await page.locator('[data-component-id="driver"] image').count();
      assert.ok(imageCount > 0, 'Owner SVG rendered in stage');
      await page.evaluate(() => window.fixture.wb.selectComponent('driver'));
      await page.getByTestId('l298n-jumper-controls').waitFor({ timeout: 10000 });
      const ena = page.getByTestId('l298n-jumper-enaJumperInstalled');
      assert.equal(await ena.isChecked(), false);
      await ena.click();
      assert.equal(await ena.isChecked(), false, 'Cannot re-install a wired PWM jumper');
      const angle = () =>
        page.evaluate(
          () =>
            window.fixture.wb.document.components.find((item) => item.id === 'driver')?.rotation ??
            0,
        );
      assert.equal(await angle(), 0);
      await page.evaluate(() => window.fixture.wb.rotateSelected());
      await page.waitForFunction(
        () =>
          (window.fixture.wb.document.components.find((item) => item.id === 'driver')?.rotation ??
            0) !== 0,
      );
      const rotatedAngle = await angle();
      await page.evaluate(() => window.fixture.wb.undo());
      await page.waitForFunction(
        () =>
          (window.fixture.wb.document.components.find((item) => item.id === 'driver')?.rotation ??
            0) === 0,
      );
      await page.evaluate(() => window.fixture.wb.redo());
      await page.waitForFunction(
        (expected) =>
          window.fixture.wb.document.components.find((item) => item.id === 'driver')?.rotation ===
          expected,
        rotatedAngle,
      );
      await page.evaluate(() => window.fixture.wb.undo());
      await page.waitForFunction(
        () =>
          (window.fixture.wb.document.components.find((item) => item.id === 'driver')?.rotation ??
            0) === 0,
      );
      const oldRevision = await page.evaluate(() => window.fixture.revision);
      await page.evaluate(() => window.fixture.wb.saveNow());
      await page.waitForFunction((old) => window.fixture.revision > old, oldRevision);
      const persisted = await page.evaluate(() => ({
        board: window.fixture.saved.components.find((item) => item.id === 'driver'),
        wires: window.fixture.saved.connections.length,
      }));
      assert.ok(persisted.board.pinIds.includes('ENA'), 'PWM ENA persists across save');
      assert.equal(persisted.board.stateProperties.enaJumperInstalled, false);
      assert.equal(persisted.board.rotation ?? 0, 0);
      assert.equal(persisted.wires, 13);
      await page.evaluate(() => window.fixture.unmountEditor());
      await page.waitForFunction(() => !document.querySelector('[data-l298n-led="driver"]'));
      await page.evaluate(() => window.fixture.remountEditor());
      await page.waitForFunction(() => window.fixture.wb?.status === 'ready', null, {
        timeout: 30000,
      });
      await page.locator('[data-l298n-led="driver"]').waitFor();
      assert.equal(
        await page.evaluate(() =>
          window.fixture.wb.document.components
            .find((item) => item.id === 'driver')
            ?.pinIds.includes('ENA'),
        ),
        true,
        'ENA remains attached on editor reopen',
      );
      await page.evaluate(() => {
        window.fixture.wb.setLibraryOpen(false);
        window.fixture.wb.fitScene();
        window.fixture.wb.selectComponent('driver');
      });
      await page.screenshot({
        path: resolve(out, 'l298n-stopped-' + width + '.png'),
        fullPage: true,
      });
      const before = await page.evaluate(() => ({
        markers: document.querySelectorAll('[data-terminal-component-id="driver"]').length,
        document: window.fixture.wb.document,
      }));
      assert.ok(before.markers >= 11, 'real terminal marker overlays');
      await page.evaluate(() => window.fixture.wb.toggleSimulation());
      await page.waitForFunction(
        () =>
          window.fixture.wb.simulationRunning === true &&
          document
            .querySelector('[data-l298n-led="driver"]')
            ?.getAttribute('data-l298n-led-state') === 'on',
        null,
        { timeout: 30000 },
      );
      const live = await page.evaluate(() => ({
        status: window.fixture.wb.simulationStatus,
        led: document
          .querySelector('[data-l298n-led="driver"]')
          ?.getAttribute('data-l298n-led-state'),
        workerRequests: window.fixture.workerRequests.length,
        result: window.fixture.wb.resultByComponent.get('driver'),
      }));
      assert.equal(live.led, 'on', 'LED only reflects calculated logic 5 V');
      assert.ok(live.workerRequests > 0, 'real Worker must process simulation');
      await page.screenshot({
        path: resolve(out, 'l298n-running-' + width + '.png'),
        fullPage: true,
      });
      await page.evaluate(() => window.fixture.wb.toggleSimulation());
      await page.waitForFunction(() => !window.fixture.wb.simulationRunning);
      const receipt = {
        width,
        boardHtml,
        imageCount,
        markers: before.markers,
        ledOn: live.led,
        workerRequests: live.workerRequests,
        status: live.status,
        pageErrors: errors,
      };
      assert.deepEqual(errors, [], 'no runtime browser errors');
      receipts.push(receipt);
      console.log('L298N_P3_BROWSER_CASE_PASS', JSON.stringify(receipt));
    } catch (error) {
      await page
        .screenshot({ path: resolve(out, 'l298n-failure-' + width + '.png'), fullPage: true })
        .catch(() => {});
      const diagnostics = await page
        .evaluate(() => ({
          ready: window.fixture?.wb?.status,
          simulationStatus: window.fixture?.wb?.simulationStatus,
          simulationMessage: window.fixture?.wb?.simulationMessage,
          workerResponses: window.fixture?.workerResponses?.slice(-5),
          notice: window.fixture?.wb?.notice,
          led: document
            .querySelector('[data-l298n-led="driver"]')
            ?.getAttribute('data-l298n-led-state'),
        }))
        .catch(() => null);
      console.error(
        'L298N_P3_BROWSER_FAILURE',
        JSON.stringify({ width, diagnostics, pageErrors: errors }),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(resolve(out, 'receipt.json'), JSON.stringify({ checks: receipts }, null, 2));
console.log('L298N_P3_BROWSER_ALL_PASS', receipts.length);
