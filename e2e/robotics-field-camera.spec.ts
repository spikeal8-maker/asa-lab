import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { test, expect, type Page, type BrowserContext, type TestInfo } from '@playwright/test';
import { createInitialRoboticsProject } from '../contexts/robotics/domain/default-project';

// UI_ONLY acceptance uses the existing frontend-fixture pattern from
// access-account-ui.spec.ts: every API request is fulfilled in this browser
// context with synthetic data. No credentials, human-verification interaction,
// protected source reads, real authentication, backend or save acceptance.
// The portal editor, render/gesture code and simulation Worker are served by
// the existing owner-authorized 4630 process without a separate test server.
const uiOnly = process.env['ASA_FIELD_CAMERA_UI_ONLY'] === 'true';
const sourceSha = process.env['ASA_FIELD_CAMERA_SHA'] ?? 'not-recorded';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const projectId = '30000000-0000-4000-8000-000000001071';
const accountId = '20000000-0000-4000-8000-000000001071';
const workspaceId = '10000000-0000-4000-8000-000000001071';
const now = '2026-11-11T00:00:00.000Z';

async function openEditor(page: Page, context: BrowserContext, publicationFixture = false) {
  if (
    !uiOnly ||
    process.env['ASA_E2E_EXTERNAL'] !== 'true' ||
    process.env['ASA_E2E_BASE_URL'] !== 'http://127.0.0.1:4630'
  ) {
    throw new Error('UI_ONLY camera acceptance requires the existing external D2-R2:4630 editor');
  }
  const url = new URL('http://127.0.0.1:4630/#/home/' + projectId + '?module=robotics');
  const fixture = {
    project: {
      id: projectId,
      scope: 'personal',
      classroomId: null,
      moduleKey: 'robotics',
      title: publicationFixture
        ? 'Робот для исследования движения, датчика расстояния и собственного высокого поля · UI_ONLY'
        : 'FIELD-CAMERA-001 · UI_ONLY fixture',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      preview: null,
      snapshotRevision: null,
      description: null,
      tags: [],
      license: 'private',
      copiedFrom: null,
    },
    draft: {
      projectId,
      document: createInitialRoboticsProject(),
      revision: publicationFixture ? 1 : 0,
      updatedAt: now,
      preview: null,
    },
    versions: [],
  };
  const originalHash = hash(fixture.draft.document);
  const sourceWrites: unknown[] = [];
  const interceptedRequests: string[] = [];
  const preventedWrites: string[] = [];
  const unexpectedMutations: string[] = [];
  // This handler has no continue/fetch path: synthetic identities never reach
  // a protected backend, including unknown GETs or mutations.
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    interceptedRequests.push(method + ' ' + path);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      preventedWrites.push(method + ' ' + path);
    }
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === '/api/auth/me') {
      return reply({
        authenticated: true,
        user: { id: accountId, displayName: 'UI_ONLY fixture', email: 'camera@example.test' },
        account: { id: accountId, displayName: 'UI_ONLY fixture', email: 'camera@example.test' },
        capabilities: [],
        workspaces: [{ workspaceId, kind: 'personal', title: 'Личное', role: 'owner' }],
        activeWorkspace: { workspaceId, kind: 'personal' },
        navigation: { classes: false, classroomManagement: false, contentAuthoring: false },
        timeZone: 'Europe/Moscow',
      });
    }
    if (path === '/api/account/presentation') {
      return reply({ motion: 'system', sidebar: 'expanded', revision: 0 });
    }
    if (path === '/api/account/avatar') return reply({ avatarDataUrl: null });
    if (path === '/api/auth/max/status') {
      return reply({
        linked: false,
        verifiedAt: null,
        firstAuthenticatedAt: null,
        promptDue: false,
        promptDismissedUntil: null,
        available: false,
      });
    }
    if (path === '/api/auth/max/config') return reply({ enabled: false, launchUrl: null });
    if (path === '/api/class-join/me') return reply({ authenticated: false });
    if (
      method === 'POST' &&
      [
        '/api/analytics/v2/events',
        '/api/analytics/v2/module-session',
        '/api/analytics/v2/quality',
        '/api/diagnostics/client',
        '/api/diagnostics/quality',
      ].includes(path)
    ) {
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/learning/notifications') {
      return reply({ items: [], snapshot: now, unread: 0 });
    }
    if (method === 'GET' && path === '/api/learning/projects/' + projectId + '/context') {
      return reply({ state: 'not_learning', projectId });
    }
    if (method === 'GET' && path === '/api/projects/' + projectId) return reply(fixture);
    // Only the modal regression needs these UI acknowledgements. The real
    // snapshot capture and ProjectProperties component run in the browser;
    // neither endpoint is forwarded to a backend or a real publication.
    if (
      publicationFixture &&
      method === 'PUT' &&
      path === '/api/projects/' + projectId + '/snapshot'
    ) {
      const body = request.postDataJSON();
      return reply({
        snapshot: {
          projectId,
          contentType: 'image/png',
          width: 480,
          height: 360,
          sourceRevision: body.sourceRevision,
          capturedAt: now,
        },
      });
    }
    if (
      publicationFixture &&
      method === 'GET' &&
      path === '/api/projects/' + projectId + '/publication'
    ) {
      return reply({
        canPublish: true,
        reasonCode: null,
        acquisition: { allowed: false, version: 0 },
        publication: {
          publicationId: '40000000-0000-4000-8000-000000001071',
          revisionId: '50000000-0000-4000-8000-000000001071',
          revisionNo: 1,
          versionNo: 1,
          state: 'public',
          publishedAt: now,
          publicPath: '/public-projects/40000000-0000-4000-8000-000000001071',
        },
      });
    }
    if (method === 'PUT' && path === '/api/projects/' + projectId + '/draft') {
      const body = request.postDataJSON();
      sourceWrites.push(body.document);
      fixture.draft = {
        ...fixture.draft,
        document: body.document,
        revision: body.baseRevision + 1,
      };
      return reply({ draft: fixture.draft });
    }
    if (method === 'GET') return reply({ items: [], meta: { total: 0 } });
    unexpectedMutations.push(method + ' ' + path);
    return reply({ error: { code: 'unexpected_mutation', message: path } }, 400);
  });
  await page.addInitScript(() => {
    const host = window as typeof window & {
      __fieldCameraWorkers?: { created: string[]; terminated: string[] };
    };
    const stats = { created: [] as string[], terminated: [] as string[] };
    host.__fieldCameraWorkers = stats;
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      private readonly cameraTestUrl: string;
      constructor(script: string | URL, options?: WorkerOptions) {
        super(script, options);
        this.cameraTestUrl = String(script);
        stats.created.push(this.cameraTestUrl);
      }
      override terminate() {
        stats.terminated.push(this.cameraTestUrl);
        super.terminate();
      }
    };
  });
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible({ timeout: 45_000 });
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  await expect(page.locator('.robotics-field-camera-surface')).toBeVisible();
  return {
    originalHash,
    sourceWrites,
    preventedWrites,
    url: url.href,
    interceptedRequests,
    unexpectedMutations,
  };
}

