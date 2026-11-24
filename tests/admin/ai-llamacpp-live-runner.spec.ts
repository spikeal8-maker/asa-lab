import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const SHA = '7a'.repeat(20);
const OLD_SHA = '8b'.repeat(20);
const TREE = '9c'.repeat(20);
const RECEIPT = 'reports/ai-llamacpp-live-build.json';
const mockedModules = ['node:child_process', 'node:fs', 'node:process', 'node:console'];

class Refused extends Error {
  constructor(readonly status: number) {
    super('Isolated runner refused');
  }
}

function output(api: string, revision = SHA): Record<string, string> {
  return {
    'apps/api/dist/main.js': api,
    'apps/api/dist/ai/adapter.js': 'export const adapter = "' + api + '";',
    'apps/web/dist/build-metadata.json': JSON.stringify({ revision }),
    'apps/web/dist/assets/app.js': 'export const revision = "' + revision + '";',
    'apps/web/dist/index.html': '<main>' + api + '</main>',
  };
}

// Independent expected digest over known fixture bytes. No source-text matching,
// production function calls, or filesystem access is involved in the oracle.
function expectedDigest(files: Record<string, string>, directory: string): string {
  const entries = Object.entries(files)
    .filter(([name]) => name.startsWith(directory + '/'))
    .map(([name, text]) => [name.slice(directory.length + 1), Buffer.from(text)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256')
    .update(
      Buffer.concat(
        entries.flatMap(([name, bytes]) => [Buffer.from(name + '\0' + bytes.length + '\0'), bytes]),
      ),
    )
    .digest('hex');
}

function harness() {
  const oldOutput = output('OLD_API', SHA);
  const files = new Map(Object.entries(oldOutput).map(([name, text]) => [name, Buffer.from(text)]));
  const build = Object.assign(new EventEmitter(), { kill: vi.fn() });
  const browser = Object.assign(new EventEmitter(), { kill: vi.fn() });
  let announceBuild: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    announceBuild = resolve;
  });
  const state = { head: SHA, dirty: '', events: [] as string[] };
  const environment: Record<string, string | undefined> = {
    ASA_LLAMACPP_LIVE_SHA: SHA,
    TEST_DATABASE_URL:
      'postgresql://test_admin:fixture@127.0.0.1:5432/asa_llamacpp_live_fixture_test',
    APP_TEST_DATABASE_URL:
      'postgresql://asalab_app:fixture@127.0.0.1:5432/asa_llamacpp_live_fixture_test',
    ASA_LLAMACPP_LIVE_ENDPOINT: 'http://127.0.0.1:8080',
    ASA_SETTINGS_ENCRYPTION_KEY: 'fixture-encryption-key',
  };
  const process = Object.assign(new EventEmitter(), {
    env: environment,
    platform: 'linux',
    execPath: '/isolated-fixture/node',
    exitCode: undefined as number | undefined,
    exit: vi.fn((status: number): never => {
      throw new Refused(status);
    }),
  });
  const spawn = vi.fn(
    (command: string, args: string[], options: { env: Record<string, string | undefined> }) => {
      if (command === 'corepack' && args.includes('nx') && args.includes('build')) {
        state.events.push('build-start');
        announceBuild();
        return build;
      }
      if (command === process.execPath && args[0] === 'node_modules/@playwright/test/cli.js') {
        state.events.push('browser-start');
        return browser;
      }
      throw new Error(
        'Unexpected subprocess was blocked: ' +
          command +
          ' ' +
          args.join(' ') +
          ' ' +
          Object.keys(options.env).join(','),
      );
    },
  );
  const execFileSync = vi.fn((command: string, args: string[]) => {
    if (command !== 'git') throw new Error('Unexpected command was blocked');
    if (args.join(' ') === 'rev-parse HEAD') return state.head + '\n';
    if (args.join(' ') === 'rev-parse HEAD^{tree}') return TREE + '\n';
    if (args.join(' ') === 'status --porcelain=v1 -uno') return state.dirty;
    throw new Error('Unexpected Git operation was blocked');
  });
  const readFileSync = vi.fn((name: string, encoding?: string) => {
    state.events.push('read:' + name);
    const bytes = files.get(name);
    if (!bytes) throw new Error('Missing isolated fixture file: ' + name);
    return encoding === 'utf8' ? bytes.toString('utf8') : Buffer.from(bytes);
  });
  const readdirSync = vi.fn((directory: string) => {
    const prefix = directory + '/';
    const names = [
      ...new Set(
        [...files.keys()]
          .filter((name) => name.startsWith(prefix))
          .map((name) => name.slice(prefix.length).split('/')[0]!),
      ),
    ];
    if (!names.length) throw new Error('Missing isolated fixture directory: ' + directory);
    return names.reverse().map((name) => ({
      name,
      isFile: () => files.has(prefix + name),
      isDirectory: () => [...files.keys()].some((file) => file.startsWith(prefix + name + '/')),
    }));
  });
  const statSync = vi.fn((name: string) => {
    const bytes = files.get(name);
    if (!bytes) throw new Error('Missing isolated fixture file: ' + name);
    return { isFile: () => true, size: bytes.length, mode: 0o100600 };
  });
  const mkdirSync = vi.fn((name: string) => {
    if (name !== 'reports') throw new Error('Unexpected directory write was blocked');
  });
  const writeFileSync = vi.fn((name: string, data: string) => {
    if (name !== RECEIPT) throw new Error('Unexpected file write was blocked');
    state.events.push('receipt-written');
    files.set(name, Buffer.from(data));
  });
  vi.doMock('node:child_process', () => ({ spawn, execFileSync }));
  vi.doMock('node:process', () => ({ default: process }));
  vi.doMock('node:console', () => ({ default: { error: vi.fn() } }));
  vi.doMock('node:fs', () => ({ readFileSync, readdirSync, statSync, mkdirSync, writeFileSync }));
  const run = () => import('../../tools/ai-llamacpp-live.mjs');
  return {
    oldOutput,
    files,
    state,
    process,
    spawn,
    build,
    browser,
    readFileSync,
    writeFileSync,
    run,
    async startBuild() {
      const execution = run();
      await Promise.race([
        started,
        execution.then(() => {
          throw new Error('Runner completed without a build');
        }),
      ]);
      return { execution };
    },
    finishBuild(freshOutput: Record<string, string>, status = 0) {
      for (const [name, text] of Object.entries(freshOutput)) files.set(name, Buffer.from(text));
      state.events.push('build-exit');
      build.emit('exit', status);
    },
    browserCalls() {
      return spawn.mock.calls.filter(([command]) => command === process.execPath);
    },
  };
}

