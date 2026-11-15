// Saved-program preservation regression: native Blockly/React; no server, database or timers altered.
/* global window */
import assert from 'node:assert/strict';
import process from 'node:process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const assets = new Map();
const bundle = await build({
  stdin: {
    resolveDir: resolve('apps/web'),
    loader: 'tsx',
    contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import * as S from 'scratch-blocks'; import * as A from './src/electronics/arduino-blocks';
import {ArduinoCodePanel} from './src/electronics/ArduinoCodePanel';
A.registerArduinoBlocks();
let root;
const programHandle = React.createRef();
window.flush = () => programHandle.current.flushPendingPublication();
window.eventState = () => [S.Events.getGroup(), S.Events.getRecordUndo()];
window.notices = [];
window.board = null;
window.inspect=()=>({undo:S.getMainWorkspace().getUndoStack().map(e=>({type:e.type,recordUndo:e.recordUndo,group:e.group})),redo:S.getMainWorkspace().getRedoStack().map(e=>({type:e.type,recordUndo:e.recordUndo,group:e.group})),source:A.generateArduinoCode(S.getMainWorkspace()),state:JSON.stringify(S.serialization.workspaces.save(S.getMainWorkspace())),blocks:S.getMainWorkspace().getAllBlocks(false).map(b=>({id:b.id,type:b.type}))});
window.mount=(workspace,source,properties)=>{
 window.persisted=[]; window.notices=[];
 const board={id:'old-uno',kind:'visual',componentTypeId:'arduino-uno',stateProperties:properties===null?{}:properties??{arduinoCodeMode:'blocks',arduinoWorkspace:workspace,arduinoSource:source}};
 window.board=board;window.otherBoard={...board,id:'other-uno',stateProperties:{...board.stateProperties,arduinoSource:'// Other saved board\\r\\n'+source}};const boards=[board,window.otherBoard]; const c={document:{components:boards},selection:null,simulationRunning:false,arduinoSerialByBoard:{},selectComponent:()=>{},updateArduinoProgram:(id,p)=>{window.persisted.push(p);const target=boards.find(b=>b.id===id);target.stateProperties={...target.stateProperties,...p}},setNotice:(n)=>window.notices.push(n),sendArduinoSerialRx:()=>{}};
 root=createRoot(document.getElementById('app'));root.render(<ArduinoCodePanel controller={c} programHandleRef={programHandle} open drawerWidth={700} onDrawerWidthChange={()=>{}} mobileHeightPercent={80} onMobileHeightChange={()=>{}} onClose={()=>{}}/>);
};
window.unmount=()=>root.unmount();`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: {
    '@asa-lab/electronics/rendering': resolve('contexts/electronics/rendering.ts'),
    '@asa-lab/electronics': resolve('contexts/electronics/index.ts'),
    '@asa-lab/module-sdk': resolve('packages/module-sdk/src/index.ts'),
  },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  plugins: [
    {
      name: 'vendor-assets',
      setup(b) {
        b.onResolve({ filter: /\?url$/ }, (a) => ({
          path: resolve(a.resolveDir, a.path.replace(/\?url$/, '')),
          namespace: 'asset',
        }));
        b.onLoad({ filter: /.*/, namespace: 'asset' }, async (a) => {
          const url = 'https://asa-fixture.invalid/assets/' + basename(a.path);
          assets.set(url, {
            body: await readFile(a.path),
            contentType: a.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
          });
          return { contents: 'export default ' + JSON.stringify(url) };
        });
      },
    },
  ],
});
// Original source/workspace bytes from 8fd7f251, captured before issue #865.
const oracles = JSON.parse(
  await readFile(new URL('./arduino-preservation-865-oracles.json', import.meta.url), 'utf8'),
);
assert.equal(oracles.length, 16);
const browser = await chromium.launch({ headless: true });
const receipts = [];
const journeys = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', async (route) => {
      if (route.request().isNavigationRequest())
        return route.fulfill({
          contentType: 'text/html',
          body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>',
        });
      const asset = assets.get(route.request().url());
      if (asset) return route.fulfill(asset);
      return route.abort();
    });
    await page.goto('https://asa-fixture.invalid/');
    await page.addStyleTag({
      content:
        (await readFile('apps/web/src/electronics/workbench.css', 'utf8')) +
        '\n#app{position:relative;height:900px;--wb-code-height:80%;--arduino-code-panel-width:700px}',
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const eventState = await page.evaluate(() => window.eventState());
    for (const name of ['hats', 'empty', 'corrupt']) {
      const oracle = oracles.find((o) => o.name === (name === 'corrupt' ? 'hats' : name));
      const workspace = name === 'corrupt' ? '{invalid-json' : oracle.workspace;
      const source = '// Existing owner sketch: preserve on no-edit open\r\n' + oracle.source;
      await page.evaluate(({ workspace, source }) => window.mount(workspace, source), {
        workspace,
        source,
      });
      await page.locator('.blocklySvg').first().waitFor();
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.flush());
      const actual = await page.evaluate(() => ({
        persisted: window.persisted,
        board: window.board,
        notices: window.notices,
        liveBlockCount: window.Blockly?.getMainWorkspace?.()?.getAllBlocks(false).length,
      }));
      const last = actual.board.stateProperties;
      assert.equal(actual.persisted.length, 0, 'Mount and host Save flush preserve saved bytes');
      assert.equal(actual.notices.length, name === 'corrupt' ? 1 : 0);
      receipts.push({
        width,
        name,
        before: { workspace, source },
        after: last,
        publishCount: actual.persisted.length,
        sourceExact: source === last.arduinoSource,
        workspaceExact: workspace === last.arduinoWorkspace,
        errors: [...errors],
      });
      assert.equal(last.arduinoAutoWaitMs, undefined);
      assert.equal(workspace, last.arduinoWorkspace);
      assert.equal(source === last.arduinoSource, true, 'Saved source must be preserved exactly');
      for (const index of [1, 2, 0]) {
        await page.locator('.arduino-mode-menu summary').click();
        await page.locator('.arduino-mode-popover button').nth(index).click();
        const confirm = page.locator('.arduino-confirm-dialog .primary');
        if (await confirm.count()) await confirm.click();
        await page.waitForTimeout(200);
        const saved = await page.evaluate(() => window.board.stateProperties);
        assert.equal(saved.arduinoSource, source);
        assert.equal(saved.arduinoWorkspace, workspace);
      }
      await page.evaluate(() => window.unmount());
      await page.evaluate(({ workspace, source }) => window.mount(workspace, source), {
        workspace,
        source,
      });
      await page.locator('.blocklySvg').first().waitFor();
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.flush());
      assert.equal(await page.evaluate(() => window.persisted.length), 0);
      assert.equal(await page.evaluate(() => window.board.stateProperties.arduinoSource), source);
      assert.equal(
        await page.evaluate(() => window.board.stateProperties.arduinoWorkspace),
        workspace,
      );
      if (name === 'corrupt') {
        await page.locator('.arduino-mode-menu summary').click();
        await page.getByRole('button', { name: 'Настройки Arduino' }).click();
        await page.getByRole('checkbox', { name: 'Входной порт A0', exact: true }).check();
        await page.getByRole('button', { name: 'Применить' }).click();
        const afterSettings = await page.evaluate(() => window.board.stateProperties);
        assert.deepEqual(afterSettings.arduinoInputPins, ['A0']);
        assert.equal(afterSettings.arduinoSource, source);
        assert.equal(afterSettings.arduinoWorkspace, workspace);
      }
      receipts.at(-1).modeSwitchExact = true;
      receipts.at(-1).reopenExact = true;
      await page.evaluate(() => window.unmount());
    }
    const unknownBlock = JSON.stringify({ blocks: { blocks: [{ type: 'asa_removed_block' }] } });
    await page.evaluate(
      (workspace) => window.mount(workspace, '// Preserved sketch\r\n'),
      unknownBlock,
    );
    await page.locator('.blocklySvg').first().waitFor();
    await page.evaluate(() => window.flush());
    assert.deepEqual(await page.evaluate(() => window.eventState()), eventState);
    assert.equal(await page.evaluate(() => window.persisted.length), 0);
    assert.equal(await page.evaluate(() => window.notices.length), 1);
    await page.evaluate(() => window.unmount());
    const legacyComment = JSON.stringify({
      workspaceComments: [{ id: 'owner-note', text: 'Saved project note', x: 420, y: 60 }],
    });
    await page.evaluate(
      (workspace) => window.mount(workspace, '// Saved project note'),
      legacyComment,
    );
    await page.locator('.blocklySvg').first().waitFor();
    await page.evaluate(() => window.flush());
    assert.equal(await page.evaluate(() => window.persisted.length), 0);
    assert.equal(await page.evaluate(() => window.notices.length), 0);
    assert.equal(
      await page.evaluate(() => window.board.stateProperties.arduinoWorkspace),
      legacyComment,
    );
    await page.evaluate(() => window.unmount());
    const oracle = oracles.find((o) => o.name === 'hats');
    const source = '// Saved exact CRLF\r\n' + oracle.source;
    // Separate genuine-edit fixture; the original six fixtures above remain untouched.
    const editingState = JSON.parse(oracle.workspace);
    editingState.blocks.blocks.forEach((b, i) => {
      b.x = 500;
      b.y = i * 300;
    });
    const editingWorkspace = JSON.stringify(editingState);
    await page.evaluate(({ workspace, source }) => window.mount(workspace, source), {
      workspace: editingWorkspace,
      source,
    });
    await page.locator('.blocklySvg').first().waitFor();
    await page.waitForTimeout(300);
    // Public renderer inspection is read-only; all edits below use native UI.
    if (width < 500) {
      await page.locator('.arduino-palette-resize-handle').focus();
      await page.keyboard.press('Shift+ArrowLeft');
      await page.keyboard.press('Shift+ArrowLeft');
    }
    await page.locator('.blocklyZoomReset').click();
    for (let i = 0; i < 3; i++) await page.locator('.blocklyZoomOut').click();
    if (width >= 500) {
      const loopId = await page.evaluate(
        () => window.inspect().blocks.find((b) => b.type === 'asa_loop').id,
      );
      const loopBox = await page.locator(`[data-id="${loopId}"]`).boundingBox();
      await page.mouse.move(loopBox.x + 15, loopBox.y + 12);
      await page.mouse.down();
      await page.mouse.move(loopBox.x + 15, loopBox.y + 70, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(350);
    }
    const ledId = await page.evaluate(
      () => window.inspect().blocks.find((b) => b.type === 'asa_builtin_led').id,
    );
    const ledField = page.locator(`[data-id="${ledId}"] .blocklyDropdownText`).first();
    if (width < 500) {
      await page.mouse.move(330, 500);
      await page.mouse.wheel(
        (await ledField.boundingBox()).x + 22 - 330,
        (await ledField.boundingBox()).y + 6 - 500,
      );
      await page.waitForTimeout(150);
    }
    await ledField.click();
    await page.getByText(/^\u041d\u0418\u0417\u041a\u0418\u0419$/).click();
    await page.waitForFunction(() =>
      window.board.stateProperties.arduinoSource.includes('digitalWrite(LED_BUILTIN, LOW)'),
    );
    await page.waitForTimeout(350);
    const edited = await page.evaluate(() => ({
      p: window.board.stateProperties,
      inspection: window.inspect(),
      publishes: window.persisted.length,
    }));
    assert.equal(edited.p.arduinoSource, edited.inspection.source);
    assert.equal(edited.p.arduinoWorkspace, edited.inspection.state);
    assert.match(edited.p.arduinoSource, /digitalWrite\(LED_BUILTIN, LOW\)/);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(50);
    const undone = await page.evaluate(() => ({
      p: window.board.stateProperties,
      i: window.inspect(),
    }));
    assert.equal(undone.p.arduinoSource, undone.i.source);
    assert.equal(undone.p.arduinoWorkspace, undone.i.state);
    assert.match(undone.p.arduinoSource, /digitalWrite\(LED_BUILTIN, HIGH\)/);
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(50);
    const redone = await page.evaluate(() => ({
      p: window.board.stateProperties,
      i: window.inspect(),
    }));
    assert.equal(redone.p.arduinoSource, redone.i.source);
    assert.equal(redone.p.arduinoWorkspace, redone.i.state);
    assert.equal(redone.p.arduinoSource, edited.p.arduinoSource);
    await page.locator('.arduino-board-select').selectOption('other-uno');
    await page.waitForTimeout(300);
    const otherExact = await page.evaluate(() => window.otherBoard.stateProperties.arduinoSource);
    assert.equal(otherExact, '// Other saved board\r\n' + source);
    await page.locator('.arduino-board-select').selectOption('old-uno');
    await page.waitForTimeout(300);
    const download = page.waitForEvent('download');
    await page.locator('.arduino-download-button').click();
    const exported = await download;
    const exportedText = await readFile(await exported.path(), 'utf8');
    assert.equal(exportedText, edited.p.arduinoSource);
    await page.evaluate(() => window.unmount());
    await page.evaluate((p) => window.mount(p.arduinoWorkspace, p.arduinoSource, p), edited.p);
    await page.locator('.blocklySvg').first().waitFor();
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => window.board.stateProperties), edited.p);
    assert.equal(await page.evaluate(() => window.persisted.length), 0);
    for (const index of [1, 2, 0]) {
      await page.locator('.arduino-mode-menu summary').click();
      await page.locator('.arduino-mode-popover button').nth(index).click();
      const confirm = page.locator('.arduino-confirm-dialog .primary');
      if (await confirm.count()) await confirm.click();
      await page.waitForTimeout(250);
      const p = await page.evaluate(() => window.board.stateProperties);
      assert.equal(p.arduinoSource, edited.p.arduinoSource);
      assert.equal(p.arduinoWorkspace, edited.p.arduinoWorkspace);
    }
    await page.evaluate(() => window.unmount());
    // Source-only text, including intentional emptiness, does not become Blink.
    for (const rawSource of ['', '// owner\r\nvoid setup(){}\r\nvoid loop(){}\r\n']) {
      await page.evaluate((p) => window.mount(undefined, undefined, p), {
        arduinoSource: rawSource,
      });
      await page.locator('textarea').waitFor();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('textarea').inputValue(), rawSource.replace(/\r\n/g, '\n'));
      assert.equal(
        await page.evaluate(() => window.board.stateProperties.arduinoSource),
        rawSource,
      );
      await page.evaluate(() => window.flush());
      assert.equal(await page.evaluate(() => window.persisted.length), 0);
      assert.equal(await page.locator('.blocklySvg').count(), 0);
      await page.evaluate(() => window.unmount());
    }
    // Explicit stored emptiness is distinct from genuinely new state.
    for (const workspace of ['', '{}']) {
      await page.evaluate(({ workspace, source }) => window.mount(workspace, source), {
        workspace,
        source,
      });
      await page.locator('.blocklySvg').first().waitFor();
      await page.waitForTimeout(300);
      await page.evaluate(() => window.flush());
      assert.equal(await page.evaluate(() => window.persisted.length), 0);
      assert.equal(await page.evaluate(() => window.inspect().blocks.length), 0);
      await page.evaluate(() => window.unmount());
    }
    await page.evaluate(() => window.mount(undefined, undefined, null));
    await page.waitForFunction(() => window.persisted.length > 0);
    const created = await page.evaluate(() => ({
      p: window.board.stateProperties,
      i: window.inspect(),
    }));
    assert.equal(created.p.arduinoSource, created.i.source);
    assert.equal(created.p.arduinoWorkspace, created.i.state);
    assert(created.i.blocks.length > 0);
    assert.match(created.p.arduinoSource, /delay\(1000\)/);
    journeys.push({ width, edited, undone, redone, created, exportExact: true, reopenExact: true });
    await page.evaluate(() => window.unmount());
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    JSON.stringify({
      oracles: oracles.length,
      genuineEditWidths: journeys.map(({ width }) => width),
      mounts: receipts.length,
      sourceOverwrites: receipts.filter((r) => !r.sourceExact).length,
      workspaceOverwrites: receipts.filter((r) => !r.workspaceExact).length,
    }) + '\n',
  );
} finally {
  await browser.close();
}
