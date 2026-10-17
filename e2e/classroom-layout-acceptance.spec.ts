import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fixture, classId } from './fixtures/classroom-owner';
import { classroomTextDefects } from './classroom-readable-text';

// Visual acceptance of the built React application. All data below is synthetic;
// this suite never claims real-database, authorization or classroom-load evidence.
const out = 'e2e/artifacts/owner-preview/classroom-layout-final';
const names = [
  'Александра Иванова',
  'Григорий Белов',
  'Мария Соколова',
  'Илья Громов',
  'Арина Кузнецова',
  'Даниил Морозов',
  'Елизавета Петрова',
  'Михаил Лебедев',
  'Анастасия Павлова',
  'Роман Волков',
  'Дарья Алексеева',
  'Артём Семёнов',
  'Софья Новикова',
  'Никита Фёдоров',
  'Вероника Михайлова-Смирнова',
];
const sections = [
  ['Ученики', 'students'],
  ['Обучение', 'learning'],
  ['Журнал', 'journal'],
  ['Проекты', 'projects'],
  ['История', 'history'],
  ['Преподаватели', 'teachers'],
  ['Заявки', 'requests'],
  ['Настройки', 'settings'],
] as const;
test.use({ locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
test.setTimeout(90_000);

async function seedPresentation(page: Page, populated: boolean) {
  const state = await fixture(page, populated ? 15 : 0, {
    classes: populated ? 23 : 1,
    sidebar: 'expanded',
  });
  state.students().forEach((row, i) => {
    row.displayLabel = names[i]!;
    row.assignedCount = 8;
    row.submittedCount = 3 + (i % 4);
    row.awaitingReview = i % 3;
  });
  const students = state.students();
  let requests = populated
    ? names.slice(0, 4).map((name, i) => ({
        id: `request-${i}`,
        classroom_id: classId,
        classroom_title: '7А Робототехника',
        display_label: name,
        status: i === 3 ? 'approved' : 'pending',
        reason: i === 3 ? 'Вы приняты в класс. Добро пожаловать!' : null,
      }))
    : [];
  const works = populated
    ? [
        ['Исследование электрической цепи', 'electronics', false],
        ['Опора для сервопривода', 'three-d', true],
        ['Игра «Лабиринт»', 'blocks', false],
        ['Датчик освещённости', 'electronics', true],
        ['Корпус мобильного робота', 'three-d', false],
        ['Анимация движения планет', 'blocks', true],
      ].map(([title, moduleKey, assigned], i) => ({
        id: `visual-work-${i}`,
        seatId: students[i]!.id,
        student: students[i]!.displayLabel,
        avatarKey: null,
        title,
        moduleKey,
        assigned,
        status: 'active',
        updatedAt: `2026-10-12T${String(12 - i).padStart(2, '0')}:25:00Z`,
      }))
    : [];
  const actions = [
    'project.saved',
    'seat.signed_in',
    'project.created',
    'seat.signed_out',
    'assignment.submitted',
    'project.renamed',
  ];
  const events = works.map((work, i) => ({
    id: `event-${i}`,
    seatId: work.seatId,
    student: work.student,
    action: actions[i],
    byTeacher: false,
    projectId: work.id,
    projectTitle: i === 1 || i === 3 ? null : work.title,
    at: work.updatedAt,
    count: 1,
  }));
  const columns = populated
    ? [0, 1, 2].map((i) => ({
        id: `grade-column-${i}`,
        date: `2026-10-${String(9 + i).padStart(2, '0')}`,
        category: ['Работа 1', 'Практика', 'Самостоятельная работа'][i],
        preset: 'five',
        scaleVersion: 1,
        headerRevision: 0,
      }))
    : [];
  const grades = students.flatMap((student, i) =>
    columns.flatMap((column, j) =>
      i % 5 === 4
        ? []
        : [
            {
              id: `grade-${i}-${j}`,
              columnId: column.id,
              seatId: student.id,
              revision: 1,
              value: (i + j) % 6,
              reason: null,
              authorName: 'Преподаватель',
              publishedAt: '2026-10-12T08:00:00Z',
            },
          ],
    ),
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    if (path === '/api/classrooms/observation/summary') {
      const input = request.postDataJSON() as { classroomIds: string[] };
      const items = input.classroomIds.map((id, index) =>
        id === classId
          ? {
              classroomId: id,
              averageRating: students.length > 0 ? 10.5 : null,
              ratingParticipants: students.length,
              ratingPeriodDays: 30,
              students: students.length,
              works: works.length,
              assigned: students.reduce((n, student) => n + student.assignedCount, 0),
              submitted: students.reduce((n, student) => n + student.submittedCount, 0),
              waiting: students.reduce((n, student) => n + student.awaitingReview, 0),
              notSubmitted: students.filter(
                (student) => student.assignedCount > 0 && student.submittedCount === 0,
              ).length,
            }
          : {
              classroomId: id,
              averageRating: null,
              ratingParticipants: 0,
              ratingPeriodDays: 30,
              students: 13 + (index % 3),
              works: 22 + index * 2,
              assigned: 40 + index,
              submitted: 12 + index,
              waiting: index % 4,
              notSubmitted: index % 3,
            },
      );
      const totals = {
        students: 0,
        works: 0,
        assigned: 0,
        submitted: 0,
        waiting: 0,
        notSubmitted: 0,
      };
      for (const item of items)
        for (const key of Object.keys(totals) as Array<keyof typeof totals>)
          totals[key] += item[key];
      return reply({ items, totals });
    }
    if (path.startsWith('/api/class-join/requests')) {
      if (request.method() === 'POST' && path.endsWith('/decision')) {
        const id = path.split('/').at(-2),
          body = request.postDataJSON() as {
            decision: string;
            reason?: string;
          };
        requests = requests.map((item) =>
          item.id === id ? { ...item, status: body.decision, reason: body.reason ?? null } : item,
        );
        return reply({ ok: true });
      }
      return reply({ items: requests });
    }
    if (path === `/api/classrooms/${classId}/observation/projects`) {
      const module = url.searchParams.get('module') || url.searchParams.get('moduleKey'),
        learner = url.searchParams.get('learner'),
        assignment = url.searchParams.get('assignment'),
        q = (url.searchParams.get('search') ?? '').toLocaleLowerCase('ru');
      const items = works.filter(
        (w) =>
          (!module || w.moduleKey === module) &&
          (!learner || w.seatId === learner) &&
          (!assignment || (assignment === 'assigned') === w.assigned) &&
          (!q || String(w.title).toLocaleLowerCase('ru').includes(q)),
      );
      return reply({
        total: items.length,
        hidden: 0,
        offset: 0,
        nextOffset: null,
        items,
        learners: students.map((s) => ({ id: s.id, label: s.displayLabel })),
      });
    }
    if (path === `/api/classrooms/${classId}/observation/history`) {
      const category = url.searchParams.get('category'),
        learner = url.searchParams.get('learner');
      const items = events.filter(
        (e) =>
          (!learner || learner === e.seatId) &&
          (!category ||
            category === 'all' ||
            (category === 'access'
              ? e.action?.startsWith('seat.')
              : e.action?.startsWith('project.'))),
      );
      return reply({
        nextCursor: null,
        items,
        learners: students.map((s) => ({ id: s.id, label: s.displayLabel })),
      });
    }
    if (path === `/api/classrooms/${classId}/journal` && request.method() === 'GET')
      return reply({
        status: 'active',
        timeZone: 'Europe/Moscow',
        scale: { preset: 'five', version: 1 },
        students: students.map((s) => ({
          id: s.id,
          name: s.displayLabel,
          status: s.status,
        })),
        columns,
        grades,
        offset: 0,
        nextOffset: null,
        range: {
          from: '2026-10-01',
          to: '2026-10-31',
          today: '2026-10-12',
          timeZone: 'Europe/Moscow',
        },
      });
    if (path === `/api/classrooms/${classId}/grading-scheme` && request.method() === 'GET')
      return reply({
        title: populated ? 'Пятибалльная шкала' : '',
        version: populated ? 1 : null,
        bands: populated
          ? [
              { minBasisPoints: 0, label: '2' },
              { minBasisPoints: 6000, label: '3' },
              { minBasisPoints: 8000, label: '4' },
              { minBasisPoints: 9000, label: '5' },
            ]
          : [],
      });
    if (path === `/api/classrooms/${classId}/course-runs`)
      return reply({
        items: populated
          ? [
              {
                id: 'run-visual',
                title: 'Основы робототехники',
                summary: 'Датчики, механика и программы',
                versionNumber: 1,
                status: 'open',
                dueAt: '2026-10-30T12:00:00Z',
                publishedAt: '2026-10-01T09:00:00Z',
                startedCount: 10,
                submittedCount: 6,
                sections: [
                  {
                    id: 'section-visual',
                    title: 'Первый робот',
                    lessons: [
                      {
                        id: 'lesson-visual',
                        title: 'Знакомство с датчиками',
                        kind: 'material',
                        content: 'Датчики помогают роботу наблюдать окружающий мир.',
                        blocks: [],
                        seatCount: 15,
                        completedCount: 8,
                      },
                    ],
                  },
                ],
              },
            ]
          : [],
      });
    if (path === '/api/courses' && !populated) return reply({ items: [] });
    return route.fallback();
  });
  return state;
}

async function section(page: Page, name: string) {
  await expect(page.locator('.classroom-tabbar')).toBeVisible();
  const select = page.getByLabel('Раздел класса', { exact: true });
  if (await select.isVisible()) await select.selectOption({ label: name });
  else
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name, exact: true })
      .click();
}
async function photograph(page: Page, file: string, expectedPanel: string) {
  await expect(page.locator(expectedPanel).first()).toBeVisible();
  await expect
    .poll(async () =>
      page.locator('[aria-busy=true]').evaluateAll(
        (nodes) =>
          nodes.filter((el) =>
            (el as HTMLElement).checkVisibility({
              checkVisibilityCSS: true,
              checkOpacity: true,
            }),
          ).length,
      ),
    )
    .toBe(0);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
  });
  const measure = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('.portal-content')!;
    const checks = [...main.querySelectorAll<HTMLElement>('button,input,select,textarea')].filter(
      (el) =>
        el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
        !el.closest('.manual-journal-scroll,.sr-only,.dropdown-menu') &&
        !['checkbox', 'radio'].includes(el.getAttribute('type') ?? ''),
    );
    const outside = checks
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < -1 || r.right > innerWidth + 1;
      })
      .map((el) => ({
        text: el.textContent?.slice(0, 45),
        label: el.getAttribute('aria-label'),
        rect: el.getBoundingClientRect().toJSON(),
      }));
    return {
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      mainWidth: main.clientWidth,
      mainScrollWidth: main.scrollWidth,
      overflowCandidates: [...main.querySelectorAll<HTMLElement>('*')]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          const parent = main.getBoundingClientRect();
          return (
            el.checkVisibility() && (box.right > parent.right + 0.5 || box.left < parent.left - 0.5)
          );
        })
        .slice(0, 12)
        .map((el) => ({
          element: el.tagName.toLowerCase(),
          className: typeof el.className === 'string' ? el.className.slice(0, 100) : '',
          content: el.textContent?.trim().slice(0, 40),
          left: el.getBoundingClientRect().left,
          right: el.getBoundingClientRect().right,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        })),
      outside,
      clippedClassDates: [
        ...main.querySelectorAll<HTMLElement>('.classroom-list-row .classroom-row-date'),
      ]
        .filter((el) => el.checkVisibility() && el.scrollWidth > el.clientWidth + 1)
        .map((el) => ({
          text: el.textContent,
          available: el.clientWidth,
          required: el.scrollWidth,
        })),
      rosterIdentityOverlaps: [
        ...main.querySelectorAll<HTMLElement>('.classroom-roster-row'),
      ].flatMap((row) => {
        const index = row.querySelector<HTMLElement>('.classroom-roster-index');
        const avatar = row.querySelector<HTMLElement>('.classroom-seat-avatar');
        if (!index || !avatar || !avatar.checkVisibility()) return [];
        const range = document.createRange();
        range.selectNodeContents(index);
        const numberBox = range.getBoundingClientRect(),
          imageBox = avatar.getBoundingClientRect();
        return Math.min(numberBox.right, imageBox.right) - Math.max(numberBox.left, imageBox.left) >
          0.5 &&
          Math.min(numberBox.bottom, imageBox.bottom) - Math.max(numberBox.top, imageBox.top) > 0.5
          ? [
              {
                number: index.textContent?.trim(),
                numberBox: numberBox.toJSON(),
                imageBox: imageBox.toJSON(),
              },
            ]
          : [];
      }),
    };
  });
  const textDefects = await classroomTextDefects(page);
  await page.screenshot({ path: `${out}/${file}.png`, fullPage: true });
  expect.soft(textDefects, `Actual caption/value/checkbox collisions: ${file}`).toEqual([]);
  writeFileSync(`${out}/${file}.json`, JSON.stringify(measure, null, 2));
  expect.soft(measure.documentWidth, file).toBeLessThanOrEqual(measure.width + 1);
  expect
    .soft(measure.mainScrollWidth, file + JSON.stringify(measure.overflowCandidates))
    .toBeLessThanOrEqual(measure.mainWidth + 1);
  expect.soft(measure.outside, file).toEqual([]);
  expect
    .soft(measure.clippedClassDates, 'Dates must fit as one readable line: ' + file)
    .toEqual([]);
  expect
    .soft(measure.rosterIdentityOverlaps, 'Pupil row numbers must not cover avatar images: ' + file)
    .toEqual([]);
}

