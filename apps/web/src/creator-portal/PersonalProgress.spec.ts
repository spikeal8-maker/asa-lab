// @vitest-environment jsdom

import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnProgressGroupV1, PersonalProgressSummaryV1 } from '@asa-lab/contracts';
import {
  api,
  type ApiResult,
  type LearnerQuiz,
  type LearningQuizAttempt,
  type SeatAssignment,
} from '../api';
import * as apiCall from '../api-call';
import { setTelemetryContext } from '../telemetry-context';
import { PersonalProgress } from './PersonalProgress';
import {
  nextLearningAction,
  readPersonalProgress,
  usePersonalProgress,
  useProgressLifetime,
  useNextLearningAction,
  useDirectQuizAction,
  type OwnProgressActor,
} from './personal-progress';
import { defaultAvatarForAccount, notifyProfileAvatarChanged, seatAvatar } from './default-avatars';

const account: OwnProgressActor = {
  kind: 'account',
  accountId: 'account-a',
  displayName: 'Александра',
};
const seat: OwnProgressActor = {
  kind: 'seat',
  seatId: 'Raw-Seat-A',
  classroomId: 'class-a',
  displayName: 'Ученик',
  avatarKey: 'asa-avatar-07',
};
const success = <T>(data: T): ApiResult<T> => ({ ok: true, status: 200, data });
const failure: ApiResult<never> = {
  ok: false,
  status: 503,
  error: { code: 'unavailable', message: 'Недоступно' },
};
function group(id: string, score: number | null = 68, rank: number | null = 4): OwnProgressGroupV1 {
  return {
    groupId: id,
    title: `Группа ${id}`,
    periodDays: 30,
    own: { availability: 'available', score, rank },
  };
}
function summary(
  groups: readonly OwnProgressGroupV1[] = [],
  actor: OwnProgressActor = account,
): PersonalProgressSummaryV1 {
  return {
    scope:
      actor.kind === 'account'
        ? { kind: 'account', accountId: actor.accountId.toLowerCase() }
        : {
            kind: 'seat',
            seatId: actor.seatId.toLowerCase(),
            classroomId: actor.classroomId.toLowerCase(),
          },
    asOf: '2026-11-12T12:00:00Z',
    availability: 'available',
    metrics: {
      everPublishedWorks: { availability: 'available', value: 0 },
      currentLikes: { availability: 'available', value: 84 },
      createdCopies: { availability: 'available', value: 17 },
      activePublicWorks: { availability: 'available', value: 0 },
    },
    coverage: {
      everPublishedWorks: {
        basis: 'confirmed_publication_revisions',
        completeness: 'partial',
        knownSince: null,
        limitations: ['history_before_canonical_records_unknown'],
      },
      currentLikes: {
        basis: 'current_publication_likes',
        completeness: 'complete',
        knownSince: null,
        limitations: [],
      },
      createdCopies: {
        basis: 'durable_publication_copy_receipts',
        completeness: 'partial',
        knownSince: null,
        limitations: ['copies_not_supported_by_all_modules'],
      },
      activePublicWorks: {
        basis: 'current_catalog_visibility',
        completeness: 'complete',
        knownSince: null,
        limitations: [],
      },
    },
    personalRating: { availability: 'not_enabled', value: null },
    groups: { availability: 'available', items: groups, hasMore: false, nextCursor: null },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function ready(actor: OwnProgressActor = account, workspaceId = 'personal') {
  setTelemetryContext(
    actor.kind === 'account'
      ? { kind: 'account', accountId: actor.accountId.toLowerCase(), workspaceId }
      : {
          kind: 'student',
          seatId: actor.seatId.toLowerCase(),
          classId: actor.classroomId.toLowerCase(),
        },
    true,
    'home',
  );
}
let host: HTMLDivElement;
let root: Root;
let frames: string[];
let currentProgress: ReturnType<typeof usePersonalProgress>;
function Harness({
  actor = account,
  mode = 'home',
}: {
  actor?: OwnProgressActor;
  mode?: 'home' | 'learning';
}) {
  const progress = usePersonalProgress(actor);
  currentProgress = progress;
  useLayoutEffect(() => {
    frames.push(host.textContent ?? '');
  });
  return createElement(PersonalProgress, { actor, progress, mode });
}
async function render(actor = account, mode: 'home' | 'learning' = 'home') {
  await act(async () => root.render(createElement(Harness, { actor, mode })));
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
beforeEach(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  frames = [];
  ready();
  vi.spyOn(api, 'accountAvatar').mockResolvedValue(success({ avatarDataUrl: null }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setTelemetryContext(null, false, 'unknown');
  vi.restoreAllMocks();
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('Own progress presentation', () => {
  it('shows genuine zero, full fractional score and SQL rank; Home only two groups', async () => {
    const result = summary([group('A', 99.99, 101), group('B', 0, 2), group('C', 12.5, 2)]);
    const read = vi.spyOn(apiCall, 'call').mockResolvedValue(success(result));
    await render();
    expect(host.querySelector('[data-testid="progress-everPublishedWorks"] dd')?.textContent).toBe(
      '0',
    );
    expect(
      host.querySelector('[data-testid="progress-createdCopies"]')?.getAttribute('title'),
    ).toBe('Копии ваших работ');
    expect(host.querySelectorAll('[data-testid="own-progress-group"]')).toHaveLength(2);
    expect(
      [...host.querySelectorAll('[data-testid="own-progress-score"]')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['99,99', '0']);
    expect(host.querySelector('[data-testid="own-progress-rank"]')?.textContent).toBe('101');
    expect(host.querySelector('.personal-progress-self')?.getAttribute('aria-label')).toBe(
      'Вы, 101-е место, рейтинг 99,99',
    );
    expect(host.textContent).not.toMatch(/из \d|\/100|99\+|1\s?240/);
    expect(host.textContent).toContain('Общий рейтинг ещё не рассчитывается');
    expect(host.querySelector('a[href="/#/learning"]')?.textContent).toContain('Все группы');
    await render(account, 'learning');
    expect(host.querySelectorAll('[data-testid="own-progress-group"]')).toHaveLength(3);
    expect(
      [...host.querySelectorAll('[data-testid="own-progress-rank"]')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['101', '2', '2']);
    expect(host.textContent).toContain('12,5');
    expect(host.querySelector('a[href="#/learning?view=results"]')?.textContent).toBe(
      'Результаты и заслуги',
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('distinguishes disabled, ambiguous, partial and unavailable values from zero', async () => {
    const result = summary([
      group('Disabled', null, null),
      {
        ...group('Ambiguous'),
        own: {
          availability: 'unavailable',
          score: null,
          rank: null,
          reason: 'ambiguous_self_participant',
        },
      },
      {
        ...group('Source'),
        own: { availability: 'unavailable', score: null, rank: null, reason: 'source_unavailable' },
      },
    ]);
    vi.spyOn(apiCall, 'call').mockResolvedValue(
      success({
        ...result,
        availability: 'partial',
        metrics: {
          ...result.metrics,
          currentLikes: { availability: 'unavailable', value: null, reason: 'source_unavailable' },
        },
      }),
    );
    await render();
    expect(host.querySelector('[data-testid="progress-currentLikes"] dd')?.textContent).toBe('—');
    expect(host.querySelector('[data-testid="progress-everPublishedWorks"] dd')?.textContent).toBe(
      '0',
    );
    expect(host.textContent).toContain('Часть прогресса сейчас недоступна');
    await render(account, 'learning');
    expect(host.querySelectorAll('[data-testid="own-progress-score"]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-testid="own-progress-rank"]')).toHaveLength(0);
    expect(host.textContent).toContain('Рейтинг выключен');
    expect(host.textContent).toContain('Учебный профиль нужно уточнить у преподавателя');
    expect(host.textContent).toContain('Рейтинг сейчас недоступен');
  });

  it.each([403, 503])(
    'offers a summary retry on %s without inventing empty or numeric results',
    async (status) => {
      vi.spyOn(apiCall, 'call')
        .mockResolvedValueOnce({ ...failure, status })
        .mockResolvedValueOnce(success(summary()));
      await render();
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        status === 403
          ? 'Прогресс сейчас недоступен в этом контексте'
          : 'Не удалось загрузить прогресс',
      );
      expect(
        host.querySelector('[data-testid="progress-everPublishedWorks"] dd')?.textContent,
      ).toBe('—');
      await click('Повторить загрузку прогресса');
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(
        host.querySelector('[data-testid="progress-everPublishedWorks"] dd')?.textContent,
      ).toBe('0');
    },
  );

  it('uses the Seat avatar with its raw ID and never requests the Account avatar', async () => {
    ready(seat);
    vi.spyOn(apiCall, 'call').mockResolvedValue(success(summary([group('Seat')], seat)));
    await render(seat);
    expect(api.accountAvatar).not.toHaveBeenCalled();
    for (const img of host.querySelectorAll('img'))
      expect(img.getAttribute('src')).toBe(seatAvatar(seat.seatId, seat.avatarKey).src);
  });

  it('keeps an avatar change over a late read and falls back after image failure', async () => {
    const avatar = deferred<Awaited<ReturnType<typeof api.accountAvatar>>>();
    vi.mocked(api.accountAvatar).mockReturnValue(avatar.promise);
    vi.spyOn(apiCall, 'call').mockResolvedValue(success(summary()));
    await render();
    await act(async () => notifyProfileAvatarChanged('/avatar-new.webp'));
    await act(async () => avatar.resolve(success({ avatarDataUrl: '/avatar-old.webp' })));
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/avatar-new.webp');
    await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      defaultAvatarForAccount(account.accountId).src,
    );
  });
});

describe('Personal request lifetime', () => {
  it.each(['same-account', 'workspace', 'seat'] as const)(
    'fences summary, avatar and opened pages on %s handoff before passive effects',
    async (handoff) => {
      const oldSummary = summary([group('OLD')]);
      const first = {
        ...oldSummary,
        groups: { ...oldSummary.groups, hasMore: true, nextCursor: 'next-page' },
      };
      const latePage = deferred<ApiResult<PersonalProgressSummaryV1>>();
      const lateInitial = deferred<ApiResult<PersonalProgressSummaryV1>>();
      const lateAvatar = deferred<Awaited<ReturnType<typeof api.accountAvatar>>>();
      const read = vi
        .spyOn(apiCall, 'call')
        .mockResolvedValueOnce(success(first))
        .mockReturnValueOnce(latePage.promise)
        .mockReturnValueOnce(lateInitial.promise);
      vi.mocked(api.accountAvatar)
        .mockReturnValueOnce(lateAvatar.promise)
        .mockResolvedValue(success({ avatarDataUrl: null }));
      await render(account, 'learning');
      await click('Показать ещё группы');
      const oldSignal = read.mock.calls[1]![1]!.signal!;
      const nextActor = handoff === 'seat' ? seat : account;
      frames.length = 0;
      await act(async () => {
        setTelemetryContext(null, false, 'home');
        root.render(createElement(Harness, { actor: nextActor, mode: 'learning' }));
      });
      expect(oldSignal.aborted).toBe(true);
      expect(frames.every((frame) => !frame.includes('Группа OLD'))).toBe(true);
      expect(host.textContent).toContain('Проверяем учебный контекст');
      await act(async () =>
        ready(nextActor, handoff === 'workspace' ? 'other-workspace' : 'personal'),
      );
      await act(async () => {
        latePage.resolve(success(summary([group('STALE PAGE')])));
        lateAvatar.resolve(success({ avatarDataUrl: '/previous-person.webp' }));
      });
      expect(host.textContent).not.toContain('STALE PAGE');
      expect(host.querySelector('img[src="/previous-person.webp"]')).toBeNull();
      await act(async () => lateInitial.resolve(success(summary([group('CURRENT')], nextActor))));
      expect(host.textContent).toContain('Группа CURRENT');
      expect(
        frames.every((frame) => !frame.includes('Группа OLD') && !frame.includes('STALE PAGE')),
      ).toBe(true);
    },
  );

  it('retires a pending initial read on same-ID logout/login and rejects a mismatched scope', async () => {
    const old = deferred<ApiResult<PersonalProgressSummaryV1>>();
    const fresh = deferred<ApiResult<PersonalProgressSummaryV1>>();
    const read = vi
      .spyOn(apiCall, 'call')
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    await render();
    await act(async () => setTelemetryContext(null, false, 'home'));
    await act(async () => ready());
    expect(read.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    await act(async () => old.resolve(success(summary([group('STALE INITIAL')]))));
    expect(host.textContent).not.toContain('STALE INITIAL');
    await act(async () => fresh.resolve(success(summary([group('FRESH')]))));
    expect(host.textContent).toContain('FRESH');
    read.mockResolvedValueOnce(success(summary([], seat)));
    const result = await readPersonalProgress(account, new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('progress_scope_mismatch');
  });

  it('loads one bounded cursor page only on request and retains opened groups on page error', async () => {
    const initial = summary(Array.from({ length: 20 }, (_, i) => group(String(i))));
    const first = {
      ...initial,
      groups: { ...initial.groups, hasMore: true, nextCursor: 'cursor with space' },
    };
    const read = vi
      .spyOn(apiCall, 'call')
      .mockResolvedValueOnce(success(first))
      .mockRejectedValueOnce(new Error('connection interrupted'))
      .mockResolvedValueOnce(success(summary([group('19'), group('20')])));
    await render(account, 'learning');
    expect(host.querySelectorAll('[data-testid="own-progress-group"]')).toHaveLength(20);
    expect(read).toHaveBeenCalledTimes(1);
    await click('Показать ещё группы');
    expect(host.querySelectorAll('[data-testid="own-progress-group"]')).toHaveLength(20);
    expect(host.textContent).toContain('Уже открытые группы сохранены');
    await click('Повторить загрузку групп');
    expect(host.querySelectorAll('[data-testid="own-progress-group"]')).toHaveLength(21);
    expect(host.textContent).not.toContain('Показать ещё группы');
    expect(read.mock.calls.map(([path]) => path)).toEqual([
      '/api/progress/summary',
      '/api/progress/summary?cursor=cursor%20with%20space',
      '/api/progress/summary?cursor=cursor%20with%20space',
    ]);
    expect(currentProgress.hasMore).toBe(false);
  });
});

describe('Actionable learning recommendation', () => {
  const assignment = (state: string, overrides: Partial<SeatAssignment> = {}) =>
    ({
      id: state,
      title: `Задание ${state}`,
      status: 'open',
      activityKind: 'project',
      projectId: 'project',
      submittedAt: null,
      canonicalState: { workflowState: state },
      ...overrides,
    }) as SeatAssignment;
  const quiz = (state: string, overrides: Partial<LearnerQuiz> = {}) =>
    ({
      assignmentId: state,
      title: `Тест ${state}`,
      status: 'open',
      attemptLimit: 2,
      attemptsUsed: 0,
      latestResult: null,
      canonicalState: { workflowState: state },
      ...overrides,
    }) as LearnerQuiz;

  it('honors canonical state over legacy fields, prioritizes changes and preserves the existing destination', () => {
    const action = nextLearningAction(
      [
        assignment('completed'),
        assignment('waiting_review'),
        assignment('in_progress'),
        assignment('changes_requested', { submittedAt: '2026-11-11' }),
      ],
      [],
    );
    expect(action).toMatchObject({
      assignmentId: 'changes_requested',
      title: 'Задание changes_requested',
      label: 'Доработать',
      href: '/#/learning?assignment=changes_requested',
    });
  });

  it.each(['completed', 'submitted', 'waiting_review', 'invalidated'])(
    'does not recommend canonical %s work despite a legacy editable project or remaining quiz attempts',
    (state) => {
      expect(nextLearningAction([assignment(state)], [quiz(state)])).toBeNull();
    },
  );

  it('does not recommend an unproved modern Direct quiz from its null assignment projection', () => {
    expect(nextLearningAction([modernQuiz()], [])).toBeNull();
  });

  it('supports quiz-only work without starting an attempt and excludes exhausted or closed quizzes', () => {
    expect(nextLearningAction([], [quiz('not_started')])?.href).toBe(
      '/#/learning?assignment=not_started',
    );
    expect(
      nextLearningAction(
        [],
        [quiz('not_started', { attemptsUsed: 2 }), quiz('in_progress', { status: 'closed' })],
      ),
    ).toBeNull();
    expect(nextLearningAction([], [])).toBeNull();
  });
});

function modernQuiz(id = 'modern-quiz', runId = 'modern-run'): SeatAssignment {
  // The current Direct quiz wire projection has no project or canonical project state.
  return {
    id,
    title: `Тест ${id}`,
    activityKind: 'quiz',
    activityRunId: runId,
    moduleKey: null,
    status: 'open',
    projectId: null,
    submittedAt: null,
    canonicalState: null,
    brief: null,
    goal: null,
    dueAt: null,
    sampleImage: null,
    snapshotRevision: null,
    updatedAt: null,
  } as unknown as SeatAssignment;
}
type QuizRead = Awaited<ReturnType<typeof api.readQuizLearning>>;
type QuizProof = Extract<QuizRead, { ok: true }>['data'];
function quizAttempt(state: string, expiresAt: string | null = null): LearningQuizAttempt {
  return {
    attemptId: 'quiz-attempt',
    version: 1,
    state,
    expiresAt,
    serverNow: '2026-11-12T12:00:00Z',
    lastSavedAt: null,
    answers: {},
    questions: [],
    questionOrder: [],
  };
}
function quizProof(attempt: LearningQuizAttempt | null = null, canStart = true): QuizProof {
  return {
    participationId: 'quiz-participation',
    attempt,
    canStart,
    title: 'Тест',
    instructions: null,
  };
}
let currentDirect: ReturnType<typeof useDirectQuizAction>;
let currentNext: ReturnType<typeof useNextLearningAction>;
function DirectProofHarness({
  candidate,
  actor = account,
}: {
  candidate: SeatAssignment;
  actor?: OwnProgressActor;
}) {
  const lifetime = useProgressLifetime(actor);
  currentDirect = useDirectQuizAction(candidate, lifetime);
  useLayoutEffect(() => {
    frames.push(host.textContent ?? '');
  });
  return createElement(
    'div',
    { 'data-settled': String(currentDirect.settled) },
    currentDirect.action
      ? createElement(
          'a',
          { href: currentDirect.action.href },
          `${currentDirect.action.label}: ${currentDirect.action.title}`,
        )
      : 'Открыть обучение',
  );
}
function NextActionHarness({ actor = account }: { actor?: OwnProgressActor }) {
  const lifetime = useProgressLifetime(actor);
  currentNext = useNextLearningAction(actor, lifetime);
  useLayoutEffect(() => {
    frames.push(host.textContent ?? '');
  });
  return createElement(
    'div',
    { 'data-settled': String(currentNext.settled) },
    currentNext.action
      ? createElement(
          'a',
          { href: currentNext.action.href },
          `${currentNext.action.label}: ${currentNext.action.title}`,
        )
      : 'Открыть обучение',
  );
}

describe('Bounded Direct quiz proof', () => {
  it.each([
    ['fresh', null, true, 'Начать'],
    ['created', quizAttempt('created'), true, 'Продолжить'],
    ['in_progress', quizAttempt('in_progress'), true, 'Продолжить'],
    ['working', quizAttempt('working', '2026-11-12T12:01:00Z'), true, 'Продолжить'],
    ['active', quizAttempt('active', '2026-11-12T12:01:00Z'), true, 'Продолжить'],
    ['closed', quizAttempt('closed'), true, null],
    ['evaluating', quizAttempt('evaluating'), true, null],
    ['expired state', quizAttempt('expired'), true, null],
    ['expired server deadline', quizAttempt('in_progress', '2026-11-12T12:00:00Z'), true, null],
    ['unknown state', quizAttempt('unknown'), true, null],
    ['unknown deadline', quizAttempt('active', 'invalid'), true, null],
    ['closed window fresh', null, false, null],
    ['closed window working', quizAttempt('in_progress'), false, null],
  ] as const)(
    'uses the actual %s proof without interpreting canStart as permission to repeat a terminal attempt',
    async (_name, attempt, canStart, label) => {
      const read = vi
        .spyOn(api, 'readQuizLearning')
        .mockResolvedValue(success(quizProof(attempt, canStart)));
      await act(async () =>
        root.render(createElement(DirectProofHarness, { candidate: modernQuiz() })),
      );
      expect(read).toHaveBeenCalledExactlyOnceWith('modern-run');
      expect(currentDirect.settled).toBe(true);
      expect(currentDirect.action?.label ?? null).toBe(label);
      if (label)
        expect(host.querySelector('a')?.getAttribute('href')).toBe(
          '/#/learning?assignment=modern-quiz',
        );
      else expect(host.textContent).toBe('Открыть обучение');
    },
  );

  it.each(['account', 'seat'] as const)(
    '%s: waits for one real quiz read and does not start an attempt from Home',
    async (identity) => {
      const actor = identity === 'seat' ? seat : account;
      ready(actor);
      vi.spyOn(
        api,
        identity === 'seat' ? 'seatAssignments' : 'attendedAssignments',
      ).mockResolvedValue(success({ items: [modernQuiz()] }));
      vi.spyOn(api, identity === 'seat' ? 'seatQuizzes' : 'accountQuizzes').mockResolvedValue(
        success({ items: [] }),
      );
      const pending = deferred<QuizRead>();
      const read = vi.spyOn(api, 'readQuizLearning').mockReturnValue(pending.promise);
      const quizStart = vi.spyOn(api, 'startQuizLearning').mockResolvedValue(failure);
      const projectStart = vi.spyOn(api, 'startLearningWork').mockResolvedValue(failure);
      await act(async () => root.render(createElement(NextActionHarness, { actor })));
      expect(currentNext.action).toBeNull();
      expect(currentNext.settled).toBe(false);
      await act(async () => pending.resolve(success(quizProof())));
      expect(currentNext.action).toMatchObject({ assignmentId: 'modern-quiz', label: 'Начать' });
      expect(currentNext.settled).toBe(true);
      expect(read).toHaveBeenCalledExactlyOnceWith('modern-run');
      expect(quizStart).not.toHaveBeenCalled();
      expect(projectStart).not.toHaveBeenCalled();
    },
  );

  it('checks only the first eligible run in server order and retries only that run on explicit request', async () => {
    vi.spyOn(api, 'attendedAssignments').mockResolvedValue(
      success({
        items: [
          { ...modernQuiz('closed-assignment', 'ignored-run'), status: 'closed' },
          { ...modernQuiz('without-run'), activityRunId: null },
          { ...modernQuiz('first', 'first-run'), classroomTitle: 'Класс' },
          { ...modernQuiz('second', 'second-run'), classroomTitle: 'Класс' },
        ] as (SeatAssignment & { classroomTitle: string })[],
      }),
    );
    vi.spyOn(api, 'accountQuizzes').mockResolvedValue(success({ items: [] }));
    const read = vi
      .spyOn(api, 'readQuizLearning')
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(success(quizProof(quizAttempt('closed'))));
    await act(async () => root.render(createElement(NextActionHarness)));
    expect(read).toHaveBeenCalledExactlyOnceWith('first-run');
    expect(currentNext.action).toBeNull();
    expect(currentNext.error).toBe(true);
    await act(async () => currentNext.reload());
    expect(currentNext.action).toBeNull();
    expect(currentNext.error).toBe(false);
    expect(read.mock.calls.map(([run]) => run)).toEqual(['first-run', 'first-run']);
  });

  it.each(['project', 'legacy quiz'] as const)(
    'retains an already proven %s action when the extra quiz proof fails',
    async (kind) => {
      const project = {
        ...modernQuiz('project'),
        activityKind: 'project',
        activityRunId: 'project-run',
        projectId: 'project',
        canonicalState: { workflowState: 'in_progress' },
        classroomTitle: 'Класс',
      } as SeatAssignment & { classroomTitle: string };
      vi.spyOn(api, 'attendedAssignments').mockResolvedValue(
        success({
          items: [
            ...(kind === 'project' ? [project] : []),
            { ...modernQuiz(), classroomTitle: 'Класс' },
          ],
        }),
      );
      const legacy = {
        assignmentId: 'legacy',
        title: 'Существующий тест',
        status: 'open',
        attemptLimit: 2,
        attemptsUsed: 0,
        latestResult: null,
        canonicalState: null,
      } as LearnerQuiz;
      vi.spyOn(api, 'accountQuizzes').mockResolvedValue(
        success({ items: kind === 'legacy quiz' ? [legacy] : [] }),
      );
      vi.spyOn(api, 'readQuizLearning').mockResolvedValue(failure);
      await act(async () => root.render(createElement(NextActionHarness)));
      expect(currentNext.action?.assignmentId).toBe(kind === 'project' ? 'project' : 'legacy');
      expect(currentNext.error).toBe(true);
      expect(currentNext.settled).toBe(true);
    },
  );

  it('clears a prior proof on the first render of a new run and ignores late responses within the same actor', async () => {
    const second = deferred<QuizRead>();
    const third = deferred<QuizRead>();
    const read = vi
      .spyOn(api, 'readQuizLearning')
      .mockResolvedValueOnce(success(quizProof()))
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    await act(async () =>
      root.render(
        createElement(DirectProofHarness, {
          candidate: modernQuiz('same-assignment', 'first-run'),
        }),
      ),
    );
    expect(currentDirect.action?.label).toBe('Начать');
    frames.length = 0;
    await act(async () =>
      root.render(
        createElement(DirectProofHarness, {
          candidate: modernQuiz('same-assignment', 'second-run'),
        }),
      ),
    );
    expect(currentDirect.action).toBeNull();
    expect(frames.every((frame) => frame === 'Открыть обучение')).toBe(true);
    await act(async () =>
      root.render(
        createElement(DirectProofHarness, {
          candidate: modernQuiz('same-assignment', 'third-run'),
        }),
      ),
    );
    await act(async () => second.resolve(success(quizProof())));
    expect(currentDirect.action).toBeNull();
    expect(frames.every((frame) => frame === 'Открыть обучение')).toBe(true);
    await act(async () => third.resolve(success(quizProof(quizAttempt('in_progress')))));
    expect(currentDirect.action?.label).toBe('Продолжить');
    expect(read.mock.calls.map(([run]) => run)).toEqual(['first-run', 'second-run', 'third-run']);
  });

  it.each(['actor', 'same-ID login'] as const)(
    'retires a pending exact-run proof across %s change',
    async (transition) => {
      const old = deferred<QuizRead>();
      const current = deferred<QuizRead>();
      vi.spyOn(api, 'readQuizLearning')
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise);
      const candidate = modernQuiz();
      await act(async () => root.render(createElement(DirectProofHarness, { candidate })));
      await act(async () => setTelemetryContext(null, false, 'home'));
      const nextActor = transition === 'actor' ? seat : account;
      await act(async () => {
        ready(nextActor);
        root.render(createElement(DirectProofHarness, { candidate, actor: nextActor }));
      });
      await act(async () => old.resolve(success(quizProof())));
      expect(currentDirect.action).toBeNull();
      expect(host.textContent).toBe('Открыть обучение');
      await act(async () => current.resolve(success(quizProof(quizAttempt('closed')))));
      expect(currentDirect.action).toBeNull();
      expect(currentDirect.settled).toBe(true);
    },
  );
});
