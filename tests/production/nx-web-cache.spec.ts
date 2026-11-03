import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
// Exercise the installed, pinned Nx hasher rather than reproducing its rules.
const { NativeTaskHasherImpl } = require('nx/src/hasher/native-task-hasher-impl.js');
const { testOnlyTransferFileMap } = require('nx/src/native/index.js');
const root = resolve(import.meta.dirname, '../..');
const project = JSON.parse(readFileSync(join(root, 'apps/web/project.json'), 'utf8'));
const nx = JSON.parse(readFileSync(join(root, 'nx.json'), 'utf8'));
const task = {
  id: 'web:build',
  target: { project: 'web', target: 'build' },
  overrides: {},
  outputs: [],
  cache: true,
};
const graph = {
  nodes: { web: { name: 'web', type: 'app', data: { ...project, root: 'apps/web' } } },
  dependencies: { web: [] },
  externalNodes: {},
};
const taskGraph = {
  roots: [task.id],
  tasks: { [task.id]: task },
  dependencies: { [task.id]: [] },
  continuousDependencies: {},
};
const fixtures: string[] = [];
const temporaryRoot = resolve(tmpdir());
function fixture() {
  const directory = mkdtempSync(join(temporaryRoot, 'asa-web-cache-'));
  fixtures.push(directory);
  return directory;
}
afterAll(() => {
  for (const directory of fixtures) {
    if (
      dirname(resolve(directory)) !== temporaryRoot ||
      !basename(directory).startsWith('asa-web-cache-')
    )
      throw new Error('Unsafe cache-test fixture cleanup');
    rmSync(directory, { recursive: true, force: true });
  }
});

const environment = {
  ...process.env,
  VITE_ASA_BUILD_REVISION: 'a'.repeat(40),
  VITE_ASA_BUILT_AT: '2026-11-03T00:00:00.000Z',
  VITE_ASA_BLOCKS_PREVIEW: '0',
  VITE_ASA_BLOCKS_RUNTIME_ORIGIN: '',
  ASA_CAPTURE_PUBLICATION_GRAPH: 'false',
  ASA_WEB_PORT: '4610',
  ASA_API_PORT: '4611',
  NODE_ENV: 'production',
};
async function hash(env: Record<string, string | undefined> = environment) {
  const hasher = new NativeTaskHasherImpl(
    root,
    nx,
    graph,
    testOnlyTransferFileMap({ web: [] }, []),
    { selectivelyHashTsConfig: false },
  );
  return (await hasher.hashTask(task, taskGraph, env, root)).value;
}

// Nx memoizes runtime commands within an invocation. A Git HEAD change between
// builds needs separate invocations without changing the actual repository.
function isolatedHash(env: Record<string, string | undefined>) {
  const script = `
    const { root, nx, graph, task, taskGraph, implementation, native } = JSON.parse(process.argv[1]);
    const { NativeTaskHasherImpl } = require(implementation);
    const { testOnlyTransferFileMap } = require(native);
    const hasher = new NativeTaskHasherImpl(root, nx, graph,
      testOnlyTransferFileMap({web: []}, []), {selectivelyHashTsConfig: false});
    hasher.hashTask(task, taskGraph, process.env, root).then(result => process.stdout.write(result.value));
  `;
  return execFileSync(
    process.execPath,
    [
      '-e',
      script,
      JSON.stringify({
        root,
        nx,
        graph,
        task,
        taskGraph,
        implementation: require.resolve('nx/src/hasher/native-task-hasher-impl.js'),
        native: require.resolve('nx/src/native/index.js'),
      }),
    ],
    { env, cwd: root, encoding: 'utf8', windowsHide: true },
  );
}

describe('Web build cache identity', () => {
  it('reuses the same key for identical build inputs', async () => {
    expect(await hash()).toBe(await hash());
  });

  it.each([
    ['VITE_ASA_BUILD_REVISION', 'b'.repeat(40)],
    ['VITE_ASA_BUILT_AT', '2026-11-03T01:00:00.000Z'],
    ['VITE_ASA_BLOCKS_PREVIEW', '1'],
    ['VITE_ASA_BLOCKS_RUNTIME_ORIGIN', 'https://preview.example.test'],
    ['ASA_CAPTURE_PUBLICATION_GRAPH', 'true'],
    ['ASA_WEB_PORT', '3000'],
    ['ASA_API_PORT', 'invalid'],
    ['NODE_ENV', 'development'],
  ])('invalidates a cached artifact when %s changes', async (name, value) => {
    expect(await hash({ ...environment, [name]: value })).not.toBe(await hash());
  });

  it('binds fallback revision to Git output across separate builds', () => {
    const directory = fixture();
    const head = join(directory, 'HEAD');
    const hook = join(directory, 'git-output.cjs');
    // Only the external Git result is simulated: the configured helper, native
    // Nx runtime command and cache key are real. This also runs without Git in
    // the isolated test image. No actual checkout or process-global env changes.
    writeFileSync(
      hook,
      `
      const child = require('node:child_process');
      const original = child.execFileSync;
      child.execFileSync = function(command, args, options) {
        if (command === 'git' && JSON.stringify(args) === '["rev-parse","HEAD"]')
          return require('node:fs').readFileSync(process.env.ASA_CACHE_TEST_HEAD, 'utf8');
        return original(command, args, options);
      };
      require('node:module').syncBuiltinESMExports();
    `,
    );
    writeFileSync(head, `${'b'.repeat(40)}\n`);
    const env = {
      ...environment,
      VITE_ASA_BUILD_REVISION: ' ',
      ASA_CACHE_TEST_HEAD: head,
      NODE_OPTIONS:
        `${process.env.NODE_OPTIONS ?? ''} --require "${hook.replaceAll('\\', '/')}"`.trim(),
    };
    const first = isolatedHash(env);
    writeFileSync(head, `${'c'.repeat(40)}\n`);
    expect(isolatedHash(env)).not.toBe(first);
    expect(
      isolatedHash({ ...env, VITE_ASA_BUILD_REVISION: environment.VITE_ASA_BUILD_REVISION }),
    ).toBe(isolatedHash(environment));
  });

  it('supports source archives without Git when revision is explicit or unavailable', async () => {
    const directory = fixture();
    const unavailable = { ...environment, GIT_DIR: join(directory, 'no-repository') };
    expect(isolatedHash(unavailable)).toBe(isolatedHash(environment));
    const absent = { ...unavailable, VITE_ASA_BUILD_REVISION: '' };
    expect(isolatedHash(absent)).toBe(isolatedHash(absent));
    expect(
      execFileSync(process.execPath, ['tools/web-build-revision.mjs'], {
        env: absent,
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      }),
    ).toBe('development');
  });
});
