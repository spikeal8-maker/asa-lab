import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, type RollupOutput } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const API_PACKAGE = resolve(REPO_ROOT, 'apps/api/package.json');
const WEB_ROOT = resolve(REPO_ROOT, 'apps/web');
const WEB_ENTRY = resolve(WEB_ROOT, 'testing/engine-browser-consumer.ts');

const DOCUMENT = {
  schemaVersion: 4 as const,
  components: [
    {
      id: 'source',
      kind: 'source' as const,
      position: { x: 0, y: 0 },
      value: 5,
    },
    {
      id: 'resistor',
      kind: 'resistor' as const,
      position: { x: 100, y: 0 },
      value: 1000,
    },
  ],
  connections: [
    {
      id: 'positive',
      from: { componentId: 'source', terminal: 'a' },
      to: { componentId: 'resistor', terminal: 'a' },
    },
    {
      id: 'negative',
      from: { componentId: 'resistor', terminal: 'b' },
      to: { componentId: 'source', terminal: 'b' },
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: true, maxIterations: 24 },
};

beforeAll(() => {
  const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
  execFileSync(
    corepack,
    ['pnpm', 'nx', 'run', 'electronics:build', '--skip-nx-cache'],
    {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    },
  );
}, 60_000);

describe('Electronics built-package consumer contract', () => {
  it('resolves and executes the public engine subpath from the API package', async () => {
    const apiRequire = createRequire(pathToFileURL(API_PACKAGE));
    const engineEntry = apiRequire.resolve('@asa-lab/electronics/engine');
    expect(engineEntry.replaceAll('\\', '/')).toContain('/contexts/electronics/dist/engine.js');

    const engine = await import(pathToFileURL(engineEntry).href);
    expect(engine.ELECTRONICS_ENGINE_DESCRIPTOR.contractVersion).toBe(1);
    expect(engine.ELECTRONICS_ENGINE_DESCRIPTOR.capabilities).toEqual([
      'parse-document',
      'prepare-topology',
      'analyse-snapshot',
    ]);

    const parsed = engine.parseElectronicsEngineDocument(DOCUMENT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const prepared = engine.prepareElectronicsSnapshot(parsed.document);
    const result = engine.analyseElectronicsSnapshot(parsed.document);
    expect(prepared.netCount).toBeGreaterThan(0);
    expect(result.status).toBe('solved');
    expect(result.current).toBeCloseTo(0.005, 9);
  });

  it('bundles and executes the same public engine subpath from the Web package', async () => {
    const built = await build({
      root: WEB_ROOT,
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        target: 'es2022',
        lib: {
          entry: WEB_ENTRY,
          formats: ['es'],
          fileName: 'engine-browser-consumer',
        },
        rollupOptions: { output: { inlineDynamicImports: true } },
      },
    });

    const output = (Array.isArray(built) ? built[0] : built) as RollupOutput;
    const entry = output.output.find((item) => item.type === 'chunk' && item.isEntry);
    expect(entry?.type).toBe('chunk');
    if (!entry || entry.type !== 'chunk') return;

    const bundleUrl = `data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`;
    const browserConsumer = await import(bundleUrl);
    const receipt = browserConsumer.runEngineBrowserConsumerContract();

    expect(receipt.contractVersion).toBe(1);
    expect(receipt.capabilities).toEqual([
      'parse-document',
      'prepare-topology',
      'analyse-snapshot',
    ]);
    expect(receipt.netCount).toBeGreaterThan(0);
    expect(receipt.status).toBe('solved');
    expect(receipt.solved).toBe(true);
    expect(receipt.current).toBeCloseTo(0.005, 9);
  });
});
