import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  statfsSync,
} from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { availableParallelism, cpus, hostname, platform, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'node:timers';
import {
  SCALE_PROFILE,
  OFFICIAL_SCALE_SCENARIO,
  OFFICIAL_SCALE_POSTGRES,
  assertOfficialScaleDispatch,
  officialScaleAfterSelector,
  assertOfficialScaleReleaseProof,
  assertOfficialScaleImage,
  assertOfficialScaleRunner,
  assertOfficialScaleCompose,
  officialScaleBrowserInvocation,
  officialScaleResourceListArgs,
  assertOfficialScaleOwnedResource,
  assertOfficialScaleResourceInventory,
  assertOfficialScaleOwnedContainer,
  assertOfficialScaleRuntime,
  runOfficialScaleN30,
  SCALE_PROFILE_HASH,
  assertScaleDockerContext,
  assertScaleEnvironment,
  assertScaleImages,
  assertScaleIngressConfig,
  assertScaleApiIngressEnvironment,
  SCALE_API_ENV_PROBE_SCRIPT,
  assertScaleDriverNetwork,
  createScaleLedger,
  evaluateScaleLevel,
  readScaleMemInfo,
  scaleHash,
  scaleResourceViolation,
  evaluateScaleCalibration,
  SCALE_FAILURE_DIAGNOSTIC_LIMITS,
  captureScaleFailureDiagnostics,
  scaleFailureDiagnosticError,
} from './classroom-scale-contracts.mjs';
import {
  PG_ACTIVITY_POLICY,
  pgActivityError,
  qualifyPgActivityNative,
  startPgActivityObserver,
} from './classroom-scale-pg-activity.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reportsRoot = resolve(root, 'reports/classroom-official-n30');
const execute = promisify(execFile);
const composeFiles = [
  'compose.yaml',
  'compose.test.yaml',
  '.github/compose.registry-ci.yaml',
  '.github/compose.classroom-scale.yml',
];
const plannedFiles = [
  'tools/capacity/classroom-scale.mjs',
  'tools/capacity/classroom-scale-contracts.mjs',
  'tests/capacity/classroom-scale.spec.ts',
  'e2e/classroom-scale.spec.ts',
  '.github/workflows/classroom-official-n30.yml',
  '.github/compose.classroom-scale.yml',
  'tools/capacity/classroom-scale-release.py',
  'tools/capacity/classroom-scale-pg-activity.mjs',
  'tests/capacity/classroom-scale-pg-activity.spec.ts',
];
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const redactions = new Set();
const safeError = (error) => {
  let message = error instanceof Error ? error.message : 'Unknown controller failure';
  for (const value of redactions) if (value) message = message.replaceAll(value, '[redacted]');
  return message.replace(/(postgres(?:ql)?:\/\/)[^\s]+/g, '$1[redacted]').slice(0, 2000);
};
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.tmp';
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  renameSync(temporary, path);
}

async function capture(command, args, options = {}) {
  const result = await execute(command, args, {
    cwd: root,
    maxBuffer: 16 * 1024 ** 2,
    timeout: 30000,
    ...options,
  });
  return result.stdout.trim();
}

function start(command, args, options = {}) {
  const { timeoutMs = 30 * 60000, ...spawnOptions } = options;
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    detached: process.platform === 'linux',
    ...spawnOptions,
  });
  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform === 'linux' && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  };
  const deadline = setTimeout(kill, timeoutMs);
  const done = new Promise((resolveResult, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveResult({ code, signal }));
  }).finally(() => clearTimeout(deadline));
  return { child, done, kill };
}

async function checked(command, args, options = {}) {
  const { done } = start(command, args, options);
  const result = await done;
  if (result.code !== 0)
    throw Error(command + ' failed, exit=' + result.code + ', signal=' + result.signal);
}

async function check() {
  await checked('corepack', [
    'pnpm',
    'exec',
    'vitest',
    'run',
    'tests/capacity/classroom-scale.spec.ts',
    'tests/capacity/request-storm.spec.ts',
    'tests/capacity/classroom-scale-pg-activity.spec.ts',
    '--maxWorkers=1',
  ]);
  // Resolve the existing workspace aliases without generating a shared tsconfig
  // or requiring source application bundles for this contracts-only gate.
  const ts = (await import('typescript')).default;
  const loaded = ts.readConfigFile(resolve(root, 'tsconfig.base.json'), ts.sys.readFile);
  if (loaded.error) throw Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(
    {
      compilerOptions: {
        baseUrl: '.',
        paths: {
          ...loaded.config.compilerOptions.paths,
          '@asa-lab/identity': ['contexts/identity/index.ts'],
          '@asa-lab/module-sdk': ['packages/module-sdk/src/index.ts'],
          '@asa-lab/electronics/simulation': ['contexts/electronics/simulation.ts'],
        },
      },
      files: [
        'apps/web/src/build-metadata.d.ts',
        'e2e/classroom-scale.spec.ts',
        'tests/capacity/classroom-scale.spec.ts',
        'tests/capacity/classroom-scale-pg-activity.spec.ts',
      ],
      include: [],
    },
    ts.sys,
    root,
    {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
      checkJs: false,
      types: ['node'],
      noUnusedLocals: true,
      noUnusedParameters: true,
    },
  );
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) {
    console.error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (path) => path,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      }),
    );
    throw Error('Official N30 strict typecheck failed');
  }
  await checked(
    'corepack',
    ['pnpm', 'exec', 'nx', 'graph', '--file', 'reports/classroom-official-n30-graph.json'],
    { env: { ...process.env, NX_SKIP_NX_CACHE: 'true', NX_DAEMON: 'false' } },
  );
  await checked('corepack', [
    'pnpm',
    'exec',
    'eslint',
    ...plannedFiles.filter((path) => /\.(mjs|tsx?)$/.test(path)),
  ]);
  await checked('corepack', [
    'pnpm',
    'exec',
    'prettier',
    '--check',
    ...plannedFiles.filter((path) => !path.endsWith('.py')),
  ]);
  await checked('git', ['diff', '--check']);
}

async function ensurePortFree(port) {
  const server = createServer();
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', done);
  });
  await new Promise((done, fail) => server.close((error) => (error ? fail(error) : done())));
}

