import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface NativeSession {
  setZoom(factor: 1 | 2): Promise<{ factor: number }>;
  close(failure?: { error: unknown }): Promise<void>;
}

type Outcome = { ok: true } | { ok: false; error: unknown };
type Fault =
  | 'launch_error'
  | 'evidence_prepare_error'
  | 'cookies_error'
  | 'worker_wait_error'
  | 'control_goto_error'
  | 'after_zoom_write_error'
  | 'reset_reject'
  | 'reset_wrong_readback'
  | 'reset_pending'
  | 'trace_receipt_error'
  | 'trace_receipt_pending'
  | 'context_close_error'
  | 'context_close_pending'
  | 'remove_error';

const helperPath = new URL('../../e2e/course-editor-native-zoom.ts', import.meta.url);
const callerPath = new URL('../../e2e/learning-author-preview.spec.ts', import.meta.url);
const compile = (source: string) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
const helper = compile(readFileSync(helperPath, 'utf8'));

// Keep the real selected case's catch/finally. Only its browser-dependent try
// body is replaced by an injected operation; no assertion or cleanup is copied.
const caller = ts.createSourceFile(
  callerPath.pathname,
  readFileSync(callerPath, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
let nativeStage: ts.TryStatement | undefined;
function findNativeStage(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(caller) === 'nativeBrowserZoom') {
    function findArrow(child: ts.Node): void {
      if (ts.isArrowFunction(child) && ts.isBlock(child.body)) {
        nativeStage = child.body.statements.find(ts.isTryStatement);
        return;
      }
      ts.forEachChild(child, findArrow);
    }
    ts.forEachChild(node, findArrow);
    return;
  }
  ts.forEachChild(node, findNativeStage);
}
findNativeStage(caller);
if (!nativeStage?.finallyBlock) throw new Error('Missing actual native-stage cleanup.');
const callerLifecycle = compile(`
  exports.runNativeStage = async (native, operation) => {
    let nativeFailure;
    try { await operation(); }
    ${nativeStage.catchClause?.getText(caller) ?? ''}
    finally ${nativeStage.finallyBlock.getText(caller)}
  };
`);

function harness(options: { faults?: Fault[]; ci?: boolean; ambiguous?: boolean } = {}) {
  const events: Array<{ name: string; args: unknown[] }> = [];
  const errors = new Map<Fault, Error>();
  const faults = new Set(options.faults);
  const ownedDirectory = '/pure-owned/asa-course-native-zoom-case';
  const record = (name: string, ...args: unknown[]) => events.push({ name, args });
  const fail = (key: Fault) => {
    if (!faults.has(key)) return;
    const error = errors.get(key) ?? new Error('injected:' + key);
    errors.set(key, error);
    throw error;
  };
  const pending = () => new Promise<void>(() => {});
  let zoom = 1;
  let hasZoomed = false;
  let lastFactor = 1;
  let settings = { mode: 'automatic', scope: 'per-tab' };
  let targetUrl = 'about:blank';
  const target = { url: () => targetUrl, bringToFront: async () => record('bringToFront') };
  const control = {
    goto: async (url: string) => {
      record('control.goto', url);
      fail('control_goto_error');
    },
    evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
  };
  const context = {
    tracing: {
      start: async () => {
        record('unexpected.runnerTraceStart');
        throw new Error('Runner owns trace.start: native helper must not start tracing.');
      },
      stop: async () => {
        record('unexpected.runnerTraceStop');
        throw new Error('Runner owns trace.stop: native helper must not stop tracing.');
      },
    },
    addCookies: async (cookies: unknown) => {
      record('addCookies', cookies);
      fail('cookies_error');
    },
    serviceWorkers: () =>
      faults.has('worker_wait_error')
        ? []
        : [{ url: () => 'chrome-extension://owned-extension/background.js' }],
    waitForEvent: async (event: string) => {
      record('waitForEvent', event);
      fail('worker_wait_error');
    },
    newPage: async () => control,
    pages: () => [target, control],
    close: async () => {
      record('context.close');
      fail('context_close_error');
      if (faults.has('context_close_pending')) await pending();
    },
  };
  const filesystem = {
    mkdtemp: async (prefix: string) => {
      record('mkdtemp', prefix);
      return ownedDirectory;
    },
    mkdir: async (location: string) => {
      record('mkdir', location);
      if (location === '/pure-evidence') fail('evidence_prepare_error');
    },
    writeFile: async (location: string, data: string) => {
      if (location.endsWith('/native-zoom-trace-ownership.json')) {
        record('trace.receipt', location, data);
        fail('trace_receipt_error');
        if (faults.has('trace_receipt_pending')) await pending();
      } else record('writeFile', location, data);
    },
    rm: async (location: string, args: unknown) => {
      record('rm', location, args);
      fail('remove_error');
    },
  };
  const sandbox = {
    exports: {} as {
      openCourseNativeZoom: (source: unknown, evidence: string) => Promise<NativeSession>;
      runNativeStage: (session: NativeSession, operation: () => Promise<void>) => Promise<void>;
    },
    process: { env: { CI: options.ci === false ? 'false' : 'true' } },
    URL,
    Error,
    AggregateError,
    setTimeout,
    clearTimeout,
    chrome: {
      tabs: {
        query: async () => {
          record('tabs.query');
          return options.ambiguous
            ? [
                { id: 7, url: targetUrl },
                { id: 8, url: targetUrl },
              ]
            : [{ id: 7, url: targetUrl }];
        },
        setZoomSettings: async (id: number, value: typeof settings) => {
          record('tabs.setZoomSettings', id, value);
          settings = value;
        },
        setZoom: async (id: number, value: number) => {
          record('tabs.setZoom', id, value);
          lastFactor = value;
          if (value === 1 && hasZoomed) {
            fail('reset_reject');
            if (faults.has('reset_pending')) await pending();
          }
          zoom = value;
          if (value === 2) {
            hasZoomed = true;
            fail('after_zoom_write_error');
          }
        },
        getZoom: async (id: number) => {
          record('tabs.getZoom', id);
          return lastFactor === 1 && hasZoomed && faults.has('reset_wrong_readback') ? 2 : zoom;
        },
        getZoomSettings: async (id: number) => {
          record('tabs.getZoomSettings', id);
          return settings;
        },
      },
    },
    require: (specifier: string) => {
      if (specifier === '@playwright/test')
        return {
          chromium: {
            launchPersistentContext: async (profile: string, args: unknown) => {
              record('launch', profile, args);
              fail('launch_error');
              return context;
            },
          },
        };
      if (specifier === 'node:fs/promises') return filesystem;
      if (specifier === 'node:os') return { tmpdir: () => '/pure-owned' };
      if (specifier === 'node:path') return path;
      throw new Error('Unexpected native-helper import: ' + specifier);
    },
  };
  runInNewContext(helper + '\n' + callerLifecycle, sandbox, { timeout: 1000 });
  const source = {
    url: () => 'http://127.0.0.1:4612/#/challenges',
    context: () => ({ cookies: async () => [{ name: 'synthetic', value: 'run-owned' }] }),
  };
  async function run(operation: (session: NativeSession) => Promise<void>): Promise<Outcome> {
    try {
      const session = await sandbox.exports.openCourseNativeZoom(source, '/pure-evidence');
      targetUrl = source.url();
      await sandbox.exports.runNativeStage(session, () => operation(session));
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }
  return {
    events,
    errors,
    run,
    zoomCalls: () =>
      events.filter(({ name }) => name === 'tabs.setZoom').map(({ args }) => args[1]),
    expectOwnedCleanup: () => {
      expect(events.filter(({ name }) => name === 'context.close')).toHaveLength(1);
      expect(events.filter(({ name }) => name === 'rm')).toEqual([
        { name: 'rm', args: [ownedDirectory, { recursive: true, force: true }] },
      ]);
      expect(events.at(-1)?.name).toBe('rm');
    },
  };
}

function failureOf(outcome: Outcome): unknown {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error('Expected the scenario to fail.');
  return outcome.error;
}

async function zoomIn(session: NativeSession): Promise<void> {
  await session.setZoom(1);
  await session.setZoom(2);
}

describe('Course Editor native zoom lifecycle without a browser or profile', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('preserves the explicit successful 100% → 200% → 100% readback sequence', async () => {
    const test = harness();
    const outcome = await test.run(async (session) => {
      await zoomIn(session);
      expect((await session.setZoom(1)).factor).toBe(1);
    });
    expect(outcome).toEqual({ ok: true });
    expect(test.zoomCalls()).toEqual([1, 2, 1]);
    expect(test.events.filter(({ name }) => name === 'tabs.getZoom')).toHaveLength(3);
    test.expectOwnedCleanup();
  });

  it('resets and reads 100% after the real caller receives a later assertion failure', async () => {
    const test = harness();
    const original = new Error('injected:later geometry/expect failure');
    const outcome = await test.run(async (session) => {
      await zoomIn(session);
      throw original;
    });
    expect(failureOf(outcome)).toBe(original);
    expect(test.zoomCalls()).toEqual([1, 2, 1]);
    expect(test.events.filter(({ name }) => name === 'tabs.getZoom')).toHaveLength(3);
    const names = test.events.map(({ name }) => name);
    expect(names.lastIndexOf('tabs.getZoom')).toBeLessThan(names.indexOf('trace.receipt'));
    expect(names.indexOf('trace.receipt')).toBeLessThan(names.indexOf('context.close'));
    expect(names.some((name) => name.startsWith('unexpected.runnerTrace'))).toBe(false);
    test.expectOwnedCleanup();
  });

  it('attempts reset even when the 200% call changes zoom and then rejects', async () => {
    const test = harness({ faults: ['after_zoom_write_error'] });
    const outcome = await test.run(zoomIn);
    expect(failureOf(outcome)).toBe(test.errors.get('after_zoom_write_error'));
    expect(test.zoomCalls()).toEqual([1, 2, 1]);
    test.expectOwnedCleanup();
  });

  it.each([
    'reset_reject',
    'reset_wrong_readback',
    'trace_receipt_error',
    'context_close_error',
    'remove_error',
  ] as const)('fails an otherwise successful scenario when cleanup reports %s', async (fault) => {
    const test = harness({ faults: [fault] });
    const error = failureOf(await test.run(zoomIn));
    expect(error).toBeInstanceOf(AggregateError);
    const failures = (error as AggregateError).errors;
    expect(failures).toHaveLength(1);
    if (fault === 'reset_wrong_readback') expect(String(failures[0])).toMatch(/reset.*1/i);
    else expect(failures[0]).toBe(test.errors.get(fault));
    expect(test.zoomCalls()).toEqual([1, 2, 1]);
    test.expectOwnedCleanup();
  });

  it.each([
    'reset_reject',
    'reset_wrong_readback',
    'trace_receipt_error',
    'context_close_error',
    'remove_error',
  ] as const)('preserves the original scenario error when cleanup reports %s', async (fault) => {
    const test = harness({ faults: [fault] });
    const original = new Error('original assertion');
    const outcome = await test.run(async (session) => {
      await zoomIn(session);
      throw original;
    });
    expect(failureOf(outcome)).toBe(original);
    expect(test.zoomCalls()).toEqual([1, 2, 1]);
    test.expectOwnedCleanup();
  });

  it.each(['reset_pending', 'trace_receipt_pending', 'context_close_pending'] as const)(
    'bounds unresolved %s, reports failure and still removes the owned profile',
    async (fault) => {
      const test = harness({ faults: [fault] });
      const pending = test.run(zoomIn);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(4999);
      expect(test.events.some(({ name }) => name === 'rm')).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      const error = failureOf(await pending);
      expect(error).toBeInstanceOf(AggregateError);
      expect(String((error as AggregateError).errors[0])).toMatch(/timed out.*5000/);
      test.expectOwnedCleanup();
    },
  );

  it('keeps the original assertion after an unresolved reset reaches its bound', async () => {
    const test = harness({ faults: ['reset_pending'] });
    const original = new Error('original assertion');
    const pending = test.run(async (session) => {
      await zoomIn(session);
      throw original;
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(failureOf(await pending)).toBe(original);
    expect(test.zoomCalls()).toEqual([1, 2, 1]);
    test.expectOwnedCleanup();
  });

  it.each([false, true])(
    'retains all cleanup attempts with multiple faults; primary=%s',
    async (hasPrimary) => {
      const test = harness({
        faults: ['reset_reject', 'trace_receipt_error', 'context_close_error'],
      });
      const original = new Error('original assertion');
      const outcome = await test.run(async (session) => {
        await zoomIn(session);
        if (hasPrimary) throw original;
      });
      const error = failureOf(outcome);
      if (hasPrimary) expect(error).toBe(original);
      else {
        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).errors).toEqual([
          test.errors.get('reset_reject'),
          test.errors.get('trace_receipt_error'),
          test.errors.get('context_close_error'),
        ]);
      }
      expect(test.zoomCalls()).toEqual([1, 2, 1]);
      test.expectOwnedCleanup();
    },
  );

  it('keeps the runner-owned trace receipt without manual start or stop', async () => {
    const test = harness();
    expect(await test.run(zoomIn)).toEqual({ ok: true });
    const receipts = test.events.filter(({ name }) => name === 'trace.receipt');
    expect(receipts).toHaveLength(1);
    expect(JSON.parse(String(receipts[0]!.args[1]))).toMatchObject({
      owner: 'Playwright Test',
      mode: 'retain-on-failure',
      directTracingCalls: false,
    });
    expect(test.events.some(({ name }) => name.startsWith('unexpected.runnerTrace'))).toBe(false);
    test.expectOwnedCleanup();
  });

  it('does not mistake a thrown undefined for a successful scenario', async () => {
    const test = harness({ faults: ['trace_receipt_error'] });
    const outcome = await test.run(async (session) => {
      await zoomIn(session);
      throw undefined;
    });
    expect(failureOf(outcome)).toBeUndefined();
    test.expectOwnedCleanup();
  });

  it('fails closed outside CI without touching even the stub browser or filesystem', async () => {
    const test = harness({ ci: false });
    expect(String(failureOf(await test.run(zoomIn)))).toContain('requires the isolated CI');
    expect(test.events).toEqual([]);
  });

  it('removes the owned directory if browser launch itself rejects', async () => {
    const test = harness({ faults: ['launch_error'] });
    expect(failureOf(await test.run(zoomIn))).toBe(test.errors.get('launch_error'));
    expect(test.events.some(({ name }) => name === 'context.close')).toBe(false);
    expect(test.events.at(-1)).toEqual({
      name: 'rm',
      args: ['/pure-owned/asa-course-native-zoom-case', { recursive: true, force: true }],
    });
  });

  it.each([
    'evidence_prepare_error',
    'cookies_error',
    'worker_wait_error',
    'control_goto_error',
  ] as const)('preserves setup failure %s even if context close also rejects', async (fault) => {
    const test = harness({ faults: [fault, 'context_close_error'] });
    expect(failureOf(await test.run(zoomIn))).toBe(test.errors.get(fault));
    expect(test.zoomCalls()).toEqual([]);
    test.expectOwnedCleanup();
  });

  it('keeps exact-tab ambiguity fail-closed and still cleans up', async () => {
    const test = harness({ ambiguous: true });
    expect(String(failureOf(await test.run(zoomIn)))).toContain('one exact Course Editor tab');
    expect(test.zoomCalls()).toEqual([]);
    test.expectOwnedCleanup();
  });
});
