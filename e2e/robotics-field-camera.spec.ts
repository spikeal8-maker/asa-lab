import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, type Page, type BrowserContext, type TestInfo } from '@playwright/test';

// Runs the real portal editor against the already-running owner-authorized
// server. Source reads and simulation are real; test-only source mutations are
// acknowledged in this isolated browser context and never sent to the database.
const authFile = process.env['ASA_FIELD_CAMERA_LOGIN_FILE'];
const sourceSha = process.env['ASA_FIELD_CAMERA_SHA'] ?? 'not-recorded';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function openEditor(page: Page, context: BrowserContext) {
  if (!authFile)
    throw new Error('ASA_FIELD_CAMERA_LOGIN_FILE is required for this actual-editor acceptance');
  const login = Object.fromEntries(
    readFileSync(authFile, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  const url = new URL(login['URL']!);
  if (url.origin !== 'http://127.0.0.1:4630' || !url.hash.startsWith('#/home/')) {
    throw new Error('FIELD-CAMERA-001 only accepts the existing private D2-R2:4630 portal editor');
  }
  const projectId = url.hash.slice('#/home/'.length).split('?')[0]!;
  await page.goto(url.origin + '/#/', { waitUntil: 'domcontentloaded' });
  await page
    .locator('.public-home-header-actions')
    .getByRole('button', { name: 'Войти', exact: true })
    .click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(login['EMAIL']!);
  await page.getByLabel('Пароль', { exact: true }).fill(login['PASSWORD']!);
  const checkbox = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await checkbox.isVisible()) await checkbox.check();
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 30_000 });

  const endpoint = url.origin + '/api/projects/' + encodeURIComponent(projectId);
  const response = await context.request.get(endpoint);
  expect(response.ok()).toBe(true);
  const fixture = await response.json();
  const originalHash = hash(fixture.draft.document);
  const sourceWrites: unknown[] = [];
  const preventedWrites: string[] = [];
  await context.route(new RegExp('/api/projects/' + projectId + '(?:[/?]|$)'), async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    if (request.method() === 'GET' && requestUrl.pathname === '/api/projects/' + projectId) {
      await route.fulfill({ status: 200, json: fixture });
      return;
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      await route.continue();
      return;
    }
    preventedWrites.push(request.method() + ' ' + requestUrl.pathname);
    if (requestUrl.pathname.endsWith('/draft')) {
      const body = request.postDataJSON();
      sourceWrites.push(body.document);
      fixture.draft = {
        ...fixture.draft,
        document: body.document,
        revision: body.baseRevision + 1,
      };
      await route.fulfill({ status: 200, json: { draft: fixture.draft, result: fixture.result } });
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        ok: true,
        project: fixture.project,
        draft: fixture.draft,
        result: fixture.result,
      },
    });
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
    endpoint,
    url: url.href,
    checkServerUnchanged: async () => {
      const current = await context.request.get(endpoint);
      expect(current.ok()).toBe(true);
      expect(hash((await current.json()).draft.document)).toBe(originalHash);
    },
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
  await evidence.checkServerUnchanged();
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
    serverSourceSha256: evidence.originalHash,
    serverSourceUnchanged: true,
    isolation:
      'Actual portal editor and real Worker; browser-context-only mutation acknowledgements; no database save acceptance',
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
    !authFile,
    'Actual-editor acceptance requires explicit private test login file and existing4630',
  );
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
