/* global window, document, process, console, URL, getComputedStyle, innerWidth */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const before = process.argv.includes('--before');
const baseline = '1386e10cb35aa003781d69733a52cb4ad4042162';
const historical = (path) =>
  execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });
const output = resolve('test-results/toolbar-single-row', before ? 'before' : 'after');
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: {
    resolveDir: resolve('apps/web/src/electronics'),
    loader: 'tsx',
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {WorkbenchHeader} from './WorkbenchHeader';
const counts={};const hit=n=>{counts[n]=(counts[n]||0)+1};
const c={projectTitle:'Очень длинное название проекта с Arduino и электрической схемой '.repeat(3),project:{title:'Схема'},saveStatus:'saved',saveIssue:null,localCopySaved:true,busy:false,selection:{kind:'component'},hasClipboard:true,canUndo:true,canRedo:true,activeWireColor:'#149447',orthogonalWireMode:false,libraryOpen:true,simulationRunning:false,simulationStatus:'stopped',simulationMessage:null,nativeOpticalPresentation:{subscribeClock:()=>()=>{},readClock:()=>3661000000},saveNow:()=>hit('save'),toggleSimulation:()=>hit('run'),exportEmergencyCopy:()=>hit('copy'),setWireColor:()=>hit('wire')};
for(const name of ['copySelected','pasteCopied','removeSelection','undo','redo','rotateSelected','mirrorSelected','toggleWireRoute','renameProject','setProjectTitle'])c[name]=()=>hit(name);
const root=createRoot(document.getElementById('app'));let view='breadboard',code=false;
function render(){root.render(<div className={'workbench-shell'+(c.libraryOpen?'':' library-collapsed')}><WorkbenchHeader controller={c} user={{id:'fixture',displayName:'Проверка',identityKind:'student-seat'}} view={view} codeOpen={code} notesOpen={false} onBack={()=>{}} onViewChange={()=>{}} onToggleNotes={()=>{}} onToggleCode={()=>{}} onToggleLibrary={()=>{}} onOpenShare={()=>{}} onExportView={()=>{}}/><main className="workbench-main" data-testid="stage"/></div>)}
window.fixture={counts,set:(state)=>{Object.assign(c,state);view=state.view??view;code=state.code??code;render()}};render();`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  plugins: before
    ? [
        {
          name: 'baseline-header',
          setup(builder) {
            builder.onLoad({ filter: /WorkbenchHeader\.tsx$/ }, () => ({
              contents: historical('apps/web/src/electronics/WorkbenchHeader.tsx'),
              loader: 'tsx',
            }));
          },
        },
      ]
    : [],
});
const css = before
  ? historical('apps/web/src/electronics/workbench.css')
  : await readFile('apps/web/src/electronics/workbench.css', 'utf8');
const mark = await readFile('apps/web/public/asa-lab-mark.svg', 'utf8');
const browser = await chromium.launch({ headless: true });
const receipts = [];
try {
  for (const dpr of [1, 1.25, 1.5]) {
    const context = await browser.newContext({ deviceScaleFactor: dpr, hasTouch: true });
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).pathname === '/asa-lab-mark.svg')
        return route.fulfill({ contentType: 'image/svg+xml', body: mark });
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><meta charset="utf-8"><style>body{margin:0}${css}</style><div id="app"></div><script>${bundle.outputFiles[0].text}</script>`,
      });
    });
    for (const width of [1920, 1536, 1440, 1374, 1373, 1281, 1280, 1024, 981, 980, 390, 320]) {
      await page.setViewportSize({ width, height: 864 });
      await page.goto('https://toolbar-fixture.invalid/');
      await page.locator('.workbench-toolbar').waitFor();
      for (const view of ['breadboard', 'schematic', 'bom']) {
        for (const running of [false, true]) {
          for (const error of [false, true]) {
            await page.evaluate((state) => window.fixture.set(state), {
              view,
              simulationRunning: running,
              simulationStatus: running ? 'running' : 'stopped',
              saveStatus: error ? 'error' : 'saved',
              saveIssue: error ? 'offline' : null,
              localCopySaved: !error,
              code: running,
              libraryOpen: !running,
            });
            await page.waitForTimeout(10);
            const geometry = await page.evaluate(() => {
              const box = (s) => {
                const e = document.querySelector(s),
                  r = e?.getBoundingClientRect();
                return r
                  ? {
                      x: r.x,
                      y: r.y,
                      w: r.width,
                      h: r.height,
                      display: getComputedStyle(e).display,
                    }
                  : null;
              };
              return {
                toolbar: box('.workbench-toolbar'),
                stage: box('main'),
                save: box('.save'),
                run: box('.simulate'),
                actions: box('.workbench-toolbar-group.right'),
                clock: box('.workbench-simulation-time'),
                copy: box('.emergency-copy'),
                viewport: innerWidth,
                pageWidth: document.documentElement.scrollWidth,
                saveDisabled: document.querySelector('.save').disabled,
              };
            });
            receipts.push({ width, dpr, view, running, error, ...geometry });
            if (!before) {
              assert.equal(geometry.toolbar.h, width > 980 ? 49 : 47);
              assert.ok(geometry.pageWidth <= width);
              assert.equal(geometry.saveDisabled, !error);
              assert.equal(geometry.stage.y, geometry.toolbar.y + geometry.toolbar.h);
              for (const key of ['save', 'run', ...(error ? ['copy'] : [])]) {
                const b = geometry[key];
                assert.notEqual(b.display, 'none');
                assert.ok(
                  b.x >= 0 && b.x + b.w <= width + 1,
                  JSON.stringify({ key, width, geometry }),
                );
                assert.ok(
                  b.y >= geometry.toolbar.y &&
                    b.y + b.h <= geometry.toolbar.y + geometry.toolbar.h + 1,
                );
              }
              assert.ok(geometry.run.x < geometry.save.x);
              if (running && width > 980)
                assert.ok(
                  geometry.clock.x >= 0 &&
                    geometry.clock.x + geometry.clock.w <= geometry.actions.x + 1,
                );
            }
            if (view === 'breadboard' && running && error)
              await page.screenshot({ path: resolve(output, `${width}-${dpr}.png`) });
          }
        }
      }
      if (!before) {
        await page.evaluate(() =>
          window.fixture.set({
            saveStatus: 'dirty',
            localCopySaved: true,
            simulationRunning: false,
            simulationStatus: 'stopped',
            view: 'breadboard',
          }),
        );
        await page.waitForTimeout(10);
        for (const [selector, key] of [
          ['.save', 'save'],
          ['.simulate', 'run'],
        ]) {
          const button = page.locator(selector);
          const initial = await page.evaluate((k) => window.fixture.counts[k] || 0, key);
          await button.focus();
          await page.keyboard.press('Enter');
          assert.equal(await page.evaluate((k) => window.fixture.counts[k], key), initial + 1);
          await button.tap();
          assert.equal(await page.evaluate((k) => window.fixture.counts[k], key), initial + 2);
        }
        if (width > 980) {
          await page.evaluate(() =>
            window.fixture.set({
              simulationRunning: true,
              simulationStatus: 'running',
              saveStatus: 'error',
              localCopySaved: false,
            }),
          );
          await page.waitForTimeout(10);
          const tools = page.locator('.workbench-toolbar-group:not(.right)');
          let first = true;
          for (const tool of await tools.locator('button:not(:disabled):visible, summary').all()) {
            if (first) await tool.focus();
            else await page.keyboard.press('Tab');
            first = false;
            const reach = await tool.evaluate((element) => {
              const r = element.getBoundingClientRect(),
                g = element.closest('.workbench-toolbar-group').getBoundingClientRect();
              return {
                ok: r.right > g.left && r.left < g.right,
                label: element.getAttribute('aria-label'),
                active: document.activeElement?.getAttribute('aria-label'),
                scroll: element.closest('.workbench-toolbar-group').scrollLeft,
                scrollWidth: element.closest('.workbench-toolbar-group').scrollWidth,
                left: r.left,
                right: r.right,
                groupLeft: g.left,
                groupRight: g.right,
              };
            });
            assert.ok(
              reach.ok,
              `keyboard focus scrolls each tool into view at ${width}: ${JSON.stringify(reach)}`,
            );
          }
          for (let step = 0; step < 16; step++) await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(200);
          const mirror = page.getByRole('button', { name: 'Отразить', exact: true });
          assert.ok(
            await mirror.evaluate((element) => {
              const r = element.getBoundingClientRect(),
                g = element.closest('.workbench-toolbar-group').getBoundingClientRect();
              return r.left >= g.left - 1 && r.right <= g.right + 1;
            }),
          );
          await page.keyboard.press('Enter');
          assert.equal(await page.evaluate(() => window.fixture.counts.mirrorSelected), 1);
          const summary = page.locator('summary');
          await summary.scrollIntoViewIfNeeded();
          await summary.focus();
          await page.keyboard.press('Enter');
          const menu = page.getByRole('menuitemradio').first();
          await menu.click();
          assert.equal(await page.evaluate(() => window.fixture.counts.wire), 1);
        }
        for (const state of [
          { saveStatus: 'saving', busy: false },
          { saveStatus: 'dirty', busy: true },
        ]) {
          await page.evaluate((state) => window.fixture.set(state), state);
          await page.waitForTimeout(10);
          assert.equal(await page.locator('.save').isDisabled(), true);
          assert.equal(await page.locator('.simulate').isDisabled(), state.busy);
          const initial = await page.evaluate(() => ({ ...window.fixture.counts }));
          await page.locator('.save').dispatchEvent('click');
          if (state.busy) await page.locator('.simulate').dispatchEvent('click');
          assert.deepEqual(await page.evaluate(() => ({ ...window.fixture.counts })), initial);
        }
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(resolve(output, 'geometry.json'), JSON.stringify(receipts, null, 2));
}
console.log(
  `${before ? 'BEFORE' : 'AFTER'} actual WorkbenchHeader: ${receipts.length} native layout states; screenshots and geometry in ${output}`,
);
