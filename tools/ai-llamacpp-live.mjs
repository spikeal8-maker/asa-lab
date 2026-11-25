import { execFileSync, spawn } from 'node:child_process';
import console from 'node:console';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

function refuse(message) {
  console.error(`llama.cpp live acceptance refused: ${message}`);
  process.exit(78);
}

// This is an explicit post-CI acceptance runner, never part of an ordinary
// provider-free unit/browser suite and never a deployment command.
const sha = process.env.ASA_LLAMACPP_LIVE_SHA;
if (!sha || !/^[a-f0-9]{40}$/.test(sha)) refuse('an exact checked Git SHA is required');
function assertCandidate() {
  if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== sha)
    refuse('checkout does not match the checked candidate');
  if (execFileSync('git', ['status', '--porcelain=v1', '-uno'], { encoding: 'utf8' }).trim())
    refuse('tracked source must be clean');
}
assertCandidate();

let admin, runtime, endpoint;
try {
  admin = new URL(process.env.TEST_DATABASE_URL ?? '');
  runtime = new URL(process.env.APP_TEST_DATABASE_URL ?? '');
  endpoint = new URL(process.env.ASA_LLAMACPP_LIVE_ENDPOINT ?? '');
} catch {
  refuse('explicit test database URLs and a real HTTP(S) endpoint are required');
}
if (
  !['postgres:', 'postgresql:'].includes(admin.protocol) ||
  !['postgres:', 'postgresql:'].includes(runtime.protocol) ||
  !/^\/asa_llamacpp_live_[a-z0-9_]+_test$/.test(admin.pathname) ||
  admin.host !== runtime.host ||
  admin.pathname !== runtime.pathname ||
  decodeURIComponent(runtime.username) !== 'asalab_app' ||
  admin.username === runtime.username
)
  refuse('use a dedicated asa_llamacpp_live_*_test database and its restricted asalab_app role');
if (
  !['http:', 'https:'].includes(endpoint.protocol) ||
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash
)
  refuse('endpoint must be HTTP(S), without embedded credentials, query or fragment');

const keyFile = process.env.ASA_LLAMACPP_LIVE_API_KEY_FILE;
if (keyFile) {
  try {
    const info = statSync(keyFile);
    if (!info.isFile() || info.size < 1 || info.size > 4096)
      refuse('the private key file must be a bounded regular file');
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      refuse('the private key file must not be accessible to group or other users');
    const key = readFileSync(keyFile, 'utf8').trim();
    if (!key || /[\r\n\0]/u.test(key)) refuse('the key file must contain one key');
  } catch {
    refuse('the private key file is unreadable');
  }
}

// /api/version reads a runtime environment variable. It cannot establish the
// origin of an old dist directory, so the runner itself builds this clean SHA.
const buildArgs = [
  'pnpm',
  'exec',
  'nx',
  'run-many',
  '-t',
  'build',
  '-p',
  'identity',
  'api',
  'web',
  '--skip-nx-cache',
];
const buildEnv = {
  ...process.env,
  ASA_BUILD_REVISION: sha,
  VITE_ASA_BUILD_REVISION: sha,
  NX_DAEMON: 'false',
  NX_SKIP_NX_CACHE: 'true',
  NX_SKIP_REMOTE_CACHE: 'true',
};
for (const name of [
  'DATABASE_URL',
  'APP_DATABASE_URL',
  'TEST_DATABASE_URL',
  'APP_TEST_DATABASE_URL',
  'ASA_SETTINGS_ENCRYPTION_KEY',
  'ASA_LLAMACPP_LIVE_ENDPOINT',
  'ASA_LLAMACPP_LIVE_API_KEY_FILE',
])
  delete buildEnv[name];
const build = spawn(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', buildArgs, {
  stdio: 'inherit',
  env: buildEnv,
});
const forwardBuildSignal = (signal) => build.kill(signal);
process.on('SIGINT', forwardBuildSignal);
process.on('SIGTERM', forwardBuildSignal);
const built = await new Promise((resolve) => {
  build.once('error', () => resolve(false));
  build.once('exit', (code) => resolve(code === 0));
});
process.removeListener('SIGINT', forwardBuildSignal);
process.removeListener('SIGTERM', forwardBuildSignal);
if (!built) refuse('the fresh uncached candidate build did not succeed');
assertCandidate();

function directoryDigest(directory) {
  const hash = createHash('sha256');
  function visit(relative = '') {
    for (const entry of readdirSync(join(directory, relative), { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) {
        const bytes = readFileSync(join(directory, name));
        hash.update(name + '\0' + bytes.length + '\0');
        hash.update(bytes);
      } else refuse('build output must contain only regular files and directories');
    }
  }
  visit();
  return hash.digest('hex');
}

try {
  const web = JSON.parse(readFileSync('apps/web/dist/build-metadata.json', 'utf8'));
  if (web.revision !== sha) refuse('the built Web must identify the same checked SHA');
  statSync('apps/api/dist/main.js');
  mkdirSync('reports', { recursive: true });
  writeFileSync(
    'reports/ai-llamacpp-live-build.json',
    JSON.stringify(
      {
        sourceSha: sha,
        sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
          encoding: 'utf8',
        }).trim(),
        method: 'fresh-uncached-nx',
        command: ['corepack', ...buildArgs],
        apiDistSha256: directoryDigest('apps/api/dist'),
        webDistSha256: directoryDigest('apps/web/dist'),
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
} catch {
  refuse('the fresh API/Web build could not be verified');
}

const child = spawn(
  process.execPath,
  [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    'playwright.ai-llamacpp-live.config.ts',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ASA_BUILD_REVISION: sha,
      VITE_ASA_BUILD_REVISION: sha,
      ASA_SETTINGS_ENCRYPTION_KEY:
        process.env.ASA_SETTINGS_ENCRYPTION_KEY ?? randomBytes(32).toString('hex'),
      ASA_SEED_DEMO: 'false',
    },
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.once('error', () => {
  console.error('llama.cpp live acceptance could not start its isolated browser runner');
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
