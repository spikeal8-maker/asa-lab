import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const evidenceDir = 'e2e/artifacts/classroom-management';

let admin: pg.Pool;
let teacher: SeededTeacher;

async function openClassrooms(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Классы', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Мои классы' })).toBeVisible();
}

test.beforeAll(async () => {
  admin = e2eAdminPool();
  teacher = await seedTeacher(admin, 'classroom-management');
  mkdirSync(evidenceDir, { recursive: true });
});

test.afterAll(async () => {
  await admin.end();
});

test('teacher creates a class, issues a StudentSeat and controls learner access', async ({
  browser,
  page,
}) => {
  const teacherFailures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(page, teacher);
  await openClassrooms(page);

  await page.getByRole('button', { name: 'Создать класс' }).first().click();
  const createDialog = page.getByRole('dialog', { name: 'Создать класс' });
  await createDialog.getByLabel('Название класса').fill('5Б Makers');
  await createDialog.getByLabel('Возраст учеников').selectOption('11-12');
  await createDialog.getByLabel('Электроника').check();
  await createDialog.getByRole('button', { name: 'Создать', exact: true }).click();

  const classCard = page.getByTestId('classroom-card').filter({ hasText: '5Б Makers' });
  await expect(classCard).toContainText('Ученики: 0');
  await classCard.locator('.classroom-row-title').click();

  await expect(page.getByRole('heading', { name: '5Б Makers', level: 1 })).toBeVisible();
  const joinCode = (await page.locator('.classroom-code-chip').innerText()).trim();
  expect(joinCode).toMatch(/^[A-Z2-9]{3} [A-Z2-9]{3} [A-Z2-9]{3}$/);

  /**
   * The code goes on the wall: one screen, nothing but the code, and a square
   * so a camera can do the typing.
   */
  await page.getByRole('button', { name: 'Поделиться классом' }).click();
  const shareScreen = page.getByRole('dialog', { name: `Вход в класс 5Б Makers` });
  await expect(shareScreen.getByTestId('class-share-code')).toHaveText(joinCode);
  await expect(shareScreen.getByTestId('class-join-qr')).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/class-share.png` });
  // The same screen on a phone: a teacher without a projector holds the code up.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(shareScreen.getByTestId('class-share-code')).toBeVisible();
  await page.screenshot({ path: `${evidenceDir}/class-share-phone.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await shareScreen.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(shareScreen).toHaveCount(0);

  await page.getByRole('button', { name: 'Добавить ученика' }).click();
  const studentDialog = page.getByRole('dialog');
  await studentDialog.getByLabel('Имя в списке класса').fill('Алина К.');
  await studentDialog.getByLabel('Имя для входа').fill('alina-k');
  await studentDialog.getByRole('button', { name: 'Добавить', exact: true }).click();

  const studentRow = page.getByRole('row').filter({ hasText: 'Алина К.' });
  await expect(studentRow).toContainText('alina-k');
  await expect(studentRow).toContainText('Ещё не входил');
  await page.screenshot({ path: `${evidenceDir}/teacher-roster.png`, fullPage: true });

  /**
   * The same register on a phone. A teacher walking between desks holds one,
   * so the five-column table has to become a list of cards that fits — nothing
   * may push the page sideways.
   */
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(studentRow).toContainText('Алина К.');
  const overflow = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const document_ = document.documentElement.scrollWidth;
    // Named only when the page really does slide sideways: a tab strip that
    // scrolls inside itself is wider than the screen on purpose.
    const wide =
      document_ <= viewport
        ? []
        : [...document.querySelectorAll<HTMLElement>('body *')]
            .filter((node) => node.getBoundingClientRect().right > viewport + 1)
            .slice(0, 6)
            .map((node) => `${node.tagName.toLowerCase()}.${node.className}`);
    return { document: document_, viewport, wide };
  });
  expect(
    overflow.document,
    `elements past the viewport: ${overflow.wide.join(', ')}`,
  ).toBeLessThanOrEqual(overflow.viewport);
  await page.screenshot({ path: `${evidenceDir}/teacher-roster-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  const studentFailures = collectBrowserFailures(studentPage, {
    allowAnonymousSessionProbe: true,
  });
  await studentPage.goto(`/#/join-class?code=${encodeURIComponent(joinCode)}`);
  await expect(studentPage.getByRole('heading', { name: 'Введите код класса' })).toBeVisible();
  await studentPage.getByRole('button', { name: 'Продолжить' }).click();
  await expect(studentPage.getByText('5Б Makers', { exact: true })).toBeVisible();
  await studentPage.getByLabel('Имя для входа').fill('alina-k');
  await studentPage.getByRole('button', { name: 'Войти в класс' }).click();

  /**
   * A learner lands in the same portal a teacher uses — same header, same
   * sidebar, same pages — with the places a seat has no business in absent:
   * no class to manage, no school to switch to, no account to configure.
   */
  await expect(
    studentPage.getByRole('heading', { name: 'Проектируйте сами, ведите класс, подключите школу' }),
  ).toBeVisible();
  await expect(
    studentPage.getByRole('button', { name: 'Проекты', exact: true }).first(),
  ).toBeVisible();
  await expect(studentPage.getByRole('button', { name: 'Классы', exact: true })).toHaveCount(0);

  await studentPage.getByRole('button', { name: 'Проекты', exact: true }).first().click();
  await expect(studentPage.getByRole('heading', { name: 'Мои проекты' })).toBeVisible();

  // The point of the seat: a learner can make something.
  await studentPage.getByRole('button', { name: 'Создать', exact: true }).first().click();
  await studentPage.getByLabel('Название проекта').fill('Моя модель');
  await studentPage.locator('.module-tile').filter({ hasText: 'ASA 3D' }).click();
  await studentPage.getByRole('dialog').getByRole('button', { name: 'Создать проект' }).click();
  await expect(studentPage.getByTestId('asa3d-viewport')).toBeVisible({ timeout: 30_000 });
  await expect(studentPage.getByTestId('asa3d-viewport')).toHaveAttribute(
    'data-runtime-ready',
    'true',
    { timeout: 30_000 },
  );
  await studentPage.screenshot({ path: `${evidenceDir}/student-editor.png`, fullPage: true });

  await studentPage.getByRole('button', { name: 'ASA Lab' }).first().click();
  await expect(
    studentPage.getByTestId('project-card').filter({ hasText: 'Моя модель' }),
  ).toBeVisible();
  await studentPage.screenshot({ path: `${evidenceDir}/student-home.png`, fullPage: true });

  await page.reload();
  const activeStudentRow = page.getByRole('row').filter({ hasText: 'Алина К.' });
  await expect(activeStudentRow).not.toContainText('Ещё не входил');

  /**
   * The teacher walks from the register into the learner: their works, and
   * what they have been doing. This is the question a teacher arrives with,
   * and the register alone cannot answer it.
   */
  await page.getByRole('button', { name: 'Алина К.' }).first().click();
  await expect(page.getByRole('heading', { name: 'Алина К.', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Работы · 1' })).toBeVisible();
  await expect(page.getByTestId('project-card').filter({ hasText: 'Моя модель' })).toBeVisible();
  await expect(page.getByTestId('classroom-activity')).toContainText('вошёл в класс');
  await expect(page.getByTestId('classroom-activity')).toContainText('создал «Моя модель»');
  /**
   * A response to the work: a badge for the verdict, a comment for the why.
   * The badge lands on the card, where the learner and the teacher both see it
   * without opening anything.
   */
  const work = page.getByTestId('project-card').filter({ hasText: 'Моя модель' });
  await work.hover();
  await work.locator('summary').click();
  await work.getByRole('button', { name: 'Оценить работу' }).click();
  const feedbackDialog = page.getByRole('dialog', { name: 'Отклик: Моя модель' });
  await feedbackDialog.getByRole('button', { name: 'Хорошо' }).click();
  await feedbackDialog.getByLabel('Комментарий').fill('Добавь отверстие под винт.');
  await feedbackDialog.getByRole('button', { name: 'Сохранить отклик' }).click();
  await expect(work).toContainText('Хорошо');
  await page.screenshot({ path: `${evidenceDir}/teacher-sees-student.png`, fullPage: true });

  await page.getByRole('button', { name: '5Б Makers' }).first().click();
  await expect(page.getByRole('heading', { name: '5Б Makers', level: 1 })).toBeVisible();

  // The same record, for the whole class, with the learner named.
  await page.getByRole('button', { name: 'Модерация' }).click();
  await expect(page.getByTestId('classroom-activity')).toContainText('Алина К.');
  await page.getByRole('button', { name: 'Проекты', exact: true }).last().click();
  await expect(page.getByTestId('classroom-activity')).toContainText('Моя модель');
  await page.screenshot({ path: `${evidenceDir}/class-activity.png`, fullPage: true });

  await page.getByRole('button', { name: 'Учащиеся' }).click();
  await page.getByLabel('Действия: Алина К.').click();
  await page.getByRole('button', { name: 'Приостановить доступ' }).click();
  await expect(page.getByText('Доступ приостановлен')).toBeVisible();

  // Suspending the seat ends the session, so the learner is signed out and back
  // at the front door — the same place any ended session leads to.
  await studentPage.reload();
  await expect(studentPage.getByRole('button', { name: 'Войти по коду класса' })).toBeVisible();
  await expect(studentPage.getByRole('heading', { name: 'Мои проекты' })).toHaveCount(0);

  teacherFailures.assertEmpty();
  studentFailures.assertEmpty();
  await studentContext.close();
});
