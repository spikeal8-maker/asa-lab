import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import type pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import { parseElectronicsDocument } from '../contexts/electronics/domain/document';
import type {
  ElectronicsSimulationWorkerRequest,
  ElectronicsSimulationWorkerResponse,
} from '../apps/web/src/electronics/simulation-worker-protocol';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher } from './seed';

type Pcm = {
  contextId: number;
  gainId: number;
  state: AudioContextState;
  contextTime: number;
  sampleRate: number;
  samples: number[];
};
type RecordEntry = { field: string; value: unknown };
type ObservedWindow = Window & {
  __piezoRecord?: (record: RecordEntry) => Promise<void>;
  __piezoPcm?: () => Pcm[];
};
type RequestRecord = {
  order: number;
  workerId: number;
  request: ElectronicsSimulationWorkerRequest;
};
type ResponseRecord = {
  order: number;
  workerId: number;
  response: ElectronicsSimulationWorkerResponse;
};
type Run = {
  workerId: number;
  generationId: number;
  projectSessionId: string;
  startedOrder: number;
};
type Publication = {
  order: number;
  status: string | null;
  activeRun: Run | null;
  parts: Array<{ id: string | null; frequency: number; sounding: boolean }>;
};
type Scenario = 'original-active' | 'piezo-passive-buzzer' | 'piezo-disc';

