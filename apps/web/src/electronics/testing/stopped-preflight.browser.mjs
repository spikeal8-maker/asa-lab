/* global window, document, navigator, innerWidth, innerHeight, devicePixelRatio, requestAnimationFrame, PerformanceObserver, Worker, Blob, URL, process, console, performance, setTimeout, structuredClone */
// Full production SchematicEditor/Worker sources with a disposable fixture API.
// This is candidate evidence; it is neither an installation nor a server/save acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const controlRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const arg = (name, fallback) =>
  process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const sourceRoot = resolve(arg('source-root', process.cwd()));
const fixtureRoot = resolve(controlRoot, 'tests/electronics/recovery');
const output = resolve(arg('output', 'reports/electronics-recovery'));
const phase = arg('phase', 'before');
const smoke = process.argv.includes('--smoke');
const buildOnly = process.argv.includes('--build-only');
const generate = process.argv.includes('--generate-fixtures');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const saveJson = async (path, value) => writeFile(path, json(value));
const git = (...args) =>
  execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8' }).trim();
const require = createRequire(resolve(sourceRoot, 'package.json'));
const { build } = createRequire(require.resolve('vite'))('esbuild');
const ts = require('typescript');
const prettier = require('prettier');
const { chromium } = require('@playwright/test');
const sourceSha = git('rev-parse', 'HEAD');
const requestedSourceSha = arg('expected-source-sha', null);
if (requestedSourceSha !== null) {
  assert.match(requestedSourceSha, /^[0-9a-f]{40}$/);
  assert.equal(sourceSha, requestedSourceSha, 'exact requested source revision before compilation');
}
const catalogPath = 'apps/web/public/assets/electronics/component-database/catalog.json';
const catalogText = await readFile(resolve(sourceRoot, catalogPath), 'utf8');
const sketch = await readFile(resolve(fixtureRoot, 'reconstructed-audit.ino'), 'utf8');
const alias = Object.fromEntries(
  ['', '/rendering', '/simulation', '/engine', '/timed-state'].map((suffix) => [
    '@asa-lab/electronics' + suffix,
    resolve(sourceRoot, 'contexts/electronics/' + (suffix.slice(1) || 'index') + '.ts'),
  ]),
);
alias['@asa-lab/module-sdk'] = resolve(sourceRoot, 'packages/module-sdk/src/index.ts');
alias['@asa-lab/contracts'] = resolve(sourceRoot, 'packages/contracts/src/index.ts');
const opts = {
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  minify: true,
  metafile: true,
  loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
  alias,
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env': '{}',
    'import.meta.url': '"http://127.0.0.1:4612/recovery-ui.js"',
  },
};

// The generator uses the actual catalogue, geometry, parser and load normalizer.
const fixtureModule = `
import {configureProductionLibrary,productionBreadboard} from './apps/web/src/electronics/production-manifest-adapter';
import {addComponentToDocument} from './apps/web/src/electronics/workbench-document';
import {componentPointPosition,terminalPosition} from './apps/web/src/electronics/component-catalog';
import {normalizeLoadedDocument} from './apps/web/src/electronics/use-workbench-project-state';
import {parseElectronicsDocument,canonicalElectricalModelRegistry,simulationInputDigest} from '@asa-lab/electronics';
configureProductionLibrary(${catalogText});
export {parseElectronicsDocument,canonicalElectricalModelRegistry,simulationInputDigest,normalizeLoadedDocument};
export function makeScenes(source){
 const empty=()=>({schemaVersion:4,components:[],connections:[],viewport:{x:0,y:0,zoom:1},simulation:{running:false,maxIterations:24}});
 let s3=empty();
 for(const [type,id,x,y] of [['breadboard-large','board',850,360],['arduino-uno','uno',300,650]])
  s3=addComponentToDocument(s3,type,{x,y},id).document;
 s3={...s3,components:s3.components.map(c=>c.id==='uno'?{...c,stateProperties:{...c.stateProperties,arduinoCodeMode:'text',arduinoSource:source,arduinoSerialOpen:false,arduinoBaudRate:9600}}:c)};
 let s4=JSON.parse(JSON.stringify(s3));
 const board=s4.components.find(c=>c.id==='board');
 const holes=productionBreadboard('breadboard-large').holes;
 function mount(type,id,bindings,value){
  s4=addComponentToDocument(s4,type,{x:0,y:0},id).document;
  let c=s4.components.find(c=>c.id===id);c.rotation=0;
  const [pin,holeId]=Object.entries(bindings)[0];
  const p=terminalPosition(c,c.position,pin,0);
  const h=componentPointPosition(board,board.position,holes.find(h=>h.id===holeId),0);
  c={...c,position:{x:c.position.x+h.x-p.x,y:c.position.y+h.y-p.y},holeBindings:Object.fromEntries(Object.entries(bindings).map(([p,h])=>[p,{breadboardComponentId:'board',holeId:h}]))};
  if(value!==undefined)c={...c,value};
  if(type==='resistor-axial')c.stateProperties={...c.stateProperties,resistanceUnit:'Ω'};
  if(type==='potentiometer')c.wiperPosition=0.5;
  s4={...s4,components:s4.components.map(p=>p.id===id?c:p)};
 }
 for(const [index,column] of [20,23,26,29,32].entries()){
  mount('led-5mm','led-'+index,{cathode:'I'+column,anode:'I'+(column+1)});
  mount('resistor-axial','resistor-'+index,{'lead-1':'top-negative-'+column,'lead-2':'J'+column},220);
 }
 for(const [index,column] of [54,59].entries()){
  mount('button-tactile-6mm','button-'+index,{'SW-A1':'F'+column,'SW-B1':'F'+(column+2),'SW-A2':'E'+column,'SW-B2':'E'+(column+2)});
  mount('resistor-axial','pulldown-'+index,{'lead-1':'top-negative-'+(column+2),'lead-2':'J'+(column+2)},10000);
 }
 mount('potentiometer','pot',{'terminal-1':'F7',wiper:'F8','terminal-2':'F9'},1000);
 const endpoint=(componentId,terminal)=>({componentId,terminal});
 const wiring=[
 ['uno','power-5v','board','top-positive-02'],['uno','power-gnd-1','board','top-negative-38'],
 ...[5,6,9,10,11].map((pin,i)=>['uno','d'+pin,'board','J'+([21,24,27,30,33][i])]),
 ['board','top-positive-54','board','J54'],['board','top-positive-59','board','J59'],
 ['uno','d2','board','A56'],['uno','d3','board','A61'],
 ['board','F9','board','top-positive-09'],['board','F7','board','top-negative-07'],['board','F8','uno','a5']
 ];
 s4.connections=wiring.map(([a,b,c,d],i)=>({id:'wire-'+String(i+1).padStart(2,'0'),from:endpoint(a,b),to:endpoint(c,d),vertices:[],color:['#e3212b','#2a3035','#149447','#2c62c9','#e7a400','#8d45c7'][i%6]}));
 return [normalizeLoadedDocument(s3),normalizeLoadedDocument(s4)];
}`;
const domainBundle = await build({
  ...opts,
  minify: false,
  platform: 'node',
  format: 'cjs',
  stdin: { contents: fixtureModule, resolveDir: sourceRoot, loader: 'ts' },
});
const evaluated = { exports: {} };
new Function('module', 'exports', 'require', domainBundle.outputFiles[0].text)(
  evaluated,
  evaluated.exports,
  require,
);
const domain = evaluated.exports;
if (generate) {
  await mkdir(fixtureRoot, { recursive: true });
  const [s3, s4] = domain.makeScenes(sketch);
  for (const doc of [s3, s4]) {
    const parsed = domain.parseElectronicsDocument(doc);
    assert.ok(parsed.ok, parsed.message);
    assert.deepEqual(domain.normalizeLoadedDocument(doc), doc, 'fixture load must be idempotent');
  }
  assert.equal(s3.components.length, 2);
  assert.equal(s4.components.length, 17);
  assert.equal(s4.connections.length, 14);
  const fixtureBytes = {};
  for (const [file, doc] of [
    ['s3.json', s3],
    ['s4-reconstruction.json', s4],
  ]) {
    const path = resolve(fixtureRoot, file);
    fixtureBytes[file] = await prettier.format(json(doc), {
      ...(await prettier.resolveConfig(path)),
      filepath: path,
    });
    await writeFile(path, fixtureBytes[file]);
  }
  const catalogue = JSON.parse(catalogText);
  await saveJson(resolve(fixtureRoot, 'provenance.json'), {
    format: 'asa-electronics-recovery-fixtures-v1',
    originalProject:
      'https://asa-lab.ru/projects/3283023f-5448-4ad0-b369-8701319c7c20/electronics/edit',
    originalProjectModified: false,
    originalExport:
      'UNAVAILABLE: public landing page required sign-in; no login or mutation attempted',
    originalSketch:
      'UNAVAILABLE: the supplied audit describes behaviour but does not contain the complete source',
    audit: 'ASA_Lab_Electronics_Audit_2026-11-12.docx',
    auditSourceRevision: 'f19f5d47541e9006a5d96281e7af1b1ea960615f',
    fixtureGeneratorSourceRevision: sourceSha,
    reconstruction: {
      s3: 'Synthetic 882-hole breadboard and Arduino Uno, reconstructed sketch attached',
      s4: 'New reconstruction from audit descriptions; not an original export or byte-exact historical reconstruction',
      composition:
        '1 breadboard + 1 Uno + 5 LED + 5 current-limiting resistors + 2 buttons + 2 pulldowns + 1 potentiometer = 17 components; 14 wires',
      assumedValues:
        'LED resistors 220 Ω, pulldowns 10 kΩ, potentiometer 1 kΩ at 50%; assumptions of the audit, not values read from the owner project',
      electricalFacts:
        '5V to top-positive-02; GND to top-negative-38; unbridged 31/32 rails; four LED returns on left negative half; pot F7/F8/F9; buttons on right positive half',
      reconstructionChoices:
        'Exact body coordinates, LED/button pin assignments, free equivalent holes and straight wire routing are reconstructed. LED columns20/23/26/29/32 and button columns54/59 preserve the described split-rail fault.',
      sketch:
        'Explicit reconstructed semantics: x starts0 then11, selects9..11, D5/D6 configured but not driven in loop, A5/4 PWM, serial ADC and x, two100ms delays; selection changes before the LOW write. Original spelling/order not claimed.',
      measuredPrograms:
        '90 variants in a full profile: replace the first delay(100) with delay(101 + zero-based sample index). Every raw row preserves complete expected source and SHA-256 before/after; smoke uses the first variant only.',
    },
    hashes: {
      's3.json': sha256(fixtureBytes['s3.json']),
      's4-reconstruction.json': sha256(fixtureBytes['s4-reconstruction.json']),
      'reconstructed-audit.ino': sha256(sketch),
      catalogue: sha256(catalogText),
      modelRegistry: sha256(domain.canonicalElectricalModelRegistry()),
    },
    catalogue: {
      variants: catalogue.components.length,
      modelRegistry: JSON.parse(domain.canonicalElectricalModelRegistry()),
    },
    coldReadinessBudget: 'NOT_CHECKED: this bounded package measures warm Stop editing',
  });
  console.log('Generated, parsed and normalized S3 2/0 and S4 17/14 reconstruction fixtures.');
  process.exit(0);
}

