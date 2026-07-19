#!/usr/bin/env node
// TST-STARTUP-001: real HTTP startup verification on the canonical API port.
// Starts the built API with APP_DATABASE_URL, requires /health/live 200 with an
// x-request-id header, /health/ready 200 (database up), then a clean shutdown.
// Occupied canonical port or missing environment => exit 78 (BLOCKED), never
// killing a foreign process.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const API_PORT = Number.parseInt(process.env.ASA_API_PORT ?? '4611', 10);
const LOCAL_DIR = join(process.env.LOCALAPPDATA ?? '.', 'asa-lab-devenv');

function fallbackAppUrl() {
  const cfgFile = join(LOCAL_DIR, 'config.json');
  const appFile = join(LOCAL_DIR, 'app-db.json');
  if (!existsSync(cfgFile) || !existsSync(appFile)) return null;
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  const appDb = JSON.parse(readFileSync(appFile, 'utf8'));
  return `postgres://${appDb.user}:${appDb.password}@127.0.0.1:${cfg.ports.postgres}/asalab`;
}

const appUrl = process.env.APP_DATABASE_URL ?? fallbackAppUrl();
if (!appUrl) {
  console.error('BLOCKED: APP_DATABASE_URL is required for the startup check');
  process.exit(78);
}
if (!existsSync('apps/api/dist/main.js')) {
  console.error('BLOCKED: apps/api/dist missing - run pnpm build first');
  process.exit(78);
}

const portState = await new Promise((resolveProbe) => {
  const server = net
    .createServer()
    .once('error', () => resolveProbe('occupied'))
    .once('listening', () => server.close(() => resolveProbe('free')))
    .listen(API_PORT, '127.0.0.1');
});
if (portState === 'occupied') {
  console.error(
    `BLOCKED: canonical API port ${API_PORT} is occupied; not killing the owner per LOCAL_PORT_POLICY`,
  );
  process.exit(78);
}

const child = spawn('node', ['apps/api/dist/main.js'], {
  env: {
    ...process.env,
    APP_DATABASE_URL: appUrl,
    API_PORT: String(API_PORT),
    API_HOST: '127.0.0.1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += String(chunk);
});

async function waitFor(path, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      return await fetch(`http://127.0.0.1:${API_PORT}${path}`);
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw last ?? new Error('timeout');
}

let failures = 0;
try {
  const live = await waitFor('/health/live', 15000);
  if (live.status !== 200) {
    console.error(`FAIL: /health/live => ${live.status}`);
    failures += 1;
  }
  const requestId = live.headers.get('x-request-id');
  if (!requestId) {
    console.error('FAIL: x-request-id header missing on /health/live');
    failures += 1;
  } else console.log('live: 200, x-request-id present');
  const ready = await fetch(`http://127.0.0.1:${API_PORT}/health/ready`);
  const readyBody = await ready.json();
  if (ready.status !== 200 || readyBody?.dependencies?.database !== 'up') {
    console.error(`FAIL: /health/ready => ${ready.status} ${JSON.stringify(readyBody)}`);
    failures += 1;
  } else console.log('ready: 200, database up');
} catch (error) {
  console.error(`FAIL: API did not answer on ${API_PORT}: ${String(error)}\n${stderr.slice(-500)}`);
  failures += 1;
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
}

if (failures > 0) {
  console.error('startup:check FAIL');
  process.exit(1);
}
console.log(`startup:check PASS on http://127.0.0.1:${API_PORT}`);
