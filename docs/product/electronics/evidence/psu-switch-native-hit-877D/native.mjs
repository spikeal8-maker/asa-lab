import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import ts from 'typescript';
const spec=readFileSync('e2e/electronics-simulation.spec.ts','utf8');
assert.equal(createHash('sha256').update(spec).digest('hex'),'d9c0c74dd49997636aca4decd6c61d0381b4aa649a030b8e094305ece7b0f93c');
const ast=ts.createSourceFile('spec.ts',spec,ts.ScriptTarget.Latest,true);let ownedHelper;
function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='clickOwnedRect')ownedHelper=n.initializer.getText(ast);ts.forEachChild(n,walk);}walk(ast);assert.ok(ownedHelper);
const compiledHelper=ts.transpile(`const extracted=${ownedHelper};`,{target:ts.ScriptTarget.ES2022});
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const output = new URL('./', import.meta.url);
const rawRoot = process.argv[2];
assert.ok(rawRoot, 'cached raw16 root required');
function files(path) { return readdirSync(path, {withFileTypes:true}).flatMap(e => e.isDirectory() ? files(resolve(path,e.name)) : e.name === 'instrument525-raw.json' ? [resolve(path,e.name)] : []); }
const poses = files(rawRoot).map(path => ({path, raw:JSON.parse(readFileSync(path,'utf8'))})).filter(({raw}) => raw.primaryError?.message?.includes('power-slider')).map(({path,raw}) => {
 const observation=raw.rows.filter(r=>/^pan-bench-supply-\d+-after$/.test(r.name)).at(-1).observation;
 return {width:raw.width,mirror:raw.mirror, document:raw.rows.find(r=>r.name==='whole-document-0').observation.actual, observation, rawSha256:createHash('sha256').update(readFileSync(path)).digest('hex'), wireId:raw.primaryError.message.match(/data-wire-id="([^"]+)"/)[1]};
});
assert.equal(poses.length,6);
const catalog=readFileSync('apps/web/public/assets/electronics/component-database/catalog.json','utf8');
const source=`
import React,{useState,useRef} from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
import {WorkbenchStage} from './src/electronics/WorkbenchStage';
import {configureProductionLibrary} from './src/electronics/production-manifest-adapter';
configureProductionLibrary(${catalog});
window.proof={events:[],calls:[],renders:0};
document.addEventListener('pointerdown',e=>window.proof.events.push({type:e.type,trusted:e.isTrusted,target:e.target.getAttribute('class')}),true);
let update; const noop=()=>{};
function App(){const [config,setConfig]=useState(null);update=setConfig;window.proof.renders++;const stageRef=useRef(null),secondStageRef=useRef(null);if(!config)return null;
 const doc=config.document;
 const call=(name,...args)=>window.proof.calls.push({name,args});
 const c={document:doc,stageRef,viewport:{zoom:config.zoom},viewBox:config.viewBox,
 pendingTerminal:config.pending?{componentId:'bench-supply',terminal:'positive'}:null,
 selection:config.selection??null, simulationRunning:false,simulationTimeMs:0,
 diagnosticsByComponent:new Map(),runtimePresentationResultByComponent:new Map(),errorDiagnosticComponentIds:new Set(),
 componentVisualState:()=> 'default',componentLedBrightness:()=>0,componentArduinoLActive:()=>false,
 preparedComponentLedAsset:noop,committedComponentLedAsset:noop,rollbackComponentLedAsset:noop,
 terminalConnectionCount:()=>0, syncCatalogPreview:noop,handleWheel:noop,beginStagePointer:noop,
 handlePointerMove:noop,finishPointer:noop,cancelPointer:noop,startPan:noop,documentMutationEpoch:()=>0,
 setRegulatedPowerSupplyControls:(id,patch)=>{call('supply',id,patch);setConfig(old=>({...old,document:{...old.document,components:old.document.components.map(p=>p.id===id?{...p,stateProperties:{...p.stateProperties,...patch}}:p)}}));},
 selectComponent:(...a)=>call('selectComponent',...a),startComponentDrag:(e,p)=>call('bodyDrag',p.id),
 setSelection:(...a)=>call('selection',...a),startSegmentDrag:(e,...a)=>call('segmentDrag',...a),
 startEndpointDrag:(e,...a)=>call('endpointDrag',...a),startVertexDrag:(e,...a)=>call('vertexDrag',...a),
 startWireTerminalPointer:(e,...a)=>call('terminal',...a),clickTerminal:(...a)=>call('clickTerminal',...a),consumeTerminalClick:()=>true,
 setMultimeterMeasurementMode:noop,setSignalGeneratorControls:noop,resetArduinoRuntime:noop,
 addWireVertexAt:(...a)=>call('bend',...a),removeWireVertexAt:noop,zoomBy:noop,fitScene:noop,
 wirePreviewVertices:[],activeWireColor:'#f00'};
 window.proof.config=config; window.proof.controller=c;
 return <><WorkbenchStage controller={c} showGrid={false}/>{config.twoStages?<div style={{display:config.twoStages==='hidden'?'none':'block'}}><WorkbenchStage controller={{...c,stageRef:secondStageRef}} showGrid={false}/></div>:null}</>;
}
window.configure=config=>{window.proof.calls=[];window.proof.events=[];flushSync(()=>update(config));};
createRoot(document.getElementById('app')).render(<App/>);
`;
const ui=(await build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',stdin:{contents:source,loader:'tsx',resolveDir:resolve('apps/web')},loader:{'.css':'empty','.svg':'dataurl','.png':'dataurl'},alias:Object.fromEntries(['','/rendering','/simulation','/engine'].map(s=>['@asa-lab/electronics'+s,resolve('contexts/electronics/'+(s.slice(1)||'index')+'.ts')])),define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'}})).outputFiles[0].text;
const css=readFileSync('apps/web/src/electronics/workbench.css','utf8');
const browser=await chromium.launch({headless:true});const receipts=[];const errors=[];
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
 page.on('pageerror',e=>errors.push(String(e)));
 await context.route('https://native877.invalid/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.startsWith('/assets/'))return route.fulfill({body:readFileSync(resolve('apps/web/public','.'+path)),contentType:path.endsWith('.json')?'application/json':'image/svg+xml'});return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+' body{margin:0} .workbench-stage{position:absolute;top:94px;left:0;width:100vw;height:750px;min-height:0}</style><div id="app"></div><script>'+ui+'</script>'});});
 await page.goto('https://native877.invalid/');await page.waitForFunction(()=>window.configure);
 for(const pose of poses){
  await page.setViewportSize({width:pose.width,height:1000});
  await page.evaluate(b=>{let style=document.getElementById('fixture-dimensions');if(!style){style=document.createElement('style');style.id='fixture-dimensions';document.head.append(style);}style.textContent=`.workbench-stage{left:${b.x}px!important;top:${b.y}px!important;width:${b.width}px!important;height:${b.height}px!important}`;},pose.observation.canvas.bounds);
  const [x,y,width,height]=pose.observation.viewBox.split(' ').map(Number);
  const config={document:pose.document,zoom:pose.observation.canvas.ctm[0],viewBox:{x,y,width,height}};
  await page.evaluate(c=>window.configure(c),config);
  const runtime=page.locator('[data-component-id="bench-supply"] .workbench-regulated-supply-runtime');
  await runtime.waitFor();await page.waitForFunction(()=>document.querySelector('.workbench-wire-hit-layer')?.hasAttribute('clip-path'));
  const sample=await runtime.evaluate(el=>{const track=el.querySelector('rect.workbench-regulated-supply-power-switch:not(.workbench-regulated-supply-power-slider)');const m=track.getScreenCTM();const candidates=[[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75],[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([u,v])=>{const p=new DOMPoint(14+67*u,202+26*v).matrixTransform(m);const target=document.elementFromPoint(p.x,p.y);return{x:p.x,y:p.y,owned:target?.classList.contains('workbench-regulated-supply-power-switch'),target:target?.outerHTML.slice(0,200)};});return{matrix:[m.a,m.b,m.c,m.d,m.e,m.f],candidates};});
  assert.ok(sample.candidates.every(p=>p.owned),JSON.stringify({pose:pose.mirror,width:pose.width,sample}));
  const expected=pose.observation.body.ctm.map((n,i)=>i<4?n*.5:n);
  sample.matrix.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<.001,JSON.stringify({actual:sample.matrix,expected})));
  const witnesses=[];const clickOwnedRect=Function('page','checkpoint',`${compiledHelper};return extracted;`)(page,(name,value)=>witnesses.push({name,value}));
  await clickOwnedRect(runtime.locator('.workbench-regulated-supply-power-slider'),'supply-power-slider');
  const calls=await page.evaluate(()=>window.proof.calls);
  assert.equal(calls.filter(c=>c.name==='supply').length,1,JSON.stringify(calls));
  assert.equal((await page.evaluate(()=>window.proof.events)).filter(e=>e.trusted).length,1);
  receipts.push({kind:'actual-six-pose',width:pose.width,mirror:pose.mirror,wireId:pose.wireId,rawSha256:pose.rawSha256,sample,witnesses,calls});
 }

 async function configure(config) {
   await page.evaluate(c=>window.configure(c),config);
   await page.waitForFunction(()=>document.querySelector('[data-component-id="bench-supply"] .workbench-regulated-supply-runtime'));
   await page.waitForTimeout(20);
 }
 async function ownerPoints(points) {
  return page.evaluate(points=>{const r=document.querySelector('[data-component-id="bench-supply"] .workbench-regulated-supply-runtime');const m=r.getScreenCTM(),s=document.querySelector('.workbench-canvas').getScreenCTM().inverse();return points.map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(m),world=p.matrixTransform(s),target=document.elementFromPoint(p.x,p.y);return{x:p.x,y:p.y,world:{x:world.x,y:world.y},owned:target?.classList.contains('workbench-regulated-supply-power-switch'),testid:target?.getAttribute('data-testid'),target:target?.outerHTML.slice(0,180)};});},points);
 }
 await page.evaluate(()=>document.getElementById('fixture-dimensions').remove());
 const base=structuredClone(poses[0].document);
 const pairs=[[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75],[.25,.25],[.75,.25],[.25,.75],[.75,.75]];
 for(const width of [1440,1024,390,320])for(const rotation of [0,90,180,270])for(const mirror of [{x:false,y:false},{x:true,y:false},{x:false,y:true},{x:true,y:true}]){
  await page.setViewportSize({width,height:1000});
  const doc=structuredClone(base);doc.components=doc.components.filter(c=>c.id==='bench-supply'||c.id==='load');const supply=doc.components[0];supply.rotation=rotation;supply.stateProperties={...supply.stateProperties,mirrorX:mirror.x,mirrorY:mirror.y};doc.connections=doc.connections.filter(w=>w.id==='supply-positive');
  const bounds=rotation%180?{width:118.5,height:147}:{width:147,height:118.5};
  const zoom=1;const viewBox={x:600+bounds.width/2-width/2,y:30+bounds.height/2-375,width,height:750};
  const config={document:doc,zoom,viewBox};await configure(config);
  const route=await ownerPoints([[-30,215],[130,215]]);doc.connections[0].vertices=route.map(p=>p.world);await configure(config);
  const sample=await ownerPoints(pairs.map(([u,v])=>[14+67*u,202+26*v]));
  assert.ok(sample.every(p=>p.owned),JSON.stringify({width,rotation,mirror,sample}));
  const corners=await ownerPoints([[14.1,202.1],[80.9,202.1],[14.1,227.9],[80.9,227.9]]);
  assert.ok(corners.every(p=>p.testid==='wire-segment'||p.testid==='wire-hit'),JSON.stringify({width,rotation,mirror,corners}));
  await page.mouse.click(sample[0].x,sample[0].y);
  const calls=await page.evaluate(()=>window.proof.calls);assert.equal(calls.filter(c=>c.name==='supply').length,1);
  if(rotation===0&&!mirror.x&&!mirror.y)await page.screenshot({path:new URL(`native-${width}.png`,output).pathname.replace(/^\/(?=[A-Za-z]:)/,'')});
  receipts.push({kind:'rotation-mirror-width',width,rotation,mirror,sample,corners,calls});
 }
 // Use a single 1:1 fixture for interaction and composition boundaries.
 await page.setViewportSize({width:1440,height:1000});
 const doc=structuredClone(base);doc.components=doc.components.filter(c=>c.id==='bench-supply'||c.id==='load');doc.components[0].stateProperties={...doc.components[0].stateProperties,mirrorX:false,mirrorY:false};doc.connections=doc.connections.filter(w=>w.id==='supply-positive');
 const config={document:doc,zoom:1,viewBox:{x:0,y:-285,width:1440,height:750}};
 await configure(config);doc.connections[0].vertices=(await ownerPoints([[-30,215],[130,215]])).map(p=>p.world);await configure(config);
 const center=(await ownerPoints([[47.5,215]]))[0];
 await configure({...config,pending:true});
 assert.equal(await page.locator('.workbench-wire-hit-layer').getAttribute('clip-path'),null);
 const pending=(await ownerPoints([[47.5,215]]))[0];assert.equal(pending.testid,'wire-segment');await page.mouse.click(pending.x,pending.y);assert.equal((await page.evaluate(()=>window.proof.calls)).filter(c=>c.name==='supply').length,0);
 receipts.push({kind:'pending-wire',pending,calls:await page.evaluate(()=>window.proof.calls)});
 const withVertex=structuredClone(doc);withVertex.connections[0].vertices=[center.world];await configure({...config,document:withVertex,selection:{kind:'wire',id:'supply-positive'}});
 const vertex=(await ownerPoints([[47.5,215]]))[0];assert.equal(vertex.testid,'wire-vertex');await page.mouse.click(vertex.x,vertex.y);assert.ok((await page.evaluate(()=>window.proof.calls)).some(c=>c.name==='vertexDrag'));
 receipts.push({kind:'selected-vertex-priority',vertex,calls:await page.evaluate(()=>window.proof.calls)});
 await configure({...config,selection:{kind:'wire',id:'supply-positive'}});
 const endpoint=page.locator('[data-testid="wire-endpoint"]').first();const endpointBox=await endpoint.boundingBox();await page.mouse.click(endpointBox.x+endpointBox.width/2,endpointBox.y+endpointBox.height/2);assert.ok((await page.evaluate(()=>window.proof.calls)).some(c=>c.name==='endpointDrag'));
 receipts.push({kind:'selected-endpoint-priority',calls:await page.evaluate(()=>window.proof.calls)});
 // Foreground body bounds conservatively suppress the whole hole, even if its
 // alpha mask leaves some control pixels exposed. No invisible wire gap.
 const overlap=structuredClone(doc);const cover=structuredClone(base.components.find(c=>c.id==='load'));cover.id='cover';cover.position={x:600,y:130};overlap.components.push(cover);await configure({...config,document:overlap});
 assert.equal(await page.locator('.workbench-wire-hit-layer').getAttribute('clip-path'),null);
 receipts.push({kind:'conservative-foreground-overlap',clips:await page.locator('clipPath').count()});
 await configure(config);
 const two=structuredClone(doc);const second=structuredClone(two.components[0]);second.id='second-supply';second.position={x:820,y:30};two.components.push(second);await configure({...config,document:two});
 assert.equal(await page.locator('clipPath').count(),2);const ids=await page.locator('clipPath').evaluateAll(es=>es.map(e=>e.id));assert.equal(new Set(ids).size,2);assert.equal(await page.locator('clipPath').nth(1).locator('path').getAttribute('clip-path'),`url(#${ids[0]})`);
 const intersect=(await ownerPoints([[47.5,215]]))[0];assert.ok(intersect.owned);
 receipts.push({kind:'two-supply-intersection',ids,intersect});
 const coincident=structuredClone(two);coincident.components.find(c=>c.id==='second-supply').position={x:600,y:30};await configure({...config,document:coincident});assert.equal(await page.locator('clipPath').count(),1);const occluded=(await ownerPoints([[47.5,215]]))[0];assert.ok(occluded.owned);await page.mouse.click(occluded.x,occluded.y);const overlapCalls=await page.evaluate(()=>window.proof.calls);assert.deepEqual(overlapCalls.filter(c=>c.name==='supply').map(c=>c.args[0]),['second-supply']);receipts.push({kind:'overlapping-supplies',occluded,calls:overlapCalls});
 await page.evaluate(c=>window.configure(c),{...config,document:{...doc,components:doc.components.filter(c=>c.id!=='bench-supply'),connections:[]}});await page.waitForTimeout(30);assert.equal(await page.locator('clipPath').count(),0);receipts.push({kind:'unmount-cleans-exclusion'});

 await configure({...config,twoStages:'hidden'});assert.equal(await page.locator('clipPath').count(),1);
 await configure({...config,twoStages:true});await page.waitForFunction(()=>document.querySelectorAll('clipPath').length===2);const twoStageIds=await page.locator('clipPath').evaluateAll(es=>es.map(e=>e.id));assert.equal(new Set(twoStageIds).size,2);receipts.push({kind:'two-stages-unique-ids',ids:twoStageIds});
 await configure(config);
 const body=(await ownerPoints([[147,70]]))[0];await page.mouse.click(body.x,body.y);assert.ok((await page.evaluate(()=>window.proof.calls)).some(c=>c.name==='bodyDrag'));receipts.push({kind:'body-drag-select',calls:await page.evaluate(()=>window.proof.calls)});
 await configure(config);const outside=(await ownerPoints([[100,215]]))[0];assert.equal(outside.testid,'wire-segment');await page.mouse.dblclick(outside.x,outside.y);const outsideCalls=await page.evaluate(()=>window.proof.calls);assert.ok(outsideCalls.some(c=>c.name==='segmentDrag'));assert.ok(outsideCalls.some(c=>c.name==='bend'));receipts.push({kind:'outside-wire-segment-bend',outside,calls:outsideCalls});
 // Whole-wire width remains 20/30 and segment width14/24; test the annulus
 // at 9 desktop pixels (whole only) and 14 mobile pixels (whole only).
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});const cfg={...config,viewBox:{...config.viewBox,width,x:600+147/2-width/2}};await configure(cfg);
  const widths=await page.locator('.workbench-wire-hit-layer').evaluate(e=>({whole:getComputedStyle(e.querySelector('.workbench-wire-hit')).strokeWidth,segment:getComputedStyle(e.querySelector('.workbench-wire-segment-hit')).strokeWidth}));assert.deepEqual(widths,width<=980?{whole:'30px',segment:'24px'}:{whole:'20px',segment:'14px'});
  const start=(await ownerPoints([[-20,215]]))[0];const q={x:start.x,y:start.y+(width<=980?14:9)};const hit=await page.evaluate(q=>document.elementFromPoint(q.x,q.y)?.getAttribute('data-testid'),q);assert.equal(hit,'wire-hit');await page.mouse.click(q.x,q.y);assert.ok((await page.evaluate(()=>window.proof.calls)).some(c=>c.name==='selection'));receipts.push({kind:'unchanged-hit-widths',width,widths,q,hit,calls:await page.evaluate(()=>window.proof.calls)});
 }
 await page.setViewportSize({width:1440,height:1000});

 for(const zoom of [.2,.35,2,4]){
  const cfg={...config,zoom,viewBox:{x:673.5-720/zoom,y:89.25-375/zoom,width:1440/zoom,height:750/zoom}};await configure(cfg);const point=(await ownerPoints([[47.5,215]]))[0];assert.ok(point.owned);const domain=await page.locator('clipPath path').first().getAttribute('d');assert.ok(!/NaN|Infinity/.test(domain));receipts.push({kind:'finite-domain-zoom',zoom,point,domain});
 }
 await configure(config);const knobDoc=structuredClone(doc);knobDoc.connections[0].vertices=(await ownerPoints([[0,75],[100,75]])).map(p=>p.world);await configure({...config,document:knobDoc});const knob=(await ownerPoints([[53,75]]))[0];assert.ok(knob.testid==='wire-segment'||knob.testid==='wire-hit');receipts.push({kind:'knob-wire-priority-unchanged',knob});
 await configure(config);const terminal=page.locator('[data-terminal-component-id="bench-supply"][data-terminal-id="positive"]');const tb=await terminal.boundingBox();await page.mouse.click(tb.x+tb.width/2,tb.y+tb.height/2);const terminalCalls=await page.evaluate(()=>window.proof.calls);assert.equal(terminalCalls.filter(c=>c.name==='terminal').length,1);receipts.push({kind:'native-terminal-route',calls:terminalCalls});
 // New documents isolate the actual source cache: delayed, failed and malformed
 // owner input must never create a clip from the fallback image.
 for(const mode of ['loading','failed','malformed']){
  const ctx=await browser.newContext({viewport:{width:1440,height:1000}});const p=await ctx.newPage();let release;const gate=new Promise(r=>release=r);let sourceRequested=false;
  await ctx.route('https://native877.invalid/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.startsWith('/assets/')){if(path.includes('reg_power_supply')||path.includes('regulated-power-supply')){sourceRequested=true;if(mode==='loading')await gate;if(mode==='failed')return route.fulfill({status:503,body:'unavailable'});if(mode==='malformed')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 294 237"><rect width="294" height="237"/></svg>'});}return route.fulfill({body:readFileSync(resolve('apps/web/public','.'+path)),contentType:path.endsWith('.json')?'application/json':'image/svg+xml'});}return route.fulfill({contentType:'text/html',body:'<!doctype html><style>'+css+' .workbench-stage{width:1440px;height:750px}</style><div id="app"></div><script>'+ui+'</script>'});});
  await p.goto('https://native877.invalid/');await p.waitForFunction(()=>window.configure);await p.evaluate(c=>window.configure(c),config);await p.waitForTimeout(150);assert.ok(sourceRequested);assert.equal(await p.locator('clipPath').count(),0);const fallback=await p.locator('[data-owner-svg-status]').first().getAttribute('data-owner-svg-status');
  if(mode==='loading'){assert.equal(fallback,'loading');release();await p.waitForFunction(()=>document.querySelectorAll('clipPath').length===1);}else{release();assert.equal(await p.locator('.workbench-regulated-supply-runtime').count(),0);}
  receipts.push({kind:'owner-source-'+mode,fallback,exclusionsBeforeReady:0});await ctx.close();
 }
 assert.deepEqual(errors,[]);
} finally {await browser.close();writeFileSync(new URL('native-result.json',output),JSON.stringify({receipts,errors,sourceHashes:Object.fromEntries(['WorkbenchStage.tsx','ProductionComponentVisual.tsx','supply-switch-hit-geometry.ts'].map(f=>[f,createHash('sha256').update(readFileSync('apps/web/src/electronics/'+f)).digest('hex')]))},null,2)+'\n');}
console.log(JSON.stringify({nativePoses:receipts.length,errors}));
