import { expect, test, type Page } from '@playwright/test';
import type { ClassroomElectronicsSimulation } from '@asa-lab/contracts';
import { createEmptyThreeDDocument, createThreeDNode } from '../contexts/three-d/domain/document';
import { EMPTY_DOCUMENT } from '../contexts/electronics/domain/document';
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

for (const width of [320, 1440]) {
  test(`teacher copies the authorized exact version and opens it privately at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page, 1);
    const pupil = state.students()[0]!;
    const assigned = width === 1440;
    const moduleKey = assigned ? 'three-d' : 'electronics';
    const projectId = '10000000-0000-4000-8000-000000000081';
    const copyId = '10000000-0000-4000-8000-000000000082';
    const title = 'Работа для частной копии';
    const copyTitle = `${title} — копия`;
    const attemptId = '10000000-0000-4000-8000-000000000083';
    const submissionId = '10000000-0000-4000-8000-000000000084';
    const projectVersionId = '10000000-0000-4000-8000-000000000085';
    const source = assigned
      ? { kind: 'submission', attemptId, submissionId, projectVersionId }
      : { kind: 'free', revision: 6 };
    const document = assigned
      ? { ...createEmptyThreeDDocument(), nodes: [createThreeDNode('box', 'copy-box')] }
      : {
          ...EMPTY_DOCUMENT,
          components: [
            {
              id: 'copy-board',
              kind: 'visual',
              componentTypeId: 'arduino-uno',
              variantId: 'arduino-uno',
              position: { x: 80, y: 80 },
              value: 0,
            },
          ],
        };
    const root = `/api/classrooms/${classId}`;
    const projectPath = `${root}/observation/learners/${pupil.id}/projects/${projectId}`;
    const copyPath = `${projectPath}/private-copy`;
    const commands: Array<{ key: string | undefined; body: unknown }> = [];
    let allowed = false;
    let releaseFirst = () => {};
    const firstResponse = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const copy = {
      id: copyId,
      moduleKey,
      title: copyTitle,
      scope: 'personal',
      classroomId: null,
      status: 'active',
      privateClassroomCopy: true,
      updatedAt: '2026-10-12T12:00:00Z',
      createdAt: '2026-10-12T12:00:00Z',
      preview: null,
      snapshotRevision: null,
      copiedFrom: null,
    };
    const sourceMutations: string[] = [];
    await page.route('**/projects/*/electronics/edit?*', (route) =>
      route.fulfill({ path: 'apps/web/dist/index.html' }),
    );
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === root + '/observation/projects')
        return route.fulfill({
          json: {
            items: [
              {
                id: projectId,
                seatId: pupil.id,
                student: pupil.displayLabel,
                avatarKey: null,
                title,
                moduleKey,
                assigned,
                status: 'active',
                updatedAt: copy.updatedAt,
              },
            ],
            total: 1,
            hidden: 0,
            nextOffset: null,
            learners: [],
          },
        });
      if (url.pathname === projectPath + '/free-preview')
        return route.fulfill({
          json: { projectId, revision: 6, moduleKey, document, preview: null },
        });
      if (url.pathname === projectPath + '/review')
        return route.fulfill({
          json: {
            assignmentId: 'copy-assignment',
            activityRunId: 'copy-run',
            attemptId,
            submissionId,
            projectVersionId,
            canReview: true,
          },
        });
      if (url.pathname === root + '/attempts/' + attemptId + '/submission')
        return route.fulfill({
          json: {
            kind: 'project',
            submissionId,
            projectVersionId,
            sourceRevision: 6,
            digest: 'copy-digest',
            moduleKey,
            document,
            preview: null,
          },
        });
      if (url.pathname === copyPath && request.method() === 'GET') {
        expect(Object.fromEntries(url.searchParams)).toEqual(
          Object.fromEntries(Object.entries(source).map(([key, value]) => [key, String(value)])),
        );
        return route.fulfill({ json: { canCopy: allowed } });
      }
      if (url.pathname === copyPath && request.method() === 'POST') {
        commands.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
        if (commands.length === 1) {
          await firstResponse;
          return route.fulfill({
            status: 503,
            json: { error: { code: 'network_error', message: 'Ответ недоступен.' } },
          });
        }
        return route.fulfill({
          status: 201,
          json: { projectId: copyId, moduleKey, created: true },
        });
      }
      if (url.pathname === '/api/projects/' + copyId && request.method() === 'GET')
        return route.fulfill({
          json: {
            project: copy,
            draft: { projectId: copyId, document, revision: 1, updatedAt: copy.updatedAt },
            versions: [],
            result: null,
          },
        });
      if (url.pathname === '/api/projects') return route.fulfill({ json: { items: [copy] } });
      if (url.pathname.includes(projectId) && request.method() !== 'GET')
        sourceMutations.push(request.method() + ' ' + url.pathname);
      return route.fallback();
    });
    await page.goto('/#/classrooms/' + classId);
    await section(page, 'Проекты');
    const card = page.getByRole('button', { name: 'Предпросмотр работы ' + title });
    const dialog = page.getByRole('dialog', { name: 'Работа: ' + title });
    const copyAction = dialog.getByRole('button', { name: 'Копировать в «Мои проекты»' });
    const denied = page.waitForResponse(
      (response) => new URL(response.url()).pathname === copyPath,
    );
    await card.click();
    await denied;
    await expect(copyAction).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(card).toBeFocused();
    allowed = true;
    await card.press('Enter');
    await expect(copyAction).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Открыть в редакторе' })).toBeVisible();
    if (assigned) await expect(dialog.getByRole('button', { name: 'Оценить сдачу' })).toBeVisible();
    try {
      await copyAction.press('Enter');
      await expect(dialog.getByRole('button', { name: 'Копируем…' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      releaseFirst();
      await expect(dialog.getByRole('alert')).toHaveText('Ответ недоступен.');
      await dialog.getByRole('button', { name: 'Повторить копирование' }).press('Enter');
      const open = dialog.getByRole('button', { name: 'Открыть копию', exact: true });
      await expect(open).toBeFocused();
      expect(commands).toEqual([{ key: expect.any(String), body: source }, commands[0]]);
      expect(
        await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      mkdirSync(out, { recursive: true });
      await page.screenshot({ path: `${out}/${width}-teacher-private-copy.png` });
      await open.press('Enter');
      await expect(page).toHaveURL(new RegExp(copyId));
      if (moduleKey === 'three-d') {
        await expect(page.locator('.asa3d-workspace')).toBeVisible();
        await expect(
          page
            .locator('.asa3d-actions')
            .getByRole('button', { name: 'История', exact: true, includeHidden: true }),
        ).toHaveCount(1);
        await expect(page.locator('.asa3d-export-wrap')).toHaveCount(0);
        await expect(
          page
            .locator('.asa3d-actions')
            .getByRole('button', { name: 'Публикация', includeHidden: true }),
        ).toHaveCount(0);
      } else {
        await expect(page.locator('.workbench-shell')).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Отправить — пока недоступно', includeHidden: true }),
        ).toHaveCount(0);
        await page.getByRole('button', { name: 'Схемы', exact: true }).click();
        await expect(
          page.getByRole('button', { name: 'Скачать PDF', includeHidden: true }),
        ).toHaveCount(0);
        await page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
        await expect(page.locator('.arduino-code-panel.open .arduino-code-toolbar')).toBeVisible();
        await expect(page.getByTitle('Скачать .ino')).toHaveCount(0);
      }
      await page.goto('/#/projects');
      const copyCard = page.getByTestId('project-card').filter({ hasText: copyTitle });
      await expect(copyCard.getByText('Свойства', { exact: true })).toHaveCount(1);
      if (width === 1440) {
        await copyCard.getByLabel('Действия с проектом ' + copyTitle).click();
        await expect(copyCard.getByText('Свойства', { exact: true })).toBeVisible();
      }
      await expect(copyCard.getByText('Публикация', { exact: true })).toHaveCount(0);
      await expect(copyCard.getByText('Дублировать', { exact: true })).toHaveCount(0);
      expect(sourceMutations).toEqual([]);
      expect(state.errors).toEqual([]);
    } finally {
      releaseFirst();
    }
  });
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

for (const width of [320, 390, 1440]) {
  test(`journal has one vertical scroll for 30 pupils at ${width}px`, async ({ page }) => {
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page, 30, { sidebar: 'expanded' });
    let assignmentCount = 2;
    await page.route('**/api/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      const root = `/api/classrooms/${classId}`;
      if (pathname === root + '/journal' && route.request().method() === 'GET') {
        return route.fulfill({
          json: {
            status: 'active',
            timeZone: 'Europe/Moscow',
            scale: { preset: 'five', version: 1 },
            students: state.students().map((s) => ({
              id: s.id,
              name: s.displayLabel,
              status: s.status,
            })),
            columns: Array.from({ length: 10 }, (_, i) => ({
              id: `grade-column-${i}`,
              slotKey: `2026-10:${i + 1}`,
              date: `2026-10-${i + 10}`,
              category: i < 2 ? 'Контрольная' : 'Практика',
              preset: 'five',
              scaleVersion: 1,
              headerRevision: 0,
            })),
            grades: [],
            offset: 0,
            nextOffset: null,
            range: {
              from: '2026-10-01',
              to: '2026-10-31',
              today: '2026-10-12',
              timeZone: 'Europe/Moscow',
            },
          },
        });
      }
      if (pathname === root + '/gradebook') {
        return route.fulfill({
          json: {
            scheme: null,
            items: state.students().flatMap((s) =>
              Array.from({ length: assignmentCount }, (_, i) => ({
                seatId: s.id,
                displayLabel: s.displayLabel,
                assignmentId: `work-${i}`,
                assignmentTitle: `Модель опоры для лабораторной установки ${i + 1}`,
                attemptId: null,
                attemptNumber: null,
                state: 'not_started',
                submittedAt: null,
                points: null,
                maxPoints: 100,
                displayGrade: null,
                canonicalState: null,
              })),
            ),
          },
        });
      }
      return route.fallback();
    });
    await page.goto(`/#/classrooms/${classId}`);
    await section(page, 'Журнал');
    const modes = page.getByRole('navigation', { name: 'Режим журнала' });
    for (const mode of ['По датам', 'Задания']) {
      for (const count of [2, 10]) {
        if (mode === 'По датам') {
          await page
            .getByLabel('Категория', { exact: true })
            .selectOption(count === 2 ? 'Контрольная' : '');
        } else {
          if (count === 10) await modes.getByRole('button', { name: 'По датам' }).click();
          assignmentCount = count;
          await modes.getByRole('button', { name: 'Задания', exact: true }).click();
        }
        const matrix = page.locator('.journal-matrix-scroll');
        const heading = matrix.locator('thead');
        const rows = matrix.locator('tbody tr');
        await expect(rows).toHaveCount(30);
        await expect(heading.getByRole('columnheader')).toHaveCount(count + 1);
        const dimensions = await matrix.evaluate((element) => {
          const table = element.querySelector('table')!;
          const [name, work] = table.tHead!.rows[0]!.cells;
          return {
            localY: element.scrollHeight - element.clientHeight,
            pageY: document.documentElement.scrollHeight - innerHeight,
            pageX: document.documentElement.scrollWidth - innerWidth,
            width: work!.getBoundingClientRect().width,
            name: name!.getBoundingClientRect().width,
          };
        });
        expect(dimensions.localY).toBeLessThanOrEqual(1);
        expect(dimensions.pageY).toBeGreaterThan(0);
        expect(dimensions.pageX).toBeLessThanOrEqual(1);
        const expectedWidth =
          mode === 'По датам' ? 128 : width === 1440 ? 112 : width === 320 ? 84 : 92;
        expect(Math.abs(dimensions.width - expectedWidth)).toBeLessThanOrEqual(1);
        if (mode === 'По датам' && width === 1440) expect(dimensions.name).toBeCloseTo(200, 0);
        if (mode === 'По датам' && width === 390)
          expect(dimensions.name).toBeGreaterThanOrEqual(140);

        await matrix.evaluate((element) => {
          element.focus({ preventScroll: true });
          scrollTo(0, 0);
        });
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
        await page.keyboard.press('PageDown');
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
        await matrix.evaluate((element) =>
          scrollTo(0, scrollY + element.getBoundingClientRect().top + 180),
        );
        await expect
          .poll(() =>
            heading.evaluate((element) =>
              Math.abs(
                element.getBoundingClientRect().top -
                  document.querySelector('.portal-header')!.getBoundingClientRect().bottom,
              ),
            ),
          )
          .toBeLessThanOrEqual(1);

        const nameCell = rows.nth(7).getByRole('rowheader');
        const initialNameX = await nameCell.evaluate(
          (element) => element.getBoundingClientRect().left,
        );
        await matrix.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });
        await expect
          .poll(() => nameCell.evaluate((element) => element.getBoundingClientRect().left))
          .toBeCloseTo(initialNameX, 0);
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await expect(rows.last()).toBeInViewport();
        await page.screenshot({
          path: `${out}/${width}-journal-${mode === 'По датам' ? 'manual' : 'assignments'}-${count}.png`,
        });
        if (count === 10) {
          const row = rows.last();
          const gradeCells = row.locator('td button');
          await gradeCells.last().focus();
          for (const [key, index] of [
            ['Shift+Tab', 8],
            ['Tab', 9],
          ] as const) {
            await page.keyboard.press(key);
            const focused = gradeCells.nth(index);
            await expect(focused).toBeFocused();
            await expect
              .poll(() =>
                focused.evaluate((element) => {
                  const name = element.closest('tr')!.querySelector('th')!;
                  return element.getBoundingClientRect().left - name.getBoundingClientRect().right;
                }),
              )
              .toBeGreaterThanOrEqual(-1);
          }
        }
        if (mode === 'По датам' && count === 10) {
          const cell = rows.last().locator('.manual-journal-cell').last();
          await cell.click();
          const editor = page.locator('.manual-journal-cell-dialog');
          await expect(editor).toBeInViewport({ ratio: 0.9 });
          await page.keyboard.press('Escape');
          await expect(editor).toHaveCount(0);
          await expect(cell).toBeFocused();
        }
        if (mode === 'Задания' && count === 10) {
          await matrix.evaluate((element) => {
            element.scrollLeft = 0;
            scrollTo(0, scrollY + element.getBoundingClientRect().top + 180);
          });
          const cell = rows.nth(8).locator('.gradebook-cell').first();
          await cell.click();
          const review = page.getByRole('region', { name: 'Историческая проверка' });
          await expect(review.getByRole('heading')).toBeInViewport();
          await expect(page.locator('.gradebook-detail-target')).toBeFocused();
          await review.getByRole('button', { name: 'Закрыть' }).click();
          await expect(cell).toBeFocused();
        }
      }
    }
    if (width === 1440) {
      const columns = page.locator('.gradebook-column-picker');
      const heading = page.locator('.gradebook-matrix thead');
      await columns.locator('summary').click();
      await columns.getByRole('checkbox').first().uncheck();
      await expect(heading.getByRole('columnheader')).toHaveCount(10);
      await modes.getByRole('button', { name: 'По датам' }).click();
      await modes.getByRole('button', { name: 'Задания', exact: true }).click();
      await expect(heading.getByRole('columnheader')).toHaveCount(10);
      await columns.locator('summary').click();
      await columns.getByRole('button', { name: 'Показать все столбцы' }).click();
      await expect(heading.getByRole('columnheader')).toHaveCount(11);
    }
    expect(state.errors).toEqual([]);
    expect(state.mutations).toEqual([]);
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

