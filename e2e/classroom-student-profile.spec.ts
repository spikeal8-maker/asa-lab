import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fixture, classId } from './fixtures/classroom-owner';
import type {
  ParticipantGrades,
  ParticipantProfile,
} from '../apps/web/src/classroom-participants-api';

const artifacts = 'e2e/artifacts/owner-preview/student-profile';
const longName = 'Александра Константинопольская-Долгорукова Екатерина Александровна';

async function tabMetrics(rail: Locator) {
  return rail.evaluate((element) => {
    const rail = getComputedStyle(element);
    const button = getComputedStyle(element.querySelector('button')!);
    return {
      rail: {
        minHeight: rail.minHeight,
        padding: rail.padding,
        gap: rail.gap,
        border: rail.border,
        radius: rail.borderRadius,
        background: rail.backgroundColor,
      },
      button: {
        height: button.height,
        padding: button.padding,
        fontSize: button.fontSize,
        lineHeight: button.lineHeight,
        weight: button.fontWeight,
        color: button.color,
        background: button.backgroundColor,
        border: button.border,
        radius: button.borderRadius,
        shadow: button.boxShadow,
      },
    };
  });
}
test.use({ locale: 'ru-RU', timezoneId: 'Europe/Moscow', trace: 'on' });
test.setTimeout(90_000);

