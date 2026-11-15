import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import type {
  ElectronicsSimulationWorkerRequest,
  ElectronicsSimulationWorkerResponse,
} from '../apps/web/src/electronics/simulation-worker-protocol';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher } from './seed';

type ClockFrame = {
  documentId: string;
  workerId: number;
  requestId: string;
  projectSessionId: string;
  matchedActiveRequest: boolean;
  generationId: number;
  requestedMicroseconds: number;
  committedMicroseconds: number;
  status: string;
  computeMs: number | null;
  resultSolved: boolean | null;
  resultFinite: boolean;
  resultPassed: boolean;
  computeMsFinite: boolean;
  receivedAt: number;
};
type ClockPublication = {
  text: string;
  publishedAt: number;
  frame: ClockFrame | null;
  startup: boolean;
  documentId: string;
  marker: string | null;
  mountId: number;
  mountBindingStable: boolean;
  binding: Pick<ClockFrame, 'workerId' | 'generationId' | 'projectSessionId'> | null;
  equivalentRequestIds?: string[];
};
type ClockRequestReceipt = Readonly<{
  workerId: number;
  requestId: string;
  kind: ElectronicsSimulationWorkerRequest['kind'];
  generationId: number;
  projectSessionId: string;
  protocolVersion: ElectronicsSimulationWorkerRequest['protocolVersion'];
  requestedHorizonMicroseconds?: number;
  sentAt: number;
}>;
type ClockProbe = {
  requests: ClockRequestReceipt[];
  frames: ClockFrame[];
  settledSamples: ClockPublication[];
  publications: ClockPublication[];
  actions: Array<{ name: string; at: number }>;
};
type ClockKind = keyof ClockProbe;
type ClockReceipt = { documentId: string; sequence: number; kind: ClockKind; data: unknown };
type ClockAck = { sequence: number; hash: string };
type ClockBrowserProbe = {
  emit: (kind: ClockKind, data: unknown) => void;
  drain: () => Promise<{ documentId: string; sequence: number; ack: ClockAck; errors: string[] }>;
};
type ProbeWindow = Window & {
  __integerClockProbe?: ClockBrowserProbe;
  __integerClockReceipt: (rows: ClockReceipt[]) => Promise<ClockAck>;
};
const clockStores = new WeakMap<
  Page,
  {
    probe: ClockProbe;
    documents: Map<string, { sequence: number; hash: string; hashes: string[] }>;
    errors: string[];
    path: string;
  }
>();

