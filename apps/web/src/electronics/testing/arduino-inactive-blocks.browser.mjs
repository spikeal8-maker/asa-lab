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
const worker = await build({
  entryPoints: ['apps/web/src/electronics/simulation.worker.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  alias: {
    '@asa-lab/electronics': resolve('contexts/electronics/index.ts'),
    '@asa-lab/electronics/engine': resolve('contexts/electronics/engine.ts'),
    '@asa-lab/electronics/simulation': resolve('contexts/electronics/simulation.ts'),
  },
});
const result = await build({
  stdin: {
    resolveDir: resolve('apps/web'),
    loader: 'tsx',
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import * as S from 'scratch-blocks'; import * as A from './src/electronics/arduino-blocks';
      import {activeArduinoGraph} from './src/electronics/arduino-pin-inputs';
      import {ScratchWorkspace} from './src/electronics/ArduinoCodePanel';
      import {ElectronicsSimulationWorkerClient} from './src/electronics/simulation-worker-client';
      import {resetElectronicsTimedState} from '@asa-lab/electronics/engine';
      window.rootlessProof=async()=>{
        const w=new S.Workspace(); S.Events.disable();
        const v={id:'rootless-count',name:'count',type:S.SCALAR_VARIABLE_TYPE};
        const wait={type:'asa_wait',fields:{TIME:'1',UNIT:'MILLISECONDS'}};
        const print={type:'asa_serial_print',fields:{ENDING:'LINE'},inputs:{TEXT:{block:{type:'asa_var_get',fields:{NAME:{id:v.id}}}}},next:{block:wait}};
        const change={type:'asa_var_change',fields:{NAME:{id:v.id},VALUE:'1'},next:{block:print}};
        try {
          S.serialization.workspaces.load(A.migrateLegacyArduinoWorkspaceState({variables:[v],blocks:{blocks:[
            {type:'asa_repeat',id:'first-free-chain',fields:{COUNT:'2'},inputs:{DO:{block:change}}},
            {type:'asa_builtin_led',id:'second-free-chain',fields:{LEVEL:'LOW'},next:{block:{type:'asa_serial_print',fields:{TEXT:'tail',ENDING:'LINE'},next:{block:wait}}}}
          ]}}),w);
          A.applyArduinoBlockDefaults(w);
          const high=w.newBlock('asa_builtin_led');A.applyArduinoBlockDefaults(w);
          const repeat=w.getBlockById('first-free-chain');
          const changeBlock=repeat.getInputTargetBlock('DO');changeBlock.unplug(false);
          repeat.getInput('DO').connection.connect(high.previousConnection);
          high.nextConnection.connect(changeBlock.previousConnection);
          const source=A.generateArduinoCode(w);
          const saved=S.serialization.workspaces.save(w), ids=w.getAllBlocks(false).map(b=>b.id).sort();
          w.clear();S.serialization.workspaces.load(saved,w);
          const reopened=A.generateArduinoCode(w);
          const reopenedIds=w.getAllBlocks(false).map(b=>b.id).sort();
          const document={schemaVersion:4,components:[{id:'uno',kind:'visual',componentTypeId:'arduino-uno',pinIds:['d13','power-5v','power-3v3','power-gnd-1'],position:{x:0,y:0},value:5,stateProperties:{arduinoSource:source}}],connections:[],viewport:{x:0,y:0,zoom:1},simulation:{running:true,maxIterations:24}};
          const client=new ElectronicsSimulationWorkerClient(()=>new Worker('/worker.js',{type:'module'}));
          try {
            const generation=client.beginGeneration('rootless-proof'); let state=resetElectronicsTimedState(); const steps=[];
            for(const horizon of [1500,2500,4500,5500]){
              const advance=await client.advance(generation,document,state,horizon);state=advance.state;
              steps.push({horizon,status:advance.executionStatus,diagnostics:advance.diagnostics,runtime:JSON.parse(state.continuation.serializedState).boards[0].runtime});
            }
            return {source,reopened,ids,reopenedIds,steps};
          }finally{client.dispose();}
        }finally{w.dispose();S.Events.enable();}
      };
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
  alias: {
    '@asa-lab/electronics': resolve('contexts/electronics/index.ts'),
    '@asa-lab/electronics/engine': resolve('contexts/electronics/engine.ts'),
  },
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
    const page = await browser.newPage({ viewport: { width, height: 900 }, hasTouch: true });
    const cdp = await page.context().newCDPSession(page);
    activePage = page;
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const html =
      '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#app{height:720px}</style><div id="app"></div>';
    await page.route('**/*', async (route) => {
      if (route.request().isNavigationRequest())
        return route.fulfill({ contentType: 'text/html', body: html });
      if (route.request().url().endsWith('/worker.js'))
        return route.fulfill({ contentType: 'text/javascript', body: worker.outputFiles[0].text });
      const asset = assets.get(route.request().url());
      if (asset) await route.fulfill(asset);
      else await route.abort();
    });
    await page.goto('https://asa-fixture.invalid/');
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
    // Pointer input goes through the real Blockly gesture/drag pipeline.
    const drag = async (id, dx, dy, touch = false) => {
      const point = await page.evaluate((id) => {
        const b = window.fixture.S.common.getMainWorkspace().getBlockById(id);
        const r = b.getSvgRoot().querySelector('.blocklyPath').getBoundingClientRect();
        return {
          x: r.x + Math.min(25, r.width / 2),
          y: r.y + 10,
          fill: b.getSvgRoot().querySelector('.blocklyPath').getAttribute('fill'),
        };
      }, id);
      if (touch) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: point.x, y: point.y }],
        });
        for (let step = 1; step <= 12; step++) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: point.x + (dx * step) / 12, y: point.y + (dy * step) / 12 }],
          });
        }
      } else {
        await page.mouse.move(point.x, point.y);
        await page.mouse.down();
        await page.mouse.move(point.x + dx, point.y + dy, { steps: 12 });
      }
      await page.waitForTimeout(250);
      const during = await page.evaluate((id) => {
        const w = window.fixture.S.common.getMainWorkspace(),
          b = w.getBlockById(id);
        return {
          opacity: b.getSvgRoot().style.opacity,
          parent: b.getParent()?.id ?? null,
          dragging: b.getSvgRoot().classList.contains('blocklyDragging'),
          fill: b.getSvgRoot().querySelector('.blocklyPath').getAttribute('fill'),
          descendants: b.getDescendants(false).map((child) => child.getSvgRoot().style.opacity),
        };
      }, id);
      assert.equal(during.fill, point.fill, 'drag preserves capability color');
      assert.ok(during.descendants.every((opacity) => opacity !== '0.45'));
      await page.screenshot({
        path: resolve(output, `${width}-${id}-${touch ? 'touch' : 'mouse'}-drag.png`),
      });
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await page.mouse.up();
      await page.waitForTimeout(250);
      return during;
    };
    const palettePoint = await page.evaluate(() => {
      const w = window.fixture.S.common.getMainWorkspace();
      const b = w.getFlyout().getWorkspace().getTopBlocks(false)[0];
      const r = b.getSvgRoot().querySelector('.blocklyPath').getBoundingClientRect();
      return { x: r.x + 15, y: r.y + 10 };
    });
    await page.mouse.move(palettePoint.x, palettePoint.y);
    await page.mouse.down();
    await page.mouse.move(220, 500, { steps: 15 });
    await page.waitForTimeout(250);
    const paletteDrag = await page.evaluate(() => {
      const w = window.fixture.S.common.getMainWorkspace();
      const b = w
        .getAllBlocks(false)
        .find((b) => b.getSvgRoot()?.classList.contains('blocklyDragging'));
      return b ? { id: b.id, opacity: b.getSvgRoot().style.opacity } : null;
    });
    assert.ok(paletteDrag, 'palette creates a native dragged block');
    assert.equal(paletteDrag.opacity, '');
    await page.mouse.up();
    await page.waitForTimeout(250);
    await page.click('#undo');
    await page.waitForTimeout(250);
    assert.deepEqual(
      await page.evaluate(() =>
        window.fixture.S.common
          .getMainWorkspace()
          .getAllBlocks(false)
          .map((b) => b.id)
          .sort(),
      ),
      initial.ids,
    );
    await page.evaluate(() => window.fixture.S.common.getMainWorkspace().clearUndo());
    const nativeDrag = await drag('repeat', 50, 160);
    console.log('native drag', width, nativeDrag);
    assert.equal(nativeDrag.parent, null);
    assert.equal(nativeDrag.opacity, '');
    assert.equal(nativeDrag.dragging, true);
    assert.equal(
      await page.evaluate(
        () =>
          window.fixture.S.common.getMainWorkspace().getBlockById('repeat').getSvgRoot().style
            .opacity,
      ),
      '0.45',
    );
    await drag('repeat', -50, -160);
    await page.waitForFunction((source) => window.latest.source === source, initial.source);
    assert.equal(
      await page.evaluate(
        () => window.fixture.S.common.getMainWorkspace().getBlockById('repeat').getParent()?.id,
      ),
      'loop',
    );
    const nestedDrag = await drag('print', 60, 100);
    assert.equal(nestedDrag.dragging, true);
    assert.equal(nestedDrag.opacity, '');
    await page.click('#undo');
    await page.waitForFunction((source) => window.latest.source === source, initial.source);
    await page.evaluate(() => {
      const w = window.fixture.S.common.getMainWorkspace(),
        b = w.getBlockById('detached-lcd');
      const p = b.getRelativeToSurfaceXY();
      b.moveBy(350 - p.x, 430 - p.y);
    });
    const inactiveDrag = await drag('detached-lcd', 35, 45, true);
    assert.equal(inactiveDrag.dragging, true);
    assert.equal(inactiveDrag.opacity, '');
    assert.equal(
      await page.evaluate(
        () =>
          window.fixture.S.common.getMainWorkspace().getBlockById('detached-lcd').getSvgRoot().style
            .opacity,
      ),
      '0.45',
    );
    await page.evaluate(() => window.fixture.S.common.getMainWorkspace().clearUndo());
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
    const rootlessSource = await page.evaluate(() => window.latest.source);
    const rootlessDrag = await drag('repeat', 25, 25, true);
    assert.equal(rootlessDrag.opacity, '');
    assert.equal(await page.evaluate(() => window.latest.source), rootlessSource);
    if (width === 1440) {
      const proof = await page.evaluate(() => window.rootlessProof());
      assert.equal(proof.reopened, proof.source);
      assert.deepEqual(proof.reopenedIds, proof.ids);
      assert.ok(proof.source.includes('void loop()'));
      assert.deepEqual(
        proof.steps.map((s) => s.runtime.outputVoltages.d13),
        [5, 0, 5, 0],
      );
      assert.deepEqual(
        proof.steps.map((s) => s.runtime.variables.count),
        [2, 2, 4, 4],
      );
      assert.ok(proof.steps.every((s) => s.status === 'ready' && s.diagnostics.length === 0));
      assert.deepEqual(
        proof.steps[3].runtime.serial.tx.map((e) => e.text),
        ['1\n', '2\n', 'tail\n', '3\n', '4\n', 'tail\n'],
      );
      await writeFile(resolve(output, 'rootless-worker.json'), JSON.stringify(proof, null, 2));
      console.log(
        'PASS real Chromium Worker rootless freechains: Serial1,2,tail,3,4,tail; D13=5,0,5,0 at1500/2500/4500/5500us; count2,2,4,4; reopen exact',
      );
    }
    assert.deepEqual(errors, []);
    receipts.push({
      width,
      initial,
      nativeDrag,
      paletteDrag,
      inactiveDrag,
      nestedDrag,
      rootlessDrag,
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
