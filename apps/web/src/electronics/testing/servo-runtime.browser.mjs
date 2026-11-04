// Real Chromium Worker/client + mounted workbench hook + production Stage/owner SVG.
// Project API responses and static assets are fixture ports; no server or listening ports.
/* global window, document, URL, console, DOMPoint */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import process from 'node:process';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const alias = {
  '@asa-lab/electronics/rendering': resolve('contexts/electronics/rendering.ts'),
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
import {rawDisplayCircuit,rawDisplaySource,OWNER_HIGH_WRITES,RAW_DISPLAY_PINS} from '../../contexts/electronics/testing/fixtures/raw-seven-segment';
import {sevenSegmentDiodeMatrix} from '../../contexts/electronics/testing/fixtures/seven-segment-diode-matrix';
import {helperDisplayCounterSource} from '../../contexts/electronics/testing/fixtures/arduino-helper-display-counter';
import {SWITCH_DISPLAY_SOURCE} from '../../contexts/electronics/testing/fixtures/arduino-switch-display';
import {arduinoSevenSegmentMatrix,matrixLinearSource,matrixCommands,outputCommonMatrix,gpioCommonMatrix,outputCommonCommands} from '../../contexts/electronics/testing/fixtures/arduino-seven-segment-matrix';
import {configureProductionLibrary} from './src/electronics/production-manifest-adapter';
import {catalogEntry} from './src/electronics/component-catalog';
import {ElectronicsSimulationWorkerClient} from './src/electronics/simulation-worker-client';

import {advanceElectronicsToHorizon,resetElectronicsTimedState} from '@asa-lab/electronics/engine';
import * as Blocks from 'scratch-blocks';import {generateArduinoCode,registerArduinoBlocks} from './src/electronics/arduino-blocks';
configureProductionLibrary(${JSON.stringify(catalog)});
window.probe={responses:[],errors:[],renders:0};
const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{constructor(){super(URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'})));this.addEventListener('message',e=>window.probe.responses.push(e.data));}postMessage(message){super.postMessage(message);if(message.kind==='advance'&&window.probe.stopOnAdvance){const stop=window.probe.stopOnAdvance;window.probe.stopOnAdvance=null;stop(message);}}};
function cpp(a){return '#include <Servo.h>\\nServo motor;void setup(){motor.attach(9);motor.write('+a+');}void loop(){delay(100);}';}
function circuit(a=0,power=true,raw=false){const source=raw?'void setup(){pinMode(9,OUTPUT);}void loop(){digitalWrite(9,HIGH);delayMicroseconds('+a+');digitalWrite(9,LOW);delayMicroseconds('+(20000-a)+');}':cpp(a);return {schemaVersion:4,components:[{id:'uno',kind:'visual',componentTypeId:'arduino-uno',value:5,position:{x:0,y:0},pinIds:['d9','d13','power-5v','power-3v3','power-gnd-1'],stateProperties:{arduinoSource:source}},{id:'servo',kind:'visual',componentTypeId:'servo-motor',variantId:'servo-motor',value:0,position:{x:400,y:40},pinIds:['gnd','vcc','signal']}],connections:[...(power?[['power-5v','vcc']]:[]),['power-gnd-1','gnd'],['d9','signal']].map(([a,b],i)=>({id:'w'+i,from:{componentId:'uno',terminal:a},to:{componentId:'servo',terminal:b}})),viewport:{x:0,y:0,zoom:1},simulation:{running:false,maxIterations:24}};}
function blockSource(a){registerArduinoBlocks();Blocks.Events.disable();const w=new Blocks.Workspace();try{const loop=w.newBlock('asa_loop'),write=w.newBlock('asa_servo_write'),pin=w.newBlock('asa_pin'),angle=w.newBlock('asa_number');pin.setFieldValue('9','VALUE');angle.setFieldValue(String(a),'VALUE');write.getInput('PIN').connection.connect(pin.outputConnection);write.getInput('ANGLE').connection.connect(angle.outputConnection);loop.getInput('DO').connection.connect(write.previousConnection);return generateArduinoCode(w);}finally{w.dispose();Blocks.Events.enable();}}
function sevenParitySource(active,commonAnode,blocks){
if(!blocks)return {source:rawDisplaySource(RAW_DISPLAY_PINS,active,commonAnode),blockTypes:[]};
registerArduinoBlocks();Blocks.Events.disable();const w=new Blocks.Workspace();try{
const loop=w.newBlock('asa_loop');let previous=null;
for(const [index,pinNumber] of RAW_DISPLAY_PINS.entries()){
const segment=['a','b','c','d','e','f','g','dp'][index];
const lit=segment==='dp'?active.includes('dp'):active.replace('dp','').includes(segment);
const write=w.newBlock('asa_digital_write'),pin=w.newBlock('asa_pin'),level=w.newBlock('asa_level');
pin.setFieldValue(String(pinNumber),'VALUE');level.setFieldValue(lit!==commonAnode?'HIGH':'LOW','LEVEL');
write.getInput('PIN').connection.connect(pin.outputConnection);write.getInput('LEVEL').connection.connect(level.outputConnection);
if(previous)previous.nextConnection.connect(write.previousConnection);else loop.getInput('DO').connection.connect(write.previousConnection);previous=write;
}
return {source:generateArduinoCode(w),blockTypes:w.getAllBlocks(false).map(b=>b.type).sort()};
}finally{w.dispose();Blocks.Events.enable();}}
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
function multiCircuit(){const doc=circuit();doc.components[0].pinIds.push('d10');doc.components[0].stateProperties.arduinoSource='#include <Servo.h>\\nServo left;Servo right;void setup(){left.attach(9);right.attach(10);}void loop(){left.write(0);right.write(180);delay(250);left.write(180);right.write(0);delay(250);}';doc.components[1].position={x:800,y:20};doc.components.push({...doc.components[1],id:'servo-right',position:{x:1100,y:20}});for(const [a,b] of [['power-5v','vcc'],['power-gnd-1','gnd'],['d10','signal']])doc.connections.push({id:'right-'+b,from:{componentId:'uno',terminal:a},to:{componentId:'servo-right',terminal:b}});return doc;}
function blockCounter(count){registerArduinoBlocks();Blocks.Events.disable();const w=new Blocks.Workspace();try{
const variables=new Map([...Array.from({length:count},(_,i)=>'d'+i),'lastTick'].map(name=>[name,w.getVariableMap().createVariable(name)]));
const block=t=>w.newBlock(t),connect=(b,k,v)=>{b.getInput(k).connection.connect(v.outputConnection);return b;};
const number=v=>{const b=block('asa_number');b.setFieldValue(String(v),'VALUE');return b;};
const variable=name=>{const b=block('asa_var_get');b.setFieldValue(variables.get(name).getId(),'NAME');return b;};
const binary=(type,a,b)=>connect(connect(block(type),'A',a),'B',b);
const chain=list=>{for(let i=1;i<list.length;i++)list[i-1].nextConnection.connect(list[i].previousConnection);return list[0];};
const set=(name,value,change=false)=>{const b=block(change?'asa_var_change':'asa_var_set');b.setFieldValue(variables.get(name).getId(),'NAME');return connect(b,'VALUE',value);};
const conditional=(condition,list)=>{const b=connect(block('asa_if'),'CONDITION',condition);b.getInput('DO').connection.connect(chain(list).previousConnection);return b;};
const write=(pin,value)=>{const p=block('asa_pin');p.setFieldValue(String(pin),'VALUE');return connect(connect(block('asa_digital_write'),'PIN',p),'LEVEL',value);};
const level=high=>{const b=block('asa_level');b.setFieldValue(high?'HIGH':'LOW','LEVEL');return b;};
const millis=()=>block('asa_millis');const setup=block('asa_setup'),loop=block('asa_loop');
setup.getInput('DO').connection.connect(chain([...Array.from({length:count},(_,i)=>set('d'+i,number(i?9:8))),set('lastTick',millis())]).previousConnection);
const digits=['abcdef','bc','abdeg','abcdg','bcfg','acdfg','acdefg','abc','abcdefg','abcdfg'],segments=['a','b','c','d','e','f','g','dp'],commands=[];
for(let digit=0;digit<count;digit++){for(let i=0;i<count;i++)commands.push(write(10+i,level(false)));for(let i=0;i<8;i++){const choices=digits.flatMap((pattern,value)=>pattern.includes(segments[i])?[binary('asa_compare_eq',variable('d'+(count-digit-1)),number(value))]:[]);commands.push(write(2+i,choices.length?choices.reduce((a,b)=>binary('asa_logic_or',a,b)):level(false)));}commands.push(write(10+digit,level(true)));const wait=connect(block('asa_wait'),'TIME',number(2));wait.setFieldValue('MILLISECONDS','UNIT');commands.push(wait,write(10+digit,level(false)));}
let carry;for(let i=count-1;i>=0;i--)carry=conditional(binary('asa_compare_gt',variable('d'+i),number(9)),[set('d'+i,number(0)),...(i+1<count?[set('d'+(i+1),number(1),true),carry]:[])]);
commands.push(conditional(binary('asa_compare_gt',binary('asa_math_minus',millis(),variable('lastTick')),number(39)),[set('d0',number(1),true),carry,set('lastTick',millis())]));loop.getInput('DO').connection.connect(chain(commands).previousConnection);
return {source:generateArduinoCode(w),blockTypes:w.getAllBlocks(false).map(b=>b.type).sort(),blockCount:w.getAllBlocks(false).length};
}finally{w.dispose();Blocks.Events.enable();}}
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
pendingStop:()=>new Promise(resolve=>{window.probe.stopOnAdvance=request=>{const before=window.fixture.potSnapshot();wb.toggleSimulation();resolve({requestId:request.requestId,requestGeneration:request.generationId,projectSessionId:request.projectSessionId,beforeGeneration:before.lastResponse?.generationId,requestedWhileAdvanceInFlight:true});};}),
loadMulti(){current=multiCircuit();isDirect=false;epoch++;root.render(<Demo key={epoch}/>);},
loadButtons(saved){current=saved??sevenSegmentDiodeMatrix();isDirect=false;epoch++;root.render(<Demo key={epoch}/>);return {document:current,projectSessionId:'servo-project-'+epoch};},
loadHelperCounter(count,helpers){const generated=helpers==='blocks'?blockCounter(count):null;current=arduinoSevenSegmentMatrix(count,helpers==='switch'?SWITCH_DISPLAY_SOURCE:generated?.source??helperDisplayCounterSource(count,helpers));isDirect=false;epoch++;root.render(<Demo key={epoch}/>);return {document:current,projectSessionId:'servo-project-'+epoch,blockTypes:generated?.blockTypes??[],blockCount:generated?.blockCount??0};},
loadMatrix(count,blocks,optical=false,patterns){let blockTypes=[];if(blocks){registerArduinoBlocks();Blocks.Events.disable();const w=new Blocks.Workspace();try{const loop=w.newBlock('asa_loop');let previous=null;for(const command of (optical?matrixCommands(count,patterns):outputCommonCommands(count))){let next;if('waitMs' in command){next=w.newBlock('asa_wait');next.setFieldValue('MILLISECONDS','UNIT');const n=w.newBlock('asa_number');n.setFieldValue(String(command.waitMs),'VALUE');next.getInput('TIME').connection.connect(n.outputConnection);}else{next=w.newBlock('asa_digital_write');const pin=w.newBlock('asa_pin'),level=w.newBlock('asa_level');pin.setFieldValue(String(command.pin),'VALUE');level.setFieldValue(command.high?'HIGH':'LOW','LEVEL');next.getInput('PIN').connection.connect(pin.outputConnection);next.getInput('LEVEL').connection.connect(level.outputConnection);}if(previous)previous.nextConnection.connect(next.previousConnection);else loop.getInput('DO').connection.connect(next.previousConnection);previous=next;}blockTypes=w.getAllBlocks(false).map(b=>b.type).sort();current=optical?arduinoSevenSegmentMatrix(count,generateArduinoCode(w)):outputCommonMatrix(count,generateArduinoCode(w));}finally{w.dispose();Blocks.Events.enable();}}else current=optical?arduinoSevenSegmentMatrix(count,matrixLinearSource(count,patterns)):gpioCommonMatrix(count);isDirect=false;epoch++;root.render(<Demo key={epoch}/>);return {document:current,blockTypes,projectSessionId:'servo-project-'+epoch};},
async multiReplay({saved,document}){const doc=JSON.parse(JSON.stringify(document));const generation=client.beginGeneration('multi-replay');async function through(state,horizon){let result;do{result=await client.advance(generation,doc,JSON.parse(JSON.stringify(state)),horizon);state=result.state;}while(result.executionStatus==='yielded');if(result.executionStatus!=='ready')throw new Error('Short replay fault: '+JSON.stringify(result));return result;}const target=200000;const restored=await through(saved,target);const fresh=await through(resetElectronicsTimedState(),target);return {serializedByteEqual:JSON.stringify(restored.state)===JSON.stringify(fresh.state),restored:restored.state,fresh:fresh.state,target};},
loadPot(blocks){current=potCircuit(blocks);isDirect=false;epoch++;root.render(<Demo key={epoch}/>);},
potSnapshot:()=>{const committed=wb.nativeOpticalPresentation.getSnapshot().committed;const session='servo-project-'+epoch;const activeGeneration=Math.max(0,...window.probe.responses.filter(r=>r.projectSessionId===session).map(r=>r.generationId));const lastResponse=window.probe.responses.findLast(r=>r.projectSessionId===session&&r.generationId===activeGeneration&&r.advance?.executionStatus==='ready'&&r.metrics?.simulationInputDigest===committed?.result?.simulationInputDigest&&r.advance?.committedHorizonMicroseconds===committed?.frame?.atMicroseconds);return {document:wb.document,result:committed?.result,committedAtMicroseconds:committed?.frame?.atMicroseconds,lastResponse};},
editOpticalMatrix:({count,patterns})=>{const source=matrixLinearSource(count,patterns);wb.updateArduinoProgram('uno',{arduinoSource:source});return source;},
matrixOpticalSnapshot:()=>{const optical=wb.nativeOpticalPresentation.getSnapshot().committed;const session='servo-project-'+epoch;const generation=Math.max(0,...window.probe.responses.filter(r=>r.projectSessionId===session).map(r=>r.generationId));const response=window.probe.responses.findLast(r=>r.projectSessionId===session&&r.generationId===generation&&r.advance?.executionStatus==='ready'&&r.metrics?.simulationInputDigest===optical?.result.simulationInputDigest&&r.advance?.result===optical?.result);return {document:wb.document,frame:optical?{token:optical.frame.token,atMicroseconds:optical.frame.atMicroseconds,segments:Object.fromEntries(optical.frame.sevenSegmentBrightness??[])}:null,result:optical?.result,response};},
loadSevenParity({active,commonAnode,blocks}){const program=sevenParitySource(active,commonAnode,blocks);current=rawDisplayCircuit({active,commonAnode,resistanceOhm:1000,source:program.source});current={...current,components:current.components.map(c=>({...c,position:c.id==='display'?{x:400,y:40}:c.position})),simulation:{...current.simulation,running:false}};isDirect=false;epoch++;root.render(<Demo key={epoch}/>);return {...program,projectSessionId:'servo-project-'+epoch};},
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
async function checkMultiServo(page, width) {
  const wallStart = Date.now(),
    checkpoints = [];
  const finite = (value) => {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
    else if (value && typeof value === 'object')
      for (const child of Object.values(value)) finite(child);
  };
  await page.evaluate(() => window.fixture.loadMulti());
  await page.waitForFunction(() => window.fixture.status() === 'ready');
  await page.evaluate(() => window.fixture.start());
  async function checkpoint(target) {
    await page.waitForFunction(
      (target) => {
        const s = window.fixture.potSnapshot(),
          r = s.result,
          response = s.lastResponse;
        if (!response || !r?.solved || s.committedAtMicroseconds < target) return false;
        const t = s.committedAtMicroseconds,
          phase = t % 250000;
        if (phase < 30000 || phase > 220000) return false;
        const clock = JSON.parse(response.advance.state.continuation.serializedState),
          objects = clock.boards[0]?.runtime.servo?.objects;
        const expected = Math.floor(t / 250000) % 2 === 0 ? [0, 180] : [180, 0];
        return [
          ['servo', 'left'],
          ['servo-right', 'right'],
        ].every(([id, key], index) => {
          const model = r.components.find((c) => c.componentId === id),
            decoder = clock.servoMotors.find((c) => c.componentId === id)?.runtime;
          return (
            objects?.[key]?.commandedAngle === expected[index] &&
            decoder?.powered &&
            decoder.angleDegrees === expected[index] &&
            model?.servoAngleDegrees === expected[index] &&
            document
              .querySelector('[data-component-id="' + id + '"] [data-testid="servo-motor-horn"]')
              ?.getAttribute('transform') ===
              'rotate(' + (expected[index] - 90) + ' 114.5 314)'
          );
        });
      },
      target,
      { timeout: 30000 },
    );
    const snapshot = await page.evaluate(() => window.fixture.potSnapshot());
    const { result: r, lastResponse: response } = snapshot,
      clock = JSON.parse(response.advance.state.continuation.serializedState),
      objects = clock.boards[0].runtime.servo.objects;
    const expected =
      Math.floor(snapshot.committedAtMicroseconds / 250000) % 2 === 0 ? [0, 180] : [180, 0];
    assert.equal(Object.keys(objects).length, 2);
    assert.equal(objects.left.pin, 'd9');
    assert.equal(objects.right.pin, 'd10');
    finite(r);
    finite(clock);
    assert.equal(r.quality.finite, true);
    assert.equal(r.quality.passed, true);
    assert.ok(r.quality.maxKclResidualAmp <= r.quality.kclToleranceAmp);
    assert.ok(r.quality.maxSourceVoltageResidualVolt <= r.quality.sourceVoltageToleranceVolt);
    const servos = [];
    for (const [index, [id, key]] of [
      ['servo', 'left'],
      ['servo-right', 'right'],
    ].entries()) {
      const object = objects[key],
        decoder = clock.servoMotors.find((c) => c.componentId === id).runtime,
        model = r.components.find((c) => c.componentId === id),
        pulse = expected[index] === 0 ? 544 : 2400;
      assert.equal(object.commandedAngle, expected[index]);
      assert.equal(object.pulseWidthMicroseconds, pulse);
      assert.equal(object.waveform.frequencyHz, 50);
      assert.equal(object.waveform.dutyDenominator, 20000);
      assert.equal(object.waveform.dutyNumerator, pulse);
      assert.equal(decoder.lastValidPulseWidthMicroseconds, pulse);
      assert.equal(decoder.powered, true);
      assert.equal(model.servoAngleDegrees, expected[index]);
      const vcc = model.terminalVoltages.vcc - model.terminalVoltages.gnd;
      assert.ok(vcc >= 4.5 && vcc <= 5.5);
      const horn = await page
        .locator('[data-component-id="' + id + '"] [data-testid="servo-motor-horn"]')
        .getAttribute('transform');
      assert.equal(horn, 'rotate(' + (expected[index] - 90) + ' 114.5 314)');
      servos.push({ id, key, object, decoder, model, horn });
    }
    const saved = JSON.parse(JSON.stringify(response.advance.state));
    assert.deepEqual(saved, response.advance.state);
    const receipt = {
      targetMicroseconds: target,
      modelMicroseconds: snapshot.committedAtMicroseconds,
      wallElapsedMs: Date.now() - wallStart,
      projectSessionId: response.projectSessionId,
      generationId: response.generationId,
      inputDigest: r.simulationInputDigest,
      responseInputDigest: response.metrics.simulationInputDigest,
      responseHorizonMicroseconds: response.advance.committedHorizonMicroseconds,
      quality: r.quality,
      servos,
      state: saved,
      document: snapshot.document,
      stateSha256: createHash('sha256').update(JSON.stringify(saved)).digest('hex'),
    };
    checkpoints.push(receipt);
    return receipt;
  }
  try {
    const first = await checkpoint(100000);
    // Only the first short continuation is replayed; the 10-second trajectory is never repeated.
    const replay = await page.evaluate((payload) => window.fixture.multiReplay(payload), {
      saved: first.state,
      document: first.document,
    });
    await writeFile(
      resolve(output, 'servo-multi-sustained-786-replay-diagnostic.json'),
      JSON.stringify(replay, null, 2),
    );
    const parsedState = (state) => ({
      ...state,
      continuation: {
        ...state.continuation,
        serializedState: JSON.parse(state.continuation.serializedState),
      },
    });
    assert.deepEqual(parsedState(replay.restored), parsedState(replay.fresh));
    replay.fullParsedStateEqual = true;
    for (let target = 350000; target <= 10100000; target += 250000) await checkpoint(target);
    assert.ok(checkpoints.at(-1).modelMicroseconds >= 10000000);
    const oldGeneration = checkpoints.at(-1).generationId;
    await page.evaluate(() => window.fixture.reset());
    await page.waitForFunction((g) => {
      const s = window.fixture.potSnapshot();
      return s.lastResponse?.generationId > g && s.committedAtMicroseconds < 250000;
    }, oldGeneration);
    const reset = await checkpoint(100000);
    assert.ok(reset.generationId > oldGeneration);
    // Request Stop while the running controller is scheduling Worker advances.
    const pendingStop = await page.evaluate(() => window.fixture.pendingStop());
    await page.waitForFunction(() => !window.fixture.state().running);
    const stopped = await page.evaluate(() => window.fixture.potSnapshot());
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.fixture.state().running), false);
    return {
      width,
      checkpoints,
      replay,
      resetGeneration: reset.generationId,
      pendingStop: { ...pendingStop, stoppedAt: stopped.committedAtMicroseconds },
      wallElapsedMs: Date.now() - wallStart,
    };
  } catch (error) {
    await writeFile(
      resolve(output, 'servo-multi-sustained-786-failure.json'),
      JSON.stringify(
        {
          width,
          error: String(error),
          checkpoints,
          snapshot: await page.evaluate(() => window.fixture.potSnapshot()),
        },
        null,
        2,
      ),
    );
    throw error;
  }
}
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
async function checkSevenParity(page, width) {
  const patterns = [
    'abcdef',
    'bc',
    'abdeg',
    'abcdg',
    'bcfg',
    'acdfg',
    'acdefg',
    'abc',
    'abcdefg',
    'abcdfg',
    'dp',
    '',
  ];
  const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
  const samples = [];
  const finite = (value) => {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
    else if (value && typeof value === 'object')
      for (const item of Object.values(value)) finite(item);
  };
  for (const commonAnode of [false, true])
    for (const [index, active] of patterns.entries())
      for (const blocks of [false, true]) {
        const started = Date.now();
        const loaded = await page.evaluate((options) => window.fixture.loadSevenParity(options), {
          active,
          commonAnode,
          blocks,
        });
        assert.equal(
          loaded.blockTypes.filter((type) => type === 'asa_digital_write').length,
          blocks ? 8 : 0,
        );
        if (blocks) assert.equal(loaded.blockTypes.length, 25);
        await page.waitForFunction(() => window.fixture.status() === 'ready');
        await page.evaluate(() => window.fixture.start());
        try {
          await page.waitForFunction(
            ({ active, source, projectSessionId, commonAnode }) => {
              const s = window.fixture.potSnapshot(),
                r = s.result,
                response = s.lastResponse;
              if (
                !response ||
                response.projectSessionId !== projectSessionId ||
                !r?.solved ||
                !r.quality?.passed ||
                s.committedAtMicroseconds <= 0
              )
                return false;
              if (
                s.document.components.find((c) => c.id === 'uno').stateProperties.arduinoSource !==
                source
              )
                return false;
              const clock = JSON.parse(response.advance.state.continuation.serializedState);
              const board = clock.boards.find((b) => b.componentId === 'uno');
              if (board?.loadedSource !== source || board.runtime.loopIterations < 2) return false;
              if (
                ![4, 6, 7, 8, 9, 10, 11, 12].every((pin, index) => {
                  const segment = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'][index];
                  const lit =
                    segment === 'dp'
                      ? active.includes('dp')
                      : active.replace('dp', '').includes(segment);
                  return (
                    board.runtime.pinModes['d' + pin] === 'OUTPUT' &&
                    board.runtime.outputVoltages['d' + pin] === (lit !== commonAnode ? 5 : 0)
                  );
                })
              )
                return false;
              const b = r.components.find((c) => c.componentId === 'display')?.branchBrightness;
              if (
                !b ||
                !['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].every(
                  (segment) =>
                    b[segment] > 0 ===
                    (segment === 'dp'
                      ? active.includes('dp')
                      : active.replace('dp', '').includes(segment)),
                )
              )
                return false;
              const elements = [
                ...document.querySelectorAll('[data-component-id="display"] [data-segment]'),
              ];
              return (
                elements.length === 8 &&
                elements.every(
                  (e) =>
                    Number(e.getAttribute('opacity')) === b[e.getAttribute('data-segment')] / 100,
                )
              );
            },
            {
              active,
              source: loaded.source,
              projectSessionId: loaded.projectSessionId,
              commonAnode,
            },
            { timeout: 30000 },
          );
          const snapshot = await page.evaluate(() => window.fixture.potSnapshot());
          const {
            document: doc,
            result,
            lastResponse: response,
            committedAtMicroseconds,
          } = snapshot;
          const clock = JSON.parse(response.advance.state.continuation.serializedState);
          const model = result.components.find((c) => c.componentId === 'display');
          finite(result);
          finite(clock);
          assert.equal(result.quality.finite, true);
          assert.equal(result.quality.passed, true);
          assert.ok(result.quality.maxKclResidualAmp <= result.quality.kclToleranceAmp);
          assert.ok(
            result.quality.maxSourceVoltageResidualVolt <=
              result.quality.sourceVoltageToleranceVolt,
          );
          assert.equal(response.projectSessionId, loaded.projectSessionId);
          assert.equal(response.metrics.simulationInputDigest, result.simulationInputDigest);
          assert.equal(response.advance.committedHorizonMicroseconds, committedAtMicroseconds);
          assert.equal(
            doc.components.find((c) => c.id === 'uno').stateProperties.arduinoSource,
            loaded.source,
          );
          assert.equal(
            clock.boards.find((b) => b.componentId === 'uno').loadedSource,
            loaded.source,
          );
          assert.equal(
            doc.components.find((c) => c.id === 'display').stateProperties.commonMode,
            commonAnode ? 'common-anode' : 'common-cathode',
          );
          assert.deepEqual(
            doc.components.filter((c) => c.id.startsWith('r-')).map((c) => c.value),
            Array(8).fill(1000),
          );
          const visible = await page
            .locator('[data-component-id="display"] [data-segment]')
            .evaluateAll((es) =>
              Object.fromEntries(
                es.map((e) => [e.getAttribute('data-segment'), Number(e.getAttribute('opacity'))]),
              ),
            );
          const currents = [],
            brightness = [],
            glyph = [];
          for (const segment of segments) {
            const lit =
              segment === 'dp' ? active.includes('dp') : active.replace('dp', '').includes(segment);
            const current = model.branchCurrents[segment],
              light = model.branchBrightness[segment];
            assert.equal(light > 0, lit);
            assert.equal(current > 0, lit);
            assert.ok(current >= 0 && current < 0.004, segment + ': safe 1kOhm branch');
            assert.equal(visible[segment], light / 100);
            currents.push(current);
            brightness.push(light);
            glyph.push(lit);
          }
          const runtime = clock.boards.find((b) => b.componentId === 'uno').runtime;
          assert.ok(runtime.loopIterations >= 2);
          const uno = result.components.find((c) => c.componentId === 'uno');
          const driven = [4, 6, 7, 8, 9, 10, 11, 12].map((pin, index) => {
            const high = glyph[index] !== commonAnode;
            assert.equal(runtime.pinModes['d' + pin], 'OUTPUT');
            assert.equal(runtime.outputVoltages['d' + pin], high ? 5 : 0);
            const physical = uno.terminalVoltages['d' + pin];
            assert.ok(high ? physical >= 4 && physical <= 5.1 : physical >= -0.1 && physical <= 1);
            return {
              pin,
              mode: runtime.pinModes['d' + pin],
              commanded: runtime.outputVoltages['d' + pin],
              physical,
            };
          });
          assert.notEqual(model.stressState, 'burned');
          const sample = {
            pattern: index < 10 ? String(index) : index === 10 ? 'dp' : 'off',
            commonMode: commonAnode ? 'CA' : 'CC',
            blocks,
            sourceSha256: createHash('sha256').update(loaded.source).digest('hex'),
            blockCount: loaded.blockTypes.length,
            projectSessionId: response.projectSessionId,
            generationId: response.generationId,
            requestId: response.requestId,
            inputDigest: result.simulationInputDigest,
            committedAtMicroseconds,
            programFingerprint: clock.boards.find((b) => b.componentId === 'uno').runtime
              .programFingerprint,
            glyph,
            driven,
            completedIterationsAtLeast: runtime.loopIterations - 1,
            currents,
            brightness,
            dom: segments.map((segment) => visible[segment]),
            quality: {
              kcl: result.quality.maxKclResidualAmp,
              source: result.quality.maxSourceVoltageResidualVolt,
            },
            wallMs: Date.now() - started,
          };
          samples.push(sample);
          if (samples.length === 2)
            console.log(
              JSON.stringify({
                firstTwoSevenSegmentSamples: samples.map(
                  ({ wallMs, committedAtMicroseconds, blocks }) => ({
                    wallMs,
                    committedAtMicroseconds,
                    blocks,
                  }),
                ),
              }),
            );
          if (
            (width === 1440 && !commonAnode && !blocks && index === 0) ||
            (width === 390 && commonAnode && blocks && index === 10)
          )
            await page.screenshot({ path: resolve(output, 'seven-parity-' + width + '.png') });
        } catch (error) {
          await writeFile(
            resolve(output, 'seven-parity-failure.json'),
            JSON.stringify(
              {
                width,
                active,
                commonAnode,
                blocks,
                error: String(error),
                loaded,
                snapshot: await page.evaluate(() => window.fixture.potSnapshot()),
              },
              null,
              2,
            ),
          );
          throw error;
        } finally {
          if (await page.evaluate(() => window.fixture.state().running))
            await page.evaluate(() => window.fixture.stop());
          await page.waitForFunction(() => !window.fixture.state().running);
        }
        if (process.argv.includes('--seven-segment-parity-pilot') && samples.length === 2)
          return { width, pilot: true, samples };
      }
  for (let i = 0; i < samples.length; i += 2) {
    assert.deepEqual(samples[i].glyph, samples[i + 1].glyph);
    for (let j = 0; j < 8; j++) {
      assert.ok(Math.abs(samples[i].currents[j] - samples[i + 1].currents[j]) < 0.000001);
      assert.ok(Math.abs(samples[i].brightness[j] - samples[i + 1].brightness[j]) < 0.001);
    }
  }
  return { width, samples };
}
async function waitSevenOptical(page, patterns, minimumGeneration = 0) {
  try {
    await page.waitForFunction(
      ({ patterns, minimumGeneration }) => {
        const s = window.fixture.matrixOpticalSnapshot();
        if (
          !s.response ||
          s.response.generationId < minimumGeneration ||
          !s.result?.solved ||
          !s.result.quality?.passed ||
          !s.frame ||
          s.frame.atMicroseconds < 24000
        )
          return false;
        return patterns.every((pattern, i) => {
          const values = s.frame.segments['display-' + i];
          const nodes = [
            ...document.querySelectorAll('[data-component-id="display-' + i + '"] [data-segment]'),
          ];
          return (
            values &&
            nodes.length === 8 &&
            nodes.every((node) => {
              const segment = node.getAttribute('data-segment');
              return (
                values[segment] > 0 === pattern.includes(segment) &&
                Number(node.getAttribute('opacity')) === values[segment] / 100
              );
            })
          );
        });
      },
      { patterns, minimumGeneration },
      { timeout: 30000 },
    );
  } catch (error) {
    await writeFile(
      resolve(output, 'seven-optical-failure.json'),
      JSON.stringify(
        await page.evaluate(() => ({
          snapshot: window.fixture.matrixOpticalSnapshot(),
          responses: window.probe.responses.slice(-3),
          state: window.fixture.state(),
          visible: [
            ...document.querySelectorAll('[data-component-id^=display-] [data-segment]'),
          ].map((e) => [
            e.closest('[data-component-id]').getAttribute('data-component-id'),
            e.getAttribute('data-segment'),
            e.getAttribute('opacity'),
          ]),
        })),
        null,
        2,
      ),
    );
    throw error;
  }
  return page.evaluate(() => window.fixture.matrixOpticalSnapshot());
}
async function checkSevenOptical(page, width, count, blocks) {
  const started = Date.now();
  const loaded = await page.evaluate(
    ({ count, blocks }) => window.fixture.loadMatrix(count, blocks, true),
    { count, blocks },
  );
  await page.waitForFunction(() => window.fixture.status() === 'ready');
  await page.evaluate(() => window.fixture.start());
  const patterns = ['bc', 'abdeg', 'abcdg', 'bcfg'].slice(0, count);
  const snapshot = await waitSevenOptical(page, patterns);
  assert.equal(snapshot.response.projectSessionId, loaded.projectSessionId);
  assert.equal(
    snapshot.response.metrics.simulationInputDigest,
    snapshot.result.simulationInputDigest,
  );
  assert.ok(
    snapshot.frame.atMicroseconds <= snapshot.response.advance.committedHorizonMicroseconds,
  );
  assert.ok(snapshot.result.quality.maxKclResidualAmp <= 1e-6);
  assert.ok(snapshot.result.quality.maxSourceVoltageResidualVolt <= 1e-9);
  assert.equal(
    snapshot.document.components[0].stateProperties.arduinoSource,
    loaded.document.components[0].stateProperties.arduinoSource,
  );
  if (blocks)
    assert.ok(
      loaded.blockTypes.includes('asa_loop') &&
        loaded.blockTypes.includes('asa_digital_write') &&
        loaded.blockTypes.includes('asa_wait'),
    );
  await page.screenshot({
    path: resolve(output, `seven-optical-${count}-${blocks ? 'blocks' : 'text'}-${width}.png`),
  });
  let lifecycle;
  if (count === 4 && !blocks && !process.argv.includes('--optical-pilot')) {
    const nextPatterns = ['abcdef', 'abcdefgdp', 'abdeg', 'acdfg'];
    const source = await page.evaluate(
      ({ count, patterns }) => window.fixture.editOpticalMatrix({ count, patterns }),
      { count, patterns: nextPatterns },
    );
    const edited = await waitSevenOptical(page, nextPatterns);
    assert.equal(edited.document.components[0].stateProperties.arduinoSource, source);
    const executed = JSON.parse(
      edited.response.advance.state.continuation.serializedState,
    ).boards.find((board) => board.componentId === 'uno').loadedSource;
    assert.equal(executed, source);
    await page.evaluate(() => window.fixture.reset());
    const reset = await waitSevenOptical(page, nextPatterns, edited.response.generationId + 1);
    await page.evaluate(() => window.fixture.stop());
    await page.waitForFunction(() => !window.fixture.state().running);
    assert.ok(
      await page
        .locator('[data-component-id^="display-"] [data-segment]')
        .evaluateAll((nodes) => nodes.every((node) => Number(node.getAttribute('opacity')) === 0)),
    );
    await page.evaluate(() => window.fixture.start());
    const restarted = await waitSevenOptical(page, nextPatterns, reset.response.generationId + 1);
    lifecycle = {
      sourceChanged: true,
      dp: true,
      editedSource: source,
      editedDigest: edited.result.simulationInputDigest,
      resetGeneration: reset.response.generationId,
      restartGeneration: restarted.response.generationId,
      stopDark: true,
    };
  }
  await page.evaluate(() => window.fixture.stop());
  await page.waitForFunction(() => !window.fixture.state().running);
  return {
    width,
    count,
    blocks,
    blockTypes: loaded.blockTypes,
    source: loaded.document.components[0].stateProperties.arduinoSource,
    frame: snapshot.frame,
    electrical: snapshot.result.components.filter((c) => c.componentId.startsWith('display-')),
    quality: snapshot.result.quality,
    projectSessionId: snapshot.response.projectSessionId,
    generation: snapshot.response.generationId,
    inputDigest: snapshot.result.simulationInputDigest,
    electricalHorizon: snapshot.response.advance.committedHorizonMicroseconds,
    computeMs: snapshot.response.metrics.computeMs,
    wallMs: Date.now() - started,
    ...(lifecycle ? { lifecycle } : {}),
  };
}
async function checkHelperCounter(page, width, count, helpers) {
  const started = Date.now();
  const loaded = await page.evaluate(
    ({ count, helpers }) => window.fixture.loadHelperCounter(count, helpers),
    { count, helpers },
  );
  await page.waitForFunction(() => window.fixture.status() === 'ready');
  if (helpers === 'blocks')
    assert.ok(
      loaded.blockCount > 100 &&
        loaded.blockTypes.includes('asa_var_change') &&
        loaded.blockTypes.includes('asa_if') &&
        loaded.blockTypes.includes('asa_millis'),
    );
  await page.evaluate(() => window.fixture.start());
  const snapshots = [];
  for (const digits of [
    [...Array(count - 1).fill(9), 8],
    Array(count).fill(9),
    Array(count).fill(0),
  ]) {
    const glyphs = [
      'abcdef',
      'bc',
      'abdeg',
      'abcdg',
      'bcfg',
      'acdfg',
      'acdefg',
      'abc',
      'abcdefg',
      'abcdfg',
    ];
    const patterns = digits.map((digit) => glyphs[digit]);
    const snapshot = await waitSevenOptical(page, patterns);
    assert.equal(snapshot.response.projectSessionId, loaded.projectSessionId);
    assert.equal(
      snapshot.response.metrics.simulationInputDigest,
      snapshot.result.simulationInputDigest,
    );
    assert.ok(
      snapshot.frame.atMicroseconds <= snapshot.response.advance.committedHorizonMicroseconds,
    );
    assert.equal(
      snapshot.document.components[0].stateProperties.arduinoSource,
      loaded.document.components[0].stateProperties.arduinoSource,
    );
    assert.ok(snapshot.result.quality.maxKclResidualAmp <= 1e-6);
    assert.ok(snapshot.result.quality.maxSourceVoltageResidualVolt <= 1e-9);
    const board = JSON.parse(snapshot.response.advance.state.continuation.serializedState)
      .boards[0];
    assert.equal(board.loadedSource, loaded.document.components[0].stateProperties.arduinoSource);
    if (helpers === 'switch') {
      assert.equal(board.runtime.serial.begun, true);
      const text = board.runtime.serial.tx.map((entry) => entry.text).join('');
      assert.ok(text.includes(String(digits[0])));
      assert.ok(
        loaded.document.components[0].stateProperties.arduinoSource.includes('switch(value)'),
      );
    }
    snapshots.push({
      digits,
      frame: snapshot.frame,
      quality: snapshot.result.quality,
      modelHorizon: snapshot.response.advance.committedHorizonMicroseconds,
      runtime: board.runtime,
      wallMs: Date.now() - started,
    });
  }
  if (count === 4 || helpers === 'switch')
    await page.screenshot({
      path: resolve(
        output,
        `helper-counter-${count}-${helpers === 'blocks' ? 'blocks' : helpers ? 'functions' : 'linear'}-${width}.png`,
      ),
    });
  await page.evaluate(() => window.fixture.stop());
  await page.waitForFunction(() => !window.fixture.state().running);
  return {
    width,
    count,
    helpers,
    blockCount: loaded.blockCount,
    blockTypes: loaded.blockTypes,
    source: loaded.document.components[0].stateProperties.arduinoSource,
    snapshots,
  };
}
async function checkArduinoMatrixPilot(page, width) {
  const samples = [];
  for (const [count, blocks] of [
    [1, false],
    [4, false],
    [4, true],
  ]) {
    const loaded = await page.evaluate(
      ([count, blocks]) => window.fixture.loadMatrix(count, blocks),
      [count, blocks],
    );
    await page.waitForFunction(() => window.fixture.status() === 'ready');
    const started = Date.now();
    await page.evaluate(() => window.fixture.start());
    await page.waitForFunction(
      ({ session }) => {
        const s = window.fixture.potSnapshot();
        return s.lastResponse?.projectSessionId === session && s.committedAtMicroseconds >= 20000;
      },
      { session: loaded.projectSessionId, blocks },
      { timeout: 30000 },
    );
    const wallMs = Date.now() - started;
    const snapshot = await page.evaluate(() => ({
      ...window.fixture.potSnapshot(),
      responses: window.probe.responses,
      state: window.fixture.state(),
      dom: [...document.querySelectorAll('[data-component-id^="display-"] .workbench-part')].map(
        (e) => ({
          id: e.closest('[data-component-id]').getAttribute('data-component-id'),
          segments: [...e.querySelectorAll('[data-segment]')].map((s) => ({
            segment: s.getAttribute('data-segment'),
            opacity: Number(s.getAttribute('opacity')),
          })),
        }),
      ),
    }));
    const responses = snapshot.responses.filter(
      (r) => r.projectSessionId === loaded.projectSessionId,
    );
    if (blocks) {
      assert.ok(
        loaded.blockTypes.includes('asa_loop') &&
          loaded.blockTypes.includes('asa_digital_write') &&
          loaded.blockTypes.includes('asa_wait'),
      );
    }
    {
      assert.equal(snapshot.dom.length, count);
      assert.ok(snapshot.result.solved && snapshot.result.quality.passed);
      assert.equal(
        snapshot.lastResponse.metrics.simulationInputDigest,
        snapshot.result.simulationInputDigest,
      );
      assert.equal(
        snapshot.lastResponse.advance.committedHorizonMicroseconds,
        snapshot.committedAtMicroseconds,
      );
      for (const d of snapshot.dom) {
        const calculated = snapshot.result.components.find((c) => c.componentId === d.id);
        assert.equal(d.segments.length, 8);
        for (const s of d.segments)
          assert.equal(s.opacity, calculated.branchBrightness[s.segment] / 100);
      }
    }
    const visible = snapshot.dom.filter((d) => d.segments.some((s) => s.opacity > 0));
    const status =
      count === 4 && visible.length < 4
        ? 'BLOCKED_multiplex_instantaneous_optics'
        : 'single_display_first_frame_only';
    await page.screenshot({
      path: resolve(output, `arduino-matrix-${count}-${blocks ? 'blocks' : 'text'}-${width}.png`),
    });
    samples.push({
      count,
      blocks,
      status,
      wallMs,
      document: loaded.document,
      blockTypes: loaded.blockTypes,
      modelMicroseconds: snapshot.committedAtMicroseconds,
      visibleDisplayIds: visible.map((d) => d.id),
      dom: snapshot.dom,
      result: snapshot.result,
      frame: snapshot.lastResponse?.advance?.frame,
      responses: responses.map((r) => ({
        kind: r.kind,
        generationId: r.generationId,
        projectSessionId: r.projectSessionId,
        advance: r.advance,
        metrics: r.metrics,
      })),
      state: snapshot.state,
    });
    if (snapshot.state.running) await page.evaluate(() => window.fixture.stop());
  }
  return { width, qualification: 'BLOCKED_NOT_FULL_MATRIX_PASS', samples };
}

async function checkSevenButtons(page, width) {
  const started = Date.now();
  const loaded = await page.evaluate(() => window.fixture.loadButtons());
  assert.equal(loaded.document.components.filter((c) => c.kind === 'diode').length, 49);
  assert.equal(
    loaded.document.components.some((c) => c.componentTypeId === 'arduino-uno'),
    false,
  );
  await page.waitForFunction(() => window.fixture.status() === 'ready');
  await page.evaluate(() => window.fixture.start());
  const patterns = [
    'abcdef',
    'bc',
    'abdeg',
    'abcdg',
    'bcfg',
    'acdfg',
    'acdefg',
    'abc',
    'abcdefg',
    'abcdfg',
  ];
  const samples = [];
  const check = async (active, digit) => {
    await page.waitForFunction(
      ({ active, digit }) => {
        const s = window.fixture.potSnapshot(),
          r = s.result,
          response = s.lastResponse;
        if (!response || !r?.solved || !r.quality?.passed || s.committedAtMicroseconds <= 0)
          return false;
        if (
          s.document.components
            .filter((c) => c.kind === 'button' && c.state)
            .map((c) => c.id)
            .join(',') !== (digit === null ? '' : 'button-' + digit)
        )
          return false;
        const b = r.components.find((c) => c.componentId === 'display')?.branchBrightness;
        if (
          !b ||
          !['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].every(
            (segment) => b[segment] > 0 === active.includes(segment),
          )
        )
          return false;
        const elements = [
          ...document.querySelectorAll('[data-component-id="display"] [data-segment]'),
        ];
        return (
          elements.length === 8 &&
          elements.every(
            (e) => Number(e.getAttribute('opacity')) === b[e.getAttribute('data-segment')] / 100,
          )
        );
      },
      { active, digit },
      { timeout: 30000 },
    );
    const s = await page.evaluate(() => window.fixture.potSnapshot());
    assert.equal(s.lastResponse.projectSessionId, loaded.projectSessionId);
    assert.equal(s.lastResponse.metrics.simulationInputDigest, s.result.simulationInputDigest);
    assert.equal(s.lastResponse.advance.committedHorizonMicroseconds, s.committedAtMicroseconds);
    assert.ok(s.result.quality.maxKclResidualAmp <= 1e-6);
    assert.ok(s.result.quality.maxSourceVoltageResidualVolt <= 1e-9);
    const display = s.result.components.find((c) => c.componentId === 'display');
    for (const current of Object.values(display.branchCurrents))
      assert.ok(Number.isFinite(current) && Math.abs(current) < 0.01);
    return {
      digit,
      active,
      projectSessionId: s.lastResponse.projectSessionId,
      generationId: s.lastResponse.generationId,
      inputDigest: s.result.simulationInputDigest,
      frame: s.committedAtMicroseconds,
      currents: display.branchCurrents,
      brightness: display.branchBrightness,
      quality: s.result.quality,
    };
  };
  await check('', null);
  const cdp = width < 500 ? await page.context().newCDPSession(page) : null;
  for (let digit = 0; digit < 10; digit++) {
    const part = page.locator(`[data-component-id="button-${digit}"] .workbench-part`);
    const box = await part.boundingBox();
    assert.ok(box);
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    assert.ok(x > 0 && x < width && y > 0 && y < 900);
    if (cdp)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y, id: 1 }],
      });
    else {
      await page.mouse.move(x, y);
      await page.mouse.down();
    }
    try {
      const pressed = await check(patterns[digit], digit);
      if (digit === 8)
        await page.screenshot({ path: resolve(output, 'diode-matrix-' + width + '.png') });
      samples.push({ pressed });
    } finally {
      if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await page.mouse.up();
    }
    samples.at(-1).released = await check('', null);
  }
  await page.evaluate(() => window.fixture.stop());
  await page.waitForFunction(() => !window.fixture.state().running);
  const saved = await page.evaluate(() =>
    JSON.parse(JSON.stringify(window.fixture.potSnapshot().document)),
  );
  assert.deepEqual(
    saved.components.map((c) => [c.id, c.state]),
    loaded.document.components.map((c) => [c.id, c.state]),
  );
  const reopened = await page.evaluate((saved) => window.fixture.loadButtons(saved), saved);
  assert.deepEqual(reopened.document.components, loaded.document.components);
  assert.deepEqual(reopened.document.connections, loaded.document.connections);
  await page.waitForFunction(() => window.fixture.status() === 'ready');
  await writeFile(
    resolve(output, 'diode-matrix-example.json'),
    JSON.stringify(loaded.document, null, 2),
  );
  return {
    width,
    supplyVolt: 3,
    componentCount: loaded.document.components.length,
    diodeRoutes: 49,
    samples,
    savedReopened: true,
    wallMs: Date.now() - started,
  };
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
    if (process.argv.includes('--switch-display-only')) {
      all.push(await checkHelperCounter(page, width, 1, 'switch'));
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (process.argv.includes('--helper-display-counters-only')) {
      for (const count of process.argv.includes('--helpers-pilot') ? [1, 4] : [1, 2, 3, 4])
        for (const helpers of process.argv.includes('--helpers-pilot')
          ? [true]
          : [false, true, 'blocks'])
          all.push(await checkHelperCounter(page, width, count, helpers));
      assert.deepEqual(errors, []);
      await page.close();
      if (process.argv.includes('--helpers-pilot')) break;
      continue;
    }
    if (process.argv.includes('--seven-segment-optical-only')) {
      for (const count of process.argv.includes('--optical-pilot') ? [1, 4] : [1, 2, 3, 4])
        for (const blocks of process.argv.includes('--optical-pilot') ? [false] : [false, true])
          all.push(await checkSevenOptical(page, width, count, blocks));
      assert.deepEqual(errors, []);
      await page.close();
      if (process.argv.includes('--optical-pilot')) break;
      continue;
    }
    if (process.argv.includes('--arduino-seven-segment-pilot-only')) {
      all.push(await checkArduinoMatrixPilot(page, width));
      assert.deepEqual(errors, []);
      await page.close();
      break;
    }
    if (process.argv.includes('--seven-segment-buttons-only')) {
      all.push(await checkSevenButtons(page, width));
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
    if (process.argv.includes('--seven-segment-parity-only')) {
      all.push(await checkSevenParity(page, width));
      assert.deepEqual(errors, []);
      await page.close();
      if (process.argv.includes('--seven-segment-parity-pilot')) break;
      continue;
    }
    if (process.argv.includes('--multi-servo-sustained-only')) {
      all.push(await checkMultiServo(page, width));
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }
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
  const receiptName = process.argv.includes('--switch-display-only')
    ? 'arduino-switch-display-859.json'
    : process.argv.includes('--helper-display-counters-only')
      ? 'arduino-helper-display-counters-824.json'
      : process.argv.includes('--seven-segment-optical-only')
        ? 'seven-segment-optical-821.json'
        : process.argv.includes('--arduino-seven-segment-pilot-only')
          ? 'arduino-seven-segment-pilot-817.json'
          : process.argv.includes('--seven-segment-buttons-only')
            ? 'seven-segment-diode-matrix-815.json'
            : process.argv.includes('--seven-segment-parity-only')
              ? 'seven-segment-parity-788' +
                (process.argv.includes('--seven-segment-parity-pilot') ? '-pilot' : '') +
                '.json'
              : process.argv.includes('--multi-servo-sustained-only')
                ? 'servo-multi-sustained-786.json'
                : process.argv.includes('--potentiometer-only')
                  ? 'servo-potentiometer-784.json'
                  : process.argv.includes('--horn-clip-only')
                    ? `horn-${process.argv.includes('--horn-clip-baseline') ? 'before' : 'after'}-receipts.json`
                    : 'receipts.json';
  await writeFile(resolve(output, receiptName), JSON.stringify(all, null, 2));
  console.log(
    process.argv.includes('--switch-display-only')
      ? 'PASS real Arduino switch display counter and Serial; no arbitrary C++ or realtime claim.'
      : process.argv.includes('--helper-display-counters-only')
        ? 'PASS real linear/helper Arduino display counters with visible carry; not arbitrary C++ or realtime acceptance.'
        : process.argv.includes('--seven-segment-optical-only')
          ? 'PASS physically observed multiplexed raw display optical projection; not function-runtime or realtime acceptance.'
          : process.argv.includes('--arduino-seven-segment-pilot-only')
            ? 'BLOCKED Arduino display qualification: unsupported user functions, NPN/LED quality fault, and instantaneous multiplex optics require separate repairs. Pilot is not a full matrix PASS.'
            : process.argv.includes('--seven-segment-buttons-only')
              ? 'PASS physical 2AA ten-button diode matrix: 0–9 press/release and saved circuit reopen, real Worker/Stage desktop/mobile; no Arduino.'
              : process.argv.includes('--seven-segment-parity-only')
                ? 'PASS real Blockly/text raw seven-segment common-mode parity; fixture only, not counters/buttons or realtime.'
                : process.argv.includes('--multi-servo-sustained-only')
                  ? 'PASS two physical Servo models sustained complementary cycles 10s MODEL, correlated native horns1440/390, JSON replay/reset/Stop.'
                  : process.argv.includes('--potentiometer-only')
                    ? 'PASS live Stage potentiometer → physical ADC → fixed text/Blockly → PWM → Servo/horn 1440/390.'
                    : process.argv.includes('--horn-clip-only')
                      ? 'PASS Servo native Stage horn clipping: five angles at 1440/390, actual CSS and hidden-viewport control.'
                      : 'PASS Servo real Worker/client/full workbench hook/Stage owner horn at 1440/390; API/static fixture ports, no server/DB/SaveCAS/listening ports.',
  );
} finally {
  await browser.close();
}
