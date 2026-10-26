// Actual renderer, canonical solver and owner SVG bytes; no listening server.
/* global window, document, getComputedStyle, console, process */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const before = process.argv.includes('--before');
const historical = (path) =>
  execFileSync('git', ['show', `586b4d9e:${path}`], { encoding: 'utf8' });
const output = resolve(
  process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) ??
    'test-results/reverse-led-colour',
  before ? 'before' : 'after',
);
await mkdir(output, { recursive: true });
const manifest = await readFile(
  'apps/web/public/assets/electronics/component-database/catalog.json',
  'utf8',
);
const css = before
  ? historical('apps/web/src/electronics/workbench.css')
  : await readFile('apps/web/src/electronics/workbench.css', 'utf8');
const hook = await readFile('apps/web/src/electronics/use-electronics-workbench.ts', 'utf8');
const ast = ts.createSourceFile('hook.ts', hook, ts.ScriptTarget.Latest, true);
const stateFunction = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'ordinaryLedVisualState',
);
assert.ok(stateFunction, 'use the actual production state classifier');
const built = await build({
  stdin: {
    resolveDir: resolve('.'),
    loader: 'tsx',
    contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {ProductionComponentVisual} from './apps/web/src/electronics/ProductionComponentVisual';
import {configureProductionLibrary} from './apps/web/src/electronics/production-manifest-adapter';
import {catalogEntry,visualAsset} from './apps/web/src/electronics/component-catalog';
import {ordinaryLedAsset,ordinaryLedState} from './apps/web/src/electronics/production-asset-contracts';
import {solveCircuit} from './contexts/electronics/domain/solver';
import {parseElectronicsDocument} from './contexts/electronics/domain/document';
${stateFunction.getText(ast)}
configureProductionLibrary(${manifest});const entry=catalogEntry('led-5mm');if(!entry)throw Error('missing actual LED');
const root=createRoot(document.getElementById('app'));
window.fixture={set:(colour,mode)=>{
 const led={id:'led',kind:'led',componentTypeId:'led-5mm',position:{x:0,y:0},value:2,pinIds:['anode','cathode'],stateProperties:{ledColour:colour}};
 const wire=(id,from,ft,to,tt)=>({id,from:{componentId:from,terminal:ft},to:{componentId:to,terminal:tt},color:'#e3212b',vertices:[]});
 const parsed=parseElectronicsDocument({schemaVersion:2,components:[{id:'source',kind:'source',position:{x:0,y:0},value:5},{id:'res',kind:'resistor',position:{x:0,y:0},value:220},led],connections:[wire('w1','source','a','res','a'),wire('w2','res','b','led',mode==='reverse'?'cathode':'anode'),wire('w3','led',mode==='reverse'?'anode':'cathode','source','b')],viewport:{x:0,y:0,zoom:1},simulation:{running:false,maxIterations:24}});
 if(!parsed.ok)throw Error(parsed.message);const solved=solveCircuit(parsed.document);const measured=solved.components.find(c=>c.componentId==='led');if(!measured)throw Error('missing solver result');
 const visual=mode==='burned'?'burned':mode==='overcurrent'?'overcurrent':ordinaryLedVisualState(measured);
 const brightness=mode==='reverse'?measured.brightness:mode==='burned'?0:measured.brightness;
 root.render(<ProductionComponentVisual entry={entry} component={led} width={180} height={180} visualState={visual} effectiveBrightness={brightness} result={measured} simulationRunning/>);
 window.fixture.result={colour,mode,visual,brightness,measurement:measured,diagnostics:solved.diagnostics,document:JSON.stringify(parsed.document),expectedAsset:visualAsset(entry,{...led,stateProperties:{...led.stateProperties,ledBrightness:brightness}},visual),faultAsset:ordinaryLedAsset(ordinaryLedState(colour,75,mode==='reverse'?'reverse':mode==='burned'?'burned':mode==='overcurrent'?'overcurrent':'none'))};
 }};`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  alias: { '@asa-lab/electronics': resolve('contexts/electronics/index.ts') },
  plugins: before
    ? [
        {
          name: 'original-asset-contract',
          setup(builder) {
            builder.onLoad({ filter: /production-asset-contracts\.ts$/ }, () => ({
              contents: historical('apps/web/src/electronics/production-asset-contracts.ts'),
              loader: 'ts',
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
    await context.route('http://led.fixture/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/assets/'))
        await route.fulfill({
          body: await readFile(resolve('apps/web/public', '.' + url.pathname)),
          contentType: 'image/svg+xml',
        });
      else
        await route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="app"></div><script>${built.outputFiles[0].text}</script>`,
        });
    });
    const page = await context.newPage();
    await page.goto('http://led.fixture/');
    for (const colour of ['blue', 'green', 'orange', 'red', 'white', 'yellow']) {
      for (const mode of ['reverse', 'forward', 'burned', 'overcurrent']) {
        await page.evaluate(({ colour, mode }) => window.fixture.set(colour, mode), {
          colour,
          mode,
        });
        await page.waitForFunction(
          ({ colour, mode }) => {
            const svg = document.querySelector('.workbench-led-visual');
            const image = svg?.querySelector('.workbench-led-asset');
            return (
              svg?.getAttribute('data-led-colour') === colour &&
              image?.getAttribute('href') === window.fixture.result.expectedAsset &&
              (mode !== 'reverse' || svg.classList.contains('is-reverse'))
            );
          },
          { colour, mode },
        );
        await page.evaluate(async () => {
          const image = new window.Image();
          image.src = document.querySelector('.workbench-led-asset').getAttribute('href');
          await image.decode();
          await new Promise(window.requestAnimationFrame);
        });
        const actual = await page.evaluate(() => ({
          ...window.fixture.result,
          filter: getComputedStyle(document.querySelector('.workbench-led-asset')).filter,
          href: document.querySelector('.workbench-led-asset').getAttribute('href'),
          lit: document.querySelector('.workbench-led-visual').classList.contains('is-lit'),
        }));
        if (mode === 'reverse') {
          assert.equal(actual.brightness, 0);
          assert.equal(actual.measurement.lit, false);
          assert.equal(actual.visual, 'reverse');
          assert.equal(actual.lit, false);
          assert.equal(actual.measurement.junctionState, 'reverse_blocking');
          if (before) {
            assert.match(actual.href, /special\/led_red_reverse_polarity.svg$/);
            assert.match(actual.filter, /grayscale/);
          } else {
            assert.match(
              actual.href,
              new RegExp('/led/' + colour + '/led_' + colour + '_i000.svg$'),
            );
            assert.equal(actual.filter, 'none');
          }
        } else if (mode === 'forward') {
          assert.ok(actual.measurement.lit);
          assert.ok(actual.brightness > 0);
          assert.ok(actual.lit);
        } else if (mode === 'burned') assert.match(actual.href, /led_red_burned.svg$/);
        else assert.match(actual.faultAsset, /led_orange_overcurrent.svg$/);
        const name = `${width}-${colour}-${mode}.png`;
        const png = await page
          .locator('.workbench-led-visual')
          .screenshot({ path: resolve(output, name) });
        const asset = await readFile(resolve('apps/web/public', '.' + actual.href));
        receipts.push({
          width,
          ...actual,
          pngSha256: createHash('sha256').update(png).digest('hex'),
          assetSha256: createHash('sha256').update(asset).digest('hex'),
        });
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
if (!before) {
  const previous = JSON.parse(await readFile(resolve(output, '../before/receipts.json'), 'utf8'));
  for (let index = 0; index < receipts.length; index++) {
    const actual = receipts[index],
      old = previous[index];
    assert.deepEqual(actual.measurement, old.measurement);
    assert.deepEqual(actual.diagnostics, old.diagnostics);
    assert.equal(actual.document, old.document);
    if (actual.mode !== 'reverse') {
      assert.equal(actual.href, old.href);
      assert.equal(actual.pngSha256, old.pngSha256);
    }
  }
}
await writeFile(resolve(output, 'receipts.json'), JSON.stringify(receipts, null, 2));
console.log(
  `PASS ${before ? 'BEFORE' : 'AFTER'}: ${receipts.length} native renderer/owner SVG cases with canonical solver forward/reverse. Burn/overcurrent are presentation inputs; no Worker/installed/SaveCAS claim.`,
);