function rawFixture(scenario: Scenario): SchematicDocument {
  if (scenario === 'original-active') return ORIGINAL_ACTIVE;
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'uno',
        kind: 'visual',
        componentTypeId: 'arduino-uno',
        variantId: 'arduino-uno',
        name: 'Arduino Uno',
        position: { x: 100, y: 100 },
        value: 5,
        pinIds: ['d8', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
        stateProperties: {
          arduinoCodeMode: 'text',
          arduinoSource:
            'void setup(){tone(8,1000);delay(1000);noTone(8);}void loop(){delay(100);}',
          arduinoWorkspace: '{"blocks":{"blocks":[]}}',
          arduinoBaudRate: 9600,
          arduinoSerialOpen: false,
        },
      },
      {
        id: 'sounder',
        kind: 'piezo',
        componentTypeId: scenario,
        variantId: scenario,
        name: 'Пьезоэлемент',
        position: { x: 520, y: 280 },
        value: 0,
        pinIds: ['positive', 'negative'],
        stateProperties: { piezoMode: 'passive' },
      },
      {
        id: 'resistor',
        kind: 'resistor',
        componentTypeId: 'resistor-axial',
        variantId: 'resistor-axial',
        name: 'R1',
        position: { x: 700, y: 150 },
        value: 220,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { powerRatingWatt: 0.25 },
      },
    ],
    connections: [
      {
        id: 'tone-positive',
        from: { componentId: 'uno', terminal: 'd8' },
        to: { componentId: 'sounder', terminal: 'positive' },
        vertices: [],
        color: '#149447',
      },
      {
        id: 'tone-negative',
        from: { componentId: 'sounder', terminal: 'negative' },
        to: { componentId: 'uno', terminal: 'power-gnd-1' },
        vertices: [],
        color: '#000000',
      },
      {
        id: 'load-positive',
        from: { componentId: 'uno', terminal: 'power-5v' },
        to: { componentId: 'resistor', terminal: 'lead-1' },
        vertices: [],
        color: '#ff0000',
      },
      {
        id: 'load-negative',
        from: { componentId: 'resistor', terminal: 'lead-2' },
        to: { componentId: 'uno', terminal: 'power-gnd-1' },
        vertices: [],
        color: '#000000',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function fixture(scenario: Scenario) {
  const parsed = parseElectronicsDocument(rawFixture(scenario));
  if (!parsed.ok) throw new Error('Invalid piezo fixture ' + scenario + ': ' + parsed.message);
  return parsed.document;
}

function evidence(info: TestInfo, scenario: Scenario) {
  const path = info.outputPath(`piezo-${scenario}-originals.json`);
  const raw = {
    fixture: fixture(scenario),
    lastCheckpoint: 'created',
    requests: [] as RequestRecord[],
    responses: [] as ResponseRecord[],
    records: [] as Array<{ page: string; field: string; value: unknown }>,
    puts: [] as unknown[],
    documents: [] as unknown[],
    errors: [] as string[],
    supplements: {} as Record<string, unknown>,
    primaryFailure: null as string | null,
    limitations: { schoolFrequency: 'NOT_PROVED', schoolAudibility: 'NOT_VERIFIED', T3: 'PENDING' },
  };
  // This separate journal cannot be overwritten by an older queued async snapshot.
  const primaryPath = info.outputPath(`piezo-${scenario}-primary-failure.json`);
  const flushPrimary = () => {
    try {
      writeFileSync(primaryPath, JSON.stringify(raw, null, 2));
    } catch (error) {
      raw.errors.push(`primary journal write: ${String(error)}`);
      console.error(error);
    }
  };
  const recordPrimary = (error: unknown, name: string) => {
    raw.primaryFailure ??= String(error);
    raw.lastCheckpoint = name;
    flushPrimary();
  };
  const skipAfterFailure = (names: string[]) => {
    for (const name of names) {
      raw.supplements[name] = {
        status: 'NOT_AVAILABLE',
        reason: 'primary failure already recorded',
      };
    }
    flushPrimary();
  };
  const closeAfterFailure = (operation: () => Promise<unknown>) => {
    const name = 'cookies-context-close';
    raw.supplements[name] = { status: 'PENDING' };
    flushPrimary();
    const failed = (error: unknown) => {
      raw.supplements[name] = { status: 'NOT_AVAILABLE', error: String(error) };
      raw.errors.push(`${name}: ${String(error)}`);
      console.error(error);
      flushPrimary();
    };
    try {
      void operation().then(() => {
        raw.supplements[name] = { status: 'CAPTURED' };
        flushPrimary();
      }, failed);
    } catch (error) {
      failed(error);
    }
  };
  let pending = Promise.resolve();
  const persist = () =>
    (pending = pending.then(async () => {
      try {
        await writeFile(path, JSON.stringify(raw, null, 2));
      } catch (error) {
        raw.errors.push(`raw write: ${String(error)}`);
        console.error(error);
      }
    }));
  const checkpoint = async (name: string) => {
    raw.lastCheckpoint = name;
    await persist();
  };
  const guard = async (name: string, operation: () => Promise<unknown>) => {
    await checkpoint(`before:${name}`);
    try {
      raw.supplements[name] = { status: 'CAPTURED', value: await operation() };
    } catch (error) {
      raw.supplements[name] = { status: 'NOT_AVAILABLE', error: String(error) };
      raw.errors.push(`${name}: ${String(error)}`);
    }
    await persist();
  };
  return {
    raw,
    persist,
    checkpoint,
    guard,
    recordPrimary,
    skipAfterFailure,
    closeAfterFailure,
    async receive(page: string, entry: RecordEntry) {
      raw.records.push({ page, ...entry });
      if (entry.field === 'capture-error') raw.errors.push(String(entry.value));
      if (entry.field === 'request') raw.requests.push(entry.value as RequestRecord);
      if (entry.field === 'response') raw.responses.push(entry.value as ResponseRecord);
      await persist();
    },
  };
}
type Evidence = ReturnType<typeof evidence>;

async function observe(page: Page, original: Evidence, pageName: string) {
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/projects')) return;
    void original.receive(pageName, {
      field: 'project-request',
      value: { method: request.method(), path, body: request.postDataJSON() },
    });
  });
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith('/api/projects')) return;
    void response
      .json()
      .then((body) =>
        original.receive(pageName, {
          field: 'project-response',
          value: { method: response.request().method(), path, status: response.status(), body },
        }),
      )
      .catch((error) =>
        original.receive(pageName, { field: 'capture-error', value: String(error) }),
      );
  });
  await page.exposeBinding('__piezoRecord', (_source, entry: RecordEntry) =>
    original.receive(pageName, entry),
  );
  await page.addInitScript(() => {
    const emit = (field: string, value: unknown) => {
      void (window as ObservedWindow).__piezoRecord?.({ field, value }).catch(() => {});
    };
    let workerId = 0;
    let order = 0;
    let activeRun: Run | null = null;
    window.Worker = new Proxy(window.Worker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        if ((args[1] as WorkerOptions | undefined)?.name !== 'asa-electronics-simulation')
          return worker;
        const id = ++workerId;
        worker.postMessage = new Proxy(worker.postMessage, {
          apply(target, thisArg, args) {
            const request = args[0] as ElectronicsSimulationWorkerRequest;
            const requestOrder = ++order;
            if (request.kind === 'preflight')
              activeRun = {
                workerId: id,
                generationId: request.generationId,
                projectSessionId: request.projectSessionId,
                startedOrder: requestOrder,
              };
            if (
              request.kind === 'cancel-generation' &&
              activeRun?.workerId === id &&
              activeRun.generationId === request.generationId &&
              activeRun.projectSessionId === request.projectSessionId
            )
              activeRun = null;
            emit('request', {
              order: requestOrder,
              workerId: id,
              request: structuredClone(request),
            });
            return Reflect.apply(target, thisArg, args);
          },
        });
        worker.addEventListener(
          'message',
          (event: MessageEvent<ElectronicsSimulationWorkerResponse>) =>
            emit('response', {
              order: ++order,
              workerId: id,
              response: structuredClone(event.data),
            }),
        );
        return worker;
      },
    });
    const taps: Array<{
      context: AudioContext;
      analyser: AnalyserNode;
      gainId: number;
      contextId: number;
    }> = [];
    let contextId = 0;
    let gainId = 0;
    window.AudioContext = new Proxy(window.AudioContext, {
      construct(target, args, newTarget) {
        const context = Reflect.construct(target, args, newTarget) as AudioContext;
        const id = ++contextId;
        emit('audio', {
          type: 'constructed',
          contextId: id,
          state: context.state,
          userActive: navigator.userActivation.isActive,
        });
        context.addEventListener('statechange', () =>
          emit('audio', {
            type: 'statechange',
            contextId: id,
            state: context.state,
            contextTime: context.currentTime,
          }),
        );
        context.createGain = new Proxy(context.createGain, {
          apply(target, thisArg, args) {
            const gain = Reflect.apply(target, thisArg, args) as GainNode;
            const gid = ++gainId;
            const connect = gain.connect;
            let attached = false;
            gain.connect = new Proxy(connect, {
              apply(target, thisArg, args) {
                const result = Reflect.apply(target, thisArg, args);
                if (!attached && args[0] === context.destination) {
                  attached = true;
                  const analyser = context.createAnalyser();
                  analyser.fftSize = 4096;
                  Reflect.apply(connect, gain, [analyser]);
                  taps.push({ context, analyser, contextId: id, gainId: gid });
                  emit('audio', {
                    type: 'parallel-native-analyser',
                    contextId: id,
                    gainId: gid,
                    originalDestinationPreserved: true,
                  });
                }
                return result;
              },
            });
            return gain;
          },
        });
        return context;
      },
    });
    (window as ObservedWindow).__piezoPcm = () =>
      taps.map(({ context, analyser, gainId, contextId }) => {
        const buffer = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buffer);
        const result: Pcm = {
          contextId,
          gainId,
          state: context.state,
          contextTime: context.currentTime,
          sampleRate: context.sampleRate,
          samples: Array.from(buffer),
        };
        emit('pcm', result);
        return result;
      });
    const publish = () => {
      const parts = [...document.querySelectorAll('[data-piezo-frequency]')].map((part) => ({
        id: part.closest('[data-component-id]')?.getAttribute('data-component-id') ?? null,
        frequency: Number(part.getAttribute('data-piezo-frequency')),
        sounding: part.getAttribute('data-piezo-sounding') === 'true',
      }));
      if (parts.length)
        emit('publication', {
          order: ++order,
          status:
            document
              .querySelector('button[data-simulation-status]')
              ?.getAttribute('data-simulation-status') ?? null,
          activeRun: activeRun ? { ...activeRun } : null,
          parts,
        });
    };
    const observer = new MutationObserver(publish);
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-piezo-frequency', 'data-piezo-sounding', 'data-simulation-status'],
    });
    document.addEventListener(
      'click',
      (event) => {
        const target =
          event.target instanceof Element
            ? event.target.closest('button[data-simulation-status]')
            : null;
        if (target)
          emit('action', {
            trusted: event.isTrusted,
            status: target.getAttribute('data-simulation-status'),
            at: performance.now(),
          });
      },
      true,
    );
  });
}

