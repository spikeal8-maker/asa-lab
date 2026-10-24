import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import {
  beginPhaseTrace,
  installPhaseProbe,
  parsePhaseTrace,
  PHASE_PREFIX,
  readPhaseStream,
  TRACE_LIMIT,
} from '../../e2e/arduino-682-phase-probe';

const workerSource = readFileSync('apps/web/src/electronics/simulation.worker.ts', 'utf8');
function worker(enabled = true, markThrows = false, postThrows = false) {
  const response = { ok: true, projectSessionId: 'session', generationId: 1, requestId: 'r1' };
  const request = {
    ...response,
    kind: 'preflight',
    protocolVersion: 1,
    engineRevision: 'revision',
  };
  const calls: unknown[][] = [];
  const clock = {
    timeOrigin: 1000,
    now: vi.fn(() => 20),
    mark: vi.fn((name: string) => {
      void name;
      if (markThrows) throw new Error('mark');
    }),
    clearMarks: vi.fn(),
  };
  const scope = {
    location: enabled
      ? { href: 'https://asa/worker?asa682phase=v1&asa682instance=run-1' }
      : undefined,
    postMessage: function (...args: unknown[]) {
      calls.push([this, ...args]);
      if (postThrows) throw new Error('native-post');
    },
    onmessage: null as null | ((event: { data: unknown }) => void),
  };
  const exports: Record<string, unknown> = {};
  const evaluate = vi.fn(() => response);
  runInNewContext(
    ts.transpileModule(workerSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
      .outputText,
    {
      Error,
      self: scope,
      performance: clock,
      URL,
      exports,
      require: (name: string) =>
        name.endsWith('evaluator')
          ? {
              evaluateSimulationWorkerRequest: evaluate,
              evaluateSimulationWorkerRequestBatched: async () => response,
            }
          : {
              ELECTRONICS_SIMULATION_WORKER_PROTOCOL: 1,
              ELECTRONICS_SIMULATION_ENGINE_REVISION: 'revision',
            },
    },
  );
  return { scope, request, response, clock, calls, evaluate };
}

const phases = ['request-received', 'response-ready', 'send-call', 'send-return', 'main-receipt'];
const row = (phase: string, epoch: number, id = 'r1', generation = 1) => ({
  phase,
  epoch,
  id,
  generation,
  instance: 'run-1',
  session: 'session',
});
const trace = (rows = phases.map((phase, i) => row(phase, 1000 + i))) =>
  JSON.stringify({
    traceEvents: rows.map((data) => ({
      name: PHASE_PREFIX + encodeURIComponent(JSON.stringify(data)),
      cat: 'blink.user_timing',
      ph: 'I',
    })),
  });

describe('682 Worker opt-in transparency', () => {
  it('disabled bootstrap tolerates mock scope without location and makes zero clock/mark calls', () => {
    const w = worker(false);
    w.scope.onmessage!({ data: w.request });
    expect(w.calls).toEqual([[w.scope, w.response]]);
    expect(w.calls[0]![1]).toBe(w.response);
    expect(w.clock.now).not.toHaveBeenCalled();
    expect(w.clock.mark).not.toHaveBeenCalled();
    expect(w.clock.clearMarks).not.toHaveBeenCalled();
  });
  it('enabled emits four bounded versioned epochs and clears each mark without changing identity', () => {
    const w = worker();
    w.scope.onmessage!({ data: w.request });
    expect(w.calls).toEqual([[w.scope, w.response]]);
    expect(w.calls[0]![1]).toBe(w.response);
    expect(
      w.clock.mark.mock.calls.map(([name]) =>
        JSON.parse(decodeURIComponent(name.slice(PHASE_PREFIX.length))),
      ),
    ).toEqual(phases.slice(0, 4).map((phase) => ({ ...row(phase, 1020), instance: 'run-1' })));
    expect(w.clock.clearMarks.mock.calls).toEqual(w.clock.mark.mock.calls);
  });
  it('mark failures cannot alter response or original native-post throw/catch behavior', () => {
    for (const enabled of [false, true]) {
      const w = worker(enabled, true, true);
      expect(() => w.scope.onmessage!({ data: w.request })).toThrow('native-post');
      expect(w.calls).toHaveLength(2);
      expect(w.calls[0]![1]).toBe(w.response);
      expect(w.calls[1]![1]).toMatchObject({ ok: false, message: 'native-post' });
    }
  });
});

describe('682 trace integrity and causal epochs', () => {
  it('decodes a complete trace and keeps compute/channel/send boundaries separate', () => {
    const report = parsePhaseTrace(trace(), 'run', false, [{ id: 'r1', generation: 1 }]);
    expect(report.verdict).toBe('OBSERVED_DIAGNOSTIC_ONLY');
    expect(report.groups[0]).toMatchObject({ evaluationMs: 1, channelMs: 2, sendMs: 1 });
    expect(report.interference).toBe('UNKNOWN_NONZERO');
  });
  it('allows main receipt before send return on the other thread', () => {
    expect(
      parsePhaseTrace(
        trace(phases.map((phase, i) => row(phase, phase === 'main-receipt' ? 1002.5 : 1000 + i))),
        'run',
      ).errors,
    ).toEqual([]);
  });
  it.each(['request-received', 'response-ready', 'send-call', 'send-return', 'main-receipt'])(
    'rejects missing or duplicate %s',
    (phase) => {
      const rows = phases.map((p, i) => row(p, 1000 + i));
      expect(parsePhaseTrace(trace(rows.filter((r) => r.phase !== phase)), 'run').verdict).toBe(
        'NOT_OBSERVED',
      );
      expect(
        parsePhaseTrace(trace([...rows, rows.find((r) => r.phase === phase)!]), 'run').verdict,
      ).toBe('NOT_OBSERVED');
    },
  );
  it('rejects loss, truncated JSON, missing first response coverage, foreign IDs and mixed generations', () => {
    expect(parsePhaseTrace(trace(), 'run', true).verdict).toBe('NOT_OBSERVED');
    expect(parsePhaseTrace(trace().slice(0, -1), 'run').verdict).toBe('NOT_OBSERVED');
    expect(parsePhaseTrace(trace(), 'run', false, [{ id: 'r0', generation: 1 }]).verdict).toBe(
      'NOT_OBSERVED',
    );
    expect(parsePhaseTrace(trace(), 'foreign').verdict).toBe('NOT_OBSERVED');
    expect(
      parsePhaseTrace(trace(phases.map((p, i) => row(p, 1000 + i, 'r1', i === 4 ? 2 : 1))), 'run')
        .verdict,
    ).toBe('NOT_OBSERVED');
  });
  it('keeps different sessions, worker instances and generations separate', () => {
    const rows = phases.map((p, i) => row(p, 1000 + i));
    expect(
      parsePhaseTrace(
        trace([
          ...rows,
          ...rows.map((r) => ({ ...r, instance: 'run-2', session: 'session2', generation: 2 })),
        ]),
        'run',
      ).groups,
    ).toHaveLength(2);
  });
  it('reads base64 and UTF8 through EOF and closes exactly the owned handle', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        data: Buffer.from('{').toString('base64'),
        base64Encoded: true,
        eof: false,
      })
      .mockResolvedValueOnce({ data: '}', eof: true })
      .mockResolvedValue({});
    expect(await readPhaseStream({ send }, 'owned')).toBe('{}');
    expect(send.mock.calls.at(-1)).toEqual(['IO.close', { handle: 'owned' }]);
  });
  it('retains primary read error identity and bytes when close independently fails', async () => {
    const primary = new Error('read-failure');
    const cleanup = new Error('close-failure');
    const prefix = '{"traceEvents":[';
    const send = vi
      .fn()
      .mockResolvedValueOnce({ data: prefix, eof: false })
      .mockRejectedValueOnce(primary)
      .mockRejectedValueOnce(cleanup);
    const caught = await readPhaseStream({ send }, 'owned').catch((error) => error);
    expect(caught).toBe(primary);
    expect(caught.partialTrace).toBe(prefix);
    expect(caught.partialTraceBytes).toEqual(Buffer.from(prefix));
    expect(caught.cleanupError).toBe(cleanup);
  });
  it('retains complete read bytes and close error identity after successful EOF', async () => {
    const cleanup = new Error('close-failure');
    const send = vi
      .fn()
      .mockResolvedValueOnce({ data: trace(), eof: true })
      .mockRejectedValueOnce(cleanup);
    const caught = await readPhaseStream({ send }, 'owned').catch((error) => error);
    expect(caught).toBe(cleanup);
    expect(caught.partialTrace).toBe(trace());
    expect(caught.partialTraceBytes).toEqual(Buffer.from(trace()));
    expect(caught.cleanupError).toBe(cleanup);
  });
  it.each([
    { data: '?', base64Encoded: true, eof: true },
    { data: '', eof: false },
    { data: '{}' },
    { data: Buffer.from([255]).toString('base64'), base64Encoded: true, eof: true },
    { data: 'x'.repeat(TRACE_LIMIT + 1), eof: true },
  ])('rejects encoding/EOF/stall/cap failures and closes', async (bad) => {
    const send = vi.fn().mockResolvedValueOnce(bad).mockResolvedValue({});
    await expect(readPhaseStream({ send }, 'owned')).rejects.toThrow();
    expect(send.mock.calls.at(-1)).toEqual(['IO.close', { handle: 'owned' }]);
  });
});

