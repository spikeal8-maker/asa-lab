// Real Chromium Worker/client + mounted workbench hook + production Stage/owner SVG.
// Project API responses and static assets are fixture ports; no server or listening ports.
/* global window, document, URL, console, DOMPoint */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
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
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '{}',
    'import.meta.url': '"https://servo-fixture.invalid/fixture.js"',
  },
};
const worker = (
  await build({ ...opts, entryPoints: ['apps/web/src/electronics/simulation.worker.ts'] })
).outputFiles[0].text;
const catalog = JSON.parse(
  await readFile('apps/web/public/assets/electronics/component-database/catalog.json', 'utf8'),
);
const output = resolve('test-results/servo-runtime');
await mkdir(output, { recursive: true });
const source = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {api} from './src/api';
import {useElectronicsWorkbench} from './src/electronics/use-electronics-workbench';
import {NativeOpticalProvider} from './src/electronics/NativeOpticalComponentVisual';
import {ProductionComponentVisual as DirectVisual} from './src/electronics/ProductionComponentVisual';
import {WorkbenchStage} from './src/electronics/WorkbenchStage';
import {rawDisplayCircuit,rawDisplaySource,OWNER_HIGH_WRITES} from '../../contexts/electronics/testing/fixtures/raw-seven-segment';
import {configureProductionLibrary} from './src/electronics/production-manifest-adapter';
import {catalogEntry} from './src/electronics/component-catalog';
import {ElectronicsSimulationWorkerClient} from './src/electronics/simulation-worker-client';

