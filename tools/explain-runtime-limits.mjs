#!/usr/bin/env node
// Why the runtime is configured the way it is. Two decisions in the code look
// arbitrary and are not; this reproduces the measurements behind them so the
// numbers can be re-checked on other hardware instead of taken on trust.
//
//   node tools/explain-runtime-limits.mjs
//
// 1. Pool size. `max: 10` looks small. Raising it makes things worse: the
//    contention moves into PostgreSQL, throughput drops and the tail grows.
// 2. Password hashing. Moving scrypt off the event loop is not enough on its
//    own. Asynchronous crypto runs on the libuv pool, which is shared with file
//    reads, so unbounded hashing frees the event loop and starves static file
//    serving instead — the API answers health checks while the site stops
//    loading. Hence the concurrency bound in contexts/identity/domain/password.
//
// Needs DATABASE_URL-style access for the pool section (APP_DATABASE_URL) and
// the identity context built for the hashing section.
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { cpus } from 'node:os';
import { scrypt, scryptSync, randomBytes } from 'node:crypto';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DURATION_MS = 3000;
const CONCURRENCY = 100;
const TENANT = '00000000-0000-0000-0000-000000000000';

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

function appDatabaseUrl() {
  if (process.env.APP_DATABASE_URL) return process.env.APP_DATABASE_URL;
  // Convenience for the no-Docker local environment.
  const local = join(process.env.LOCALAPPDATA ?? '', 'asa-lab-devenv', 'app-db.json');
  try {
    const app = JSON.parse(readFileSync(local, 'utf8'));
    return `postgres://${app.user}:${app.password}@127.0.0.1:5433/asalab_dev`;
  } catch {
    return null;
  }
}

// Exactly what withTenantContext does for every authorised request.
async function tenantOperation(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT]);
    await client.query('SELECT id FROM projects WHERE tenant_id = $1 LIMIT 20', [TENANT]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function poolProfile(url, max) {
  const pool = new pg.Pool({ connectionString: url, max });
  const latencies = [];
  const deadline = Date.now() + DURATION_MS;
  const started = Date.now();

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (Date.now() < deadline) {
        const at = process.hrtime.bigint();
        await tenantOperation(pool);
        latencies.push(Number(process.hrtime.bigint() - at) / 1e6);
      }
    }),
  );

  const elapsed = (Date.now() - started) / 1000;
  await pool.end();
  return {
    perSecond: Math.round(latencies.length / elapsed),
    p99: Math.round(percentile(latencies, 99)),
    worst: Math.round(Math.max(...latencies)),
  };
}

function watchEventLoop(durationMs) {
  return new Promise((resolvePromise) => {
    const lags = [];
    let last = process.hrtime.bigint();
    const timer = setInterval(() => {
      const now = process.hrtime.bigint();
      lags.push(Number(now - last) / 1e6 - 20);
      last = now;
    }, 20);
    setTimeout(() => {
      clearInterval(timer);
      resolvePromise(lags);
    }, durationMs);
  });
}

async function watchFileReads(deadline) {
  const samples = [];
  while (Date.now() < deadline) {
    const at = process.hrtime.bigint();
    await readFile(join(root, 'package.json'));
    samples.push(Number(process.hrtime.bigint() - at) / 1e6);
  }
  return samples;
}

async function hashingProfile(label, hashOnce) {
  const deadline = Date.now() + DURATION_MS;
  const lagsPromise = watchEventLoop(DURATION_MS);
  const filesPromise = watchFileReads(deadline);

  let done = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (Date.now() < deadline) {
        await hashOnce();
        done += 1;
      }
    }),
  );

  const lags = await lagsPromise;
  const files = await filesPromise;
  console.log(
    `  ${label.padEnd(34)} входов/с ${String(Math.round(done / (DURATION_MS / 1000))).padStart(5)}` +
      `   цикл p99 ${String(Math.round(percentile(lags, 99))).padStart(5)} мс` +
      `   чтение файла p99 ${String(Math.round(percentile(files, 99))).padStart(5)} мс`,
  );
}

console.log(
  `Среда: ${cpus().length} ядер, UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE ?? '(4 по умолчанию)'}\n`,
);

console.log('1. Размер пула — почему 10, а не больше');
const url = appDatabaseUrl();
if (!url) {
  console.log('   пропущено: нет APP_DATABASE_URL и локальной конфигурации\n');
} else {
  for (const max of [10, 25, 50]) {
    const result = await poolProfile(url, max);
    console.log(
      `  max=${String(max).padStart(3)}   операций/с ${String(result.perSecond).padStart(6)}` +
        `   p99 ${String(result.p99).padStart(4)} мс   худшая ${String(result.worst).padStart(4)} мс`,
    );
  }
  console.log('  Больше соединений — больше конкуренции внутри PostgreSQL, а не больше работы.\n');
}

console.log('2. Хеширование пароля — почему асинхронности мало');
const salt = randomBytes(16);
const params = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

await hashingProfile('синхронно (как было)', async () => {
  scryptSync('measurement-password', salt, KEY_LEN, params);
});

await hashingProfile('асинхронно, без ограничения', async () => {
  await new Promise((resolvePromise, reject) => {
    scrypt('measurement-password', salt, KEY_LEN, params, (error, key) =>
      error ? reject(error) : resolvePromise(key),
    );
  });
});

const identity = resolve(root, 'contexts/identity/dist/index.js');
try {
  const { verifyPasswordAsync, hashPassword } = await import(pathToFileURL(identity).href);
  const stored = hashPassword('measurement-password');
  await hashingProfile('как в коде: с ограничением', async () => {
    await verifyPasswordAsync('wrong-password', stored);
  });
  console.log(
    '  Асинхронность освобождает событийный цикл, но без ограничения занимает весь пул\n' +
      '  потоков libuv — и голодают уже файловые операции, то есть раздача сайта.\n',
  );
} catch {
  console.log('  пропущено: соберите identity (pnpm nx build identity)\n');
}
