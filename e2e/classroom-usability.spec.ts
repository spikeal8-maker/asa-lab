import { expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:4612';
async function createTeacher(page: Page) {
  const id = crypto.randomUUID().replaceAll('-', '');
  const response = await page.request.post('/api/auth/register', {
    headers: { origin },
    data: {
      email: `${id}@classroom-usability.test`,
      username: `cu_${id.slice(0, 20)}`,
      displayName: 'Синтетический преподаватель',
      password: `Safe-${id}-Password`,
      birthDate: '1990-04-12',
      country: 'RU',
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const attest = await page.request.post('/api/capabilities/educator/self-attest', {
    headers: { origin },
    data: {},
  });
  expect(attest.status(), await attest.text()).toBe(201);
}
async function createClass(page: Page, title: string) {
  const response = await page.request.post('/api/classrooms', {
    headers: { origin },
    data: { title, ageBand: 'mixed', topicKeys: [], safeModeDefault: true },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).classroom as { id: string };
}
async function addSeat(page: Page, classroomId: string, displayLabel: string) {
  const response = await page.request.post(`/api/classrooms/${classroomId}/seats`, {
    headers: { origin },
    data: { displayLabel, safeMode: true },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).student as {
    id: string;
    studentCode: string;
    displayLabel: string;
  };
}

test('real classroom credentials: default secrecy, header, clipboard, double click, F2, invalid/refused save, scope and revocation', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await createTeacher(page);
  const a = await createClass(page, 'Проверка кодов А'),
    b = await createClass(page, 'Проверка кодов Б');
  const pupil = await addSeat(page, a.id, 'Александра Иванова');
  const other = await addSeat(page, a.id, 'Константин Соколов');
  const pupilB = await addSeat(page, b.id, 'Мария Александрова');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/#/classrooms/${a.id}`);
  const row = page.locator('.classroom-roster-row').filter({ hasText: pupil.displayLabel });
  const code = row.locator('.classroom-login-handle');
  await expect(code).toHaveText('******');
  for (const secret of [pupil.studentCode, other.studentCode])
    expect(await page.locator('body').innerHTML()).not.toContain(secret);
  const copies: string[] = [];
  await page.exposeFunction('recordClassroomCopy', (value: string) => copies.push(value));
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (value: string) =>
          (
            window as unknown as { recordClassroomCopy(value: string): Promise<void> }
          ).recordClassroomCopy(value),
      },
    }),
  );
  await code.press('Space');
  await expect(code).toHaveText(pupil.studentCode);
  await expect.poll(() => copies).toEqual([pupil.studentCode]);
  await expect(page.getByRole('status')).toContainText('Код ученика скопирован.');
  await code.dblclick();
  await expect(page.locator('.student-code-dialog')).toBeVisible();
  expect(copies).toEqual([pupil.studentCode]);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  const header = page
    .locator('.classroom-roster-head')
    .getByRole('button', { name: 'Код', exact: true });
  await header.click();
  await expect(header).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('.classroom-roster-row').filter({ hasText: other.displayLabel }),
  ).toContainText(other.studentCode);
  await header.click();
  await expect(header).toHaveAttribute('aria-pressed', 'false');
  expect(await page.locator('body').innerHTML()).not.toContain(pupil.studentCode);
  await code.press('F2');
  await expect(page.locator('.student-code-dialog')).toBeVisible();
  const input = page.getByLabel('Код ученика', { exact: true });
  await input.fill('невалидный');
  await expect(page.getByRole('button', { name: 'Сохранить код', exact: true })).toBeDisabled();
  // A real duplicate is rejected by the server; the original credential remains valid.
  await input.fill(other.studentCode);
  await page.getByRole('button', { name: 'Сохранить код', exact: true }).click();
  await expect(page.locator('.student-code-dialog [role="alert"]')).toBeVisible();
  const roster = await page.request.get(`/api/classrooms/${a.id}/roster`);
  expect(
    (await roster.json()).items.find((item: { id: string }) => item.id === pupil.id).studentCode,
  ).toBe(pupil.studentCode);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.goto(`/#/classrooms/${b.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Проверка кодов Б');
  for (const secret of [pupil.studentCode, other.studentCode, pupilB.studentCode])
    expect(await page.locator('body').innerHTML()).not.toContain(secret);
  await page.goto(`/#/classrooms/${a.id}`);
  await code.press('Enter');
  await expect(code).toHaveText(pupil.studentCode);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    }),
  );
  await code.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Выделите и скопируйте');
  await expect(code).toHaveText(pupil.studentCode);
  await page.route(`**/api/classrooms/${a.id}/seats/${pupil.id}/code`, (route) =>
    route.fulfill({
      status: 403,
      json: { error: { code: 'forbidden', message: 'Доступ отозван.' } },
    }),
  );
  await code.press('F2');
  await page.getByRole('button', { name: 'Сгенерировать новый', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Доступ к классу закрыт.');
  expect(await page.locator('body').innerHTML()).not.toContain(pupil.studentCode);
  await expect(page.locator('.classroom-login-handle')).toHaveCount(0);
  await page.goto(`/#/classrooms/${b.id}`);
  const bCode = page.locator('.classroom-roster-row .classroom-login-handle');
  await bCode.press('Enter');
  await expect(bCode).toHaveText(pupilB.studentCode);
  await page.locator('.portal-account > summary').click();
  await page.locator('.portal-account').getByRole('button', { name: 'Выход', exact: true }).click();
  await expect(page.locator('.classroom-login-handle')).toHaveCount(0);
  expect(await page.locator('body').innerHTML()).not.toContain(pupilB.studentCode);
});
