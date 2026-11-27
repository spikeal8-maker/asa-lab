import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { PublicRoboticsArtifactV6 } from '../packages/contracts/src/public-robotics-artifact-v6';
import type { Project, ProjectDraft } from '../contexts/projects/domain/project';
import type { RoboticsProject } from '../contexts/robotics/domain/document';
import { createRoboticsBall } from '../contexts/robotics/domain/world-document';
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

/** Compare actual CSS bar endpoints to the captured real orthographic render inputs.
 * Neither the label nor a self-reported pixels/metre value is a projection oracle.
 */
async function sideRuler(page: Page) {
  const ruler = page.getByTestId('robotics-side-scale');
  await expect(ruler).toBeVisible(); // WebGL fallback is deliberately not a PASS.
  const read = () =>
    ruler.evaluate((element) => {
      const bar = element.querySelector<HTMLElement>('.robotics-side-scale-bar');
      const canvas = element.parentElement?.querySelector('canvas');
      const toolbar = document.querySelector<HTMLElement>(
        '#robotics-panel-field .robotics-field-toolbar',
      );
      if (!bar || !canvas || !toolbar)
        throw new Error('Side ruler lost its real canvas/bar/toolbar');
      if (
        canvas.dataset.rendered !== 'true' ||
        element.parentElement?.getAttribute('data-renderer') !== 'webgl'
      )
        throw new Error('Side ruler has no actual WebGL render');
      const projection: number[] = JSON.parse(element.getAttribute('data-projection') ?? 'null');
      if (projection?.length !== 7 || !projection.every(Number.isFinite))
        throw new Error('Missing actual orthographic render inputs');
      const [left, right, top, bottom, zoom, width, height] = projection as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const label = element.textContent?.trim() ?? '';
      const match = /^([\d.,]+)\s*(мм|см|м)$/.exec(label);
      if (!match) throw new Error('Unreadable metric label: ' + label);
      const meters =
        Number(match[1]!.replace(',', '.')) /
        (match[2] === 'мм' ? 1000 : match[2] === 'см' ? 100 : 1);
      const viewport = canvas.getBoundingClientRect();
      const pixels = bar.getBoundingClientRect().width;
      const horizontal = (meters * zoom * width) / (right - left);
      const vertical = (meters * zoom * height) / (top - bottom);
      const error = Math.max(
        Math.abs(pixels - horizontal),
        Math.abs(pixels - vertical),
        Math.abs(width - viewport.width),
        Math.abs(height - viewport.height),
      );
      return {
        meters,
        pixels,
        label,
        error,
        zoom,
        pixelsPerMeter: (zoom * width) / (right - left),
        viewport: viewport.toJSON(),
        bounds: element.getBoundingClientRect().toJSON(),
        toolbar: toolbar.getBoundingClientRect().toJSON(),
        toolbarCount: document.querySelectorAll('#robotics-panel-field .robotics-field-toolbar')
          .length,
      };
    });
  await expect.poll(async () => (await read()).error).toBeLessThanOrEqual(1);
  const measurement = await read();
  expect(measurement.meters).toBeGreaterThan(0);
  expect(measurement.pixels).toBeGreaterThan(0);
  expect(measurement.bounds.left).toBeGreaterThanOrEqual(measurement.viewport.left);
  expect(measurement.bounds.right).toBeLessThanOrEqual(measurement.viewport.right);
  expect(measurement.bounds.top).toBeGreaterThanOrEqual(measurement.viewport.top);
  expect(measurement.bounds.bottom).toBeLessThanOrEqual(measurement.viewport.bottom);
  expect(measurement.toolbarCount).toBe(1);
  expect(measurement.toolbar.width).toBeGreaterThan(0);
  expect(measurement.toolbar.height).toBeGreaterThan(0);
  expect(measurement.toolbar.bottom).toBeLessThanOrEqual(measurement.viewport.top + 1);
  await expect(ruler).toHaveAccessibleName('Масштаб бокового вида: ' + measurement.label);
  await expect(ruler).toHaveCSS('pointer-events', 'none');
  await expect(ruler).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(ruler).toHaveCSS('border-width', '0px');
  await expect(ruler).toHaveCSS('border-radius', '0px');
  await expect(ruler).toHaveCSS('box-shadow', 'none');
  return measurement;
}

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

/** Restore access to the existing dock on narrow screens before switching modes.
 * This is test navigation only; do not bypass a hidden or broken user control.
 */
async function ensureFieldDockVisible(page: Page): Promise<void> {
  const dock = page.locator('#robotics-field-catalog');
  const visibleInViewport = await dock.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < innerWidth &&
      rect.top < innerHeight &&
      style.display !== 'none' &&
      style.visibility !== 'hidden'
    );
  });
  if (visibleInViewport) return;
  const toggle = page.locator('.robotics-field-toolbar .robotics-field-catalog-toggle');
  await expect(toggle).toBeVisible();
  // A panel left expanded outside the current narrow viewport must be closed
  // through the real control before reopening at the new viewport geometry.
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
  await toggle.click();
  await expect(dock).toBeInViewport();
}

async function openFieldSettings(page: Page): Promise<void> {
  // The profile menu remains open after invoking Publication. Close the actual
  // native details before interacting with the right-hand field dock underneath.
  const profileMenu = page.locator('.robotics-unified-header .robotics-header-profile');
  if ((await profileMenu.count()) && (await profileMenu.getAttribute('open')) !== null) {
    await profileMenu.locator(':scope > summary').click();
    await expect(profileMenu).not.toHaveAttribute('open', '');
  }
  const toggle = page.getByRole('button', { name: 'Элементы поля', exact: true });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  await ensureFieldDockVisible(page);
  const fieldTab = page
    .locator('#robotics-field-catalog')
    .getByRole('tab', { name: 'Настройки поля', exact: true });
  if ((await fieldTab.count()) && (await fieldTab.getAttribute('aria-selected')) !== 'true')
    await fieldTab.click();
  const settings = page.locator('.robotics-field-settings-sheet');
  if ((await settings.isVisible()) && (await settings.getAttribute('open')) === null)
    await settings.locator(':scope > summary').click();
}

/** Switch the E4 dock to its object catalogue before selecting a new tool.
 * The old test assumed palette and selected properties were visible together;
 * do not weaken any test, timer, world assertion or publication gate.
 */
