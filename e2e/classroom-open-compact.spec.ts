import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixture, classId } from './fixtures/classroom-owner';

const path = 'e2e/artifacts/owner-preview/open-class-compact';
const widths = [320, 390, 540, 680, 768, 900, 1024, 1440, 1920, 2560, 3840] as const;

test.use({ locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
test.setTimeout(120_000);

type ClassroomFixtureState = Awaited<ReturnType<typeof fixture>>;

async function installParticipantProfileRoutes(
  page: Page,
  state: ClassroomFixtureState,
): Promise<void> {
  await page.route('**/api/classrooms/' + classId + '/participants/*/grades*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        journal: { offset: 0, nextOffset: null, columns: [], grades: [] },
        resultOffset: 0,
        nextResultOffset: null,
        results: [],
      }),
    }),
  );
  await page.route('**/api/classrooms/' + classId + '/participants/*/profile', (route) => {
    const seatId = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const student = state.students().find((item) => item.id === seatId)!;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        helperClasses: [],
        status: 'active',
        student: {
          id: student.id,
          displayLabel: student.displayLabel,
          avatarKey: student.avatarKey ?? null,
          status: student.status,
          safeMode: student.safeMode,
          lastActiveAt: student.lastActiveAt,
        },
        settings: {
          periodDays: 30,
          revision: 0,
          factors: { projects: true, logins: true, days: true, time: true, grades: true },
        },
        metrics: {
          seatId: student.id,
          totalWorks: 0,
          archivedWorks: 0,
          score: 0,
          rank: 1,
          role: 'student',
          avatarUrl: null,
          factors: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
          sources: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
        },
        activity: [],
        builtinAwards: [],
        submittedCount: 0,
        awaitingReview: 0,
        merits: [],
        avatars: [],
      }),
    });
  });
}

