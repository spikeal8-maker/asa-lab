import { execFileSync, spawn } from 'node:child_process';
import console from 'node:console';
import { randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
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
if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== sha)
  refuse('checkout does not match the checked candidate');
if (execFileSync('git', ['status', '--porcelain=v1', '-uno'], { encoding: 'utf8' }).trim())
  refuse('tracked source must be clean');

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

try {
  const web = JSON.parse(readFileSync('apps/web/dist/build-metadata.json', 'utf8'));
  if (web.revision !== sha) refuse('the built Web must identify the same checked SHA');
  statSync('apps/api/dist/main.js');
} catch {
  refuse('build the exact candidate API and Web before live acceptance');
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
