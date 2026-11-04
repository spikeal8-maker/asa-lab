// Mounted production editor, Stage, inspector and actual Chromium simulation Worker.
// Only API/static-resource ports and read-only instrumentation are fixture supplied.
/* global window, document, URL, console, requestAnimationFrame, MessageEvent */
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const before = process.argv.includes('--before');
const baseline = '6edb1afc1e013f686a26f80c87939bc66051d4f8';
const output = resolve('test-results/instrument-projection-873/native');
await mkdir(output, { recursive: true });
const opts = {
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  alias: Object.fromEntries(
    ['', '/rendering', '/simulation', '/engine'].map((s) => [
      '@asa-lab/electronics' + s,
      resolve('contexts/electronics/' + (s.slice(1) || 'index') + '.ts'),
    ]),
  ),
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '{}',
    'import.meta.url': '"https://instrument-fixture.invalid/fixture.js"',
  },
};
const worker = (
  await build({ ...opts, entryPoints: ['apps/web/src/electronics/simulation.worker.ts'] })
).outputFiles[0].text;
const catalog = await readFile(
  'apps/web/public/assets/electronics/component-database/catalog.json',
  'utf8',
);
const css = await readFile('apps/web/src/electronics/workbench.css', 'utf8');
const sidebarSource = before
  ? execFileSync('git', ['show', baseline + ':apps/web/src/electronics/WorkbenchSidebars.tsx'], {
      encoding: 'utf8',
    })
  : await readFile('apps/web/src/electronics/WorkbenchSidebars.tsx', 'utf8');
