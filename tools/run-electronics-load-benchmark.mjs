import console from 'node:console';
import process from 'node:process';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { arch, cpus, platform, release } from 'node:os';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'apps/web/dist');
const assets = resolve(dist, 'assets');
const quick = process.argv.includes('--quick');
const iterations = quick ? 1 : 20;
const reportPath = resolve(root, 'reports/electronics-opt0-load-baseline.json');
const summaryPath = resolve(root, 'reports/electronics-opt0-load-baseline.md');

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}
function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}
function contentType(path) {
  return (
    {
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    }[extname(path)] ?? 'application/octet-stream'
  );
}
function asset(prefix) {
  const name = readdirSync(assets).find(
    (entry) => entry.startsWith(prefix) && entry.endsWith('.js'),
  );
  if (!name) throw new Error(`Missing production asset ${prefix}*.js`);
  return name;
}

const targets = {
  schematicEditor: asset('SchematicEditor-'),
  arduinoCodePanel: asset('ArduinoCodePanel-'),
  productionManifestAdapter: asset('production-manifest-adapter-'),
};
const catalogUrl = '/assets/electronics/component-database/catalog.json';
const server = createServer((request, response) => {
  if (request.url === '/' || request.url === '/blank.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><html><body><div id=root></div></body></html>');
    return;
  }
  const pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
  const file = resolve(dist, `.${pathname}`);
  if (!file.startsWith(dist)) {
    response.writeHead(403);
    response.end('forbidden');
    return;
  }
  try {
    const body = readFileSync(file);
    response.writeHead(200, {
      'content-type': contentType(file),
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});
await new Promise((done, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', done);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Load benchmark server failed');
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

async function freshPage(throttleRate) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttleRate });
  await page.goto(`${baseUrl}/blank.html`, { waitUntil: 'domcontentloaded' });
  return { context, page };
}
async function measureModule(fileName, throttleRate) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const { context, page } = await freshPage(throttleRate);
    const duration = await page.evaluate(async (url) => {
      const started = globalThis.performance.now();
      await import(url);
      return globalThis.performance.now() - started;
    }, `${baseUrl}/assets/${fileName}?cold=${index}`);
    samples.push(duration);
    await context.close();
  }
  return {
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    maxMs: Math.max(...samples),
  };
}
async function measureCatalog(throttleRate) {
  const fetchSamples = [];
  const parseSamples = [];
  for (let index = 0; index < iterations; index += 1) {
    const { context, page } = await freshPage(throttleRate);
    const measured = await page.evaluate(async (url) => {
      const fetchStarted = globalThis.performance.now();
      const response = await globalThis.fetch(`${url}?cold=${Math.random()}`, {
        cache: 'no-store',
      });
      const text = await response.text();
      const fetchMs = globalThis.performance.now() - fetchStarted;
      const parseStarted = globalThis.performance.now();
      const parsed = JSON.parse(text);
      return {
        fetchMs,
        parseMs: globalThis.performance.now() - parseStarted,
        rows: parsed.components?.length ?? null,
      };
    }, `${baseUrl}${catalogUrl}`);
    fetchSamples.push(measured.fetchMs);
    parseSamples.push(measured.parseMs);
    await context.close();
  }
  return {
    fetchP50Ms: percentile(fetchSamples, 0.5),
    fetchP95Ms: percentile(fetchSamples, 0.95),
    parseP50Ms: percentile(parseSamples, 0.5),
    parseP95Ms: percentile(parseSamples, 0.95),
  };
}
try {
  const profiles = [];
  for (const [profileId, throttleRate] of [
    ['native', 1],
    ['low-end-4x-cpu', 4],
  ]) {
    const modules = {};
    for (const [key, fileName] of Object.entries(targets)) {
      modules[key] = await measureModule(fileName, throttleRate);
    }
    profiles.push({
      profileId,
      cpuThrottleRate: throttleRate,
      modules,
      catalog: await measureCatalog(throttleRate),
    });
  }
  const report = {
    receiptVersion: 1,
    revision: git('rev-parse', 'HEAD'),
    dirtyTree: git('status', '--porcelain').length > 0,
    runtime: process.version,
    browser: `Chromium ${browser.version()}`,
    os: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    iterations,
    assets: Object.fromEntries(
      Object.entries(targets).map(([key, fileName]) => [
        key,
        { fileName, bytes: statSync(resolve(assets, fileName)).size },
      ]),
    ),
    profiles,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const rows = profiles
    .flatMap((profile) =>
      Object.entries(profile.modules).map(
        ([key, value]) =>
          `| ${profile.profileId} | ${key} | ${value.p50Ms.toFixed(2)} | ${value.p95Ms.toFixed(2)} | ${value.maxMs.toFixed(2)} |`,
      ),
    )
    .join('\n');
  const catalogRows = profiles
    .map(
      (profile) =>
        `| ${profile.profileId} | ${profile.catalog.fetchP50Ms.toFixed(2)} | ${profile.catalog.fetchP95Ms.toFixed(2)} | ${profile.catalog.parseP50Ms.toFixed(2)} | ${profile.catalog.parseP95Ms.toFixed(2)} |`,
    )
    .join('\n');
  const markdown = `# ASA Lab Electronics E-OPT-0 cold-load baseline

- revision: \`${report.revision}\`
- dirty tree: \`${report.dirtyTree}\`
- browser: \`${report.browser}\`
- iterations per cold measurement: ${iterations}
- boundary: production-built route modules are imported in fresh browser contexts; this is module cold-load evidence, not authenticated editor TTI.

## Production module cold import

| Profile | Module | p50 ms | p95 ms | max ms |
| --- | --- | ---: | ---: | ---: |
${rows}

## Component catalog fetch + parse

| Profile | fetch p50 ms | fetch p95 ms | parse p50 ms | parse p95 ms |
| --- | ---: | ---: | ---: | ---: |
${catalogRows}
`;
  writeFileSync(summaryPath, markdown, 'utf8');
  console.log(`Wrote ${reportPath}`);
  console.log(`Wrote ${summaryPath}`);
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
