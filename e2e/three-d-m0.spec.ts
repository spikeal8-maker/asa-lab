import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

let admin: pg.Pool;
let teacher: SeededTeacher;

interface DirectHandleSnapshot {
  readonly centre: { readonly x: number; readonly y: number };
  readonly handles: readonly { readonly id: string; readonly x: number; readonly y: number }[];
}

async function directHandlePoint(
  page: Page,
  handleId: string,
): Promise<{
  readonly handle: { readonly x: number; readonly y: number };
  readonly centre: { readonly x: number; readonly y: number };
}> {
  const viewport = page.getByTestId('asa3d-viewport');
  await expect(viewport).toHaveAttribute('data-selected-node-id', /.+/);
  const overlay = page.getByTestId('asa3d-manipulator-overlay');
  await expect(overlay).toHaveAttribute('data-handle-positions', new RegExp(handleId));
  const snapshot = JSON.parse(
    (await overlay.getAttribute('data-handle-positions')) ?? '{}',
  ) as DirectHandleSnapshot;
  const handle = snapshot.handles.find((candidate) => candidate.id === handleId);
  const bounds = await viewport.boundingBox();
  if (!handle || !snapshot.centre || !bounds) throw new Error(`3D handle ${handleId} unavailable`);
  return {
    handle: { x: bounds.x + handle.x, y: bounds.y + handle.y },
    centre: { x: bounds.x + snapshot.centre.x, y: bounds.y + snapshot.centre.y },
  };
}

async function selectObject(
  page: Page,
  preferredPoint?: { readonly x: number; readonly y: number },
): Promise<void> {
  const viewport = page.getByTestId('asa3d-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('3D viewport unavailable');
  const candidates = [
    preferredPoint,
    { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height * 0.5 },
    { x: bounds.x + bounds.width * 0.56, y: bounds.y + bounds.height * 0.47 },
    { x: bounds.x + bounds.width * 0.45, y: bounds.y + bounds.height * 0.52 },
  ].filter((candidate): candidate is { readonly x: number; readonly y: number } =>
    Boolean(candidate),
  );

  for (const candidate of candidates) {
    await page.mouse.click(candidate.x, candidate.y);
    if (await viewport.getAttribute('data-selected-node-id')) return;
  }
  throw new Error('Unable to select the 3D object from the rendered workplane');
}

function extendFromCentre(
  handle: { readonly x: number; readonly y: number },
  centre: { readonly x: number; readonly y: number },
  distance: number,
): { readonly x: number; readonly y: number } {
  const x = handle.x - centre.x;
  const y = handle.y - centre.y;
  const length = Math.max(1, Math.hypot(x, y));
  return { x: handle.x + (x / length) * distance, y: handle.y + (y / length) * distance };
}

async function createThreeDProject(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await page.getByLabel('Название проекта').fill(title);
  const tile = page.locator('.module-tile').filter({ hasText: 'ASA 3D' });
  await expect(tile).toContainText('Браузерное 3D-моделирование');
  await tile.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByTestId('asa3d-viewport')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('asa3d-viewport')).toHaveAttribute('data-runtime-ready', 'true', {
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/#\/3d\/[^/?#]+\?returnTo=%2Fprojects$/);

  const toolbar = page.getByRole('toolbar', { name: 'Инструменты редактора' });
  await expect(toolbar.locator('[data-command]')).toHaveCount(16);
  await expect(toolbar.locator('[data-command]').first()).toHaveAttribute('data-command', 'copy');
  expect(
    await toolbar
      .locator('[data-command]')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-command'))),
  ).toEqual([
    'copy',
    'paste',
    'duplicate',
    'delete',
    'undo',
    'redo',
    'visibility',
    'bundle',
    'group',
    'ungroup',
    'align',
    'mirror',
    'cruise',
    'ruler',
    'workplane',
    'drop',
  ]);
  expect(
    await toolbar.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      hasVerticalScrollbar:
        ['auto', 'scroll'].includes(getComputedStyle(element).overflowY) &&
        element.scrollHeight > element.clientHeight,
    })),
  ).toEqual({ overflowY: 'visible', hasVerticalScrollbar: false });
}

