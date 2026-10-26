// Real React ScratchWorkspace component in Chromium, without a server or DB.
/* global window, document, console, innerWidth, getComputedStyle */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import process from 'node:process';
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
    import {ScratchWorkspace,ArduinoCodePanel} from './src/electronics/ArduinoCodePanel';
    const initial = JSON.stringify({variables:Array.from({length:12},(_,i)=>({id:'v'+i,name:'переменная '+i,type:S.SCALAR_VARIABLE_TYPE})),blocks:{blocks:[{type:'asa_loop',id:'loop'}]}});
    window.fixture={S,A,workspace:initial,mountPanel:(mode='text')=>{const board={id:'uno',kind:'visual',componentTypeId:'arduino-uno',stateProperties:{arduinoCodeMode:mode,arduinoWorkspace:initial,arduinoSource:['void setup(){}','void loop(){','  // iii WWW 123','}'].join(String.fromCharCode(10))}};const c={document:{components:[board]},selection:null,simulationRunning:false,arduinoSerialByBoard:{},updateArduinoProgram:(id,properties)=>{window.saved=properties},setNotice:()=>{},sendArduinoSerialRx:()=>{}};createRoot(document.getElementById('app')).render(<ArduinoCodePanel controller={c} open drawerWidth={700} onDrawerWidthChange={()=>{}} mobileHeightPercent={80} onMobileHeightChange={()=>{}} onClose={()=>{}}/>);},mount:(scale,width)=>{
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
  if (process.argv.includes('--commands-before')) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    activePage = page;
    await page.route('**/*', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<div id="app"></div>' }),
    );
    await page.goto('https://asa-fixture.invalid/');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.evaluate(() => window.fixture.mountPanel());
    await page.locator('.arduino-commands-button').click();
    const reference = page.getByRole('complementary', { name: 'Справочник команд Arduino' });
    assert.equal(await reference.locator('summary').filter({ hasText: 'Библиотеки' }).count(), 0);
    await reference.getByRole('searchbox').fill('for');
    await reference.getByRole('button', { name: 'Развернуть описание for' }).click();
    assert.match(await reference.innerText(), /тело выполняется один раз/);
    await page.screenshot({ path: resolve(output, 'commands-before.png') });
    await writeFile(
      resolve(output, 'commands-before.json'),
      JSON.stringify({ libraries: false, help: await reference.innerText() }, null, 2),
    );
    console.log('PASS before: mounted panel lacks Libraries and claims one-pass for');
    await page.close();
  } else if (process.argv.includes('--commands')) {
    for (const width of [1440, 1024, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        hasTouch: width < 500,
        isMobile: width < 500,
      });
      const page = await context.newPage();
      activePage = page;
      await page.route('**/*', (route) => {
        const asset = assets.get(route.request().url());
        return route.fulfill(
          asset ?? {
            contentType: 'text/html',
            body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>',
          },
        );
      });
      await page.goto('https://asa-fixture.invalid/');
      await page.addStyleTag({
        content:
          css +
          '\n#app{position:relative;height:900px;--wb-code-height:80%;--arduino-code-panel-width:700px}',
      });
      await page.addScriptTag({ content: result.outputFiles[0].text });
      await page.evaluate(() => window.fixture.mountPanel());
      const editor = page.getByRole('textbox', { name: 'Код Arduino C++' });
      const original = await editor.inputValue();
      await page.locator('.arduino-commands-button').click();
      const ref = page.getByRole('complementary', { name: 'Справочник команд Arduino' });
      const libraries = ref.locator('summary').filter({ hasText: /^Библиотеки$/ });
      await libraries.scrollIntoViewIfNeeded();
      if (width < 500) await libraries.tap();
      else {
        await libraries.focus();
        await page.keyboard.press('Enter');
      }
      assert.equal(await libraries.evaluate((e) => e.parentElement.open), true);
      const servo = ref.locator('summary').filter({ hasText: /^Servo$/ });
      if (width < 500) await servo.tap();
      else {
        await servo.focus();
        await page.keyboard.press('Space');
      }
      assert.equal(await servo.evaluate((e) => e.parentElement.open), true);
      assert.equal(await ref.locator('.arduino-command-library article').count(), 5);
      const search = ref.getByRole('searchbox');
      for (const alias of ['библиотеки', 'libraries', 'сервопривод', 'Servo']) {
        await search.fill(alias);
        assert.equal(await ref.locator('article').count(), 5, alias);
      }
      await search.fill('Servo.read');
      assert.equal(await ref.locator('article').count(), 1);
      await ref.getByRole('button', { name: 'Развернуть описание servo.read()' }).click();
      assert.match(await ref.innerText(), /не измерение положения физического вала/);
      await search.fill('библиотека');
      await editor.press('Control+Home');
      await ref.locator('.arduino-command-drag').filter({ hasText: '#include <Servo.h>' }).click();
      assert.equal(await editor.inputValue(), '#include <Servo.h>\nServo servo;\n' + original);
      // Click inserts at the tracked cursor inside setup, using the same path as ordinary commands.
      const attachAt = (await editor.inputValue()).indexOf('}');
      await editor.evaluate((e, at) => {
        e.focus();
        e.setSelectionRange(at - 1, at - 1);
      }, attachAt);
      await editor.press('ArrowRight');
      await ref.locator('.arduino-command-drag').filter({ hasText: 'servo.attach(pin)' }).click();
      assert.match(await editor.inputValue(), /void setup\(\)\{\nservo.attach\(9\);\n\}/);
      let nativeDrag = null;
      if (width === 1440) {
        const row = ref.locator('.arduino-command-drag').filter({ hasText: 'servo.write(angle)' });
        await row.scrollIntoViewIfNeeded();
        const start = await row.boundingBox();
        const target = await editor.evaluate((e) => {
          const r = e.getBoundingClientRect(),
            style = getComputedStyle(e);
          const line = e.value.split('\n').findIndex((line) => line.includes('// iii'));
          return {
            x: r.x + 80,
            y:
              r.y +
              parseFloat(style.paddingTop) +
              line * parseFloat(style.lineHeight) -
              e.scrollTop +
              2,
          };
        });
        await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
        await page.mouse.down();
        await page.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2, {
          steps: 5,
        });
        await page.mouse.move(target.x, target.y, { steps: 25 });
        await page.mouse.move(target.x + 1, target.y, { steps: 2 });
        await page.locator('.arduino-snippet-drop-line').waitFor();
        nativeDrag = await page.locator('.arduino-snippet-drop-line').innerText();
        await page.mouse.up();
        assert.match(
          await editor.inputValue(),
          /void loop\(\)\{\nservo.write\(90\);\n {2}\/\/ iii/,
        );
      }
      assert.match(await editor.inputValue(), /\/\/ iii WWW 123/);
      const saved = await page.evaluate(() => window.saved);
      assert.equal(saved.arduinoSource, await editor.inputValue());
      assert.equal(saved.arduinoWorkspace, await page.evaluate(() => window.fixture.workspace));
      await search.fill('no-such-command');
      assert.match(await ref.innerText(), /Ничего не найдено/);
      await search.fill('random');
      assert.match(await ref.innerText(), /Не исполняется/);
      await search.fill('Servo');
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({ path: resolve(output, 'commands-' + width + '.png') });
      receipts.push({ width, nativeDrag, saved });
      // Mixed mode keeps the reference informative and disables every insertion gesture.
      const mixed = await context.newPage();
      activePage = mixed;
      await mixed.route('**/*', (route) =>
        route.fulfill(
          assets.get(route.request().url()) ?? {
            contentType: 'text/html',
            body: '<div id="app"></div>',
          },
        ),
      );
      await mixed.goto('https://asa-fixture.invalid/');
      await mixed.addStyleTag({
        content:
          css +
          '\n#app{position:relative;height:900px;--wb-code-height:80%;--arduino-code-panel-width:700px}',
      });
      await mixed.addScriptTag({ content: result.outputFiles[0].text });
      await mixed.evaluate(() => window.fixture.mountPanel('blocks-text'));
      await mixed.locator('.arduino-commands-button').click();
      await mixed.getByRole('searchbox', { name: 'Поиск команды Arduino' }).fill('Servo');
      const readonly = mixed.getByRole('textbox', { name: 'Сгенерированный код Arduino' });
      const before = await readonly.inputValue();
      assert.equal(await readonly.getAttribute('readonly'), '');
      const commands = mixed.locator('.arduino-command-library .arduino-command-drag');
      assert.equal(await commands.count(), 5);
      for (const button of await commands.all())
        assert.equal(await button.getAttribute('draggable'), 'false');
      await commands.first().click();
      assert.equal(await readonly.inputValue(), before);
      await context.close();
    }
    await writeFile(resolve(output, 'commands-receipts.json'), JSON.stringify(receipts, null, 2));
    console.log(
      'PASS Commands: keyboard/touch Libraries, search, cursor click, native mouse line drag, preserved text/workspace, read-only mixed at1440/1024/390/320',
    );
  }
  for (const [width, zoom, mobile] of process.argv.some((arg) => arg.startsWith('--commands'))
    ? []
    : [
        [1920, 1, false],
        [1920, 1.1, false],
        [1440, 1, false],
        [1920, 1.25, false],
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
      assert.equal(await page.locator('.arduino-palette-scroll').count(), 0);
      if (!mobile) {
        await page.mouse.move(80, 350);
        await page.mouse.wheel(0, 30000);
      } else {
        const native = await context.newCDPSession(page);
        for (let swipe = 0; swipe < 18; swipe++) {
          await native.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: 2, y: 440 }],
          });
          for (let step = 1; step <= 8; step++)
            await native.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x: 2, y: 440 - step * 35 }],
            });
          await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
      }
      await page.waitForTimeout(80);
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
      // Drag the native scrollbar thumb back to the beginning.
      const handle = page
        .locator('.blocklyFlyoutScrollbar .blocklyScrollbarHandle')
        .filter({ visible: true })
        .last();
      const thumb = (await handle.count()) ? await handle.boundingBox() : null;
      if (thumb && before.metrics.contentHeight > before.metrics.viewHeight - 100) {
        await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
        await page.mouse.down();
        await page.mouse.move(thumb.x + thumb.width / 2, -50, { steps: 10 });
        await page.mouse.up();
      }
      const scrollbarTop = await page.evaluate(
        () => window.fixture.S.common.getMainWorkspace().getFlyout().getWorkspace().scrollY,
      );
      if (thumb && after.y < -2 && ['data', 'variables'].includes(category))
        assert.ok(scrollbarTop > after.y, 'native scrollbar must scroll toward top');
      await page.mouse.move(80, 350);
      await page.mouse.wheel(0, -30000);
      await page.waitForTimeout(50);
      const top = await page.evaluate(
        () => window.fixture.S.common.getMainWorkspace().getFlyout().getWorkspace().scrollY,
      );
      assert.ok(
        Math.abs(top) < 2,
        `${width}/${zoom}/${category}: cannot return to top ${top} thumb ${JSON.stringify(thumb)}`,
      );
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
      receipts.push({ width, zoom, mobile, category, scale, before, after, scrollbarTop });
    }

    const rgb = await page.evaluate(() => {
      const { S, A } = window.fixture,
        w = S.common.getMainWorkspace();
      S.Events.disable();
      w.clear();
      const legacy = {
        blocks: {
          blocks: [
            {
              type: 'asa_loop',
              id: 'rgb-loop',
              x: 350,
              y: 20,
              inputs: {
                DO: {
                  block: {
                    type: 'asa_rgb_write',
                    id: 'rgb',
                    fields: { R_PIN: '3', G_PIN: '5', B_PIN: '6', R: '255', G: '80', B: '0' },
                  },
                },
              },
            },
          ],
        },
      };
      S.serialization.workspaces.load(A.migrateLegacyArduinoWorkspaceState(legacy), w);
      A.applyArduinoBlockDefaults(w);
      const rgb = w.getBlockById('rgb');
      for (const b of w.getAllBlocks(false)) {
        b.initSvg();
        b.render();
      }
      const originalCode = A.generateArduinoCode(w),
        names = ['R_PIN', 'G_PIN', 'B_PIN', 'R', 'G', 'B'];
      const defaults = Object.fromEntries(
        names.map((n) => [n, rgb.getInputTargetBlock(n).getFieldValue('VALUE')]),
      );
      const text = rgb.inputList[0].fieldRow[0],
        e = text.getSvgRoot().querySelector('text'),
        style = getComputedStyle(e),
        canvas = document.createElement('canvas').getContext('2d');
      canvas.font = style.font;
      const measured = canvas.measureText(text.getText().replaceAll('\u00a0', ' ')).width;
      const font = {
        computed: style.font,
        shadow: style.textShadow,
        fieldWidth: text.getSize().width,
        canvasWidth: measured,
      };
      const compact = rgb.getHeightWidth();
      w.scroll(w.getFlyout().getWidth() + 20 - 350 * w.scale, 30 - 20 * w.scale);
      S.Events.enable();
      return {
        inline: rgb.getInputsInline(),
        compact,
        font,
        defaults,
        originalCode,
        ids: w
          .getAllBlocks(false)
          .map((b) => b.id)
          .sort(),
      };
    });
    assert.equal(rgb.inline, true);
    assert.ok(rgb.compact.height < 180, JSON.stringify(rgb));
    assert.equal(rgb.font.shadow, 'none');
    assert.ok(Math.abs(rgb.font.fieldWidth - rgb.font.canvasWidth) < 1, JSON.stringify(rgb.font));
    assert.deepEqual(rgb.defaults, {
      R_PIN: '3',
      G_PIN: '5',
      B_PIN: '6',
      R: '255',
      G: '80',
      B: '0',
    });
    assert.match(rgb.originalCode, /analogWrite\(3, 255\)/);
    assert.match(rgb.originalCode, /analogWrite\(5, 80\)/);
    await page
      .locator('.arduino-scratch-host')
      .screenshot({ path: resolve(output, 'rgb-' + width + '-' + zoom + '.png') });
    // Isolate only the native RGB render for a readable crop, including on phones.
    const clip = await page.evaluate(() => {
      const w = window.fixture.S.common.getMainWorkspace(),
        b = w.getBlockById('rgb');
      w.getFlyout().hide();
      const p = b.getRelativeToSurfaceXY();
      w.scroll(12 - p.x * w.scale, 130 - p.y * w.scale);
      const r = b.getSvgRoot().getBoundingClientRect();
      return { x: r.x - 2, y: r.y - 2, width: r.width + 4, height: r.height + 4 };
    });
    await page.screenshot({
      path: resolve(output, 'rgb-crop-' + width + '-' + zoom + '.png'),
      clip,
    });
    await page.evaluate((scale) => {
      const { S, A } = window.fixture;
      S.common.getMainWorkspace().updateToolbox(A.toolboxForCategory('output', [], scale));
    }, scale);
    await page.evaluate(() => {
      const { S, A } = window.fixture,
        w = S.common.getMainWorkspace(),
        rgb = w.getBlockById('rgb');
      S.Events.disable();
      for (const [i, name] of ['R_PIN', 'G_PIN', 'B_PIN', 'R', 'G', 'B'].entries()) {
        const math = w.newBlock('asa_math_add', 'math-' + name),
          pin = w.newBlock(i < 3 ? 'asa_pwm_pin' : 'asa_number', 'value-' + name);
        pin.setFieldValue(i < 3 ? '3' : '20', 'VALUE');
        math.initSvg();
        pin.initSvg();
        A.applyArduinoBlockDefaults(w);
        math.getInput('A').connection.connect(pin.outputConnection);
        rgb.getInput(name).connection.connect(math.outputConnection);
        math.render();
      }
      S.Events.enable();
      w.clearUndo();
      window.rgbCode = A.generateArduinoCode(w);
      window.rgbIds = w
        .getAllBlocks(false)
        .map((b) => b.id)
        .sort();
      S.Events.setGroup(true);
      rgb.getInputTargetBlock('R').getInputTargetBlock('A').setFieldValue('21', 'VALUE');
      S.Events.setGroup(false);
    });
    await page.waitForTimeout(70);
    const nested = await page.evaluate(() => {
      const { S, A } = window.fixture,
        w = S.common.getMainWorkspace();
      w.undo(false);
      const undone = A.generateArduinoCode(w) === window.rgbCode;
      w.undo(true);
      const redone = A.generateArduinoCode(w) !== window.rgbCode;
      w.undo(false);
      const saved = S.serialization.workspaces.save(w);
      w.clear();
      S.serialization.workspaces.load(A.migrateLegacyArduinoWorkspaceState(saved), w);
      A.applyArduinoBlockDefaults(w);
      const rgb = w.getBlockById('rgb');
      return {
        undone,
        redone,
        code: A.generateArduinoCode(w) === window.rgbCode,
        ids:
          JSON.stringify(
            w
              .getAllBlocks(false)
              .map((b) => b.id)
              .sort(),
          ) === JSON.stringify(window.rgbIds),
        slots: ['R_PIN', 'G_PIN', 'B_PIN', 'R', 'G', 'B'].every(
          (n) => rgb.getInputTargetBlock(n).type === 'asa_math_add',
        ),
      };
    });
    assert.deepEqual(nested, { undone: true, redone: true, code: true, ids: true, slots: true });
    receipts.push({ width, zoom, mobile, rgb, nested });
    if (mobile) {
      await page.getByRole('tab', { name: 'data', exact: true }).tap();
      await page.waitForTimeout(150);
      await page.evaluate(() => {
        const w = window.fixture.S.common.getMainWorkspace().getFlyout().getWorkspace();
        w.scroll(w.scrollX, 0);
      });
      if (mobile && true) {
        const touch = await context.newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: 2, y: 450 }],
        });
        for (let step = 1; step <= 10; step++)
          await touch.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: 2, y: 450 - step * 20 }],
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
    if (!mobile && width === 1440)
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
    const panel = await context.newPage();
    await panel.route('**/*', (r) =>
      r.fulfill({
        contentType: 'text/html',
        body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><div id="app"></div>',
      }),
    );
    await panel.goto('https://asa-fixture.invalid/');
    await panel.addStyleTag({ content: css });
    await panel.addScriptTag({ content: result.outputFiles[0].text });
    await panel.evaluate(() => window.fixture.mountPanel());
    await panel.locator('textarea').waitFor();
    const typography = await panel.evaluate(() => {
      const selectors = ['textarea', '.arduino-code-highlight', '.arduino-code-gutter'];
      const styles = selectors.map((q) => {
        const e = document.querySelector(q),
          s = getComputedStyle(e),
          r = e.getBoundingClientRect();
        return {
          font: s.font,
          lineHeight: s.lineHeight,
          paddingTop: s.paddingTop,
          left: r.left,
          width: r.width,
        };
      });
      const canvas = document.createElement('canvas').getContext('2d');
      canvas.font = styles[0].font;
      const summary = getComputedStyle(document.querySelector('.arduino-mode-menu summary'));
      return {
        styles,
        summary: { font: summary.font, lineHeight: summary.lineHeight },
        monoWidths: ['iiii', 'WWWW', '1234'].map((t) => canvas.measureText(t).width),
      };
    });
    assert.equal(typography.styles[0].font, typography.styles[1].font);
    assert.equal(typography.styles[0].font, typography.styles[2].font);
    assert.equal(typography.styles[0].left, typography.styles[1].left);
    assert.equal(typography.styles[0].width, typography.styles[1].width);
    assert.ok(Math.max(...typography.monoWidths) - Math.min(...typography.monoWidths) < 0.01);
    assert.ok(parseFloat(typography.summary.lineHeight) >= 17);
    await panel.locator('textarea').evaluate((e) => {
      e.focus();
      e.setSelectionRange(5, 10);
    });
    assert.deepEqual(
      await panel.locator('textarea').evaluate((e) => [e.selectionStart, e.selectionEnd]),
      [5, 10],
    );
    await panel.screenshot({ path: resolve(output, 'code-' + width + '-' + zoom + '.png') });
    receipts.push({ width, zoom, mobile, typography });
    await panel.close();
    await context.close();
  }
  if (!process.argv.some((arg) => arg.startsWith('--commands'))) {
    await writeFile(resolve(output, 'receipts.json'), JSON.stringify(receipts, null, 2));
    console.log(
      `PASS ${receipts.length} real-component palette/menu checks across Full HD effective100/110/125 and1440/390/320 (CSS viewport/DPR emulation, not browser Ctrl zoom)`,
    );
  }
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
