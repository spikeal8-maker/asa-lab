// Native production editor and Worker; fixture API roundtrip, not installed SaveCAS.
/* global window, URL, requestAnimationFrame, MessageEvent, console */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const output = resolve('test-results/canvas-annotations-860/native');
await mkdir(output, { recursive: true });
const opts = {
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  alias: Object.fromEntries(
    ['', '/rendering', '/simulation', '/engine'].map((suffix) => [
      '@asa-lab/electronics' + suffix,
      resolve('contexts/electronics/' + (suffix.slice(1) || 'index') + '.ts'),
    ]),
  ),
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '{}',
    'import.meta.url': '"https://annotations-fixture.invalid/fixture.js"',
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
import {parseElectronicsDocument,simulationInputDigest,analyseCircuit} from '@asa-lab/electronics';
window.fixtureDigest=simulationInputDigest;
configureProductionLibrary(${catalog});
window.fixture={wb:null,requests:[],responses:[],saves:[],events:[]};
const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(){super(URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'})));window.fixture.worker=this;this.addEventListener('message',e=>{window.fixture.responses.push(e.data);if(window.fixture.holdNextAdvance&&e.data.kind==='advance'){window.fixture.holdNextAdvance=false;window.fixture.heldAdvance=e.data;e.stopImmediatePropagation();}});}postMessage(m){window.fixture.requests.push(m);super.postMessage(m);}};
const initial={schemaVersion:4,components:[{id:'uno',kind:'visual',componentTypeId:'arduino-uno',value:5,position:{x:0,y:0},pinIds:['d9','d13','power-5v','power-3v3','power-gnd-1'],stateProperties:{arduinoSource:'void setup(){Serial.begin(9600);}void loop(){Serial.println(millis());delay(20);}'}}],connections:[],viewport:{x:0,y:0,zoom:1},simulation:{running:false,maxIterations:24}};
let saved=JSON.parse(localStorage.getItem('fixture-server')||'null')||initial,revision=1;
api.me=async()=>({ok:true,status:200,data:{authenticated:true,user:{id:'owner',displayName:'Owner'}}});
api.openProject=async id=>({ok:true,status:200,data:{project:{id,moduleKey:'electronics',title:'Текст на схеме',scope:'personal',classroomId:null,status:'active'},draft:{projectId:id,document:saved,revision,updatedAt:''},versions:[],result:null}});
api.saveDraft=async(id,document)=>{const parsed=parseElectronicsDocument(JSON.parse(JSON.stringify(document)));if(!parsed.ok)throw Error(parsed.message);saved=parsed.document;revision++;localStorage.setItem('fixture-server',JSON.stringify(saved));window.fixture.saves.push({revision,document:saved,running:window.fixture.wb.simulationRunning,heldAdvance:!!window.fixture.heldAdvance});return{ok:true,status:200,data:{draft:{projectId:id,document:saved,revision,updatedAt:''},result:analyseCircuit(parsed.document)}};};
document.addEventListener('pointerdown',e=>window.fixture.events.push({trusted:e.isTrusted,type:e.pointerType,annotation:!!e.target.closest?.('[data-canvas-annotation]')}),true);
createRoot(document.getElementById('app')).render(<SchematicEditor projectId="annotation-project" user={{id:'owner',email:'',displayName:'Owner'}} onBack={()=>{}}/>);
`;
const ui = (
  await build({
    ...opts,
    stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: source },
    plugins: [
      {
        name: 'expose-production-controller-readonly',
        setup(builder) {
          builder.onLoad({ filter: /pages[\\/]SchematicEditor\.tsx$/ }, async (args) => ({
            loader: 'tsx',
            contents: (await readFile(args.path, 'utf8')).replace(
              'const controller = useElectronicsWorkbench(projectId, user.id, seatLearner);',
              'const controller = useElectronicsWorkbench(projectId, user.id, seatLearner); window.fixture.wb = controller;',
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
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await context.route('https://annotations-fixture.invalid/**', async (route) => {
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
          body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style><div id="app"></div><script>${ui}</script>`,
        });
    });
    const notes = () => page.evaluate(() => window.fixture.wb.annotations.items);
    try {
      await page.goto('https://annotations-fixture.invalid/');
      await page.waitForFunction(() => window.fixture.wb?.status === 'ready');
      await page.evaluate(() => window.fixture.wb.setLibraryOpen(false));
      await page.getByRole('button', { name: 'Заметки', exact: true }).click();
      await page
        .getByRole('textbox', { name: 'Заметки проекта', exact: true })
        .fill('Отдельная локальная заметка');
      await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
      assert.equal((await notes()).length, 0);
      await page.getByRole('button', { name: 'Добавить текст на схему', exact: true }).click();
      const malicious = '<img src=x onerror=alert(1)> 😀\nПодпись';
      await page.getByRole('textbox', { name: 'Текст на схеме', exact: true }).fill(malicious);
      await page.getByRole('textbox', { name: 'Текст на схеме', exact: true }).press('Control+a');
      await page.getByRole('textbox', { name: 'Текст на схеме', exact: true }).press('Delete');
      assert.equal((await notes()).length, 1);
      await page.getByRole('textbox', { name: 'Текст на схеме', exact: true }).fill(malicious);
      await page.getByRole('spinbutton', { name: 'Размер шрифта', exact: true }).fill('24');
      await page.getByRole('spinbutton', { name: 'Размер шрифта', exact: true }).press('Enter');
      assert.equal((await notes())[0].fontSize, 24);
      assert.equal(await page.locator('.workbench-annotation-content img').count(), 0);
      await page.getByRole('button', { name: 'Закрыть свойства текста' }).click();
      const target = page.getByTestId('canvas-annotation');
      const before = (await notes())[0];
      const rect = await target.boundingBox();
      assert.ok(rect);
      await page.mouse.move(rect.x + 15, rect.y + 15);
      await page.mouse.down();
      await page.mouse.move(rect.x + 65, rect.y + 65, { steps: 5 });
      await page.mouse.up();
      const moved = (await notes())[0];
      assert.notDeepEqual(moved.position, before.position);
      await page.getByRole('button', { name: 'Закрыть свойства текста' }).click();
      await page.keyboard.press('Control+z');
      assert.deepEqual((await notes())[0].position, before.position);
      await page.keyboard.press('Control+Shift+z');
      assert.deepEqual((await notes())[0].position, moved.position);
      // Cancelled pointer preview must not enter history or persist a partial move.
      const currentRect = await target.boundingBox();
      await page.mouse.move(currentRect.x + 15, currentRect.y + 15);
      await page.mouse.down();
      await page.mouse.move(currentRect.x + 40, currentRect.y + 40);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.deepEqual((await notes())[0].position, moved.position);
      // Native touch drag: no synthetic dispatchEvent.
      const touchRect = await target.boundingBox();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: touchRect.x + 12, y: touchRect.y + 12 }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: touchRect.x + 42, y: touchRect.y + 32 }],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.notDeepEqual((await notes())[0].position, moved.position);
      await page.evaluate(() => window.fixture.wb.fitScene());
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const beforeResize = (await notes())[0];
      const handle = await page.locator('[data-annotation-resize] > rect').first().boundingBox();
      assert.ok(handle);
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 + 30, handle.y + handle.height / 2 + 20);
      await page.mouse.up();
      assert.ok((await notes())[0].size.width > beforeResize.size.width);
      await page.getByRole('button', { name: 'Закрыть свойства текста' }).click();
      await page.keyboard.press('Control+z');
      assert.deepEqual((await notes())[0].size, beforeResize.size);
      await target.click({ position: { x: 12, y: 12 } });
      const beforeNudge = (await notes())[0].position;
      await page.keyboard.press('ArrowRight');
      assert.ok((await notes())[0].position.x > beforeNudge.x);
      await page.keyboard.press('Control+c');
      await page.keyboard.press('Delete');
      assert.equal((await notes()).length, 0);
      await page.keyboard.press('Control+v');
      assert.equal((await notes())[0].text, malicious);
      await page.getByRole('button', { name: 'Закрыть свойства текста' }).click();
      await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
      await page.waitForFunction(() =>
        window.fixture.responses.some((message) => message.kind === 'advance' && message.ok),
      );
      const liveBefore = await page.evaluate(() => ({
        requests: window.fixture.requests.map(({ kind, generationId }) => ({ kind, generationId })),
        time: window.fixture.wb.simulationTimeMs,
        digest: window.fixtureDigest(window.fixture.wb.document),
      }));
      await page.evaluate(() => {
        window.fixture.holdNextAdvance = true;
      });
      await page.waitForFunction(() => !!window.fixture.heldAdvance);
      await page.getByRole('button', { name: 'Добавить текст на схему', exact: true }).click();
      await page.getByRole('textbox', { name: 'Текст на схеме', exact: true }).fill('Live note');
      await page.getByRole('button', { name: 'Закрыть свойства текста' }).click();
      const pending = await page.evaluate(() => ({
        requestId: window.fixture.heldAdvance.requestId,
        generationId: window.fixture.heldAdvance.generationId,
        horizon: window.fixture.heldAdvance.advance.committedHorizonMicroseconds,
      }));
      await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
      await page.waitForFunction(() =>
        window.fixture.saves.some(
          (s) => s.running && s.heldAdvance && s.document.annotations?.length === 2,
        ),
      );
      await page.evaluate(() => {
        const data = window.fixture.heldAdvance;
        window.fixture.heldAdvance = null;
        window.fixture.worker.dispatchEvent(new MessageEvent('message', { data }));
      });
      await page.waitForTimeout(250);
      const liveAfter = await page.evaluate(() => ({
        requests: window.fixture.requests.map(({ kind, generationId }) => ({ kind, generationId })),
        running: window.fixture.wb.simulationRunning,
        time: window.fixture.wb.simulationTimeMs,
        digest: window.fixtureDigest(window.fixture.wb.document),
        serial: window.fixture.responses.filter((m) => m.kind === 'advance' && m.ok).at(-1).advance
          .serial[0]?.tx,
      }));
      assert.equal(liveAfter.running, true);
      assert.equal(
        liveAfter.requests.filter((m) => m.kind === 'preflight').length,
        liveBefore.requests.filter((m) => m.kind === 'preflight').length,
      );
      assert.deepEqual(
        [...new Set(liveAfter.requests.map((m) => m.generationId))],
        [...new Set(liveBefore.requests.map((m) => m.generationId))],
      );
      assert.ok(liveAfter.time >= liveBefore.time);
      assert.ok(liveAfter.time * 1000 >= pending.horizon);
      assert.equal(liveAfter.digest, liveBefore.digest);
      assert.ok(liveAfter.serial?.length > 1);
      assert.equal(liveAfter.serial.filter((value) => value.sequence === 0).length, 1);
      assert.ok(liveAfter.serial.at(-1).sequence > 0);
      await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
      await page.waitForFunction(() =>
        window.fixture.saves.some((s) => s.document.annotations?.length === 2),
      );
      const expected = await notes();
      const events = await page.evaluate(() => window.fixture.events);
      await page.reload();
      await page.waitForFunction(() => window.fixture.wb?.status === 'ready');
      assert.deepEqual(await notes(), expected);
      assert.equal(
        await page.evaluate(
          () => window.fixture.wb.document.components[0].stateProperties.arduinoSource,
        ),
        'void setup(){Serial.begin(9600);}void loop(){Serial.println(millis());delay(20);}',
      );
      await page.getByRole('button', { name: 'Заметки', exact: true }).click();
      assert.equal(
        await page.getByRole('textbox', { name: 'Заметки проекта', exact: true }).inputValue(),
        'Отдельная локальная заметка',
      );
      await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
      // A later component copy replaces the annotation clipboard, not vice versa.
      await page.evaluate(() =>
        window.fixture.wb.setSelection({ kind: 'component', id: 'uno', ids: ['uno'] }),
      );
      await page.getByRole('button', { name: 'Копировать (Ctrl+C)', exact: true }).click();
      await page.getByRole('button', { name: 'Вставить (Ctrl+V)', exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixture.wb.document.components.length), 2);
      assert.equal((await notes()).length, expected.length);
      await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixture.wb.document.components.length), 1);
      await page.evaluate(() => window.fixture.wb.setSelection(null));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(output, `annotations-${width}.png`), fullPage: true });
      receipts.push({
        width,
        passed: true,
        annotationCount: expected.length,
        liveBefore,
        liveAfter,
        pendingAcknowledgement: pending,
        saveAcknowledgedWhileRunAndAdvanceHeld: true,
        trustedPointerEvents: events.filter((e) => e.trusted).length,
        fixtureSaveReopen: true,
        notesPanelIndependent: true,
        laterComponentCopyReplacesNoteClipboard: true,
        installedSave: 'NOT_RUN',
      });
    } catch (error) {
      await writeFile(
        resolve(output, `failure-${width}.json`),
        JSON.stringify(
          await page.evaluate(() => ({
            requests: window.fixture.requests,
            responses: window.fixture.responses,
            status: window.fixture.wb.status,
            message: window.fixture.wb.simulationMessage,
            notice: window.fixture.wb.notice,
            running: window.fixture.wb.simulationRunning,
            annotations: window.fixture.wb.annotations.items,
            saves: window.fixture.saves,
            saveIssue: window.fixture.wb.saveIssue,
            saveError: window.fixture.wb.saveError,
            saveStatus: window.fixture.wb.saveStatus,
          })),
          null,
          2,
        ),
      );
      await page.screenshot({ path: resolve(output, `failure-${width}.png`), fullPage: true });
      throw error;
    } finally {
      await context.close();
    }
  }
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify(receipts, null, 2));
  console.log(JSON.stringify(receipts, null, 2));
} finally {
  await browser.close();
}
