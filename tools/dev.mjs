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
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiChildEnv, webChildEnv } from './child-env.mjs';

const FORBIDDEN_PORTS = new Set([3000, 3100, 5173]);
const STOP_FILE = '.asa-dev-stop';
const SHUTDOWN_TIMEOUT_MS = 15000;

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

function removeStopFile() {
  try {
    if (existsSync(STOP_FILE)) unlinkSync(STOP_FILE);
  } catch {
    // A stale stop marker is non-fatal; the watcher will retry cleanup.
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

function waitForExit(child, timeoutMs) {
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

const viteBin = resolve('node_modules/vite/bin/vite.js');
if (!existsSync(viteBin)) {
  console.error(`Vite executable is missing: ${viteBin}. Run pnpm install.`);
  process.exit(78);
}

// Long-lived children are launched as the actual Node processes, not through
// cmd.exe/pnpm shell wrappers. On Windows a wrapper can die while leaving Vite
// or the API orphaned and still holding ports 4610/4611.
const children = [];
let shuttingDown = false;
let shutdownPromise = null;
let stopWatcher = null;

function startNodeChild(name, script, args, env) {
  const child = spawn(process.execPath, [script, ...args], {
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env,
  });
  children.push({ name, child });

  child.once('error', (error) => {
    console.error(`${name} failed to start: ${String(error)}`);
    if (!shuttingDown) void shutdownAll(`${name} start error`, 1);
  });
  child.once('exit', (code, signal) => {
    console.log(`${name} exited (${code ?? signal ?? 'unknown'})`);
    if (!shuttingDown) void shutdownAll(`${name} exited unexpectedly`, code ?? 1);
  });
  return child;
}

async function shutdownAll(reason = 'requested', requestedExitCode = 0) {
  if (shutdownPromise !== null) return shutdownPromise;
  shuttingDown = true;
  if (stopWatcher !== null) clearInterval(stopWatcher);

  shutdownPromise = (async () => {
    console.log(`Stopping ASA Lab dev environment (${reason})...`);
    const live = children.filter(
      ({ child }) => child.exitCode === null && child.signalCode === null,
    );

    for (const { child } of live) child.kill();
    const results = await Promise.all(
      live.map(async ({ name, child }) => ({
        name,
        child,
        exited: await waitForExit(child, SHUTDOWN_TIMEOUT_MS),
      })),
    );

    const survivors = results.filter(({ exited }) => !exited);
    let exitCode = requestedExitCode;
    if (survivors.length > 0) {
      exitCode = 1;
      console.error(
        `FAIL: tracked ASA Lab child process(es) did not stop: ${survivors.map(({ name }) => name).join(', ')}`,
      );
      // Emergency cleanup is limited to PIDs spawned and tracked by this
      // orchestrator. It must never be the path that makes TST-STARTUP-001 pass.
      for (const { child } of survivors) {
        if (!child.pid) continue;
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' });
        } else {
          child.kill('SIGKILL');
        }
      }
    }

    removeStopFile();
    console.log(
      exitCode === 0
        ? 'ASA Lab dev environment stopped cleanly.'
        : 'ASA Lab dev environment stopped with cleanup errors.',
    );
    process.exit(exitCode);
  })();
  return shutdownPromise;
}

startNodeChild('api', resolve('apps/api/dist/main.js'), [], apiChildEnv(process.env, API_PORT));
startNodeChild(
  'web',
  viteBin,
  ['-c', resolve('apps/web/vite.config.ts')],
  webChildEnv(process.env),
);

process.on('SIGINT', () => void shutdownAll('SIGINT', 0));
process.on('SIGTERM', () => void shutdownAll('SIGTERM', 0));

// Graceful programmatic stop for automated harnesses: creating the stop file
// asks the orchestrator to stop its direct child processes and wait for them.
removeStopFile();
stopWatcher = setInterval(() => {
  if (existsSync(STOP_FILE)) void shutdownAll('stop file', 0);
}, 500);
stopWatcher.unref();

console.log('');
console.log('ASA Lab dev environment (LOCAL_PORT_POLICY):');
console.log(`  Web (Vite dev):        http://127.0.0.1:${WEB_PORT}`);
console.log(`  API:                   http://127.0.0.1:${API_PORT}`);
console.log(`  Same-origin built SPA: http://127.0.0.1:${API_PORT}/`);
console.log('API code changes: restart pnpm dev (the API is rebuilt on every start).');
