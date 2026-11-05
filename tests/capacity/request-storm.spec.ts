import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertStormClientProvenance,
  assertStormEnvironment,
  documentDigest,
  STORM_CLIENT_MODULES,
  stormChromiumResources,
  stormClientProvenance,
  stormRoute,
  stormSourcePlugin,
  summarizeStorm,
} from '../../tools/capacity/request-storm-contracts.mjs';

const fixture = () => ({
  ASA_REQUEST_STORM: '1',
  ASA_STORM_USERS: '60',
  ASA_STORM_VARIANT: 'candidate',
  ASA_STORM_SOURCE_SHA: 'a'.repeat(40),
  ASA_STORM_RUN_ID: '12345678-1234-4234-8234-123456789012',
  TEST_DATABASE_URL:
    'postgresql://postgres:fixture@127.0.0.1:5432/asa_request_storm_candidate_test',
  APP_TEST_DATABASE_URL:
    'postgresql://asalab_app:fixture@127.0.0.1:5432/asa_request_storm_candidate_test',
});

describe('request-storm real Vite source selection', () => {
  const temporary: string[] = [];
  const source = 'a'.repeat(40);
  afterEach(() => {
    for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true });
  });

  function sourceFixture() {
    const directory = mkdtempSync(join(tmpdir(), 'asa-storm-source-'));
    temporary.push(directory);
    const roots = {
      candidate: join(directory, 'candidate'),
      baseline: join(directory, 'baseline'),
    };
    for (const [variant, root] of Object.entries(roots))
      for (const path of STORM_CLIENT_MODULES) {
        const file = join(root, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `export const value = ${JSON.stringify(`${variant}:${path}`)};`);
      }
    // Like the workload, the entry always belongs to the candidate checkout.
    // Candidate imports physically exist, so a normal-order remapper loses to vite:resolve.
    const entry = join(roots.candidate, 'tests/capacity/request-storm-client.ts');
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(
      entry,
      STORM_CLIENT_MODULES.map(
        (path, index) => `import { value as v${index} } from '../../${path.replace(/\.ts$/, '')}';`,
      ).join('\n') +
        `\nexport const values = [${STORM_CLIENT_MODULES.map((_, index) => `v${index}`).join(',')}];`,
    );
    async function bundle(selectedRoot: string, early = true) {
      const plugin = stormSourcePlugin(entry, selectedRoot);
      if (!early) delete plugin.enforce;
      const result = await build({
        root: roots.candidate,
        configFile: false,
        logLevel: 'silent',
        plugins: [plugin],
        build: {
          write: false,
          minify: false,
          lib: { entry, formats: ['es'], name: 'StormSourceFixture' },
        },
      });
      return (Array.isArray(result) ? result : [result])
        .flatMap((output) => ('output' in output ? output.output : []))
        .filter((item) => item.type === 'chunk');
    }
    return { roots, entry, bundle };
  }

  it.each(['baseline', 'candidate'] as const)(
    'bundles every real client module from the selected %s tree',
    async (variant) => {
      const { roots, bundle } = sourceFixture();
      const chunks = await bundle(roots[variant]);
      const proof = stormClientProvenance(chunks, roots[variant], source);
      const code = chunks.map((chunk) => chunk.code).join('\n');
      for (const path of STORM_CLIENT_MODULES) {
        expect(code).toContain(`${variant}:${path}`);
        expect(code).not.toContain(`${variant === 'baseline' ? 'candidate' : 'baseline'}:${path}`);
      }
      expect(proof.modules.map(([path]) => path)).toEqual([...STORM_CLIENT_MODULES].sort());
      expect(proof.moduleCount).toBe(STORM_CLIENT_MODULES.length);
      expect(assertStormClientProvenance(proof, source)).toBe(proof);
    },
  );

  it('reproduces the old late-plugin bug and rejects its falsely labelled baseline graph', async () => {
    const { roots, bundle } = sourceFixture();
    const chunks = await bundle(roots.baseline, false);
    expect(chunks[0]!.code).toContain('candidate:apps/web/src/api.ts');
    expect(() => stormClientProvenance(chunks, roots.baseline, source)).toThrow(
      'Foreign client module',
    );
  });

  it('rejects a transitive candidate dependency even when every required baseline entry exists', async () => {
    const { roots, bundle } = sourceFixture();
    const foreign = join(roots.candidate, 'apps/web/src/foreign.ts');
    writeFileSync(foreign, 'export const foreign = "candidate-leak";');
    writeFileSync(
      join(roots.baseline, 'apps/web/src/api.ts'),
      `import { foreign } from ${JSON.stringify(foreign.replaceAll('\\', '/'))};\n` +
        'export const value = "baseline:apps/web/src/api.ts" + foreign;',
    );
    const chunks = await bundle(roots.baseline);
    expect(chunks[0]!.code).toContain('candidate-leak');
    expect(() => stormClientProvenance(chunks, roots.baseline, source)).toThrow(
      'Foreign client module',
    );
  });

  it.each(['moduleIds', 'modules'] as const)('checks foreign paths in chunk.%s', async (field) => {
    const { roots, bundle } = sourceFixture();
    const chunks = await bundle(roots.baseline);
    const foreign = join(roots.candidate, 'apps/web/src/api.ts');
    const first = chunks[0]!;
    if (field === 'moduleIds') first.moduleIds.push(foreign);
    else first.modules[foreign] = first.modules[first.moduleIds[0]!]!;
    expect(() => stormClientProvenance(chunks, roots.baseline, source)).toThrow(
      'Foreign client module',
    );
  });

  it('rejects an incomplete real bundle instead of accepting a labelled stub', async () => {
    const { roots, entry, bundle } = sourceFixture();
    writeFileSync(entry, 'export { value } from "../../apps/web/src/api";');
    const chunks = await bundle(roots.baseline);
    expect(() => stormClientProvenance(chunks, roots.baseline, source)).toThrow(
      'Missing required client modules',
    );
  });

  it('rejects old reports, a mismatched source and altered module evidence before comparison', async () => {
    const { roots, bundle } = sourceFixture();
    const proof = stormClientProvenance(await bundle(roots.baseline), roots.baseline, source);
    const incomplete = proof.modules.slice(1);
    const invalid = [
      undefined,
      { ...proof, source: 'b'.repeat(40) },
      { ...proof, bundleFingerprint: undefined },
      { ...proof, moduleCount: proof.moduleCount + 1 },
      { ...proof, modules: proof.modules.map(([path]) => [path, '0'.repeat(64)]) },
      {
        ...proof,
        modules: incomplete,
        moduleCount: incomplete.length,
        moduleFingerprint: createHash('sha256').update(JSON.stringify(incomplete)).digest('hex'),
      },
    ];
    for (const value of invalid)
      expect(() => assertStormClientProvenance(value, source)).toThrow(
        'Verified client source provenance',
      );
  });

  it('makes the comparison CLI reject legacy success reports without verified client sources', () => {
    const { roots } = sourceFixture();
    const reports = join(roots.candidate, 'reports/request-storm');
    mkdirSync(reports, { recursive: true });
    for (const variant of ['baseline', 'candidate'])
      writeFileSync(
        join(reports, `${variant}-30.json`),
        JSON.stringify({ success: true, source, users: 30, variant }),
      );
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../tools/capacity/request-storm.mjs', import.meta.url)),
        'compare',
        '30',
      ],
      { cwd: roots.candidate, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Verified client source provenance is required');
  });
});

