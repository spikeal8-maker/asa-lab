import type { CDPSession, Page } from '@playwright/test';

export const PHASE_PREFIX = 'asa682:v1:';
export const TRACE_LIMIT = 16 * 1024 * 1024;
export type NativeAttributeRow = {
  phase: 'NATIVE-ATTRIBUTE-PUBLICATION';
  ownerRun: string;
  epoch: number;
  target: string;
  node: number;
  attribute: string;
  value: string | null;
};
export type PhaseRow = {
  phase: string;
  instance: string;
  session: string;
  generation: number;
  id: string;
  epoch: number;
  attribute?: string;
  target?: string;
};

// This function is serialized by Playwright. Keep every browser dependency local.
export function installPhaseProbe(run: string) {
  let ordinal = 0;
  let accepting = true;
  let overflow = false;
  const expected: Array<{ instance: string; session: string; generation: number; id: string }> = [];
  const pending = new Map<string, Record<string, unknown>>();
  const nodes = new WeakMap<Element, number>();
  let nodeSequence = 0;
  (window as unknown as { __asa682PhaseEnd: () => unknown }).__asa682PhaseEnd = () => {
    accepting = false;
    return { expected, outstanding: [...pending.values()], overflow };
  };
  let latest: Record<string, unknown> | null = null;
  const emit = (data: Record<string, unknown>, epoch: number) => {
    try {
      if (!accepting) return;
      const name = 'asa682:v1:' + encodeURIComponent(JSON.stringify({ ...data, epoch }));
      try {
        performance.mark(name);
      } finally {
        performance.clearMarks(name);
      }
    } catch {
      /* Marks are optional evidence, never application behavior. */
    }
  };
  const NativeWorker = window.Worker;
  window.Worker = new Proxy(NativeWorker, {
    construct(target, args, newTarget) {
      if ((args[1] as WorkerOptions | undefined)?.name !== 'asa-electronics-simulation')
        return Reflect.construct(target, args, newTarget);
      const instance = `${run}-${++ordinal}`;
      const url = new URL(String(args[0]), document.baseURI);
      url.searchParams.set('asa682phase', 'v1');
      url.searchParams.set('asa682instance', instance);
      const worker = Reflect.construct(target, [url, ...args.slice(1)], newTarget) as Worker;
      const nativePost = worker.postMessage;
      worker.postMessage = function (this: Worker, ...values: unknown[]) {
        try {
          if (accepting) {
            const request = values[0] as {
              kind: string;
              projectSessionId: string;
              generationId: number;
              requestId: string;
            };
            if (request.kind !== 'cancel-generation') {
              if (pending.size >= 20000) overflow = true;
              else
                pending.set(
                  JSON.stringify([
                    instance,
                    request.projectSessionId,
                    request.generationId,
                    request.requestId,
                  ]),
                  {
                    instance,
                    session: request.projectSessionId,
                    generation: request.generationId,
                    id: request.requestId,
                    kind: request.kind,
                    status: 'OUTSTANDING_AT_END',
                  },
                );
            }
          }
        } catch {
          overflow = true;
        }
        return Reflect.apply(nativePost, this, values);
      } as Worker['postMessage'];
      worker.addEventListener('message', (event: MessageEvent) => {
        // Clock first, before response access/parse and before the journal listener.
        try {
          const epoch = performance.timeOrigin + performance.now();
          if (!accepting) return;
          const response = event.data;
          if (
            typeof response?.projectSessionId !== 'string' ||
            response.projectSessionId.length > 160 ||
            typeof response.requestId !== 'string' ||
            response.requestId.length > 160 ||
            !Number.isSafeInteger(response.generationId)
          ) {
            overflow = true;
            return;
          }
          latest = {
            instance,
            session: response.projectSessionId,
            generation: response.generationId,
            id: response.requestId,
          };
          if (expected.length >= 20000) overflow = true;
          else
            expected.push(
              latest as { instance: string; session: string; generation: number; id: string },
            );
          pending.delete(
            JSON.stringify([
              instance,
              response.projectSessionId,
              response.generationId,
              response.requestId,
            ]),
          );
          emit({ ...latest, phase: 'main-receipt' }, epoch);
        } catch {
          /* Missing evidence is rejected by the parser. */
        }
      });
      return worker;
    },
  });
  const observe = (element: Element, attribute: string) => {
    try {
      if (
        !latest ||
        ![
          'href',
          'xlink:href',
          'data-led-brightness',
          'data-led-asset-active',
          'data-active',
          'data-led-runtime-state',
          'data-led-asset-token',
          'opacity',
          'fill',
          'visibility',
        ].includes(attribute)
      )
        return;
      const component = element.closest('[data-component-id]')?.getAttribute('data-component-id');
      if (!component || !['uno', 'led0', 'led1', 'led2'].includes(component)) return;
      if (component === 'uno' && element.getAttribute('data-testid') !== 'arduino-led-l') return;
      let node = nodes.get(element);
      if (!node) {
        if (nodeSequence >= 20000) {
          overflow = true;
          return;
        }
        node = ++nodeSequence;
        nodes.set(element, node);
      }
      emit(
        {
          ownerRun: run,
          node,
          phase: 'NATIVE-ATTRIBUTE-PUBLICATION',
          attribute,
          value: element.getAttribute(attribute),
          target: component,
        },
        performance.timeOrigin + performance.now(),
      );
    } catch {
      /* Never change native attribute behavior. */
    }
  };
  const set = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (...args: Parameters<typeof set>) {
    const result = Reflect.apply(set, this, args);
    observe(this, args[0]);
    return result;
  };
  const setNS = Element.prototype.setAttributeNS;
  Element.prototype.setAttributeNS = function (...args: Parameters<typeof setNS>) {
    const result = Reflect.apply(setNS, this, args);
    observe(this, args[1]);
    return result;
  };
}

