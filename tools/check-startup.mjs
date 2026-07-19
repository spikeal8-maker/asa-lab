#!/usr/bin/env node
// TST-STARTUP-001: reproducible startup proof.
// Removes apps/api/dist, then runs the real `pnpm dev` inside a clean
// `pwsh -NoProfile` session (APP_DATABASE_URL passed explicitly via the
// environment). Requires Web 4610 => 200, API /health/live and /health/ready
// on 4611 => 200 with an x-request-id header, then shuts down only our own
// process tree and verifies the canonical ports are released.
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { rmSync, existsSync } from 'node:fs';

const WEB_PORT = 4610;
const API_PORT = 4611;

if (!process.env.APP_DATABASE_URL) {
  console.error('BLOCKED: APP_DATABASE_URL is required for the startup check');
  process.exit(78);
}

async function portFree(port) {
  return new Promise((resolvePromise) => {
    const probe = net
      .createServer()
      .once('error', () => resolvePromise(false))
      .once('listening', () => probe.close(() => resolvePromise(true)))
      .listen(port, '127.0.0.1');
  });
}
for (const port of [WEB_PORT, API_PORT]) {
  if (!(await portFree(port))) {
    console.error(
      `BLOCKED: canonical port ${port} is occupied; not killing the owner per LOCAL_PORT_POLICY`,
    );
    process.exit(78);
  }
}

rmSync('apps/api/dist', { recursive: true, force: true });
if (existsSync('apps/api/dist')) {
  console.error('FAIL: could not remove apps/api/dist for the clean-checkout scenario');
  process.exit(1);
}
console.log('apps/api/dist removed; starting the real `pnpm dev` in pwsh -NoProfile...');

const child = spawn('pwsh', ['-NoProfile', '-Command', 'pnpm dev'], {
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (c) => {
  output += String(c);
});
child.stderr.on('data', (c) => {
  output += String(c);
});

async function waitFor(url, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let last = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dev exited early (${child.exitCode})`);
    try {
      return await fetch(url);
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw last ?? new Error('timeout');
}

let failures = 0;
try {
  const live = await waitFor(`http://127.0.0.1:${API_PORT}/health/live`, 240000);
  if (live.status !== 200) {
    console.error(`FAIL: /health/live => ${live.status}`);
    failures += 1;
  }
  if (!live.headers.get('x-request-id')) {
    console.error('FAIL: x-request-id missing');
    failures += 1;
  } else console.log('api live: 200, x-request-id present');
  const ready = await fetch(`http://127.0.0.1:${API_PORT}/health/ready`);
  const readyBody = await ready.json();
  if (ready.status !== 200 || readyBody?.dependencies?.database !== 'up') {
    console.error(`FAIL: /health/ready => ${ready.status} ${JSON.stringify(readyBody)}`);
    failures += 1;
  } else console.log('api ready: 200, database up');
  const web = await waitFor(`http://127.0.0.1:${WEB_PORT}/`, 60000);
  if (web.status !== 200) {
    console.error(`FAIL: web / => ${web.status}`);
    failures += 1;
  } else console.log('web: 200');
} catch (error) {
  console.error(
    `FAIL: startup did not become healthy: ${String(error)}\n--- dev output tail ---\n${output.slice(-1200)}`,
  );
  failures += 1;
} finally {
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' });
  await new Promise((r) => setTimeout(r, 1500));
}

for (const port of [WEB_PORT, API_PORT]) {
  if (!(await portFree(port))) {
    console.error(`FAIL: port ${port} still occupied after shutdown`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error('startup:check FAIL');
  process.exit(1);
}
console.log(
  `startup:check PASS: pnpm dev from clean checkout served web ${WEB_PORT} and api ${API_PORT}, then released both ports`,
);
