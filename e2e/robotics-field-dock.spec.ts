import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const EVIDENCE = 'e2e/artifacts/robotics-field-dock-001';
const widths = [
  [1920, 1080],
  [1440, 900],
  [1366, 768],
  [1024, 768],
  [390, 844],
  [320, 568],
] as const;

async function registerTestAccount(page: Page): Promise<void> {
  const unique = randomUUID().replaceAll('-', '');
  await page.goto('/#/', { waitUntil: 'domcontentloaded' });
  await page
    .locator('.public-home-header-actions')
    .getByRole('button', { name: 'Создать аккаунт', exact: true })
    .click();
  await page.getByLabel('Email', { exact: true }).fill(`field-dock-${unique}@isolated.test`);
  await page.getByLabel('Отображаемое имя', { exact: true }).fill('FIELD-DOCK isolated QA');
  await page.getByLabel('Дата рождения', { exact: true }).fill('1991-04-18');
  await page.getByLabel('Пароль', { exact: true }).fill(`Dock-${unique}-Password!`);
  const antiBot = page.getByRole('checkbox', { name: 'Я не робот' });
  if (await antiBot.isVisible()) await antiBot.press('Space');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/);
}

async function createTestRoboticsProject(page: Page): Promise<string> {
  await page.locator('.portal-header .portal-quick-create > summary').click();
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/projects' && r.request().method() === 'POST',
  );
  await page
    .locator('.portal-header .portal-create-options')
    .getByRole('button', { name: /^Робототехника/ })
    .click();
  const result = await response;
  expect(result.status()).toBe(201);
  const projectId: string = (await result.json()).project.id;
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible();
  return projectId;
}

async function readWorld(page: Page, projectId: string) {
  const response = await page.request.get(`/api/projects/${projectId}`);
  expect(response.status()).toBe(200);
  const body = await response.json();
  return body.draft.document.world;
}

async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByTestId('robotics-account-editor')).toHaveAttribute(
    'data-server-revision',
    /^[1-9]\d*$/,
  );
}

async function selectWall(page: Page) {
  await page.getByRole('button', { name: 'Показать поле целиком' }).click();
  const wall = page
    .locator('#robotics-panel-field [data-scene-key="wall:barrier"]:not([data-vector-handle])')
    .first();
  await expect(wall).toBeVisible();
  await wall.click();
}

