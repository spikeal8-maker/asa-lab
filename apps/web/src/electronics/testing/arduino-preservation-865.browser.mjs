// Saved-program preservation regression: native Blockly/React; no server, database or timers altered.
/* global window */
import assert from 'node:assert/strict';
import process from 'node:process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
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
const wait=(unit='MILLISECONDS',time='1')=>({type:'asa_wait',fields:{UNIT:unit,TIME:time}});
const led={type:'asa_builtin_led',fields:{LEVEL:'HIGH'}};
const cycle=(type,body)=>({type,inputs:{DO:{block:body}}});
const hat=(body)=>cycle('asa_loop',body);
const fixtures={
 hats:{blocks:{blocks:[cycle('asa_setup',wait()),hat(led)]}},
 free:{blocks:{blocks:[led]}},
 detached:{blocks:{blocks:[hat(led),wait()]}},
 forever:{blocks:{blocks:[hat(cycle('asa_forever',led))]}},
 while:{blocks:{blocks:[hat(cycle('asa_while',led))]}},
 for:{blocks:{blocks:[hat(cycle('asa_for',led))]}},
 repeat:{blocks:{blocks:[hat(cycle('asa_repeat',led))]}},
 conditional:{blocks:{blocks:[hat(cycle('asa_if',wait()))]}},
 seconds:{blocks:{blocks:[hat(wait('SECONDS'))]}},
 milliseconds:{blocks:{blocks:[hat(wait())]}},
 microseconds:{blocks:{blocks:[hat(wait('MICROSECONDS'))]}},
 zero:{blocks:{blocks:[hat(wait('MILLISECONDS','0'))]}},
 playNote:{blocks:{blocks:[hat({type:'asa_play_note'})]}},
 tone:{blocks:{blocks:[hat({type:'asa_tone'})]}},
 ultrasonic:{blocks:{blocks:[hat({type:'asa_serial_print',inputs:{TEXT:{block:{type:'asa_ultrasonic'}}}})]}},
 empty:{blocks:{blocks:[]}},
};
window.oracles=()=>Object.entries(fixtures).map(([name,state])=>{
 const w=new S.Workspace();S.Events.disable();try{
  S.serialization.workspaces.load(A.migrateLegacyArduinoWorkspaceState(state),w);A.applyArduinoBlockDefaults(w);
  const saved=JSON.stringify(S.serialization.workspaces.save(w));
  const source=A.generateArduinoCode(w), xml=S.Xml.domToText(S.Xml.workspaceToDom(w));
  return {name,workspace:saved,xml,source,repeatedIdentical:A.generateArduinoCode(w)===source};
 }finally{w.dispose();S.Events.enable();}
});
let root; window.notices=[]; window.board=null;
window.inspect=()=>({undo:S.getMainWorkspace().getUndoStack().map(e=>({type:e.type,recordUndo:e.recordUndo,group:e.group})),redo:S.getMainWorkspace().getRedoStack().map(e=>({type:e.type,recordUndo:e.recordUndo,group:e.group})),source:A.generateArduinoCode(S.getMainWorkspace()),state:JSON.stringify(S.serialization.workspaces.save(S.getMainWorkspace())),blocks:S.getMainWorkspace().getAllBlocks(false).map(b=>({id:b.id,type:b.type}))});
window.mount=(workspace,source,properties)=>{
 window.persisted=[]; window.notices=[];
 const board={id:'old-uno',kind:'visual',componentTypeId:'arduino-uno',stateProperties:properties===null?{}:properties??{arduinoCodeMode:'blocks',arduinoWorkspace:workspace,arduinoSource:source}};
 window.board=board;window.otherBoard={...board,id:'other-uno',stateProperties:{...board.stateProperties,arduinoSource:'// Other saved board\\r\\n'+source}};const boards=[board,window.otherBoard]; const c={document:{components:boards},selection:null,simulationRunning:false,arduinoSerialByBoard:{},selectComponent:()=>{},updateArduinoProgram:(id,p)=>{window.persisted.push(p);const target=boards.find(b=>b.id===id);target.stateProperties={...target.stateProperties,...p}},setNotice:(n)=>window.notices.push(n),sendArduinoSerialRx:()=>{}};
 root=createRoot(document.getElementById('app'));root.render(<ArduinoCodePanel controller={c} open drawerWidth={700} onDrawerWidthChange={()=>{}} mobileHeightPercent={80} onMobileHeightChange={()=>{}} onClose={()=>{}}/>);
};
window.unmount=()=>root.unmount();`,
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
const output = resolve('reports/arduino-block-mount-completion-865/after');
await mkdir(output, { recursive: true });
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
    const oracles = await page.evaluate(() => window.oracles());
    assert(oracles.every((o) => o.repeatedIdentical));
    if (width === 1440)
      await writeFile(resolve(output, 'oracles.json'), JSON.stringify(oracles, null, 2) + '\n');
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
      const actual = await page.evaluate(() => ({
        persisted: window.persisted,
        board: window.board,
        notices: window.notices,
        liveBlockCount: window.Blockly?.getMainWorkspace?.()?.getAllBlocks(false).length,
      }));
      const last = actual.board.stateProperties;
      assert.equal(actual.persisted.length, 0);
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
      await page.screenshot({ path: resolve(output, name + '-' + width + '.png'), fullPage: true });
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
      assert.equal(await page.evaluate(() => window.persisted.length), 0);
      assert.equal(await page.evaluate(() => window.board.stateProperties.arduinoSource), source);
      assert.equal(
        await page.evaluate(() => window.board.stateProperties.arduinoWorkspace),
        workspace,
      );
      receipts.at(-1).modeSwitchExact = true;
      receipts.at(-1).reopenExact = true;
      await page.evaluate(() => window.unmount());
    }
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
    await page.screenshot({ path: resolve(output, 'pre-field-' + width + '.png') });
    await ledField.click();
    await page.screenshot({ path: resolve(output, 'dropdown-' + width + '.png') });
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
    await writeFile(
      resolve(output, 'undo-debug-' + width + '.json'),
      JSON.stringify({ edited, undone, redone }, null, 2),
    );
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
    await page.screenshot({
      path: resolve(output, 'edited-reopen-' + width + '.png'),
      fullPage: true,
    });
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
    await page.screenshot({
      path: resolve(output, 'new-default-' + width + '.png'),
      fullPage: true,
    });
    await page.evaluate(() => window.unmount());
    await page.close();
  }
  await writeFile(
    resolve(output, 'genuine-edit-receipts.json'),
    JSON.stringify(journeys, null, 2) + '\n',
  );
  await writeFile(
    resolve(output, 'legacy-mount-receipts.json'),
    JSON.stringify(receipts, null, 2) + '\n',
  );
  process.stdout.write(
    JSON.stringify({
      oracles: 16,
      mounts: receipts.length,
      sourceOverwrites: receipts.filter((r) => !r.sourceExact).length,
      workspaceOverwrites: receipts.filter((r) => !r.workspaceExact).length,
    }) + '\n',
  );
} finally {
  await browser.close();
}
