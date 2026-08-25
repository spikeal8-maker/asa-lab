#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const defaultFiles = [
  'tests/portal/auth-response-contract.spec.ts',
  'tests/portal/creator-home.spec.ts',
  'tests/portal/capability-navigation.spec.ts',
  'tests/portal/creator-routing.spec.ts',
  'tests/portal/boot-shell.spec.ts',
  'tests/portal/project-integrity-contract.spec.ts',
];
const forwarded = process.argv.slice(2).filter((argument) => argument !== '--');
const runFlag = forwarded.indexOf('--run');
const requestedFiles = runFlag === -1 ? [] : forwarded.slice(runFlag + 1);
const files = requestedFiles.length > 0 ? requestedFiles : defaultFiles;
const result = spawnSync('pnpm', ['exec', 'vitest', 'run', ...files], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(78);
}
process.exit(result.status ?? 1);