// A complete ordinary DC circuit: no Arduino cadence or fake clock is needed
// to demonstrate the presentation of real fractional committed horizons.
const initialDocument: SchematicDocument = {
  schemaVersion: 4,
  components: [
    {
      id: 'source',
      kind: 'source',
      componentTypeId: 'battery-holder-aa-2',
      variantId: 'battery-holder-aa-2',
      name: 'Источник 3 В',
      position: { x: 100, y: 150 },
      rotation: 0,
      value: 3,
      pinIds: ['BAT-', 'BAT+'],
      stateProperties: { cells: 2 },
    },
    {
      id: 'resistor',
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      variantId: 'resistor-axial',
      name: 'R1',
      position: { x: 400, y: 150 },
      rotation: 90,
      value: 220,
      pinIds: ['lead-1', 'lead-2'],
      stateProperties: { tolerancePercent: 5, resistanceUnit: 'Ом' },
    },
  ],
  connections: [
    {
      id: 'positive',
      from: { componentId: 'source', terminal: 'BAT+' },
      to: { componentId: 'resistor', terminal: 'lead-1' },
      color: '#e3212b',
      vertices: [{ x: 300, y: 100 }],
    },
    {
      id: 'negative',
      from: { componentId: 'resistor', terminal: 'lead-2' },
      to: { componentId: 'source', terminal: 'BAT-' },
      color: '#2a3035',
      vertices: [
        { x: 500, y: 350 },
        { x: 100, y: 350 },
      ],
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};

async function observeRealClock(page: Page, path: string) {
  const store = {
    probe: {
      requests: [],
      frames: [],
      settledSamples: [],
      publications: [],
      actions: [],
    } as ClockProbe,
    documents: new Map<string, { sequence: number; hash: string; hashes: string[] }>(),
    errors: [] as string[],
    path,
  };
  writeFileSync(path, '', { encoding: 'utf8', flush: true });
  clockStores.set(page, store);
  await page.exposeBinding('__integerClockReceipt', (_source, rows: ClockReceipt[]) => {
    try {
      if (!Array.isArray(rows) || rows.length === 0 || rows.length > 32)
        throw new Error('Invalid clock receipt batch');
      const documentId = rows[0].documentId;
      if (!/^[a-f0-9]{32}$/.test(documentId)) throw new Error('Invalid clock document identity');
      const prior = store.documents.get(documentId) ?? { sequence: 0, hash: '', hashes: [] };
      let sequence = prior.sequence;
      let hash = prior.hash;
      const hashes: string[] = [],
        lines: string[] = [];
      for (const row of rows) {
        if (
          row.documentId !== documentId ||
          row.sequence !== ++sequence ||
          !Object.hasOwn(store.probe, row.kind)
        )
          throw new Error('Clock receipt gap/duplicate/kind');
        const line = `${JSON.stringify(row)}\n`;
        hash = createHash('sha256').update(hash).update(line).digest('hex');
        hashes.push(hash);
        lines.push(line);
      }
      // ACK is returned only after durable retention of the entire batch.
      appendFileSync(path, lines.join(''), { encoding: 'utf8', flush: true });
      store.documents.set(documentId, { sequence, hash, hashes: [...prior.hashes, ...hashes] });
      for (const row of rows) (store.probe[row.kind] as unknown[]).push(row.data);
      return { sequence, hash };
    } catch (error) {
      store.errors.push(String(error));
      throw error;
    }
  });
  await page.addInitScript(() => {
    const documentId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
      value.toString(16).padStart(2, '0'),
    ).join('');
    let sequence = 0;
    let ack: ClockAck = { sequence: 0, hash: '' };
    let pending: Promise<void> | null = null;
    const queue: ClockReceipt[] = [],
      errors: string[] = [];
    let inFlight = 0;
    const pump = () => {
      if (pending || !queue.length) return;
      pending = Promise.resolve()
        .then(async () => {
          while (queue.length) {
            const rows = queue.splice(0, 32);
            inFlight = rows.length;
            const next = await (window as unknown as ProbeWindow).__integerClockReceipt(rows);
            if (
              next.sequence !== rows[rows.length - 1].sequence ||
              !/^[a-f0-9]{64}$/.test(next.hash)
            )
              throw new Error('Invalid clock durable acknowledgment');
            ack = next;
            inFlight = 0;
          }
        })
        .catch((error: unknown) => {
          errors.push(String(error));
        })
        .finally(() => {
          pending = null;
          inFlight = 0;
          // A record may arrive between the loop's final check and this microtask.
          pump();
        });
    };
    const emit = (kind: ClockKind, data: unknown) => {
      try {
        const row = { documentId, sequence: ++sequence, kind, data: structuredClone(data) };
        // Only active unacknowledged transport is bounded, never durable history.
        if (queue.length + inFlight >= 128) throw new Error('Clock active receipt backlog');
        queue.push(row);
        pump();
      } catch (error) {
        // Observation must never throw into product dispatch/native handlers.
        errors.push(String(error));
      }
    };
    const probe: ClockBrowserProbe = {
      emit,
      drain: async () => {
        while (pending) await pending;
        return { documentId, sequence, ack: { ...ack }, errors: [...errors] };
      },
    };
    (window as unknown as ProbeWindow).__integerClockProbe = probe;
    let workerId = 0;
    let latestReady: ClockFrame | null = null;
    let awaitingReady = true;
    let priorText = '';
    let priorMount = 0;
    let activeBinding: ClockPublication['binding'] = null;
    let nextMount = 0;
    const mounts = new WeakMap<Element, { id: number; binding: string | null }>();
    const sample = (): ClockPublication | null => {
      const elements = document.querySelectorAll('.workbench-simulation-time');
      if (!elements.length) return null;
      if (elements.length !== 1) {
        errors.push('Ambiguous clock DOM mount');
        return null;
      }
      const element = elements[0];
      const key = activeBinding ? JSON.stringify(activeBinding) : null;
      let mount = mounts.get(element);
      if (!mount) {
        mount = { id: ++nextMount, binding: key };
        mounts.set(element, mount);
      } else if (mount.binding === null && key !== null) mount.binding = key;
      return {
        text: element.textContent?.trim() ?? '',
        marker: element.getAttribute('data-time-ms'),
        documentId,
        mountId: mount.id,
        mountBindingStable: mount.binding === key,
        binding: activeBinding ? { ...activeBinding } : null,
        publishedAt: performance.now(),
        frame: null,
        startup: awaitingReady,
      };
    };
    window.Worker = new Proxy(window.Worker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        if ((args[1] as WorkerOptions | undefined)?.name !== 'asa-electronics-simulation')
          return worker;
        const id = ++workerId;
        let active = true;
        let binding: { generationId: number; projectSessionId: string } | null = null;
        const pending = new Map<string, ClockRequestReceipt>();
        latestReady = null;
        awaitingReady = true;
        activeBinding = null;
        const invalidate = () => {
          active = false;
          pending.clear();
          if (workerId === id) {
            latestReady = null;
            awaitingReady = true;
            activeBinding = null;
          }
        };
        worker.terminate = new Proxy(worker.terminate, {
          apply(target, thisArg, args) {
            invalidate();
            return Reflect.apply(target, thisArg, args);
          },
        });
        worker.postMessage = new Proxy(worker.postMessage, {
          apply(target, thisArg, messages) {
            try {
              const request = messages[0] as ElectronicsSimulationWorkerRequest;
              const receipt: ClockRequestReceipt = Object.freeze({
                workerId: id,
                requestId: request.requestId,
                kind: request.kind,
                generationId: request.generationId,
                projectSessionId: request.projectSessionId,
                protocolVersion: request.protocolVersion,
                ...(request.kind === 'advance'
                  ? { requestedHorizonMicroseconds: request.requestedHorizonMicroseconds }
                  : {}),
                sentAt: performance.now(),
              });
              probe.emit('requests', receipt);
              if (request.kind === 'cancel-generation') invalidate();
              else if (active && workerId === id) {
                if (request.kind === 'preflight') {
                  pending.clear();
                  latestReady = null;
                  awaitingReady = true;
                  binding = {
                    generationId: receipt.generationId,
                    projectSessionId: receipt.projectSessionId,
                  };
                  activeBinding = { workerId: id, ...binding };
                }
                if (
                  request.kind === 'advance' &&
                  binding?.generationId === request.generationId &&
                  binding.projectSessionId === request.projectSessionId
                )
                  pending.set(receipt.requestId, receipt);
              }
            } catch (error) {
              errors.push(String(error));
            }
            return Reflect.apply(target, thisArg, messages);
          },
        });
        worker.addEventListener('message', (event: MessageEvent) => {
          const response = event.data as ElectronicsSimulationWorkerResponse;
          if (!response.ok || response.kind !== 'advance' || !response.advance) return;
          const request = pending.get(response.requestId);
          const matchedActiveRequest = Boolean(
            active &&
            workerId === id &&
            request &&
            request.kind === 'advance' &&
            request.workerId === id &&
            response.protocolVersion === request.protocolVersion &&
            response.generationId === request.generationId &&
            response.projectSessionId === request.projectSessionId &&
            binding?.generationId === response.generationId &&
            binding.projectSessionId === response.projectSessionId &&
            response.advance.requestedHorizonMicroseconds === request.requestedHorizonMicroseconds,
          );
          if (matchedActiveRequest) pending.delete(response.requestId);
          const frame: ClockFrame = {
            documentId,
            workerId: id,
            requestId: response.requestId,
            projectSessionId: response.projectSessionId,
            matchedActiveRequest,
            generationId: response.generationId ?? -1,
            requestedMicroseconds: response.advance.requestedHorizonMicroseconds,
            committedMicroseconds: response.advance.committedHorizonMicroseconds,
            status: response.advance.executionStatus,
            computeMs: response.metrics?.computeMs ?? null,
            resultSolved: response.advance.result?.solved ?? null,
            resultFinite: response.advance.result?.quality?.finite === true,
            resultPassed: response.advance.result?.quality?.passed === true,
            computeMsFinite: Number.isFinite(response.metrics?.computeMs),
            receivedAt: performance.now(),
          };
          probe.emit('frames', frame);
          if (
            matchedActiveRequest &&
            frame.status === 'ready' &&
            frame.resultSolved === true &&
            frame.resultFinite &&
            frame.resultPassed &&
            frame.computeMsFinite &&
            Number.isSafeInteger(frame.committedMicroseconds) &&
            frame.committedMicroseconds >= 0 &&
            frame.committedMicroseconds === frame.requestedMicroseconds
          ) {
            latestReady = frame;
            awaitingReady = false;
            // Give React an opportunity to settle; this is DOM sampling, not
            // proof that React committed this particular Worker response.
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const sampledFrame = latestReady;
                if (
                  !active ||
                  workerId !== id ||
                  !sampledFrame ||
                  sampledFrame.workerId !== id ||
                  sampledFrame.generationId !== frame.generationId ||
                  sampledFrame.projectSessionId !== frame.projectSessionId ||
                  binding?.generationId !== frame.generationId ||
                  binding.projectSessionId !== frame.projectSessionId
                )
                  return;
                const publication = sample();
                if (publication) probe.emit('settledSamples', publication);
              }),
            );
          }
        });
        return worker;
      },
    });
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => {
        const publication = sample();
        const text = publication?.text ?? '';
        const mount = publication?.mountId ?? 0;
        if (text !== priorText || mount !== priorMount) {
          priorText = text;
          priorMount = mount;
          if (publication) probe.emit('publications', publication);
        }
      }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-time-ms'],
      });
    });
  });
}

