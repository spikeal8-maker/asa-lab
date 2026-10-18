import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Real built portal/React DOM, deterministic authorized read-model fixtures.
// This suite does not claim database, server authorization or owner acceptance.
const evidence = 'e2e/artifacts/owner-preview/my-learning-618';
const longTitle =
  'Исследование электрических цепей и создание собственного проекта — расширенный учебный маршрут';
const person = {
  id: 'learning-account',
  displayName: 'Александра Константинопольская',
  email: 'learning@example.test',
};
const account = {
  authenticated: true,
  user: person,
  account: person,
  capabilities: [],
  workspaces: [
    { workspaceId: 'personal', kind: 'personal', title: 'Личный кабинет', role: 'owner' },
  ],
  activeWorkspace: { workspaceId: 'personal', kind: 'personal' },
  navigation: { classes: true, classroomManagement: false },
  timeZone: 'Europe/Moscow',
};
const seat = {
  authenticated: true,
  student: { seatId: 'seat-1', displayName: person.displayName, safeMode: true, avatarKey: null },
  classroom: {
    id: 'class-1',
    title: 'Лаборатория инженерного творчества и программирования',
    teacherDisplayName: 'Мария Александровна',
  },
  expiresAt: '2099-01-01T00:00:00Z',
};

async function fixture(page: Page, identity: 'seat' | 'account', count: number) {
  const state = {
    fail: false,
    hold: false,
    joins: 0,
    submitted: false,
    writes: [] as string[],
    reads: [] as string[],
    errors: [] as string[],
    failedWork: null as 'assignments' | 'quizzes' | null,
    workStatus: 503,
  };
  page.on('pageerror', (error) => state.errors.push(error.message));
  const assignments = Array.from({ length: count }, (_, i) => ({
    id: `work-${i}`,
    activityRunId: `activity-${i}`,
    title: `${longTitle} ${i + 1}`,
    classroomTitle: i % 2 ? 'Второй класс' : seat.classroom.title,
    brief: 'Прочитайте задание и сохраните свою работу перед сдачей.',
    goal: null,
    moduleKey: 'electronics',
    dueAt: '2026-11-01T12:00:00Z',
    status: i === 2 ? 'closed' : 'open',
    sampleImage: null,
    projectId: i < 2 ? `project-${i}` : null,
    submittedAt: i === 1 ? '2026-10-01T12:00:00Z' : null,
    snapshotRevision: null,
    updatedAt: null,
    legacySubmitAllowed: true,
    canonicalState:
      i === 1
        ? {
            workflowState: 'completed',
            flags: [],
            selectedResult: { displayGrade: '5', completionValue: true },
          }
        : null,
  }));
  const courses = Array.from({ length: count }, (_, i) => ({
    id: `course-${i}`,
    courseId: `content-${i}`,
    courseVersionId: `version-${i}`,
    versionNumber: 2,
    title: `${longTitle} — курс ${i + 1}`,
    classroomTitle: seat.classroom.title,
    summary: 'Материалы, практика и результаты по занятиям.',
    dueAt: null,
    status: i === 0 ? 'closed' : 'open',
    sections: [
      {
        id: `section-${i}`,
        title: 'Первый раздел',
        position: 0,
        summary: null,
        lessons: [
          {
            id: `lesson-${i}`,
            title: 'Знакомство с материалом',
            kind: 'material',
            position: 0,
            content: 'Учебный материал курса.',
            blocks: [],
            activityOccurrences: [],
            completedAt: i === 0 ? '2026-10-01T12:00:00Z' : null,
            projectId: null,
            submittedAt: null,
            canonicalState: null,
          },
        ],
      },
    ],
  }));
  const results = Array.from({ length: count }, (_, i) => ({
    assignmentId: `work-${i}`,
    assignmentTitle: `${longTitle} ${i + 1}`,
    classroomTitle: seat.classroom.title,
    attemptNumber: 2,
    state: 'submitted',
    points: 8,
    maxPoints: 10,
    percentage: 80,
    displayGrade: '4',
    outcome: 'passed',
    feedback: 'Хорошая работа',
    publishedAt: '2026-10-01T12:00:00Z',
    canonicalState:
      i === 1
        ? {
            workflowState: 'completed',
            flags: [],
            selectedResult: {
              displayGrade: '5',
              completionValue: true,
              rawPoints: 9,
              maxPoints: 10,
              percentageBasisPoints: 9000,
            },
          }
        : null,
  }));
  const profile = {
    status: 'archived',
    helperClasses: [],
    student: {
      id: 'seat-1',
      displayLabel: person.displayName,
      avatarKey: null,
      status: 'archived',
      safeMode: true,
      lastActiveAt: null,
    },
    settings: {
      periodDays: 30,
      revision: 1,
      factors: { projects: true, logins: false, days: false, time: false, grades: false },
    },
    metrics: {
      seatId: 'seat-1',
      totalWorks: 12,
      archivedWorks: 2,
      score: 12,
      rank: 3,
      role: 'student',
      avatarUrl: null,
      factors: { projects: 12, logins: 0, days: 0, time: 0, grades: 0 },
      sources: { projects: 12, logins: 0, days: 0, time: 0, grades: 0 },
    },
    builtinAwards: [],
    submittedCount: 2,
    awaitingReview: 1,
    merits: [
      {
        id: 'merit-1',
        title: 'За исследование',
        description: 'От преподавателя',
        granted: true,
        grantedAt: '2026-10-01T12:00:00Z',
      },
    ],
    avatars: [],
    activity: [],
  };
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === 'GET') state.reads.push(path);
    else state.writes.push(path);
    if (path === '/api/auth/me')
      return json(route, identity === 'account' ? account : { authenticated: false });
    if (path === '/api/class-join/me') return json(route, seat);
    if (path === '/api/account/avatar') return json(route, { avatarDataUrl: null });
    if (path === '/api/account/presentation')
      return json(route, { revision: 0, motion: 'system', sidebar: 'expanded' });
    if (path === '/api/auth/max/status')
      return json(route, { linked: false, available: false, promptDue: false });
    if (path === '/api/modules') return json(route, { items: [] });
    if (path === '/api/learning/notifications/preferences')
      return json(route, {
        revision: 1,
        masterEnabled: true,
        categories: {
          NC01: true,
          NC02: true,
          NC03: true,
          NC04: true,
          NC05: true,
          NC06: true,
          NC08: true,
        },
        classOverrides: {},
        classes: [
          { id: 'class-1', title: seat.classroom.title },
          { id: 'class-2', title: 'Второй класс' },
        ],
      });
    if (path === '/api/admin/v1/me')
      return json(route, { error: { code: 'forbidden', message: 'Нет доступа' } }, 403);
    if (/\/(assignments|course-runs|results|quizzes)$/.test(path)) {
      while (state.hold && !page.isClosed())
        await new Promise((resolve) => setTimeout(resolve, 30));
      if (state.fail)
        return json(route, { error: { code: 'unavailable', message: 'Временно недоступно' } }, 503);
      if (state.failedWork && path.endsWith(`/${state.failedWork}`))
        return json(
          route,
          { error: { code: 'unavailable', message: 'Временно недоступно' } },
          state.workStatus,
        );
    }
    if (path.includes('/journal/results'))
      return json(route, {
        range: {
          from: '2026-10-01',
          to: '2026-10-31',
          today: '2026-10-18',
          timeZone: 'Europe/Moscow',
        },
        offset: 0,
        nextOffset: null,
        items: count
          ? [
              {
                id: 'grade-1',
                columnId: 'column-1',
                seatId: 'seat-1',
                revision: 2,
                value: 5,
                reason: 'Исправленная оценка',
                authorName: 'Мария Александровна',
                publishedAt: '2026-10-01T12:00:00Z',
                date: '2026-10-01',
                category: 'Практика',
                preset: 'five',
                scaleVersion: 1,
                classroomId: 'class-1',
                classroomTitle: seat.classroom.title,
                timeZone: 'Europe/Moscow',
              },
            ]
          : [],
      });
    if (path.endsWith('/participants/me') || /\/participants\/seat-\d+\/profile$/.test(path))
      return json(route, profile);
    if (path.endsWith('/participants/grades') || /\/participants\/seat-\d+\/grades$/.test(path))
      return json(route, {
        journal: { offset: 0, nextOffset: null, columns: [], grades: [] },
        resultOffset: 0,
        nextResultOffset: null,
        results: [],
      });
    if (path.endsWith('/assignments'))
      return json(route, {
        items: assignments.map((item) => ({
          ...item,
          submittedAt:
            state.submitted && item.id === 'work-0' ? '2026-10-18T12:00:00Z' : item.submittedAt,
        })),
      });
    if (path.endsWith('/course-runs')) return json(route, { items: courses });
    if (path.endsWith('/results')) return json(route, { items: results });
    if (path.endsWith('/quizzes'))
      return json(route, {
        items: count
          ? [
              {
                assignmentId: 'quiz-1',
                quizVersionId: 'quiz-version-1',
                title: 'Проверка знаний',
                classroomTitle: seat.classroom.title,
                instructions: 'Выберите ответ.',
                dueAt: null,
                status: 'open',
                attemptLimit: 2,
                attemptsUsed: 0,
                totalPoints: 1,
                passThreshold: 50,
                latestResult: null,
                canonicalState: null,
                questions: [
                  {
                    versionId: 'question-1',
                    type: 'single_choice',
                    promptBlocks: [{ text: 'Что измеряют в вольтах?' }],
                    responseSchema: {
                      options: [
                        { id: 'voltage', label: 'Напряжение' },
                        { id: 'current', label: 'Ток' },
                      ],
                    },
                    maxPoints: 1,
                    position: 0,
                  },
                ],
              },
            ]
          : [],
      });
    if (path === '/api/class-join/me/quizzes/quiz-1/submit')
      return json(route, {
        attemptId: 'quiz-attempt',
        submissionId: 'quiz-submission',
        attemptNumber: 1,
        points: 1,
        maxPoints: 1,
        percentage: 100,
        outcome: 'passed',
        lateState: 'on_time',
        questionResults: [
          { questionVersionId: 'question-1', correct: true, points: 1, maxPoints: 1 },
        ],
        reused: false,
      });
    if (path === '/api/class-join/account/classes')
      return json(route, {
        items: count
          ? [1, 2].map((i) => ({
              seatId: `seat-${i}`,
              classroomId: `class-${i}`,
              classroomTitle: i === 1 ? seat.classroom.title : 'Второй класс',
              teacherDisplayName: 'Мария Александровна',
              openCount: 3,
              unfinishedCount: 1,
            }))
          : [],
      });
    if (path === '/api/class-join/account' && method === 'POST') {
      state.joins++;
      return json(route, { classroom: { title: 'Новый класс' }, alreadyMember: false });
    }
    if (path === '/api/learning/projects/project-0/context')
      return json(route, { state: 'unavailable', projectId: 'project-0' });
    if (path === '/api/projects/project-0') return json(route, { draft: { revision: 7 } });
    if (path.includes('/assignments/work-0/submit')) {
      state.submitted = true;
      return json(route, { submittedAt: '2026-10-18T12:00:00Z' });
    }
    if (path.startsWith('/api/analytics/')) return json(route, { accepted: true });
    return json(route, { items: [], total: 0 });
  });
  return Object.assign(state, { assignments, courses });
}

