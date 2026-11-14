import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { PublicRoboticsArtifactV6 } from '../packages/contracts/src/public-robotics-artifact-v6';
import type { Project, ProjectDraft } from '../contexts/projects/domain/project';
import type { RoboticsProject } from '../contexts/robotics/domain/document';
import { collectBrowserFailures } from './browser-failures';
import { accountMenu, openAccountMenu, openPortalSection, portalTopBar } from './portal-navigation';

// This spec uses the ordinary production entry, cookie sessions and Project Core
// against e2e/server.mjs's real isolated PostgreSQL. No request is fulfilled,
// aborted or replaced by a browser fixture; editor/source assertions use its API.
const EVIDENCE = 'e2e/artifacts/robotics-projects';
const WIDTHS = [1440, 1024, 390, 320] as const;
const PRIVATE_SOURCE = 'ROBOTICS_PRIVATE_PROGRAM_MUST_NOT_APPEAR_PUBLICLY';
const origin = (page: Page): string => new URL(page.url()).origin;
const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an API response object');
  return value as Record<string, unknown>;
}

function responseString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error('Expected a nonempty API string');
  return value;
}

function responseRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error('Expected a positive API revision');
  return value;
}

async function register(page: Page, label: string) {
  const unique = randomUUID().replaceAll('-', '');
  const credentials = {
    email: `robotics-${unique}@isolated.test`,
    password: `Robotics-${unique}-Password`,
  };
  await page.goto('/#/');
  await page
    .locator('.public-home-header-actions')
    .getByRole('button', { name: 'Создать аккаунт', exact: true })
    .click();
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill(label);
  await page.getByLabel('Дата рождения', { exact: true }).fill('1991-04-18');
  await page.getByLabel('Пароль', { exact: true }).fill(credentials.password);
  const botCheck = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await botCheck.isVisible()) {
    await botCheck.press('Space');
    await expect(botCheck).toBeChecked();
    await expect(page.locator('.bot-check')).toHaveAttribute('data-status', 'ready');
  }
  const submit = page.getByRole('button', { name: 'Создать аккаунт', exact: true });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/#\/home$/);
  return credentials;
}

async function login(page: Page, credentials: { email: string; password: string }): Promise<void> {
  await page.goto('/#/');
  await page
    .locator('.public-home-header-actions')
    .getByRole('button', { name: 'Войти', exact: true })
    .click();
  await page.getByLabel('Почта или логин', { exact: true }).fill(credentials.email);
  await page.getByLabel('Пароль', { exact: true }).fill(credentials.password);
  const botCheck = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await botCheck.isVisible()) {
    await botCheck.press('Space');
    await expect(botCheck).toBeChecked();
    await expect(page.locator('.bot-check')).toHaveAttribute('data-status', 'ready');
  }
  const submit = page.getByRole('button', { name: 'Войти', exact: true });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/#\/home$/);
}

