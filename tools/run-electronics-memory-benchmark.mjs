import console from 'node:console';
import process from 'node:process';
import { createServer as createHttpServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer as createViteServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const quick = process.argv.includes('--quick');
const requestedSoakSeconds = Number.parseInt(
  process.env.ASA_ELECTRONICS_MEMORY_SOAK_SECONDS ?? '',
  10,
);
const soakSeconds = quick
  ? 3
  : Number.isInteger(requestedSoakSeconds) && requestedSoakSeconds > 0
    ? requestedSoakSeconds
    : 900;
const reportPath = resolve(root, 'reports/electronics-opt0-memory-baseline.json');
const summaryPath = resolve(root, 'reports/electronics-opt0-memory-baseline.md');
const livePath = resolve(root, 'apps/web/src/electronics/live-simulation.ts').replaceAll('\\', '/');

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}
const vite = await createViteServer({
  configFile: resolve(root, 'apps/web/vite.config.ts'),
  server: { middlewareMode: true },
  appType: 'custom',
});
const html = `<!doctype html><html><body><script type="module">
import { calculateSimulationPreflight, advanceLiveSimulation } from '/@fs/${livePath}';
const document = {
  schemaVersion: 4,
  components: [
    { id: 'source', kind: 'source', value: 6, position: { x: 0, y: 0 } },
    { id: 'motor', kind: 'visual', value: 0, position: { x: 0, y: 0 }, componentTypeId: 'dc-motor', pinIds: ['negative', 'positive'] },
  ],
  connections: [
    { id: 'p', from: { componentId: 'source', terminal: 'a' }, to: { componentId: 'motor', terminal: 'positive' }, vertices: [] },
    { id: 'n', from: { componentId: 'motor', terminal: 'negative' }, to: { componentId: 'source', terminal: 'b' }, vertices: [] },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: true, maxIterations: 64 },
};
globalThis.__ASA_MEMORY_SOAK__ = async (milliseconds) => {
  let previous = calculateSimulationPreflight(document, 0);
  let simulationTimeMs = 0;
  let iterations = 0;
  let maxIterationMs = 0;
  const started = performance.now();
  while (performance.now() - started < milliseconds) {
    simulationTimeMs += 100;
    const iterationStarted = performance.now();
    previous = advanceLiveSimulation(document, previous, simulationTimeMs);
    maxIterationMs = Math.max(maxIterationMs, performance.now() - iterationStarted);
    iterations += 1;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { iterations, simulationTimeMs, maxIterationMs, finalStatus: previous.status };
};
globalThis.__ASA_MEMORY_READY__ = true;
</script></body></html>`;
const server = createHttpServer((request, response) => {
  if (request.url === '/__electronics_memory') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  vite.middlewares(request, response, () => {
    response.writeHead(404);
    response.end('not found');
  });
});
await new Promise((done, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', done);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Memory benchmark server failed');
const browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] });
const page = await browser.newPage();
const cdp = await page.context().newCDPSession(page);
try {
  await page.goto(`http://127.0.0.1:${address.port}/__electronics_memory`);
  await page.waitForFunction(() => globalThis.__ASA_MEMORY_READY__ === true);
  await cdp.send('HeapProfiler.collectGarbage');
  const before = await page.evaluate(() => globalThis.performance.memory?.usedJSHeapSize ?? null);
  const result = await page.evaluate(
    (ms) => globalThis.__ASA_MEMORY_SOAK__(ms),
    soakSeconds * 1000,
  );
  await cdp.send('HeapProfiler.collectGarbage');
  const after = await page.evaluate(() => globalThis.performance.memory?.usedJSHeapSize ?? null);
  const delta = before === null || after === null ? null : after - before;
  const growthPercent = before && delta !== null ? (delta / before) * 100 : null;
  const report = {
    receiptVersion: 1,
    revision: git('rev-parse', 'HEAD'),
    dirtyTree: git('status', '--porcelain').length > 0,
    browser: `Chromium ${browser.version()}`,
    soakSeconds,
    method:
      'production advanceLiveSimulation motor path; 100 ms simulation ticks; CDP GC before/after',
    heapBeforeBytes: before,
    heapAfterBytes: after,
    retainedHeapDeltaBytes: delta,
    retainedHeapGrowthPercent: growthPercent,
    ...result,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const markdown = `# ASA Lab Electronics E-OPT-0 memory baseline

- revision: \`${report.revision}\`
- dirty tree: \`${report.dirtyTree}\`
- browser: \`${report.browser}\`
- soak: ${soakSeconds}s, ${report.iterations} live-simulation iterations
- method: ${report.method}
- heap before GC-stabilized soak: ${before ?? 'n/a'} bytes
- heap after GC-stabilized soak: ${after ?? 'n/a'} bytes
- retained delta: ${delta ?? 'n/a'} bytes
- retained growth: ${growthPercent === null ? 'n/a' : growthPercent.toFixed(2) + '%'}
- maximum single live-simulation iteration: ${report.maxIterationMs.toFixed(3)} ms
`;
  writeFileSync(summaryPath, markdown, 'utf8');
  console.log(`Wrote ${reportPath}`);
  console.log(`Wrote ${summaryPath}`);
} finally {
  await browser.close();
  await vite.close();
  await new Promise((done) => server.close(done));
}
