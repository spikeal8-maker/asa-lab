import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';

const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { fetch, AbortSignal } = globalThis;
const dataTmpfs = 'rw,nosuid,nodev,noexec,size=512m,uid=1000,gid=1000,mode=0700';
const scratchTmpfs = 'rw,nosuid,nodev,noexec,size=64m,uid=1000,gid=1000,mode=0700';
const dockerSocket = 'unix:///var/run/docker.sock';

/** This fixture is deliberately separate from working-installation and capacity
 * storage. Neither a general test run nor a local runner may start it implicitly. */
export function readAiAttachmentFixtureEnvironment(env) {
  if (
    env.ASA_AI_ATTACHMENTS_STORAGE_TEST !== '1' ||
    env.GITHUB_ACTIONS !== 'true' ||
    !/^[1-9]\d{0,19}$/.test(env.GITHUB_RUN_ID || '') ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')
  )
    throw new Error('Explicit disposable GitHub AI attachment fixture required');
  if (
    env.ASA_OBJECT_STORAGE_ENDPOINT !== 'http://127.0.0.1:19000' ||
    env.ASA_OBJECT_STORAGE_REGION !== 'us-east-1' ||
    env.ASA_OBJECT_STORAGE_BUCKET !== `ai-attachments-${env.GITHUB_RUN_ID}` ||
    env.ASA_OBJECT_STORAGE_FORCE_PATH_STYLE !== 'true' ||
    env.ASA_OBJECT_STORAGE_ACCESS_KEY !== 'ai-attachments-ci-only' ||
    env.ASA_OBJECT_STORAGE_SECRET_KEY !== 'ai-attachments-ci-only-secret' ||
    env.DOCKER_HOST ||
    env.DOCKER_CONTEXT
  )
    throw new Error('Exact loopback, synthetic credentials and local Docker fixture required');
  return Object.freeze({
    runId: env.GITHUB_RUN_ID,
    sha: env.GITHUB_SHA,
    endpoint: env.ASA_OBJECT_STORAGE_ENDPOINT,
    region: env.ASA_OBJECT_STORAGE_REGION,
    bucket: env.ASA_OBJECT_STORAGE_BUCKET,
    accessKeyId: env.ASA_OBJECT_STORAGE_ACCESS_KEY,
    secretAccessKey: env.ASA_OBJECT_STORAGE_SECRET_KEY,
    forcePathStyle: true,
    containerName: `asa-ai-attachments-objects-${env.GITHUB_RUN_ID}`,
    imageName: `asa-ai-attachments-minio:${env.GITHUB_RUN_ID}`,
    labels: Object.freeze({
      'asa.ai-attachments.fixture': '1',
      'asa.ai-attachments.run': env.GITHUB_RUN_ID,
      'asa.ai-attachments.sha': env.GITHUB_SHA,
      'asa.ai-attachments.bucket': env.ASA_OBJECT_STORAGE_BUCKET,
    }),
  });
}

function exactPortBinding(ports) {
  return (
    ports &&
    Object.keys(ports).length === 1 &&
    Array.isArray(ports['9000/tcp']) &&
    ports['9000/tcp'].length === 1 &&
    ports['9000/tcp'][0]?.HostIp === '127.0.0.1' &&
    ports['9000/tcp'][0]?.HostPort === '19000'
  );
}

/** Return an immutable container ID, never an unchecked name for cleanup. */
export function assertAiAttachmentFixtureContainer(value, fixture, requireRunning = false) {
  const host = value?.HostConfig;
  if (
    !/^[a-f0-9]{64}$/.test(value?.Id || '') ||
    value?.Name !== `/${fixture.containerName}` ||
    value?.Config?.Image !== fixture.imageName ||
    !/^sha256:[a-f0-9]{64}$/.test(value?.Image || '') ||
    value?.Config?.Labels?.['asa.ai-attachments.image'] !== value.Image ||
    Object.entries(fixture.labels).some(
      ([key, expected]) => value?.Config?.Labels?.[key] !== expected,
    ) ||
    !host ||
    host.Privileged !== false ||
    host.NetworkMode !== 'bridge' ||
    host.PublishAllPorts !== false ||
    host.ReadonlyRootfs !== true ||
    (host.Binds != null && (!Array.isArray(host.Binds) || host.Binds.length !== 0)) ||
    !exactPortBinding(host.PortBindings) ||
    !host.Tmpfs ||
    Object.keys(host.Tmpfs).length !== 2 ||
    host.Tmpfs['/data'] !== dataTmpfs ||
    host.Tmpfs['/tmp'] !== scratchTmpfs ||
    !Array.isArray(value.Mounts) ||
    value.Mounts.some(
      (mount) => mount.Type !== 'tmpfs' || !['/data', '/tmp'].includes(mount.Destination),
    ) ||
    (requireRunning &&
      (value?.State?.Running !== true || !exactPortBinding(value?.NetworkSettings?.Ports)))
  )
    throw new Error('Refusing foreign or non-disposable AI attachment container');
  return value.Id;
}

