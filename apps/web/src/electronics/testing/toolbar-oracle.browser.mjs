/* global window, document, getComputedStyle, requestAnimationFrame, URL, console */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const output = resolve('test-results/toolbar-oracle-870');
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: {
    resolveDir: resolve('apps/web/src/electronics'),
    loader: 'tsx',
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {WorkbenchHeader} from './WorkbenchHeader';import {SimulationPacing} from './simulation-pacing';
const noop=()=>{};let clockMicros=3661000000;const c={projectTitle:'Toolbar oracle witness',project:{title:'Circuit'},document:{},saveStatus:'saved',saveIssue:null,localCopySaved:true,busy:false,selection:{kind:'component'},hasClipboard:true,canUndo:true,canRedo:true,activeWireColor:'#149447',orthogonalWireMode:false,libraryOpen:true,simulationRunning:false,simulationStatus:'stopped',simulationMessage:null,nativeOpticalPresentation:{subscribeClock:()=>()=>{},readClock:()=>clockMicros},simulationPacing:new SimulationPacing()};
const counts={};for(const name of ['saveNow','toggleSimulation','exportEmergencyCopy','setWireColor','copySelected','pasteCopied','removeSelection','undo','redo','rotateSelected','mirrorSelected','toggleWireRoute','renameProject','setProjectTitle','setSimulationRate','addCanvasText'])c[name]=()=>{counts[name]=(counts[name]||0)+1};
const root=createRoot(document.getElementById('app'));window.fixture={counts,set:({view,running,code=true,hours=1,emergency=false})=>{clockMicros=(hours*3600+61)*1000000;c.simulationRunning=running;c.simulationStatus=running?'running':'stopped';c.saveStatus=emergency?'error':'saved';root.render(<div className="workbench-shell"><WorkbenchHeader controller={c} user={{id:'fixture',displayName:'Witness',identityKind:'student-seat'}} view={view} codeOpen={code} notesOpen={false} onBack={noop} onViewChange={noop} onToggleNotes={noop} onToggleCode={()=>{counts.code=(counts.code||0)+1}} onToggleLibrary={noop} onOpenShare={noop} onExportView={noop}/></div>)}};window.fixture.set({view:'breadboard',running:false});`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
});
// Import both production stylesheets, including the application's box-sizing reset.
const css = await readFile('apps/web/src/styles.css', 'utf8');
const workbenchCss = await readFile('apps/web/src/electronics/workbench.css', 'utf8');
const mark = await readFile('apps/web/public/asa-lab-mark.svg', 'utf8');
const browser = await chromium.launch({ headless: true });
const receipts = [];
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).pathname === '/asa-lab-mark.svg')
      return route.fulfill({ contentType: 'image/svg+xml', body: mark });
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><meta charset="utf-8"><style>${css}\n${workbenchCss}</style><div id="app"></div><script>${bundle.outputFiles[0].text}</script>`,
    });
  });
  await page.goto('https://toolbar-oracle.invalid/');
  for (const width of [320, 390, 768, 980, 981, 1024, 1180, 1181, 1373, 1374, 1440, 1459, 1460]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [view, running, code = true, hours = 1, emergency = false] of [
      ['breadboard', false],
      ['breadboard', true],
      ['schematic', false],
      ['bom', false],
      ['breadboard', false, false],
      ['breadboard', true, false],
      ['breadboard', true, true, 1000],
      ['breadboard', false, true, 1, true],
      ['breadboard', true, true, 1, true],
      ['breadboard', true, true, 1000, true],
    ]) {
      await page.evaluate((state) => window.fixture.set(state), {
        view,
        running,
        code,
        hours,
        emergency,
      });
      await page.locator(`.workbench-toolbar.${view}`).waitFor();
      await page.waitForTimeout(20);
      const geometry = await page.evaluate(() => {
        const toolbar = document.querySelector('.workbench-toolbar');
        const rect = (element) => element.getBoundingClientRect().toJSON();
        const measure = (element) => {
          const box = element.getBoundingClientRect();
          const points = [
            [0.5, 0.5],
            [0.1, 0.1],
            [0.9, 0.1],
            [0.1, 0.9],
            [0.9, 0.9],
          ];
          const textRects = [];
          const walker = document.createTreeWalker(element, 4);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            textRects.push(
              ...Array.from(range.getClientRects(), (r) => r.toJSON()).filter(
                (r) => r.width > 0 && r.height > 0,
              ),
            );
          }
          const clipping = [];
          for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor),
              r = ancestor.getBoundingClientRect();
            if (
              (/(auto|scroll|hidden|clip)/.test(style.overflowX) &&
                (box.left < r.left - 0.5 || box.right > r.right + 0.5)) ||
              (/(auto|scroll|hidden|clip)/.test(style.overflowY) &&
                (box.top < r.top - 0.5 || box.bottom > r.bottom + 0.5))
            )
              clipping.push(ancestor.className);
          }
          return {
            ariaLabel: element.getAttribute('aria-label'),
            text: element.textContent.trim(),
            rect: rect(element),
            right: !!element.closest('.right'),
            tool: element.matches('.workbench-tool:not(.workbench-pill)'),
            fontSize: getComputedStyle(element).fontSize,
            hits: points.map(([x, y]) => {
              const hit = document.elementFromPoint(
                box.left + box.width * x,
                box.top + box.height * y,
              );
              return !!hit && (hit === element || element.contains(hit));
            }),
            clipping,
            textRects,
          };
        };
        const controls = Array.from(
          toolbar.querySelectorAll(
            '.workbench-toolbar-group > button, .workbench-toolbar-group > strong, .workbench-toolbar-group > details > summary',
          ),
        ).filter((element) => {
          const box = element.getBoundingClientRect();
          return (
            box.width > 0 && box.height > 0 && getComputedStyle(element).visibility === 'visible'
          );
        });
        return {
          toolbar: rect(toolbar),
          groups: Array.from(toolbar.querySelectorAll('.workbench-toolbar-group'), rect),
          controls: controls.map(measure),
          clock: toolbar.querySelector('.workbench-simulation-time')?.textContent ?? null,
          pace: toolbar.querySelector('.workbench-simulation-clock-button')
            ? measure(toolbar.querySelector('.workbench-simulation-clock-button'))
            : null,
        };
      });
      const phase = `${width}-${view}-${running ? 'running' : 'stopped'}-code${code}-hours${hours}-emergency${emergency}`;
      receipts.push({ width, view, running, code, hours, emergency, phase, ...geometry });
      await writeFile(resolve(output, 'geometry.json'), JSON.stringify(receipts, null, 2));
      for (const control of [...geometry.controls, ...(geometry.pace ? [geometry.pace] : [])]) {
        const name = control.ariaLabel || control.text;
        // Mobile and narrower desktop retain their designed local tool scrolling.
        if (
          (width >= 1180 && !emergency && hours === 1) ||
          control.right ||
          control === geometry.pace
        ) {
          if (!control.hits.every(Boolean) || control.clipping.length)
            failures.push({
              phase,
              name,
              rect: control.rect,
              hits: control.hits,
              clipping: control.clipping,
            });
          for (const text of control.textRects) {
            if (
              text.left < control.rect.left - 0.5 ||
              text.right > control.rect.right + 0.5 ||
              text.top < control.rect.top - 0.5 ||
              text.bottom > control.rect.bottom + 0.5
            )
              failures.push({ phase, name, text, rect: control.rect });
          }
        }
        if (width >= 981 && control.tool)
          assert.ok(control.rect.width >= 36, `${phase}: desktop icon target >=36px`);
      }
      assert.equal(geometry.toolbar.height, width >= 981 ? 48 : 46);
      assert.equal(geometry.groups.length, 2);
      if (width >= 981)
        assert.equal(
          geometry.controls.length,
          (view === 'breadboard' ? 16 : view === 'schematic' ? 8 : 6) + (emergency ? 1 : 0),
        );
      assert.equal(
        geometry.controls.filter((control) => control.ariaLabel === 'Добавить текст на схему')
          .length,
        view === 'breadboard' ? 1 : 0,
      );
      if (running)
        assert.equal(geometry.clock, `Время моделирования: ${hours === 1 ? '01' : '1000'}:01:01`);
      const run = geometry.controls.find(
        (c) => c.ariaLabel === (running ? 'Остановить моделирование' : 'Начать моделирование'),
      );
      assert.equal(run.text, running ? 'Остановить моделирование' : 'Начать моделирование');
      if (width >= 981)
        assert.ok(run.textRects.length > 0, `${phase}: primary caption is rendered`);
      if (running && width >= 981)
        assert.ok(
          geometry.pace.textRects.length >= 3,
          `${phase}: clock prefix, time and rate render`,
        );
      if (width <= 980 && emergency) {
        const copy = geometry.controls.find(
          (c) => c.ariaLabel === 'Получить аварийную копию проекта',
        );
        assert.equal(copy.text, 'Копия JSON');
        assert.equal(copy.rect.width, 42);
        assert.equal(copy.rect.height, 44);
        assert.equal(copy.fontSize, '11px');
      }
      await page.screenshot({
        path: resolve(output, `${phase}.png`),
      });
      if (width >= 981 && view === 'breadboard' && (width < 1180 || emergency || hours !== 1)) {
        const tools = page.locator('.workbench-breadboard-tools');
        await tools.locator('button').first().focus();
        const keyboard = [];
        for (let i = 0; i < 12; i++) {
          const delta = await tools.evaluate((element) => {
            const r = document.activeElement.getBoundingClientRect(),
              group = element.getBoundingClientRect();
            return r.left < group.left || r.right > group.right
              ? r.left + r.width / 2 - group.left - group.width / 2
              : 0;
          });
          if (delta) {
            await tools.hover();
            await page.mouse.wheel(delta, 0);
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
            );
          }
          const hit = await page.evaluate(() => {
            const element = document.activeElement,
              r = element.getBoundingClientRect();
            return {
              label: element.getAttribute('aria-label'),
              left: !!element.closest('.workbench-breadboard-tools'),
              rect: r.toJSON(),
              hits: [
                [0.5, 0.5],
                [0.1, 0.1],
                [0.9, 0.1],
                [0.1, 0.9],
                [0.9, 0.9],
              ].map(([x, y]) => {
                const hit = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y);
                return !!hit && (hit === element || element.contains(hit));
              }),
            };
          });
          keyboard.push(hit);
          hit.wheelDelta = delta;
          await writeFile(
            resolve(output, 'keyboard.json'),
            JSON.stringify({ phase, keyboard }, null, 2),
          );
          assert.ok(
            hit.left && hit.hits.every(Boolean),
            `${phase}: keyboard reaches ${hit.label} with native ownership`,
          );
          await page.keyboard.press('Tab');
        }
        receipts[receipts.length - 1].keyboard = keyboard;
        await writeFile(resolve(output, 'geometry.json'), JSON.stringify(receipts, null, 2));
      }
    }
  }
} finally {
  await browser.close();
}
await writeFile(resolve(output, 'failures.json'), JSON.stringify(failures, null, 2));
assert.equal(
  failures.length,
  0,
  `Native ownership/clipping/text failures; see ${output}/failures.json`,
);
console.log(
  `PASS: ${receipts.length} production Header states; desktop 48px/mobile 46px; controls 16/8/6; full text, clipping, five-point ownership and keyboard/scroll reachability.`,
);
