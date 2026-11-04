/* global document, DOMPoint, Node */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { PNG } from 'pngjs';

// TypeScript loader only: no application server, port, database or network.
const loader = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, watch: null },
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      {
        find: '@asa-lab/electronics/rendering',
        replacement: resolve('contexts/electronics/rendering.ts'),
      },
      { find: '@asa-lab/electronics', replacement: resolve('contexts/electronics/index.ts') },
      { find: '@asa-lab/contracts', replacement: resolve('packages/contracts/src/index.ts') },
    ],
  },
});
const evidence = 'tests/electronics/evidence/selection-halo-902';
const baselinePath = `${evidence}/normal-baseline.json`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
let browser;
try {
  const { ProductionComponentVisual } = await loader.ssrLoadModule(
    '/apps/web/src/electronics/ProductionComponentVisual.tsx',
  );
  const { configureProductionLibrary } = await loader.ssrLoadModule(
    '/apps/web/src/electronics/production-manifest-adapter.ts',
  );
  const { catalogEntry, renderedSize } = await loader.ssrLoadModule(
    '/apps/web/src/electronics/component-catalog.ts',
  );
  const { selectionStrokeDimensions } = await loader.ssrLoadModule(
    '/tests/electronics/native-oracle-contracts.ts',
  );
  const { WORLD_UNITS_PER_MM } = await loader.ssrLoadModule(
    '/apps/web/src/electronics/production-asset-contracts.ts',
  );
  configureProductionLibrary(
    JSON.parse(
      readFileSync('apps/web/public/assets/electronics/component-database/catalog.json', 'utf8'),
    ),
  );
  const types = ['resistor-axial', 'button-tactile-6mm', 'switch-spdt'];
  const mirrors = [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ];
  const render = (type, mirror, selected = false, selectionOffset) => {
    const entry = catalogEntry(type);
    return renderToStaticMarkup(
      createElement(ProductionComponentVisual, {
        entry,
        component: {
          id: type,
          componentTypeId: type,
          kind: entry.kind,
          position: { x: 0, y: 0 },
          rotation: 0,
          value: 220,
          stateProperties: { mirrorX: mirror[0], mirrorY: mirror[1] },
        },
        ...renderedSize(entry),
        visualState: 'off',
        selected,
        selectionOffset,
      }),
    );
  };
  const normals = Object.fromEntries(
    types.flatMap((type) =>
      mirrors.map((mirror) => [`${type}:${mirror}`, hash(render(type, mirror))]),
    ),
  );
  if (process.argv.includes('--record-normal-baseline')) {
    writeFileSync(
      baselinePath,
      `${JSON.stringify({ source: '7e36923e03898518d9fff81c7027a77d09a25c39', normals }, null, 2)}\n`,
    );
  } else {
    assert.deepEqual(
      normals,
      JSON.parse(readFileSync(baselinePath, 'utf8')).normals,
      'Unselected production SVG must remain byte-identical to the pre-repair baseline',
    );
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    const rows = [];
    for (const viewport of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width: viewport, height: 700 });
      for (const zoom of [1, 3.832303484615499]) {
        for (const rotation of [0, 90, 180, 270]) {
          for (const mirror of mirrors) {
            for (const type of types) {
              const normal = render(type, mirror);
              const selected = render(type, mirror, true, 1.6 / zoom);
              // Native scene scale stays explicit, independently measurable through CTM.
              const scene = (markup) =>
                `<svg class="scene" width="${viewport}" height="680" viewBox="0 0 ${viewport / 0.88} ${680 / 0.88}"><g transform="translate(${viewport / 1.76} 360) scale(${zoom}) rotate(${rotation}) scale(${mirror[0] ? -1 : 1} ${mirror[1] ? -1 : 1})">${markup}</g></svg>`;
              await page.setContent(
                `<style>body{margin:0}</style><div id="normal">${scene(normal)}</div><div id="selected" style="position:absolute;top:0;left:0">${scene(selected)}</div>`,
              );
              const dimensions = await page
                .locator('#selected')
                .evaluate(selectionStrokeDimensions, 2);
              const measured = await page.evaluate(() => {
                const modelSelector =
                  '.workbench-owner-resistor, .workbench-tinkercad-button, .workbench-tinkercad-switch';
                const normal = document.querySelector(
                  `#normal ${modelSelector.split(', ').join(', #normal ')}`,
                );
                const selected = document.querySelector(
                  `#selected ${modelSelector.split(', ').join(', #selected ')}`,
                );
                const outline = selected.querySelector('.workbench-tinkercad-selection');
                const ordinary = [...selected.children].filter((node) => node.tagName === 'line');
                const normalPins = [...normal.children].filter((node) => node.tagName === 'line');
                const pinBounds = (nodes) =>
                  nodes.map((node) => {
                    const box = node.getBoundingClientRect();
                    return [box.x, box.y, box.width, box.height];
                  });
                const clean = selected.cloneNode(true);
                clean.querySelector('.workbench-tinkercad-selection').remove();
                const ctm = selected.getScreenCTM();
                const scene = document.querySelector('#selected .scene').getScreenCTM();
                const resistor = selected.matches('.workbench-owner-resistor');
                const spdt = selected.matches('.workbench-tinkercad-switch');
                const points = resistor
                  ? [
                      [3.69, 0],
                      [1, -18],
                    ]
                  : spdt
                    ? [
                        [14, -10],
                        [11, -2.5],
                      ]
                    : [
                        [12, 0],
                        [11, -14],
                      ];
                const profiles = points.map(([x, y]) => {
                  const point = new DOMPoint(x, y).matrixTransform(ctm);
                  const length = Math.hypot(ctm.a, ctm.b);
                  return { x: point.x, y: point.y, nx: ctm.a / length, ny: ctm.b / length };
                });
                return {
                  scale: Math.hypot(ctm.a, ctm.b),
                  stageScale: Math.hypot(scene.a, scene.b),
                  profiles,
                  ordinary: ordinary.map((node) => node.outerHTML),
                  normalPins: normalPins.map((node) => node.outerHTML),
                  bounds: pinBounds(ordinary),
                  normalBounds: pinBounds(normalPins),
                  underlay: ordinary.every(
                    (node) =>
                      outline.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
                  ),
                  inert: outline.getAttribute('pointer-events'),
                  unchanged: clean.outerHTML === normal.outerHTML,
                };
              });
              const expected = (1.6 / zoom) * measured.stageScale * zoom;
              const body = (dimensions.body / 2) * measured.scale;
              const pin = ((dimensions.pin - dimensions.ordinary) / 2) * measured.scale;
              assert.ok(Math.abs(body - expected) < 0.000005, `Body radius ${type}`);
              assert.ok(Math.abs(pin - expected) < 0.000005, `Pin radius ${type}`);
              assert.deepEqual(measured.ordinary, measured.normalPins);
              assert.deepEqual(measured.bounds, measured.normalBounds);
              assert.equal(measured.underlay, true);
              assert.equal(measured.inert, 'none');
              assert.equal(measured.unchanged, true);
              await page.locator('#selected').evaluate((node) => {
                node.style.visibility = 'hidden';
              });
              const beforePng = await page.screenshot();
              const before = PNG.sync.read(beforePng);
              await page.locator('#selected').evaluate((node) => {
                node.style.visibility = 'visible';
              });
              const afterPng = await page.screenshot();
              const after = PNG.sync.read(afterPng);
              if (rotation === 0 && mirror.every((value) => !value)) {
                const name = `${evidence}/${type}-${viewport}-${zoom === 1 ? 'fit' : 'zoom'}`;
                writeFileSync(`${name}-before.png`, beforePng);
                writeFileSync(`${name}-after.png`, afterPng);
              }
              // Identical colour classification and 1.25px antialias allowance to E11.
              const raster = measured.profiles.map((profile) => {
                const blue = [];
                for (let distance = -2; distance <= expected + 3; distance += 0.25) {
                  const x = Math.floor(profile.x + profile.nx * distance);
                  const y = Math.floor(profile.y + profile.ny * distance);
                  assert.ok(
                    x >= 0 && x < before.width && y >= 0 && y < before.height,
                    'Unclipped profile',
                  );
                  const index = (y * before.width + x) * 4;
                  const a = before.data.subarray(index, index + 4);
                  const b = after.data.subarray(index, index + 4);
                  const added = a[0] - b[0] > 8 && b[2] - b[0] > a[2] - a[0] + 12 && b[1] > b[0];
                  if (distance > 0 && added) blue.push(distance);
                }
                assert.ok(
                  blue.length > 0,
                  `${type} exterior blue ${JSON.stringify({ viewport, zoom, rotation, mirror, profile })}`,
                );
                const last = blue.at(-1);
                assert.ok(
                  Math.abs(last - expected) <= 1.25,
                  `${type} raster radius ${last} versus ${expected}`,
                );
                return { exteriorBlue: blue.length, lastBlueDistance: last };
              });
              // Mutate actual SVG DOM to reintroduce each original defect; same oracle rejects it.
              await page.locator('#selected .workbench-tinkercad-selection').evaluate((node) => {
                node.querySelector('path, rect').setAttribute('stroke-width', '3.5');
                for (const pin of node.querySelectorAll('line'))
                  pin.setAttribute('stroke-width', '2');
              });
              const bad = await page.locator('#selected').evaluate(selectionStrokeDimensions, 2);
              assert.ok(Math.abs((bad.body / 2) * measured.scale - expected) >= 0.000005);
              assert.ok(
                Math.abs(((bad.pin - bad.ordinary) / 2) * measured.scale - expected) >= 0.000005,
              );
              rows.push({
                viewport,
                zoom,
                rotation,
                mirror,
                type,
                expected,
                body,
                pin,
                ordinary: dimensions.ordinary,
                scale: measured.scale,
                raster,
              });
            }
          }
        }
      }
    }
    // Verify the optional prop's existing default is consumed too.
    for (const type of types) {
      await page.setContent(render(type, [false, false], true));
      const dimensions = await page.locator('body').evaluate(selectionStrokeDimensions, 2);
      const modelScale = 0.254 * WORLD_UNITS_PER_MM;
      assert.ok(Math.abs((dimensions.body / 2) * modelScale - 2) < 0.000005);
      assert.ok(Math.abs(((dimensions.pin - 2) / 2) * modelScale - 2) < 0.000005);
    }
    writeFileSync(
      `${evidence}/native-receipt.json`,
      `${JSON.stringify({ cases: rows.length, normals, rows }, null, 2)}\n`,
    );
    process.stdout.write(
      `PASS ${rows.length} actual production SVG radius/order/bounds cases; default offset; zoom-dependent and missing-pin negatives; unselected byte identity. No full journey claim.\n`,
    );
  }
} finally {
  await browser?.close();
  await loader.close();
}
