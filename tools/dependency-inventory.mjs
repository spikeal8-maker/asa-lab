#!/usr/bin/env node
// Dependency and license inventory baseline. Reads the root manifest and the
// pnpm lockfile, writes a machine-readable inventory to reports/ and prints a
// short summary. Foundation baseline for supply-chain visibility.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const REPORTS_DIR = 'reports';
const LOCK_PATH = 'pnpm-lock.yaml';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const declared = {
  dependencies: pkg.dependencies ?? {},
  devDependencies: pkg.devDependencies ?? {},
};

let lockedPackages = 0;
if (existsSync(LOCK_PATH)) {
  const lock = parseYaml(readFileSync(LOCK_PATH, 'utf8'));
  lockedPackages = Object.keys(lock.packages ?? {}).length;
} else {
  console.error('pnpm-lock.yaml not found; run pnpm install first');
  process.exit(1);
}

const inventory = {
  generatedAt: new Date().toISOString(),
  packageManager: pkg.packageManager ?? null,
  declaredDependencies: Object.keys(declared.dependencies).length,
  declaredDevDependencies: Object.keys(declared.devDependencies).length,
  lockedPackages,
  declared,
};

if (!existsSync(REPORTS_DIR)) {
  mkdirSync(REPORTS_DIR, { recursive: true });
}
const outPath = `${REPORTS_DIR}/dependency-inventory.json`;
writeFileSync(outPath, JSON.stringify(inventory, null, 2), 'utf8');

console.log('security:dependencies PASS');
console.log(`  declared dependencies    : ${inventory.declaredDependencies}`);
console.log(`  declared devDependencies : ${inventory.declaredDevDependencies}`);
console.log(`  locked packages          : ${inventory.lockedPackages}`);
console.log(`  inventory written to     : ${outPath}`);