test('classroom name search filters cards without changing the teacher totals', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await seedPresentation(page, true);
  await page.goto('/#/classrooms');
  const search = page.getByRole('searchbox', {
    name: 'Поиск класса по названию',
  });
  const classes = page.getByTestId('classroom-card');
  const totalClasses = page.locator('.classroom-title-row .classroom-metrics strong').first();
  await expect(classes).toHaveCount(23);
  await expect(totalClasses).toHaveText('23');
  await search.fill('7А Робототехника');
  await expect(classes).toHaveCount(1);
  await expect(classes.first()).toContainText('7А Робототехника');
  await expect(totalClasses).toHaveText('23');
  await search.fill('Такого класса не существует');
  await expect(classes).toHaveCount(0);
  await expect(page.getByText('Классы не найдены. Измените поисковый запрос.')).toBeVisible();
  await search.clear();
  await expect(classes).toHaveCount(23);
  await expect(totalClasses).toHaveText('23');
});

for (const width of [320, 390, 1024, 1440]) {
  for (const populated of [false, true]) {
    test(`all classroom screens ${width}px ${populated ? 'populated' : 'empty'}`, async ({
      page,
    }) => {
      mkdirSync(out, { recursive: true });
      await page.setViewportSize({ width, height: 1000 });
      const state = await seedPresentation(page, populated),
        prefix = `${width}-${populated ? 'filled' : 'empty'}`;
      await page.goto('/#/classrooms');
      await photograph(page, `${prefix}-classes`, '.classroom-owner-list');
      await expect(page.locator('.classroom-title-row .classroom-metrics')).toBeVisible();
      const ratedClass = page
        .locator('.classroom-row-rating .classroom-stat-number')
        .filter({ hasText: '10,5' });
      if (populated) await expect(ratedClass).toHaveCount(1);
      else await expect(ratedClass).toHaveCount(0);
      await expect(page.getByRole('searchbox', { name: 'Поиск класса по названию' })).toBeVisible();
      await page.goto(`/#/classrooms/${classId}`);
      for (const [label, key] of sections) {
        await section(page, label);
        const target =
          key === 'students'
            ? '.classroom-roster-panel'
            : key === 'projects'
              ? '.classroom-observation'
              : key === 'history'
                ? '.classroom-observation'
                : key === 'requests'
                  ? '.learning-join-requests'
                  : '.classroom-tab-panel';
        await photograph(page, `${prefix}-${key}`, target);
        if (key === 'students' && populated)
          await expect(page.locator('.classroom-roster-row .classroom-login-handle')).toHaveText(
            Array(15).fill('******'),
          );
        if (key === 'journal') {
          await expect(page.locator('.manual-journal-column')).toHaveCount(10);
          if (populated) {
            await expect(page.locator('.manual-journal-cell[data-slot-key=""]').first()).toHaveText(
              '0',
            );
            await page.locator('.manual-journal-cell[data-slot-key=""]').first().click();
            await photograph(page, `${prefix}-journal-editor`, '.manual-journal-editor');
            await page.keyboard.press('Escape');
          }
        }
        if (key === 'learning' && populated) {
          await page.getByRole('button', { name: 'Добавить курс', exact: true }).click();
          await photograph(page, `${prefix}-learning-assignment`, '.classroom-course-assign');
          await page.getByRole('radio', { name: 'Выбранные ученики', exact: true }).check();
          await photograph(page, `${prefix}-learning-audience`, '.learning-assign-field');
        }
        if (key === 'projects' && populated)
          await expect(page.locator('.observation-projects > li')).toHaveCount(6);
        if (key === 'history' && populated)
          await expect(page.locator('.observation-history > li')).toHaveCount(6);
        if (key === 'requests' && populated) {
          await expect(page.locator('.learning-join-requests > ul > li')).toHaveCount(4);
          await page
            .getByLabel('Ответ ученику (необязательно)', { exact: true })
            .first()
            .fill('Добро пожаловать на занятия!');
          await photograph(page, `${prefix}-request-reply`, '.classroom-request-actions');
          await page.getByRole('button', { name: 'Принять заявку', exact: true }).first().click();
          await expect(page.locator('[data-request-status=approved]')).toHaveCount(2);
        }
      }
      expect(state.errors).toEqual([]);
    });
  }
}

