// Actual Chromium Worker -> production client/live controller -> real monitor.
// Controller UI ports are explicit; this is not full installed app or server SaveCAS.
/* global window, document, console */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const alias = {
  '@asa-lab/electronics/simulation': resolve('contexts/electronics/simulation.ts'),
  '@asa-lab/electronics/engine': resolve('contexts/electronics/engine.ts'),
  '@asa-lab/electronics': resolve('contexts/electronics/index.ts'),
};
const opts = {
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  alias,
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
};
const before = process.argv.includes('--before');
const serialBeginBefore = process.argv.includes('--serial-begin-before');
const serialBeginOnly = serialBeginBefore || process.argv.includes('--serial-begin-only');
if (serialBeginBefore)
  opts.plugins = [
    {
      name: 'serial-begin-baseline',
      setup(builder) {
        builder.onLoad({ filter: /ArduinoSerialMonitor\.tsx$/ }, (args) => ({
          contents: execFileSync(
            'git',
            ['show', 'abfeff96:apps/web/src/electronics/ArduinoSerialMonitor.tsx'],
            { encoding: 'utf8' },
          ),
          loader: 'tsx',
        }));
      },
    },
  ];
if (before)
  opts.plugins = [
    {
      name: 'before-ui',
      setup(builder) {
        builder.onLoad(
          { filter: /(ArduinoSerialMonitor\.tsx|live-simulation-worker-controller\.ts)$/ },
          (args) => {
            const path = args.path.replaceAll('\\', '/').split('/ASA-lab/').at(-1);
            return {
              contents: execFileSync('git', ['show', `83e7f3b0:${path}`], { encoding: 'utf8' }),
              loader: 'tsx',
            };
          },
        );
      },
    },
  ];
