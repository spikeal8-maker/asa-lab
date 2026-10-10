import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';
import { loginWithOrganization } from './organization-login';

// Real API + isolated *_test PostgreSQL. No successful endpoint is mocked.
let admin: pg.Pool;
let teacher: SeededTeacher;
const evidence = 'e2e/artifacts/classroom-participants';
test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'participants');
  mkdirSync(evidence, { recursive: true });
});
test.afterAll(async () => {
  await admin.end();
});

test('real participant works, persisted rating, merits, avatars and mixed-cookie isolation', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await loginWithOrganization(page, teacher);
  await page.getByRole('link', { name: 'Классы', exact: true }).click();
  await page.getByRole('button', { name: 'Создать класс' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Создать класс' });
  const title = `Участники ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Название класса').fill(title);
  await dialog.getByLabel('Возраст учеников').selectOption('11-12');
  await dialog.getByLabel('Электроника').check();
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: title })
    .locator('.classroom-row-title')
    .click();
  await page.getByRole('button', { name: 'Добавить ученика', exact: true }).click();
  const studentDialog = page.getByRole('dialog');
  await studentDialog.getByLabel('Имя в списке класса').fill('Анна Участница');
  await studentDialog.getByRole('button', { name: 'Добавить', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'Анна Участница' });
  const code = (await row.locator('.classroom-login-handle').innerText()).trim();
  await expect(row.getByLabel('Всего работ: Анна Участница')).toContainText('0');
  const list = (await (await page.request.get('/api/classrooms')).json()) as {
    items: Array<{ id: string; title: string }>;
  };
  const classId = list.items.find((c) => c.title === title)!.id;
  const rosterResponse = await page.request.get(`/api/classrooms/${classId}/roster`);
  const roster = (await rosterResponse.json()) as {
    items: Array<{ id: string; displayLabel: string }>;
  };
  const seatId = roster.items.find((s) => s.displayLabel === 'Анна Участница')!.id;
  const shareCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  const studentContext = await browser.newContext();
  try {
    const student = await studentContext.newPage();
    await student.goto(`/#/join-class?code=${encodeURIComponent(shareCode)}`);
    await student.getByLabel('Код ученика', { exact: true }).fill(code);
    await student.getByRole('button', { name: 'Войти', exact: true }).click();
    const createMenu = student.locator('.portal-header .portal-quick-create');
    await createMenu.locator('> summary').click();
    const createdProject = student.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/api/projects'),
    );
    await createMenu.getByRole('button', { name: /^3D модель/ }).click();
    const creation = await createdProject;
    expect(creation.ok(), await creation.text()).toBe(true);
    const project = (await creation.json()).project;
    await expect(student.getByTestId('asa3d-viewport')).toBeVisible({ timeout: 30_000 });
    await expect(student.getByTestId('asa3d-viewport')).toHaveAttribute(
      'data-runtime-ready',
      'true',
    );
    const titleField = student.getByLabel('Название проекта', { exact: true });
    await titleField.fill('Модель участницы');
    const renamed = student.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith('/api/projects/' + project.id),
    );
    await titleField.press('Enter');
    expect((await renamed).ok()).toBe(true);
    await expect(titleField).toHaveValue('Модель участницы');
    await student.goto('/#/projects');

    await page.reload();
    await expect(row.getByLabel('Всего работ: Анна Участница')).toContainText('1');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    const rating = page.getByRole('region', { name: 'Настройки рейтинга' });
    await rating.getByLabel('Период рейтинга').selectOption('7');
    for (const factor of ['Активные дни', 'Активное время', 'Оценки', 'Входы / занятия'])
      await rating.getByLabel(factor, { exact: true }).uncheck();
    await rating.getByLabel('Проекты', { exact: true }).check();
    await rating.getByRole('button', { name: 'Сохранить рейтинг' }).click();
    await expect(rating.getByText('Рейтинг сохранён')).toBeVisible();
    await page.reload();
    await expect(row.getByLabel('Рейтинг: Анна Участница')).toContainText('20');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await expect(rating.getByLabel('Период рейтинга')).toHaveValue('7');
    await expect(rating.getByLabel('Оценки', { exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Учащиеся', exact: true }).click();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(row.getByLabel('Всего работ: Анна Участница')).toBeVisible();
      await expect(row.locator('.classroom-seat-safe')).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: `${evidence}/roster-${width}.png`, fullPage: true });
    }
    await row.locator('.classroom-student-name').click();
    await expect(page.getByRole('heading', { name: 'Анна Участница', exact: true })).toBeVisible();
    await expect(
      page.getByText('Доступно преподавателю: 1 из 1 работ.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('Модель участницы', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Электроника', exact: true }).click();
    await expect(page.getByText('Нет доступных работ по этому фильтру.')).toBeVisible();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.getByText('Модель участницы', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Scratch', exact: true }).click();
    await expect(page.getByText('Нет доступных работ по этому фильтру.')).toBeVisible();
    await page.getByRole('button', { name: 'Все работы', exact: true }).click();

    // Abort one transport request, then retry against the real server.
    await page.route(`**/api/classrooms/${classId}/participants/${seatId}/works*`, (route) =>
      route.abort(),
    );
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('сервер недоступен');
    await page.unroute(`**/api/classrooms/${classId}/participants/${seatId}/works*`);
    await page.getByRole('alert').getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Модель участницы', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Заслуги', exact: true }).click();
    await page.getByLabel('Название заслуги').fill('Мастер класса');
    await page.getByLabel('Описание', { exact: true }).fill('Аккуратная работа');
    await page.getByRole('button', { name: 'Создать заслугу' }).click();
    const merit = page.locator('.participant-merits li').filter({ hasText: 'Мастер класса' });
    await merit.getByRole('button', { name: 'Выдать', exact: true }).click();
    await expect(merit.getByRole('button', { name: 'Отозвать', exact: true })).toBeVisible();
    await page.getByLabel('Название аватара').fill('Секретный мастер');
    await page.getByLabel('Секретный аватар', { exact: true }).check();
    const meritResponse = await page.request.get(
      `/api/classrooms/${classId}/participants/${seatId}/profile`,
    );
    const beforeUpload = (await meritResponse.json()) as { merits: Array<{ id: string }> };
    await page
      .getByLabel('Открыть при достижении')
      .selectOption(`custom:${beforeUpload.merits[0]!.id}`);
    const image = new PNG({ width: 32, height: 32 });
    image.data.fill(255);
    await page
      .getByLabel('Файлы аватаров')
      .setInputFiles({ name: 'raster.png', mimeType: 'image/png', buffer: PNG.sync.write(image) });
    await page.getByRole('button', { name: 'Загрузить 1', exact: true }).click();
    await page.getByRole('button', { name: 'Выбрать Секретный мастер', exact: true }).click();
    const avatarSaved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/participants/actions/avatar_choose'),
    );
    await page.getByRole('button', { name: 'Сохранить аватар', exact: true }).click();
    const savedResponse = await avatarSaved;
    expect(savedResponse.status(), await savedResponse.text()).toBe(201);
    await expect(
      page.getByRole('button', { name: 'Выбрать Секретный мастер', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    const ownBefore = (await (
      await student.request.get('/api/class-join/participants/me')
    ).json()) as { metrics: { seatId: string; avatarUrl: string }; avatars: Array<{ id: string }> };
    expect(ownBefore.metrics.seatId).toBe(seatId);
    expect(ownBefore.metrics.avatarUrl).toContain('/api/class-join/participants/avatars/');
    expect(
      (await student.request.get(ownBefore.metrics.avatarUrl)).headers()['content-type'],
    ).toContain('image/png');
    const invalid = await page.request.post(
      `/api/classrooms/${classId}/participants/actions/avatar`,
      {
        headers: { origin: new URL(page.url()).origin },
        data: {
          requestId: randomUUID(),
          title: 'Bad',
          secret: false,
          dataUrl: 'data:image/png;base64,PGh0bWw+',
        },
      },
    );
    expect(invalid.status()).toBe(400);
    const oversized = await page.request.post(
      `/api/classrooms/${classId}/participants/actions/avatar`,
      {
        headers: { origin: new URL(page.url()).origin },
        data: {
          requestId: randomUUID(),
          title: 'Big',
          secret: false,
          dataUrl: `data:image/png;base64,${'A'.repeat(300000)}`,
        },
      },
    );
    expect(oversized.status()).toBe(400);
    expect(
      (await (await student.request.get('/api/class-join/participants/me')).json()).metrics
        .avatarUrl,
    ).toBe(ownBefore.metrics.avatarUrl);
    await page.getByLabel('Роль в классе').selectOption('helper');
    expect((await student.request.get(`/api/classrooms/${classId}/participants`)).status()).toBe(
      401,
    );
    await studentContext.addCookies(await page.context().cookies());
    const mixed = await student.request.get('/api/class-join/participants/me');
    expect(mixed.ok()).toBe(true);
    expect((await mixed.json()).metrics.seatId).toBe(seatId);
    await student.reload();
    expect(
      (await (await student.request.get('/api/class-join/participants/me')).json()).metrics
        .avatarUrl,
    ).toBe(ownBefore.metrics.avatarUrl);
    const meritRevoked = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/participants/actions/merit_grant'),
    );
    await merit.getByRole('button', { name: 'Отозвать', exact: true }).click();
    const revokedResponse = await meritRevoked;
    expect(revokedResponse.status(), await revokedResponse.text()).toBe(201);
    await expect(merit.getByRole('button', { name: 'Выдать', exact: true })).toBeVisible();
    const revoked = await (await student.request.get('/api/class-join/participants/me')).json();
    expect(revoked.avatars).toEqual([]);
    expect(revoked.metrics.avatarUrl).toBeNull();
    await page.screenshot({ path: `${evidence}/merits.png`, fullPage: true });
  } finally {
    await studentContext.close();
  }
});
