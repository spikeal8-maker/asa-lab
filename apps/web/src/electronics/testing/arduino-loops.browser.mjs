// Real Chromium Worker + production lifecycle controller ports; no server/DB/SaveCAS.
/* global window */
import assert from 'node:assert/strict';
import console from 'node:console';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const alias = {
  '@asa-lab/electronics/simulation': resolve('contexts/electronics/simulation.ts'),
  '@asa-lab/electronics/engine': resolve('contexts/electronics/engine.ts'),
  '@asa-lab/electronics': resolve('contexts/electronics/index.ts'),
};
const worker = await build({
  entryPoints: ['apps/web/src/electronics/simulation.worker.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  alias,
});
const source = `int total=0;void setup(){pinMode(13,OUTPUT);Serial.begin(9600);
for(int i=0;i<3;i++){if(i==1)continue;for(int j=0;j<3;j++){
if(j==2)break;Serial.println(i*10+j);digitalWrite(13,j);delay(1);total++;}}
Serial.println(total);}void loop(){delay(100);}`;
const entry = await build({
  stdin: {
    resolveDir: resolve('apps/web'),
    loader: 'ts',
    contents: `
import {ElectronicsSimulationWorkerClient} from './src/electronics/simulation-worker-client';
import {ElectronicsLiveSimulationWorkerController} from './src/electronics/live-simulation-worker-controller';
import {advanceElectronicsToHorizon,resetElectronicsTimedState} from '@asa-lab/electronics/engine';
const initial=${JSON.stringify(source)};
const doc=(source)=>({schemaVersion:4,components:[{id:'uno',kind:'visual',componentTypeId:'arduino-uno',pinIds:['d13','power-5v','power-3v3','power-gnd-1'],position:{x:0,y:0},value:5,stateProperties:{arduinoSource:source}}],connections:[],viewport:{x:0,y:0,zoom:1},simulation:{running:true,maxIterations:24}});
const factory=()=>new Worker('/worker.js',{type:'module'});
window.proof=async()=>{
 const client=new ElectronicsSimulationWorkerClient(factory);
 try{
 const generation=client.beginGeneration('loop-proof');
 const advance=await client.advance(generation,doc(initial),resetElectronicsTimedState(),20000);
 const direct=advanceElectronicsToHorizon(doc(initial),{state:resetElectronicsTimedState(),requestedHorizonMicroseconds:20000});
 return {advance,direct};
 }finally{client.dispose();}
};
const client=new ElectronicsSimulationWorkerClient(factory);
const controller=new ElectronicsLiveSimulationWorkerController(client);
let running=false,ready=false,results=0,committed=0,failure=null,serial=[];
const input=document.querySelector('textarea');input.value=initial;
const current=()=>doc(input.value);
const render=()=>{window.receipt={running,ready,results,committed,failure,serial};document.querySelector('output').textContent=JSON.stringify(window.receipt)};
const callbacks={onInitialReady:()=>{ready=true;render();controller.update(current(),20000)},onResult:()=>{results++;render()},onCommittedHorizon:h=>{committed=h;render()},onSerialProjection:s=>{serial=s;render()},onFailure:f=>{failure=f;running=false;render()}};
document.querySelector('#run').onclick=()=>{running=true;ready=false;failure=null;committed=0;controller.start('loop-native',current(),callbacks);render()};
document.querySelector('#stop').onclick=()=>{controller.stop();running=false;render()};
document.querySelector('#reset').onclick=()=>{ready=false;failure=null;committed=0;controller.restart(current());render()};
input.oninput=()=>{if(running)controller.update(current(),30000);render()};
window.fixture={dispose:()=>controller.dispose()};render();
`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  alias,
});
const output = resolve('test-results/arduino-loops');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const receipts = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    let workers = 0;
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('worker', () => workers++);
    await context.route('**/*', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/worker.js')
        return route.fulfill({ contentType: 'text/javascript', body: worker.outputFiles[0].text });
      if (path === '/')
        return route.fulfill({
          contentType: 'text/html',
          body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>textarea{display:block;width:95%;height:320px}output{display:block;overflow-wrap:anywhere}button{min-height:44px}</style><button id="run">Run</button><button id="stop">Stop</button><button id="reset">Reset</button><textarea aria-label="source"></textarea><output></output>',
        });
      return route.abort();
    });
    await page.goto('https://asa-loops.invalid/');
    await page.addScriptTag({ content: entry.outputFiles[0].text });
    const proof = await page.evaluate(() => window.proof());
    assert.equal(proof.advance.executionStatus, 'ready');
    assert.deepEqual(proof.advance.diagnostics, []);
    assert.deepEqual(proof.advance.state, proof.direct.state);
    const runtime = JSON.parse(proof.advance.state.continuation.serializedState).boards[0].runtime;
    assert.equal(runtime.variables.total, 4);
    assert.deepEqual(
      runtime.serial.tx.map((e) => e.text),
      ['0\n', '1\n', '20\n', '21\n', '4\n'],
    );
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    assert.equal((await page.evaluate(() => window.receipt)).failure, null);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    const afterReset = await page.evaluate(() => window.receipt);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const stopped = await page.evaluate(() => window.receipt);
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.receipt), stopped);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    await page
      .getByRole('textbox', { name: 'source' })
      .fill('void setup(){for(;;){unknown();}}void loop(){}');
    await page.waitForFunction(() => window.receipt.failure !== null);
    const invalid = await page.evaluate(() => window.receipt);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByRole('textbox', { name: 'source' }).fill(source);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(
      () => window.receipt.committed === 20000 && window.receipt.failure === null,
    );
    assert.deepEqual(errors, []);
    assert.ok(workers >= 5);
    await page.screenshot({ path: resolve(output, 'loops-' + width + '.png') });
    receipts.push({
      width,
      workers,
      realWorkerMatchesDirect: true,
      goldenTotal: runtime.variables.total,
      afterReset,
      stopped,
      invalid,
    });
    await page.evaluate(() => window.fixture.dispose());
    await context.close();
  }
  await writeFile(resolve(output, 'receipts.json'), JSON.stringify(receipts, null, 2));
  console.log(
    'PASS real simulation.worker equals direct complete state; native controller-port Run/Stop/Reset/source invalidation 1440/390; no server, DB, SaveCAS or listening ports',
  );
} finally {
  await browser.close();
}
