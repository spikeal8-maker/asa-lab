// Browser component regression: genuine Scratch renderer and mouse gestures,
// entirely in an in-memory page. No server, Docker, ports, accounts or database.
/* global process, window, document, innerWidth, console */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const buildOptions = {
  stdin: {
    contents: `import * as S from 'scratch-blocks';
      import * as A from './src/electronics/arduino-blocks';
      import { configureArduinoConnections } from './src/electronics/arduino-block-ui';
      window.fixture = { S, A, configureArduinoConnections };`,
    resolveDir: resolve('apps/web'),
  },
  alias: { '@asa-lab/electronics': resolve('contexts/electronics/index.ts') },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"test"' },
};
const result = await build(buildOptions);
// Use the immutable pre-repair source to create a genuine legacy save and
// generated-code oracle. Override only the module in memory, never disk.
const legacyRef = process.env.ARDUINO_LEGACY_REF ?? '91587fe47ee635ef745fca368ab384bf27a6a26d';
const legacySource = execFileSync(
  'git',
  ['show', `${legacyRef}:apps/web/src/electronics/arduino-blocks.ts`],
  { encoding: 'utf8' },
);
const legacyBundle = await build({
  ...buildOptions,
  plugins: [
    {
      name: 'legacy-arduino-fixture',
      setup(builder) {
        builder.onLoad({ filter: /[\\/]arduino-blocks\.ts$/ }, (args) => ({
          contents: legacySource,
          loader: 'ts',
          resolveDir: resolve(args.path, '..'),
        }));
      },
    },
  ],
});
const output = resolve('test-results/arduino-value-inputs');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const receipts = [];
let activePage;
try {
  const legacyPage = await browser.newPage();
  await legacyPage.addScriptTag({ content: legacyBundle.outputFiles[0].text });
  const legacy = await legacyPage.evaluate(() => {
    const { S, A } = window.fixture;
    A.registerArduinoBlocks();
    S.Events.disable();
    const w = new S.Workspace();
    const loop = w.newBlock('asa_loop');
    const variable = w.getVariableMap().createVariable('counter');
    const cases = [
      ['asa_wait', { TIME: '0.125', UNIT: 'SECONDS' }],
      ['asa_repeat', { COUNT: '3' }],
      ['asa_for', { NAME: 'i', STEP: '2', FROM: '3', TO: '9' }],
      ['asa_builtin_led', { LEVEL: 'LOW' }],
      ['asa_digital_write', { PIN: '8', LEVEL: 'LOW' }],
      ['asa_analog_write', { PIN: '5' }],
      ['asa_servo_write', { PIN: '9', ANGLE: '93' }],
      ['asa_tone', { PIN: '8', FREQUENCY: '880' }],
      ['asa_play_note', { PIN: '8', FREQUENCY: '523', DURATION: '0.375' }],
      ['asa_serial_print', { TEXT: '', ENDING: 'NONE' }],
      ['asa_serial_print', { TEXT: 'a "quote"\nстрока', ENDING: 'LINE' }],
      ['asa_rgb_write', { R: '17', G: '23', B: '31' }],
      ['asa_lcd_print', { TEXT: '  ' }],
      ['asa_lcd_cursor', { COLUMN: '3', ROW: '1' }],
      ['asa_7seg_print', { DISPLAY: '2', VALUE: '2345' }],
      ['asa_neopixel_set', { INDEX: '2', R: '3', G: '5', B: '7' }],
      ['asa_var_change', { NAME: variable.getId(), VALUE: '-2.5' }],
      ['asa_if', {}],
    ];
    let connection = loop.getInput('DO').connection;
    for (const [type, fields] of cases) {
      const block = w.newBlock(type);
      for (const [name, value] of Object.entries(fields)) block.setFieldValue(value, name);
      connection.connect(block.previousConnection);
      connection = block.nextConnection;
    }
    for (const [type, fields] of [
      ['asa_random', { MIN: '2', MAX: '9' }],
      ['asa_map', { FROM_LOW: '2', FROM_HIGH: '9', TO_LOW: '20', TO_HIGH: '90' }],
      ['asa_constrain', { MIN: '3', MAX: '8' }],
      ['asa_math_add', {}],
    ]) {
      const assignment = w.newBlock('asa_var_set');
      assignment.setFieldValue(variable.getId(), 'NAME');
      const value = w.newBlock(type);
      for (const [name, literal] of Object.entries(fields)) value.setFieldValue(literal, name);
      assignment.getInput('VALUE').connection.connect(value.outputConnection);
      connection.connect(assignment.previousConnection);
      connection = assignment.nextConnection;
    }
    const saved = S.serialization.workspaces.save(w),
      code = A.generateArduinoCode(w);
    w.dispose();
    return { saved, code, cases: cases.length + 4 };
  });
  await legacyPage.close();
  const compatibilityPage = await browser.newPage();
  await compatibilityPage.addScriptTag({ content: result.outputFiles[0].text });
  const compatibility = await compatibilityPage.evaluate((legacy) => {
    const { S, A } = window.fixture;
    A.registerArduinoBlocks();
    S.Events.disable();
    const w = new S.Workspace();
    S.serialization.workspaces.load(A.migrateLegacyArduinoWorkspaceState(legacy.saved), w);
    A.applyArduinoBlockDefaults(w);
    const code = A.generateArduinoCode(w),
      saved = S.serialization.workspaces.save(w);
    w.clear();
    S.serialization.workspaces.load(A.migrateLegacyArduinoWorkspaceState(saved), w);
    A.applyArduinoBlockDefaults(w);
    const reopened = A.generateArduinoCode(w);
    w.dispose();
    return { code, reopened };
  }, legacy);
  assert.equal(
    compatibility.code,
    legacy.code,
    'Old-project generated source must be byte-for-byte equal',
  );
  assert.equal(
    compatibility.reopened,
    legacy.code,
    'Reopened old project must preserve the source',
  );
  await compatibilityPage.close();
  await writeFile(
    resolve(output, 'legacy-compatibility.json'),
    JSON.stringify({ legacyRef, cases: legacy.cases, exactCodeEqual: true, ...legacy }, null, 2),
  );
  for (const width of [1440, 1024, 390, 320]) {
    const mobile = width === 390;
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      hasTouch: mobile,
      isMobile: mobile,
    });
    activePage = page;
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(
      '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#host{width:100vw;height:900px}</style><div id="host"></div>',
    );
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.evaluate(() => {
      const { S, A } = window.fixture;
      A.registerArduinoBlocks();
      window.fixture.workspace = S.inject(document.getElementById('host'), {
        sounds: false,
        scrollbars: true,
        trashcan: false,
        scratchTheme: S.ScratchBlocksTheme.CLASSIC,
        zoom: { startScale: 0.86 },
      });
      window.fixture.configureArduinoConnections(window.fixture.workspace);
    });
    for (const [type, socket, reporterType] of [
      ['asa_wait', 'TIME', 'asa_var_get'],
      ['asa_serial_print', 'TEXT', 'asa_var_get'],
      ['asa_digital_write', 'LEVEL', 'asa_var_get'],
      ['asa_var_change', 'VALUE', 'asa_var_get'],
      ...([1440, 390].includes(width)
        ? [
            ['asa_wait', 'TIME', 'asa_compare_eq'],
            ['asa_tone', 'FREQUENCY', 'asa_compare_eq'],
            ['asa_servo_write', 'ANGLE', 'asa_compare_eq'],
            ['asa_7seg_print', 'VALUE', 'asa_compare_eq'],
            ['asa_logic_and', 'A', 'asa_number'],
            ['asa_while', 'CONDITION', 'asa_number'],
          ]
        : []),
    ]) {
      for (const nested of reporterType === 'asa_var_get' ? [false, true] : [false]) {
        const points = await page.evaluate(
          ({ type, socket, nested, reporterType }) => {
            const { workspace: w, S, A } = window.fixture;
            w.clear();
            const loop = w.newBlock('asa_loop');
            const target = w.newBlock(type);
            const variable = w.getVariableMap().createVariable('sensor');
            const value = w.newBlock(reporterType);
            if (reporterType === 'asa_var_get') value.setFieldValue(variable.getId(), 'NAME');
            if (reporterType === 'asa_number') value.setFieldValue('2', 'VALUE');
            if (type === 'asa_var_change') target.setFieldValue(variable.getId(), 'NAME');
            let dragged = value;
            if (nested) {
              dragged = w.newBlock('asa_math_add');
              dragged.getInput('A').connection.connect(value.outputConnection);
            }
            if (target.previousConnection)
              loop.getInput('DO').connection.connect(target.previousConnection);
            A.applyArduinoBlockDefaults(w);
            for (const block of w.getAllBlocks(false)) {
              block.initSvg();
              block.render();
            }
            loop.moveBy(12, 60);
            if (target.outputConnection) target.moveBy(12, 140);
            dragged.moveBy(20, 300);
            // Long labels can place Servo/display sockets outside a phone's
            // viewport. Pan the genuine workspace, then keep the loose reporter
            // visible so the touch gesture begins and ends on screen.
            const inputPosition = target.getRelativeToSurfaceXY();
            const inputOffset = target.getInput(socket).connection.getOffsetInBlock();
            const inputPoint = w.getParentSvg().createSVGPoint();
            inputPoint.x = inputPosition.x + inputOffset.x;
            inputPoint.y = inputPosition.y + inputOffset.y;
            const inputScreen = inputPoint.matrixTransform(w.getCanvas().getScreenCTM());
            if (inputScreen.x > innerWidth - 80)
              w.scroll(w.scrollX + innerWidth / 2 - inputScreen.x, w.scrollY);
            const looseBox = dragged.getSvgRoot().getBoundingClientRect();
            dragged.moveBy((20 - looseBox.left) / w.scale, 0);
            window.fixture.target = target;
            window.fixture.dragged = dragged;
            const root = dragged.getSvgRoot();
            const box = root.getBoundingClientRect();
            const position = target.getRelativeToSurfaceXY();
            const offset = target.getInput(socket).connection.getOffsetInBlock();
            const outputOffset = dragged.outputConnection.getOffsetInBlock();
            const svgPoint = w.getParentSvg().createSVGPoint();
            svgPoint.x = position.x + offset.x;
            svgPoint.y = position.y + offset.y;
            const targetPoint = svgPoint.matrixTransform(w.getCanvas().getScreenCTM());
            // Grab the operator label, never a nested child reporter or shadow.
            // Use the math block's top border: grabbing its right-hand operator
            // can put the mouse beyond a narrow viewport when aligning outputs.
            const start = nested
              ? { x: box.left + 24, y: box.top + 2 }
              : { x: box.left + 18, y: box.top + box.height / 2 };
            const draggedPosition = dragged.getRelativeToSurfaceXY();
            svgPoint.x = draggedPosition.x + outputOffset.x;
            svgPoint.y = draggedPosition.y + outputOffset.y;
            const outputPoint = svgPoint.matrixTransform(w.getCanvas().getScreenCTM());
            // Scratch snaps at the reporter output, not the mouse grab point.
            const end = {
              x: targetPoint.x + start.x - outputPoint.x,
              y: targetPoint.y + start.y - outputPoint.y,
            };
            const constants = w.getRenderer().getConstants();
            const shape = constants.shapeFor(target.getInput(socket).connection);
            if (
              target.getInput(socket).connection.getCheck()?.includes('Number') &&
              shape !== constants.ROUNDED
            )
              throw Error('Value socket must be rounded');
            const expectedShape =
              reporterType === 'asa_compare_eq' ? S.OUTPUT_SHAPE_HEXAGONAL : S.OUTPUT_SHAPE_ROUND;
            if (dragged.getOutputShape() !== expectedShape) throw Error('Reporter shape changed');
            return { start, end };
          },
          { type, socket, nested, reporterType },
        );
        if (mobile) {
          const touch = await page.context().newCDPSession(page);
          await touch.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ ...points.start, id: 1 }],
          });
          for (let step = 1; step <= 24; step++) {
            await touch.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [
                {
                  x: points.start.x + ((points.end.x - points.start.x) * step) / 24,
                  y: points.start.y + ((points.end.y - points.start.y) * step) / 24,
                  id: 1,
                },
              ],
            });
          }
          await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await touch.detach();
        } else {
          await page.mouse.move(points.start.x, points.start.y);
          await page.mouse.down();
          await page.mouse.move(points.start.x + 12, points.start.y + 12, { steps: 4 });
          await page.mouse.move(points.end.x, points.end.y, { steps: 24 });
          await page.mouse.up();
        }
        const receipt = await page.evaluate(
          ({ socket, type, nested }) => {
            const { workspace: w, target, dragged, S, A } = window.fixture;
            if (target.getInputTargetBlock(socket) !== dragged)
              throw Error(`Native drag failed: ${type}.${socket}, nested=${nested}`);
            // A loose operator avoids a competing ancestor socket during the
            // gesture. Mount the successfully connected operator afterwards so
            // generated-source comparison also exercises the completed graph.
            if (target.outputConnection) {
              const wait = w.newBlock('asa_wait');
              w.getAllBlocks(false)
                .find((block) => block.type === 'asa_loop')
                .getInput('DO')
                .connection.connect(wait.previousConnection);
              wait.getInput('TIME').connection.connect(target.outputConnection);
              A.applyArduinoBlockDefaults(w);
            }
            const code = A.generateArduinoCode(w);
            const saved = S.serialization.workspaces.save(w);
            const targetId = target.id,
              draggedId = dragged.id;
            w.clear();
            S.serialization.workspaces.load(
              A.migrateLegacyArduinoWorkspaceState(JSON.parse(JSON.stringify(saved))),
              w,
            );
            A.applyArduinoBlockDefaults(w);
            if (A.generateArduinoCode(w) !== code) throw Error('Code changed on reopen');
            if (w.getBlockById(targetId).getInputTargetBlock(socket).id !== draggedId)
              throw Error('Connection lost on reopen');
            return {
              type,
              socket,
              nested,
              code,
              connectionPreserved: true,
              pageOverflow: document.documentElement.scrollWidth > innerWidth,
            };
          },
          { socket, type, nested },
        );
        assert.equal(receipt.pageOverflow, false);
        receipts.push({ width, mobile, reporterType, ...receipt });
      }
    }
    await page.screenshot({ path: resolve(output, `expressions-${width}.png`) });
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(resolve(output, 'receipts.json'), JSON.stringify(receipts, null, 2));
  console.log(
    `PASS ${legacy.cases} legacy cases with byte-exact old code; ${receipts.length} native drags and save/reopen checks; 1440/1024/390/320; no server or ports`,
  );
} catch (error) {
  await activePage?.screenshot({ path: resolve(output, 'failure.png') });
  await writeFile(
    resolve(output, 'failure.json'),
    JSON.stringify({ message: String(error), completed: receipts }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
