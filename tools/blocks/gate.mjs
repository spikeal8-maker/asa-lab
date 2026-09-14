import { spawnSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const modes = new Set(['--browser', '--docs', '--list']);
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !modes.has(args[0]))) {
  throw new Error('Usage: pnpm gate:blocks [--browser|--docs|--list]');
}

// Diagnostic branch only: write the exact formatter output, print its diff, then fail intentionally.
const focused = [
  ['pnpm', 'exec', 'prettier', '--write', 'e2e/blocks-host-controls.spec.ts'],
  [
    'node',
    '--input-type=module',
    '-e',
    "import { execFileSync } from 'node:child_process'; console.log(execFileSync('git', ['diff', '--', 'e2e/blocks-host-controls.spec.ts'], { encoding: 'utf8' })); process.exit(1);",
  ],
];
const browser = [
  ['node', 'tools/verify-blocks-host-shell.mjs'],
  ['node', 'tools/verify-blocks-host-protocol.mjs'],
  ['pnpm', 'exec', 'playwright', 'test', '--config', 'tools/blocks/browser/playwright.config.mjs'],
];
const docs = [['node', 'tools/validate-blocks-docs.mjs']];
const commands = args[0] === '--browser' ? browser : args[0] === '--docs' ? docs : focused;
if (args[0] === '--list') {
  console.log(JSON.stringify({ focused, browser, docs }, null, 2));
} else {
  for (const [program, ...commandArgs] of commands) {
    console.log(`\n> ${program} ${commandArgs.join(' ')}`);
    const executable = process.execPath;
    if (program === 'pnpm' && !process.env.npm_execpath) {
      throw new Error('Run this gate via pnpm gate:blocks');
    }
    const argv = program === 'node' ? commandArgs : [process.env.npm_execpath, ...commandArgs];
    const result = spawnSync(executable, argv, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, NX_SKIP_NX_CACHE: 'true' },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log('Scratch gate: PASS (Nx cache disabled)');
}