function browserProbe(markThrows = false) {
  const marks: string[] = [];
  const nativeCalls: unknown[][] = [];
  let listener: ((event: unknown) => void) | undefined;
  const clock = {
    timeOrigin: 1000,
    now: vi.fn(() => 10),
    mark: (name: string) => {
      if (markThrows) throw new Error('mark');
      marks.push(name);
    },
    clearMarks: vi.fn(),
  };
  class NativeWorker {
    constructor(...args: unknown[]) {
      nativeCalls.push([new.target, ...args]);
    }
    postMessage(...args: unknown[]) {
      nativeCalls.push([this, ...args]);
      if (args[0] === 'throw') throw new Error('native-post');
      return 'post-return';
    }
    addEventListener(_kind: string, callback: (event: unknown) => void) {
      listener = callback;
    }
  }
  class Element {
    component = 'led0';
    attribute = '';
    closest() {
      return this;
    }
    getAttribute(name: string) {
      return name === 'data-component-id' ? this.component : this.attribute;
    }
    setAttribute(...args: unknown[]) {
      nativeCalls.push([this, ...args]);
      if (args[1] === 'throw') throw new Error('native');
      this.attribute = String(args[1]);
      return 'native-return';
    }
    setAttributeNS(...args: unknown[]) {
      nativeCalls.push([this, ...args]);
      if (args[2] === 'throw') throw new Error('native');
      this.attribute = String(args[2]);
      return 'native-ns-return';
    }
  }
  const window = { Worker: NativeWorker };
  runInNewContext(`(${installPhaseProbe.toString()})('run')`, {
    window,
    Element,
    performance: clock,
    URL,
    document: { baseURI: 'https://asa/' },
  });
  return {
    window,
    Element,
    marks,
    nativeCalls,
    clock,
    receive: (response: unknown) =>
      listener!({
        get data() {
          expect(clock.now).toHaveBeenCalled();
          return response;
        },
      }),
  };
}