// BEGIN CLOCK COMMIT ATTRIBUTION: extracted by focused adversarial tests.
function attributeClockPublication(
  publication: ClockPublication,
  frames: ClockFrame[],
): ClockPublication {
  const milliseconds = Number(publication.marker);
  if (
    publication.marker === null ||
    publication.marker.trim() === '' ||
    !Number.isFinite(milliseconds) ||
    milliseconds < 0 ||
    !publication.documentId ||
    !Number.isSafeInteger(publication.mountId) ||
    publication.mountId < 1 ||
    !publication.mountBindingStable
  )
    throw new Error('Missing/invalid clock commit input or mount binding');
  const seconds = Math.floor(milliseconds / 1000);
  const expected = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  if (publication.text !== `Время моделирования: ${expected}`)
    throw new Error('Clock committed input/text mismatch');
  if (publication.startup && milliseconds === 0) {
    // Explicit startup, not evidence that any particular ready frame committed.
    return { ...publication, frame: null, equivalentRequestIds: [] };
  }
  const binding = publication.binding;
  if (!binding) throw new Error('Clock commit has no active binding');
  const candidates = frames.filter(
    (frame) =>
      frame.documentId === publication.documentId &&
      frame.workerId === binding.workerId &&
      frame.generationId === binding.generationId &&
      frame.projectSessionId === binding.projectSessionId &&
      frame.matchedActiveRequest &&
      frame.status === 'ready' &&
      frame.resultSolved === true &&
      frame.resultFinite &&
      frame.resultPassed &&
      frame.computeMsFinite &&
      Number.isSafeInteger(frame.committedMicroseconds) &&
      frame.committedMicroseconds >= 0 &&
      frame.committedMicroseconds === frame.requestedMicroseconds &&
      frame.committedMicroseconds / 1000 === milliseconds &&
      Number.isFinite(frame.receivedAt) &&
      frame.receivedAt <= publication.publishedAt,
  );
  if (!candidates.length) throw new Error('Clock commit input has no equivalent ready provenance');
  return {
    ...publication,
    frame: candidates[candidates.length - 1],
    equivalentRequestIds: candidates.map((frame) => frame.requestId),
  };
}
// END CLOCK COMMIT ATTRIBUTION

