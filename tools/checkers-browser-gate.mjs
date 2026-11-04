import { spawnSync } from 'node:child_process';
import process from 'node:process';

const manager = process.env.npm_execpath;
if (!manager) throw new Error('Run this gate through pnpm gate:checkers-network:browser');
const steps = [
  ['Games navigation', ['e2e:games', '--output', 'reports/playwright-games']],
  [
    'Checkers lessons and local play',
    ['e2e:checkers', '--output', 'reports/playwright-checkers-module'],
  ],
  ['Checkers real PostgreSQL', ['test:checkers-network:pg']],
  [
    'Checkers two-user games',
    [
      'exec',
      'playwright',
      'test',
      'e2e/checkers-network.spec.ts',
      '--output',
      'reports/playwright-checkers-network',
    ],
  ],
  [
    'Publication owner boundary',
    [
      'exec',
      'playwright',
      'test',
      'e2e/public-projects.spec.ts',
      '--grep',
      'only.the.publication.owner',
      '--output',
      'reports/playwright-publication-owner',
    ],
  ],
];
const failures = [];
for (const [name, args] of steps) {
  console.log(`CHECKERS_BROWSER_STEP: ${name}`);
  const result = spawnSync(process.execPath, [manager, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) console.error(result.error.message);
  const passed = result.status === 0;
  console.log(`CHECKERS_BROWSER_RESULT: ${name}: ${passed ? 'PASS' : 'FAIL'}`);
  if (!passed) failures.push(name);
}
if (failures.length) console.error(`Checkers browser gate failed: ${failures.join(', ')}`);
process.exitCode = failures.length ? 1 : 0;
