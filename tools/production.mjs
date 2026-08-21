#!/usr/bin/env node
// Production launcher for the single-process API + built Web SPA.
// It never builds at startup: deployment builds and verifies first, then this
// process starts only already-produced artifacts with the runtime-role DB URL.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiChildEnv } from './child-env.mjs';

function loadDotEnvLocal() {
  const file = '.env.local';
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

function resolvePort(raw) {
  const source = raw?.trim() || '4611';
  const port = Number.parseInt(source, 10);
  if (!Number.isInteger(port) || String(port) !== source || port < 1024 || port > 65535) {
    console.error(`ASA_API_PORT must be an integer port in 1024..65535, got: ${source}`);
    process.exit(78);
  }
  if (new Set([3000, 3100, 5173]).has(port)) {
    console.error(`ASA_API_PORT=${port} is forbidden by LOCAL_PORT_POLICY`);
    process.exit(78);
  }
  return port;
}

loadDotEnvLocal();
const port = resolvePort(process.env.ASA_API_PORT);
const entry = resolve('apps/api/dist/main.js');
const webEntry = resolve('apps/web/dist/index.html');

if (!process.env.APP_DATABASE_URL) {
  console.error('APP_DATABASE_URL is required in the environment or uncommitted .env.local.');
  process.exit(78);
}
if (!existsSync(entry) || !existsSync(webEntry)) {
  console.error('Production artifacts are missing. Run `pnpm build` before startup.');
  process.exit(78);
}

const revision = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
  encoding: 'utf8',
  windowsHide: true,
});
const env = apiChildEnv(
  {
    ...process.env,
    NODE_ENV: 'production',
    ASA_SECURE_COOKIES: '1',
    ASA_PUBLIC_WEB_ORIGINS:
      process.env.ASA_PUBLIC_WEB_ORIGINS ?? 'https://asa-lab.ru,https://www.asa-lab.ru',
    ASA_BUILD_REVISION: process.env.ASA_BUILD_REVISION || revision.stdout.trim() || 'production',
  },
  port,
);

const child = spawn(process.execPath, [entry], {
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
  env,
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.once('error', (error) => {
  console.error(`ASA Lab production failed to start: ${String(error)}`);
  process.exit(1);
});
child.once('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

console.log(`ASA Lab production: http://127.0.0.1:${port}`);
