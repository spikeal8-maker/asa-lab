import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const title =
  'E11 stopped-fit: native outward selection, real DC and whole save reopen at 390px';
export const file = 'electronics-selection-outline.spec.ts';
export const families = [
  'resistor',
  'button',
  'switch',
  'led',
  'lamp',
  'supply',
  'meter',
  'uno',
  'board',
];
export const selector = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'reports/e11-stopped-fit-390');
const need = (value, message) => assert.ok(value, 'Fixed E11 qualification: ' + message);

export function validateReport(report, execution = false) {
  need(Array.isArray(report.suites) && !report.errors?.length, 'missing discovery/report errors');
  const cases = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) cases.push(spec);
    for (const nested of suite.suites ?? []) visit(nested);
  }
  report.suites.forEach(visit);
  need(
    cases.length === 1 && cases[0].file === file && cases[0].title === title,
    'exactly one fixed original case',
  );
  const tests = cases[0].tests;
  need(
    tests?.length === 1 &&
      tests[0].expectedStatus === 'passed' &&
      !(tests[0].annotations ?? []).some((a) => ['skip', 'fixme', 'fail'].includes(a.type)),
    'one non-skipped project',
  );
  if (execution) {
    const test = tests[0];
    need(
      test.status === 'expected' &&
        test.results?.length === 1 &&
        test.results[0].status === 'passed' &&
        test.results[0].retry === 0,
      'one successful attempt',
    );
    need(
      report.stats?.expected === 1 &&
        report.stats.unexpected === 0 &&
        report.stats.flaky === 0 &&
        report.stats.skipped === 0,
      'one completed case, no other outcomes',
    );
  }
  return cases[0];
}

export function validateRaw(raw) {
  need(
    raw.width === 390 &&
      raw.scenario === 'stopped-fit' &&
      raw.journeyComplete === true &&
      raw.lastCheckpoint === 'complete' &&
      !raw.primaryFailure &&
      !raw.mandatoryEvidenceFailure,
    'complete original journey',
  );
  need(
    raw.lifecycleJournal?.errors?.length === 0 && raw.workerJournal?.errors?.length === 0,
    'complete lifecycle/worker evidence',
  );
  for (const id of families) {
    const pairs = raw.output.filter(
      (entry) => entry.phase === 'fit' && entry.id === id && entry.beforePath && entry.afterPath,
    );
    need(pairs.length === 1, 'all nine original native PNG pairs');
  }
}

export function validateImages(proofs, revision) {
  need(Array.isArray(proofs) && proofs.length === 3, 'three exact built image proofs');
  const expected = ['api', 'web', 'test'].map((service) => `asa-lab-${service}:${revision}`).sort();
  need(
    JSON.stringify(proofs.map((row) => row.built_image).sort()) === JSON.stringify(expected),
    'fixed image identities',
  );
  need(
    proofs.every(
      (row) =>
        row.source_revision === revision &&
        /^sha256:[a-f0-9]{64}$/.test(row.config_digest) &&
        Array.isArray(row.base_diff_ids) &&
        row.base_diff_ids.length > 0,
    ),
    'image source/base proof',
  );
}

function filesIn(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = resolve(path, entry.name);
    need(!entry.isSymbolicLink(), 'evidence must not follow links');
    return entry.isDirectory() ? filesIn(target) : [target];
  });
}