async function observation(page: Page) {
  const store = clockStores.get(page);
  if (!store) throw new Error('Node clock receipt store is missing');
  const barrier = await page.evaluate(async () => {
    const probe = (window as unknown as ProbeWindow).__integerClockProbe;
    if (!probe) throw new Error('Real Worker observer is missing');
    return probe.drain();
  });
  expect(store.errors).toEqual([]);
  expect(barrier.errors).toEqual([]);
  expect(barrier.ack.sequence).toBe(barrier.sequence);
  const retained = store.documents.get(barrier.documentId);
  expect(retained?.sequence ?? 0).toBeGreaterThanOrEqual(barrier.sequence);
  expect(barrier.ack.hash).toBe(barrier.sequence ? retained?.hashes[barrier.sequence - 1] : '');
  const result = structuredClone(store.probe);
  const readyByInput = new Map<string, ClockFrame[]>();
  const key = (documentId: string, binding: ClockPublication['binding'], milliseconds: number) =>
    JSON.stringify([
      documentId,
      binding?.workerId,
      binding?.generationId,
      binding?.projectSessionId,
      milliseconds,
    ]);
  for (const frame of result.frames) {
    const input = key(frame.documentId, frame, frame.committedMicroseconds / 1000);
    const group = readyByInput.get(input) ?? [];
    group.push(frame);
    readyByInput.set(input, group);
  }
  for (const kind of ['publications', 'settledSamples'] as const)
    result[kind] = result[kind].map((publication) =>
      attributeClockPublication(
        publication,
        readyByInput.get(
          key(publication.documentId, publication.binding, Number(publication.marker)),
        ) ?? [],
      ),
    );
  return result;
}