async function ownJournal(page: Page) {
  for (const path of ['/api/learning/journal/results', '/api/class-join/journal/results']) {
    await page.route(`**${path}*`, (route) =>
      route.fulfill({
        json: {
          range: {
            from: '2026-10-01',
            to: '2026-10-31',
            today: '2026-10-18',
            timeZone: 'Europe/Moscow',
          },
          offset: 0,
          nextOffset: null,
          items: [],
        },
      }),
    );
  }
}

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
    account?: boolean;
    populated?: boolean;
    named?: boolean;
    moreWorks?: number;
  } = {},
) {
  const state = await fixture(page, options.count ?? 3, {
    status: options.archived ? 'archived' : 'active',
    account: options.account,
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
  for (const student of state.students()) {
    student.safeMode = options.safe ?? true;
    student.status = options.suspended ? 'suspended' : 'active';
  }
  if (options.named) {
    state.students()[1]!.displayLabel = 'Иванов Иван Петрович';
    state.students()[2]!.displayLabel = 'Петрова Анна Сергеевна';
  }
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
    holdGrade: false,
    releaseGrade: () => {},
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
        activity: options.populated
          ? [
              {
                id: 'activity',
                action: 'project.saved',
                seatId,
                seatLabel: student.displayLabel,
                byTeacher: false,
                projectId: 'work-0',
                projectTitle: 'Исследовательская модель',
                count: 2,
                firstAt: '2026-10-10T09:00:00Z',
                at: '2026-10-10T10:00:00Z',
              },
            ]
          : [],
        builtinAwards: [],
        merits: options.populated
          ? [
              {
                id: 'merit',
                title: 'Исследователь',
                description: 'За аккуратный эксперимент',
                granted: true,
                grantedAt: '2026-10-10T10:00:00Z',
              },
            ]
          : [],
        avatars: [],
        helperClasses: [],
      };
      return route.fulfill({ json: data });
    }
    if (kind === 'grades') {
      if (control.holdGrade && seatId === 'seat-0') {
        await new Promise<void>((resolve) => {
          control.releaseGrade = resolve;
        });
        const stale = grades(100, 100, offset, resultOffset);
        stale.journal.columns.forEach((c) => {
          c.category = 'УТЕКШАЯ ОЦЕНКА';
        });
        stale.results.forEach((r) => {
          r.assignment_title = 'УТЕКШИЙ РЕЗУЛЬТАТ';
        });
        return route.fulfill({ json: stale });
      }
      if (control.failGrade) {
        control.failGrade = false;
        return error();
      }
      return route.fulfill({
        json: grades(options.manual ?? 30, options.results ?? 30, offset, resultOffset),
      });
    }
    if (kind === 'assignments')
      return route.fulfill({
        json: {
          items: options.populated
            ? [
                {
                  id: 'assignment',
                  title: 'Практическое исследование',
                  kind: 'project',
                  moduleKey: 'three-d',
                  dueAt: null,
                  assignmentId: 'assignment',
                  courseRunId: null,
                  activityRunId: null,
                  projectId: null,
                  status: 'not_started',
                  canonicalState: null,
                },
              ]
            : [],
          offset: 0,
          nextOffset: null,
        },
      });
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
          items: Array.from({ length: offset === 0 ? 1 : (options.moreWorks ?? 1) }, (_, i) => ({
            id: `work-${offset}-${i}`,
            title: offset === 0 ? 'Открытая модель' : i === 0 ? 'Ожидает проверки' : `Модель ${i}`,
            moduleKey: url.searchParams.get('module') ?? 'three-d',
            status: url.searchParams.get('archive') === 'true' ? 'archived' : 'active',
            createdAt: '2026-10-10T10:00:00Z',
            updatedAt: '2026-10-10T10:00:00Z',
            preview: null,
            snapshotRevision: null,
            submittedAt: null,
            assignment: null,
            feedback: null,
            lastEditedByTeacher: false,
            awaitingReview: offset > 0 && i === 0,
          })),
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
    const acceptedTabs = await tabMetrics(page.locator('.classroom-workspace-tabs'));
    if (options.named) await shot(page, 'open-class-reference-1440');
    await page
      .locator('.classroom-student-name')
      .filter({ hasText: options.long === false ? 'Ученик 01' : longName })
      .click();
    await expect(page.locator('.classroom-student-picker-name')).toHaveText(
      options.long === false ? 'Ученик 01' : longName,
    );
    return acceptedTabs;
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
  // Keyboard checks can leave the viewport at the last card. Reset the capture
  // position so sticky portal chrome is recorded at the top of full-page evidence.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.mouse.move(0, 0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({
    path: `${artifacts}/${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

async function assertPupilHistory(page: Page) {
  const details = page.locator('details').filter({
    has: page.locator('.participant-grades[aria-label="Оценки и история"]'),
  });
  await details.locator(':scope > summary').click();
  await details.getByRole('button', { name: 'История', exact: true }).first().click();
  await expect(details.locator('.participant-history')).toContainText(
    'Исправление с сохранением истории',
  );
  await details.getByRole('button', { name: 'История результата', exact: true }).first().click();
  await expect(details.locator('.participant-history')).toContainText('Полный подробный отзыв');
}

for (const width of [1440, 390, 320]) {
  test(`profile settings and confirmed seat actions stay usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await setup(page, { long: false, manual: 0, results: 0 });
    await state.open();
    const main = page.locator('main.classroom-student');
    const protection = main.getByRole('checkbox', { name: 'Защита: Ученик 01', exact: true });
    const hiddenRoster = page.locator('main.classroom-owner-workspace');
    await expect(hiddenRoster).toBeHidden();
    let releaseSave!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let patchSeen = false;
    await page.route(`**/api/classrooms/${classId}/seats/seat-0`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      patchSeen = true;
      expect(route.request().postDataJSON()).toMatchObject({
        safeMode: false,
        displayLabel: 'Ученик 01',
      });
      await held;
      await route.fallback();
    });
    await protection.click();
    await expect.poll(() => patchSeen).toBe(true);
    await expect(protection).toBeChecked();
    await expect(protection).toBeDisabled();
    releaseSave();
    await expect(protection).not.toBeChecked();
    await expect(protection).toBeEnabled();
    await page.unroute(`**/api/classrooms/${classId}/seats/seat-0`);

    await main.getByRole('button', { name: 'Настройки ученика: Ученик 01', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Настройки ученика: Ученик 01', exact: true });
    await expect(dialog).toBeVisible();
    await expect(hiddenRoster).toBeHidden();
    expect(await dialog.evaluate((node) => node.closest('main[aria-hidden="true"]'))).toBeNull();
    await expect(dialog.getByLabel('Имя в списке класса')).toBeFocused();
    await dialog.getByLabel('Имя в списке класса').fill('Сохранённый ученик');
    await dialog.getByRole('button', { name: 'Выбрать аватар ученика', exact: true }).click();
    await dialog
      .getByRole('button', { name: /^Выбрать: / })
      .first()
      .click();
    await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(main.locator('.classroom-student-picker-name')).toHaveText('Сохранённый ученик');
    expect(state.students()[0]!.avatarKey).not.toBeNull();
    expect(state.mutations.filter((mutation) => mutation.path.endsWith('/seats/seat-0'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: expect.objectContaining({
            displayLabel: 'Сохранённый ученик',
            safeMode: false,
            avatarKey: expect.any(String),
          }),
        }),
      ]),
    );
    await noOverflow(page);

    const actions = () =>
      main.getByRole('button', { name: 'Действия: Сохранённый ученик', exact: true });
    await actions().click();
    await main.getByRole('button', { name: 'Аватары класса', exact: true }).click();
    const avatars = main.getByRole('region', { name: 'Аватары класса', exact: true });
    await expect(avatars).toBeFocused();
    await expect(avatars.locator('.participant-recognition')).toBeVisible();
    await expect(avatars).toContainText('Стандартный аватар выбирается в настройках ученика');
    await main.getByRole('button', { name: 'Все работы', exact: true }).click();

    await page.route(`**/api/classrooms/${classId}/seats/seat-0/code`, async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toMatchObject({
        studentCode: 'NewCode7',
        requestId: expect.any(String),
      });
      Object.assign(state.students()[0]!, { studentCode: 'NewCode7', loginHandle: 'NewCode7' });
      await route.fulfill({ json: { studentCode: 'NewCode7', version: 2, reused: false } });
    });
    expect(await main.textContent()).not.toContain('Aa0000');
    await actions().click();
    await main.getByRole('button', { name: 'Изменить код', exact: true }).click();
    const code = page.locator('.student-code-dialog');
    await expect(code).toBeVisible();
    await code.getByLabel('Код ученика', { exact: true }).fill('NewCode7');
    await code.getByRole('button', { name: 'Сохранить код', exact: true }).click();
    await expect(code).toBeHidden();
    await expect(main.locator('.classroom-student-picker-name')).toHaveText('Сохранённый ученик');
    expect(await main.textContent()).not.toContain('NewCode7');
    await actions().click();
    await main.getByRole('button', { name: 'Карточка доступа', exact: true }).click();
    const cards = page.getByRole('dialog', { name: 'Карточки доступа', exact: true });
    await expect(cards).toBeVisible();
    await expect(cards).toContainText('NewCode7');
    await cards.getByRole('button', { name: 'Закрыть', exact: true }).first().click();

    await actions().click();
    await main.getByRole('button', { name: 'Приостановить доступ', exact: true }).click();
    await expect(main.getByText('Доступ приостановлен', { exact: true })).toBeVisible();
    await expect(
      main.getByRole('checkbox', { name: 'Защита: Сохранённый ученик', exact: true }),
    ).toBeDisabled();
    await actions().click();
    await main.getByRole('button', { name: 'Вернуть доступ', exact: true }).click();
    await expect(main.getByText('Доступ приостановлен', { exact: true })).toHaveCount(0);
    await expect(
      main.getByRole('checkbox', { name: 'Защита: Сохранённый ученик', exact: true }),
    ).toBeEnabled();

    await main.getByRole('button', { name: /Следующий ученик:/ }).click();
    await expect(main.locator('.classroom-student-picker-name')).not.toHaveText(
      'Сохранённый ученик',
    );
    await main.getByRole('button', { name: /^Выбрать ученика:/ }).click();
    await page
      .getByRole('dialog', { name: 'Ученики класса', exact: true })
      .getByRole('button', { name: 'Сохранённый ученик', exact: true })
      .click();
    await expect(main.locator('.classroom-student-picker-name')).toHaveText('Сохранённый ученик');
    await main.getByRole('button', { name: '← К классу', exact: true }).click();
    await expect(hiddenRoster).toBeVisible();
    await expect(
      page.locator('.classroom-student-name').filter({ hasText: 'Сохранённый ученик' }),
    ).toBeVisible();
    expect(state.errors).toEqual([]);
  });
}