describe('682 genuine constructor and public attribute transparency', () => {
  it('preserves constructor options/newTarget and creates exactly one genuine Worker', () => {
    const b = browserProbe();
    const options = { name: 'asa-electronics-simulation', type: 'module' };
    const worker = new b.window.Worker(new URL('https://asa/worker?keep=1'), options);
    expect(worker).toBeInstanceOf(b.window.Worker);
    expect(b.nativeCalls).toHaveLength(1);
    expect(b.nativeCalls[0]![2]).toBe(options);
    const url = b.nativeCalls[0]![1] as URL;
    expect(url.searchParams.get('keep')).toBe('1');
    expect(url.searchParams.get('asa682phase')).toBe('v1');
    b.receive({ projectSessionId: 'session', generationId: 1, requestId: 'r1' });
    expect(JSON.parse(decodeURIComponent(b.marks[0]!.slice(PHASE_PREFIX.length)))).toMatchObject(
      row('main-receipt', 1010),
    );
  });
  it('forwards attribute args/receiver/return/throw and filters unrelated components/attributes', () => {
    const b = browserProbe();
    new b.window.Worker('https://asa/worker', { name: 'asa-electronics-simulation' });
    b.receive({ projectSessionId: 'session', generationId: 1, requestId: 'r1' });
    const element = new b.Element();
    expect(element.setAttribute('data-led-brightness', '0.5')).toBe('native-return');
    expect(b.nativeCalls.at(-1)).toEqual([element, 'data-led-brightness', '0.5']);
    expect(element.setAttributeNS('namespace', 'href', 'asset')).toBe('native-ns-return');
    expect(() => element.setAttribute('href', 'throw')).toThrow('native');
    const count = b.marks.length;
    element.setAttribute('class', 'unrelated');
    element.component = 'resistor';
    element.setAttribute('href', 'asset');
    expect(b.marks).toHaveLength(count);
    expect(
      b.marks.some((name) => decodeURIComponent(name).includes('NATIVE-ATTRIBUTE-PUBLICATION')),
    ).toBe(true);
  });
  it('contains mark failures and does not coerce attribute values a second time', () => {
    const b = browserProbe(true);
    new b.window.Worker('https://asa/worker', { name: 'asa-electronics-simulation' });
    b.receive({ projectSessionId: 'session', generationId: 1, requestId: 'r1' });
    const value = { toString: vi.fn(() => 'asset') };
    expect(new b.Element().setAttribute('href', value)).toBe('native-return');
    expect(value.toString).toHaveBeenCalledTimes(1);
  });
  it('preserves original post receiver/args/transfer/return/throw and freezes at capture end', () => {
    const b = browserProbe();
    const instance = new b.window.Worker('https://asa/worker', {
      name: 'asa-electronics-simulation',
    });
    const request = {
      kind: 'advance',
      projectSessionId: 'session',
      generationId: 1,
      requestId: 'r1',
    };
    const transfers = [new ArrayBuffer(1)];
    expect(instance.postMessage(request, transfers)).toBe('post-return');
    expect(b.nativeCalls.at(-1)).toEqual([instance, request, transfers]);
    expect(() => instance.postMessage('throw')).toThrow('native-post');
    b.receive(request);
    const end = (
      b.window as unknown as {
        __asa682PhaseEnd: () => { expected: unknown[]; outstanding: unknown[] };
      }
    ).__asa682PhaseEnd();
    expect(end.expected).toHaveLength(1);
    const count = b.marks.length;
    b.receive({ ...request, requestId: 'after-end' });
    expect(b.marks).toHaveLength(count);
    expect(end.expected).toHaveLength(1);
  });
});

