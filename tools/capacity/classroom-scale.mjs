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
  SCALE_LEVELS,
  SCALE_PROFILE,
  SCALE_PROFILE_HASH,
  assertScaleDockerContext,
  assertScaleEnvironment,
  assertScaleImages,
  assertScaleIngressConfig,
  assertScaleApiIngressEnvironment,
  assertScaleDriverNetwork,
  createScaleLedger,
  evaluateScaleLevel,
  readScaleMemInfo,
  runScaleLadder,
  scaleHash,
  scaleResourceViolation,
  evaluateScaleCalibration,
  scaleLadderSummary,
  summarizeLatencyTimings,
} from './classroom-scale-contracts.mjs';
import {
  STORM_BASELINE,
  STORM_ORIGIN,
  assertStormClientProvenance,
} from './request-storm-contracts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const reports = resolve(root, 'reports/classroom-scale');
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
  '.github/workflows/classroom-scale.yml',
  '.github/compose.classroom-scale.yml',
  'docs/testing/CLASSROOM_REQUEST_STORM.md',
  'tests/capacity/request-storm.pg.spec.ts',
  'tests/capacity/request-storm-client.tsx',
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
    '--maxWorkers=1',
  ]);
  await checked('corepack', [
    'pnpm',
    'exec',
    'tsc',
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--esModuleInterop',
    '--module',
    'esnext',
    '--moduleResolution',
    'bundler',
    '--target',
    'es2022',
    '--lib',
    'es2022,dom,dom.iterable',
    '--jsx',
    'react-jsx',
    '--allowJs',
    '--checkJs',
    'false',
    '--types',
    'node',
    '--noUnusedLocals',
    '--noUnusedParameters',
    'apps/web/src/build-metadata.d.ts',
    'e2e/classroom-scale.spec.ts',
    'tests/capacity/classroom-scale.spec.ts',
    'tests/capacity/request-storm-client.tsx',
    'tests/capacity/request-storm.pg.spec.ts',
  ]);
  await checked('corepack', [
    'pnpm',
    'exec',
    'eslint',
    ...plannedFiles.filter((path) => /\.(mjs|tsx?)$/.test(path)),
  ]);
  await checked('corepack', ['pnpm', 'exec', 'prettier', '--check', ...plannedFiles]);
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
    ASA_SCALE_PROFILE_HASH: SCALE_PROFILE_HASH,
  };
  const initialIdentity = assertScaleEnvironment(env);
  if (platform() !== 'linux' || /DESKTOP-R0HSMSA|D2-R2/i.test(hostname()))
    throw Error('Only isolated hosted Linux CI is allowed');
  const head = await capture('git', ['rev-parse', 'HEAD']);
  if (
    head !== initialIdentity.sourceSha ||
    (await capture('git', ['status', '--porcelain', '--untracked-files=no']))
  )
    throw Error('The capacity source must be the clean exact selected checkout');
  assertScaleDockerContext(JSON.parse(await capture('docker', ['context', 'inspect', 'default'])));
  await ensurePortFree(4612);
  await ensurePortFree(4611);
  await ensurePortFree(5432);
  const project = 'asa-scale-' + initialIdentity.runId + '-' + initialIdentity.attempt;
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
    ASA_IMAGE_TAG: project,
    ASA_TEST_UID: String(process.getuid()),
    ASA_TEST_GID: String(process.getgid()),
    ASA_SCALE_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
    ASA_SCALE_APP_PASSWORD: randomBytes(24).toString('hex'),
    ASA_SCALE_SIGNING_KEY: randomBytes(32).toString('hex'),
    ASA_SCALE_STORAGE_KEY: randomBytes(12).toString('hex'),
    ASA_SCALE_STORAGE_SECRET: randomBytes(24).toString('hex'),
  });
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
    ...composeFiles.flatMap((path) => ['-f', path]),
    '--profile',
    'test',
  ];
  const compose = (args) => checked('docker', [...composePrefix, ...args], { env });
  const composeCapture = (args) => capture('docker', [...composePrefix, ...args], { env });
  mkdirSync(reports, { recursive: true, mode: 0o777 });
  mkdirSync(resolve(root, 'e2e/artifacts'), { recursive: true, mode: 0o777 });
  mkdirSync(resolve(root, '.asa/diagnostics/store'), { recursive: true });
  const composeVersion = await capture('docker', ['compose', 'version', '--short']);
  const config = JSON.parse(await composeCapture(['config', '--format', 'json']));
  assertScaleIngressConfig(config, (ingress) =>
    writeJson(resolve(reports, 'preflight-ingress.json'), {
      ...initialIdentity,
      stage: 'resolved-compose-ingress',
      composeVersion,
      ingress,
    }),
  );
  if (
    Object.values(config.volumes || {}).some((volume) => volume.external) ||
    Object.values(config.networks || {}).some((network) => network.external)
  )
    throw Error('External Docker resources are forbidden');
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
    hypothesis:
      'Separate candidate/order/browser/upstream timing before attributing higher login/save p95 to product code.',
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
  let monitorPending;
  let monitorTimer;
  let currentAbortFile;
  let activeCommand;
  let observationsPaused = false;
  const ownMetadata = (metadata) => {
    if (
      metadata.Config?.Labels?.['com.docker.compose.project'] !== project ||
      metadata.Config?.Labels?.['io.asalab.scale.run'] !== env.ASA_SCALE_RUN_TOKEN ||
      metadata.Config?.Labels?.['com.docker.compose.project.working_dir'] !== root
    )
      throw Error('Refusing a foreign Docker resource');
    return metadata;
  };
  const refreshContainers = async () => {
    const ids = (await composeCapture(['ps', '--all', '--quiet'])).split(/\s+/).filter(Boolean);
    const metadata = ids.length ? JSON.parse(await capture('docker', ['inspect', ...ids])) : [];
    containerIds = metadata.map((value) => ({
      id: ownMetadata(value).Id,
      service: value.Config.Labels['com.docker.compose.service'],
    }));
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
    const buildDeadline = Date.now() + 30 * 60000;
    for (const service of ['api', 'web', 'scratch', 'minio', 'test-runner']) {
      if (Date.now() >= buildDeadline)
        throw Error('Build exceeded the fixed30-minute runner budget');
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
          'CADDY_IMAGE=mirror.gcr.io/library/caddy@sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83',
          '--build-arg',
          'BUILDKIT_SYNTAX=mirror.gcr.io/docker/dockerfile@sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720',
          service,
        ],
        { timeoutMs: buildDeadline - Date.now() },
      );
    }
    await checked('docker', ['buildx', 'stop', builder]);
    currentPhase = 'stack-startup';
    stackStarted = true;
    await compose([
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '180',
      '--no-deps',
      'postgres',
      'minio',
    ]);
    await compose(['run', '--rm', '--no-deps', 'minio-init']);
    await compose(['run', '--rm', '--no-deps', 'migration']);
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
      if (service === 'api')
        assertScaleApiIngressEnvironment(metadata, (ingress) =>
          writeJson(resolve(reports, 'runtime-api-ingress.json'), {
            ...initialIdentity,
            stage: 'owned-api-before-calibration',
            ingress,
          }),
        );
      const image = JSON.parse(await capture('docker', ['image', 'inspect', metadata.Image]))[0];
      images.push({
        service,
        id: image.Id,
        revision: image.Config.Labels?.['org.opencontainers.image.revision'] || '',
      });
    }
    const imageManifestHash = assertScaleImages(images, head);
    env.ASA_SCALE_IMAGE_MANIFEST_HASH = imageManifestHash;
    identity = { ...initialIdentity, environmentHash, imageManifestHash };
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
    await requireResources();

    let latencyCompleted = false;
    const runBrowserLevel = async (users, mode = 'capacity') => {
      currentPhase = mode === 'calibration' ? 'calibration' : 'level-' + users;
      const directory = resolve(reports, currentPhase);
      mkdirSync(directory, { recursive: true, mode: 0o777 });
      currentAbortFile = resolve(directory, 'abort.json');
      const sampleIndex = allResources.length;
      await sample();
      if (!stoppedByResource) {
        driverName = project + '-browser-' + mode + '-' + users;
        const running = start(
          'docker',
          [
            ...composePrefix,
            'run',
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
          reasons: ['resource_observer_errors'],
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
    const calibration = await runBrowserLevel(2, 'calibration');
    writeJson(resolve(reports, 'calibration', 'receipt.json'), calibration);
    if (calibration.status !== 'VALID_FIXTURE') {
      summary = {
        ...scaleLadderSummary([], identity),
        calibration,
        host,
        latencyProfile: 'NOT_RUN',
      };
      writeJson(resolve(reports, 'summary.json'), summary);
      process.exitCode = 2;
      return;
    }
    summary = await runScaleLadder(identity, runBrowserLevel, async (receipt) => {
      writeJson(resolve(reports, 'level-' + receipt.users, 'receipt.json'), receipt);
      console.log('[classroom-scale]', receipt.users, receipt.status, receipt.reasons.join(', '));
      if (receipt.users === 30 && receipt.status === 'PASS' && !latencyCompleted) {
        currentPhase = 'latency-ab-ba';
        // The diagnostic fixture owns loopback4611/4612. Stop only our now-idle
        // full-UI services before it binds4612; the next level reuses exact images.
        await compose(['stop', 'web', 'api', 'scratch']);
        await refreshContainers();
        let latencyFailure;
        try {
          await latencyProfile(env, monitored, composeCapture, reports);
        } catch (error) {
          latencyFailure = error;
          writeJson(resolve(reports, 'latency/failure.json'), { reason: safeError(error) });
        }
        if (!stoppedByResource) {
          await compose([
            'up',
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
          for (const container of containerIds.filter((item) =>
            ['api', 'web', 'scratch'].includes(item.service),
          )) {
            const metadata = ownMetadata(await dockerApi('/containers/' + container.id + '/json'));
            if (metadata.Image !== images.find((image) => image.service === container.service).id)
              throw Error('Image changed while returning from latency diagnosis');
          }
        }
        if (latencyFailure) throw latencyFailure;
        latencyCompleted = true;
      }
    });
    summary.host = host;
    summary.calibration = calibration;
    summary.latencyProfile = latencyCompleted ? 'COMPLETED' : 'NOT_RUN';
    summary.observationErrors = observationErrors;
    writeJson(resolve(reports, 'summary.json'), summary);
    if (summary.levels.some((level) => level.status !== 'PASS')) process.exitCode = 2;
  } catch (error) {
    process.exitCode = 2;
    writeJson(resolve(reports, 'controller-failure.json'), {
      ...(identity || initialIdentity),
      phase: currentPhase,
      status: stoppedByResource ? 'BLOCKED_BY_RUNNER' : 'INVALID',
      reason: stoppedByResource?.reason || safeError(error),
      observationErrors,
    });
    if (identity && !summary) {
      const receipts = SCALE_LEVELS.map((users) =>
        resolve(reports, 'level-' + users, 'receipt.json'),
      )
        .filter(existsSync)
        .map(readJson);
      writeJson(resolve(reports, 'summary.json'), {
        ...scaleLadderSummary(receipts, identity),
        host,
        controllerStatus: stoppedByResource ? 'BLOCKED_BY_RUNNER' : 'INVALID',
        stoppedAt: currentPhase,
      });
    }
    throw error;
  } finally {
    if (monitorTimer) clearInterval(monitorTimer);
    await monitorPending?.catch(() => undefined);
    writeJson(resolve(reports, 'resource-observations.json'), {
      samples: allResources,
      observationErrors,
    });
    if (stackStarted) {
      try {
        await refreshContainers();
        writeJson(resolve(reports, 'owned-containers.json'), containerIds);
        await compose(['down']); // Deliberately no --volumes, no prune, no unrelated project.
      } catch (error) {
        process.exitCode = 2;
        writeJson(resolve(reports, 'cleanup-failure.json'), { reason: safeError(error) });
      }
    }
    if (builderCreated) {
      try {
        await checked('docker', ['buildx', 'rm', builder]);
      } catch (error) {
        process.exitCode = 2;
        writeJson(resolve(reports, 'builder-cleanup-failure.json'), { reason: safeError(error) });
      }
    }
  }
}

async function latencyProfile(env, monitored, composeCapture, output) {
  const deadline = Date.now() + 10 * 60000;
  const bounded = async (command, args, options = {}) => {
    if (Date.now() >= deadline)
      throw Error('Latency diagnostic exceeded its fixed10-minute budget');
    return monitored(command, args, { ...options, timeoutMs: deadline - Date.now() });
  };
  const baselineRoot = resolve(root, '../baseline');
  if (
    (await capture('git', ['-C', baselineRoot, 'rev-parse', 'HEAD'])) !== STORM_BASELINE ||
    (await capture('git', ['-C', baselineRoot, 'status', '--porcelain', '--untracked-files=no']))
  )
    throw Error('Counterbalanced baseline checkout is not the pinned clean source');
  await bounded('corepack', ['pnpm', '--dir', baselineRoot, 'install', '--frozen-lockfile']);
  await bounded('corepack', [
    'pnpm',
    '--dir',
    baselineRoot,
    'exec',
    'nx',
    'build',
    'api',
    '--skip-nx-cache',
  ]);
  await bounded('corepack', ['pnpm', 'exec', 'playwright', 'install', '--with-deps', 'chromium']);
  const samples = [];
  for (const [sampleId, variant] of [
    ['ab-a', 'baseline'],
    ['ab-b', 'candidate'],
    ['ba-b', 'candidate'],
    ['ba-a', 'baseline'],
  ]) {
    const database = 'asa_request_storm_' + variant + '_test';
    const owned = 'asa-scale:' + env.ASA_SCALE_RUN_TOKEN;
    const existing = await composeCapture([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      "SELECT coalesce(shobj_description(oid,'pg_database'),'') FROM pg_database WHERE datname='" +
        database +
        "'",
    ]);
    if (existing && existing !== owned) throw Error('Refusing another latency database');
    if (existing === owned)
      await composeCapture([
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        'DROP DATABASE ' + database,
      ]);
    await composeCapture([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'CREATE DATABASE ' + database,
    ]);
    await composeCapture([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'COMMENT ON DATABASE ' + database + " IS '" + owned + "'",
    ]);
    const sourceRoot = variant === 'baseline' ? baselineRoot : root;
    const sourceSha = variant === 'baseline' ? STORM_BASELINE : env.ASA_SCALE_SHA;
    const adminUrl =
      'postgresql://postgres:' + env.ASA_SCALE_ADMIN_PASSWORD + '@127.0.0.1:5432/' + database;
    const runtimeUrl =
      'postgresql://asalab_app:' + env.ASA_SCALE_APP_PASSWORD + '@127.0.0.1:5432/' + database;
    const sampleEnv = {
      ...env,
      ASA_REQUEST_STORM: '1',
      ASA_STORM_USERS: '30',
      ASA_STORM_VARIANT: variant,
      ASA_STORM_SOURCE_ROOT: sourceRoot,
      ASA_STORM_SOURCE_SHA: sourceSha,
      ASA_STORM_RUN_ID: (await import('node:crypto')).randomUUID(),
      ASA_STORM_SCENARIO: 'latency',
      ASA_STORM_SAMPLE_ID: sampleId,
      TEST_DATABASE_URL: adminUrl,
      APP_TEST_DATABASE_URL: runtimeUrl,
      MIGRATION_DATABASE_URL: adminUrl,
      MIGRATION_EXPECT_DATABASE: database,
      MIGRATION_CONFIRM: 'APPLY:' + database,
      ASA_APP_DB_PASSWORD: env.ASA_SCALE_APP_PASSWORD,
      ASA_BLOCKS_RUNTIME_ORIGIN: 'http://127.0.0.1:4612',
      ASA_BLOCKS_RUNTIME_SIGNING_KEY: env.ASA_SCALE_SIGNING_KEY,
    };
    await bounded('corepack', ['pnpm', '--dir', sourceRoot, 'db:migrate'], { env: sampleEnv });
    await composeCapture([
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      "ALTER ROLE asalab_app WITH LOGIN PASSWORD '" + env.ASA_SCALE_APP_PASSWORD + "'",
    ]);
    await bounded('node', ['tools/capacity/request-storm.mjs', 'measure'], { env: sampleEnv });
    const report = readJson(resolve(output, 'latency', sampleId + '.json'));
    assertStormClientProvenance(report.clientSource, sourceSha);
    if (
      !report.success ||
      report.scenario !== 'latency' ||
      report.sampleId !== sampleId ||
      report.source !== sourceSha ||
      report.users !== 30
    )
      throw Error('Incomplete counterbalanced latency report');
    samples.push({
      sampleId,
      variant,
      sourceSha,
      loginLatencyMs: report.loginLatencyMs,
      segments: summarizeLatencyTimings(report.operationTimings, report.records, 30),
      rawReport: sampleId + '.json',
      summary: report.summary,
      clientSource: report.clientSource,
    });
  }
  writeJson(resolve(output, 'latency', 'summary.json'), {
    schemaVersion: 1,
    candidateSha: env.ASA_SCALE_SHA,
    baselineSha: STORM_BASELINE,
    users: 30,
    entryOrigin: STORM_ORIGIN,
    fullEditorOrigin: SCALE_PROFILE.ingress.origin,
    fullEditorProfileHash: env.ASA_SCALE_PROFILE_HASH,
    order: samples.map((sample) => sample.sampleId),
    samples,
    causalConclusion: 'UNRESOLVED_UNTIL_TIMESTAMP_ANALYSIS',
    interpretation:
      'One counterbalanced AB/BA diagnostic experiment; no automatic production change or statistical capacity claim.',
  });
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