test('account seats have no code editor and archived profiles expose no enabled mutations', async ({
  page,
}) => {
  const state = await setup(page, { long: false, archived: true, manual: 0, results: 0 });
  Object.assign(state.students()[0]!, {
    loginMethod: 'account',
    studentCode: null,
    loginHandle: null,
  });
  await state.open();
  const main = page.locator('main.classroom-student');
  await expect(
    main.getByRole('checkbox', { name: 'Защита: Ученик 01', exact: true }),
  ).toBeDisabled();
  await expect(
    main.getByRole('button', { name: 'Настройки ученика: Ученик 01', exact: true }),
  ).toBeDisabled();
  await main.getByRole('button', { name: 'Действия: Ученик 01', exact: true }).click();
  await expect(main.getByRole('button', { name: 'Изменить код', exact: true })).toHaveCount(0);
  for (const name of ['Имя и аватар', 'Карточка доступа', 'Приостановить доступ', 'Аватары класса'])
    await expect(main.getByRole('button', { name, exact: true })).toBeDisabled();
  expect(state.mutations).toEqual([]);
});

test('a pending seat reply cannot change the next pupil and forbidden saves mask the profile', async ({
  page,
}) => {
  const state = await setup(page, { long: false, manual: 0, results: 0 });
  await state.open();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let seen = false;
  await page.route(`**/api/classrooms/${classId}/seats/seat-0`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    seen = true;
    await pending;
    await route.fulfill({
      status: 403,
      json: { error: { code: 'forbidden', message: 'OLD SEAT ERROR' } },
    });
  });
  await page.getByRole('checkbox', { name: 'Защита: Ученик 01', exact: true }).click();
  await expect.poll(() => seen).toBe(true);
  await page.getByRole('button', { name: /Следующий ученик:/ }).click();
  await expect(page.locator('.classroom-student-picker-name')).toHaveText('Ученик 02');
  release();
  await expect(
    page.getByRole('checkbox', { name: 'Защита: Ученик 02', exact: true }),
  ).toBeEnabled();
  await expect(page.getByText(/OLD SEAT ERROR/)).toHaveCount(0);
  await page.route(`**/api/classrooms/${classId}/seats/seat-1`, (route) =>
    route.fulfill({
      status: 403,
      json: { error: { code: 'forbidden', message: 'Доступ запрещён' } },
    }),
  );
  await page.getByRole('checkbox', { name: 'Защита: Ученик 02', exact: true }).click();
  await expect(page.getByText('Доступ к классу закрыт.', { exact: true })).toBeVisible();
  await expect(page.locator('main.classroom-student')).toHaveCount(0);
  await expect(page.locator('.student-code-dialog')).toHaveCount(0);
  expect(state.students()[0]!.safeMode).toBe(true);
  expect(state.students()[1]!.safeMode).toBe(true);
  expect(state.errors).toEqual([]);
});

