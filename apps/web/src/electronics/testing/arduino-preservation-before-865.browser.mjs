// Read-only baseline oracle: native Blockly/React; no server, database or timers altered.
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
let root;
window.mount=(workspace,source)=>{
 window.persisted=[];
 const board={id:'old-uno',kind:'visual',componentTypeId:'arduino-uno',stateProperties:{arduinoCodeMode:'blocks',arduinoWorkspace:workspace,arduinoSource:source}};
 const c={document:{components:[board]},selection:null,simulationRunning:false,arduinoSerialByBoard:{},updateArduinoProgram:(_id,p)=>window.persisted.push(p),setNotice:()=>{},sendArduinoSerialRx:()=>{}};
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
const output = resolve('reports/arduino-block-mount-completion-865/before');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const receipts = [];
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
      await page.waitForFunction(() => window.persisted.length > 0);
      const actual = await page.evaluate(() => ({
        persisted: window.persisted,
        liveBlockCount: window.Blockly?.getMainWorkspace?.()?.getAllBlocks(false).length,
      }));
      const last = actual.persisted.at(-1);
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
      assert.equal(
        source === last.arduinoSource,
        false,
        'Baseline source overwrite must be independently reproduced',
      );
      await page.screenshot({ path: resolve(output, name + '-' + width + '.png'), fullPage: true });
      await page.evaluate(() => window.unmount());
    }
    await page.close();
  }
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