function docker(args, missingName) {
  try {
    return execFileSync('docker', ['--host', dockerSocket, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
  } catch (problem) {
    const stderr = String(problem?.stderr || '');
    if (
      missingName &&
      stderr
        .split('\n')
        .some((line) =>
          [
            `Error: No such object: ${missingName}`,
            `Error response from daemon: No such container: ${missingName}`,
            `Error response from daemon: No such object: ${missingName}`,
            `Error: No such container: ${missingName}`,
          ].includes(line.trim()),
        )
    )
      return null;
    // The CLI reports only this message, without dumping inspection JSON.
    throw new Error(`Disposable AI attachment Docker ${args[0]} failed`, { cause: problem });
  }
}

function inspect(fixture, missingIsOkay = false, requireRunning = false) {
  const output = docker(
    ['container', 'inspect', fixture.containerName],
    missingIsOkay ? fixture.containerName : undefined,
  );
  if (output === null) return null;
  let values;
  try {
    values = JSON.parse(output);
  } catch {
    throw new Error('Invalid disposable AI attachment container inspection');
  }
  if (!Array.isArray(values) || values.length !== 1)
    throw new Error('Ambiguous disposable AI attachment container inspection');
  return assertAiAttachmentFixtureContainer(values[0], fixture, requireRunning);
}

export function assertAiAttachmentFixtureRunning(fixture) {
  return inspect(fixture, false, true);
}

async function start(fixture) {
  const imageId = docker(['image', 'inspect', '--format', '{{.Id}}', fixture.imageName]).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId))
    throw new Error('Build the pinned disposable AI attachment MinIO image first');
  const containerId = docker([
    'run',
    '--detach',
    '--pull=never',
    '--name',
    fixture.containerName,
    ...Object.entries({ ...fixture.labels, 'asa.ai-attachments.image': imageId }).flatMap(
      ([key, value]) => ['--label', `${key}=${value}`],
    ),
    '--network',
    'bridge',
    '--publish',
    '127.0.0.1:19000:9000',
    '--restart',
    'no',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '256',
    '--memory',
    '768m',
    '--cpus',
    '2',
    '--tmpfs',
    `/data:${dataTmpfs}`,
    '--tmpfs',
    `/tmp:${scratchTmpfs}`,
    '--env',
    `MINIO_ROOT_USER=${fixture.accessKeyId}`,
    '--env',
    `MINIO_ROOT_PASSWORD=${fixture.secretAccessKey}`,
    '--env',
    'MINIO_BROWSER=off',
    fixture.imageName,
    '--certs-dir',
    '/tmp/certs',
    'server',
    '/data',
    '--address',
    ':9000',
    '--console-address',
    ':9001',
  ]).trim();
  if (inspect(fixture) !== containerId)
    throw new Error('Disposable AI attachment container identity changed');

  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${fixture.endpoint}/minio/health/ready`, {
        redirect: 'error',
        signal: AbortSignal.timeout(Math.min(1000, Math.max(1, deadline - Date.now()))),
      });
      ready = response.ok;
      await response.body?.cancel();
      if (ready) break;
    } catch {
      // Only this explicitly selected, disposable loopback server is polled.
    }
    await delay(Math.min(250, Math.max(0, deadline - Date.now())));
  }
  if (!ready) throw new Error('Disposable AI attachment MinIO did not become ready in 30s');
  if (assertAiAttachmentFixtureRunning(fixture) !== containerId)
    throw new Error('Disposable AI attachment container identity changed');

  const {
    S3Client,
    CreateBucketCommand,
    PutBucketTaggingCommand,
    PutBucketVersioningCommand,
    HeadBucketCommand,
  } = apiRequire('@aws-sdk/client-s3');
  const client = new S3Client({
    endpoint: fixture.endpoint,
    region: fixture.region,
    forcePathStyle: fixture.forcePathStyle,
    maxAttempts: 1,
    credentials: { accessKeyId: fixture.accessKeyId, secretAccessKey: fixture.secretAccessKey },
  });
  const send = (command) => client.send(command, { abortSignal: AbortSignal.timeout(5000) });
  try {
    // No ACL or public policy is installed. An existing bucket is an error in
    // this freshly created container; do not silently reuse unknown storage.
    await send(new CreateBucketCommand({ Bucket: fixture.bucket }));
    await send(
      new PutBucketTaggingCommand({
        Bucket: fixture.bucket,
        Tagging: {
          TagSet: [
            { Key: 'asa-ai-attachments-fixture', Value: '1' },
            { Key: 'asa-ai-attachments-run', Value: fixture.runId },
            { Key: 'asa-ai-attachments-sha', Value: fixture.sha },
          ],
        },
      }),
    );
    // Exercise removal of actual versions, rather than merely delete markers.
    await send(
      new PutBucketVersioningCommand({
        Bucket: fixture.bucket,
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    );
    await send(new HeadBucketCommand({ Bucket: fixture.bucket }));
  } finally {
    client.destroy();
  }
  process.stdout.write(
    `AI_ATTACHMENTS_MINIO_READY run=${fixture.runId} sha=${fixture.sha} bucket=${fixture.bucket} image=${imageId}\n`,
  );
}

function stop(fixture) {
  const containerId = inspect(fixture, true);
  if (containerId === null) {
    process.stdout.write(`AI_ATTACHMENTS_MINIO_NOT_PRESENT run=${fixture.runId}\n`);
    return;
  }
  // Inspect and remove by the same immutable ID. A name reused after inspection
  // cannot cause another container or a working-installation volume to be removed.
  docker(['container', 'rm', '--force', containerId]);
  process.stdout.write(
    `AI_ATTACHMENTS_MINIO_REMOVED run=${fixture.runId} container=${containerId}\n`,
  );
}

async function main() {
  if (process.argv.length !== 3 || !['start', 'stop'].includes(process.argv[2]))
    throw new Error('Usage: node tests/ai-attachments/minio-fixture.mjs start|stop');
  const fixture = readAiAttachmentFixtureEnvironment(process.env);
  if (process.argv[2] === 'stop') stop(fixture);
  else await start(fixture);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((problem) => {
    process.stderr.write(
      `${problem instanceof Error ? problem.message : 'Disposable AI attachment fixture failed'}\n`,
    );
    process.exitCode = 1;
  });
}