test('exact submitted project review keeps 3D, Arduino and Electronics playback accessible at all widths', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name !== 'asa-electronics-simulation') return;
        this.addEventListener('message', ({ data }) => {
          if (data?.ok && data.kind === 'preflight' && data.result?.status === 'solved')
            document.documentElement.dataset.solvedPlaybackSession = data.projectSessionId;
        });
      }
    };
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await fixture(page, 1);
  const pupil = state.students()[0]!;
  const assignment = 'submitted-exact-3d';
  const assignmentTitle = 'Трёхмерная модель длинной опоры для лабораторной установки';
  const attempt = 'attempt-exact-3d';
  const submission = '123e4567-e89b-42d3-a456-426614174001';
  const version = '123e4567-e89b-42d3-a456-426614174002';
  const nextAttempt = 'attempt-exact-next';
  const nextSubmission = '123e4567-e89b-42d3-a456-426614174003';
  const nextVersion = '123e4567-e89b-42d3-a456-426614174004';
  const submittedAt = '2026-10-12T12:00:00Z';
  const document = {
    ...createEmptyThreeDDocument(),
    nodes: [createThreeDNode('box', 'frozen-box')],
  };
  let moduleKey = 'three-d';
  let payload: unknown = document;
  let electronicsSimulation: ClassroomElectronicsSimulation | null = null;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const root = '/api/classrooms/' + classId;
    if (path === root + '/gradebook')
      return route.fulfill({
        json: {
          scheme: null,
          items: [
            {
              seatId: pupil.id,
              displayLabel: pupil.displayLabel,
              assignmentId: assignment,
              assignmentTitle,
              attemptId: attempt,
              attemptNumber: 1,
              state: 'submitted',
              submittedAt,
              points: null,
              maxPoints: null,
              displayGrade: null,
              canonicalState: {
                activityRunId: 'run-exact-3d',
                workflowState: 'waiting_review',
                flags: [],
                selectedResult: null,
              },
            },
          ],
        },
      });
    if (path === root + '/assignments/' + assignment + '/students/' + pupil.id + '/review-context')
      return route.fulfill({
        json: {
          participationId: 'participation-exact-3d',
          activityRunId: 'run-exact-3d',
          resultMode: 'completion',
          moduleKey,
          selectionPolicy: 'first',
          teacherSelectedAttemptId: null,
          attempts: [
            {
              id: attempt,
              number: 1,
              state: 'submitted',
              submissionId: submission,
              projectVersionId: version,
              submittedAt,
              results: [],
            },
            ...(electronicsSimulation
              ? [
                  {
                    id: nextAttempt,
                    number: 2,
                    state: 'submitted',
                    submissionId: nextSubmission,
                    projectVersionId: nextVersion,
                    submittedAt,
                    results: [],
                  },
                ]
              : []),
          ],
        },
      });
    if ([attempt, nextAttempt].some((id) => path === root + '/attempts/' + id + '/submission'))
      return route.fulfill({
        json: {
          kind: 'project',
          submissionId: path.includes(nextAttempt) ? nextSubmission : submission,
          projectVersionId: path.includes(nextAttempt) ? nextVersion : version,
          ...(electronicsSimulation ? { electronicsSimulation } : {}),
          sourceRevision: 7,
          digest: 'frozen-digest',
          moduleKey,
          document: payload,
          preview: {
            figure: {
              kind: 'schematic',
              viewBox: { width: 100, height: 100 },
              shapes: [{ shape: 'rect', x: 10, y: 10, width: 80, height: 80, fill: '#99bbed' }],
            },
          },
        },
      });
    if (path === root + '/assignments/' + assignment + '/conditions')
      return route.fulfill({
        json: {
          impact: { participants: 1, activeAttempts: 0, submittedAttempts: 1, excused: false },
          runId: 'run-exact-3d',
          revision: 1,
          overrides: {},
          effective: { values: {}, sources: {}, extraAttempts: 0, teacherUnlocked: false },
        },
      });
    return route.fallback();
  });
  await page.goto('/#/classrooms/' + classId);
  await page
    .getByRole('navigation', { name: 'Разделы класса' })
    .getByRole('button', { name: 'Журнал', exact: true })
    .click();
  await page.getByRole('button', { name: 'Задания', exact: true }).click();
  const cell = page.getByRole('button', { name: new RegExp(assignmentTitle) });
  const detail = page.getByRole('region', { name: 'Проверка сдачи' });
  const fixed = detail.getByTestId('submission-version-id');
  const disclosure = detail.getByRole('button', { name: /^(Показать|Скрыть) 3D-модель$/ });
  const viewer = detail.getByRole('region', { name: 'Сданная 3D-модель' });
  const presentation = viewer.getByTestId('three-d-presentation');
  const canvas = presentation.locator('canvas');
  await cell.click();
  await expect(fixed).toHaveText(version);
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(canvas).toHaveCount(0);

  const viewerRequests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith('/api/projects/') ||
      (path.startsWith('/api/classrooms/') && !['GET', 'HEAD'].includes(request.method()))
    )
      viewerRequests.push(request.method() + ' ' + path);
  });
  await disclosure.press('Enter');
  await expect(viewer).toHaveAttribute('data-ready', 'true', { timeout: 15_000 });
  await expect(canvas).toBeVisible();
  const initialCamera = await presentation.getAttribute('data-camera-state');
  expect(initialCamera).toBeTruthy();
  await canvas.press('ArrowRight');
  await expect(presentation).not.toHaveAttribute('data-camera-state', initialCamera!);

  mkdirSync(out, { recursive: true });
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const stage = (await canvas.boundingBox())!;
    expect(stage.x).toBeGreaterThanOrEqual(0);
    expect(stage.x + stage.width).toBeLessThanOrEqual(width + 1);
    for (const control of [disclosure, ...(await viewer.getByRole('button').all())]) {
      const target = (await control.boundingBox())!;
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    }
    await viewer.screenshot({ path: out + '/exact-three-d-review-' + width + '.png' });
  }
  await canvas.press('Escape');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(disclosure).toBeFocused();
  await expect(canvas).toHaveCount(0);
  expect(viewerRequests).toEqual([]);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await detail.getByRole('button', { name: 'Закрыть проверку' }).click();
  payload = { schemaVersion: -1 };
  await cell.click();
  await expect(fixed).toHaveText(version);
  await disclosure.click();
  await expect(
    detail.getByRole('status').filter({ hasText: 'Не удалось запустить 3D-просмотр.' }),
  ).toBeVisible();
  await expect(detail.getByLabel('Точный снимок сданной работы')).toBeVisible();
  await expect(canvas).toHaveCount(0);

  await detail.getByRole('button', { name: 'Закрыть проверку' }).click();
  payload = document;
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...options: unknown[]) {
      return type.startsWith('webgl') ? null : Reflect.apply(original, this, [type, ...options]);
    } as typeof original;
  });
  await cell.click();
  await expect(fixed).toHaveText(version);
  await disclosure.click();
  await expect(
    detail.getByRole('status').filter({ hasText: 'Не удалось запустить 3D-просмотр.' }),
  ).toBeVisible();
  await expect(detail.getByLabel('Точный снимок сданной работы')).toBeVisible();
  await expect(canvas).toHaveCount(0);

  await detail.getByRole('button', { name: 'Закрыть проверку' }).click();
  moduleKey = 'electronics';
  const firstSource = '#include <Arduino.h>\n\n// ' + 'длиннаяСтрока'.repeat(24) + '\n';
  const secondSource = 'void setup() {}\nvoid loop() {}\n';
  const board = { kind: 'visual', value: 5, position: { x: 0, y: 0 } };
  const circuit = {
    schemaVersion: 4,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
    connections: [],
  };
  const noCode = [
    { ...board, id: 'empty', componentTypeId: 'arduino-uno' },
    {
      ...board,
      id: 'blank',
      componentTypeId: 'arduino-uno',
      stateProperties: { arduinoSource: ' ' },
    },
    {
      ...board,
      id: 'other',
      kind: 'resistor',
      stateProperties: { arduinoSource: 'invalid board' },
    },
  ];
  payload = {
    ...circuit,
    components: [
      {
        ...board,
        id: 'first',
        componentTypeId: 'arduino-uno',
        name: 'Контроллер освещения',
        stateProperties: { arduinoSource: firstSource },
      },
      {
        ...board,
        id: 'legacy',
        variantId: 'arduino-uno',
        stateProperties: { arduinoSource: secondSource },
      },
      ...noCode,
    ],
  };
  await cell.click();
  await expect(fixed).toHaveText(version);
  await expect(disclosure).toHaveCount(0);
  await expect(detail.getByLabel('Точный снимок сданной работы')).toBeVisible();

  const sourceDisclosure = detail.getByRole('button', { name: 'Код', exact: true });
  const source = detail.getByRole('region', { name: 'Плата 1 · Контроллер освещения' });
  const legacy = detail.getByRole('region', { name: 'Плата 2 · Arduino Uno' });
  await expect(sourceDisclosure).toBeVisible();
  await expect(source).toHaveCount(0);
  await sourceDisclosure.press('Enter');
  await expect(source).toBeVisible();
  expect(await source.textContent()).toBe(firstSource);
  expect(await source.locator('code').evaluate((node) => node.childElementCount)).toBe(0);
  expect(await legacy.textContent()).toBe(secondSource);
  await expect(detail.locator('.gradebook-arduino-source pre')).toHaveCount(2);

  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const trigger = (await sourceDisclosure.boundingBox())!;
    const bounds = (await source.boundingBox())!;
    expect(trigger.height).toBeGreaterThanOrEqual(44);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    await detail.locator('.gradebook-arduino-source').screenshot({
      path: out + '/exact-arduino-review-' + width + '.png',
    });
  }
  await source.press('Escape');
  await expect(source).toHaveCount(0);
  await expect(sourceDisclosure).toBeFocused();
  expect(viewerRequests).toEqual([]);

  await detail.getByRole('button', { name: 'Закрыть проверку' }).click();
  electronicsSimulation = {
    submissionId: submission,
    projectVersionId: version,
    simulation: {
      schemaVersion: 3,
      status: 'simulation',
      viewerFamily: 'electronics',
      capabilities: { readOnly: true, interactive: true, download: false },
      solverIterations: 24,
      components: [
        {
          id: 'battery',
          kind: 'source',
          componentTypeId: 'battery-3v',
          pinIds: ['positive', 'negative'],
          position: { x: 0, y: 0 },
          value: 3,
        },
        {
          id: 'resistor',
          kind: 'resistor',
          componentTypeId: 'resistor-axial',
          pinIds: ['lead-1', 'lead-2'],
          position: { x: 120, y: 0 },
          value: 330,
        },
      ],
      connections: [
        {
          id: 'w1',
          from: { componentId: 'battery', terminal: 'positive' },
          to: { componentId: 'resistor', terminal: 'lead-1' },
        },
        {
          id: 'w2',
          from: { componentId: 'battery', terminal: 'negative' },
          to: { componentId: 'resistor', terminal: 'lead-2' },
        },
      ],
    },
  };
  const playbackRequests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path.startsWith('/api/public-projects') ||
      path.startsWith('/api/projects/') ||
      (path.startsWith('/api/') &&
        !path.startsWith('/api/diagnostics') &&
        !path.startsWith('/api/analytics') &&
        !['GET', 'HEAD'].includes(request.method()))
    )
      playbackRequests.push(request.method() + ' ' + path);
  });

  await cell.click();
  await expect(fixed).toHaveText(version);
  const toggle = detail.getByRole('button', { name: /^(Открыть|Скрыть) симуляцию$/ });
  const playback = detail.getByRole('region', { name: 'Сданная электрическая схема' });
  const start = playback.getByTestId('classroom-electronics-start');
  const stage = playback.getByTestId('public-electronics-scene');
  const isSimulationWorker = (worker: { url(): string }) =>
    worker.url().includes('simulation.worker');
  const launch = async () => {
    const pending = page.waitForEvent('worker', { predicate: isSimulationWorker });
    await start.click();
    const worker = await pending;
    return { closed: new Promise<void>((resolve) => worker.once('close', resolve)) };
  };

  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(playback).toHaveCount(0);
  await expect(detail.getByLabel('Точный снимок сданной работы')).toBeVisible();
  await toggle.press('Enter');
  await expect(playback).toBeVisible();
  expect(page.workers().filter(isSimulationWorker)).toHaveLength(0);
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = (await stage.boundingBox())!;
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    const more = playback.getByRole('button', { name: 'Инструменты просмотра' });
    const fullscreen = playback.getByRole('button', { name: 'На весь экран' });
    if (width <= 390) {
      await expect(more).toBeVisible();
      await expect(fullscreen).toBeHidden();
      await more.click();
      await expect(fullscreen).toBeVisible();
    }
    for (const control of [toggle, ...(await playback.getByRole('button').all())]) {
      if (!(await control.isVisible())) continue;
      const target = (await control.boundingBox())!;
      const label = width + ' px · ' + (await control.textContent());
      expect(target.width, label).toBeGreaterThanOrEqual(44);
      expect(target.height, label).toBeGreaterThanOrEqual(44);
      expect(target.x, label).toBeGreaterThanOrEqual(bounds.x - 1);
      expect(target.x + target.width, label).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    }
    if (width <= 390) await more.click();
    await playback.screenshot({ path: out + '/exact-electronics-review-' + width + '.png' });
  }

  const workerForBlur = await launch();
  await expect(page.locator('html')).toHaveAttribute(
    'data-solved-playback-session',
    'classroom-submission:' + submission + ':' + version,
  );
  await expect(start).toHaveText('Остановить');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await workerForBlur.closed;
  await expect(start).toHaveText('Запустить');
  await expect(playback.getByRole('status').filter({ hasText: 'потере фокуса' })).toBeVisible();

  const workerForEscape = await launch();
  await stage.press('Escape');
  await workerForEscape.closed;
  await expect(toggle).toBeFocused();
  await expect(playback).toHaveCount(0);
  await expect(detail.getByLabel('Точный снимок сданной работы')).toBeVisible();

  await toggle.click();
  const workerForAttemptSwitch = await launch();
  await detail.getByLabel('Попытка', { exact: true }).selectOption(nextAttempt);
  await workerForAttemptSwitch.closed;
  await expect(fixed).toHaveText(nextVersion);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(
    detail.getByRole('status').filter({ hasText: 'Симуляция этой сдачи недоступна.' }),
  ).toBeVisible();
  await expect(playback).toHaveCount(0);
  await expect(detail.getByLabel('Точный снимок сданной работы')).toBeVisible();
  await expect(sourceDisclosure).toBeVisible();
  expect(page.workers().filter(isSimulationWorker)).toHaveLength(0);
  expect(playbackRequests).toEqual([]);

  await detail.getByRole('button', { name: 'Закрыть проверку' }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  payload = { ...circuit, components: noCode };
  await cell.click();
  await expect(fixed).toHaveText(version);
  await expect(detail.getByLabel('Точный снимок сданной работы')).toBeVisible();
  await expect(sourceDisclosure).toHaveCount(0);

  await detail.getByRole('button', { name: 'Закрыть проверку' }).click();
  const savedWorkspace = {
    blocks: {
      languageVersion: 0,
      blocks: [
        {
          type: 'asa_loop',
          id: 'pupil-loop',
          inputs: {
            DO: {
              block: {
                type: 'asa_wait',
                id: 'pupil-wait',
                fields: { TIME: '2', UNIT: 'SECONDS' },
                next: {
                  block: {
                    type: 'asa_digital_write',
                    fields: { PIN: '13', LEVEL: 'HIGH' },
                    next: {
                      block: {
                        type: 'asa_wait',
                        fields: { TIME: '1', UNIT: 'SECONDS' },
                        next: {
                          block: { type: 'asa_digital_write', fields: { PIN: '13', LEVEL: 'LOW' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };
  const savedBoard = {
    ...board,
    id: 'uno',
    kind: 'visual' as const,
    componentTypeId: 'arduino-uno',
    stateProperties: {
      arduinoCodeMode: 'blocks',
      arduinoSource:
        'void setup() { pinMode(13, OUTPUT); } void loop() { delay(2000); digitalWrite(13, HIGH); delay(1000); digitalWrite(13, LOW); }',
    },
  };
  payload = {
    ...circuit,
    components: [
      {
        ...savedBoard,
        stateProperties: {
          ...savedBoard.stateProperties,
          arduinoWorkspace: JSON.stringify(savedWorkspace),
        },
      },
    ],
  };
  electronicsSimulation = {
    ...electronicsSimulation,
    simulation: { ...electronicsSimulation.simulation, components: [savedBoard], connections: [] },
  };
  await cell.click();
  await toggle.click();
  const showBlocks = playback.getByRole('button', { name: 'Блоки', exact: true });
  await expect(showBlocks).toHaveAttribute('aria-expanded', 'false');
  await expect(playback.locator('pre')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 900 });
  await showBlocks.click();
  const blocks = playback.getByTestId('public-arduino-blocks');
  for (const id of ['pupil-loop', 'pupil-wait']) {
    await expect(blocks.locator(`.blocklyBlock[data-id="${id}"]`)).toBeVisible();
  }
  const programPanel = playback.getByRole('complementary', { name: 'Программа' });
  await programPanel.scrollIntoViewIfNeeded();
  await expect
    .poll(
      () =>
        blocks.evaluate((host) => {
          const svg = host.querySelector('svg.blocklySvg')!;
          const outlines = Array.from(
            svg.querySelectorAll('.blocklyBlockCanvas path.blocklyPath'),
            (path) => path.getBoundingClientRect(),
          );
          const panel = host.closest('.arduino-program-preview')!.getBoundingClientRect();
          const canvas = svg.getBoundingClientRect();
          const clearance = {
            left: Math.round(
              Math.min(...outlines.map((rect) => rect.left)) - Math.max(canvas.left, panel.left),
            ),
            top: Math.round(
              Math.min(...outlines.map((rect) => rect.top)) - Math.max(canvas.top, panel.top),
            ),
            right: Math.round(
              Math.min(canvas.right, panel.right) - Math.max(...outlines.map((rect) => rect.right)),
            ),
            bottom: Math.round(
              Math.min(canvas.bottom, panel.bottom) -
                Math.max(...outlines.map((rect) => rect.bottom)),
            ),
          };
          if (!outlines.length) return ['no rendered blocks'];
          return Object.entries(clearance).filter(([, pixels]) => pixels < -1);
        }),
      {
        message:
          'The entire saved loop, including its closing bracket, fits inside the visible program panel',
      },
    )
    .toEqual([]);
  await expect(blocks.locator('.blocklyDraggable, .blocklyToolboxDiv')).toHaveCount(0);
  await expect(playback.locator('pre')).toHaveCount(0);
  await playback.getByRole('button', { name: 'Закрыть программу' }).press('Escape');
  await expect(showBlocks).toBeFocused();
  await expect(stage).toBeVisible();
  expect(playbackRequests).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('refreshing a reclassified classroom card retires its previous project preview immediately', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await seedPresentation(page, true);
  const pupil = state.students()[0]!;
  const projectId = 'transition-project';
  const title = 'Модель при смене типа работы';
  const attemptId = 'transition-attempt';
  const submissionId = '123e4567-e89b-42d3-a456-426614174019';
  const projectVersionId = '123e4567-e89b-42d3-a456-426614174020';
  const root = '/api/classrooms/' + classId;
  const projectPath = root + '/observation/learners/' + pupil.id + '/projects/' + projectId;
  const submissionPath = root + '/attempts/' + attemptId + '/submission';
  const document = {
    ...createEmptyThreeDDocument(),
    nodes: [createThreeDNode('box', 'transition-box')],
  };
  let assigned = false;
  let finishSubmission: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    finishSubmission = resolve;
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === root + '/observation/projects')
      return route.fulfill({
        json: {
          items: [
            {
              id: projectId,
              seatId: pupil.id,
              student: pupil.displayLabel,
              avatarKey: null,
              title,
              moduleKey: 'three-d',
              assigned,
              status: 'active',
              updatedAt: '2026-10-12T12:00:00Z',
            },
          ],
          total: 1,
          hidden: 0,
          nextOffset: null,
          learners: [{ id: pupil.id, label: pupil.displayLabel }],
        },
      });
    if (path === projectPath + '/free-preview')
      return route.fulfill({
        json: { projectId, revision: 6, moduleKey: 'three-d', document, preview: null },
      });
    if (path === projectPath + '/review')
      return route.fulfill({
        json: {
          assignmentId: 'transition-assignment',
          activityRunId: 'transition-run',
          attemptId,
          submissionId,
          projectVersionId,
          canReview: true,
        },
      });
    if (path === submissionPath) {
      await pending;
      return route.fulfill({
        json: {
          kind: 'project',
          submissionId,
          projectVersionId,
          sourceRevision: 7,
          digest: 'frozen-digest',
          moduleKey: 'three-d',
          document,
          preview: null,
        },
      });
    }
    return route.fallback();
  });

  await page.goto('/#/classrooms/' + classId);
  await section(page, 'Проекты');
  const card = page.getByRole('button', { name: new RegExp('Предпросмотр работы ' + title) });
  const dialog = page.getByRole('dialog', { name: 'Работа: ' + title });
  const free = dialog.getByRole('region', { name: 'Сохранённая 3D-модель' });
  const frozen = dialog.getByRole('region', { name: 'Сданная 3D-модель' });
  await card.click();
  await expect(free).toHaveAttribute('data-ready', 'true');
  const unexpected: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (
      (path.startsWith('/api/projects/') && !path.endsWith('/snapshot')) ||
      (path.startsWith('/api/classrooms/') && request.method() !== 'GET') ||
      path.startsWith('/api/public-projects')
    )
      unexpected.push(request.method() + ' ' + path);
  });

  try {
    assigned = true;
    const lookup = page.waitForRequest(
      (request) => new URL(request.url()).pathname === submissionPath,
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await lookup;
    await expect(dialog.getByRole('status')).toHaveText('Загружаем сохранённую сдачу…');
    await expect(dialog.locator('canvas')).toHaveCount(0);
    await expect(free).toHaveCount(0);
    await expect(frozen).toHaveCount(0);
    finishSubmission();
    await expect(frozen).toHaveAttribute('data-ready', 'true');
    await expect(free).toHaveCount(0);

    assigned = false;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(free).toHaveAttribute('data-ready', 'true');
    await expect(frozen).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(card).toBeFocused();
    expect(unexpected).toEqual([]);
  } finally {
    finishSubmission();
  }
});

for (const width of [320, 390, 1024, 1440]) {
  test(`own work opens its saved model without entering the editor at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page, 2);
    const project = {
      id: '10000000-0000-4000-8000-000000000057',
      moduleKey: 'three-d',
      title: 'Опора датчика',
      scope: 'personal',
      classroomId: null,
      status: 'active',
      updatedAt: '2026-10-10T12:00:00Z',
      createdAt: '2026-10-10T12:00:00Z',
      preview: null,
      snapshotRevision: null,
      copiedFrom: null,
    };
    const detailReads: string[] = [];
    await page.route(/\/api\/projects(?:[/?]|$)/, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/projects') return route.fulfill({ json: { items: [project] } });
      if (path === `/api/projects/${project.id}/preview`) {
        detailReads.push(route.request().method());
        return route.fulfill({
          json: {
            projectId: project.id,
            revision: 3,
            moduleKey: 'three-d',
            preview: null,
            document: { ...createEmptyThreeDDocument(), nodes: [createThreeDNode('box', 'foot')] },
          },
        });
      }
      return route.fallback();
    });
    await page.goto('/#/projects');
    const card = page.getByTestId('project-card').filter({ hasText: project.title });
    const cover = card.getByRole('button', { name: 'Предпросмотр работы ' + project.title });
    await expect(cover).toBeVisible();
    expect(detailReads).toEqual([]);
    await cover.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Работа: ' + project.title });
    await expect(dialog.getByRole('region', { name: 'Сохранённая 3D-модель' })).toHaveAttribute(
      'data-ready',
      'true',
    );
    const view = dialog.getByTestId('three-d-presentation');
    const initial = await view.getAttribute('data-camera-state');
    await view.locator('canvas').press('ArrowRight');
    await expect(view).not.toHaveAttribute('data-camera-state', initial!);
    await expect(dialog.getByRole('link', { name: 'Открыть в редакторе' })).toHaveAttribute(
      'href',
      (await card.getByRole('link', { name: project.title, exact: true }).getAttribute('href'))!,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await dialog.getByRole('button', { name: 'Закрыть' }).press('Escape');
    await expect(cover).toBeFocused();
    expect(detailReads).toEqual(['GET']);
    expect(state.mutations.filter((mutation) => mutation.path.startsWith('/api/projects'))).toEqual(
      [],
    );
  });
}