const worker = await build({
  ...opts,
  entryPoints: ['apps/web/src/electronics/simulation.worker.ts'],
});
const ui = await build({
  ...opts,
  stdin: {
    resolveDir: resolve('apps/web'),
    loader: 'tsx',
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {ArduinoSerialMonitor} from './src/electronics/ArduinoSerialMonitor';
import {ElectronicsSimulationWorkerClient} from './src/electronics/simulation-worker-client';
import {ElectronicsLiveSimulationWorkerController} from './src/electronics/live-simulation-worker-controller';
import {advanceElectronicsToHorizon,parseElectronicsEngineDocument,resetElectronicsTimedState} from '@asa-lab/electronics/engine';
const workerCode=${JSON.stringify(worker.outputFiles[0].text)};
const rows=[['uno','power-5v','top','a'],['top','b','bottom','a'],['bottom','b','uno','power-gnd-1'],['uno','a0','top','b']];
function circuit(floating=false,source='void setup(){Serial.begin(9600);}void loop(){Serial.println(analogRead(A0));delay(1);}'){
return {schemaVersion:4,components:[{id:'uno',kind:'visual',componentTypeId:'arduino-uno',value:5,position:{x:0,y:0},pinIds:['d13','power-3v3','a0','a1','a2','a3','a4','a5','power-5v','power-gnd-1'],stateProperties:{arduinoSource:source}},{id:'top',kind:'resistor',value:1000,position:{x:0,y:0}},{id:'bottom',kind:'resistor',value:1000,position:{x:0,y:0}}],connections:rows.slice(0,floating?3:4).map(([a,b,c,d],i)=>({id:'w'+i,from:{componentId:a,terminal:b},to:{componentId:c,terminal:d}})),viewport:{x:0,y:0,zoom:1},simulation:{running:true,maxIterations:24}};}
function scenario(name){let doc=circuit();const uno=doc.components[0],top=doc.components[1];const wires=rows=>rows.map(([a,b,c,d],i)=>({id:'w'+i,from:{componentId:a,terminal:b},to:{componentId:c,terminal:d}}));
if(name==='pot')doc={...doc,components:[uno,{id:'pot',kind:'potentiometer',value:10000,position:{x:0,y:0},wiperPosition:.25}],connections:wires([['uno','power-5v','pot','a'],['uno','power-gnd-1','pot','b'],['uno','a0','pot','wiper']])};
if(name==='diode')doc={...doc,components:[uno,top,{id:'diode',kind:'diode',value:.7,position:{x:0,y:0}}],connections:wires([['uno','power-5v','top','a'],['top','b','diode','a'],['diode','b','uno','power-gnd-1'],['uno','a0','diode','a']])};
if(name==='ladder'){const resistances=[100,1000,3000,10000];doc={...doc,components:[uno,top,...resistances.flatMap((value,i)=>[{id:'r'+i,kind:'resistor',value,position:{x:0,y:0}},{id:'key'+i,kind:'button',value:0,state:i===0,position:{x:0,y:0}}])],connections:wires([['uno','power-5v','top','a'],['uno','a0','top','b'],...resistances.flatMap((_,i)=>[['top','b','r'+i,'a'],['r'+i,'b','key'+i,'a'],['key'+i,'b','uno','power-gnd-1']])])};}
if(name==='allpins')doc={...doc,components:[{...uno,stateProperties:{arduinoSource:'void setup(){Serial.begin(9600);'+[0,1,2,3,4,5].map(p=>'Serial.println(analogRead(A'+p+'));').join('')+'}void loop(){delay(100);}'}},...doc.components.slice(1)],connections:[...doc.connections,...[1,2,3,4,5].map(p=>({id:'pin'+p,from:{componentId:'uno',terminal:'a'+p},to:{componentId:'uno',terminal:p===2?'power-gnd-1':p===3?'power-5v':'a0'}}))]};
if(name==='two')doc={...doc,components:[...doc.components,{...uno,id:'second',stateProperties:{arduinoSource:'void setup(){Serial.begin(9600);Serial.println(222);}void loop(){delay(100);}'}}]};
return parseElectronicsEngineDocument(doc).document;}
let render;let serial=[],running=true,open=true,boardId='uno';let current=circuit();
window.probe={responses:[],errors:[],sends:[],horizon:-1};
const client=new ElectronicsSimulationWorkerClient(()=>{const w=new Worker(URL.createObjectURL(new Blob([workerCode],{type:'text/javascript'})));w.addEventListener('message',e=>window.probe.responses.push(e.data));return w;});
const controller=new ElectronicsLiveSimulationWorkerController(client);
const callbacks={onResult:r=>{window.probe.result=r},onCommittedHorizon:t=>{window.probe.horizon=t},onSerialProjection:s=>{serial=s;render?.()},onFailure:e=>window.probe.errors.push(e)};
function Demo(){const [,refresh]=React.useState(0);render=()=>refresh(n=>n+1);return <ArduinoSerialMonitor boardId={boardId} open={open} running={running} serial={serial.find(s=>s.componentId===boardId)} onOpenChange={v=>{open=v;render()}} onSend={(id,text)=>{window.probe.sends.push({id,text});controller.sendSerialRx(id,text,9000)}}/>;}
createRoot(document.getElementById('app')).render(<Demo/>);
window.fixture={scenario:name=>{current=scenario(name);running=true;window.probe.horizon=-1;controller.start('native',current,callbacks)},board:id=>{boardId=id;render()},edit:(id,value)=>{current={...current,components:current.components.map(c=>c.id===id?{...c,...value}:c)};controller.update(current,9000)},start:(floating=false,source)=>{current=circuit(floating,source);running=true;window.probe.horizon=-1;controller.start('native',current,callbacks);render?.()},advance:t=>controller.update(current,t),stop:()=>{controller.stop();running=false;render()},run:()=>{running=true;window.probe.horizon=-1;controller.start('native',current,callbacks);render()},reset:()=>{window.probe.horizon=-1;controller.restart(current)},switchSource:()=>{current=circuit(false,'int changed=0;void setup(){Serial.begin(9600);}void loop(){Serial.println(analogRead(A0));delay(1);}');window.probe.horizon=-1;controller.update(current,9000)},parity:()=>{const parsed=parseElectronicsEngineDocument(current);if(!parsed.ok)throw Error(parsed.message);let state=resetElectronicsTimedState(),r;do{r=advanceElectronicsToHorizon(parsed.document,{state,requestedHorizonMicroseconds:9000,maxEvents:7});state=r.state}while(r.executionStatus==='yielded');const last=window.probe.responses.filter(r=>r.ok&&r.kind==='advance'&&r.advance.committedHorizonMicroseconds===9000).at(-1);const a=JSON.stringify(last.advance.state),b=JSON.stringify(r.state);let i=0;while(i<a.length&&a[i]===b[i])i++;window.probe.parity={index:i,a:a.slice(i-60,i+180),b:b.slice(i-60,i+180)};return a===b},dispose:()=>controller.dispose()};
`,
  },
});
const browser = await chromium.launch({ headless: true });
const output = resolve('test-results/arduino-analog-serial');
await mkdir(output, { recursive: true });
const receipts = [];
let activePage;
let phase = 'initial';
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    activePage = page;
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(
      '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>',
    );
    await page.addStyleTag({
      content: await readFile('apps/web/src/electronics/workbench.css', 'utf8'),
    });
    await page.addScriptTag({ content: ui.outputFiles[0].text });
    const wait = async () => {
      await page.evaluate(() => window.fixture.advance(9000));
      await page.waitForFunction(() => window.probe.horizon === 9000);
    };
    const text = () => page.locator('.arduino-serial-output').innerText();
    // Real Worker rejects RX before begin; UI must retain the unsent message.
    phase = 'serial-begin-input';
    const message = page.getByLabel('Сообщение в последовательный порт');
    const send = page.getByRole('button', { name: 'Отпр.' });
    await page.evaluate(() => window.fixture.start(false, 'void setup(){}void loop(){delay(1);}'));
    await wait();
    assert.match(await page.locator('.arduino-serial-status').innerText(), /Ожидает Serial.begin/);
    await message.fill('A');
    const sendCount = await page.evaluate(() => window.probe.sends.length);
    if (serialBeginBefore) {
      assert.equal(await send.isEnabled(), true);
      await send.click();
      assert.equal(await message.inputValue(), '');
      await page.evaluate(() => window.fixture.advance(18000));
      await page.waitForFunction(() => window.probe.horizon === 18000);
      assert.equal(await text(), '');
      assert.equal(await page.evaluate(() => window.probe.sends.length), sendCount + 1);
      await page.screenshot({ path: resolve(output, 'before-serial-begin-' + width + '.png') });
      receipts.push({ width, expectedBeforeInputLoss: true, ignoredRx: 'A', tx: '' });
    } else {
      assert.equal(await send.isDisabled(), true);
      await message.press('Enter');
      assert.equal(await message.inputValue(), 'A');
      assert.equal(await page.evaluate(() => window.probe.sends.length), sendCount);
      await page.evaluate(() =>
        window.fixture.start(
          false,
          'void setup(){Serial.begin(9600);}void loop(){if(Serial.available()){Serial.println(Serial.read());}delay(1);}',
        ),
      );
      await wait();
      assert.equal(await message.inputValue(), 'A');
      assert.equal(await send.isEnabled(), true);
      assert.equal(await text(), '');
      await message.press('Enter');
      await page.evaluate(() => window.fixture.advance(18000));
      await page.waitForFunction(() => window.probe.horizon === 18000);
      assert.equal((await text()).trim(), '65');
      assert.equal(await message.inputValue(), '');
      assert.equal(await page.evaluate(() => window.probe.sends.length), sendCount + 1);
      await message.fill('B');
      await page.evaluate(() => window.fixture.stop());
      assert.equal(await message.inputValue(), 'B');
      assert.equal(await send.isDisabled(), true);
      await page.evaluate(() => window.fixture.run());
      await wait();
      assert.equal(await message.inputValue(), 'B');
      assert.equal(await text(), '');
      await page.evaluate(() => window.fixture.reset());
      await wait();
      assert.equal(await message.inputValue(), 'B');
      assert.equal(await text(), '');
      await send.click();
      await page.evaluate(() => window.fixture.advance(18000));
      await page.waitForFunction(() => window.probe.horizon === 18000);
      assert.equal((await text()).trim(), '66');
      assert.equal(await page.evaluate(() => window.probe.sends.length), sendCount + 2);
      assert.deepEqual(await page.evaluate(() => window.probe.errors), []);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(output, 'serial-begin-' + width + '.png') });
      receipts.push({
        width,
        beginGuard: true,
        inputPreserved: true,
        enterRx: 65,
        buttonRx: 66,
        stopRunReset: true,
      });
    }
    if (serialBeginOnly) {
      await page.evaluate(() => window.fixture.dispose());
      await page.close();
      continue;
    }
    await page.evaluate(() => window.fixture.start());
    await wait();
    assert.equal((await text()).trim().split(/\s+/).length, 9);
    assert.match(await text(), /511/);
    assert.equal(await page.evaluate(() => window.fixture.parity()), true);
    await page.getByRole('button', { name: 'Очист.' }).click();
    assert.equal(await text(), '');
    await page.evaluate(() => window.fixture.stop());
    assert.equal(await text(), '');
    phase = 'clear-stop-run';
    await page.evaluate(() => window.fixture.run());
    await wait();
    assert.match(await text(), /511/);
    phase = 'remaining-journeys';
    await page.getByRole('button', { name: 'Очист.' }).click();
    await page.evaluate(() => window.fixture.reset());
    await wait();
    assert.match(await text(), /511/);
    await page.getByRole('button', { name: 'Очист.' }).click();
    await page.evaluate(() => window.fixture.switchSource());
    await page.evaluate(() => window.fixture.advance(18000));
    await page.waitForFunction(() => window.probe.horizon === 18000);
    assert.match(await text(), /511/);
    const title = page.getByRole('button', { name: /Монитор последовательного интерфейса/ });
    await title.click();
    await title.click();
    assert.match(await text(), /511/);
    const circuits = [];
    for (const name of ['pot', 'diode', 'ladder', 'allpins']) {
      await page.evaluate((name) => window.fixture.scenario(name), name);
      await wait();
      const codes = (await text()).trim().split(/\s+/).map(Number);
      const voltage = await page.evaluate(
        () =>
          window.probe.result.components.find((c) => c.componentId === 'uno').terminalVoltages.a0,
      );
      const expected = Math.round((voltage / 5) * 1023);
      if (name === 'allpins') assert.deepEqual(codes, [511, 511, 0, 1023, 511, 511]);
      else assert.ok(codes.every((code) => code === expected));
      assert.equal(
        await page.evaluate(() => window.fixture.parity()),
        true,
        name + JSON.stringify(await page.evaluate(() => window.probe.parity)),
      );
      if (name === 'pot') {
        await page.evaluate(() => {
          window.fixture.edit('pot', { wiperPosition: 0.75 });
          window.fixture.advance(18000);
        });
        await page.waitForFunction(() => window.probe.horizon === 18000);
        assert.equal(Number((await text()).trim().split(/\s+/).at(-1)), 256);
      }
      if (name === 'ladder') {
        for (const [index, expectedCode] of [
          [1, 512],
          [2, 767],
          [3, 930],
        ]) {
          const target = 18000 + (index - 1) * 9000;
          await page.evaluate(
            ({ index, target }) => {
              window.fixture.edit('key' + (index - 1), { state: false });
              window.fixture.edit('key' + index, { state: true });
              window.fixture.advance(target);
            },
            { index, target },
          );
          await page.waitForFunction((target) => window.probe.horizon === target, target);
          assert.equal(Number((await text()).trim().split(/\s+/).at(-1)), expectedCode);
        }
      }
      circuits.push({ name, codes, expected });
    }
    await page.evaluate(() => window.fixture.scenario('two'));
    await wait();
    await page.getByRole('button', { name: 'Очист.' }).click();
    await page.evaluate(() => window.fixture.board('second'));
    await page.waitForFunction(
      () => document.querySelector('.arduino-serial-output').textContent.trim() === '222',
    );
    assert.equal((await text()).trim(), '222');
    await page.evaluate(() => window.fixture.board('uno'));
    await page.waitForFunction(
      () => document.querySelector('.arduino-serial-output').textContent === '',
    );
    assert.equal(await text(), '');
    await page.evaluate(() => window.fixture.start(true));
    await wait();
    const floating = (await text()).trim().split(/\s+/).map(Number);
    assert.ok(new Set(floating).size > 3);
    assert.ok(floating.every((n) => Number.isInteger(n) && n >= 0 && n <= 1023));
    assert.equal(await page.evaluate(() => window.fixture.parity()), true);
    await page.screenshot({ path: resolve(output, 'monitor-' + width + '.png') });
    // Recorded topology actions use the production controller's generation boundary.
    await page.evaluate(() => window.fixture.start(false));
    await wait();
    assert.match(await text(), /511/);
    await page.evaluate(() => window.fixture.start(true));
    await wait();
    assert.deepEqual((await text()).trim().split(/\s+/).map(Number), floating);
    await page.evaluate(() =>
      window.fixture.start(
        false,
        'void setup(){Serial.begin(9600);}void loop(){if(Serial.available()){Serial.println(Serial.read());}delay(1);}',
      ),
    );
    await wait();
    const input = page.getByLabel('Сообщение в последовательный порт');
    await input.fill('A');
    assert.equal(await text(), '');
    await page.getByRole('button', { name: 'Отпр.' }).click();
    await page.evaluate(() => window.fixture.advance(18000));
    await page.waitForFunction(() => window.probe.horizon === 18000);
    assert.equal((await text()).trim(), '65');
    const probe = await page.evaluate(() => ({
      errors: window.probe.errors,
      responses: window.probe.responses.length,
    }));
    assert.deepEqual(errors, []);
    assert.deepEqual(probe.errors, []);
    receipts.push({
      width,
      connected: 511,
      floating,
      actualWorkerResponses: probe.responses,
      directParity: true,
      clearStopRunResetSource: true,
      circuits,
      boardIsolation: true,
      recordedTopologyActions: ['disconnect', 'connect', 'disconnect'],
      realRx: 65,
    });
    await page.evaluate(() => window.fixture.dispose());
    await page.close();
  }
  await writeFile(
    resolve(
      output,
      serialBeginBefore
        ? 'serial-begin-before.json'
        : serialBeginOnly
          ? 'serial-begin.json'
          : 'receipt.json',
    ),
    JSON.stringify(receipts, null, 2),
  );
  if (before) throw new Error('Expected baseline monitor failure was not reproduced.');
  console.log(JSON.stringify(receipts));
} catch (error) {
  if (!before || phase !== 'clear-stop-run' || error.operator !== 'match' || error.actual !== '')
    throw error;
  await activePage?.screenshot({ path: resolve(output, 'before-hidden-fresh-tx.png') });
  await writeFile(
    resolve(output, 'before.json'),
    JSON.stringify(
      {
        expectedFailure: true,
        error: String(error),
        probe: await activePage?.evaluate(() => ({
          horizon: window.probe.horizon,
          errors: window.probe.errors,
          responses: window.probe.responses.length,
        })),
      },
      null,
      2,
    ),
  );
  console.log('EXPECTED BEFORE FAILURE: ' + String(error));
} finally {
  await browser.close();
}