// Intermediate phone/tablet widths complete the owner's seven-width acceptance matrix.
// This uses the built React bundle and the same synthetic fixture as the main suite.
for (const width of [360, 430, 768]) {
  test(`class list, pupil roster and journal at ${width}px`, async ({ page }) => {
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    const state = await seedPresentation(page, true);
    await page.goto('/#/classrooms');
    await photograph(page, `${width}-filled-classes`, '.classroom-owner-list');
    await page.goto(`/#/classrooms/${classId}`);
    await section(page, 'Ученики');
    await photograph(page, `${width}-filled-students`, '.classroom-roster-panel');
    await section(page, 'Журнал');
    await expect(page.locator('.manual-journal-column')).toHaveCount(10);
    await photograph(page, `${width}-filled-journal`, '.manual-journal');
    const nameWidth = await page
      .locator('.manual-journal tbody tr > th:first-child')
      .first()
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(nameWidth).toBeGreaterThanOrEqual(120);
    expect(nameWidth).toBeLessThanOrEqual(222);
    expect(state.errors).toEqual([]);
  });
}

test('teacher compact class list remains readable with sidebar and on phones', async ({ page }) => {
  const state = await seedPresentation(page, true);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/#/classrooms');
    const cards = page.getByTestId('classroom-card');
    await expect(cards).toHaveCount(23);
    await expect(
      page.locator('.classroom-row-students .classroom-stat-number').first(),
    ).not.toHaveText('—');

    const measure = await cards.first().evaluate((element) => {
      const row = element as HTMLElement;
      const labels = [...row.querySelectorAll<HTMLElement>('.classroom-stat-label')].filter(
        (item) => item.checkVisibility(),
      );
      const numbers = [...row.querySelectorAll<HTMLElement>('.classroom-stat-number')].filter(
        (item) => item.checkVisibility(),
      );
      return {
        height: row.getBoundingClientRect().height,
        containerWidth: row.closest<HTMLElement>('main')?.clientWidth ?? innerWidth,
        smallestLabel: labels.length
          ? Math.min(...labels.map((item) => parseFloat(getComputedStyle(item).fontSize)))
          : null,
        smallestNumber: numbers.length
          ? Math.min(...numbers.map((item) => parseFloat(getComputedStyle(item).fontSize)))
          : null,
      };
    });
    const maxHeight = width >= 1440 ? 65 : width >= 768 ? 135 : 150;
    expect(measure.height, 'Class card should be dense at ' + width + 'px').toBeLessThan(maxHeight);
    if (measure.containerWidth < 680) {
      expect(measure.smallestLabel, 'Class metric captions at ' + width + 'px').not.toBeNull();
      expect(
        measure.smallestLabel!,
        'Class metric captions at ' + width + 'px',
      ).toBeGreaterThanOrEqual(11);
      expect(
        measure.smallestNumber!,
        'Class metric values at ' + width + 'px',
      ).toBeGreaterThanOrEqual(13);
    } else {
      expect(measure.smallestLabel).toBeNull();
      await expect(
        page.getByRole('button', { name: 'Сортировать по колонке «Ученики»' }),
      ).toBeVisible();
    }
  }

  // A 320px code chip must never squeeze "← Мои классы" under it.
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto('/#/classrooms/' + classId);
  await expect(page.getByRole('button', { name: '← Мои классы' })).toBeVisible();
  const back = await page.locator('.classroom-head-compact .classroom-back').boundingBox();
  const actions = await page.locator('.classroom-head-compact .classroom-head-code').boundingBox();
  expect(back).not.toBeNull();
  expect(actions).not.toBeNull();
  expect(
    back!.y + back!.height,
    '320px class navigation must not overlap the join code',
  ).toBeLessThanOrEqual(actions!.y + 1);
  const sectionSwitch = page.getByRole('combobox', { name: 'Раздел класса' });
  await expect(sectionSwitch).toBeVisible();
  await expect(sectionSwitch.locator('option')).toHaveCount(8);
  expect(state.errors).toEqual([]);
});
