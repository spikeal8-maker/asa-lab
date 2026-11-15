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
  type LearningQuizAttempt,
} from '../../api';
import { setTelemetryContext } from '../../telemetry-context';
import * as apiCall from '../../api-call';
import type { PersonalProgressSummaryV1 } from '@asa-lab/contracts';
import type { OwnProgressActor } from '../../creator-portal/personal-progress';
import { AttendedClassesPage } from '../AttendedClassesPage';

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

const retrySeat = {
  authenticated: true,
  student: { seatId: 'seat-2', displayName: 'Ученик', safeMode: true, avatarKey: null },
  classroom: { id: 'class-2', title: 'Класс 2', teacherDisplayName: 'Преподаватель' },
  expiresAt: '2099-01-01',
} as ClassroomStudentSession;
const accountActor: OwnProgressActor = {
  kind: 'account',
  accountId: 'account-learning',
  displayName: 'Ученик',
};
function progressActor(seat: ClassroomStudentSession): OwnProgressActor {
  return {
    kind: 'seat',
    seatId: seat.student.seatId,
    classroomId: seat.classroom.id ?? 'class-learning',
    displayName: seat.student.displayName ?? 'Ученик',
    avatarKey: seat.student.avatarKey ?? null,
  };
}
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
            actor: progressActor(retrySeat),
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
          root.render(
            createElement(LearningPage, {
              seat: retrySeat,
              actor: progressActor(retrySeat),
              onOpenProject: open,
            }),
          ),
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
        root.render(
          createElement(LearningPage, {
            seat: retrySeat,
            actor: progressActor(retrySeat),
            onOpenProject: vi.fn(),
          }),
        ),
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
        root.render(
          createElement(LearningPage, { seat, actor: progressActor(seat), onOpenProject: vi.fn() }),
        );
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
        root.render(
          createElement(LearningPage, {
            seat: retrySeat,
            actor: progressActor(retrySeat),
            onOpenProject: vi.fn(),
          }),
        ),
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