export async function runQualification() {
  need(process.argv.length === 2, 'no arguments, filters or commands');
  need(
    process.env.CI === 'true' &&
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.ASA_E2E_EXTERNAL === 'true' &&
      process.env.ASA_E2E_BASE_URL === 'http://web:8080' &&
      process.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE === 'strict-real-time' &&
      !process.env.ASA_ELECTRONICS_QUALIFICATION_ENTRYPOINT,
    'fixed isolated strict runtime',
  );
  mkdirSync(directory, { recursive: true });
  const source = JSON.parse(readFileSync(resolve(directory, 'source.json'), 'utf8'));
  need(
    source.revision === process.env.ASA_ELECTRONICS_EXPECTED_SHA &&
      /^[a-f0-9]{40}$/.test(source.revision) &&
      source.candidate === 'fadc2ee0c46c9a704641d68f334d82f4d9b5ac05' &&
      source.fullElectronicsQualification === false,
    'reviewed source receipt',
  );
  const imageProof = readFileSync(resolve(directory, 'built-images.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  validateImages(imageProof, source.revision);
  const postgresProof = JSON.parse(readFileSync(resolve(directory, 'postgres-image.json'), 'utf8'));
  need(
    /@sha256:[a-f0-9]{64}$/.test(postgresProof.pulled_image) &&
      Array.isArray(postgresProof.rootfs_diff_ids) &&
      postgresProof.rootfs_diff_ids.length > 0,
    'retained verified PostgreSQL proof',
  );
  const ready = await fetch('http://web:8080/health/ready', { signal: AbortSignal.timeout(10000) });
  need(ready.status === 200, 'runtime readiness');
  const data = await ready.json();
  need(
    data.status === 'ready' &&
      data.deployment?.revision === source.revision &&
      data.deployment.schemaVersion === source.schema &&
      data.deployment.synchronized === true,
    'runtime source/schema identity',
  );
  const output = resolve(directory, 'playwright');
  const invoke = (args, env = process.env) =>
    spawnSync(
      'pnpm',
      [
        'exec',
        'playwright',
        'test',
        'e2e/' + file,
        '--grep',
        selector,
        '--workers=1',
        '--retries=0',
        '--output',
        output,
        ...args,
      ],
      { cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
  let failure;
  try {
    const discovery = invoke(['--list', '--reporter=json']);
    writeFileSync(resolve(directory, 'discovery.json'), discovery.stdout ?? '');
    need(!discovery.error && discovery.status === 0, 'discovery process');
    validateReport(JSON.parse(discovery.stdout));
    const executionPath = resolve(directory, 'execution.json');
    const child = invoke(['--trace=on', '--reporter=list,json'], {
      ...process.env,
      PLAYWRIGHT_JSON_OUTPUT_FILE: executionPath,
    });
    writeFileSync(resolve(directory, 'stdout.log'), child.stdout ?? '');
    writeFileSync(resolve(directory, 'stderr.log'), child.stderr ?? '');
    need(!child.error && child.status === 0, 'native execution process');
    validateReport(JSON.parse(readFileSync(executionPath, 'utf8')), true);
    const evidence = filesIn(output);
    const rawPaths = evidence.filter((p) => p.endsWith('e11-outline-stopped-fit-390-raw.json'));
    need(rawPaths.length === 1, 'one raw original receipt');
    const raw = JSON.parse(readFileSync(rawPaths[0], 'utf8'));
    validateRaw(raw);
    for (const id of families)
      for (const state of ['unselected', 'selected']) {
        need(
          evidence.some(
            (p) =>
              p.endsWith(`fit-${id}-${state}.png`) &&
              statSync(p).size > 8 &&
              readFileSync(p)
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
          ),
          'retained native PNG',
        );
      }
    need(
      evidence.some((p) => p.endsWith('trace.zip') && statSync(p).size > 0),
      'retained trace',
    );
    need(
      evidence.some(
        (p) => p.endsWith('e11-outline-stopped-fit-390-lifecycle.jsonl') && statSync(p).size > 0,
      ),
      'retained lifecycle journal',
    );
    need(
      evidence.some((p) => p.endsWith('e11-outline-stopped-fit-390-worker.jsonl')),
      'retained worker journal',
    );
  } catch (error) {
    failure = error;
  }
  const manifest = filesIn(directory).map((p) => ({
    path: relative(directory, p),
    bytes: statSync(p).size,
    sha256: createHash('sha256').update(readFileSync(p)).digest('hex'),
  }));
  writeFileSync(
    resolve(directory, 'qualification.json'),
    JSON.stringify(
      {
        ...source,
        title,
        file,
        discoveryExpected: 1,
        executionExpected: 1,
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runQualification();