describe('request-storm Chromium process evidence', () => {
  it('counts the live Playwright headless_shell tree, excluding unrelated host browsers', () => {
    const resources = stormChromiumResources(
      [
        '100 1 200 0.1 node',
        '101 100 10 0.0 node',
        '102 101 1200 3.0 headless_shell',
        '103 102 800 2.5 headless_shell',
        '104 102 100 0.5 chrome_crashpad',
        '200 1 9000 50.0 chrome',
        '201 200 9000 50.0 headless_shell',
        '105 100 500 1.0 chromedriver',
      ].join('\n'),
      100,
      true,
    );
    expect(resources).toEqual({
      supported: true,
      scope: 'workload-process-descendants',
      processes: 3,
      rssSumBytes: 2100 * 1024,
      lifetimeCpuPercentSum: 6,
    });
  });

  it.each(['chrome', 'chromium', 'chromium-browse'])('accepts %s executable names', (name) => {
    expect(stormChromiumResources(`101 100 1024 1.5 ${name}`, 100, true).processes).toBe(1);
  });

  it('fails a zero-process live-browser sample even if another browser is present', () => {
    expect(() => stormChromiumResources('200 1 9000 50.0 chrome', 100, true)).toThrow(
      'Live Chromium has no owned process samples',
    );
    expect(stormChromiumResources('', 100, false).processes).toBe(0);
  });

  it('rejects malformed process evidence instead of recording non-finite resource values', () => {
    expect(() => stormChromiumResources('101 100 missing NaN headless_shell', 100, true)).toThrow(
      'Invalid Chromium process sample',
    );
  });
});

