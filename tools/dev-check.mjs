import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPython } from './devex-python.mjs';

export function main(args, { run = runPython, env = process.env, log = console.error } = {}) {
  const runId = randomUUID();
  log(`DEV CHECK invocation=${runId}; only this invocation's source-bound output is current`);
  const code = run(['tools/dev_check.py', ...args], {
    env: { ...env, ASA_DEV_CHECK_RUN_ID: runId },
  });
  if (code !== 0)
    log(`DEV CHECK invocation=${runId} exited ${code}; do not reuse an earlier report as current`);
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