const field = (page: Page) => page.locator('.robotics-field-canvas svg.robotics-field');
const canvas = (page: Page) => page.locator('.robotics-field-canvas');
const viewBox = (page: Page) => field(page).getAttribute('viewBox');

async function screenWorld(page: Page, x: number, y: number) {
  return field(page).evaluate(
    (svg: SVGSVGElement, point) => {
      const height = Number(svg.querySelector('defs clipPath rect')!.getAttribute('height'));
      const matrix = svg.getScreenCTM();
      if (!matrix) throw new Error('Missing real SVG transform');
      const result = new DOMPoint(point.x * 1000, height - point.y * 1000).matrixTransform(matrix);
      return { x: result.x, y: result.y };
    },
    { x, y },
  );
}
async function closeObjectPanel(page: Page) {
  const close = page.getByRole('button', { name: 'Закрыть параметры объекта', exact: true });
  if (await close.isVisible()) await close.click();
}
async function fit(page: Page) {
  await page.getByRole('button', { name: 'Показать поле целиком', exact: true }).click();
}
async function selectTool(page: Page, name: string) {
  const button = page
    .getByTestId('robotics-field-palette')
    .getByRole('button', { name, exact: true });
  if (!(await button.isVisible())) {
    await page.getByRole('button', { name: /Элементы поля/ }).click();
  }
  await button.click();
}
async function pan(page: Page, button: 'left' | 'middle' = 'left') {
  const rect = await canvas(page).boundingBox();
  if (!rect) throw new Error('No field viewport');
  const start = { x: rect.x + rect.width * 0.12, y: rect.y + rect.height * 0.15 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button });
  await page.mouse.move(start.x + 37, start.y + 29, { steps: 6 });
  await page.mouse.up({ button });
}

