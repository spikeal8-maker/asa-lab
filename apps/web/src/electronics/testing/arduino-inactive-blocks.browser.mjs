// Actual React ScratchWorkspace + native Blockly. In-memory fixture, no server/DB.
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
      import * as S from 'scratch-blocks'; import * as A from './src/electronics/arduino-blocks';
      import {activeArduinoGraph} from './src/electronics/arduino-pin-inputs';
      import {ScratchWorkspace} from './src/electronics/ArduinoCodePanel';
      const legacy = {variables:[{id:'pupil-variable',name:'pupilCount',type:S.SCALAR_VARIABLE_TYPE}],blocks:{blocks:[
        {type:'asa_setup',id:'setup',x:330,y:20},
        {type:'asa_loop',id:'loop',x:330,y:130,inputs:{DO:{block:{
          type:'asa_repeat',id:'repeat',fields:{COUNT:'3'},
          inputs:{DO:{block:{type:'asa_serial_print',id:'print',fields:{TEXT:'hello',ENDING:'LINE'}}}},
          next:{block:{type:'asa_wait',id:'wait',fields:{TIME:'1',UNIT:'SECONDS'}}}
        }}}},
        {type:'asa_lcd_i2c_setup',id:'detached-lcd',x:1000,y:600},
        {type:'asa_var_get',id:'detached-variable',fields:{NAME:{id:'pupil-variable'}},x:1000,y:800}
      ]}};
      let stored=JSON.stringify(legacy), root;
      window.fixture={S,A,activeArduinoGraph,legacy,mount:()=>{
        root=createRoot(document.getElementById('app'));
        function Demo(){const [mode,setMode]=React.useState('blocks');return <>
          <button id="mode" onClick={()=>setMode(mode==='blocks'?'text':'blocks')}>mode</button>
          <button id="undo" onClick={()=>S.common.getMainWorkspace().undo(false)}>Undo</button>
          <button id="redo" onClick={()=>S.common.getMainWorkspace().undo(true)}>Redo</button>
          {mode==='blocks'?<div className="arduino-block-editor" style={{height:650,'--arduino-flyout-width':'100px'}}>
            <ScratchWorkspace initialWorkspace={stored} category="control" flyoutWidth={100} paletteScale={0.45}
              onChange={(state,source)=>{stored=state;window.latest={state,source};window.publishes=(window.publishes||0)+1}}/>
          </div>:<textarea aria-label="source" readOnly value={window.latest?.source}/>}
        </>};root.render(<Demo/>);
      },reopen:()=>{root.unmount();window.fixture.mount()}};`,
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
          return { contents: 'export default ' + JSON.stringify(url) };
        });
      },
    },
  ],
});
const output = resolve('test-results/arduino-inactive-blocks');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const receipts = [];
let activePage;
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    activePage = page;
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const asset = assets.get(route.request().url());
      if (asset) await route.fulfill(asset);
      else await route.abort();
    });
    await page.setContent(
      '<meta name="viewport" content="width=device-width,initial-scale=1"><base href="https://asa-fixture.invalid/"><style>body{margin:0}#app{height:720px}</style><div id="app"></div>',
    );
    await page.addStyleTag({
      content: await readFile('apps/web/src/electronics/workbench.css', 'utf8'),
    });
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.evaluate(() => window.fixture.mount());
    await page.waitForFunction(() => window.latest);
    await page.waitForTimeout(250);
    await page.evaluate((width) => {
      const w = window.fixture.S.common.getMainWorkspace();
      w.setScale(width < 400 ? 0.45 : 0.75);
      window.fixture.S.svgResize(w);
      w.scroll(120 - 330 * w.scale, 35 - 20 * w.scale);
    }, width);
    const initial = await page.evaluate(() => {
      const { S } = window.fixture,
        w = S.common.getMainWorkspace();
      w.clearUndo();
      return {
        state: JSON.parse(window.latest.state),
        source: window.latest.source,
        ids: w
          .getAllBlocks(false)
          .map((b) => b.id)
          .sort(),
        undo: w.getUndoStack().length,
        publishes: window.publishes,
        orphan: w.getBlockById('detached-lcd').getSvgRoot().style.opacity,
      };
    });
    assert.equal(initial.orphan, '0.45');
    assert.equal(initial.undo, 0);
    assert.ok(!initial.source.includes('LiquidCrystal'));
    for (const id of [
      'setup',
      'loop',
      'repeat',
      'print',
      'wait',
      'detached-lcd',
      'detached-variable',
    ])
      assert.ok(initial.ids.includes(id));
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(() => window.publishes),
      initial.publishes,
      'presentation must not publish',
    );
    await page.evaluate(() => {
      const { S } = window.fixture,
        w = S.common.getMainWorkspace();
      S.Events.setGroup('detach-program');
      w.getBlockById('repeat').unplug(false);
      S.Events.setGroup(false);
    });
    await page.waitForFunction(() => !window.latest.source.includes('Serial.begin'));
    const detached = await page.evaluate(() => {
      const { S } = window.fixture,
        w = S.common.getMainWorkspace(),
        b = w.getBlockById('repeat');
      return {
        source: window.latest.source,
        root: b.getSvgRoot().style.opacity,
        child: w.getBlockById('print').getSvgRoot().style.opacity,
        state: JSON.parse(window.latest.state),
        ids: w
          .getAllBlocks(false)
          .map((b) => b.id)
          .sort(),
        undo: w.getUndoStack().length,
      };
    });
    assert.equal(detached.root, '0.45');
    assert.equal(detached.child, '');
    assert.deepEqual(detached.ids, initial.ids);
    assert.equal(detached.undo, 1);
    assert.ok(!JSON.stringify(detached.state).includes('disabled'));
    await page.screenshot({ path: resolve(output, `${width}-detached.png`) });
    await page.click('#undo');
    await page.waitForFunction((source) => window.latest.source === source, initial.source);
    assert.equal(
      await page.evaluate(
        () =>
          window.fixture.S.common.getMainWorkspace().getBlockById('repeat').getSvgRoot().style
            .opacity,
      ),
      '',
    );
    await page.click('#redo');
    await page.waitForFunction((source) => window.latest.source === source, detached.source);
    await page.evaluate(() => {
      const w = window.fixture.S.common.getMainWorkspace();
      w.getBlockById('loop')
        .getInput('DO')
        .connection.connect(w.getBlockById('repeat').previousConnection);
    });
    await page.waitForFunction((source) => window.latest.source === source, initial.source);
    await page.screenshot({ path: resolve(output, `${width}-reconnected.png`) });
    const saved = await page.evaluate(() => JSON.parse(window.latest.state));
    await page.click('#mode');
    await page.waitForSelector('textarea');
    await page.click('#mode');
    await page.waitForSelector('.blocklyMainBackground');
    await page.waitForTimeout(250);
    assert.deepEqual(await page.evaluate(() => JSON.parse(window.latest.state)), saved);
    assert.equal(await page.evaluate(() => window.latest.source), initial.source);
    await page.evaluate(() => window.fixture.reopen());
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => JSON.parse(window.latest.state)), saved);
    // Remove both roots, retaining their pupil chains: rootless fallback becomes active.
    await page.evaluate(() => {
      const { S } = window.fixture,
        w = S.common.getMainWorkspace();
      w.getBlockById('repeat').unplug(false);
      w.getBlockById('setup').dispose(false);
      w.getBlockById('loop').dispose(false);
    });
    await page.waitForFunction(() => window.latest.source.includes('LiquidCrystal_I2C'));
    assert.equal(
      await page.evaluate(
        () =>
          window.fixture.S.common.getMainWorkspace().getBlockById('repeat').getSvgRoot().style
            .opacity,
      ),
      '',
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.fixture.S.common.getMainWorkspace().getBlockById('detached-variable').getSvgRoot()
            .style.opacity,
      ),
      '0.45',
    );
    assert.deepEqual(errors, []);
    receipts.push({
      width,
      initial,
      detached,
      saved,
      reopen: 'exact serialized state',
      rootless: 'statement trees active; orphan reporter dim',
      errors,
    });
    await page.close();
  }
  await writeFile(resolve(output, 'receipts.json'), JSON.stringify(receipts, null, 2));
  console.log(
    'PASS actual ScratchWorkspace 1440/390/320 detach/dim/reconnect Undo/Redo mode/reopen/rootless; fixture only, no server SaveCAS',
  );
} catch (error) {
  console.log(
    await activePage.evaluate(() => ({
      latest: window.latest,
      undo: window.fixture.S.common
        .getMainWorkspace()
        .getUndoStack()
        .map((e) => e.toJson()),
      redo: window.fixture.S.common
        .getMainWorkspace()
        .getRedoStack()
        .map((e) => e.toJson()),
    })),
  );
  throw error;
} finally {
  await browser.close();
}
