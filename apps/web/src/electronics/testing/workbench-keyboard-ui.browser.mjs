/* global window, process, console */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const before = process.argv.includes('--before');
const revision = '7d0d24e1b23154e51639c096406b4eaacb25b4da';
const hookPath = 'apps/web/src/electronics/use-electronics-workbench.ts';
const historical = (path) =>
  execFileSync('git', ['show', `${revision}:${path}`], { encoding: 'utf8' });
const hook = before ? historical(hookPath) : await readFile(hookPath, 'utf8');
const ast = ts.createSourceFile(hookPath, hook, ts.ScriptTarget.Latest, true);
const snippets = {};
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ['keyDown', 'keyUp'].includes(node.name?.text))
    snippets[node.name.text] = node.getText(ast);
  if (
    ts.isExpressionStatement(node) &&
    node.getText(ast).startsWith('shortcutActionsRef.current =')
  )
    snippets.actions = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(snippets.actions);
const consumer = before
  ? `${snippets.keyDown}\n${snippets.keyUp}\nwindow.addEventListener('keydown',keyDown);window.addEventListener('keyup',keyUp);const cleanup=()=>{window.removeEventListener('keydown',keyDown);window.removeEventListener('keyup',keyUp)};`
  : 'const cleanup=bindWorkbenchShortcuts(shortcutActionsRef,spacePressedRef);';