export interface TracePort {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export async function readPhaseStream(port: TracePort, handle: string): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let decoded = '';
  let primary: unknown;
  let failed = false;
  let cleanupError: unknown;
  let cleanupFailed = false;
  try {
    for (;;) {
      const row = await port.send('IO.read', { handle, size: 65536 });
      if (
        typeof row.data !== 'string' ||
        typeof row.eof !== 'boolean' ||
        (row.base64Encoded !== undefined && typeof row.base64Encoded !== 'boolean')
      )
        throw new Error('Invalid trace stream encoding/EOF');
      if (
        row.base64Encoded &&
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.data)
      )
        throw new Error('Invalid trace base64');
      const chunk = Buffer.from(row.data, row.base64Encoded ? 'base64' : 'utf8');
      if (row.base64Encoded && chunk.toString('base64') !== row.data)
        throw new Error('Noncanonical trace base64');
      bytes += chunk.length;
      if (bytes > TRACE_LIMIT) throw new Error('Trace exceeds 16 MiB');
      chunks.push(chunk);
      if (row.eof) break;
      if (!chunk.length) throw new Error('Trace stalled before EOF');
    }
    const data = Buffer.concat(chunks);
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch (error) {
    primary = error;
    failed = true;
  } finally {
    try {
      await port.send('IO.close', { handle });
    } catch (error) {
      cleanupError = error;
      cleanupFailed = true;
    }
  }
  if (failed || cleanupFailed) {
    const original = failed ? primary : cleanupError;
    throw Object.assign(original instanceof Error ? original : new Error(String(original)), {
      partialTrace: Buffer.concat(chunks).toString('utf8'),
      partialTraceBytes: Buffer.concat(chunks),
      ...(cleanupFailed ? { cleanupError } : {}),
    });
  }
  return decoded;
}