describe('682 owned tracing lifecycle', () => {
  function pagePort(collision = false, loss?: boolean, freezeFails = false) {
    const effectiveLoss = arguments.length >= 2 ? loss : false;
    let complete: (event: unknown) => void = () => undefined;
    const send = vi.fn(async (method: string) => {
      if (method === 'Tracing.start' && collision) throw new Error('Tracing already started');
      if (method === 'Tracing.end') complete({ stream: 'owned', dataLossOccurred: effectiveLoss });
      if (method === 'IO.read') return { data: trace(), eof: true };
      return {};
    });
    const cdp = {
      send,
      once: (_event: string, callback: (event: unknown) => void) => {
        complete = callback;
      },
      detach: vi.fn(async () => undefined),
    };
    const page = {
      context: () => ({ browser: () => ({ newBrowserCDPSession: async () => cdp }) }),
      evaluate: vi.fn(async () => {
        if (freezeFails) throw new Error('page closed');
        return {
          expected: [{ id: 'r1', generation: 1, instance: 'run-1', session: 'session' }],
          outstanding: [],
          overflow: false,
        };
      }),
    };
    return { page: page as unknown as import('@playwright/test').Page, send, cdp };
  }
  it('starts ReturnAsStream before journey, freezes before end and harvests EOF', async () => {
    const p = pagePort();
    const finish = await beginPhaseTrace(p.page, 'run');
    expect(p.send).toHaveBeenCalledTimes(1);
    expect(p.send.mock.calls[0]).toEqual([
      'Tracing.start',
      { categories: 'blink.user_timing', transferMode: 'ReturnAsStream', streamFormat: 'json' },
    ]);
    const evidence = await finish();
    expect(evidence.report.verdict).toBe('OBSERVED_DIAGNOSTIC_ONLY');
    expect(p.send.mock.calls.map(([method]) => method)).toEqual([
      'Tracing.start',
      'Tracing.end',
      'IO.read',
      'IO.close',
    ]);
    expect(p.cdp.detach).toHaveBeenCalledTimes(1);
  });
  it('never ends or reads a foreign trace after a collision', async () => {
    const p = pagePort(true);
    expect((await (await beginPhaseTrace(p.page, 'run'))()).report.verdict).toBe('NOT_OBSERVED');
    expect(p.send.mock.calls.map(([method]) => method)).toEqual(['Tracing.start']);
  });
  it.each([true, undefined])(
    'retains raw trace but rejects loss/unknown loss flag %s',
    async (loss) => {
      const p = pagePort(false, loss);
      const evidence = await (await beginPhaseTrace(p.page, 'run'))();
      expect(evidence.raw).toBe(trace());
      expect(evidence.report.verdict).toBe('NOT_OBSERVED');
    },
  );
  it('ends owned trace and retains raw even when capture freeze fails', async () => {
    const p = pagePort(false, false, true);
    const evidence = await (await beginPhaseTrace(p.page, 'run'))();
    expect(evidence.raw).toBe(trace());
    expect(evidence.report.verdict).toBe('NOT_OBSERVED');
    expect(p.send.mock.calls.map(([method]) => method)).toContain('Tracing.end');
  });
  it.each([false, true])(
    'actual trace helper retains raw and independent close error (read fails: %s)',
    async (readFails) => {
      const p = pagePort();
      const original = p.send.getMockImplementation()!;
      const primary = new Error('read-failure');
      const cleanup = new Error('close-failure');
      let reads = 0;
      const prefix = '{"traceEvents":[';
      p.send.mockImplementation(async (method) => {
        if (method === 'IO.close') throw cleanup;
        if (readFails && method === 'IO.read') {
          if (reads++ === 0) return { data: prefix, eof: false };
          throw primary;
        }
        return original(method);
      });
      const evidence = await (await beginPhaseTrace(p.page, 'run'))();
      expect(evidence.raw).toBe(readFails ? prefix : trace());
      expect(evidence.report.verdict).toBe('NOT_OBSERVED');
      expect(evidence.report).toMatchObject({
        cleanupErrors: ['Error: close-failure'],
        rawTraceBytesBase64: Buffer.from(evidence.raw).toString('base64'),
      });
      expect(evidence.report.errors).toContain(
        readFails ? 'Error: read-failure' : 'Error: close-failure',
      );
    },
  );
  it('labels actual pending requests separately, never waives a responding orphan', () => {
    const pending = { ...row('request-received', 1000), status: 'OUTSTANDING_AT_END' };
    const outstanding = [pending];
    expect(parsePhaseTrace(trace([pending]), 'run', false, [], outstanding).groups).toEqual([]);
    expect(
      parsePhaseTrace(trace([pending, row('main-receipt', 1004)]), 'run', false, [], outstanding)
        .verdict,
    ).toBe('NOT_OBSERVED');
  });
  it.each(['duplicate-receive', 'duplicate-ready', 'reversed', 'missing-prefix'])(
    'validates outstanding observed integrity before incomplete classification: %s',
    (failure) => {
      const complete = phases.map((phase, i) => row(phase, 1000 + i));
      const received = row('request-received', 2000, 'r2');
      const ready = row('response-ready', 2001, 'r2');
      const pending =
        failure === 'duplicate-receive'
          ? [received, received]
          : failure === 'duplicate-ready'
            ? [received, ready, ready]
            : failure === 'reversed'
              ? [received, { ...ready, epoch: 1999 }]
              : [received, row('send-call', 2002, 'r2')];
      expect(
        parsePhaseTrace(
          trace([...complete, ...pending]),
          'run',
          false,
          [{ id: 'r1', generation: 1 }],
          [received],
        ).verdict,
      ).toBe('NOT_OBSERVED');
    },
  );
  it('retains valid outstanding prefix without pretending it completed', () => {
    const complete = phases.map((phase, i) => row(phase, 1000 + i));
    const pending = row('request-received', 2000, 'r2');
    const evidence = parsePhaseTrace(
      trace([...complete, pending, row('response-ready', 2001, 'r2')]),
      'run',
      false,
      [{ id: 'r1', generation: 1 }],
      [pending],
    );
    expect(evidence.verdict).toBe('OBSERVED_DIAGNOSTIC_ONLY');
    expect(evidence.groups.map((group) => group.id)).toEqual(['r1']);
  });
});

