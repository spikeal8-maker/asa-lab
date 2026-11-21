import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const files = [
  'e2e/electronics-mobile-properties.spec.ts',
  'e2e/electronics-block-pin-setup.spec.ts',
];
const root = '/workspace';
const directory = root + '/reports/electronics-supplemental-native';
const need = (v) => assert.ok(v, 'Supplemental native proof incomplete');
const sha = (data) => createHash('sha256').update(data).digest('hex');

export function cases(report, execution = false) {
  need(Array.isArray(report.suites) && !report.errors?.length);
  const result = [];
  function visit(suite, parents = []) {
    for (const spec of suite.specs ?? []) {
      need(files.some((file) => file.slice(4) === spec.file));
      need(spec.tests?.length === 1);
      const test = spec.tests[0];
      need(
        test.expectedStatus === 'passed' &&
          !(test.annotations ?? []).some((a) => ['skip', 'fixme', 'fail'].includes(a.type)),
      );
      if (execution)
        need(
          test.status === 'expected' &&
            test.results?.length === 1 &&
            test.results[0].status === 'passed' &&
            test.results[0].retry === 0,
        );
      result.push(JSON.stringify([spec.file, parents, spec.title, test.projectName ?? '']));
    }
    for (const child of suite.suites ?? []) visit(child, [...parents, suite.title]);
  }
  report.suites.forEach((suite) => visit(suite));
  need(result.length > 0 && new Set(result).size === result.length);
  for (const file of files) need(result.some((key) => JSON.parse(key)[0] === file.slice(4)));
  if (execution)
    need(
      report.stats?.expected === result.length &&
        report.stats.unexpected === 0 &&
        report.stats.flaky === 0 &&
        report.stats.skipped === 0,
    );
  return result.sort();
}

export function readiness(status, body, source) {
  const number = (n) => (Number.isSafeInteger(n) && n >= 0 && n < 1000000 ? n : null);
  const deployment = body?.deployment;
  return {
    httpStatus: Number.isInteger(status) ? status : null,
    status: ['ready', 'not_ready'].includes(body?.status) ? body.status : null,
    revision:
      typeof deployment?.revision === 'string' && /^[a-f0-9]{40}$/.test(deployment.revision)
        ? deployment.revision
        : null,
    schemaVersion: number(deployment?.schemaVersion),
    expectedSchemaVersion: number(deployment?.expectedSchemaVersion),
    synchronized: typeof deployment?.synchronized === 'boolean' ? deployment.synchronized : null,
    candidateRevision: source.candidateRevision,
    workflowRevision: source.workflowRevision,
  };
}
export function validateReady(value, source) {
  need(
    value.httpStatus === 200 &&
      value.status === 'ready' &&
      value.revision === source.candidateRevision &&
      value.schemaVersion === source.schema &&
      value.expectedSchemaVersion === source.schema &&
      value.synchronized === true,
  );
}
export function validateWebIdentity(status, body, source) {
  need(status === 200 && body?.revision === source.candidateRevision);
}

function inventory(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    need(!entry.isSymbolicLink());
    const file = resolve(path, entry.name);
    return entry.isDirectory()
      ? inventory(file)
      : [
          {
            path: relative(directory, file),
            bytes: statSync(file).size,
            sha256: sha(readFileSync(file)),
          },
        ];
  });
}

