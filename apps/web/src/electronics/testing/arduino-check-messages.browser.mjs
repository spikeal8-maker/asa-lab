// Real production panel in Chromium; intercepted fixture origin, no listening server.
/* global window, process, console */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const phase = process.argv[2];
assert.ok(['before', 'after'].includes(phase), 'choose before or after');
const output = resolve('docs/product/electronics/evidence/arduino-check-863', phase);
await mkdir(output, { recursive: true });
const cases = {
  supported: 'void setup(){pinMode(13,OUTPUT);}\nvoid loop(){digitalWrite(13,HIGH);delay(100);}',
  loops: 'void loop(){for(int i=0;i<3;i++){digitalWrite(13,HIGH);}while(false){delay(1);}}',
  servo:
    '#include <Servo.h>\nServo arm;\nvoid setup(){arm.attach(9);}\nvoid loop(){arm.write(90);int angle=arm.read();arm.detach();}',
  tonePwm: 'void loop(){analogWrite(9,128);tone(8,440,100);delay(100);noTone(8);}',
  serial:
    'void setup(){Serial.begin(9600);}\nvoid loop(){Serial.println("<img onerror=alert(1)>😀");int n=Serial.available();int b=Serial.read();delay(100);}',
  timeIncrement:
    'int count=0;\nvoid loop(){unsigned long a=millis();unsigned long b=micros();count++;--count;}',
  unsupported:
    '// 😀 source coordinates\nvoid setup(){}\nvoid loop(){\n  shiftOut(2,3,1,42);\n  mystery(1);\n}',
  syntax: '// 😀 source coordinates\nvoid setup(){}\nvoid loop(){\n  /* 😀 */ digitalWrite(13);\n}',
};
const assets = new Map();
const result = await build({
  stdin: {
    resolveDir: resolve('apps/web'),
    loader: 'tsx',
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {ArduinoCodePanel} from './src/electronics/ArduinoCodePanel';
      import {analyseArduinoSourceSupport,arduinoSourceHasUnsupportedFeatures,ARDUINO_BLOCK_SUPPORT,ARDUINO_TEXT_COMMAND_SUPPORT,ARDUINO_LANGUAGE_FEATURE_SUPPORT} from '../../contexts/electronics/domain/arduino-capabilities';
      import {analyseArduinoProgramSyntax,advanceClockedArduinoRuntime} from '../../contexts/electronics/domain/arduino-program-runtime';
      window.inspectSource=(source)=>({source,diagnostics:analyseArduinoSourceSupport(source),syntax:analyseArduinoProgramSyntax(source),blocked:arduinoSourceHasUnsupportedFeatures(source),runtime:advanceClockedArduinoRuntime(source,{},1)});
      window.registries={blocks:ARDUINO_BLOCK_SUPPORT,commands:ARDUINO_TEXT_COMMAND_SUPPORT,language:ARDUINO_LANGUAGE_FEATURE_SUPPORT};
      window.mount=(source)=>{const board={id:'uno',kind:'visual',componentTypeId:'arduino-uno',variantId:'arduino-uno',name:'Uno',position:{x:0,y:0},value:5,stateProperties:{arduinoCodeMode:'text',arduinoSource:source,ownerField:'unchanged'}};
        window.board=board;window.original=JSON.stringify(board);window.notices=[];
        const controller={document:{components:[board]},selection:null,simulationRunning:false,arduinoSerialByBoard:{},updateArduinoProgram:(_id,p)=>{window.persisted=p},setNotice:(text)=>window.notices.push(text),sendArduinoSerialRx:()=>{}};
        createRoot(document.getElementById('app')).render(<ArduinoCodePanel controller={controller} open={true} drawerWidth={700} onDrawerWidthChange={()=>{}} mobileHeightPercent={80} onMobileHeightChange={()=>{}} onClose={()=>{}}/>);};`,
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
      name: 'assets',
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
const browser = await chromium.launch({ headless: true });
const receipts = [];
let structures;
try {
  for (const width of [1440, 390])
    for (const [name, source] of Object.entries(cases)) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        acceptDownloads: true,
      });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/*', async (route) => {
        if (route.request().url() === 'https://asa-fixture.invalid/')
          return route.fulfill({
            contentType: 'text/html',
            body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app" class="workbench-shell code-open" style="position:fixed;inset:0;--arduino-code-panel-width:700px;--wb-code-height:80%"></div>',
          });
        const asset = assets.get(route.request().url());
        if (asset) await route.fulfill(asset);
        else await route.abort();
      });
      await page.goto('https://asa-fixture.invalid/');
      await page.addStyleTag({
        content: await readFile('apps/web/src/electronics/workbench.css', 'utf8'),
      });
      await page.addScriptTag({ content: result.outputFiles[0].text });
      structures ??= await page.evaluate(
        (cases) => ({
          cases: Object.fromEntries(
            Object.entries(cases).map(([key, value]) => [key, window.inspectSource(value)]),
          ),
          registries: window.registries,
        }),
        cases,
      );
      await page.evaluate((source) => window.mount(source), source);
      const editor = page.getByRole('textbox', { name: 'Код Arduino C++', exact: true });
      await editor.waitFor();
      await page.locator('.arduino-check-button').click();
      const header = page.locator('.arduino-code-check-title');
      assert.equal(await header.getAttribute('aria-expanded'), 'true');
      const selections = [];
      const diagnostics = structures.cases[name].diagnostics;
      for (let i = 0; i < diagnostics.length; i++) {
        await page.locator('.arduino-code-check-messages button').nth(i).click();
        const selection = await editor.evaluate((el) => ({
          start: el.selectionStart,
          length: el.selectionEnd - el.selectionStart,
        }));
        assert.deepEqual(selection, { start: diagnostics[i].start, length: diagnostics[i].length });
        selections.push(selection);
      }
      const expanded = await page.locator('.arduino-code-check').innerText();
      await header.click();
      assert.equal(await header.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('.arduino-code-check-body').count(), 0);
      await header.click();
      assert.equal(await editor.inputValue(), source);
      const box = await page.locator('.arduino-code-panel').boundingBox();
      assert.ok(box.x >= -1 && box.x + box.width <= width + 1, 'panel fits viewport');
      assert.equal(
        await page.locator('.arduino-code-check-messages img').count(),
        0,
        'messages are literal text',
      );
      const originalUntouched = await page.evaluate(
        () => JSON.stringify(window.board) === window.original,
      );
      assert.equal(originalUntouched, true);
      const edited = '// edited 😀\n' + source;
      await editor.fill(edited);
      assert.equal(await page.evaluate(() => window.persisted.arduinoSource), edited);
      await editor.fill(source);
      const downloadPromise = page.waitForEvent('download');
      await page.locator('.arduino-download-button').click();
      const download = await downloadPromise;
      const downloadPath = await download.path();
      assert.equal(
        await readFile(downloadPath, 'utf8'),
        source,
        'actual .ino download preserves source',
      );
      await page.screenshot({ path: resolve(output, `${name}-${width}.png`) });
      const notice = await page.evaluate(() => window.notices.at(-1));
      if (phase === 'after') {
        const blockers = diagnostics.filter((item) => item.status === 'unsupported').length;
        const notes = diagnostics.length - blockers;
        assert.ok(expanded.includes(`Блокирующих: ${blockers}`));
        assert.ok(expanded.includes(`Примечаний: ${notes}`));
        assert.ok(!/упрощённо|ограничениями модели|Ограничений:/.test(expanded + notice));
        if (blockers) {
          if (width === 1440) assert.ok(expanded.includes('Моделирование заблокировано'));
          assert.ok(expanded.includes('перед запуском'));
          assert.ok(notice.includes(`блокирующих ошибок — ${blockers}`));
          assert.ok(structures.cases[name].runtime.diagnostics.length > 0);
        } else {
          assert.deepEqual(structures.cases[name].runtime.diagnostics, []);
          assert.ok(
            notes
              ? notice.includes('можно запускать')
              : notice.includes('ошибок для симулятора не найдено'),
          );
          if (notes) assert.ok(expanded.includes('не блокируют запуск'));
        }
        assert.equal(
          await page.locator('.arduino-code-check-messages button').count(),
          diagnostics.length,
        );
      }
      let generated = null;
      if (name === 'supported') {
        await page.locator('.arduino-mode-menu summary').click();
        await page.getByRole('button', { name: 'Блоки с текстом', exact: true }).click();
        await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
        generated = await page
          .getByRole('textbox', { name: 'Сгенерированный код Arduino', exact: true })
          .inputValue();
      }
      await page.reload();
      await page.addStyleTag({
        content: await readFile('apps/web/src/electronics/workbench.css', 'utf8'),
      });
      await page.addScriptTag({ content: result.outputFiles[0].text });
      await page.evaluate((source) => window.mount(source), source);
      assert.equal(
        await page.getByRole('textbox', { name: 'Код Arduino C++', exact: true }).inputValue(),
        source,
        'fixture reopen preserves saved source',
      );
      receipts.push({
        width,
        name,
        expanded,
        notice,
        selections,
        sourcePreserved: true,
        download: source,
        generated,
        reopened: source,
        originalUntouched,
        panel: box,
        errors,
      });
      assert.deepEqual(errors, []);
      await page.close();
    }
  await writeFile(resolve(output, 'structures.json'), JSON.stringify(structures, null, 2) + '\n');
  await writeFile(resolve(output, 'native.json'), JSON.stringify(receipts, null, 2) + '\n');
  if (phase === 'after') {
    const before = JSON.parse(await readFile(resolve(output, '../before/structures.json'), 'utf8'));
    const strip = (value) =>
      Array.isArray(value)
        ? value.map(strip)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => !['message', 'summary'].includes(key))
                .map(([key, value]) => [key, strip(value)]),
            )
          : value;
    assert.equal(
      JSON.stringify(strip(structures)),
      JSON.stringify(strip(before)),
      'all non-message fields byte-equal',
    );
    const beforeNative = JSON.parse(
      await readFile(resolve(output, '../before/native.json'), 'utf8'),
    );
    const immutableNative = (rows) =>
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).filter(([key]) => !['expanded', 'notice', 'panel'].includes(key)),
        ),
      );
    assert.deepEqual(
      immutableNative(receipts),
      immutableNative(beforeNative),
      'source, downloads, generated C++, selection and reopen unchanged',
    );
    const changes = [];
    function compare(a, b, path = '') {
      if (typeof a === 'string' && a !== b) changes.push({ path, before: a, after: b });
      else if (a && typeof a === 'object')
        for (const key of Object.keys(a)) compare(a[key], b[key], path + '/' + key);
    }
    compare(before, structures);
    await writeFile(
      resolve(output, 'message-deltas.json'),
      JSON.stringify(changes, null, 2) + '\n',
    );
  }
  console.log(
    `PASS ${phase}: 8 real diagnostic cases × 1440/390; check/collapse/source navigation/edit/preservation, no server`,
  );
} finally {
  await browser.close();
}