test('production profile stays compact with long Russian identity on desktop, split-screen, phones and CSS reflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await setup(page, { named: true, manual: 100, results: 100 });
  const acceptedTabs = await state.open();
  const measurements: unknown[] = [];
  const summary = page.getByRole('region', { name: 'Оценки этого класса', exact: true });
  await expect(summary.locator('[data-grade-source="journal"]')).toHaveCount(30);
  for (const width of [1440, 1024, 800, 680, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    const row = page.locator('.classroom-student-navrow');
    const rowBox = await row.boundingBox();
    expect(
      rowBox!.height,
      'UI-01 rail: <=52px at 390, <=56px at 320 and compact on desktop',
    ).toBeLessThanOrEqual(width <= 350 ? 56 : width <= 599 ? 52 : 68);
    await expect(row.getByRole('navigation', { name: 'Переход по ученикам' })).toBeVisible();
    await expect(row.locator('.classroom-student-picker-name')).toHaveText(longName);
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
    const metrics = await tabMetrics(tabs);
    expect(metrics.rail).toEqual(acceptedTabs.rail);
    expect(metrics.button).toEqual({
      ...acceptedTabs.button,
      // The profile's section buttons preserve the mandated >=44px hit target.
      // Open-class tabs retain the same palette/focus language but are shorter.
      height: '44px',
      fontSize: '13px',
      lineHeight: '15.6px',
    });
    const summaryBox = (await summary.boundingBox())!;
    expect(summaryBox.height, 'dense grade overview including paging').toBeLessThanOrEqual(
      width <= 600 ? 100 : 84,
    );
    await expect(page.getByRole('button', { name: /История/ })).toHaveCount(0);
    const names = page.locator('.student-pager-name');
    await expect(names).toHaveText(['Петрова Анна', 'Иванов Иван']);
    for (const name of await names.all()) {
      if (width <= 599) {
        await expect(name).toBeHidden();
      } else {
        await expect(name).toBeVisible();
        expect((await name.boundingBox())!.width).toBeGreaterThan(24);
      }
    }
    await expect(
      page.getByRole('button', { name: 'Предыдущий ученик: Петрова Анна Сергеевна' }),
    ).toHaveAttribute('title', 'Петрова Анна Сергеевна');
    const token = (await summary.locator('li').first().boundingBox())!;
    expect(token.height).toBe(44);
    expect(token.width).toBeLessThanOrEqual(210);
    const value = (await summary.locator('li').first().locator('strong').boundingBox())!;
    expect(value.y).toBeGreaterThanOrEqual(token.y);
    expect(value.y + value.height, 'grade value fits inside its compact token').toBeLessThanOrEqual(
      token.y + token.height,
    );
    expect(value.x).toBeGreaterThanOrEqual(token.x);
    expect(value.x + value.width).toBeLessThanOrEqual(token.x + token.width);
    const toolbar = (await page.locator('.classroom-student-works-head').boundingBox())!;
    expect(toolbar.height).toBeLessThanOrEqual(width <= 600 ? 90 : 44);
    await expect(page.getByRole('combobox', { name: 'Статус работ' })).toHaveAccessibleDescription(
      'по загруженным',
    );
    measurements.push({
      width,
      identityRailHeight: rowBox!.height,
      summaryHeight: summaryBox.height,
      tokenWidth: token.width,
      tokenHeight: token.height,
      toolbarHeight: toolbar.height,
      tabs: metrics,
    });
    expect((await tabs.boundingBox())!.height, 'single row, no giant tab grid').toBeLessThanOrEqual(
      70,
    );
    await expect(tabs.locator('button')).toHaveCount(8);
    for (const tab of await tabs.locator('button').all()) {
      await tab.focus();
      await expect(tab).toBeInViewport();
      const { box, rail } = await tab.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const rail = element.closest('.participant-tabs')!.getBoundingClientRect();
        return {
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          rail: { x: rail.x, y: rail.y, width: rail.width, height: rail.height },
        };
      });
      expect(box.x).toBeGreaterThanOrEqual(rail.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(rail.x + rail.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(rail.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(rail.y + rail.height + 1);
    }
    await tabs.locator('button').first().focus();
    await page.keyboard.press('End');
    await expect(tabs.locator('button').last()).toBeFocused();
    await expect(tabs.locator('button').last()).toBeInViewport();
    await page.keyboard.press('Home');
    await expect(tabs.locator('button').first()).toBeFocused();
    await expect(tabs.locator('button').first()).toBeInViewport();
    await shot(page, `profile-${width}`);
  }
  const rail = summary.getByRole('list', { name: 'Оценки текущего класса' });
  await rail.focus();
  await page.keyboard.press('End');
  await expect(summary.locator('li').last()).toBeInViewport();
  await summary.getByRole('button', { name: 'Предыдущие оценки', exact: true }).click();
  await expect
    .poll(() => rail.evaluate((element) => element.scrollLeft))
    .toBeLessThan(await rail.evaluate((element) => element.scrollWidth - element.clientWidth));
  await rail.focus();
  await page.keyboard.press('Home');
  await expect(summary.locator('li').first()).toBeInViewport();
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(
    `${artifacts}/visual-measurements.json`,
    JSON.stringify({ acceptedTabs, measurements }, null, 2),
  );
  // CSS layout reflow only. Actual browser/device zoom is NOT_RUN by this test.
  await page.setViewportSize({ width: 1024, height: 900 });
  for (const zoom of [1.25, 1.5, 1.75]) {
    await page.evaluate((value) => {
      document.documentElement.style.zoom = String(value);
    }, zoom);
    await noOverflow(page);
    await expect(page.locator('.classroom-student-picker-name')).toHaveText(longName);
    await shot(page, `profile-zoom-${zoom}`);
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = '1';
  });
  await page.getByRole('button', { name: /Следующий ученик:/ }).click();
  await expect(page.locator('.classroom-student-picker-name')).toHaveText('Иванов Иван Петрович');
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const previous = page.getByRole('button', { name: `Предыдущий ученик: ${longName}` });
    await expect(previous).toHaveAttribute('title', longName);
    await expect(previous.locator('.student-pager-name')).toHaveText(
      'Александра Константинопольская-Долгорукова',
    );
    if (width <= 599) await expect(previous.locator('.student-pager-name')).toBeHidden();
    else await expect(previous.locator('.student-pager-name')).toBeVisible();
    await noOverflow(page);
    await shot(page, `long-neighbor-${width}`);
  }
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

for (const count of [0, 1, 30, 100]) {
  test(`all ${count} manual and assignment grades remain accessible without eager fetching`, async ({
    page,
  }) => {
    const state = await setup(page, { manual: count, results: count });
    await state.open();
    const summary = page.getByRole('region', { name: 'Оценки этого класса', exact: true });
    await expect(summary.locator('[data-grade-source="journal"]')).toHaveCount(Math.min(count, 30));
    expect(state.requests.filter((r) => r.kind === 'grades')).toHaveLength(1);
    if (count === 100) {
      state.control.failGrade = true;
      await summary.getByRole('button', { name: 'Ещё результаты', exact: true }).click();
      await expect(summary.getByRole('alert')).toContainText('Временная ошибка');
      await summary.getByRole('button', { name: 'Повторить', exact: true }).click();
      for (let i = 0; i < 3; i++)
        await summary.getByRole('button', { name: 'Ещё ручные оценки', exact: true }).click();
      for (let i = 0; i < 2; i++)
        await summary.getByRole('button', { name: 'Ещё результаты', exact: true }).click();
      await expect(
        summary.getByRole('button', { name: 'Ещё результаты', exact: true }),
      ).toHaveCount(0);
    }
    await expect(summary.locator('[data-grade-source="journal"]')).toHaveCount(count);
    await expect(summary.locator('[data-grade-source="results"]')).toHaveCount(count);
    if (count === 100) {
      const reads = state.requests.filter((request) => request.kind === 'grades');
      expect([...new Set(reads.map((request) => request.offset))].sort((a, b) => a - b)).toEqual([
        0, 30, 60, 90,
      ]);
      expect(
        [...new Set(reads.map((request) => request.resultOffset))].sort((a, b) => a - b),
      ).toEqual([0, 30, 60, 90]);
      for (const label of ['Ручные оценки', 'Результаты заданий']) {
        const rows = summary.locator(
          `[data-grade-source="${label === 'Ручные оценки' ? 'journal' : 'results'}"]`,
        );
        expect(new Set(await rows.allTextContents()).size).toBe(100);
      }
    }
    if (count > 0) {
      await expect(summary.locator('time[datetime="2021-01-01"]').first()).toHaveText('01.01.2021');
      await expect(summary.getByRole('button', { name: /История/ })).toHaveCount(0);
      await expect(summary).toContainText('0 / 10');
    } else await expect(summary).toContainText('Оценок пока нет.');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(summary.locator('[data-grade-source="journal"]')).toHaveCount(count);
    await noOverflow(page);
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
      if (count === 0) expect((await summary.boundingBox())!.height).toBeLessThan(60);
      await shot(page, `grades-${count}-${width}`);
    }
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
    populated: true,
  });
  await state.open();
  await expect(
    page.getByRole('checkbox', { name: `Защита: ${longName}`, exact: true }),
  ).not.toBeChecked();
  const suspended = page.locator('.classroom-student-identity-rail .classroom-student-suspended');
  await expect(suspended).toHaveCount(1);
  await expect(suspended).toHaveText('Доступ приостановлен');
  await expect(suspended).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Роль в классе' })).toHaveValue('helper');
  const tabs = page.getByRole('navigation', { name: 'Разделы профиля' });
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of [
      'Оценки',
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
      await expect(page.getByRole('button', { name: /История/ })).toHaveCount(0);
      await expect(page.getByText('Оценки и история', { exact: true })).toHaveCount(0);
      await noOverflow(page);
      if (name === 'Задания')
        await expect(page.getByRole('region', { name: 'Задания участника' })).toContainText(
          'Практическое исследование',
        );
      else if (name === 'Заслуги')
        await expect(page.locator('.participant-merits')).toContainText('Исследователь');
      else if (name === 'Активность')
        await expect(page.getByTestId('classroom-activity')).toContainText(
          'Исследовательская модель',
        );
      else if (name !== 'Оценки')
        await expect(page.locator('.project-card-grid > li')).toHaveCount(1);
      await shot(page, `tab-${name}-${width}`);
    }
  }
  await expect(page.getByText(/Часть личных работ закрыта/)).toContainText('8 из 10');
  const works = page
    .locator('.classroom-student-section')
    .filter({ has: page.locator('#student-works') });
  await works.getByRole('combobox', { name: 'Статус работ' }).selectOption('awaiting');
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
  await expect(
    page.getByRole('checkbox', { name: `Защита: ${longName}`, exact: true }),
  ).toBeChecked();
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
  await expect(page.locator('.classroom-student-picker-name')).toHaveText('Ученик 03');
  await expect(page.locator('.classroom-student-navigation-position')).toHaveText('3/3');
  await page.getByRole('button', { name: /Следующий ученик:/ }).click();
  await expect(page.locator('.classroom-student-picker-name')).toHaveText('Ученик 01');
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

