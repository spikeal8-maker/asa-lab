import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';
import type {
  ElectronicsDocument,
  SchematicComponent,
} from '../contexts/electronics/domain/document';
import { e2eAdminPool } from './seed';

const EVIDENCE = 'e2e/artifacts/public-projects/electronics-viewer/player';
const catalog = JSON.parse(
  readFileSync('apps/web/public/assets/electronics/component-database/catalog.json', 'utf8'),
) as { components: { componentId: string; pins: { id: string }[] }[] };
const origin = (page: Page) => ({ origin: new URL(page.url()).origin });
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
  await page.goto('/#/explore');
  const suffix = randomUUID().replaceAll('-', '');
  const registered = await page.request.post('/api/auth/register', {
    headers: origin(page),
    data: {
      email: `${suffix}@isolated.test`,
      username: `pub_${suffix.slice(0, 24)}`,
      displayName: 'Автор проигрывателя',
      password: `Player-${suffix}-Password`,
      birthDate: '1990-01-01',
      country: 'RU',
    },
  });
  expect(registered.status()).toBe(201);
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
        await page.goto(`/#/home/${fixture.id}`);
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
        const state = {
          created: 0,
          terminated: 0,
          sent: 0,
          received: 0,
          peakInFlight: 0,
          inFlight: 0,
          electrical: [] as { at: number; brightness: number; current: number }[],
        };
        Object.assign(window, { __publicWorkerProof: state });
        const Original = window.Worker;
        window.Worker = class extends Original {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            if (!String(url).includes('simulation.worker')) return;
            state.created++;
            this.addEventListener('message', (event) => {
              const response = event.data;
              state.received++;
              state.inFlight = Math.max(0, state.inFlight - 1);
              const led =
                response?.result?.components?.find(
                  (c: { componentId: string }) => c.componentId === 'l',
                ) ??
                response?.advance?.result?.components?.find(
                  (c: { componentId: string }) => c.componentId === 'l',
                );
              if (led && state.electrical.length < 512)
                state.electrical.push({
                  at: performance.now(),
                  brightness: led.brightness ?? 0,
                  current: led.current,
                });
            });
          }
          override postMessage(
            message: unknown,
            transferOrOptions?: Transferable[] | StructuredSerializeOptions,
          ) {
            if ((message as { kind?: string })?.kind !== 'cancel-generation') {
              state.sent++;
              state.inFlight++;
              state.peakInFlight = Math.max(state.peakInFlight, state.inFlight);
            }
            if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
            else super.postMessage(message, transferOrOptions);
          }
          override terminate() {
            state.terminated++;
            state.inFlight = 0;
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
      await guest.getByTestId('public-electronics-start').click();
      await expect.poll(() => workers.length).toBe(1);
      expect(workers[0]).toMatch(/simulation\.worker-/);
      const brightness = () =>
        guest
          .locator('[data-component-id="l"] [data-led-brightness]')
          .getAttribute('data-led-brightness')
          .then(Number);
      const input = guest.getByTestId('public-input-b');
      if (mode === 'passive' || mode === 'button') {
        await expect.poll(brightness).toBe(0);
        const low = await ledRaster(guest, `${mode}-low`);
        await input.focus();
        await guest.keyboard.down('Space');
        await expect.poll(brightness).toBeGreaterThan(0);
        const high = await ledRaster(guest, `${mode}-high`);
        expect(high.sha256).not.toBe(low.sha256);
        let changed = 0;
        for (let i = 0; i < high.png.data.length; i += 4)
          if (
            Math.abs(high.png.data[i]! - low.png.data[i]!) +
              Math.abs(high.png.data[i + 1]! - low.png.data[i + 1]!) +
              Math.abs(high.png.data[i + 2]! - low.png.data[i + 2]!) >
            60
          )
            changed++;
        expect(changed).toBeGreaterThan(4);
        await guest.keyboard.up('Space');
        await expect.poll(brightness).toBe(0);
        const box = await input.boundingBox();
        expect(box).not.toBeNull();
        await guest.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await guest.mouse.down();
        await expect.poll(brightness).toBeGreaterThan(0);
        await guest.mouse.up();
        await expect.poll(brightness).toBe(0);
        const cdp = await guestContext.newCDPSession(guest);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }],
        });
        await expect.poll(brightness).toBeGreaterThan(0);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await expect.poll(brightness).toBe(0);
      } else {
        await expect.poll(brightness).toBeGreaterThan(0);
        await ledRaster(guest, `${mode}-high`);
        await expect.poll(brightness).toBe(0);
        await ledRaster(guest, `${mode}-low`);
        await guest.getByText('Код Arduino', { exact: true }).click();
        await expect(guest.locator('.public-electronics-code code')).toHaveText(
          String(draft.document.components[0]!.stateProperties?.arduinoSource),
        );
      }
      for (const width of [320, 390, 1024, 1440]) {
        await guest.setViewportSize({ width, height: 900 });
        await expect
          .poll(() => guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
        await guest.screenshot({ path: `${EVIDENCE}/${mode}-${width}.png` });
      }
      await guest.getByTestId('public-electronics-zoom-in').click();
      await guest.getByTestId('public-electronics-fit').click();
      expect(workers).toHaveLength(1);
      await guest.getByTestId('public-electronics-reset').click();
      await expect(guest.getByTestId('public-electronics-start')).toHaveText('Начать');
      await guest.getByTestId('public-electronics-start').click();
      await expect.poll(() => workers.length).toBe(2);
      await guest.getByTestId('public-electronics-start').click();
      const workerProof = await guest.evaluate(
        () => (window as Window & { __publicWorkerProof?: unknown }).__publicWorkerProof,
      );
      expect(workerProof).toMatchObject({
        created: 2,
        terminated: 2,
        peakInFlight: 1,
        inFlight: 0,
      });
      expect((workerProof as { received: number }).received).toBeGreaterThan(0);
      await guest.goto('/#/explore');
      expect(mutations).toEqual([]);
      expect(await frozen()).toEqual(afterPrivateSave);
      expect(before).not.toEqual(afterPrivateSave);
      writeFileSync(
        `${EVIDENCE}/${mode}-receipt.json`,
        JSON.stringify(
          {
            workers,
            workerProof,
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
