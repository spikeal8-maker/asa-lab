/* global window, document, getComputedStyle, process, console */
// Supporting source/UI fixture: actual Stage/renderer, explicit controller ports.
// This does not exercise useElectronicsWorkbench, Worker, API or SaveCAS.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const output = resolve(
  process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) ??
    'test-results/spdt-active-shadow',
);
await mkdir(output, { recursive: true });
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const css = await readFile('apps/web/src/electronics/workbench.css', 'utf8');
const manifest = await readFile(
  'apps/web/public/assets/electronics/component-database/catalog.json',
  'utf8',
);
const built = await build({
  stdin: {
    resolveDir: resolve('.'),
    loader: 'tsx',
    contents: `
import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
import {WorkbenchStage} from './apps/web/src/electronics/WorkbenchStage';
import {configureProductionLibrary} from './apps/web/src/electronics/production-manifest-adapter';
import {addComponentToDocument,sceneBounds} from './apps/web/src/electronics/workbench-document';
import {applyRuntimeComponentOverrides} from './apps/web/src/electronics/workbench-runtime-controls';
import {fitViewportToScreen,viewportViewBox} from './apps/web/src/electronics/workbench-geometry';
import {solveCircuit} from './contexts/electronics/domain/solver';
configureProductionLibrary(${manifest});
let initial={schemaVersion:4,components:[],connections:[],viewport:{x:0,y:0,zoom:1},simulation:{running:false,maxIterations:24}};
for(const [type,id,x,y] of [['switch-spdt','switch',140,120],['button-tactile-6mm','button',300,120],['battery-holder-aa-2','battery',140,360],['resistor-axial','resistor',300,360]])initial=addComponentToDocument(initial,type,{x,y},id).document;
initial.components=initial.components.map(c=>c.id==='resistor'?{...c,value:220}:c);
const wire=(id,from,terminal,to,pin)=>({id,from:{componentId:from,terminal},to:{componentId:to,terminal:pin},color:'#e3212b',vertices:[]});
initial.connections=[wire('w1','battery','BAT+','switch','common'),wire('w2','switch','throw-left','resistor','lead-1'),wire('w3','switch','throw-right','resistor','lead-1'),wire('w4','resistor','lead-2','battery','BAT-')];
const stored=localStorage.getItem('spdt-document');const persistent=stored?JSON.parse(stored):initial;
localStorage.setItem('spdt-document',JSON.stringify(persistent));
window.fixture={events:[]};
for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,e=>window.fixture.events.push({type,trusted:e.isTrusted,pointerType:e.pointerType,x:e.clientX,y:e.clientY,actuator:!!e.target.closest?.('[data-testid="spdt-actuator"]'),component:e.target.closest?.('[data-component-id]')?.getAttribute('data-component-id')??null}),true);
function App(){
 const stageRef=useRef(null),pressed=useRef(null);
 const [running,setRunning]=useState(false),[overrides,setOverrides]=useState({}),[selection,setSelection]=useState(null),[viewport,setViewport]=useState({x:0,y:0,zoom:1});
 const runtime=applyRuntimeComponentOverrides(persistent,running,overrides);
 const selected=id=>setSelection({kind:'component',id,ids:[id]});
 const state=(id,value)=>{selected(id);setOverrides(old=>({...old,[id]:{state:value}}))};
 const fit=()=>setViewport(fitViewportToScreen(sceneBounds(persistent),stageRef.current.getBoundingClientRect(),window.innerWidth,700,.1,6,50));
 const solved=solveCircuit(runtime);
 window.fixture.snapshot=()=>({document:JSON.stringify(persistent),stored:localStorage.getItem('spdt-document'),running,overrides,selection,viewport,solved});
 const c={document:runtime,stageRef,viewport,viewBox:viewportViewBox(viewport,window.innerWidth,700),simulationRunning:running,simulationTimeMs:0,selection,
 runtimePresentationResultByComponent:new Map(solved.components.map(c=>[c.componentId,c])),diagnosticsByComponent:new Map(),errorDiagnosticComponentIds:new Set(),
 componentVisualState:c=>c.kind==='switch'&&c.state?'on':c.kind==='button'&&c.state?'pressed':'default',
 componentLedBrightness:()=>0,componentArduinoLActive:()=>false,preparedComponentLedAsset:()=>undefined,committedComponentLedAsset:()=>undefined,rollbackComponentLedAsset:()=>undefined,
 terminalConnectionCount:()=>0,documentMutationEpoch:()=>0,syncCatalogPreview:()=>{},handleWheel:()=>{},beginStagePointer:()=>{},handlePointerMove:()=>{},cancelPointer:()=>{},
 startPan:e=>{if(e.target.classList.contains('workbench-grid-hit'))setSelection(null)},
 startComponentDrag:(e,c)=>{selected(c.id);if(running&&c.kind==='button'){pressed.current=c.id;stageRef.current.setPointerCapture(e.pointerId);state(c.id,true)}e.stopPropagation();e.preventDefault()},
 finishPointer:e=>{if(pressed.current){state(pressed.current,false);pressed.current=null;if(stageRef.current.hasPointerCapture(e.pointerId))stageRef.current.releasePointerCapture(e.pointerId)}},
 selectComponent:selected,setSelection,toggleComponentState:id=>state(id,!runtime.components.find(c=>c.id===id).state),
 fitScene:fit,zoomBy:factor=>setViewport(v=>{const z=v.zoom*factor;return{x:v.x+window.innerWidth/v.zoom/2-window.innerWidth/z/2,y:v.y+700/v.zoom/2-700/z/2,zoom:z}})};
 return <><header><button id="run" onClick={()=>{setRunning(!running);setOverrides({})}}>{running?'Stop':'Run'}</button><output>{running?'Running':'Stopped'}</output></header><WorkbenchStage controller={c} showGrid/></>;
}createRoot(document.getElementById('app')).render(<App/>);
`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    '@asa-lab/electronics/simulation': resolve('contexts/electronics/simulation.ts'),
    '@asa-lab/electronics': resolve('contexts/electronics/index.ts'),
  },
});
const receipts = [],
  assets = new Map();
