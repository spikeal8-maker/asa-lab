import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
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
    [
      'pnpm',
      'exec',
      'playwright',
      'test',
      '--config',
      'tools/blocks/browser/playwright.config.mjs',
    ],
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

test('non-root Scratch has bounded writable tmpfs in CI and preview', () => {
  const scratch = YAML.parse(read('compose.blocks-preview.yaml')).services.scratch;
  assert.equal(scratch.user, '101:101');
  assert.equal(scratch.read_only, true);
  assert.deepEqual(scratch.cap_drop, ['ALL']);
  const start = workflow('scratch-focused').jobs['runtime-image'].steps.find(
    (step) => step.name === 'Start isolated Scratch host',
  ).run;
  for (const entry of [
    '/var/cache/nginx:uid=101,gid=101,mode=0700,size=64m',
    '/var/run:uid=101,gid=101,mode=0700,size=8m',
  ]) {
    assert.ok(scratch.tmpfs.includes(entry));
    assert.ok(start.includes(`--tmpfs ${entry}`));
  }
});

test('prebuilt delivery rejects another SHA and unsafe parent origins', async () => {
  const { configureArtifact } = await import('../../infra/scratch-editor/configure-artifact.mjs');
  assert.throws(() => configureArtifact('.', 'main', 'http://127.0.0.1:4628'), /Exact Git SHA/);
  for (const origin of [
    'javascript:alert(1)',
    'https://example.test/path',
    'https://x.test/?x="',
  ]) {
    assert.throws(() => configureArtifact('.', 'a'.repeat(40), origin), /exact HTTP/);
  }
  const recipe = read('infra/scratch-editor/Dockerfile.artifact');
  assert.ok(recipe.includes('node configure-artifact.mjs'));
  assert.ok(recipe.includes('USER 101:101'));
});

test('static precompression preserves bytes and excludes HTML and binary media', async () => {
  const { precompressStaticAssets } =
    await import('../../infra/scratch-editor/configure-artifact.mjs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { gunzipSync } = await import('node:zlib');
  const directory = fs.mkdtempSync(join(tmpdir(), 'asa-static-gzip-'));
  try {
    fs.mkdirSync(join(directory, 'vendor'));
    const javascript = Buffer.from('export const sample = "static";\n'.repeat(2000));
    fs.writeFileSync(join(directory, 'vendor', 'gui.js'), javascript);
    fs.writeFileSync(join(directory, 'image.svg'), '<svg>'.repeat(1000));
    for (const name of ['index.html', 'sound.wav', 'image.png'])
      fs.writeFileSync(join(directory, name), 'unchanged'.repeat(2000));
    fs.writeFileSync(join(directory, 'small.json'), '{}');
    assert.deepEqual(precompressStaticAssets(directory), { files: 2 });
    const encoded = fs.readFileSync(join(directory, 'vendor', 'gui.js.gz'));
    assert.deepEqual(gunzipSync(encoded), javascript);
    assert.deepEqual(fs.readFileSync(join(directory, 'vendor', 'gui.js')), javascript);
    assert.ok(encoded.length < javascript.length / 2);
    precompressStaticAssets(directory);
    assert.deepEqual(fs.readFileSync(join(directory, 'vendor', 'gui.js.gz')), encoded);
    for (const name of ['index.html', 'sound.wav', 'image.png', 'small.json'])
      assert.equal(fs.existsSync(join(directory, `${name}.gz`)), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
