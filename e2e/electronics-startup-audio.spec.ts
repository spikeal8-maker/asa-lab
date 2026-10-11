import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import type {
  ElectronicsSimulationWorkerRequest,
  ElectronicsSimulationWorkerResponse,
} from '../apps/web/src/electronics/simulation-worker-protocol';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher } from './seed';

type Scenario = 'dc' | 'immediate-high' | 'intentional-delay' | 'tone';
type Frame = { at: number; workerId: number; response: ElectronicsSimulationWorkerResponse };
type Publication = {
  at: number;
  status: string | null;
  brightness: number;
  asset: Array<{ href: string; failed: string | null }>;
  latestReady: number | null;
};
type Pcm = {
  at: number;
  contextTime: number;
  state: AudioContextState;
  sampleRate: number;
  gainId: number;
  samples: number[];
};
type Probe = {
  actions: Array<{ at: number; type: string; trusted: boolean }>;
  audio: Array<{
    at: number;
    type: string;
    contextId: number;
    state: AudioContextState;
    userActive: boolean;
  }>;
  requests: Array<{ at: number; workerId: number; request: ElectronicsSimulationWorkerRequest }>;
  frames: Frame[];
  publications: Publication[];
  pcm: Pcm[];
  assets: Array<{ at: number; type: string; href: string; connected: boolean }>;
  errors: string[];
  dropped: number;
};
type ObservedWindow = Window & { __startupAudio?: Probe; __sampleStartupPcm?: () => Pcm[] };