async function showObjectCatalog(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Элементы поля', exact: true });
  if ((await toggle.isVisible()) && (await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click();
  await ensureFieldDockVisible(page);
  const tab = page
    .locator('#robotics-field-catalog')
    .getByRole('tab', { name: 'Объекты', exact: true });
  await tab.click();
  await expect(page.getByTestId('robotics-field-palette')).toBeVisible();
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

const FIELD_PRIMARY_BUTTONS = [
  'Сверху',
  'Перспектива',
  'Сбоку',
  'Отдалить поле',
  'Приблизить поле',
] as const;
type FieldPrimaryButton = (typeof FIELD_PRIMARY_BUTTONS)[number];

const fieldToolbar = (page: Page) =>
  page.getByRole('toolbar', { name: 'Инструменты поля', exact: true });
const fieldPrimaryButton = (page: Page, name: FieldPrimaryButton) =>
  fieldToolbar(page).getByRole('button', { name, exact: true });
const fieldScale = (page: Page) => fieldToolbar(page).getByLabel('Масштаб поля', { exact: true });

async function measurePrimaryControl(control: Locator, hitTest: boolean, minimum: number) {
  await expect(control).toHaveCount(1);
  const measurement = await control.evaluate((element, hitTest) => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    const hit = document.elementFromPoint(x, y);
    const containedBy = (area: DOMRect, axis: 'x' | 'y') =>
      axis === 'x'
        ? bounds.left >= area.left && bounds.right <= area.right + 1
        : bounds.top >= area.top && bounds.bottom <= area.bottom + 1;
    let unclipped =
      bounds.left >= 0 &&
      bounds.top >= 0 &&
      bounds.right <= innerWidth + 1 &&
      bounds.bottom <= innerHeight + 1;
    for (let parent = element.parentElement; parent && unclipped; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const area = parent.getBoundingClientRect();
      if (style.overflowX !== 'visible') unclipped = containedBy(area, 'x');
      if (style.overflowY !== 'visible') unclipped &&= containedBy(area, 'y');
    }
    return {
      bounds: bounds.toJSON(),
      center: { x, y },
      unclipped,
      hittable: !hitTest || (hit !== null && element.contains(hit)),
    };
  }, hitTest);
  expect(measurement.unclipped).toBe(true);
  expect(measurement.hittable).toBe(true);
  expect(measurement.bounds.width).toBeGreaterThanOrEqual(minimum);
  expect(measurement.bounds.height).toBeGreaterThanOrEqual(minimum);
  return measurement;
}

/** Client bounds and hit-testing do not scroll a previously offscreen control into view. */
async function measurePrimaryFieldControls(page: Page) {
  const width = page.viewportSize()!.width;
  await expect(fieldToolbar(page)).toHaveCount(1);
  await noOverflow(page);
  const buttons = [];
  for (const name of FIELD_PRIMARY_BUTTONS) {
    buttons.push({
      name,
      ...(await measurePrimaryControl(
        fieldPrimaryButton(page, name),
        true,
        width === 320 ? 44 : 1,
      )),
    });
  }
  await expect(fieldScale(page)).toHaveText(/^\d+%$/);
  const scale = await measurePrimaryControl(fieldScale(page), false, 1);
  if (width === 320) {
    const centersY = [...buttons.map(({ center }) => center.y), scale.center.y];
    expect(Math.max(...centersY) - Math.min(...centersY)).toBeLessThanOrEqual(2);
  }
  return { width, buttons, scale };
}

async function clickPrimaryFieldControl(page: Page, name: FieldPrimaryButton) {
  const control = fieldPrimaryButton(page, name);
  await expect(control).toBeEnabled();
  const { center } = await measurePrimaryControl(control, true, 1);
  await page.mouse.click(center.x, center.y);
}

async function roundTripFieldZoom(page: Page, renderAttribute: 'data-camera' | 'data-projection') {
  const canvas = page.getByTestId('robotics-field-spatial').locator('canvas');
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const readZoom = async () => Number((await fieldScale(page).textContent())?.replace('%', ''));
  const before = await readZoom();
  const initialRender = await canvas.getAttribute(renderAttribute);
  expect(initialRender).not.toBeNull();
  await clickPrimaryFieldControl(page, 'Приблизить поле');
  await expect.poll(readZoom).toBeGreaterThan(before);
  await expect(canvas).not.toHaveAttribute(renderAttribute, initialRender!);
  const increased = await readZoom();
  const zoomedRender = await canvas.getAttribute(renderAttribute);
  await clickPrimaryFieldControl(page, 'Отдалить поле');
  await expect.poll(readZoom).toBeLessThan(increased);
  await expect(canvas).not.toHaveAttribute(renderAttribute, zoomedRender!);
  return { before, increased, decreased: await readZoom() };
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

test('FIELD-EDIT-GESTURES UI_ONLY drags one Top candidate and moves the same saved object in Perspective', async ({
  page,
}) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE, { recursive: true });
  const failures = collectBrowserFailures(page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await register(page, 'Автор проверки перемещения поля');
  await page.locator('.portal-header .portal-quick-create > summary').click();
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/projects' && r.request().method() === 'POST',
  );
  await page
    .locator('.portal-header .portal-create-options')
    .getByRole('button', { name: /^Робототехника/ })
    .click();
  const created = await response;
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible();
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  const initial = await saved(page, projectId);
  await showObjectCatalog(page);
  const paletteBall = page
    .getByTestId('robotics-field-palette')
    .getByRole('button', { name: 'Мяч', exact: true });
  const card = await paletteBall.boundingBox();
  const svg = page.getByTestId('robotics-field');
  await expect(page.getByLabel('Масштаб поля', { exact: true })).toHaveText('100%');
  await expect(svg).toHaveAttribute('data-render-layer', 'interaction');
  await expect(page.getByTestId('robotics-field-spatial').locator('canvas')).toHaveAttribute(
    'data-rendered',
    'true',
  );
  await expect(page.getByRole('checkbox', { name: 'Привязка', exact: true })).not.toBeChecked();
  await page.screenshot({ path: `${EVIDENCE}/field-visual-default100-1440.png`, fullPage: true });
  const radiusMeters = createRoboticsBall('drop-probe', { xMeters: 0, yMeters: 0 }).radiusMeters;
  const drop = await svg.evaluate(
    (element, { world, radiusMeters }) => {
      if (!(element instanceof SVGSVGElement)) throw new Error('Actual Top SVG missing');
      const matrix = element.getScreenCTM();
      // Chromium can return SVGMatrix: its public affine a–f/inverse API has no is2D.
      const determinant = matrix ? matrix.a * matrix.d - matrix.b * matrix.c : NaN;
      if (
        !matrix ||
        !Number.isFinite(determinant) ||
        determinant === 0 ||
        ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite) ||
        matrix.a <= 0 ||
        matrix.d <= 0
      )
        throw new Error('Actual affine Top projection missing');
      const area = element.getBoundingClientRect();
      if (!(area.width > 0 && area.height > 0)) throw new Error('Actual Top viewport missing');
      const inverse = matrix.inverse();
      const clearance = radiusMeters + 0.03;
      const free = (xMeters: number, yMeters: number) => {
        if (![xMeters, yMeters].every(Number.isFinite)) return false;
        if (
          xMeters <= clearance ||
          yMeters <= clearance ||
          xMeters >= world.field.widthMeters - clearance ||
          yMeters >= world.field.heightMeters - clearance
        )
          return false;
        const robotRadius = Math.max(
          Math.hypot(world.robot.bodyLengthMeters, world.robot.bodyWidthMeters) / 2,
          world.robot.wheelTrackMeters / 2 + world.robot.wheelWidthMeters,
          Math.abs(world.robot.sensorForwardMeters) + 0.05,
        );
        if (
          Math.hypot(xMeters - world.initialPose.xMeters, yMeters - world.initialPose.yMeters) <=
          robotRadius + clearance
        )
          return false;
        if (
          world.field.balls.some(
            (ball) =>
              Math.hypot(xMeters - ball.xMeters, yMeters - ball.yMeters) <=
              ball.radiusMeters + clearance,
          )
        )
          return false;
        if (
          (world.field.bodies ?? []).some(
            (body) =>
              Math.hypot(xMeters - body.xMeters, yMeters - body.yMeters) <=
              (body.kind === 'can'
                ? body.radiusMeters
                : Math.hypot(body.widthMeters, body.depthMeters) / 2) +
                clearance,
          )
        )
          return false;
        return !world.field.obstacles.some(
          (wall) =>
            Math.hypot(
              xMeters - wall.xMeters - wall.widthMeters / 2,
              yMeters - wall.yMeters - wall.heightMeters / 2,
            ) <=
            Math.hypot(wall.widthMeters, wall.heightMeters) / 2 + clearance,
        );
      };
      for (const fy of [0.3, 0.45, 0.6, 0.75])
        for (const fx of [0.3, 0.45, 0.6, 0.75]) {
          const x = Math.round(area.left + area.width * fx),
            y = Math.round(area.top + area.height * fy);
          // Native HTML DnD uses integer CSS coordinates. Include the final +1 move
          // and enough screen-space room for the complete real candidate footprint.
          const inset = radiusMeters * matrix.a * 1000 + 12;
          if (
            x - inset <= area.left ||
            x + inset + 1 >= area.right ||
            y - inset <= area.top ||
            y + inset + 1 >= area.bottom
          )
            continue;
          let final: { xMeters: number; yMeters: number } | null = null;
          let accessible = true;
          for (const delta of [0, 1]) {
            const hit = document.elementFromPoint(x + delta, y + delta);
            if (!hit || !element.contains(hit) || hit.closest('[data-scene-key]')) {
              accessible = false;
              break;
            }
            const ground = new DOMPoint(x + delta, y + delta).matrixTransform(inverse);
            const point = {
              xMeters: Math.round(ground.x * 10) / 10000,
              yMeters: Math.round((world.field.heightMeters * 1000 - ground.y) * 10) / 10000,
            };
            if (!free(point.xMeters, point.yMeters)) {
              accessible = false;
              break;
            }
            final = point;
          }
          if (accessible && final)
            return {
              x,
              y,
              final,
              viewport: area.toJSON(),
              matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
            };
        }
      throw new Error('No accessible free ground point in the actual default100% viewport');
    },
    { world: initial.draft.document.world, radiusMeters },
  );
  if (!card) throw new Error('Palette card is not visible');
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2);
  await page.mouse.down();
  await page.mouse.move(card.x - 12, card.y + card.height / 2, { steps: 4 });
  await page.mouse.move(drop.x, drop.y, { steps: 12 });
  await page.mouse.move(drop.x + 1, drop.y + 1);
  const ghost = svg.locator('[data-field-ghost]');
  await expect(ghost).toHaveCount(1);
  const ghostKey = await ghost.getAttribute('data-scene-key');
  expect(ghostKey).toMatch(/^ball:/);
  await expect(ghost).toHaveAttribute('data-field-ghost', 'valid');
  expect(Number(await ghost.getAttribute('data-x-meters'))).toBeCloseTo(drop.final.xMeters, 8);
  expect(Number(await ghost.getAttribute('data-y-meters'))).toBeCloseTo(drop.final.yMeters, 8);
  expect((await readProject(page, projectId)).draft.document).toEqual(initial.draft.document);
  await page.screenshot({ path: `${EVIDENCE}/field-edit-top-candidate-1440.png`, fullPage: true });
  await page.mouse.up();
  await expect(ghost).toHaveCount(0);
  let committed = await saved(page, projectId);
  expect(committed.draft.document.world.field.balls).toHaveLength(
    initial.draft.document.world.field.balls.length + 1,
  );
  const id = ghostKey!.slice('ball:'.length);
  const placed = committed.draft.document.world.field.balls.find((ball) => ball.id === id);
  expect(placed).toBeDefined();
  expect(placed!.xMeters).toBeCloseTo(drop.final.xMeters, 8);
  expect(placed!.yMeters).toBeCloseTo(drop.final.yMeters, 8);
  expect(placed!.radiusMeters).toBe(radiusMeters);
  // Observe after the actual renderer RAF, including the final coalesced pointer event.
  const rendered = (canvas: Locator) =>
    canvas.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  // The desktop dock becomes an overlay at the compact breakpoint. Close it
  // through its real user control before navigating to the camera underneath.
  const closeFieldOverlay = async () => {
    const close = page.getByRole('button', { name: 'Закрыть панель поля', exact: true });
    if (await close.isVisible()) {
      await close.click();
      await expect(
        page.locator('.robotics-field-toolbar .robotics-field-catalog-toggle'),
      ).toHaveAttribute('aria-expanded', 'false');
    }
  };
  const observations: unknown[] = [];
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await closeFieldOverlay();
    await page.getByRole('button', { name: 'Сверху', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Привязка', exact: true }).check();
    await expect(page.getByRole('checkbox', { name: 'Привязка', exact: true })).toBeChecked();
    await selectFieldObject(page, 'ball:' + id);
    const close = page.getByRole('button', { name: 'Закрыть параметры объекта' });
    if (await close.isVisible()) await close.click();
    await closeFieldOverlay();
    await page.getByRole('button', { name: 'Перспектива', exact: true }).click();
    const canvas = page.getByTestId('robotics-field-spatial').locator('canvas');
    await expect(canvas).toBeVisible();
    await expect(page.locator('.robotics-spatial-notice')).toHaveCount(0);
    if (width === 1440) {
      await rendered(canvas);
      await expect(page.getByLabel('Масштаб поля', { exact: true })).toHaveText('100%');
      await page.screenshot({
        path: `${EVIDENCE}/field-visual-perspective-default100-1440.png`,
        fullPage: true,
      });
    }
    await page.getByRole('button', { name: 'К выделенному', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-camera', /./);
    await rendered(canvas);
    const camera = await canvas.getAttribute('data-camera');
    const clock = await page.getByTestId('robotics-time').getAttribute('data-microseconds');
    const rect = await canvas.boundingBox();
    if (!rect) throw new Error('Actual Perspective canvas missing');
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    const source = committed.draft.document;
    const ball = source.world.field.balls.find((item) => item.id === id)!;
    // Focus aims the actual camera at the selected ball. Hit-test and pointer capture
    // run normally; no DOM pose injection, network route, or renderer fallback.
    await page.mouse.move(x + 3, y - 3);
    await page.mouse.down();
    await page.mouse.move(x + 47, y - 16, { steps: 8 });
    await expect(canvas).toHaveAttribute('data-edit-preview', /"key":"ball:/);
    await rendered(canvas);
    const delta = JSON.parse((await canvas.getAttribute('data-edit-preview'))!) as {
      dxMeters: number;
      dyMeters: number;
    };
    expect(await canvas.getAttribute('data-camera')).toBe(camera);
    expect((await readProject(page, projectId)).draft.document).toEqual(source);
    await page.screenshot({
      path: `${EVIDENCE}/field-edit-perspective-draft-${width}.png`,
      fullPage: true,
    });
    await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-edit-preview', 'null');
    committed = await saved(page, projectId);
    const moved = committed.draft.document.world.field.balls.find((item) => item.id === id)!;
    expect(moved).not.toEqual(ball);
    expect(moved.xMeters).toBeCloseTo(ball.xMeters + delta.dxMeters, 8);
    expect(moved.yMeters).toBeCloseTo(ball.yMeters + delta.dyMeters, 8);
    expect(moved.id).toBe(ball.id);
    expect(moved.radiusMeters).toBe(ball.radiusMeters);
    const grid = source.world.field.gridMeters;
    expect(moved.xMeters / grid).toBeCloseTo(Math.round(moved.xMeters / grid), 8);
    expect(moved.yMeters / grid).toBeCloseTo(Math.round(moved.yMeters / grid), 8);
    expect(committed.draft.document.world).toEqual({
      ...source.world,
      field: {
        ...source.world.field,
        balls: source.world.field.balls.map((item) => (item.id === id ? moved : item)),
      },
    });
    expect(committed.draft.document.circuit).toEqual(source.circuit);
    expect(await page.getByTestId('robotics-time').getAttribute('data-microseconds')).toBe(clock);
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    expect((await saved(page, projectId)).draft.document).toEqual(source);
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    expect((await saved(page, projectId)).draft.document).toEqual(committed.draft.document);
    // Empty space keeps the real camera's native orbit gesture and never changes source.
    const emptyCamera = await canvas.getAttribute('data-camera');
    await page.mouse.move(rect.x + 8, rect.y + 8);
    await page.mouse.down();
    await page.mouse.move(rect.x + 34, rect.y + 20, { steps: 8 });
    await page.mouse.up();
    await expect(canvas).not.toHaveAttribute('data-camera', emptyCamera!);
    await expect(canvas).toHaveAttribute('data-edit-preview', 'null');
    expect((await readProject(page, projectId)).draft.document).toEqual(committed.draft.document);
    // An actual captured drag cancelled with Escape must not create a history entry.
    await page.getByRole('button', { name: 'К выделенному', exact: true }).click();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 44, y - 13, { steps: 8 });
    await expect(canvas).toHaveAttribute('data-edit-preview', /"key":"ball:/);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-edit-preview', 'null');
    expect((await saved(page, projectId)).draft.document).toEqual(committed.draft.document);
    // Captured pointer outside the actual viewport is rejected, not clamped into a commit.
    await page.getByRole('button', { name: 'К выделенному', exact: true }).click();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(rect.x - 10, rect.y + rect.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-edit-preview', 'null');
    expect((await saved(page, projectId)).draft.document).toEqual(committed.draft.document);
    observations.push({
      width,
      id,
      from: ball,
      to: moved,
      camera,
      clock,
      document: digest(committed.draft.document),
    });
    await page.screenshot({
      path: `${EVIDENCE}/field-edit-perspective-${width}.png`,
      fullPage: true,
    });
  }
  const url = page.url();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible();
  expect((await readProject(page, projectId)).draft.document).toEqual(committed.draft.document);
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  await closeFieldOverlay();
  await page.getByRole('button', { name: 'Сверху', exact: true }).click();
  await selectFieldObject(page, 'ball:' + id);
  const inspector = page.getByRole('button', { name: 'Закрыть параметры объекта' });
  if (await inspector.isVisible()) await inspector.click();
  await closeFieldOverlay();
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await expect
    .poll(async () =>
      Number(await page.getByTestId('robotics-time').getAttribute('data-microseconds')),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Перспектива', exact: true }).click();
  const paused = await page.getByTestId('robotics-time').getAttribute('data-microseconds');
  const canvas = page.getByTestId('robotics-field-spatial').locator('canvas');
  await page.getByRole('button', { name: 'К выделенному', exact: true }).click();
  const lockedRect = await canvas.boundingBox();
  if (!lockedRect) throw new Error('Paused actual canvas missing');
  await page.mouse.move(lockedRect.x + lockedRect.width / 2, lockedRect.y + lockedRect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    lockedRect.x + lockedRect.width / 2 + 35,
    lockedRect.y + lockedRect.height / 2 - 10,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-edit-preview', 'null');
  await page.getByRole('button', { name: 'Сбоку', exact: true }).click();
  await sideRuler(page);
  await canvas.focus();
  await canvas.press('ArrowRight');
  expect(await page.getByTestId('robotics-time').getAttribute('data-microseconds')).toBe(paused);
  expect((await saved(page, projectId)).draft.document).toEqual(committed.draft.document);
  writeFileSync(
    `${EVIDENCE}/field-edit-gestures.json`,
    JSON.stringify(
      { projectId, drop, placed, observations, paused, source: digest(committed.draft.document) },
      null,
      2,
    ),
  );
  failures.assertEmpty();
});

test('SIDE-SCALE UI_ONLY calibrates the real side camera without changing the saved world or paused clock', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE, { recursive: true });
  await register(page, 'Автор проверки масштаба поля');
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
  const before = await saved(page, projectId);
  const sourceDigest = digest(before.draft.document);
  const url = page.url();
  const baseURL = origin(page);
  const storageState = await page.context().storageState();
  const measurements: unknown[] = [];
  const topMeasurements: unknown[] = [];
  const toolbarMeasurements: unknown[] = [];

  for (const dpr of [1, 2]) {
    const context = await browser.newContext({
      baseURL,
      storageState,
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: dpr,
    });
    try {
      const target = await context.newPage();
      const failures = collectBrowserFailures(target, {
        allowAnonymousSessionProbe: true,
        allowAdminAccessProbe: true,
      });
      await target.goto(url, { waitUntil: 'domcontentloaded' });
      await expect(target.getByTestId('robotics-account-editor')).toBeVisible();
      await target.getByRole('tab', { name: 'Поле', exact: true }).click();
      await expect(target.getByLabel('Масштаб поля', { exact: true })).toHaveText('100%');
      await expect(target.getByTestId('robotics-field-spatial').locator('canvas')).toHaveAttribute(
        'data-rendered',
        'true',
      );
      await expect(target.getByTestId('robotics-field')).toHaveAttribute(
        'data-render-layer',
        'interaction',
      );
      await target.getByRole('button', { name: 'Запустить', exact: true }).click();
      await expect
        .poll(
          async () =>
            Number(await target.getByTestId('robotics-time').getAttribute('data-microseconds')),
          { timeout: 60_000 },
        )
        .toBeGreaterThan(200_000);
      await target.getByRole('button', { name: 'Пауза', exact: true }).click();
      await expect(target.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
      await measurePrimaryFieldControls(target);
      await clickPrimaryFieldControl(target, 'Сбоку');
      const spatial = target.getByTestId('robotics-field-spatial');
      const sideCanvas = spatial.locator('canvas');
      const snapshot = () =>
        spatial.evaluate((element) =>
          [
            'data-microseconds',
            'data-physics-microseconds',
            'data-x-meters',
            'data-y-meters',
            'data-heading-radians',
          ].map((name) => element.getAttribute(name)),
        );
      await sideRuler(target);
      const paused = await snapshot();
      expect(Number(paused[0])).toBeGreaterThan(200_000);
      const revision = (await readProject(target, projectId)).draft.revision;

      for (const width of [1440, 320]) {
        const cameraBeforeResize = await sideCanvas.getAttribute('data-camera');
        const zoomBeforeResize = (await sideRuler(target)).zoom;
        await expect(fieldPrimaryButton(target, 'Сбоку')).toBeFocused();
        await target.setViewportSize({ width, height: 900 });
        const primary = await measurePrimaryFieldControls(target);
        await expect(spatial).toHaveAttribute('data-field-view', 'side');
        await expect(fieldPrimaryButton(target, 'Сбоку')).toBeFocused();
        const resized = await sideRuler(target);
        expect(resized.zoom).toBe(zoomBeforeResize);
        expect(await sideCanvas.getAttribute('data-camera')).toBe(cameraBeforeResize);
        expect(await snapshot()).toEqual(paused);
        const closeDock = target.getByRole('button', { name: 'Закрыть панель поля', exact: true });
        if (await closeDock.isVisible()) await closeDock.click();
        await target.getByRole('button', { name: 'Показать поле целиком', exact: true }).click();
        await expect.poll(async () => (await sideRuler(target)).zoom).toBe(1);
        const fitted = await sideRuler(target);
        expect(fitted.zoom).toBe(1);
        // Independent known-field projection at Fit, not a scale helper result.
        const verticalSpan =
          Math.max(
            1.25,
            before.draft.document.world.field.widthMeters /
              (fitted.viewport.width / fitted.viewport.height),
          ) * 1.22;
        expect(fitted.pixelsPerMeter).toBeCloseTo(fitted.viewport.height / verticalSpan, 8);
        await clickPrimaryFieldControl(target, 'Приблизить поле');
        await expect.poll(async () => (await sideRuler(target)).zoom).toBe(1.25);
        const zoomed = await sideRuler(target);
        expect(zoomed.pixelsPerMeter / fitted.pixelsPerMeter).toBeCloseTo(1.25, 8);
        await clickPrimaryFieldControl(target, 'Отдалить поле');
        await expect.poll(async () => (await sideRuler(target)).zoom).toBe(1);
        expect((await sideRuler(target)).pixelsPerMeter).toBeCloseTo(fitted.pixelsPerMeter, 8);
        await clickPrimaryFieldControl(target, 'Приблизить поле');
        await expect.poll(async () => (await sideRuler(target)).zoom).toBe(1.25);
        const canvas = target
          .getByRole('img', { name: 'Масштаб бокового вида: ' + zoomed.label })
          .locator('..')
          .locator('canvas');
        await canvas.focus();
        await canvas.press('ArrowRight');
        expect((await sideRuler(target)).pixelsPerMeter).toBeCloseTo(zoomed.pixelsPerMeter, 8);
        await canvas.press('Home');
        await expect.poll(async () => (await sideRuler(target)).zoom).toBe(1);
        await target.getByRole('button', { name: 'К роботу', exact: true }).click();
        await expect.poll(async () => (await sideRuler(target)).zoom).toBeGreaterThan(1);
        const focused = await sideRuler(target);
        expect(focused.zoom).toBeGreaterThan(1);
        expect(await snapshot()).toEqual(paused);
        expect(await target.getByTestId('robotics-time').getAttribute('data-microseconds')).toBe(
          paused[0],
        );
        await spatial.screenshot({ path: `${EVIDENCE}/side-scale-${width}-dpr${dpr}.png` });
        measurements.push({ width, dpr, fitted, zoomed, focused, paused });
        // Same actual WebGL scene above its authoritative SVG ground transform.
        await clickPrimaryFieldControl(target, 'Сверху');
        await expect(spatial).toHaveAttribute('data-field-view', 'top');
        await expect(target.getByTestId('robotics-field')).toHaveAttribute(
          'data-render-layer',
          'interaction',
        );
        await expect(target.getByTestId('robotics-field-fallback')).toHaveCount(0);
        await expect(target.locator('.robotics-field-toolbar')).toHaveCount(1);
        await expect(
          target.locator('.robotics-spatial-controls, .robotics-field-stage-toolbar'),
        ).toHaveCount(0);
        const topCanvas = spatial.locator('canvas');
        await expect(topCanvas).toHaveAttribute('data-rendered', 'true');
        await expect(target.getByTestId('robotics-top-scale')).toBeVisible();
        // Let both layout ResizeObserver and the actual on-demand renderer commit.
        await topCanvas.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const top = await target.getByTestId('robotics-field').evaluate((svg, fieldHeight) => {
          if (!(svg instanceof SVGSVGElement)) throw new Error('Missing real edit overlay');
          const matrix = svg.getScreenCTM();
          const canvas = document.querySelector<HTMLCanvasElement>(
            '#robotics-panel-field .robotics-field-spatial canvas',
          );
          const ruler = document.querySelector<HTMLElement>('[data-testid="robotics-top-scale"]');
          if (!matrix || !canvas || !ruler) throw new Error('Missing real camera/ruler');
          const projection: number[] = JSON.parse(canvas.dataset.projection!);
          const [position, quaternion]: number[][] = JSON.parse(canvas.dataset.camera!);
          if (!projection || projection.length !== 16 || !position || !quaternion)
            throw new Error('Missing rendered camera readback');
          const area = canvas.getBoundingClientRect();
          const errors = [
            [0, 0],
            [0.8, 1.2],
            [2.5, fieldHeight],
          ].map(([x, y]) => {
            const expected = new DOMPoint(x! * 1000, (fieldHeight - y!) * 1000).matrixTransform(
              matrix,
            );
            const nx = projection[0]! * (x! - position[0]!) + projection[12]!;
            const ny = projection[5]! * (y! - position[1]!) + projection[13]!;
            return Math.hypot(
              expected.x - (area.x + ((1 + nx) * area.width) / 2),
              expected.y - (area.y + ((1 - ny) * area.height) / 2),
            );
          });
          const meters = Number(ruler.dataset.meters);
          const bar = ruler
            .querySelector<HTMLElement>('.robotics-side-scale-bar')!
            .getBoundingClientRect();
          return {
            errors,
            quaternion,
            meters,
            cssPixels: bar.width,
            expectedPixels: meters * matrix.a * 1000,
            canvasCount: document.querySelectorAll(
              '#robotics-panel-field .robotics-field-spatial canvas',
            ).length,
          };
        }, before.draft.document.world.field.heightMeters);
        expect(top.canvasCount).toBe(1);
        expect(Math.max(...top.errors)).toBeLessThan(0.05);
        expect(top.quaternion).toEqual([0, 0, 0, 1]);
        expect(Math.abs(top.cssPixels - top.expectedPixels)).toBeLessThan(0.05);
        const grid = target.getByRole('checkbox', { name: 'Сетка', exact: true });
        await grid.uncheck();
        await expect(topCanvas).toHaveAttribute('data-grid-rendered', 'false');
        await grid.check();
        await expect(topCanvas).toHaveAttribute('data-grid-rendered', 'true');
        const topZoom = await roundTripFieldZoom(target, 'data-projection');
        await target.getByRole('button', { name: 'Показать поле целиком', exact: true }).click();
        await expect(target.getByLabel('Масштаб поля', { exact: true })).toHaveText('50%');
        expect(await snapshot()).toEqual(paused);
        topMeasurements.push({ width, dpr, top, paused });
        await target.screenshot({
          path: `${EVIDENCE}/field-visual-top-${width}-dpr${dpr}.png`,
          fullPage: true,
        });
        await clickPrimaryFieldControl(target, 'Перспектива');
        await expect(spatial).toHaveAttribute('data-field-view', 'orbit');
        await expect(target.getByTestId('robotics-side-scale')).toHaveCount(0);
        const perspectiveZoom = await roundTripFieldZoom(target, 'data-camera');
        await clickPrimaryFieldControl(target, 'Сверху');
        await expect(target.getByTestId('robotics-side-scale')).toHaveCount(0);
        await clickPrimaryFieldControl(target, 'Сбоку');
        await sideRuler(target);
        toolbarMeasurements.push({ dpr, primary, topZoom, perspectiveZoom, zoomBeforeResize });
      }
      await target.getByRole('tab', { name: 'Робот', exact: true }).click();
      await expect(target.getByTestId('robotics-side-scale')).toBeHidden();
      await target.getByRole('tab', { name: 'Поле', exact: true }).click();
      await sideRuler(target);
      const afterCamera = await readProject(target, projectId);
      expect(afterCamera.draft.revision).toBe(revision);
      expect(digest(afterCamera.draft.document)).toBe(sourceDigest);
      expect(await snapshot()).toEqual(paused);
      expect(digest((await saved(target, projectId)).draft.document)).toBe(sourceDigest);
      await target.reload();
      await expect(target.getByTestId('robotics-account-editor')).toBeVisible();
      expect(digest((await readProject(target, projectId)).draft.document)).toBe(sourceDigest);
      failures.assertEmpty();
    } finally {
      await context.close();
    }
  }
  writeFileSync(
    `${EVIDENCE}/side-scale.json`,
    JSON.stringify(
      {
        profile: 'UI_ONLY',
        projectId,
        sourceDigest,
        measurements,
        topMeasurements,
        toolbarMeasurements,
      },
      null,
      2,
    ),
  );
});

async function inspectRobotConstruction(page: Page, projectId: string) {
  const source = await saved(page, projectId);
  const revision = source.draft.revision;
  const panel = page.locator('#robotics-panel-robot');
  const spatial = panel.getByTestId('robotics-assembly-spatial');
  const canvas = spatial.locator('canvas');
  const frame = () =>
    canvas.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  const observations: unknown[] = [];
  let identity: Awaited<ReturnType<typeof canvas.elementHandle>> = null;
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('tab', { name: 'Робот', exact: true }).click();
    await panel.getByRole('button', { name: 'Перспектива', exact: true }).click();
    await canvas.scrollIntoViewIfNeeded();
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await expect(panel.getByTestId('robotics-assembly-viewport')).toHaveAttribute(
      'data-renderer',
      'webgl',
    );
    await frame();
    await noOverflow(page);
    if (!identity) identity = await canvas.elementHandle();
    else expect(await canvas.evaluate((element, first) => element === first, identity)).toBe(true);
    expect(JSON.parse((await canvas.getAttribute('data-robot-geometry'))!)).toEqual(
      source.draft.document.world.robot,
    );
    await expect(spatial).toHaveAttribute('data-coordinate-frame', 'construction-local');
    const area = await canvas.boundingBox();
    if (!area || area.width < 100 || area.height < 100)
      throw new Error('Construction viewport inaccessible');
    const beforeOrbit = await canvas.getAttribute('data-camera');
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width / 2 + 36, area.y + area.height / 2 + 18, {
      steps: 9,
    });
    await page.mouse.up();
    await expect(canvas).not.toHaveAttribute('data-camera', beforeOrbit!);
    await frame();
    const orbit = await canvas.getAttribute('data-camera');
    await page.screenshot({
      path: `${EVIDENCE}/robot-visual-perspective-${width}.png`,
      fullPage: true,
    });
    const cameras: unknown[] = [];
    for (const [label, value] of [
      ['Спереди', 'front'],
      ['Сверху', 'top'],
      ['Сбоку', 'side'],
      ['Перспектива', 'orbit'],
    ] as const) {
      await panel.getByRole('button', { name: label, exact: true }).click();
      await expect(panel.getByRole('button', { name: label, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(spatial).toHaveAttribute('data-field-view', value);
      await frame();
      expect(await canvas.evaluate((element, first) => element === first, identity)).toBe(true);
      const camera = JSON.parse((await canvas.getAttribute('data-camera'))!) as number[][];
      expect(camera.flat().every(Number.isFinite)).toBe(true);
      cameras.push({
        view: value,
        camera,
        projection: JSON.parse((await canvas.getAttribute('data-projection'))!),
      });
      if (value === 'front') {
        expect(camera[0]![0]).toBeGreaterThan(camera[2]![0]!);
        expect(camera[0]![1]).toBeCloseTo(camera[2]![1]!, 9);
        expect(camera[0]![2]).toBeCloseTo(camera[2]![2]!, 9);
      }
      if (value === 'top')
        await page.screenshot({
          path: `${EVIDENCE}/robot-visual-top-${width}.png`,
          fullPage: true,
        });
    }
    const prior = JSON.parse(orbit!) as number[][];
    const returned = JSON.parse((await canvas.getAttribute('data-camera'))!) as number[][];
    returned.forEach((row, i) =>
      row.forEach((value, j) => expect(value).toBeCloseTo(prior[i]![j]!, 9)),
    );
    await panel.getByRole('button', { name: 'Показать конструкцию целиком', exact: true }).click();
    await expect(panel.getByLabel('Масштаб конструкции', { exact: true })).toHaveText('100%');
    await panel.getByRole('button', { name: 'Приблизить конструкцию', exact: true }).click();
    await expect(panel.getByLabel('Масштаб конструкции', { exact: true })).toHaveText('125%');
    await panel.getByRole('button', { name: 'Показать конструкцию целиком', exact: true }).click();
    await page.getByRole('tab', { name: 'Поле', exact: true }).click();
    await frame();
    const stopped = await canvas.getAttribute('data-render-count');
    await frame();
    expect(await canvas.getAttribute('data-render-count')).toBe(stopped);
    const fieldCanvas = page.getByTestId('robotics-field-spatial').locator('canvas');
    await expect(fieldCanvas).toHaveAttribute('data-rendered', 'true');
    await fieldCanvas.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(JSON.parse((await fieldCanvas.getAttribute('data-robot-geometry'))!)).toEqual(
      source.draft.document.world.robot,
    );
    const after = await readProject(page, projectId);
    expect(after.draft.revision).toBe(revision);
    expect(after.draft.document).toEqual(source.draft.document);
    observations.push({ width, cameras, stopped, document: digest(after.draft.document) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('tab', { name: 'Робот', exact: true }).click();
  writeFileSync(
    `${EVIDENCE}/robot-visual.json`,
    JSON.stringify(
      { projectId, sourceDigest: digest(source.draft.document), observations },
      null,
      2,
    ),
  );
}

async function inspectHeaderControls(page: Page, projectId: string) {
  const source = await saved(page, projectId);
  const header = page.locator('.robotics-unified-header');
  const group = header.locator('.robotics-run-bar');
  const identity = await group.elementHandle();
  const stage = await page.locator('.workbench-canvas').elementHandle();
  const code = page.locator('.robotics-program-shell textarea[aria-label="Код Arduino C++"]');
  await page.getByRole('tab', { name: 'Код', exact: true }).click();
  const codeIdentity = await code.elementHandle();
  if (!identity || !stage || !codeIdentity) throw new Error('Missing real shared header/editors');
  const pose = () =>
    page
      .getByTestId('robotics-field-spatial')
      .evaluate((element) =>
        ['data-x-meters', 'data-y-meters', 'data-heading-radians'].map((key) =>
          element.getAttribute(key),
        ),
      );
  const clock = () => page.getByTestId('robotics-time').getAttribute('data-microseconds');
  const measurements: unknown[] = [];
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await group.getByRole('button', { name: 'Запустить', exact: true }).click();
    await expect
      .poll(async () => Number(await clock()), { timeout: 60_000 })
      .toBeGreaterThan(100_000);
    await group.getByRole('button', { name: 'Пауза', exact: true }).click();
    await expect(group.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
    const paused = await clock();
    const pausedPose = await pose();
    const views: unknown[] = [];
    for (const tab of ['Поле', 'Робот', 'Электроника', 'Код']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.locator('.robotics-run-bar')).toHaveCount(1);
      await expect(page.getByTestId('robotics-time')).toHaveCount(1);
      await expect(group).toBeVisible();
      expect(await group.evaluate((element, first) => element === first, identity)).toBe(true);
      expect(
        await page
          .locator('.workbench-canvas')
          .evaluate((element, first) => element === first, stage),
      ).toBe(true);
      expect(await code.evaluate((element, first) => element === first, codeIdentity)).toBe(true);
      expect(await clock()).toBe(paused);
      expect(await pose()).toEqual(pausedPose);
      const geometry = await group.evaluate((element) => {
        const header = element.closest('header')!;
        const bounds = header.getBoundingClientRect();
        const workspace = header
          .parentElement!.querySelector('.robotics-workspace')!
          .getBoundingClientRect();
        const controls = [
          element.querySelector('.workbench-simulation-clock-button')!,
          ...element.querySelectorAll('.robotics-run-buttons button'),
        ];
        const rects = controls.map((control) => control.getBoundingClientRect());
        const other = [
          ...header.querySelectorAll(
            '.robotics-header-save, .robotics-header-brand-zone, .robotics-header-controls',
          ),
        ].map((node) => node.getBoundingClientRect());
        const children = [...other, element.getBoundingClientRect()];
        const overlaps = (a: DOMRect, b: DOMRect) =>
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        return {
          header: bounds.toJSON(),
          workspace: workspace.toJSON(),
          children: children.map((rect) => rect.toJSON()),
          childrenContained: children.every(
            (rect) =>
              rect.left >= bounds.left &&
              rect.right <= bounds.right + 1 &&
              rect.top >= bounds.top &&
              rect.bottom <= bounds.bottom + 1,
          ),
          controls: rects.map((rect) => rect.toJSON()),
          contained: rects.every(
            (rect) =>
              rect.width > 0 &&
              rect.height > 0 &&
              rect.left >= bounds.left &&
              rect.right <= bounds.right + 1 &&
              rect.top >= bounds.top &&
              rect.bottom <= bounds.bottom + 1,
          ),
          reachable: controls.every((control, i) => {
            const rect = rects[i]!;
            const hit = document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            );
            return hit !== null && control.contains(hit);
          }),
          separate: rects.every(
            (rect, i) =>
              !rects.some((other, j) => i !== j && overlaps(rect, other)) &&
              !other.some((other) => overlaps(rect, other)),
          ),
        };
      });
      expect(geometry.contained).toBe(true);
      expect(geometry.reachable).toBe(true);
      expect(geometry.separate).toBe(true);
      expect(geometry.childrenContained).toBe(true);
      expect(geometry.workspace.top).toBeGreaterThanOrEqual(geometry.header.bottom);
      if (width === 320)
        for (const bounds of geometry.controls) {
          expect(bounds.width).toBeGreaterThanOrEqual(44);
          expect(bounds.height).toBeGreaterThanOrEqual(44);
        }
      await noOverflow(page);
      if (tab === 'Поле') {
        const close = page.getByRole('button', { name: 'Закрыть панель поля', exact: true });
        if (await close.isVisible()) {
          await close.click();
          await expect(page.locator('.robotics-field-catalog-toggle')).toHaveAttribute(
            'aria-expanded',
            'false',
          );
        }
        await page.getByRole('button', { name: 'Сбоку', exact: true }).click();
        await expect(page.getByTestId('robotics-field-spatial')).toHaveAttribute(
          'data-field-view',
          'side',
        );
        await page.getByRole('button', { name: 'Сверху', exact: true }).click();
        await expect(page.getByTestId('robotics-field-spatial')).toHaveAttribute(
          'data-field-view',
          'top',
        );
        expect(await clock()).toBe(paused);
        expect(await pose()).toEqual(pausedPose);
      }
      if (tab === 'Код') {
        for (const control of [
          page.getByRole('combobox', { name: 'Программируемая плата', exact: true }),
          page.locator('.arduino-mode-menu > summary'),
          page.getByRole('button', {
            name:
              width === 320
                ? 'Проверить совместимость кода с симулятором (не компиляция)'
                : 'Проверить код',
            exact: true,
          }),
          page.getByRole('button', { name: 'Скачать .ino', exact: true }),
          page.locator('.robotics-code-extras > summary'),
        ])
          await visibleControl(page, control);
      }
      views.push({ tab, ...geometry, time: await clock(), pose: await pose() });
      await page.screenshot({
        path: `${EVIDENCE}/header-controls-${tab}-${width}.png`,
        fullPage: true,
      });
    }
    expect((await readProject(page, projectId)).draft.document).toEqual(source.draft.document);
    await group.getByRole('button', { name: 'Продолжить', exact: true }).click();
    await expect
      .poll(async () => Number(await clock()), { timeout: 60_000 })
      .toBeGreaterThan(Number(paused));
    await group.getByRole('button', { name: 'Пауза', exact: true }).click();
    await expect(group.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
    const resumed = await clock();
    await group.getByRole('button', { name: 'Сбросить', exact: true }).click();
    await expect(page.getByTestId('robotics-time')).toHaveAttribute('data-microseconds', '0');
    await expect(group.getByRole('button', { name: 'Запустить', exact: true })).toBeEnabled();
    await expect(group.getByRole('button', { name: 'Пауза', exact: true })).toBeDisabled();
    expect((await readProject(page, projectId)).draft.document).toEqual(source.draft.document);
    const initial = source.draft.document.world.initialPose;
    expect(await pose()).toEqual([
      String(initial.xMeters),
      String(initial.yMeters),
      String(initial.headingRadians),
    ]);
    measurements.push({
      width,
      paused,
      resumed,
      resetTime: await clock(),
      resetPose: await pose(),
      views,
    });
  }
  writeFileSync(
    `${EVIDENCE}/header-controls.json`,
    JSON.stringify(
      { projectId, sourceDigest: digest(source.draft.document), measurements },
      null,
      2,
    ),
  );
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
    await showObjectCatalog(page);
    await page
      .getByTestId('robotics-field-palette')
      .getByRole('button', { name: tool, exact: true })
      .click();
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  }
  await page.getByRole('tab', { name: 'Робот', exact: true }).click();
  // Assembly inputs use millimetres; the saved document and publication use metres.
  await numberField(page, 'Длина корпуса', 180);
  await inspectRobotConstruction(page, projectId);
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

  // Navigation through the common header must retain the actual Blockly DOM
  // and its already-saved workspace, before changing editing modes below.
  if ((await page.locator('.robotics-code-extras').getAttribute('open')) !== null)
    await page.locator('.robotics-code-extras > summary').click();
  const blockWorkspace = page.getByTestId('arduino-block-workspace');
  const blockIdentity = await blockWorkspace.elementHandle();
  if (!blockIdentity) throw new Error('Actual Blockly workspace missing');
  for (const tab of ['Поле', 'Робот', 'Электроника', 'Код']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    expect(
      await blockWorkspace.evaluate((element, first) => element === first, blockIdentity),
    ).toBe(true);
    expect((await readProject(page, projectId)).draft.document).toEqual(blocksSaved.draft.document);
  }

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
  await page.getByRole('tab', { name: 'Робот', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Длина корпуса', exact: true })).toBeDisabled();
  await expect(
    page
      .locator('#robotics-panel-robot')
      .getByRole('combobox', { name: 'Левый мотор', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
  const pausedTime = await page.getByTestId('robotics-time').getAttribute('data-microseconds');
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  const fieldPose = await page
    .getByTestId('robotics-field-spatial')
    .evaluate((element) =>
      ['data-x-meters', 'data-y-meters', 'data-heading-radians'].map((key) =>
        element.getAttribute(key),
      ),
    );
  for (const tab of ['Электроника', 'Код', 'Робот', 'Поле']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    expect(await page.getByTestId('robotics-time').getAttribute('data-microseconds')).toBe(
      pausedTime,
    );
    if (tab === 'Код') await expect(code).toHaveValue(source);
  }
  expect(
    await page
      .getByTestId('robotics-field-spatial')
      .evaluate((element) =>
        ['data-x-meters', 'data-y-meters', 'data-heading-radians'].map((key) =>
          element.getAttribute(key),
        ),
      ),
  ).toEqual(fieldPose);
  expect((await saved(page, projectId)).draft.document).toEqual(confirmed.draft.document);
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();

  await inspectHeaderControls(page, projectId);

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
    await restored.getByRole('tab', { name: 'Робот', exact: true }).click();
    const restoredRobot = restored.getByTestId('robotics-assembly-spatial').locator('canvas');
    await expect(restoredRobot).toHaveAttribute('data-rendered', 'true');
    await expect
      .poll(async () =>
        JSON.parse((await restoredRobot.getAttribute('data-robot-geometry')) ?? 'null'),
      )
      .toEqual(confirmed.draft.document.world.robot);
    await expect(
      restored.getByRole('spinbutton', { name: 'Длина корпуса', exact: true }),
    ).toHaveValue('180');
    await restored.screenshot({
      path: `${EVIDENCE}/robot-visual-restored-1440.png`,
      fullPage: true,
    });
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
  await openFieldSettings(page);
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
    await showObjectCatalog(page);
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
    await showObjectCatalog(page);
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
  await showObjectCatalog(page);
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
  await showObjectCatalog(page);
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
    await showObjectCatalog(page);
    await noOverflow(page);
    for (const label of ['Мяч', 'Банка', 'Брусок', 'Кривая', 'Трасса'])
      await visibleControl(
        page,
        page
          .getByTestId('robotics-field-palette')
          .getByRole('button', { name: label, exact: true }),
      );
    await page.getByRole('button', { name: 'Показать поле целиком', exact: true }).click();
    for (let step = 0; step < 3; step++)
      await page.getByRole('button', { name: 'Приблизить поле', exact: true }).click();
    await expect(page.getByLabel('Масштаб поля', { exact: true })).toHaveText('100%');
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

test('SPLIT-WORKSPACE UI_ONLY retains real editors and Field through resize, focus and compact switching', async ({
  page,
}) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE, { recursive: true });
  const failures = collectBrowserFailures(page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await register(page, 'Автор проверки общего рабочего пространства');
  await page.locator('.portal-header .portal-quick-create > summary').click();
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/projects' && r.request().method() === 'POST',
  );
  await page
    .locator('.portal-header .portal-create-options')
    .getByRole('button', { name: /^Робототехника/ })
    .click();
  const created = await response;
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible();
  const workspace = page.locator('.robotics-workspace');
  const field = page.locator('#robotics-panel-field');
  const spatial = page.getByTestId('robotics-field-spatial');
  const fieldCanvas = spatial.locator('canvas');
  const stage = page.locator('#robotics-scheme .workbench-canvas');
  const separator = page.getByRole('separator', { name: 'Ширина редактора', exact: true });
  const observationSeparator = page.getByRole('separator', {
    name: 'Ширина панели наблюдения',
    exact: true,
  });
  const observation = page.getByTestId('robotics-observation-switch');
  const observeField = observation.getByRole('button', { name: 'Поле', exact: true });
  const observeRobot = observation.getByRole('button', { name: 'Робот', exact: true });
  const robot = page.locator('#robotics-panel-robot');
  const assembly = robot.getByTestId('robotics-assembly-viewport');
  const robotCanvas = assembly.locator('canvas');
  const editorWidthKey = 'asa-lab:robotics:editor-width:v1';
  const observationWidthKey = 'asa-lab:robotics:electronics-observation-width:v1';
  const storedWidth = (key: string) => page.evaluate((name) => localStorage.getItem(name), key);
  const header = page.locator('.robotics-unified-header');
  const clock = () => header.getByTestId('robotics-time').getAttribute('data-microseconds');
  const pose = () =>
    spatial.evaluate((element) =>
      ['data-x-meters', 'data-y-meters', 'data-heading-radians'].map((k) =>
        element.getAttribute(k),
      ),
    );
  const frames = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  const rect = async (locator: Locator) => {
    const value = await locator.boundingBox();
    if (!value || value.width <= 0 || value.height <= 0)
      throw new Error('Actual pane bounds missing');
    return value;
  };
  const inspectStatusClearance = async (label: string) => {
    const status = workspace.locator(':scope > .robotics-observation');
    const details = status.locator(':scope > .robotics-status-popover');
    const trigger = details.locator(':scope > summary');
    const ruler = field.locator('.robotics-side-scale:visible');
    const dimensions = field.locator('.robotics-field-stage-status');
    await expect(fieldCanvas).toHaveAttribute('data-rendered', 'true');
    await expect(ruler).toHaveCount(1);
    await expect(dimensions).toBeVisible();
    const before = {
      time: await clock(),
      pose: await pose(),
      camera: await fieldCanvas.getAttribute('data-camera'),
      document: (await readProject(page, projectId)).draft.document,
    };
    if ((await details.getAttribute('open')) !== null) await trigger.click();
    const measure = async (open: boolean) => {
      await visibleControl(page, trigger);
      const [popover, summary, scale, size, viewport] = await Promise.all([
        rect(status),
        rect(trigger),
        rect(ruler),
        rect(dimensions),
        rect(field.locator('.robotics-field-viewport')),
      ]);
      const disjoint = (a: typeof popover, b: typeof popover) =>
        Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x) ||
        Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y);
      for (const box of [popover, summary]) {
        expect(disjoint(box, scale)).toBe(true);
        expect(disjoint(box, size)).toBe(true);
        expect(box.x).toBeGreaterThanOrEqual(viewport.x);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
        expect(box.y).toBeGreaterThanOrEqual(viewport.y);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1);
      }
      expect((await details.getAttribute('open')) !== null).toBe(open);
      return { open, popover, summary, scale, size, viewport };
    };
    const closed = await measure(false);
    await trigger.click();
    await expect(status.getByText('До препятствия', { exact: true })).toBeVisible();
    const serial = details.locator('.robotics-drive');
    if ((await serial.getAttribute('open')) === null)
      await serial.locator(':scope > summary').click();
    await expect(serial.getByRole('button', { name: /Вперёд/ })).toBeVisible();
    const open = await measure(true);
    await page.screenshot({ path: `${EVIDENCE}/split-status-open-${label}.png`, fullPage: true });
    await trigger.click();
    const closedAgain = await measure(false);
    expect(await clock()).toBe(before.time);
    expect(await pose()).toEqual(before.pose);
    expect(await fieldCanvas.getAttribute('data-camera')).toBe(before.camera);
    expect((await readProject(page, projectId)).draft.document).toEqual(before.document);
    return { label, closed, open, closedAgain };
  };
  const width = async () => Number(await separator.getAttribute('aria-valuenow'));
  const closeFieldDrawer = async () => {
    const close = page.getByRole('button', { name: 'Закрыть панель поля', exact: true });
    if (await close.isVisible()) await close.click();
  };
  const expectSame = async (
    locator: Locator,
    handle: NonNullable<Awaited<ReturnType<Locator['elementHandle']>>>,
  ) => expect(await locator.evaluate((element, first) => element === first, handle)).toBe(true);
  const circuitPart = (id: string) =>
    stage
      .locator(`[data-testid="schematic-component"][data-component-id="${id}"] [role="button"]`)
      .first();
  const source = await saved(page, projectId);
  await showObjectCatalog(page);
  await page
    .getByTestId('robotics-field-palette')
    .getByRole('button', { name: 'Мяч', exact: true })
    .click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const withBall = await saved(page, projectId);
  const ball = withBall.draft.document.world.field.balls.find(
    (item) => !source.draft.document.world.field.balls.some((old) => old.id === item.id),
  );
  if (!ball) throw new Error('Real placed Field ball missing');
  await closeFieldDrawer();
  await expect(fieldCanvas).toHaveAttribute('data-rendered', 'true');
  const fieldIdentity = await fieldCanvas.elementHandle();
  const stageIdentity = await stage.elementHandle();
  const controlsIdentity = await header.locator('.robotics-run-bar').elementHandle();
  if (!fieldIdentity || !stageIdentity || !controlsIdentity)
    throw new Error('Shared instances missing');
  const electronicsTab = page.getByRole('tab', { name: 'Электроника', exact: true });
  const codeTab = page.getByRole('tab', { name: 'Код', exact: true });
  const robotTab = page.getByRole('tab', { name: 'Робот', exact: true });
  const electronics = page.locator('#robotics-panel-electronics');
  const programPanel = page.locator('#robotics-panel-program');
  const circuit = page.locator('#robotics-scheme');
  const blocks = page.getByTestId('arduino-block-workspace');
  const focusWithin = (locator: Locator) =>
    expect
      .poll(() => locator.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
  const sameCamera = async (canvas: Locator, sample: number[][]) => {
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await frames();
    await expect
      .poll(async () => {
        const current = JSON.parse((await canvas.getAttribute('data-camera')) ?? 'null') as
          number[][] | null;
        if (!current || current.length !== sample.length) return Number.POSITIVE_INFINITY;
        return Math.max(
          ...sample.flatMap((row, i) =>
            row.map((value, j) => Math.abs(value - (current[i]?.[j] ?? Infinity))),
          ),
        );
      })
      .toBeLessThan(0.000001);
  };
  const cameraSample = async (canvas: Locator) => {
    await expect(canvas).toHaveAttribute('data-rendered', 'true');
    await frames();
    return JSON.parse((await canvas.getAttribute('data-camera'))!) as number[][];
  };
  const widthOf = async (divider: Locator) => Number(await divider.getAttribute('aria-valuenow'));
  const dragRight = async (divider: Locator, pixels: number) => {
    const { x, y, width, height } = await rect(divider);
    const from = { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + pixels, from.y, { steps: 10 });
    await page.mouse.up();
  };
  const observerBounds = async (subject: Locator) => {
    const [left, right, canvas, divider, area] = await Promise.all([
      rect(subject),
      rect(circuit),
      rect(stage),
      rect(observationSeparator),
      rect(workspace),
    ]);
    const width = await widthOf(observationSeparator);
    expect(Math.abs(left.width - width)).toBeLessThanOrEqual(1);
    expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1);
    expect(Math.abs(divider.x + divider.width / 2 - right.x)).toBeLessThanOrEqual(
      divider.width + 2,
    );
    expect(right.width).toBeGreaterThanOrEqual(640);
    expect(canvas.width).toBeGreaterThan(left.width);
    expect(canvas.x).toBeGreaterThanOrEqual(right.x - 1);
    expect(right.x + right.width).toBeLessThanOrEqual(area.x + area.width + 1);
    await noOverflow(page);
    return { left, right, canvas, divider, area, width };
  };
  const observerStatus = async () => {
    const details = workspace.locator(':scope > .robotics-observation > .robotics-status-popover');
    const trigger = details.locator(':scope > summary');
    await visibleControl(page, trigger);
    if ((await details.getAttribute('open')) === null) await trigger.click();
    await expect(details.getByText('До препятствия', { exact: true })).toBeVisible();
    const serial = details.locator('.robotics-drive');
    if ((await serial.getAttribute('open')) === null)
      await serial.locator(':scope > summary').click();
    await expect(serial.getByRole('button', { name: /Вперёд/ })).toBeVisible();
    await trigger.click();
  };
  const observerFieldControls = async () => {
    await expect(fieldToolbar(page)).toHaveCount(1);
    await expect(fieldScale(page)).toHaveText(/^\d+%$/);
    const buttons = [];
    for (const name of FIELD_PRIMARY_BUTTONS)
      buttons.push({
        name,
        ...(await measurePrimaryControl(
          fieldPrimaryButton(page, name),
          true,
          page.viewportSize()!.width === 320 ? 44 : 1,
        )),
      });
    return { buttons, scale: await measurePrimaryControl(fieldScale(page), false, 1) };
  };
  const measureObserverRobot = async () => {
    const controls = robot.getByRole('group', { name: 'Камера конструкции робота', exact: true });
    await expect(assembly).toHaveAttribute('data-renderer', 'webgl');
    await expect(robot.getByTestId('robotics-assembly-spatial')).toHaveAttribute(
      'data-coordinate-frame',
      'construction-local',
    );
    await expect(robotCanvas).toHaveAttribute('data-rendered', 'true');
    await frames();
    expect(JSON.parse((await robotCanvas.getAttribute('data-robot-geometry'))!)).toEqual(
      withBall.draft.document.world.robot,
    );
    const [left, toolbar, canvas, area] = await Promise.all([
      rect(robot),
      rect(controls),
      rect(robotCanvas),
      rect(workspace),
    ]);
    const withinLeft = (bounds: { left: number; right: number }) => {
      expect(bounds.left).toBeGreaterThanOrEqual(left.x - 2);
      expect(bounds.right).toBeLessThanOrEqual(left.x + left.width + 2);
    };
    const buttons = [];
    for (const name of [
      'Перспектива',
      'Спереди',
      'Сверху',
      'Сбоку',
      'Отдалить конструкцию',
      'Приблизить конструкцию',
      'Показать конструкцию целиком',
    ]) {
      const button = controls.getByRole('button', { name, exact: true });
      await expect(button).toBeEnabled();
      const measured = await measurePrimaryControl(button, true, 44);
      withinLeft(measured.bounds);
      buttons.push({ name, ...measured });
    }
    const output = controls.getByLabel('Масштаб конструкции', { exact: true });
    await expect(output).toHaveText(/^\d+%$/);
    const scale = await measurePrimaryControl(output, false, 1);
    withinLeft(scale.bounds);
    expect(Math.abs(canvas.x - left.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(canvas.x + canvas.width - left.x - left.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(canvas.y - toolbar.y - toolbar.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(canvas.y + canvas.height - left.y - left.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(left.y + left.height - area.y - area.height)).toBeLessThanOrEqual(2);
    await noOverflow(page);
    return { left, toolbar, canvas, area, buttons, scale };
  };
  const dragCamera = async (canvas: Locator, button: 'left' | 'right') => {
    const before = await canvas.getAttribute('data-camera');
    const { x, y, width, height } = await rect(canvas);
    const start = { x: Math.round(x + width * 0.4), y: Math.round(y + height * 0.28) };
    expect(
      await canvas.evaluate(
        (element, point) => document.elementFromPoint(point.x, point.y) === element,
        start,
      ),
    ).toBe(true);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button });
    await page.mouse.move(start.x + 32, start.y + 20, { steps: 8 });
    await page.mouse.up({ button });
    await expect(canvas).not.toHaveAttribute('data-camera', before!);
  };

  const priorCodeWidth = await storedWidth(editorWidthKey);
  await electronicsTab.click();
  await expect(workspace).toHaveAttribute('data-electronics-observer', 'true');
  await expect(workspace).toHaveAttribute('data-observation-subject', 'field');
  await expect(observeField).toHaveAttribute('aria-pressed', 'true');
  await expect(field.locator('.robotics-field-editor-body')).toHaveAttribute(
    'data-observation',
    'true',
  );
  await expect(fieldCanvas).toBeVisible();
  await expect(stage).toBeVisible();
  await expectSame(fieldCanvas, fieldIdentity);
  await expectSame(stage, stageIdentity);
  await expect(field.getByTestId('robotics-field-palette')).toBeHidden();
  await expect(field.getByRole('button', { name: 'Отменить', exact: true })).toBeHidden();
  await expect(field.getByRole('checkbox', { name: 'Привязка', exact: true })).toBeHidden();
  const initialBounds = await observerBounds(field);
  expect(initialBounds.width).toBe(240);
  await expect(observationSeparator).toHaveAttribute('aria-valuemin', '200');
  await expect(observationSeparator).toHaveAttribute('aria-valuemax', '360');
  await observationSeparator.press('Home');
  const minimumBounds = await observerBounds(field);
  expect(minimumBounds.width).toBe(200);
  const desktopFieldControls = await observerFieldControls();
  for (const control of [...desktopFieldControls.buttons, desktopFieldControls.scale]) {
    expect(control.bounds.left).toBeGreaterThanOrEqual(minimumBounds.left.x - 1);
    expect(control.bounds.right).toBeLessThanOrEqual(
      minimumBounds.left.x + minimumBounds.left.width + 1,
    );
  }
  // The Top percent is relative to the current viewport fit. Compare the
  // real orthographic projection and displayed scale at the same pane width.
  await expect(spatial).toHaveAttribute('data-field-view', 'top');
  const minimumTopCamera = await cameraSample(fieldCanvas);
  const minimumTopProjection = await fieldCanvas.getAttribute('data-projection');
  const minimumTopScale = await fieldScale(page).textContent();
  if (!minimumTopProjection || !minimumTopScale)
    throw new Error('Top camera projection and scale are required at 200 px');
  await clickPrimaryFieldControl(page, 'Сбоку');
  const metric = await sideRuler(page);
  const dimensions = await rect(field.locator('.robotics-field-stage-status'));
  expect(
    metric.bounds.right <= dimensions.x ||
      metric.bounds.bottom <= dimensions.y ||
      dimensions.x + dimensions.width <= metric.bounds.left ||
      dimensions.y + dimensions.height <= metric.bounds.top,
  ).toBe(true);
  const observerSideZoom = await roundTripFieldZoom(page, 'data-projection');
  expect(observerSideZoom.decreased).toBe(observerSideZoom.before);
  await clickPrimaryFieldControl(page, 'Сверху');
  await expect(spatial).toHaveAttribute('data-field-view', 'top');
  await expect(observationSeparator).toHaveAttribute('aria-valuenow', '200');
  await sameCamera(fieldCanvas, minimumTopCamera);
  await expect(fieldCanvas).toHaveAttribute('data-projection', minimumTopProjection);
  await expect(fieldScale(page)).toHaveText(minimumTopScale);
  await observationSeparator.press('ArrowRight');
  expect(await widthOf(observationSeparator)).toBe(216);
  await observationSeparator.press('End');
  const maximumBounds = await observerBounds(field);
  expect(maximumBounds.width).toBe(360);
  await observationSeparator.press('Home');
  await dragRight(observationSeparator, 100);
  expect(await widthOf(observationSeparator)).toBe(300);
  const observationPreference = await storedWidth(observationWidthKey);
  expect(observationPreference).not.toBeNull();
  expect(await storedWidth(editorWidthKey)).toBe(priorCodeWidth);
  const resizedBounds = await observerBounds(field);
  await observerStatus();

  const library = circuit.getByRole('complementary', {
    name: 'Библиотека компонентов',
    exact: true,
  });
  const openLibrary = library.getByRole('button', { name: 'Открыть библиотеку', exact: true });
  if (await openLibrary.isVisible()) await openLibrary.click();
  await expect(
    library.getByRole('combobox', { name: 'Категория компонентов', exact: true }),
  ).toBeVisible();
  const closeLibrary = library.getByRole('button', { name: 'Свернуть библиотеку', exact: true });
  await closeLibrary.click();
  await electronics.getByRole('button', { name: 'Открыть код', exact: true }).click();
  await expect(programPanel).toHaveAttribute('data-drawer-open', 'true');
  await expect(blocks).toBeVisible();
  const [drawer, main] = await Promise.all([rect(programPanel), rect(circuit)]);
  expect(drawer.x).toBeGreaterThanOrEqual(main.x - 1);
  expect(drawer.x + drawer.width).toBeLessThanOrEqual(main.x + main.width + 1);
  const firstBlocks = await blocks.elementHandle();
  if (!firstBlocks) throw new Error('Electronics must show the real shared Blockly instance');
  await electronics.getByRole('button', { name: 'Закрыть код', exact: true }).click();
  await expect(programPanel).toBeHidden();

  const bounds = async (editor: Locator) => {
    const [left, right, divider, area] = await Promise.all([
      rect(editor),
      rect(field),
      rect(separator),
      rect(workspace),
    ]);
    expect(left.width).toBeGreaterThan(100);
    expect(right.width).toBeGreaterThanOrEqual(640);
    expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1);
    expect(divider.x + divider.width / 2).toBeGreaterThan(left.x);
    expect(Math.abs(divider.x + divider.width / 2 - right.x)).toBeLessThanOrEqual(
      divider.width + 1,
    );
    expect(right.x + right.width).toBeLessThanOrEqual(area.x + area.width + 1);
    expect(Math.abs(left.width - (await width()))).toBeLessThanOrEqual(1);
    await noOverflow(page);
    return { left, right, divider, area, width: await width() };
  };
  // Each real editor owns its navigation. Wheel over the circuit cannot zoom Field.
  const fieldZoom = page.getByLabel('Масштаб поля', { exact: true });
  const circuitZoom = circuit.locator('.workbench-stage-controls > span[aria-label^="Масштаб "]');
  const beforeCircuitZoom = await circuitZoom.textContent();
  const beforeFieldZoom = await fieldZoom.textContent();
  const circuitArea = await rect(stage);
  const wheelPoint = await stage.evaluate((element) => {
    const area = element.getBoundingClientRect();
    for (const fy of [0.25, 0.5, 0.75])
      for (const fx of [0.25, 0.5, 0.75]) {
        const x = Math.round(area.x + area.width * fx),
          y = Math.round(area.y + area.height * fy);
        const hit = document.elementFromPoint(x, y);
        if (hit && element.contains(hit)) return { x, y };
      }
    throw new Error('No reachable real circuit point');
  });
  expect(circuitArea.width).toBeGreaterThan(100);
  await page.mouse.move(wheelPoint.x, wheelPoint.y);
  await page.mouse.wheel(0, -180);
  await expect(circuitZoom).not.toHaveText(beforeCircuitZoom!);
  expect(await fieldZoom.textContent()).toBe(beforeFieldZoom);
  const afterCircuitZoom = await circuitZoom.textContent();
  const circuitViewBox = await stage.getAttribute('viewBox');
  await clickPrimaryFieldControl(page, 'Приблизить поле');
  await expect(fieldZoom).not.toHaveText(beforeFieldZoom!);
  expect(await circuitZoom.textContent()).toBe(afterCircuitZoom);
  expect(await stage.getAttribute('viewBox')).toBe(circuitViewBox);
  await expect(field.getByRole('checkbox', { name: 'Сетка', exact: true })).toBeHidden();
  await clickPrimaryFieldControl(page, 'Перспектива');
  await expect(spatial).toHaveAttribute('data-field-view', 'orbit');
  await dragCamera(fieldCanvas, 'right');
  const observedFieldCamera = await cameraSample(fieldCanvas);
  await page.screenshot({
    path: `${EVIDENCE}/split-workspace-electronics-1440.png`,
    fullPage: true,
  });
  await observeRobot.click();
  await expect(workspace).toHaveAttribute('data-observation-subject', 'robot');
  await expect(observeRobot).toHaveAttribute('aria-pressed', 'true');
  await expect(field).toBeHidden();
  await expect(robot.getByText('Компоненты робота', { exact: true })).toBeHidden();
  await expect(assembly).toHaveAttribute('data-renderer', 'webgl');
  await expect(assembly).toHaveAttribute('data-view', 'orbit');
  await observationSeparator.press('Home');
  await expect(observationSeparator).toHaveAttribute('aria-valuenow', '200');
  const minimumRobot = await measureObserverRobot();
  expect(Math.abs(minimumRobot.left.width - 200)).toBeLessThanOrEqual(2);
  await page.screenshot({
    path: `${EVIDENCE}/electronics-observer-robot-min200-1440.png`,
    fullPage: true,
  });
  await dragRight(observationSeparator, 100);
  await expect(observationSeparator).toHaveAttribute('aria-valuenow', '300');
  const robotBounds = await observerBounds(robot);
  const nativeRobot = await robotCanvas.elementHandle();
  if (!nativeRobot) throw new Error('Observer has no real Robot WebGL canvas');
  await cameraSample(robotCanvas);
  await dragCamera(robotCanvas, 'left');
  const observedRobotCamera = await cameraSample(robotCanvas);
  await observerStatus();
  await page.screenshot({
    path: `${EVIDENCE}/electronics-observer-robot-1440.png`,
    fullPage: true,
  });
  await robotTab.click();
  await expect(robot.getByText('Компоненты робота', { exact: true })).toBeVisible();
  await expectSame(robotCanvas, nativeRobot);
  await electronicsTab.click();
  await expect(observeRobot).toHaveAttribute('aria-pressed', 'true');
  await sameCamera(robotCanvas, observedRobotCamera);
  await observeField.click();
  await sameCamera(fieldCanvas, observedFieldCamera);
  await expectSame(fieldCanvas, fieldIdentity);
  await expectSame(stage, stageIdentity);
  expect((await readProject(page, projectId)).draft.document).toEqual(withBall.draft.document);

  // A shortcut over the observer cannot act on a selected circuit component or on the Field.
  const uno = circuitPart('uno');
  const unoComponent = stage.locator(
    '[data-component-id="uno"][data-testid="schematic-component"]',
  );
  await uno.focus();
  await uno.press('Enter');
  await expect(unoComponent).toHaveClass(/workbench-component-selected/);
  const topCamera = fieldPrimaryButton(page, 'Сверху');
  await topCamera.click();
  await expect(topCamera).toBeFocused();
  await expect(workspace).toHaveAttribute('data-shortcut-owner', 'field');
  await topCamera.press('Delete');
  await topCamera.press('Control+z');
  await expect(workspace).toHaveAttribute('data-shortcut-owner', 'field');
  await expect(unoComponent).toHaveClass(/workbench-component-selected/);
  expect((await readProject(page, projectId)).draft).toEqual(withBall.draft);
  await uno.focus();
  await uno.press('Enter');
  await expect(workspace).toHaveAttribute('data-shortcut-owner', 'editor');
  await uno.press('Delete');
  const circuitDeleted = await saved(page, projectId);
  expect(circuitDeleted.draft.document.circuit.components.some((item) => item.id === 'uno')).toBe(
    false,
  );
  expect(circuitDeleted.draft.document.world).toEqual(withBall.draft.document.world);
  const fitCircuit = circuit.getByRole('button', { name: 'Подогнать проект', exact: true });
  await fitCircuit.focus();
  await fitCircuit.press('Control+z');
  expect((await saved(page, projectId)).draft.document).toEqual(withBall.draft.document);

  await codeTab.click();
  await expect(blocks).toBeVisible();
  await expectSame(blocks, firstBlocks);
  const codeBounds = await bounds(programPanel);
  expect(codeBounds.width).toBe(480);
  const codeZoomBeforeResize = await page.getByLabel('Масштаб поля', { exact: true }).textContent();
  await separator.focus();
  await separator.press('Home');
  const minimum = Number(await separator.getAttribute('aria-valuemin'));
  const maximum = Number(await separator.getAttribute('aria-valuemax'));
  expect(await width()).toBe(minimum);
  await separator.press('ArrowRight');
  expect(await width()).toBe(minimum + 16);
  await separator.press('Shift+ArrowRight');
  expect(await width()).toBe(minimum + 56);
  await separator.press('End');
  expect(await width()).toBe(maximum);
  const codeMaximumBounds = await bounds(programPanel);
  await separator.press('Home');
  const divider = await rect(separator);
  const startX = Math.round(divider.x + divider.width / 2),
    startY = Math.round(divider.y + divider.height / 2);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 160, startY, { steps: 10 });
  await page.mouse.up();
  expect(await width()).toBe(minimum + 160);
  await separator.focus();
  await separator.press('Shift+ArrowRight');
  const preferredWidth = await width();
  const preferredBytes = await storedWidth(editorWidthKey);
  expect(preferredBytes).not.toBeNull();
  const codeResizedBounds = await bounds(programPanel);
  expect(await page.getByLabel('Масштаб поля', { exact: true }).textContent()).toBe(
    codeZoomBeforeResize,
  );
  expect((await readProject(page, projectId)).draft.document).toEqual(withBall.draft.document);

  expect(await storedWidth(observationWidthKey)).toBe(observationPreference);
  const grid = page.getByRole('checkbox', { name: 'Сетка', exact: true });
  await grid.uncheck();
  await expect(fieldCanvas).toHaveAttribute('data-grid-rendered', 'false');
  await grid.check();
  await expect(fieldCanvas).toHaveAttribute('data-grid-rendered', 'true');
  const viewport = field.locator('.robotics-field-viewport');
  const closedFieldWidth = (await rect(viewport)).width;
  await showObjectCatalog(page);
  expect((await rect(viewport)).width).toBeCloseTo(closedFieldWidth, 6);
  await closeFieldDrawer();
  await selectFieldObject(page, 'ball:' + ball.id);
  await closeFieldDrawer();
  const fieldInput = page.getByRole('group', { name: 'Полотно поля', exact: true });
  await fieldInput.focus();
  await expect(workspace).toHaveAttribute('data-shortcut-owner', 'field');
  await fieldInput.press('Delete');
  const fieldDeleted = await saved(page, projectId);
  expect(fieldDeleted.draft.document.world.field.balls.some((item) => item.id === ball.id)).toBe(
    false,
  );
  expect(fieldDeleted.draft.document.circuit).toEqual(withBall.draft.document.circuit);
  await fieldInput.focus();
  await fieldInput.press('Control+z');
  expect((await saved(page, projectId)).draft.document).toEqual(withBall.draft.document);
  await page.locator('.robotics-code-extras > summary').click();
  const presetBoard = (await readProject(page, projectId)).draft.document.circuit.components.find(
    (item) => item.id === withBall.draft.document.world.bindings.boardId,
  )!;
  const confirmPreset = page.waitForEvent('dialog').then(async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toBe(
      `Заменить программу платы робота «${presetBoard.name?.trim() || 'Arduino Uno R3'}» (${presetBoard.id}) примером «Поворот налево»? Редактор откроет эту плату. Программы других плат, схема и поле сохранятся. Изменение можно отменить.`,
    );
    await dialog.accept();
  });
  await Promise.all([
    confirmPreset,
    page.getByRole('combobox', { name: 'Пример программы', exact: true }).selectOption('turn-left'),
  ]);
  await expect(
    blocks.locator('.blocklyDraggable[data-id^="robotics-turn-left-"]').first(),
  ).toBeAttached();
  const preset = await saved(page, projectId);
  const program = preset.draft.document.circuit.components.find(
    (item) => item.id === 'uno',
  )!.stateProperties!;
  expect(program['arduinoCodeMode']).toBe('blocks');
  const blockSource = String(program['arduinoWorkspace']);
  expect(blockSource).toContain('robotics-turn-left-');
  expect(blockSource).toContain('asa_setup');
  expect(blockSource).toContain('asa_loop');
  const blockIdentity = await blocks.elementHandle();
  if (!blockIdentity) throw new Error('Actual Blockly workspace missing');
  if ((await page.locator('.robotics-code-extras').getAttribute('open')) !== null)
    await page.locator('.robotics-code-extras > summary').click();
  const blockCanvas = blocks.locator('svg.blocklySvg > .blocklyWorkspace > .blocklyBlockCanvas');
  const blockScale = () =>
    blockCanvas.evaluate((element) => {
      const matrix = (element as SVGGraphicsElement).getScreenCTM();
      if (!matrix) throw new Error('Actual Blockly projection missing');
      return Math.hypot(matrix.a, matrix.b);
    });
  const beforeBlockScale = await blockScale();
  const beforeBlockFieldZoom = await fieldZoom.textContent();
  await blocks.locator('.blocklyZoomIn').click();
  await expect.poll(blockScale).toBeGreaterThan(beforeBlockScale);
  expect(await fieldZoom.textContent()).toBe(beforeBlockFieldZoom);
  const zoomedBlockScale = await blockScale();
  await page.getByRole('button', { name: 'Приблизить поле', exact: true }).click();
  await expect(fieldZoom).not.toHaveText(beforeBlockFieldZoom!);
  expect(await blockScale()).toBeCloseTo(zoomedBlockScale, 8);
  const blockIds = await blocks
    .locator('.blocklyDraggable[data-id]')
    .evaluateAll((elements) => elements.map((e) => e.getAttribute('data-id')));
  for (const tab of ['Поле', 'Электроника', 'Робот', 'Код']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expectSame(blocks, blockIdentity);
    await expectSame(fieldCanvas, fieldIdentity);
    await expectSame(stage, stageIdentity);
    if (tab === 'Поле') {
      await expect(workspace).toHaveAttribute('data-split', 'false');
      await expect(fieldCanvas).toBeVisible();
      await expect(separator).toBeHidden();
    }
  }
  expect(
    await blocks
      .locator('.blocklyDraggable[data-id]')
      .evaluateAll((elements) => elements.map((e) => e.getAttribute('data-id'))),
  ).toEqual(blockIds);
  expect((await readProject(page, projectId)).draft.document).toEqual(preset.draft.document);

  await page.locator('.arduino-mode-menu > summary').click();
  await page.getByRole('button', { name: 'Текст', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Продолжить?', exact: true })
    .getByRole('button', { name: 'Продолжить', exact: true })
    .click();
  const code = page.locator('.robotics-program-shell textarea[aria-label="Код Arduino C++"]');
  await expect(code).toBeVisible();
  const text = '// split workspace draft\n' + (await code.inputValue());
  await code.fill(text);
  // Start uses the real pending-code flush; no test substitutes a Worker or its clock.
  await header.getByRole('button', { name: 'Запустить', exact: true }).click();
  await expect
    .poll(async () => Number(await clock()), { timeout: 60_000 })
    .toBeGreaterThan(100_000);
  await header.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(header.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
  const confirmed = await saved(page, projectId);
  expect(
    confirmed.draft.document.circuit.components.find((item) => item.id === 'uno')!.stateProperties![
      'arduinoSource'
    ],
  ).toBe(text);
  await code.press('Control+Home');
  await code.press('Shift+ArrowRight');
  const selection = () =>
    code.evaluate((element) => {
      const input = element as HTMLTextAreaElement;
      return [input.selectionStart, input.selectionEnd, input.selectionDirection];
    });
  const selectedText = await selection();
  expect(Number(selectedText[1])).toBeGreaterThan(Number(selectedText[0]));
  const codeIdentity = await code.elementHandle();
  if (!codeIdentity) throw new Error('Actual text editor missing');
  const paused = { time: await clock(), pose: await pose() };
  const currentView = await spatial.getAttribute('data-field-view');
  const desktopZoom = await fieldZoom.textContent();
  await frames();
  const desktopCamera = JSON.parse((await fieldCanvas.getAttribute('data-camera'))!) as number[][];
  const statusDesktop = await inspectStatusClearance('1440');
  await page.screenshot({ path: `${EVIDENCE}/split-workspace-code-1440.png`, fullPage: true });

  // A real captured resize must be cancelled when its separator becomes hidden.
  // Moving/releasing the original pointer afterwards cannot overwrite the preference.
  const pendingDivider = await rect(separator);
  await page.mouse.move(
    pendingDivider.x + pendingDivider.width / 2,
    pendingDivider.y + pendingDivider.height / 2,
  );
  await page.mouse.down();
  await page.setViewportSize({ width: 320, height: 900 });
  const compact = page.getByRole('group', { name: 'Рабочая область', exact: true });
  await expect(compact).toBeVisible();
  await expect(separator).toBeHidden();
  await page.mouse.move(300, 400);
  await page.mouse.up();
  await compact.getByRole('button', { name: 'Редактор', exact: true }).click();
  await expect(code).toBeVisible();
  await expect(field).toBeHidden();
  await frames();
  const stoppedRenderCount = await fieldCanvas.getAttribute('data-render-count');
  await frames();
  expect(await fieldCanvas.getAttribute('data-render-count')).toBe(stoppedRenderCount);
  await expectSame(code, codeIdentity);
  expect(await code.inputValue()).toBe(text);
  expect(await selection()).toEqual(selectedText);
  expect(await page.evaluate(() => localStorage.getItem('asa-lab:robotics:editor-width:v1'))).toBe(
    preferredBytes,
  );
  await compact.getByRole('button', { name: 'Поле', exact: true }).click();
  await expect(fieldCanvas).toBeVisible();
  await expect(code).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator('#robotics-panel-field')
        .evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await expectSame(fieldCanvas, fieldIdentity);
  await expect(spatial).toHaveAttribute('data-field-view', currentView!);
  await closeFieldDrawer();
  const compactFieldControls = await measurePrimaryFieldControls(page);
  await clickPrimaryFieldControl(page, 'Сбоку');
  const compactMetric = await sideRuler(page);
  const compactSideZoom = await roundTripFieldZoom(page, 'data-projection');
  expect(compactSideZoom.decreased).toBe(compactSideZoom.before);
  await clickPrimaryFieldControl(page, 'Сверху');
  await fieldInput.focus();
  await fieldInput.press('Delete');
  expect((await readProject(page, projectId)).draft.document).toEqual(confirmed.draft.document);
  const statusCompact = await inspectStatusClearance('320');
  await page.screenshot({ path: `${EVIDENCE}/split-workspace-field-320.png`, fullPage: true });
  await compact.getByRole('button', { name: 'Редактор', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('#robotics-panel-program')
        .evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await expectSame(code, codeIdentity);
  expect(await selection()).toEqual(selectedText);
  expect({ time: await clock(), pose: await pose() }).toEqual(paused);
  await noOverflow(page);
  await page.screenshot({ path: `${EVIDENCE}/split-workspace-code-320.png`, fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(fieldCanvas).toBeVisible();
  await expect(code).toBeVisible();
  await expect(separator).toBeVisible();
  expect(await width()).toBe(preferredWidth);
  expect(await fieldZoom.textContent()).toBe(desktopZoom);
  await frames();
  const restoredCamera = JSON.parse((await fieldCanvas.getAttribute('data-camera'))!) as number[][];
  restoredCamera.forEach((row, i) =>
    row.forEach((v, j) => expect(v).toBeCloseTo(desktopCamera[i]![j]!, 7)),
  );
  await expectSame(fieldCanvas, fieldIdentity);
  await expectSame(stage, stageIdentity);
  await expectSame(code, codeIdentity);
  await expectSame(header.locator('.robotics-run-bar'), controlsIdentity);
  expect(await selection()).toEqual(selectedText);
  expect({ time: await clock(), pose: await pose() }).toEqual(paused);
  const stable = await saved(page, projectId);
  expect(stable.draft.document).toEqual(confirmed.draft.document);
  expect(stable.draft.revision).toBe(confirmed.draft.revision);

  await electronicsTab.click();
  await expect(workspace).toHaveAttribute('data-electronics-observer', 'true');
  await expect(observationSeparator).toHaveAttribute('aria-valuenow', '300');
  const pausedFieldCamera = await cameraSample(fieldCanvas);
  const pausedSchematicView = await stage.getAttribute('viewBox');
  await observeRobot.click();
  const pausedRobotCamera = await cameraSample(robotCanvas);
  await expectSame(robotCanvas, nativeRobot);
  await observerStatus();
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(compact).toBeVisible();
  await expect(observationSeparator).toBeHidden();
  const compactObservation = compact.getByRole('button', { name: 'Наблюдение', exact: true });
  const compactSchematic = compact.getByRole('button', { name: 'Редактор', exact: true });
  await compactObservation.click();
  await expect(circuit).toBeHidden();
  await expect(robotCanvas).toBeVisible();
  await expect(observeRobot).toHaveAttribute('aria-pressed', 'true');
  await focusWithin(robot);
  await expectSame(robotCanvas, nativeRobot);
  const compactRobot = await measureObserverRobot();
  await page.screenshot({ path: `${EVIDENCE}/electronics-observer-robot-320.png`, fullPage: true });
  await observeField.click();
  await expect(fieldCanvas).toBeVisible();
  await expect(robot).toBeHidden();
  const compactObserverFieldControls = await observerFieldControls();
  await clickPrimaryFieldControl(page, 'Сбоку');
  const compactObserverMetric = await sideRuler(page);
  await clickPrimaryFieldControl(page, 'Сверху');
  await expectSame(fieldCanvas, fieldIdentity);
  await noOverflow(page);
  await page.screenshot({ path: `${EVIDENCE}/electronics-observer-field-320.png`, fullPage: true });
  await compactSchematic.click();
  await expect(stage).toBeVisible();
  await expect(field).toBeHidden();
  await expect(robot).toBeHidden();
  await expect
    .poll(() =>
      workspace.evaluate((node) =>
        Boolean(
          document.activeElement?.closest('#robotics-panel-electronics, #robotics-scheme') &&
          node.contains(document.activeElement),
        ),
      ),
    )
    .toBe(true);
  const hiddenRenderCounts = async () =>
    Promise.all(
      [fieldCanvas, robotCanvas].map((canvas) => canvas.getAttribute('data-render-count')),
    );
  await frames();
  const hiddenObserverFrames = await hiddenRenderCounts();
  expect(hiddenObserverFrames.every((count) => Number(count) > 0)).toBe(true);
  await frames();
  expect(await hiddenRenderCounts()).toEqual(hiddenObserverFrames);
  await expectSame(stage, stageIdentity);
  await noOverflow(page);
  await page.screenshot({
    path: `${EVIDENCE}/electronics-observer-circuit-320.png`,
    fullPage: true,
  });
  await compactObservation.click();
  await expect(observeField).toHaveAttribute('aria-pressed', 'true');
  await focusWithin(field);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(fieldCanvas).toBeVisible();
  await expect(stage).toBeVisible();
  await expect(observationSeparator).toHaveAttribute('aria-valuenow', '300');
  await sameCamera(fieldCanvas, pausedFieldCamera);
  await observeRobot.click();
  await sameCamera(robotCanvas, pausedRobotCamera);
  await expectSame(robotCanvas, nativeRobot);
  await expectSame(stage, stageIdentity);
  await expectSame(header.locator('.robotics-run-bar'), controlsIdentity);
  expect(await stage.getAttribute('viewBox')).toBe(pausedSchematicView);
  expect(await storedWidth(observationWidthKey)).toBe(observationPreference);
  expect(await storedWidth(editorWidthKey)).toBe(preferredBytes);
  expect({ time: await clock(), pose: await pose() }).toEqual(paused);
  const afterObservation = await saved(page, projectId);
  expect(afterObservation.draft.document).toEqual(confirmed.draft.document);
  expect(afterObservation.draft.revision).toBe(confirmed.draft.revision);
  await header.getByRole('button', { name: 'Остановить', exact: true }).click();
  const url = page.url();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible();
  await electronicsTab.click();
  await expect(observationSeparator).toHaveAttribute('aria-valuenow', '300');
  expect(await storedWidth(observationWidthKey)).toBe(observationPreference);
  await codeTab.click();
  await expect(code).toHaveValue(text);
  await expect(separator).toBeVisible();
  expect(await width()).toBe(preferredWidth);
  expect((await readProject(page, projectId)).draft.document).toEqual(confirmed.draft.document);
  writeFileSync(
    `${EVIDENCE}/split-workspace.json`,
    JSON.stringify(
      {
        profile: 'UI_ONLY',
        projectId,
        sourceDigest: digest(confirmed.draft.document),
        initialBounds,
        resizedBounds,
        maximumBounds,
        minimumBounds,
        robotBounds,
        robotCameraControls: [minimumRobot, compactRobot],
        codeBounds,
        codeResizedBounds,
        codeMaximumBounds,
        observerSideZoom,
        compactObserverMetric,
        observationPreference,
        observerCameraSamples: {
          observedFieldCamera,
          observedRobotCamera,
          pausedFieldCamera,
          pausedRobotCamera,
        },
        hiddenObserverFrames,
        preferredWidth,
        circuitZoom: { before: beforeCircuitZoom, after: afterCircuitZoom },
        blockScale: { before: beforeBlockScale, after: zoomedBlockScale },
        metric,
        compactMetric,
        selectedText,
        paused,
        stoppedRenderCount,
        statusClearances: [statusDesktop, statusCompact],
        fieldControls: [desktopFieldControls, compactFieldControls, compactObserverFieldControls],
        compactSideZoom,
        sameInstancesBeforeReload: true,
      },
      null,
      2,
    ),
  );
  failures.assertEmpty();
});

test('PERSPECTIVE-PLACE UI_ONLY places four real palette objects by native drag and preserves the saved world', async ({
  page,
}) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE, { recursive: true });
  const failures = collectBrowserFailures(page, {
    allowAnonymousSessionProbe: true,
    allowAdminAccessProbe: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await register(page, 'Автор проверки размещения в перспективе');
  await page.locator('.portal-header .portal-quick-create > summary').click();
  const response = page.waitForResponse(
    (event) =>
      new URL(event.url()).pathname === '/api/projects' && event.request().method() === 'POST',
  );
  await page
    .locator('.portal-header .portal-create-options')
    .getByRole('button', { name: /^Робототехника/ })
    .click();
  const created = await response;
  expect(created.status()).toBe(201);
  const projectId = (await created.json()).project.id as string;
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible();
  await page.getByRole('tab', { name: 'Поле', exact: true }).click();
  const spatial = page.getByTestId('robotics-field-spatial');
  const canvas = spatial.locator('canvas');
  const orbit = page.getByRole('button', { name: 'Перспектива', exact: true });
  const top = page.getByRole('button', { name: 'Сверху', exact: true });
  const snap = page.getByRole('checkbox', { name: 'Привязка', exact: true });
  await expect(snap).not.toBeChecked();
  await orbit.click();
  await page.getByRole('button', { name: 'Показать поле целиком', exact: true }).click();
  await expect(spatial).toHaveAttribute('data-field-view', 'orbit');
  await expect(canvas).toHaveAttribute('data-rendered', 'true');

  type NativeDrag = { type: 'dragover' | 'drop'; x: number; y: number; paletteKind: string | null };
  const originalCanvas = await canvas.elementHandle();
  if (!originalCanvas) throw new Error('Original Perspective canvas missing');
  const native: NativeDrag[] = [];
  await page.exposeFunction('recordPerspectivePaletteDrag', (event: NativeDrag) =>
    native.push(event),
  );
  await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error('Native field canvas missing');
    const capture = (
      window as Window & {
        recordPerspectivePaletteDrag?: (entry: NativeDrag) => Promise<unknown>;
      }
    ).recordPerspectivePaletteDrag;
    if (!capture) throw new Error('Native drag evidence binding missing');
    for (const type of ['dragover', 'drop'] as const) {
      element.addEventListener(
        type,
        (event) => {
          const format = 'application/x-asa-robotics-field-tool';
          if (!event.isTrusted || !event.dataTransfer?.types.includes(format)) return;
          void capture({
            type,
            x: event.clientX,
            y: event.clientY,
            paletteKind: type === 'drop' ? event.dataTransfer.getData(format) : null,
          });
        },
        { capture: true },
      );
    }
  });
  const writes: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (
      (path === `/api/projects/${projectId}` || path.startsWith(`/api/projects/${projectId}/`)) &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())
    ) {
      writes.push(`${request.method()} ${path}`);
    }
  });
  type ScreenPoint = { x: number; y: number };
  type PlacementKind = 'wall' | 'ball' | 'can' | 'box';
  type Candidate = {
    kind: PlacementKind;
    key: string;
    xMeters: number;
    yMeters: number;
    valid: boolean;
    meshCount: number;
  };
  type PointMode = 'free' | 'outside-field' | 'invalid-wall-footprint';
  const renderSettled = () =>
    canvas.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  const rayTarget = async (project: RoboticsProject, mode: PointMode, snapped: boolean) => {
    await renderSettled();
    return canvas.evaluate(
      (element, { world, mode, snapped }) => {
        if (!(element instanceof HTMLCanvasElement) || element.dataset.rendered !== 'true')
          throw new Error('A rendered Perspective canvas is required');
        const rect = element.getBoundingClientRect();
        const projection = JSON.parse(element.dataset.projection ?? 'null') as number[];
        const camera = JSON.parse(element.dataset.camera ?? 'null') as number[][];
        const position = camera?.[0],
          quaternion = camera?.[1];
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          projection?.length !== 16 ||
          position?.length !== 3 ||
          quaternion?.length !== 4 ||
          ![...projection, ...position, ...quaternion].every(Number.isFinite)
        )
          throw new Error('Live Perspective camera readback is incomplete');

        // Independently unproject the actual CSS event point through the rendered matrix.
        // Use the public DOMMatrix and quaternion vector formula, not the application raycaster.
        const inverse = new DOMMatrix(projection).inverse();
        const [ox, oy, oz] = position as [number, number, number];
        const [qx, qy, qz, qw] = quaternion as [number, number, number, number];
        const groundAt = (x: number, y: number) => {
          const local = new DOMPoint(
            ((x - rect.left) / rect.width) * 2 - 1,
            1 - ((y - rect.top) / rect.height) * 2,
            0,
            1,
          ).matrixTransform(inverse);
          if (!local.w) return null;
          const vx = local.x / local.w,
            vy = local.y / local.w,
            vz = local.z / local.w;
          const tx = 2 * (qy * vz - qz * vy);
          const ty = 2 * (qz * vx - qx * vz);
          const tz = 2 * (qx * vy - qy * vx);
          const dx = vx + qw * tx + qy * tz - qz * ty;
          const dy = vy + qw * ty + qz * tx - qx * tz;
          const dz = vz + qw * tz + qx * ty - qy * tx;
          const t = -oz / dz;
          return Number.isFinite(t) && t >= 0
            ? { xMeters: ox + dx * t, yMeters: oy + dy * t }
            : null;
        };
        const field = world.field;
        const occupied = [
          {
            x: world.initialPose.xMeters,
            y: world.initialPose.yMeters,
            r: Math.hypot(world.robot.bodyLengthMeters, world.robot.bodyWidthMeters) / 2 + 0.09,
          },
          ...field.obstacles.map((wall) => ({
            x: wall.xMeters + wall.widthMeters / 2,
            y: wall.yMeters + wall.heightMeters / 2,
            r: Math.hypot(wall.widthMeters, wall.heightMeters) / 2,
          })),
          ...field.balls.map((ball) => ({
            x: ball.xMeters,
            y: ball.yMeters,
            r: ball.radiusMeters,
          })),
          ...(field.bodies ?? []).map((body) => ({
            x: body.xMeters,
            y: body.yMeters,
            r:
              body.kind === 'can'
                ? body.radiusMeters
                : Math.hypot(body.widthMeters, body.depthMeters) / 2,
          })),
        ];
        const round = (n: number) => Math.round(n * 10000) / 10000;
        const anchorAt = (ground: NonNullable<ReturnType<typeof groundAt>>) => {
          const grid = field.gridMeters;
          const coordinate = (n: number) =>
            snapped ? round(Math.round(round(n) / grid) * grid) : round(n);
          return { xMeters: coordinate(ground.xMeters), yMeters: coordinate(ground.yMeters) };
        };
        const admits = (ground: ReturnType<typeof groundAt>) => {
          if (mode === 'outside-field')
            return (
              !ground ||
              ground.xMeters < -0.04 ||
              ground.yMeters < -0.04 ||
              ground.xMeters > field.widthMeters + 0.04 ||
              ground.yMeters > field.heightMeters + 0.04
            );
          if (!ground) return false;
          const { xMeters: x, yMeters: y } = anchorAt(ground);
          if (mode === 'invalid-wall-footprint')
            return (
              x > field.widthMeters - 0.22 &&
              x < field.widthMeters - 0.035 &&
              y > 0.2 &&
              y < field.heightMeters - 0.2
            );
          // Leave clearance for the largest palette footprint and one pixel of native drag sampling.
          return (
            x >= 0.22 &&
            y >= 0.22 &&
            x <= field.widthMeters - 0.38 &&
            y <= field.heightMeters - 0.22 &&
            occupied.every((item) => Math.hypot(x - item.x, y - item.y) > item.r + 0.22)
          );
        };
        for (let y = Math.ceil(rect.top + 25); y < rect.bottom - 25; y += 9) {
          for (let x = Math.ceil(rect.left + 25); x < rect.right - 25; x += 9) {
            const hover = { x: x + 1, y: y + 1 };
            const ground = groundAt(hover.x, hover.y);
            if (!admits(groundAt(x, y)) || !admits(ground)) continue;
            if (
              document.elementFromPoint(x, y) !== element ||
              document.elementFromPoint(hover.x, hover.y) !== element
            )
              continue;
            return {
              approach: { x, y },
              hover,
              ground,
              anchor: ground ? anchorAt(ground) : null,
              viewport: rect.toJSON(),
              projection,
              camera,
            };
          }
        }
        throw new Error('No native Perspective target found for ' + mode);
      },
      { world: project.world, mode, snapped },
    );
  };
  const palette = page.getByTestId('robotics-field-palette');
  const readPreview = async () =>
    JSON.parse((await canvas.getAttribute('data-placement-preview')) ?? 'null') as Candidate | null;
  const nativeAt = async (
    start: number,
    type: NativeDrag['type'],
    point: ScreenPoint,
    paletteKind: PlacementKind | null = null,
  ) => {
    await expect
      .poll(() =>
        native
          .slice(start)
          .filter((event) => event.type === type)
          .at(-1),
      )
      .toEqual({
        type,
        x: point.x,
        y: point.y,
        paletteKind,
      });
  };
  const dragCardTo = async (card: Locator, target: Awaited<ReturnType<typeof rayTarget>>) => {
    await card.scrollIntoViewIfNeeded();
    const rect = await card.boundingBox();
    if (!rect) throw new Error('Visible native drag source is missing');
    const x = Math.round(rect.x + rect.width / 2),
      y = Math.round(rect.y + rect.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(Math.round(rect.x) - 12, y, { steps: 4 });
    await page.mouse.move(target.approach.x, target.approach.y, { steps: 12 });
    await page.mouse.move(target.hover.x, target.hover.y);
  };
  const beginDrag = async (label: string, target: Awaited<ReturnType<typeof rayTarget>>) => {
    const card = palette.getByRole('button', { name: label, exact: true });
    await expect(card).toHaveAttribute('draggable', 'true');
    const start = native.length;
    await dragCardTo(card, target);
    await nativeAt(start, 'dragover', target.hover);
    return start;
  };
  const unchangedBeforeDrop = async (
    draft: Awaited<ReturnType<typeof readProject>>['draft'],
    writeCount: number,
  ) => {
    const row = (await readProject(page, projectId)).draft;
    expect(row.document).toEqual(draft.document);
    expect(row.revision).toBe(draft.revision);
    expect(writes).toHaveLength(writeCount);
  };

  const cases = [
    {
      kind: 'wall',
      label: 'Стена',
      list: 'obstacles',
      meshCount: 2,
      dimensions: { widthMeters: 0.3, heightMeters: 0.05 },
    },
    { kind: 'ball', label: 'Мяч', list: 'balls', meshCount: 3, dimensions: { radiusMeters: 0.06 } },
    {
      kind: 'can',
      label: 'Банка',
      list: 'bodies',
      meshCount: 6,
      dimensions: { kind: 'can', radiusMeters: 0.033, heightMeters: 0.115 },
    },
    {
      kind: 'box',
      label: 'Брусок',
      list: 'bodies',
      meshCount: 1,
      dimensions: { kind: 'box', widthMeters: 0.03, depthMeters: 0.03, heightMeters: 0.03 },
    },
  ] as const;
  const initial = (await saved(page, projectId)).draft;
  let current = initial;
  let previous = initial;
  const observations: unknown[] = [];
  for (const item of cases) {
    const snapped = item.kind === 'box';
    if (snapped) {
      await top.click();
      await snap.check();
      await orbit.click();
      await expect(spatial).toHaveAttribute('data-field-view', 'orbit');
    }
    await showObjectCatalog(page);
    const target = await rayTarget(current.document, 'free', snapped);
    if (!target.anchor) throw new Error('Expected a feasible ground-plane anchor');
    const camera = await canvas.getAttribute('data-camera');
    const clock = await page.getByTestId('robotics-time').getAttribute('data-microseconds');
    const writeCount = writes.length;
    const start = await beginDrag(item.label, target);
    await expect.poll(readPreview).toMatchObject({ kind: item.kind, valid: true });
    const ghost = (await readPreview())!;
    expect(ghost.meshCount).toBe(item.meshCount);
    expect(ghost.xMeters).toBeCloseTo(target.anchor.xMeters, 8);
    expect(ghost.yMeters).toBeCloseTo(target.anchor.yMeters, 8);
    expect(await canvas.evaluate((node, original) => node === original, originalCanvas)).toBe(true);
    expect(await canvas.getAttribute('data-camera')).toBe(camera);
    await expect(spatial).toHaveAttribute('data-field-view', 'orbit');
    await unchangedBeforeDrop(current, writeCount);
    await page.screenshot({ path: `${EVIDENCE}/perspective-place-ghost-${item.kind}.png` });
    await page.mouse.up();
    await nativeAt(start, 'drop', target.hover, item.kind);
    await expect(canvas).toHaveAttribute('data-placement-preview', 'null');
    previous = current;
    current = (await saved(page, projectId)).draft;
    const keyKind = item.list === 'bodies' ? 'body' : item.kind;
    expect(ghost.key).toMatch(new RegExp('^' + keyKind + ':.'));
    const id = ghost.key.slice(keyKind.length + 1);
    const beforeList = previous.document.world.field[item.list] ?? [];
    const afterList = current.document.world.field[item.list] ?? [];
    expect(afterList).toHaveLength(beforeList.length + 1);
    const object = afterList.find((candidate) => candidate.id === id);
    if (!object) throw new Error('Committed native candidate key absent: ' + ghost.key);
    expect(object).toMatchObject({ id, ...item.dimensions });
    expect(object.xMeters).toBeCloseTo(target.anchor.xMeters, 8);
    expect(object.yMeters).toBeCloseTo(target.anchor.yMeters, 8);
    expect(current.document).toEqual({
      ...previous.document,
      world: {
        ...previous.document.world,
        field: { ...previous.document.world.field, [item.list]: [...beforeList, object] },
      },
    });
    expect(current.revision).toBe(previous.revision + 1);
    expect(await canvas.getAttribute('data-camera')).toBe(camera);
    expect(await page.getByTestId('robotics-time').getAttribute('data-microseconds')).toBe(clock);
    await expect(spatial).toHaveAttribute('data-field-view', 'orbit');
    observations.push({
      kind: item.kind,
      snapped,
      target,
      ghost,
      object,
      revision: current.revision,
    });
  }

  await top.click();
  await snap.uncheck();
  await orbit.click();
  await expect(spatial).toHaveAttribute('data-field-view', 'orbit');
  const negativeChecks: unknown[] = [];
  for (const mode of [
    'escape',
    'outside-viewport',
    'outside-field',
    'invalid-wall-footprint',
  ] as const) {
    await showObjectCatalog(page);
    const target = await rayTarget(
      current.document,
      mode === 'escape' || mode === 'outside-viewport' ? 'free' : mode,
      false,
    );
    const writesBefore = writes.length;
    const camera = await canvas.getAttribute('data-camera');
    const start = await beginDrag('Стена', target);
    if (mode === 'escape' || mode === 'outside-viewport') {
      await expect.poll(readPreview).toMatchObject({ valid: true });
      if (mode === 'escape') await page.keyboard.press('Escape');
      else await page.mouse.move(target.hover.x, Math.round(target.viewport.top) - 8, { steps: 5 });
      await expect(canvas).toHaveAttribute('data-placement-preview', 'null');
      if (mode === 'outside-viewport') {
        const reentered = native.length;
        await page.mouse.move(target.hover.x, target.hover.y, { steps: 5 });
        await nativeAt(reentered, 'dragover', target.hover);
        await expect(canvas).toHaveAttribute('data-placement-preview', 'null');
      }
    } else if (mode === 'invalid-wall-footprint') {
      await expect.poll(readPreview).toMatchObject({ kind: 'wall', valid: false, meshCount: 2 });
    } else {
      await expect(canvas).toHaveAttribute('data-placement-preview', 'null');
    }
    await unchangedBeforeDrop(current, writesBefore);
    await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-placement-preview', 'null');
    await unchangedBeforeDrop(current, writesBefore);
    expect(await canvas.getAttribute('data-camera')).toBe(camera);
    negativeChecks.push({ mode, target, native: native.slice(start) });
  }
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  expect((await saved(page, projectId)).draft.document).toEqual(previous.document);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  const redone = (await saved(page, projectId)).draft;
  expect(redone.document).toEqual(current.document);
  await page.screenshot({ path: `${EVIDENCE}/perspective-place-final-1440.png` });

  await showObjectCatalog(page);
  const blockedCard = palette.getByRole('button', { name: 'Стена', exact: true });
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await expect(blockedCard).toBeDisabled();
  await expect
    .poll(async () =>
      Number(await page.getByTestId('robotics-time').getAttribute('data-microseconds')),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
  const paused = await page.getByTestId('robotics-time').getAttribute('data-microseconds');
  const pausedWrites = writes.length;
  await expect(blockedCard).toBeDisabled();
  await expect(blockedCard).toHaveAttribute('draggable', 'false');
  await dragCardTo(blockedCard, await rayTarget(redone.document, 'free', false));
  await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-placement-preview', 'null');
  await unchangedBeforeDrop(redone, pausedWrites);
  expect(await page.getByTestId('robotics-time').getAttribute('data-microseconds')).toBe(paused);
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();

  const url = page.url();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible();
  const reopened = (await readProject(page, projectId)).draft;
  expect(reopened.document).toEqual(redone.document);
  expect(reopened.revision).toBe(redone.revision);
  writeFileSync(
    `${EVIDENCE}/perspective-place.json`,
    JSON.stringify(
      {
        profile: 'UI_ONLY',
        projectId,
        source: digest(reopened.document),
        observations,
        negativeChecks,
        paused,
      },
      null,
      2,
    ),
  );
  failures.assertEmpty();
});