import {advanceElectronicsToHorizon,resetElectronicsTimedState} from '@asa-lab/electronics/engine';
import * as Blocks from 'scratch-blocks';import {generateArduinoCode,registerArduinoBlocks} from './src/electronics/arduino-blocks';
configureProductionLibrary(${JSON.stringify(catalog)});
window.probe={responses:[],errors:[],renders:0};
const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(){super(URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'})));this.addEventListener('message',e=>window.probe.responses.push(e.data));}};
function cpp(a){return '#include <Servo.h>\\nServo motor;void setup(){motor.attach(9);motor.write('+a+');}void loop(){delay(100);}';}
function circuit(a=0,power=true,raw=false){const source=raw?'void setup(){pinMode(9,OUTPUT);}void loop(){digitalWrite(9,HIGH);delayMicroseconds('+a+');digitalWrite(9,LOW);delayMicroseconds('+(20000-a)+');}':cpp(a);return {schemaVersion:4,components:[{id:'uno',kind:'visual',componentTypeId:'arduino-uno',value:5,position:{x:0,y:0},pinIds:['d9','d13','power-5v','power-3v3','power-gnd-1'],stateProperties:{arduinoSource:source}},{id:'servo',kind:'visual',componentTypeId:'servo-motor',variantId:'servo-motor',value:0,position:{x:400,y:40},pinIds:['gnd','vcc','signal']}],connections:[...(power?[['power-5v','vcc']]:[]),['power-gnd-1','gnd'],['d9','signal']].map(([a,b],i)=>({id:'w'+i,from:{componentId:'uno',terminal:a},to:{componentId:'servo',terminal:b}})),viewport:{x:0,y:0,zoom:1},simulation:{running:false,maxIterations:24}};}
function blockSource(a){registerArduinoBlocks();Blocks.Events.disable();const w=new Blocks.Workspace();try{const loop=w.newBlock('asa_loop'),write=w.newBlock('asa_servo_write'),pin=w.newBlock('asa_pin'),angle=w.newBlock('asa_number');pin.setFieldValue('9','VALUE');angle.setFieldValue(String(a),'VALUE');write.getInput('PIN').connection.connect(pin.outputConnection);write.getInput('ANGLE').connection.connect(angle.outputConnection);loop.getInput('DO').connection.connect(write.previousConnection);return generateArduinoCode(w);}finally{w.dispose();Blocks.Events.enable();}}
function potSource(blocks){
if(!blocks)return '#include <Servo.h>\\nServo motor;void setup(){motor.attach(9);}void loop(){motor.write(map(analogRead(A0),0,1023,0,180));delay(20);}';
registerArduinoBlocks();Blocks.Events.disable();const w=new Blocks.Workspace();try{
const number=n=>{const b=w.newBlock('asa_number');b.setFieldValue(String(n),'VALUE');return b;};
const loop=w.newBlock('asa_loop'),write=w.newBlock('asa_servo_write'),pin=w.newBlock('asa_pin'),map=w.newBlock('asa_map'),read=w.newBlock('asa_analog_read'),analog=w.newBlock('asa_analog_pin'),wait=w.newBlock('asa_wait');
pin.setFieldValue('9','VALUE');analog.setFieldValue('A0','VALUE');read.getInput('PIN').connection.connect(analog.outputConnection);write.getInput('PIN').connection.connect(pin.outputConnection);
map.getInput('VALUE').connection.connect(read.outputConnection);for(const [key,n] of [['FROM_LOW',0],['FROM_HIGH',1023],['TO_LOW',0],['TO_HIGH',180]])map.getInput(key).connection.connect(number(n).outputConnection);
write.getInput('ANGLE').connection.connect(map.outputConnection);wait.setFieldValue('MILLISECONDS','UNIT');wait.getInput('TIME').connection.connect(number(20).outputConnection);write.nextConnection.connect(wait.previousConnection);loop.getInput('DO').connection.connect(write.previousConnection);return generateArduinoCode(w);
}finally{w.dispose();Blocks.Events.enable();}}
function potCircuit(blocks){const doc=circuit();doc.components[0].stateProperties.arduinoSource=potSource(blocks);doc.components[0].pinIds.push('a0');doc.components[1].position={x:1000,y:40};doc.components.push({id:'pot',kind:'potentiometer',componentTypeId:'potentiometer',value:10000,wiperPosition:0.5,position:{x:800,y:220},pinIds:['a','b','wiper']});for(const [a,b] of [['power-5v','a'],['power-gnd-1','b'],['a0','wiper']])doc.connections.push({id:'pot-'+b,from:{componentId:'uno',terminal:a},to:{componentId:'pot',terminal:b}});return doc;}
let current=circuit();let wb;let refresh;let direct=null;let isDirect=false;let epoch=0;
api.me=async()=>({ok:true,status:200,data:{authenticated:true,user:{id:'pupil'}}});
api.openProject=async id=>({ok:true,status:200,data:{project:{id,moduleKey:'electronics',title:id,scope:'personal',classroomId:null,status:'active'},draft:{projectId:id,document:current,revision:1,updatedAt:''},versions:[],result:null}});
api.saveDraft=async()=>({ok:true,status:200,data:{revision:2,updatedAt:''}});
function Demo(){wb=useElectronicsWorkbench('servo-project-'+epoch,'pupil');window.probe.renders++;const [,set]=React.useState(0);refresh=()=>set(n=>n+1);return <NativeOpticalProvider port={wb.nativeOpticalPresentation}>{isDirect?<svg width="340" height="700"><DirectVisual entry={catalogEntry(current.components[1])} component={current.components[1]} width={180} height={460} visualState="default" simulationRunning={true} simulationTimeMs={5} result={direct}/></svg>:wb.document?<div style={{height:700,width:'100%'}}><WorkbenchStage controller={wb} showGrid={true}/></div>:null}</NativeOpticalProvider>;}
const root=createRoot(document.getElementById('app'));root.render(<Demo key={epoch}/>);
const client=new ElectronicsSimulationWorkerClient();let gen;
window.fixture={status:()=>wb?.project?.id==='servo-project-'+epoch?wb.status:'loading',start:()=>{wb.fitScene();return wb.toggleSimulation()},stop:()=>wb.toggleSimulation(),reset:()=>wb.resetArduinoRuntime('uno'),edit:a=>wb.updateArduinoProgram('uno',{arduinoSource:cpp(a)}),state:()=>({running:wb?.simulationRunning,result:wb?.nativeOpticalPresentation.getSnapshot().committed?.result,hookResult:wb?.result,renders:window.probe.renders,message:wb?.simulationMessage}),
async direct(a,power=true,raw=false,blocks=false){isDirect=true;current=circuit(a,power,raw);if(blocks)current.components[0].stateProperties.arduinoSource=blockSource(a);current.simulation.running=true;gen=client.beginGeneration('direct');const r=await client.advance(gen,current,resetElectronicsTimedState(),5000);direct=r.result?.components.find(c=>c.componentId==='servo');window.probe.direct=r;refresh();return {...r,source:current.components[0].stateProperties.arduinoSource};},
load(a,blocks=false){current=circuit(a);if(blocks)current.components[0].stateProperties.arduinoSource=blockSource(a);isDirect=false;epoch++;root.render(<Demo key={epoch}/>);},
loadPot(blocks){current=potCircuit(blocks);isDirect=false;epoch++;root.render(<Demo key={epoch}/>);},
potSnapshot:()=>{const committed=wb.nativeOpticalPresentation.getSnapshot().committed;const session='servo-project-'+epoch;const activeGeneration=Math.max(0,...window.probe.responses.filter(r=>r.projectSessionId===session).map(r=>r.generationId));const lastResponse=window.probe.responses.findLast(r=>r.projectSessionId===session&&r.generationId===activeGeneration&&r.advance?.executionStatus==='ready'&&r.metrics?.simulationInputDigest===committed?.result?.simulationInputDigest&&r.advance?.committedHorizonMicroseconds===committed?.frame?.atMicroseconds);return {document:wb.document,result:committed?.result,committedAtMicroseconds:committed?.frame?.atMicroseconds,lastResponse};},
loadSeven(active){current=rawDisplayCircuit({active});current={...current,components:current.components.map(c=>({...c,position:c.id==='display'?{x:400,y:40}:c.position})),simulation:{...current.simulation,running:false}};isDirect=false;epoch++;root.render(<Demo key={epoch}/>);},
editSeven:active=>wb.updateArduinoProgram('uno',{arduinoSource:rawDisplaySource(OWNER_HIGH_WRITES,active)}),
parity(){let state=resetElectronicsTimedState(),r;do{r=advanceElectronicsToHorizon(current,{state,requestedHorizonMicroseconds:5000,maxEvents:1});state=JSON.parse(JSON.stringify(r.state));}while(r.executionStatus==='yielded');return JSON.stringify(state)===JSON.stringify(window.probe.direct.state);},
hook:()=>{isDirect=false;refresh();},cpp,circuit,dispose:()=>client.dispose()};
`;
const ui = (
  await build({
    ...opts,
    stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: source },
  })
).outputFiles[0].text;
const browser = await chromium.launch({ headless: true });
const all = [];
async function checkPotentiometer(page, width) {
  const samples = [];
  for (const blocks of [false, true]) {
    await page.evaluate((b) => window.fixture.loadPot(b), blocks);
    await page.waitForFunction(() => window.fixture.status() === 'ready');
    const originalSource = await page.evaluate(
      () => window.fixture.potSnapshot().document.components[0].stateProperties.arduinoSource,
    );
    assert.match(originalSource, /analogRead\(A0\)/);
    await page.evaluate(() => window.fixture.start());
    await page.waitForSelector('.workbench-potentiometer-hit');
    for (const position of [0, 0.5, 1]) {
      const target = await page.locator('.workbench-potentiometer-hit').evaluate((circle, p) => {
        const matrix = circle.getScreenCTM();
        // Real production pointer mapping centre: half width and 45% height.
        const visual = circle.parentElement.querySelector('.workbench-production-visual');
        const width = Number(visual.getAttribute('width')),
          height = Number(visual.getAttribute('height'));
        const angle = ((p * 270 - 135 - 90) * Math.PI) / 180;
        const point = new DOMPoint(
          width / 2 + Math.cos(angle) * Number(circle.getAttribute('r')) * 0.7,
          height * 0.45 + Math.sin(angle) * Number(circle.getAttribute('r')) * 0.7,
        ).matrixTransform(matrix);
        const hit = document.elementFromPoint(point.x, point.y);
        return {
          x: point.x,
          y: point.y,
          hit: hit?.outerHTML,
          circle: circle.outerHTML,
          visual: visual.outerHTML.slice(0, 220),
        };
      }, position);
      assert.match(
        target.hit,
        /workbench-potentiometer-hit/,
        'native target must hit the actual unobstructed Stage knob',
      );
      const wallStart = Date.now();
      await page.mouse.move(target.x, target.y);
      await page.mouse.down();
      await page.mouse.up();
      try {
        await page.waitForFunction(
          (p) => {
            const s = window.fixture.potSnapshot(),
              pot = s.document.components.find((c) => c.id === 'pot'),
              r = s.result;
            if (Math.abs(pot.wiperPosition - p) > 0.001 || !r?.solved) return false;
            const continuation = s.lastResponse?.advance?.state?.continuation?.serializedState;
            const board = continuation
              ? JSON.parse(continuation).boards.find((b) => b.componentId === 'uno')?.runtime
              : null;
            const servo = Object.values(board?.servo?.objects ?? {})[0];
            const voltages =
              r.components.find((c) => c.componentId === 'uno')?.terminalVoltages ?? {};
            const gnd = Number(voltages['power-gnd-1'] ?? 0),
              vcc = Number(voltages['power-5v'] ?? 5) - gnd;
            const adc = Math.round(
              (Math.max(0, Math.min(vcc, Number(voltages.a0) - gnd)) / vcc) * 1023,
            );
            if (Math.abs(adc - 1023 * (1 - p)) > 1) return false;
            const expected = Math.trunc((adc * 180) / 1023);
            const model = r.components.find((c) => c.componentId === 'servo');
            const decoded = ((Math.round(544 + (1856 * expected) / 180) - 544) * 180) / 1856;
            return (
              servo?.commandedAngle === expected &&
              Math.abs(model?.servoAngleDegrees - decoded) < 1e-6 &&
              document
                .querySelector('[data-testid="servo-motor-horn"]')
                ?.getAttribute('transform') ===
                'rotate(' + (model.servoAngleDegrees - 90) + ' 114.5 314)'
            );
          },
          position,
          { timeout: 30000 },
        );
      } catch (error) {
        const failure = {
          width,
          blocks,
          position,
          source: originalSource,
          target,
          wallElapsedMs: Date.now() - wallStart,
          snapshot: await page.evaluate(() => window.fixture.potSnapshot()),
          error: String(error),
        };
        await writeFile(
          resolve(output, 'servo-potentiometer-784-failure.json'),
          JSON.stringify(failure, null, 2),
        );
        throw error;
      }
      const snapshot = await page.evaluate(() => window.fixture.potSnapshot());
      const r = snapshot.result,
        clock = JSON.parse(snapshot.lastResponse.advance.state.continuation.serializedState),
        board = clock.boards.find((b) => b.componentId === 'uno').runtime,
        servo = Object.values(board.servo.objects)[0];
      const voltages = r.components.find((c) => c.componentId === 'uno').terminalVoltages;
      const ground = Number(voltages['power-gnd-1'] ?? 0),
        supply = Number(voltages['power-5v']) - ground;
      const adc = Math.round(
          (Math.max(0, Math.min(supply, Number(voltages.a0) - ground)) / supply) * 1023,
        ),
        angle = Math.trunc((adc * 180) / 1023);
      assert.ok(
        Math.abs(adc - 1023 * (1 - position)) <= 1,
        'committed measured ADC must reflect this live wiper position',
      );
      assert.equal(snapshot.document.components[0].stateProperties.arduinoSource, originalSource);
      assert.equal(servo.commandedAngle, angle);
      assert.equal(servo.pulseWidthMicroseconds, Math.round(544 + (1856 * angle) / 180));
      assert.ok(supply >= 4.5 && supply <= 5.5);
      assert.equal(r.quality.finite, true);
      assert.equal(r.quality.passed, true);
      assert.ok(r.quality.maxKclResidualAmp <= r.quality.kclToleranceAmp);
      assert.ok(r.quality.maxSourceVoltageResidualVolt <= r.quality.sourceVoltageToleranceVolt);
      assert.ok(
        Math.abs(
          r.components.find((c) => c.componentId === 'servo').servoAngleDegrees -
            ((servo.pulseWidthMicroseconds - 544) * 180) / 1856,
        ) < 1e-6,
      );
      samples.push({
        width,
        blocks,
        position,
        actualWiper: snapshot.document.components.find((c) => c.id === 'pot').wiperPosition,
        source: originalSource,
        adc,
        angle,
        supply,
        pulseWidthMicroseconds: servo.pulseWidthMicroseconds,
        model: r.components.find((c) => c.componentId === 'servo'),
        quality: r.quality,
        modelTimeMs: clock.reachedMicroseconds / 1000,
        correlation: {
          projectSessionId: snapshot.lastResponse.projectSessionId,
          generationId: snapshot.lastResponse.generationId,
          committedAtMicroseconds: snapshot.committedAtMicroseconds,
          responseHorizonMicroseconds: snapshot.lastResponse.advance.committedHorizonMicroseconds,
          inputDigest: r.simulationInputDigest,
          responseInputDigest: snapshot.lastResponse.metrics.simulationInputDigest,
        },
        wallElapsedMs: Date.now() - wallStart,
        horn: await page.locator('[data-testid="servo-motor-horn"]').getAttribute('transform'),
        document: snapshot.document,
      });
    }
  }
  return { width, samples };
}
async function checkHornClipping(page, width) {
  const baseline = process.argv.includes('--horn-clip-baseline');
  const samples = [];
  for (const angle of [0, 45, 90, 135, 180]) {
    await page.evaluate((a) => window.fixture.load(a), angle);
    await page.waitForFunction(() => window.fixture.status() === 'ready');
    await page.evaluate(() => window.fixture.start());
    await page.waitForFunction(
      (a) =>
        window.fixture.state().result?.components.find((c) => c.componentId === 'servo')
          ?.servoAngleDegrees === a &&
        document.querySelector('[data-testid="servo-motor-horn"]')?.getAttribute('transform') ===
          'rotate(' + (a - 90) + ' 114.5 314)',
      angle,
    );
    // Native hit testing respects SVG viewport clipping. Temporarily opt only the
    // horn into hit testing; the production visual normally has pointerEvents=none.
    const probe = () =>
      page.evaluate(() => {
        const svg = document.querySelector('[data-testid="servo-motor-runtime"]');
        const horn = svg.querySelector('[data-testid="servo-motor-horn"]');
        const previous = horn.style.pointerEvents;
        horn.style.pointerEvents = 'all';
        try {
          const matrix = horn.getScreenCTM();
          const tips = [145, 483].map((y) => {
            const point = new DOMPoint(114.5, y).matrixTransform(matrix);
            return {
              x: point.x,
              y: point.y,
              visible: document.elementsFromPoint(point.x, point.y).includes(horn),
            };
          });
          const rect = (id) => {
            const box = svg.querySelector('use[href$="#' + id + '"]').getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height };
          };
          return { tips, body: rect('body'), connector: rect('connector') };
        } finally {
          horn.style.pointerEvents = previous;
        }
      });
    const actual = await probe();
    const hidden = await page.addStyleTag({
      content: 'svg[data-servo-angle-degrees]{overflow:hidden!important}',
    });
    const clipped = await probe();
    await hidden.evaluate((el) => el.remove());
    assert.deepEqual(actual.body, clipped.body);
    assert.deepEqual(actual.connector, clipped.connector);
    assert.deepEqual(
      actual.tips.map(({ x, y }) => [x, y]),
      clipped.tips.map(({ x, y }) => [x, y]),
    );
    if (baseline) assert.deepEqual(actual.tips, clipped.tips);
    else
      assert.ok(
        actual.tips.every((tip) => tip.visible),
        `${width}/${angle}: both horn tips must render`,
      );
    if (angle !== 90)
      assert.ok(
        clipped.tips.some((tip) => !tip.visible),
        `${width}/${angle}: clipping control must lose a tip`,
      );
    else assert.ok(clipped.tips.every((tip) => tip.visible));
    const phase = baseline ? 'before' : 'after';
    await page.screenshot({ path: resolve(output, `horn-${phase}-${width}-${angle}.png`) });
    samples.push({ angle, actual, clipped });
  }
  return { width, phase: baseline ? 'before' : 'after', samples };
}
async function checkSeven(page) {
  await page.evaluate(() => window.fixture.loadSeven('bc'));
  await page.waitForFunction(() => window.fixture.status() === 'ready');
  await page.evaluate(() => window.fixture.start());
  const samples = [];
  for (const active of ['bc', 'abcdefgdp']) {
    if (active !== 'bc') await page.evaluate((a) => window.fixture.editSeven(a), active);
    await page.waitForFunction((active) => {
      const b = window.fixture
        .state()
        .result?.components.find((c) => c.componentId === 'display')?.branchBrightness;
      return (
        b &&
        Object.entries(b).every(
          ([s, v]) =>
            v > 0 === (s === 'dp' ? active.includes('dp') : active.replace('dp', '').includes(s)),
        )
      );
    }, active);
    await page.waitForFunction(() => {
      const b = window.fixture
        .state()
        .result?.components.find((c) => c.componentId === 'display')?.branchBrightness;
      return (
        b &&
        [...document.querySelectorAll('[data-segment]')].every(
          (e) => Number(e.getAttribute('opacity')) === b[e.getAttribute('data-segment')] / 100,
        )
      );
    });
    samples.push({
      active,
      model: await page.evaluate(
        () =>
          window.fixture.state().result.components.find((c) => c.componentId === 'display')
            .branchBrightness,
      ),
      visible: await page
        .locator('[data-segment]')
        .evaluateAll((es) =>
          Object.fromEntries(
            es.map((e) => [e.getAttribute('data-segment'), Number(e.getAttribute('opacity'))]),
          ),
        ),
    });
  }
  return samples;
}
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/assets/')) {
        try {
          return route.fulfill({
            body: await readFile(resolve('apps/web/public', '.' + url.pathname)),
            contentType: url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'application/json',
          });
        } catch {
          return route.abort();
        }
      }
      return route.fulfill({
        contentType: 'text/html',
        body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div>',
      });
    });
    await page.goto('https://servo-fixture.invalid/');
    await page.addScriptTag({ content: ui });
    await page.waitForFunction(() => window.fixture?.status() === 'ready');
    await page.addStyleTag({
      content:
        (await readFile('apps/web/src/electronics/workbench.css', 'utf8')) +
        '\n#app{--wb-library-width:0px}.workbench-stage{position:relative;height:700px;width:100%}',
    });
    if (process.argv.includes('--potentiometer-only')) {
      all.push(await checkPotentiometer(page, width));
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (process.argv.includes('--horn-clip-only')) {
      all.push(await checkHornClipping(page, width));
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (process.argv.includes('--seven-spotcheck')) {
      all.push({ width, samples: await checkSeven(page) });
      await page.close();
      continue;
    }
    const receipts = [];
    for (const blocks of [false, true])
      for (const angle of [0, 45, 90, 135, 180, ...(blocks ? [] : ['45+90'])]) {
        const result = await page.evaluate(
          ({ angle, blocks }) => window.fixture.direct(angle, true, false, blocks),
          { angle, blocks },
        );
        const expected = angle === '45+90' ? 135 : angle;
        await page.waitForFunction(
          (a) =>
            document
              .querySelector('[data-testid="servo-motor-horn"]')
              ?.getAttribute('transform') ===
            'rotate(' + (a - 90) + ' 114.5 314)',
          expected,
        );
        assert.equal(
          result.result.components.find((c) => c.componentId === 'servo').servoAngleDegrees,
          expected,
        );
        const runtime = JSON.parse(result.state.continuation.serializedState);
        assert.equal(
          runtime.servoMotors[0].runtime.lastValidPulseWidthMicroseconds,
          544 + (1856 * expected) / 180,
        );
        if (!blocks) assert.equal(await page.evaluate(() => window.fixture.parity()), true);
        receipts.push({
          blocks,
          angle,
          source: result.source,
          model: result.result?.components.find((c) => c.componentId === 'servo'),
          runtime,
          transform: await page
            .locator('[data-testid="servo-motor-horn"]')
            .getAttribute('transform'),
        });
      }
    // digitalWrite/statement scheduling contributes two accepted microseconds to HIGH.
    // Requesting pulse-2 below produces the measured exact reference, without a tolerance change.
    const raw = [];
    for (const pulse of [544, 1008, 1472, 1936, 2400, 500, 2401]) {
      const result = await page.evaluate((p) => window.fixture.direct(p - 2, true, true), pulse);
      const runtime = JSON.parse(result.state.continuation.serializedState).servoMotors[0].runtime;
      const expected = pulse < 544 || pulse > 2400 ? 90 : ((pulse - 544) * 180) / 1856;
      assert.ok(
        Math.abs(
          result.result.components.find((c) => c.componentId === 'servo').servoAngleDegrees -
            expected,
        ) < 1e-6,
      );
      raw.push({ pulse, runtime });
    }
    const unpowered = await page.evaluate(() => window.fixture.direct(180, false));
    assert.equal(
      unpowered.result.components.find((c) => c.componentId === 'servo').servoAngleDegrees,
      90,
    );
    const waitAngle = async (angle) =>
      page.waitForFunction(
        (a) =>
          window.fixture.state().result?.components.find((c) => c.componentId === 'servo')
            ?.servoAngleDegrees === a &&
          document.querySelector('[data-testid="servo-motor-horn"]')?.getAttribute('transform') ===
            'rotate(' + (a - 90) + ' 114.5 314)',
        angle,
      );
    const hooks = [];
    for (const blocks of [false, true])
      for (const angle of [0, 45, 90, 135, 180]) {
        await page.evaluate(({ angle, blocks }) => window.fixture.load(angle, blocks), {
          angle,
          blocks,
        });
        await page.waitForFunction(() => window.fixture.status() === 'ready');
        await page.evaluate(() => window.fixture.start());
        await waitAngle(angle);
        hooks.push({
          blocks,
          angle,
          committed: await page.evaluate(
            () =>
              window.fixture.state().result?.components.find((c) => c.componentId === 'servo')
                ?.servoAngleDegrees,
          ),
          transform: await page
            .locator('[data-testid="servo-motor-horn"]')
            .getAttribute('transform'),
        });
      }
    await page.evaluate(() => window.fixture.load(0));
    await page.waitForFunction(() => window.fixture.status() === 'ready');
    await page.evaluate(() => window.fixture.start());
    await waitAngle(0);
    await page.evaluate(() => window.fixture.stop());
    await page.waitForFunction(() => !window.fixture.state().running);
    assert.equal(
      await page.locator('[data-testid="servo-motor-horn"]').getAttribute('transform'),
      'rotate(0 114.5 314)',
    );
    await page.evaluate(() => window.fixture.start());
    await waitAngle(0);
    await page.evaluate(() => window.fixture.reset());
    await waitAngle(0);
    await page.evaluate(() => window.fixture.edit(135));
    await waitAngle(135);
    await page.screenshot({ path: resolve(output, 'servo-' + width + '.png') });
    const seven = await checkSeven(page);
    await page.screenshot({ path: resolve(output, 'seven-' + width + '.png') });
    assert.deepEqual(errors, []);
    all.push({
      width,
      receipts,
      raw,
      hooks,
      seven,
      stopRunResetSourceEdit: true,
      missingPower: true,
      jsonBudgetParity: true,
      errors,
    });
    await page.close();
  }
  const receiptName = process.argv.includes('--potentiometer-only')
    ? 'servo-potentiometer-784.json'
    : process.argv.includes('--horn-clip-only')
      ? `horn-${process.argv.includes('--horn-clip-baseline') ? 'before' : 'after'}-receipts.json`
      : 'receipts.json';
  await writeFile(resolve(output, receiptName), JSON.stringify(all, null, 2));
  console.log(
    process.argv.includes('--potentiometer-only')
      ? 'PASS live Stage potentiometer → physical ADC → fixed text/Blockly → PWM → Servo/horn 1440/390.'
      : process.argv.includes('--horn-clip-only')
        ? 'PASS Servo native Stage horn clipping: five angles at 1440/390, actual CSS and hidden-viewport control.'
        : 'PASS Servo real Worker/client/full workbench hook/Stage owner horn at 1440/390; API/static fixture ports, no server/DB/SaveCAS/listening ports.',
  );
} finally {
  await browser.close();
}