async function layout(page: Page) {
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('#main-content')).toHaveCount(1);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Моё обучение', exact: true }),
  ).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const identity of ['seat', 'account'] as const) {
  test(`${identity}: mobile tabs stay in one scrollable keyboard-accessible rail`, async ({
    page,
  }) => {
    await fixture(page, identity, 1);
    await page.goto('/#/learning');
    const nav = page.getByRole('navigation', { name: 'Разделы моего обучения' });
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      const rail = await nav.evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        width: el.clientWidth,
        scroll: el.scrollWidth,
        wrap: getComputedStyle(el).flexWrap,
        overflow: getComputedStyle(el).overflowX,
      }));
      expect(rail.wrap).toBe('nowrap');
      expect(rail.height).toBeLessThanOrEqual(44);
      if (width <= 390) {
        expect(rail.scroll).toBeGreaterThan(rail.width);
        expect(rail.overflow).toBe('auto');
      }
      await nav.locator('a').first().focus();
      for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
      const last = nav.getByRole('link', { name: 'Самостоятельно', exact: true });
      await expect(last).toBeFocused();
      expect(
        await last.evaluate((el) => {
          const link = el.getBoundingClientRect();
          const parent = el.parentElement!.getBoundingClientRect();
          return link.left >= parent.left && link.right <= parent.right;
        }),
      ).toBe(true);
      await layout(page);
    }
  });

  for (const nested of [false, true]) {
    test(`${identity}: assignment-only notification resolves ${nested ? 'nested practice' : 'course lesson'}`, async ({
      page,
    }) => {
      const state = await fixture(page, identity, 2);
      const lesson = state.courses[1].sections[0].lessons[0];
      lesson.title = 'Практика курса';
      state.courses[1].sections[0].lessons.unshift({
        ...lesson,
        id: 'unrelated-lesson',
        title: 'Другой урок',
        content: 'Посторонний материал',
      });
      Object.assign(
        lesson,
        nested
          ? {
              blocks: [
                { id: 'practice', type: 'activity', learningActivityVersionId: 'activity-version' },
              ],
              activityOccurrences: [
                {
                  id: 'occurrence',
                  blockId: 'practice',
                  classroomAssignmentId: 'course-work',
                  title: 'Практика курса',
                  moduleKey: 'electronics',
                  blocks: [],
                  projectId: null,
                  submittedAt: null,
                  canonicalState: null,
                },
              ],
            }
          : {
              kind: 'assignment',
              classroomAssignmentId: 'course-work',
              assignmentTitle: 'Практика курса',
            },
      );
      const url = '/#/learning?assignment=course-work&attempt=attempt-2';
      await page.goto(url);
      const nav = page.getByRole('navigation', { name: 'Разделы моего обучения' });
      const player = page.getByTestId('seat-course-player');
      await expect(player).toBeVisible();
      await expect(player).toContainText('Практика курса');
      await expect(player).toContainText('курс 2');
      await expect(player.locator('.seat-course-lesson h3')).toHaveText('Практика курса');
      await expect(player.locator('.seat-course-lesson')).not.toContainText('Посторонний материал');
      await expect(page.getByTestId('seat-assignments')).toHaveCount(0);
      await expect(page.getByTestId('attended-assignments')).toHaveCount(0);
      await page.reload();
      await expect(player).toContainText('Практика курса');
      const results = nav.getByRole('link', { name: 'Результаты', exact: true });
      await results.focus();
      await page.keyboard.press('Enter');
      await expect(results).toHaveAttribute('aria-current', 'page');
      await page.goBack();
      await expect(player).toContainText('Практика курса');
      await expect(nav.getByRole('link', { name: 'Курсы', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(state.errors).toEqual([]);
    });
  }
}

for (const identity of ['seat', 'account'] as const) {
  for (const count of [0, 1, 30, 100]) {
    test(`${identity}: ${count} items, compact overview and responsive detail sections`, async ({
      page,
    }) => {
      const state = await fixture(page, identity, count);
      mkdirSync(evidence, { recursive: true });
      await page.goto('/#/learning');
      const nav = page.getByRole('navigation', { name: 'Разделы моего обучения' });
      await expect(page.locator('.learning-overview-metrics strong')).toHaveText([
        String(count),
        String(count),
        String(count),
      ]);
      await expect(page.locator('.learning-overview-panel').first().locator('li')).toHaveCount(
        Math.min(count, 3),
      );
      for (const width of [1440, 1024, 390, 320]) {
        await page.setViewportSize({ width, height: 960 });
        await layout(page);
        if (count === 1) {
          await page.screenshot({
            path: `${evidence}/${identity}-overview-${width}.png`,
            fullPage: true,
          });
          if (width >= 1024)
            expect(
              await nav
                .locator('a')
                .first()
                .evaluate((a) => a.getBoundingClientRect().height),
            ).toBeLessThanOrEqual(38);
        }
      }
      for (const [view, label] of [
        ['courses', 'Курсы'],
        ['assignments', 'Задания'],
        ['results', 'Результаты'],
        ['classes', 'Классы'],
        ['completed', 'Завершённое'],
        ['self', 'Самостоятельно'],
      ] as const) {
        await nav.getByRole('link', { name: label, exact: true }).click();
        await expect(nav.getByRole('link', { name: label, exact: true })).toHaveAttribute(
          'aria-current',
          'page',
        );
        await expect(
          page.locator('.learning-workspace-body [role="status"]', { hasText: 'Загружаем' }),
        ).toHaveCount(0);
        for (const width of [1440, 1024, 390, 320]) {
          await page.setViewportSize({ width, height: 960 });
          await layout(page);
          if (count === 1)
            await page.screenshot({
              path: `${evidence}/${identity}-${view}-${width}.png`,
              fullPage: true,
            });
        }
        if (count > 0 && view === 'assignments') {
          const list = page.getByTestId(
            identity === 'seat' ? 'seat-assignments' : 'attended-assignments',
          );
          await expect(list.locator(':scope > li')).toHaveCount(count);
        }
        if (view === 'completed') {
          const list =
            identity === 'seat'
              ? page.locator('[aria-labelledby="learning-completed-results"] li')
              : page.getByTestId('attended-assignments').locator(':scope > li');
          await expect(list).toHaveCount(count >= 2 ? 1 : 0);
          if (count >= 2) await expect(list.first()).toContainText(`${longTitle} 2`);
          await expect(page.getByRole('region', { name: 'Мои оценки по датам' })).toHaveCount(0);
        }
      }
      expect(state.errors).toEqual([]);
      expect(
        state.writes.filter(
          (path) => !path.startsWith('/api/analytics/') && !path.startsWith('/api/diagnostics/'),
        ),
      ).toEqual([]);
      expect(
        state.reads.some((path) =>
          identity === 'seat'
            ? path.startsWith('/api/class-join/account/')
            : path.startsWith('/api/class-join/me/'),
        ),
      ).toBe(false);
    });
  }

  test(`${identity}: destination, refresh, history, keyboard and retry`, async ({ page }) => {
    const state = await fixture(page, identity, 1);
    state.hold = true;
    await page.goto('/#/learning');
    await expect(
      page.getByRole('status', { name: '' }).filter({ hasText: 'Загружаем обзор' }),
    ).toBeVisible();
    state.fail = true;
    state.hold = false;
    await expect(page.getByRole('alert').filter({ hasText: 'Часть обзора' })).toBeVisible();
    await expect(page.locator('.learning-overview-metrics strong')).toHaveText(['—', '—', '—']);
    state.fail = false;
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(page.locator('.learning-overview-metrics strong')).toHaveText(['1', '1', '1']);
    await page.goto('/#/learning?assignment=work-0&learner=seat-1');
    const nav = page.getByRole('navigation', { name: 'Разделы моего обучения' });
    await expect(nav.getByRole('link', { name: 'Задания', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('button', { name: `${longTitle} 1`, exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await layout(page);
      await page.screenshot({
        path: `${evidence}/${identity}-open-assignment-${width}.png`,
        fullPage: true,
      });
    }
    const courses = nav.getByRole('link', { name: 'Курсы', exact: true });
    await courses.focus();
    await expect(courses).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(courses).toHaveAttribute('aria-current', 'page');
    expect(new URL(page.url()).hash).toContain('learner=seat-1');
    await page.reload();
    await expect(nav.getByRole('link', { name: 'Курсы', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.goBack();
    await expect(nav.getByRole('link', { name: 'Задания', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.goForward();
    await expect(nav.getByRole('link', { name: 'Курсы', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.goto('/#/learning?courseRun=course-0&lesson=lesson-0');
    await expect(page.getByTestId('seat-course-player')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Отметить непройденным' })).toBeDisabled();
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await layout(page);
      await page.screenshot({
        path: `${evidence}/${identity}-open-course-${width}.png`,
        fullPage: true,
      });
      if (width <= 390) {
        const heading = page.locator('.seat-course-player-head');
        const bounds = await heading.boundingBox();
        const title = await heading.locator('h2').boundingBox();
        expect(title!.width).toBeGreaterThan(bounds!.width * 0.9);
      }
    }
    await page.goto('/#/learning?journalMonth=2026-10');
    await expect(nav.getByRole('link', { name: 'Результаты', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByLabel('Месяц журнала', { exact: true })).toHaveValue('2026-10');
    expect(state.errors).toEqual([]);
  });

  test(`${identity}: existing saved-work submit remains available`, async ({ page }) => {
    const state = await fixture(page, identity, 1);
    await page.goto('/#/learning?assignment=work-0');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Сдать', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Работа сдана', exact: true })).toBeDisabled();
    expect(state.submitted).toBe(true);
    expect(state.errors).toEqual([]);
  });

  test(`${identity}: assignment load errors are visible and retryable`, async ({ page }) => {
    const state = await fixture(page, identity, 1);
    state.fail = true;
    await page.goto('/#/learning?view=assignments');
    await expect(
      page
        .locator('.learning-workspace')
        .getByRole('alert')
        .filter({ hasText: identity === 'seat' ? 'Часть заданий' : 'Не удалось загрузить' }),
    ).toBeVisible();
    state.fail = false;
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(
      page.getByTestId(identity === 'seat' ? 'seat-assignments' : 'attended-assignments'),
    ).toBeVisible();
    await layout(page);
    expect(state.errors).toEqual([]);
  });
}

for (const failedWork of ['assignments', 'quizzes'] as const) {
  test(`Seat: retry ${failedWork} preserves visible work and unsent quiz answers`, async ({
    page,
  }) => {
    const state = await fixture(page, 'seat', 1);
    state.failedWork = failedWork;
    await page.goto('/#/learning?view=assignments');
    await expect(page.getByRole('alert').filter({ hasText: 'Часть заданий' })).toBeVisible();
    await expect(page.getByText('Заданий и тестов пока нет.', { exact: false })).toHaveCount(0);
    if (failedWork === 'assignments') {
      await page.getByRole('button', { name: /Проверка знаний/ }).click();
      await page.getByRole('radio', { name: 'Напряжение' }).check();
    } else {
      await expect(page.getByTestId('seat-assignments')).toBeVisible();
    }
    state.failedWork = null;
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(page.getByTestId('seat-assignments')).toBeVisible();
    await expect(page.getByRole('button', { name: /Проверка знаний/ })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Часть заданий' })).toHaveCount(0);
    if (failedWork === 'assignments')
      await expect(page.getByRole('radio', { name: 'Напряжение' })).toBeChecked();
    expect(
      state.writes.filter(
        (path) => !path.startsWith('/api/analytics/') && !path.startsWith('/api/diagnostics/'),
      ),
    ).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

for (const status of [403, 503]) {
  test(`Seat: partial zero with ${status} is an error until both reads succeed`, async ({
    page,
  }) => {
    const state = await fixture(page, 'seat', 0);
    state.failedWork = 'quizzes';
    state.workStatus = status;
    await page.goto('/#/learning?view=assignments');
    await expect(page.getByRole('alert').filter({ hasText: 'Часть заданий' })).toBeVisible();
    await expect(page.getByText('Заданий и тестов пока нет.', { exact: false })).toHaveCount(0);
    state.failedWork = null;
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(page.getByText('Заданий и тестов пока нет.', { exact: false })).toBeVisible();
    expect(
      state.writes.filter(
        (path) => !path.startsWith('/api/analytics/') && !path.startsWith('/api/diagnostics/'),
      ),
    ).toEqual([]);
  });
}

test('Seat: existing quiz interaction and submit stay available', async ({ page }) => {
  const state = await fixture(page, 'seat', 1);
  await page.goto('/#/learning?view=assignments');
  await page.getByRole('button', { name: /Проверка знаний/ }).click();
  await page.getByRole('radio', { name: 'Напряжение', exact: true }).check();
  expect(
    await page
      .getByRole('radio', { name: 'Напряжение', exact: true })
      .evaluate((input) => input.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(20);
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await layout(page);
    await page.screenshot({ path: `${evidence}/seat-open-quiz-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Завершить и проверить', exact: true }).click();
  await expect(page.getByText('Тест пройден · 100%', { exact: true })).toBeVisible();
  expect(state.writes).toContain('/api/class-join/me/quizzes/quiz-1/submit');
  expect(state.errors).toEqual([]);
});

test('Account: class join and class-scoped awards stay embedded', async ({ page }) => {
  const state = await fixture(page, 'account', 1);
  await page.goto('/#/learning?joinRequest=request');
  await page.getByLabel('Код класса', { exact: true }).fill('ABC DEF 234');
  await page.getByRole('button', { name: 'Войти в класс', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Заявка в класс' })).toBeVisible();
  expect(state.joins).toBe(1);
  await page.getByRole('button', { name: 'Мой рейтинг и заслуги', exact: true }).first().click();
  await expect(page.getByRole('region', { name: 'Мои показатели' })).toBeVisible();
  await expect(page.getByText('За исследование', { exact: true })).toBeVisible();
  expect(state.reads).toContain('/api/classrooms/class-1/participants/seat-1/profile');
  expect(state.reads).not.toContain('/api/class-join/participants/me');
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await layout(page);
    await page.screenshot({ path: `${evidence}/account-open-awards-${width}.png`, fullPage: true });
  }
  expect(state.errors).toEqual([]);
});