async function readProject(
  page: Page,
  projectId: string,
): Promise<{
  project: Project;
  draft: Omit<ProjectDraft, 'document'> & { document: RoboticsProject };
}> {
  const response = await page.request.get(`/api/projects/${projectId}`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function saved(page: Page, projectId: string) {
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByTestId('robotics-account-editor')).toHaveAttribute(
    'data-server-revision',
    /^[1-9]\d*$/,
  );
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
  const result = await readProject(page, projectId);
  expect(
    await page.getByTestId('robotics-account-editor').getAttribute('data-server-revision'),
  ).toBe(String(result.draft.revision));
  return result;
}

async function openFieldSettings(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Элементы поля', exact: true });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  const settings = page.locator('.robotics-field-settings-sheet');
  if ((await settings.isVisible()) && (await settings.getAttribute('open')) === null)
    await settings.locator(':scope > summary').click();
}

/** Select the real scene object, not the removed right-hand object list.
 * This exercises the new floating editor and keeps all object invariants. */
async function selectFieldObject(page: Page, key: string): Promise<void> {
  const dismissInspector = page.getByRole('button', { name: 'Закрыть параметры объекта' });
  if (await dismissInspector.isVisible()) await dismissInspector.click();
  const closeCatalog = page.getByRole('button', { name: 'Закрыть каталог элементов' });
  if (await closeCatalog.isVisible()) await closeCatalog.click();
  await page.getByRole('button', { name: 'Показать поле целиком', exact: true }).click();
  // Resize grips share data-scene-key with the source item. Select the
  // actual body/path, otherwise Playwright clicks a grip behind the object.
  const shape = page
    .locator('#robotics-panel-field [data-scene-key="' + key + '"]:not([data-vector-handle])')
    .first();
  await expect(shape).toBeAttached();
  if (key.startsWith('mark-group:')) {
    // Straight SVG lines can have a zero-width/zero-height DOM bounding box,
    // even though their visible stroke is clickable. Use the real path center.
    const position = await shape.evaluate((element) => {
      if (!(element instanceof SVGPathElement)) throw new Error('Expected an SVG path.');
      const matrix = element.getScreenCTM();
      if (!matrix) throw new Error('SVG path is not on screen.');
      const midpoint = element.getPointAtLength(element.getTotalLength() / 2);
      const screen = midpoint.matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
    await page.mouse.click(position.x, position.y);
  } else {
    await expect(shape).toBeVisible();
    await shape.click({ timeout: 15_000 });
  }
  await expect(page.getByRole('dialog', { name: 'Параметры выбранного объекта' })).toBeVisible();
}

async function numberField(page: Page, label: string, value: number): Promise<void> {
  const field = page.getByRole('spinbutton', { name: label, exact: true });
  if (!(await field.isVisible())) await openFieldSettings(page);
  await field.fill(String(value), { timeout: 20_000 });
  await field.press('Tab', { timeout: 20_000 });
  await expect(field).toHaveAttribute('aria-invalid', 'false');
}

/** Inspect native focus scrolling as-is: scrolling here would hide header-overlap regressions. */
async function fieldErrorLeavesFocusUncovered(invalidField: Locator, nextField: Locator) {
  await expect(nextField).toBeFocused();
  await expect
    .poll(() =>
      nextField.evaluate((input) => {
        const bounds = input.getBoundingClientRect();
        const inset = Math.min(4, bounds.width / 4, bounds.height / 4);
        const xs = [bounds.left + inset, bounds.left + bounds.width / 2, bounds.right - inset];
        const ys = [bounds.top + inset, bounds.top + bounds.height / 2, bounds.bottom - inset];
        return {
          focused: document.activeElement === input,
          inViewport:
            bounds.width > 0 &&
            bounds.height > 0 &&
            bounds.left >= 0 &&
            bounds.top >= 0 &&
            bounds.right <= innerWidth &&
            bounds.bottom <= innerHeight,
          uncovered: xs.every((x) =>
            ys.every((y) => {
              const hit = document.elementFromPoint(x, y);
              return hit === input || (hit !== null && input.contains(hit));
            }),
          ),
        };
      }),
    )
    .toEqual({ focused: true, inViewport: true, uncovered: true });
  await expect
    .poll(() =>
      invalidField.evaluate((input) => {
        const error = input.closest('label')?.querySelector('[role="alert"]');
        const text = error?.firstChild;
        if (!error || !text || text.nodeType !== Node.TEXT_NODE || !text.textContent?.length)
          return { inViewport: false, uncovered: false };
        // The first glyph catches an obscured beginning even when later wrapped lines are visible.
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 1);
        const bounds = range.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        );
        return {
          inViewport:
            bounds.width > 0 &&
            bounds.height > 0 &&
            bounds.left >= 0 &&
            bounds.top >= 0 &&
            bounds.right <= innerWidth &&
            bounds.bottom <= innerHeight,
          uncovered: hit === error || (hit !== null && error.contains(hit)),
        };
      }),
    )
    .toEqual({ inViewport: true, uncovered: true });
}

async function noOverflow(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(size.document).toBeLessThanOrEqual(size.viewport);
}

async function visibleControl(page: Page, control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(24);
  expect(box!.height).toBeGreaterThanOrEqual(28);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
}

/**
 * Navigation and publication stay available when the single-row Robotics
 * header moves secondary actions into its compact menu.
 * Inspect the actual visible action instead of assuming desktop-only buttons.
 */
async function roboticsHeaderAction(
  page: Page,
  label: 'Главная' | 'Аккаунт' | 'Публикация',
  activate = false,
): Promise<void> {
  const header = page.locator('.robotics-unified-header');
  const inline =
    label === 'Публикация'
      ? header.locator('.robotics-header-publish')
      : header.locator('.robotics-header-navigation').getByRole('button', {
          name: label,
          exact: true,
        });
  if (await inline.isVisible()) {
    await visibleControl(page, inline);
    if (activate) await inline.click();
    return;
  }
  const summary = header.locator('.robotics-header-menu > summary');
  await visibleControl(page, summary);
  await summary.click();
  const action = header
    .locator('.robotics-header-menu-panel')
    .getByRole('button', { name: label, exact: true });
  await visibleControl(page, action);
  if (activate) await action.click();
  else await summary.click();
}

async function gridControlGeometry(control: Locator): Promise<void> {
  await expect(control).toBeVisible();
  const geometry = await control.evaluate((element) => {
    const label = element.closest('label');
    if (!label || label.control !== element) throw new Error('Expected a native checkbox label');
    const caption = Array.from(label.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === 'Сетка',
    );
    if (!caption) throw new Error('Expected the grid checkbox caption');
    const range = document.createRange();
    range.selectNodeContents(caption);
    const glyph = element.getBoundingClientRect();
    const touch = label.getBoundingClientRect();
    const text = range.getBoundingClientRect();
    return {
      glyphWidth: glyph.width,
      glyphHeight: glyph.height,
      touchWidth: touch.width,
      touchHeight: touch.height,
      captionFragments: range.getClientRects().length,
      captionGap: text.left - glyph.right,
      centerOffset: Math.abs(text.top + text.height / 2 - glyph.top - glyph.height / 2),
    };
  });
  expect(geometry.glyphWidth).toBeGreaterThanOrEqual(14);
  expect(geometry.glyphWidth).toBeLessThanOrEqual(24);
  expect(geometry.glyphHeight).toBeGreaterThanOrEqual(14);
  expect(geometry.glyphHeight).toBeLessThanOrEqual(24);
  expect(geometry.touchWidth).toBeGreaterThanOrEqual(44);
  expect(geometry.touchHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.captionFragments).toBe(1);
  expect(geometry.captionGap).toBeGreaterThanOrEqual(3);
  expect(geometry.captionGap).toBeLessThanOrEqual(16);
  expect(geometry.centerOffset).toBeLessThanOrEqual(2);
}

async function cardPreview(page: Page, title: string): Promise<Locator> {
  const card = page
    .getByTestId('project-card')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(card).toHaveCount(1);
  await card.scrollIntoViewIfNeeded();
  const image = card.getByTestId('project-preview-snapshot');
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const picture = element as HTMLImageElement;
        return picture.complete && picture.naturalWidth === 480 && picture.naturalHeight === 360;
      }),
    )
    .toBe(true);
  const frame = await card.locator('.project-card-frame').boundingBox();
  const imageBox = await image.boundingBox();
  const cardBox = await card.boundingBox();
  expect(frame).not.toBeNull();
  expect(imageBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(frame!.width).toBeGreaterThan(32);
  expect(frame!.height).toBeGreaterThan(32);
  expect(frame!.height).toBeLessThan(cardBox!.height);
  expect(imageBox!.x).toBeGreaterThanOrEqual(frame!.x - 1);
  expect(imageBox!.y).toBeGreaterThanOrEqual(frame!.y - 1);
  expect(imageBox!.x + imageBox!.width).toBeLessThanOrEqual(frame!.x + frame!.width + 1);
  expect(imageBox!.y + imageBox!.height).toBeLessThanOrEqual(frame!.y + frame!.height + 1);
  expect(await image.evaluate((element) => getComputedStyle(element).objectFit)).toBe('contain');
  // Home shelves and My Projects deliberately have different card shapes.
  // Respect their actual CSS ratio; an auto frame is sized by its square card.
  for (const surface of [card, card.locator('.project-card-frame')]) {
    const ratio = await surface.evaluate((element) => getComputedStyle(element).aspectRatio);
    if (ratio === 'auto') continue;
    const [horizontal, vertical = 1] = ratio.split('/').map(Number);
    const box = (await surface.boundingBox())!;
    expect(horizontal).toBeGreaterThan(0);
    expect(vertical).toBeGreaterThan(0);
    expect(Math.abs(box.height - (box.width * vertical!) / horizontal!)).toBeLessThanOrEqual(2);
  }
  const raster = await image.evaluate(async (element) => {
    const picture = element as HTMLImageElement;
    await picture.decode();
    const canvas = document.createElement('canvas');
    canvas.width = picture.naturalWidth;
    canvas.height = picture.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not inspect the saved preview');
    context.drawImage(picture, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = true;
    let nonBackgroundPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      opaque &&= pixels[offset + 3] === 255;
      if (
        Math.abs(pixels[offset]! - pixels[0]!) +
          Math.abs(pixels[offset + 1]! - pixels[1]!) +
          Math.abs(pixels[offset + 2]! - pixels[2]!) >
        24
      )
        nonBackgroundPixels += 1;
    }
    return { opaque, nonBackgroundPixels, png: canvas.toDataURL('image/png') };
  });
  expect(raster.opaque).toBe(true);
  expect(raster.nonBackgroundPixels).toBeGreaterThan(1000);
  const png = Buffer.from(raster.png.split(',')[1]!, 'base64');
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const location = new URL(page.url()).hash.startsWith('#/projects') ? 'my-projects' : 'home';
  writeFileSync(`${EVIDENCE}/source-preview-${location}-${page.viewportSize()!.width}.png`, png);
  return card;
}

