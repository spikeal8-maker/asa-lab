#!/usr/bin/env node
// Web delivery budget: what a visitor downloads and how long they wait before
// the first screen is usable. "Usable" means the sign-in control responds, not
// first paint — a spinner is not a product.
//
//   node tools/measure-load.mjs <baseUrl>            report only
//   node tools/measure-load.mjs <baseUrl> --check    compare against the budget
//
// Needs a running instance serving the built SPA and Playwright's chromium.
// Absolute timings depend on the machine, so thresholds keep margin; the point
// is to catch a regression, not to certify a number.
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = resolve(root, 'docs/testing/performance-budget.json');
const SIGN_IN_CONTROL = 'Войти';

const args = process.argv.slice(2);
const check = args.includes('--check');
const baseUrl = args.find((value) => !value.startsWith('--')) ?? 'http://127.0.0.1:4611';

const PROFILES = [
  { key: 'mbps10', label: 'школьный Wi-Fi  10 Мбит/с', mbps: 10, rttMs: 40 },
  { key: 'mbps1_6', label: 'слабый мобильный 1.6 Мбит/с', mbps: 1.6, rttMs: 150 },
];

const browser = await chromium.launch();

async function measureWeight() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const seen = [];

  // Transferred bytes, not decoded bytes: a visitor on a school connection pays
  // for what crosses the wire. Reading the body instead would report the
  // uncompressed size and hide compression entirely.
  const pending = [];
  page.on('response', (response) => {
    if (!response.url().startsWith(baseUrl)) return;
    pending.push(
      response
        .request()
        .sizes()
        .then((sizes) => ({
          url: response.url().replace(baseUrl, ''),
          size: sizes.responseBodySize,
        }))
        .catch(() => ({ url: response.url().replace(baseUrl, ''), size: 0 })),
    );
  });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('button', { name: SIGN_IN_CONTROL, exact: true })
    .waitFor({ timeout: 60_000 });
  await page.waitForLoadState('networkidle');
  seen.push(...(await Promise.all(pending)));
  await context.close();

  return {
    requests: seen.length,
    pageWeightKb: Math.round(seen.reduce((sum, entry) => sum + entry.size, 0) / 1024),
    heaviest: seen.sort((a, b) => b.size - a.size).slice(0, 5),
  };
}

async function measureTimeToInterface(profile) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.rttMs,
    downloadThroughput: (profile.mbps * 1024 * 1024) / 8,
    uploadThroughput: (profile.mbps * 1024 * 1024) / 8,
  });

  const started = Date.now();
  await page.goto(baseUrl, { waitUntil: 'commit' });
  await page
    .getByRole('button', { name: SIGN_IN_CONTROL, exact: true })
    .waitFor({ timeout: 120_000 });
  const elapsed = Date.now() - started;
  await context.close();
  return elapsed;
}

/**
 * The entry chunk, measured uncompressed from the build. Transferred size is
 * what a visitor pays for on the wire, but the entry chunk is also what the
 * browser must parse and execute before anything is interactive, and that cost
 * does not compress.
 */
async function mainChunkKb() {
  const assets = resolve(root, 'apps/web/dist/assets');
  const entries = await readdir(assets);
  const main = entries.filter((name) => /^index-[^/]+\.js$/.test(name));
  if (main.length === 0) return null;
  const sizes = await Promise.all(
    main.map(async (name) => (await stat(resolve(assets, name))).size),
  );
  return Math.round(Math.max(...sizes) / 1024);
}

const weight = await measureWeight();
const entryChunkKb = await mainChunkKb();
const timings = {};
for (const profile of PROFILES) {
  timings[profile.key] = await measureTimeToInterface(profile);
}
await browser.close();

console.log(`ASA Lab web delivery — ${baseUrl}`);
console.log(`  запросов на главной: ${weight.requests}, вес: ${weight.pageWeightKb} КБ`);
for (const entry of weight.heaviest) {
  console.log(`    ${(entry.size / 1024).toFixed(1).padStart(8)} КБ  ${entry.url}`);
}
for (const profile of PROFILES) {
  console.log(`  до интерфейса, ${profile.label}: ${timings[profile.key]} мс`);
}
if (entryChunkKb !== null) {
  console.log(`  главный чанк (без сжатия): ${entryChunkKb} КБ`);
}

if (!check) process.exit(0);

const budget = JSON.parse(await readFile(BUDGET_FILE, 'utf8')).web;
const rules = [
  { label: 'вес главной', value: weight.pageWeightKb, limit: budget.pageWeightKbMax, unit: ' КБ' },
  ...PROFILES.map((profile) => ({
    label: `до интерфейса ${profile.label}`,
    value: timings[profile.key],
    limit: budget.timeToInterfaceMsMax[profile.key],
    unit: ' мс',
  })),
  ...(entryChunkKb === null
    ? []
    : [{ label: 'главный чанк', value: entryChunkKb, limit: budget.mainChunkKbMax, unit: ' КБ' }]),
];

let failed = false;
for (const rule of rules) {
  const ok = rule.value <= rule.limit;
  if (!ok) failed = true;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${rule.label}: ${rule.value}${rule.unit} (порог ≤ ${rule.limit}${rule.unit})`,
  );
}

console.log(failed ? '\nбюджет превышен' : '\nбюджет соблюдён');
process.exit(failed ? 1 : 0);