test('a delayed previous learner grade page cannot populate the next learner', async ({ page }) => {
  const state = await setup(page, { long: false, manual: 100, results: 100 });
  await state.open();
  const summary = page.getByRole('region', { name: 'Оценки этого класса', exact: true });
  state.control.holdGrade = true;
  await summary.getByRole('button', { name: 'Ещё ручные оценки', exact: true }).click();
  await expect
    .poll(() => state.requests.some((r) => r.kind === 'grades' && r.offset === 30))
    .toBe(true);
  await page.getByRole('button', { name: /Следующий ученик:/ }).click();
  await expect(page.locator('.classroom-student-picker-name')).toHaveText('Ученик 02');
  await expect(summary.locator('[data-grade-source="journal"]')).toHaveCount(30);
  state.control.holdGrade = false;
  state.control.releaseGrade();
  await expect(page.getByText(/УТЕКШАЯ ОЦЕНКА|УТЕКШИЙ РЕЗУЛЬТАТ/)).toHaveCount(0);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});

test('manual retraction supersedes earlier revisions across pages, focus refresh and a busy companion stream', async ({
  page,
}) => {
  const state = await setup(page, { manual: 31, results: 100 });
  await page.route(`**/api/classrooms/${classId}/participants/*/grades*`, async (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset'));
    const resultOffset = Number(url.searchParams.get('resultOffset'));
    const data = grades(31, 100, offset, resultOffset);
    const rev1 = { ...grades(1, 0, 0, 0).journal.grades[0]!, value: 5 };
    data.journal.grades = data.journal.grades.filter((grade) => grade.columnId !== 'c0');
    data.journal.grades.push(
      ...(offset ? [{ ...rev1, id: 'rev2', revision: 2, value: null }, rev1] : [rev1]),
    );
    return route.fulfill({ json: data });
  });
  await state.open();
  const summary = page.getByRole('region', { name: 'Оценки этого класса', exact: true });
  const manual = summary.locator('[data-grade-source="journal"]');
  const column = manual.filter({ hasText: 'Урок 0' });
  await expect(column.locator('strong')).toHaveText('5');
  await summary.getByRole('button', { name: 'Ещё ручные оценки', exact: true }).click();
  await expect(column).toHaveCount(1);
  await expect(column.locator('strong')).toHaveText('Отозвана');
  // Results first/last must never reintroduce a repeated rev1 companion page.
  for (let i = 0; i < 3; i++) {
    await summary.getByRole('button', { name: 'Ещё результаты', exact: true }).click();
    await expect(summary.locator('[data-grade-source="results"]')).toHaveCount(
      Math.min(60 + i * 30, 100),
    );
  }
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(manual).toHaveCount(31);
  await expect(column).toHaveCount(1);
  await expect(column.locator('strong')).toHaveText('Отозвана');
  await expect(summary.getByRole('button', { name: /История/ })).toHaveCount(0);
  await noOverflow(page);
  expect(state.errors).toEqual([]);
});

