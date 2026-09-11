import console from 'node:console';
import process from 'node:process';
import { createServer as createHttpServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { createServer as createViteServer } from 'vite';

const repositoryRoot = resolve(import.meta.dirname, '..');
const reportPath = resolve(repositoryRoot, 'reports/electronics-opt0-browser-baseline.json');
const summaryPath = resolve(repositoryRoot, 'docs/delivery/ELECTRONICS_OPT0_BROWSER_BASELINE.md');
const quick = process.argv.includes('--quick');
const warmups = quick ? 1 : 2;
const iterations = quick ? 2 : 5;

function git(...args) {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function bundleEntry(path) {
  const bytes = statSync(path).size;
  const gzipBytes = gzipSync(readFileSync(path)).byteLength;
  return { bytes, gzipBytes };
}
const revision = git('rev-parse', 'HEAD');
const dirtyTree = git('status', '--porcelain').length > 0;
const vite = await createViteServer({
  configFile: resolve(repositoryRoot, 'apps/web/vite.config.ts'),
  server: { middlewareMode: true },
  appType: 'custom',
});
const corpusModulePath = resolve(
  repositoryRoot,
  'contexts/electronics/testing/benchmark-corpus.ts',
).replaceAll('\\', '/');
const digestModulePath = resolve(
  repositoryRoot,
  'contexts/electronics/domain/simulation-input-digest.ts',
).replaceAll('\\', '/');
const benchmarkHtml = `<!doctype html><html><body><script type="module">
import { ELECTRONICS_BENCHMARK_CORPUS } from '/@fs/${corpusModulePath}';
import { sha256Hex } from '/@fs/${digestModulePath}';
const cases = [
  'dc-series-50',
  'transient-capacitor-5000ms',
  'transient-dc-motor-1000ms',
  'arduino-gpio-clock-2000us',
  'arduino-gpio-small-budget',
];
const fingerprint = (value) => sha256Hex(typeof value === 'string' ? value : JSON.stringify(value));
const statusOf = (value, operation) => {
  if (operation === 'digest') return 'digest';
  if (!value || typeof value !== 'object') return 'invalid-result';
  return operation === 'arduino-clock'
    ? String(value.executionStatus ?? 'missing')
    : String(value.status ?? 'missing');
};
const yieldToBrowser = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0));
async function runCase(caseId, warmups, iterations) {
  const testCase = ELECTRONICS_BENCHMARK_CORPUS.find((entry) => entry.id === caseId);
  if (!testCase) throw new Error('unknown benchmark case: ' + caseId);
  for (let index = 0; index < warmups; index += 1) {
    testCase.run();
    await yieldToBrowser();
  }
  const measured = [];
  const fingerprints = new Set();
  let status = 'missing';
  for (let index = 0; index < iterations; index += 1) {
    const timerStarted = globalThis.performance.now();
    const timerDelay = new Promise((resolve) =>
      globalThis.setTimeout(() => resolve(globalThis.performance.now() - timerStarted), 0),
    );
    const started = globalThis.performance.now();
    const result = testCase.run();
    const resultFingerprint = fingerprint(result);
    status = statusOf(result, testCase.operation);
    fingerprints.add(resultFingerprint);
    measured.push({
      durationMs: globalThis.performance.now() - started,
      eventLoopDelayMs: await timerDelay,
      fingerprint: resultFingerprint,
    });
    await yieldToBrowser();
  }
  return {
    caseId,
    iterations: measured,
    deterministic: fingerprints.size === 1,
    status,
    expectedStatus: testCase.expectedStatus,
  };
}
globalThis.__ASA_ELECTRONICS_BENCHMARK__ = { cases, runCase, ready: true };
</script></body></html>`;
const server = createHttpServer((request, response) => {
  if (request.url === '/__electronics_benchmark') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(benchmarkHtml);
    return;
  }
  vite.middlewares(request, response, () => {
    response.writeHead(404);
    response.end('not found');
  });
});
await new Promise((resolvePromise, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolvePromise);
});
const address = server.address();
if (!address || typeof address === 'string')
  throw new Error('benchmark server did not expose a TCP port');
