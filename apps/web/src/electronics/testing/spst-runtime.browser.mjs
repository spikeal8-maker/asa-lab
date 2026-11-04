// Real production editor/hook/Worker. API and static files are fixture ports;
// save/reopen is a fixture JSON roundtrip, not server SaveCAS evidence.
/* global window, document, URL, console, MutationObserver, requestAnimationFrame, getComputedStyle */
import assert from 'node:assert/strict';
import process from 'node:process';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const burnoutOnly = process.argv.includes('--led-burnout-only');
const output = resolve(burnoutOnly ? 'test-results/led-burnout-858' : 'test-results/spst-runtime');
await mkdir(output, { recursive: true });
const opts = {
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.css': 'empty', '.png': 'dataurl', '.svg': 'dataurl' },
  alias: {
    '@asa-lab/electronics/rendering': resolve('contexts/electronics/rendering.ts'),
    '@asa-lab/electronics/simulation': resolve('contexts/electronics/simulation.ts'),
    '@asa-lab/electronics/engine': resolve('contexts/electronics/engine.ts'),
    '@asa-lab/electronics': resolve('contexts/electronics/index.ts'),
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '{}',
    'import.meta.url': '"https://spst-fixture.invalid/fixture.js"',
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
import {addComponentToDocument} from './src/electronics/workbench-document';
configureProductionLibrary(${catalog});
window.fixture={wb:null,events:[],saves:[]};
const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(){super(URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'})));}};
let initial={schemaVersion:4,components:[],connections:[],viewport:{x:0,y:0,zoom:1},simulation:{running:false,maxIterations:24}};
for(const [type,id,x,y] of [['battery-holder-aa-2','source',80,80],['switch-spst','switch',350,100],['resistor-axial','resistor',540,100],['led-5mm','led',700,100],['switch-spdt','original',550,320]]) initial=addComponentToDocument(initial,type,{x,y},id).document;
const wire=(id,from,terminal,to,pin)=>({id,from:{componentId:from,terminal},to:{componentId:to,terminal:pin},color:'#149447',vertices:[]});
initial.connections=[wire('feed','source','BAT+','switch','common'),wire('contact','switch','throw-left','resistor','lead-1'),wire('load','resistor','lead-2','led','anode')];
if(${burnoutOnly}){initial.components=initial.components.filter(c=>!['switch','original'].includes(c.id)).map(c=>c.id==='resistor'?{...c,value:0}:c);initial.connections=[wire('feed','source','BAT+','resistor','lead-1'),wire('load','resistor','lead-2','led','anode'),wire('return','led','cathode','source','BAT-')];}
let saved=JSON.parse(localStorage.getItem('fixture-server')||'null')||initial,revision=1;
api.me=async()=>({ok:true,status:200,data:{authenticated:true,user:{id:'pupil',displayName:'Pupil'}}});
api.openProject=async id=>({ok:true,status:200,data:{project:{id,moduleKey:'electronics',title:'SPST — два контакта',scope:'personal',classroomId:null,status:'active'},draft:{projectId:id,document:saved,revision,updatedAt:''},versions:[],result:null}});
api.saveDraft=async(id,document)=>{saved=JSON.parse(JSON.stringify(document));revision++;localStorage.setItem('fixture-server',JSON.stringify(saved));window.fixture.saves.push({revision,document:saved});return{ok:true,status:200,data:{draft:{projectId:id,document:saved,revision,updatedAt:''}}};};
for(const type of ['pointerdown','pointerup'])document.addEventListener(type,e=>window.fixture.events.push({type,trusted:e.isTrusted,pointerType:e.pointerType,actuator:!!e.target.closest?.('[data-testid="spdt-actuator"]')}),true);
window.fixture.snapshot=()=>{const w=window.fixture.wb;return{status:w?.status,running:w?.simulationRunning,document:w?.document,result:w?.result,selected:w?.selectedComponent?.id,canUndo:w?.canUndo,canRedo:w?.canRedo,saveStatus:w?.saveStatus,message:w?.simulationMessage,saves:window.fixture.saves.length};};
createRoot(document.getElementById('app')).render(<SchematicEditor projectId="spst-project" user={{id:'pupil',email:'',displayName:'Pupil'}} onBack={()=>{}}/>);
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
    await context.route('https://spst-fixture.invalid/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/assets/')) {
        const file = resolve('apps/web/public', '.' + path);
        await route.fulfill({
          body: await readFile(file),
          contentType: path.endsWith('.json') ? 'application/json' : 'image/svg+xml',
        });
      } else if (path.startsWith('/api/')) await route.fulfill({ status: 200, json: {} });
      else
        await route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style><div id="app"></div><script>${ui}</script>`,
        });
    });
    const snapshot = () => page.evaluate(() => window.fixture.snapshot());
    try {
      await page.goto('https://spst-fixture.invalid/');
      await page.waitForFunction(() => window.fixture?.snapshot().status === 'ready');
      if (burnoutOnly) {
        await page.evaluate(() => {
          window.fixture.wb.setLibraryOpen(false);
          window.fixture.wb.fitScene();
          window.fixture.firstFailureDom = null;
          new MutationObserver(() => {
            const observation =
              window.fixture.wb.nativeOpticalPresentation.getSnapshot().observation;
            if (
              window.fixture.firstFailureDom ||
              observation?.result.components.find((c) => c.componentId === 'led')?.damageState !==
                'failed'
            )
              return;
            window.fixture.firstFailureDom = {
              cursor: observation.frame.atMicroseconds,
              bodyState: document
                .querySelector('[data-component-id="led"] [data-led-runtime-state]')
                ?.getAttribute('data-led-runtime-state'),
              burst: !!document.querySelector('[data-testid="led-burnout-explosion"]'),
            };
          }).observe(document.getElementById('app'), {
            subtree: true,
            childList: true,
            attributes: true,
          });
        });
        await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
        await page.waitForFunction(
          () =>
            window.fixture.wb.nativeOpticalPresentation
              .getSnapshot()
              .observation?.result.components.find((c) => c.componentId === 'led')?.damageState ===
            'failed',
        );
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const failure = await page.evaluate(() => {
          const w = window.fixture.wb,
            s = w.nativeOpticalPresentation.getSnapshot();
          return {
            result: s.observation.result,
            cursor: s.observation.frame.atMicroseconds,
            committedCursor: s.committed?.frame.atMicroseconds,
            bodyState: document
              .querySelector('[data-component-id="led"] [data-led-runtime-state]')
              ?.getAttribute('data-led-runtime-state'),
            burst: !!document.querySelector('[data-testid="led-burnout-explosion"]'),
            firstFailureDom: window.fixture.firstFailureDom,
          };
        });
        assert.equal(failure.bodyState, 'fault');
        assert.equal(failure.burst, true);
        assert.equal(failure.firstFailureDom.burst, true);
        assert.equal(failure.firstFailureDom.bodyState, 'fault');
        assert.ok(
          failure.result.diagnostics.some(
            (d) => d.code === 'led_burnout' && d.componentIds?.includes('led'),
          ),
        );
        await page.screenshot({ path: resolve(output, `${width}-burnout.png`) });
        await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
        assert.equal(await page.locator('[data-testid="led-burnout-explosion"]').count(), 0);
        await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
        await page.waitForFunction(
          () =>
            window.fixture.wb.nativeOpticalPresentation
              .getSnapshot()
              .observation?.result.components.find((c) => c.componentId === 'led')
              ?.presentationState === 'destructive',
        );
        assert.equal(await page.locator('[data-testid="led-burnout-explosion"]').count(), 0);
        await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
        receipts.push({
          width,
          failure,
          errors,
          evidence:
            'Real Worker thermal failure, body and burst without an extra user action; Stop and fresh generation clear it.',
        });
        continue;
      }
      await page.waitForSelector('[data-family-id="spst-switch"]');
      const card = page.locator('[data-family-id="spst-switch"]');
      assert.equal(
        await card.locator('[data-visual-contract="tinkercad-spst-two-pin"]').count(),
        1,
      );
      assert.equal(await card.locator('image').count(), 0);
      // Actual palette pick and cancel exposes the real drag ghost.
      await card.locator('button').first().focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('[data-testid="catalog-placement-preview"]', {
        state: 'attached',
      });
      assert.equal(
        await page
          .locator('[data-testid="catalog-placement-preview"] [data-testid="spdt-actuator"] > g')
          .getAttribute('transform'),
        null,
      );
      await page.mouse.move(width * 0.65, 400);
      assert.equal(
        await page
          .locator(
            '[data-testid="catalog-placement-preview"] [data-visual-contract="tinkercad-spst-two-pin"]',
          )
          .count(),
        1,
      );
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        window.fixture.wb.setLibraryOpen(false);
        window.fixture.wb.fitScene();
      });
      const terminal = (component, id) =>
        page.locator(
          '[data-terminal-component-id="' + component + '"][data-terminal-id="' + id + '"]',
        );
      assert.equal(await terminal('switch', 'throw-right').count(), 0);
      assert.equal(await terminal('switch', 'common').count(), 1);
      assert.equal(await terminal('switch', 'throw-left').count(), 1);
      assert.equal(await terminal('original', 'throw-right').count(), 1);
      // Native wire creation, then actual project-state Undo and Redo.
      await terminal('led', 'cathode').focus();
      await page.keyboard.press('Enter');
      await terminal('source', 'BAT-').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.fixture.snapshot().document.connections.length === 4);
      await page.keyboard.press('Control+z');
      await page.waitForFunction(() => window.fixture.snapshot().document.connections.length === 3);
      await page.keyboard.press('Control+Shift+z');
      await page.waitForFunction(() => window.fixture.snapshot().document.connections.length === 4);
      await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
      await page.waitForFunction(
        () => window.fixture.snapshot().saveStatus === 'saved' && window.fixture.saves.length > 0,
      );
      const persisted = (await snapshot()).document;
      await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
      await page.waitForFunction(
        () => window.fixture.snapshot().running && window.fixture.snapshot().result?.solved,
      );
      assert.equal(
        (await snapshot()).document.components.find((c) => c.id === 'switch').state,
        true,
      );
      assert.equal(
        (await snapshot()).result.components.find((c) => c.componentId === 'switch').current,
        0,
      );
      assert.equal(
        (await snapshot()).result.components.find((c) => c.componentId === 'led').lit,
        false,
      );
      const actuator = page.locator('[data-component-id="switch"] [data-testid="spdt-actuator"]');
      const target = await actuator.evaluate((element) => {
        const r = element.getBoundingClientRect();
        const points = [];
        for (let y = r.top + 1; y < r.bottom; y += 1)
          for (let x = r.left + 1; x < r.right; x += 1) {
            const hit = document.elementFromPoint(x, y);
            if (hit && element.contains(hit))
              points.push({
                x,
                y,
                distance: Math.hypot(x - r.left - r.width / 2, y - r.top - r.height / 2),
              });
          }
        points.sort((a, b) => a.distance - b.distance);
        if (!points.length) throw Error('No reachable actuator');
        return points[0];
      });
      const shadow = [];
      const ordinaryShadow = await page
        .locator('[data-component-id="original"] .workbench-part')
        .evaluate((element) => getComputedStyle(element).filter);
      const checkShadow = async (state) => {
        for (const selected of [false, true]) {
          await page.evaluate(
            (selected) =>
              selected
                ? window.fixture.wb.selectComponent('switch', false)
                : window.fixture.wb.setSelection(null),
            selected,
          );
          const filter = await page
            .locator('[data-component-id="switch"] .workbench-part')
            .evaluate((element) => getComputedStyle(element).filter);
          assert.equal(filter, ordinaryShadow);
          assert.doesNotMatch(filter, /25, 151, 205/);
          shadow.push({ state, selected, filter });
        }
      };
      await checkShadow('open');
      await page.mouse.click(target.x, target.y);
      await page.waitForFunction(
        () =>
          window.fixture.snapshot().result?.components.find((c) => c.componentId === 'led')?.lit,
      );
      await checkShadow('closed');
      const before = await snapshot();
      await page.mouse.click(target.x, target.y);
      await page.waitForFunction(
        () =>
          window.fixture.snapshot().result?.components.find((c) => c.componentId === 'switch')
            ?.current === 0,
      );
      assert.equal(
        (await snapshot()).result.components.find((c) => c.componentId === 'led').lit,
        false,
      );
      await page.screenshot({ path: resolve(output, `${width}-open.png`) });
      await page.touchscreen.tap(target.x, target.y);
      await page.waitForFunction(
        () =>
          window.fixture.snapshot().result?.components.find((c) => c.componentId === 'led')?.lit,
      );
      const after = await snapshot();
      assert.deepEqual(after.document, before.document);
      assert.equal(after.canUndo, before.canUndo);
      assert.equal(after.canRedo, before.canRedo);
      await page.screenshot({ path: resolve(output, `${width}-closed.png`) });
      await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
      const events = await page.evaluate(() => window.fixture.events);
      assert.ok(events.some((e) => e.trusted && e.actuator && e.pointerType === 'mouse'));
      assert.ok(events.some((e) => e.trusted && e.actuator && e.pointerType === 'touch'));
      await page.reload();
      await page.waitForFunction(() => window.fixture?.snapshot().status === 'ready');
      const reopened = await snapshot();
      assert.deepEqual(reopened.document.components, persisted.components);
      assert.deepEqual(reopened.document.connections, persisted.connections);
      assert.equal(reopened.running, false);
      assert.deepEqual(errors, []);
      receipts.push({
        width,
        persisted,
        before,
        after,
        reopened,
        events,
        errors,
        shadow,
        evidence:
          'actual SchematicEditor/hook/Worker; fixture API JSON save/reopen; no server acceptance',
      });
    } finally {
      await page.screenshot({ path: resolve(output, `${width}-final.png`) });
      await writeFile(
        resolve(output, `${width}-debug.json`),
        JSON.stringify({ snapshot: await snapshot().catch(() => null), errors }, null, 2),
      );
      await context.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(
    resolve(output, 'receipt.json'),
    JSON.stringify(
      {
        sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        receipts,
      },
      null,
      2,
    ),
  );
}
console.log(`SPST actual editor/Worker native fixture PASS: ${receipts.length} widths`);
