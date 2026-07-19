#!/usr/bin/env node
// TST-PORTS-001: canonical port policy verification (LOCAL_PORT_POLICY.md).
// 1) Runtime configuration references only 4610 (web), 4611 (api), 4612 (e2e).
// 2) Forbidden legacy ports 5173/3000/3100 are absent from runtime config,
//    scripts, Playwright, Vite and README.
// 3) Occupied-port safety: canonical ports are probed without killing anything.
import { readFileSync } from 'node:fs';
import net from 'node:net';

const RUNTIME_FILES = [
  'package.json',
  'apps/web/vite.config.ts',
  'apps/api/src/main.ts',
  'playwright.config.ts',
  'e2e/server.mjs',
  'tools/dev.mjs',
  'README.md',
];
const FORBIDDEN = ['5173', '3000', '3100'];
const REQUIRED = [
  ['apps/web/vite.config.ts', '4610'],
  ['apps/web/vite.config.ts', '4611'],
  ['apps/api/src/main.ts', '4611'],
  ['playwright.config.ts', '4612'],
  ['e2e/server.mjs', '4612'],
  ['tools/dev.mjs', '4610'],
  ['tools/dev.mjs', '4611'],
];

let failures = 0;
for (const file of RUNTIME_FILES) {
  const text = readFileSync(file, 'utf8');
  for (const port of FORBIDDEN) {
    const pattern = new RegExp(`(?<![0-9.])${port}(?![0-9])`);
    if (pattern.test(text)) {
      console.error(`FAIL: forbidden port ${port} referenced in ${file}`);
      failures += 1;
    }
  }
}
for (const [file, port] of REQUIRED) {
  if (!readFileSync(file, 'utf8').includes(port)) {
    console.error(`FAIL: canonical port ${port} missing from ${file}`);
    failures += 1;
  }
}

async function probe(port) {
  return new Promise((resolveProbe) => {
    const server = net
      .createServer()
      .once('error', () => resolveProbe('occupied'))
      .once('listening', () => server.close(() => resolveProbe('free')))
      .listen(port, '127.0.0.1');
  });
}
for (const port of [4610, 4611, 4612]) {
  const state = await probe(port);
  console.log(
    `port ${port}: ${state}${state === 'occupied' ? ' (left untouched per policy)' : ''}`,
  );
}

if (failures > 0) {
  console.error(`ports:check FAIL (${failures} violation(s))`);
  process.exit(1);
}
console.log('ports:check PASS (canonical 4610/4611/4612; 5173/3000/3100 absent)');