async function markAction(page: Page, name: string) {
  await page.evaluate((name) => {
    (window as unknown as ProbeWindow).__integerClockProbe?.emit('actions', {
      name,
      at: performance.now(),
    });
  }, name);
}

async function projectDraft(page: Page, projectId: string) {
  const response = await page.context().request.get(`/api/projects/${projectId}`, {
    headers: { origin: new URL(page.url()).origin },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    draft: { revision: number; document: SchematicDocument; updatedAt: string };
  };
}

async function runStopWithRealClock(page: Page, phase: string, testInfo: TestInfo) {
  const before = await observation(page);
  await markAction(page, `${phase}:Run`);
  await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Остановить моделирование', exact: true }),
  ).toHaveAttribute('data-simulation-status', 'running');
  await expect
    .poll(async () => {
      const probe = await observation(page);
      return probe.settledSamples
        .slice(before.settledSamples.length)
        .some(
          (entry) =>
            entry.frame &&
            entry.frame.committedMicroseconds > 0 &&
            entry.frame.committedMicroseconds % 1_000_000 !== 0,
        );
    })
    .toBe(true);
  // Fractional horizons need not change integer text. Sample them independently
  // of MutationObserver publications, retaining the exact floor oracle below.
  const fractional = (await observation(page)).settledSamples
    .slice(before.settledSamples.length)
    .find(
      (entry) =>
        entry.frame &&
        entry.frame.committedMicroseconds > 0 &&
        entry.frame.committedMicroseconds % 1_000_000 !== 0,
    )!;
  expect(fractional.text).toMatch(/^Время моделирования: \d{2,}:\d{2}:\d{2}$/);
  const fractionalSeconds = Math.floor(fractional.frame!.committedMicroseconds / 1_000_000);
  const fractionalExpected = [
    Math.floor(fractionalSeconds / 3600),
    Math.floor(fractionalSeconds / 60) % 60,
    fractionalSeconds % 60,
  ]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  expect(fractional.text).toBe(`Время моделирования: ${fractionalExpected}`);
  await expect
    .poll(async () => {
      const probe = await observation(page);
      return probe.publications
        .slice(before.publications.length)
        .some((entry) => entry.frame && entry.frame.committedMicroseconds >= 1_000_000);
    })
    .toBe(true);
  const geometry = await page.evaluate(() => {
    const clock = document.querySelector('.workbench-simulation-time')!;
    const button = document.querySelector('.workbench-pill.simulate')!;
    const c = clock.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    const caption = Array.from(button.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
      .map((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return { text: node.textContent?.trim(), left: rect.left, right: rect.right };
      });
    return {
      viewportWidth: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      clockLeft: c.left,
      clockRight: c.right,
      clockWidth: c.width,
      clockScrollWidth: clock.scrollWidth,
      clockClientWidth: clock.clientWidth,
      buttonLeft: b.left,
      buttonRight: b.right,
      buttonHit: hit !== null && button.contains(hit),
      caption,
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.clockLeft).toBeGreaterThanOrEqual(-1);
  expect(geometry.clockRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.clockScrollWidth).toBeLessThanOrEqual(geometry.clockClientWidth + 1);
  expect(geometry.buttonLeft).toBeGreaterThanOrEqual(-1);
  expect(geometry.buttonRight).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.buttonHit).toBe(true);
  expect(geometry.caption.map((entry) => entry.text).join('')).toBe('Остановить моделирование');
  for (const caption of geometry.caption) {
    expect(caption.left).toBeGreaterThanOrEqual(geometry.buttonLeft - 1);
    expect(caption.right).toBeLessThanOrEqual(geometry.buttonRight + 1);
  }
  const runningClockPath = testInfo.outputPath(`${phase}-running-clock.png`);
  await page.screenshot({ path: runningClockPath });
  await testInfo.attach(`${phase}-running-clock`, {
    path: runningClockPath,
    contentType: 'image/png',
  });
  await markAction(page, `${phase}:Stop`);
  await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
  await expect(page.locator('.workbench-simulation-time')).toHaveCount(0);
  const after = await observation(page);
  const frames = after.frames.slice(before.frames.length);
  expect(
    frames.some(
      (frame) =>
        frame.matchedActiveRequest &&
        frame.status === 'ready' &&
        frame.resultSolved === true &&
        frame.resultFinite &&
        frame.resultPassed &&
        frame.computeMsFinite &&
        frame.committedMicroseconds === frame.requestedMicroseconds &&
        frame.committedMicroseconds > 0 &&
        frame.committedMicroseconds % 1_000_000 !== 0,
    ),
  ).toBe(true);
  expect(
    frames.some((frame) => frame.status === 'ready' && frame.committedMicroseconds === 0),
  ).toBe(true);
  for (const frame of frames) {
    expect(Number.isSafeInteger(frame.committedMicroseconds)).toBe(true);
    expect(frame.committedMicroseconds).toBeLessThanOrEqual(frame.requestedMicroseconds);
    if (frame.status === 'ready')
      expect(frame.committedMicroseconds).toBe(frame.requestedMicroseconds);
    if (frame.status === 'ready') {
      expect(frame.resultSolved).toBe(true);
      expect(frame.resultFinite).toBe(true);
      expect(frame.resultPassed).toBe(true);
    }
    expect(frame.status).not.toBe('fault');
    expect(frame.computeMs).not.toBeNull();
    expect(frame.computeMsFinite).toBe(true);
    expect(Number.isFinite(frame.computeMs)).toBe(true);
  }
  for (const publication of [
    ...after.publications.slice(before.publications.length),
    ...after.settledSamples.slice(before.settledSamples.length),
  ]) {
    if (!publication.frame) {
      expect(publication.startup).toBe(true);
      expect(publication.text).toBe('Время моделирования: 00:00:00');
      continue;
    }
    expect(publication.frame.matchedActiveRequest).toBe(true);
    expect(publication.frame.status).toBe('ready');
    expect(publication.frame.resultSolved).toBe(true);
    expect(publication.frame.resultFinite).toBe(true);
    expect(publication.frame.resultPassed).toBe(true);
    expect(publication.frame.computeMsFinite).toBe(true);
    expect(Number.isFinite(publication.frame.computeMs)).toBe(true);
    const seconds = Math.floor(publication.frame.committedMicroseconds / 1_000_000);
    const expected = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((part) => String(part).padStart(2, '0'))
      .join(':');
    expect(publication.text).toBe(`Время моделирования: ${expected}`);
    expect(publication.publishedAt).toBeGreaterThanOrEqual(publication.frame.receivedAt);
  }
  return {
    phase,
    geometry,
    frames,
    settledSamples: after.settledSamples.slice(before.settledSamples.length),
    publications: after.publications.slice(before.publications.length),
  };
}

let admin: pg.Pool;
test.beforeAll(() => {
  admin = e2eAdminPool();
});
test.afterAll(async () => {
  await admin.end();
});

for (const width of [1440, 1024, 390, 320]) {
  test(`integer simulation time: real DC Run Stop save reopen at ${width}px`, async ({
    page,
    browser,
  }, testInfo) => {
    const teacher = await seedTeacher(
      admin,
      `e2e-integer-clock-${width}-${testInfo.workerIndex}-${testInfo.retry}`,
    );
    const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
    const phases: unknown[] = [];
    await page.setViewportSize({ width: 1440, height: 900 });
    await observeRealClock(page, testInfo.outputPath(`integer-clock-${width}-source.jsonl`));
    await loginWithOrganization(page, teacher);
    const sessionResponse = await page.context().request.get('/api/auth/me');
    expect(sessionResponse.status()).toBe(200);
    const session = (await sessionResponse.json()) as {
      authenticated: boolean;
      user: { id: string };
    };
    expect(session.authenticated).toBe(true);
    const userId = session.user.id;
    const created = await page.context().request.post('/api/projects', {
      headers: { origin: new URL(page.url()).origin, 'idempotency-key': crypto.randomUUID() },
      data: {
        scope: 'personal',
        classroomId: null,
        module: 'electronics',
        title: `Целое время ${width}`,
      },
    });
    expect(created.status()).toBe(201);
    const projectId = ((await created.json()) as { project: { id: string } }).project.id;
    const empty = await projectDraft(page, projectId);
    const seeded = await page.context().request.put(`/api/projects/${projectId}/draft`, {
      headers: { origin: new URL(page.url()).origin },
      data: {
        document: initialDocument,
        baseRevision: empty.draft.revision,
        mutationId: crypto.randomUUID(),
      },
    });
    expect(seeded.status()).toBe(200);
    let reopened: Page | null = null;
    let primaryError: unknown;
    let primaryFailed = false;
    try {
      await page.goto(`/#/home/${projectId}`);
      await expect(page.locator('.workbench-stage')).toBeVisible();
      await page.locator('[data-component-id="resistor"] .workbench-part').press('Enter');
      const resistance = page
        .locator('.workbench-inspector label')
        .filter({ hasText: 'Сопротивление' })
        .locator('input[type="number"]');
      await resistance.fill('333.3');
      await expect(resistance).toHaveValue('333.3');
      const localKey = `asa-project-local-draft:user:account:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`;
      const wholeEdited = await page.evaluate(
        ({ key, id, userId }) => {
          const raw = localStorage.getItem(key);
          if (!raw) throw new Error('Edited full local document is missing');
          const record = JSON.parse(raw) as {
            schemaVersion: number;
            identityKind: string;
            userId: string;
            projectId: string;
            moduleKey: string;
            document: SchematicDocument;
          };
          if (
            record.schemaVersion !== 3 ||
            record.identityKind !== 'account' ||
            record.userId !== userId ||
            record.projectId !== id ||
            record.moduleKey !== 'electronics'
          )
            throw new Error('Edited full local document belongs to another identity or scope');
          return record.document;
        },
        { key: localKey, id: projectId, userId },
      );
      expect(wholeEdited.components.find((item) => item.id === 'resistor')?.value).toBe(333.3);
      const beforeSave = await projectDraft(page, projectId);
      await markAction(page, 'Save');
      await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
      await expect
        .poll(async () => (await projectDraft(page, projectId)).draft.document)
        .toEqual(wholeEdited);
      const saved = await projectDraft(page, projectId);
      expect(saved.draft.revision).toBe(beforeSave.draft.revision + 1);
      phases.push({ wholeEdited, beforeSave: beforeSave.draft, saved: saved.draft });
      await page.setViewportSize({ width, height: 900 });
      phases.push(await runStopWithRealClock(page, 'first', testInfo));
      phases.push(await runStopWithRealClock(page, 'restart', testInfo));
      expect((await projectDraft(page, projectId)).draft).toEqual(saved.draft);
      const cookies = await page.context().cookies();
      const fresh = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width, height: 900 },
      });
      let freshPrimaryError: unknown;
      let freshFailed = false;
      try {
        await fresh.addCookies(cookies);
        reopened = await fresh.newPage();
        const freshFailures = collectBrowserFailures(reopened, {
          allowAnonymousSessionProbe: true,
        });
        await observeRealClock(
          reopened,
          testInfo.outputPath(`integer-clock-${width}-reopened.jsonl`),
        );
        await reopened.goto(`/#/home/${projectId}`);
        await expect(reopened.locator('.workbench-stage')).toBeVisible();
        expect(
          await reopened.evaluate(() =>
            Object.keys(localStorage).filter((key) => key.startsWith('asa-project-local-draft:')),
          ),
        ).toEqual([]);
        expect((await projectDraft(reopened, projectId)).draft).toEqual(saved.draft);
        // The reopened DOM must expose the actual persisted component value.
        await reopened.locator('[data-component-id="resistor"] .workbench-part').press('Enter');
        await expect(
          reopened
            .locator('.workbench-inspector label')
            .filter({ hasText: 'Сопротивление' })
            .locator('input[type="number"]'),
        ).toHaveValue('333.3');
        phases.push(await runStopWithRealClock(reopened, 'cookies-only-reopen', testInfo));
        expect((await projectDraft(reopened, projectId)).draft).toEqual(saved.draft);
        freshFailures.assertEmpty();
      } catch (error) {
        freshPrimaryError = error;
        freshFailed = true;
      } finally {
        let cleanupError: unknown;
        try {
          if (reopened) phases.push({ reopenedProbe: await observation(reopened) });
        } catch (error) {
          cleanupError = error;
          phases.push({
            reopenedDrainError: String(error),
            retained: reopened ? clockStores.get(reopened) : null,
          });
        }
        try {
          await fresh.close();
        } catch (error) {
          cleanupError ??= error;
        }
        reopened = null;
        if (!freshFailed && cleanupError) {
          freshPrimaryError = cleanupError;
          freshFailed = true;
        }
      }
      if (freshFailed) throw freshPrimaryError;
      failures.assertEmpty();
    } catch (error) {
      primaryError = error;
      primaryFailed = true;
    } finally {
      const rawPath = testInfo.outputPath(`integer-clock-${width}-raw.json`);
      let finalError: unknown;
      let probe: ClockProbe | undefined;
      let server: unknown;
      try {
        probe = await observation(page);
      } catch (error) {
        finalError = error;
      }
      try {
        server = await projectDraft(page, projectId);
      } catch (error) {
        finalError ??= error;
      }
      const retained = clockStores.get(page);
      try {
        await writeFile(
          rawPath,
          JSON.stringify(
            {
              width,
              projectId,
              phases,
              probe: probe ?? retained?.probe,
              server,
              primaryError: primaryError ? String(primaryError) : null,
              retention: {
                path: retained?.path,
                errors: retained?.errors,
                documents: retained ? Array.from(retained.documents.entries()) : [],
                finalDrainError: finalError ? String(finalError) : null,
              },
            },
            null,
            2,
          ),
          'utf8',
        );
        await testInfo.attach(`integer-clock-${width}-raw`, {
          path: rawPath,
          contentType: 'application/json',
        });
        await page.screenshot({ path: testInfo.outputPath(`integer-clock-${width}.png`) });
      } catch (error) {
        finalError ??= error;
      }
      if (!primaryFailed && finalError) {
        primaryError = finalError;
        primaryFailed = true;
      }
    }
    if (primaryFailed) throw primaryError;
  });
}
