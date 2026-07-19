#!/usr/bin/env node
// One documented local command: starts the API (NestJS, built) and the Vite
// dev server for the web app, printing exact URLs. Requires: local PostgreSQL
// running, `pnpm build`, `pnpm db:migrate` and `pnpm db:seed:dev` done once.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCAL_DIR = join(process.env.LOCALAPPDATA ?? '.', 'asa-lab-devenv');

function localDatabaseUrls() {
  if (process.env.DATABASE_URL && process.env.APP_DATABASE_URL) {
    return { admin: process.env.DATABASE_URL, app: process.env.APP_DATABASE_URL };
  }
  const cfgFile = join(LOCAL_DIR, 'config.json');
  const appFile = join(LOCAL_DIR, 'app-db.json');
  if (!existsSync(cfgFile) || !existsSync(appFile)) {
    console.error(
      'Set DATABASE_URL and APP_DATABASE_URL, or run infra/local setup + pnpm db:seed:dev first.',
    );
    process.exit(78);
  }
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  const appDb = JSON.parse(readFileSync(appFile, 'utf8'));
  const port = cfg.ports.postgres;
  return {
    admin:
      process.env.DATABASE_URL ?? `postgres://${cfg.user}:${cfg.password}@127.0.0.1:${port}/asalab`,
    app: `postgres://${appDb.user}:${appDb.password}@127.0.0.1:${port}/asalab`,
  };
}

const urls = localDatabaseUrls();
if (!existsSync('apps/api/dist/main.js')) {
  console.error('apps/api/dist is missing — run `pnpm build` first.');
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
  APP_DATABASE_URL: urls.app,
  DATABASE_URL: urls.admin,
  API_PORT: '3000',
});
start('web', 'pnpm', ['exec', 'vite', '-c', 'apps/web/vite.config.ts'], {});

process.on('SIGINT', () => children.forEach((c) => c.kill('SIGINT')));

console.log('');
console.log('ASA Lab dev environment:');
console.log('  Web (Vite):  http://127.0.0.1:5173');
console.log('  API:         http://127.0.0.1:3000');
console.log('  Same-origin build: pnpm build → http://127.0.0.1:3000/');