async function checkCamera(
  page: Page,
  context: BrowserContext,
  testInfo: TestInfo,
  mobile: boolean,
) {
  const evidence = await openEditor(page, context);
  const checks: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const initialWrites = evidence.sourceWrites.length;
  await fit(page);
  const control = await screenWorld(page, 2, 3);
  let maxDriftCssPx = 0;
  await page.mouse.move(control.x, control.y);
  for (let i = 0; i < 20; i += 1) {
    const previous = await viewBox(page);
    await page.mouse.wheel(0, i % 2 === 0 ? -67 : 53);
    await expect.poll(() => viewBox(page)).not.toBe(previous);
    const after = await screenWorld(page, 2, 3);
    maxDriftCssPx = Math.max(maxDriftCssPx, Math.hypot(after.x - control.x, after.y - control.y));
  }
  expect(maxDriftCssPx).toBeLessThanOrEqual(1);
  checks.push('20 native wheel zooms: world control point drift <= 1 CSS px');

  const beforePan = await viewBox(page);
  await pan(page, 'middle');
  expect(await viewBox(page)).not.toBe(beforePan);
  await fit(page);
  await pan(page);
  await page.getByRole('button', { name: 'К роботу', exact: true }).click();
  await fit(page);
  const beforeTab = await viewBox(page);
  await page.getByRole('tab', { name: 'Робот', exact: true }).click();
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  expect(await viewBox(page)).toBe(beforeTab);
  expect(evidence.sourceWrites.length).toBe(initialWrites);
  checks.push(
    'blank-left/middle pan, fit/robot navigation and tab retention without source writes',
  );

  const metrics = await canvas(page).evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflow: getComputedStyle(element).overflow,
  }));
  expect(metrics.scrollWidth - metrics.clientWidth).toBeLessThanOrEqual(1);
  expect(metrics.scrollHeight - metrics.clientHeight).toBeLessThanOrEqual(1);
  expect(metrics.overflow).toBe('hidden');
  checks.push('fixed viewport, no horizontal or vertical scene scrollbar');

  await selectTool(page, 'Прямоугольник');
  let point = await screenWorld(page, 1, 1);
  await page.mouse.click(point.x, point.y);
  const rectangle = page.locator('.robotics-field-canvas [data-object-kind="rectangle"]').last();
  await expect(rectangle).toBeVisible();
  await closeObjectPanel(page);
  await pan(page, 'middle');
  const zoomAnchor = await rectangle.boundingBox();
  if (!zoomAnchor) throw new Error('Missing rectangle');
  await page.mouse.move(zoomAnchor.x + zoomAnchor.width / 2, zoomAnchor.y + zoomAnchor.height / 2);
  await page.mouse.wheel(0, -120);
  const beforeDrag = await rectangle.boundingBox();
  if (!beforeDrag) throw new Error('Missing rectangle before drag');
  const dragCamera = await viewBox(page);
  const start = { x: beforeDrag.x + beforeDrag.width / 2, y: beforeDrag.y + beforeDrag.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 31, start.y - 19, { steps: 8 });
  await page.mouse.up();
  const afterDrag = await rectangle.boundingBox();
  if (!afterDrag) throw new Error('Missing rectangle after drag');
  expect(Math.abs(afterDrag.x - beforeDrag.x - 31)).toBeLessThanOrEqual(1);
  expect(Math.abs(afterDrag.y - beforeDrag.y + 19)).toBeLessThanOrEqual(1);
  expect(await viewBox(page)).toBe(dragCamera);
  await closeObjectPanel(page);
  await page.getByRole('button', { name: 'К выделенному', exact: true }).click();
  await fit(page);
  checks.push('object follows pointer after pan/zoom within 1 CSS px; selection navigation');

  await rectangle.click();
  await closeObjectPanel(page);
  const handle = page
    .locator(
      '.robotics-field-selection-handles [data-vector-kind="decoration"][data-vector-handle="end"]',
    )
    .last();
  const handleRect = await handle.boundingBox();
  const sizeBefore = await rectangle.boundingBox();
  if (!handleRect || !sizeBefore) throw new Error('Missing resize handle');
  const resizeCamera = await viewBox(page);
  await page.mouse.move(handleRect.x + handleRect.width / 2, handleRect.y + handleRect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    handleRect.x + handleRect.width / 2 + 22,
    handleRect.y + handleRect.height / 2 - 17,
    { steps: 6 },
  );
  await page.mouse.up();
  expect(await viewBox(page)).toBe(resizeCamera);
  expect((await rectangle.boundingBox())!.width).toBeGreaterThan(sizeBefore.width + 10);
  await closeObjectPanel(page);
  checks.push('existing resize handles use the same camera inverse and do not pan');

  await selectTool(page, 'Линия');
  const beforeDrawingPan = await viewBox(page);
  const fieldRect = await canvas(page).boundingBox();
  if (!fieldRect) throw new Error('No canvas');
  await page.mouse.move(fieldRect.x + fieldRect.width / 2, fieldRect.y + fieldRect.height / 2);
  await page.keyboard.down('Space');
  await pan(page);
  await page.keyboard.up('Space');
  expect(await viewBox(page)).not.toBe(beforeDrawingPan);
  await fit(page);
  point = await screenWorld(page, 0.7, 3.4);
  const drawingCamera = await viewBox(page);
  await page.mouse.click(point.x, point.y);
  point = await screenWorld(page, 1.5, 3.4);
  await page.mouse.click(point.x, point.y);
  expect(await viewBox(page)).toBe(drawingCamera);
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  await expect(canvas(page)).toHaveAttribute('data-drawing', 'false');
  checks.push(
    'Space temporary pan preserves drawing tool; drawing clicks keep camera; Escape cancels trace',
  );

  await selectTool(page, 'Линия');
  if (mobile) {
    const rect = await canvas(page).boundingBox();
    if (!rect) throw new Error('No touch viewport');
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    const span = Math.min(70, rect.width / 4);
    const client = await context.newCDPSession(page);
    const before = (await viewBox(page))!.split(' ').map(Number);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { id: 1, x: x - span / 2, y },
        { id: 2, x: x + span / 2, y },
      ],
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { id: 1, x: x + 10 - span * 0.75, y: y + 15 },
        { id: 2, x: x + 10 + span * 0.75, y: y + 15 },
      ],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => viewBox(page)).not.toBe(before.join(' '));
    const after = (await viewBox(page))!.split(' ').map(Number);
    expect(before[2]! / after[2]!).toBeCloseTo(1.5, 1);
    await expect(canvas(page)).toHaveAttribute('data-drawing', 'false');
    await expect(canvas(page)).toHaveAttribute('data-camera-gesturing', 'false');
    const afterTouch = await viewBox(page);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { id: 4, x: x - 20, y },
        { id: 5, x: x + 20, y },
      ],
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    expect(await viewBox(page)).toBe(afterTouch);
    await expect(canvas(page)).toHaveAttribute('data-camera-gesturing', 'false');
    checks.push('native CDP two-finger pan + 1.5x pinch, drawing suppression and touchCancel');
    const externalCamera = await viewBox(page);
    await page.getByRole('button', { name: /Элементы поля/ }).click();
    const catalog = page.locator('.robotics-scene-inspector:visible');
    const catalogRect = await catalog.boundingBox();
    if (!catalogRect) throw new Error('No mobile catalog viewport');
    const scrollBefore = await catalog.evaluate((element) => element.scrollTop);
    const touchX = catalogRect.x + catalogRect.width - 12;
    const touchY = catalogRect.y + catalogRect.height - 30;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 7, x: touchX, y: touchY }],
    });
    for (let step = 1; step <= 6; step += 1) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { id: 7, x: touchX, y: touchY - (Math.min(180, catalogRect.height / 2) * step) / 6 },
        ],
      });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(() => catalog.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(scrollBefore);
    expect(await viewBox(page)).toBe(externalCamera);
    await page.getByRole('button', { name: 'Закрыть каталог элементов', exact: true }).click();
    await client.detach();
    checks.push(
      'native one-finger catalog scrolling outside the field remains available and does not alter camera',
    );
  }
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  await fit(page);

  const blurView = await viewBox(page);
  await page.mouse.move(fieldRect.x + 50, fieldRect.y + 60);
  await page.mouse.down({ button: 'middle' });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.move(fieldRect.x + 100, fieldRect.y + 100);
  await page.mouse.up({ button: 'middle' });
  expect(await viewBox(page)).toBe(blurView);
  await expect(canvas(page)).toHaveAttribute('data-camera-gesturing', 'false');
  checks.push('focus loss cancels a held pan without a later edit');

  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  const time = page.locator('[data-testid="robotics-time"]:visible');
  const readTime = async () =>
    Number(await time.first().getAttribute('data-microseconds')) / 1_000_000;
  await expect.poll(readTime, { timeout: 45_000 }).toBeGreaterThan(0);
  const beforeTime = await readTime();
  await time.first().evaluate((element) => {
    const samples = [Number(element.getAttribute('data-microseconds'))];
    const observer = new MutationObserver(() =>
      samples.push(Number(element.getAttribute('data-microseconds'))),
    );
    observer.observe(element, { attributes: true, attributeFilter: ['data-microseconds'] });
    (
      window as typeof window & { __fieldCameraTimeProbe?: { samples: number[]; stop: () => void } }
    ).__fieldCameraTimeProbe = { samples, stop: () => observer.disconnect() };
  });
  const workers = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __fieldCameraWorkers: { created: string[]; terminated: string[] };
        }
      ).__fieldCameraWorkers,
  );
  const writesBeforeRunNavigation = evidence.sourceWrites.length;
  await pan(page, 'middle');
  await page.mouse.wheel(0, -73);
  await page.getByRole('button', { name: 'К роботу', exact: true }).click();
  await fit(page);
  await expect.poll(readTime).toBeGreaterThan(beforeTime);
  const workersAfter = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __fieldCameraWorkers: { created: string[]; terminated: string[] };
        }
      ).__fieldCameraWorkers,
  );
  expect(workersAfter).toEqual(workers);
  const modelTimeSamples = await page.evaluate(() => {
    const probe = (
      window as typeof window & { __fieldCameraTimeProbe: { samples: number[]; stop: () => void } }
    ).__fieldCameraTimeProbe;
    probe.stop();
    return probe.samples;
  });
  expect(modelTimeSamples.length).toBeGreaterThan(1);
  expect(
    modelTimeSamples.every((value, index) => index === 0 || value >= modelTimeSamples[index - 1]!),
  ).toBe(true);
  expect(evidence.sourceWrites.length).toBe(writesBeforeRunNavigation);
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();
  checks.push(
    'real simulation: same Worker lifecycle, monotonic model time, no source writes during navigation',
  );

  await fit(page);
  await closeObjectPanel(page);
  expect(evidence.unexpectedMutations).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('field-camera-' + testInfo.project.name + '.png'),
    fullPage: false,
  });
  const report = {
    sourceSha,
    editorUrl: evidence.url,
    viewport: page.viewportSize(),
    maxDriftCssPx,
    metrics,
    checks,
    realWorker: workers,
    modelTimeBefore: beforeTime,
    modelTimeSamples,
    syntheticInitialSourceSha256: evidence.originalHash,
    interceptedApiRequests: evidence.interceptedRequests,
    protectedDataAccess: false,
    authenticationAcceptance: false,
    backendAndSaveAcceptance: false,
    isolation:
      'UI_ONLY synthetic session/project with all API requests fulfilled in an isolated browser context; actual 4630 portal editor and real Worker; no authentication, backend or database save acceptance',
    preventedMutationCount: evidence.preventedWrites.length,
    errors,
  };
  writeFileSync(testInfo.outputPath('camera-report.json'), JSON.stringify(report, null, 2) + '\n');
  await testInfo.attach('FIELD-CAMERA-001 evidence', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
}

