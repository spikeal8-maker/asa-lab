#!/usr/bin/env node
// Isolated Vite CSS HMR acceptance; no account, database or production access.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

const cssPath = 'apps/web/src/robotics/robotics.css';
const original = readFileSync(cssPath);
const token = 'probe-' + randomUUID().slice(0, 10);
const pageUrl = 'http://127.0.0.1:4630/#/';
let browser;
let touched = false;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await import('/src/robotics/robotics.css');
  });
  const loaded = await page.evaluate(() =>
    [...document.querySelectorAll('style')].some((node) => node.textContent.includes('.robotics-')),
  );
  if (!loaded) throw new Error('Robotics CSS was not imported by Vite');
  await page.evaluate((value) => { window.__roboticsFastHmrMarker = value; }, token);
  writeFileSync(cssPath, Buffer.concat([
    original,
    Buffer.from('\n:root { --asa-robotics-hmr-probe: ' + token + '; }\n'),
  ]));
  touched = true;
  await expect.poll(
    () => page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--asa-robotics-hmr-probe').trim(),
    ),
    { timeout: 25000 },
  ).toBe(token);
  const marker = await page.evaluate(() => window.__roboticsFastHmrMarker);
  if (marker !== token) throw new Error('Browser reloaded rather than CSS HMR');
  console.log('HMR_CSS_APPLIED_WITHOUT_RELOAD=PASS');
} catch (error) {
  console.error('HMR_CSS_CHECK=FAIL', error);
  process.exitCode = 1;
} finally {
  if (touched) {
    writeFileSync(cssPath, original);
    if (browser) {
      try {
        const pages = browser.contexts().flatMap((ctx) => ctx.pages());
        if (pages[0]) {
          await expect.poll(
            () => pages[0].evaluate(() =>
              getComputedStyle(document.documentElement)
                .getPropertyValue('--asa-robotics-hmr-probe').trim(),
            ),
            { timeout: 25000 },
          ).toBe('');
          console.log('HMR_TEMPORARY_CSS_REVERTED=PASS');
        }
      } catch (error) {
        console.error('HMR_REVERT_CHECK=FAIL', error);
        process.exitCode = 1;
      }
    }
  }
  await browser?.close();
}