export async function run() {
  need(
    process.argv.length === 2 &&
      process.env.CI === 'true' &&
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.ASA_E2E_EXTERNAL === 'true' &&
      process.env.ASA_E2E_BASE_URL === 'http://web:8080',
  );
  const source = JSON.parse(readFileSync(directory + '/source.json', 'utf8'));
  need(
    /^[a-f0-9]{40}$/.test(source.candidateRevision) &&
      /^[a-f0-9]{40}$/.test(source.workflowRevision) &&
      source.candidateRevision === process.env.ASA_ELECTRONICS_EXPECTED_SHA &&
      source.workflowRevision === process.env.ASA_SUPPLEMENTAL_WORKFLOW_REVISION &&
      Number.isSafeInteger(source.schema) &&
      source.schema > 0 &&
      source.fullElectronicsQualification === false &&
      source.releaseAccepted === false,
  );
  assert.deepEqual(source.files, files);
  need(
    sha(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/g, '\n')) ===
      source.runnerSha256,
  );
  // Workflow-side verified proofs must exist before runtime requests/native code.
  const images = JSON.parse(readFileSync(directory + '/built-images.json', 'utf8'));
  need(images.length === 3);
  for (const [i, name] of ['api', 'web', 'test'].entries()) {
    const roots = source.images[name === 'web' ? 'caddy' : 'node'].rootfs_diff_ids;
    assert.deepEqual(images[i].RootFS.Layers.slice(0, roots.length), roots);
    need(images[i].Architecture === 'amd64' && images[i].Os === 'linux');
    if (name !== 'test')
      need(
        images[i].Config.Labels['org.opencontainers.image.revision'] === source.candidateRevision,
      );
  }
  const pg = JSON.parse(readFileSync(directory + '/postgres-image.json', 'utf8'));
  need(
    pg.pulled_image === source.images.postgres.reference &&
      [source.images.postgres.config.digest, source.images.postgres.manifest_digest].includes(
        pg.config_digest,
      ),
  );
  assert.deepEqual(pg.rootfs_diff_ids, source.images.postgres.rootfs_diff_ids);
  let failure,
    discovered = [],
    executed = [];
  try {
    const response = await fetch('http://web:8080/health/ready', {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    const ready = readiness(response.status, await response.json().catch(() => null), source);
    writeFileSync(directory + '/runtime-readiness.json', JSON.stringify(ready, null, 2), {
      flag: 'wx',
    });
    validateReady(ready, source);
    const webResponse = await fetch('http://web:8080/build-metadata.json', {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    const webBody = await webResponse.json().catch(() => null);
    const web = {
      httpStatus: webResponse.status,
      revision:
        typeof webBody?.revision === 'string' && /^[a-f0-9]{40}$/.test(webBody.revision)
          ? webBody.revision
          : null,
    };
    writeFileSync(directory + '/web-identity.json', JSON.stringify(web), { flag: 'wx' });
    validateWebIdentity(web.httpStatus, web, source);
    const invoke = (args, env = process.env) =>
      spawnSync('pnpm', ['exec', 'playwright', 'test', ...files, ...args], {
        cwd: root,
        env,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
    const discovery = invoke(['--list', '--reporter=json']);
    writeFileSync(directory + '/discovery.json', discovery.stdout ?? '', { flag: 'wx' });
    writeFileSync(directory + '/discovery.private.log', discovery.stderr ?? '', { flag: 'wx' });
    need(!discovery.error && discovery.status === 0);
    discovered = cases(JSON.parse(discovery.stdout));
    const output = directory + '/playwright';
    mkdirSync(output);
    const child = invoke(['--reporter=list,json', '--trace=on', '--output', output], {
      ...process.env,
      PLAYWRIGHT_JSON_OUTPUT_FILE: directory + '/execution.json',
    });
    writeFileSync(
      directory + '/execution.private.log',
      (child.stdout ?? '') + (child.stderr ?? ''),
      { flag: 'wx' },
    );
    need(!child.error && child.status === 0);
    executed = cases(JSON.parse(readFileSync(directory + '/execution.json', 'utf8')), true);
    assert.deepEqual(executed, discovered);
  } catch {
    failure = true;
  }
  writeFileSync(
    directory + '/qualification.json',
    JSON.stringify(
      {
        candidateRevision: source.candidateRevision,
        workflowRevision: source.workflowRevision,
        files,
        discoveryCount: discovered.length,
        executionCount: executed.length,
        conclusion: failure ? 'FAIL_OR_INCOMPLETE' : 'PASS',
        fullElectronicsQualification: false,
        releaseAccepted: false,
        manifest: inventory(directory),
      },
      null,
      2,
    ),
    { flag: 'wx' },
  );
  if (failure)
    throw new Error(
      'Supplemental native qualification failed; inspect encrypted evidence privately',
    );
  console.log(
    'Supplemental native cases passed: ' +
      executed.length +
      '; no full Electronics/release acceptance.',
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  run().catch(() => {
    console.error('Supplemental native qualification failed; raw evidence was not printed.');
    process.exitCode = 1;
  });
