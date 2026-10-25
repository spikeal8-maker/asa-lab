// Actual ArduinoCodePanel in Chromium; in-memory controller, no server or DB.
/* global window, console */
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
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ArduinoCodePanel} from './src/electronics/ArduinoCodePanel';
      const source = '// legacy pupil source\\nvoid setup(){}\\nvoid loop(){\\n' + '// retained line\\n'.repeat(65) + '  /* 😀 */ digitalWrite(13);\\n}';
      const board = {id:'uno',kind:'visual',componentTypeId:'arduino-uno',variantId:'arduino-uno',name:'Uno',position:{x:0,y:0},value:5,stateProperties:{arduinoCodeMode:'text',arduinoSource:source,arduinoWorkspace:'{"blocks":{"blocks":[{"type":"asa_loop","id":"old-loop"}]}}',ownerField:'unchanged'}};
      window.fixture={source,board,original:JSON.stringify(board),mount:()=>{
        const controller={document:{components:[board]},selection:null,simulationRunning:false,arduinoSerialByBoard:{},updateArduinoProgram:(_id,p)=>{window.persisted=p},setNotice:()=>{},sendArduinoSerialRx:()=>{}};
        createRoot(document.getElementById('app')).render(<ArduinoCodePanel controller={controller} open={true} drawerWidth={700} onDrawerWidthChange={()=>{}} mobileHeightPercent={80} onMobileHeightChange={()=>{}} onClose={()=>{}}/>);
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
      name: 'local-assets',
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
          return { contents: 'export default ' + JSON.stringify(url) };
        });
      },
    },
  ],
});
const output = resolve('test-results/arduino-diagnostic-positions');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const receipts = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    await page.route('**/*', async (route) => {
      if (route.request().url() === 'https://asa-fixture.invalid/') {
        await route.fulfill({
          contentType: 'text/html',
          body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>',
        });
        return;
      }
      const asset = assets.get(route.request().url());
      if (asset) await route.fulfill(asset);
      else await route.abort();
    });
    await page.goto('https://asa-fixture.invalid/');
    await page.addStyleTag({
      content:
        (await readFile('apps/web/src/electronics/workbench.css', 'utf8')) +
        '\n.arduino-code-panel{position:fixed;inset:0;width:100%;height:100%}.arduino-source-editor{min-height:0;max-height:500px}',
    });
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.evaluate(() => window.fixture.mount());
    const editor = page.getByRole('textbox', { name: 'Код Arduino C++', exact: true });
    await editor.waitFor();
    const reveal = async (expected) => {
      await page
        .locator('.arduino-code-check-messages button')
        .filter({ hasText: 'Неверное число аргументов' })
        .click();
      const actual = await editor.evaluate((el) => ({
        start: el.selectionStart,
        end: el.selectionEnd,
        slice: el.value.slice(el.selectionStart, el.selectionEnd),
        scroll: el.scrollTop,
      }));
      const slice = 'digitalWrite(13)',
        start = expected.indexOf(slice);
      assert.deepEqual(
        { start: actual.start, end: actual.end, slice: actual.slice },
        { start, end: start + slice.length, slice },
      );
      assert.ok(actual.scroll > 0, 'diagnostic scrolls actual editor');
      return actual;
    };
    const original = await editor.inputValue();
    const initial = await reveal(original);
    const edited = '// extra 😀 line\n' + original;
    await editor.fill(edited);
    const afterEdit = await reveal(edited);
    assert.equal(afterEdit.start - initial.start, '// extra 😀 line\n'.length);
    await page.locator('.arduino-mode-menu summary').click();
    await page.getByRole('button', { name: 'Блоки с текстом', exact: true }).click();
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await page.getByRole('textbox', { name: 'Сгенерированный код Arduino', exact: true }).waitFor();
    await page.locator('.arduino-mode-menu summary').click();
    await page.getByRole('button', { name: 'Текст', exact: true }).click();
    await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await editor.waitFor();
    await editor.fill(edited);
    const afterMode = await reveal(edited);
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.fixture.board) === window.fixture.original),
      true,
      'legacy input object untouched',
    );
    assert.equal(await page.evaluate(() => window.persisted.arduinoSource), edited);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(output, `diagnostic-${width}.png`) });
    receipts.push({
      width,
      initial,
      afterEdit,
      afterMode,
      legacy: 'unchanged fixture input',
      errors,
    });
    await page.close();
  }
  await writeFile(resolve(output, 'receipts.json'), JSON.stringify(receipts, null, 2));
  console.log(
    'PASS actual ArduinoCodePanel 1440/390 diagnostic selection/scroll after edits/mode switches; in-memory fixture only',
  );
} finally {
  await browser.close();
}
