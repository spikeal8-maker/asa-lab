import { chromium } from '@playwright/test';

const runtimeUrl = process.env.BLOCKS_RUNTIME_URL ?? 'http://127.0.0.1:4613';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const runtimeErrors = [];

page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});

try {
  await page.goto(runtimeUrl, { waitUntil: 'networkidle' });
  const shell = page.locator('[data-asa-host-shell]');
  await shell.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-asa-host-shell]');
    return node?.getAttribute('data-runtime-state') === 'standalone-ready';
  });

  const state = await shell.getAttribute('data-runtime-state');
  if (state !== 'standalone-ready') throw new Error(`unexpected runtime state: ${state}`);
  const editorChildren = await page
    .locator('#scratch-editor-root')
    .evaluate((node) => node.childElementCount);
  if (editorChildren !== 0) {
    throw new Error(`editor mounted before protocol slice: childElementCount=${editorChildren}`);
  }

  const marker = await page.locator('body').getAttribute('data-asa-scratch-host');
  if (marker !== 'm1-002a') throw new Error(`unexpected ASA host marker: ${marker}`);

  if (runtimeErrors.length > 0) {
    throw new Error(`runtime JavaScript errors:\n${runtimeErrors.join('\n')}`);
  }

  console.log('blocks host browser smoke: PASS');
  console.log(`runtime=${runtimeUrl}`);
  console.log(`state=${state}`);
  console.log(`editorChildren=${editorChildren}`);
} finally {
  await browser.close();
}