function assertFinite(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  else if (value && typeof value === 'object') Object.values(value).forEach(assertFinite);
}
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 1024, 390, 320])
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width, height: 760 },
        colorScheme,
        hasTouch: true,
      });
      const errors = [];
      await context.route('http://spdt.fixture/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.startsWith('/assets/')) {
          const body = await readFile(resolve('apps/web/public', '.' + path));
          assets.set(path, createHash('sha256').update(body).digest('hex'));
          await route.fulfill({ body, contentType: 'image/svg+xml' });
        } else
          await route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><meta charset="utf-8"><style>${css}</style><style>body{margin:0}#app{--wb-library-width:0px}.workbench-stage{top:60px;bottom:0}header{height:60px}#run{margin:10px}</style><div id="app"></div><script>${built.outputFiles[0].text}</script>`,
          });
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(String(error)));
      const key = `${width}-${colorScheme}`;
      const samples = [];
      const snapshot = () => page.evaluate(() => window.fixture.snapshot());
      const sample = async (label) => {
        await page.evaluate(async () => {
          await new Promise(window.requestAnimationFrame);
          await Promise.all(
            document
              .getAnimations()
              .filter((animation) => Number.isFinite(animation.effect.getComputedTiming().endTime))
              .map((animation) => animation.finished),
          );
        });
        const result = await page.evaluate(() => {
          const component = document.querySelector('[data-component-id="switch"]');
          const part = component.querySelector('.workbench-part');
          return {
            ...window.fixture.snapshot(),
            filter: getComputedStyle(part).filter,
            active: component.classList.contains('workbench-component-actuator-active'),
            selected: part.classList.contains('selected'),
            selection: !!component.querySelector('.workbench-tinkercad-selection'),
            focused: document.activeElement === part,
            transform: component
              .querySelector('[data-testid="spdt-actuator"] g')
              .getAttribute('transform'),
            dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
            background: getComputedStyle(document.querySelector('.workbench-stage'))
              .backgroundColor,
          };
        });
        samples.push({ label, ...result });
        return result;
      };
      // Find a native reachable point, excluding overlapping terminal hit areas.
      const point = async (selector) =>
        page.locator(selector).evaluate((element) => {
          const r = element.getBoundingClientRect();
          const candidates = [];
          for (let y = r.top + 1; y < r.bottom; y += 1)
            for (let x = r.left + 1; x < r.right; x += 1) {
              const hit = document.elementFromPoint(x, y);
              if (hit && (hit === element || element.contains(hit)))
                candidates.push({
                  x,
                  y,
                  tag: hit.tagName,
                  distance: Math.hypot(x - r.left - r.width / 2, y - r.top - r.height / 2),
                });
            }
          candidates.sort((a, b) => a.distance - b.distance);
          if (candidates.length) return candidates[0];
          throw Error('No reachable native point: ' + selector);
        });
      const gesture = async (mode) => {
        const p = await point('[data-testid="spdt-actuator"]');
        const prior = await page.evaluate(() => window.fixture.events.length);
        if (mode === 'touch') await page.touchscreen.tap(p.x, p.y);
        else await page.mouse.click(p.x, p.y);
        const events = await page.evaluate((n) => window.fixture.events.slice(n), prior);
        samples.push({ label: `native-${mode}`, point: p, events });
        assert.ok(
          events.some(
            (e) =>
              e.type === 'pointerdown' &&
              e.trusted &&
              e.actuator &&
              e.component === 'switch' &&
              e.pointerType === mode,
          ),
        );
        return { point: p, events };
      };
      try {
        await page.goto('http://spdt.fixture/');
        await page.waitForFunction(() => !!window.fixture?.snapshot);
        await page.waitForFunction(() =>
          [...document.querySelectorAll('[data-hit-mask-status]')].every(
            (e) => e.getAttribute('data-hit-mask-status') === 'ready',
          ),
        );
        const bytes = (await snapshot()).document;
        for (const zoom of ['fit', 'in', 'out']) {
          await page.getByRole('button', { name: 'Подогнать проект', exact: true }).click();
          if (zoom !== 'fit')
            await page
              .getByRole('button', {
                name: zoom === 'in' ? 'Увеличить масштаб' : 'Уменьшить масштаб',
                exact: true,
              })
              .click();
          const stopped = await sample(`${zoom}-stopped`);
          assert.equal(stopped.active, false);
          await gesture('mouse');
          assert.equal((await sample(`${zoom}-stopped-gesture`)).active, false);
          await page.locator('#run').click();
          const off = await sample(`${zoom}-off`);
          assert.match(off.filter, /drop-shadow/);
          assert.equal(off.dark, colorScheme === 'dark');
          const offPng = await page.screenshot({ path: resolve(output, `${key}-${zoom}-off.png`) });
          samples.push({
            label: `${zoom}-off-screenshot`,
            sha256: createHash('sha256').update(offPng).digest('hex'),
          });
          const mouse = await gesture('mouse');
          const on = await sample(`${zoom}-on`);
          assert.equal(on.active, true);
          assert.equal(on.filter, off.filter);
          assert.notEqual(on.transform, off.transform);
          assert.ok(on.selection && on.selected);
          assert.equal(on.document, bytes);
          assert.equal(on.stored, bytes);
          assert.equal(on.solved.solved, true);
          assertFinite(on.solved);
          assert.ok(on.solved.numericalResidual <= on.solved.numericalTolerance);
          await page.mouse.click(width - 10, 80);
          const unselectedOn = await sample(`${zoom}-on-unselected`);
          assert.ok(unselectedOn.active && !unselectedOn.selection);
          assert.equal(unselectedOn.filter, off.filter);
          const onPng = await page.screenshot({ path: resolve(output, `${key}-${zoom}-on.png`) });
          samples.push({
            label: `${zoom}-on-screenshot`,
            sha256: createHash('sha256').update(onPng).digest('hex'),
          });
          const touch = await gesture('touch');
          const offAgain = await sample(`${zoom}-off-touch`);
          assert.equal(offAgain.active, false);
          assert.equal(offAgain.transform, off.transform);
          assert.equal(offAgain.filter, off.filter);
          await page.mouse.click(width - 10, 80);
          const unselectedOff = await sample(`${zoom}-off-unselected`);
          assert.ok(!unselectedOff.active && !unselectedOff.selection);
          assert.equal(unselectedOff.filter, unselectedOn.filter);
          const part = page.locator('[data-component-id="switch"] > .workbench-part');
          await part.focus();
          await page.keyboard.press('Enter');
          const focused = await sample(`${zoom}-focused`);
          assert.ok(focused.focused && focused.selection);
          assert.equal(focused.filter, 'none');
          await gesture('touch');
          const focusedOn = await sample(`${zoom}-focused-on`);
          assert.equal(focusedOn.filter, 'none');
          assert.ok(focusedOn.active && focusedOn.focused);
          await page.locator('#run').click();
          assert.equal((await sample(`${zoom}-stopped-after-on`)).active, false);
          await page.locator('#run').click();
          const buttonPoint = await point(
            '[data-component-id="button"] .workbench-tinkercad-button',
          );
          await page.mouse.move(buttonPoint.x, buttonPoint.y);
          await page.mouse.down();
          await sample(`${zoom}-control-button-held`);
          const button = await page
            .locator('[data-testid="schematic-component"][data-component-id="button"]')
            .evaluate((e) => ({
              active: e.classList.contains('workbench-component-actuator-active'),
              filter: getComputedStyle(e.querySelector('.workbench-part')).filter,
            }));
          assert.ok(button.active);
          assert.match(button.filter, /25, 151, 205/);
          await page.mouse.up();
          assert.equal(
            await page
              .locator('[data-testid="schematic-component"][data-component-id="button"]')
              .evaluate((e) => e.classList.contains('workbench-component-actuator-active')),
            false,
          );
          await page.locator('#run').click();
          await page.mouse.click(width - 10, 80);
          assert.equal((await sample(`${zoom}-unselected`)).selection, false);
          samples.push({ label: `${zoom}-native`, mouse, touch, button });
          const png = await page.screenshot({ path: resolve(output, `${key}-${zoom}.png`) });
          samples.push({
            label: `${zoom}-screenshot`,
            sha256: createHash('sha256').update(png).digest('hex'),
          });
        }
        assert.equal((await snapshot()).document, bytes);
        assert.equal((await snapshot()).stored, bytes);
        await page.reload();
        await page.waitForFunction(() => !!window.fixture?.snapshot);
        assert.equal((await snapshot()).document, bytes);
        assert.equal((await snapshot()).running, false);
        await page.getByRole('button', { name: 'Подогнать проект', exact: true }).click();
        await page.locator('#run').click();
        await gesture('touch');
        const reopened = await sample('local-reopen-on');
        assert.ok(reopened.active && reopened.selection);
        assert.equal(reopened.document, bytes);
        assert.equal(reopened.stored, bytes);
        assert.deepEqual(errors, []);
      } finally {
        receipts.push({ key, width, colorScheme, samples, errors });
        await writeFile(resolve(output, `${key}.json`), JSON.stringify(receipts.at(-1), null, 2));
        await page.screenshot({ path: resolve(output, `${key}-final.png`) });
        await context.close();
      }
    }
} finally {
  await writeFile(
    resolve(output, 'receipts.json'),
    JSON.stringify(
      {
        sourceSha,
        cssSha256: createHash('sha256').update(css).digest('hex'),
        proof:
          'Actual WorkbenchStage/NativeOptical/ProductionComponentVisual with declared controller ports, canonical solver and localStorage only. No full hook, Worker, server or SaveCAS evidence.',
        assets: Object.fromEntries(assets),
        receipts,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
console.log(
  `SPDT source/UI PASS: ${receipts.length} viewport/preference cases, native mouse/touch, fit/in/out`,
);