function fixture(scenario: Scenario): SchematicDocument {
  const arduino = scenario !== 'dc';
  const source =
    scenario === 'immediate-high'
      ? 'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){delay(100);}'
      : scenario === 'intentional-delay'
        ? 'void setup(){pinMode(13,OUTPUT);delay(250);digitalWrite(13,HIGH);}void loop(){delay(100);}'
        : 'void setup(){pinMode(13,OUTPUT);tone(8,1000);delay(1000);noTone(8);digitalWrite(13,HIGH);}void loop(){delay(100);}';
  const components: SchematicDocument['components'][number][] = [
    arduino
      ? {
          id: 'uno',
          kind: 'visual',
          componentTypeId: 'arduino-uno',
          variantId: 'arduino-uno',
          name: 'Arduino Uno',
          position: { x: 100, y: 100 },
          value: 5,
          pinIds: ['d13', 'd8', 'power-gnd-1', 'power-5v', 'power-3v3'],
          stateProperties: {
            arduinoCodeMode: 'text',
            arduinoSource: source,
            arduinoWorkspace: '{"blocks":{"blocks":[]}}',
            arduinoBaudRate: 9600,
            arduinoSerialOpen: false,
          },
        }
      : {
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
      position: { x: 650, y: 180 },
      rotation: 90,
      value: 220,
      pinIds: ['lead-1', 'lead-2'],
      stateProperties: { tolerancePercent: 5, resistanceUnit: 'Ω', powerRatingWatt: 0.25 },
    },
    {
      id: 'led',
      kind: 'led',
      componentTypeId: 'led-5mm',
      variantId: 'led-5mm',
      name: 'LED1',
      position: { x: 850, y: 180 },
      value: 2,
      pinIds: ['anode', 'cathode'],
      stateProperties: { ledColour: 'red', ledBrightness: 0, ledFault: 'none' },
    },
  ];
  const connections: SchematicDocument['connections'][number][] = [
    {
      id: 'positive',
      from: { componentId: arduino ? 'uno' : 'source', terminal: arduino ? 'd13' : 'BAT+' },
      to: { componentId: 'resistor', terminal: 'lead-1' },
      color: '#e3212b',
      vertices: [{ x: 500, y: 100 }],
    },
    {
      id: 'series',
      from: { componentId: 'resistor', terminal: 'lead-2' },
      to: { componentId: 'led', terminal: 'anode' },
      color: '#149447',
      vertices: [],
    },
    {
      id: 'negative',
      from: { componentId: 'led', terminal: 'cathode' },
      to: { componentId: arduino ? 'uno' : 'source', terminal: arduino ? 'power-gnd-1' : 'BAT-' },
      color: '#000000',
      vertices: [
        { x: 900, y: 500 },
        { x: 100, y: 500 },
      ],
    },
  ];
  if (scenario === 'tone') {
    components.push({
      id: 'sounder',
      kind: 'piezo',
      componentTypeId: 'piezo-disc',
      variantId: 'piezo-disc',
      name: 'Пьезо',
      position: { x: 650, y: 450 },
      value: 0,
      pinIds: ['positive', 'negative'],
      stateProperties: { piezoMode: 'passive', piezoVariant: 'disc', waveform: 'sine' },
    });
    connections.push(
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
    );
  }
  return {
    schemaVersion: 4,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

async function observe(page: Page) {
  await page.addInitScript(() => {
    const probe: Probe = {
      actions: [],
      audio: [],
      requests: [],
      frames: [],
      publications: [],
      pcm: [],
      assets: [],
      errors: [],
      dropped: 0,
    };
    (window as ObservedWindow).__startupAudio = probe;
    const append = <T>(array: T[], value: T) => {
      if (array.length < 512) array.push(value);
      else probe.dropped++;
    };
    for (const type of ['load', 'error'])
      document.addEventListener(
        type,
        (event) => {
          if (event.target instanceof SVGImageElement)
            append(probe.assets, {
              at: performance.now(),
              type,
              href: event.target.getAttribute('href') ?? '',
              connected: event.target.isConnected,
            });
        },
        true,
      );
    let latestReady: number | null = null;
    let workerId = 0;
    window.Worker = new Proxy(window.Worker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        if ((args[1] as WorkerOptions | undefined)?.name !== 'asa-electronics-simulation')
          return worker;
        const id = ++workerId;
        worker.postMessage = new Proxy(worker.postMessage, {
          apply(target, thisArg, messages) {
            const request = messages[0] as ElectronicsSimulationWorkerRequest;
            if (request.kind === 'preflight') latestReady = null;
            append(probe.requests, {
              at: performance.now(),
              workerId: id,
              request: structuredClone(request),
            });
            return Reflect.apply(target, thisArg, messages);
          },
        });
        worker.addEventListener(
          'message',
          (event: MessageEvent<ElectronicsSimulationWorkerResponse>) => {
            const response = structuredClone(event.data);
            append(probe.frames, { at: performance.now(), workerId: id, response });
            if (
              response.ok &&
              response.kind === 'advance' &&
              response.advance.executionStatus === 'ready'
            )
              latestReady = probe.frames.length - 1;
          },
        );
        return worker;
      },
    });
    const analysers: Array<{ context: AudioContext; analyser: AnalyserNode; gainId: number }> = [];
    let contextId = 0;
    let gainId = 0;
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = new Proxy(NativeAudioContext, {
      construct(target, args, newTarget) {
        const context = Reflect.construct(target, args, newTarget) as AudioContext;
        const id = ++contextId;
        const record = (type: string) =>
          append(probe.audio, {
            at: performance.now(),
            type,
            contextId: id,
            state: context.state,
            userActive: navigator.userActivation.isActive,
          });
        record('constructed');
        context.addEventListener('statechange', () => record('statechange'));
        context.resume = new Proxy(context.resume, {
          apply(target, thisArg, argumentsList) {
            record('resume-invoked');
            // Preserve the SAME native promise, including its rejection semantics.
            return Reflect.apply(target, thisArg, argumentsList);
          },
        });
        context.createGain = new Proxy(context.createGain, {
          apply(target, thisArg, argumentsList) {
            const gain = Reflect.apply(target, thisArg, argumentsList) as GainNode;
            const id = ++gainId;
            const originalConnect = gain.connect;
            let attached = false;
            gain.connect = new Proxy(originalConnect, {
              apply(target, thisArg, connections) {
                const result = Reflect.apply(target, thisArg, connections);
                if (!attached && connections[0] === context.destination) {
                  attached = true;
                  try {
                    const analyser = context.createAnalyser();
                    analyser.fftSize = 4096;
                    // Original audible destination remains connected. The passive
                    // analyser is parallel and its own output is unconnected.
                    Reflect.apply(originalConnect, gain, [analyser]);
                    analysers.push({ context, analyser, gainId: id });
                  } catch (error) {
                    probe.errors.push(String(error));
                  }
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
    (window as ObservedWindow).__sampleStartupPcm = () =>
      analysers.map(({ context, analyser, gainId }) => {
        const buffer = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buffer);
        const sample: Pcm = {
          at: performance.now(),
          contextTime: context.currentTime,
          state: context.state,
          sampleRate: context.sampleRate,
          gainId,
          samples: Array.from(buffer),
        };
        append(probe.pcm, sample);
        return sample;
      });
    document.addEventListener(
      'click',
      (event) => {
        const target =
          event.target instanceof Element
            ? event.target.closest('button[data-simulation-status]')
            : null;
        if (target)
          append(probe.actions, {
            at: performance.now(),
            type: target.textContent ?? '',
            trusted: event.isTrusted,
          });
      },
      true,
    );
    document.addEventListener('DOMContentLoaded', () => {
      let prior = '';
      new MutationObserver(() => {
        const status =
          document
            .querySelector('button[data-simulation-status]')
            ?.getAttribute('data-simulation-status') ?? null;
        const led = document.querySelector(
          '.workbench-stage [data-component-id="led"] [data-led-brightness]',
        );
        const brightness = Number(led?.getAttribute('data-led-brightness') ?? 0);
        const asset = Array.from(led?.querySelectorAll('image') ?? []).map((image) => ({
          href: image.getAttribute('href') ?? '',
          failed: image.getAttribute('data-production-asset-failed'),
        }));
        const key = JSON.stringify({ status, brightness, asset });
        if (key !== prior) {
          prior = key;
          append(probe.publications, {
            at: performance.now(),
            status,
            brightness,
            asset,
            latestReady,
          });
        }
      }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    });
  });
}
async function probe(page: Page) {
  return page.evaluate(() => {
    const value = (window as ObservedWindow).__startupAudio;
    if (!value) throw new Error('Native startup observer absent');
    return value;
  });
}
async function draft(page: Page, id: string) {
  const response = await page
    .context()
    .request.get(`/api/projects/${id}`, { headers: { origin: new URL(page.url()).origin } });
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    draft: { revision: number; document: SchematicDocument; updatedAt: string };
  };
}
async function snapshot(page: Page, name: string, info: TestInfo) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}
function assertFrames(observation: Probe) {
  expect(observation.dropped).toBe(0);
  expect(observation.errors).toEqual([]);
  for (const frame of observation.frames) {
    expect(frame.response.ok).toBe(true);
    if (!frame.response.ok) continue;
    expect(Number.isFinite(frame.response.metrics.computeMs)).toBe(true);
    if (frame.response.kind !== 'advance') continue;
    const advance = frame.response.advance;
    expect(advance.executionStatus).not.toBe('fault');
    if (advance.executionStatus === 'yielded') expect(advance.result).toBeNull();
    if (advance.executionStatus !== 'ready') continue;
    expect(advance.committedHorizonMicroseconds).toBe(advance.requestedHorizonMicroseconds);
    expect(advance.result).toMatchObject({ solved: true, quality: { finite: true, passed: true } });
  }
  for (const publication of observation.publications.filter((entry) => entry.brightness > 0)) {
    expect(publication.latestReady).not.toBeNull();
    const frame = observation.frames[publication.latestReady!];
    expect(
      frame.response.ok && frame.response.kind === 'advance'
        ? frame.response.advance.executionStatus
        : null,
    ).toBe('ready');
    expect(publication.at).toBeGreaterThanOrEqual(frame.at);
  }
}
async function runStop(page: Page, scenario: Scenario, name: string, info: TestInfo) {
  const before = await probe(page);
  await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
  const stop = page.getByRole('button', { name: 'Остановить моделирование', exact: true });
  await expect(stop).toHaveAttribute('data-simulation-status', 'running');
  await expect
    .poll(async () =>
      Number(
        await page
          .locator('.workbench-stage [data-component-id="led"] [data-led-brightness]')
          .getAttribute('data-led-brightness'),
      ),
    )
    .toBeGreaterThan(0);
  const observation = await probe(page);
  const frames = observation.frames.slice(before.frames.length);
  expect(
    frames.some(
      (frame) =>
        frame.response.ok &&
        frame.response.kind === 'advance' &&
        frame.response.advance.executionStatus === 'ready' &&
        frame.response.advance.committedHorizonMicroseconds === 0,
    ),
  ).toBe(true);
  if (scenario === 'intentional-delay') {
    for (const frame of frames)
      if (
        frame.response.ok &&
        frame.response.kind === 'advance' &&
        frame.response.advance.executionStatus === 'ready' &&
        frame.response.advance.committedHorizonMicroseconds < 250_000
      )
        expect(
          frame.response.advance.result?.components.find((part) => part.componentId === 'led')
            ?.brightness,
        ).toBe(0);
    const firstLit = frames.find(
      (frame) =>
        frame.response.ok &&
        frame.response.kind === 'advance' &&
        (frame.response.advance.result?.components.find((part) => part.componentId === 'led')
          ?.brightness ?? 0) > 0,
    );
    expect(
      firstLit?.response.ok && firstLit.response.kind === 'advance'
        ? firstLit.response.advance.committedHorizonMicroseconds
        : null,
    ).toBeGreaterThanOrEqual(250_000);
  }
  expect(observation.actions.slice(before.actions.length).every((action) => action.trusted)).toBe(
    true,
  );
  await snapshot(page, `${scenario}-${name}-ready`, info);
  await stop.click();
  await expect(
    page.getByRole('button', { name: 'Начать моделирование', exact: true }),
  ).toHaveAttribute('data-simulation-status', 'stopped');
  assertFrames(await probe(page));
  return {
    name,
    beforeFrames: before.frames.length,
    afterFrames: frames,
    nativeAudio: observation.audio,
    publications: observation.publications.slice(before.publications.length),
  };
}

let admin: pg.Pool;
test.beforeAll(() => {
  admin = e2eAdminPool();
});
test.afterAll(async () => {
  await admin.end();
});

for (const scenario of ['dc', 'immediate-high', 'intentional-delay'] as const)
  for (const width of [1440, 390]) {
    test(`optional audio natural ${scenario} startup and whole save reopen at ${width}px`, async ({
      page,
      browser,
    }, info) => {
      const teacher = await seedTeacher(
        admin,
        `e2e-startup-audio-${scenario}-${width}-${info.workerIndex}`,
      );
      const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
      const phases: unknown[] = [];
      const puts: unknown[] = [];
      await observe(page);
      await loginWithOrganization(page, teacher);
      const created = await page.context().request.post('/api/projects', {
        headers: { origin: new URL(page.url()).origin, 'idempotency-key': crypto.randomUUID() },
        data: {
          scope: 'personal',
          classroomId: null,
          module: 'electronics',
          title: `Запуск ${scenario} ${width}`,
        },
      });
      expect(created.status()).toBe(201);
      const id = ((await created.json()) as { project: { id: string } }).project.id;
      const empty = await draft(page, id);
      const seed = await page.context().request.put(`/api/projects/${id}/draft`, {
        headers: { origin: new URL(page.url()).origin },
        data: {
          document: fixture(scenario),
          baseRevision: empty.draft.revision,
          mutationId: crypto.randomUUID(),
        },
      });
      expect(seed.status()).toBe(200);
      page.on('request', (request) => {
        if (
          request.method() === 'PUT' &&
          new URL(request.url()).pathname === `/api/projects/${id}/draft`
        )
          puts.push(request.postDataJSON());
      });
      let reopenedRaw: Probe | null = null;
      try {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/#/home/${id}`);
        await expect(page.locator('.workbench-stage')).toBeVisible();
        const initial = await draft(page, id);
        phases.push({ initial });
        phases.push(await runStop(page, scenario, 'cold', info));
        phases.push(await runStop(page, scenario, 'warm', info));
        expect((await draft(page, id)).draft).toEqual(initial.draft);
        expect(puts).toHaveLength(0);
        // Make the sole persistent pupil edit at the existing desktop inspector.
        await page.setViewportSize({ width: 1440, height: 900 });
        await page
          .locator('.workbench-stage [data-component-id="resistor"] .workbench-part')
          .press('Enter');
        const value = page
          .locator('.workbench-inspector label')
          .filter({ hasText: 'Сопротивление' })
          .locator('input[type="number"]');
        await value.fill('333.3');
        await expect(value).toHaveValue('333.3');
        const expected: SchematicDocument = {
          ...initial.draft.document,
          components: initial.draft.document.components.map((part) =>
            part.id === 'resistor' ? { ...part, value: 333.3 } : part,
          ),
        };
        await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
        await expect.poll(async () => (await draft(page, id)).draft.document).toEqual(expected);
        const saved = await draft(page, id);
        expect(saved.draft.revision).toBe(initial.draft.revision + 1);
        expect(puts).toHaveLength(1);
        expect(puts[0]).toMatchObject({ baseRevision: initial.draft.revision, document: expected });
        phases.push({ expected, saved });
        const fresh = await browser.newContext({
          baseURL: new URL(page.url()).origin,
          viewport: { width, height: 900 },
        });
        let reopened: Page | null = null;
        try {
          await fresh.addCookies(await page.context().cookies());
          reopened = await fresh.newPage();
          const freshFailures = collectBrowserFailures(reopened, {
            allowAnonymousSessionProbe: true,
          });
          await observe(reopened);
          await reopened.goto(`/#/home/${id}`);
          await expect(reopened.locator('.workbench-stage')).toBeVisible();
          expect(
            await reopened.evaluate(() =>
              Object.keys(localStorage).filter((key) => key.startsWith('asa-project-local-draft:')),
            ),
          ).toEqual([]);
          expect((await draft(reopened, id)).draft).toEqual(saved.draft);
          phases.push(await runStop(reopened, scenario, 'cookies-only', info));
          expect((await draft(reopened, id)).draft).toEqual(saved.draft);
          reopenedRaw = await probe(reopened);
          freshFailures.assertEmpty();
        } finally {
          if (reopened) {
            reopenedRaw = await probe(reopened);
            await snapshot(reopened, `${scenario}-cookies-final`, info);
          }
          await fresh.close();
        }
        failures.assertEmpty();
      } finally {
        await snapshot(page, `${scenario}-${width}-final`, info);
        const path = info.outputPath(`startup-audio-${scenario}-${width}-raw.json`);
        await writeFile(
          path,
          JSON.stringify(
            {
              scenario,
              width,
              id,
              phases,
              puts,
              probe: await probe(page),
              reopenedRaw,
              server: await draft(page, id),
              limitations: {
                nativeCharacterizationOnly: true,
                conditionalPendingEvidenceIsSeparateMountedTest: true,
                schoolCauseAndFrequency: 'NOT_PROVED',
                physicalSpeakerAudibility: 'NOT_VERIFIED',
                actualSchoolDeviceT3: 'PENDING',
              },
            },
            null,
            2,
          ),
        );
        await info.attach('native-startup-whole-evidence', {
          path,
          contentType: 'application/json',
        });
      }
    });
  }

function pcmMetrics(sample: Pcm) {
  const rms = Math.sqrt(
    sample.samples.reduce((sum, value) => sum + value * value, 0) / sample.samples.length,
  );
  let crossings = 0;
  for (let index = 1; index < sample.samples.length; index++)
    if (sample.samples[index - 1] <= 0 && sample.samples[index] > 0) crossings++;
  return { rms, frequency: (crossings * sample.sampleRate) / sample.samples.length };
}
test('optional audio native tone PCM, noTone and Stop preserve the canonical clock boundary', async ({
  page,
}, info) => {
  const teacher = await seedTeacher(admin, `e2e-startup-audio-tone-${info.workerIndex}`);
  await observe(page);
  await loginWithOrganization(page, teacher);
  const failures = collectBrowserFailures(page);
  const created = await page.context().request.post('/api/projects', {
    headers: { origin: new URL(page.url()).origin, 'idempotency-key': crypto.randomUUID() },
    data: {
      scope: 'personal',
      classroomId: null,
      module: 'electronics',
      title: 'Нативный tone/noTone',
    },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { project: { id: string } }).project.id;
  const empty = await draft(page, id);
  const seeded = await page.context().request.put(`/api/projects/${id}/draft`, {
    headers: { origin: new URL(page.url()).origin },
    data: {
      document: fixture('tone'),
      baseRevision: empty.draft.revision,
      mutationId: crypto.randomUUID(),
    },
  });
  expect(seeded.status()).toBe(200);
  try {
    await page.goto(`/#/home/${id}`);
    await expect(page.locator('.workbench-stage')).toBeVisible();
    const initial = await draft(page, id);
    await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
    // The existing piezo clock admission defect must FAIL here, not be skipped,
    // converted to solved, or hidden by synthetic PCM. It is a separate blocker.
    await expect(
      page.getByRole('button', { name: 'Остановить моделирование', exact: true }),
    ).toHaveAttribute('data-simulation-status', 'running');
    const sample = async () =>
      page.evaluate(() => (window as ObservedWindow).__sampleStartupPcm?.() ?? []);
    let sounding: Pcm | undefined;
    await expect
      .poll(async () => {
        sounding = (await sample()).find(
          (entry) => entry.state === 'running' && pcmMetrics(entry).rms > 0.001,
        );
        return Boolean(sounding);
      })
      .toBe(true);
    expect(pcmMetrics(sounding!).frequency).toBeGreaterThan(970);
    expect(pcmMetrics(sounding!).frequency).toBeLessThan(1030);
    const first = sounding!;
    await expect
      .poll(async () =>
        (await sample()).some(
          (entry) =>
            entry.state === 'running' &&
            entry.contextTime > first.contextTime + 0.05 &&
            pcmMetrics(entry).rms > 0.001,
        ),
      )
      .toBe(true);
    await expect
      .poll(async () =>
        (await probe(page)).frames.some(
          (frame) =>
            frame.response.ok &&
            frame.response.kind === 'advance' &&
            frame.response.advance.executionStatus === 'ready' &&
            frame.response.advance.committedHorizonMicroseconds >= 1_000_000 &&
            frame.response.advance.result?.components.find((part) => part.componentId === 'sounder')
              ?.frequencyHz === 0,
        ),
      )
      .toBe(true);
    await expect
      .poll(async () => (await sample()).every((entry) => pcmMetrics(entry).rms < 0.0001))
      .toBe(true);
    await snapshot(page, 'tone-native-noTone-ready', info);
    await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Начать моделирование', exact: true }),
    ).toHaveAttribute('data-simulation-status', 'stopped');
    await expect
      .poll(async () => (await sample()).every((entry) => pcmMetrics(entry).rms < 0.0001))
      .toBe(true);
    expect((await draft(page, id)).draft).toEqual(initial.draft);
    assertFrames(await probe(page));
    failures.assertEmpty();
  } finally {
    await snapshot(page, 'tone-final', info);
    const path = info.outputPath('startup-audio-tone-raw.json');
    await writeFile(
      path,
      JSON.stringify(
        {
          id,
          fixture: fixture('tone'),
          probe: await probe(page),
          server: await draft(page, id),
          limitations: {
            currentPiezoClockAdmission: 'KNOWN_INDEPENDENT_BLOCKER_NOT_REPAIRED_HERE',
            syntheticPcm: false,
            headlessDigitalPcmIsNotSchoolSpeakerAudibility: true,
          },
        },
        null,
        2,
      ),
    );
    await info.attach('native-tone-originals', { path, contentType: 'application/json' });
  }
});