for (const count of [30, 100]) {
  test(`result paging refreshes retracted companions in ${count} loaded manual columns without cursor drift`, async ({
    page,
  }) => {
    const state = await setup(page, { manual: count, results: 100 });
    const calls: number[][] = [];
    let retracted = false;
    const original = { ...grades(1, 0, 0, 0).journal.grades[0]!, value: 5 };
    const latest = {
      ...original,
      id: 'rev2',
      revision: 2,
      value: null,
      publishedAt: '2026-02-01T00:00:00Z',
    };
    await page.route(`**/api/classrooms/${classId}/participants/*/grades*`, async (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get('offset'));
      const resultOffset = Number(url.searchParams.get('resultOffset'));
      calls.push([offset, resultOffset]);
      const data = grades(count, 100, offset, resultOffset);
      // Match SQL 0209: each column is in one date-ordered page; only its
      // latest revision is returned. c0 cannot appear in the offset=90 page.
      data.journal.columns.forEach((column, i) => {
        column.date = new Date(Date.UTC(2026, 0, 100 - offset - i)).toISOString().slice(0, 10);
      });
      data.journal.grades = data.journal.grades.map((g) =>
        g.columnId === 'c0' ? (retracted ? latest : original) : g,
      );
      return route.fulfill({ json: data });
    });
    await page.route(`**/api/classrooms/${classId}/participants/*/history/c0*`, (route) =>
      route.fulfill({
        json: { preset: 'five', items: [latest, original], nextBeforeRevision: null },
      }),
    );
    await state.open();
    const summary = page.getByRole('region', { name: 'Оценки этого класса', exact: true });
    const manual = summary.locator('[data-grade-source="journal"]');
    const column = manual.filter({ hasText: 'Урок 0' });
    await expect(column.locator('strong')).toHaveText('5');
    for (let o = 30; o < count; o += 30) {
      await summary.getByRole('button', { name: 'Ещё ручные оценки', exact: true }).click();
      await expect(manual).toHaveCount(Math.min(o + 30, count));
    }
    const before = calls.length;
    retracted = true;
    await summary.getByRole('button', { name: 'Ещё результаты', exact: true }).click();
    await expect(column.locator('strong')).toHaveText('Отозвана');
    await expect(column).toHaveCount(1);
    await expect(manual).toHaveCount(count);
    expect(calls.slice(before)).toEqual(
      count === 100
        ? [
            [90, 30],
            [0, 30],
            [30, 30],
            [60, 30],
          ]
        : [[0, 30]],
    );
    await expect(
      summary.getByRole('button', { name: 'Ещё ручные оценки', exact: true }),
    ).toHaveCount(0);
    await expect(manual.locator('strong').filter({ hasText: /^0$/ }).first()).toBeVisible();
    await expect(summary.getByRole('button', { name: /История/ })).toHaveCount(0);
    const beforeFocus = calls.length;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(summary.getByRole('status')).toHaveCount(0);
    expect(calls.slice(beforeFocus)).toEqual(
      count === 100
        ? [
            [0, 0],
            [30, 30],
            [60, 0],
            [90, 0],
          ]
        : [
            [0, 0],
            [0, 30],
          ],
    );
    await summary.getByRole('button', { name: 'Ещё результаты', exact: true }).click();
    await expect(summary.getByRole('status')).toHaveCount(0);
    expect(calls.at(-(count === 100 ? 4 : 1))).toEqual([count === 100 ? 90 : 0, 60]);
    await expect(manual).toHaveCount(count);
    await expect(column.locator('strong')).toHaveText('Отозвана');
    await noOverflow(page);
    await shot(page, `repair-companion-retraction-${count}`);
    expect(state.errors).toEqual([]);
  });
}

for (const newerFirst of [true, false]) {
  test(`newest nullable result survives repeated pages and stale focus (newerFirst=${newerFirst})`, async ({
    page,
  }) => {
    const state = await setup(page, { manual: 100, results: 100 });
    const old = {
      ...grades(0, 1, 0, 0).results[0]!,
      display_grade: '5',
      raw_points: 5,
      feedback: 'OLD',
    };
    const latest = {
      ...old,
      display_grade: null,
      raw_points: null,
      max_points: null,
      feedback: 'Снятый текущий результат',
      published_at: '2026-02-01T03:00:00.000002+0300',
    };
    let staleRefresh = false;
    const calls: number[][] = [];
    await page.route(`**/api/classrooms/${classId}/participants/*/grades*`, (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get('offset'));
      const resultOffset = Number(url.searchParams.get('resultOffset'));
      calls.push([offset, resultOffset]);
      const data = grades(100, 100, offset, resultOffset);
      data.results[0] = staleRefresh ? old : (resultOffset === 0) === newerFirst ? latest : old;
      return route.fulfill({ json: data });
    });
    await page.route(`**/api/classrooms/${classId}/participants/*/result-history/a0*`, (route) =>
      route.fulfill({
        json: {
          offset: 0,
          hasMore: false,
          items: [
            {
              id: 'r2',
              revision: 2,
              attempt_number: 1,
              raw_points: null,
              max_points: null,
              feedback: latest.feedback,
              reason: 'Отозвано',
              author: 'Преподаватель',
              published_at: latest.published_at,
            },
            {
              id: 'r1',
              revision: 1,
              attempt_number: 1,
              raw_points: 5,
              max_points: 10,
              feedback: old.feedback,
              reason: null,
              author: 'Преподаватель',
              published_at: old.published_at,
            },
          ],
        },
      }),
    );
    await state.open();
    const summary = page.getByRole('region', { name: 'Оценки этого класса', exact: true });
    const result = summary
      .locator('[data-grade-source="results"]')
      .filter({ hasText: 'Исследование 0' });
    await summary.getByRole('button', { name: 'Ещё результаты', exact: true }).click();
    await expect(result).toHaveCount(1);
    await expect(result.locator('strong')).toHaveText('Без балла');
    staleRefresh = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(summary.getByRole('status')).toHaveCount(0);
    await expect(result.locator('strong')).toHaveText('Без балла');
    await summary.getByRole('button', { name: 'Ещё ручные оценки', exact: true }).click();
    await expect(summary.getByRole('status')).toHaveCount(0);
    expect(calls.at(-1)).toEqual([30, 30]);
    await summary.getByRole('button', { name: 'Ещё результаты', exact: true }).click();
    await expect(summary.getByRole('status')).toHaveCount(0);
    expect(calls.slice(-2)).toEqual([
      [30, 60],
      [0, 60],
    ]);
    await expect(result).toHaveCount(1);
    await expect(result.locator('strong')).toHaveText('Без балла');
    await expect(result).toHaveAttribute('title', new RegExp(latest.feedback));
    await expect(summary.getByRole('button', { name: /История/ })).toHaveCount(0);
    await noOverflow(page);
    await shot(page, `repair-result-retraction-${newerFirst}`);
    expect(state.errors).toEqual([]);
  });
}

