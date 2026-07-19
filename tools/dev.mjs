#!/usr/bin/env node
// One command (`pnpm dev`) from a clean checkout: builds the API (Nx cached),
// then starts it on 127.0.0.1:<ASA_API_PORT=4611> together with the Vite dev
// server on 127.0.0.1:<ASA_WEB_PORT=4610>, printing exact URLs.
// Configuration comes only from the environment or uncommitted .env.local.
// API code changes: restart `pnpm dev` (it rebuilds the API on every start).
// Occupied canonical port => exact BLOCKED (exit 78); foreign processes are
// never terminated (LOCAL_PORT_POLICY).
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { apiChildEnv, webChildEnv } from './child-env.mjs';

const FORBIDDEN_PORTS = new Set([3000, 3100, 5173]);

function resolvePort(variable, fallback) {
  const raw = process.env[variable];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || String(value) !== raw.trim() || value < 1024 || value > 65535) {
    console.error(`${variable} must be an integer port in 1024..65535, got: ${raw}`);
    process.exit(78);
  }
  if (FORBIDDEN_PORTS.has(value)) {
    console.error(`${variable}=${value} is forbidden by LOCAL_PORT_POLICY`);
    process.exit(78);
  }
  return value;
}

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

async function assertPortFree(port, name) {
  await new Promise((resolvePromise) => {
    const probe = net
      .createServer()
      .once('error', () => {
        console.error(
          `BLOCKED: canonical port ${port} (${name}) is occupied. Per LOCAL_PORT_POLICY do not kill the owner; stop the previous ASA Lab session or investigate.`,
        );
        process.exit(78);
      })
      .once('listening', () => probe.close(resolvePromise))
      .listen(port, '127.0.0.1');
  });
}

loadDotEnvLocal();
const WEB_PORT = resolvePort('ASA_WEB_PORT', 4610);
const API_PORT = resolvePort('ASA_API_PORT', 4611);

await assertPortFree(API_PORT, 'API');
await assertPortFree(WEB_PORT, 'Web');

if (!process.env.APP_DATABASE_URL) {
  console.error(
    'APP_DATABASE_URL is required: set it in the environment or in uncommitted .env.local (see .env.example).',
  );
  process.exit(78);
}

console.log('Building the API (Nx, cached)...');
const build = spawnSync('pnpm', ['exec', 'nx', 'run', 'api:build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (build.status !== 0) {
  console.error('API build failed; dev startup aborted.');
  process.exit(build.status ?? 1);
}

const children = [];
function startWithEnv(name, command, args, env) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });
  children.push(child);
  child.on('exit', (code) => {
    console.log(`${name} exited (${code ?? 'signal'})`);
    for (const other of children) {
      if (other !== child && other.exitCode === null) other.kill();
    }
    process.exit(code ?? 0);
  });
}

startWithEnv('api', 'node', ['apps/api/dist/main.js'], apiChildEnv(process.env, API_PORT));
startWithEnv(
  'web',
  'pnpm',
  ['exec', 'vite', '-c', 'apps/web/vite.config.ts'],
  webChildEnv(process.env),
);

process.on('SIGINT', () => children.forEach((c) => c.kill('SIGINT')));

console.log('');
console.log('ASA Lab dev environment (LOCAL_PORT_POLICY):');
console.log(`  Web (Vite dev):        http://127.0.0.1:${WEB_PORT}`);
console.log(`  API:                   http://127.0.0.1:${API_PORT}`);
console.log(`  Same-origin built SPA: http://127.0.0.1:${API_PORT}/`);
console.log('API code changes: restart pnpm dev (the API is rebuilt on every start).');
