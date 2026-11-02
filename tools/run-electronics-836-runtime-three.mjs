import assert from 'node:assert/strict';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const { fetch, AbortSignal } = globalThis;

const BASE = '692b76095dd0cdf0c9f6f8e18a503d37668940f8';
const SUBSET = '836-runtime-three-v1';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'reports/electronics-836-three');
const need = (value, message) => assert.ok(value, '836 targeted evidence: ' + message);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const expectedCases = Object.freeze([
  {
    file: 'electronics-selection-outline.spec.ts',
    suites: [],
    title: 'E11 stopped-fit: native outward selection, real DC and whole save reopen at 1440px',
  },
  {
    file: 'electronics-selection-outline.spec.ts',
    suites: [],
    title:
      'E11 running-controls: native outward selection, real DC and whole save reopen at 1440px',
  },
  {
    file: 'electronics-interactions.spec.ts',
    suites: ['asset recovery in the built editor'],
    title: 'a failed catalog owner image recovers without placing or saving a component',
  },
]);
const key = ({ file, suites, title }) => JSON.stringify([file, suites, title]);
const expectedKeys = new Set(expectedCases.map(key));
export const selector =
  '(?:' +
  expectedCases.map(({ title }) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') +
  ')$';

export function validateReport(report, execution = false, selectedOnly = true) {
  need(Array.isArray(report.suites) && !report.errors?.length, 'missing suites/report errors');
  const cases = [];
  function visit(suite, parents = []) {
    const suites = parents.length ? parents.slice(1) : [];
    for (const spec of suite.specs ?? [])
      cases.push({
        file: spec.file,
        suites: [...suites, ...(parents.length ? [suite.title] : [])],
        title: spec.title,
        spec,
      });
    for (const child of suite.suites ?? []) visit(child, [...parents, suite.title]);
  }
  report.suites.forEach((suite) => visit(suite));
  const selected = cases.filter((entry) => expectedKeys.has(key(entry)));
  need(selected.length === 3 && (!selectedOnly || cases.length === 3), 'exactly three fixed cases');
  need(new Set(selected.map(key)).size === 3, 'duplicate identity');
  for (const entry of selected) {
    const tests = entry.spec.tests;
    need(
      tests?.length === 1 &&
        tests[0].expectedStatus === 'passed' &&
        !(tests[0].annotations ?? []).some(({ type }) => ['skip', 'fixme', 'fail'].includes(type)),
      'one project, no skipped/expected-failure case',
    );
    if (execution)
      need(
        tests[0].status === 'expected' &&
          tests[0].results?.length === 1 &&
          tests[0].results[0].status === 'passed' &&
          tests[0].results[0].retry === 0,
        'one actual successful attempt',
      );
  }
  if (execution)
    need(
      report.stats?.expected === 3 &&
        report.stats.unexpected === 0 &&
        report.stats.flaky === 0 &&
        report.stats.skipped === 0,
      'three passed; no other outcomes',
    );
  return selected;
}

export function validateImages(proofs, postgres, source) {
  need(proofs.length === 3, 'three built images');
  const expected = ['api', 'web', 'test']
    .map((name) => `asa-lab-${name}:${source.revision}`)
    .sort();
  assert.deepEqual(proofs.map((r) => r.built_image).sort(), expected);
  for (const proof of proofs) {
    const base = proof.built_image.startsWith('asa-lab-web:') ? 'caddy' : 'node';
    need(
      proof.source_revision === source.revision &&
        /^sha256:[a-f0-9]{64}$/.test(proof.config_digest),
      'built revision/config',
    );
    assert.deepEqual(proof.base_diff_ids, source.images[base].rootfs_diff_ids);
  }
  need(
    postgres.pulled_image === source.images.postgres.reference &&
      [source.images.postgres.config.digest, source.images.postgres.manifest_digest].includes(
        postgres.config_digest,
      ),
    'exact original PostgreSQL image',
  );
  assert.deepEqual(postgres.rootfs_diff_ids, source.images.postgres.rootfs_diff_ids);
}

function filesIn(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    need(!entry.isSymbolicLink(), 'linked evidence forbidden');
    const target = resolve(path, entry.name);
    return entry.isDirectory() ? filesIn(target) : [target];
  });
}

