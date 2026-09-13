import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { matchesGlob } from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const workflow = (name) => YAML.parse(read(`.github/workflows/${name}.yml`));
const neighbours = [
  'chess-r1-focused',
  'checkers-m1-focused',
  'electronics-r4-m1-focused',
  'three-d-m0-focused',
];
const matches = (config, event, path) =>
  config.on[event]?.paths?.some((pattern) => matchesGlob(path, pattern)) ?? false;

test('ordinary Scratch changes reach Scratch checks without other subject pipelines', () => {
  const paths = [
    'contexts/blocks/module.ts',
    'apps/web/src/blocks/runtime-protocol.ts',
    'infra/scratch-editor/host/storage.js',
    'tools/blocks/browser/scenarios.mjs',
    'tools/verify-blocks-host-shell.mjs',
    'tools/validate-blocks-docs.mjs',
    'e2e/blocks-host-storage.spec.ts',
  ];
  for (const event of ['push', 'pull_request']) {
    for (const path of paths) {
      assert.ok(
        matches(workflow('scratch-focused'), event, path),
        `${event}: Scratch misses ${path}`,
      );
      for (const name of neighbours) {
        assert.equal(
          matches(workflow(name), event, path),
          false,
          `${event}: ${name} triggered by ${path}`,
        );
      }
    }
    const doc = 'docs/product/visual-programming/tasks/VSCR-M1-002D.md';
    assert.ok(matches(workflow('scratch-docs-routing'), event, doc));
    assert.equal(
      matches(workflow('scratch-focused'), event, doc),
      false,
      'docs do not need runtime image',
    );
  }
});

test('shared package and dependency changes retain every existing subject safety trigger', () => {
  for (const name of neighbours) {
    const config = workflow(name);
    for (const event of ['push', 'pull_request'].filter((event) => config.on[event])) {
      for (const path of ['package.json', 'pnpm-lock.yaml']) {
        assert.ok(matches(config, event, path), `${name} lost shared ${path} trigger`);
      }
    }
  }
});

test('stable gate has bounded build/type dependencies and includes the C unit and browser suites', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./gate.mjs', import.meta.url)), '--list'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  const commands = plan.focused.map((args) => args.join(' '));
  assert.deepEqual(
    commands.filter((cmd) => cmd.includes(' nx ')),
    ['pnpm nx build blocks', 'pnpm nx run blocks:typecheck'],
  );
  assert.ok(commands.some((cmd) => cmd.includes('apps/web/src/blocks/tsconfig.json')));
  assert.ok(
    commands.some(
      (cmd) => cmd === 'pnpm vitest run contexts/blocks/testing apps/web/src/blocks/testing',
    ),
  );
  assert.deepEqual(plan.browser, [
    ['node', 'tools/verify-blocks-host-shell.mjs'],
    ['node', 'tools/verify-blocks-host-protocol.mjs'],
  ]);
  const graph = JSON.parse(read('docs/project-map/nx-project-graph.json')).graph;
  const visited = new Set();
  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    for (const dep of graph.dependencies[name] ?? []) {
      if (graph.nodes[dep.target]) visit(dep.target);
    }
  }
  visit('blocks');
  assert.deepEqual([...visited].sort(), ['blocks', 'module-sdk']);
});

test('root keeps one Scratch command and repository checks still compose governance, code and data', () => {
  const { scripts } = JSON.parse(read('package.json'));
  assert.deepEqual(
    Object.keys(scripts).filter((name) => /^(gate|test):blocks/.test(name)),
    ['gate:blocks'],
  );
  assert.equal(
    scripts['gate:repository'],
    'corepack pnpm gate:governance && corepack pnpm gate:code && corepack pnpm gate:data',
  );
  assert.ok(
    workflow('scratch-focused').jobs.contracts.steps.some(
      (step) => step.run === 'pnpm gate:blocks',
    ),
  );
  assert.ok(
    workflow('scratch-focused').jobs['runtime-image'].steps.some(
      (step) => step.run === 'pnpm gate:blocks --browser',
    ),
  );
});
