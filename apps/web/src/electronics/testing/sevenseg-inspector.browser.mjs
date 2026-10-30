// Mounted production editor, Stage, inspector and actual Chromium simulation Worker.
// Only API/static-resource ports and read-only instrumentation are fixture supplied.
/* global window, document, URL, console, requestAnimationFrame, MessageEvent */
import assert from 'node:assert/strict';
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
const output = resolve('test-results/sevenseg-inspector-872', before ? 'before' : 'after');
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
    'import.meta.url': '"https://sevenseg-fixture.invalid/fixture.js"',
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
let saved=rawDisplayCircuit({active:query.get('mask'),commonAnode:query.get('anode')==='true'});
saved.simulation.running=false;
saved.components.forEach((c,i)=>c.position=c.id==='display'?{x:0,y:0}:c.id==='uno'?{x:500,y:350}:{x:330,y:50+i*32});
saved.components.push({...saved.components.find(c=>c.id==='display'),id:'other-display',position:{x:710,y:350}});
let revision=1;
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
          builder.onLoad({ filter: /WorkbenchSidebars\.tsx$/ }, () => ({
            loader: 'tsx',
            contents: sidebarSource.replace(
              'const [helpOpen, setHelpOpen] = useState(false);',
              'window.fixture.sidebarRenders++; c={...c,resultByComponent:window.fixture.stale}; const [helpOpen, setHelpOpen] = useState(false);',
            ),
          }));
        },
      },
    ],
  })
).outputFiles[0].text;
const browser = await chromium.launch({ headless: true });
const receipts = [];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
await writeFile(
  resolve(output, 'source-provenance.json'),
  JSON.stringify(
    {
      mode: before ? 'immutable-main-baseline-reproduction' : 'candidate',
      baseline,
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sidebarSha256: sha256(sidebarSource),
      workerBundleSha256: sha256(worker),
      fixtureSourceSha256: sha256(source),
      note: 'Initial BEFORE captured before product edit; baseline mode also reproduces immutable main after local product edits without reverting them.',
    },
    null,
    2,
  ),
);
await writeFile(resolve(output, 'fixture-source.tsx'), source);
async function readout(page) {
  return page.evaluate(() => ({
    snapshot: window.fixture.snapshot(),
    mask: document.querySelector('[data-testid="seven-segment-active-mask"]')?.textContent,
    rows: [
      ...document.querySelectorAll('[data-testid="seven-segment-junction-measurements"] > div'),
    ].map((row) => ({
      name: row.querySelector('dt')?.textContent,
      value: row.querySelector('dd')?.textContent,
    })),
    stage: [...document.querySelectorAll('[data-component-id="display"] [data-segment]')].map(
      (n) => ({ id: n.getAttribute('data-segment'), opacity: Number(n.getAttribute('opacity')) }),
    ),
  }));
}
function check(record, mask) {
  const component = record.snapshot.committed.result.components.find(
    (c) => c.componentId === 'display',
  );
  assert.equal(record.snapshot.committed.result.solved, true);
  assert.equal(record.snapshot.committed.result.quality.finite, true);
  assert.equal(record.snapshot.committed.result.quality.passed, true);
  const expected = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].filter((s) =>
    s === 'dp' ? mask.includes('dp') : mask.replace('dp', '').includes(s),
  );
  assert.equal(
    record.mask,
    'Светятся: ' + (expected.length ? expected.map((s) => s.toUpperCase()).join(', ') : 'нет'),
  );
  for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp']) {
    const current = component.branchCurrents[s],
      brightness = component.branchBrightness[s];
    assert.ok(Number.isFinite(current) && Number.isFinite(brightness));
    assert.equal(brightness > 0, expected.includes(s));
    const row = record.rows.find((row) => row.name === s.toUpperCase());
    assert.ok(row.value.includes((Math.abs(current) * 1000).toFixed(2) + ' мА'));
    assert.ok(row.value.includes(brightness.toFixed(0) + '%'));
  }
  assert.equal(record.snapshot.staleSize, 0);
  assert.equal(record.stage.length, 8);
  for (const segment of record.stage) {
    assert.equal(segment.opacity > 0, expected.includes(segment.id));
    assert.ok(Math.abs(segment.opacity - component.branchBrightness[segment.id] / 100) < 1e-9);
  }
}
try {
  for (const width of [1440, 390])
    for (const anode of [false, true])
      for (const mask of ['abdeg', 'bc', 'abcdefgdp', 'afdp']) {
        if (before && (width !== 1440 || anode || mask !== 'abdeg')) continue;
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          hasTouch: true,
        });
        const page = await context.newPage(),
          errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await context.route('https://sevenseg-fixture.invalid/**', async (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path.startsWith('/assets/'))
            await route.fulfill({
              body: await readFile(resolve('apps/web/public', '.' + path)),
              contentType: path.endsWith('.json') ? 'application/json' : 'image/svg+xml',
            });
          else if (path.startsWith('/api/')) await route.fulfill({ status: 200, json: {} });
          else
            await route.fulfill({
              contentType: 'text/html',
              body:
                '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}' +
                css +
                '</style><div id="app"></div><script>' +
                ui +
                '</script>',
            });
        });
        const key = `${width}-${anode ? 'anode' : 'cathode'}-${mask}`;
        try {
          await page.goto(`https://sevenseg-fixture.invalid/?mask=${mask}&anode=${anode}`);
          await page.waitForFunction(() => window.fixture.wb?.status === 'ready');
          await page.evaluate(() => {
            window.fixture.wb.setLibraryOpen(false);
            window.fixture.wb.selectComponent('display', false);
          });
          await page.getByRole('button', { name: /Техническое состояние/ }).click();
          await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
          await page.waitForFunction(() => {
            const s = window.fixture.wb.nativeOpticalPresentation.getSnapshot().committed;
            return (
              s?.frame.atMicroseconds > 5000 &&
              s?.result.components.find((c) => c.componentId === 'display')?.branchBrightness
            );
          });
          const live = await readout(page);
          await writeFile(
            resolve(output, key + '-worker.json'),
            JSON.stringify(
              await page.evaluate(() => ({
                requests: window.fixture.requests,
                responses: window.fixture.responses,
              })),
              null,
              2,
            ),
          );
          await writeFile(resolve(output, key + '-live.json'), JSON.stringify(live, null, 2));
          if (before) {
            assert.equal(live.mask, 'Светятся: нет');
            await page.screenshot({ path: resolve(output, key + '.png') });
            receipts.push({
              key,
              expectedFailure: 'stale inspector, actual Worker committed digit2',
              live,
            });
            continue;
          }
          check(live, mask);
          // Pausing host pacing preserves the committed inspector; it is still a running simulation.
          await page.evaluate(() => window.fixture.wb.setSimulationRate(0));
          await page.waitForFunction(
            () => window.fixture.wb.simulationPacing.read().phase === 'paused',
          );
          const paused = await readout(page);
          check(paused, mask);
          assert.equal(paused.snapshot.running, true);
          await page.evaluate(() => window.fixture.wb.fitScene());
          await page.screenshot({ path: resolve(output, key + '.png') });
          const count = await page.evaluate(() => ({
            editor: window.fixture.editorRenders,
            sidebar: window.fixture.sidebarRenders,
          }));
          // Synthetic store negatives use already calculated Worker results, never fabricated physical positives.
          const negatives = await page.evaluate(async () => {
            const wb = window.fixture.wb,
              port = wb.nativeOpticalPresentation,
              s = port.getSnapshot().committed;
            const wait = () =>
              new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            const text = () =>
              document.querySelector('[data-testid="seven-segment-active-mask"]')?.textContent;
            const initial = text();
            const proposal = { ...s, result: { ...s.result, components: [] } };
            port.setObservation(proposal, true);
            await wait();
            const proposed = text();
            port.setObservation(null);
            await wait();
            const cleared = text();
            port.commit(s);
            await wait();
            const retired = text();
            port.setObservation(s);
            await wait();
            const restored = text();
            return { initial, proposed, cleared, retired, restored };
          });
          assert.equal(negatives.proposed, negatives.initial);
          assert.equal(negatives.cleared, 'Светятся: нет');
          assert.equal(negatives.retired, 'Светятся: нет');
          assert.equal(negatives.restored, negatives.initial);
          assert.deepEqual(
            await page.evaluate(() => ({
              editor: window.fixture.editorRenders,
              sidebar: window.fixture.sidebarRenders,
            })),
            count,
          );
          await page.evaluate(() => window.fixture.wb.selectComponent('uno', false));
          await page.waitForFunction(
            () => !document.querySelector('[data-testid="seven-segment-active-mask"]'),
          );
          await page.evaluate(() => window.fixture.wb.selectComponent('other-display', false));
          await page.waitForSelector('[data-testid="seven-segment-active-mask"]');
          const other = await readout(page);
          assert.equal(other.mask, 'Светятся: нет');
          assert.equal(other.snapshot.selected, 'other-display');
          for (const row of other.rows.slice(0, 8)) assert.ok(row.value.includes('0.00 мА · 0%'));
          await page.evaluate(() => window.fixture.wb.selectComponent('display', false));
          await page.waitForSelector('[data-testid="seven-segment-active-mask"]');
          check(await readout(page), mask);
          await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
          await page.waitForFunction(
            () =>
              !window.fixture.wb.simulationRunning &&
              window.fixture.wb.nativeOpticalPresentation.getSnapshot().committed === null,
          );
          const stopped = await readout(page);
          assert.equal(stopped.mask, 'Светятся: нет');
          // Replay an actual response from the retired generation; never manufacture a positive measurement.
          const retiredGeneration = await page.evaluate(async () => {
            const response = window.fixture.responses.find((r) => r.kind === 'advance');
            window.fixture.worker.dispatchEvent(new MessageEvent('message', { data: response }));
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            return {
              responseGeneration: response?.generationId,
              snapshot: window.fixture.snapshot(),
            };
          });
          assert.equal(retiredGeneration.snapshot.committed, null);
          let restarted = null;
          if (!anode && mask === 'abdeg') {
            await page.evaluate(() => window.fixture.wb.setSimulationRate(1));
            await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
            await page.waitForFunction(() => {
              const s = window.fixture.wb.nativeOpticalPresentation.getSnapshot().committed;
              return s?.frame.atMicroseconds > 5000;
            });
            await page.evaluate(() => window.fixture.wb.setSimulationRate(0));
            await page.waitForFunction(
              () => window.fixture.wb.simulationPacing.read().phase === 'paused',
            );
            const previous = await readout(page);
            check(previous, mask);
            await page.evaluate(() =>
              window.fixture.worker.dispatchEvent(
                new MessageEvent('message', {
                  data: window.fixture.responses.find((r) => r.kind === 'advance'),
                }),
              ),
            );
            await page.waitForTimeout(50);
            restarted = await readout(page);
            check(restarted, mask);
            assert.equal(restarted.snapshot.committed.token, previous.snapshot.committed.token);
          }
          assert.deepEqual(errors, []);
          receipts.push({
            key,
            live,
            paused,
            negatives,
            other,
            stopped,
            retiredGeneration,
            restarted,
            errors,
          });
        } catch (error) {
          await writeFile(
            resolve(output, key + '-failure.json'),
            JSON.stringify({ error: String(error), errors, readout: await readout(page) }, null, 2),
          );
          throw error;
        } finally {
          await context.close();
        }
      }
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify(receipts, null, 2));
  console.log(
    `${before ? 'BEFORE confirmed discrepancy' : 'PASS'}: ${receipts.length} actual Worker/Stage/inspector cases; synthetic store negatives are labelled separately.`,
  );
} finally {
  await browser.close();
}