afterEach(() => {
  for (const module of mockedModules) vi.doUnmock(module);
  vi.resetModules();
});

it('waits for a fresh uncached successful build and binds the receipt to its new API and Web bytes before the browser starts', async () => {
  const h = harness();
  const { execution } = await h.startBuild();
  expect(h.browserCalls()).toHaveLength(0);
  expect(h.readFileSync).not.toHaveBeenCalled();
  expect(h.writeFileSync).not.toHaveBeenCalled();
  const buildCall = h.spawn.mock.calls[0]!;
  expect(buildCall[1]).toEqual(
    expect.arrayContaining(['identity', 'api', 'web', '--skip-nx-cache']),
  );
  expect(buildCall[2].env).toMatchObject({
    ASA_BUILD_REVISION: SHA,
    VITE_ASA_BUILD_REVISION: SHA,
    NX_SKIP_NX_CACHE: 'true',
    NX_SKIP_REMOTE_CACHE: 'true',
  });
  for (const name of [
    'TEST_DATABASE_URL',
    'APP_TEST_DATABASE_URL',
    'ASA_LLAMACPP_LIVE_ENDPOINT',
    'ASA_SETTINGS_ENCRYPTION_KEY',
  ])
    expect(buildCall[2].env).not.toHaveProperty(name);
  const fresh = output('FRESH_API');
  h.finishBuild(fresh);
  await execution;
  expect(h.browserCalls()).toHaveLength(1);
  expect(h.state.events.indexOf('build-exit')).toBeLessThan(
    h.state.events.indexOf('receipt-written'),
  );
  expect(h.state.events.indexOf('receipt-written')).toBeLessThan(
    h.state.events.indexOf('browser-start'),
  );
  const receipt = JSON.parse(h.files.get(RECEIPT)!.toString('utf8'));
  expect(receipt).toMatchObject({
    sourceSha: SHA,
    sourceTree: TREE,
    apiDistSha256: expectedDigest(fresh, 'apps/api/dist'),
    webDistSha256: expectedDigest(fresh, 'apps/web/dist'),
  });
  expect(receipt.apiDistSha256).not.toBe(expectedDigest(h.oldOutput, 'apps/api/dist'));
  h.browser.emit('exit', 0);
  expect(h.process.exitCode).toBe(0);
});

it.each(['exit', 'error'] as const)(
  'blocks the browser and receipt after a build %s failure even if old outputs claim the candidate SHA',
  async (failure) => {
    const h = harness();
    const { execution } = await h.startBuild();
    const rejected = expect(execution).rejects.toMatchObject({ status: 78 });
    if (failure === 'exit') h.finishBuild({}, 1);
    else h.build.emit('error', new Error('isolated build failure'));
    await rejected;
    expect(h.browserCalls()).toHaveLength(0);
    expect(h.readFileSync).not.toHaveBeenCalled();
    expect(h.writeFileSync).not.toHaveBeenCalled();
  },
);

it.each(['missing-sha', 'invalid-sha', 'different-head', 'dirty-source'] as const)(
  'refuses %s before starting any build or browser',
  async (guard) => {
    const h = harness();
    if (guard === 'missing-sha') delete h.process.env.ASA_LLAMACPP_LIVE_SHA;
    if (guard === 'invalid-sha') h.process.env.ASA_LLAMACPP_LIVE_SHA = 'main';
    if (guard === 'different-head') h.state.head = OLD_SHA;
    if (guard === 'dirty-source') h.state.dirty = ' M apps/api/src/main.ts\n';
    await expect(h.run()).rejects.toMatchObject({ status: 78 });
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.readFileSync).not.toHaveBeenCalled();
    expect(h.writeFileSync).not.toHaveBeenCalled();
  },
);

it.each(['different-head', 'dirty-source'] as const)(
  'rechecks %s after the build and refuses to certify a changing checkout',
  async (guard) => {
    const h = harness();
    const { execution } = await h.startBuild();
    if (guard === 'different-head') h.state.head = OLD_SHA;
    else h.state.dirty = ' M apps/api/src/main.ts\n';
    h.finishBuild(output('FRESH_API'));
    await expect(execution).rejects.toMatchObject({ status: 78 });
    expect(h.browserCalls()).toHaveLength(0);
    expect(h.writeFileSync).not.toHaveBeenCalled();
  },
);

it('blocks live acceptance when the successful build produces Web metadata for another SHA', async () => {
  const h = harness();
  const { execution } = await h.startBuild();
  h.finishBuild(output('FRESH_API', OLD_SHA));
  await expect(execution).rejects.toMatchObject({ status: 78 });
  expect(h.browserCalls()).toHaveLength(0);
  expect(h.writeFileSync).not.toHaveBeenCalled();
});
