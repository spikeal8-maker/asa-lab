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
const postTestSource = `int total=0;void setup(){pinMode(13,OUTPUT);Serial.begin(9600);
do {total++;if(total==2)continue;if(total==4)break;
Serial.println(total);digitalWrite(13,total==1);delay(1);delayMicroseconds(3);
} while(total<9);do {Serial.println(10);} while(false);}
void loop(){delay(100);}`;
const incrementSource = `int checks=0;int total=0;int pin=12;
void setup(){pinMode(12,OUTPUT);pinMode(13,OUTPUT);Serial.begin(9600);
while(++checks<3 && total<3){Serial.println(total++);digitalWrite(pin++,HIGH);delayMicroseconds(3);}
Serial.println(checks);Serial.println(pin);int skipped=false && ++pin;
Serial.println(pin--);Serial.println(++pin);delay(1);}
void loop(){delay(100);}`;
const waitingIncrementSource = `int n=2;long value=-1;
void setup(){Serial.begin(9600);pinMode(13,OUTPUT);
value=pulseIn(n++,HIGH,100);Serial.println(n);Serial.println(value);
value=n++ +pulseIn(4,HIGH,100);Serial.println(value);
pinMode(4,OUTPUT);digitalWrite(n++,pulseIn(6,HIGH,100));
value=pulseIn(n++,HIGH,100)+pulseIn(n++,HIGH,100);
value=readUltrasonicCm(n++,10);Serial.println(n);Serial.println(value);
value=pulseIn(11,HIGH,100)+n++;Serial.println(n);Serial.println(value);}
void loop(){delay(100);}`;
const seededSource = `long value=0;void setup(){Serial.begin(9600);pinMode(13,OUTPUT);
randomSeed(42);Serial.println(random());randomSeed(0);Serial.println(random());
value=random(100)+pulseIn(2,HIGH,100);Serial.println(value);digitalWrite(13,value>0);
randomSeed(random()+pulseIn(3,HIGH,100));Serial.println(random());}
void loop(){delay(100);}`;
const conditionalSource = `int n=0;long value=-1;void setup(){Serial.begin(9600);pinMode(13,OUTPUT);
value=(++n?random(100)+pulseIn(2,HIGH,100):++n);Serial.println(n);Serial.println(value);
digitalWrite(13,value==7?HIGH:LOW);Serial.println(false?99:true?42:0);
value=Serial.read()==-1?pulseIn(3,HIGH,100000):99;Serial.println(value);Serial.println(Serial.available());}
void loop(){delay(100);}`;
const entry = await build({
  stdin: {
    resolveDir: resolve('apps/web'),
    loader: 'ts',
    contents: `
import {ElectronicsSimulationWorkerClient} from './src/electronics/simulation-worker-client';
import {ElectronicsLiveSimulationWorkerController} from './src/electronics/live-simulation-worker-controller';
import {advanceElectronicsToHorizon,resetElectronicsTimedState} from '@asa-lab/electronics/engine';
import {advanceClockedArduinoRuntime} from '../../contexts/electronics/domain/arduino-program-runtime';
import * as ScratchBlocks from 'scratch-blocks';
import {registerArduinoBlocks,applyArduinoBlockDefaults,generateArduinoCode} from './src/electronics/arduino-blocks';
import {arduinoBlockSupport} from '../../contexts/electronics/domain/arduino-capabilities';
const initial=${JSON.stringify(postTestSource)};
const legacy=${JSON.stringify(source)};
const increment=${JSON.stringify(incrementSource)};
const waiting=${JSON.stringify(waitingIncrementSource)};
const seeded=${JSON.stringify(seededSource)};
const conditional=${JSON.stringify(conditionalSource)};
registerArduinoBlocks();
const workspace=new ScratchBlocks.Workspace();
ScratchBlocks.Events.disable();
const setup=workspace.newBlock('asa_setup');
const print=workspace.newBlock('asa_serial_print');
setup.getInput('DO').connection.connect(print.previousConnection);
const random=workspace.newBlock('asa_random');
print.getInput('TEXT').connection.connect(random.outputConnection);
const detached=workspace.newBlock('asa_random');
workspace.newBlock('asa_loop').getInput('DO').connection.connect(workspace.newBlock('asa_wait').previousConnection);
applyArduinoBlockDefaults(workspace);
const generated=generateArduinoCode(workspace);
const blockStatus=arduinoBlockSupport('asa_random').status;
const blockColour=random.getColour();
workspace.dispose();ScratchBlocks.Events.enable();
window.generatedRandom={source:generated,blockStatus,blockColour};
const doc=(source)=>({schemaVersion:4,components:[{id:'uno',kind:'visual',componentTypeId:'arduino-uno',pinIds:['d13','power-5v','power-3v3','power-gnd-1'],position:{x:0,y:0},value:5,stateProperties:{arduinoSource:source}}],connections:[],viewport:{x:0,y:0,zoom:1},simulation:{running:true,maxIterations:24}});
const factory=()=>new Worker('/worker.js',{type:'module'});
window.proof=async()=>{
 const client=new ElectronicsSimulationWorkerClient(factory);
 try{
 const generation=client.beginGeneration('loop-proof');
 const proofs=[];
 for(const source of [legacy,initial,increment,waiting,seeded,generated,conditional]){
  const horizons=source===waiting?[50,500,1100000]:source===conditional?[50,500,150000]:[500,1500,20000];
  const horizon=horizons.at(-1);
  let state=resetElectronicsTimedState();let advance;
  for(const horizon of horizons){
   advance=await client.advance(generation,doc(source),JSON.parse(JSON.stringify(state)),horizon);
   state=advance.state;
  }
  let direct;let directState=resetElectronicsTimedState();
  do {direct=advanceElectronicsToHorizon(doc(source),{state:directState,requestedHorizonMicroseconds:horizon});
    directState=JSON.parse(JSON.stringify(direct.state));
  }while(direct.executionStatus==='yielded');
  let runtime;const events=[];let slices=0;
  do {const step=advanceClockedArduinoRuntime(source,{},horizon/1000,runtime,undefined,{instructionBudget:1});
   runtime=JSON.parse(JSON.stringify(step.state));events.push(...step.events);slices++;
   if(step.executionStatus!=='yielded')break;
  }while(slices<10000);
  proofs.push({advance,direct,budgetOne:{runtime,events,slices}});
 }
 proofs.push({invalid:await client.advance(generation,doc(increment.replace('total++','++1')),resetElectronicsTimedState(),20000)});
 const multi=doc(seeded);multi.components.push({...multi.components[0],id:'other',stateProperties:{arduinoSource:seeded.replace('randomSeed(42)','randomSeed(1)')}});
 window.multiRandom=await client.advance(generation,multi,resetElectronicsTimedState(),20000);
 return proofs;
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
window.fixture={dispose:()=>controller.dispose(),advance:h=>controller.update(current(),h),send:text=>controller.sendSerialRx('uno',text,20000)};render();
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
    const proofs = await page.evaluate(() => window.proof());
    const incrementInvalid = proofs.pop().invalid;
    assert.ok(incrementInvalid.diagnostics.some((entry) => entry.code === 'compile_error'));
    const invalidRuntime = JSON.parse(incrementInvalid.state.continuation.serializedState).boards[0]
      .runtime;
    assert.deepEqual(invalidRuntime.outputVoltages, {});
    const proof = proofs[1];
    const seededProof = proofs[4];
    const generatedProof = proofs[5];
    const conditionalProof = proofs[6];
    for (const result of proofs) {
      assert.equal(result.advance.executionStatus, 'ready');
      assert.deepEqual(result.advance.diagnostics, []);
      assert.deepEqual(result.advance.state, result.direct.state);
      const board = JSON.parse(result.advance.state.continuation.serializedState).boards[0].runtime;
      assert.deepEqual(result.budgetOne.runtime, board);
      assert.ok(result.budgetOne.slices > 1);
    }
    const seededRuntime = JSON.parse(seededProof.advance.state.continuation.serializedState)
      .boards[0].runtime;
    const seededSerial = seededRuntime.serial.tx.map((entry) => entry.text);
    assert.deepEqual(seededSerial.slice(0, 3), ['705894\n', '1126542223\n', '9\n']);
    assert.equal(seededRuntime.outputVoltages.d13, 5);
    const generated = await page.evaluate(() => window.generatedRandom);
    assert.equal(generated.blockStatus, 'supported');
    assert.equal(generated.blockColour, '#40bf4a');
    assert.equal(generated.source.match(/random\(/g).length, 1);
    assert.ok(generated.source.includes('random(1, 11)'));
    const generatedRuntime = JSON.parse(generatedProof.advance.state.continuation.serializedState)
      .boards[0].runtime;
    assert.deepEqual(
      generatedRuntime.serial.tx.map((entry) => entry.text),
      ['8\n'],
    );
    assert.equal(generatedRuntime.randomState, 16807);
    const conditionalRuntime = JSON.parse(
      conditionalProof.advance.state.continuation.serializedState,
    ).boards[0].runtime;
    assert.deepEqual(conditionalRuntime.variables, { n: 1, value: 0 });
    assert.equal(conditionalRuntime.randomState, 16807);
    assert.equal(conditionalRuntime.outputVoltages.d13, 5);
    assert.deepEqual(
      conditionalRuntime.serial.tx.map((e) => e.text),
      ['1\n', '7\n', '42\n', '0\n', '0\n'],
    );
    const multi = await page.evaluate(() => window.multiRandom);
    assert.deepEqual(multi.diagnostics, []);
    const multiBoards = JSON.parse(multi.state.continuation.serializedState).boards;
    assert.deepEqual(
      multiBoards.find((board) => board.componentId === 'uno').runtime,
      seededRuntime,
    );
    assert.equal(
      multiBoards.find((board) => board.componentId === 'other').runtime.serial.tx[0].text,
      '16807\n',
    );
    assert.notEqual(multiBoards[0].runtime.randomState, multiBoards[1].runtime.randomState);
    assert.equal(proof.advance.executionStatus, 'ready');
    assert.deepEqual(proof.advance.diagnostics, []);
    assert.deepEqual(proof.advance.state, proof.direct.state);
    const runtime = JSON.parse(proof.advance.state.continuation.serializedState).boards[0].runtime;
    assert.equal(runtime.variables.total, 4);
    assert.deepEqual(
      runtime.serial.tx.map((e) => e.text),
      ['1\n', '3\n', '10\n'],
    );
    assert.equal(runtime.outputVoltages.d13, 0);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    assert.equal((await page.evaluate(() => window.receipt)).failure, null);
    assert.deepEqual((await page.evaluate(() => window.receipt)).serial[0].tx, runtime.serial.tx);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    const afterReset = await page.evaluate(() => window.receipt);
    assert.deepEqual(afterReset.serial[0].tx, runtime.serial.tx);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const stopped = await page.evaluate(() => window.receipt);
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.receipt), stopped);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    await page
      .getByRole('textbox', { name: 'source' })
      .fill('void setup(){do {unknown();}while(false);}void loop(){}');
    await page.waitForFunction(() => window.receipt.failure !== null);
    const invalid = await page.evaluate(() => window.receipt);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByRole('textbox', { name: 'source' }).fill(postTestSource);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(
      () => window.receipt.committed === 20000 && window.receipt.failure === null,
    );
    await page
      .getByRole('textbox', { name: 'source' })
      .fill(postTestSource.replace('Serial.println(10)', 'Serial.println(42)'));
    await page.waitForFunction(
      () =>
        window.receipt.committed === 30000 && window.receipt.serial[0]?.tx.at(-1)?.text === '42\n',
    );
    const edited = await page.evaluate(() => window.receipt);
    await page
      .getByRole('textbox', { name: 'source' })
      .fill('void setup(){do {continue;}while(true);}void loop(){}');
    await page.waitForFunction(
      () => window.receipt.committed === 30000 && window.receipt.serial.length === 0,
    );
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const infiniteStopped = await page.evaluate(() => window.receipt);
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.receipt), infiniteStopped);
    const incrementProof = proofs[2];
    const incrementRuntime = JSON.parse(incrementProof.advance.state.continuation.serializedState)
      .boards[0].runtime;
    assert.deepEqual(incrementRuntime.variables, { checks: 3, total: 2, pin: 14 });
    const incrementSerial = ['0\n', '1\n', '3\n', '14\n', '14\n', '14\n'];
    assert.deepEqual(
      incrementRuntime.serial.tx.map((e) => e.text),
      incrementSerial,
    );
    assert.equal(incrementRuntime.outputVoltages.d12, 5);
    assert.equal(incrementRuntime.outputVoltages.d13, 5);
    await page.getByRole('textbox', { name: 'source' }).fill(incrementSource);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    const incrementRun = await page.evaluate(() => window.receipt);
    assert.equal(incrementRun.failure, null);
    assert.deepEqual(incrementRun.serial[0].tx, incrementRuntime.serial.tx);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    const incrementReset = await page.evaluate(() => window.receipt);
    assert.deepEqual(incrementReset.serial[0].tx, incrementRuntime.serial.tx);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const incrementStopped = await page.evaluate(() => window.receipt);
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.receipt), incrementStopped);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    await page
      .getByRole('textbox', { name: 'source' })
      .fill(incrementSource.replace('Serial.println(checks)', 'Serial.println(checks+40)'));
    await page.waitForFunction(
      () => window.receipt.committed === 30000 && window.receipt.serial[0]?.tx[2]?.text === '43\n',
    );
    const incrementEdited = await page.evaluate(() => window.receipt);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const waitingProof = proofs[3];
    const waitingRuntime = JSON.parse(waitingProof.advance.state.continuation.serializedState)
      .boards[0].runtime;
    assert.deepEqual(waitingRuntime.variables, { n: 9, value: 8 });
    const waitingSerial = ['3\n', '0\n', '3\n', '8\n', '0\n', '9\n', '8\n'];
    assert.deepEqual(
      waitingRuntime.serial.tx.map((entry) => entry.text),
      waitingSerial,
    );
    assert.equal(waitingRuntime.pendingEvaluation, undefined);
    await page.getByRole('textbox', { name: 'source' }).fill(waitingIncrementSource);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    const waitingPending = await page.evaluate(() => window.receipt);
    assert.deepEqual(
      waitingPending.serial[0].tx.map((entry) => entry.text),
      waitingSerial.slice(0, 3),
    );
    await page.evaluate(() => window.fixture.advance(1100000));
    await page.waitForFunction(() => window.receipt.committed === 1100000);
    const waitingCompleted = await page.evaluate(() => window.receipt);
    assert.deepEqual(waitingCompleted.serial[0].tx, waitingRuntime.serial.tx);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    assert.deepEqual(
      (await page.evaluate(() => window.receipt)).serial[0].tx,
      waitingPending.serial[0].tx,
    );
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const waitingStopped = await page.evaluate(() => window.receipt);
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.receipt), waitingStopped);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    await page
      .getByRole('textbox', { name: 'source' })
      .fill(waitingIncrementSource.replace('readUltrasonicCm(n++,10)', 'pulseIn(n++,HIGH,100)'));
    await page.waitForFunction(
      () => window.receipt.committed === 30000 && window.receipt.serial[0]?.tx.length === 7,
    );
    const waitingEdited = await page.evaluate(() => window.receipt);
    assert.deepEqual(
      waitingEdited.serial[0].tx.map((entry) => entry.text),
      waitingSerial,
    );
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByRole('textbox', { name: 'source' }).fill(seededSource);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(
      () => window.receipt.committed === 20000 && window.receipt.serial[0]?.tx.length === 4,
    );
    const seededRun = await page.evaluate(() => window.receipt);
    assert.equal(seededRun.failure, null);
    assert.deepEqual(seededRun.serial[0].tx, seededRuntime.serial.tx);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    const seededReset = await page.evaluate(() => window.receipt);
    assert.deepEqual(seededReset.serial[0].tx, seededRuntime.serial.tx);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const seededStopped = await page.evaluate(() => window.receipt);
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.receipt), seededStopped);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    await page
      .getByRole('textbox', { name: 'source' })
      .fill(seededSource.replace('randomSeed(42)', 'randomSeed(1)'));
    await page.waitForFunction(
      () =>
        window.receipt.committed === 30000 && window.receipt.serial[0]?.tx[0]?.text === '16807\n',
    );
    const seededEdited = await page.evaluate(() => window.receipt);
    assert.equal(seededEdited.failure, null);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByRole('textbox', { name: 'source' }).fill(generated.source);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(
      () => window.receipt.committed === 20000 && window.receipt.serial[0]?.tx[0]?.text === '8\n',
    );
    const generatedRun = await page.evaluate(() => window.receipt);
    assert.equal(generatedRun.failure, null);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    assert.deepEqual(errors, []);
    await page.getByRole('textbox', { name: 'source' }).fill(conditionalSource);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    const conditionalPending = await page.evaluate(() => window.receipt);
    assert.deepEqual(
      conditionalPending.serial[0].tx.map((e) => e.text),
      ['1\n', '7\n', '42\n'],
    );
    await page.evaluate(() => {
      window.fixture.send('A');
      window.fixture.advance(150000);
    });
    await page.waitForFunction(() => window.receipt.committed === 150000);
    const conditionalCompleted = await page.evaluate(() => window.receipt);
    assert.deepEqual(
      conditionalCompleted.serial[0].tx.map((e) => e.text),
      ['1\n', '7\n', '42\n', '0\n', '1\n'],
    );
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    const conditionalReset = await page.evaluate(() => window.receipt);
    assert.deepEqual(conditionalReset.serial[0].tx, conditionalPending.serial[0].tx);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const conditionalStopped = await page.evaluate(() => window.receipt);
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.receipt), conditionalStopped);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => window.receipt.committed === 20000);
    await page
      .getByRole('textbox', { name: 'source' })
      .fill(conditionalSource.replace('Serial.read()==-1', 'false'));
    await page.waitForFunction(
      () => window.receipt.committed === 30000 && window.receipt.serial[0]?.tx[3]?.text === '99\n',
    );
    const conditionalEdited = await page.evaluate(() => window.receipt);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    assert.ok(workers >= 5);
    await page.screenshot({ path: resolve(output, 'loops-' + width + '.png') });
    receipts.push({
      width,
      workers,
      realWorkerMatchesDirect: true,
      goldenTotal: runtime.variables.total,
      postTestSerial: runtime.serial.tx,
      budgetOneSlices: proof.budgetOne.slices,
      workerJsonHorizons: [500, 1500, 20000],
      afterReset,
      stopped,
      invalid,
      edited,
      infiniteStopped,
      incrementRun,
      incrementReset,
      incrementStopped,
      incrementEdited,
      incrementInvalid,
      incrementVariables: incrementRuntime.variables,
      incrementSerial,
      incrementBudgetOneSlices: incrementProof.budgetOne.slices,
      waitingPending,
      waitingCompleted,
      waitingStopped,
      waitingEdited,
      waitingVariables: waitingRuntime.variables,
      waitingSerial,
      waitingBudgetOneSlices: waitingProof.budgetOne.slices,
      seededSerial,
      seededRun,
      seededReset,
      seededStopped,
      seededEdited,
      generated,
      conditionalPending,
      conditionalCompleted,
      conditionalReset,
      conditionalStopped,
      conditionalEdited,
      conditionalBudgetOneSlices: conditionalProof.budgetOne.slices,
      generatedRun,
      multiBoards,
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
