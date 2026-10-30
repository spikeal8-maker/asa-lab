import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { chromium } from '@playwright/test';
const out = new URL('./', import.meta.url);
const spec = readFileSync('e2e/electronics-simulation.spec.ts', 'utf8');
const ast = ts.createSourceFile('spec.ts', spec, ts.ScriptTarget.Latest, true);
function initializer(name) {
  let found;
  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer;
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.ok(found, name);
  return found.getText(ast);
}
function compile(expression, bindings = {}) {
  const js = ts.transpile(`const extracted = ${expression};`, { target: ts.ScriptTarget.ES2022 });
  return Function(...Object.keys(bindings), `${js};return extracted;`)(...Object.values(bindings));
}
const installerSource = initializer('installInstrument525Observer');
const helperSource = initializer('clickOwnedRect');
const install = compile(installerSource);
const evidence = { specSha256: createHash('sha256').update(spec).digest('hex'), browser: '', observer: [], geometry: [], syntheticNegative: [], preservation: {} };
const browser = await chromium.launch({ headless: true });
evidence.browser = browser.version();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  let requests = 0;
  await page.route('https://instrument525.test/**', async route => {
    if (route.request().method() === 'PUT') {
      requests++;
      await route.fulfill({ status: 200, headers: { 'x-proof': 'unchanged' }, body: 'native-response' });
    } else await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<button aria-label="Сохранить проект">Save</button>' });
  });
  const dispatch = [], native = [], errors = [];
  await page.exposeBinding('instrument525DispatchAck', (_, v) => { dispatch.push(v); return dispatch.length; });
  await page.exposeBinding('instrument525NativeAck', (_, v) => { native.push(v); return native.length; });
  await page.exposeBinding('instrument525ObserverError', (_, v) => { errors.push(v); return errors.length; });
  await page.goto('https://instrument525.test/');
  await page.addInitScript(install, 'proof');
  await page.evaluate(install, 'proof');
  await page.evaluate(() => { window.savedWrapper = window.fetch; });
  await page.evaluate(install, 'proof');
  assert.equal(await page.evaluate(() => window.fetch === window.savedWrapper), true);
  await page.goto('https://instrument525.test/#/home/proof');
  assert.equal(await page.evaluate(() => window.fetch === window.savedWrapper), true);
  async function one(label) {
    const d0 = dispatch.length, n0 = native.length, r0 = requests;
    await page.evaluate(() => {
      localStorage.clear(); localStorage.setItem('synchronous', 'before');
      document.querySelector('button').onclick = () => {
        window.originalPromise = fetch('/api/projects/proof/draft', { method: 'PUT', body: JSON.stringify({ mutationId: 'm' + performance.now(), baseRevision: 2, document: { complete: true } }) });
        localStorage.setItem('synchronous', 'after');
      };
    });
    await page.getByRole('button').click();
    const response = await page.evaluate(async () => {
      const r = await window.originalPromise;
      await Promise.all([...window.instrument525DispatchAcks, ...window.instrument525NativeAcks]);
      return { status: r.status, header: r.headers.get('x-proof'), body: await r.text(), storage: localStorage.getItem('synchronous') };
    });
    assert.deepEqual(response, { status: 200, header: 'unchanged', body: 'native-response', storage: 'after' });
    assert.equal(requests - r0, 1); assert.equal(dispatch.length - d0, 1);
    assert.deepEqual(dispatch.at(-1).entries, [['synchronous', 'before']]);
    assert.deepEqual(native.slice(n0).map(x => x.type), ['pointerdown', 'pointerup', 'click']);
    assert.ok(native.slice(n0).every(x => x.trusted));
    evidence.observer.push({ label, requests: requests - r0, dispatches: dispatch.length - d0, nativeTypes: native.slice(n0).map(x => x.type), synchronousSnapshot: dispatch.at(-1).entries, response });
  }
  await one('already-loaded + hash-navigation + repeated install');
  await page.goto('https://instrument525.test/new-document');
  assert.equal(await page.evaluate(() => window.instrument525ObserverProjectId), 'proof');
  await page.evaluate(install, 'proof');
  await one('new-document init + repeated install');
  assert.deepEqual(errors, []);
  await context.close();
  const rawRoot = process.argv[2];
  assert.ok(rawRoot, 'Pass cached raw16 directory');
  const rawFiles = readdirSync(rawRoot).map(folder => `${rawRoot}/${folder}/instrument525-raw.json`);
  for (const file of rawFiles) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!raw.primaryError?.message?.includes('workbench-regulated-supply-power-slider')) continue;
    const after = raw.rows.filter(x => /^pan-bench-supply-\d+-after$/.test(x.name)).at(-1).observation;
    const ctm = after.body.ctm;
    const wire = raw.primaryError.message.match(/d="([^"]+)" class="workbench-wire-segment-hit/)[1];
    const rect = raw.primaryError.message.match(/<rect x="14"[^>]+>/)[0].replace('></rect>', '/>');
    const c = await browser.newContext({ viewport: { width: raw.width, height: 900 } });
    const p = await c.newPage();
    const scale = Math.abs(ctm[0]);
    const worldE = ctm[4] - (raw.mirror.x ? 147 * scale : 0) - 600 * scale;
    const worldF = ctm[5] - (raw.mirror.y ? 118.5 * scale : 0) - 30 * scale;
    const css = readFileSync('apps/web/src/electronics/workbench.css', 'utf8');
    assert.match(css, /@media \(max-width: 980px\)/);
    assert.match(css, /\.workbench-wire-segment-hit \{\s*fill: none;\s*stroke: transparent;\s*stroke-width: 14;/);
    assert.match(css, /\.workbench-wire-segment-hit \{\s*stroke-width: 24;/);
    const stroke = raw.width <= 980 ? 24 : 14;
    await p.setContent(`<style>body{margin:0}svg{display:block}.workbench-wire-segment-hit{fill:none;stroke:transparent;stroke-width:${stroke};pointer-events:stroke}</style><svg width="${raw.width}" height="900"><g transform="matrix(${ctm.join(' ')})"><g transform="scale(.5)">${rect}</rect></g></g><g transform="matrix(${scale} 0 0 ${scale} ${worldE} ${worldF})"><path class="workbench-wire-segment-hit" vector-effect="non-scaling-stroke" d="${wire}"/></g></svg>`);
    const witnesses = [];
    const click = compile(helperSource, { page: p, checkpoint: (name, value) => witnesses.push({ name, value }) });
    await p.evaluate(() => { window.clicks = []; document.querySelector('rect').addEventListener('click', e => window.clicks.push({ trusted: e.isTrusted, x: e.clientX, y: e.clientY })); });
    let failure;
    try { await click(p.locator('rect'), 'supply-power-slider'); }
    catch (error) { failure = String(error); }
    const clicks = await p.evaluate(() => window.clicks);
    assert.equal(witnesses.length, 1); assert.equal(witnesses[0].value.candidates.length, 9);
    assert.equal(witnesses[0].value.candidates[0].eligible, false, 'failed center reproduced');
    if (failure) {
      assert.match(failure, /No owned supply-power-slider native point/);
      assert.equal(clicks.length, 0);
      assert.equal(witnesses[0].value.candidates.some(x => x.eligible), false);
    } else { assert.equal(clicks.length, 1); assert.equal(clicks[0].trusted, true); }
    evidence.geometry.push({ classification: 'cached failed pose reconstructed in genuine SVG, not full runtime acceptance', outcome: failure ?? 'one trusted click', width: raw.width, mirror: raw.mirror.name, rawSha256: createHash('sha256').update(readFileSync(file)).digest('hex'), bodyCTM: ctm, worldCTM: [scale,0,0,scale,worldE,worldF], wireId: raw.primaryError.message.match(/data-wire-id="([^"]+)"/)[1], wire, stroke, witnesses, clicks });
    // Separate synthetic full occlusion proves fail-closed without a native click.
    await p.evaluate(() => { document.querySelector('svg').insertAdjacentHTML('beforeend', '<rect x="0" y="0" width="2000" height="2000" fill="red"/>'); window.clicks = []; });
    await assert.rejects(click(p.locator('rect').first(), 'fully-covered'), /No owned fully-covered native point/);
    assert.equal((await p.evaluate(() => window.clicks)).length, 0);
    evidence.syntheticNegative.push({ width: raw.width, mirror: raw.mirror.name, fullOcclusion: 'strict failure, zero clicks' });
    await c.close();
  }
  assert.equal(evidence.geometry.length, 6);
  // Explicit synthetic positive fixture: only the center is occluded by a thin wire.
  const positive = await browser.newPage();
  await positive.setContent('<svg width="400" height="400"><g transform="translate(200 200) rotate(90) scale(-2 2)"><rect x="14" y="20" width="35" height="26" fill="gray"/><path d="M 31.5 20 V 46" stroke="red" stroke-width="2" pointer-events="stroke"/></g></svg>');
  const positiveWitness = [];
  const positiveClick = compile(helperSource, { page: positive, checkpoint: (name, value) => positiveWitness.push({ name, value }) });
  await positive.evaluate(() => { window.count = 0; document.querySelector('rect').addEventListener('click', e => { if (e.isTrusted) window.count++; }); });
  await positiveClick(positive.locator('rect'), 'synthetic-partial-wire');
  assert.equal(await positive.evaluate(() => window.count), 1);
  assert.equal(positiveWitness[0].value.candidates[0].eligible, false);
  assert.equal(positiveWitness[0].value.candidates[1].eligible, true);
  evidence.syntheticPositive = { classification: 'synthetic, not actual failed pose', trustedClicks: 1, positiveWitness };
  await positive.close();
  const before = execFileSync('git', ['show', '536bded6a:e2e/electronics-simulation.spec.ts'], { encoding: 'utf8', maxBuffer: 4e6 });
  const start = "test.describe('ELECTRONICS-525 complete instrument mirror matrix'";
  const end = spec.indexOf('\ntest.', spec.indexOf(start) + start.length);
  const oldEnd = before.indexOf('\ntest.', before.indexOf(start) + start.length);
  assert.equal(spec.slice(0, spec.indexOf(start)), before.slice(0, before.indexOf(start)));
  assert.equal(spec.slice(end), before.slice(oldEnd));
  evidence.verdict = evidence.geometry.some(x => x.outcome.startsWith('Error:')) ? 'BLOCKED: selected nine-point helper has no owned candidate in some failed poses; no complete16 claim or strict CI authorization' : 'narrow proof only';
  evidence.preservation = { unrelatedBeforeAndAfterMatrix: 'byte-identical UTF-8', baselineBlob: '06174a9675a5e670e3798a4adb7e40239a729a3a' };
} finally { await browser.close(); }
writeFileSync(new URL('narrow-browser-result.json', out), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ observer: evidence.observer.length, realFailedPoses: evidence.geometry.length, syntheticNegative: evidence.syntheticNegative.length, browser: evidence.browser, specSha256: evidence.specSha256 }));