export function parsePhaseTrace(
  raw: string,
  run: string,
  loss = false,
  expected: Array<{ id: string; generation: number; instance?: string; session?: string }> = [],
  outstanding: Array<Record<string, unknown>> = [],
) {
  const errors: string[] = [];
  const rows: PhaseRow[] = [];
  const nativeAttributes: NativeAttributeRow[] = [];
  const groups = new Map<string, PhaseRow[]>();
  try {
    if (loss) throw new Error('Trace data loss');
    const trace = JSON.parse(raw) as { traceEvents?: Array<{ name?: string; cat?: string }> };
    if (!Array.isArray(trace.traceEvents)) throw new Error('Missing traceEvents');
    for (const event of trace.traceEvents) {
      if (!event.name?.startsWith(PHASE_PREFIX)) continue;
      if (!event.cat?.split(',').includes('blink.user_timing'))
        throw new Error('Wrong trace category');
      const decoded = JSON.parse(decodeURIComponent(event.name.slice(PHASE_PREFIX.length)));
      if (decoded.phase === 'NATIVE-ATTRIBUTE-PUBLICATION') {
        if (
          decoded.ownerRun !== run ||
          !Number.isFinite(decoded.epoch) ||
          !Number.isSafeInteger(decoded.node) ||
          decoded.node <= 0 ||
          typeof decoded.target !== 'string' ||
          typeof decoded.attribute !== 'string' ||
          !(typeof decoded.value === 'string' || decoded.value === null)
        )
          throw new Error('Invalid native attribute ownership/epoch');
        nativeAttributes.push(decoded as NativeAttributeRow);
        continue;
      }
      const row = decoded as PhaseRow;
      if (
        !row.instance?.startsWith(`${run}-`) ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(row.instance) ||
        typeof row.session !== 'string' ||
        !row.session ||
        row.session.length > 160 ||
        typeof row.id !== 'string' ||
        !row.id ||
        row.id.length > 160 ||
        !Number.isSafeInteger(row.generation) ||
        !Number.isFinite(row.epoch)
      )
        throw new Error('Invalid ownership/IDs/epoch');
      if (
        ![
          'request-received',
          'response-ready',
          'send-call',
          'send-return',
          'main-receipt',
          'NATIVE-ATTRIBUTE-PUBLICATION',
        ].includes(row.phase)
      )
        throw new Error('Unknown phase');
      rows.push(row);
      const key = JSON.stringify([row.instance, row.session, row.generation, row.id]);
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    if (
      !groups.size ||
      ![...groups.values()].some((group) => group.some((row) => row.phase === 'main-receipt'))
    )
      throw new Error('Missing first responding mark');
    for (const request of expected) {
      if (
        ![...groups.values()].some(
          (group) =>
            group[0]?.id === request.id &&
            group[0]?.generation === request.generation &&
            (!request.instance || group[0]?.instance === request.instance) &&
            (!request.session || group[0]?.session === request.session),
        )
      )
        throw new Error('Missing first request coverage');
    }
    for (const group of groups.values()) {
      const isOutstanding =
        !group.some((row) => row.phase === 'main-receipt') &&
        outstanding.some(
          (request) =>
            request.instance === group[0]!.instance &&
            request.session === group[0]!.session &&
            request.generation === group[0]!.generation &&
            request.id === group[0]!.id,
        );
      const phases = [
        'request-received',
        'response-ready',
        'send-call',
        'send-return',
        'main-receipt',
      ];
      let prior = -Infinity;
      let missingSuffix = false;
      for (const phase of phases) {
        const found = group.filter((row) => row.phase === phase);
        if (found.length > 1) throw new Error(`Duplicate ${phase}`);
        if (found.length === 0) {
          if (!isOutstanding) throw new Error(`Missing ${phase}`);
          missingSuffix = true;
          continue;
        }
        if (missingSuffix) throw new Error(`Missing prefix before ${phase}`);
        if (phase === 'main-receipt') {
          if (found[0]!.epoch < group.find((row) => row.phase === 'send-call')!.epoch)
            throw new Error('Receipt precedes send');
        } else {
          if (found[0]!.epoch < prior) throw new Error('Phase epoch order');
          prior = found[0]!.epoch;
        }
      }
    }
  } catch (error) {
    errors.push(String(error));
  }
  return {
    version: 1,
    verdict: errors.length ? 'NOT_OBSERVED' : 'OBSERVED_DIAGNOSTIC_ONLY',
    interference: 'UNKNOWN_NONZERO',
    opticalPublication: 'UNKNOWN_CSS_OPACITY_UNTRAPPED',
    attributePublication:
      nativeAttributes.length > 0 ? 'OBSERVED_NATIVE_ATTRIBUTES' : 'NOT_OBSERVED',
    attributeFrameOwnership: 'UNPROVEN',
    nativeAttributes,
    errors,
    rows,
    groups: [...groups.values()]
      .filter((group) => group.some((row) => row.phase === 'main-receipt'))
      .map((group) => {
        const at = (phase: string) => group.find((row) => row.phase === phase)?.epoch ?? NaN;
        return {
          instance: group[0]!.instance,
          session: group[0]!.session,
          generation: group[0]!.generation,
          id: group[0]!.id,
          evaluationMs: at('response-ready') - at('request-received'),
          sendMs: at('send-return') - at('send-call'),
          channelMs: at('main-receipt') - at('send-call'),
        };
      }),
  };
}

export async function beginPhaseTrace(page: Page, run: string) {
  let cdp: CDPSession;
  try {
    cdp = await page.context().browser()!.newBrowserCDPSession();
  } catch (error) {
    return async () => ({
      raw: '',
      report: { ...parsePhaseTrace('', run, true), errors: [String(error)], outstanding: [] },
    });
  }
  let owned = false;
  let startError: unknown;
  let complete!: (event: { stream?: string; dataLossOccurred?: boolean }) => void;
  const completed = new Promise<{ stream?: string; dataLossOccurred?: boolean }>((resolve) => {
    complete = resolve;
  });
  cdp.once('Tracing.tracingComplete', complete);
  try {
    await cdp.send('Tracing.start', {
      categories: 'blink.user_timing',
      transferMode: 'ReturnAsStream',
      streamFormat: 'json',
    });
    owned = true;
  } catch (error) {
    startError = error;
  }
  return async () => {
    let capture: {
      expected: Array<{ instance: string; session: string; generation: number; id: string }>;
      outstanding: Array<Record<string, unknown>>;
      overflow: boolean;
    } = { expected: [], outstanding: [], overflow: true };
    let raw = '';
    let failure = startError;
    try {
      if (!owned) throw startError ?? new Error('Trace not owned');
      try {
        capture = await page.evaluate(() =>
          (window as unknown as { __asa682PhaseEnd: () => typeof capture }).__asa682PhaseEnd(),
        );
      } catch (error) {
        failure = error;
      }
      // Even a failed capture boundary must release our own trace and retain its stream.
      await cdp.send('Tracing.end');
      const done = await Promise.race([
        completed,
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('Trace completion missing')), 5000);
          completed.finally(() => clearTimeout(timer)).catch(() => undefined);
        }),
      ]);
      if (!done.stream) throw new Error('Trace stream missing');
      raw = await readPhaseStream(cdp as unknown as TracePort, done.stream);
      if (done.dataLossOccurred !== false || capture.overflow)
        throw new Error('Trace stream lost/unknown or capture overflow');
    } catch (error) {
      failure = error;
      if (
        error &&
        typeof error === 'object' &&
        'partialTrace' in error &&
        typeof error.partialTrace === 'string'
      )
        raw = error.partialTrace;
    } finally {
      await cdp.detach().catch(() => undefined);
    }
    const report = parsePhaseTrace(
      raw,
      run,
      Boolean(failure),
      capture.expected,
      capture.outstanding,
    );
    if (failure) report.errors.push(String(failure));
    const streamFailure = failure as
      { cleanupError?: unknown; partialTraceBytes?: Buffer } | undefined;
    return {
      raw,
      report: {
        ...report,
        outstanding: capture.outstanding,
        cleanupErrors:
          streamFailure && 'cleanupError' in streamFailure
            ? [String(streamFailure.cleanupError)]
            : [],
        rawTraceBytesBase64: streamFailure?.partialTraceBytes?.toString('base64') ?? null,
      },
    };
  };
}