test('Robotics uses account projects, the main portal and an immutable publication for a second user', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE, { recursive: true });
  const failures = [
    collectBrowserFailures(page, { allowAnonymousSessionProbe: true, allowAdminAccessProbe: true }),
  ];
  const contexts: BrowserContext[] = [];
  const serverWrites: { method: string; path: string; status: number }[] = [];
  const observe = (target: Page): void => {
    target.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (
        /^\/api\/projects(?:\/|$)/.test(path) &&
        ['POST', 'PUT', 'PATCH'].includes(response.request().method())
      )
        serverWrites.push({ method: response.request().method(), path, status: response.status() });
    });
    target.on('dialog', (dialog) => {
      void dialog.accept();
    });
  };
  observe(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const credentials = await register(page, 'Автор робототехники');
  const title = `Робот для исследования движения, датчика расстояния и собственного высокого поля — ${randomUUID().slice(0, 8)}`;

  await page.locator('.portal-header .portal-quick-create > summary').click();
  const createdResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/projects' &&
      response.request().method() === 'POST',
  );
  await page
    .locator('.portal-header .portal-create-options')
    .getByRole('button', { name: /^Робототехника/ })
    .click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  await expect(page).toHaveURL(new RegExp(`${projectId}.*module=robotics`));
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Поле', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('textbox', { name: 'Название проекта', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Название проекта', exact: true }).press('Tab');
  const initial = await readProject(page, projectId);
  expect(initial.project.moduleKey).toBe('robotics');
  expect(initial.draft.document.schemaVersion).toBe(3);
  const initialUno = initial.draft.document.circuit.components.find((part) => part.id === 'uno')!;
  expect(initialUno.stateProperties?.['arduinoCodeMode']).toBe('blocks');
  expect(String(initialUno.stateProperties?.['arduinoWorkspace'])).toContain('blocks');

  // The supported field's tallest aspect ratio is 0.8 × 2.4 metres. Remove the
  // starter wall through the inspector before narrowing its authored geometry.
  await selectFieldObject(page, 'wall:barrier');
  await page.getByRole('button', { name: 'Удалить предмет', exact: true }).click();
  await numberField(page, 'Высота поля', 2.4);
  await numberField(page, 'Ширина поля', 0.8);
  await numberField(page, 'Шаг сетки', 0.2);
  for (const tool of ['Стена', 'Мяч', 'Зона']) {
    await page
      .getByTestId('robotics-field-palette')
      .getByRole('button', { name: tool, exact: true })
      .click();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  }
  await page.getByRole('tab', { name: 'Робот', exact: true }).click();
  // Assembly inputs use millimetres; the saved document and publication use metres.
  await numberField(page, 'Длина корпуса', 180);
  await page.getByRole('tab', { name: 'Электроника', exact: true }).click();
  await expect(
    page.locator('.workbench-canvas [data-testid="schematic-component"][data-component-id="uno"]'),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Код', exact: true }).click();
  await expect(page.getByTestId('arduino-block-workspace')).toBeVisible();
  await page.locator('.robotics-code-extras > summary').click();
  await page
    .getByRole('combobox', { name: 'Пример программы', exact: true })
    .selectOption('turn-left');
  const blocksSaved = await saved(page, projectId);
  const blockProgram = blocksSaved.draft.document.circuit.components.find(
    (part) => part.id === 'uno',
  )!.stateProperties!;
  expect(blockProgram['arduinoCodeMode']).toBe('blocks');
  expect(blockProgram['arduinoWorkspace']).not.toBe(
    initialUno.stateProperties?.['arduinoWorkspace'],
  );

  await page.locator('.arduino-mode-menu > summary').click();
  await page.getByRole('button', { name: 'Текст', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Продолжить?', exact: true })
    .getByRole('button', { name: 'Продолжить', exact: true })
    .click();
  const code = page.getByRole('textbox', { name: 'Код Arduino C++', exact: true });
  const source = `// ${PRIVATE_SOURCE}\n${await code.inputValue()}`;
  await code.fill(source);
  const confirmed = await saved(page, projectId);
  expect(confirmed.project.title).toBe(title);
  expect(confirmed.draft.document.world.field).toMatchObject({
    widthMeters: 0.8,
    heightMeters: 2.4,
    gridMeters: 0.2,
  });
  expect(confirmed.draft.document.world.field.obstacles).toHaveLength(1);
  expect(confirmed.draft.document.world.field.balls).toHaveLength(1);
  expect(confirmed.draft.document.world.field.floorMarks).toHaveLength(1);
  expect(confirmed.draft.document.world.robot.bodyLengthMeters).toBe(0.18);
  expect(
    confirmed.draft.document.circuit.components.find((part) => part.id === 'uno')!
      .stateProperties?.['arduinoSource'],
  ).toBe(source);
  expect(confirmed.draft.document.circuit.simulation.running).toBe(false);

  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await expect
    .poll(
      async () => Number(await page.getByTestId('robotics-time').getAttribute('data-microseconds')),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(200_000);
  const duringRun = await saved(page, projectId);
  expect(duringRun.draft).toEqual(confirmed.draft);
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('tab', { name: 'Поле', exact: true }).click();
    await noOverflow(page);
    for (const label of ['Поле', 'Робот', 'Электроника', 'Код'])
      await visibleControl(page, page.getByRole('tab', { name: label, exact: true }));
    await visibleControl(page, page.getByRole('button', { name: 'Сохранить', exact: true }));
    for (const label of ['Публикация', 'Аккаунт'] as const) await roboticsHeaderAction(page, label);
    await page.screenshot({ path: `${EVIDENCE}/editor-field-${width}.png`, fullPage: true });
    await page.getByRole('tab', { name: 'Код', exact: true }).click();
    await expect(code).toBeVisible();
    await expect(code).toHaveValue(source);
    await noOverflow(page);
    await page.screenshot({ path: `${EVIDENCE}/editor-program-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await roboticsHeaderAction(page, 'Главная', true);
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByRole('heading', { name: 'Робототехника', exact: true })).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await cardPreview(page, title);
    await noOverflow(page);
    await page.screenshot({ path: `${EVIDENCE}/home-${width}.png`, fullPage: true });
  }
  await openPortalSection(page, 'Проекты');
  await page.getByRole('tab', { name: 'Виртуальная робототехника', exact: true }).click();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await cardPreview(page, title);
    await noOverflow(page);
    await page.screenshot({ path: `${EVIDENCE}/my-projects-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAccountMenu(page);
  await accountMenu(page).getByRole('button', { name: 'Выход', exact: true }).click();
  await expect(page.locator('.public-home-header-actions')).toBeVisible();

  try {
    // A fresh context has no cookies/localStorage from the authoring device.
    const secondDevice = await browser.newContext({
      baseURL: origin(page),
      viewport: { width: 1440, height: 900 },
    });
    contexts.push(secondDevice);
    expect((await secondDevice.storageState()).origins).toEqual([]);
    const restored = await secondDevice.newPage();
    failures.push(
      collectBrowserFailures(restored, {
        allowAnonymousSessionProbe: true,
        allowAdminAccessProbe: true,
      }),
    );
    observe(restored);
    await login(restored, credentials);
    await openPortalSection(restored, 'Проекты');
    await (
      await cardPreview(restored, title)
    )
      .getByRole('link', { name: title, exact: true })
      .click();
    await expect(restored.getByTestId('robotics-account-editor')).toBeVisible();
    const reopened = await readProject(restored, projectId);
    expect(reopened.draft.document).toEqual(confirmed.draft.document);
    expect(reopened.draft.revision).toBe(confirmed.draft.revision);
    await restored.getByRole('tab', { name: 'Код', exact: true }).click();
    await expect(
      restored.getByRole('textbox', { name: 'Код Arduino C++', exact: true }),
    ).toHaveValue(source);
    await restored.getByRole('tab', { name: 'Поле', exact: true }).click();
    await openFieldSettings(restored);
    await expect(
      restored.getByRole('spinbutton', { name: 'Высота поля', exact: true }),
    ).toHaveValue('2.4');
    await roboticsHeaderAction(restored, 'Публикация', true);
    const publicationDialog = restored.getByRole('dialog', {
      name: 'Публикация проекта',
      exact: true,
    });
    await expect(publicationDialog).toBeVisible();
    await publicationDialog
      .getByLabel('Описание проекта', { exact: true })
      .fill('Собственное высокое поле, стена, мяч, разметка и конструкция робота.');
    await publicationDialog.getByTestId('publication-publish').click();
    await expect(publicationDialog.getByTestId('publication-status')).toContainText('Опубликовано');
    for (const width of WIDTHS) {
      await restored.setViewportSize({ width, height: 900 });
      await noOverflow(restored);
      await publicationDialog.screenshot({ path: `${EVIDENCE}/publication-${width}.png` });
    }
    const statusResponse = await restored.request.get(`/api/projects/${projectId}/publication`);
    expect(statusResponse.status()).toBe(200);
    const publicationRecord = record(record(await statusResponse.json()).publication);
    const publication = {
      publicationId: responseString(publicationRecord.publicationId),
      revisionId: responseString(publicationRecord.revisionId),
      revisionNo: responseRevision(publicationRecord.revisionNo),
      state: responseString(publicationRecord.state),
    };
    expect(publication.state).toBe('public');
    await publicationDialog
      .locator('.project-properties-head')
      .getByRole('button', { name: 'Закрыть', exact: true })
      .click();

    const otherAccount = await browser.newContext({
      baseURL: origin(restored),
      viewport: { width: 1440, height: 900 },
    });
    contexts.push(otherAccount);
    const viewer = await otherAccount.newPage();
    failures.push(
      collectBrowserFailures(viewer, {
        allowAnonymousSessionProbe: true,
        allowAdminAccessProbe: true,
      }),
    );
    observe(viewer);
    await register(viewer, 'Читатель робототехники');
    await portalTopBar(viewer).getByRole('link', { name: 'Проекты', exact: true }).click();
    await viewer
      .getByRole('group', { name: 'Среда проекта' })
      .getByRole('button', { name: 'Робототехника', exact: true })
      .click();
    await viewer.getByRole('searchbox', { name: 'Поиск по названию и описанию' }).fill(title);
    await viewer.getByRole('button', { name: 'Найти', exact: true }).click();
    await expect(viewer).toHaveURL(/module=robotics/);
    const publicCard = viewer.getByTestId('public-project-card').filter({ hasText: title });
    await expect(publicCard).toBeVisible();
    await viewer.screenshot({ path: `${EVIDENCE}/community-1440.png`, fullPage: true });
    await publicCard.getByRole('link', { name: `Открыть проект «${title}»`, exact: true }).click();
    const publicView = viewer.getByTestId('public-robotics-viewer');
    await expect(publicView).toBeVisible();
    await expect(publicView).toHaveAttribute(
      'data-revision-number',
      String(publication.revisionNo),
    );
    const publicResponse = await viewer.request.get(
      `/api/public-projects/${publication.publicationId}`,
    );
    expect(publicResponse.status()).toBe(200);
    const publicMetadata = record(record(await publicResponse.json()).publication);
    expect(publicMetadata.capabilities).toMatchObject({ canCopy: false, downloadFormats: [] });
    const artifactPath = `/api/public-projects/${publication.publicationId}/artifact?revisionId=${publication.revisionId}`;
    const artifactResponse = await viewer.request.get(artifactPath);
    expect(artifactResponse.status()).toBe(200);
    const artifact = (await artifactResponse.json()).artifact as PublicRoboticsArtifactV6;
    expect(artifact).toMatchObject({
      schemaVersion: 6,
      viewerFamily: 'robotics',
      capabilities: { readOnly: true, download: false },
      world: {
        field: { widthMeters: 0.8, heightMeters: 2.4 },
        robot: { bodyLengthMeters: 0.18 },
        initialPose: confirmed.draft.document.world.initialPose,
      },
    });
    expect(JSON.stringify(artifact)).not.toMatch(
      /arduinoSource|arduinoWorkspace|bindings|circuit|ROBOTICS_PRIVATE_PROGRAM/,
    );
    expect((await viewer.request.get(`/api/projects/${projectId}`)).status()).toBe(404);
    const ownerRoute = await viewer.request.get(
      `/api/public-projects/${publication.publicationId}/editor`,
    );
    expect(ownerRoute.status()).toBe(200);
    expect(await ownerRoute.json()).toEqual({ editor: null });

    const gridControl = publicView.getByRole('checkbox', { name: 'Сетка', exact: true });
    for (const width of WIDTHS) {
      await viewer.setViewportSize({ width, height: 900 });
      await noOverflow(viewer);
      await publicView.getByRole('button', { name: 'Поле', exact: true }).click();
      await expect(gridControl).toBeEnabled();
      await expect(gridControl).toBeChecked();
      await gridControlGeometry(gridControl);
      if (width === WIDTHS[0]) {
        await gridControl.focus();
        await expect(gridControl).toBeFocused();
        await gridControl.press('Space');
        await expect(gridControl).not.toBeChecked();
        await gridControl.press('Space');
        await expect(gridControl).toBeChecked();
      }
      await publicView.getByRole('button', { name: 'Приблизить поле', exact: true }).click();
      await expect(publicView.getByLabel('Текущий масштаб')).toHaveText('125%');
      await publicView.getByRole('button', { name: 'Показать целиком', exact: true }).click();
      await expect(publicView.getByLabel('Текущий масштаб')).toHaveText('100%');
      await expect(viewer.getByTestId('public-robotics-field')).toHaveAttribute(
        'preserveAspectRatio',
        'xMidYMid meet',
      );
      await viewer.screenshot({ path: `${EVIDENCE}/viewer-field-${width}.png`, fullPage: true });
      await publicView.getByRole('button', { name: 'Конструкция', exact: true }).click();
      await expect(gridControl).toBeDisabled();
      await expect(gridControl).toBeChecked();
      await gridControlGeometry(gridControl);
      await noOverflow(viewer);
      await viewer.screenshot({ path: `${EVIDENCE}/viewer-assembly-${width}.png`, fullPage: true });
    }
    // Updating the private project must leave the already published revision frozen.
    await restored.setViewportSize({ width: 1440, height: 900 });
    await restored.getByRole('tab', { name: 'Поле', exact: true }).click();
    await numberField(restored, 'Шаг сетки', 0.1);
    const changed = await saved(restored, projectId);
    expect(changed.draft.revision).toBeGreaterThan(confirmed.draft.revision);
    await viewer.reload();
    await expect(publicView).toHaveAttribute(
      'data-revision-number',
      String(publication.revisionNo),
    );
    const unchanged = await viewer.request.get(artifactPath);
    expect(unchanged.status()).toBe(200);
    expect((await unchanged.json()).artifact).toEqual(artifact);
    expect(
      serverWrites.some(
        (write) => write.path === `/api/projects/${projectId}/draft` && write.status === 200,
      ),
    ).toBe(true);
    expect(
      serverWrites.some(
        (write) => write.path === `/api/projects/${projectId}/publication` && write.status === 200,
      ),
    ).toBe(true);
    for (const failure of failures) failure.assertEmpty();
    writeFileSync(
      `${EVIDENCE}/lifecycle.json`,
      JSON.stringify(
        {
          projectId,
          revisionBeforePublication: confirmed.draft.revision,
          revisionAfterPrivateEdit: changed.draft.revision,
          publicationId: publication.publicationId,
          publicationRevisionId: publication.revisionId,
          sourceDigest: digest(confirmed.draft.document),
          artifactDigest: digest(artifact),
          freshBrowserContextRestored: true,
          secondAccountPrivateAccess: 404,
          viewportWidths: WIDTHS,
          serverWrites,
        },
        null,
        2,
      ),
    );
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('FIELD v3 authors tiled tracks and real objects, runs Arduino contacts, and publishes frozen v6 geometry', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  mkdirSync(EVIDENCE, { recursive: true });
  const failures = [
    collectBrowserFailures(page, { allowAnonymousSessionProbe: true, allowAdminAccessProbe: true }),
  ];
  const contexts: BrowserContext[] = [];
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const credentials = await register(page, 'Автор исследования физики поля');
  const title = `Плитки 30 см, банка, мяч и брусок — ${randomUUID().slice(0, 8)}`;
  await page.locator('.portal-header .portal-quick-create > summary').click();
  const createdResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/projects' &&
      response.request().method() === 'POST',
  );
  await page
    .locator('.portal-header .portal-create-options')
    .getByRole('button', { name: /^Робототехника/ })
    .click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible();
  await page.getByRole('textbox', { name: 'Название проекта', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Название проекта', exact: true }).press('Tab');
  const initial = await readProject(page, projectId);
  expect(initial.draft.document.schemaVersion).toBe(3);
  expect(initial.draft.document.world.physicsProfile).toBe('rigid-body-2d-v1');
  await openFieldSettings(page);
  await expect(page.getByRole('combobox', { name: 'Режим физики', exact: true })).toHaveValue(
    'dynamic',
  );
  await selectFieldObject(page, 'wall:barrier');
  await page.getByRole('button', { name: 'Удалить предмет', exact: true }).click();
  await page
    .locator('summary')
    .filter({ hasText: /^Плитки и размер поля$/ })
    .click();
  const columnsInput = page.getByRole('spinbutton', { name: 'Плиток по ширине', exact: true });
  await columnsInput.fill('4.5');
  await columnsInput.press('Tab');
  await expect(columnsInput).toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.getByRole('button', { name: 'Применить размер по плиткам', exact: true }),
  ).toBeDisabled();
  await columnsInput.focus();
  await columnsInput.press('Escape');
  await numberField(page, 'Плиток по ширине', 4);
  await numberField(page, 'Плиток по высоте', 6);
  await page.getByRole('button', { name: 'Применить размер по плиткам', exact: true }).click();
  await numberField(page, 'Шаг сетки', 0.1);
  await page
    .getByRole('combobox', { name: 'Точность расчёта', exact: true })
    .selectOption('precise');
  await page.getByRole('combobox', { name: 'Покрытие поля', exact: true }).selectOption('carpet');
  const tiled = await saved(page, projectId);
  expect(tiled.draft.document.world.field).toMatchObject({
    widthMeters: 1.2,
    heightMeters: 1.8,
    gridMeters: 0.1,
    tiles: { enabled: true, sizeMeters: 0.3 },
    surface: 'carpet',
  });
  expect(tiled.draft.document.world.physics?.accuracy).toBe('precise');
  await page.getByRole('combobox', { name: 'Покрытие поля', exact: true }).selectOption('wood');

  const add = async (label: string) => {
    await page
      .getByTestId('robotics-field-palette')
      .getByRole('button', { name: label, exact: true })
      .click();
    // Lines and curves are drawn directly on the SVG canvas, not inserted
    // through the ordinary object "Добавить" button.
    if (label === 'Линия' || label === 'Кривая') {
      const canvas = page.locator('.robotics-field-canvas svg.robotics-field');
      const widthMeters = tiled.draft.document.world.field.widthMeters;
      const heightMeters = tiled.draft.document.world.field.heightMeters;
      // Use the actual scene transformation, not a fraction of an SVG box
      // containing padding, letterboxing and scroll offsets.
      const click = async (x: number, y: number, button: 'left' | 'right' = 'left') => {
        const target = await canvas.evaluate(
          (svg, { x, y, widthMeters, heightMeters }) => {
            if (!(svg instanceof SVGSVGElement)) {
              throw new Error('Field canvas must be an SVGSVGElement.');
            }
            const matrix = svg.getScreenCTM();
            if (!matrix) throw new Error('Field SVG screen transform is unavailable.');
            const point = svg.createSVGPoint();
            point.x = x * widthMeters * 1000;
            point.y = (1 - y) * heightMeters * 1000;
            const screen = point.matrixTransform(matrix);
            const hit = document.elementFromPoint(screen.x, screen.y);
            return {
              x: screen.x,
              y: screen.y,
              onField: hit === svg || (hit !== null && svg.contains(hit)),
              hitTag: hit?.tagName ?? null,
            };
          },
          { x, y, widthMeters, heightMeters },
        );
        if (!target.onField)
          throw new Error('Vector click was outside visible canvas: ' + JSON.stringify(target));
        await page.mouse.click(target.x, target.y, { button });
      };
      if (label === 'Линия') {
        const before = await page
          .locator('#robotics-panel-field [data-object-kind="line"]')
          .count();
        await click(0.18, 0.74);
        await click(0.47, 0.74);
        await click(0.47, 0.74, 'right'); // finish the authored polyline
        await expect(page.locator('#robotics-panel-field [data-object-kind="line"]')).toHaveCount(
          before + 1,
        );
      } else {
        const before = await page
          .locator('#robotics-panel-field [data-object-kind="curve"]')
          .count();
        await click(0.2, 0.48); // start
        await click(0.35, 0.37); // Bézier control
        await click(0.52, 0.48); // end
        await expect(page.locator('#robotics-panel-field [data-object-kind="curve"]')).toHaveCount(
          before + 1,
        );
      }
      await expect(
        page.getByRole('dialog', { name: 'Параметры выбранного объекта' }),
      ).toBeVisible();
      return;
    }
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  };
  const nameObject = async (label: string) => {
    await page.getByRole('textbox', { name: 'Название предмета', exact: true }).fill(label);
    await page.getByRole('textbox', { name: 'Название предмета', exact: true }).press('Tab');
  };
  await add('Мяч');
  await numberField(page, 'X мяча', 0.82);
  await numberField(page, 'Y мяча', 0.9);
  await add('Банка');
  await numberField(page, 'X банки', 0.99);
  await numberField(page, 'Y банки', 0.9);
  await numberField(page, 'Масса банки', 0.06);
  const longLabel = 'Металлическая банка для опыта со столкновением и сопротивлением покрытия поля';
  await nameObject(longLabel);
  await add('Брусок');
  await numberField(page, 'X бруска', 0.9);
  await numberField(page, 'Y бруска', 1.3);
  await numberField(page, 'Угол предмета', 30);
  await add('Линия');
  await numberField(page, 'Начало линии X', 0.15);
  await numberField(page, 'Начало линии Y', 0.3);
  await numberField(page, 'Конец линии X', 1.05);
  await numberField(page, 'Конец линии Y', 0.3);
  await add('Кривая');
  await numberField(page, 'Начало линии Y', 1.2);
  await numberField(page, 'Конец линии Y', 1.5);
  await numberField(page, 'Изгиб Y', 1.2);

  for (const [kind, x, y] of [
    ['straight', 0.15, 0.15],
    ['turn', 0.45, 0.15],
    ['t-junction', 0.75, 0.15],
  ] as const) {
    await page
      .getByTestId('robotics-field-palette')
      .getByRole('button', { name: 'Трасса', exact: true })
      .click();
    await page.getByRole('combobox', { name: 'Штамп трассы', exact: true }).selectOption(kind);
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await numberField(page, 'Центр штампа X', x);
    await numberField(page, 'Центр штампа Y', y);
  }
  const beforeCross = await saved(page, projectId);
  await page
    .getByTestId('robotics-field-palette')
    .getByRole('button', { name: 'Трасса', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Штамп трассы', exact: true }).selectOption('cross');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const withCross = await saved(page, projectId);
  expect(withCross.draft.document.world.field.floorMarks).toHaveLength(
    beforeCross.draft.document.world.field.floorMarks.length + 2,
  );
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  expect((await saved(page, projectId)).draft.document.world).toEqual(
    beforeCross.draft.document.world,
  );
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  expect((await saved(page, projectId)).draft.document.world).toEqual(
    withCross.draft.document.world,
  );
  await numberField(page, 'Центр штампа X', 0.75);
  await numberField(page, 'Центр штампа Y', 0.45);
  await nameObject('Перекрёсток 30 см');
  const beforeRotation = await saved(page, projectId);
  const cross = beforeRotation.draft.document.world.field.floorMarks.find(
    (mark) => mark.label === 'Перекрёсток 30 см',
  )!;
  expect(cross.groupId).toBeTruthy();
  const crossMembers = (source: RoboticsProject) =>
    source.world.field.floorMarks.filter((mark) => mark.groupId === cross.groupId);
  await page.getByRole('button', { name: 'Повернуть на 90°', exact: true }).click();
  const rotated = await saved(page, projectId);
  expect(crossMembers(rotated.draft.document)).toHaveLength(2);
  expect(crossMembers(rotated.draft.document)).not.toEqual(
    crossMembers(beforeRotation.draft.document),
  );
  for (const mark of crossMembers(rotated.draft.document))
    expect(mark.groupPivot).toEqual(cross.groupPivot);
  await page.getByRole('button', { name: 'Дублировать предмет', exact: true }).click();
  const duplicated = await saved(page, projectId);
  expect(duplicated.draft.document.world.field.floorMarks).toHaveLength(
    rotated.draft.document.world.field.floorMarks.length + 2,
  );
  await page.getByRole('button', { name: 'Удалить предмет', exact: true }).click();
  expect((await saved(page, projectId)).draft.document.world).toEqual(rotated.draft.document.world);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  expect((await saved(page, projectId)).draft.document.world).toEqual(
    duplicated.draft.document.world,
  );

  // Dragging a grouped stamp moves all members and commits one history entry.
  await selectFieldObject(page, `mark-group:${cross.groupId}`);
  const beforeDrag = await saved(page, projectId);
  await page.getByRole('checkbox', { name: 'Привязка', exact: true }).check();
  const stampShape = page
    .locator(`#robotics-panel-field [data-scene-key="mark-group:${cross.groupId}"]`)
    .first();
  const box = await stampShape.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 - 64, box!.y + box!.height / 2 - 12, { steps: 4 });
  await page.mouse.up();
  const afterDrag = await saved(page, projectId);
  const beforeMembers = crossMembers(beforeDrag.draft.document);
  const afterMembers = crossMembers(afterDrag.draft.document);
  expect(afterMembers).not.toEqual(beforeMembers);
  expect(afterMembers).toHaveLength(2);
  const dx = afterMembers[0]!.groupPivot!.xMeters - beforeMembers[0]!.groupPivot!.xMeters;
  const dy = afterMembers[0]!.groupPivot!.yMeters - beforeMembers[0]!.groupPivot!.yMeters;
  expect(dx / 0.1).toBeCloseTo(Math.round(dx / 0.1), 9);
  expect(dy / 0.1).toBeCloseTo(Math.round(dy / 0.1), 9);
  for (let index = 0; index < afterMembers.length; index++) {
    const before = beforeMembers[index]!,
      after = afterMembers[index]!;
    expect(after.groupPivot!.xMeters - before.groupPivot!.xMeters).toBeCloseTo(dx, 9);
    expect(after.groupPivot!.yMeters - before.groupPivot!.yMeters).toBeCloseTo(dy, 9);
    if (before.kind === 'line' && after.kind === 'line') {
      expect(after.start.xMeters - before.start.xMeters).toBeCloseTo(dx, 9);
      expect(after.end.yMeters - before.end.yMeters).toBeCloseTo(dy, 9);
    }
  }
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  expect((await saved(page, projectId)).draft.document.world).toEqual(
    beforeDrag.draft.document.world,
  );
  await page.getByRole('checkbox', { name: 'Привязка', exact: true }).uncheck();

  await page.getByRole('tab', { name: 'Робот', exact: true }).click();
  await numberField(page, 'Датчик: вперёд от центра', 0);
  await numberField(page, 'Датчик: влево от центра', 100);
  await numberField(page, 'Направление датчика', 90);
  await page.getByRole('tab', { name: 'Код', exact: true }).click();
  await expect(page.getByTestId('arduino-block-workspace')).toBeVisible();
  await page.locator('.robotics-code-extras > summary').click();
  await page
    .getByRole('combobox', { name: 'Пример программы', exact: true })
    .selectOption('push-one-shot');
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  const authored = await saved(page, projectId);
  const source = authored.draft.document;
  expect(source.schemaVersion).toBe(3);
  expect(source.world.physicsProfile).toBe('rigid-body-2d-v1');
  expect(source.world.field.bodies).toHaveLength(2);
  const uno = source.circuit.components.find((part) => part.id === 'uno')!;
  expect(uno.stateProperties?.['arduinoCodeMode']).toBe('blocks');
  expect(String(uno.stateProperties?.['arduinoSource'])).toMatch(/delay\(800\)/);
  expect(String(uno.stateProperties?.['arduinoWorkspace'])).toContain('blocks');
  const ballId = source.world.field.balls[0]!.id;
  const canId = source.world.field.bodies!.find((body) => body.kind === 'can')!.id;
  const observePhysics = async () => {
    const attr = async (locator: Locator, name: string) => Number(await locator.getAttribute(name));
    const ball = page.locator(`#robotics-panel-field [data-ball-id="${ballId}"]`);
    const can = page.locator(`#robotics-panel-field [data-body-id="${canId}"]`);
    return {
      time: await attr(page.getByTestId('robotics-time'), 'data-microseconds'),
      leftRpm: await attr(page.getByTestId('robotics-left-rpm'), 'data-rpm'),
      rightRpm: await attr(page.getByTestId('robotics-right-rpm'), 'data-rpm'),
      robotX: await attr(page.getByTestId('robotics-robot'), 'data-x-meters'),
      ballX: await attr(ball, 'data-x-meters'),
      ballY: await attr(ball, 'data-y-meters'),
      ballVx: await attr(ball, 'data-velocity-x'),
      canX: await attr(can, 'data-x-meters'),
      canY: await attr(can, 'data-y-meters'),
      canVx: await attr(can, 'data-velocity-x'),
    };
  };
  const beforeRun = await observePhysics();
  await page.screenshot({ path: `${EVIDENCE}/field-v3-before-run-1440.png`, fullPage: true });
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await expect
    .poll(
      async () => {
        const observed = await observePhysics();
        return observed.leftRpm > 0 && observed.rightRpm > 0;
      },
      { timeout: 60_000, intervals: [25, 50, 100] },
    )
    .toBe(true);
  const driving = await observePhysics();
  await expect
    .poll(
      async () => {
        const observed = await observePhysics();
        return observed.time > 200_000 && observed.ballX > 0.835 && observed.canX > 1.005;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  const atContact = await observePhysics();
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
  const paused = await observePhysics();
  await page.screenshot({ path: `${EVIDENCE}/field-v3-after-contact-1440.png`, fullPage: true });
  // Sampling after real UI work verifies an acknowledged pause, with no synthetic clock advance.
  expect((await saved(page, projectId)).draft.document).toEqual(source);
  expect(await observePhysics()).toEqual(paused);
  await expect(
    page.getByTestId('robotics-field-palette').getByRole('button', { name: 'Банка', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  await expect.poll(async () => (await observePhysics()).time).toBe(0);
  const reset = await observePhysics();
  expect(reset.robotX).toBe(source.world.initialPose.xMeters);
  expect(reset.ballX).toBe(0.82);
  expect(reset.canX).toBe(0.99);
  expect(reset.ballVx).toBe(0);
  expect(reset.canVx).toBe(0);
  await openFieldSettings(page);
  await page
    .getByRole('combobox', { name: 'Режим физики', exact: true })
    .selectOption('educational');
  expect((await saved(page, projectId)).draft.document.world.physicsProfile).toBe(
    'kinematic-rover-bodies-v2',
  );
  await expect(page.getByTestId('robotics-physics-mode')).toHaveText('Учебный');
  await page.getByRole('combobox', { name: 'Режим физики', exact: true }).selectOption('dynamic');
  expect((await saved(page, projectId)).draft.document).toEqual(source);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const properties = page.getByRole('button', { name: 'Элементы поля', exact: true });
    if (await properties.isVisible()) {
      if ((await properties.getAttribute('aria-expanded')) !== 'true') await properties.click();
    }
    await noOverflow(page);
    for (const label of ['Мяч', 'Банка', 'Брусок', 'Кривая', 'Трасса'])
      await visibleControl(
        page,
        page
          .getByTestId('robotics-field-palette')
          .getByRole('button', { name: label, exact: true }),
      );
    await page.getByRole('button', { name: 'Приблизить поле', exact: true }).click();
    await expect(page.getByLabel('Масштаб поля', { exact: true })).toHaveText('125%');
    await page.getByRole('button', { name: 'Показать поле целиком', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Привязка', exact: true }).check();
    await page.screenshot({ path: `${EVIDENCE}/field-v3-tools-${width}.png`, fullPage: true });
    await selectFieldObject(page, `body:${canId}`);
    const name = page.getByRole('textbox', { name: 'Название предмета', exact: true });
    await name.scrollIntoViewIfNeeded();
    await expect(name).toHaveValue(longLabel);
    await noOverflow(page);
    await page.screenshot({ path: `${EVIDENCE}/field-v3-inspector-${width}.png`, fullPage: true });
    // Selecting a scene object closes the mobile catalog. Reopen settings
    // explicitly before editing field dimensions on a narrow screen.
    await openFieldSettings(page);
    const widthInput = page.getByRole('spinbutton', { name: 'Ширина поля', exact: true });
    await widthInput.fill('0.8');
    await widthInput.press('Tab');
    await expect(widthInput).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').first()).toBeVisible();
    await fieldErrorLeavesFocusUncovered(
      widthInput,
      page.getByRole('spinbutton', { name: 'Высота поля', exact: true }),
    );
    await noOverflow(page);
    await page.screenshot({
      path: `${EVIDENCE}/field-v3-invalid-shrink-${width}.png`,
      fullPage: true,
    });
    await widthInput.focus();
    await widthInput.press('Escape');
    if (await properties.isVisible()) {
      await expect(properties).toBeFocused();
      await expect(properties).toHaveAttribute('aria-expanded', 'false');
    }
    // The Select palette card was removed. Escape on the field canvas is
    // the supported way to return to selection mode without another edit.
    const fieldCanvas = page.getByRole('group', { name: 'Полотно поля' });
    await fieldCanvas.focus();
    await fieldCanvas.press('Escape');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[hidden], [inert]'))).toBe(
      false,
    );
  }
  expect((await saved(page, projectId)).draft.document).toEqual(source);

  try {
    const secondDevice = await browser.newContext({
      baseURL: origin(page),
      viewport: { width: 1440, height: 900 },
    });
    contexts.push(secondDevice);
    expect((await secondDevice.storageState()).origins).toEqual([]);
    const restored = await secondDevice.newPage();
    failures.push(
      collectBrowserFailures(restored, {
        allowAnonymousSessionProbe: true,
        allowAdminAccessProbe: true,
      }),
    );
    restored.on('dialog', (dialog) => {
      void dialog.accept();
    });
    await login(restored, credentials);
    await openPortalSection(restored, 'Проекты');
    await (
      await cardPreview(restored, title)
    )
      .getByRole('link', { name: title, exact: true })
      .click();
    await expect(restored.getByTestId('robotics-account-editor')).toBeVisible();
    expect((await readProject(restored, projectId)).draft.document).toEqual(source);
    await openFieldSettings(restored);
    await expect(restored.getByRole('combobox', { name: 'Режим физики', exact: true })).toHaveValue(
      'dynamic',
    );
    await expect(
      restored.getByRole('combobox', { name: 'Точность расчёта', exact: true }),
    ).toHaveValue('precise');
    await selectFieldObject(restored, `mark-group:${cross.groupId}`);
    await expect(
      restored.locator(
        `#robotics-panel-field [data-scene-key="mark-group:${cross.groupId}"].selected`,
      ),
    ).toHaveCount(2);
    await restored.getByRole('button', { name: 'Повернуть на 90°', exact: true }).click();
    const rotatedReopened = await saved(restored, projectId);
    expect(crossMembers(rotatedReopened.draft.document)).not.toEqual(crossMembers(source));
    for (const member of crossMembers(rotatedReopened.draft.document))
      expect(member.groupPivot).toEqual(cross.groupPivot);
    await restored.getByRole('button', { name: 'Отменить', exact: true }).click();
    expect((await saved(restored, projectId)).draft.document).toEqual(source);
    await restored.getByRole('button', { name: 'Дублировать предмет', exact: true }).click();
    const copiedReopened = await saved(restored, projectId);
    expect(copiedReopened.draft.document.world.field.floorMarks).toHaveLength(
      source.world.field.floorMarks.length + 2,
    );
    await restored.getByRole('button', { name: 'Отменить', exact: true }).click();
    expect((await saved(restored, projectId)).draft.document).toEqual(source);
    await roboticsHeaderAction(restored, 'Публикация', true);
    const dialog = restored.getByRole('dialog', { name: 'Публикация проекта', exact: true });
    await dialog
      .getByLabel('Описание проекта', { exact: true })
      .fill(
        'Поле из плиток 30 см, цельная трасса и столкновение мяча с металлической банкой от программы Arduino.',
      );
    await dialog.getByTestId('publication-publish').click();
    await expect(dialog.getByTestId('publication-status')).toContainText('Опубликовано');
    const status = await restored.request.get(`/api/projects/${projectId}/publication`);
    expect(status.status()).toBe(200);
    const publication = record(record(await status.json()).publication);
    const publicationId = responseString(publication.publicationId),
      revisionId = responseString(publication.revisionId);
    await dialog
      .locator('.project-properties-head')
      .getByRole('button', { name: 'Закрыть', exact: true })
      .click();
    const otherAccount = await browser.newContext({
      baseURL: origin(restored),
      viewport: { width: 1440, height: 900 },
    });
    contexts.push(otherAccount);
    const viewer = await otherAccount.newPage();
    failures.push(
      collectBrowserFailures(viewer, {
        allowAnonymousSessionProbe: true,
        allowAdminAccessProbe: true,
      }),
    );
    await register(viewer, 'Читатель физики поля');
    await portalTopBar(viewer).getByRole('link', { name: 'Проекты', exact: true }).click();
    await viewer
      .getByRole('group', { name: 'Среда проекта' })
      .getByRole('button', { name: 'Робототехника', exact: true })
      .click();
    await viewer.getByRole('searchbox', { name: 'Поиск по названию и описанию' }).fill(title);
    await viewer.getByRole('button', { name: 'Найти', exact: true }).click();
    await viewer
      .getByTestId('public-project-card')
      .filter({ hasText: title })
      .getByRole('link', { name: `Открыть проект «${title}»`, exact: true })
      .click();
    await expect(viewer.getByTestId('public-robotics-viewer')).toBeVisible();
    const artifactPath = `/api/public-projects/${publicationId}/artifact?revisionId=${revisionId}`;
    const publicResponse = await viewer.request.get(artifactPath);
    expect(publicResponse.status()).toBe(200);
    const artifact = (await publicResponse.json()).artifact as PublicRoboticsArtifactV6;
    expect(artifact.schemaVersion).toBe(6);
    expect(artifact.world.field).toMatchObject({
      widthMeters: 1.2,
      heightMeters: 1.8,
      gridMeters: 0.1,
      tiles: { enabled: true, sizeMeters: 0.3 },
      surface: 'wood',
    });
    expect(artifact.world.field.bodies).toHaveLength(2);
    expect(artifact.world.field.floorMarks).toEqual(
      source.world.field.floorMarks.map((mark) => {
        const geometry = { ...mark };
        delete geometry.groupId;
        delete geometry.groupPivot;
        return geometry;
      }),
    );
    expect(artifact.world.field.bodies.find((body) => body.id === canId)?.xMeters).toBe(0.99);
    expect(JSON.stringify(artifact)).not.toMatch(
      /physics|massKg|Coefficient|restitution|groupId|groupPivot|arduino|bindings|circuit|atMicroseconds|robotVelocity/,
    );
    expect((await viewer.request.get(`/api/projects/${projectId}`)).status()).toBe(404);
    for (const width of WIDTHS) {
      await viewer.setViewportSize({ width, height: 900 });
      await noOverflow(viewer);
      await expect(viewer.getByTestId('public-robotics-tiles')).toBeVisible();
      await expect(
        viewer.locator('[data-testid="public-robotics-field"] [data-body-id]'),
      ).toHaveCount(2);
      await expect(
        viewer.locator('[data-testid="public-robotics-field"] [data-object-kind="curve"]'),
      ).toHaveCount(2);
      await expect(viewer.getByTestId('public-robotics-field')).toHaveAttribute(
        'data-editable',
        'false',
      );
      await expect(
        viewer.locator('[data-testid="public-robotics-field"] [data-velocity-x]'),
      ).toHaveCount(0);
      await viewer.screenshot({ path: `${EVIDENCE}/field-v6-public-${width}.png`, fullPage: true });
    }
    await numberField(restored, 'Шаг сетки', 0.05);
    const privateEdit = await saved(restored, projectId);
    expect(privateEdit.draft.document.world.field.gridMeters).toBe(0.05);
    await viewer.reload();
    await expect(viewer.getByTestId('public-robotics-viewer')).toBeVisible();
    expect((await (await viewer.request.get(artifactPath)).json()).artifact).toEqual(artifact);
    for (const failure of failures) failure.assertEmpty();
    writeFileSync(
      `${EVIDENCE}/field-v3-lifecycle.json`,
      JSON.stringify(
        {
          projectId,
          sourceSchema: 3,
          publicSchema: 6,
          publicationId,
          revisionId,
          sourceDigest: digest(source),
          artifactDigest: digest(artifact),
          beforeRun,
          driving,
          atContact,
          paused,
          reset,
          persistedGroupId: cross.groupId,
          wholeGroupAfterReopen: true,
          freshBrowserContextRestored: true,
          secondAccountPrivateAccess: 404,
          viewportWidths: WIDTHS,
        },
        null,
        2,
      ),
    );
  } finally {
    for (const context of contexts) await context.close();
  }
});
