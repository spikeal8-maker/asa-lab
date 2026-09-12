import console from 'node:console';
import process from 'node:process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';

if (!process.argv.includes('--accept')) {
  throw new Error('Refusing to rewrite Electronics golden data without --accept');
}

const repositoryRoot = resolve(import.meta.dirname, '..');
const outputPath = resolve(
  repositoryRoot,
  'contexts/electronics/testing/fixtures/benchmark-golden.v2.json',
);
const corpusPath = resolve(
  repositoryRoot,
  'contexts/electronics/testing/benchmark-corpus.ts',
).replaceAll('\\', '/');
const digestPath = resolve(
  repositoryRoot,
  'contexts/electronics/domain/simulation-input-digest.ts',
).replaceAll('\\', '/');
function statusOf(value, operation) {
  if (operation === 'digest') return 'digest';
  if (!value || typeof value !== 'object') return 'invalid-result';
  return operation === 'arduino-clock'
    ? String(value.executionStatus ?? 'missing')
    : String(value.status ?? 'missing');
}

const vite = await createViteServer({
  configFile: resolve(repositoryRoot, 'apps/web/vite.config.ts'),
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const corpusModule = await vite.ssrLoadModule(`/@fs/${corpusPath}`);
  const digestModule = await vite.ssrLoadModule(`/@fs/${digestPath}`);
  const entries = {};
  for (const testCase of corpusModule.ELECTRONICS_BENCHMARK_CORPUS) {
    const result = testCase.run();
    const status = statusOf(result, testCase.operation);
    if (status !== testCase.expectedStatus) {
      throw new Error(`${testCase.id}: expected ${testCase.expectedStatus}, got ${status}`);
    }
    entries[testCase.id] = {
      status,
      fingerprint: digestModule.sha256Hex(
        typeof result === 'string' ? result : JSON.stringify(result),
      ),
    };
  }

  const golden = {
    schema: 'asa-lab.electronics-benchmark-golden.v1',
    corpusVersion: corpusModule.ELECTRONICS_BENCHMARK_CORPUS_VERSION,
    entries,
  };
  writeFileSync(outputPath, `${JSON.stringify(golden, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outputPath}`);
} finally {
  await vite.close();
}
