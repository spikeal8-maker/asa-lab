import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { assertIsolatedEnvironment } from './contracts.mjs';

assertIsolatedEnvironment(process.env);
const { fetch, AbortSignal } = globalThis;
const id = process.env.GITHUB_RUN_ID;
const name = `asa-capacity-objects-${id}`;
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
if (process.argv[2] === 'stop') {
  let label;
  try {
    label = docker([
      'inspect',
      '--format',
      '{{index .Config.Labels "asa.capacity.run"}}',
      name,
    ]).trim();
  } catch {
    process.exit(0);
  }
  if (label !== id) throw new Error('Refusing foreign capacity object-store cleanup');
  docker(['rm', '-f', name]);
} else {
  docker([
    'run',
    '-d',
    '--name',
    name,
    '--label',
    `asa.capacity.run=${id}`,
    '-p',
    '127.0.0.1:19000:9000',
    '-e',
    `MINIO_ROOT_USER=${process.env.ASA_OBJECT_STORAGE_ACCESS_KEY}`,
    '-e',
    `MINIO_ROOT_PASSWORD=${process.env.ASA_OBJECT_STORAGE_SECRET_KEY}`,
    `asa-capacity-minio:${id}`,
    'server',
    '/data',
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if (
        (
          await fetch('http://127.0.0.1:19000/minio/health/ready', {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      ) {
        ready = true;
        break;
      }
    } catch {
      /* Wait only for this disposable server. */
    }
    await delay(500);
  }
  if (!ready) throw new Error('Disposable object store did not become ready');
  docker([
    'exec',
    name,
    'mc',
    'alias',
    'set',
    'capacity',
    'http://127.0.0.1:9000',
    process.env.ASA_OBJECT_STORAGE_ACCESS_KEY,
    process.env.ASA_OBJECT_STORAGE_SECRET_KEY,
  ]);
  docker(['exec', name, 'mc', 'mb', '--ignore-existing', 'capacity/capacity-fixture']);
}
