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
const warmupSeconds = quick ? 1 : 30;
const checkpointCount = quick ? 2 : 5;
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
let previous = calculateSimulationPreflight(document, 0);
let simulationTimeMs = 0;
let totalIterations = 0;
let maximumIterationMs = 0;
globalThis.__ASA_MEMORY_ADVANCE__ = async (milliseconds) => {
  let intervalIterations = 0;
  const started = performance.now();
  while (performance.now() - started < milliseconds) {
    simulationTimeMs += 100;
    const iterationStarted = performance.now();
    previous = advanceLiveSimulation(document, previous, simulationTimeMs);
    maximumIterationMs = Math.max(maximumIterationMs, performance.now() - iterationStarted);
    intervalIterations += 1;
    totalIterations += 1;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return {
    intervalIterations,
    totalIterations,
    simulationTimeMs,
    maximumIterationMs,
    finalStatus: previous.status,
  };
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
  const coldHeapBytes = await page.evaluate(
    () => globalThis.performance.memory?.usedJSHeapSize ?? null,
  );
  const warmup = await page.evaluate(
    (ms) => globalThis.__ASA_MEMORY_ADVANCE__(ms),
    warmupSeconds * 1000,
  );
  await cdp.send('HeapProfiler.collectGarbage');
  const warmHeapBytes = await page.evaluate(
    () => globalThis.performance.memory?.usedJSHeapSize ?? null,
  );
  const checkpoints = [];
  const intervalMilliseconds = (soakSeconds * 1000) / checkpointCount;
  let latest = warmup;
  for (let checkpointIndex = 1; checkpointIndex <= checkpointCount; checkpointIndex += 1) {
    latest = await page.evaluate(
      (ms) => globalThis.__ASA_MEMORY_ADVANCE__(ms),
      intervalMilliseconds,
    );
    await cdp.send('HeapProfiler.collectGarbage');
    const heapBytes = await page.evaluate(
      () => globalThis.performance.memory?.usedJSHeapSize ?? null,
    );
    const deltaBytes =
      warmHeapBytes === null || heapBytes === null ? null : heapBytes - warmHeapBytes;
    checkpoints.push({
      elapsedSoakSeconds: (soakSeconds * checkpointIndex) / checkpointCount,
      heapBytes,
      retainedDeltaFromWarmBytes: deltaBytes,
      retainedGrowthFromWarmPercent:
        warmHeapBytes && deltaBytes !== null ? (deltaBytes / warmHeapBytes) * 100 : null,
      totalIterations: latest.totalIterations,
      simulationTimeMs: latest.simulationTimeMs,
    });
  }
  const finalCheckpoint = checkpoints.at(-1);
  const retainedHeapDeltaBytes = finalCheckpoint?.retainedDeltaFromWarmBytes ?? null;
  const retainedHeapGrowthPercent = finalCheckpoint?.retainedGrowthFromWarmPercent ?? null;
  const report = {
    receiptVersion: 2,
    revision: git('rev-parse', 'HEAD'),
    dirtyTree: git('status', '--porcelain').length > 0,
    browser: `Chromium ${browser.version()}`,
    warmupSeconds,
    soakSeconds,
    checkpointCount,
    method:
      'production advanceLiveSimulation motor path; persistent 100 ms simulation ticks; warm-up then CDP GC baseline plus GC-stabilized checkpoints',
    coldHeapBytes,
    warmHeapBytes,
    retainedHeapDeltaBytes,
    retainedHeapGrowthPercent,
    provisionalFivePercentTargetPassed:
      retainedHeapGrowthPercent !== null ? retainedHeapGrowthPercent <= 5 : null,
    checkpoints,
    iterations: latest.totalIterations,
    simulationTimeMs: latest.simulationTimeMs,
    maxIterationMs: latest.maximumIterationMs,
    finalStatus: latest.finalStatus,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const markdown = `# ASA Lab Electronics E-OPT-0 memory baseline

- revision: \`${report.revision}\`
- dirty tree: \`${report.dirtyTree}\`
- browser: \`${report.browser}\`
- warm-up: ${warmupSeconds}s before the retained-heap baseline
- soak: ${soakSeconds}s, ${report.iterations} cumulative live-simulation iterations
- method: ${report.method}
- cold heap before warm-up: ${coldHeapBytes ?? 'n/a'} bytes
- warm GC-stabilized baseline: ${warmHeapBytes ?? 'n/a'} bytes
- retained delta from warm baseline: ${retainedHeapDeltaBytes ?? 'n/a'} bytes
- retained growth from warm baseline: ${retainedHeapGrowthPercent === null ? 'n/a' : retainedHeapGrowthPercent.toFixed(2) + '%'}
- provisional <=5% target: ${report.provisionalFivePercentTargetPassed === null ? 'n/a' : report.provisionalFivePercentTargetPassed ? 'PASS' : 'FAIL'}
- maximum single live-simulation iteration: ${report.maxIterationMs.toFixed(3)} ms

## GC-stabilized checkpoints

| Elapsed soak s | Heap bytes | Delta from warm B | Growth from warm % | Total iterations |
| ---: | ---: | ---: | ---: | ---: |
${checkpoints
  .map(
    (entry) =>
      `| ${entry.elapsedSoakSeconds.toFixed(0)} | ${entry.heapBytes ?? 'n/a'} | ${entry.retainedDeltaFromWarmBytes ?? 'n/a'} | ${entry.retainedGrowthFromWarmPercent === null ? 'n/a' : entry.retainedGrowthFromWarmPercent.toFixed(2)} | ${entry.totalIterations} |`,
  )
  .join('\n')}
`;
  writeFileSync(summaryPath, markdown, 'utf8');
  console.log(`Wrote ${reportPath}`);
  console.log(`Wrote ${summaryPath}`);
} finally {
  await browser.close();
  await vite.close();
  await new Promise((done) => server.close(done));
}