test('equal-time conflicting result copies fail closed until canonical retry', async ({ page }) => {
  const state = await setup(page, { manual: 30, results: 100 });
  let canonical = false;
  await page.route(`**/api/classrooms/${classId}/participants/*/grades*`, (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset'));
    const resultOffset = Number(url.searchParams.get('resultOffset'));
    const data = grades(30, 100, offset, resultOffset);
    data.results[0] = {
      ...grades(0, 1, 0, 0).results[0]!,
      display_grade: canonical || resultOffset ? null : '5',
      raw_points: null,
      published_at: resultOffset
        ? '2026-02-01T03:00:00.000001+0300'
        : '2026-02-01T00:00:00.000001Z',
    };
    return route.fulfill({ json: data });
  });
  await state.open();
  const summary = page.getByRole('region', { name: 'Оценки этого класса', exact: true });
  await summary.getByRole('button', { name: 'Ещё результаты', exact: true }).click();
  await expect(summary.getByRole('alert')).toContainText(
    'Не удалось определить актуальный результат',
  );
  await expect(summary.locator('.participant-grade-row')).toHaveCount(0);
  canonical = true;
  await summary.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(summary.getByRole('alert')).toHaveCount(0);
  await expect(summary.locator('[data-grade-source="results"]')).toHaveCount(30);
  await noOverflow(page);
  await shot(page, 'repair-result-conflict-retry');
  expect(state.errors).toEqual([]);
});

for (const invalid of ['2026-02-30T00:00:00Z', '2026-02-01T00:00:00+03:60']) {
  test(`invalid publication ${invalid} hides grades until canonical retry`, async ({ page }) => {
    const state = await setup(page, { manual: 1, results: 1 });
    let canonical = false;
    await page.route(`**/api/classrooms/${classId}/participants/*/grades*`, (route) => {
      const data = grades(1, 1, 0, 0);
      if (!canonical) data.results[0]!.published_at = invalid;
      return route.fulfill({ json: data });
    });
    await state.open();
    const summary = page.getByRole('region', { name: 'Оценки этого класса', exact: true });
    await expect(summary.getByRole('alert')).toContainText(
      'Не удалось определить актуальный результат',
    );
    await expect(summary.locator('.participant-grade-row')).toHaveCount(0);
    canonical = true;
    await summary.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(summary.getByRole('alert')).toHaveCount(0);
    await expect(summary.locator('[data-grade-source="results"]')).toHaveCount(1);
    await noOverflow(page);
    expect(state.errors).toEqual([]);
  });
}

