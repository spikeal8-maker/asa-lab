/* global window, document, requestAnimationFrame, getComputedStyle, innerWidth, URL, Event, console */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const before = process.argv.includes('--before');
const baseline = '0dad68fa';
const historic = (path) =>
  execFileSync('git', ['show', baseline + ':' + path], { encoding: 'utf8' });
const output = resolve('test-results/workbench-tooltips', before ? 'before' : 'after');
await mkdir(output, { recursive: true });
const source = `import React from 'react';import {createRoot} from 'react-dom/client';import {WorkbenchHeader} from './WorkbenchHeader';
const counts={};const hit=n=>counts[n]=(counts[n]||0)+1;
const c={projectTitle:'Проверка панели Arduino',project:{title:'Проверка'},saveStatus:'unsaved',saveIssue:null,localCopySaved:true,busy:false,selection:{kind:'component'},hasClipboard:true,canUndo:true,canRedo:true,activeWireColor:'#149447',orthogonalWireMode:false,libraryOpen:true,simulationRunning:false,simulationStatus:'stopped',simulationMessage:null,nativeOpticalPresentation:{subscribeClock:()=>()=>{},readClock:()=>0}};
for(const name of ['copySelected','pasteCopied','removeSelection','undo','redo','rotateSelected','mirrorSelected','renameProject','setProjectTitle','exportEmergencyCopy','saveNow'])c[name]=()=>hit(name);
let code=false,view='breadboard';const root=createRoot(document.getElementById('app'));
c.toggleSimulation=()=>{hit('run');c.simulationRunning=!c.simulationRunning;c.simulationStatus=c.simulationRunning?'running':'stopped';render()};c.toggleWireRoute=()=>{hit('path');c.orthogonalWireMode=!c.orthogonalWireMode;render()};c.setWireColor=color=>{hit('color');c.activeWireColor=color;render()};
function render(){root.render(<div className="workbench-shell"><WorkbenchHeader controller={c} user={{id:'fixture',displayName:'Проверка',identityKind:'student-seat'}} view={view} notesOpen={false} codeOpen={code} onBack={()=>hit('back')} onViewChange={v=>{view=v;render()}} onToggleNotes={()=>hit('notes')} onToggleCode={()=>{hit('code');code=!code;render()}} onToggleLibrary={()=>hit('library')} onOpenShare={()=>hit('share')} onExportView={()=>hit('export')}/><main className="workbench-main"/></div>)}
window.fixture={counts,set:patch=>{Object.assign(c,patch);render()},dispose:()=>root.unmount()};render();`;
const bundle = await build({
  stdin: { contents: source, resolveDir: resolve('apps/web/src/electronics'), loader: 'tsx' },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  plugins: before
    ? [
        {
          name: 'current-baseline-header',
          setup(builder) {
            builder.onLoad({ filter: /WorkbenchHeader\.tsx$/ }, () => ({
              contents: historic('apps/web/src/electronics/WorkbenchHeader.tsx'),
              loader: 'tsx',
            }));
          },
        },
      ]
    : [],
});
const css = before
  ? historic('apps/web/src/electronics/workbench.css')
  : await readFile('apps/web/src/electronics/workbench.css', 'utf8');