describe('Account Direct quiz destination', () => {
  function mockDirectQuiz(attempt: LearningQuizAttempt | null = null) {
    const quizWire = {
      id: 'account-direct-quiz',
      activityKind: 'quiz',
      activityRunId: 'account-direct-quiz-run',
      title: 'Проверка электрической цепи',
      brief: null,
      goal: null,
      blocks: [],
      moduleKey: null,
      dueAt: null,
      status: 'open',
      sampleImage: null,
      projectId: null,
      submittedAt: null,
      snapshotRevision: null,
      updatedAt: null,
      canonicalState: null,
      classroomTitle: 'Электроника',
    } satisfies Omit<SeatAssignment, 'moduleKey'> & {
      moduleKey: null;
      classroomTitle: string;
    };
    // Modern Direct quiz DTOs have no project/module, including after Start.
    // The older shared SeatAssignment type still declares moduleKey as string.
    const quiz = quizWire as unknown as SeatAssignment & { classroomTitle: string };
    const other: SeatAssignment & { classroomTitle: string } = {
      ...quiz,
      id: 'account-other-work',
      activityKind: 'project',
      activityRunId: 'account-other-run',
      moduleKey: 'electronics',
      title: 'Соберите электрическую цепь',
    };
    const assignments = vi.spyOn(api, 'attendedAssignments').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [quiz, other] },
    });
    vi.spyOn(api, 'attendedClasses').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          {
            seatId: 'account-linked-seat',
            classroomId: 'account-classroom',
            classroomTitle: 'Электроника',
            teacherDisplayName: 'Преподаватель',
            openCount: 2,
            unfinishedCount: 2,
          },
        ],
      },
    });
    const courses = vi.spyOn(api, 'accountCourseRuns').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    const read = vi.spyOn(api, 'readQuizLearning').mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        participationId: 'account-quiz-participation',
        attempt,
        title: quiz.title,
        instructions: 'Выберите верное утверждение.',
        canStart: true,
      },
    });
    const started: LearningQuizAttempt = {
      attemptId: 'account-quiz-attempt',
      version: 1,
      answers: {},
      questions: [
        {
          id: 'account-quiz-question',
          type: 'boolean',
          promptBlocks: [{ type: 'text', text: 'Замкнутая цепь проводит ток.' }],
          maxPoints: 1,
        },
      ],
      questionOrder: ['account-quiz-question'],
      state: 'in_progress',
      expiresAt: null,
      serverNow: new Date().toISOString(),
      lastSavedAt: null,
    };
    const start = vi.spyOn(api, 'startQuizLearning').mockResolvedValue({
      ok: true,
      status: 200,
      data: { attempt: started, reused: false },
    });
    const failure = {
      ok: false as const,
      status: 409,
      error: { code: 'unexpected_mutation', message: 'Неожиданная команда' },
    };
    const projectStart = vi.spyOn(api, 'startLearningWork').mockResolvedValue(failure);
    const save = vi.spyOn(api, 'saveQuizAnswers').mockResolvedValue(failure);
    const submit = vi.spyOn(api, 'submitQuizAttempt').mockResolvedValue(failure);
    return { quiz, other, assignments, courses, read, started, start, projectStart, save, submit };
  }

  it.each(['assignment link', 'closed card'] as const)(
    'reads the real player from an Account %s and starts only on explicit action',
    async (entry) => {
      reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      const fixture = mockDirectQuiz();
      const open = vi.fn();
      try {
        setTelemetryContext(
          { kind: 'account', accountId: accountActor.accountId, workspaceId: 'personal' },
          true,
          'learning',
        );
        window.history.replaceState(
          null,
          '',
          entry === 'assignment link'
            ? `#/learning?assignment=${fixture.quiz.id}`
            : '#/learning?view=assignments',
        );
        await act(async () =>
          root.render(
            createElement(LearningPage, { seat: null, actor: accountActor, onOpenProject: open }),
          ),
        );
        const row = container.querySelector('[data-testid="attended-assignments"] > li')!;
        expect(row.textContent).toContain(fixture.quiz.title);
        expect(fixture.courses).toHaveBeenCalledTimes(entry === 'assignment link' ? 1 : 0);
        if (entry === 'closed card') {
          expect(fixture.read).not.toHaveBeenCalled();
          const action = row.querySelector<HTMLButtonElement>('.seat-assignment-actions button')!;
          expect(action.textContent).toBe('Открыть тест');
          await act(async () => action.click());
        }
        expect(row.querySelector('.quiz-player')).not.toBeNull();
        expect(fixture.read).toHaveBeenCalledExactlyOnceWith(fixture.quiz.activityRunId);
        expect(fixture.start).not.toHaveBeenCalled();
        expect(fixture.projectStart).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
        const start = [...row.querySelectorAll<HTMLButtonElement>('.quiz-player button')].find(
          (button) => button.textContent === 'Начать тест',
        )!;
        expect(start).toBeDefined();
        await act(async () => start.click());
        expect(fixture.start).toHaveBeenCalledExactlyOnceWith(
          'account-quiz-participation',
          expect.any(String),
        );
        expect(fixture.assignments).toHaveBeenCalledTimes(2);
        const legend = row.querySelector<HTMLElement>('.quiz-player legend')!;
        expect(legend.textContent).toContain('Замкнутая цепь проводит ток.');
        // A non-control click bubbles to the assignment row unless the real
        // player is excluded from that row's expand/collapse handler.
        await act(async () => legend.click());
        expect(row.classList.contains('is-open')).toBe(true);
        expect(row.querySelector('.quiz-player legend')).toBe(legend);
        expect(fixture.read).toHaveBeenCalledTimes(1);
        expect(fixture.projectStart).not.toHaveBeenCalled();
        expect(fixture.save).not.toHaveBeenCalled();
        expect(fixture.submit).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
      } finally {
        await act(async () => root.unmount());
        container.remove();
        setTelemetryContext(null, false, 'unknown');
        reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
      }
    },
  );

  it('keeps an unsaved Account Direct quiz answer when the learner refuses an assignment switch', async () => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const fixture = mockDirectQuiz();
    fixture.read.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        participationId: 'account-quiz-participation',
        attempt: fixture.started,
        title: fixture.quiz.title,
        instructions: 'Выберите верное утверждение.',
        canStart: true,
      },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const open = vi.fn();
    try {
      setTelemetryContext(
        { kind: 'account', accountId: accountActor.accountId, workspaceId: 'personal' },
        true,
        'learning',
      );
      window.history.replaceState(null, '', `#/learning?assignment=${fixture.quiz.id}`);
      await act(async () =>
        root.render(
          createElement(LearningPage, { seat: null, actor: accountActor, onOpenProject: open }),
        ),
      );
      const rows = container.querySelectorAll('[data-testid="attended-assignments"] > li');
      const quizRow = rows[0]!;
      const otherRow = rows[1]!;
      expect(quizRow.querySelector('.quiz-player')).not.toBeNull();
      const answer = quizRow.querySelector<HTMLInputElement>('.quiz-player input[type="radio"]')!;
      await act(async () => answer.click());
      expect(answer.checked).toBe(true);
      expect(quizRow.textContent).toContain('Есть несохранённые ответы');
      const other = otherRow.querySelector<HTMLButtonElement>('.seat-assignment-open')!;
      await act(async () => other.click());
      expect(confirm).toHaveBeenCalledExactlyOnceWith(
        'Ответы ещё не сохранены. Выйти? Ответы останутся в этой учебной сессии.',
      );
      expect(quizRow.classList.contains('is-open')).toBe(true);
      expect(other.getAttribute('aria-expanded')).toBe('false');
      expect(quizRow.querySelector('.quiz-player input')).toBe(answer);
      expect(answer.checked).toBe(true);
      expect(fixture.read).toHaveBeenCalledExactlyOnceWith(fixture.quiz.activityRunId);
      expect(fixture.start).not.toHaveBeenCalled();
      expect(fixture.projectStart).not.toHaveBeenCalled();
      expect(fixture.save).not.toHaveBeenCalled();
      expect(fixture.submit).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      await act(async () => other.click());
      expect(quizRow.classList.contains('is-open')).toBe(false);
      expect(other.getAttribute('aria-expanded')).toBe('true');
      expect(container.querySelector('.quiz-player')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.useRealTimers();
      setTelemetryContext(null, false, 'unknown');
      reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
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
      root.render(
        createElement(LearningPage, { seat: null, actor: accountActor, onOpenProject: vi.fn() }),
      ),
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
          root.render(
            createElement(LearningPage, {
              seat: retrySeat,
              actor: progressActor(retrySeat),
              onOpenProject: vi.fn(),
            }),
          ),
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
                actor: identity === 'seat' ? progressActor(retrySeat) : accountActor,
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
      createElement(LearningPage, { seat: null, actor: accountActor, onOpenProject: vi.fn() }),
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

function ownProgressSummary(actor: OwnProgressActor, groups = 3): PersonalProgressSummaryV1 {
  return {
    scope:
      actor.kind === 'account'
        ? { kind: 'account', accountId: actor.accountId }
        : { kind: 'seat', seatId: actor.seatId, classroomId: actor.classroomId },
    asOf: '2026-11-12',
    availability: 'available',
    metrics: {
      everPublishedWorks: { availability: 'available', value: 0 },
      currentLikes: { availability: 'available', value: 0 },
      createdCopies: { availability: 'available', value: 0 },
      activePublicWorks: { availability: 'available', value: 0 },
    },
    coverage: {
      everPublishedWorks: {
        basis: 'confirmed_publication_revisions',
        completeness: 'complete',
        knownSince: null,
        limitations: [],
      },
      currentLikes: {
        basis: 'current_publication_likes',
        completeness: 'complete',
        knownSince: null,
        limitations: [],
      },
      createdCopies: {
        basis: 'durable_publication_copy_receipts',
        completeness: 'complete',
        knownSince: null,
        limitations: [],
      },
      activePublicWorks: {
        basis: 'current_catalog_visibility',
        completeness: 'complete',
        knownSince: null,
        limitations: [],
      },
    },
    personalRating: { availability: 'not_enabled', value: null },
    groups: {
      availability: 'available',
      hasMore: false,
      nextCursor: null,
      items: Array.from({ length: groups }, (_, index) => ({
        groupId: `group-${index}`,
        title: `Моя группа ${index}`,
        periodDays: 30,
        own: { availability: 'available', score: index === 0 ? 0 : 68.25, rank: index + 1 },
      })),
    },
  };
}

describe('Personal Learning overview', () => {
  it('renders all own groups and available sections while another read is pending or failed', async () => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    let finishAssignments!: (value: Awaited<ReturnType<typeof api.attendedAssignments>>) => void;
    const assignments = vi.spyOn(api, 'attendedAssignments').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishAssignments = resolve;
        }),
    );
    const courses = vi
      .spyOn(api, 'accountCourseRuns')
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        error: { code: 'unavailable', message: 'Ошибка' },
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { items: [] } });
    const results = vi
      .spyOn(api, 'accountResults')
      .mockResolvedValue({ ok: true, status: 200, data: { items: [] } });
    vi.spyOn(api, 'accountAvatar').mockResolvedValue({
      ok: true,
      status: 200,
      data: { avatarDataUrl: null },
    });
    const summary = vi
      .spyOn(apiCall, 'call')
      .mockResolvedValue({ ok: true, status: 200, data: ownProgressSummary(accountActor) });
    try {
      window.history.replaceState(null, '', '#/learning');
      setTelemetryContext(
        { kind: 'account', accountId: accountActor.accountId, workspaceId: 'personal' },
        true,
        'learning',
      );
      await act(async () =>
        root.render(
          createElement(LearningPage, { seat: null, actor: accountActor, onOpenProject: vi.fn() }),
        ),
      );
      expect(container.querySelectorAll('[data-testid="own-progress-group"]')).toHaveLength(3);
      expect(container.querySelector('[data-testid="own-progress-score"]')?.textContent).toBe('0');
      expect(
        container.querySelector('.learning-overview-metrics a[href*="view=results"] strong')
          ?.textContent,
      ).toBe('0');
      expect(
        container.querySelector('.learning-overview-metrics a[href*="view=assignments"] strong')
          ?.textContent,
      ).toBe('—');
      expect(container.textContent).toContain('Часть обзора недоступна');
      expect(container.textContent).not.toContain('Не удалось загрузить задания');
      expect(
        container.querySelector('.personal-progress a[href="#/learning?view=results"]')
          ?.textContent,
      ).toBe('Результаты и заслуги');
      const retry = [...container.querySelectorAll('button')].find(
        (node) => node.textContent === 'Повторить',
      )!;
      await act(async () => retry.click());
      expect(courses).toHaveBeenCalledTimes(2);
      expect(assignments).toHaveBeenCalledTimes(1);
      expect(results).toHaveBeenCalledTimes(1);
      expect(summary).toHaveBeenCalledTimes(1);
      await act(async () =>
        finishAssignments({
          ok: true,
          status: 200,
          data: { items: [{ ...retryWork, classroomTitle: 'Класс' }] },
        }),
      );
      expect(container.textContent).toContain('Доступная работа');
      expect(
        container.querySelector('.learning-overview-metrics a[href*="view=assignments"] strong')
          ?.textContent,
      ).toBe('1');
      expect(container.textContent).not.toContain('Загружаем обзор');
    } finally {
      await act(async () => root.unmount());
      setTelemetryContext(null, false, 'unknown');
      reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });

  it('loads the next group cursor only on demand and preserves results navigation', async () => {
    reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    const first = ownProgressSummary(accountActor, 20);
    const last = ownProgressSummary(accountActor, 1);
    const read = vi
      .spyOn(apiCall, 'call')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { ...first, groups: { ...first.groups, hasMore: true, nextCursor: 'next20' } },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          ...last,
          groups: {
            ...last.groups,
            items: [{ ...last.groups.items![0]!, groupId: 'group-20', title: 'Последняя группа' }],
          },
        },
      });
    vi.spyOn(api, 'accountAvatar').mockResolvedValue({
      ok: true,
      status: 200,
      data: { avatarDataUrl: null },
    });
    vi.spyOn(api, 'attendedAssignments').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    vi.spyOn(api, 'accountCourseRuns').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    vi.spyOn(api, 'accountResults').mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [] },
    });
    try {
      window.history.replaceState(null, '', '#/learning');
      setTelemetryContext(
        { kind: 'account', accountId: accountActor.accountId, workspaceId: 'personal' },
        true,
        'learning',
      );
      await act(async () =>
        root.render(
          createElement(LearningPage, { seat: null, actor: accountActor, onOpenProject: vi.fn() }),
        ),
      );
      expect(container.querySelectorAll('[data-testid="own-progress-group"]')).toHaveLength(20);
      expect(read).toHaveBeenCalledTimes(1);
      const button = [...container.querySelectorAll('button')].find(
        (node) => node.textContent === 'Показать ещё группы',
      )!;
      await act(async () => button.click());
      expect(container.querySelectorAll('[data-testid="own-progress-group"]')).toHaveLength(21);
      expect(read.mock.calls[1]![0]).toBe('/api/progress/summary?cursor=next20');
      expect(container.textContent).not.toContain('Показать ещё группы');
      expect(
        container.querySelector('.personal-progress a[href="#/learning?view=results"]'),
      ).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      setTelemetryContext(null, false, 'unknown');
      reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
    }
  });
});