function spectral(samples: Pcm) {
  const rms = Math.sqrt(
    samples.samples.reduce((sum, value) => sum + value * value, 0) / samples.samples.length,
  );
  const crossings: number[] = [];
  for (let i = 1; i < samples.samples.length; i++)
    if (samples.samples[i - 1]! <= 0 && samples.samples[i]! > 0)
      crossings.push(
        i - 1 + -samples.samples[i - 1]! / (samples.samples[i]! - samples.samples[i - 1]!),
      );
  return {
    rms,
    frequency:
      crossings.length > 1
        ? (samples.sampleRate * (crossings.length - 1)) / (crossings.at(-1)! - crossings[0]!)
        : 0,
  };
}
async function pcm(page: Page) {
  return page.evaluate(() => (window as ObservedWindow).__piezoPcm?.() ?? []);
}
function advances(original: Evidence, start: number) {
  return original.raw.responses.slice(start).filter(
    (
      record,
    ): record is ResponseRecord & {
      response: Extract<ElectronicsSimulationWorkerResponse, { ok: true; kind: 'advance' }>;
    } => record.response.ok && record.response.kind === 'advance',
  );
}
function assertComplete(original: Evidence, start: number) {
  const frames = advances(original, start);
  expect(frames.length).toBeGreaterThan(0);
  for (const { workerId, response } of frames) {
    const request = original.raw.requests.find(
      (entry) =>
        entry.workerId === workerId &&
        entry.request.requestId === response.requestId &&
        entry.request.generationId === response.generationId &&
        entry.request.projectSessionId === response.projectSessionId,
    )?.request;
    expect(request).toBeDefined();
    expect(request!.kind).toBe('advance');
    if (request!.kind !== 'advance') throw new Error('Missing real advance request');
    expect(response.advance.requestedHorizonMicroseconds).toBe(
      request!.requestedHorizonMicroseconds,
    );
    expect(Number.isFinite(response.metrics.computeMs)).toBe(true);
    expect(response.advance.executionStatus).not.toBe('fault');
    if (response.advance.executionStatus === 'ready') {
      expect(response.advance.committedHorizonMicroseconds).toBe(
        response.advance.requestedHorizonMicroseconds,
      );
      expect(response.advance.result).toMatchObject({
        solved: true,
        quality: { finite: true, passed: true },
      });
    } else {
      expect(response.advance.result).toBeNull();
      expect(response.advance.committedHorizonMicroseconds).toBeLessThan(
        response.advance.requestedHorizonMicroseconds,
      );
    }
  }
  const publications = original.raw.records.filter((entry) => entry.field === 'publication');
  expect(
    publications.some((entry) => {
      const value = entry.value as Publication;
      return (
        value.status === 'running' && value.activeRun && value.parts.some((part) => part.sounding)
      );
    }),
  ).toBe(true);
  for (const entry of publications) {
    const publication = entry.value as Publication;
    if (publication.status !== 'running' || !publication.activeRun) continue;
    const run = publication.activeRun;
    for (const part of publication.parts.filter((part) => part.sounding)) {
      const coherent = original.raw.records.some((record) => {
        if (record.page !== entry.page || record.field !== 'response') return false;
        const frame = record.value as ResponseRecord;
        const response = frame.response;
        if (
          frame.workerId !== run.workerId ||
          frame.order <= run.startedOrder ||
          frame.order >= publication.order ||
          response.generationId !== run.generationId ||
          response.projectSessionId !== run.projectSessionId ||
          !response.ok ||
          response.kind !== 'advance'
        )
          return false;
        const advance = response.advance;
        return (
          advance.executionStatus === 'ready' &&
          advance.committedHorizonMicroseconds === advance.requestedHorizonMicroseconds &&
          advance.result?.components.some(
            (component) =>
              component.componentId === part.id &&
              component.frequencyHz === part.frequency &&
              component.energized === true &&
              (component.soundLevel ?? 0) > 0,
          )
        );
      });
      expect(coherent, 'Sounding UI projects a prior complete ready from the same real run').toBe(
        true,
      );
    }
  }
}
async function run(page: Page, original: Evidence, scenario: Scenario, name: string) {
  const start = original.raw.responses.length;
  await original.checkpoint(`before:${name}:run`);
  await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
  const stop = page.getByRole('button', { name: 'Остановить моделирование', exact: true });
  await expect(stop).toHaveAttribute('data-simulation-status', 'running');
  const expectedFrequency = scenario === 'original-active' ? 2300 : 1000;
  await expect
    .poll(() =>
      advances(original, start).some(
        ({ response }) =>
          response.advance.executionStatus === 'ready' &&
          response.advance.result?.components.some(
            (part) => part.frequencyHz === expectedFrequency && (part.soundLevel ?? 0) > 0,
          ),
      ),
    )
    .toBe(true);
  const visual = page
    .locator(
      `[data-component-id="${scenario === 'original-active' ? 'sounder-one' : 'sounder'}"] [data-piezo-frequency]`,
    )
    .first();
  await expect(visual).toHaveAttribute('data-piezo-frequency', String(expectedFrequency));
  await expect(visual).toHaveAttribute('data-piezo-sounding', 'true');
  assertComplete(original, start);
  let sounding: Pcm[] = [];
  await expect
    .poll(async () => {
      sounding = await pcm(page);
      return sounding.some((sample) => {
        const measured = spectral(sample);
        return (
          sample.state === 'running' &&
          measured.rms > 0.00001 &&
          Math.abs(measured.frequency - expectedFrequency) < 20
        );
      });
    })
    .toBe(true);
  const first = sounding.find((sample) => spectral(sample).rms > 0.00001)!;
  await original.checkpoint(`${name}:native-${expectedFrequency}Hz`);
  await original.guard(`${name}:sounding-png`, () =>
    page.screenshot({ path: test.info().outputPath(`piezo-${name}-sounding.png`), fullPage: true }),
  );
  if (scenario !== 'original-active') {
    await expect
      .poll(() =>
        advances(original, start).some(
          ({ response }) =>
            response.advance.executionStatus === 'ready' &&
            response.advance.committedHorizonMicroseconds >= 1_000_000 &&
            response.advance.result?.components.some(
              (part) =>
                part.componentId === 'sounder' && part.frequencyHz === 0 && part.soundLevel === 0,
            ),
        ),
      )
      .toBe(true);
    await expect
      .poll(async () => {
        const samples = (await pcm(page)).filter(
          (sample) => sample.contextId === first.contextId && sample.gainId === first.gainId,
        );
        return (
          samples.length > 0 &&
          samples.every(
            (sample) =>
              sample.contextTime > first.contextTime + 0.1 && spectral(sample).rms < 0.00001,
          )
        );
      })
      .toBe(true);
    await expect(visual).toHaveAttribute('data-piezo-frequency', '0');
    await expect(visual).toHaveAttribute('data-piezo-sounding', 'false');
    await original.checkpoint(`${name}:noTone-native-silence`);
  }
  await stop.click();
  await expect(
    page.getByRole('button', { name: 'Начать моделирование', exact: true }),
  ).toHaveAttribute('data-simulation-status', 'stopped');
  await expect
    .poll(async () => {
      const samples = (await pcm(page)).filter(
        (sample) => sample.contextId === first.contextId && sample.gainId === first.gainId,
      );
      return samples.length > 0 && samples.every((sample) => spectral(sample).rms < 0.00001);
    })
    .toBe(true);
  assertComplete(original, start);
  expect(
    original.raw.records
      .filter((entry) => entry.field === 'action')
      .every((entry) => (entry.value as { trusted: boolean }).trusted),
  ).toBe(true);
  await original.checkpoint(`${name}:stopped-native-silence`);
}
async function draft(page: Page, id: string) {
  const response = await page.context().request.get(`/api/projects/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as { draft: { revision: number; document: SchematicDocument } };
}
let admin: pg.Pool;
test.use({ trace: 'on' });
test.beforeAll(() => {
  for (const scenario of ['original-active', 'piezo-passive-buzzer', 'piezo-disc'] as const) {
    fixture(scenario);
  }
  admin = e2eAdminPool();
});
test.afterAll(async () => {
  await admin.end();
});
for (const scenario of ['original-active', 'piezo-passive-buzzer', 'piezo-disc'] as const)
  test(`canonical installed ${scenario} native PCM, noTone, Stop and whole Save reopen`, async ({
    page,
    browser,
  }, info) => {
    const original = evidence(info, scenario);
    let id: string | undefined;
    let primary: unknown;
    const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
    try {
      await original.checkpoint('before:seed');
      const teacher = await seedTeacher(admin, `e2e-piezo-clock-${scenario}-${info.workerIndex}`);
      await observe(page, original, 'initial');
      await loginWithOrganization(page, teacher);
      const created = await page.context().request.post('/api/projects', {
        headers: { origin: new URL(page.url()).origin, 'idempotency-key': crypto.randomUUID() },
        data: {
          scope: 'personal',
          classroomId: null,
          module: 'electronics',
          title: `Пьезо ${scenario}`,
        },
      });
      expect(created.status()).toBe(201);
      id = ((await created.json()) as { project: { id: string } }).project.id;
      const empty = await draft(page, id);
      const seeded = await page.context().request.put(`/api/projects/${id}/draft`, {
        headers: { origin: new URL(page.url()).origin },
        data: {
          document: fixture(scenario),
          baseRevision: empty.draft.revision,
          mutationId: crypto.randomUUID(),
        },
      });
      expect(seeded.status()).toBe(200);
      page.on('request', (request) => {
        if (
          request.method() === 'PUT' &&
          new URL(request.url()).pathname === `/api/projects/${id}/draft`
        ) {
          original.raw.puts.push(request.postDataJSON());
          void original.persist();
        }
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/#/home/${id}`);
      await expect(page.locator('.workbench-stage')).toBeVisible();
      const initial = await draft(page, id);
      original.raw.documents.push({ initial });
      expect(initial.draft.document).toEqual(fixture(scenario));
      await run(page, original, scenario, 'initial');
      expect((await draft(page, id)).draft).toEqual(initial.draft);
      expect(original.raw.puts).toHaveLength(0);
      await page
        .locator('.workbench-stage [data-component-id="resistor"] .workbench-part')
        .press('Enter');
      const value = page
        .locator('.workbench-inspector label')
        .filter({ hasText: 'Сопротивление' })
        .locator('input[type="number"]');
      await value.fill('333.3');
      await expect(value).toHaveValue('333.3');
      const expected = {
        ...fixture(scenario),
        components: fixture(scenario).components.map((part) =>
          part.id === 'resistor' ? { ...part, value: 333.3 } : part,
        ),
      };
      await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
      await expect.poll(async () => (await draft(page, id!)).draft.document).toEqual(expected);
      const saved = await draft(page, id);
      expect(saved.draft.revision).toBe(initial.draft.revision + 1);
      expect(original.raw.puts).toHaveLength(1);
      expect(original.raw.puts[0]).toMatchObject({
        baseRevision: initial.draft.revision,
        document: expected,
      });
      original.raw.documents.push({ expected, saved });
      await original.checkpoint('whole-save-cas-plus-one');
      const fresh = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        viewport: { width: 1440, height: 900 },
      });
      let reopened: Page | undefined;
      let reopenFailure: unknown;
      try {
        await fresh.addCookies(await page.context().cookies());
        reopened = await fresh.newPage();
        await observe(reopened, original, 'cookies-only');
        const freshFailures = collectBrowserFailures(reopened, {
          allowAnonymousSessionProbe: true,
        });
        await reopened.goto(`/#/home/${id}`);
        await expect(reopened.locator('.workbench-stage')).toBeVisible();
        expect(
          await reopened.evaluate(() =>
            Object.keys(localStorage).filter((key) => key.startsWith('asa-project-local-draft:')),
          ),
        ).toEqual([]);
        expect((await draft(reopened, id)).draft).toEqual(saved.draft);
        await run(reopened, original, scenario, 'cookies-only');
        expect((await draft(reopened, id)).draft).toEqual(saved.draft);
        freshFailures.assertEmpty();
      } catch (error) {
        original.recordPrimary(error, 'catch:cookies-primary');
        reopenFailure = error;
      } finally {
        if (reopenFailure !== undefined) {
          original.skipAfterFailure(['cookies-dom', 'cookies-png']);
          original.closeAfterFailure(() => fresh.close());
        } else {
          await original.checkpoint('finally:cookies-node-originals');
          if (reopened) {
            const retained = reopened;
            await original.guard('cookies-dom', () =>
              retained.locator('body').evaluate((body) => body.outerHTML),
            );
            await original.guard('cookies-png', () =>
              retained.screenshot({ path: info.outputPath('cookies-final.png'), fullPage: true }),
            );
          }
          await original.guard('cookies-context-close', () => fresh.close());
        }
      }
      if (reopenFailure !== undefined) throw reopenFailure;
      failures.assertEmpty();
    } catch (error) {
      original.recordPrimary(error, 'catch:scenario-primary');
      primary = error;
    } finally {
      if (primary !== undefined) {
        original.skipAfterFailure([
          'final-dom',
          'final-png',
          'final-server-document',
          'raw-attachment',
        ]);
      } else {
        original.raw.primaryFailure = null;
        await original.checkpoint('finally:node-originals');
        await original.guard('final-dom', () =>
          page.locator('body').evaluate((body) => body.outerHTML),
        );
        await original.guard('final-png', () =>
          page.screenshot({ path: info.outputPath('final.png'), fullPage: true }),
        );
        if (id) await original.guard('final-server-document', () => draft(page, id!));
        await original.guard('raw-attachment', () =>
          info.attach('piezo-originals', {
            path: info.outputPath(`piezo-${scenario}-originals.json`),
            contentType: 'application/json',
          }),
        );
      }
    }
    if (primary !== undefined) throw primary;
    expect(original.raw.errors).toEqual([]);
  });

