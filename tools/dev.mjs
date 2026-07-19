#!/usr/bin/env node
// One documented local command (`pnpm dev`): starts the API (built NestJS) on
// 127.0.0.1:4611 and the Vite dev server on 127.0.0.1:4610, printing exact
// URLs. Ports follow docs/delivery/LOCAL_PORT_POLICY.md; forbidden legacy
// dev ports are never used. Configuration comes from environment or .env.local (uncommitted);
// the local PostgreSQL fallback reads %LOCALAPPDATA%/asa-lab-devenv.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB_PORT = Number.parseInt(process.env.ASA_WEB_PORT ?? '4610', 10);
const API_PORT = Number.parseInt(process.env.ASA_API_PORT ?? '4611', 10);
const LOCAL_DIR = join(process.env.LOCALAPPDATA ?? '.', 'asa-lab-devenv');

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

function localFallbackUrls() {
  const cfgFile = join(LOCAL_DIR, 'config.json');
  const appFile = join(LOCAL_DIR, 'app-db.json');
  if (!existsSync(cfgFile) || !existsSync(appFile)) return null;
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  const appDb = JSON.parse(readFileSync(appFile, 'utf8'));
  const port = cfg.ports.postgres;
  return {
    admin: `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${port}/asalab`,
    app: `postgres://${appDb.user}:${appDb.password}@127.0.0.1:${port}/asalab`,
  };
}

async function assertPortFree(port, name) {
  await new Promise((resolvePort, reject) => {
    const probe = net
      .createServer()
      .once('error', () =>
        reject(
          new Error(
            `BLOCKED: canonical port ${port} (${name}) is occupied. Per LOCAL_PORT_POLICY do not kill the owner; stop the previous ASA Lab session or investigate.`,
          ),
        ),
      )
      .once('listening', () => probe.close(resolvePort))
      .listen(port, '127.0.0.1');
  });
}

loadDotEnvLocal();
const fallback = localFallbackUrls();
const appUrl = process.env.APP_DATABASE_URL ?? fallback?.app;
const adminUrl = process.env.DATABASE_URL ?? fallback?.admin;
if (!appUrl) {
  console.error(
    'APP_DATABASE_URL is required (environment or .env.local), or provision local PostgreSQL first.',
  );
  process.exit(78);
}
if (!existsSync('apps/api/dist/main.js')) {
  console.error('apps/api/dist is missing - run `pnpm build` first.');
  process.exit(78);
}

try {
  await assertPortFree(API_PORT, 'API');
  await assertPortFree(WEB_PORT, 'Web');
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(78);
}

const children = [];
function start(name, command, args, env) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
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

start('api', 'node', ['apps/api/dist/main.js'], {
  APP_DATABASE_URL: appUrl,
  ...(adminUrl ? { DATABASE_URL: adminUrl } : {}),
  API_PORT: String(API_PORT),
  API_HOST: '127.0.0.1',
});
start('web', 'pnpm', ['exec', 'vite', '-c', 'apps/web/vite.config.ts'], {});

process.on('SIGINT', () => children.forEach((c) => c.kill('SIGINT')));

console.log('');
console.log('ASA Lab dev environment (LOCAL_PORT_POLICY):');
console.log(`  Web (Vite dev):        http://127.0.0.1:${WEB_PORT}`);
console.log(`  API:                   http://127.0.0.1:${API_PORT}`);
console.log(`  Same-origin built SPA: http://127.0.0.1:${API_PORT}/`);
