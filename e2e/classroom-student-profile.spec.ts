import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixture, classId } from './fixtures/classroom-owner';
import type {
  ParticipantGrades,
  ParticipantProfile,
} from '../apps/web/src/classroom-participants-api';

const artifacts = 'e2e/artifacts/owner-preview/student-profile';
const longName = 'Александра Константинопольская-Долгорукова Екатерина Александровна';
test.use({ locale: 'ru-RU', timezoneId: 'Europe/Moscow', trace: 'on' });
test.setTimeout(90_000);

function grades(
  manual: number,
  results: number,
  offset: number,
  resultOffset: number,
): ParticipantGrades {
  const ids = Array.from(
    { length: Math.min(30, Math.max(0, manual - offset)) },
    (_, i) => i + offset,
  );
  return {
    journal: {
      offset,
      nextOffset: offset + 30 < manual ? offset + 30 : null,
      columns: ids.map((i) => ({
        id: `c${i}`,
        date: `202${(i % 5) + 1}-01-01`,
        category: `Урок ${i}`,
        preset: 'five',
      })),
      grades: ids.map((i) => ({
        id: `g${i}`,
        columnId: `c${i}`,
        seatId: 'seat-0',
        revision: 1,
        value: i === 1 ? null : i % 6,
        reason: null,
        authorName: 'Преподаватель',
        publishedAt: '2026-01-01T23:30:00Z',
      })),
    },
    resultOffset,
    nextResultOffset: resultOffset + 30 < results ? resultOffset + 30 : null,
    results: Array.from({ length: Math.min(30, Math.max(0, results - resultOffset)) }, (_, i) => ({
      assignment_id: `a${i + resultOffset}`,
      assignment_title: `Исследование ${i + resultOffset}`,
      raw_points: i === 1 ? null : 0,
      max_points: 10,
      display_grade: null,
      published_at: '2026-01-01T23:30:00Z',
      feedback: 'Комментарий к опубликованному результату',
    })),
  };
}

