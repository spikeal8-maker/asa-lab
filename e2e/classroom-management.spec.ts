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

  /**
   * A learner's own picture. There is no upload — a class register full of
   * photographs of children is not a thing to build — so this is a choice from
   * the set the product ships with, and it is the learner's to make.
   */
  await studentPage.locator('.portal-account > summary').click();
  await studentPage.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(studentPage.getByRole('heading', { name: 'Мой профиль' })).toBeVisible();
  await studentPage.getByRole('button', { name: 'Аватар 7', exact: true }).click();
  await expect(studentPage.getByText('Аватар сохранён.')).toBeVisible();
  /**
   * And it is their face everywhere they see themselves — the header and the
   * sidebar, not only the picker. This is the assertion that was missing: the
   * teacher's copy updated, the learner's own did not, and the feature was
   * reported as working because nothing looked at this.
   */
  const chosen = '/assets/avatars/default/avatar-07.webp';
  await expect(studentPage.locator('.portal-sidebar-avatar img')).toHaveAttribute('src', chosen);
  await expect(studentPage.locator('.portal-user-avatar img')).toHaveAttribute('src', chosen);
  // Still theirs after a reload: the session carries it, not the page state.
  await studentPage.reload();
  await expect(studentPage.locator('.portal-sidebar-avatar img')).toHaveAttribute('src', chosen);
  await expect(studentPage.locator('.portal-user-avatar img')).toHaveAttribute('src', chosen);
  await studentPage.screenshot({ path: `${evidenceDir}/student-settings.png`, fullPage: true });

  await page.reload();
  const activeStudentRow = page.getByRole('row').filter({ hasText: 'Алина К.' });
  await expect(activeStudentRow).not.toContainText('Ещё не входил');
  // The teacher sees the face the learner chose, not a grey letter.
  await expect(activeStudentRow.locator('.classroom-seat-avatar')).toHaveAttribute(
    'src',
    '/assets/avatars/default/avatar-07.webp',
  );

  /**
   * And the register tells the truth about when they were here. This used to be
   * written once, at sign-in: a child who typed the code at nine and worked
   * until eleven was reported to their teacher as last seen at nine.
   *
   * The seat is refreshed on use, but only when the stored value has gone stale
   * — a write on every poll would be a write on every keystroke's worth of
   * traffic. So the clock is wound back and the learner does one more thing.
   */
  // By id: earlier runs leave seats with the same login handle in the shared
  // test database, and a query that matches by name would read someone else's.
  const seatRow = await admin.query(
    `SELECT id FROM classroom_student_seats
      WHERE login_handle = 'alina-k' ORDER BY created_at DESC LIMIT 1`,
  );
  const seatId = (seatRow.rows[0] as { id: string }).id;
  const staleAt = new Date(Date.now() - 30 * 60 * 1000);
  await admin.query(`UPDATE classroom_student_seats SET last_active_at = $2 WHERE id = $1`, [
    seatId,
    staleAt,
  ]);
  await studentPage.reload();
  await expect(studentPage.getByRole('heading', { name: 'Мой профиль' })).toBeVisible();
  const fresh = await admin.query(
    `SELECT last_active_at FROM classroom_student_seats WHERE id = $1`,
    [seatId],
  );
  expect((fresh.rows[0] as { last_active_at: Date }).last_active_at.getTime()).toBeGreaterThan(
    staleAt.getTime(),
  );

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

  /**
   * And into the work itself. The owner decided a teacher may open and correct
   * a learner's model, as the reference product allows; the database widens a
   * teacher's reach to the seats of their own classes and no further. This is
   * the part that had never been walked end to end.
   */
  await work.hover();
  await work.getByRole('link', { name: 'Открыть' }).click();
  await expect(page.getByTestId('asa3d-viewport')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('asa3d-viewport')).toHaveAttribute('data-runtime-ready', 'true', {
    timeout: 30_000,
  });
  await page.screenshot({ path: `${evidenceDir}/teacher-in-student-work.png`, fullPage: true });
  // Leaving the work returns to the learner it belongs to, not to the teacher's
  // own project list — which is where this used to land.
  await page.getByRole('button', { name: 'ASA Lab' }).first().click();
  await expect(page.getByRole('heading', { name: 'Алина К.', level: 1 })).toBeVisible();

  /**
   * And the learner reads it. A verdict that only ever appeared on the
   * teacher's copy of the card was a note to nobody: the badge is now on the
   * learner's own card, and the reason behind it is one click away.
   */
  await studentPage.getByRole('button', { name: 'Проекты', exact: true }).first().click();
  const ownWork = studentPage.getByTestId('project-card').filter({ hasText: 'Моя модель' });
  await expect(ownWork).toContainText('Хорошо');
  // The verdict itself opens the note: no hover menu to discover first.
  await ownWork.getByRole('button', { name: 'Хорошо' }).click();
  const note = studentPage.getByRole('dialog', { name: 'Отклик: Моя модель' });
  await expect(note).toContainText('Добавь отверстие под винт.');
  await studentPage.screenshot({ path: `${evidenceDir}/student-reads-feedback.png` });
  await note.getByRole('button', { name: 'Понятно' }).click();

  /**
   * A badge. Not a mark on one model — a fact about the person, with the reason
   * their teacher wrote, which is the half a child remembers.
   */
  await page
    .getByTestId('seat-award-grid')
    .getByRole('button', { name: /Помощник/ })
    .click();
  const awardDialog = page.getByRole('dialog', { name: 'Причина значка' });
  await awardDialog.getByLabel('Причина').fill('За помощь соседу с электроникой.');
  await awardDialog.getByRole('button', { name: 'Выдать значок' }).click();
  await expect(page.getByTestId('seat-award-grid')).toContainText('За помощь соседу');
  await page.screenshot({ path: `${evidenceDir}/teacher-awards.png`, fullPage: true });

  // The learner reads it on their own page, with the reason.
  await studentPage.locator('.portal-account > summary').click();
  await studentPage.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(studentPage.getByTestId('seat-awards-earned')).toContainText('Помощник');
  await expect(studentPage.getByTestId('seat-awards-earned')).toContainText(
    'За помощь соседу с электроникой.',
  );
  await studentPage.screenshot({ path: `${evidenceDir}/student-awards.png`, fullPage: true });

  await page.getByRole('button', { name: '5Б Makers' }).first().click();
  await expect(page.getByRole('heading', { name: '5Б Makers', level: 1 })).toBeVisible();

  // The same record, for the whole class, with the learner named.
  await page.getByRole('button', { name: 'Модерация' }).click();
  await expect(page.getByTestId('classroom-activity')).toContainText('Алина К.');
  await page.getByRole('button', { name: 'Проекты', exact: true }).last().click();
  await expect(page.getByTestId('classroom-activity')).toContainText('Моя модель');
  await page.screenshot({ path: `${evidenceDir}/class-activity.png`, fullPage: true });

  /**
   * Work a teacher sets, and what the class does with it. Both halves matter:
   * the teacher must see who has not opened it, and the learner must be able to
   * say they are done without a teacher guessing from a timestamp.
   */
  await page.getByRole('button', { name: 'Действия', exact: true }).click();
  await page.getByRole('button', { name: 'Новое задание' }).click();
  const assignmentDialog = page.getByRole('dialog', { name: 'Новое задание' });
  await assignmentDialog.getByLabel('Название').fill('Брелок с именем');
  await assignmentDialog.getByLabel('Среда').selectOption({ label: 'ASA 3D' });
  await assignmentDialog.getByLabel('Что нужно сделать').fill('Скруглите углы и подпишите имя.');
  await assignmentDialog.getByRole('button', { name: 'Выдать классу' }).click();
  await expect(page.getByText('Задание «Брелок с именем» выдано классу.')).toBeVisible();
  await expect(page.getByTestId('assignment-list')).toContainText('Работают: 0 из 1');

  // Nobody has opened it, and the register says so by name.
  await page.getByRole('button', { name: 'Брелок с именем' }).click();
  await expect(page.getByTestId('assignment-progress')).toContainText('Не открывал');
  await page.screenshot({ path: `${evidenceDir}/assignment-progress.png`, fullPage: true });

  // The learner finds it on their own home page and starts it: the project is
  // made for them in the environment the teacher chose, and opens.
  await studentPage.getByRole('button', { name: 'ASA Lab' }).first().click();
  const assignmentCard = studentPage
    .getByTestId('seat-assignments')
    .filter({ hasText: 'Брелок с именем' });
  await expect(assignmentCard).toContainText('Скруглите углы и подпишите имя.');
  await studentPage.screenshot({ path: `${evidenceDir}/student-assignment.png`, fullPage: true });
  await assignmentCard.getByRole('button', { name: 'Начать' }).click();
  await expect(studentPage.getByTestId('asa3d-viewport')).toBeVisible({ timeout: 30_000 });

  // And hands it in.
  await studentPage.getByRole('button', { name: 'ASA Lab' }).first().click();
  await assignmentCard.getByRole('button', { name: 'Сдать' }).click();
  await expect(assignmentCard).toContainText('сдано');
  await expect(assignmentCard.getByRole('button', { name: 'Вернуть в работу' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Действия', exact: true }).click();
  await expect(page.getByTestId('assignment-list')).toContainText('Сдали: 1');
  await page.getByRole('button', { name: 'Брелок с именем' }).click();
  await expect(page.getByTestId('assignment-progress')).toContainText('Сдано');
  await expect(
    page.getByTestId('assignment-progress').getByRole('button', { name: 'Открыть работу' }),
  ).toBeVisible();

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
