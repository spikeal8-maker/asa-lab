#!/usr/bin/env node
// Runtime availability budget: what a burst of sign-ins does to the rest of the
// process. Password hashing is the only request-path work heavy enough to
// starve everything else, so it is measured directly rather than through HTTP.
//
//   node tools/measure-runtime.mjs           report only
//   node tools/measure-runtime.mjs --check   compare against the budget, exit 1 on breach
//
// Requires the identity context to be built (`pnpm nx build identity`).
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { cpus } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = resolve(root, 'docs/testing/performance-budget.json');
const CONCURRENCY = 100;
const DURATION_MS = 3000;
const PROBE_FILE = resolve(root, 'package.json');

const { verifyPasswordAsync, hashPassword } = await import(
  pathToFileURL(resolve(root, 'contexts/identity/dist/index.js')).href
);

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
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

// Static file serving uses the same thread pool as password hashing. If hashing
// takes every thread the API stays "alive" while the site stops loading, so
// file latency is part of the availability budget, not a side note.
async function watchFileReads(deadline) {
  const samples = [];
  while (Date.now() < deadline) {
    const started = process.hrtime.bigint();
    await readFile(PROBE_FILE);
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  return samples;
}

async function measure() {
  const stored = hashPassword('measurement-password');
  const deadline = Date.now() + DURATION_MS;
  const lagsPromise = watchEventLoop(DURATION_MS);
  const filesPromise = watchFileReads(deadline);

  let completed = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (Date.now() < deadline) {
        await verifyPasswordAsync('wrong-password', stored);
        completed += 1;
      }
    }),
  );

  const lags = await lagsPromise;
  const files = await filesPromise;
  return {
    loginsPerSecond: Math.round(completed / (DURATION_MS / 1000)),
    eventLoopLagP99Ms: Math.round(percentile(lags, 99)),
    fileReadP99Ms: Math.round(percentile(files, 99)),
  };
}

const measured = await measure();
const check = process.argv.includes('--check');

console.log('ASA Lab runtime availability');
console.log(
  `  среда: ${cpus().length} ядер, UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE ?? '(4 по умолчанию)'}, ${CONCURRENCY} параллельных входов`,
);

if (!check) {
  for (const [key, value] of Object.entries(measured)) {
    console.log(`  ${key}: ${value}`);
  }
  process.exit(0);
}

const budget = JSON.parse(await readFile(BUDGET_FILE, 'utf8')).runtime;
const rules = [
  { key: 'loginsPerSecond', limit: budget.loginsPerSecondMin, mode: 'min', unit: '/с' },
  { key: 'eventLoopLagP99Ms', limit: budget.eventLoopLagP99MsMax, mode: 'max', unit: ' мс' },
  { key: 'fileReadP99Ms', limit: budget.fileReadP99MsMax, mode: 'max', unit: ' мс' },
];

let failed = false;
for (const rule of rules) {
  const value = measured[rule.key];
  const ok = rule.mode === 'min' ? value >= rule.limit : value <= rule.limit;
  if (!ok) failed = true;
  const bound = rule.mode === 'min' ? '≥' : '≤';
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${rule.key}: ${value}${rule.unit} (порог ${bound} ${rule.limit}${rule.unit})`,
  );
}

console.log(failed ? '\nбюджет превышен' : '\nбюджет соблюдён');
process.exit(failed ? 1 : 0);