const fixtures = {};
const provenance = JSON.parse(await readFile(resolve(fixtureRoot, 'provenance.json'), 'utf8'));
for (const [name, file] of [
  ['S3', 's3.json'],
  ['S4', 's4-reconstruction.json'],
]) {
  const bytes = await readFile(resolve(fixtureRoot, file), 'utf8');
  const doc = JSON.parse(bytes);
  assert.equal(sha256(bytes), provenance.hashes[file], 'frozen fixture hash matches provenance');
  const parsed = domain.parseElectronicsDocument(doc);
  assert.ok(parsed.ok, parsed.message);
  assert.deepEqual(domain.normalizeLoadedDocument(doc), doc);
  fixtures[name] = { file, hash: sha256(bytes), document: doc };
}
assert.equal(fixtures.S4.document.components.length, 17);
assert.equal(fixtures.S4.document.connections.length, 14);
assert.equal(sha256(sketch), provenance.hashes['reconstructed-audit.ino']);
await mkdir(output, { recursive: true });

const transformReceipts = new Map();
function wrapCalculation(code, path, name) {
  const ast = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
  const matches = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(matches.length, 1, `exact single ${name} declaration`);
  const body = matches[0].body;
  assert.ok(body);
  const original = code.slice(body.getStart(ast) + 1, body.end - 1);
  const replacement = `{
const __r00Start=globalThis.performance.now();let __r00Result;let __r00Ok=false;
try{__r00Result=(()=>{${original}\n})();__r00Ok=true;return __r00Result;}
finally{const __r00Row={kind:${JSON.stringify(name)},durationMs:globalThis.performance.now()-__r00Start,startTime:__r00Start,requestId:globalThis.__asaRecoveryRequestId??null,ok:__r00Ok};
if(typeof window!=='undefined')globalThis.__asaRecovery?.calculation(__r00Row,document,__r00Result);
else globalThis.postMessage({__asaRecoveryCalculation:__r00Row});}
}`;
  return code.slice(0, body.getStart(ast)) + replacement + code.slice(body.end);
}
function probePlugin() {
  return {
    name: 'recovery-readonly-probes',
    setup(builder) {
      builder.onLoad(
        {
          filter:
            /(?:live-simulation|simulation|use-electronics-workbench)\.ts$|SchematicEditor\.tsx$/,
        },
        async ({ path }) => {
          const normalized = relative(sourceRoot, path).replaceAll('\\', '/');
          let code = await readFile(path, 'utf8');
          const originalHash = sha256(code);
          if (normalized === 'apps/web/src/electronics/live-simulation.ts')
            code = wrapCalculation(code, path, 'calculateSimulationPreflight');
          else if (normalized === 'contexts/electronics/domain/simulation.ts')
            code = wrapCalculation(code, path, 'analyseCircuit');
          else if (normalized === 'apps/web/src/pages/SchematicEditor.tsx') {
            const marker =
              'const controller = useElectronicsWorkbench(projectId, user.id, seatLearner);';
            assert.equal(code.split(marker).length, 2, 'single full-editor controller mount');
            code =
              "import {useLayoutEffect as recoveryLayoutEffect} from 'react';\n" +
              code.replace(
                marker,
                marker +
                  '\nrecoveryLayoutEffect(()=>{window.__asaRecovery?.commit(controller,window.__asaRecoveryDiagnostic,window.__asaRecoveryStoppedPreflight);});',
              );
          } else if (normalized === 'apps/web/src/electronics/use-electronics-workbench.ts') {
            const ast = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
            const matches = [];
            const stoppedSnapshots = [];
            function visit(node) {
              if (
                ts.isVariableStatement(node) &&
                node.declarationList.declarations.some(
                  (d) => d.name.getText(ast) === 'diagnosticResult',
                )
              )
                matches.push(node);
              if (
                ts.isVariableStatement(node) &&
                node.declarationList.declarations.some(
                  (d) => d.name.getText(ast) === 'stoppedPreflight',
                )
              )
                stoppedSnapshots.push(node);
              ts.forEachChild(node, visit);
            }
            visit(ast);
            assert.equal(matches.length, 1, 'single diagnostic result observation');
            assert.ok(stoppedSnapshots.length <= 1, 'unambiguous stopped preflight snapshot');
            if (phase === 'after')
              assert.equal(
                stoppedSnapshots.length,
                1,
                'candidate exposes its actual stopped snapshot',
              );
            const end = matches[0].end;
            code =
              code.slice(0, end) +
              '\nglobalThis.__asaRecoveryDiagnostic=diagnosticResult;' +
              `\nglobalThis.__asaRecoveryStoppedPreflight=${stoppedSnapshots.length ? 'stoppedPreflight' : 'null'};` +
              code.slice(end);
          } else return;
          transformReceipts.set(normalized, {
            originalSha256: originalHash,
            transformedSha256: sha256(code),
          });
          return { contents: code, loader: path.endsWith('.tsx') ? 'tsx' : 'ts' };
        },
      );
    },
  };
}
const workerBuild = await build({
  ...opts,
  entryPoints: [resolve(sourceRoot, 'apps/web/src/electronics/simulation.worker.ts')],
  plugins: [probePlugin()],
});
// Correlate worker observations with the request on the main clock. Worker-local
// duration is never subtracted from a timestamp belonging to the main thread.
const workerCode =
  "self.addEventListener('message',event=>{self.__asaRecoveryRequestId=event.data?.requestId??null;});\n" +
  workerBuild.outputFiles[0].text;
