// Prove old circuits change only the canonical installed-model-set digest.
import assert from 'node:assert/strict';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('vite'))('esbuild');
const root = resolve('.');
const output = resolve('test-results/spst-registry');
mkdirSync(output, { recursive: true });
const source = `
export {ELECTRONICS_BENCHMARK_CORPUS} from './contexts/electronics/testing/benchmark-corpus';
export {createElectronicsAdvanceSession} from './contexts/electronics/engine';
export {rawDisplayCircuit} from './contexts/electronics/testing/fixtures/raw-seven-segment';
`;
const originalFiles = new Set([
  'document.ts',
  'model-identity.ts',
  'model-registry.ts',
  'solver.ts',
  'switch-topology.ts',
  'arduino-circuit-scheduler.ts',
]);
const modules = [];
for (const original of [true, false]) {
  const built = await build({
    stdin: { resolveDir: root, contents: source, loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    plugins: original
      ? [
          {
            name: 'exact-main-domain',
            setup(builder) {
              builder.onLoad(
                { filter: /contexts[\\/]electronics[\\/]domain[\\/][^\\/]+\.ts$/ },
                (args) => {
                  if (!originalFiles.has(args.path.split(/[\\/]/).at(-1))) return;
                  const path = args.path.slice(root.length + 1).replaceAll('\\', '/');
                  return {
                    contents: execFileSync('git', ['show', `35783660:${path}`], {
                      encoding: 'utf8',
                    }),
                    loader: 'ts',
                  };
                },
              );
            },
          },
        ]
      : [],
  });
  const path = resolve(output, original ? 'main.cjs' : 'candidate.cjs');
  writeFileSync(path, built.outputFiles[0].text);
  modules.push(require(path));
}
const [baseline, candidate] = modules;
const oldDigest = 'sha256:cf1c1cdf671948ddaa41e25ff2d9d8a33dc43596d4faffe57552f5e4e60a2a59';
const newDigest = 'sha256:fcb0f3241eef974a312c1fa1891b86aee92d5d3cd5a8e76475f53fcaa2b201d5';
const bytes = (value) => (typeof value === 'string' ? value : JSON.stringify(value));
const hash = (value) => createHash('sha256').update(bytes(value)).digest('hex');
const goldenPath = 'contexts/electronics/testing/fixtures/benchmark-golden.v2.json';
const golden = JSON.parse(
  execFileSync('git', ['show', `35783660:${goldenPath}`], { encoding: 'utf8' }),
);
const receipts = [];
for (const [index, oldCase] of baseline.ELECTRONICS_BENCHMARK_CORPUS.entries()) {
  const nextCase = candidate.ELECTRONICS_BENCHMARK_CORPUS[index];
  assert.equal(nextCase.id, oldCase.id);
  const oldResult = oldCase.run();
  const nextResult = nextCase.run();
  assert.equal(hash(oldResult), golden.entries[oldCase.id].fingerprint, `baseline ${oldCase.id}`);
  assert.equal(
    bytes(nextResult).replaceAll(newDigest, oldDigest),
    bytes(oldResult),
    `non-digest change ${oldCase.id}`,
  );
  receipts.push({ id: oldCase.id, baseline: hash(oldResult), candidate: hash(nextResult) });
  golden.entries[oldCase.id].fingerprint = hash(nextResult);
}
const rawPath = 'contexts/electronics/testing/fixtures/raw-seven-segment-before.json';
const rawSource = execFileSync('git', ['show', `35783660:${rawPath}`], { encoding: 'utf8' });
const raw = JSON.parse(rawSource);
for (const entry of raw.cases) {
  const results = [baseline, candidate].map((module) => {
    const session = module.createElectronicsAdvanceSession(
      module.rawDisplayCircuit(entry.options),
      { requestedHorizonMicroseconds: entry.horizon },
      { observeLedTemporal: true },
    );
    try {
      let value;
      do {
        value = session.step();
      } while (!value);
      return value;
    } finally {
      session.dispose();
    }
  });
  assert.equal(bytes(results[0]), bytes(entry.result), `baseline raw ${entry.horizon}`);
  assert.equal(
    bytes(results[1]).replaceAll(newDigest, oldDigest),
    bytes(results[0]),
    `non-digest raw change ${entry.horizon}`,
  );
}
if (process.argv.includes('--write')) {
  writeFileSync(goldenPath, `${JSON.stringify(golden, null, 2)}\n`);
  writeFileSync(rawPath, rawSource.replaceAll(oldDigest, newDigest));
}
writeFileSync(
  resolve(output, 'proof.json'),
  JSON.stringify(
    {
      baseline: '35783660',
      oldDigest,
      newDigest,
      benchmarkCases: receipts,
      rawCases: raw.cases.length,
      invariant: 'complete JSON byte equality after modelSetDigest substitution only',
      written: process.argv.includes('--write'),
    },
    null,
    2,
  ),
);
console.log(
  `Registry proof PASS: ${receipts.length} benchmark and ${raw.cases.length} full raw frames; only modelSetDigest changed.`,
);
