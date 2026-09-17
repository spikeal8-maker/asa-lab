#!/usr/bin/env node
// Cross-platform launcher for the Python preflight core.
// ASA Lab already uses Python for agent context/recovery; this wrapper only
// chooses a working interpreter and preserves all CLI arguments verbatim.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = resolve(root, 'tools', 'agent_preflight.py');

const explicit = process.env['ASA_PYTHON'];
const candidates = [
  ...(explicit ? [{ command: explicit, prefix: [] }] : []),
  { command: 'python', prefix: [] },
  { command: 'python3', prefix: [] },
  ...(process.platform === 'win32' ? [{ command: 'py', prefix: ['-3'] }] : []),
];

function works(candidate) {
  if (
    candidate.command.includes('\\') &&
    !existsSync(candidate.command)
  ) {
    return false;
  }
  const result = spawnSync(
    candidate.command,
    [...candidate.prefix, '--version'],
    { stdio: 'ignore' },
  );
  return result.error === undefined && result.status === 0;
}

const python = candidates.find(works);
if (!python) {
  console.error('Не найден Python для ASA Lab agent preflight.');
  console.error('Укажите интерпретатор через ASA_PYTHON или установите python/python3.');
  process.exit(78);
}

const result = spawnSync(
  python.command,
  [...python.prefix, script, ...process.argv.slice(2)],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
