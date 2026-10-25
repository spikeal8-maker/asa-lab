// Real React ScratchWorkspace component in Chromium, without a server or DB.
/* global window, document, console, innerWidth */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const assets = new Map();
const result = await build({
  stdin: {
    resolveDir: resolve('apps/web'),
    loader: 'tsx',
    contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import * as S from 'scratch-blocks'; import * as A from './src/electronics/arduino-blocks';
    import {ScratchWorkspace} from './src/electronics/ArduinoCodePanel';
    const initial = JSON.stringify({variables:Array.from({length:12},(_,i)=>({id:'v'+i,name:'переменная '+i,type:S.SCALAR_VARIABLE_TYPE})),blocks:{blocks:[{type:'asa_loop',id:'loop'}]}});
    window.fixture={S,A,mount:(scale,width)=>{
      const root=createRoot(document.getElementById('app'));
      function Demo(){const [category,setCategory]=React.useState('data');return <div className="arduino-block-editor" style={{height:600,'--arduino-flyout-width':width+'px'}}>
        <ScratchWorkspace initialWorkspace={initial} category={category} flyoutWidth={width} paletteScale={scale} onChange={(state,source)=>{window.latest={state,source}}}/>
        <div className="arduino-block-categories" role="tablist">{['input','output','control','data','variables','comment'].map(name=><button key={name} role="tab" aria-selected={category===name} className={category===name?'active':''} onClick={()=>setCategory(name)}>{name}</button>)}</div>
        <div className="arduino-palette-scale">100%</div>
      </div>}; root.render(<Demo/>);
    }};`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: { '@asa-lab/electronics': resolve('contexts/electronics/index.ts') },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  plugins: [
    {
      name: 'local-vendor-assets',
      setup(builder) {
        builder.onResolve({ filter: /\?url$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.replace(/\?url$/, '')),
          namespace: 'asset',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'asset' }, async (args) => {
          const url = 'https://asa-fixture.invalid/assets/' + basename(args.path);
          assets.set(url, {
            body: await readFile(args.path),
            contentType: args.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
          });
          return { contents: `export default ${JSON.stringify(url)}` };
        });
      },
    },
  ],
});
const css = await readFile('apps/web/src/electronics/workbench.css', 'utf8');
const output = resolve('test-results/arduino-editor-ui');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const receipts = [];
let activePage;
try {
  for (const [width, zoom, mobile] of [
    [1920, 1, false],
    [1920, 1.1, false],
    [1440, 1, false],
    [1024, 1, false],
    [390, 1, true],
    [320, 1, true],
  ]) {
    const context = await browser.newContext({
      viewport: {
        width: Math.floor(width / (mobile ? 1 : zoom)),
        height: Math.floor(900 / (mobile ? 1 : zoom)),
      },
      deviceScaleFactor: mobile ? 1 : zoom,
      isMobile: mobile,
      hasTouch: mobile,
    });
    const activate = (locator) => (mobile ? locator.tap() : locator.click());
    const page = await context.newPage();
    activePage = page;
    const errors = [];
    await page.route('**/*', async (route) => {
      const asset = assets.get(route.request().url());
      if (asset) await route.fulfill(asset);
      else await route.abort();
    });
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.log('PAGE_ERROR', error.message);
    });
    await page.setContent(
      '<meta name="viewport" content="width=device-width,initial-scale=1"><base href="https://asa-fixture.invalid/"><style>body{margin:0}#app{width:100vw;height:600px;position:relative}</style><div id="app"></div>',
    );
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: result.outputFiles[0].text });
    const paletteWidth = mobile ? 220 : 290;
    const scale = Math.min(0.75, Math.max(0.45, (0.675 * paletteWidth) / 330)) * 1.25 * zoom;
    await page.evaluate(({ scale, paletteWidth }) => window.fixture.mount(scale, paletteWidth), {
      scale,
      paletteWidth,
    });
    await page.waitForSelector('.blocklyFlyoutScrollbar');
    await page.waitForFunction(() => window.latest);
    for (const category of ['data', 'variables', 'input', 'control', 'output']) {
      await page.getByRole('tab', { name: category, exact: true })[mobile ? 'tap' : 'click']();
      await page.waitForFunction(
        (category) =>
          document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === category,
        category,
        { timeout: 3000 },
      );
      await page.waitForTimeout(100);
      const before = await page.evaluate(() => {
        const w = window.fixture.S.common.getMainWorkspace(),
          f = w.getFlyout();
        const blocks = f.getWorkspace().getTopBlocks(true);
        const last = blocks.at(-1);
        return {
          y: f.getWorkspace().scrollY,
          metrics: f.getWorkspace().getMetrics(),
          last: last?.type,
        };
      });
      // Explicit production control works for touch/keyboard as well as mouse.
      for (let i = 0; i < 12; i++)
        await activate(page.getByRole('button', { name: 'Прокрутить палитру вниз', exact: true }));
      const after = await page.evaluate(() => {
        const f = window.fixture.S.common.getMainWorkspace().getFlyout();
        const blocks = f.getWorkspace().getTopBlocks(true),
          last = blocks.at(-1);
        const rectangle = last?.getSvgRoot().getBoundingClientRect();
        const host = document.querySelector('.arduino-scratch-host').getBoundingClientRect();
        return {
          y: f.getWorkspace().scrollY,
          bottom: rectangle?.bottom,
          hostBottom: host.bottom,
          overflow: document.documentElement.scrollWidth > innerWidth,
          scrollHeight: f.getWorkspace().getMetrics().scrollHeight,
        };
      });
      assert.equal(after.overflow, false);
      if (before.metrics.contentHeight > before.metrics.viewHeight - 100)
        assert.ok(after.y < before.y, `${width}/${category}: palette must move`);
      assert.ok(
        after.bottom <= after.hostBottom - 60,
        `${width}/${category}: last block hidden behind footer (${JSON.stringify(after)})`,
      );
      for (let i = 0; i < 12; i++)
        await activate(page.getByRole('button', { name: 'Прокрутить палитру вверх', exact: true }));
      const top = await page.evaluate(
        () => window.fixture.S.common.getMainWorkspace().getFlyout().getWorkspace().scrollY,
      );
      assert.ok(Math.abs(top) < 2, `${width}/${category}: cannot return to top`);
      if (!mobile) {
        await page.mouse.move(100, 350);
        await page.mouse.wheel(0, 10000);
        await page.waitForTimeout(70);
        const wheel = await page.evaluate(
          () => window.fixture.S.common.getMainWorkspace().getFlyout().getWorkspace().scrollY,
        );
        if (before.metrics.contentHeight > before.metrics.viewHeight - 100)
          assert.ok(wheel < top, `${category}: native wheel cannot scroll`);
      }
      receipts.push({ width, zoom, mobile, category, scale, before, after });
    }
    if (mobile) {
      await page.getByRole('tab', { name: 'data', exact: true }).tap();
      await page.waitForTimeout(150);
      for (let i = 0; i < 12; i++)
        await page.getByRole('button', { name: 'Прокрутить палитру вверх', exact: true }).tap();
      if (mobile && true) {
        const touch = await context.newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: 100, y: 450 }],
        });
        for (let step = 1; step <= 10; step++)
          await touch.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: 100, y: 450 - step * 20 }],
          });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(80);
        const touchY = await page.evaluate(
          () => window.fixture.S.common.getMainWorkspace().getFlyout().getWorkspace().scrollY,
        );
        assert.ok(touchY < 0, `native touch swipe cannot scroll`);
      }
      await page.waitForTimeout(550);
    }
    {
      const point = await page.evaluate(() => {
        const { S, A } = window.fixture,
          w = S.common.getMainWorkspace();
        S.Events.disable();
        w.clear();
        const b = w.newBlock('asa_digital_write');
        A.applyArduinoBlockDefaults(w);
        b.initSvg();
        b.render();
        b.moveBy(450, 120);
        const pin = b.getInputTargetBlock('PIN');
        let r = pin.getField('VALUE').getSvgRoot().getBoundingClientRect();
        const desired = Math.min(innerWidth - 35, w.getFlyout().getWidth() + 100);
        w.scroll(w.scrollX + desired - (r.x + r.width / 2), w.scrollY + 180 - (r.y + r.height / 2));
        r = pin.getField('VALUE').getSvgRoot().getBoundingClientRect();
        window.pinUnderTest = pin;
        S.Events.enable();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (mobile) await page.touchscreen.tap(point.x, point.y);
      else await page.mouse.click(point.x, point.y);
      await page.waitForSelector('.blocklyMenuItem');
      const menu = await page
        .locator('.blocklyMenuItem')
        .evaluateAll((nodes) =>
          nodes.map((n) => ({ text: n.textContent, height: n.getBoundingClientRect().height })),
        );
      assert.equal(menu.length, 20);
      assert.ok(
        menu.every((item) => (mobile ? item.height >= 44 : item.height <= 32)),
        JSON.stringify(menu),
      );
      assert.deepEqual(
        menu.slice(-6).map((item) => item.text.trim()),
        ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'],
      );
      const last = page.locator('.blocklyMenuItem').filter({ hasText: /^A5$/ });
      await last.scrollIntoViewIfNeeded();
      if (mobile) await last.tap();
      else await last.click();
      assert.equal(await page.evaluate(() => window.pinUnderTest.getFieldValue('VALUE')), 'A5');
      receipts.push({ width, zoom, mobile, pinMenu: menu });
    }
    if (!mobile)
      for (const type of ['asa_number', 'asa_var_get', 'asa_math_add', 'asa_compare_eq']) {
        const points = await page.evaluate((type) => {
          const { S, A } = window.fixture,
            w = S.common.getMainWorkspace();
          S.Events.disable();
          w.clear();
          const loop = w.newBlock('asa_loop'),
            target = w.newBlock('asa_digital_write');
          loop.getInput('DO').connection.connect(target.previousConnection);
          const dragged = w.newBlock(type);
          if (type === 'asa_number') dragged.setFieldValue('13', 'VALUE');
          if (type === 'asa_var_get')
            dragged.setFieldValue(w.getVariableMap().createVariable('port').getId(), 'NAME');
          A.applyArduinoBlockDefaults(w);
          target.getInputTargetBlock('PIN').setFieldValue('A5', 'VALUE');
          for (const b of w.getAllBlocks(false)) {
            b.initSvg();
            b.render();
          }
          loop.moveBy(450, 80);
          dragged.moveBy(450, 350);
          const box = dragged.getSvgRoot().getBoundingClientRect();
          const start = { x: box.x + 24, y: box.y + 2 };
          const output = dragged.outputConnection.getOffsetInBlock(),
            sourcePosition = dragged.getRelativeToSurfaceXY();
          const input = target.getInput('PIN').connection.getOffsetInBlock(),
            targetPosition = target.getRelativeToSurfaceXY();
          const p = w.getParentSvg().createSVGPoint(),
            matrix = w.getCanvas().getScreenCTM();
          p.x = sourcePosition.x + output.x;
          p.y = sourcePosition.y + output.y;
          const origin = p.matrixTransform(matrix);
          p.x = targetPosition.x + input.x;
          p.y = targetPosition.y + input.y;
          const destination = p.matrixTransform(matrix);
          window.dragTarget = target;
          window.dragValue = dragged;
          S.Events.enable();
          return {
            start,
            end: { x: destination.x + start.x - origin.x, y: destination.y + start.y - origin.y },
          };
        }, type);
        await page.mouse.move(points.start.x, points.start.y);
        await page.mouse.down();
        await page.mouse.move(points.start.x + 12, points.start.y + 12, { steps: 4 });
        await page.mouse.move(points.end.x, points.end.y, { steps: 24 });
        await page.mouse.up();
        const nativeResult = await page.evaluate(() => {
          const w = window.fixture.S.common.getMainWorkspace(),
            a = window.dragTarget.getInput('PIN').connection,
            b = window.dragValue.outputConnection;
          return {
            connected: a.targetBlock() === window.dragValue,
            checker: w.connectionChecker.constructor.name,
            checks: w.connectionChecker.doTypeChecks(a, b),
            reason: w.connectionChecker.canConnectWithReason(b, a, true, 10000),
            baseDrag: String(window.fixture.S.ConnectionChecker.prototype.doDragChecks).slice(
              0,
              3500,
            ),
            reasons: Object.fromEntries(
              ['REASON_SHADOW_PARENT', 'REASON_DRAG_CHECKS_FAILED', 'REASON_CHECKS_FAILED'].map(
                (k) => [k, window.fixture.S.Connection[k]],
              ),
            ),
            dragCheck: String(w.connectionChecker.doDragChecks).slice(0, 1800),
          };
        });
        assert.equal(
          nativeResult.connected,
          true,
          `native pin drag ${type}: ${JSON.stringify(nativeResult)}`,
        );
        await page.waitForTimeout(220);
        await page
          .locator('#app')
          .screenshot({ path: resolve(output, `pin-${type}-${width}-${zoom}.png`) });
        const connected = await page.evaluate(() => {
          const { S, A } = window.fixture,
            w = S.common.getMainWorkspace(),
            saved = S.serialization.workspaces.save(w);
          const targetId = window.dragTarget.id,
            valueId = window.dragValue.id,
            source = A.generateArduinoCode(w);
          w.clear();
          S.serialization.workspaces.load(
            A.migrateLegacyArduinoWorkspaceState(JSON.parse(JSON.stringify(saved))),
            w,
          );
          A.applyArduinoBlockDefaults(w);
          const same =
            w.getBlockById(targetId).getInputTargetBlock('PIN').id === valueId &&
            A.generateArduinoCode(w) === source;
          w.getBlockById(valueId).dispose();
          const pin = w.getBlockById(targetId).getInputTargetBlock('PIN');
          return { same, dropdownRestored: pin.isShadow() && pin.getFieldValue('VALUE') === 'A5' };
        });
        assert.deepEqual(connected, { same: true, dropdownRestored: true });
        receipts.push({ width, zoom, type, nativePinDrag: connected });
      }
    await page.screenshot({ path: resolve(output, `editor-${width}-${zoom}.png`) });
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile(resolve(output, 'receipts.json'), JSON.stringify(receipts, null, 2));
  console.log(
    `PASS ${receipts.length} real-component palette/menu checks across Full HD100/110 and1440/1024/390/320`,
  );
} catch (error) {
  await activePage?.screenshot({ path: resolve(output, 'failure.png') });
  await writeFile(
    resolve(output, 'failure.json'),
    JSON.stringify({ error: String(error), receipts }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
