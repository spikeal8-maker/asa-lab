import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';
import type {
  ElectronicsDocument,
  SchematicComponent,
} from '../contexts/electronics/domain/document';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';
import { loginWithOrganization } from './organization-login';
import { restoreNativeChromiumFocus } from './native-chromium-focus';

// A real background tab must become hidden. CI supplies headed Chromium/Xvfb;
// the lifecycle segment also removes Playwright's original-agent focus override.
// Other publication suites retain their configured headless default.
test.use({ headless: false });
let author: SeededTeacher;
test.beforeAll(async () => {
  const admin = e2eAdminPool();
  try {
    author = await seedTeacher(admin, 'public-electronics-player');
  } finally {
    await admin.end();
  }
});

const EVIDENCE = 'e2e/artifacts/public-projects/electronics-viewer/player';
const catalog = JSON.parse(
  readFileSync('apps/web/public/assets/electronics/component-database/catalog.json', 'utf8'),
) as { components: { componentId: string; pins: { id: string }[] }[] };
const origin = (page: Page) => ({ origin: new URL(page.url()).origin });
interface ElectricalReceipt {
  workerId: number;
  generationId: number;
  requestId: string;
  at: number;
  horizon: number;
  solved: boolean;
  qualityPassed: boolean;
  executionStatus: string;
  brightness: number;
  current: number;
}
interface WorkerProof {
  created: number;
  terminated: number;
  sent: number;
  received: number;
  peakInFlight: number;
  inFlight: number;
  electrical: ElectricalReceipt[];
  nativeMutations: number;
  pointerId: number | null;
  lifecycle: { type: string; at: number; trusted: boolean; visibility: string; focused: boolean }[];
}
type ProofWindow = Window & { __publicWorkerProof: WorkerProof };
const readProof = (page: Page) =>
  page.evaluate(() => (window as unknown as ProofWindow).__publicWorkerProof);
const mark = (page: Page) => page.evaluate(() => performance.now());

/** Observe a fresh, same-generation solved phase around the real native PNG.
 * No clock/input/result is changed. Fast transitions are retried, never relabelled. */