async function expandShapeInspector(page: Page): Promise<void> {
  const expand = page.getByRole('button', { name: 'Развернуть параметры формы' });
  if (await expand.isVisible()) await expand.click();
  await expect(page.getByLabel('Ширина, мм')).toBeVisible();
}

async function dismissNotice(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Закрыть уведомление' });
  if (await close.isVisible()) await close.click();
}

async function previewAndDropShape(page: Page): Promise<void> {
  const source = page.getByRole('button', { name: 'Параллелепипед', exact: true });
  const viewport = page.getByTestId('asa3d-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error('3D viewport unavailable');
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const point = {
    x: bounds.x + bounds.width * 0.58,
    y: bounds.y + bounds.height * 0.54,
  };
  await source.dispatchEvent('dragstart', { dataTransfer });
  await viewport.dispatchEvent('dragover', { dataTransfer, clientX: point.x, clientY: point.y });
  await expect(viewport).toHaveAttribute('data-placement-preview', /^solid:box:/);
  mkdirSync('e2e/artifacts/three-d', { recursive: true });
  await page.screenshot({
    path: 'e2e/artifacts/three-d/direct-manipulation-placement-preview.png',
    fullPage: true,
  });
  await viewport.dispatchEvent('drop', { dataTransfer, clientX: point.x, clientY: point.y });
  await source.dispatchEvent('dragend', { dataTransfer });
  await expect(viewport).not.toHaveAttribute('data-placement-preview', /.+/);
  await expect(viewport).toHaveAttribute('data-selected-node-id', /.+/);
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'e2e-three-d');
});

test.afterAll(async () => {
  await admin.end();
});