it('preserves original ten case body inputs/actions/oracles by inverse transformation', () => {
  const current = readFileSync('e2e/electronics-interactions.spec.ts', 'utf8');
  const extract = (source: string) =>
    source.slice(
      source.indexOf('      const shortMs = mode.startsWith'),
      source.indexOf('\nconst ID ='),
    );
  // Only the conditional probe setup/finally and Stop observation are new in the shared body.
  const normalize = (text: string) => {
    const file = ts.createSourceFile(
      'inverse.ts',
      'async function inverse(){' + text,
      ts.ScriptTarget.Latest,
      true,
    );
    const tokens: string[] = [];
    const walk = (node: ts.Node) => {
      const children = node.getChildren(file);
      if (children.length) children.forEach(walk);
      else tokens.push(node.getText(file));
    };
    walk(file);
    return JSON.stringify(tokens);
  };
  let body = extract(current);
  body = body.replace(
    / {6}const phaseRun = diagnostic[\s\S]*? {6}const journal =/,
    '      const journal =',
  );
  body = body.replace(/,\s*phaseRun,/, ',');
  body = body.replace(/ {6}let finishPhase:[^;]+;\s*/, '');
  body = body.replace(/\s*let stopReached = false;\s*/, '');
  body = body.replace(
    /\s*if \(phaseRun\) finishPhase = await beginPhaseTrace\(page, phaseRun\);/,
    '',
  );
  body = body.replace(/\s*if \(diagnostic\) stopReached = true;/g, '');
  body = body.replace(
    / {8}if \(finishPhase\) \{[\s\S]*? {8}journal.retain\('node-final',/,
    "        journal.retain('node-final',",
  );
  expect(createHash('sha256').update(normalize(body)).digest('hex')).toBe(
    '4e0f660f2103a24c2c423f12f2b80adefcd91d983f739d0a5a0fc163dd437708',
  );
});
