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
const output = resolve('reports/arduino-resize-876', process.argv.includes('--baseline-panel')?'empty-before':'empty-after');
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
createRoot(document.getElementById('app')).render(<SchematicEditor projectId="empty-876-unique" user={{id:'owner',email:'',displayName:'Owner'}} onBack={()=>{}}/>);
`;
const ui = (
  await build({
    ...opts,
    stdin: { resolveDir: resolve('apps/web'), loader: 'tsx', contents: source },
    plugins: [{name:'baseline-panel',setup(builder){if(process.argv.includes('--baseline-panel'))builder.onLoad({filter:/ArduinoCodePanel\.tsx$/},()=>({loader:'tsx',contents:execFileSync('git',['show','21ebdb1b311e773967dd29389d6ef3442c9522cb:apps/web/src/electronics/ArduinoCodePanel.tsx'],{encoding:'utf8'})}));}},{name:'vendor-assets',setup(builder){builder.onResolve({filter:/\?url$/},args=>({path:resolve(args.resolveDir,args.path.replace(/\?url$/,'')),namespace:'asset'}));builder.onLoad({filter:/.*/,namespace:'asset'},async args=>{const url='https://instrument-fixture.invalid/vendor/'+args.path.split(/[\\/]/).pop();assets.set(url,{body:await readFile(args.path),contentType:args.path.endsWith('.svg')?'image/svg+xml':'image/png'});return{contents:'export default '+JSON.stringify(url)};});}},
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
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.route('https://instrument-fixture.invalid/**',async route=>{const asset=assets.get(route.request().url());if(asset)return route.fulfill(asset);const path=new URL(route.request().url()).pathname;if(path.startsWith('/assets/'))return route.fulfill({body:await readFile(resolve('apps/web/public','.'+path)),contentType:path.endsWith('.json')?'application/json':'image/svg+xml'});return route.fulfill({contentType:'text/html',body:'<!doctype html><style>'+css+'</style><div id="app"></div><script>'+ui+'</script>'});});
try{await page.goto('https://instrument-fixture.invalid/?empty');await page.waitForFunction(()=>window.fixture.wb?.status==='ready');await page.getByRole('button',{name:'Открыть редактор кода',exact:true}).click();const empty=page.locator('.arduino-code-panel.empty.open');await empty.waitFor({state:'visible'});assert.equal(await page.locator('.arduino-palette-resize-handle').count(),0);assert.equal(await page.evaluate(()=>window.fixture.wb.document.components.length),0);const h=empty.locator('.arduino-drawer-resize-handle');const width=()=>h.getAttribute('aria-valuenow').then(Number);await h.focus();const start=await width();await h.press('ArrowRight');assert.equal(await width(),start-16);await h.press('Shift+ArrowLeft');assert.equal(await width(),start+32);await page.screenshot({path:resolve(output,'empty-1440.png')});const receipt={start,final:await width(),components:0,palette:0,html:await empty.innerHTML(),errors,panelSource:process.argv.includes('--baseline-panel')?'git21eb':'working candidate'};await writeFile(resolve(output,'receipt.json'),JSON.stringify(receipt,null,2));assert.deepEqual(errors,[]);console.log('PASS actual empty branch',start,await width());}finally{await browser.close();}