const entry = `
import React from 'react';import{createRoot}from'react-dom/client';
import{api}from'./apps/web/src/api';import{SchematicEditor}from'./apps/web/src/pages/SchematicEditor';
import{configureProductionLibrary}from'./apps/web/src/electronics/production-manifest-adapter';
import{parseElectronicsDocument,simulationInputDigest}from'@asa-lab/electronics';
import{simulationModelSetDigest}from'./contexts/electronics/domain/simulation';
import{ELECTRONICS_SIMULATION_ENGINE_REVISION,ELECTRONICS_SIMULATION_WORKER_PROTOCOL}from'./apps/web/src/electronics/simulation-worker-protocol';
configureProductionLibrary(${catalogText});window.__asaWorkerCode=${JSON.stringify(workerCode)};
window.__asaDigest=simulationInputDigest;
window.__asaRecoveryModelSet=simulationModelSetDigest();
window.__asaRecoveryEngineRevision=ELECTRONICS_SIMULATION_ENGINE_REVISION;
window.__asaRecoveryProtocol=ELECTRONICS_SIMULATION_WORKER_PROTOCOL;
window.__asaRecoveryInputKey=(document,electrical=simulationInputDigest(document,0))=>JSON.stringify({electrical,programs:document.components.filter(c=>c.componentTypeId==='arduino-uno'||c.variantId==='arduino-uno').sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(c=>[c.id,c.stateProperties?.arduinoSource??null]),modelSet:simulationModelSetDigest(),engineRevision:ELECTRONICS_SIMULATION_ENGINE_REVISION,protocolVersion:ELECTRONICS_SIMULATION_WORKER_PROTOCOL});
const initial=window.__asaInitialDocument;let saved=structuredClone(initial),revision=1;
const user={id:'r00-fixture-user',displayName:'R00 — контрольная копия',email:'r00@example.test'};
const projectId=window.__asaProjectId;
api.me=async()=>({ok:true,status:200,data:{authenticated:true,user}});
api.openProject=async()=>({ok:true,status:200,data:{project:{id:projectId,moduleKey:'electronics',title:window.__asaFixtureTitle,scope:'personal',classroomId:null,status:'active'},draft:{projectId,document:saved,revision,updatedAt:'2026-11-13T00:00:00Z'},versions:[],result:null}});
api.saveDraft=async(id,document)=>{const p=parseElectronicsDocument(structuredClone(document));if(!p.ok)throw Error(p.message);saved=p.document;revision++;window.__asaRecovery.saves.push({at:performance.now(),revision});return{ok:true,status:200,data:{draft:{projectId:id,document:saved,revision,updatedAt:'2026-11-13T00:00:00Z'},result:null}};};
createRoot(document.getElementById('app')).render(<SchematicEditor projectId={projectId} user={user} onBack={()=>{}}/>);
`;
const uiBuild = await build({
  ...opts,
  stdin: { contents: entry, resolveDir: sourceRoot, loader: 'tsx' },
  plugins: [probePlugin()],
});
const uiCode = uiBuild.outputFiles[0].text;
const css = (
  await Promise.all(
    ['workbench.css', 'workbench-mobile-properties.css'].map((file) =>
      readFile(resolve(sourceRoot, 'apps/web/src/electronics', file), 'utf8'),
    ),
  )
).join('\n');
assert.equal(transformReceipts.size, 4, 'all four observational transform boundaries compiled');
const receipt = {
  format: 'asa-electronics-recovery-build-v1',
  sourceSha,
  requestedSourceSha,
  sourceDirty: git('status', '--porcelain', '--untracked-files=no') !== '',
  harnessSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
  runtime:
    'Actual full SchematicEditor and dedicated Worker; esbuild production mode, fixture API, observational instrumentation',
  artifacts: { uiSha256: sha256(uiCode), workerSha256: sha256(workerCode), cssSha256: sha256(css) },
  transforms: Object.fromEntries(transformReceipts),
  fixtureHashes: Object.fromEntries(Object.entries(fixtures).map(([name, f]) => [name, f.hash])),
  catalogueSha256: sha256(catalogText),
  modelRegistrySha256: sha256(domain.canonicalElectricalModelRegistry()),
  sketchSha256: sha256(sketch),
  platform: {
    os: platform(),
    release: release(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    ramBytes: totalmem(),
    node: process.version,
  },
};
await saveJson(resolve(output, 'build-receipt.json'), receipt);
await saveJson(resolve(output, 'compiled-inputs.json'), {
  ui: uiBuild.metafile,
  worker: workerBuild.metafile,
});
console.log('R00 build and actual parser validation PASS', sourceSha, receipt.artifacts);
if (buildOnly) process.exit(0);
assert.equal(
  process.env.GITHUB_ACTIONS,
  'true',
  'browser evidence runs in the authorized GitHub CI only',
);
assert.equal(process.env.NX_SKIP_NX_CACHE, 'true');

// This function runs in the browser. It observes native inputs and committed DOM;
// it never calls a workbench mutation method.
function installProbe({ initial, projectId, title, workerSource, requiresStoppedSnapshot }) {
  window.__asaInitialDocument = initial;
  window.__asaProjectId = projectId;
  window.__asaFixtureTitle = title;
  window.__asaWorkerCode = workerSource;
  const resultMeta = new WeakMap();
  const inputKeys = new WeakMap();
  const inputKey = (input) => {
    let key = inputKeys.get(input);
    if (key === undefined) {
      key = window.__asaRecoveryInputKey(input);
      inputKeys.set(input, key);
    }
    return key;
  };
  const p = (window.__asaRecovery = {
    controller: null,
    diagnostic: null,
    pending: null,
    rows: [],
    calls: [],
    longTasks: [],
    saves: [],
    transport: [],
    workersCreated: 0,
    workersTerminated: 0,
    workerPending: 0,
    lastCalculationAt: 0,
    phase: 'warmup',
    calculation(row, input, result) {
      this.lastCalculationAt = performance.now();
      this.calls.push({ ...row, context: 'main', at: row.startTime, phase: this.phase });
      if (row.kind === 'calculateSimulationPreflight' && result && typeof result === 'object')
        resultMeta.set(result, {
          input,
          projectId,
          receivedAt: performance.now(),
          context: 'main',
        });
    },
    commit(controller, diagnostic, stoppedPreflight) {
      this.controller = controller;
      this.diagnostic = diagnostic;
      if (requiresStoppedSnapshot && (!stoppedPreflight || typeof stoppedPreflight !== 'object'))
        throw Error('candidate must expose its actual stopped preflight snapshot');
      const a = this.pending;
      if (!a || a.startedAt === undefined) return;
      const doc = controller.document;
      if (!doc) return;
      const c = doc?.components.find((c) => c.id === a.expected.id);
      const node = a.expected.id
        ? document.querySelector(`[data-component-id="${a.expected.id}"]`)
        : null;
      const matches = (d) => {
        const item = d?.components.find((c) => c.id === a.expected.id);
        if (a.expected.kind === 'count') return d?.components.length === a.expected.value;
        if (a.expected.kind === 'position')
          return item && (item.position.x !== a.expected.x || item.position.y !== a.expected.y);
        if (a.expected.kind === 'value') return item?.value === a.expected.value;
        return item?.stateProperties?.arduinoSource === a.expected.source;
      };
      if (a.commitAt === undefined && matches(doc)) {
        const domMatches =
          a.expected.kind === 'count'
            ? document.querySelectorAll('[data-testid="schematic-component"]').length ===
              a.expected.value
            : a.expected.kind === 'position'
              ? node &&
                Number(node.getAttribute('data-x')) === c.position.x &&
                Number(node.getAttribute('data-y')) === c.position.y
              : a.expected.kind === 'source'
                ? document.querySelector('textarea[aria-label="Код Arduino C++"]')?.value ===
                  a.expected.source
                : Boolean(node);
        if (domMatches) {
          a.commitAt = performance.now();
          a.documentMutationEpoch = controller.documentMutationEpoch();
          if (!Number.isSafeInteger(a.documentMutationEpoch) || a.documentMutationEpoch < 0)
            throw Error('committed document mutation epoch must be a nonnegative safe integer');
          a.domWitness =
            a.expected.kind === 'position'
              ? { x: node.getAttribute('data-x'), y: node.getAttribute('data-y') }
              : { componentCount: doc.components.length, expectedKind: a.expected.kind };
          requestAnimationFrame(() => {
            a.firstRafAt = performance.now();
            requestAnimationFrame(() => {
              a.secondRafAt = performance.now();
            });
          });
        }
      }
      const meta = diagnostic && resultMeta.get(diagnostic);
      if (a.diagnosticAt === undefined && a.commitAt !== undefined && meta) {
        // The same physical/program/model predicate applies to direct baseline,
        // Worker responses and accepted cache hits. Geometry is intentionally
        // excluded by the real canonical electrical digest, never by a move
        // wildcard. The candidate's actual accepted session is observed only.
        const currentInputKey = inputKey(doc);
        // Read the electrical identity already produced by the real solver.
        // Do not add another canonical SHA-256 to every observed preflight:
        // that would disproportionately burden the duplicate baseline path.
        const resultInputKey = window.__asaRecoveryInputKey(
          meta.input,
          diagnostic.simulationInputDigest,
        );
        const currentInput =
          controller.status === 'ready' &&
          controller.simulationRunning === false &&
          controller.project?.id === projectId &&
          meta.projectId === projectId &&
          typeof diagnostic.simulationInputDigest === 'string' &&
          resultInputKey === currentInputKey &&
          diagnostic.modelSetDigest === window.__asaRecoveryModelSet &&
          diagnostic.solverRevision === window.__asaRecoveryEngineRevision;
        const currentSession =
          !requiresStoppedSnapshot ||
          (meta.context === 'worker' &&
            meta.responseMatchesRequest &&
            stoppedPreflight.result === diagnostic &&
            stoppedPreflight.pending === false &&
            stoppedPreflight.error === null &&
            stoppedPreflight.projectId === projectId &&
            typeof stoppedPreflight.projectSessionId === 'string' &&
            stoppedPreflight.projectSessionId.length > 0 &&
            stoppedPreflight.projectSessionId === meta.projectSessionId &&
            stoppedPreflight.inputKey === currentInputKey &&
            stoppedPreflight.key ===
              JSON.stringify([stoppedPreflight.projectSessionId, currentInputKey]));
        if (currentInput && currentSession) {
          a.diagnosticAt = performance.now();
          a.diagnosticContext = meta.context;
          a.resultReceivedAt = meta.receivedAt;
          a.diagnosticCorrelation = {
            inputKey: currentInputKey,
            modelSetDigest: diagnostic.modelSetDigest,
            solverRevision: diagnostic.solverRevision,
            protocolVersion: window.__asaRecoveryProtocol,
            projectId,
            projectSessionId: meta.projectSessionId ?? null,
            generationId: meta.generationId ?? null,
            requestId: meta.requestId ?? null,
            acceptedKey: stoppedPreflight?.key ?? null,
            lifecycle: requiresStoppedSnapshot ? 'accepted-worker-session' : 'direct-baseline',
          };
        }
      }
    },
    arm(a) {
      if (this.pending) throw Error('previous measurement not finished');
      this.phase = 'measure';
      this.pending = { ...a, armedAt: performance.now() };
    },
    finish() {
      const a = this.pending;
      if (!a || a.commitAt === undefined || a.diagnosticAt === undefined)
        throw Error('missing current committed document/diagnostics');
      a.finishedAt = performance.now();
      a.calls = this.calls.filter((r) => r.at >= a.startedAt && r.at <= a.finishedAt);
      a.longTasks = this.longTasks.filter(
        (r) => r.startTime < a.finishedAt && r.startTime + r.duration > a.startedAt,
      );
      a.commitLatencyMs = a.commitAt - a.startedAt;
      a.diagnosticLatencyMs = a.diagnosticAt - a.startedAt;
      this.rows.push(a);
      this.pending = null;
      this.phase = 'reset';
      return a;
    },
  });
  for (const type of ['pointerdown', 'pointerup', 'input', 'keydown'])
    document.addEventListener(
      type,
      (event) => {
        const a = p.pending;
        if (a && a.startedAt === undefined && event.type === a.eventType && event.isTrusted) {
          a.startedAt = performance.now();
          a.nativeEvent = { type: event.type, trusted: event.isTrusted, key: event.key ?? null };
        }
      },
      true,
    );
  new PerformanceObserver((list) => {
    for (const e of list.getEntries())
      p.longTasks.push({ startTime: e.startTime, duration: e.duration, name: e.name });
  }).observe({ type: 'longtask', buffered: true });
  const NativeWorker = Worker;
  window.Worker = class RecoveryWorker extends NativeWorker {
    constructor(_url, options) {
      super(
        URL.createObjectURL(new Blob([window.__asaWorkerCode], { type: 'text/javascript' })),
        options,
      );
      this.requests = new Map();
      p.workersCreated++;
      this.addEventListener('message', (event) => {
        if (event.data?.__asaRecoveryCalculation) {
          event.stopImmediatePropagation();
          const row = event.data.__asaRecoveryCalculation;
          p.lastCalculationAt = performance.now();
          const request = this.requests.get(row.requestId);
          p.calls.push({
            ...row,
            context: 'worker',
            at: request?.sentAt ?? performance.now(),
            receivedAt: performance.now(),
            correlated: Boolean(request),
            phase: request?.phase ?? p.phase,
          });
          return;
        }
        const request = this.requests.get(event.data?.requestId);
        if (request) {
          this.requests.delete(event.data.requestId);
          p.workerPending--;
          p.transport.push({
            requestId: event.data.requestId,
            sentAt: request.sentAt,
            receivedAt: performance.now(),
            ok: event.data.ok,
            kind: event.data.kind,
          });
          if (event.data.result)
            resultMeta.set(event.data.result, {
              input: request.document,
              projectId,
              projectSessionId: event.data.projectSessionId,
              generationId: event.data.generationId,
              responseMatchesRequest:
                event.data.projectSessionId === request.projectSessionId &&
                event.data.generationId === request.generationId &&
                event.data.protocolVersion === request.protocolVersion,
              receivedAt: performance.now(),
              context: 'worker',
              requestId: event.data.requestId,
            });
        }
      });
    }
    postMessage(message, ...rest) {
      if (message.kind === 'preflight') {
        this.requests.set(message.requestId, {
          document: message.document,
          projectSessionId: message.projectSessionId,
          generationId: message.generationId,
          protocolVersion: message.protocolVersion,
          sentAt: performance.now(),
          phase: p.phase,
        });
        p.workerPending++;
      }
      return super.postMessage(message, ...rest);
    }
    terminate() {
      p.workersTerminated++;
      p.workerPending -= this.requests.size;
      this.requests.clear();
      return super.terminate();
    }
  };
}

const browser = await chromium.launch({ headless: true });
const profiles = [];
const environment = {
  ...receipt.platform,
  browser: browser.version(),
  headless: true,
  displayHz: 'not_applicable: CI virtual display',
  power: 'not_applicable: GitHub hosted VM',
  cache: 'warm per context, assets and editor ready before measurements',
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = (page) =>
  page.evaluate(() => structuredClone(window.__asaRecovery.controller.document));
const part = (page, id) =>
  page.locator(`[data-testid="schematic-component"][data-component-id="${id}"]`);
async function settle(page) {
  await page.waitForTimeout(300);
  await page.waitForFunction(
    () =>
      window.__asaRecovery.workerPending === 0 &&
      performance.now() - window.__asaRecovery.lastCalculationAt >= 160,
    null,
    { timeout: 20000 },
  );
}
async function setCode(page, open) {
  const target = open ? 'Открыть редактор кода' : 'Закрыть редактор кода';
  const button = page.getByRole('button', { name: target, exact: true });
  if (await button.count()) {
    await button.click();
    await page.waitForTimeout(190);
  }
}
async function emptyPoint(page) {
  return page.locator('.workbench-canvas').evaluate((svg) => {
    const r = svg.getBoundingClientRect();
    for (const [dx, dy] of [
      [80, 80],
      [150, 80],
      [80, 180],
      [150, 180],
      [220, 80],
      [80, 280],
    ]) {
      const x = r.x + dx,
        y = r.y + dy;
      const at = document.elementFromPoint(x, y);
      if (
        at?.closest('.workbench-canvas') &&
        !at.closest('[data-testid="schematic-component"],button,input,textarea')
      )
        return { x, y };
    }
    throw Error('no visible empty canvas target');
  });
}
async function canvasFocus(page) {
  const p = await emptyPoint(page);
  await page.mouse.click(p.x, p.y);
}
async function preparePlacement(page, codeOpen) {
  await setCode(page, false);
  const open = page.getByRole('button', { name: 'Открыть библиотеку', exact: true });
  if (await open.count()) await open.click();
  const item = page.locator('[data-selected-variant="resistor-axial"] .workbench-catalog-add');
  await item.scrollIntoViewIfNeeded();
  await item.focus();
  await item.press('Enter');
  if (codeOpen) await setCode(page, true);
  return emptyPoint(page);
}
async function addUnmeasured(page) {
  const old = new Set((await snapshot(page)).components.map((c) => c.id));
  const p = await preparePlacement(page, false);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(
    (n) => window.__asaRecovery.controller.document.components.length === n,
    old.size + 1,
  );
  await settle(page);
  return (await snapshot(page)).components.find((c) => !old.has(c.id)).id;
}
async function openFixture(scene, codeOpen, viewport, videoDirectory) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    ...(videoDirectory ? { recordVideo: { dir: videoDirectory, size: viewport } } : {}),
  });
  const page = await context.newPage();
  const errors = [],
    resources = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(installProbe, {
    initial: fixtures[scene].document,
    projectId: `r00-${scene}`,
    title: `${scene} — реконструкция R00`,
    workerSource: workerCode,
    requiresStoppedSnapshot: phase === 'after',
  });
  await context.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/recovery-ui.js')
      return route.fulfill({ contentType: 'text/javascript', body: uiCode });
    if (path === '/recovery.css') return route.fulfill({ contentType: 'text/css', body: css });
    if (path === '/asa-lab-mark.svg') {
      const body = await readFile(resolve(sourceRoot, 'apps/web/public/asa-lab-mark.svg'));
      resources.push({ path, sha256: sha256(body) });
      return route.fulfill({ contentType: 'image/svg+xml', body });
    }
    if (path.startsWith('/assets/')) {
      try {
        const full = resolve(sourceRoot, 'apps/web/public', '.' + decodeURIComponent(path));
        assert.ok(full.startsWith(resolve(sourceRoot, 'apps/web/public') + '/'));
        const body = await readFile(full);
        resources.push({ path, sha256: sha256(body) });
        return route.fulfill({
          body,
          contentType: path.endsWith('.json')
            ? 'application/json'
            : path.endsWith('.png')
              ? 'image/png'
              : 'image/svg+xml',
        });
      } catch (error) {
        errors.push(`resource ${path}: ${error.message}`);
        return route.fulfill({ status: 404, body: '' });
      }
    }
    if (path.startsWith('/api/')) return route.fulfill({ status: 200, json: {} });
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/recovery.css"><style>body{margin:0}#receipt{position:fixed;bottom:2px;right:6px;max-width:calc(100vw - 18px);z-index:99999;pointer-events:none;font:11px sans-serif;background:#fff9;padding:3px;overflow-wrap:anywhere}</style><div id="app"></div><div id="receipt">${phase} · ${scene} reconstruction · candidate ${sourceSha}<span id="visual-action"></span></div><script src="/recovery-ui.js"></script></html>`,
    });
  });
  await page.goto(`http://127.0.0.1:4612/projects/r00-${scene}/electronics/edit`);
  await page.waitForFunction(() => window.__asaRecovery.controller?.status === 'ready', null, {
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Подогнать проект', exact: true }).click();
  await setCode(page, codeOpen);
  await settle(page);
  assert.equal(
    await page.locator('[data-testid="schematic-component"]').count(),
    fixtures[scene].document.components.length,
  );
  assert.equal(
    await page.locator('[data-testid="owner-svg-error"],[data-testid="owner-image-error"]').count(),
    0,
  );
  const observed = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      viewport: { width: innerWidth, height: innerHeight },
      dpr: devicePixelRatio,
      visibility: document.visibilityState,
      zoom: window.__asaRecovery.controller.viewport.zoom,
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      gpu:
        gl && debug
          ? {
              vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),
              renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
            }
          : 'unavailable',
      browserZoom: '100%: fresh context, deviceScaleFactor=1',
      simulationRunning: window.__asaRecovery.controller.simulationRunning,
    };
  });
  assert.equal(observed.simulationRunning, false);
  return { context, page, errors, resources, observed };
}
async function prepareNominal(page, scene, codeOpen, profile) {
  await setCode(page, false);
  const id = scene === 'S3' ? await addUnmeasured(page) : 'resistor-0';
  await part(page, id).click();
  const input = page.locator('.workbench-value-field input[type="number"]');
  await setCode(page, true);
  const inspectAccess = async () => {
    if (!(await input.count()))
      return { visibleAtCenter: false, blocker: 'inspector input not mounted' };
    return input.evaluate((node) => {
      const r = node.getBoundingClientRect(),
        at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        visibleAtCenter: r.width > 0 && r.height > 0 && (at === node || node.contains(at)),
        blocker: at?.className?.baseVal ?? at?.className ?? null,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      };
    });
  };
  const access = { original: await inspectAccess() };
  const handle = page.getByRole('separator', {
    name: 'Изменить ширину редактора кода',
    exact: true,
  });
  const originalWidth = Number(await handle.getAttribute('aria-valuenow'));
  const beforeResize = await snapshot(page);
  const resizeByPointer = async (deltaX) => {
    const r = await handle.boundingBox();
    assert.ok(r, 'visible native code-panel resize handle');
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 + deltaX, r.y + r.height / 2, { steps: 5 });
    await page.mouse.up();
    await settle(page);
    const afterResize = await snapshot(page);
    assert.deepEqual(afterResize, beforeResize, 'panel resize must not mutate the document');
    assert.equal(
      domain.simulationInputDigest(afterResize),
      domain.simulationInputDigest(beforeResize),
      'panel resize must preserve physical input',
    );
  };
  if (!access.original.visibleAtCenter && (await handle.isVisible())) {
    await resizeByPointer(480);
    access.narrowed = await inspectAccess();
    access.narrowedWidth = Number(await handle.getAttribute('aria-valuenow'));
  }
  profile.nominalFieldAccess = access;
  await page.screenshot({ path: resolve(output, `${profile.id}-nominal-open-access.png`) });
  const mode =
    access.original.visibleAtCenter || access.narrowed?.visibleAtCenter ? 'typing' : 'history';
  if (mode === 'history' && access.narrowedWidth !== undefined)
    await resizeByPointer(-(originalWidth - access.narrowedWidth));
  profile.nominalPanelWidthPx = Number(await handle.getAttribute('aria-valuenow'));
  profile.resizeDocumentUnchanged = true;
  // Establish nominal history only after all panel-access/resize preparation.
  // Arrow resizing also reaches the existing global nudge shortcut; the probe
  // uses the real pointer handle and does not repair that product behaviour.
  await setCode(page, false);
  await part(page, id).click();
  await page
    .getByRole('combobox', { name: 'Единица сопротивления', exact: true })
    .selectOption('Ω');
  await input.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('220');
  await canvasFocus(page);
  await settle(page);
  await part(page, id).click();
  await input.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('330');
  await canvasFocus(page);
  await settle(page);
  await page.keyboard.press('Control+z');
  await settle(page);
  assert.equal((await snapshot(page)).components.find((c) => c.id === id).value, 220);
  assert.equal(
    await page.evaluate(() => window.__asaRecovery.controller.canRedo),
    true,
    'prepared nominal change must be redoable',
  );
  if (mode === 'typing') await part(page, id).click();
  if (codeOpen) await setCode(page, true);
  profile.nominalGesture =
    mode === 'typing'
      ? 'native input of 220↔330 Ω in the visible inspector'
      : 'native Undo/Redo of a manually entered 220↔330 Ω change; not typing latency';
  if (mode === 'history') await canvasFocus(page);
  await settle(page);
  return { id, mode };
}
async function measureAction(page, gesture, index, codeOpen, nominalId, label) {
  let expected,
    eventType,
    action,
    reset = async () => {};
  const before = await snapshot(page);
  if (gesture === 'add') {
    const p = await preparePlacement(page, codeOpen);
    expected = { kind: 'count', value: before.components.length + 1 };
    eventType = 'pointerdown';
    action = () => page.mouse.click(p.x, p.y);
    reset = async () => {
      await canvasFocus(page);
      await page.keyboard.press('Control+z');
      await settle(page);
      assert.equal((await snapshot(page)).components.length, before.components.length);
    };
  } else if (gesture === 'move') {
    const c = before.components.find((c) => c.id === 'uno');
    const r = await part(page, 'uno').boundingBox();
    assert.ok(r);
    const x = r.x + r.width / 2,
      y = r.y + r.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (index % 2 ? -12 : 12), y, { steps: 5 });
    expected = { kind: 'position', id: 'uno', x: c.position.x, y: c.position.y };
    eventType = 'pointerup';
    action = () => page.mouse.up();
  } else if (gesture === 'nominal') {
    expected = { kind: 'value', id: nominalId.id, value: index % 2 ? 220 : 330 };
    if (nominalId.mode === 'typing') {
      const input = page.locator('.workbench-value-field input[type="number"]');
      await input.click();
      await page.keyboard.press('Control+a');
      eventType = 'input';
      action = () => page.keyboard.insertText(String(expected.value));
    } else {
      assert.equal(
        await page.evaluate(
          (redo) =>
            redo
              ? window.__asaRecovery.controller.canRedo
              : window.__asaRecovery.controller.canUndo,
          index % 2 === 0,
        ),
        true,
        'nominal history action must remain available before arming',
      );
      eventType = 'keydown';
      action = () => page.keyboard.press(index % 2 ? 'Control+z' : 'Control+Shift+z');
    }
  } else {
    await setCode(page, true);
    const input = page.getByRole('textbox', { name: 'Код Arduino C++', exact: true });
    await input.click();
    await page.keyboard.press('Control+a');
    const source = sketch.replace('delay(100);', `delay(${101 + index});`);
    expected = { kind: 'source', id: 'uno', source };
    eventType = 'input';
    action = () => page.keyboard.insertText(source);
    if (!codeOpen) reset = async () => setCode(page, false);
  }
  const beforeDigest = domain.simulationInputDigest(before);
  await page.evaluate((a) => window.__asaRecovery.arm(a), {
    id: label,
    gesture,
    eventType,
    expected,
  });
  await action();
  await page.waitForFunction(
    () =>
      window.__asaRecovery.pending?.commitAt !== undefined &&
      window.__asaRecovery.pending?.diagnosticAt !== undefined,
    null,
    { timeout: 20000 },
  );
  await settle(page);
  const row = await page.evaluate(() => window.__asaRecovery.finish());
  const after = await snapshot(page);
  row.electricalDigestBefore = beforeDigest;
  row.electricalDigestAfter = domain.simulationInputDigest(after);
  row.programHashesBefore = Object.fromEntries(
    before.components
      .filter((c) => c.componentTypeId === 'arduino-uno' || c.variantId === 'arduino-uno')
      .map((c) => [c.id, sha256(c.stateProperties?.arduinoSource ?? '')]),
  );
  row.programHashesAfter = Object.fromEntries(
    after.components
      .filter((c) => c.componentTypeId === 'arduino-uno' || c.variantId === 'arduino-uno')
      .map((c) => [c.id, sha256(c.stateProperties?.arduinoSource ?? '')]),
  );
  row.latencyBoundary =
    gesture === 'move'
      ? 'native pointer release → matching committed document; whole drag is present in visual replay'
      : 'native event → matching committed document';
  row.codePanelAtCommit = gesture === 'source' ? 'open' : codeOpen ? 'open' : 'closed';
  if (gesture === 'move')
    assert.equal(
      row.electricalDigestAfter,
      beforeDigest,
      'movement must preserve electrical input',
    );
  if (gesture === 'nominal' || gesture === 'add')
    assert.notEqual(row.electricalDigestAfter, beforeDigest);
  if (gesture === 'source')
    row.sourceTransition = codeOpen
      ? 'type with code open'
      : 'open → type → close; measured native input starts after opening';
  await reset();
  return row;
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
  return { n: values.length, p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1) ?? 0 };
}
function summarize(rows) {
  const calls = rows.flatMap((r) => r.calls),
    tasks = rows.flatMap((r) => r.longTasks);
  return {
    samples: rows.length,
    commitLatencyMs: stats(rows.map((r) => r.commitLatencyMs)),
    diagnosticLatencyMs: stats(rows.map((r) => r.diagnosticLatencyMs)),
    preflight: Object.fromEntries(
      ['main', 'worker'].map((context) => [
        context,
        {
          apiCalls: calls.filter(
            (r) => r.context === context && r.kind === 'calculateSimulationPreflight',
          ).length,
          actualAnalyses: calls.filter((r) => r.context === context && r.kind === 'analyseCircuit')
            .length,
          analysisDurationMs: stats(
            calls
              .filter((r) => r.context === context && r.kind === 'analyseCircuit')
              .map((r) => r.durationMs),
          ),
        },
      ]),
    ),
    longTasks: {
      count: tasks.length,
      totalMs: tasks.reduce((sum, r) => sum + r.duration, 0),
      durationMs: stats(tasks.map((r) => r.duration)),
    },
  };
}
const protocol = {
  passes: smoke ? 1 : 3,
  samplesPerPass: smoke ? 1 : 30,
  slotMs: 1000,
  settlementMs: 300,
  gestures: ['add', 'move', 'nominal', 'source'],
  numericViewport: { width: 1920, height: 1080 },
  smokeNotAcceptance: smoke,
};
try {
  for (const scene of ['S3', 'S4'])
    for (const codeOpen of [false, true])
      for (const gesture of protocol.gestures) {
        const id = `${phase}-${scene}-${codeOpen ? 'code-open' : 'code-closed'}-${gesture}`;
        const f = await openFixture(scene, codeOpen, protocol.numericViewport);
        const profile = {
          id,
          scene,
          codeOpen,
          gesture,
          observed: f.observed,
          passes: [],
          fixtureSha256: fixtures[scene].hash,
          initialDiagnostic: await f.page.evaluate(() =>
            structuredClone(window.__asaRecovery.diagnostic),
          ),
        };
        try {
          let nominalId;
          if (gesture === 'nominal')
            nominalId = await prepareNominal(f.page, scene, codeOpen, profile);
          // Warm the same catalogue variant and code module through real UI once.
          if (gesture === 'add') {
            await preparePlacement(f.page, codeOpen);
            await f.page.keyboard.press('Escape');
          }
          if (gesture === 'source') {
            await setCode(f.page, true);
            if (!codeOpen) await setCode(f.page, false);
          }
          await settle(f.page);
          profile.nominalMode = nominalId?.mode ?? null;
          for (let pass = 0; pass < protocol.passes; pass++) {
            const started = Date.now(),
              rows = [];
            for (let index = 0; index < protocol.samplesPerPass; index++) {
              const scheduled = started + index * protocol.slotMs;
              if (!smoke) await sleep(Math.max(0, scheduled - Date.now()));
              const commandStarted = Date.now();
              const sequence = pass * protocol.samplesPerPass + index;
              const row = await measureAction(
                f.page,
                gesture,
                sequence,
                codeOpen,
                nominalId,
                `${id}-p${pass + 1}-s${index + 1}`,
              );
              row.scheduledSlot = index;
              row.startDeadlineMissMs = Math.max(0, commandStarted - scheduled);
              row.harnessWallMs = Date.now() - commandStarted;
              rows.push(row);
            }
            const raw = {
              pass: pass + 1,
              scheduledWindowMs: protocol.samplesPerPass * protocol.slotMs,
              actualElapsedMs: Date.now() - started,
              rows,
              summary: summarize(rows),
            };
            profile.passes.push(raw);
            await saveJson(resolve(output, `${id}-pass${pass + 1}.json`), raw);
          }
          profile.summary = summarize(profile.passes.flatMap((p) => p.rows));
          profile.allContextEvidence = await f.page.evaluate(() => ({
            calls: window.__asaRecovery.calls,
            longTasks: window.__asaRecovery.longTasks,
            saves: window.__asaRecovery.saves,
            transport: window.__asaRecovery.transport,
            workersCreated: window.__asaRecovery.workersCreated,
            workersTerminated: window.__asaRecovery.workersTerminated,
          }));
          profile.assetResponses = f.resources;
          assert.deepEqual(f.errors, []);
          profiles.push(profile);
          console.log('MEASURED', id, JSON.stringify(profile.summary));
          await saveJson(resolve(output, 'incremental-results.json'), {
            receipt,
            environment,
            protocol,
            profiles,
          });
        } catch (error) {
          await f.page.screenshot({ path: resolve(output, `${id}-failure.png`) });
          await saveJson(resolve(output, `${id}-failure.json`), {
            error: String(error),
            errors: f.errors,
            profile,
            browserProbe: await f.page.evaluate(() => ({
              pending: window.__asaRecovery.pending,
              calls: window.__asaRecovery.calls,
              transport: window.__asaRecovery.transport,
              status: window.__asaRecovery.controller?.status,
            })),
          });
          throw error;
        } finally {
          await f.context.close();
        }
      }
  // Separate visual replay: tracing/video do not distort numeric passes.
  const visual = [];
  const visualActionNames = {
    add: 'Добавить загруженный резистор',
    move: 'Переместить Arduino без изменения связей',
    nominal: 'Изменить номинал 220 → 330 Ω',
    source: 'Изменить программу Arduino',
  };
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    for (const scene of ['S3', 'S4']) {
      const id = `${phase}-${scene}-${viewport.width}-visual`;
      const dir = resolve(output, 'videos');
      await mkdir(dir, { recursive: true });
      const f = await openFixture(scene, false, viewport, dir);
      const actions = [];
      const labelAction = async (text) =>
        f.page.locator('#visual-action').evaluate((node, value) => {
          node.textContent = ` · Stop · ${value}`;
        }, text);
      const trace = [],
        cdp = await f.context.newCDPSession(f.page);
      cdp.on('Tracing.dataCollected', (event) => trace.push(...event.value));
      await cdp.send('Tracing.start', {
        categories: 'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline',
        options: 'record-as-much-as-possible',
      });
      try {
        for (const codeOpen of [false, true]) {
          await setCode(f.page, codeOpen);
          await labelAction(codeOpen ? 'Код открыт' : 'Код закрыт');
          await f.page.waitForTimeout(800);
          await f.page.screenshot({
            path: resolve(output, `${id}-${codeOpen ? 'open' : 'closed'}.png`),
          });
          if (codeOpen)
            assert.ok(
              await f.page
                .getByRole('button', { name: 'Закрыть редактор кода', exact: true })
                .isVisible(),
            );
          if (viewport.width < 1366) continue;
          for (const gesture of protocol.gestures) {
            const label = `${id}-${codeOpen ? 'open' : 'closed'}-${gesture}`;
            const nominalProfile = { id: label };
            if (gesture === 'nominal')
              await labelAction('Подготовка истории номинала 220 ↔ 330 Ω (вне измерения)');
            const nominal =
              gesture === 'nominal'
                ? await prepareNominal(f.page, scene, codeOpen, nominalProfile)
                : null;
            await labelAction(
              `${codeOpen ? 'Код открыт' : 'Код закрыт'} · ${visualActionNames[gesture]}${
                nominal?.mode === 'history' ? ' (Undo/Redo)' : ''
              }`,
            );
            const row = await measureAction(
              f.page,
              gesture,
              gesture === 'source' && codeOpen ? 1 : 0,
              codeOpen,
              nominal,
              label,
            );
            actions.push({ codeOpen, gesture, nominalMode: nominal?.mode ?? null, row });
          }
        }
        await labelAction('Визуальный сценарий завершён');
        await setCode(f.page, false);
        const completion = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
        await cdp.send('Tracing.end');
        await completion;
        await writeFile(
          resolve(output, `${id}-trace.json.gz`),
          gzipSync(json({ traceEvents: trace })),
        );
        assert.deepEqual(f.errors, []);
        const video = f.page.video();
        await f.context.close();
        const path = resolve(output, `${id}.webm`);
        await video.saveAs(path);
        visual.push({
          id,
          scene,
          viewport,
          video: `${id}.webm`,
          trace: `${id}-trace.json.gz`,
          observed: f.observed,
          actions,
        });
      } catch (error) {
        await f.page.screenshot({ path: resolve(output, `${id}-failure.png`) });
        await f.context.close();
        throw error;
      }
    }
  }
  const report = {
    format: 'asa-electronics-recovery-performance-v1',
    phase,
    receipt,
    environment,
    protocol,
    profiles,
    visual,
    acceptedMeasurementBoundary:
      'Native input to matching committed DOM and current diagnostic result; RAF is scheduling evidence, not proof of paint. Headless CI is not the owner computer.',
  };
  await saveJson(resolve(output, 'report.json'), report);
  const rows = profiles
    .map(
      (p) =>
        `<tr><td>${p.scene}</td><td>${p.codeOpen ? 'open' : 'closed'}</td><td>${p.gesture}</td><td>${p.summary.samples}</td><td>${p.summary.preflight.main.actualAnalyses}</td><td>${p.summary.preflight.worker.actualAnalyses}</td><td>${p.summary.commitLatencyMs.p95.toFixed(2)}</td><td>${p.summary.diagnosticLatencyMs.p95.toFixed(2)}</td><td>${p.summary.longTasks.count}</td><td>${p.summary.longTasks.durationMs.max.toFixed(2)}</td></tr>`,
    )
    .join('');
  await writeFile(
    resolve(output, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>R00 ${phase}</title><style>body{font:16px system-ui;margin:24px;background:#f7fafc;color:#0b3558}table{border-collapse:collapse}th,td{padding:8px;border:1px solid #aaa}video{max-width:100%;width:960px}</style><h1>${phase} · ${sourceSha}</h1><p>${smoke ? 'SMOKE — NOT ACCEPTANCE' : '3 fixed 30-slot passes per action/profile'} · Full SchematicEditor and real Worker · Fixture API · No deployment</p><p>Source/render/worker/CSS/scene hashes and all raw observations: <a href="report.json">report.json</a>.</p><table><tr><th>Scene</th><th>Code</th><th>Action</th><th>N</th><th>Main analyses</th><th>Worker analyses</th><th>Commit p95 ms</th><th>Diagnostics p95 ms</th><th>Long tasks</th><th>Max task ms</th></tr>${rows}</table>${visual.map((v) => `<h2>${v.id}</h2><video src="${v.video}" controls></video><p><a href="${v.trace}">Rendering/Paint trace</a></p>`).join('')}`,
  );
  console.log(smoke ? 'SMOKE PASS — NOT ACCEPTANCE' : 'R00 FULL BEFORE EVIDENCE PASS', output);
} finally {
  await browser.close();
}
