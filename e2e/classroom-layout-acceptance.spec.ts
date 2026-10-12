import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fixture, classId } from './fixtures/classroom-owner';

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
    if (path.startsWith('/api/class-join/requests')) {
      if (request.method() === 'POST' && path.endsWith('/decision')) {
        const id = path.split('/').at(-2),
          body = request.postDataJSON() as { decision: string; reason?: string };
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
        students: students.map((s) => ({ id: s.id, name: s.displayLabel, status: s.status })),
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
      page
        .locator('[aria-busy=true]')
        .evaluateAll(
          (nodes) =>
            nodes.filter((el) =>
              (el as HTMLElement).checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }),
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
      outside,
    };
  });
  await page.screenshot({ path: `${out}/${file}.png`, fullPage: true });
  writeFileSync(`${out}/${file}.json`, JSON.stringify(measure, null, 2));
  expect.soft(measure.documentWidth, file).toBeLessThanOrEqual(measure.width + 1);
  expect.soft(measure.mainScrollWidth, file).toBeLessThanOrEqual(measure.mainWidth + 1);
  expect.soft(measure.outside, file).toEqual([]);
}

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