async function setup(
  page: Page,
  options: {
    manual?: number;
    results?: number;
    count?: number;
    archived?: boolean;
    safe?: boolean;
    helper?: boolean;
    suspended?: boolean;
    long?: boolean;
  } = {},
) {
  const state = await fixture(page, options.count ?? 3, {
    status: options.archived ? 'archived' : 'active',
  });
  // Legacy request-error diagnostics are receipts, never classroom mutations.
  await page.route('**/api/diagnostics/client', (route) =>
    route.fulfill({ status: 202, json: { accepted: true } }),
  );
  await page.route('**/api/modules', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            moduleKey: 'three-d',
            moduleVersion: '1',
            displayName: '3D',
            shortDescription: 'Модели',
            defaultProjectTitlePrefix: 'Модель',
            projectType: 'scene',
            schemaVersion: 1,
            editorRoute: '',
            viewerRoute: '',
            safeModeSupported: true,
            availability: 'active',
            previewKind: 'scene',
            iconKey: 'cube',
            categories: [],
            creatable: true,
          },
        ],
      },
    }),
  );
  if (options.long !== false) state.students()[0]!.displayLabel = longName;
  const requests: Array<{
    kind: string;
    seat: string;
    offset: number;
    resultOffset: number;
    archive?: boolean;
    module?: string | null;
  }> = [];
  const control = {
    failGrade: false,
    failWorks: false,
    failProfile: false,
    holdProfile: false,
    release: () => {},
  };
  await page.route(`**/api/classrooms/${classId}/participants/*/*`, async (route) => {
    const url = new URL(route.request().url());
    const kind = url.pathname.split('/').at(-1)!;
    const seatId = url.pathname.split('/').at(-2)!;
    const student = state.students().find((s) => s.id === seatId);
    if (!student) return route.fallback();
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const resultOffset = Number(url.searchParams.get('resultOffset') ?? 0);
    requests.push({
      kind,
      seat: seatId,
      offset,
      resultOffset,
      archive: url.searchParams.get('archive') === 'true',
      module: url.searchParams.get('module'),
    });
    const error = () =>
      route.fulfill({
        status: 503,
        json: { error: { code: 'temporary', message: 'Временная ошибка страницы' } },
      });
    if (kind === 'profile') {
      if (control.holdProfile)
        await new Promise<void>((resolve) => {
          control.release = resolve;
        });
      if (control.failProfile) {
        control.failProfile = false;
        return error();
      }
      const data: ParticipantProfile = {
        status: options.archived ? 'archived' : 'active',
        student: {
          ...student,
          status: options.suspended ? 'suspended' : 'active',
          safeMode: options.safe ?? true,
        },
        settings: {
          revision: 0,
          periodDays: 30,
          factors: { projects: true, logins: true, days: true, time: true, grades: true },
        },
        metrics: {
          seatId,
          totalWorks: 10,
          archivedWorks: 1,
          score: 39.05,
          rank: 1,
          role: options.helper ? 'helper' : 'student',
          avatarUrl: null,
          factors: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
          sources: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
        },
        submittedCount: 0,
        awaitingReview: 0,
        activity: [],
        builtinAwards: [],
        merits: [],
        avatars: [],
        helperClasses: [],
      };
      return route.fulfill({ json: data });
    }
    if (kind === 'grades') {
      if (control.failGrade) {
        control.failGrade = false;
        return error();
      }
      return route.fulfill({
        json: grades(options.manual ?? 30, options.results ?? 30, offset, resultOffset),
      });
    }
    if (kind === 'assignments')
      return route.fulfill({ json: { items: [], offset: 0, nextOffset: null } });
    if (kind === 'builtin-awards') return route.fulfill({ json: { items: [] } });
    if (kind === 'works') {
      if (control.failWorks) {
        control.failWorks = false;
        return error();
      }
      return route.fulfill({
        json: {
          totalWorks: 10,
          visibleWorks: 8,
          filteredWorks: 8,
          offset,
          hasMore: offset === 0,
          items: [
            {
              id: `work-${offset}`,
              title: offset === 0 ? 'Открытая модель' : 'Ожидает проверки',
              moduleKey: 'three-d',
              status: url.searchParams.get('archive') === 'true' ? 'archived' : 'active',
              createdAt: '2026-10-10T10:00:00Z',
              updatedAt: '2026-10-10T10:00:00Z',
              preview: null,
              snapshotRevision: null,
              submittedAt: null,
              assignment: null,
              feedback: null,
              lastEditedByTeacher: false,
              awaitingReview: offset > 0,
            },
          ],
        },
      });
    }
    return route.fallback();
  });
  await page.route(`**/api/classrooms/${classId}/participants/*/history/*`, (route) =>
    route.fulfill({
      json: {
        preset: 'five',
        items: [
          {
            ...grades(1, 0, 0, 0).journal.grades[0],
            revision: 2,
            reason: 'Исправление с сохранением истории',
          },
        ],
        nextBeforeRevision: null,
      },
    }),
  );
  await page.route(`**/api/classrooms/${classId}/participants/*/result-history/*`, (route) =>
    route.fulfill({
      json: {
        offset: 0,
        hasMore: false,
        items: [
          {
            id: 'revision',
            revision: 2,
            attempt_number: 1,
            raw_points: 0,
            max_points: 10,
            reason: 'Уточнение',
            feedback: 'Полный подробный отзыв',
            author: 'Преподаватель',
            published_at: '2026-01-01T23:30:00Z',
          },
        ],
      },
    }),
  );
  async function open() {
    await page.goto('/#/classrooms/' + classId);
    await expect(page.locator('.classroom-roster-row')).toHaveCount(options.count ?? 3);
    await page
      .locator('.classroom-student-name')
      .filter({ hasText: options.long === false ? 'Ученик 01' : longName })
      .click();
    await expect(page.locator('.classroom-student-identity h1')).toHaveText(
      options.long === false ? 'Ученик 01' : longName,
    );
  }
  return { ...state, requests, control, open };
}

async function noOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: document.documentElement.clientWidth,
    main: document.querySelector('main.classroom-student')!.scrollWidth,
    client: document.querySelector('main.classroom-student')!.clientWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1);
  expect(sizes.main).toBeLessThanOrEqual(sizes.client + 1);
}
async function shot(page: Page, name: string) {
  mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true });
}

