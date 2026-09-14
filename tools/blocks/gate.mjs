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

// One cumulative Scratch gate. New slices extend this list, never the root scripts.
// Full API/Web composition and repository-wide boundaries stay in gate:repository.
const docs = [
  ['node', 'tools/validate-blocks-docs.mjs'],
  [
    'pnpm',
    'exec',
    'prettier',
    '--check',
    '--ignore-path',
    '.gitignore',
    'START_HERE_FOR_AI.md',
    'docs/product/visual-programming/README.md',
    'docs/product/visual-programming/AGENT_GUIDE.md',
    'docs/product/visual-programming/VSCR-M1-FORWARD-PLAN-2026-09-11.md',
    'docs/product/visual-programming/tasks',
    'docs/product/visual-programming/components/host.yaml',
    'docs/product/ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md',
    'docs/architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md',
    'tools/validate-blocks-docs.mjs',
    '.github/workflows/scratch-*.yml',
  ],
];
const focused = [
  [
    'pnpm',
    'exec',
    'prettier',
    '--check',
    'contexts/blocks',
    'apps/web/src/blocks',
    'infra/scratch-editor/host',
    'tools/blocks',
    'tools/verify-blocks-host-protocol.mjs',
    'tools/verify-blocks-host-shell.mjs',
    'e2e/blocks-host-storage.spec.ts',
    'e2e/blocks-host-controls.spec.ts',
  ],
  ['node', '--test', 'tools/blocks/checks.test.mjs', 'tools/blocks/host.test.mjs'],
  ['pnpm', 'nx', 'build', 'blocks'],
  ['pnpm', 'nx', 'run', 'blocks:typecheck'],
  ['pnpm', 'exec', 'tsc', '-p', 'apps/web/src/blocks/tsconfig.json'],
  ['pnpm', 'exec', 'eslint', 'contexts/blocks', 'apps/web/src/blocks'],
  [
    'pnpm',
    'exec',
    'eslint',
    'tools/blocks',
    'e2e/blocks-host-storage.spec.ts',
    'e2e/blocks-host-controls.spec.ts',
    'tools/verify-blocks-host-protocol.mjs',
    'tools/verify-blocks-host-shell.mjs',
  ],
  [
    'pnpm',
    'exec',
    'eslint',
    '--config',
    'eslint.boundaries.config.mjs',
    'contexts/blocks',
    'apps/web/src/blocks',
  ],
  ['pnpm', 'vitest', 'run', 'contexts/blocks/testing', 'apps/web/src/blocks/testing'],
  ...['main', 'protocol', 'status', 'storage', 'editor'].map((name) => [
    'node',
    '--check',
    `infra/scratch-editor/host/${name}.js`,
  ]),
  ...docs,
];
const browser = [
  ['node', 'tools/verify-blocks-host-shell.mjs'],
  ['node', 'tools/verify-blocks-host-protocol.mjs'],
  ['pnpm', 'exec', 'playwright', 'test', '--config', 'tools/blocks/browser/playwright.config.mjs'],
];
const commands = args[0] === '--browser' ? browser : args[0] === '--docs' ? docs : focused;
if (args[0] === '--list') {
  console.log(JSON.stringify({ focused, browser, docs }, null, 2));
} else {
  for (const [program, ...commandArgs] of commands) {
    console.log(`\n> ${program} ${commandArgs.join(' ')}`);
    // pnpm supplies its own JS entry point; no shell quoting or global dependency.
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