export async function runQualification() {
  need(process.argv.length === 2, 'no arguments, filters or commands');
  need(
    process.env.CI === 'true' &&
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.NX_SKIP_NX_CACHE === 'true' &&
      process.env.ASA_E2E_EXTERNAL === 'true' &&
      process.env.ASA_E2E_BASE_URL === 'http://web:8080' &&
      process.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE === 'strict-real-time' &&
      process.env.ASA_ELECTRONICS_EVIDENCE_SUBSET === SUBSET &&
      !process.env.ASA_ELECTRONICS_QUALIFICATION_ENTRYPOINT,
    'fixed isolated strict runtime',
  );
  const source = JSON.parse(readFileSync(resolve(directory, 'source.json'), 'utf8'));
  need(
    source.revision === process.env.ASA_ELECTRONICS_EXPECTED_SHA &&
      /^[a-f0-9]{40}$/.test(source.revision) &&
      source.candidate === BASE &&
      source.scope === SUBSET &&
      source.schema === 300 &&
      source.fullElectronicsQualification === false &&
      source.releaseAccepted === false &&
      /^[a-f0-9]{64}$/.test(source.sourceProjectionSha256),
    'exact reviewed source receipt',
  );
  need(
    sha(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/g, '\n')) ===
      source.runnerSha256 &&
      sha(
        readFileSync(resolve(root, 'tools/electronics_836_three_source.py'), 'utf8').replace(
          /\r\n/g,
          '\n',
        ),
      ) === source.guardSha256,
    'actual executable bytes differ from source proof',
  );
  // Identity checks precede runtime requests, child processes and evidence writes.
  validateImages(
    readFileSync(resolve(directory, 'built-images.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l)),
    JSON.parse(readFileSync(resolve(directory, 'postgres-image.json'), 'utf8')),
    source,
  );
  need(
    readdirSync(directory).sort().join('|') ===
      'built-images.jsonl|postgres-image.json|source.json',
    'stale/foreign output',
  );
  const response = await fetch('http://web:8080/health/ready', {
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  need(response.status === 200, 'runtime readiness');
  const data = await response.json();
  need(
    data.status === 'ready' &&
      data.deployment?.revision === source.revision &&
      data.deployment.schemaVersion === source.schema &&
      data.deployment.synchronized === true,
    'runtime revision/schema',
  );
  const output = resolve(directory, 'playwright');
  mkdirSync(output);
  const invoke = (args, env = process.env, stdio = 'pipe') =>
    spawnSync(
      'pnpm',
      [
        'exec',
        'playwright',
        'test',
        'e2e/electronics-selection-outline.spec.ts',
        'e2e/electronics-interactions.spec.ts',
        ...args,
      ],
      { cwd: root, env, stdio, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
  let failure;
  try {
    const discovery = invoke(['--list', '--reporter=json']);
    writeFileSync(resolve(directory, 'discovery-all.json'), discovery.stdout ?? '');
    need(!discovery.error && discovery.status === 0, 'discovery process');
    validateReport(JSON.parse(discovery.stdout), false, false);
    const selected = invoke(['--list', '--grep', selector, '--reporter=json']);
    writeFileSync(resolve(directory, 'discovery-three.json'), selected.stdout ?? '');
    need(!selected.error && selected.status === 0, 'selected discovery process');
    validateReport(JSON.parse(selected.stdout));
    const child = invoke(
      ['--grep', selector, '--retries=0', '--trace=on', '--output', output, '--reporter=list,json'],
      { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: resolve(directory, 'execution.json') },
      'inherit',
    );
    need(!child.error && child.status === 0, 'native execution process');
    validateReport(JSON.parse(readFileSync(resolve(directory, 'execution.json'), 'utf8')), true);
    const originals = spawnSync(
      'python3',
      ['tools/electronics_836_three_source.py', '--artifacts'],
      { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    writeFileSync(
      resolve(directory, 'artifact-validation.log'),
      (originals.stdout ?? '') + (originals.stderr ?? ''),
    );
    need(!originals.error && originals.status === 0, 'original raw/trace/PNG/lifecycle proof');
  } catch (error) {
    failure = error;
  }
  let manifest = [];
  try {
    manifest = filesIn(directory).map((path) => ({
      path: relative(directory, path),
      bytes: statSync(path).size,
      sha256: sha(readFileSync(path)),
    }));
  } catch (error) {
    failure ??= error;
  }
  writeFileSync(
    resolve(directory, 'qualification.json'),
    JSON.stringify(
      {
        ...source,
        cases: expectedCases,
        discoveryExpected: 3,
        executionExpected: 3,
        conclusion: failure ? 'FAIL_OR_INCOMPLETE' : 'PASS',
        fullElectronicsQualification: false,
        releaseAccepted: false,
        error: failure?.message ?? null,
        manifest,
      },
      null,
      2,
    ) + '\n',
  );
  if (failure) throw failure;
  console.log(
    '836 targeted three cases PASS; full Electronics qualification NOT_RUN; no release acceptance.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runQualification();
