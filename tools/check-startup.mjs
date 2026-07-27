#!/usr/bin/env node
// TST-STARTUP-001: reproducible startup and shutdown proof.
// Removes apps/api/dist, then runs the real `pnpm dev` inside a clean
// `pwsh -NoProfile` session (APP_DATABASE_URL passed explicitly via the
// environment). Requires Web 4610 => 200, API /health/live and /health/ready
// on 4611 => 200 with an x-request-id header. Shutdown is requested through
// `.asa-dev-stop`; the test fails if emergency taskkill is required or either
// canonical port remains occupied.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { rmSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';

const WEB_PORT = 4610;
const API_PORT = 4611;
const STOP_FILE = '.asa-dev-stop';

if (!process.env.APP_DATABASE_URL) {
  console.error('BLOCKED: APP_DATABASE_URL is required for the startup check');
  process.exit(78);
}

function removeStopFile() {
  try {
    if (existsSync(STOP_FILE)) unlinkSync(STOP_FILE);
  } catch {
    // The final port checks remain authoritative.
  }
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

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    const onExit = () => {
      clearTimeout(timer);
      resolvePromise(true);
    };
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolvePromise(false);
    }, timeoutMs);
    child.once('exit', onExit);
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

removeStopFile();
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
child.stdout.on('data', (chunk) => {
  output += String(chunk);
});
child.stderr.on('data', (chunk) => {
  output += String(chunk);
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
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
  }
  throw last ?? new Error('timeout');
}

let failures = 0;
let emergencyCleanupUsed = false;
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
    `FAIL: startup did not become healthy: ${String(error)}\n--- dev output tail ---\n${output.slice(-1600)}`,
  );
  failures += 1;
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    writeFileSync(STOP_FILE, 'stop\n', 'utf8');
    const exited = await waitForProcessExit(child, 30000);
    if (!exited) {
      emergencyCleanupUsed = true;
      failures += 1;
      console.error(
        'FAIL: pnpm dev did not exit after .asa-dev-stop; using tracked-PID emergency cleanup',
      );
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' });
      } else {
        child.kill('SIGKILL');
      }
    }
  }
  removeStopFile();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
}

if (!emergencyCleanupUsed && child.exitCode !== 0) {
  console.error(
    `FAIL: pnpm dev exited with ${child.exitCode ?? child.signalCode ?? 'unknown'} after stop request\n--- dev output tail ---\n${output.slice(-1600)}`,
  );
  failures += 1;
}
if (!emergencyCleanupUsed && !output.includes('ASA Lab dev environment stopped cleanly.')) {
  console.error(
    `FAIL: clean shutdown marker missing\n--- dev output tail ---\n${output.slice(-1600)}`,
  );
  failures += 1;
}

for (const port of [WEB_PORT, API_PORT]) {
  if (!(await portFree(port))) {
    console.error(`FAIL: port ${port} still occupied after stop-file shutdown`);
    failures += 1;
  }
}

if (failures > 0) {
  console.error('startup:check FAIL');
  process.exit(1);
}
console.log(
  `startup:check PASS: pnpm dev served web ${WEB_PORT} and api ${API_PORT}, then stop-file shutdown released both ports without taskkill`,
);
