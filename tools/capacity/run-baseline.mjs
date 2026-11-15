import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { assertIsolatedEnvironment } from './contracts.mjs';

assertIsolatedEnvironment(process.env);
const result = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', 'tests/capacity/classroom-baseline.pg.spec.ts'],
  { stdio: 'inherit', timeout: 210000 },
);
process.exit(result.status ?? 1);