test('production profile stays compact with long Russian identity on desktop, split-screen, phones and zoom', async ({
  page,
}) => {
  const state = await setup(page);
  await state.open();
  const summary = page.getByRole('region', { name: 'Оценки этого класса', exact: true });
  await expect(
    summary.getByRole('list', { name: 'Ручные оценки', exact: true }).locator('li'),
  ).toHaveCount(30);
  for (const width of [1440, 1024, 800, 680, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    const row = page.locator('.classroom-student-navrow');
    const rowBox = await row.boundingBox();
    expect(rowBox!.height, 'one slim navigation row').toBeLessThanOrEqual(46);
    const hero = await page.locator('.participant-hero').boundingBox();
    expect(
      hero!.y - (rowBox!.y + rowBox!.height),
      'navigation adjacent to identity',
    ).toBeLessThanOrEqual(12);
    for (const target of await row.locator('button').all()) {
      const box = await target.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    const tabs = page.getByRole('navigation', { name: 'Разделы профиля' });
    expect((await tabs.boundingBox())!.height, 'single row, no giant tab grid').toBeLessThanOrEqual(
      70,
    );
    await expect(tabs.locator('button')).toHaveCount(8);
    for (const tab of await tabs.locator('button').all()) {
      await tab.focus();
      await expect(tab).toBeInViewport();
    }
    await tabs.locator('button').first().focus();
    await page.keyboard.press('End');
    await expect(tabs.locator('button').last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tabs.locator('button').first()).toBeFocused();
    await shot(page, `profile-${width}`);
  }
  // CSS zoom exercises real layout reflow, not a raster resize or device scale.
  await page.setViewportSize({ width: 1024, height: 900 });
  for (const zoom of [1.25, 1.5, 1.75]) {
    await page.evaluate((value) => {
      document.documentElement.style.zoom = String(value);
    }, zoom);
    await noOverflow(page);
    await expect(page.locator('.classroom-student-identity h1')).toHaveText(longName);
    await shot(page, `profile-zoom-${zoom}`);
  }
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

for (const count of [0, 1, 30, 100]) {
  test(`all ${count} manual and assignment grades remain accessible without eager fetching`, async ({
    page,
  }) => {
    const state = await setup(page, { manual: count, results: count === 100 ? 31 : count });
    await state.open();
    const summary = page.getByRole('region', { name: 'Оценки этого класса', exact: true });
    await expect(
      summary.getByRole('list', { name: 'Ручные оценки', exact: true }).locator('li'),
    ).toHaveCount(Math.min(count, 30));
    expect(state.requests.filter((r) => r.kind === 'grades')).toHaveLength(1);
    if (count === 100) {
      state.control.failGrade = true;
      await summary.getByRole('button', { name: 'Ещё результаты', exact: true }).click();
      await expect(summary.getByRole('alert')).toContainText('Временная ошибка');
      await summary.getByRole('button', { name: 'Повторить', exact: true }).click();
      for (let i = 0; i < 3; i++)
        await summary.getByRole('button', { name: 'Ещё ручные оценки', exact: true }).click();
      await expect(
        summary.getByRole('button', { name: 'Ещё результаты', exact: true }),
      ).toHaveCount(0);
    }
    await expect(
      summary.getByRole('list', { name: 'Ручные оценки', exact: true }).locator('li'),
    ).toHaveCount(count);
    await expect(
      summary.getByRole('list', { name: 'Результаты заданий', exact: true }).locator('li'),
    ).toHaveCount(count === 100 ? 31 : count);
    if (count > 0) {
      await expect(summary.locator('time[datetime="2021-01-01"]').first()).toHaveText('01.01.2021');
      await summary.getByRole('button', { name: 'История', exact: true }).first().click();
      await expect(summary).toContainText('Исправление с сохранением истории');
      await summary
        .getByRole('button', { name: 'История результата', exact: true })
        .first()
        .click();
      await expect(summary).toContainText('Полный подробный отзыв');
      await expect(summary).toContainText('0 / 10');
    } else await expect(summary).toContainText('Оценок пока нет.');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      summary.getByRole('list', { name: 'Ручные оценки', exact: true }).locator('li'),
    ).toHaveCount(count);
    await noOverflow(page);
    await shot(page, `grades-${count}`);
    expect(state.errors).toEqual([]);
  });
}

test('all eight sections, honest loaded-only filtering, private works, archive and failed next-page retry', async ({
  page,
}) => {
  const state = await setup(page, {
    safe: false,
    helper: true,
    suspended: true,
    manual: 1,
    results: 1,
  });
  await state.open();
  await expect(page.getByText('Защита выключена', { exact: true })).toBeVisible();
  await expect(page.getByText('Доступ приостановлен', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Роль в классе' })).toHaveValue('helper');
  const tabs = page.getByRole('navigation', { name: 'Разделы профиля' });
  for (const name of [
    'Оценки и история',
    'Задания',
    '3D',
    'Электроника',
    'Scratch',
    'Заслуги',
    'Активность',
    'Все работы',
  ]) {
    await tabs.getByRole('button', { name, exact: true }).click();
    await expect(tabs.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await noOverflow(page);
  }
  await expect(page.getByText(/Часть личных работ закрыта/)).toContainText('8 из 10');
  const works = page
    .locator('.classroom-student-section')
    .filter({ has: page.locator('#student-works') });
  await works
    .getByRole('button', { name: 'Ждут проверки · среди загруженных', exact: true })
    .click();
  await expect(works).toContainText(
    'Среди загруженных работ нет ожидающих проверки. Загрузите ещё работы.',
  );
  state.control.failWorks = true;
  await works.getByRole('button', { name: 'Ещё работы', exact: true }).click();
  await works.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(works.getByText('Ожидает проверки', { exact: true })).toBeVisible();
  expect(
    state.requests
      .filter((r) => r.kind === 'works')
      .slice(-2)
      .map((r) => r.offset),
  ).toEqual([30, 30]);
  await works.getByLabel('Включая архив').check();
  await expect
    .poll(() => state.requests.filter((r) => r.kind === 'works').at(-1)?.archive)
    .toBe(true);
  expect(state.requests.filter((r) => r.kind === 'works').at(-1)?.offset).toBe(0);
  await noOverflow(page);
  await shot(page, 'loaded-only-archive-helper-suspended');
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test('single learner is disabled, archived is read-only, profile loading/error/retry remains usable', async ({
  page,
}) => {
  const state = await setup(page, { count: 1, archived: true, manual: 0, results: 0 });
  state.control.holdProfile = true;
  await page.goto('/#/classrooms/' + classId);
  await page.locator('.classroom-student-name').click();
  await expect(page.getByRole('status').filter({ hasText: 'Загружаем профиль' })).toBeVisible();
  await shot(page, 'profile-loading');
  state.control.failProfile = true;
  state.control.holdProfile = false;
  state.control.release();
  await expect(page.getByRole('alert')).toContainText('Временная ошибка');
  await shot(page, 'profile-error');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.classroom-student-navigation button:disabled')).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Роль в классе' })).toBeDisabled();
  await expect(page.getByText('Защита включена', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Класс в архиве. Изменения недоступны.', { exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await shot(page, 'profile-archived-empty');
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test('previous/next wrap and return to the exact journal context including month, search, category and mode', async ({
  page,
}) => {
  const state = await setup(page, { long: false, manual: 0, results: 0 });
  await page.goto('/#/classrooms/' + classId);
  await page.getByRole('button', { name: 'Журнал', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Поиск ученика' });
  const month = page.getByLabel('Месяц журнала', { exact: true });
  const category = page.getByRole('combobox', { name: 'Категория', exact: true });
  await search.fill('Ученик 01');
  await month.fill('2025-10');
  if ((await category.locator('option').count()) > 1) await category.selectOption({ index: 1 });
  const savedCategory = await category.inputValue();
  await page
    .locator('.manual-journal .classroom-journal-student-link')
    .filter({ hasText: 'Ученик 01' })
    .click();
  await expect(page.locator('.classroom-student-navigation-position')).toHaveText('1/3');
  await page.getByRole('button', { name: /Предыдущий ученик:/ }).click();
  await expect(page.locator('.classroom-student-identity h1')).toHaveText('Ученик 03');
  await expect(page.locator('.classroom-student-navigation-position')).toHaveText('3/3');
  await page.getByRole('button', { name: /Следующий ученик:/ }).click();
  await expect(page.locator('.classroom-student-identity h1')).toHaveText('Ученик 01');
  await page.getByRole('button', { name: '← К классу', exact: true }).click();
  await expect(month).toHaveValue('2025-10');
  await expect(search).toHaveValue('Ученик 01');
  await expect(category).toHaveValue(savedCategory);
  await expect(page.getByRole('button', { name: 'По датам', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});
