/* global window, document */
import { log } from 'node:console';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

// Use Vite solely as an in-process TypeScript loader. Never listen on a port.
// This optional native proof is separate from portable universal Vitest tests.
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
  const { installNativeSaveInputObserver, selectionStrokeDimensions } = await loader.ssrLoadModule(
    '/tests/electronics/native-oracle-contracts.ts',
  );
  configureProductionLibrary(
    JSON.parse(
      readFileSync('apps/web/public/assets/electronics/component-database/catalog.json', 'utf8'),
    ),
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ hasTouch: true });
  await page.route('**/*', (route) => route.abort());
  for (const [type, body] of [
    ['resistor-axial', 3.5],
    ['button-tactile-6mm', 3],
    ['switch-spdt', 3.5],
  ]) {
    const entry = catalogEntry(type);
    const markup = renderToStaticMarkup(
      createElement(ProductionComponentVisual, {
        entry,
        component: { id: type, type, x: 0, y: 0, rotation: 0, value: 220 },
        ...renderedSize(entry),
        visualState: 'off',
        selected: true,
      }),
    );
    await page.setContent(`<div id="visual">${markup}</div>`);
    assert.deepEqual(await page.locator('#visual').evaluate(selectionStrokeDimensions, 2), {
      body,
      pin: 2,
      ordinary: 2,
    });
  }
  await page.setContent(
    '<button class="workbench-pill save" aria-label="Сохранить проект" data-workbench-tooltip="Сохранить проект сейчас"><span>Save</span></button><button id="other">Other</button>',
  );
  const witness = () => page.evaluate(() => window.f2SaveInput);
  await page.evaluate(installNativeSaveInputObserver);
  await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
  assert.deepEqual(await witness(), {
    trusted: true,
    pointerType: 'mouse',
    ariaLabel: 'Сохранить проект',
    saveButton: true,
  });
  await page.locator('#other').click();
  assert.equal((await witness()).saveButton, true);
  await page.evaluate(installNativeSaveInputObserver);
  const bounds = await page
    .getByRole('button', { name: 'Сохранить проект', exact: true })
    .boundingBox();
  assert.ok(bounds);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
  assert.deepEqual(await witness(), {
    trusted: true,
    pointerType: 'touch',
    ariaLabel: 'Сохранить проект',
    saveButton: true,
  });
  await page.evaluate(installNativeSaveInputObserver);
  await page.locator('#other').click();
  assert.equal((await witness()).saveButton, false);
  await page.evaluate(() =>
    document.body.append(document.querySelector('button.save').cloneNode(true)),
  );
  await page.evaluate(installNativeSaveInputObserver);
  await page.locator('button.save').first().click();
  assert.equal((await witness()).saveButton, false);
  await page.evaluate(() => document.querySelector('button.save:last-child').remove());
  await page.evaluate(installNativeSaveInputObserver);
  await page.locator('button.save').dispatchEvent('pointerdown', { pointerType: 'mouse' });
  assert.equal((await witness()).trusted, false);
  log(
    'PASS: actual three production selection DOMs; trusted mouse/touch Save; once, wrong/duplicate target and untrusted negatives. No full native journey claim.',
  );
} finally {
  await browser?.close();
  await loader.close();
}
