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
const baseline = 'e1be12d19f8669c1145020c756551dd2188ed10f';
const historical = (path) =>
  execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' });
const output = resolve('test-results/emergency-toolbar-868-r2', before ? 'before' : 'after');
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: {
    resolveDir: resolve('apps/web/src/electronics'),
    loader: 'tsx',
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {WorkbenchHeader} from './WorkbenchHeader';import {SimulationPacing} from './simulation-pacing';
let clockMicros=3661000000;const counts={};const hit=n=>{counts[n]=(counts[n]||0)+1};
const c={projectTitle:'Очень длинное название проекта с Arduino и электрической схемой '.repeat(3),project:{title:'Схема'},saveStatus:'saved',saveIssue:null,localCopySaved:true,busy:false,selection:{kind:'component'},hasClipboard:true,canUndo:true,canRedo:true,activeWireColor:'#149447',orthogonalWireMode:false,libraryOpen:true,simulationRunning:false,simulationStatus:'stopped',simulationMessage:null,nativeOpticalPresentation:{subscribeClock:()=>()=>{},readClock:()=>clockMicros},saveNow:()=>hit('save'),toggleSimulation:()=>hit('run'),exportEmergencyCopy:()=>hit('copy'),setWireColor:()=>hit('wire')};
for(const name of ['copySelected','pasteCopied','removeSelection','undo','redo','rotateSelected','mirrorSelected','toggleWireRoute','renameProject','setProjectTitle'])c[name]=()=>hit(name);
const pace=new SimulationPacing();c.simulationPacing=pace;c.setSimulationRate=rate=>{hit('pace');pace.request(rate)};
const root=createRoot(document.getElementById('app'));let view='breadboard',code=false;
function render(){root.render(<div className={'workbench-shell'+(c.libraryOpen?'':' library-collapsed')}><WorkbenchHeader controller={c} user={{id:'fixture',displayName:'Проверка',identityKind:'student-seat'}} view={view} codeOpen={code} notesOpen={false} onBack={()=>{}} onViewChange={()=>{}} onToggleNotes={()=>{}} onToggleCode={()=>hit('code')} onToggleLibrary={()=>hit('library')} onOpenShare={()=>{}} onExportView={()=>{}}/><main className="workbench-main" data-testid="stage"/></div>)}
window.fixture={counts,readPacing:pace.read,set:(state)=>{Object.assign(c,state);clockMicros=state.clockMicros??3661000000;if(state.pacing){pace.request(state.pacing.rate);if(state.pacing.phase==='paused')pace.settlePause()}view=state.view??view;code=state.code??code;render()}};render();`,
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
let callbacks = 0;
try {
  // 1152 CSS pixels represents a 1440-wide desktop at 125% browser zoom.
  for (const dpr of [1, 1.25]) {
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
    for (const width of [320, 390, 391, 400, 480, 768, 980, 981, 1024, 1152, 1440, 1536]) {
      await page.setViewportSize({ width, height: 864 });
      await page.goto('https://toolbar-fixture.invalid/');
      await page.locator('.workbench-toolbar').waitFor();
      for (const code of [false, true])
        for (const pacing of [
          { running: false, phase: 'running', rate: 1 },
          { running: true, phase: 'running', rate: 1 },
          ...[100, 1000].flatMap((clockHours) => [
            {
              running: true,
              phase: 'running',
              rate: 1,
              clockHours,
              edgeOnly: true,
              geometryOnly: true,
            },
            {
              running: true,
              phase: 'pausing',
              rate: 0,
              clockHours,
              edgeOnly: true,
              geometryOnly: true,
            },
            {
              running: true,
              phase: 'paused',
              rate: 0,
              clockHours,
              edgeOnly: true,
              geometryOnly: true,
            },
          ]),
          { running: true, phase: 'pausing', rate: 0, edgeOnly: true },
          { running: true, phase: 'paused', rate: 0, edgeOnly: true },
          { running: true, phase: 'running', rate: 0.1, edgeOnly: true },
          { running: true, phase: 'running', rate: 10, edgeOnly: true },
        ])
          for (const emergency of pacing.clockHours ? [true] : [false, true]) {
            if (pacing.edgeOnly && (!code || !emergency)) continue;
            const { running } = pacing;
            await page.evaluate((state) => window.fixture.set(state), {
              code,
              pacing,
              clockMicros: pacing.clockHours
                ? (pacing.clockHours * 3600 + 61) * 1000000
                : 3661000000,
              simulationRunning: running,
              simulationStatus: running ? 'running' : 'stopped',
              saveStatus: emergency ? 'error' : 'dirty',
              saveIssue: emergency ? 'offline' : null,
              localCopySaved: !emergency,
            });
            await page.waitForTimeout(20);
            const geometry = await page.evaluate(() => {
              const box = (selector) => {
                const element = document.querySelector(selector);
                if (!element) return null;
                const r = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                return {
                  x: r.x,
                  y: r.y,
                  w: r.width,
                  h: r.height,
                  display: style.display,
                  visible: style.visibility,
                  fontSize: style.fontSize,
                  contentWidth: element.scrollWidth,
                  label: element.getAttribute('aria-label'),
                  unobstructed: element.contains(hit),
                  text: element.textContent,
                };
              };
              return {
                pacing: window.fixture.readPacing(),
                toolbar: box('.workbench-toolbar'),
                save: box('.save'),
                run: box('.simulate'),
                copy: box('.emergency-copy'),
                code: box('.workbench-pill.code'),
                library: box('.workbench-mobile-library-toggle'),
                clock: box('.workbench-simulation-time'),
                pace: box('.workbench-simulation-clock-button'),
                tools: box('.workbench-toolbar-group:not(.right)'),
                viewport: innerWidth,
                pageWidth: document.documentElement.scrollWidth,
              };
            });
            receipts.push({ width, dpr, code, running, emergency, pacing, geometry });
            if (!before) {
              assert.equal(geometry.pacing.phase, pacing.phase);
              assert.equal(geometry.pacing.rate, pacing.rate);
              assert.ok(geometry.pageWidth <= width, JSON.stringify(geometry));
              assert.ok(geometry.tools.w >= 44, JSON.stringify(geometry));
              const required = [
                'save',
                'run',
                'code',
                ...(emergency ? ['copy'] : []),
                ...(width <= 980 ? ['library'] : []),
                ...(running ? ['clock', 'pace'] : []),
              ];
              for (const key of required) {
                const b = geometry[key];
                const detail = JSON.stringify({ width, dpr, code, running, emergency, key, b });
                assert.ok(b && b.display !== 'none' && b.visible === 'visible', detail);
                assert.ok(b.x >= 0 && b.x + b.w <= width + 0.5, detail);
                assert.ok(
                  b.y >= geometry.toolbar.y &&
                    b.y + b.h <= geometry.toolbar.y + geometry.toolbar.h + 0.5,
                  detail,
                );
                assert.ok(b.unobstructed, detail);
                if (width <= 980 && key !== 'clock') assert.ok(b.w >= 42 && b.h >= 42, detail);
              }
              const distinct = required.filter((k) => k !== 'clock').map((k) => geometry[k]);
              for (let i = 0; i < distinct.length; i++)
                for (let j = i + 1; j < distinct.length; j++) {
                  const a = distinct[i],
                    b = distinct[j];
                  assert.ok(
                    a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5,
                    JSON.stringify({ a, b, width }),
                  );
                }
              assert.equal(Boolean(geometry.copy), emergency);
              assert.equal(Boolean(geometry.clock), running);
              if (running)
                assert.ok(
                  geometry.clock.text.endsWith(`${pacing.clockHours ?? '01'}:01:01`),
                  JSON.stringify(geometry.clock),
                );
              if (!pacing.geometryOnly) {
                for (const [selector, key] of [
                  ['.save', 'save'],
                  ['.simulate', 'run'],
                  ['.workbench-pill.code', 'code'],
                  ...(emergency ? [['.emergency-copy', 'copy']] : []),
                  ...(width <= 980 ? [['.workbench-mobile-library-toggle', 'library']] : []),
                ]) {
                  const button = page.locator(selector);
                  const initial = await page.evaluate((k) => window.fixture.counts[k] || 0, key);
                  await button.focus();
                  await page.keyboard.press('Enter');
                  assert.equal(
                    await page.evaluate((k) => window.fixture.counts[k], key),
                    initial + 1,
                  );
                  await button.tap();
                  assert.equal(
                    await page.evaluate((k) => window.fixture.counts[k], key),
                    initial + 2,
                  );
                  callbacks += 2;
                }
                const firstTool = page
                  .locator('.workbench-toolbar-group:not(.right) button:not(:disabled)')
                  .first();
                await firstTool.scrollIntoViewIfNeeded();
                const copied = await page.evaluate(() => window.fixture.counts.copySelected || 0);
                await firstTool.tap();
                assert.equal(
                  await page.evaluate(() => window.fixture.counts.copySelected),
                  copied + 1,
                );
                callbacks++;
                if (running) {
                  await page.locator('.workbench-simulation-clock-button').tap();
                  await page
                    .getByRole('dialog', { name: 'Скорость моделирования', exact: true })
                    .waitFor();
                  if (pacing.phase === 'pausing')
                    await page
                      .getByText(
                        '\u041f\u0440\u0438\u043e\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0430\u2026',
                        { exact: true },
                      )
                      .waitFor();
                  await page.keyboard.press('Escape');
                  assert.equal(
                    await page
                      .locator('.workbench-simulation-clock-button')
                      .getAttribute('aria-expanded'),
                    'false',
                  );
                  callbacks++;
                }
              }
            }
            if (code && running && emergency)
              await page.screenshot({
                path: resolve(
                  output,
                  `${width}-${dpr}-${pacing.phase}-${pacing.rate}-${pacing.clockHours ?? 1}h.png`,
                ),
              });
          }
    }
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(
    resolve(output, 'geometry.json'),
    JSON.stringify({ states: receipts.length, callbacks, receipts }, null, 2),
  );
}
console.log(
  `${before ? 'BEFORE' : 'AFTER'} actual production WorkbenchHeader+SimulationSpeedControl: ${receipts.length} states, ${callbacks} native keyboard/touch actions; ${output}`,
);
