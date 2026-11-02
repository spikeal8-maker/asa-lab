import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';
import type { ElectronicsSimulationArtifact } from '../packages/contracts/src/public-project-display-artifact';
import { e2eAdminPool, seedTeacher } from './seed';
import { loginWithOrganization } from './organization-login';

const EVIDENCE = 'e2e/artifacts/public-projects/electronics-viewer';
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440];
const headers = (page: Page) => ({ origin: new URL(page.url()).origin });
function publicScriptEvidence(page: Page, revision: string) {
  const index = JSON.parse(
    readFileSync(`apps/web/private-symbols/web-rendered-modules-${revision}.json`, 'utf8'),
  );
  expect(index.revision).toBe(revision);
  // Match the emitted boundary check by source-module identity. Rendering-only
  // workbench geometry/model/icons are shared primitives, not editor entrypoints.
  const forbiddenModules = [
    /apps\/web\/src\/pages\/SchematicEditor\.tsx$/,
    /apps\/web\/src\/electronics\/(?:use-electronics-workbench|use-workbench-project-state|workbench-autosave|workbench-runtime-controls|WorkbenchStage|WorkbenchSidebars|WorkbenchHeader|AlternateWorkbenchViews)(?:\.|\/)/,
    /apps\/web\/src\/electronics\/(?!(?:simulation-worker-client|simulation-worker-protocol|live-simulation-worker-controller)\.ts$)(?:.*worker.*|live-simulation|use-piezo-audio|ArduinoSerialMonitor|ArduinoCodePanel|ArduinoBlocksEditor)(?:\.|\/)/i,
    /apps\/web\/src\/electronics\/(?:arduino-blocks|arduino-block-ui|arduino-program-state|arduino-pin-inputs)(?:\.|\/)/,
    /contexts\/electronics\/(?:engine|simulation|module)\.ts$/,
    /contexts\/electronics\/domain\/(?:solver|simulation|arduino-.*runtime|models\/.*(?:runtime|transient-model|audio-model))(?:\.|\/)/,
    /apps\/web\/src\/modules\/(?:use-project|project-autosave|use-module-project)/,
  ];
  const forbiddenFiles = new Set(
    Object.entries(index.assets)
      .filter(([, value]) => {
        const chunk = value as { modules: { id: string; renderedLength: number }[] };
        return chunk.modules.some(
          (module) =>
            module.renderedLength > 0 &&
            forbiddenModules.some((rule) => rule.test(module.id.replaceAll('\\', '/'))),
        );
      })
      .map(([file]) => file),
  );
  const requested: string[] = [];
  // Observe from before navigation; do not intercept, suppress, or alter scripts.
  page.on('request', (request) => {
    if (request.resourceType() === 'script' || new URL(request.url()).pathname.endsWith('.js'))
      requested.push(new URL(request.url()).pathname);
  });
  return async (label: string) => {
    const forbidden = requested.filter((file) => forbiddenFiles.has(file));
    await test.info().attach(`${label}-actual-script-requests.json`, {
      body: JSON.stringify({ revision, requested, forbidden }),
      contentType: 'application/json',
    });
    expect(requested.some((file) => /ElectronicsPublicationScene-/.test(file))).toBe(true);
    expect(
      forbidden,
      `${label} must not fetch emitted editor or executable runtime chunks`,
    ).toEqual([]);
  };
}
function png(): string {
  // This valid cover is setup only. Every viewer screenshot must contain the SVG circuit.
  const image = new PNG({ width: 32, height: 32 });
  image.data.fill(255);
  const bytes = PNG.sync.write(image);
  expect(PNG.sync.read(bytes).data).toEqual(image.data);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
async function register(page: Page) {
  await page.goto('/#/explore');
  const id = randomUUID().replaceAll('-', '');
  const response = await page.request.post('/api/auth/register', {
    headers: headers(page),
    data: {
      email: `viewer-${id}@isolated.test`,
      username: `view_${id.slice(0, 24)}`,
      displayName: 'Автор электрической цепи',
      password: `Viewer-${id}-Password`,
      birthDate: '1990-01-01',
      country: 'RU',
    },
  });
  expect(response.status()).toBe(201);
  await page.reload();
}
async function snapshot(page: Page, id: string, revision: number) {
  expect(
    (
      await page.request.put(`/api/projects/${id}/snapshot`, {
        headers: headers(page),
        data: { sourceRevision: revision, imageDataUrl: png() },
      })
    ).status(),
  ).toBe(200);
}
async function publish(page: Page, id: string) {
  const response = await page.request.post(`/api/projects/${id}/publication`, {
    headers: headers(page),
    data: { license: 'cc-by', description: 'Настоящая схема, собранная в редакторе.' },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).publication as { publicationId: string; revisionId: string };
}
async function artifact(page: Page, publicationId: string, revisionId: string) {
  const response = await page.request.get(
    `/api/public-projects/${publicationId}/artifact?revisionId=${revisionId}`,
  );
  expect(response.status()).toBe(200);
  const value = (await response.json()).artifact as ElectronicsSimulationArtifact;
  expect(value).toMatchObject({
    schemaVersion: 3,
    status: 'simulation',
    viewerFamily: 'electronics',
  });
  return value;
}
async function capture(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await expect
    .poll(() => page.evaluate(() => ({ x: scrollX, y: scrollY })))
    .toEqual({ x: 0, y: 0 });
  await expect(page.getByTestId('public-electronics-scene')).toBeVisible();
  await expect(page.getByTestId('public-electronics-component')).toHaveCount(3);
  await expect(page.getByTestId('public-electronics-wire')).toHaveCount(3);
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
  if (name === 'normal-1440' || name === 'normal-390') {
    // The short-title normal fixture must expose the complete stage, including
    // its zoom/fit toolbar and hint, without an initial page scroll.
    const bounds = await page.getByTestId('public-electronics-viewer').boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  }
}
async function place(page: Page, name: string, x: number, y: number) {
  await page.getByRole('textbox', { name: 'Поиск компонентов', exact: true }).fill(name);
  const card = page.getByRole('button', { name, exact: true });
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  const count = await page.getByTestId('schematic-component').count();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 - 4, box!.y + box!.height / 2, { steps: 2 });
  await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(1);
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId('schematic-component')).toHaveCount(count + 1);
}