test('ROBOTICS-FIELD-DOCK-001 real API: one dock with object properties and field settings', async ({
  page,
}) => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE, { recursive: true });
  const errors: string[] = [];
  page.on('response', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/projects') && r.status() >= 500)
      errors.push(`${r.status()} ${r.url()}`);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await registerTestAccount(page);
  const projectId = await createTestRoboticsProject(page);
  const dock = page.locator('#robotics-field-catalog');
  const canvas = page.locator('.robotics-field-canvas').first();
  const tabs = {
    objects: dock.getByRole('tab', { name: 'Объекты', exact: true }),
    properties: dock.getByRole('tab', { name: 'Свойства', exact: true }),
    field: dock.getByRole('tab', { name: 'Настройки поля', exact: true }),
  };
  await expect(dock).toBeVisible();
  await expect(tabs.objects).toHaveAttribute('aria-selected', 'true');
  const before = await readWorld(page, projectId);
  await selectWall(page);
  await expect(tabs.properties).toHaveAttribute('aria-selected', 'true');
  const inspector = dock.getByRole('dialog', {
    name: 'Параметры выбранного объекта',
  });
  await expect(inspector).toBeVisible();
  await expect(dock.locator('.robotics-field-object-flyout')).toHaveCount(0);
  const length = inspector.getByRole('spinbutton', {
    name: 'Длина стены',
    exact: true,
  });
  const initial = Number(await length.inputValue());
  const next = Math.round((initial + 0.02) * 1000) / 1000;
  await length.fill(String(next));
  await length.press('Tab');
  await expect(length).toHaveValue(String(next));
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(length).toHaveValue(String(initial));
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(length).toHaveValue(String(next));
  await save(page);
  const persisted = await readWorld(page, projectId);
  expect(
    persisted.field.obstacles.find((wall: { id: string }) => wall.id === 'barrier').widthMeters,
  ).toBe(next);

  const scale = page.getByLabel('Масштаб поля');
  const currentZoom = await scale.textContent();
  await page.getByRole('button', { name: 'Приблизить поле' }).click();
  expect(await scale.textContent()).not.toBe(currentZoom);
  const rect = await canvas.boundingBox();
  expect(rect).not.toBeNull();
  await page.mouse.move(rect!.x + 55, rect!.y + 60);
  await page.mouse.wheel(0, -130);
  await page.getByRole('button', { name: 'Перемещать вид поля' }).click();
  await page.mouse.move(rect!.x + 90, rect!.y + 90);
  await page.mouse.down();
  await page.mouse.move(rect!.x + 135, rect!.y + 120, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Перемещать вид поля' }).click();
  await save(page);
  expect(await readWorld(page, projectId)).toEqual(persisted);

  await tabs.field.click();
  await expect(dock.locator('.robotics-field-settings-sheet')).toBeVisible();
  await tabs.objects.click();
  await expect(dock.locator('.robotics-field-settings-sheet')).not.toHaveAttribute('open', '');
  await expect(dock.getByTestId('robotics-field-palette')).toBeVisible();
  await dock
    .getByTestId('robotics-field-palette')
    .getByRole('button', { name: 'Мяч', exact: true })
    .click({ timeout: 12_000 });
  await dock.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(inspector.getByRole('spinbutton', { name: 'Диаметр мяча' })).toBeVisible();
  await tabs.objects.click();
  await dock
    .getByTestId('robotics-field-palette')
    .getByRole('button', { name: 'Банка', exact: true })
    .click();
  await dock.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(inspector.getByRole('spinbutton', { name: 'Диаметр банки' })).toBeVisible();
  await save(page);
  const afterBodies = await readWorld(page, projectId);
  expect(afterBodies.field.balls.length).toBeGreaterThan(0);
  expect(afterBodies.field.bodies.some((body: { kind: string }) => body.kind === 'can')).toBe(true);

  for (const [width, height] of widths) {
    await page.setViewportSize({ width, height });
    if (width < 1280) {
      const toggle = page.getByRole('button', { name: 'Элементы поля' });
      if ((await toggle.getAttribute('aria-expanded', { timeout: 8_000 })) !== 'true')
        await toggle.click({ timeout: 8_000 });
      await expect(dock).toBeVisible();
    } else {
      await expect(dock).toBeVisible();
      const a = await canvas.boundingBox(),
        b = await dock.boundingBox();
      expect(a && b).toBeTruthy();
      expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + 2);
      expect(Math.round(b!.width)).toBeGreaterThanOrEqual(280);
      expect(Math.round(b!.width)).toBeLessThanOrEqual(420);
    }
    await page.screenshot({
      path: `${EVIDENCE}/dock-${width}x${height}.png`,
      fullPage: false,
    });
    await expect(canvas).toBeVisible();
    if (width === 390 || width === 320) {
      await tabs.properties.click();
      await expect(inspector.getByRole('spinbutton', { name: 'Диаметр банки' })).toBeVisible();
      await expect(dock.locator('#robotics-field-dock-catalog')).toBeHidden();
      await tabs.field.click();
      await expect(dock.locator('#robotics-field-dock-settings')).toHaveAttribute('open', '');
      await tabs.objects.click();
      await expect(dock.locator('#robotics-field-dock-settings')).not.toHaveAttribute('open', '');
      await expect(dock.getByTestId('robotics-field-palette')).toBeVisible();
    }
    if (width < 1280) {
      await dock.getByRole('button', { name: 'Закрыть панель поля' }).click({ timeout: 8_000 });
      await expect(dock).toBeHidden();
      await expect(canvas).toBeVisible();
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.getByTestId('robotics-account-editor')).toBeVisible();
  expect(await readWorld(page, projectId)).toEqual(afterBodies);
  await page.getByRole('button', { name: 'Запустить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Пауза', exact: true })).toBeEnabled();
  await tabs.objects.click();
  await expect(
    dock.getByTestId('robotics-field-palette').getByRole('button', { name: 'Мяч', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  await expect
    .poll(async () =>
      Number(await page.getByTestId('robotics-time').getAttribute('data-microseconds')),
    )
    .toBe(0);
  expect(errors).toEqual([]);
  writeFileSync(
    `${EVIDENCE}/dock-realapi-result.json`,
    JSON.stringify(
      {
        projectId,
        widths,
        initialWallWidth: initial,
        editedWallWidth: next,
        separatePhysicsBeforeCamera: before,
        cameraOnlyDoesNotChangeSavedWorld: true,
        balls: afterBodies.field.balls.length,
        cans: afterBodies.field.bodies.filter((body: { kind: string }) => body.kind === 'can')
          .length,
        simulationControls: ['Start', 'Pause', 'Reset'],
        projectApi5xx: errors,
      },
      null,
      2,
    ),
    'utf8',
  );
});
