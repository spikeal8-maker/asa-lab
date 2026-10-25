// Real production renderer and owner bytes; route-fulfilled fixture, no server.
/* global window, document, getComputedStyle, process, console */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const phase = process.argv.includes('--before') ? 'before' : 'after';
const output = resolve('test-results/potentiometer-vector-retirement', phase);
await mkdir(output, { recursive: true });
const manifest = JSON.parse(
  await readFile('apps/web/public/assets/electronics/component-database/catalog.json', 'utf8'),
);
const css = await readFile('apps/web/src/electronics/workbench.css', 'utf8');
const built = await build({
  stdin: {
    resolveDir: resolve('apps/web'),
    loader: 'tsx',
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {ProductionComponentVisual} from './src/electronics/ProductionComponentVisual';
import {configureProductionLibrary} from './src/electronics/production-manifest-adapter';
import {catalogEntry} from './src/electronics/component-catalog';
configureProductionLibrary(${JSON.stringify(manifest)});
const entry=catalogEntry('potentiometer');if(!entry)throw Error('missing real potentiometer');
const root=createRoot(document.getElementById('app'));let rotation=0,mirror=false;
let doc={version:1,components:[{id:'saved-pot',kind:'potentiometer',componentTypeId:entry.key,
variantId:entry.variantId,position:{x:100,y:100},value:10000,wiperPosition:.5,pinIds:['a','b','wiper'],stateProperties:{}}],wires:[],notes:'Сохранённая схема'};
let inputs=0;const render=()=>root.render(<><input aria-label="Положение движка — fixture adapter" type="range" min="0" max="1" step="0.1" value={doc.components[0].wiperPosition}
onChange={e=>{inputs++;doc.components[0].wiperPosition=Number(e.target.value);render()}}/>
<svg width="280" height="280" viewBox="-140 -140 280 280"><g transform={'rotate('+rotation+') scale('+(mirror?-1:1)+' 1) translate(-60 -68)'}>
<ProductionComponentVisual entry={entry} component={doc.components[0]} width={120} height={136.6666666667} visualState="default"/>
</g></svg></>);
window.fixture={set:(w,r,m)=>{doc.components[0].wiperPosition=w;rotation=r;mirror=m;render()},
save:()=>{localStorage.setItem('fixture-doc',JSON.stringify(doc));return JSON.stringify(doc)},
reopen:()=>{doc=JSON.parse(localStorage.getItem('fixture-doc'));render();return JSON.stringify(doc)},
read:()=>({doc:JSON.stringify(doc),inputs})};render();`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  plugins:
    phase === 'before'
      ? [
          {
            name: 'accepted-baseline-renderer',
            setup(builder) {
              builder.onLoad({ filter: /ProductionComponentVisual\.tsx$/ }, () => ({
                contents: execFileSync(
                  'git',
                  ['show', '43198e8b:apps/web/src/electronics/ProductionComponentVisual.tsx'],
                  { encoding: 'utf8' },
                ),
                loader: 'tsx',
              }));
            },
          },
        ]
      : [],
});
const browser = await chromium.launch({ headless: true });
const receipts = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route('http://pot.fixture/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/assets/')) {
        const bytes = await readFile(resolve('apps/web/public', '.' + url.pathname));
        await route.fulfill({
          body: bytes,
          contentType: extname(url.pathname) === '.svg' ? 'image/svg+xml' : 'application/json',
        });
      } else
        await route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="app"></div><script>${built.outputFiles[0].text}</script>`,
        });
    });
    const page = await context.newPage();
    await page.goto('http://pot.fixture/');
    await page.locator('[data-testid="potentiometer-angle"] line').first().waitFor();
    for (const w of [0, 0.5, 1])
      for (const rotation of [0, 90, 180, 270])
        for (const mirror of [false, true]) {
          await page.evaluate(
            ({ w, rotation, mirror }) => window.fixture.set(w, rotation, mirror),
            { w, rotation, mirror },
          );
          await page.waitForFunction(
            (angle) =>
              document
                .querySelector('[data-testid="potentiometer-angle"]')
                ?.getAttribute('data-owner-svg-state-angle') === String(angle),
            45 + w * 270,
          );
          const state = await page.evaluate(() => ({
            visible: document.querySelector('[data-testid="potentiometer-angle"]').outerHTML,
            hidden: getComputedStyle(
              document.querySelector('[data-testid="potentiometer-legacy-vector-contract"]'),
            ).display,
            diagnosticAngle: document
              .querySelector('[data-testid="potentiometer-legacy-vector-contract"]')
              .getAttribute('data-owner-svg-state-angle'),
            saved: window.fixture.save(),
            reopened: window.fixture.reopen(),
          }));
          assert.equal(state.hidden, 'none');
          assert.equal(state.saved, state.reopened);
          const filename = `${width}-${w}-${rotation}-${mirror}.png`;
          const png = await page
            .locator('#app > svg')
            .screenshot({ path: resolve(output, filename) });
          receipts.push({
            width,
            w,
            rotation,
            mirror,
            ...state,
            pngSha256: createHash('sha256').update(png).digest('hex'),
          });
        }
    await page.evaluate(() => window.fixture.set(0.5, 0, false));
    const slider = page.getByRole('slider');
    await slider.focus();
    await slider.press('ArrowRight');
    await page.waitForFunction(
      () => JSON.parse(window.fixture.read().doc).components[0].wiperPosition === 0.6,
    );
    const previous = await page.evaluate(() => window.fixture.read().inputs);
    const box = await slider.boundingBox();
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
    const after = await page.evaluate(() => window.fixture.read());
    assert.equal(after.inputs, previous + 1, 'one native range callback per click');
    await context.close();
  }
} finally {
  await browser.close();
}
if (phase === 'after') {
  const before = JSON.parse(await readFile(resolve(output, '../before/receipts.json'), 'utf8'));
  assert.deepEqual(
    receipts,
    before,
    'visible markup, owner pixels, diagnostics and saved documents unchanged',
  );
}
await writeFile(resolve(output, 'receipts.json'), JSON.stringify(receipts, null, 2));
console.log(
  `PASS ${phase}: ${receipts.length} real-renderer geometry/pixel/document cases; native keyboard/pointer range-adapter parity at1440/390. Not installed SaveCAS proof.`,
);
