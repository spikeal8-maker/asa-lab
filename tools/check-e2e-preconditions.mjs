#!/usr/bin/env node
// Preconditions for browser tests. Both of these have produced failures that
// read as product defects and were not:
//
//   1. A stale build. The E2E server serves apps/web/dist and apps/api/dist, so
//      a checkout whose sources moved ahead of the build tests code nobody has.
//      Nineteen specs once failed against a three-week-old bundle, and later a
//      rate-limit assertion failed against a superseded constant.
//   2. An occupied canonical port. A dev session already listening on 4611 makes
//      the lifecycle specs fail with EADDRINUSE.
//
// Staleness is not guessed from file timestamps: Nx restores cached output
// without touching mtimes, so a correct build looks old. The build is simply
// run — cached, that costs seconds — and this checks what cannot be fixed
// automatically, because stopping someone's dev session is their decision.
import net from 'node:net';

const PORTS = [
  { port: Number(process.env.ASA_API_PORT ?? 4611), name: 'API' },
  { port: Number(process.env.ASA_E2E_PORT ?? 4612), name: 'E2E' },
];

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

const occupied = [];
for (const { port, name } of PORTS) {
  if (!(await portFree(port))) occupied.push({ port, name });
}

if (occupied.length > 0) {
  console.error('Браузерные тесты запускать нельзя:');
  for (const { port, name } of occupied) {
    console.error(`  - порт ${port} (${name}) занят`);
  }
  console.error('\nОстановите свою dev-сессию: создайте файл .asa-dev-stop в корне репозитория.');
  console.error('Чужие процессы не трогать — порты 3000 и 5173 принадлежат другим проектам.');
  process.exit(78);
}

console.log('предполётная проверка пройдена: канонические порты свободны');