test('mobile work filters share a row and one card fills the grid while multiple cards remain readable', async ({
  page,
}) => {
  const state = await setup(page, { manual: 0, results: 0, moreWorks: 4 });
  await state.open();
  const grid = page.locator('.project-card-grid');
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const card = (await grid.locator(':scope > li').first().boundingBox())!;
    if (width <= 600)
      expect(card.width).toBeGreaterThanOrEqual((await grid.boundingBox())!.width - 2);
    const filters = page.locator('.classroom-student-works-head');
    const archive = (await filters.locator('label').first().boundingBox())!;
    const awaiting = (await filters.locator('.classroom-student-filter').boundingBox())!;
    expect(Math.abs(archive.y - awaiting.y)).toBeLessThanOrEqual(1);
    expect(archive.height).toBeGreaterThanOrEqual(44);
    expect(awaiting.height).toBeGreaterThanOrEqual(44);
    expect(archive.x + archive.width).toBeLessThanOrEqual(awaiting.x);
    await noOverflow(page);
    await shot(page, `work-one-${width}`);
  }
  await page.getByRole('button', { name: 'Ещё работы', exact: true }).click();
  await expect(grid.locator(':scope > li')).toHaveCount(5);
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const boxes = await Promise.all(
      (await grid.locator(':scope > li').all()).map(async (card) => (await card.boundingBox())!),
    );
    if (width === 390) {
      expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThanOrEqual(1);
      expect(boxes[0]!.x + boxes[0]!.width).toBeLessThan(boxes[1]!.x);
    } else if (width === 320)
      expect(boxes[1]!.y).toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height);
    // Reveal each card's actions through its real keyboard focus path. Role
    // locators across the whole grid change indices as hover visibility changes.
    for (const card of await grid.locator(':scope > li').all()) {
      await card.locator('.project-card-title a').focus();
      const link = card.getByRole('link', { name: 'Открыть', exact: true });
      await expect(link).toBeVisible();
      await link.focus();
      const box = (await link.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(await link.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
        true,
      );
    }
    await noOverflow(page);
    await shot(page, `work-multiple-${width}`);
  }
  await page.getByRole('combobox', { name: 'Статус работ' }).selectOption('awaiting');
  await expect(grid.locator(':scope > li')).toHaveCount(1);
  expect((await grid.locator(':scope > li').boundingBox())!.width).toBeGreaterThanOrEqual(
    (await grid.boundingBox())!.width - 2,
  );
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test('pending role mutations cannot repopulate another learner or a logged-out profile; teacher history is unavailable', async ({
  page,
}) => {
  const state = await setup(page, { long: false, manual: 1, results: 1 });
  const roles: Array<{ seatId: string; role: string; release: () => void }> = [];
  await page.route(`**/api/classrooms/${classId}/participants/actions/role`, async (route) => {
    const body = route.request().postDataJSON() as { seatId: string; role: string };
    await new Promise<void>((release) => roles.push({ ...body, release }));
    return route.fulfill({ json: { ok: true } });
  });
  let loggedOut = false;
  await page.route('**/api/auth/me', (route) =>
    loggedOut ? route.fulfill({ json: { authenticated: false } }) : route.fallback(),
  );
  await page.route('**/api/auth/logout', (route) => {
    loggedOut = true;
    return route.fulfill({ json: { ok: true } });
  });
  await state.open();
  await page.getByRole('combobox', { name: 'Роль в классе' }).selectOption('helper');
  await expect.poll(() => roles.length).toBe(1);
  await expect(page.getByRole('button', { name: /История/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Следующий ученик:/ }).click();
  await expect(page.locator('.classroom-student-picker-name')).toHaveText('Ученик 02');
  await expect(page.getByRole('combobox', { name: 'Роль в классе' })).toHaveValue('student');
  const beforeOldReply = state.requests.filter((request) => request.kind === 'profile').length;
  const oldReply = page.waitForResponse((response) =>
    response.url().endsWith('/participants/actions/role'),
  );
  roles[0]!.release();
  await (await oldReply).finished();
  await expect(page.getByRole('combobox', { name: 'Роль в классе' })).toHaveValue('student');
  expect(state.requests.filter((request) => request.kind === 'profile')).toHaveLength(
    beforeOldReply,
  );
  await page.getByRole('combobox', { name: 'Роль в классе' }).selectOption('helper');
  await expect.poll(() => roles.length).toBe(2);
  expect(roles.map(({ seatId, role }) => ({ seatId, role }))).toEqual([
    { seatId: 'seat-0', role: 'helper' },
    { seatId: 'seat-1', role: 'helper' },
  ]);
  await page.locator('.portal-account > summary').click();
  await page.locator('.portal-account').getByRole('button', { name: 'Выход', exact: true }).click();
  await expect(page.locator('main.classroom-student')).toHaveCount(0);
  const beforeLogoutReply = state.requests.length;
  const lastReply = page.waitForResponse((response) =>
    response.url().endsWith('/participants/actions/role'),
  );
  roles[1]!.release();
  await (await lastReply).finished();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('main.classroom-student')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Роль в классе' })).toHaveCount(0);
  expect(state.requests).toHaveLength(beforeLogoutReply);
  expect(state.errors).toEqual([]);
});

test('attended Account classes retain the original compact pupil summary', async ({ page }) => {
  const state = await setup(page, { account: true, manual: 30, results: 30 });
  await ownJournal(page);
  await page.route('**/api/class-join/account/classes', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            seatId: 'seat-0',
            classroomId: classId,
            classroomTitle: 'Мой учебный класс',
            teacherDisplayName: 'Преподаватель',
            openCount: 0,
            unfinishedCount: 0,
          },
        ],
      },
    }),
  );
  await page.goto('/#/classrooms');
  await page.getByRole('button', { name: 'Мой рейтинг и заслуги', exact: true }).click();
  const summary = page.getByRole('region', { name: 'Последние оценки', exact: true });
  await expect(summary.locator('.participant-grade-row')).toHaveCount(6);
  await expect(summary.locator('button')).toHaveCount(0);
  await expect(page.locator('.teacher-profile-grades')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await shot(page, 'account-pupil-default-390');
  await assertPupilHistory(page);
  await shot(page, 'account-pupil-history-390');
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test('SeatResults keeps the original pupil summary and uses only Seat grade reads', async ({
  page,
}) => {
  const pupilSeatId = '40000000-0000-4000-8000-000000000001';
  const state = await fixture(page, 0, { account: true });
  await ownJournal(page);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { authenticated: false } }));
  await page.route('**/api/class-join/me', (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        student: { seatId: pupilSeatId, displayName: 'Ученик', safeMode: true, avatarKey: null },
        classroom: { id: classId, title: 'Мой класс', teacherDisplayName: 'Преподаватель' },
        expiresAt: '2099-01-01T00:00:00Z',
      },
    }),
  );
  await page.route('**/api/class-join/participants/me', (route) =>
    route.fulfill({
      json: {
        status: 'active',
        student: {
          id: pupilSeatId,
          displayLabel: 'Ученик',
          avatarKey: null,
          status: 'active',
          safeMode: true,
          lastActiveAt: null,
        },
        settings: {
          revision: 0,
          periodDays: 30,
          factors: { projects: true, logins: true, days: true, time: true, grades: true },
        },
        metrics: {
          seatId: pupilSeatId,
          totalWorks: 0,
          archivedWorks: 0,
          score: 0,
          rank: 1,
          role: 'student',
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
      },
    }),
  );
  let seatReads = 0,
    teacherReads = 0;
  await page.route('**/api/classrooms/*/participants/*/grades*', (route) => {
    teacherReads++;
    return route.abort();
  });
  await page.route('**/api/class-join/participants/grades*', (route) => {
    seatReads++;
    const data = grades(30, 30, 0, 0);
    data.journal.grades = data.journal.grades.map((grade) => ({ ...grade, seatId: pupilSeatId }));
    return route.fulfill({ json: data });
  });
  await page.route('**/api/class-join/participants/history/*', (route) =>
    route.fulfill({
      json: {
        preset: 'five',
        nextBeforeRevision: null,
        items: [
          {
            ...grades(1, 0, 0, 0).journal.grades[0],
            seatId: pupilSeatId,
            revision: 2,
            reason: 'Исправление с сохранением истории',
          },
        ],
      },
    }),
  );
  await page.route('**/api/class-join/participants/result-history/*', (route) =>
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
  await page.goto('/#/classrooms');
  const summary = page.getByRole('region', { name: 'Последние оценки', exact: true });
  await expect(summary.locator('.participant-grade-row')).toHaveCount(6);
  await expect(summary.locator('button')).toHaveCount(0);
  await expect(page.locator('.teacher-profile-grades')).toHaveCount(0);
  expect(seatReads).toBeGreaterThan(0);
  expect(teacherReads).toBe(0);
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await shot(page, 'seat-pupil-default-390');
  await assertPupilHistory(page);
  await shot(page, 'seat-pupil-history-390');
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});