const bundle = await build({
  stdin: {
    resolveDir: resolve('apps/web/src/electronics'),
    loader: 'ts',
    contents: `
import {${before ? 'resolveWorkbenchShortcut,isEditableShortcutTarget,targetConsumesSpace' : 'bindWorkbenchShortcuts'}} from './workbench-shortcuts';
const counts={};const state={angle:0,mirror:false,running:false,x:0,y:0};let busy=false;
const count=n=>{counts[n]=(counts[n]||0)+1;document.querySelector('output').textContent=JSON.stringify({state,counts})};
const undo=()=>count('undo'),redo=()=>count('redo'),copySelected=()=>count('copy'),pasteCopied=()=>count('paste'),duplicateSelected=()=>count('duplicate'),removeSelection=()=>count('delete');
let rotateSelected=()=>{state.angle+=45;count('rotate')};
const mirrorSelected=axis=>{if(axis!=='horizontal')throw Error('wrong axis');state.mirror=!state.mirror;count('mirror')};
const toggleSimulationWithAudio=()=>{state.running=!state.running;count('simulate')};
const getCurrentDocument=()=>({components:[{id:'led'}]}),setSelection=value=>count(value?'select-all':'escape');
const nudgeSelection=(x,y)=>{state.x+=x;state.y+=y;count('nudge')};
const cancelInteraction=()=>{},setCatalogPlacementState=()=>{},setPendingTerminal=()=>{},setWireDraftVertices=()=>{},setWirePreviewEnd=()=>{},setReconnectEndpoint=()=>{},setNotice=()=>{};
const shortcutActionsRef={current:null},spacePressedRef={current:false};
const KEYBOARD_NUDGE_STEP=5,KEYBOARD_NUDGE_LARGE_STEP=20;
const refresh=()=>{${snippets.actions}};refresh();${consumer}
window.fixture={counts,state,space:()=>spacePressedRef.current,busy:value=>{busy=value;refresh()},fresh:()=>{rotateSelected=()=>count('fresh');refresh()},cleanup};
document.querySelector('#native').onclick=()=>count('native');
`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  plugins: before
    ? [
        {
          name: 'baseline-shortcuts',
          setup(builder) {
            builder.onLoad({ filter: /workbench-shortcuts\.ts$/ }, () => ({
              contents: historical('apps/web/src/electronics/workbench-shortcuts.ts'),
              loader: 'ts',
            }));
          },
        },
      ]
    : [],
});
const output = resolve(
  process.argv.find((argument) => argument.startsWith('--output='))?.slice(9) ||
    'test-results/workbench-keyboard-ui',
  before ? 'before' : 'after',
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const receipts = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 750 } });
    await page.route('**/*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif;margin:20px}#canvas{height:240px;background:#eff6fc;border:1px solid #668;outline-offset:3px}input,textarea,button,select{display:block;margin:8px;max-width:90%}output{display:block;overflow-wrap:anywhere}</style><h1>Клавиши электроники</h1><div id="canvas" tabindex="0">R — поворот · M — отражение · Ctrl/⌘+Enter — пуск/стоп<output></output></div><button id="native">Обычная кнопка</button><input id="input"><textarea class="arduino-source-editor"></textarea><div class="monaco-editor"><span tabindex="0">Код</span></div><div contenteditable="true">Текст</div><select><option>Значение</option></select><script>${bundle.outputFiles[0].text}</script>`,
      }),
    );
    await page.goto('https://keyboard-fixture.invalid/');
    const canvas = page.locator('#canvas');
    await canvas.focus();
    await page.keyboard.press('r');
    await page.keyboard.press('m');
    await page.keyboard.press('Control+Enter');
    assert.deepEqual(await page.evaluate(() => window.fixture.state), {
      angle: 45,
      mirror: !before,
      running: !before,
      x: 0,
      y: 0,
    });
    await page.keyboard.press('Meta+Enter');
    assert.equal(await page.evaluate(() => window.fixture.state.running), false);
    const cdp = await page.context().newCDPSession(page);
    for (const [code, key] of [
      ['KeyR', 'к'],
      ['KeyM', 'ь'],
    ]) {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        code,
        key,
        windowsVirtualKeyCode: code === 'KeyR' ? 82 : 77,
      });
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        code,
        key,
        windowsVirtualKeyCode: code === 'KeyR' ? 82 : 77,
      });
    }
    assert.equal(await page.evaluate(() => window.fixture.state.angle), 90);
    assert.equal(await page.evaluate(() => window.fixture.state.mirror), false);
    await page.keyboard.down('m');
    await page.keyboard.down('m');
    await page.keyboard.up('m');
    assert.equal(await page.evaluate(() => window.fixture.counts.mirror || 0), before ? 0 : 3);
    await page.keyboard.down('Control');
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await page.keyboard.up('Control');
    assert.equal(await page.evaluate(() => window.fixture.counts.simulate || 0), before ? 0 : 3);
    if (!before) {
      await page.evaluate(() => window.fixture.busy(true));
      await page.keyboard.press('Control+Enter');
      assert.equal(await page.evaluate(() => window.fixture.counts.simulate), 3);
      await page.evaluate(() => window.fixture.busy(false));
      const prior = await page.evaluate(() => JSON.stringify(window.fixture.counts));
      await canvas.dispatchEvent('keydown', { code: 'KeyM', key: 'm', isComposing: true });
      assert.equal(await page.evaluate(() => JSON.stringify(window.fixture.counts)), prior);
    }
    const protectedCounts = await page.evaluate(() => JSON.stringify(window.fixture.counts));
    for (const selector of [
      'input',
      'textarea',
      '.monaco-editor span',
      '[contenteditable]',
      'select',
    ]) {
      await page.locator(selector).focus();
      await page.keyboard.press('r');
      await page.keyboard.press('m');
      await page.keyboard.press('Control+Enter');
    }
    assert.equal(await page.evaluate(() => JSON.stringify(window.fixture.counts)), protectedCounts);
    await page.locator('#native').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => window.fixture.counts.native || 0), before ? 0 : 1);
    await canvas.focus();
    await page.keyboard.down('Space');
    assert.equal(await page.evaluate(() => window.fixture.space()), true);
    await page.keyboard.up('Space');
    assert.equal(await page.evaluate(() => window.fixture.space()), false);
    for (const key of [
      'Control+z',
      'Control+Shift+z',
      'Control+y',
      'Control+c',
      'Control+v',
      'Control+d',
      'Control+a',
      'Delete',
      'Backspace',
      'ArrowUp',
      'Shift+ArrowRight',
      'Escape',
    ])
      await page.keyboard.press(key);
    const result = await page.evaluate(() => ({
      counts: window.fixture.counts,
      state: window.fixture.state,
    }));
    for (const [key, value] of Object.entries({
      undo: 1,
      redo: 2,
      copy: 1,
      paste: 1,
      duplicate: 1,
      'select-all': 1,
      delete: 2,
      nudge: 2,
      escape: 1,
    }))
      assert.equal(result.counts[key], value, key);
    assert.equal(result.state.x, 20);
    assert.equal(result.state.y, -5);
    await page.evaluate(() => window.fixture.fresh());
    await page.keyboard.press('r');
    assert.equal(await page.evaluate(() => window.fixture.counts.fresh), 1);
    await page.screenshot({ path: resolve(output, `${width}.png`) });
    await page.evaluate(() => window.fixture.cleanup());
    const finalCounts = await page.evaluate(() => JSON.stringify(window.fixture.counts));
    await page.keyboard.press('r');
    await page.keyboard.press('m');
    await page.keyboard.press('Control+Enter');
    assert.equal(await page.evaluate(() => JSON.stringify(window.fixture.counts)), finalCounts);
    receipts.push({
      width,
      phase: before ? 'before' : 'after',
      ...result,
      productionConsumer: true,
      callbackPorts: 'supporting fixtures, not full app/physics/persistence',
    });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(resolve(output, 'receipts.json'), JSON.stringify(receipts, null, 2));
console.log(`${before ? 'BEFORE' : 'AFTER'} native keyboard ${receipts.length} viewports PASS`);
