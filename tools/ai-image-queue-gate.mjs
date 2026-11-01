import { spawnSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--unit-only'))
  throw new Error('Usage: pnpm gate:ai-image-queue [--unit-only]');
const unitOnly = args[0] === '--unit-only';
if (!process.env.npm_execpath) throw new Error('Invoke through pnpm gate:ai-image-queue');
if (!unitOnly && process.env.ASA_IMAGE_QUEUE_TEST !== '1')
  throw new Error(
    'The complete queue gate requires an explicitly opted-in disposable PostgreSQL test database',
  );
const commands = [
  ['exec', 'nx', 'run-many', '-t', 'build', '-p', 'identity', 'api', '--skip-nx-cache'],
  ['exec', 'nx', 'run', 'web:typecheck', '--skip-nx-cache'],
  ['db:migrate:check'],
  [
    'exec',
    'vitest',
    'run',
    'tests/admin/ai-image-generation.embedded.spec.ts',
    'apps/api/src/ai-image.controller.spec.ts',
    'apps/api/src/ai-image-comfyui.spec.ts',
    'apps/api/src/ai-image-worker-diagnostics.spec.ts',
    'apps/web/src/ai/ai-image-generation.spec.ts',
    'apps/web/src/ai/ai-generated-image.spec.ts',
    '--maxWorkers=1',
  ],
];
if (!unitOnly)
  commands.push([
    'exec',
    'vitest',
    'run',
    'tests/admin/ai-image-queue.pg.spec.ts',
    '--maxWorkers=1',
  ]);
for (const command of commands) {
  console.log(`\n> pnpm ${command.join(' ')}`);
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...command], {
    stdio: 'inherit',
    env: { ...process.env, NX_SKIP_NX_CACHE: 'true' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(
  unitOnly
    ? 'AI image queue unit/type gate: PASS; real PostgreSQL NOT_RUN'
    : 'AI image queue code and real PostgreSQL gate: PASS; production GPU/load NOT_RUN',
);