test.describe('FIELD-CAMERA-001 existing portal editor', () => {
  test.skip(
    !uiOnly,
    'UI_ONLY acceptance requires explicit ASA_FIELD_CAMERA_UI_ONLY=true and existing4630',
  );
  test('regression: legacy zoom and fit survive the full responsive width sequence', async ({
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const evidence = await openEditor(page, context);
    const writes = evidence.sourceWrites.length;
    const measurements: { width: number; afterPlus: string | null; afterFit: string | null }[] = [];
    await fit(page);
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const label = page.getByLabel('Масштаб поля', { exact: true });
      await expect(label).toHaveText('100%');
      await page.getByRole('button', { name: 'Приблизить поле', exact: true }).click();
      await expect(label).toHaveText('125%');
      const afterPlus = await label.textContent();
      await fit(page);
      await expect(label).toHaveText('100%');
      measurements.push({ width, afterPlus, afterFit: await label.textContent() });
    }
    expect(evidence.sourceWrites.length).toBe(writes);
    expect(evidence.unexpectedMutations).toEqual([]);
    await testInfo.attach('responsive zoom levels', {
      body: JSON.stringify(measurements),
      contentType: 'application/json',
    });
  });

  test('regression: real publication modal closes above Robotics navigation at narrow widths', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const evidence = await openEditor(page, context, true);
    const writes = evidence.sourceWrites.length;
    const openPublication = async () => {
      const header = page.locator('.robotics-unified-header');
      const inline = header.locator('.robotics-header-publish');
      if (await inline.isVisible()) await inline.click();
      else {
        await header.locator('.robotics-header-menu > summary').click();
        await header
          .locator('.robotics-header-menu-panel')
          .getByRole('button', { name: 'Публикация', exact: true })
          .click();
      }
    };
    const modal = page.getByRole('dialog', { name: 'Публикация проекта', exact: true });
    await openPublication();
    await expect(modal.getByTestId('publication-status')).toContainText('Опубликовано');
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(modal).toBeVisible();
    }
    for (const width of [320, 390]) {
      if (width === 390) {
        await page.setViewportSize({ width, height: 900 });
        await openPublication();
        await expect(modal.getByTestId('publication-status')).toContainText('Опубликовано');
      }
      await page.screenshot({ path: testInfo.outputPath('publication-modal-' + width + '.png') });
      await modal
        .locator('.project-properties-head')
        .getByRole('button', { name: 'Закрыть', exact: true })
        .click({ timeout: 6_000 });
      await expect(modal).toBeHidden();
      await expect(page).toHaveURL(evidence.url);
      await expect(page.getByTestId('robotics-account-editor')).toBeVisible();
    }
    expect(evidence.sourceWrites.length).toBe(writes);
    expect(evidence.unexpectedMutations).toEqual([]);
    await testInfo.attach('modal isolation', {
      body: JSON.stringify({
        widths: [1440, 1024, 390, 320],
        closedNormallyAt: [320, 390],
        sourceWrites: evidence.sourceWrites.length - writes,
        sourceSha,
        backendAndSaveAcceptance: false,
      }),
      contentType: 'application/json',
    });
  });
  for (const [width, height] of [
    [1440, 900],
    [1366, 768],
    [390, 844],
  ] as const) {
    test('camera and gestures ' + width + 'x' + height, async ({ browser }, testInfo) => {
      test.setTimeout(180_000);
      const context = await browser.newContext({
        viewport: { width, height },
        locale: 'ru-RU',
        hasTouch: width === 390,
        isMobile: width === 390,
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      try {
        await checkCamera(page, context, testInfo, width === 390);
      } finally {
        await context.close();
      }
    });
  }
});
