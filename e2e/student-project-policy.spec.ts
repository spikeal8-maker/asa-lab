import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { registerAccountSetup } from './registration-setup';
const evidenceDir = 'e2e/artifacts/student-project-policy';
async function capture(page: Page, name: string) {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `${evidenceDir}/${name}-${width}.png`, fullPage: true });
  }
}
function randomKey() {
  return `publication-policy-${crypto.randomUUID()}`;
}
test('teacher policy explicitly permits own Seat publication and preserves public read after disabling', async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180000);
  const target = new URL(baseURL!);
  if (
    ['4610', '4620'].includes(target.port) ||
    !process.env['APP_TEST_DATABASE_URL'] ||
    !new URL(process.env['APP_TEST_DATABASE_URL']!).pathname.endsWith('_test')
  )
    throw new Error('Isolated test runtime required');
  const origin = target.origin;
  // This external SDK is unrelated to Account/Seat admission. API calls remain real.
  await page.route('https://st.max.ru/js/max-web-app.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  );
  mkdirSync(evidenceDir, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const id = crypto.randomUUID().replaceAll('-', '');
  const register = await registerAccountSetup(
    page.request,
    {
      headers: { origin },
      data: {
        email: `games-${id}@admission.test`,
        username: `games_${id.slice(0, 20)}`,
        displayName: 'Учитель допуска игр',
        password: `Safe-${id}-Password`,
        birthDate: '1990-04-12',
        country: 'RU',
      },
    },
    test.info(),
  );
  expect(register.status(), await register.text()).toBe(201);
  const educator = await page.request.post('/api/capabilities/educator/self-attest', {
    headers: { origin },
    data: {},
  });
  expect(educator.status(), await educator.text()).toBe(201);
  const classroom = await page.request.post('/api/classrooms', {
    headers: { origin, 'idempotency-key': randomKey() },
    data: { title: 'Учебные игры', ageBand: 'mixed', topicKeys: [], safeModeDefault: true },
  });
  expect(classroom.status(), await classroom.text()).toBe(201);
  const classroomId = (await classroom.json()).classroom.id as string;
  const details = await page.request.get(`/api/classrooms/${classroomId}`);
  expect(details.status(), await details.text()).toBe(200);
  const classCode = (await details.json()).classroom.joinCode as string;
  const issued = await page.request.post(`/api/classrooms/${classroomId}/seats`, {
    headers: { origin },
    data: { displayLabel: 'Ученик допуска', safeMode: true },
  });
  expect(issued.status(), await issued.text()).toBe(201);
  const student = (await issued.json()).student as { id: string; studentCode: string };

  const studentContext = await browser.newContext({ baseURL: origin });
  await studentContext.route('https://st.max.ru/js/max-web-app.js', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  );
  const learner = await studentContext.newPage();
  learner.on('pageerror', (error) => errors.push(error.message));
  try {
    await learner.goto(`${origin}/#/join-class?code=${encodeURIComponent(classCode)}`);
    await learner.getByLabel('Код ученика', { exact: true }).fill(student.studentCode);
    const joined = learner.waitForResponse(
      (response) =>
        response.url().includes('/api/class-join/studentseat') &&
        response.request().method() === 'POST',
    );
    await learner.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await joined).status()).toBe(200);

    await learner.goto(`${origin}/#/projects`);
    const created = await learner.request.post('/api/projects', {
      headers: { origin, 'idempotency-key': randomKey() },
      data: { scope: 'personal', module: 'electronics', title: 'Публикация ученика' },
    });
    expect(created.status(), await created.text()).toBe(201);
    const projectId = (await created.json()).project.id as string;
    const image = await learner.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 240;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#e6f3ff';
      ctx.fillRect(0, 0, 400, 240);
      ctx.fillStyle = '#2464bd';
      ctx.fillRect(100, 60, 200, 120);
      return canvas.toDataURL('image/png');
    });
    const snapshot = await learner.request.put(`/api/projects/${projectId}/snapshot`, {
      headers: { origin },
      data: { imageDataUrl: image, sourceRevision: 1 },
    });
    expect(snapshot.status(), await snapshot.text()).toBe(200);
    const endpoint = `/api/projects/${projectId}/publication`;
    expect((await learner.request.post(endpoint, { headers: { origin }, data: {} })).status()).toBe(
      403,
    );
    await page.goto(`${origin}/#/classrooms/${classroomId}`);
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Настройки', exact: true })
      .click();
    const controls = page.getByRole('group', { name: 'Проекты класса', exact: true });
    await expect(controls.getByLabel('Публикация проектов', { exact: true })).not.toBeChecked();
    await expect(controls.getByLabel('Скачивание проектов', { exact: true })).not.toBeChecked();
    await controls.getByLabel('Публикация проектов', { exact: true }).check();
    await controls.getByRole('button', { name: 'Сохранить разрешения', exact: true }).click();
    await expect(controls.getByRole('status')).toHaveText('Разрешения проектов сохранены.');
    await capture(page, 'teacher-class');
    await learner.reload();
    const card = learner.getByTestId('project-card').filter({ hasText: 'Публикация ученика' });
    await card.locator('details > summary').click();
    await card.getByRole('button', { name: 'Публикация', exact: true }).click();
    const dialog = learner.getByRole('dialog', { name: 'Публикация проекта' });
    await expect(dialog.getByRole('button', { name: 'Опубликовать', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: 'Обновить публикацию', exact: true }),
    ).toBeEnabled();
    await capture(learner, 'seat-published');
    const state = await learner.request.get(endpoint);
    const publicationId = (await state.json()).publication.publicationId as string;
    await controls.getByLabel('Публикация проектов', { exact: true }).uncheck();
    await controls.getByRole('button', { name: 'Сохранить разрешения', exact: true }).click();
    await expect(controls.getByRole('status')).toHaveText('Разрешения проектов сохранены.');
    expect((await learner.request.post(endpoint, { headers: { origin }, data: {} })).status()).toBe(
      403,
    );
    expect((await learner.request.get(`/api/public-projects/${publicationId}`)).status()).toBe(200);
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Ученики', exact: true })
      .click();
    await page.locator('.classroom-student-name').filter({ hasText: 'Ученик допуска' }).click();
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.getByRole('button', { name: /Публикация и скачивание/ }).click();
    const individual = page.getByRole('group', { name: 'Проекты ученика', exact: true });
    await individual.getByLabel('Публикация проектов', { exact: true }).selectOption('allow');
    await individual.getByLabel('Скачивание проектов', { exact: true }).selectOption('deny');
    await individual.getByRole('button', { name: 'Сохранить разрешения', exact: true }).click();
    await expect(individual.getByRole('status')).toHaveText('Разрешения проектов сохранены.');
    await capture(page, 'teacher-seat');
    expect((await learner.request.post(endpoint, { headers: { origin }, data: {} })).status()).toBe(
      200,
    );
    expect((await learner.request.delete(endpoint, { headers: { origin } })).status()).toBe(200);
    expect((await learner.request.get(`/api/public-projects/${publicationId}`)).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    await studentContext.close();
  }
});