test('open teacher class uses compact controls without losing pupils', async ({ page }) => {
  mkdirSync(path, { recursive: true });
  const state = await fixture(page, 15, { classes: 23, sidebar: 'expanded' });
  await installParticipantProfileRoutes(page, state);
  await page.goto('/#/classrooms/' + classId);
  await expect(page.locator('.classroom-roster-row')).toHaveCount(15);
  await expect(page.getByRole('button', { name: 'Добавить ученика', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить списком', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Карточки доступа', exact: true })).toBeVisible();

  for (const width of widths) {
    await page.setViewportSize({ width, height: 920 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const bounds = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('main.teacher-open-compact')!;
      const rows = [...main.querySelectorAll<HTMLElement>('.classroom-roster-row')];
      const box = (s: string) => {
        const el = main.querySelector<HTMLElement>(s)!;
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      const metrics = box('.teacher-class-status .classroom-metrics');
      const identity = box('.teacher-class-identity');
      return {
        documentWidth: document.documentElement.scrollWidth,
        mainWidth: main.clientWidth,
        mainContentWidth:
          main.clientWidth -
          parseFloat(getComputedStyle(main).paddingLeft) -
          parseFloat(getComputedStyle(main).paddingRight),
        mainScrollWidth: main.scrollWidth,
        firstRowHeight: rows[0]?.getBoundingClientRect().height,
        identity,
        metrics,
        tabbar: box('.classroom-tabbar'),
        roster: box('.classroom-roster-table'),
        pupilName: box('.classroom-student-name'),
        pupilCode: box('.classroom-row-details .classroom-login-handle'),
        actions: box('.classroom-roster-actions'),
      };
    });
    expect(bounds.documentWidth, width + ': horizontal page overflow').toBeLessThanOrEqual(
      width + 1,
    );
    expect(bounds.mainScrollWidth, width + ': horizontal workspace overflow').toBeLessThanOrEqual(
      bounds.mainWidth + 1,
    );
    if (bounds.mainContentWidth >= 680) {
      expect(bounds.pupilCode.height, width + ': compact table code').toBeLessThanOrEqual(30);
    } else {
      expect(bounds.pupilCode.height, width + ': accessible phone code').toBeGreaterThanOrEqual(44);
    }
    expect(bounds.firstRowHeight, width + ': roster density').toBeLessThanOrEqual(
      width > 1920 ? 60 : bounds.mainContentWidth >= 680 ? 40 : 110,
    );
    expect(bounds.pupilName.width, width + ': clickable pupil name').toBeGreaterThanOrEqual(80);
    if (width === 3840) {
      const font = await page
        .locator('.classroom-student-name strong')
        .first()
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
      expect(font).toBeGreaterThanOrEqual(19.9);
    }
    await page.screenshot({ path: path + '/open-class-' + width + '.png', fullPage: false });
    await expect(page.getByRole('button', { name: 'Добавить ученика', exact: true })).toBeVisible();
    if (bounds.mainContentWidth <= 679) {
      await expect(page.getByRole('combobox', { name: 'Раздел класса' })).toBeVisible();
    } else {
      await expect(page.getByRole('navigation', { name: 'Разделы класса' })).toBeVisible();
    }
  }

  await page.setViewportSize({ width: 390, height: 900 });
  const name = await page.locator('.classroom-student-name strong').first().innerText();
  await page.locator('.classroom-student-name').first().click();
  await expect(page.getByRole('heading', { name, exact: false })).toBeVisible();
  await page.getByRole('button', { name: '← К классу' }).click();
  await expect(page.locator('.classroom-roster-row')).toHaveCount(15);
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test('teacher can open participant from journal without editing a grade', async ({ page }) => {
  const state = await fixture(page, 15, { classes: 23, sidebar: 'expanded' });
  // Fixture only mocks the journal. Complete a real-shaped profile for this
  // navigation test instead of hiding errors or modifying shared fixtures.
  await installParticipantProfileRoutes(page, state);
  await page.goto('/#/classrooms/' + classId);
  await page.getByRole('button', { name: 'Журнал', exact: true }).click();
  await expect(page.locator('.manual-journal tbody tr')).toHaveCount(15);
  const nameButton = page.locator('.manual-journal .classroom-journal-student-link').first();
  await expect(nameButton).toBeVisible();
  const label = (await nameButton.innerText()).trim();
  await nameButton.click();
  await expect(page.getByRole('heading', { name: label, exact: false })).toBeVisible();
  await page.getByRole('button', { name: '← К классу' }).click();
  await expect(page.locator('.manual-journal tbody tr')).toHaveCount(15);
  for (const width of [390, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const dimensions = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('main.teacher-open-compact')!;
      const matrix = document.querySelector<HTMLElement>('.manual-journal-scroll')!;
      return {
        page: document.documentElement.scrollWidth,
        main: shell.scrollWidth,
        mainClient: shell.clientWidth,
        matrix: matrix.scrollWidth,
        matrixClient: matrix.clientWidth,
      };
    });
    expect(dimensions.page, 'Journal page overflow at ' + width).toBeLessThanOrEqual(width + 1);
    expect(dimensions.main, 'Journal shell overflow at ' + width).toBeLessThanOrEqual(
      dimensions.mainClient + 1,
    );
    expect(dimensions.matrix, 'Local journal table scroll at ' + width).toBeGreaterThan(
      dimensions.matrixClient,
    );
    await page.screenshot({ path: path + '/journal-' + width + '.png', fullPage: false });
  }
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test('assigned journal learner names navigate to the teacher profile', async ({ page }) => {
  const state = await fixture(page, 15, { classes: 23, sidebar: 'expanded' });
  await installParticipantProfileRoutes(page, state);
  const student = state.students()[0]!;
  await page.route('**/api/classrooms/' + classId + '/gradebook', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        gradingScheme: null,
        items: [
          {
            seatId: student.id,
            displayLabel: student.displayLabel,
            assignmentId: 'assignment-ui-link',
            assignmentTitle: 'Проверка перехода в профиль',
            attemptId: null,
            attemptNumber: null,
            state: 'not_started',
            submittedAt: null,
            points: null,
            maxPoints: 100,
            percentage: null,
            displayGrade: null,
            outcome: null,
            feedback: null,
            publishedAt: null,
            canonicalState: null,
            compatibilityDiagnostic: null,
          },
        ],
      }),
    }),
  );
  await page.goto('/#/classrooms/' + classId);
  await page.getByRole('button', { name: 'Журнал', exact: true }).click();
  await page.getByRole('button', { name: 'Задания', exact: true }).click();
  const link = page.locator('.gradebook-matrix .classroom-journal-student-link').first();
  await expect(link).toBeVisible();
  await expect(link).toHaveText(student.displayLabel);
  await link.click();
  await expect(
    page.getByRole('heading', { name: student.displayLabel, exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: '← К классу' }).click();
  await expect(page.getByRole('button', { name: 'Журнал', exact: true })).toBeVisible();
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});
