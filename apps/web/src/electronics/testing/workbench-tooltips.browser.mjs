/* global window, document, requestAnimationFrame */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import process from 'node:process';
import {chromium} from '@playwright/test';
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('vite'))('esbuild');
const before=process.argv.includes('--before');
const baseline='81bdb813c7765c9280442efb2dea6b32e543c91e';
const historic=path=>execFileSync('git',['show',baseline+':'+path],{encoding:'utf8'});
const output=resolve('test-results/workbench-tooltips',before?'before':'after');
await mkdir(output,{recursive:true});
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {WorkbenchHeader} from './WorkbenchHeader';
const counts={};const hit=n=>counts[n]=(counts[n]||0)+1;
const c={projectTitle:'Проверка панели Arduino',project:{title:'Проверка'},saveStatus:'unsaved',saveIssue:null,localCopySaved:true,busy:false,selection:{kind:'component'},hasClipboard:true,canUndo:true,canRedo:true,activeWireColor:'#149447',orthogonalWireMode:false,libraryOpen:true,simulationRunning:false,simulationStatus:'stopped',simulationMessage:null,nativeOpticalPresentation:{subscribeClock:()=>()=>{},readClock:()=>0}};
for(const name of ['copySelected','pasteCopied','removeSelection','undo','redo','rotateSelected','mirrorSelected','renameProject','setProjectTitle','exportEmergencyCopy','saveNow'])c[name]=()=>hit(name);
let code=false,view='breadboard';const root=createRoot(document.getElementById('app'));
c.toggleSimulation=()=>{hit('run');c.simulationRunning=!c.simulationRunning;c.simulationStatus=c.simulationRunning?'running':'stopped';render()};c.toggleWireRoute=()=>{hit('path');c.orthogonalWireMode=!c.orthogonalWireMode;render()};c.setWireColor=color=>{hit('color');c.activeWireColor=color;render()};
function render(){root.render(<div className="workbench-shell"><WorkbenchHeader controller={c} user={{id:'fixture',displayName:'Проверка',identityKind:'student-seat'}} view={view} notesOpen={false} codeOpen={code} onBack={()=>hit('back')} onViewChange={v=>{view=v;render()}} onToggleNotes={()=>hit('notes')} onToggleCode={()=>{hit('code');code=!code;render()}} onToggleLibrary={()=>hit('library')} onOpenShare={()=>hit('share')} onExportView={()=>hit('export')}/><main className="workbench-main"/></div>)}
window.fixture={counts,set:patch=>{Object.assign(c,patch);render()},dispose:()=>root.unmount()};render();`;
const bundle=await build({stdin:{contents:source,resolveDir:resolve('apps/web/src/electronics'),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:before?[{name:'current-baseline-header',setup(builder){builder.onLoad({filter:/WorkbenchHeader\.tsx$/},()=>({contents:historic('apps/web/src/electronics/WorkbenchHeader.tsx'),loader:'tsx'}));}}]:[]});
const css=before?historic('apps/web/src/electronics/workbench.css'):await readFile('apps/web/src/electronics/workbench.css','utf8');
const browser=await chromium.launch({headless:true});
const receipts=[];
try{
for(const width of [1440,1024,390,320]){
const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1.25,hasTouch:true});
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/asa-lab-mark.svg')return route.fulfill({contentType:'image/svg+xml',body:await readFile('apps/web/public/asa-lab-mark.svg','utf8')});return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}'+css+'</style><div id="app"></div>'});});
await page.goto('https://tooltip-fixture.invalid/');await page.addScriptTag({content:bundle.outputFiles[0].text});
const copy=page.getByRole('button',{name:'Копировать (Ctrl+C)',exact:true});await copy.waitFor();
await copy.scrollIntoViewIfNeeded();await copy.hover();
const hover=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve({tooltips:document.querySelectorAll('[role="tooltip"]').length,title:document.querySelector('[aria-label="Копировать (Ctrl+C)"]').getAttribute('title')}))));
if(before){assert.equal(hover.tooltips,0);assert.equal(hover.title,'Копировать (Ctrl+C)');
await page.mouse.move(width-2,899);await page.locator('body').click({position:{x:width-2,y:898}});
for(let i=0;i<30;i++){await page.keyboard.press('Tab');if(await copy.evaluate(e=>e===document.activeElement))break;}
assert.equal(await copy.evaluate(e=>e===document.activeElement),true);
const focus=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve({tooltips:document.querySelectorAll('[role="tooltip"]').length,focused:document.activeElement.getAttribute('aria-label')}))));
assert.equal(focus.tooltips,0);assert.ok(Object.keys(await page.evaluate(()=>window.fixture.counts)).every(name=>name==='renameProject'));
receipts.push({width,dpr:1.25,hover,focus,boundary:'Native title attribute exists; no immediate DOM help. OS tooltip latency is not measured in headless Chromium.'});
if(width===1440||width===320)await page.screenshot({path:resolve(output,'toolbar-'+width+'.png')});
}else{throw new Error('AFTER assertions not implemented yet');}
assert.deepEqual(errors,[]);await context.close();
}
await writeFile(resolve(output,'receipt.json'),JSON.stringify(receipts,null,2));console.log(JSON.stringify(receipts));
}finally{await browser.close();}