const url = `http://127.0.0.1:${address.port}/__electronics_benchmark`;
const browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] });
const page = await browser.newPage();
const startedAt = new Date().toISOString();
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__ASA_ELECTRONICS_BENCHMARK__?.ready === true);
  await page.evaluate(() => {
    globalThis.__ASA_ELECTRONICS_LONG_TASKS__ = [];
    if (typeof globalThis.PerformanceObserver === 'function') {
      try {
        const observer = new globalThis.PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            globalThis.__ASA_ELECTRONICS_LONG_TASKS__.push({
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        });
        observer.observe({ type: 'longtask', buffered: true });
        globalThis.__ASA_ELECTRONICS_LONG_TASK_OBSERVER__ = observer;
      } catch {
        // Long Task API may be unavailable; event-loop delay remains authoritative.
      }
    }
  });
  const caseIds = await page.evaluate(() => [...globalThis.__ASA_ELECTRONICS_BENCHMARK__.cases]);
  const cases = [];
  for (const caseId of caseIds) {
    await page.evaluate(() => {
      globalThis.__ASA_ELECTRONICS_LONG_TASKS__.length = 0;
    });
    const heapBefore = await page.evaluate(
      () => globalThis.performance.memory?.usedJSHeapSize ?? null,
    );
    const result = await page.evaluate(
      async ({ caseId: id, warmups: w, iterations: count }) =>
        globalThis.__ASA_ELECTRONICS_BENCHMARK__.runCase(id, w, count),
      { caseId, warmups, iterations },
    );
    await page.waitForTimeout(100);
    const heapAfter = await page.evaluate(
      () => globalThis.performance.memory?.usedJSHeapSize ?? null,
    );
    const longTasks = await page.evaluate(() => [...globalThis.__ASA_ELECTRONICS_LONG_TASKS__]);
    if (!result.deterministic) throw new Error(`${caseId}: browser result is not deterministic`);
    if (result.status !== result.expectedStatus) {
      throw new Error(`${caseId}: expected ${result.expectedStatus}, received ${result.status}`);
    }
    const durations = result.iterations.map((entry) => entry.durationMs);
    const eventLoopDelays = result.iterations.map((entry) => entry.eventLoopDelayMs);
    cases.push({
      caseId,
      status: result.status,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      p99Ms: percentile(durations, 0.99),
      maxMs: Math.max(...durations),
      eventLoopDelayP95Ms: percentile(eventLoopDelays, 0.95),
      longTaskCount: longTasks.length,
      longTaskMaxMs: longTasks.length ? Math.max(...longTasks.map((entry) => entry.duration)) : 0,
      heapDeltaBytes: heapBefore === null || heapAfter === null ? null : heapAfter - heapBefore,
      deterministic: result.deterministic,
      fingerprint: result.iterations[0]?.fingerprint ?? null,
    });
  }
  const assetsDirectory = resolve(repositoryRoot, 'apps/web/dist/assets');
  const assetNames = readdirSync(assetsDirectory);
  const findAsset = (prefix, extension = '.js') => {
    const fileName = assetNames.find((name) => name.startsWith(prefix) && name.endsWith(extension));
    if (!fileName) throw new Error(`built asset not found: ${prefix}*${extension}`);
    return { fileName, ...bundleEntry(resolve(assetsDirectory, fileName)) };
  };
  const catalogPath = resolve(
    repositoryRoot,
    'apps/web/public/assets/electronics/component-database/catalog.json',
  );
  const bundle = {
    simulationCore: findAsset('electronics-simulation-core-'),
    arduinoCodePanel: findAsset('ArduinoCodePanel-'),
    schematicEditor: findAsset('SchematicEditor-', '.js'),
    schematicEditorCss: findAsset('SchematicEditor-', '.css'),
    workbenchSidebars: findAsset('WorkbenchSidebars-'),
    productionManifestAdapter: findAsset('production-manifest-adapter-'),
    componentCatalog: { fileName: 'catalog.json', ...bundleEntry(catalogPath) },
  };
  const report = {
    receiptVersion: 1,
    revision,
    dirtyTree,
    startedAt,
    completedAt: new Date().toISOString(),
    runtime: process.version,
    browser: `Chromium ${browser.version()}`,
    os: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    warmups,
    iterations,
    isolation: 'ephemeral 127.0.0.1 HTTP server + Vite middleware; no API or database',
    cases,
    bundle,
  };
  const absolute = resolve(reportPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const rows = cases
    .map(
      (entry) =>
        `| ${entry.caseId} | ${entry.status} | ${entry.p50Ms.toFixed(3)} | ${entry.p95Ms.toFixed(3)} | ${entry.eventLoopDelayP95Ms.toFixed(3)} | ${entry.longTaskCount} | ${entry.longTaskMaxMs.toFixed(3)} |`,
    )
    .join('\n');
  const bundleRows = Object.entries(bundle)
    .map(
      ([key, entry]) =>
        `| ${key} | ${entry.fileName} | ${(entry.bytes / 1024).toFixed(1)} | ${(entry.gzipBytes / 1024).toFixed(1)} |`,
    )
    .join('\n');
  const markdown = `# ASA Lab Electronics E-OPT-0 browser baseline

This receipt measures the current Electronics computation on Chromium's main thread.
The server is ephemeral and isolated: no ASA API, PostgreSQL or live Docker is used.

## Receipt

- revision: \`${revision}\`
- dirty tree before run: \`${dirtyTree}\`
- browser: \`${report.browser}\`
- runtime: \`${report.runtime}\`
- CPU: \`${report.cpu}\` (${report.logicalCpuCount} logical CPUs)
- protocol: ${warmups} warmups, ${iterations} measured iterations
- isolation: ${report.isolation}

## Main-thread cases

| Case | Status | p50 ms | p95 ms | event-loop p95 ms | Long Tasks | max Long Task ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${rows}

## Production Electronics payload baseline

| Asset | File | KiB | gzip KiB |
| --- | --- | ---: | ---: |
${bundleRows}

## Interpretation

A solve above roughly one animation-frame budget can visibly reduce responsiveness.
A measured Long Task above 50 ms is direct evidence that the current synchronous path
can block browser interaction. This receipt does not change the solver or prescribe a
specific Worker protocol; it establishes the before-state for E-OPT-1.
`;
  writeFileSync(summaryPath, markdown, 'utf8');
  console.log(`Wrote ${reportPath}`);
  console.log(`Wrote ${summaryPath}`);
} finally {
  await browser.close();
  await vite.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
}