function dockerApi(path) {
  return new Promise((done, fail) => {
    const outgoing = request(
      { socketPath: '/var/run/docker.sock', path, timeout: 4000 },
      (response) => {
        const chunks = [];
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 4 * 1024 ** 2) outgoing.destroy(Error('Docker sample exceeded its bound'));
          else chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            if (response.statusCode !== 200)
              throw Error('Docker observer HTTP' + response.statusCode);
            done(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            fail(error);
          }
        });
        response.on('error', fail);
      },
    );
    outgoing.on('timeout', () => outgoing.destroy(Error('Docker observer deadline')));
    outgoing.on('error', fail);
    outgoing.end();
  });
}

function cpuTicks() {
  return cpus().reduce(
    (sum, cpu) => ({
      idle: sum.idle + cpu.times.idle,
      total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0),
    }),
    { idle: 0, total: 0 },
  );
}

async function run() {
  const env = {
    ...process.env,
    ASA_SCALE_RUN_TOKEN: randomBytes(16).toString('hex'),
  };
  const harness = assertOfficialScaleDispatch(env);
  officialScaleAfterSelector(env);
  if (platform() !== 'linux' || /DESKTOP-R0HSMSA|D2-R2/i.test(hostname()))
    throw Error('Only isolated hosted Linux CI is allowed');
  if (
    (await capture('git', ['rev-parse', 'HEAD'])) !== harness.harnessSha ||
    (await capture('git', ['status', '--porcelain', '--untracked-files=all']))
  )
    throw Error('The measurement harness must be the clean exact dispatched main checkout');
  if (
    scaleHash(readFileSync(resolve(root, 'e2e/classroom-scale.spec.ts'), 'utf8')) !==
      OFFICIAL_SCALE_SCENARIO.e2eSha256 ||
    SCALE_PROFILE_HASH !== OFFICIAL_SCALE_SCENARIO.profileHash
  )
    throw Error('The pinned full N30 workload or its original SLO/profile changed');
  assertScaleDockerContext(JSON.parse(await capture('docker', ['context', 'inspect', 'default'])));
  const output = resolve(reportsRoot, harness.runId + '-' + harness.attempt);
  if (existsSync(output)) throw Error('Run evidence already exists; no reuse or overwrite');
  mkdirSync(output, { recursive: true });
  const preparationSamples = [];
  let preparationFailure;
  let preparing;
  const observePreparation = () => {
    try {
      const disk = statfsSync(root);
      const sample = {
        atMs: Date.now(),
        ...readScaleMemInfo(readFileSync('/proc/meminfo', 'utf8')),
        diskFreeBytes: disk.bavail * disk.bsize,
        containers: [],
      };
      preparationSamples.push(sample);
      const violation = scaleResourceViolation(sample);
      if (violation) throw Error('BLOCKED_BY_RUNNER: ' + violation);
    } catch (error) {
      preparationFailure ||= error;
      preparing?.kill();
    }
  };
  observePreparation();
  if (preparationFailure) throw preparationFailure;
  const timer = setInterval(observePreparation, 1000);
  try {
    preparing = start('python3', ['-B', 'tools/capacity/classroom-scale-release.py', 'prepare'], {
      env,
      timeoutMs: 30 * 60000,
    });
    const result = await preparing.done;
    if (preparationFailure) throw preparationFailure;
    if (result.code !== 0)
      throw Error('Canonical release verification failed, exit=' + result.code);
  } finally {
    clearInterval(timer);
    writeJson(resolve(output, 'preparation-resources.json'), preparationSamples);
  }
  const proof = assertOfficialScaleReleaseProof(readJson(resolve(output, 'releases.json')), env);
  const runtimeEnv = { ...env };
  delete runtimeEnv.GH_TOKEN;
  delete runtimeEnv.GITHUB_TOKEN;
  const baseline = await runVariant(runtimeEnv, 'baseline', proof.baseline, proof);
  const baselineLevel = baseline.summary.levels[0];
  if (
    baseline.summary.calibration.status !== 'VALID_FIXTURE' ||
    !['PASS', 'FAIL'].includes(baselineLevel.status) ||
    baseline.summary.observationErrors
  ) {
    writeJson(resolve(output, 'comparison.json'), {
      ...harness,
      baseline: baseline.summary,
      after: { status: 'NOT_RUN', reason: 'baseline_fixture_or_observation_unconfirmed' },
      comparable: false,
      absoluteCapacityEstablished: false,
    });
    process.exitCode = 2;
    return;
  }
  const after = await runVariant(runtimeEnv, 'after', proof.after, proof, baseline.runnerImageId);
  const afterLevel = after.summary.levels[0];
  const conditionsMatched =
    baseline.summary.environmentHash === after.summary.environmentHash &&
    baseline.runnerImageId === after.runnerImageId &&
    baseline.summary.profileHash === after.summary.profileHash &&
    baseline.summary.pgActivity?.policyHash === scaleHash(PG_ACTIVITY_POLICY) &&
    after.summary.pgActivity?.policyHash === scaleHash(PG_ACTIVITY_POLICY);
  const comparable =
    conditionsMatched &&
    after.summary.calibration.status === 'VALID_FIXTURE' &&
    ['PASS', 'FAIL'].includes(afterLevel.status) &&
    !after.summary.observationErrors &&
    Boolean(baselineLevel.http && afterLevel.http);
  writeJson(resolve(output, 'comparison.json'), {
    ...harness,
    scenario: OFFICIAL_SCALE_SCENARIO,
    pgActivityPolicy: PG_ACTIVITY_POLICY,
    releaseProofHash: scaleHash(proof),
    conditionsMatched,
    comparable,
    baseline: baseline.summary,
    after: after.summary,
    interpretation:
      'One sequential N30 pair with identical workload and measurement image. Preserve failed operations and raw receipts; no N60 or causal/statistical capacity claim.',
    absoluteCapacityEstablished: false,
  });
  if (!comparable) process.exitCode = 2;
}