test('editor-created immutable Electronics publication is a real inert responsive circuit for Guest and Seat', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE, { recursive: true });
  const metadata = JSON.parse(readFileSync('apps/web/dist/build-metadata.json', 'utf8'));
  expect(metadata.revision).toBe(process.env.ASA_BUILD_REVISION);
  const admin = e2eAdminPool();
  const guestContext = await browser.newContext();
  const teacherContext = await browser.newContext();
  const seatContext = await browser.newContext({
    viewport: { width: 390, height: 700 },
    hasTouch: true,
  });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await register(page);
    await page.goto('/#/projects');
    const created = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/projects' && r.request().method() === 'POST',
    );
    const create = page.locator('.portal-header .portal-quick-create:visible');
    await create.locator('> summary').click();
    await create.getByRole('button', { name: /^Электрическая цепь/ }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const id = (await response.json()).project.id as string;
    const stage = page.locator('.workbench-stage');
    await expect(stage).toBeVisible();
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    await place(
      page,
      'Батарейный отсек AA',
      box!.x + box!.width * 0.25,
      box!.y + box!.height * 0.35,
    );
    await place(page, 'Резистор', box!.x + box!.width * 0.55, box!.y + box!.height * 0.25);
    await place(page, 'Светодиод', box!.x + box!.width * 0.75, box!.y + box!.height * 0.55);
    const componentId = async (type: string) => {
      await expect(page.getByTestId('schematic-component')).toHaveCount(3);
      return page
        .locator(`[data-testid="schematic-component"][data-component-type="${type}"]`)
        .getAttribute('data-component-id');
    };
    const source = await componentId('battery-holder-aa-2');
    const resistor = await componentId('resistor-axial');
    const led = await componentId('led-5mm');
    expect(source && resistor && led).toBeTruthy();
    const terminal = (component: string | null, pin: string) =>
      page.locator(
        `.workbench-terminal-hit[data-terminal-component-id="${component}"][data-terminal-id="${pin}"]`,
      );
    for (const [from, a, to, b] of [
      [source, 'BAT+', resistor, 'lead-1'],
      [resistor, 'lead-2', led, 'anode'],
      [led, 'cathode', source, 'BAT-'],
    ]) {
      await terminal(from, a!).click({ force: true });
      await terminal(to, b!).click({ force: true });
    }
    await expect(page.getByTestId('schematic-wire')).toHaveCount(3);
    // The editor's automatic server flush runs once a minute. Exercise the real
    // explicit Save action before requiring the publication's persisted source.
    const savedCircuit = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/projects/${id}/draft` &&
        response.request().method() === 'PUT' &&
        response.request().postDataJSON().document.components.length === 3 &&
        response.request().postDataJSON().document.connections.length === 3,
    );
    await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
    const savedResponse = await savedCircuit;
    expect(savedResponse.status()).toBe(200);
    const savedDocument = savedResponse.request().postDataJSON().document;
    expect((await savedResponse.json()).draft.document).toEqual(savedDocument);
    const opened = async () => {
      const result = await page.request.get(`/api/projects/${id}`);
      expect(result.status()).toBe(200);
      return result.json();
    };
    await expect.poll(async () => (await opened()).draft.document.connections.length).toBe(3);
    const v1 = (await opened()).draft;
    expect(v1.document).toEqual(savedDocument);
    expect(v1.document.components).toHaveLength(3);
    await page.screenshot({ path: `${EVIDENCE}/editor-source.png` });
    // Navigate away to stop the editor before using publication APIs.
    await page.goto('/#/projects');
    await snapshot(page, id, v1.revision);
    const publication = await publish(page, id);
    const guest = await guestContext.newPage();
    const assertGuestScripts = publicScriptEvidence(guest, metadata.revision);
    const mutations: string[] = [],
      workers: string[] = [];
    guest.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) &&
        /^\/api\/(?:projects(?:\/|$)|public-projects\/[^/]+\/(?:copy|publication))/.test(path)
      )
        mutations.push(`${request.method()} ${path}`);
    });
    guest.on('worker', (worker) => workers.push(worker.url()));
    const frozen = async () =>
      (
        await admin.query(
          `SELECT
      (SELECT to_jsonb(p) FROM projects p WHERE id=$1) project,
      (SELECT jsonb_agg(to_jsonb(d)) FROM project_drafts d WHERE project_id=$1) drafts,
      (SELECT jsonb_agg(to_jsonb(v) ORDER BY version_no) FROM project_versions v WHERE project_id=$1) versions`,
          [id],
        )
      ).rows;
    const before = await frozen();
    const publicV1 = await artifact(guest, publication.publicationId, publication.revisionId);
    expect(publicV1.components.map((c) => c.id).sort()).toEqual([source, resistor, led].sort());
    expect(publicV1.connections).toHaveLength(3);
    const route = `/#/public-projects/${publication.publicationId}`;
    let releaseArtifact!: () => void;
    const heldArtifact = new Promise<void>((resolve) => {
      releaseArtifact = resolve;
    });
    await guest.route('**/api/public-projects/*/artifact?*', async (intercepted) => {
      await heldArtifact;
      await intercepted.continue();
    });
    await guest.goto(route);
    await expect(guest.getByTestId('public-artifact-loading')).toBeVisible();
    releaseArtifact();
    const scene = guest.getByTestId('public-electronics-scene');
    await expect(scene).toBeVisible();
    await guest.unroute('**/api/public-projects/*/artifact?*');
    await expect(guest.getByTestId('public-project-preview')).toHaveCount(0);
    for (const component of publicV1.components) {
      await expect(
        guest.locator(
          `[data-testid="public-electronics-component"][data-component-id="${component.id}"]`,
        ),
      ).toBeVisible();
    }
    for (const wire of publicV1.connections) {
      await expect(
        guest.locator(`[data-testid="public-electronics-wire"][data-wire-id="${wire.id}"]`),
      ).toHaveAttribute('d', /^M/);
    }
    await expect(
      guest.locator('.workbench-stage, .workbench-inspector, .workbench-save-state'),
    ).toHaveCount(0);
    for (const width of WIDTHS) {
      await guest.setViewportSize({ width, height: 900 });
      await expect
        .poll(() => guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      const viewer = await guest.getByTestId('public-electronics-viewer').boundingBox();
      const workspace = (await guest.locator('.public-project-workspace').boundingBox())!;
      const stage = (await guest.locator('.public-project-stage-column').boundingBox())!;
      const sidebar = (await guest.locator('.public-project-sidebar').boundingBox())!;
      // The viewer fills its actual grid slot. The current layout has a 288px
      // sidebar above 1100px, rather than the removed `has-description` flag.
      expect(viewer!.width).toBeGreaterThanOrEqual(stage.width - 2);
      expect(viewer!.x + viewer!.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
      if (width > 1100) {
        expect(sidebar.x).toBeGreaterThanOrEqual(stage.x + stage.width);
        expect(stage.width).toBeGreaterThanOrEqual(workspace.width - sidebar.width - 30);
      } else {
        expect(stage.width).toBeGreaterThanOrEqual(workspace.width - 1);
        expect(sidebar.y).toBeGreaterThanOrEqual(stage.y + stage.height);
      }
      if ([320, 390, 1440].includes(width)) await capture(guest, `normal-${width}`);
    }
    const fitted = await scene.getAttribute('viewBox');
    await guest.getByTestId('public-electronics-zoom-in').click();
    await expect(scene).not.toHaveAttribute('viewBox', fitted!);
    await capture(guest, 'zoomed-1440');
    const zoomed = await scene.getAttribute('viewBox');
    const bounds = await scene.boundingBox();
    await guest.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await guest.mouse.down();
    await guest.mouse.move(
      bounds!.x + bounds!.width / 2 + 70,
      bounds!.y + bounds!.height / 2 + 35,
      { steps: 8 },
    );
    await guest.mouse.up();
    await expect(scene).not.toHaveAttribute('viewBox', zoomed!);
    await capture(guest, 'panned-1440');
    await guest.getByTestId('public-electronics-fit').click();
    await expect(scene).toHaveAttribute('viewBox', fitted!);
    await guest.getByTestId('public-electronics-zoom-out').click();
    await expect(scene).not.toHaveAttribute('viewBox', fitted!);
    await guest.getByTestId('public-electronics-fit').click();
    await expect(scene).toHaveAttribute('viewBox', fitted!);
    await scene.focus();
    await scene.press('ArrowRight');
    await expect(scene).not.toHaveAttribute('viewBox', fitted!);
    await scene.press('Home');
    await expect(scene).toHaveAttribute('viewBox', fitted!);
    await scene.press('+');
    await expect(scene).not.toHaveAttribute('viewBox', fitted!);
    await guest.reload();
    await expect(guest.getByTestId('public-electronics-scene')).toHaveAttribute('viewBox', fitted!);
    expect(await frozen()).toEqual(before);
    expect(mutations).toEqual([]);
    expect(workers).toEqual([]);
    await assertGuestScripts('guest-after-pan-zoom-keyboard');

    // Owner draft V2 is saved explicitly, while public V1 stays byte-identical.
    const changed = {
      ...v1.document,
      components: v1.document.components.map((c: { id: string; value: number }) =>
        c.id === resistor ? { ...c, value: 470 } : c,
      ),
    };
    const saved = await page.request.put(`/api/projects/${id}/draft`, {
      headers: headers(page),
      data: { document: changed, baseRevision: v1.revision, mutationId: randomUUID() },
    });
    expect(saved.status()).toBe(200);
    const v2 = (await saved.json()).draft;
    expect(await artifact(guest, publication.publicationId, publication.revisionId)).toEqual(
      publicV1,
    );
    await snapshot(page, id, v2.revision);
    const next = await publish(page, id);
    expect(next.revisionId).not.toBe(publication.revisionId);
    const publicV2 = await artifact(guest, next.publicationId, next.revisionId);
    expect(publicV2.components.find((c) => c.id === resistor)?.value).toBe(470);
    expect(
      (
        await guest.request.get(
          `/api/public-projects/${publication.publicationId}/artifact?revisionId=${publication.revisionId}`,
        )
      ).status(),
    ).toBe(404);

    const teacherPage = await teacherContext.newPage();
    const teacher = await seedTeacher(admin, 'public-viewer');
    await loginWithOrganization(teacherPage, teacher);
    const classroomResponse = await teacherPage.request.post('/api/classrooms', {
      headers: { ...headers(teacherPage), 'idempotency-key': randomUUID() },
      data: { title: 'Public viewer Seat', ageBand: 'mixed', topicKeys: [], safeModeDefault: true },
    });
    expect(classroomResponse.status()).toBe(201);
    const classroomId = (await classroomResponse.json()).classroom.id;
    const classroom = await teacherPage.request
      .get(`/api/classrooms/${classroomId}`)
      .then((r) => r.json());
    const seatResponse = await teacherPage.request.post(`/api/classrooms/${classroomId}/seats`, {
      headers: headers(teacherPage),
      data: { displayLabel: 'Читатель схемы', safeMode: true },
    });
    expect(seatResponse.status()).toBe(201);
    const seatId = (await seatResponse.json()).student.id;
    const code = await teacherPage.request.post(
      `/api/classrooms/${classroomId}/seats/${seatId}/code`,
      { headers: headers(teacherPage), data: { requestId: randomUUID() } },
    );
    expect(code.status()).toBe(201);
    const studentCode = (await code.json()).studentCode;
    const seat = await seatContext.newPage();
    const assertSeatScripts = publicScriptEvidence(seat, metadata.revision);
    await seat.goto('/#/explore');
    expect(
      (
        await seat.request.post('/api/class-join/studentseat', {
          headers: headers(seat),
          data: { code: classroom.classroom.joinCode, studentCode },
        })
      ).status(),
    ).toBe(200);
    await artifact(seat, next.publicationId, next.revisionId);
    await seat.goto(route);
    await expect(seat.getByTestId('public-electronics-scene')).toBeVisible();
    expect(
      await seat
        .getByTestId('public-electronics-scene')
        .evaluate((el) => getComputedStyle(el).touchAction),
    ).toBe('pan-y');
    const touch = await seatContext.newCDPSession(seat);
    const touchBox = await seat.getByTestId('public-electronics-scene').boundingBox();
    const x = touchBox!.x + touchBox!.width / 2,
      y = touchBox!.y + Math.min(touchBox!.height / 2, 250);
    const seatScene = seat.getByTestId('public-electronics-scene');
    const beforeTouch = await seatScene.getAttribute('viewBox');
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 6; step++)
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + step * 10, y }],
      });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(seatScene).not.toHaveAttribute('viewBox', beforeTouch!);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 6; step++)
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - step * 25 }],
      });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => seat.evaluate(() => scrollY)).toBeGreaterThan(0);
    await touch.detach();
    await assertSeatScripts('seat-after-touch-and-scroll');

    // A transport failure uses the honest cover fallback, then a fresh navigation recovers.
    await guest.route('**/api/public-projects/*/artifact?*', (intercepted) =>
      intercepted.abort('failed'),
    );
    await guest.reload();
    await expect(guest.getByTestId('public-artifact-error')).toBeVisible();
    await expect(guest.getByTestId('public-artifact-fallback')).toBeVisible();
    await expect(guest.getByTestId('public-electronics-scene')).toHaveCount(0);
    await guest.unroute('**/api/public-projects/*/artifact?*');
    await guest.reload();
    await expect(guest.getByTestId('public-electronics-scene')).toBeVisible();

    // Refusal is real server state, including an already cached public artifact.
    expect(
      (
        await page.request.delete(`/api/projects/${id}/publication`, { headers: headers(page) })
      ).status(),
    ).toBe(200);
    expect(
      (
        await guest.request.get(
          `/api/public-projects/${next.publicationId}/artifact?revisionId=${next.revisionId}`,
        )
      ).status(),
    ).toBe(404);
    await guest.reload();
    await expect(guest.getByTestId('public-electronics-scene')).toHaveCount(0);
    await expect(guest.getByRole('heading', { name: 'Публикация недоступна' })).toBeVisible();
    expect(mutations).toEqual([]);
    expect(workers).toEqual([]);
    await assertGuestScripts('guest-after-republish-and-revoke');
  } finally {
    await guestContext.close();
    await teacherContext.close();
    await seatContext.close();
    await admin.end();
  }
});

test('a module without a circuit presenter shows its real cover without a pretend circuit', async ({
  page,
  browser,
}) => {
  await register(page);
  const created = await page.request.post('/api/projects', {
    headers: { ...headers(page), 'idempotency-key': randomUUID() },
    data: { scope: 'personal', module: 'three-d', title: `Static fallback ${randomUUID()}` },
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).project.id as string;
  await snapshot(page, id, 1);
  const published = await publish(page, id);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto(`/#/public-projects/${published.publicationId}`);
    await expect(guest.getByTestId('public-artifact-fallback')).toBeVisible();
    await expect(guest.getByTestId('public-project-preview')).toBeVisible();
    await expect(guest.getByTestId('public-electronics-scene')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