describe('request-storm workload boundaries and honest evidence', () => {
  it('compares nested JSON content independently of PostgreSQL object key order', () => {
    const original = {
      schemaVersion: 4,
      components: [{ id: 'r0', position: { x: 10, y: 20 }, value: 1001 }],
      simulation: { running: false, maxIterations: 24 },
    };
    const reopened = {
      components: [{ value: 1001, id: 'r0', position: { y: 20, x: 10 } }],
      simulation: { maxIterations: 24, running: false },
      schemaVersion: 4,
    };
    expect(documentDigest(reopened)).toBe(documentDigest(original));
  });

  it('detects changed values, missing fields and changed array order after saving', () => {
    const original = {
      components: [
        { id: 'r0', value: 1001 },
        { id: 'r1', value: 2001 },
      ],
      simulation: { running: false },
    };
    const changed = [
      {
        ...original,
        components: [{ id: 'r0', value: 1002 }, original.components[1]],
      },
      { components: original.components },
      { ...original, components: [...original.components].reverse() },
    ];
    for (const document of changed)
      expect(documentDigest(document)).not.toBe(documentDigest(original));
  });

  it('accepts only the explicitly selected disposable fixture', () => {
    expect(assertStormEnvironment(fixture())).toMatchObject({ users: 60, variant: 'candidate' });
  });
  it.each([
    { ASA_REQUEST_STORM: '0' },
    { ASA_STORM_USERS: '3000' },
    { ASA_STORM_SOURCE_SHA: 'main' },
    { ASA_STORM_RUN_ID: '-'.repeat(36) },
    { ASA_STORM_VARIANT: 'baseline' },
    {
      TEST_DATABASE_URL:
        'postgresql://postgres:fixture@asa-lab.ru:5432/asa_request_storm_candidate_test',
    },
    { TEST_DATABASE_URL: 'postgresql://postgres:fixture@127.0.0.1:5432/asalab' },
    {
      APP_TEST_DATABASE_URL:
        'postgresql://postgres:fixture@127.0.0.1:5432/asa_request_storm_candidate_test',
    },
    {
      APP_TEST_DATABASE_URL:
        'postgresql://asalab_app:fixture@127.0.0.1:5432/asa_request_storm_baseline_test',
    },
  ])('rejects unsafe fixture override %j', (change) => {
    expect(() => assertStormEnvironment({ ...fixture(), ...change })).toThrow();
  });
  it('does not hide real 5xx among deliberate injected outages or count setup as load', () => {
    const records = [
      { client: -1, phase: 'setup', route: '/api/auth/register', status: 201, durationMs: 2 },
      {
        client: 0,
        phase: 'outage',
        route: '/api/projects',
        status: 503,
        durationMs: 4,
        injected: true,
      },
      {
        client: 1,
        phase: 'steady',
        route: '/api/projects',
        status: 503,
        durationMs: 100,
        injected: false,
      },
      {
        client: 1,
        phase: 'steady',
        route: '/api/modules',
        status: 200,
        durationMs: 20,
        injected: false,
      },
    ];
    expect(summarizeStorm(records, 1000, 2)).toMatchObject({
      requests: 3,
      requestsPerSecond: 3,
      requestsPerClient: 1.5,
      injectedFailures: 1,
      unexpected5xx: 1,
      latencyMs: { count: 2, p95: 100 },
    });
    expect(stormRoute('/api/projects/12345678-1234-4234-8234-123456789012?secret=redacted')).toBe(
      '/api/projects/:id',
    );
    expect(stormRoute('/api/games/chess/invites/synthetic-private-code/accept')).toBe(
      '/api/games/chess/invites/:code/accept',
    );
  });
});
