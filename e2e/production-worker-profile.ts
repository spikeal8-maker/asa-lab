import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

type Json = Record<string, unknown>;
type WorkerTarget = {
  sessionId: string;
  targetId: string;
  url: string;
  attachedAtEpochMs: number;
  startedAtEpochMs?: number;
  stoppedAtEpochMs?: number;
  preparation?: Promise<void>;
  profile?: unknown;
};
type ProfileProbeWindow = Window & {
  __asa546Profile?: {
    startedAt: number;
    timeOrigin: number;
    raf: number[];
    longtasks: Array<{ startTime: number; duration: number }>;
    stop: () => Json;
  };
};

/** TEMP diagnostic adapter. Never pauses, evaluates, or rewrites the production Worker. */
export async function startProductionWorkerProfile(page: Page, outputPrefix: string) {
  const expectedWorkerSha256 = process.env['ASA_546_EXPECTED_WORKER_SHA'];
  if (!expectedWorkerSha256 || !/^[a-f0-9]{64}$/.test(expectedWorkerSha256))
    throw new Error('Missing SHA256 of the exact frozen production Web image Worker asset.');
  const cdp = await page.context().newCDPSession(page);
  const browser = page.context().browser();
  if (!browser) throw new Error('Production profiling requires a connected Chromium browser.');
  const browserCdp = await browser.newBrowserCDPSession();
  const targets = new Map<string, WorkerTarget>();
  const errors: Array<{ stage: string; message: string }> = [];
  const pending = new Map<
    number,
    { resolve: (result: Json) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  let sequence = 0;
  let closing = false;
  let captured: Json = {};
  const recordError = (stage: string, error: unknown) => {
    errors.push({ stage, message: error instanceof Error ? error.message : String(error) });
  };
  const workerCommand = (sessionId: string, method: string, params: Json = {}) =>
    new Promise<Json>((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Worker CDP ${method} did not answer within 1000 ms.`));
      }, 1000);
      pending.set(id, { resolve, reject, timer });
      void cdp
        .send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch((error: unknown) => {
          const entry = pending.get(id);
          if (!entry) return;
          clearTimeout(entry.timer);
          pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  cdp.on('Target.receivedMessageFromTarget', (event) => {
    const message = JSON.parse(event.message) as { id?: number; result?: Json; error?: Json };
    if (message.id === undefined) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result ?? {});
  });
  cdp.on('Target.attachedToTarget', (event) => {
    if (closing || event.targetInfo.type !== 'worker') return;
    if (!/simulation\.worker[^/]*\.js(?:\?|$)/.test(event.targetInfo.url)) return;
    const target: WorkerTarget = {
      sessionId: event.sessionId,
      targetId: event.targetInfo.targetId,
      url: event.targetInfo.url,
      attachedAtEpochMs: Date.now(),
    };
    targets.set(target.sessionId, target);
    target.preparation = (async () => {
      await workerCommand(target.sessionId, 'Profiler.enable');
      await workerCommand(target.sessionId, 'Profiler.setSamplingInterval', { interval: 1000 });
      await workerCommand(target.sessionId, 'Profiler.start');
      target.startedAtEpochMs = Date.now();
    })().catch((error: unknown) => recordError('worker-start', error));
  });
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: false,
  });
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await page.evaluate(() => {
    const probe: NonNullable<ProfileProbeWindow['__asa546Profile']> = {
      startedAt: performance.now(),
      timeOrigin: performance.timeOrigin,
      raf: [],
      longtasks: [],
      stop: () => ({}),
    };
    let active = true;
    let frame = 0;
    const sample = (at: number) => {
      if (!active) return;
      probe.raf.push(at);
      frame = requestAnimationFrame(sample);
    };
    const observer = PerformanceObserver.supportedEntryTypes.includes('longtask')
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            probe.longtasks.push({ startTime: entry.startTime, duration: entry.duration });
        })
      : null;
    observer?.observe({ type: 'longtask' });
    frame = requestAnimationFrame(sample);
    probe.stop = () => {
      active = false;
      cancelAnimationFrame(frame);
      for (const entry of observer?.takeRecords() ?? [])
        probe.longtasks.push({ startTime: entry.startTime, duration: entry.duration });
      observer?.disconnect();
      return {
        startedAt: probe.startedAt,
        stoppedAt: performance.now(),
        timeOrigin: probe.timeOrigin,
        raf: probe.raf,
        longtasks: probe.longtasks,
        longtaskSupported: observer !== null,
      };
    };
    (window as ProfileProbeWindow).__asa546Profile = probe;
  });
  const metricsBefore = await cdp.send('Performance.getMetrics');
  const processesBefore = await browserCdp.send('SystemInfo.getProcessInfo').catch((error: unknown) => {
    recordError('processes-before', error);
    return null;
  });
  const pageStartedAtEpochMs = Date.now();
  await cdp.send('Profiler.start');

  return {
    /** Stop before original raw collection, screenshots, Stop, or filesystem writes. */
    async stop(): Promise<void> {
      closing = true;
      const stoppedAtEpochMs = Date.now();
      const workerStops = [...targets.values()].map(async (target) => {
        await target.preparation;
        if (target.startedAtEpochMs === undefined) return;
        try {
          target.profile = (await workerCommand(target.sessionId, 'Profiler.stop')).profile;
          target.stoppedAtEpochMs = Date.now();
        } catch (error) {
          recordError('worker-stop', error);
        }
      });
      let pageProfile: unknown;
      try {
        pageProfile = (await cdp.send('Profiler.stop')).profile;
      } catch (error) {
        recordError('page-stop', error);
      }
      await Promise.all(workerStops);
      const metricsAfter = await cdp.send('Performance.getMetrics').catch((error: unknown) => {
        recordError('metrics-after', error);
        return null;
      });
      const processesAfter = await browserCdp
        .send('SystemInfo.getProcessInfo')
        .catch((error: unknown) => {
          recordError('processes-after', error);
          return null;
        });
      const telemetry = await page
        .evaluate(() => (window as ProfileProbeWindow).__asa546Profile?.stop() ?? null)
        .catch((error: unknown) => {
          recordError('telemetry', error);
          return null;
        });
      const requestMapping = await page
        .evaluate(() => {
          const probe = window as Window & { __bitwiseWorker?: unknown[] };
          return (probe.__bitwiseWorker ?? []).map((row) => {
            const receipt = row as {
              worker: number;
              requestId: string;
              generationId: number | null;
              requestAt: number | null;
              at: number;
              advance: { requestedHorizonMicroseconds: number; committedHorizonMicroseconds: number };
              requestSource: string | null;
            };
            return {
              worker: receipt.worker,
              requestId: receipt.requestId,
              generationId: receipt.generationId,
              requestAt: receipt.requestAt,
              at: receipt.at,
              requestedHorizonMicroseconds: receipt.advance.requestedHorizonMicroseconds,
              committedHorizonMicroseconds: receipt.advance.committedHorizonMicroseconds,
              requestSource: receipt.requestSource,
            };
          });
        })
        .catch((error: unknown) => {
          recordError('request-mapping', error);
          return null;
        });
      if (targets.size !== 1) recordError('worker-target-count', `Expected 1, got ${targets.size}.`);
      captured = { stoppedAtEpochMs, pageProfile, metricsAfter, processesAfter, telemetry, requestMapping };
    },
    /** File and asset I/O happens after the original bounded raw snapshot is retained. */
    async persist(): Promise<void> {
      const { stoppedAtEpochMs, pageProfile, metricsAfter, processesAfter, telemetry, requestMapping } = captured;
      const artifacts: Array<{ file: string; bytes: number; sha256: string }> = [];
      const save = (suffix: string, data: string | Buffer) => {
        const file = `${outputPrefix}-${suffix}`;
        writeFileSync(file, data);
        artifacts.push({
          file,
          bytes: Buffer.byteLength(data),
          sha256: createHash('sha256').update(data).digest('hex'),
        });
      };
      mkdirSync(outputPrefix.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
      try {
        if (pageProfile) save('page.cpuprofile', JSON.stringify(pageProfile));
        for (const [index, target] of [...targets.values()].entries()) {
          if (target.profile) save(`worker-${index}.cpuprofile`, JSON.stringify(target.profile));
          try {
            const response = await page.context().request.get(target.url);
            if (!response.ok()) throw new Error(`Worker asset HTTP ${response.status()}.`);
            const bytes = await response.body();
            save(`worker-${index}.js`, bytes);
            if (createHash('sha256').update(bytes).digest('hex') !== expectedWorkerSha256)
              recordError('worker-image-identity', 'Fetched Worker bytes differ from frozen Web image SHA256.');
            if (!target.url.endsWith('/assets/simulation.worker-UAINFPw3.js'))
              recordError('prior-worker-filename', 'Worker filename differs from retained exact db96 trace.');
            const sourceMap = bytes.toString('utf8').match(/\/\/# sourceMappingURL=([^\s]+)/)?.[1];
            if (sourceMap && !sourceMap.startsWith('data:')) {
              const mapResponse = await page.context().request.get(new URL(sourceMap, target.url).href);
              if (!mapResponse.ok()) throw new Error(`Existing source map HTTP ${mapResponse.status()}.`);
              save(`worker-${index}.js.map`, await mapResponse.body());
            }
          } catch (error) {
            recordError('worker-asset', error);
          }
        }
        save(
          'metadata.json',
          JSON.stringify({
            source: 'db96c92365913362ae225a09b41926f7015b30e0',
            samplingIntervalMicroseconds: 1000,
            expectedWorkerSha256,
            waitForDebuggerOnStart: false,
            pageStartedAtEpochMs,
            stoppedAtEpochMs,
            targets: [...targets.values()].map(({ preparation, profile, ...target }) => {
              void preparation;
              return { ...target, profileCaptured: profile !== undefined };
            }),
            metricsBefore,
            metricsAfter,
            processesBefore,
            processesAfter,
            telemetry,
            requestMapping,
            errors,
            artifacts,
            status:
              errors.length === 0 && pageProfile && [...targets.values()].every((t) => t.profile)
                ? 'CAPTURED_NOT_ACCEPTANCE'
                : 'INCOMPLETE_DIAGNOSTIC',
            limits: [
              'Non-pausing worker attachment may miss its initial execution prefix; inspect timestamps.',
              'CPU samples and timeDeltas are not exact per-thread CPU accounting or proof of preemption.',
              'Profiler overhead can affect original assertions; original timeout and control flow are preserved.',
              'Original initial failure prevents cookies-reopen; no forced continuation or rerun.',
            ],
          }, null, 2) + '\n',
        );
      } catch (error) {
        // Diagnostic evidence failure must not replace an original pupil-journey assertion error.
        console.error('ASA546 CPU profile evidence failed:', error);
      } finally {
        await cdp.detach().catch(() => undefined);
        await browserCdp.detach().catch(() => undefined);
      }
    },
  };
}