async function runVariant(baseEnv, variant, release, proof, runnerImageId) {
  const env = {
    ...baseEnv,
    ASA_SCALE_OFFICIAL: 'true',
    ASA_SCALE_SHA: release.manifest.revision,
    ASA_SCALE_RELEASE_SHA: release.manifest.revision,
    ASA_SCALE_DEPLOYMENT_DIGEST: release.deploymentDigest,
    ASA_SCALE_VARIANT: variant,
    ASA_SCALE_RUN_TOKEN: randomBytes(16).toString('hex'),
    ASA_SCALE_PROFILE_HASH: SCALE_PROFILE_HASH,
  };
  const initialIdentity = assertScaleEnvironment(env);
  const head = release.manifest.revision;
  const reports = resolve(reportsRoot, env.GITHUB_RUN_ID + '-' + env.GITHUB_RUN_ATTEMPT, variant);
  if (existsSync(reports)) throw Error('Variant evidence already exists; no automatic reuse');
  if ((await capture('git', ['rev-parse', 'HEAD'])) !== env.ASA_SCALE_HARNESS_SHA)
    throw Error('Harness checkout changed after release verification');
  assertScaleDockerContext(JSON.parse(await capture('docker', ['context', 'inspect', 'default'])));
  await ensurePortFree(4612);
  await ensurePortFree(4611);
  await ensurePortFree(5432);
  const project =
    'asa-scale-' + initialIdentity.runId + '-' + initialIdentity.attempt + '-' + variant;
  if (
    await capture('docker', [
      'ps',
      '-aq',
      '--filter',
      'label=com.docker.compose.project=' + project,
    ])
  )
    throw Error('This run project already exists; no takeover or automatic reuse');
  for (const kind of ['volume', 'network'])
    if (
      await capture('docker', [
        kind,
        'ls',
        '-q',
        '--filter',
        'label=com.docker.compose.project=' + project,
      ])
    )
      throw Error(
        'This run already has Docker ' + kind + ' state; a fresh owned project is required',
      );
  Object.assign(env, {
    COMPOSE_PROJECT_NAME: project,
    COMPOSE_PARALLEL_LIMIT: '1',
    NX_SKIP_NX_CACHE: 'true',
    NX_DAEMON: 'false',
    ASA_BUILD_REVISION: head,
    ASA_IMAGE_TAG:
      'asa-scale-' + initialIdentity.runId + '-' + initialIdentity.attempt + '-harness',
    ASA_SCALE_REPORTS: reports,
    ASA_EXPECTED_SCHEMA_VERSION: String(release.manifest.schema),
    ASA_TEST_UID: String(process.getuid()),
    ASA_TEST_GID: String(process.getgid()),
    ASA_SCALE_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
    ASA_SCALE_APP_PASSWORD: randomBytes(24).toString('hex'),
    ASA_SCALE_SIGNING_KEY: randomBytes(32).toString('hex'),
    ASA_SCALE_STORAGE_KEY: randomBytes(12).toString('hex'),
    ASA_SCALE_STORAGE_SECRET: randomBytes(24).toString('hex'),
  });
  for (const [service, reference] of Object.entries(release.manifest.images))
    env['ASA_' + service.toUpperCase() + '_IMAGE'] = reference;
  const runnerReference = 'asa-lab-test:' + env.ASA_IMAGE_TAG;
  const fixtureImages = Object.fromEntries(release.images.map((image) => [image.service, image]));
  fixtureImages.migration = fixtureImages.api;
  fixtureImages['minio-init'] = fixtureImages.minio;
  fixtureImages.postgres = proof.postgres;
  for (const key of [
    'ASA_SCALE_ADMIN_PASSWORD',
    'ASA_SCALE_APP_PASSWORD',
    'ASA_SCALE_SIGNING_KEY',
    'ASA_SCALE_STORAGE_KEY',
    'ASA_SCALE_STORAGE_SECRET',
  ])
    redactions.add(env[key]);
  const composePrefix = [
    'compose',
    '--env-file',
    '/dev/null',
    ...composeFiles.flatMap((path) => ['-f', path]),
    '--profile',
    'test',
  ];
  const compose = (args) => checked('docker', [...composePrefix, ...args], { env });
  const composeCapture = (args) => capture('docker', [...composePrefix, ...args], { env });
  mkdirSync(reports, { recursive: true, mode: 0o777 });
  mkdirSync(resolve(reports, 'artifacts'), { recursive: true, mode: 0o777 });
  mkdirSync(resolve(root, '.asa/diagnostics/store'), { recursive: true });
  const composeVersion = await capture('docker', ['compose', 'version', '--short']);
  const config = JSON.parse(await composeCapture(['config', '--format', 'json']));
  assertScaleIngressConfig(
    config,
    (ingress) =>
      writeJson(resolve(reports, 'preflight-ingress.json'), {
        ...initialIdentity,
        stage: 'resolved-compose-ingress',
        composeVersion,
        ingress,
      }),
    true,
  );
  assertOfficialScaleCompose(config, release, {
    project,
    runToken: env.ASA_SCALE_RUN_TOKEN,
    runnerReference,
    reports,
    root,
  });
  const serviceNames = [
    'postgres',
    'minio',
    'minio-init',
    'migration',
    'api',
    'web',
    'scratch',
    'test-runner',
  ];
  for (const name of serviceNames) {
    const service = config.services[name];
    if (
      !service ||
      service.labels?.['io.asalab.scale.run'] !== env.ASA_SCALE_RUN_TOKEN ||
      service.network_mode === 'host'
    )
      throw Error('Missing run ownership or isolated network: ' + name);
  }
  const host = {
    platform: platform(),
    availableCpus: availableParallelism(),
    memoryBytes: totalmem(),
    cpuModel: cpus()[0]?.model,
    node: process.version,
    containerLimits: Object.fromEntries(
      serviceNames.map((name) => [name, config.services[name].mem_limit || 0]),
    ),
  };
  const apiEnvironment = config.services.api.environment;
  if (
    apiEnvironment.NODE_ENV !== 'test' ||
    Number(apiEnvironment.ASA_DB_POOL_MAX) !== SCALE_PROFILE.server.apiPoolMax ||
    Number(apiEnvironment.UV_THREADPOOL_SIZE) !== SCALE_PROFILE.server.uvThreadpoolSize
  )
    throw Error('Runtime configuration differs from the fixed server/ingress profile');
  const environmentHash = scaleHash(host);
  env.ASA_SCALE_ENVIRONMENT_HASH = environmentHash;
  writeJson(resolve(reports, 'plan.json'), {
    ...initialIdentity,
    environmentHash,
    host,
    profile: SCALE_PROFILE,
    composeFiles: composeFiles.map((path) => ({
      path,
      sha256: scaleHash(readFileSync(resolve(root, path), 'utf8')),
    })),
    release: { deploymentDigest: release.deploymentDigest, manifest: release.manifest },
    releaseProofHash: scaleHash(proof),
    scenario: OFFICIAL_SCALE_SCENARIO,
    hypothesis:
      'Compare the unchanged full N30 workload on two independently qualified official releases.',
  });
  let previousCpu = cpuTicks();
  let containerIds = [];
  let currentPhase = 'build';
  let driverName;
  let stoppedByResource;
  let observationErrors = 0;
  const allResources = [];
  const builder = project + '-builder';
  let builderCreated = false;
  let stackStarted = false;
  let identity;
  let summary;
  let cleanupFailure;
  let resourceInventory;
  let ownershipChecks = 0;
  let monitorPending;
  let monitorTimer;
  let currentAbortFile;
  let activeCommand;
  let activePgObserver;
  const pgObservationReceipts = [];
  let observationsPaused = false;
  let phaseStartedAtMs = Date.now();
  let failureDiagnostics;
  let diagnosticApiImage;
  let latestApiIdentity;
  let phaseApiIdentity;
  const diagnosticIo = {
    inspect: async (id, timeoutMs) =>
      JSON.parse(
        await capture('docker', ['inspect', id], {
          timeout: timeoutMs,
          killSignal: 'SIGKILL',
          maxBuffer: SCALE_FAILURE_DIAGNOSTIC_LIMITS.inspectBytes,
        }),
      )[0],
    logs: async (id, window, timeoutMs) => {
      try {
        const result = await execute(
          'docker',
          [
            'logs',
            '--timestamps',
            '--since',
            new Date(window.startedAtMs).toISOString(),
            '--until',
            new Date(window.endedAtMs).toISOString(),
            '--tail',
            String(SCALE_FAILURE_DIAGNOSTIC_LIMITS.lines),
            id,
          ],
          {
            cwd: root,
            timeout: timeoutMs,
            killSignal: 'SIGKILL',
            maxBuffer: SCALE_FAILURE_DIAGNOSTIC_LIMITS.streamBytes,
            encoding: 'utf8',
          },
        );
        return { stdout: result.stdout, stderr: result.stderr, transport: 'completed' };
      } catch (error) {
        // Partial buffers can contain useful JSON, but arbitrary CLI messages
        // and raw logs must never enter an artifact or the workflow console.
        return {
          stdout: typeof error?.stdout === 'string' ? error.stdout : '',
          stderr: typeof error?.stderr === 'string' ? error.stderr : '',
          transport:
            error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
              ? 'truncated'
              : error?.killed
                ? 'timeout'
                : 'failed',
          error: scaleFailureDiagnosticError(error),
        };
      }
    },
  };
  const ownMetadata = (metadata) =>
    assertOfficialScaleOwnedContainer(metadata, {
      project,
      root,
      runToken: env.ASA_SCALE_RUN_TOKEN,
      configFiles: composeFiles.map((path) => resolve(root, path)).join(','),
      images: fixtureImages,
    });
  const refreshContainers = async () => {
    const ids = (
      await capture('docker', [
        'ps',
        '-aq',
        '--filter',
        'label=com.docker.compose.project=' + project,
      ])
    )
      .split(/\s+/)
      .filter(Boolean);
    const metadata = ids.length ? JSON.parse(await capture('docker', ['inspect', ...ids])) : [];
    containerIds = metadata.map((value) => ({
      id: ownMetadata(value).Id,
      service: value.Config.Labels['com.docker.compose.service'],
    }));
  };
  const attestOwnedResources = async (
    completeNetworks = Boolean(resourceInventory?.completeNetworks),
  ) => {
    const path = resolve(
      reports,
      'ownership',
      String(++ownershipChecks).padStart(2, '0') + '.json',
    );
    try {
      await refreshContainers();
      const context = { project, runToken: env.ASA_SCALE_RUN_TOKEN, config, completeNetworks };
      const resources = [];
      for (const kind of ['volume', 'network']) {
        const references = (await capture('docker', officialScaleResourceListArgs(kind, project)))
          .split(/\s+/)
          .filter(Boolean);
        for (const reference of references) {
          const records = JSON.parse(await capture('docker', [kind, 'inspect', reference]));
          resources.push(assertOfficialScaleOwnedResource(kind, reference, records, context));
        }
      }
      const inventory = assertOfficialScaleResourceInventory(resources, resourceInventory, context);
      resourceInventory ||= inventory;
      writeJson(path, { ...initialIdentity, phase: currentPhase, status: 'PASS', inventory });
    } catch (error) {
      writeJson(path, {
        ...initialIdentity,
        phase: currentPhase,
        status: 'FAIL',
        reason: safeError(error),
        previousInventory: resourceInventory || null,
      });
      throw error;
    }
  };
  const sampleOnce = async () => {
    if (allResources.at(-1)?.atMs === Date.now()) return allResources.at(-1);
    const memory = readScaleMemInfo(readFileSync('/proc/meminfo', 'utf8'));
    const filesystem = statfsSync(root);
    const currentCpu = cpuTicks();
    const elapsedCpu = currentCpu.total - previousCpu.total;
    const hostBusyPercent =
      elapsedCpu > 0 ? 100 * (1 - (currentCpu.idle - previousCpu.idle) / elapsedCpu) : 0;
    previousCpu = currentCpu;
    const containers = await Promise.all(
      containerIds.map(async ({ id, service }) => {
        const metadata = ownMetadata(await dockerApi('/containers/' + id + '/json'));
        if (service === 'api')
          latestApiIdentity = {
            id: metadata.Id,
            image: metadata.Image,
            startedAt: metadata.State.StartedAt,
            restartCount: metadata.RestartCount,
          };
        if (!metadata.State.Running)
          return {
            service,
            id,
            running: false,
            memoryBytes: 0,
            memoryLimitBytes: metadata.HostConfig.Memory,
            oomKills: Number(metadata.State.OOMKilled),
            restarts: metadata.RestartCount,
            cpuPercent: 0,
            pids: 0,
          };
        const stats = await dockerApi('/containers/' + id + '/stats?stream=false&one-shot=true');
        const cpuDelta =
          stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
        const systemDelta =
          stats.cpu_stats.system_cpu_usage - (stats.precpu_stats?.system_cpu_usage || 0);
        return {
          service,
          id,
          running: true,
          memoryBytes: stats.memory_stats.usage || 0,
          memoryLimitBytes: metadata.HostConfig.Memory || stats.memory_stats.limit,
          inactiveFileBytes:
            stats.memory_stats.stats?.inactive_file ||
            stats.memory_stats.stats?.total_inactive_file ||
            0,
          oomKills: Number(metadata.State.OOMKilled),
          restarts: metadata.RestartCount,
          cpuPercent:
            systemDelta > 0
              ? ((100 * cpuDelta) / systemDelta) *
                (stats.cpu_stats.online_cpus || availableParallelism())
              : 0,
          pids: stats.pids_stats?.current || 0,
        };
      }),
    );
    const value = {
      atMs: Date.now(),
      phase: currentPhase,
      ...memory,
      diskFreeBytes: filesystem.bavail * filesystem.bsize,
      hostBusyPercent,
      containers,
    };
    allResources.push(value);
    const violation = scaleResourceViolation(value);
    if (violation && !stoppedByResource) {
      stoppedByResource = { reason: violation, atMs: value.atMs, phase: currentPhase };
      writeJson(resolve(reports, 'resource-stop.json'), stoppedByResource);
      if (currentAbortFile) writeJson(currentAbortFile, stoppedByResource);
      activeCommand?.kill();
      if (driverName) {
        const metadata = ownMetadata(
          JSON.parse(await capture('docker', ['inspect', driverName]))[0],
        );
        if (metadata.State.Running) await checked('docker', ['stop', '--time', '15', metadata.Id]);
      }
      if (builderCreated && currentPhase === 'build')
        await checked('docker', ['buildx', 'stop', builder]);
    }
    return value;
  };
  const sample = () => {
    if (!monitorPending)
      monitorPending = sampleOnce()
        .catch((error) => {
          observationErrors++;
          throw error;
        })
        .finally(() => {
          monitorPending = undefined;
        });
    return monitorPending;
  };
  const tick = () => {
    if (!observationsPaused) void sample().catch(() => undefined);
  };
  const requireResources = async () => {
    await sample();
    if (observationErrors) throw Error('Resource observer failed');
    if (stoppedByResource) throw Error('BLOCKED_BY_RUNNER: ' + stoppedByResource.reason);
  };
  const monitored = async (command, args, options = {}) => {
    await requireResources();
    const running = start(command, args, { env, ...options });
    activeCommand = running;
    const result = await running.done;
    activeCommand = undefined;
    if (stoppedByResource) throw Error('BLOCKED_BY_RUNNER: ' + stoppedByResource.reason);
    if (result.code !== 0)
      throw Error(command + ' exited ' + result.code + ', signal=' + result.signal);
  };

  try {
    await requireResources();
    monitorTimer = setInterval(tick, 1000);
    if (variant === 'baseline') {
      writeFileSync(resolve(reports, 'buildkit.toml'), '[worker.oci]\n  max-parallelism = 1\n');
      await checked('docker', [
        'buildx',
        'create',
        '--name',
        builder,
        '--driver',
        'docker-container',
        '--driver-opt',
        'memory=8g',
        '--driver-opt',
        'memory-swap=8g',
        '--driver-opt',
        'cpu-quota=300000',
        '--buildkitd-config',
        resolve(reports, 'buildkit.toml'),
      ]);
      builderCreated = true;
      // Only the measurement image is source-built. Dockerfile.api's test target
      // internally runs pnpm build; those bundles never serve application traffic.
      await monitored(
        'docker',
        [
          ...composePrefix,
          'build',
          '--builder',
          builder,
          '--build-arg',
          'NODE_IMAGE=mirror.gcr.io/library/node@sha256:43aeff40f4afc22e83f7589a2f37e111cff5ca84529571f1c8415bcc5fcc21b2',
          '--build-arg',
          'BUILDKIT_SYNTAX=mirror.gcr.io/docker/dockerfile@sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720',
          'test-runner',
        ],
        { timeoutMs: 30 * 60000 },
      );
      await checked('docker', ['buildx', 'stop', builder]);
    }
    const runnerImage = JSON.parse(
      await capture('docker', ['image', 'inspect', runnerReference]),
    )[0];
    runnerImageId = assertOfficialScaleRunner(
      runnerImage,
      runnerReference,
      env.ASA_SCALE_HARNESS_SHA,
      runnerImageId,
    );
    fixtureImages['test-runner'] = { id: runnerImageId, reference: runnerReference };
    const postgresImage = JSON.parse(
      await capture('docker', ['image', 'inspect', OFFICIAL_SCALE_POSTGRES]),
    )[0];
    if (
      postgresImage.Id !== proof.postgres?.id ||
      postgresImage.Os !== 'linux' ||
      postgresImage.Architecture !== 'amd64' ||
      !postgresImage.RepoDigests?.includes(OFFICIAL_SCALE_POSTGRES)
    )
      throw Error('The pinned shared PostgreSQL engine changed');
    for (const expected of release.images)
      assertOfficialScaleImage(
        JSON.parse(await capture('docker', ['image', 'inspect', expected.reference]))[0],
        expected,
      );
    writeJson(resolve(reports, 'harness-image.json'), {
      harnessSha: env.ASA_SCALE_HARNESS_SHA,
      id: runnerImageId,
      reference: runnerReference,
      scenario: OFFICIAL_SCALE_SCENARIO,
    });
    currentPhase = 'stack-startup';
    stackStarted = true;
    await compose([
      'up',
      '--no-build',
      '--pull',
      'never',
      '-d',
      '--wait',
      '--wait-timeout',
      '180',
      '--no-deps',
      'postgres',
      'minio',
    ]);
    await compose(['run', '--rm', '--no-deps', '--pull', 'never', 'minio-init']);
    await compose(['run', '--rm', '--no-deps', '--pull', 'never', 'migration']);
    const databaseSettings = JSON.parse(
      await composeCapture([
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'postgres',
        '-d',
        'asalab_test',
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        "SELECT json_build_object('database',current_database(),'version',current_setting('server_version'),'maxConnections',current_setting('max_connections')::int,'sharedBuffers',current_setting('shared_buffers'),'workMem',current_setting('work_mem'),'runtimeRole',(SELECT json_build_object('name',rolname,'superuser',rolsuper,'bypassRls',rolbypassrls,'connectionLimit',rolconnlimit) FROM pg_roles WHERE rolname='asalab_app'))",
      ]),
    );
    if (
      databaseSettings.database !== 'asalab_test' ||
      databaseSettings.runtimeRole?.name !== 'asalab_app' ||
      databaseSettings.runtimeRole.superuser !== false ||
      databaseSettings.runtimeRole.bypassRls !== false
    )
      throw Error('The runtime database role must retain normal RLS/session authorization');
    writeJson(resolve(reports, 'runtime-profile.json'), {
      ...initialIdentity,
      environmentHash,
      ingress: SCALE_PROFILE.ingress,
      server: SCALE_PROFILE.server,
      postgres: databaseSettings,
      api: Object.fromEntries(
        [
          'NODE_ENV',
          'UV_THREADPOOL_SIZE',
          'ASA_DB_POOL_MAX',
          'ASA_DB_CONNECTION_TIMEOUT_MS',
          'ASA_DB_IDLE_TIMEOUT_MS',
          'ASA_DB_STATEMENT_TIMEOUT_MS',
          'ASA_DB_QUERY_TIMEOUT_MS',
        ].map((key) => [key, apiEnvironment[key]]),
      ),
      containerLimits: host.containerLimits,
    });
    await compose([
      'up',
      '--no-build',
      '--pull',
      'never',
      '-d',
      '--wait',
      '--wait-timeout',
      '240',
      '--no-deps',
      'scratch',
      'api',
      'web',
    ]);
    await refreshContainers();
    const images = [];
    for (const service of ['api', 'web', 'scratch']) {
      const container = containerIds.find((value) => value.service === service);
      if (!container) throw Error('Missing running service: ' + service);
      const metadata = ownMetadata(
        JSON.parse(await capture('docker', ['inspect', container.id]))[0],
      );
      if (service === 'api') {
        const proof = {
          nonce: randomBytes(16).toString('hex'),
          requestedAtMs: Date.now(),
          completedAtMs: 0,
          result: null,
          after: null,
          transport: 'exec_failed',
        };
        try {
          const output = await capture(
            'docker',
            [
              'exec',
              container.id,
              'node',
              '-e',
              SCALE_API_ENV_PROBE_SCRIPT,
              container.id,
              proof.nonce,
            ],
            { timeout: 5000, maxBuffer: 16384 },
          );
          proof.completedAtMs = Date.now();
          proof.transport = 'parse_failed';
          proof.result = JSON.parse(output);
          proof.transport = 'inspect_failed';
          proof.after = ownMetadata(
            JSON.parse(await capture('docker', ['inspect', container.id], { timeout: 5000 }))[0],
          );
          proof.transport = 'completed';
        } catch (error) {
          proof.completedAtMs ||= Date.now();
          // The fixed native program emits only its bounded public error code.
          // Never persist arbitrary Docker stderr or a full environment.
          if (
            proof.transport === 'exec_failed' &&
            typeof error?.stdout === 'string' &&
            error.stdout.length <= 16384
          ) {
            try {
              proof.result = JSON.parse(error.stdout);
            } catch {
              /* Malformed output remains a failure. */
            }
          }
        }
        assertScaleApiIngressEnvironment(metadata, proof, (ingress) =>
          writeJson(resolve(reports, 'runtime-api-ingress.json'), {
            ...initialIdentity,
            stage: 'owned-api-before-calibration',
            ingress,
          }),
        );
      }
      const image = JSON.parse(await capture('docker', ['image', 'inspect', metadata.Image]))[0];
      images.push({
        service,
        id: image.Id,
        revision: image.Config.Labels?.['org.opencontainers.image.revision'] || '',
        reference: release.manifest.images[service],
        platform: image.Os + '/' + image.Architecture,
      });
    }
    const imageManifestHash = assertScaleImages(images, head);
    diagnosticApiImage = images.find((image) => image.service === 'api').id;
    env.ASA_SCALE_IMAGE_MANIFEST_HASH = imageManifestHash;
    identity = { ...initialIdentity, environmentHash, imageManifestHash };
    const attestRuntime = async () => {
      await refreshContainers();
      const api = containerIds.find((container) => container.service === 'api');
      if (!api) throw Error('Missing owned API for runtime attestation');
      const actual = JSON.parse(
        await capture('docker', [
          'exec',
          api.id,
          'node',
          '-e',
          "(async()=>{const paths=['/health/ready','/build-metadata.json','/internal/blocks/asa-commit.txt'];const values=[];for(const path of paths){const r=await fetch('http://web:8080'+path,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('runtime_attestation_http');values.push(path.endsWith('.txt')?(await r.text()).trim():await r.json());}console.log(JSON.stringify(values));})().catch(()=>process.exit(1));",
        ]),
      );
      return assertOfficialScaleRuntime(actual[0], actual[1], actual[2], release.manifest);
    };
    writeJson(resolve(reports, 'runtime-release.json'), {
      ...identity,
      deploymentDigest: release.deploymentDigest,
      actual: await attestRuntime(),
    });
    const assets = [];
    for (const service of ['web', 'scratch']) {
      const container = containerIds.find((value) => value.service === service);
      const directory = service === 'web' ? '/srv' : '/usr/share/nginx/html';
      const hashes = await capture('docker', [
        'exec',
        container.id,
        'find',
        directory,
        '-type',
        'f',
        '-name',
        '*.js',
        '-exec',
        'sha256sum',
        '{}',
        '+',
      ]);
      const sizes = await capture('docker', [
        'exec',
        container.id,
        'find',
        directory,
        '-type',
        'f',
        '-name',
        '*.js',
        '-exec',
        'wc',
        '-c',
        '{}',
        '+',
      ]);
      const bytes = new Map(
        sizes
          .split('\n')
          .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
          .filter(Boolean)
          .map((match) => [match[2], Number(match[1])]),
      );
      for (const line of hashes.split('\n')) {
        const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
        if (!match || !match[2].startsWith(directory + '/') || !bytes.get(match[2]))
          throw Error('Invalid image asset evidence');
        assets.push({
          service,
          path:
            (service === 'scratch' ? '/internal/blocks' : '') + match[2].slice(directory.length),
          expectedHash: match[1],
          bytes: bytes.get(match[2]),
        });
      }
    }
    if (!assets.length || assets.length > 2000) throw Error('Unbounded or missing image assets');
    writeJson(resolve(reports, 'image-manifest.json'), { ...identity, images, assets });
    await attestOwnedResources(true);
    await requireResources();

    const pgObserverOptions = (directory, startedAtMs) => {
      const api = containerIds.find((container) => container.service === 'api');
      const postgres = containerIds.find((container) => container.service === 'postgres');
      if (!api || !postgres) throw Error('PG_ACTIVITY_OWNED_SERVICES_MISSING');
      return {
        directory,
        startedAtMs,
        releaseSha: head,
        apiId: api.id,
        postgresId: postgres.id,
        expected: {
          project,
          root,
          runToken: env.ASA_SCALE_RUN_TOKEN,
          configFiles: composeFiles.map((path) => resolve(root, path)).join(','),
          images: fixtureImages,
        },
      };
    };
    const pgSmoke = await qualifyPgActivityNative(pgObserverOptions(reports, Date.now()));
    if (pgSmoke.status !== 'PASS') {
      observationErrors++;
      throw Error('PG_ACTIVITY_NATIVE_SMOKE_' + pgSmoke.code);
    }

    const runBrowserLevel = async (users, mode = 'capacity') => {
      if (observationErrors) throw Error('PG_ACTIVITY_PRIOR_OBSERVATION_FAILURE');
      const invocation = officialScaleBrowserInvocation(config, { reports, users, mode });
      currentPhase = invocation.phase;
      phaseStartedAtMs = Date.now();
      const directory = resolve(reports, currentPhase);
      mkdirSync(directory, { recursive: true, mode: 0o777 });
      writeJson(resolve(directory, 'browser-command.json'), {
        ...identity,
        users,
        mode,
        ...invocation,
      });
      currentAbortFile = resolve(directory, 'abort.json');
      const sampleIndex = allResources.length;
      await sample();
      phaseApiIdentity = latestApiIdentity;
      let pgActivityFailure;
      if (!stoppedByResource) {
        // The phase watcher and its single local PostgreSQL connection are
        // ready before the browser workload writes its first progress signal.
        await attestRuntime();
        await attestOwnedResources(true);
        activePgObserver = await startPgActivityObserver(
          pgObserverOptions(directory, phaseStartedAtMs),
          (code) => {
            if (pgActivityFailure) return;
            pgActivityFailure = code;
            observationErrors++;
            writeJson(currentAbortFile, {
              reason: 'pg_activity_observer_failure',
              code,
              atMs: Date.now(),
              classification: 'observation_error',
            });
          },
        );
        await attestOwnedResources(true);
        if (pgActivityFailure) throw Error('PG_ACTIVITY_' + pgActivityFailure);
        await requireResources();
        driverName = project + '-browser-' + mode + '-' + users;
        const running = start(
          'docker',
          [
            ...composePrefix,
            'run',
            '--pull',
            'never',
            '--name',
            driverName,
            '--no-deps',
            '-e',
            'ASA_SCALE_USERS=' + users,
            '-e',
            'ASA_SCALE_MODE=' + mode,
            '-e',
            'ASA_SCALE_IMAGE_MANIFEST_HASH=' + imageManifestHash,
            '-e',
            'ASA_SCALE_ENVIRONMENT_HASH=' + environmentHash,
            'test-runner',
            ...invocation.command,
          ],
          { env },
        );
        activeCommand = running;
        let done = false;
        const completion = running.done.finally(() => {
          done = true;
        });
        const deadline = Date.now() + SCALE_PROFILE.levelTimeoutMs;
        while (!done && Date.now() < deadline) {
          await delay(1000);
          if (pgActivityFailure) {
            const metadata = ownMetadata(
              JSON.parse(await capture('docker', ['inspect', driverName]))[0],
            );
            if (metadata.State.Running)
              await checked('docker', ['stop', '--time', '15', metadata.Id]);
            await completion;
            break;
          }
          if (!done) await refreshContainers();
        }
        if (!done) {
          writeJson(currentAbortFile, { reason: 'level_deadline', atMs: Date.now() });
          const metadata = ownMetadata(
            JSON.parse(await capture('docker', ['inspect', driverName]))[0],
          );
          await checked('docker', ['stop', '--time', '15', metadata.Id]);
        }
        const result = await completion;
        activeCommand = undefined;
        writeJson(resolve(directory, 'process.json'), result);
        await refreshContainers();
        await sample();
      }
      if (activePgObserver) {
        const activity = await activePgObserver.finish();
        pgObservationReceipts.push({
          phase: currentPhase,
          status: activity.status,
          samples: activity.samples.length,
          code: activity.code || null,
          closure: activity.closure.status,
        });
        activePgObserver = undefined;
      }
      const rawPath = resolve(directory, 'raw.json');
      let raw;
      if (existsSync(rawPath)) raw = readJson(rawPath);
      else {
        const operations = createScaleLedger(users, mode === 'calibration');
        const partial = resolve(directory, 'operations.jsonl');
        if (existsSync(partial))
          for (const line of readFileSync(partial, 'utf8').split('\n').filter(Boolean)) {
            try {
              const item = JSON.parse(line).operation;
              const index = operations.findIndex((operation) => operation.id === item?.id);
              if (index >= 0) operations[index] = item;
            } catch {
              observationErrors++;
            }
          }
        raw = {
          ...identity,
          users,
          mode,
          operations,
          runnerBlocked: Boolean(stoppedByResource),
          integrityFailures: [],
          incompleteDriverReport: true,
        };
        writeJson(resolve(directory, 'incomplete-operations.json'), raw);
      }
      const resources = allResources.slice(sampleIndex);
      writeJson(resolve(directory, 'resources.json'), resources);
      let receipt =
        mode === 'calibration'
          ? evaluateScaleCalibration(raw, identity, resources)
          : evaluateScaleLevel(raw, identity, resources);
      const successful = () => ['PASS', 'VALID_FIXTURE'].includes(receipt.status);
      if (observationErrors && successful())
        receipt = {
          ...receipt,
          status: mode === 'calibration' ? 'INVALID_FIXTURE' : 'INVALID',
          reasons: [pgActivityFailure ? 'pg_activity_observer_errors' : 'resource_observer_errors'],
        };
      const processResult = existsSync(resolve(directory, 'process.json'))
        ? readJson(resolve(directory, 'process.json'))
        : null;
      if (processResult && processResult.code !== 0 && successful())
        receipt = {
          ...receipt,
          status: mode === 'calibration' ? 'INVALID_FIXTURE' : 'INVALID',
          reasons: ['nonzero_browser_exit_despite_pass_report'],
        };
      if (!successful())
        failureDiagnostics = {
          phase: currentPhase,
          api: phaseApiIdentity,
          startedAtMs: phaseStartedAtMs,
          endedAtMs: Date.now(),
          expectedApi5xx:
            Array.isArray(raw.requests) && Array.isArray(raw.observerRequests)
              ? [...raw.requests, ...raw.observerRequests].filter(
                  (item) =>
                    typeof item?.route === 'string' &&
                    item.route.startsWith('/api/') &&
                    Number.isInteger(item.status) &&
                    item.status >= 500 &&
                    item.status <= 599 &&
                    item.injected === false,
                ).length
              : null,
        };
      if (driverName) {
        const metadata = ownMetadata(
          JSON.parse(await capture('docker', ['inspect', driverName]))[0],
        );
        const web = containerIds.find((container) => container.service === 'web');
        if (!web) throw Error('Missing owned Web namespace');
        const webMetadata = ownMetadata(
          JSON.parse(await capture('docker', ['inspect', web.id]))[0],
        );
        const network = assertScaleDriverNetwork(metadata, webMetadata);
        writeJson(resolve(directory, 'container-exit.json'), {
          id: metadata.Id,
          exitCode: metadata.State.ExitCode,
          oomKilled: metadata.State.OOMKilled,
          restartCount: metadata.RestartCount,
          image: metadata.Image,
          network,
        });
        observationsPaused = true;
        await monitorPending;
        try {
          await checked('docker', ['rm', metadata.Id]);
          driverName = undefined;
          await refreshContainers();
        } finally {
          observationsPaused = false;
        }
      }
      currentAbortFile = undefined;
      return receipt;
    };
    summary = await runOfficialScaleN30(identity, runBrowserLevel, async (receipt, phase) => {
      writeJson(resolve(reports, phase, 'receipt.json'), receipt);
      console.log(
        '[classroom-official-n30]',
        variant,
        phase,
        receipt.status,
        receipt.reasons.join(', '),
      );
      // Preserve the actual phase result even when its subsequent ownership check fails.
      await attestOwnedResources();
    });
    summary.host = host;
    summary.observationErrors = observationErrors;
    summary.pgActivity = {
      policyHash: scaleHash(PG_ACTIVITY_POLICY),
      nativeSmoke: pgSmoke.status,
      levels: pgObservationReceipts,
      extraConnectionRetainedInRawAggregates: true,
    };
    summary.harnessImageId = runnerImageId;
    summary.postRunRuntime = await attestRuntime();
    await attestOwnedResources();
    writeJson(resolve(reports, 'summary.json'), summary);
    if (summary.levels[0].status !== 'PASS') process.exitCode = 2;
  } catch (error) {
    process.exitCode = 2;
    if (!failureDiagnostics && /^(?:calibration|level-30)$/.test(currentPhase))
      failureDiagnostics = {
        phase: currentPhase,
        api: phaseApiIdentity,
        startedAtMs: phaseStartedAtMs,
        endedAtMs: Date.now(),
        expectedApi5xx: null,
      };
    writeJson(resolve(reports, 'controller-failure.json'), {
      ...(identity || initialIdentity),
      phase: currentPhase,
      status: stoppedByResource ? 'BLOCKED_BY_RUNNER' : 'INVALID',
      reason: stoppedByResource?.reason || safeError(error),
      observationErrors,
    });
    if (identity && !summary)
      writeJson(resolve(reports, 'summary.json'), {
        ...identity,
        host,
        levels: [{ users: 30, status: 'NOT_RUN' }],
        absoluteCapacityEstablished: false,
        controllerStatus: stoppedByResource ? 'BLOCKED_BY_RUNNER' : 'INVALID',
        stoppedAt: currentPhase,
      });
    throw error;
  } finally {
    if (activePgObserver) {
      try {
        await activePgObserver.finish();
      } catch (error) {
        observationErrors++;
        process.exitCode = 2;
        console.error('[classroom-scale] PG_ACTIVITY_' + pgActivityError(error));
      }
      activePgObserver = undefined;
    }
    if (monitorTimer) clearInterval(monitorTimer);
    await monitorPending?.catch(() => undefined);
    writeJson(resolve(reports, 'resource-observations.json'), {
      samples: allResources,
      observationErrors,
    });
    if (stackStarted) {
      if (failureDiagnostics) {
        // The workload and its resource samples are already sealed. Capture
        // our phase's exact API before refreshing the cleanup inventory. A
        // missing/replaced container still gets a bounded error receipt.
        try {
          const api = failureDiagnostics.api;
          const diagnostic =
            api && identity && diagnosticApiImage
              ? await captureScaleFailureDiagnostics(
                  {
                    ...failureDiagnostics,
                    container: {
                      id: api.id,
                      image: diagnosticApiImage,
                      startedAt: failureDiagnostics.api.startedAt,
                      restartCount: failureDiagnostics.api.restartCount,
                      sourceSha: head,
                      project,
                      root,
                      runToken: env.ASA_SCALE_RUN_TOKEN,
                    },
                  },
                  diagnosticIo,
                  [...redactions],
                )
              : {
                  schemaVersion: 1,
                  collector: 'owned-api-failure-only-v1',
                  status: 'UNAVAILABLE',
                  reason: api ? 'image_identity_not_verified' : 'owned_api_not_available',
                  serverErrors: [],
                  requestEvents: [],
                  poolErrors: [],
                };
          writeJson(resolve(reports, failureDiagnostics.phase, 'server-diagnostics.json'), {
            ...initialIdentity,
            ...diagnostic,
          });
        } catch (error) {
          process.exitCode = 2;
          console.error(
            '[classroom-scale] failure diagnostics could not be persisted: ' +
              scaleFailureDiagnosticError(error).code,
          );
        }
      }
      try {
        await attestOwnedResources();
        writeJson(resolve(reports, 'owned-containers.json'), containerIds);
        for (const container of containerIds.filter((item) => item.service === 'test-runner')) {
          const owned = ownMetadata(
            JSON.parse(await capture('docker', ['inspect', container.id]))[0],
          );
          if (owned.State.Running) await checked('docker', ['stop', '--time', '15', owned.Id]);
          await checked('docker', ['rm', owned.Id]);
        }
        await compose(['down']); // Retain fixture data: no volume deletion or prune.
        await refreshContainers();
        const remainingNetworks = await capture(
          'docker',
          officialScaleResourceListArgs('network', project),
        );
        if (containerIds.length || remainingNetworks) {
          cleanupFailure = Error('Owned containers or networks remain after cleanup');
          process.exitCode = 2;
          writeJson(resolve(reports, 'cleanup-failure.json'), { reason: cleanupFailure.message });
        } else
          writeJson(resolve(reports, 'cleanup.json'), {
            status: 'PASS',
            project,
            volumesRetained: true,
          });
      } catch (error) {
        process.exitCode = 2;
        writeJson(resolve(reports, 'cleanup-failure.json'), { reason: safeError(error) });
        cleanupFailure ||= error;
      }
    }
    if (builderCreated) {
      try {
        await checked('docker', ['buildx', 'rm', builder]);
      } catch (error) {
        process.exitCode = 2;
        writeJson(resolve(reports, 'builder-cleanup-failure.json'), { reason: safeError(error) });
        cleanupFailure ||= error;
      }
    }
  }
  if (cleanupFailure) throw cleanupFailure;
  return { summary, runnerImageId };
}

const mode = process.argv[2];
try {
  if (mode === 'check') await check();
  else if (mode === 'run') await run();
  else throw Error('Use check for focused local checks, or run only in isolated hosted GitHub CI');
} catch (error) {
  console.error('[classroom-scale]', safeError(error));
  process.exitCode = process.exitCode || 1;
}
