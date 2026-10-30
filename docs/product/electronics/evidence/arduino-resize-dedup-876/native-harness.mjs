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
const assets=new Map();
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const before = process.argv.includes('--before');
const baseline = '6edb1afc1e013f686a26f80c87939bc66051d4f8';
const output = resolve('reports/arduino-resize-876', process.argv.includes('--after')?'after':'before');
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
window.fixture.pointerEvents=[];document.addEventListener('pointerdown',e=>{if(e.target.matches('[role=separator]'))window.fixture.pointerEvents.push({type:e.type,trusted:e.isTrusted,button:e.button,prevented:e.defaultPrevented,captured:e.target.hasPointerCapture(e.pointerId),className:e.target.className});});const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker{constructor(){super(URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'})));window.fixture.worker=this;this.addEventListener('message',e=>window.fixture.responses.push(e.data));}postMessage(m){window.fixture.requests.push(m);super.postMessage(m);}};
const query=new URL(window.location.href).searchParams;
let saved=${JSON.stringify(JSON.parse(gunzipSync(await readFile('docs/product/electronics/evidence/instrument-native-projection-873/before-raw.json.gz')).toString('utf8')).rows.find(r=>r.name==='whole-document-0').observation.actual)};saved.simulation.running=false;saved.components=[{id:'uno',kind:'visual',componentTypeId:'arduino-uno',variantId:'arduino-uno',name:'Uno',position:{x:100,y:100},value:5,stateProperties:{arduinoCodeMode:'blocks',arduinoWorkspace:'{"blocks":{"blocks":[]}}',arduinoSource:'void setup(){} void loop(){}'}}];saved.wires=[];if(query.has('empty'))saved.components=[];
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
    plugins: [{name:'vendor-assets',setup(builder){builder.onResolve({filter:/\?url$/},args=>({path:resolve(args.resolveDir,args.path.replace(/\?url$/,'')),namespace:'asset'}));builder.onLoad({filter:/.*/,namespace:'asset'},async args=>{const url='https://instrument-fixture.invalid/vendor/'+args.path.split(/[\\/]/).pop();assets.set(url,{body:await readFile(args.path),contentType:args.path.endsWith('.svg')?'image/svg+xml':'image/png'});return{contents:'export default '+JSON.stringify(url)};});}},
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
          builder.onLoad({ filter: /UnusedWorkbenchStage\.tsx$/ }, async args => ({ loader:'tsx', contents:(await readFile(args.path,'utf8')).replace('const document = c.document!;', 'window.fixture.stageRenders=(window.fixture.stageRenders||0)+1;c={...c,runtimePresentationResultByComponent:window.fixture.stale};const document = c.document!;') }));
        },
      },
    ],
  })
).outputFiles[0].text;
const browser=await chromium.launch({headless:true});const receipts=[];
const ctx=await browser.newContext({viewport:{width:1600,height:1000}});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await ctx.route('https://instrument-fixture.invalid/**',async route=>{const asset=assets.get(route.request().url());if(asset)return route.fulfill(asset);const path=new URL(route.request().url()).pathname;if(path.startsWith('/assets/'))await route.fulfill({body:await readFile(resolve('apps/web/public','.'+path)),contentType:path.endsWith('.json')?'application/json':'image/svg+xml'});else if(path.startsWith('/api/'))await route.fulfill({json:{}});else await route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="app"></div><script>'+ui+'</script>'});});
async function open(empty=false){await page.goto('https://instrument-fixture.invalid/'+(empty?'?empty':''));await page.waitForFunction(()=>window.fixture.wb?.status==='ready');await page.getByRole('button',{name:'Открыть редактор кода',exact:true}).click();await page.locator(empty?'.arduino-drawer-resize-handle':'.arduino-palette-resize-handle').waitFor({state:'attached'});await page.waitForTimeout(350);}
async function width(h){return Number(await h.getAttribute('aria-valuenow'));}
async function position(h){const b=await h.boundingBox();assert.ok(b);return{x:b.x+b.width/2,y:b.y+b.height/2};}
async function drag(h,dx,button='left'){const p=await position(h);assert.ok(p.x>0&&p.x<1600&&p.y>0&&p.y<1000,JSON.stringify(p));await page.mouse.move(p.x,p.y);await page.mouse.down({button});await page.mouse.move(p.x+dx,p.y,{steps:4});await page.mouse.up({button});}
try{
await open();await page.evaluate(()=>{localStorage.setItem('asa-lab:electronics:arduino-drawer-width','800');localStorage.setItem('asa-lab:electronics:arduino-palette-width-v2','290');});await open();
for(const [name,direction,normal,shift,min,max,key] of [['drawer',-1,16,48,620,1180,'asa-lab:electronics:arduino-drawer-width'],['palette',1,12,40,220,500,'asa-lab:electronics:arduino-palette-width-v2']]){
 const h=page.locator('.arduino-'+name+'-resize-handle');const start=await width(h);const row={name,start,syntheticNegatives:[]};
 console.log(name,await h.boundingBox(),await h.evaluate(e=>{const b=e.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.outerHTML.slice(0,400)}));await page.screenshot({path:resolve(output,'initial-'+name+'.png')});await drag(h,40);assert.equal(await width(h),start+direction*40);row.drag=await width(h);
 // A second move remains anchored to the original pointer-down width.
 const p=await position(h);assert.ok(p.x>0&&p.x<1600&&p.y>0&&p.y<1000,JSON.stringify(p));await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+20,p.y);await page.mouse.move(p.x+40,p.y);await page.mouse.up();assert.equal(await width(h),row.drag+direction*40);row.anchored=await width(h);
 await h.focus();let w=await width(h);await h.press('ArrowRight');assert.equal(await width(h),w+direction*normal);w=await width(h);await h.press('ArrowLeft');assert.equal(await width(h),w-direction*normal);w=await width(h);await h.press('Shift+ArrowRight');assert.equal(await width(h),w+direction*shift);w=await width(h);await h.press('Shift+ArrowLeft');assert.equal(await width(h),w-direction*shift);row.keyboard=await width(h);
 await drag(h,40,'right');assert.equal(await width(h),row.keyboard);row.secondaryNative=await width(h);
 for(const end of ['pointercancel','lostpointercapture']){
  const p=await position(h);assert.ok(p.x>0&&p.x<1600&&p.y>0&&p.y<1000,JSON.stringify(p));await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+10,p.y);const held=await width(h);
  const result=await h.evaluate((e,end)=>{let id;for(let i=0;i<10;i++)if(e.hasPointerCapture(i))id=i;if(id===undefined)throw Error('Native capture missing');const dispatch=(type,pointerId,x)=>{const event=new PointerEvent(type,{bubbles:true,cancelable:true,pointerId,clientX:x,button:0});e.dispatchEvent(event);return event.defaultPrevented;};dispatch('pointermove',id+100,999);dispatch('pointerup',id+100,999);dispatch('pointercancel',id+100,999);return{id,classes:document.documentElement.className};},end);
  assert.equal(await width(h),held);assert.ok(result.classes.includes('arduino-'+name+'-resizing'));
  await h.evaluate((e,{end,id})=>{if(end==='lostpointercapture')e.releasePointerCapture(id);else e.dispatchEvent(new PointerEvent(end,{bubbles:true,pointerId:id}));},{end,id:result.id});
  await page.mouse.move(p.x+30,p.y);await page.mouse.up();assert.equal(await width(h),held);assert.ok(!(await page.locator('html').getAttribute('class')??'').includes('arduino-'+name+'-resizing'));row.syntheticNegatives.push({end,held,unrelatedPointerIgnored:true,nativeCapture:result.id});
 }
 await drag(h,direction*2000);assert.equal(await width(h),max);row.max=await width(h);
 await drag(h,-direction*2000);assert.equal(await width(h),min);row.min=await width(h);
 await h.focus();await h.press(direction===1?'Shift+ArrowRight':'Shift+ArrowLeft');const final=await width(h);row.nativeEvents=await page.evaluate(()=>window.fixture.pointerEvents);assert.ok(row.nativeEvents.some(e=>e.trusted&&e.button===0&&e.prevented&&e.captured));assert.ok(row.nativeEvents.some(e=>e.trusted&&e.button===2&&!e.prevented&&!e.captured));await page.waitForFunction(([key,val])=>Number(localStorage.getItem(key))===val,[key,final]);await page.screenshot({path:resolve(output,name+'.png')});await open();assert.equal(await width(page.locator('.arduino-'+name+'-resize-handle')),final);row.persisted=final;receipts.push(row);
 // Drawer must allow palette its fixed520 maximum for the next independent case.
 if(name==='drawer'){await page.evaluate(()=>localStorage.setItem('asa-lab:electronics:arduino-drawer-width','800'));await open();}
}
const layout=[];for(const width of [1440,1024,390,320]){await page.setViewportSize({width,height:1000});await open();layout.push(await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,drawer:document.querySelector('.arduino-drawer-resize-handle').outerHTML,palette:document.querySelector('.arduino-palette-resize-handle').outerHTML,mobileVisible:document.querySelector('.arduino-mobile-panel-grip').getBoundingClientRect().height>0})));assert.ok(layout.at(-1).scroll<=layout.at(-1).client);await page.screenshot({path:resolve(output,'layout-'+width+'.png')});}await page.setViewportSize({width:1440,height:1000});await open(true);const empty=page.locator('.arduino-drawer-resize-handle');const ew=await width(empty);await empty.focus();await empty.press('ArrowRight');assert.equal(await width(empty),ew-16);await page.screenshot({path:resolve(output,'empty-1440.png')});receipts.push({layout,empty:{start:ew,after:await width(empty)}});assert.deepEqual(errors,[]);console.log(JSON.stringify(receipts));
}finally{await writeFile(resolve(output,'receipt.json'),JSON.stringify({receipts,errors},null,2));await writeFile(resolve(output,'fixture-source.tsx'),source);await writeFile(resolve(output,'provenance.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceSha256:createHash('sha256').update(await readFile('apps/web/src/electronics/ArduinoCodePanel.tsx')).digest('hex'),uiSha256:createHash('sha256').update(ui).digest('hex'),note:'Production SchematicEditor/controller/Arduino panel; in-memory API only. Native mouse, key, capture and reload; wrong pointer/cancel events synthetic, lost capture by native release.'},null,2));await browser.close();}
