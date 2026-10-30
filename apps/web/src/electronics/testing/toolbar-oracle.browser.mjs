/* global window, document, getComputedStyle, URL, console */
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
const noop=()=>{};const c={projectTitle:'Toolbar oracle witness',project:{title:'Circuit'},saveStatus:'saved',saveIssue:null,localCopySaved:true,busy:false,selection:{kind:'component'},hasClipboard:true,canUndo:true,canRedo:true,activeWireColor:'#149447',orthogonalWireMode:false,libraryOpen:true,simulationRunning:false,simulationStatus:'stopped',simulationMessage:null,nativeOpticalPresentation:{subscribeClock:()=>()=>{},readClock:()=>3661000000},simulationPacing:new SimulationPacing()};
for(const name of ['saveNow','toggleSimulation','exportEmergencyCopy','setWireColor','copySelected','pasteCopied','removeSelection','undo','redo','rotateSelected','mirrorSelected','toggleWireRoute','renameProject','setProjectTitle','setSimulationRate','addTextAnnotation'])c[name]=noop;
const root=createRoot(document.getElementById('app'));window.fixture={set:({view,running})=>{c.simulationRunning=running;c.simulationStatus=running?'running':'stopped';root.render(<div className="workbench-shell"><WorkbenchHeader controller={c} user={{id:'fixture',displayName:'Witness',identityKind:'student-seat'}} view={view} codeOpen={true} notesOpen={false} onBack={noop} onViewChange={noop} onToggleNotes={noop} onToggleCode={noop} onToggleLibrary={noop} onOpenShare={noop} onExportView={noop}/></div>)}};window.fixture.set({view:'breadboard',running:false});`,
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
  for (const width of [1180, 1181, 1373, 1374]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [view, running] of [
      ['breadboard', false],
      ['breadboard', true],
      ['schematic', false],
      ['bom', false],
    ]) {
      await page.evaluate((state) => window.fixture.set(state), { view, running });
      await page.locator(`.workbench-toolbar.${view}`).waitFor();
      await page.waitForTimeout(20);
      const geometry = await page.evaluate(() => {
        const toolbar = document.querySelector('.workbench-toolbar');
        const rect = (element) => element.getBoundingClientRect().toJSON();
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
          controls: controls.map((element) => ({
            ariaLabel: element.getAttribute('aria-label'),
            text: element.textContent.trim(),
            rect: rect(element),
          })),
          clock: toolbar.querySelector('.workbench-simulation-time')?.textContent ?? null,
        };
      });
      receipts.push({ width, view, running, ...geometry });
      await writeFile(resolve(output, 'geometry.json'), JSON.stringify(receipts, null, 2));
      assert.equal(geometry.toolbar.height, 48);
      assert.equal(geometry.groups.length, 2);
      assert.equal(
        geometry.controls.length,
        view === 'breadboard' ? 16 : view === 'schematic' ? 8 : 6,
      );
      assert.equal(
        geometry.controls.filter((control) => control.ariaLabel === 'Добавить текст на схему')
          .length,
        view === 'breadboard' ? 1 : 0,
      );
      if (running) assert.match(geometry.clock, /^Время моделирования: \d{2}:\d{2}:\d{2}$/);
      await page.screenshot({
        path: resolve(output, `${width}-${view}-${running ? 'running' : 'stopped'}.png`),
      });
    }
  }
} finally {
  await browser.close();
}
console.log(
  `PASS: ${receipts.length} production Header states; 48px; controls 16/8/6; breadboard text tool present.`,
);
