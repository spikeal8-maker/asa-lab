// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningPage, learningSection, hasCourseAssignment } from '../LearningPage';
import {
  api,
  type SeatCourseRun,
  type ClassroomStudentSession,
  type SeatAssignment,
  type LearnerQuiz,
  type LearnerResult,
} from '../../api';
import { setTelemetryContext } from '../../telemetry-context';
import { AttendedClassesPage } from '../AttendedClassesPage';

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

const retrySeat = {
  student: { seatId: 'seat-2' },
  classroom: { title: 'Класс 2' },
  expiresAt: '2099-01-01',
} as ClassroomStudentSession;
const retryWork = {
  id: 'work',
  title: 'Доступная работа',
  moduleKey: 'electronics',
  status: 'open',
  projectId: null,
  submittedAt: null,
} as SeatAssignment;
const retryQuiz = {
  assignmentId: 'quiz',
  title: 'Настоящий тест',
  status: 'open',
  attemptLimit: 2,
  attemptsUsed: 0,
  totalPoints: 1,
  questions: [
    {
      versionId: 'question',
      type: 'single_choice',
      promptBlocks: [{ text: 'Вопрос' }],
      responseSchema: { options: [{ id: 'yes', label: 'Ответ' }] },
      maxPoints: 1,
    },
  ],
} as LearnerQuiz;

