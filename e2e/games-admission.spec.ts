import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { registerAccountSetup } from './registration-setup';

const evidenceDir = 'e2e/artifacts/games-admission';
const viewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 740 },
];

async function captureLayouts(page: Page, name: string): Promise<void> {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${name} at ${viewport.width}px must fit the viewport`,
    ).toBe(true);
    await page.screenshot({ path: `${evidenceDir}/${name}-${viewport.width}.png`, fullPage: true });
  }
  await page.setViewportSize(viewports[0]!);
}

/** No API interception: teacher policy, Seat sign-in, game creation, legal
 * move autosave and revoked direct links all use the assembled API and test DB.
 * Run only on the isolated E2E stack, never on either installation. */
test('teacher class and individual controls govern real offline games and direct links', async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const target = new URL(baseURL!);
  if (
    ['4610', '4620'].includes(target.port) ||
    !process.env['APP_TEST_DATABASE_URL'] ||
    !new URL(process.env['APP_TEST_DATABASE_URL']!).pathname.endsWith('_test')
  ) {
    throw new Error('Games admission E2E requires its isolated test server and *_test database');
  }
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
    await learner.goto(`${origin}/#/games`);
    await expect(
      learner.getByRole('button', { name: 'Играть: Шахматы', exact: true }),
    ).toBeEnabled();
    await expect(learner.getByRole('button', { name: 'Играть: Шашки', exact: true })).toBeEnabled();
    await captureLayouts(learner, 'learner-allowed');

    await learner.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
    await expect(learner.getByRole('navigation', { name: 'Меню ASA Chess' })).toBeVisible();
    await expect(learner.getByRole('button', { name: 'Онлайн', exact: true })).toHaveCount(0);
    await expect(learner.getByRole('button', { name: 'Играть онлайн', exact: true })).toHaveCount(
      0,
    );
    await learner.getByRole('button', { name: 'Открыть доску', exact: true }).click();
    const board = learner.getByTestId('asa-chess-board');
    await expect(board.locator('[data-square="e2"]')).toBeEnabled();
    await board.locator('[data-square="e2"]').click();
    await board.locator('[data-square="e4"]').click();
    await expect(board.locator('[data-square="e4"]')).toHaveAttribute('data-piece', 'white-pawn');
    const savedGames = await learner.request.get('/api/projects?scope=personal&module=chess');
    expect(savedGames.status(), await savedGames.text()).toBe(200);
    const chessId = (await savedGames.json()).items[0].id as string;
    await expect
      .poll(
        async () => {
          const saved = await learner.request.get(`/api/projects/${chessId}`);
          return saved.ok() ? (await saved.json()).draft.document.moves[0]?.uci : null;
        },
        { timeout: 15_000 },
      )
      .toBe('e2e4');
    await learner.reload();
    await expect(
      learner.getByTestId('asa-chess-board').locator('[data-square="e4"]'),
    ).toHaveAttribute('data-piece', 'white-pawn');
    await learner.screenshot({ path: `${evidenceDir}/chess-real-move.png`, fullPage: true });
    await learner.goto(`${origin}/#/games`);
    await learner.getByRole('button', { name: 'Играть: Шашки', exact: true }).click();
    await expect(
      learner.getByRole('button', { name: 'Вернуться к играм ASA Lab', exact: true }),
    ).toBeVisible();
    await learner.screenshot({ path: `${evidenceDir}/checkers-real-open.png`, fullPage: true });
    await learner.goto(`${origin}/#/games`);

    await page.goto(`${origin}/#/classrooms/${classroomId}`);
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Настройки', exact: true })
      .click();
    const classSettings = page.getByRole('group', { name: 'Игры в классе', exact: true });
    await expect(classSettings.getByLabel('Доступ к играм', { exact: true })).toHaveValue('allow');
    await classSettings.getByLabel('Доступ к играм', { exact: true }).selectOption('deny');
    await classSettings.getByRole('button', { name: 'Сохранить доступ', exact: true }).click();
    await expect(classSettings.getByRole('status')).toHaveText('Доступ к играм сохранён.');
    await learner.getByRole('button', { name: 'Проверить доступ', exact: true }).click();
    await expect(learner.locator('.game-card')).toContainText([
      'Учитель отключил игры для класса.',
      'Учитель отключил игры для класса.',
    ]);
    await expect(learner.locator('.game-card').nth(0)).toBeDisabled();
    await expect(learner.locator('.game-card').nth(1)).toBeDisabled();
    await captureLayouts(learner, 'learner-class-denied');
    const rejected = await learner.request.get(`/api/projects/${chessId}`);
    expect(rejected.status(), await rejected.text()).toBe(403);
    await learner.goto(`${origin}/#/chess/${chessId}/puzzles`);
    await expect(
      learner.getByRole('heading', { name: 'Игра не открыта', exact: true }),
    ).toBeVisible();
    await expect(learner.getByRole('alert')).toContainText('Учитель отключил игры для класса.');
    await learner.getByRole('button', { name: 'К играм', exact: true }).click();

    await classSettings
      .getByLabel('Доступ к играм', { exact: true })
      .selectOption('rating_threshold');
    await classSettings.getByLabel('Порог рейтинга для игр', { exact: true }).fill('100');
    await classSettings.getByRole('button', { name: 'Сохранить доступ', exact: true }).click();
    await expect(classSettings.getByRole('status')).toHaveText('Доступ к играм сохранён.');
    await captureLayouts(page, 'teacher-class-rating');
    await learner.getByRole('button', { name: 'Проверить доступ', exact: true }).click();
    await expect(learner.locator('.game-card').first()).toContainText(
      'Игры откроются при рейтинге класса от 100.',
    );

    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Ученики', exact: true })
      .click();
    await page.locator('.classroom-student-name').filter({ hasText: 'Ученик допуска' }).click();
    const individual = page.getByRole('group', { name: 'Игры ученика', exact: true });
    await expect(individual.getByLabel('Индивидуальный доступ', { exact: true })).toHaveValue(
      'inherit',
    );
    await individual.getByLabel('Индивидуальный доступ', { exact: true }).selectOption('allow');
    await individual.getByRole('button', { name: 'Сохранить доступ', exact: true }).click();
    await expect(individual.getByRole('status')).toHaveText('Доступ к играм сохранён.');
    await expect(individual).toContainText('Игры разрешены.');
    await captureLayouts(page, 'teacher-seat-allow');
    await learner.getByRole('button', { name: 'Проверить доступ', exact: true }).click();
    await expect(
      learner.getByRole('button', { name: 'Играть: Шахматы', exact: true }),
    ).toBeEnabled();
    await learner.getByRole('button', { name: 'Играть: Шахматы', exact: true }).click();
    await expect(learner.getByRole('navigation', { name: 'Меню ASA Chess' })).toBeVisible();
    const resumed = await learner.request.get('/api/projects?scope=personal&module=chess');
    expect((await resumed.json()).items.map((item: { id: string }) => item.id)).toEqual([chessId]);
    const stillSafe = await page.request.get(`/api/classrooms/${classroomId}`);
    expect((await stillSafe.json()).classroom.safeModeDefault).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await studentContext.close();
  }
});

function randomKey(): string {
  return `games-admission-${crypto.randomUUID()}`;
}