test('teacher models, autosaves, reloads and versions an ASA 3D scene', async ({ page }) => {
  test.setTimeout(300_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(page, teacher);
  await createThreeDProject(page, 'Корпус датчика');
  const viewport = page.getByTestId('asa3d-viewport');
  await expect(page.locator('.asa3d-canvas')).toHaveCSS('cursor', 'default');
  await expect(viewport).toHaveAttribute(
    'data-mouse-navigation',
    'left-select;right-orbit;middle-pan;wheel-zoom',
  );
  const viewportBounds = await viewport.boundingBox();
  const initialCamera = await viewport.getAttribute('data-camera-state');
  if (!viewportBounds || !initialCamera) throw new Error('3D camera evidence unavailable');
  const emptyPoint = {
    x: viewportBounds.x + viewportBounds.width * 0.18,
    y: viewportBounds.y + viewportBounds.height * 0.18,
  };

  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  await page.mouse.down();
  await page.mouse.move(emptyPoint.x + 74, emptyPoint.y + 52, { steps: 5 });
  await expect(page.getByTestId('asa3d-selection-marquee')).toBeVisible();
  await expect(viewport).toHaveAttribute('data-selecting', 'marquee');
  await page.mouse.up();
  await expect(page.getByTestId('asa3d-selection-marquee')).toBeHidden();
  await expect(viewport).toHaveAttribute('data-camera-state', initialCamera);

  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(emptyPoint.x + 90, emptyPoint.y + 18, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await expect(viewport).not.toHaveAttribute('data-camera-state', initialCamera);
  await page.getByTitle('Домой').click();

  const viewCube = page.getByTestId('asa3d-view-cube');
  await expect(viewCube).toHaveAttribute('aria-label', /мышью или пальцем/);
  const cubeBounds = await viewCube.boundingBox();
  const beforeCubeOrbit = await viewport.getAttribute('data-camera-state');
  if (!cubeBounds || !beforeCubeOrbit) throw new Error('Interactive ViewCube unavailable');
  await page.mouse.move(cubeBounds.x + cubeBounds.width / 2, cubeBounds.y + cubeBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    cubeBounds.x + cubeBounds.width / 2 + 22,
    cubeBounds.y + cubeBounds.height / 2 - 90,
    { steps: 8 },
  );
  await expect(viewCube).toHaveAttribute('data-dragging', 'true');
  await page.mouse.up();
  const afterCubeOrbit = await viewport.getAttribute('data-camera-state');
  expect(afterCubeOrbit).not.toBe(beforeCubeOrbit);
  expect(Number(afterCubeOrbit?.split(',')[1])).toBeLessThan(0);
  await page.getByTitle('Домой').click();

  const beforePan = await viewport.getAttribute('data-camera-state');
  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(emptyPoint.x + 55, emptyPoint.y + 35, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await expect(viewport).not.toHaveAttribute('data-camera-state', beforePan ?? '');
  await page.getByTitle('Домой').click();

  const beforeZoom = await viewport.getAttribute('data-camera-state');
  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  await page.mouse.wheel(0, -420);
  await expect(viewport).not.toHaveAttribute('data-camera-state', beforeZoom ?? '');
  await page.getByTitle('Домой').click();

  await previewAndDropShape(page);
  await page.getByRole('button', { name: 'Удалить (Delete)' }).click();
  await expect(page.getByText('0 объектов', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Параметры', exact: true }).click();
  await expect(page.getByLabel('Параметры рабочей плоскости')).toContainText('Миллиметры (мм)');
  await expect(page.getByLabel('Ширина, мм')).toHaveValue('200');
  await expect(page.getByLabel('Глубина, мм')).toHaveValue('200');
  await page.getByRole('button', { name: 'Закрыть параметры' }).click();

  await page.getByRole('button', { name: 'Поиск форм' }).click();
  await page.getByLabel('Название формы').fill('сф');
  await expect(page.locator('.asa3d-shape-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Сфера', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Полусфера', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Поиск форм' }).click();
  await expect(page.locator('.asa3d-shape-card')).toHaveCount(11);

  await page.getByRole('button', { name: 'Параллелепипед', exact: true }).click();
  await expect(page.getByLabel('Параметры выбранной формы')).toBeVisible();
  await expandShapeInspector(page);
  await page.getByLabel('Положение X, мм').fill('-14');
  const solidId = await viewport.getAttribute('data-selected-node-id');
  const solidCentre = (await directHandlePoint(page, 'resize-south-west')).centre;
  await page.screenshot({
    path: 'e2e/artifacts/three-d/direct-manipulation-inspector-expanded.png',
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Отверстие: Цилиндр', exact: true }).click();
  await expect(
    page.getByLabel('Тип формы').getByRole('button', { name: 'Отверстие', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expandShapeInspector(page);
  await page.getByLabel('Положение X, мм').fill('0');
  const holeId = await viewport.getAttribute('data-selected-node-id');
  const holeCentre = (await directHandlePoint(page, 'resize-south-east')).centre;
  if (!solidId || !holeId || solidId === holeId)
    throw new Error('Two distinct 3D objects required');

  await page.mouse.click(solidCentre.x, solidCentre.y);
  await expect(viewport).toHaveAttribute('data-selected-node-id', solidId);
  await page.keyboard.down('Shift');
  await page.mouse.click(holeCentre.x, holeCentre.y);
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('asa3d-viewport')).toHaveAttribute('data-selected-node-ids', /,/);
  const multiSelectionPanel = page.getByTestId('asa3d-multi-selection-panel');
  await expect(multiSelectionPanel).toBeVisible();
  await expect(multiSelectionPanel).toHaveAttribute('data-selection-count', '2');
  await expect(multiSelectionPanel).toContainText('Выбрано: 2 объекта');

  await page.mouse.move(holeCentre.x, holeCentre.y);
  await page.mouse.down();
  await page.mouse.move(holeCentre.x + 16, holeCentre.y + 12, { steps: 4 });
  await expect(viewport).toHaveAttribute('data-manipulating', 'move');
  await expect(viewport).toHaveAttribute('data-manipulation-count', '2');
  await page.mouse.up();
  await expect(multiSelectionPanel).toBeVisible();

  const groupButton = page.getByRole('button', {
    name: 'Булево объединение (Ctrl+G); пересечение — Ctrl+I',
  });
  await expect(groupButton).toBeEnabled();
  await page.getByRole('button', { name: 'Сгруппировать выбранные объекты' }).click();
  await expect(page.getByText(/Булева группа/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Разгруппировать (Ctrl+Shift+G)' })).toBeEnabled();
  await page.getByRole('button', { name: 'Разгруппировать (Ctrl+Shift+G)' }).click();

  const marqueeStart = {
    x: Math.min(solidCentre.x, holeCentre.x) - 58,
    y: Math.min(solidCentre.y, holeCentre.y) - 58,
  };
  const marqueeEnd = {
    x: Math.max(solidCentre.x, holeCentre.x) + 58,
    y: Math.max(solidCentre.y, holeCentre.y) + 58,
  };
  await page.mouse.move(marqueeStart.x, marqueeStart.y);
  await page.mouse.down();
  await page.mouse.move(marqueeEnd.x, marqueeEnd.y, { steps: 8 });
  await expect(page.getByTestId('asa3d-selection-marquee')).toBeVisible();
  await page.mouse.up();
  await expect(viewport).toHaveAttribute('data-selected-node-ids', /,/);
  await page.getByRole('button', { name: 'Выровнять (L)' }).click();
  await page.getByRole('button', { name: 'X · ширина: По центру' }).click();
  await page.getByRole('button', { name: 'Линейка (R)' }).click();
  await expect(page.getByText('Линейка · мм')).toBeVisible();
  await page.getByRole('button', { name: 'Снять выделение' }).click();
  await selectObject(page);
  await page.getByRole('button', { name: 'Удалить (Delete)' }).click();
  await expect(page.getByText('1 объект', { exact: true })).toBeVisible();
  await selectObject(page);
  await expandShapeInspector(page);

  const corner = await directHandlePoint(page, 'resize-south-west');
  await page.mouse.move(corner.handle.x, corner.handle.y);
  await expect(page.getByTestId('asa3d-width-value')).toHaveText('20.00');
  await expect(page.getByTestId('asa3d-depth-value')).toHaveText('20.00');
  const enlargedCorner = extendFromCentre(corner.handle, corner.centre, 36);
  await page.mouse.down();
  await page.mouse.move(corner.handle.x + 1, corner.handle.y);
  await expect(page.getByTestId('asa3d-width-value')).toHaveText(/^(19|20|21)\.00$/);
  await expect(page.getByTestId('asa3d-depth-value')).toHaveText(/^(19|20|21)\.00$/);
  await page.mouse.move(enlargedCorner.x, enlargedCorner.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('asa3d-width-value').locator('input')).toBeVisible();
  await expect(page.getByTestId('asa3d-depth-value').locator('input')).toBeVisible();
  await expect(page.getByLabel('Ширина, мм')).not.toHaveValue('20');
  await expect(page.getByLabel('Глубина, мм')).not.toHaveValue('20');
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)' }).click();
  await expect(page.getByLabel('Ширина, мм')).toHaveValue('20');
  await expect(page.getByLabel('Глубина, мм')).toHaveValue('20');

  const height = await directHandlePoint(page, 'resize-height');
  await page.mouse.move(height.handle.x, height.handle.y);
  await expect(page.getByTestId('asa3d-height-value')).toHaveText('20.00');
  const taller = extendFromCentre(height.handle, height.centre, 34);
  await page.mouse.down();
  await page.mouse.move(taller.x, taller.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel('Высота, мм')).not.toHaveValue('20');
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)' }).click();
  await expect(page.getByLabel('Высота, мм')).toHaveValue('20');

  const lift = await directHandlePoint(page, 'lift');
  await page.mouse.move(lift.handle.x, lift.handle.y);
  await expect(page.getByTestId('asa3d-lift-value')).toHaveText('0.00');
  await page.mouse.down();
  await page.mouse.move(lift.handle.x, lift.handle.y - 36, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('asa3d-lift-value').locator('input')).toBeVisible();
  await expect(page.getByLabel('Положение Y, мм')).not.toHaveValue('10');
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)' }).click();
  await expect(page.getByLabel('Положение Y, мм')).toHaveValue('10');

  const rotate = await directHandlePoint(page, 'rotate-y');
  await page.mouse.move(rotate.handle.x, rotate.handle.y);
  await expect(page.getByTestId('asa3d-angle-value')).toHaveText('0°');
  const ringGrab = extendFromCentre(rotate.handle, rotate.centre, 18);
  await page.mouse.move(ringGrab.x, ringGrab.y, { steps: 8 });
  await expect(page.getByTestId('asa3d-angle-value')).toHaveText('0°');
  const angle = Math.PI / 7;
  const dx = ringGrab.x - rotate.centre.x;
  const dy = ringGrab.y - rotate.centre.y;
  const rotated = {
    x: rotate.centre.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: rotate.centre.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
  await page.mouse.down();
  await page.mouse.move(rotated.x, rotated.y, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('asa3d-angle-value').locator('input')).toBeVisible();
  await expect(page.getByLabel('Поворот Y, градусов')).not.toHaveValue('0');
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)' }).click();
  await expect(page.getByLabel('Поворот Y, градусов')).toHaveValue('0');

  const movable = await directHandlePoint(page, 'resize-height');
  const moveStartX = await page.getByLabel('Положение X, мм').inputValue();
  const moveStartZ = await page.getByLabel('Положение Z, мм').inputValue();
  await page.mouse.move(movable.centre.x, movable.centre.y);
  await page.mouse.down();
  await page.mouse.move(movable.centre.x + 42, movable.centre.y + 18, { steps: 8 });
  await page.mouse.up();
  const movedX = Number(await page.getByLabel('Положение X, мм').inputValue());
  const movedZ = Number(await page.getByLabel('Положение Z, мм').inputValue());
  expect(
    Math.abs(movedX - Number(moveStartX)) + Math.abs(movedZ - Number(moveStartZ)),
  ).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)' }).click();
  await expect(page.getByLabel('Положение X, мм')).toHaveValue(moveStartX);
  await expect(page.getByLabel('Положение Z, мм')).toHaveValue(moveStartZ);

  await page.getByLabel('Ширина, мм').fill('42');
  await page.getByLabel('Глубина, мм').fill('28');
  await page.getByLabel('Высота, мм').fill('12');
  await page.getByLabel('Положение X, мм').fill('16');
  await page.getByLabel('Поворот Z, градусов').fill('15');
  await page.getByRole('button', { name: 'Копировать (Ctrl+C)' }).click();
  await page.getByRole('button', { name: 'Вставить (Ctrl+V)' }).click();
  await expect(page.getByText('2 объекта', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Отменить (Ctrl+Z)' }).click();
  await expect(page.getByText('1 объект', { exact: true })).toBeVisible();
  await expect(page.getByText('Все изменения сохранены', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await dismissNotice(page);

  mkdirSync('e2e/artifacts/three-d', { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await selectObject(page, movable.centre);
  const dimensionEvidence = await directHandlePoint(page, 'resize-south-west');
  await page.mouse.move(dimensionEvidence.handle.x, dimensionEvidence.handle.y);
  await expect(page.getByTestId('asa3d-width-value')).toHaveText('42.00');
  await expect(page.getByTestId('asa3d-depth-value')).toHaveText('28.00');
  await page.screenshot({
    path: 'e2e/artifacts/three-d/direct-manipulation-desktop.png',
    fullPage: true,
  });
  const rotationEvidence = await directHandlePoint(page, 'rotate-y');
  await page.mouse.move(rotationEvidence.handle.x, rotationEvidence.handle.y);
  await expect(page.getByTestId('asa3d-angle-value')).toHaveText('0°');
  await page.screenshot({
    path: 'e2e/artifacts/three-d/direct-manipulation-rotation.png',
    fullPage: true,
  });

  await page.reload();
  await expect(page.getByTestId('asa3d-viewport')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('1 объект', { exact: true })).toBeVisible();
  await selectObject(page);
  await expandShapeInspector(page);
  await expect(page.getByLabel('Ширина, мм')).toHaveValue('42');
  await expect(page.getByLabel('Глубина, мм')).toHaveValue('28');
  await expect(page.getByLabel('Высота, мм')).toHaveValue('12');
  await expect(page.getByLabel('Положение X, мм')).toHaveValue('16');
  await expect(page.getByLabel('Поворот Z, градусов')).toHaveValue('15');
  /**
   * Versions, and the way back into them.
   *
   * The button used to only write: versions piled up and could never be
   * returned to, which makes a history pointless. It now opens the history, and
   * the shape put back below proves the document actually travels.
   */
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  const history = page.getByRole('dialog', {
    name: 'Отправить проект и открыть историю версий',
  });
  await history.getByRole('button', { name: 'Сохранить версию' }).click();
  await expect(page.getByText(/Создана неизменяемая версия №1/)).toBeVisible();
  await dismissNotice(page);
  await expect(history.getByRole('button', { name: 'Вернуться' })).toBeVisible();
  // The same button closes it. Escape would also clear the selection the next
  // step needs, and a panel over a canvas has to be dismissable by the control
  // that opened it.
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(history).toHaveCount(0);

  // Wreck the work, then take it back to the version just saved.
  await page.getByLabel('Ширина, мм').fill('9');
  await page.getByLabel('Ширина, мм').press('Enter');
  await expect(page.getByLabel('Ширина, мм')).toHaveValue('9');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Отправить проект и открыть историю версий' })
    .getByRole('button', { name: 'Вернуться' })
    .first()
    .click();
  // Restoring replaces the document, so nothing is selected afterwards — the
  // shape is picked up again to read its width back off the inspector.
  await expect(page.getByText('1 объект', { exact: true })).toBeVisible();
  await selectObject(page);
  await expandShapeInspector(page);
  await expect(page.getByLabel('Ширина, мм')).toHaveValue('42');
  await page.screenshot({ path: 'e2e/artifacts/three-d/version-restored.png', fullPage: true });

  await page.getByRole('button', { name: 'Свернуть параметры формы' }).click();

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByLabel('Библиотека форм')).toBeVisible();
  await expect(page.getByTestId('asa3d-viewport')).toHaveAttribute('data-selected-node-id', /.+/);
  await page.screenshot({
    path: 'e2e/artifacts/three-d/direct-manipulation-tablet.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Библиотека форм')).toBeVisible();
  await expect(page.getByTestId('asa3d-viewport')).toHaveAttribute('data-selected-node-id', /.+/);
  await page.screenshot({
    path: 'e2e/artifacts/three-d/direct-manipulation-mobile.png',
    fullPage: true,
  });
  failures.assertEmpty();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expandShapeInspector(page);
  await page.route(/\/api\/projects\/[^/]+\/draft$/, async (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'unauthorized', message: 'no active session' } }),
    }),
  );
  await page.getByLabel('Ширина, мм').fill('43');
  await expect(page.getByRole('button', { name: /Сессия завершена.*Войти снова/ })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('.asa3d-toast')).toHaveCount(0);
  await expect(page.getByText(/no active session/i)).toHaveCount(0);
});