describe('Seat work load retry', () => {
  it.each(['seatAssignments', 'seatQuizzes'] as const)(
    'retires pending %s on Seat lifetime change and unmount',
    async (endpoint) => {
      reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
      const container = document.createElement('div');
      const root = createRoot(container);
      type Result = Awaited<ReturnType<(typeof api)[typeof endpoint]>>;
      const pending: ((result: Result) => void)[] = [];
      vi.spyOn(api, 'seatAssignments').mockResolvedValue({
        ok: true,
        status: 200,
        data: { items: [] },
      });
      vi.spyOn(api, 'seatQuizzes').mockResolvedValue({
        ok: true,
        status: 200,
        data: { items: [] },
      });
      if (endpoint === 'seatAssignments')
        vi.spyOn(api, 'seatAssignments').mockImplementation(
          () => new Promise((resolve) => pending.push(resolve as (result: Result) => void)),
        );
      else
        vi.spyOn(api, 'seatQuizzes').mockImplementation(
          () => new Promise((resolve) => pending.push(resolve as (result: Result) => void)),
        );
      const success = {
        ok: true,
        status: 200,
        data: { items: endpoint === 'seatAssignments' ? [retryWork] : [retryQuiz] },
      } as Result;
      const title = endpoint === 'seatAssignments' ? retryWork.title : retryQuiz.title;
      const render = (expiresAt: string) =>
        root.render(
          createElement(LearningPage, {
            seat: { ...retrySeat, expiresAt },
            onOpenProject: vi.fn(),
          }),
        );
      try {
        window.history.replaceState(null, '', '#/learning?view=assignments');
        await act(async () => render('first'));
        await act(async () => render('second'));
        expect(pending).toHaveLength(2);
        await act(async () => pending[0](success));
        expect(container.textContent).not.toContain(title);
        expect(container.textContent).toContain('Загружаем задания');
        await act(async () => pending[1](success));
        expect(container.textContent).toContain(title);
        await act(async () => render('third'));
        await act(async () => root.unmount());
        await act(async () => pending[2](success));
        expect(container.textContent).toBe('');
      } finally {
        await act(async () => root.unmount());
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
      }
    },
  );

  it.each(['assignments', 'quizzes'] as const)(
    'recovers %s without losing visible work or quiz answers',
    async (failed) => {
      reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
      const container = document.createElement('div');
      const root = createRoot(container);
      let unavailable = true;
      const failure = {
        ok: false as const,
        status: 503,
        error: { code: 'unavailable', message: 'Retry' },
      };
      const assignments = vi
        .spyOn(api, 'seatAssignments')
        .mockImplementation(async () =>
          failed === 'assignments' && unavailable
            ? failure
            : { ok: true, status: 200, data: { items: [retryWork] } },
        );
      const quizzes = vi
        .spyOn(api, 'seatQuizzes')
        .mockImplementation(async () =>
          failed === 'quizzes' && unavailable
            ? failure
            : { ok: true, status: 200, data: { items: [retryQuiz] } },
        );
      const submit = vi.spyOn(api, 'submitSeatQuiz');
      const start = vi.spyOn(api, 'startLearningWork');
      const open = vi.fn();
      try {
        window.history.replaceState(null, '', '#/learning?view=assignments');
        await act(async () =>
          root.render(createElement(LearningPage, { seat: retrySeat, onOpenProject: open })),
        );
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('Часть заданий');
        expect(container.textContent).not.toContain('Заданий и тестов пока нет');
        expect(container.textContent).toContain(
          failed === 'quizzes' ? retryWork.title : retryQuiz.title,
        );
        if (failed === 'assignments') {
          await act(async () =>
            (container.querySelector('.seat-quiz-summary') as HTMLButtonElement).click(),
          );
          await act(async () =>
            (container.querySelector('input[type="radio"]') as HTMLInputElement).click(),
          );
          // A later GET failure must retain the already loaded quiz and answer.
          quizzes.mockResolvedValueOnce(failure);
          await act(async () =>
            (container.querySelector('[role="alert"] button') as HTMLButtonElement).click(),
          );
          expect(container.querySelector('[role="alert"]')).not.toBeNull();
          expect((container.querySelector('input[type="radio"]') as HTMLInputElement).checked).toBe(
            true,
          );
        }
        unavailable = false;
        await act(async () =>
          (container.querySelector('[role="alert"] button') as HTMLButtonElement).click(),
        );
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(container.textContent).toContain(retryWork.title);
        expect(container.textContent).toContain(retryQuiz.title);
        if (failed === 'assignments')
          expect((container.querySelector('input[type="radio"]') as HTMLInputElement).checked).toBe(
            true,
          );
        expect(assignments).toHaveBeenCalledTimes(failed === 'assignments' ? 3 : 2);
        expect(quizzes).toHaveBeenCalledTimes(failed === 'assignments' ? 3 : 2);
        expect(submit).not.toHaveBeenCalled();
        expect(start).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
      } finally {
        await act(async () => root.unmount());
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
      }
    },
  );

  it.each([403, 503])('does not label partial empty results as empty on %s', async (status) => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    vi.spyOn(api, 'seatAssignments').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    const quizzes = vi
      .spyOn(api, 'seatQuizzes')
      .mockResolvedValue({ ok: false, status, error: { code: 'unavailable', message: 'Retry' } });
    try {
      window.history.replaceState(null, '', '#/learning?view=assignments');
      await act(async () =>
        root.render(createElement(LearningPage, { seat: retrySeat, onOpenProject: vi.fn() })),
      );
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(container.textContent).not.toContain('Заданий и тестов пока нет');
      quizzes.mockResolvedValue({ ok: true, status: 200, data: { items: [] } });
      await act(async () =>
        (container.querySelector('[role="alert"] button') as HTMLButtonElement).click(),
      );
      expect(container.textContent).toContain('Заданий и тестов пока нет');
    } finally {
      await act(async () => root.unmount());
      reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
});

describe('Seat quiz draft lifetime', () => {
  it.each(['section', 'seat', 'session', 'logout'] as const)(
    'retains answers only when %s keeps the same learner lifetime',
    async (transition) => {
      reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
      const container = document.createElement('div');
      const root = createRoot(container);
      vi.spyOn(api, 'seatAssignments').mockResolvedValue({
        ok: true,
        status: 200,
        data: { items: [] },
      });
      vi.spyOn(api, 'seatQuizzes').mockResolvedValue({
        ok: true,
        status: 200,
        data: { items: [retryQuiz] },
      });
      const submit = vi.spyOn(api, 'submitSeatQuiz');
      const actor = { kind: 'student' as const, seatId: 'seat-2', classId: 'class-2' };
      const render = (seat = retrySeat) =>
        root.render(createElement(LearningPage, { seat, onOpenProject: vi.fn() }));
      const navigate = async (view: string) => {
        await act(async () => {
          window.history.replaceState(null, '', `#/learning?view=${view}`);
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
      };
      const openQuiz = async () => {
        await act(async () =>
          (container.querySelector('.seat-quiz-summary') as HTMLButtonElement).click(),
        );
      };
      try {
        window.history.replaceState(null, '', '#/learning?view=assignments');
        await act(async () => {
          setTelemetryContext(actor, true, 'learning');
          render();
        });
        await openQuiz();
        await act(async () =>
          (container.querySelector('input[type="radio"]') as HTMLInputElement).click(),
        );
        expect((container.querySelector('input[type="radio"]') as HTMLInputElement).checked).toBe(
          true,
        );
        await navigate('classes');
        if (transition === 'seat')
          await act(async () =>
            render({ ...retrySeat, student: { ...retrySeat.student, seatId: 'seat-3' } }),
          );
        if (transition === 'session')
          await act(async () => render({ ...retrySeat, expiresAt: '2099-02-01' }));
        if (transition === 'logout')
          await act(async () => {
            setTelemetryContext(null, false, 'unknown');
            setTelemetryContext(actor, true, 'learning');
          });
        await navigate('assignments');
        await openQuiz();
        expect((container.querySelector('input[type="radio"]') as HTMLInputElement).checked).toBe(
          transition === 'section',
        );
        expect(submit).not.toHaveBeenCalled();
      } finally {
        await act(async () => root.unmount());
        setTelemetryContext(null, false, 'unknown');
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
      }
    },
  );

  it('keeps reused question versions in separate assignment drafts', async () => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    vi.spyOn(api, 'seatAssignments').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    vi.spyOn(api, 'seatQuizzes').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [retryQuiz, { ...retryQuiz, assignmentId: 'another-quiz' }] },
    });
    try {
      window.history.replaceState(null, '', '#/learning?view=assignments');
      await act(async () =>
        root.render(createElement(LearningPage, { seat: retrySeat, onOpenProject: vi.fn() })),
      );
      const quizzes = container.querySelectorAll<HTMLButtonElement>('.seat-quiz-summary');
      await act(async () => quizzes[0]!.click());
      await act(async () =>
        (container.querySelector('input[type="radio"]') as HTMLInputElement).click(),
      );
      await act(async () => quizzes[1]!.click());
      expect((container.querySelector('input[type="radio"]') as HTMLInputElement).checked).toBe(
        false,
      );
      await act(async () => quizzes[0]!.click());
      expect((container.querySelector('input[type="radio"]') as HTMLInputElement).checked).toBe(
        true,
      );
    } finally {
      await act(async () => root.unmount());
      reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('retires pending target reads on hashchange, identity change and unmount', async () => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  const root = createRoot(container);
  type Result = Awaited<ReturnType<typeof api.accountCourseRuns>>;
  const pending: ((result: Result) => void)[] = [];
  vi.spyOn(api, 'accountCourseRuns').mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const navigate = async (hash: string) => {
    await act(async () => {
      window.history.replaceState(null, '', hash);
      window.dispatchEvent(new Event('hashchange'));
    });
  };
  const failure = {
    ok: false,
    status: 503,
    error: { code: 'unavailable', message: 'Retry' },
  } as Result;
  try {
    window.history.replaceState(null, '', '#/learning?assignment=course-work');
    await act(async () =>
      root.render(createElement(LearningPage, { seat: null, onOpenProject: vi.fn() })),
    );
    expect(pending).toHaveLength(1);
    await navigate('#/learning?view=self');
    await act(async () => pending[0](failure));
    expect(container.textContent).toContain('Учитесь в своём темпе');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await navigate('#/learning?assignment=course-work');
    expect(pending).toHaveLength(2);
    await act(async () =>
      setTelemetryContext({ kind: 'account', accountId: 'b', workspaceId: 'b' }, true, 'learning'),
    );
    expect(pending).toHaveLength(3);
    await act(async () => pending[1](failure));
    expect(container.textContent).toContain('Загружаем задание');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => pending[2](failure));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Не удалось найти');
    await act(async () => container.querySelector('button')!.click());
    expect(pending).toHaveLength(4);
    await act(async () => root.unmount());
    await act(async () => pending[3](failure));
    expect(container.textContent).toBe('');
  } finally {
    await act(async () => root.unmount());
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
  }
});

describe('learning workspace destinations', () => {
  it.each(['standalone', 'course lesson', 'nested practice', 'quiz'] as const)(
    'opens a completed %s in its exact destination without stale section hints',
    async (kind) => {
      reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
      const container = document.createElement('div');
      const root = createRoot(container);
      const assignmentId = 'completed-work';
      const course = kind === 'course lesson' || kind === 'nested practice';
      const runs = course
        ? ([
            {
              id: 'target-course',
              title: 'Нужный курс',
              status: 'open',
              sections: [
                {
                  id: 'target-section',
                  title: 'Раздел',
                  lessons: [
                    {
                      id: 'target-lesson',
                      title: 'Нужный урок',
                      kind: 'material',
                      content: 'Материал',
                      blocks: [],
                      completedAt: null,
                      classroomAssignmentId: kind === 'course lesson' ? assignmentId : null,
                      activityOccurrences:
                        kind === 'nested practice' ? [{ classroomAssignmentId: assignmentId }] : [],
                    },
                  ],
                },
              ],
            },
          ] as unknown as SeatCourseRun[])
        : [];
      vi.spyOn(api, 'seatCourseRuns').mockResolvedValue({
        ok: true,
        status: 200,
        data: { items: runs },
      });
      vi.spyOn(api, 'seatResults').mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          items: [
            {
              assignmentId,
              assignmentTitle: 'Завершённая работа',
              classroomTitle: 'Класс 2',
              attemptNumber: 1,
              canonicalState: {
                workflowState: 'completed',
                selectedResult: { displayGrade: '5' },
              },
            } as LearnerResult,
          ],
        },
      });
      vi.spyOn(api, 'seatAssignments').mockResolvedValue({
        ok: true,
        status: 200,
        data: { items: kind === 'standalone' ? [{ ...retryWork, id: assignmentId }] : [] },
      });
      vi.spyOn(api, 'seatQuizzes').mockResolvedValue({
        ok: true,
        status: 200,
        data: { items: kind === 'quiz' ? [{ ...retryQuiz, assignmentId }] : [] },
      });
      const submit = vi.spyOn(api, 'submitSeatQuiz');
      const start = vi.spyOn(api, 'startLearningWork');
      const completedHash =
        '#/learning?view=completed&journalColumn=old-column&journalMonth=2026-10&courseRun=old-course&lesson=old-lesson&joinRequest=old-request&learner=seat-2';
      const navigate = (hash: string) =>
        act(async () => {
          window.history.replaceState(null, '', hash);
          window.dispatchEvent(new Event('hashchange'));
        });
      try {
        window.history.replaceState(null, '', completedHash);
        await act(async () =>
          root.render(createElement(LearningPage, { seat: retrySeat, onOpenProject: vi.fn() })),
        );
        const link = container.querySelector(
          '[aria-labelledby="learning-completed-results"] li a',
        ) as HTMLAnchorElement;
        expect(link.textContent).toBe('Завершённая работа');
        const href = '#/learning?learner=seat-2&assignment=completed-work';
        expect(link.getAttribute('href')).toBe(href);
        await navigate(href);
        expect(container.querySelector('[aria-current="page"]')?.textContent).toBe(
          course ? 'Курсы' : 'Задания',
        );
        if (course)
          expect(
            container.querySelector('[data-testid="seat-course-player"]')?.textContent,
          ).toContain('Нужный урок');
        else
          expect(
            container
              .querySelector(kind === 'quiz' ? '.seat-quiz-summary' : '.seat-assignment-open')
              ?.getAttribute('aria-expanded'),
          ).toBe('true');
        await navigate(completedHash);
        expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Завершённое');
        expect(container.textContent).toContain('Завершённая работа');
        expect(start).not.toHaveBeenCalled();
        expect(submit).not.toHaveBeenCalled();
      } finally {
        await act(async () => root.unmount());
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
      }
    },
  );

  for (const identity of ['seat', 'account'] as const) {
    it.each([false, true])(
      `${identity}: explicit sections override a resolved %s nested assignment destination`,
      async (nested) => {
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        const root = createRoot(container);
        const runs = [
          {
            id: 'course',
            title: 'Нужный курс',
            status: 'open',
            sections: [
              {
                id: 'section',
                title: 'Раздел',
                lessons: [
                  {
                    id: 'lesson',
                    title: 'Нужный урок',
                    kind: 'material',
                    content: 'Материал',
                    blocks: [],
                    completedAt: null,
                    classroomAssignmentId: nested ? null : 'course-work',
                    activityOccurrences: nested ? [{ classroomAssignmentId: 'course-work' }] : [],
                  },
                ],
              },
            ],
          },
        ] as unknown as SeatCourseRun[];
        const courses = vi
          .spyOn(api, identity === 'seat' ? 'seatCourseRuns' : 'accountCourseRuns')
          .mockResolvedValue({ ok: true, status: 200, data: { items: runs } });
        vi.spyOn(api, 'seatAssignments').mockResolvedValue({
          ok: true,
          status: 200,
          data: { items: [retryWork] },
        });
        vi.spyOn(api, 'seatQuizzes').mockResolvedValue({
          ok: true,
          status: 200,
          data: { items: [] },
        });
        vi.spyOn(api, 'attendedClasses').mockResolvedValue({
          ok: true,
          status: 200,
          data: { items: [] },
        });
        vi.spyOn(api, 'attendedAssignments').mockResolvedValue({
          ok: true,
          status: 200,
          data: { items: [] },
        });
        const navigate = async (hash: string) =>
          act(async () => {
            window.history.replaceState(null, '', hash);
            window.dispatchEvent(new Event('hashchange'));
          });
        const current = () => container.querySelector('[aria-current="page"]')?.textContent;
        try {
          window.history.replaceState(
            null,
            '',
            '#/learning?assignment=course-work&attempt=attempt',
          );
          await act(async () =>
            root.render(
              createElement(LearningPage, {
                seat: identity === 'seat' ? retrySeat : null,
                onOpenProject: vi.fn(),
              }),
            ),
          );
          expect(current()).toBe('Курсы');
          expect(
            container.querySelector('[data-testid="seat-course-player"]')?.textContent,
          ).toContain('Нужный урок');
          expect(courses).toHaveBeenCalledTimes(2);
          await navigate(
            '#/learning?view=assignments&assignment=course-work&attempt=attempt&courseRun=course&lesson=lesson',
          );
          expect(current()).toBe('Задания');
          expect(container.querySelector('[data-testid="seat-course-player"]')).toBeNull();
          expect(courses).toHaveBeenCalledTimes(2);
          await navigate('#/learning?view=courses&assignment=course-work');
          expect(current()).toBe('Курсы');
          expect(courses).toHaveBeenCalledTimes(3);
          await navigate('#/learning?courseRun=course&lesson=lesson');
          expect(current()).toBe('Курсы');
          expect(
            container.querySelector('[data-testid="seat-course-player"]')?.textContent,
          ).toContain('Нужный урок');
          expect(courses).toHaveBeenCalledTimes(4);
          for (const link of container.querySelectorAll('nav a')) {
            const query = new URLSearchParams(link.getAttribute('href')!.split('?')[1]);
            for (const key of ['assignment', 'attempt', 'courseRun', 'lesson'])
              expect(query.has(key)).toBe(false);
          }
        } finally {
          await act(async () => root.unmount());
          reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
        }
      },
    );
  }

  it('distinguishes course lesson and nested practice IDs from standalone assignments', () => {
    const runs = [
      {
        sections: [
          {
            lessons: [
              {
                classroomAssignmentId: 'lesson-work',
                activityOccurrences: [{ classroomAssignmentId: 'nested-work' }],
              },
            ],
          },
        ],
      },
    ] as SeatCourseRun[];
    expect(hasCourseAssignment(runs, 'lesson-work')).toBe(true);
    expect(hasCourseAssignment(runs, 'nested-work')).toBe(true);
    expect(hasCourseAssignment(runs, 'standalone')).toBe(false);
    expect(hasCourseAssignment([], 'standalone')).toBe(false);
  });
  it.each([
    ['#/learning', 'overview'],
    ['#/learning?view=unknown', 'overview'],
    ['#/learning?assignment=work&learner=seat', 'assignments'],
    ['#/learning?courseRun=course&lesson=lesson&assignment=work', 'courses'],
    ['#/learning?journalColumn=column&journalMonth=2026-10', 'results'],
    ['#/learning?joinRequest=request', 'classes'],
    ['#/learning?learner=seat', 'classes'],
    ['#/learning?view=completed&assignment=work', 'completed'],
    ['#/learning?view=assignments&assignment=work&courseRun=course&lesson=lesson', 'assignments'],
    ['#/learning?view=courses&assignment=work', 'courses'],
  ])('routes %s to %s without changing academic state', (hash, section) => {
    expect(learningSection(hash)).toBe(section);
  });

  it('embeds Account with one main, one page heading and one navigation', () => {
    vi.stubGlobal('window', { location: { hash: '#/learning?view=classes&learner=seat' } });
    const html = renderToStaticMarkup(
      createElement(LearningPage, { seat: null, onOpenProject: vi.fn() }),
    );
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/id="main-content"/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Разделы моего обучения"');
    expect(html).toContain('attend-code');
    expect(html).toContain('view=courses&amp;learner=seat');
    expect(html).not.toContain('attended-heading');
  });

  it('keeps the standalone Account class page landmark and join form', () => {
    vi.stubGlobal('window', { location: { hash: '#/classes' } });
    const html = renderToStaticMarkup(
      createElement(AttendedClassesPage, { onOpenProject: vi.fn() }),
    );
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain('>Я учусь</h1>');
    expect(html).toContain('attend-code');
    expect(html).toContain('Мои оценки по датам');
  });
});