const ORIGINAL_ACTIVE: SchematicDocument = {
  schemaVersion: 4,
  components: [
    {
      id: 'supply',
      kind: 'source',
      componentTypeId: 'regulated-power-supply',
      variantId: 'regulated-power-supply',
      position: {
        x: 50,
        y: 100,
      },
      value: 5,
      state: true,
      pinIds: ['positive', 'negative'],
      stateProperties: {
        voltageSetpointVolt: 5,
        currentLimitAmp: 1,
        outputEnabled: true,
        outputResistanceOhm: 0.05,
      },
    },
    {
      id: 'resistor',
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      variantId: 'resistor-axial',
      position: {
        x: 400,
        y: 100,
      },
      value: 220,
      pinIds: ['lead-1', 'lead-2'],
      stateProperties: {
        tolerancePercent: 5,
        resistanceUnit: 'Ω',
        powerRatingWatt: 0.25,
      },
    },
    {
      id: 'led',
      kind: 'led',
      componentTypeId: 'led-5mm',
      variantId: 'led-5mm',
      position: {
        x: 600,
        y: 100,
      },
      value: 2,
      pinIds: ['anode', 'cathode'],
      stateProperties: {
        ledColour: 'red',
        ledBrightness: 0,
        ledFault: 'none',
      },
    },
    {
      id: 'sounder-one',
      kind: 'piezo',
      componentTypeId: 'piezo-passive-buzzer',
      variantId: 'piezo-passive-buzzer',
      position: {
        x: 400,
        y: 400,
      },
      value: 0,
      pinIds: ['positive', 'negative'],
      stateProperties: {
        piezoMode: 'active',
        piezoVariant: 'enclosed',
        waveform: 'square',
      },
    },
    {
      id: 'sounder-two',
      kind: 'piezo',
      componentTypeId: 'piezo-passive-buzzer',
      variantId: 'piezo-passive-buzzer',
      position: {
        x: 600,
        y: 400,
      },
      value: 0,
      pinIds: ['positive', 'negative'],
      stateProperties: {
        piezoMode: 'active',
        piezoVariant: 'enclosed',
        waveform: 'square',
      },
    },
  ],
  connections: [
    {
      id: 'led-positive',
      from: {
        componentId: 'supply',
        terminal: 'positive',
      },
      to: {
        componentId: 'resistor',
        terminal: 'lead-1',
      },
      vertices: [
        {
          x: 200,
          y: 50,
        },
      ],
      color: '#ff0000',
    },
    {
      id: 'led-series',
      from: {
        componentId: 'resistor',
        terminal: 'lead-2',
      },
      to: {
        componentId: 'led',
        terminal: 'anode',
      },
      vertices: [],
      color: '#149447',
    },
    {
      id: 'led-negative',
      from: {
        componentId: 'led',
        terminal: 'cathode',
      },
      to: {
        componentId: 'supply',
        terminal: 'negative',
      },
      vertices: [
        {
          x: 600,
          y: 700,
        },
      ],
      color: '#000000',
    },
    {
      id: 'sounder-one-positive',
      from: {
        componentId: 'supply',
        terminal: 'positive',
      },
      to: {
        componentId: 'sounder-one',
        terminal: 'positive',
      },
      vertices: [],
      color: '#ff0000',
    },
    {
      id: 'sounder-one-negative',
      from: {
        componentId: 'sounder-one',
        terminal: 'negative',
      },
      to: {
        componentId: 'supply',
        terminal: 'negative',
      },
      vertices: [],
      color: '#000000',
    },
    {
      id: 'sounder-two-positive',
      from: {
        componentId: 'supply',
        terminal: 'positive',
      },
      to: {
        componentId: 'sounder-two',
        terminal: 'positive',
      },
      vertices: [],
      color: '#ff0000',
    },
    {
      id: 'sounder-two-negative',
      from: {
        componentId: 'sounder-two',
        terminal: 'negative',
      },
      to: {
        componentId: 'supply',
        terminal: 'negative',
      },
      vertices: [],
      color: '#000000',
    },
  ],
  viewport: {
    x: 1,
    y: 2,
    zoom: 1,
  },
  simulation: {
    running: false,
    maxIterations: 24,
  },
};
