#!/usr/bin/env node
// Runs the governance gate through a shell that actually works on this machine.
//
// The gate itself stays a single shell script, because CI runs it directly and
// without Node. This wrapper exists only for `pnpm gate:governance`: on Windows
// `bash` on PATH is the WSL launcher, and where no distribution is installed it
// fails with an installation notice rather than running anything. The gate was
// therefore unrunnable on the owner's own machine while every validator inside
// it passed — the worst kind of red, because it says nothing about the project.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = 'tools/gate-governance.sh';

function candidates() {
  const explicit = process.env['ASA_BASH'];
  const found = explicit ? [explicit] : [];
  if (process.platform === 'win32') {
    found.push(
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    );
  }
  found.push('bash');
  return found;
}

/** A shell that cannot run `exit 0` cannot run the gate either. */
function works(command) {
  if (command !== 'bash' && !existsSync(command)) return false;
  const probe = spawnSync(command, ['-c', 'exit 0'], { stdio: 'ignore' });
  return probe.error === undefined && probe.status === 0;
}

const shell = candidates().find(works);

if (!shell) {
  console.error('Не найдена рабочая оболочка bash для запуска governance-гейта.');
  console.error('На Windows подойдёт Git Bash; путь можно задать явно в ASA_BASH.');
  process.exit(78);
}

const result = spawnSync(shell, [script], { cwd: root, stdio: 'inherit' });
process.exit(result.status ?? 1);