const source = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {api} from './src/api';import {SchematicEditor} from './src/pages/SchematicEditor';
import {configureProductionLibrary} from './src/electronics/production-manifest-adapter';
import {rawDisplayCircuit} from '../../contexts/electronics/testing/fixtures/raw-seven-segment';
import {parseElectronicsDocument,analyseCircuit} from '@asa-lab/electronics';
configureProductionLibrary(${catalog});
window.fixture={requests:[],responses:[],editorRenders:0,sidebarRenders:0,stale:new Map()};
const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker{constructor(){super(URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'})));window.fixture.worker=this;this.addEventListener('message',e=>window.fixture.responses.push(e.data));}postMessage(m){window.fixture.requests.push(m);super.postMessage(m);}};
const query=new URL(window.location.href).searchParams;
let saved=${JSON.stringify(JSON.parse(gunzipSync(await readFile('docs/product/electronics/evidence/instrument-native-projection-873/before-raw.json.gz')).toString('utf8')).rows.find(r=>r.name==='whole-document-0').observation.actual)};saved.simulation.running=false;
window.fixture.calculation=()=>analyseCircuit(saved);let revision=1;
api.me=async()=>({ok:true,status:200,data:{authenticated:true,user:{id:'owner',displayName:'Owner'}}});
api.openProject=async id=>({ok:true,status:200,data:{project:{id,moduleKey:'electronics',title:'Seven segment inspector',scope:'personal',classroomId:null,status:'active'},draft:{projectId:id,document:saved,revision,updatedAt:''},versions:[],result:null}});
api.saveDraft=async(id,document)=>{const parsed=parseElectronicsDocument(JSON.parse(JSON.stringify(document)));if(!parsed.ok)throw Error(parsed.message);saved=parsed.document;return{ok:true,status:200,data:{draft:{projectId:id,document:saved,revision:++revision,updatedAt:''},result:analyseCircuit(parsed.document)}}};
window.fixture.snapshot=()=>{const wb=window.fixture.wb,s=wb.nativeOpticalPresentation.getSnapshot().committed;return{pace:wb.simulationPacing.read(),running:wb.simulationRunning,selected:wb.selectedComponent?.id,editorRenders:window.fixture.editorRenders,sidebarRenders:window.fixture.sidebarRenders,committed:s?{token:s.frame.token,at:s.frame.atMicroseconds,result:s.result}:null,staleSize:window.fixture.stale.size,requests:window.fixture.requests.length,responses:window.fixture.responses.length};};
createRoot(document.getElementById('app')).render(<SchematicEditor projectId="sevenseg-872" user={{id:'owner',email:'',displayName:'Owner'}} onBack={()=>{}}/>);
`;
const ui = (
  await build({
    ...opts,
    stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: source },
    plugins: [
      {
        name: 'read-only-observers-and-stale-controller-map',
        setup(builder) {
          builder.onLoad({ filter: /pages[\\/]SchematicEditor\.tsx$/ }, async (args) => ({
            loader: 'tsx',
            contents: (await readFile(args.path, 'utf8')).replace(
              'const controller = useElectronicsWorkbench(projectId, user.id, seatLearner);',
              'const controller = useElectronicsWorkbench(projectId, user.id, seatLearner); window.fixture.wb=controller;window.fixture.editorRenders++;',
            ),
          }));
          builder.onLoad({ filter: /WorkbenchStage\.tsx$/ }, async args => ({ loader:'tsx', contents:(await readFile(args.path,'utf8')).replace('const document = c.document!;', 'window.fixture.stageRenders=(window.fixture.stageRenders||0)+1;c={...c,runtimePresentationResultByComponent:window.fixture.stale};const document = c.document!;') }));
        },
      },
    ],
  })
).outputFiles[0].text;
const browser=await chromium.launch({headless:true});const receipts=[];
async function snapshot(page){return page.evaluate(()=>{const s=window.fixture.snapshot();return{...s,stageRenders:window.fixture.stageRenders,native:Object.fromEntries(['multimeter-runtime-display','regulated-power-supply-runtime','signal-generator-runtime','oscilloscope-runtime'].map(id=>{const e=document.querySelector('[data-testid="'+id+'"]');return[id,e?{text:e.textContent,html:e.innerHTML,attrs:Object.fromEntries([...e.attributes].map(a=>[a.name,a.value]))}:null]}))};});}
try{for(const width of [1440,390]){
 const ctx=await browser.newContext({viewport:{width,height:900}});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await ctx.route('https://instrument-fixture.invalid/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.startsWith('/assets/'))await route.fulfill({body:await readFile(resolve('apps/web/public','.'+path)),contentType:path.endsWith('.json')?'application/json':'image/svg+xml'});else if(path.startsWith('/api/'))await route.fulfill({json:{}});else await route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="app"></div><script>'+ui+'</script>'});});
 try{
 await page.goto('https://instrument-fixture.invalid/');await page.waitForFunction(()=>window.fixture.wb?.status==='ready');await page.evaluate(()=>window.fixture.wb.setLibraryOpen(false));
 await page.getByRole('button',{name:'Начать моделирование',exact:true}).click();await page.waitForFunction(()=>window.fixture.wb.nativeOpticalPresentation.getSnapshot().committed?.frame.atMicroseconds>5000);
 await page.evaluate(()=>window.fixture.wb.setSimulationRate(0));await page.waitForFunction(()=>window.fixture.wb.simulationPacing.read().phase==='paused');
 await page.waitForFunction(()=>document.querySelector('[data-testid="multimeter-runtime-display"]')?.textContent.includes('-3.000'));
 const live=await snapshot(page);await writeFile(resolve(output,width+'-live.json'),JSON.stringify(live,null,2));
 assert.equal(live.staleSize,0);assert.equal(live.committed.result.solved,true);assert.equal(live.committed.result.quality.finite,true);
 const components=live.committed.result.components;const meter=components.find(c=>c.componentId==='meter');assert.ok(Math.abs(meter.measuredValue+2.999999865)<1e-6);assert.ok(live.native['multimeter-runtime-display'].text.includes('-3.000'));
 const psu=components.find(c=>c.componentId==='bench-supply'),gen=components.find(c=>c.componentId==='generator'),scope=components.find(c=>c.componentId==='scope');
 assert.equal(live.native['regulated-power-supply-runtime'].attrs['data-regulation-mode'],psu.regulationMode);assert.ok(live.native['regulated-power-supply-runtime'].text.includes(psu.voltageDrop.toFixed(2)+' V'));assert.ok(live.native['regulated-power-supply-runtime'].text.includes(Math.abs(psu.current).toFixed(3)+' A'));
 assert.equal(live.native['signal-generator-runtime'].attrs['data-waveform'],gen.signalWaveform);assert.ok(live.native['signal-generator-runtime'].text.includes((gen.signalFrequencyHz/1000).toFixed(2)+' kHz'));assert.ok(live.native['signal-generator-runtime'].text.includes(gen.signalAmplitudeVpp.toFixed(2)+' Vpp'));assert.ok(live.native['signal-generator-runtime'].text.includes(gen.signalOffsetVolt.toFixed(2)+' V'));
 assert.ok(Number.isFinite(scope.oscilloscopeInputVoltageVolt));assert.ok(live.native['oscilloscope-runtime'].text.includes((scope.oscilloscopeFrequencyHz/1000).toFixed(2)+' kHz'));assert.ok(live.native['oscilloscope-runtime'].text.includes(scope.oscilloscopeAmplitudeVpp.toFixed(2)+' Vpp'));
 // Timed production Worker intentionally suppresses oscilloscopeTrace; no live trace claim.
 assert.equal(scope.oscilloscopeTrace,undefined);

 await page.screenshot({path:resolve(output,width+'.png')});
 await writeFile(resolve(output,width+'-worker.json'),JSON.stringify(await page.evaluate(()=>({requests:window.fixture.requests,responses:window.fixture.responses})),null,2));
 const selection=[];for(const id of ['meter','bench-supply','generator','scope']){await page.evaluate(id=>window.fixture.wb.selectComponent(id,false),id);selection.push((await snapshot(page)).selected);}assert.deepEqual(selection,['meter','bench-supply','generator','scope']);
 const count=await snapshot(page);
 const synthetic=await page.evaluate(async()=>{const port=window.fixture.wb.nativeOpticalPresentation,s=port.getSnapshot().committed;const wait=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const text=()=>document.querySelector('[data-testid="multimeter-runtime-display"]')?.textContent;const initial=text();port.setObservation({...s,result:{...s.result,components:[]}},true);await wait();const proposal=text();port.setObservation(null);await wait();const cleared=text();port.commit(s);await wait();const retired=text();port.setObservation(s);await wait();return{initial,proposal,cleared,retired,restored:text()};});assert.equal(synthetic.proposal,synthetic.initial);assert.equal(synthetic.retired,synthetic.cleared);assert.equal(synthetic.restored,synthetic.initial);
 const after=await snapshot(page);assert.equal(after.editorRenders,count.editorRenders);assert.equal(after.stageRenders,count.stageRenders);
 const calculation=await page.evaluate(async()=>{const port=window.fixture.wb.nativeOpticalPresentation,s=port.getSnapshot().committed,result=window.fixture.calculation();port.setObservation({...s,result});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return{result,path:document.querySelector('.workbench-oscilloscope-trace')?.getAttribute('d')};});
 const calcScope=calculation.result.components.find(c=>c.componentId==='scope');assert.equal(calcScope.oscilloscopeTrace.length,161);assert.ok(calcScope.oscilloscopeTrace.every(p=>Number.isFinite(p.timeMs)&&Number.isFinite(p.voltageVolt)));assert.ok(calculation.path.startsWith('M'));assert.ok(!/NaN|Infinity/.test(calculation.path));
 await writeFile(resolve(output,width+'-solver-calculation-projection.json'),JSON.stringify(calculation,null,2));

 await page.getByRole('button',{name:'Остановить моделирование',exact:true}).click();await page.waitForFunction(()=>!window.fixture.wb.simulationRunning&&window.fixture.wb.nativeOpticalPresentation.getSnapshot().committed===null);
 const stopped=await snapshot(page);await page.evaluate(async()=>{window.fixture.worker.dispatchEvent(new MessageEvent('message',{data:window.fixture.responses.find(r=>r.kind==='advance')}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});assert.equal((await snapshot(page)).committed,null);
 assert.deepEqual(errors,[]);receipts.push({width,live,selection,synthetic,stopped});
 }catch(e){await writeFile(resolve(output,width+'-failure.json'),JSON.stringify({error:String(e),snapshot:await snapshot(page),errors},null,2));throw e;}finally{await ctx.close();}
}}finally{await writeFile(resolve(output,'receipt.json'),JSON.stringify(receipts,null,2));await writeFile(resolve(output,'fixture-source.tsx'),source);await browser.close();}

await writeFile(resolve(output,'source-provenance.json'),JSON.stringify({baseline:'8dca228a017620afb60ed5e7125dd7940bf2082a',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workerBundleSha256:createHash('sha256').update(worker).digest('hex'),uiBundleSha256:createHash('sha256').update(ui).digest('hex'),nativeSourceSha256:createHash('sha256').update(await readFile('apps/web/src/electronics/NativeOpticalComponentVisual.tsx')).digest('hex'),harnessSha256:createHash('sha256').update(await readFile('docs/product/electronics/evidence/instrument-native-projection-873/native-harness.mjs')).digest('hex'),note:'Actual production Worker+Stage; read-only counters; only parent measurement map intentionally empty. Solver-calculation trace projection separately classified from timed Worker (trace suppressed).'},null,2));