const browser = await chromium.launch({ headless: true });
const receipts = [];
try {
  for (const width of [1440, 1024, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1.25,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/asa-lab-mark.svg')
        return route.fulfill({
          contentType: 'image/svg+xml',
          body: await readFile('apps/web/public/asa-lab-mark.svg', 'utf8'),
        });
      return route.fulfill({
        contentType: 'text/html',
        body:
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}' +
          css +
          '</style><div id="app"></div>',
      });
    });
    await page.goto('https://tooltip-fixture.invalid/');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const copy = page.getByRole('button', { name: 'Копировать (Ctrl+C)', exact: true });
    await copy.waitFor();
    await copy.scrollIntoViewIfNeeded();
    await copy.hover();
    const hover = await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            resolve({
              tooltips: document.querySelectorAll('[role="tooltip"]').length,
              title: document
                .querySelector('[aria-label="Копировать (Ctrl+C)"]')
                .getAttribute('title'),
            }),
          ),
        ),
    );
    if (before) {
      assert.equal(hover.tooltips, 0);
      assert.equal(hover.title, 'Копировать (Ctrl+C)');
      await page.mouse.move(width - 2, 899);
      await page.locator('body').click({ position: { x: width - 2, y: 898 } });
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        if (await copy.evaluate((e) => e === document.activeElement)) break;
      }
      assert.equal(await copy.evaluate((e) => e === document.activeElement), true);
      const focus = await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() =>
              resolve({
                tooltips: document.querySelectorAll('[role="tooltip"]').length,
                focused: document.activeElement.getAttribute('aria-label'),
              }),
            ),
          ),
      );
      assert.equal(focus.tooltips, 0);
      assert.ok(
        Object.keys(await page.evaluate(() => window.fixture.counts)).every(
          (name) => name === 'renameProject',
        ),
      );
      receipts.push({
        width,
        dpr: 1.25,
        hover,
        focus,
        boundary:
          'Native title attribute exists; no immediate DOM help. OS tooltip latency is not measured in headless Chromium.',
      });
      if (width === 1440 || width === 320)
        await page.screenshot({ path: resolve(output, 'toolbar-' + width + '.png') });
    } else {
      const tooltip = page.getByRole('tooltip');
      const frame = () =>
        page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
      const absent = async () => {
        await frame();
        assert.equal(await tooltip.count(), 0);
      };
      const visible = async (text) => {
        await frame();
        assert.equal(await tooltip.count(), 1, 'Tooltip ' + text + ' at ' + width);
        assert.equal(await tooltip.textContent(), text);
        const box = await tooltip.boundingBox();
        assert.ok(
          box &&
            box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= width &&
            box.y + box.height <= 900,
        );
        assert.equal(await tooltip.evaluate((e) => getComputedStyle(e).pointerEvents), 'none');
      };
      assert.equal(hover.title, null);
      await visible('Копировать (Ctrl+C)');
      await copy.evaluate((e) => e.setAttribute('aria-describedby', 'existing-description'));
      await page.mouse.move(width - 2, 899);
      await absent();
      // Each actual visible toolbar control is observed through its native pointer events.
      const controls = page.locator('[role="toolbar"] [data-workbench-tooltip]');
      let hoverChecks = 0;
      for (let i = 0; i < (await controls.count()); i++) {
        const control = controls.nth(i);
        if (!(await control.isVisible())) continue;
        await control.scrollIntoViewIfNeeded();
        await control.hover();
        await visible(await control.getAttribute('data-workbench-tooltip'));
        assert.equal(await control.getAttribute('title'), null);
        hoverChecks++;
        await page.mouse.move(width - 2, 899);
        await absent();
      }
      assert.ok(hoverChecks >= 13);
      await copy.scrollIntoViewIfNeeded();
      await copy.hover();
      await visible('Копировать (Ctrl+C)');
      await page.keyboard.press('Escape');
      const copyBox = await copy.boundingBox();
      await page.mouse.move(copyBox.x + copyBox.width / 2 + 1, copyBox.y + copyBox.height / 2);
      await absent();
      await page.mouse.move(width - 2, 899);
      // Keyboard focus uses the genuine Tab sequence; Escape does not execute commands.
      await page.locator('body').click({ position: { x: width - 2, y: 898 } });
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        if (await copy.evaluate((e) => e === document.activeElement)) break;
      }
      assert.equal(await copy.evaluate((e) => e === document.activeElement), true);
      await visible('Копировать (Ctrl+C)');
      assert.ok(
        (await copy.getAttribute('aria-describedby')).includes(await tooltip.getAttribute('id')),
      );
      await page.keyboard.press('Escape');
      await absent();
      assert.equal(await copy.getAttribute('aria-describedby'), 'existing-description');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Space');
      assert.equal(await page.evaluate(() => window.fixture.counts.copySelected), 2);
      // Run/Stop help follows rerenders even while keyboard focus remains on the button.
      const run = page.locator('[data-simulation-status]');
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        if (await run.evaluate((e) => e === document.activeElement)) break;
      }
      assert.equal(await run.evaluate((e) => e === document.activeElement), true);
      await visible('Начать моделирование (Ctrl/⌘+Enter)');
      await page.evaluate(() =>
        window.fixture.set({ simulationRunning: true, simulationStatus: 'running' }),
      );
      await visible('Моделирование запущено — остановить (Ctrl/⌘+Enter)');
      await page.keyboard.press('Space');
      assert.equal(await page.evaluate(() => window.fixture.counts.run), 1);
      await visible('Начать моделирование (Ctrl/⌘+Enter)');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await absent();
      // Actual clicks retain one callback per control; help never intercepts the pointer.
      const callbacks = [
        ['Копировать (Ctrl+C)', 'copySelected'],
        ['Вставить (Ctrl+V)', 'pasteCopied'],
        ['Удалить (Delete)', 'removeSelection'],
        ['Отменить (Ctrl+Z)', 'undo'],
        ['Повторить (Ctrl+Shift+Z)', 'redo'],
        ['Заметки', 'notes'],
        ['Показать или скрыть заметки', 'notes'],
        ['Повернуть на 45° (R)', 'rotateSelected'],
        ['Отразить (M)', 'mirrorSelected'],
        ['Сохранить проект сейчас', 'saveNow'],
      ];
      for (const [label, callback] of callbacks) {
        const button = page.locator('[data-workbench-tooltip]').filter({ visible: true });
        const match = await button.evaluateAll(
          (els, text) => els.findIndex((e) => e.getAttribute('data-workbench-tooltip') === text),
          label,
        );
        assert.ok(match >= 0, 'Missing control ' + label);
        const target = button.nth(match);
        await target.scrollIntoViewIfNeeded();
        const count = await page.evaluate((name) => window.fixture.counts[name] || 0, callback);
        await target.click();
        assert.equal(
          await page.evaluate((name) => window.fixture.counts[name] || 0, callback),
          count + 1,
        );
      }
      const code = page.getByRole('button', { name: 'Открыть редактор кода', exact: true });
      await code.click();
      assert.equal(await page.evaluate(() => window.fixture.counts.code), 1);
      await page.getByRole('button', { name: 'Закрыть редактор кода', exact: true }).hover();
      await visible('Закрыть редактор кода');
      await page.getByRole('button', { name: 'Закрыть редактор кода', exact: true }).click();
      assert.equal(await page.evaluate(() => window.fixture.counts.code), 2);
      const path = page.getByRole('button', {
        name: 'Автоматическая прокладка провода под 90 градусов',
      });
      await path.scrollIntoViewIfNeeded();
      await path.click();
      assert.equal(await page.evaluate(() => window.fixture.counts.path), 1);
      const color = page.locator('summary[aria-label="Цвет провода"]');
      await color.click();
      const red = page.getByRole('menuitemradio', { name: 'Цвет провода: Красный' });
      await red.hover();
      await visible('Красный');
      await red.click();
      assert.equal(await page.evaluate(() => window.fixture.counts.color), 1);
      assert.equal(await color.evaluate((e) => e.parentElement.open), false);
      const share = page.locator('[aria-label="Отправить — пока недоступно"]');
      if (await share.isVisible()) {
        await share.scrollIntoViewIfNeeded();
        await share.hover();
        await visible('Общий доступ пока недоступен');
        await share.click({ force: true });
      } else {
        await page.evaluate(() => window.fixture.set({ selection: null }));
        await copy.scrollIntoViewIfNeeded();
        await copy.hover();
        await visible('Копировать (Ctrl+C)');
        const count = await page.evaluate(() => window.fixture.counts.copySelected);
        await copy.click({ force: true });
        assert.equal(await page.evaluate(() => window.fixture.counts.copySelected), count);
        await page.evaluate(() => window.fixture.set({ selection: { kind: 'component' } }));
      }
      assert.equal(await share.isDisabled(), true);
      assert.equal(await page.evaluate(() => window.fixture.counts.share || 0), 0);
      await page.evaluate(() => window.fixture.set({ saveStatus: 'error', saveIssue: 'server' }));
      const emergency = page.getByRole('button', { name: 'Получить аварийную копию проекта' });
      await emergency.hover();
      await visible('Скачать схему и код в JSON');
      await emergency.click();
      assert.equal(await page.evaluate(() => window.fixture.counts.exportEmergencyCopy), 1);
      await page.evaluate(() => window.fixture.set({ saveStatus: 'dirty', saveIssue: null }));
      // Native touch uses Chromium input, including cancellation and horizontal scrolling.
      const session = await context.newCDPSession(page);
      const point = async (locator) => {
        await locator.scrollIntoViewIfNeeded();
        const b = await locator.boundingBox();
        assert.ok(b);
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      };
      const touch = async (type, points) =>
        session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
      let p;
      const runBefore = await page.evaluate(() => window.fixture.counts.run);
      for (const [index, status] of ['running', 'stopped'].entries()) {
        p = await point(run);
        await touch('touchStart', [p]);
        await touch('touchEnd', []);
        await absent();
        await page.waitForFunction(
          (expected) => window.fixture.counts.run === expected,
          runBefore + index + 1,
          { timeout: 1500 },
        );
        assert.equal(await run.getAttribute('data-simulation-status'), status);
        assert.equal(await page.evaluate(() => window.fixture.counts.run), runBefore + index + 1);
      }
      const library = page.locator('[aria-label="Каталог деталей"]');
      if (await library.isVisible()) {
        p = await point(library);
        await touch('touchStart', [p]);
        await touch('touchEnd', []);
        await absent();
        await page.waitForFunction(() => window.fixture.counts.library === 1, null, {
          timeout: 1500,
        });
        assert.equal(await page.evaluate(() => window.fixture.counts.library), 1);
      }
      const undo = page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true });
      const undoBefore = await page.evaluate(() => window.fixture.counts.undo || 0);
      p = await point(undo);
      await touch('touchStart', [p]);
      await touch('touchEnd', []);
      await absent();
      assert.equal(await page.evaluate(() => window.fixture.counts.undo), undoBefore + 1);
      p = await point(undo);
      await touch('touchStart', [p]);
      await touch('touchCancel', []);
      await absent();
      assert.equal(await page.evaluate(() => window.fixture.counts.undo), undoBefore + 1);
      const scroll = page.locator('.workbench-breadboard-tools');
      const scrollBefore = await scroll.evaluate((e) => {
        e.scrollLeft = 0;
        return e.scrollLeft;
      });
      p = await point(undo);
      await touch('touchStart', [p]);
      await touch('touchMove', [{ x: Math.max(5, p.x - 90), y: p.y }]);
      await touch('touchEnd', []);
      await absent();
      assert.equal(await page.evaluate(() => window.fixture.counts.undo), undoBefore + 1);
      const scrollAfter = await scroll.evaluate((e) => e.scrollLeft);
      if (width <= 390)
        assert.ok(scrollAfter > scrollBefore, 'Native horizontal toolbar scroll remains usable');
      const save = page.getByRole('button', { name: 'Сохранить проект', exact: true });
      const saveBefore = await page.evaluate(() => window.fixture.counts.saveNow || 0);
      p = await point(save);
      await touch('touchStart', [p]);
      await touch('touchEnd', []);
      await absent();
      assert.equal(await page.evaluate(() => window.fixture.counts.saveNow), saveBefore + 1);
      const toolbar = await page.locator('[role="toolbar"]').boundingBox();
      assert.ok(toolbar && toolbar.height <= 56);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await copy.scrollIntoViewIfNeeded();
      await copy.hover();
      await visible('Копировать (Ctrl+C)');
      await page.mouse.move(width - 2, 899);
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        if (await copy.evaluate((e) => e === document.activeElement)) break;
      }
      assert.equal(await copy.evaluate((e) => e === document.activeElement), true);
      await visible('Копировать (Ctrl+C)');
      const clips = await scroll.evaluate((e) => {
        const movable = e.scrollWidth > e.clientWidth + 50;
        if (movable) e.scrollLeft = e.scrollWidth;
        return movable;
      });
      if (clips) {
        await absent();
        await copy.scrollIntoViewIfNeeded();
        await copy.hover();
        await visible('Копировать (Ctrl+C)');
      }
      if (width === 1440 || width === 320)
        await page.screenshot({ path: resolve(output, 'toolbar-' + width + '.png') });
      await page.evaluate(() => window.fixture.dispose());
      await absent();
      receipts.push({
        width,
        dpr: 1.25,
        hoverChecks,
        keyboard: 'Tab Enter Space Escape PASS',
        dynamicRunStop: 'PASS',
        disabled: 'inert hover PASS',
        touch: 'tap swipe cancel PASS',
        scrollBefore,
        scrollAfter,
        clippedAnchorDismissal: clips ? 'PASS' : 'no horizontal overflow',
        callbacks: await page.evaluate(() => window.fixture.counts),
        unmount: 'PASS',
      });
      await writeFile(resolve(output, 'receipt.json'), JSON.stringify(receipts, null, 2));
      console.log('AFTER width ' + width + ' PASS');
      await session.detach();
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify(receipts, null, 2));
  console.log(JSON.stringify(receipts));
} finally {
  await browser.close();
}