async function nativePhase(page: Page, label: string, high: boolean, since: number) {
  const read = () =>
    page.evaluate(() => {
      const root = document.querySelector(
        '[data-testid="public-electronics-component"][data-component-id="l"]',
      )!;
      const image = root.querySelector('image[data-led-asset-active="true"]');
      const proof = (window as unknown as ProofWindow).__publicWorkerProof;
      return {
        at: performance.now(),
        brightness: Number(
          root.querySelector('[data-led-brightness]')?.getAttribute('data-led-brightness'),
        ),
        href: image?.getAttribute('href') ?? image?.getAttribute('xlink:href'),
        sample: proof.electrical.at(-1),
        workerId: proof.created,
      };
    });
  const matches = (snapshot: Awaited<ReturnType<typeof read>>) => {
    const sample = snapshot.sample;
    return Boolean(
      snapshot.href &&
      sample &&
      sample.workerId === snapshot.workerId &&
      Number.isSafeInteger(sample.generationId) &&
      sample.generationId > 0 &&
      typeof sample.requestId === 'string' &&
      sample.requestId.length > 0 &&
      Number.isSafeInteger(sample.horizon) &&
      sample.horizon >= 0 &&
      sample.at >= since &&
      sample.solved &&
      sample.qualityPassed &&
      sample.executionStatus === 'ready' &&
      Number.isFinite(sample.current) &&
      Number.isFinite(sample.brightness) &&
      (high
        ? snapshot.brightness > 0 && sample.brightness > 0 && Math.abs(sample.current) > 1e-6
        : snapshot.brightness === 0 && sample.brightness === 0 && Math.abs(sample.current) <= 1e-9),
    );
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    await expect.poll(async () => matches(await read())).toBe(true);
    const before = await read();
    const raster = await ledRaster(page, `${label}-${attempt}`);
    const after = await read();
    if (
      !matches(before) ||
      !matches(after) ||
      before.href !== after.href ||
      before.sample?.generationId !== after.sample?.generationId ||
      before.workerId !== after.workerId ||
      after.at - before.at >= 400
    )
      continue;
    expect(before.sample!.horizon).toBeLessThanOrEqual(after.sample!.horizon);
    return { ...raster, proof: { since, before, after, sha256: raster.sha256 } };
  }
  throw new Error(`No stable native/electrical ${high ? 'HIGH' : 'LOW'} acquisition for ${label}`);
}
function changedNativePixels(low: PNG, high: PNG): number {
  expect({ width: high.width, height: high.height }).toEqual({
    width: low.width,
    height: low.height,
  });
  let changed = 0;
  for (let i = 0; i < high.data.length; i += 4)
    if (
      Math.abs(high.data[i]! - low.data[i]!) +
        Math.abs(high.data[i + 1]! - low.data[i + 1]!) +
        Math.abs(high.data[i + 2]! - low.data[i + 2]!) >
      60
    )
      changed++;
  expect(changed).toBeGreaterThan(4);
  return changed;
}
function circuit(mode: 'passive' | 'button' | 'blink' | 'blocks'): ElectronicsDocument {
  const component = (
    id: string,
    kind: SchematicComponent['kind'],
    type: string,
    x: number,
    y: number,
    value: number,
    properties = {},
  ): SchematicComponent => ({
    id,
    kind,
    componentTypeId: type,
    variantId: type,
    position: { x, y },
    value,
    pinIds: catalog.components.find((c) => c.componentId === type)!.pins.map((p) => p.id),
    stateProperties: properties,
  });
  const source =
    mode === 'button'
      ? 'void setup(){pinMode(2,INPUT_PULLUP);pinMode(13,OUTPUT);}void loop(){if(digitalRead(2)==LOW){digitalWrite(13,HIGH);}else{digitalWrite(13,LOW);}delay(10);}'
      : mode === 'blocks'
        ? 'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,LOW);delay(10);}'
        : 'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(500);digitalWrite(13,LOW);delay(500);}';
  const components: SchematicComponent[] = [
    mode === 'passive'
      ? component('s', 'source', 'battery-holder-aa-2', 100, 100, 3, { cells: 2 })
      : component('s', 'visual', 'arduino-uno', 80, 100, 5, {
          arduinoSource: source,
          arduinoCodeMode: mode === 'blocks' ? 'blocks' : 'text',
          arduinoWorkspace: '',
        }),
    component('r', 'resistor', 'resistor-axial', 520, 140, 330, {
      tolerancePercent: 5,
      resistanceUnit: 'Ом',
      powerRatingWatt: 0.25,
    }),
    component('l', 'led', 'led-5mm', 720, 140, 2, { ledColour: 'red' }),
  ];
  const ends: string[][] = [
    ['s', mode === 'passive' ? 'BAT+' : 'd13', 'r', 'lead-1'],
    ['r', 'lead-2', 'l', 'anode'],
    ['l', 'cathode', 's', mode === 'passive' ? 'BAT-' : 'power-gnd-1'],
  ];
  if (mode === 'passive' || mode === 'button') {
    components.push({
      ...component('b', 'button', 'button-tactile-6mm', 440, 330, 0),
      state: false,
      internalConnections: [
        ['SW-A1', 'SW-A2'],
        ['SW-B1', 'SW-B2'],
      ],
    });
    if (mode === 'passive') {
      ends[0] = ['s', 'BAT+', 'b', 'SW-A1'];
      ends.push(['b', 'SW-B1', 'r', 'lead-1']);
    } else ends.push(['s', 'd2', 'b', 'SW-A1'], ['b', 'SW-B1', 's', 'power-gnd-1']);
  }
  return {
    schemaVersion: 4,
    components,
    connections: ends.map(([from, a, to, b], i) => ({
      id: `w${i}`,
      from: { componentId: from!, terminal: a! },
      to: { componentId: to!, terminal: b! },
      color: '#149447',
    })),
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}
async function setup(page: Page, document: ElectronicsDocument) {
  // One adult Account/Principal with verified creator capability is seeded in
  // the isolated test DB. Each case still logs in normally and owns a new
  // personal Project; registration throttling is outside playback acceptance.
  await loginWithOrganization(page, author);
  const created = await page.request.post('/api/projects', {
    headers: { ...origin(page), 'idempotency-key': randomUUID() },
    data: { scope: 'personal', module: 'electronics', title: 'Публичная живая схема' },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).project.id as string;
  const saved = await page.request.put(`/api/projects/${id}/draft`, {
    headers: origin(page),
    data: { document, baseRevision: 1, mutationId: randomUUID() },
  });
  expect(saved.status()).toBe(200);
  return {
    id,
    draft: (await saved.json()).draft as { document: ElectronicsDocument; revision: number },
  };
}
async function publish(page: Page, id: string, revision: number) {
  const png = new PNG({ width: 32, height: 32 });
  png.data.fill(255);
  expect(
    (
      await page.request.put(`/api/projects/${id}/snapshot`, {
        headers: origin(page),
        data: {
          sourceRevision: revision,
          imageDataUrl: `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`,
        },
      })
    ).status(),
  ).toBe(200);
  const response = await page.request.post(`/api/projects/${id}/publication`, {
    headers: origin(page),
    data: { license: 'reserved' },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).publication as { publicationId: string; revisionId: string };
}
async function ledRaster(page: Page, label: string) {
  const led = page.locator('[data-testid="public-electronics-component"][data-component-id="l"]');
  await expect(led.locator('image[data-led-asset-active="true"]')).toHaveCount(1);
  const bytes = await led.screenshot({ path: `${EVIDENCE}/${label}.png` });
  const png = PNG.sync.read(bytes);
  return { png, sha256: createHash('sha256').update(bytes).digest('hex') };
}
for (const mode of ['passive', 'button', 'blink', 'blocks'] as const) {
  test(`public native ${mode} simulation uses immutable source, real Worker, inputs and visible assets`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(180000);
    mkdirSync(EVIDENCE, { recursive: true });
    const admin = e2eAdminPool();
    const guestContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      hasTouch: true,
    });
    try {
      const fixture = await setup(page, circuit(mode));
      let draft = fixture.draft;
      if (mode === 'blocks') {
        // Exercise the production Blockly serializer/generator once, rather than
        // claiming a handwritten workspace or stale text is a generated sketch.
        await page.goto(`/projects/${encodeURIComponent(fixture.id)}/electronics/edit`);
        await expect(page.locator('.workbench-stage')).toBeVisible();
        await page.locator('.workbench-pill.code').click();
        await expect(page.getByTestId('arduino-block-workspace')).toBeVisible();
        await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
        await expect
          .poll(async () => {
            const read = await page.request.get(`/api/projects/${fixture.id}`);
            draft = (await read.json()).draft;
            return String(draft.document.components[0]!.stateProperties?.arduinoSource);
          })
          .toContain('HIGH');
        expect(draft.document.components[0]!.stateProperties?.arduinoCodeMode).toBe('blocks');
        expect(draft.document.components[0]!.stateProperties?.arduinoWorkspace).not.toBe('');
        await page.goto('/#/projects');
      }
      const publication = await publish(page, fixture.id, draft.revision);
      const frozen = async () =>
        (
          await admin.query(
            `SELECT (SELECT jsonb_agg(to_jsonb(d)) FROM project_drafts d WHERE project_id=$1) drafts, (SELECT jsonb_agg(to_jsonb(v) ORDER BY version_no) FROM project_versions v WHERE project_id=$1) versions`,
            [fixture.id],
          )
        ).rows;
      const before = await frozen();
      // A private, different draft must not change public execution or source.
      const privateDraft = {
        ...draft.document,
        components: draft.document.components.map((c) =>
          c.id === 's' && mode !== 'passive'
            ? {
                ...c,
                stateProperties: {
                  ...c.stateProperties,
                  arduinoSource: 'void setup(){}void loop(){/*PRIVATE-DRAFT-SECRET*/delay(10);}',
                },
              }
            : c,
        ),
      };
      expect(
        (
          await page.request.put(`/api/projects/${fixture.id}/draft`, {
            headers: origin(page),
            data: {
              document: privateDraft,
              baseRevision: draft.revision,
              mutationId: randomUUID(),
            },
          })
        ).status(),
      ).toBe(200);
      const afterPrivateSave = await frozen();
      const guest = await guestContext.newPage();
      await guest.addInitScript(() => {
        const state: WorkerProof = {
          created: 0,
          terminated: 0,
          sent: 0,
          received: 0,
          peakInFlight: 0,
          inFlight: 0,
          electrical: [],
          nativeMutations: 0,
          pointerId: null,
          lifecycle: [],
        };
        Object.assign(window, { __publicWorkerProof: state });
        for (const type of [
          'blur',
          'focus',
          'visibilitychange',
          'pointerdown',
          'lostpointercapture',
          'pointercancel',
        ]) {
          const target = type === 'visibilitychange' ? document : window;
          target.addEventListener(
            type,
            (event) => {
              if (event instanceof PointerEvent && event.type === 'pointerdown')
                state.pointerId = event.pointerId;
              state.lifecycle.push({
                type,
                at: performance.now(),
                trusted: event.isTrusted,
                visibility: document.visibilityState,
                focused: document.hasFocus(),
              });
              if (state.lifecycle.length > 128) state.lifecycle.shift();
            },
            true,
          );
        }
        const Original = window.Worker;
        window.Worker = class extends Original {
          private readonly observedWorkerId: number;
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            this.observedWorkerId = String(url).includes('simulation.worker') ? ++state.created : 0;
            if (!this.observedWorkerId) return;
            this.addEventListener('message', (event) => {
              const response = event.data;
              state.received++;
              state.inFlight = Math.max(0, state.inFlight - 1);
              const result = response?.advance?.result;
              const led = result?.components?.find(
                (c: { componentId: string }) => c.componentId === 'l',
              );
              if (led) {
                state.electrical.push({
                  at: performance.now(),
                  workerId: this.observedWorkerId,
                  generationId: response.generationId,
                  requestId: response.requestId,
                  horizon: response.advance.committedHorizonMicroseconds,
                  solved: result.solved === true,
                  qualityPassed: result.quality?.passed === true,
                  executionStatus: response.advance.executionStatus,
                  brightness: Number(led.brightness),
                  current: Number(led.current),
                });
                if (state.electrical.length > 512) state.electrical.shift();
              }
            });
          }
          override postMessage(
            message: unknown,
            transferOrOptions?: Transferable[] | StructuredSerializeOptions,
          ) {
            if (
              this.observedWorkerId &&
              (message as { kind?: string })?.kind !== 'cancel-generation'
            ) {
              state.sent++;
              state.inFlight++;
              state.peakInFlight = Math.max(state.peakInFlight, state.inFlight);
            }
            if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
            else super.postMessage(message, transferOrOptions);
          }
          override terminate() {
            if (this.observedWorkerId) {
              state.terminated++;
              state.inFlight = 0;
            }
            super.terminate();
          }
        };
      });
      const workers: string[] = [],
        mutations: string[] = [];
      guest.on('worker', (worker) => workers.push(worker.url()));
      guest.on('request', (request) => {
        if (
          !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
          /\/api\/projects(?:\/|$)/.test(request.url())
        )
          mutations.push(request.url());
      });
      await guest.goto(`/#/public-projects/${publication.publicationId}`);
      await expect(guest.getByTestId('public-electronics-start')).toBeVisible();
      const response = await guest.request.get(
        `/api/public-projects/${publication.publicationId}/artifact?revisionId=${publication.revisionId}`,
      );
      expect(response.status()).toBe(200);
      const artifact = (await response.json()).artifact;
      expect(artifact.schemaVersion).toBe(3);
      expect(JSON.stringify(artifact)).not.toContain('PRIVATE-DRAFT-SECRET');
      if (mode !== 'passive')
        expect(artifact.components[0].stateProperties.arduinoSource).toBe(
          draft.document.components[0]!.stateProperties?.arduinoSource,
        );
      expect(workers).toEqual([]);
      await guest.getByTestId('public-electronics-viewer').evaluate((viewer) => {
        // Keep observing the real nodes after SPA removal as well: a stale
        // presenter mutating a detached native vector is still a late commit.
        new MutationObserver((records) => {
          (window as unknown as ProofWindow).__publicWorkerProof.nativeMutations += records.length;
        }).observe(viewer, {
          subtree: true,
          attributes: true,
          attributeFilter: [
            'href',
            'xlink:href',
            'data-led-brightness',
            'data-led-asset-token',
            'data-active',
          ],
        });
      });
      const runStarted = await mark(guest);
      await guest.getByTestId('public-electronics-start').click();
      await expect.poll(() => workers.length).toBe(1);
      expect(workers[0]).toMatch(/simulation\.worker-/);
      const brightness = () =>
        guest
          .locator('[data-component-id="l"] [data-led-brightness]')
          .getAttribute('data-led-brightness')
          .then(Number);
      const input = guest.getByTestId('public-input-b');
      const phases: unknown[] = [];
      if (mode === 'passive' || mode === 'button') {
        const low = await nativePhase(guest, `${mode}-low`, false, runStarted);
        await input.focus();
        const pressedAt = await mark(guest);
        await guest.keyboard.down('Space');
        const high = await nativePhase(guest, `${mode}-high`, true, pressedAt);
        expect(high.sha256).not.toBe(low.sha256);
        expect(high.proof.before.href).not.toBe(low.proof.before.href);
        expect(high.proof.before.sample!.generationId).toBe(low.proof.before.sample!.generationId);
        phases.push({
          low: low.proof,
          high: high.proof,
          changedPixels: changedNativePixels(low.png, high.png),
        });
        const releasedAt = await mark(guest);
        await guest.keyboard.up('Space');
        phases.push({
          keyboardRelease: (await nativePhase(guest, `${mode}-release`, false, releasedAt)).proof,
        });
        const box = await input.boundingBox();
        expect(box).not.toBeNull();
        await guest.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await guest.mouse.down();
        await expect.poll(brightness).toBeGreaterThan(0);
        const captureLostAt = await mark(guest);
        await input.evaluate((element) => {
          const id = (window as unknown as ProofWindow).__publicWorkerProof.pointerId;
          if (id === null || !element.hasPointerCapture(id))
            throw Error('Real pointer capture is absent');
          element.releasePointerCapture(id);
        });
        await guest.mouse.move(box!.x + box!.width / 2 + 1, box!.y + box!.height / 2);
        phases.push({
          lostCapture: (await nativePhase(guest, `${mode}-lost-capture`, false, captureLostAt))
            .proof,
        });
        expect(
          (await readProof(guest)).lifecycle.some(
            (event) =>
              event.type === 'lostpointercapture' && event.trusted && event.at >= captureLostAt,
          ),
        ).toBe(true);
        await guest.mouse.up();
        await expect.poll(brightness).toBe(0);
        const cdp = await guestContext.newCDPSession(guest);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }],
        });
        await expect.poll(brightness).toBeGreaterThan(0);
        const cancelAt = await mark(guest);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        phases.push({
          touchCancel: (await nativePhase(guest, `${mode}-touch-cancel`, false, cancelAt)).proof,
        });
        expect(
          (await readProof(guest)).lifecycle.some(
            (event) => event.type === 'pointercancel' && event.trusted && event.at >= cancelAt,
          ),
        ).toBe(true);
      } else {
        const high = await nativePhase(guest, `${mode}-high`, true, runStarted);
        const low = await nativePhase(guest, `${mode}-low`, false, await mark(guest));
        expect(high.proof.before.sample!.generationId).toBe(low.proof.before.sample!.generationId);
        expect(high.sha256).not.toBe(low.sha256);
        expect(high.proof.before.href).not.toBe(low.proof.before.href);
        phases.push({
          low: low.proof,
          high: high.proof,
          changedPixels: changedNativePixels(low.png, high.png),
        });
        await guest.getByText('Код Arduino', { exact: true }).click();
        await expect(guest.locator('.public-electronics-code code')).toHaveText(
          String(draft.document.components[0]!.stateProperties?.arduinoSource),
        );
      }
      for (const width of [320, 390, 1024, 1440]) {
        await guest.setViewportSize({ width, height: 900 });
        await guest.evaluate(() => scrollTo(0, 0));
        await expect
          .poll(() => guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
        await guest.screenshot({ path: `${EVIDENCE}/${mode}-${width}.png` });
      }
      await guest.getByTestId('public-electronics-zoom-in').click();
      await guest.getByTestId('public-electronics-fit').click();
      expect(workers).toHaveLength(1);
      const beforeFullscreen = (await readProof(guest)).electrical.at(-1)!;
      await guest.getByRole('button', { name: 'На весь экран', exact: true }).click();
      await expect
        .poll(() =>
          guest.evaluate(
            () =>
              document.fullscreenElement?.classList.contains('public-electronics-viewer') === true,
          ),
        )
        .toBe(true);
      await expect
        .poll(async () => (await readProof(guest)).electrical.at(-1)?.horizon ?? -1)
        .toBeGreaterThan(beforeFullscreen.horizon);
      await guest.getByRole('button', { name: 'На весь экран', exact: true }).click();
      await expect.poll(() => guest.evaluate(() => document.fullscreenElement === null)).toBe(true);
      const afterFullscreen = (await readProof(guest)).electrical.at(-1)!;
      expect({
        workerId: afterFullscreen.workerId,
        generationId: afterFullscreen.generationId,
      }).toEqual({
        workerId: beforeFullscreen.workerId,
        generationId: beforeFullscreen.generationId,
      });
      expect(afterFullscreen.horizon).toBeGreaterThan(beforeFullscreen.horizon);
      expect(await readProof(guest)).toMatchObject({ created: 1, terminated: 0 });
      await expect(guest.getByTestId('public-electronics-start')).toHaveText('Стоп');
      await guest.getByTestId('public-electronics-reset').click();
      await expect(guest.getByTestId('public-electronics-start')).toHaveText('Начать');
      await guest.getByTestId('public-electronics-start').click();
      await expect.poll(() => workers.length).toBe(2);
      await expect
        .poll(async () => {
          const sample = (await readProof(guest)).electrical.at(-1);
          return sample?.workerId === 2 && sample.horizon > 0;
        })
        .toBe(true);
      await guest.bringToFront();
      const focusInfrastructure = await restoreNativeChromiumFocus(guest);
      await expect.poll(() => guest.evaluate(() => document.visibilityState)).toBe('visible');
      await expect.poll(() => guest.evaluate(() => document.hasFocus())).toBe(true);
      await expect(guest.getByTestId('public-electronics-start')).toHaveText('Стоп');
      // Real foreground-tab transition supplies native visibility/focus events;
      // fail visibly if this browser cannot exercise background visibility.
      const backgroundAt = await mark(guest);
      const foreground = await guestContext.newPage();
      await foreground.goto('about:blank');
      await foreground.bringToFront();
      await expect.poll(() => guest.evaluate(() => document.visibilityState)).toBe('hidden');
      await expect.poll(() => guest.evaluate(() => document.hasFocus())).toBe(false);
      await expect.poll(async () => (await readProof(guest)).terminated).toBe(2);
      const background = await readProof(guest);
      expect(
        background.lifecycle.some(
          (event) => event.type === 'blur' && event.trusted && event.at >= backgroundAt,
        ),
      ).toBe(true);
      expect(
        background.lifecycle.some(
          (event) =>
            event.type === 'visibilitychange' &&
            event.trusted &&
            event.visibility === 'hidden' &&
            event.at >= backgroundAt,
        ),
      ).toBe(true);
      await guest.bringToFront();
      await foreground.close();
      await expect(guest.getByTestId('public-electronics-start')).toHaveText('Начать');
      await guest.getByTestId('public-electronics-start').click();
      await expect.poll(() => workers.length).toBe(3);
      await expect
        .poll(async () => {
          const sample = (await readProof(guest)).electrical.at(-1);
          return sample?.workerId === 3 && sample.horizon > 0;
        })
        .toBe(true);
      // Navigate through the real SPA link while still running, retaining the
      // observer document; a full page.goto would only prove browser teardown.
      await expect(guest.getByTestId('public-electronics-start')).toHaveText('Стоп');
      await guest.locator('a.public-project-back').click();
      await expect(guest.getByTestId('public-electronics-viewer')).toHaveCount(0);
      await expect.poll(async () => (await readProof(guest)).terminated).toBe(3);
      await guest.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const stopped = await readProof(guest);
      await guest.waitForTimeout(150);
      const workerProof = await readProof(guest);
      expect({
        received: workerProof.received,
        sent: workerProof.sent,
        nativeMutations: workerProof.nativeMutations,
      }).toEqual({
        received: stopped.received,
        sent: stopped.sent,
        nativeMutations: stopped.nativeMutations,
      });
      expect(workerProof).toMatchObject({
        created: 3,
        terminated: 3,
        peakInFlight: 1,
        inFlight: 0,
      });
      expect((workerProof as { received: number }).received).toBeGreaterThan(0);
      expect(mutations).toEqual([]);
      expect(await frozen()).toEqual(afterPrivateSave);
      expect(before).not.toEqual(afterPrivateSave);
      writeFileSync(
        `${EVIDENCE}/${mode}-receipt.json`,
        JSON.stringify(
          {
            workers,
            workerProof,
            phases,
            fullscreen: { before: beforeFullscreen, after: afterFullscreen },
            background,
            focusInfrastructure,
            mutations,
            publicSource: artifact,
            immutableAfterRun: true,
            revision: process.env.ASA_BUILD_REVISION,
          },
          null,
          2,
        ),
      );
    } finally {
      await guestContext.close();
      await admin.end();
    }
  });
}
