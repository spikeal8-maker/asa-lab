// @vitest-environment jsdom

import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OwnProgressGroupV1,
  PersonalProgressSummaryV1,
  GroupRatingPeerV1,
  GroupRatingPageV1,
} from '@asa-lab/contracts';
import {
  api,
  type ApiResult,
  type LearnerQuiz,
  type LearningQuizAttempt,
  type SeatAssignment,
} from '../api';
import * as apiCall from '../api-call';
import { setTelemetryContext, telemetryContext } from '../telemetry-context';
import { notifySessionLoggedOut } from '../session-fetch';
import { PersonalProgress, SidebarProfileMetrics } from './PersonalProgress';
import { ProfileMetricStrip } from './PersonalProgress';
import { portalMutationCompleted, setPortalSessionKey } from '../portal-requests';
import {
  limitedGroupRead,
  groupRatingPreviewLimit,
  readGroupRating,
  nextLearningAction,
  readPersonalProgress,
  usePersonalProgress,
  usePersonalRead,
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
  return createElement(
    'div',
    null,
    createElement(ProfileMetricStrip, {
      data: progress.summary.data,
      loading: progress.summary.loading,
      error: progress.summary.error !== null,
      onRetry: progress.summary.reload,
    }),
    createElement(PersonalProgress, { actor, progress, mode }),
  );
}

/** The shell and page call their own real readers; no pre-read result is shared by the test. */
function SharedConsumers({
  actor = account,
  sidebar = true,
  page = true,
}: {
  actor?: OwnProgressActor;
  sidebar?: boolean;
  page?: boolean;
}) {
  return createElement(
    'div',
    null,
    sidebar
      ? createElement(SidebarProfileMetrics, { actor, active: 'learning', key: 'sidebar' })
      : null,
    page ? createElement(Harness, { actor, mode: 'learning', key: 'page' }) : null,
  );
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

describe('Shared shell and page reads', () => {
  const renderConsumers = async (props: Parameters<typeof SharedConsumers>[0] = {}) =>
    act(async () => root.render(createElement(SharedConsumers, props)));
  const allLikeValues = () =>
    [...host.querySelectorAll('[data-testid="profile-full-currentLikes"] span')].map(
      (node) => node.textContent,
    );

  it.each([account, seat])(
    'shares one initial summary for independent $kind consumers',
    async (actor) => {
      ready(actor);
      const pending = deferred<ApiResult<PersonalProgressSummaryV1>>();
      const read = vi.spyOn(apiCall, 'call').mockReturnValue(pending.promise);
      await renderConsumers({ actor });
      expect(read).toHaveBeenCalledTimes(1);
      expect(allLikeValues()).toEqual(['…', '…']);
      await act(async () => pending.resolve(success(summary([], actor))));
      expect(allLikeValues()).toEqual(['84', '84']);
      expect(api.accountAvatar).toHaveBeenCalledTimes(actor.kind === 'account' ? 1 : 0);
    },
  );

  it('shares an already completed snapshot with a later mounted sidebar', async () => {
    const read = vi.spyOn(apiCall, 'call').mockResolvedValue(success(summary()));
    await renderConsumers({ sidebar: false });
    await renderConsumers();
    expect(read).toHaveBeenCalledTimes(1);
    expect(allLikeValues()).toEqual(['84', '84']);
  });

  it('keeps the pending transport for the remaining consumer and releases the final owner', async () => {
    const pending = deferred<ApiResult<PersonalProgressSummaryV1>>();
    const read = vi.spyOn(apiCall, 'call').mockReturnValue(pending.promise);
    await renderConsumers();
    const signal = read.mock.calls[0]![1]!.signal!;
    await renderConsumers({ sidebar: false });
    expect(signal.aborted).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(success(summary())));
    expect(allLikeValues()).toEqual(['84']);
    await act(async () => root.render(null));
    read.mockResolvedValueOnce(success(summary()));
    await renderConsumers();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('aborts both transports when their last consumers unmount', async () => {
    const summaryRead = deferred<ApiResult<PersonalProgressSummaryV1>>();
    const avatarRead = deferred<Awaited<ReturnType<typeof api.accountAvatar>>>();
    const read = vi.spyOn(apiCall, 'call').mockReturnValue(summaryRead.promise);
    vi.mocked(api.accountAvatar).mockReturnValue(avatarRead.promise);
    await renderConsumers();
    const signal = read.mock.calls[0]![1]!.signal!;
    const avatarSignal = vi.mocked(api.accountAvatar).mock.calls[0]![0]!;
    await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);
    expect(avatarSignal.aborted).toBe(true);
  });

  function realSessionReads(actor = account) {
    vi.mocked(api.accountAvatar).mockRestore();
    const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (path) => {
      if (String(path).endsWith('/progress/summary')) return Response.json(summary([], actor));
      if (String(path) === '/api/account/avatar')
        return Response.json({ avatarDataUrl: '/confirmed-avatar.webp' });
      throw new Error(`Unexpected transport: ${String(path)}`);
    });
    const personalStarts = () =>
      transport.mock.calls
        .map(([path]) => String(path))
        .filter((path) => /\/(?:progress\/summary|account\/avatar)$/.test(path));
    return { transport, personalStarts };
  }

  const readMutationAssignments = (signal: AbortSignal) => api.attendedAssignments(signal);
  const readMutationCourses = () => api.accountCourseRuns();
  const readMutationResults = () => api.accountResults();
  function SessionLearningReads() {
    const lifetime = useProgressLifetime(account);
    const assignments = usePersonalRead(lifetime, readMutationAssignments);
    const courses = usePersonalRead(lifetime, readMutationCourses);
    const results = usePersonalRead(lifetime, readMutationResults);
    return createElement(
      'output',
      { 'data-testid': 'session-learning-reads' },
      JSON.stringify([assignments.data?.items, courses.data?.items, results.data?.items]),
    );
  }

  it.each([201, 500])(
    'holds shared and generic personal reads until self-attest settles with HTTP %i',
    async (status) => {
      const { transport } = realSessionReads();
      const read = transport.getMockImplementation()!;
      const response = deferred<Response>();
      const paths = [
        '/api/progress/summary',
        '/api/account/avatar',
        '/api/class-join/account/assignments',
        '/api/class-join/account/course-runs',
        '/api/class-join/account/results',
      ];
      let settled = false;
      transport.mockImplementation((url, init) => {
        const path = String(url);
        if (path === '/api/capabilities/content-author/self-attest') return response.promise;
        if (paths.slice(2).includes(path))
          return Promise.resolve(Response.json({ items: [settled ? 'confirmed' : 'initial'] }));
        if (path === '/api/progress/summary' && settled) {
          const data = summary();
          return Promise.resolve(
            Response.json({
              ...data,
              metrics: { ...data.metrics, currentLikes: { availability: 'available', value: 85 } },
            }),
          );
        }
        return read(url, init);
      });
      const counts = () =>
        paths.map((path) => transport.mock.calls.filter(([url]) => String(url) === path).length);
      const content = () =>
        host.querySelector('[data-testid="session-learning-reads"]')?.textContent;
      await act(async () =>
        root.render(
          createElement(
            'div',
            null,
            createElement(SharedConsumers),
            createElement(SessionLearningReads),
          ),
        ),
      );
      expect(counts()).toEqual([1, 1, 1, 1, 1]);
      expect(content()).toBe('[["initial"],["initial"],["initial"]]');
      let mutation!: ReturnType<typeof api.selfAttestContentAuthor>;
      try {
        await act(async () => {
          mutation = api.selfAttestContentAuthor();
        });
        expect(counts()).toEqual([1, 1, 1, 1, 1]);
        expect(currentProgress.summary.data).toBeNull();
        expect(content()).toBe('[null,null,null]');
        await act(async () => {
          settled = true;
          response.resolve(
            Response.json(
              status === 201
                ? { capability: 'content_author', state: 'provisional', created: true }
                : { error: { code: 'server_error', message: 'Offline' } },
              { status },
            ),
          );
          expect((await mutation).ok).toBe(status === 201);
        });
        expect(counts()).toEqual([2, 2, 2, 2, 2]);
        expect(allLikeValues()).toEqual(['85', '85']);
        expect(content()).toBe('[["confirmed"],["confirmed"],["confirmed"]]');
        expect(
          transport.mock.calls.filter(
            ([url]) => String(url) === '/api/capabilities/content-author/self-attest',
          ),
        ).toHaveLength(1);
      } finally {
        response.resolve(Response.json({}, { status: 500 }));
        if (mutation) await act(async () => void (await mutation));
      }
    },
  );

  it.each([account, seat])(
    'admits no personal reads across the pending and completed $kind logout boundary',
    async (actor) => {
      ready(actor);
      const { transport, personalStarts } = realSessionReads(actor);
      const read = transport.getMockImplementation()!;
      const response = deferred<Response>();
      const returned = deferred<void>();
      const resume = deferred<void>();
      const path = actor.kind === 'account' ? '/api/auth/logout' : '/api/class-join/logout';
      transport.mockImplementation((url, init) =>
        String(url) === path ? response.promise : read(url, init),
      );
      const realCall = apiCall.call;
      vi.spyOn(apiCall, 'call').mockImplementation(async (url, init) => {
        const result = await realCall(url, init);
        if (url === path) {
          returned.resolve();
          // Hold the observed gap after the transport's finishMutation, before the API wrapper
          // can announce logout. This is a controlled scheduling fault, not a fake session.
          await resume.promise;
        }
        return result;
      });
      await renderConsumers({ actor });
      const initial = personalStarts();
      expect(initial).toHaveLength(actor.kind === 'account' ? 2 : 1);
      let logout!: ReturnType<typeof api.logout>;
      try {
        await act(async () => {
          logout = actor.kind === 'account' ? api.logout() : api.classroomStudentLogout();
        });
        expect(personalStarts()).toEqual(initial);
        await act(async () => {
          response.resolve(Response.json({ ok: true }));
          await returned.promise;
        });
        expect(personalStarts()).toEqual(initial);
        await act(async () => {
          resume.resolve();
          expect((await logout).ok).toBe(true);
        });
        expect(telemetryContext().ready).toBe(false);
        expect(personalStarts()).toEqual(initial);
        await act(async () => ready(actor));
        expect(personalStarts()).toEqual([...initial, ...initial]);
        expect(allLikeValues()).toEqual(['84', '84']);
      } finally {
        response.resolve(Response.json({ ok: true }));
        resume.resolve();
        if (logout) await act(async () => void (await logout));
      }
    },
  );

  it.each([
    { actor: account, firstStatus: 200 },
    { actor: account, firstStatus: 503 },
    { actor: seat, firstStatus: 503 },
  ])(
    'keeps overlapping $actor.kind logout admissions closed after the first response is $firstStatus',
    async ({ actor, firstStatus }) => {
      ready(actor);
      const { transport, personalStarts } = realSessionReads(actor);
      const read = transport.getMockImplementation()!;
      const replies = [deferred<Response>(), deferred<Response>()];
      let write = 0;
      const path = actor.kind === 'account' ? '/api/auth/logout' : '/api/class-join/logout';
      const logout = () => (actor.kind === 'account' ? api.logout() : api.classroomStudentLogout());
      transport.mockImplementation((url, init) =>
        String(url) === path ? replies[write++]!.promise : read(url, init),
      );
      await renderConsumers({ actor });
      const initial = personalStarts();
      expect(initial).toHaveLength(actor.kind === 'account' ? 2 : 1);
      let first!: ReturnType<typeof api.logout>;
      let second!: ReturnType<typeof api.logout>;
      try {
        await act(async () => {
          first = logout();
          second = logout();
        });
        expect(personalStarts()).toEqual(initial);
        await act(async () => {
          replies[0]!.resolve(Response.json({ ok: true }, { status: firstStatus }));
          await first;
        });
        expect(personalStarts()).toEqual(initial);
        await act(async () => {
          replies[1]!.resolve(Response.json({ error: { message: 'Offline' } }, { status: 503 }));
          expect((await second).ok).toBe(false);
        });
        expect(personalStarts()).toEqual(firstStatus === 200 ? initial : [...initial, ...initial]);
        expect(telemetryContext().ready).toBe(firstStatus !== 200);
        if (firstStatus !== 200) expect(allLikeValues()).toEqual(['84', '84']);
      } finally {
        for (const reply of replies) reply.resolve(Response.json({}, { status: 503 }));
        await act(async () => void (await Promise.all([first, second])));
      }
    },
  );

  it.each(['before', 'during'] as const)(
    'keeps the current session usable when logout is cancelled %s its transport',
    async (when) => {
      const { transport, personalStarts } = realSessionReads();
      const read = transport.getMockImplementation()!;
      transport.mockImplementation((url, init) =>
        String(url) === '/api/auth/logout'
          ? new Promise<Response>((_resolve, reject) =>
              init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), {
                once: true,
              }),
            )
          : read(url, init),
      );
      await renderConsumers();
      const initial = personalStarts();
      const controller = new AbortController();
      if (when === 'before') controller.abort();
      let logout!: ReturnType<typeof api.logout>;
      try {
        await act(async () => {
          logout = api.logout(controller.signal);
        });
        expect(personalStarts()).toEqual(initial);
        await act(async () => {
          controller.abort();
          expect((await logout).ok).toBe(false);
        });
        expect(telemetryContext().ready).toBe(true);
        expect(personalStarts()).toEqual(when === 'before' ? initial : [...initial, ...initial]);
        expect(allLikeValues()).toEqual(['84', '84']);
      } finally {
        controller.abort();
        if (logout) await act(async () => void (await logout));
      }
    },
  );

  it('retires direct logout in its synchronous notification without starting a replacement read', async () => {
    const { personalStarts } = realSessionReads();
    await renderConsumers();
    const initial = personalStarts();
    await act(async () => notifySessionLoggedOut());
    expect(personalStarts()).toEqual(initial);
    expect(telemetryContext().ready).toBe(false);
  });

  it.each([200, 503])(
    'admits a new Account while a previous Seat logout is pending and later returns %i',
    async (status) => {
      ready(seat);
      const nextActor = { ...account, accountId: 'new-account' };
      const next = summary([], nextActor);
      const { transport, personalStarts } = realSessionReads(seat);
      const read = transport.getMockImplementation()!;
      const response = deferred<Response>();
      transport.mockImplementation((url, init) => {
        if (String(url) === '/api/class-join/logout') return response.promise;
        if (String(url) === '/api/progress/summary')
          return Promise.resolve(
            Response.json({
              ...next,
              metrics: { ...next.metrics, currentLikes: { availability: 'available', value: 202 } },
            }),
          );
        return read(url, init);
      });
      await renderConsumers({ actor: seat });
      let logout!: ReturnType<typeof api.classroomStudentLogout>;
      try {
        await act(async () => {
          logout = api.classroomStudentLogout();
        });
        await act(async () => {
          notifySessionLoggedOut();
          ready(nextActor);
          root.render(createElement(SharedConsumers, { actor: nextActor }));
        });
        const started = [
          '/api/class-join/progress/summary',
          '/api/progress/summary',
          '/api/account/avatar',
        ];
        expect(personalStarts()).toEqual(started);
        expect(allLikeValues()).toEqual(['202', '202']);
        await act(async () => {
          response.resolve(Response.json({ ok: true }, { status }));
          expect(await logout).toMatchObject({
            ok: false,
            error: { code: 'request_cancelled' },
          });
        });
        expect(personalStarts()).toEqual(started);
        expect(telemetryContext()).toMatchObject({
          actor: { kind: 'account', accountId: nextActor.accountId },
          ready: true,
        });
        expect(allLikeValues()).toEqual(['202', '202']);
      } finally {
        response.resolve(Response.json({}, { status: 503 }));
        if (logout) await act(async () => void (await logout));
      }
    },
  );

  it('keeps a same-session automatic refresh available to both shared summary consumers', async () => {
    const { transport } = realSessionReads();
    const read = transport.getMockImplementation()!;
    let summaries = 0;
    transport.mockImplementation(async (url, init) => {
      if (String(url) === '/api/auth/refresh') return Response.json({ ok: true });
      if (String(url) === '/api/progress/summary' && summaries++ === 0)
        return Response.json({ error: { code: 'session_expired' } }, { status: 401 });
      return read(url, init);
    });
    await renderConsumers();
    expect(summaries).toBe(2);
    expect(
      transport.mock.calls.filter(([url]) => String(url) === '/api/auth/refresh'),
    ).toHaveLength(1);
    expect(allLikeValues()).toEqual(['84', '84']);
  });

  it('retries HTTP 200 unavailable once for all consumers and settles to available', async () => {
    const unknown = summary();
    const unknownCounter = {
      availability: 'unavailable',
      value: null,
      reason: 'source_unavailable',
    } as const;
    const unavailable: PersonalProgressSummaryV1 = {
      ...unknown,
      availability: 'unavailable',
      metrics: {
        everPublishedWorks: unknownCounter,
        currentLikes: unknownCounter,
        createdCopies: unknownCounter,
        activePublicWorks: unknownCounter,
      },
    };
    const pending = deferred<ApiResult<PersonalProgressSummaryV1>>();
    const read = vi.spyOn(apiCall, 'call').mockResolvedValue(success(unavailable));
    await renderConsumers();
    expect(allLikeValues()).toEqual(['—', '—']);
    const retryButtons = [...host.querySelectorAll<HTMLButtonElement>('button')].filter(
      (button) => button.textContent === 'Повторить загрузку прогресса',
    );
    expect(retryButtons.length).toBeGreaterThanOrEqual(2);
    read.mockReturnValue(pending.promise);
    await act(async () => retryButtons.forEach((button) => button.click()));
    expect(read).toHaveBeenCalledTimes(2);
    expect(allLikeValues()).toEqual(['…', '…']);
    expect(host.textContent).not.toContain('Сейчас не удалось получить подтверждённые показатели');
    expect(
      host.querySelector<HTMLButtonElement>('.portal-sidebar-metric-details button')?.disabled,
    ).toBe(true);
    await act(async () => currentProgress.summary.reload());
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(success(summary())));
    expect(allLikeValues()).toEqual(['84', '84']);
    expect(currentProgress.summary.loading).toBe(false);
  });

  it.each([
    '/api/projects/project/publication',
    '/api/public-projects/work/like',
    '/api/public-projects/work/copy',
  ])('refreshes all active consumers once after %s', async (path) => {
    const initial = summary();
    const updated: PersonalProgressSummaryV1 = {
      ...initial,
      metrics: { ...initial.metrics, currentLikes: { availability: 'available', value: 85 } },
    };
    const read = vi
      .spyOn(apiCall, 'call')
      .mockResolvedValueOnce(success(summary()))
      .mockResolvedValueOnce(success(updated));
    await renderConsumers();
    await act(async () => portalMutationCompleted(path, { method: 'POST' }));
    expect(read).toHaveBeenCalledTimes(2);
    expect(allLikeValues()).toEqual(['85', '85']);
    await act(async () =>
      portalMutationCompleted('/api/learning/notifications/read', { method: 'POST' }),
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('rejects an older pending response when a successful mutation invalidates it', async () => {
    const old = deferred<ApiResult<PersonalProgressSummaryV1>>();
    const fresh = deferred<ApiResult<PersonalProgressSummaryV1>>();
    const read = vi
      .spyOn(apiCall, 'call')
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    await renderConsumers();
    const oldSignal = read.mock.calls[0]![1]!.signal!;
    await act(async () =>
      portalMutationCompleted('/api/public-projects/work/like', { method: 'PUT' }),
    );
    expect(oldSignal.aborted).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => old.resolve(success(summary([group('OLD MUTATION')]))));
    expect(allLikeValues()).toEqual(['…', '…']);
    expect(host.textContent).not.toContain('OLD MUTATION');
    await act(async () => fresh.resolve(success(summary())));
    expect(allLikeValues()).toEqual(['84', '84']);
  });

  it.each(['home', 'learning'] as const)(
    'refreshes once on a later %s entry without polling',
    async (route) => {
      const read = vi.spyOn(apiCall, 'call').mockResolvedValue(success(summary()));
      await renderConsumers();
      const identity = {
        kind: 'account',
        accountId: account.accountId,
        workspaceId: 'personal',
      } as const;
      await act(async () => setTelemetryContext(identity, true, 'public'));
      expect(read).toHaveBeenCalledTimes(1);
      await act(async () => setTelemetryContext(identity, true, route));
      expect(read).toHaveBeenCalledTimes(2);
      expect(api.accountAvatar).toHaveBeenCalledTimes(2);
      await act(async () => setTelemetryContext(identity, true, route));
      expect(read).toHaveBeenCalledTimes(2);
      expect(api.accountAvatar).toHaveBeenCalledTimes(2);
    },
  );

  it('retires the snapshot when trusted grants change without changing actor or workspace IDs', async () => {
    setPortalSessionKey('trusted-grants-first');
    const pending = deferred<ApiResult<PersonalProgressSummaryV1>>();
    const read = vi
      .spyOn(apiCall, 'call')
      .mockResolvedValueOnce(success(summary([group('PREVIOUS GRANT')])));
    await renderConsumers();
    expect(host.textContent).toContain('PREVIOUS GRANT');
    read.mockReturnValueOnce(pending.promise);
    frames.length = 0;
    await act(async () => setPortalSessionKey('trusted-grants-revoked'));
    expect(read).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain('PREVIOUS GRANT');
    expect(frames.every((frame) => !frame.includes('PREVIOUS GRANT'))).toBe(true);
    await act(async () => pending.resolve(success(summary())));
    expect(allLikeValues()).toEqual(['84', '84']);
  });

  it.each(['same-account', 'other-account', 'seat'] as const)(
    'fences both independent consumers and delayed avatar on %s session handoff',
    async (kind) => {
      const previous = deferred<ApiResult<PersonalProgressSummaryV1>>();
      const previousAvatar = deferred<Awaited<ReturnType<typeof api.accountAvatar>>>();
      const nextActor: OwnProgressActor =
        kind === 'seat'
          ? seat
          : kind === 'other-account'
            ? { ...account, accountId: 'account-b' }
            : account;
      const read = vi
        .spyOn(apiCall, 'call')
        .mockReturnValueOnce(previous.promise)
        .mockResolvedValueOnce(success(summary([], nextActor)));
      vi.mocked(api.accountAvatar)
        .mockReturnValueOnce(previousAvatar.promise)
        .mockResolvedValue(success({ avatarDataUrl: '/current-avatar.webp' }));
      await renderConsumers();
      const previousSignal = read.mock.calls[0]![1]!.signal!;
      const previousAvatarSignal = vi.mocked(api.accountAvatar).mock.calls[0]![0]!;
      await act(async () => setTelemetryContext(null, false, 'home'));
      frames.length = 0;
      await act(async () => {
        ready(nextActor);
        root.render(createElement(SharedConsumers, { actor: nextActor }));
      });
      expect(previousSignal.aborted).toBe(true);
      expect(previousAvatarSignal.aborted).toBe(true);
      await act(async () => {
        previous.resolve(success(summary([group('OLD SESSION')])));
        previousAvatar.resolve(success({ avatarDataUrl: '/old-private-avatar.webp' }));
      });
      expect(read).toHaveBeenCalledTimes(2);
      expect(allLikeValues()).toEqual(['84', '84']);
      expect(frames.every((frame) => !frame.includes('OLD SESSION'))).toBe(true);
      expect(host.querySelector('img[src="/old-private-avatar.webp"]')).toBeNull();
      expect(api.accountAvatar).toHaveBeenCalledTimes(kind === 'seat' ? 1 : 2);
    },
  );
});

describe('Own progress presentation', () => {
  it('shows genuine zero, full fractional score and SQL rank; Home only two groups', async () => {
    const result = summary([group('A', 99.99, 101), group('B', 0, 2), group('C', 12.5, 2)]);
    const read = vi.spyOn(apiCall, 'call').mockResolvedValue(success(result));
    await render();
    expect(
      host.querySelector('[data-testid="progress-everPublishedWorks"] .portal-sidebar-metric-value')
        ?.textContent,
    ).toBe('0');
    expect(
      host.querySelector('[data-testid="progress-createdCopies"]')?.getAttribute('title'),
    ).toBe('Добавили к себе');
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
    expect(host.textContent).toContain('Общий личный рейтинг пока не рассчитывается');
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
    expect(
      host.querySelector('[data-testid="progress-currentLikes"] .portal-sidebar-metric-value')
        ?.textContent,
    ).toBe('—');
    expect(
      host.querySelector('[data-testid="progress-everPublishedWorks"] .portal-sidebar-metric-value')
        ?.textContent,
    ).toBe('0');
    expect(host.textContent).toContain('Часть прогресса сейчас недоступна');
    await render(account, 'learning');
    expect(
      [...host.querySelectorAll('[data-testid="own-progress-score"]')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['—', '—', '—']);
    expect(
      [...host.querySelectorAll('[data-testid="own-progress-rank"]')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['—', '—', '—']);
    expect(host.textContent).toContain('Рейтинг выключен');
    expect(host.textContent).toContain('Учебный профиль нужно уточнить у преподавателя');
    expect(host.textContent).toContain('Рейтинг сейчас недоступен');
  });

  it.each([403, 503])(
    'offers a profile retry on %s without inventing a zero for unavailable metrics',
    async (status) => {
      vi.spyOn(apiCall, 'call')
        .mockResolvedValueOnce({ ...failure, status })
        .mockResolvedValueOnce(success(summary()));
      await render();
      expect(
        host.querySelector(
          '[data-testid="progress-everPublishedWorks"] .portal-sidebar-metric-value',
        )?.textContent,
      ).toBe('—');
      expect(host.textContent).toContain('Сейчас не удалось получить подтверждённые показатели');
      await click('Повторить загрузку прогресса');
      expect(
        host.querySelector(
          '[data-testid="progress-everPublishedWorks"] .portal-sidebar-metric-value',
        )?.textContent,
      ).toBe('0');
    },
  );

  it('uses the Seat avatar with its raw ID and never requests the Account avatar', async () => {
    ready(seat);
    vi.spyOn(apiCall, 'call').mockResolvedValue(
      success(summary([group('88888888-8888-4888-8888-888888888888')], seat)),
    );
    await render(seat);
    expect(api.accountAvatar).not.toHaveBeenCalled();
    expect(host.querySelector('.personal-progress-group-avatar')).toBeNull();
    await click('Все');
    const image = host.querySelector<HTMLImageElement>('.personal-progress-rating-pinned img');
    expect(image?.getAttribute('src')).toBe(seatAvatar(seat.seatId, seat.avatarKey).src);
  });

  it('keeps an avatar change over a late read and falls back after image failure', async () => {
    const avatar = deferred<Awaited<ReturnType<typeof api.accountAvatar>>>();
    vi.mocked(api.accountAvatar).mockReturnValue(avatar.promise);
    vi.spyOn(apiCall, 'call').mockResolvedValue(
      success(summary([group('88888888-8888-4888-8888-888888888888')])),
    );
    await render();
    await click('Все');
    await act(async () => notifyProfileAvatarChanged('/avatar-new.webp'));
    await act(async () => avatar.resolve(success({ avatarDataUrl: '/avatar-old.webp' })));
    expect(host.querySelector('.personal-progress-rating-pinned img')?.getAttribute('src')).toBe(
      '/avatar-new.webp',
    );
    await act(async () =>
      host.querySelector('.personal-progress-rating-pinned img')!.dispatchEvent(new Event('error')),
    );
    expect(host.querySelector('.personal-progress-rating-pinned img')?.getAttribute('src')).toBe(
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

const SP04_TEST_GROUP = '88888888-8888-4888-8888-888888888888';

function sp04Peer(index: number): GroupRatingPeerV1 {
  return {
    peerKey: 'opaque-peer-' + index,
    avatarSrc: '/assets/avatars/default/avatar-09.webp',
    avatarTicket: null,
    score: index < 2 ? 83.46 : 68.25,
    rank: index < 2 ? 1 : 3,
    isSelf: false,
  };
}

function sp04Page(
  peers: readonly GroupRatingPeerV1[],
  nextCursor: string | null = null,
): GroupRatingPageV1 {
  return {
    groupId: SP04_TEST_GROUP,
    periodDays: 30,
    version: 'a'.repeat(32),
    asOf: '2026-11-14T00:00:00Z',
    own: { availability: 'available', score: 68.25, rank: 101, isSelf: true },
    peers,
    hasMore: nextCursor !== null,
    nextCursor,
  };
}

describe('SP-04 compact learner-safe group ratings', () => {
  it('shows only bounded anonymous peers, preserves own place 101 and opens full pages', async () => {
    const first = Array.from({ length: 5 }, (_, i) => sp04Peer(i));
    const full = Array.from({ length: 20 }, (_, i) => sp04Peer(i));
    const last = Array.from({ length: 3 }, (_, i) => sp04Peer(i + 20));
    const reads = vi
      .spyOn(apiCall, 'call')
      .mockResolvedValueOnce(success(summary([group(SP04_TEST_GROUP, 68.25, 101)])))
      .mockResolvedValueOnce(success(sp04Page(first)))
      .mockResolvedValueOnce(success(sp04Page(full, 'opaque-page-2')))
      .mockResolvedValueOnce(success(sp04Page(last)));
    await render(account, 'home');
    expect(host.querySelectorAll('[data-testid="own-progress-group"]')).toHaveLength(1);
    expect(host.querySelector('[data-testid="own-progress-rank"]')?.textContent).toBe('101');
    expect(host.querySelector('[data-testid="own-progress-score"]')?.textContent).toBe('68,25');
    expect(host.querySelectorAll('.personal-progress-peers .personal-progress-peer')).toHaveLength(
      5,
    );
    const preview = host.querySelector('.personal-progress-peers')!;
    expect(preview.textContent).toContain('83,46');
    expect(preview.textContent).not.toContain('opaque-peer');
    expect(preview.querySelector('[alt=""]')).toBeTruthy();
    expect(preview.querySelector('[aria-label*="Место"]')).toBeTruthy();
    expect(preview.outerHTML).not.toMatch(/(?:studentCode|seatId|lastActiveAt|displayName)/);
    expect(reads.mock.calls[1]?.[0]).toContain(
      '/api/progress/groups/' + SP04_TEST_GROUP + '/rating?',
    );
    await click('Все');
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(
      dialog?.querySelectorAll('.personal-progress-rating-items .personal-progress-peer'),
    ).toHaveLength(20);
    expect(dialog?.querySelector('.personal-progress-rating-pinned')?.textContent).toContain('101');
    await click('Показать ещё');
    expect(
      dialog?.querySelectorAll('.personal-progress-rating-items .personal-progress-peer'),
    ).toHaveLength(23);
    expect(reads.mock.calls[3]?.[0]).toContain('cursor=opaque-page-2');
    await click('Закрыть');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('uses the Seat-specific group endpoint with a true zero and no Account authority', async () => {
    const student: OwnProgressActor = {
      kind: 'seat',
      seatId: '77777777-7777-4777-8777-777777777777',
      classroomId: SP04_TEST_GROUP,
      displayName: 'StudentSeat test identity',
      avatarKey: 'asa-avatar-07',
    };
    ready(student);
    const seatPage = {
      ...sp04Page([]),
      own: { availability: 'available' as const, score: 0, rank: 1, isSelf: true as const },
    };
    const reads = vi
      .spyOn(apiCall, 'call')
      .mockResolvedValueOnce(success(summary([group(SP04_TEST_GROUP, 0, 1)], student)))
      .mockResolvedValueOnce(success(seatPage));
    await render(student);
    expect(api.accountAvatar).not.toHaveBeenCalled();
    expect(reads.mock.calls[0]?.[0]).toBe('/api/class-join/progress/summary');
    expect(reads.mock.calls[1]?.[0]).toContain('/api/class-join/progress/groups/');
    expect(reads.mock.calls.every(([path]) => !path.startsWith('/api/progress/groups'))).toBe(true);
    expect(host.querySelector('[data-testid="own-progress-rank"]')?.textContent).toBe('1');
    expect(host.querySelector('[data-testid="own-progress-score"]')?.textContent).toBe('0');
    expect(host.querySelectorAll('.personal-progress-peers .personal-progress-peer')).toHaveLength(
      0,
    );
  });
});

describe('SP-04 unavailable group privacy fallback', () => {
  it('preserves SP-03 ambiguous Account explanation when the peer endpoint rejects 403', async () => {
    const ambiguous: OwnProgressGroupV1 = {
      ...group(SP04_TEST_GROUP, null, null),
      own: {
        availability: 'unavailable',
        score: null,
        rank: null,
        reason: 'ambiguous_self_participant',
      },
    };
    vi.spyOn(apiCall, 'call')
      .mockResolvedValueOnce(success(summary([ambiguous])))
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: { code: 'group_forbidden', message: 'Недоступна учебная группа.' },
      });
    await render();
    expect(host.textContent).toContain('Учебный профиль нужно уточнить у преподавателя.');
    expect(host.textContent).not.toContain('Не удалось загрузить участников.');
    expect(host.querySelector('.personal-progress-group-retry')).toBeNull();
    expect(host.querySelectorAll('.personal-progress-peer')).toHaveLength(0);
  });

  it('hides peer presentation for a disabled rating even if a stale page arrived', async () => {
    const disabled: OwnProgressGroupV1 = group(SP04_TEST_GROUP, null, null);
    const page = {
      ...sp04Page([sp04Peer(0)]),
      own: {
        availability: 'unavailable' as const,
        score: null,
        rank: null,
        isSelf: true as const,
        reason: 'rating_disabled' as const,
      },
    };
    vi.spyOn(apiCall, 'call')
      .mockResolvedValueOnce(success(summary([disabled])))
      .mockResolvedValueOnce(success(page));
    await render();
    expect(host.textContent).toContain('Рейтинг выключен');
    expect(host.querySelectorAll('.personal-progress-peer')).toHaveLength(0);
  });
});

describe('SP-04 aborted group-read quota and modal accessibility', () => {
  it('releases a cancelled active slot without waiting for an abandoned fetch and skips cancelled queued work', async () => {
    const first = new AbortController();
    const second = new AbortController();
    const queued = new AbortController();
    const fresh = new AbortController();
    const neverSettles = new Promise<string>(() => undefined);
    const started: string[] = [];
    const oldOne = limitedGroupRead(first.signal, () => {
      started.push('old-one');
      return neverSettles;
    }).catch(() => 'aborted');
    const oldTwo = limitedGroupRead(second.signal, () => {
      started.push('old-two');
      return neverSettles;
    }).catch(() => 'aborted');
    const cancelledQueue = limitedGroupRead(queued.signal, async () => {
      started.push('must-not-start');
      return 'cancelled';
    }).catch(() => 'aborted');
    const newAccount = limitedGroupRead(fresh.signal, async () => {
      started.push('new-account');
      return 'ready';
    });
    expect(started).toEqual(['old-one', 'old-two']);
    queued.abort();
    expect(await cancelledQueue).toBe('aborted');
    first.abort();
    await expect(newAccount).resolves.toBe('ready');
    expect(started).toEqual(['old-one', 'old-two', 'new-account']);
    second.abort();
    expect(await oldOne).toBe('aborted');
    expect(await oldTwo).toBe('aborted');
  });

  it('traps keyboard focus on future links as well as buttons in the expanded modal', async () => {
    vi.spyOn(apiCall, 'call')
      .mockResolvedValueOnce(success(summary([group(SP04_TEST_GROUP, 68.25, 101)])))
      .mockResolvedValueOnce(success(sp04Page([])))
      .mockResolvedValueOnce(success(sp04Page([])));
    await render();
    await click('Все');
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
    const close = dialog?.querySelector<HTMLButtonElement>('button');
    expect(dialog).not.toBeNull();
    expect(close).not.toBeNull();
    const link = document.createElement('a');
    link.href = '/#/learning';
    link.textContent = 'Keyboard test route';
    dialog!.append(link);
    await act(async () => {
      link.focus();
      link.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(close);
    await act(async () => {
      close!.focus();
      close!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(link);
    await click('Закрыть');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('SP-04 single-flight active rating request', () => {
  it('reuses pending same-scope SQL across cancelled Home remounts without caching a completed response', async () => {
    const response = deferred<ApiResult<GroupRatingPageV1>>();
    const fetch = vi.spyOn(apiCall, 'call').mockReturnValue(response.promise);
    const old = new AbortController();
    const fresh = new AbortController();
    const args = { limit: 5 };
    const ownerKey = 'account:account-a:personal:generation-71';
    const first = readGroupRating(
      account,
      SP04_TEST_GROUP,
      old.signal,
      'preview',
      args,
      ownerKey,
    ).then(
      () => 'unexpected',
      () => 'aborted',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    old.abort();
    expect(await first).toBe('aborted');
    const second = readGroupRating(
      account,
      SP04_TEST_GROUP,
      fresh.signal,
      'preview',
      args,
      ownerKey,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    response.resolve(success(sp04Page([sp04Peer(0)])));
    await expect(second).resolves.toMatchObject({
      ok: true,
      data: { groupId: SP04_TEST_GROUP, peers: [expect.objectContaining({ rank: 1 })] },
    });
    const repeat = readGroupRating(
      account,
      SP04_TEST_GROUP,
      new AbortController().signal,
      'preview',
      args,
      ownerKey,
    );
    await repeat;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never shares pending previews across logout/login continuity or a different account scope', async () => {
    const oldPending = deferred<ApiResult<GroupRatingPageV1>>();
    const newPending = deferred<ApiResult<GroupRatingPageV1>>();
    const fetch = vi
      .spyOn(apiCall, 'call')
      .mockReturnValueOnce(oldPending.promise)
      .mockReturnValueOnce(newPending.promise);
    const old = new AbortController();
    const latest = new AbortController();
    const first = readGroupRating(
      account,
      SP04_TEST_GROUP,
      old.signal,
      'preview',
      { limit: 5 },
      'account-a:generation-10',
    ).catch(() => 'aborted');
    old.abort();
    expect(await first).toBe('aborted');
    const second = readGroupRating(
      account,
      SP04_TEST_GROUP,
      latest.signal,
      'preview',
      { limit: 5 },
      'account-a:generation-11',
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    oldPending.resolve(success(sp04Page([sp04Peer(0)])));
    newPending.resolve(success(sp04Page([sp04Peer(1)])));
    await expect(second).resolves.toMatchObject({
      ok: true,
      data: { peers: [expect.objectContaining({ peerKey: 'opaque-peer-1' })] },
    });
  });
});

describe('SP-04 actual custom-avatar image consumer', () => {
  it('shows only the granted batch PNG and falls back to the safe default after image failure', async () => {
    const ticket = 'opaque-batch-ticket';
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S0gAAAAASUVORK5CYII=';
    const peer: GroupRatingPeerV1 = { ...sp04Peer(0), avatarTicket: ticket };
    const reads = vi
      .spyOn(apiCall, 'call')
      .mockResolvedValueOnce(success(summary([group(SP04_TEST_GROUP, 68.25, 101)])))
      .mockResolvedValueOnce(success(sp04Page([peer])))
      .mockResolvedValueOnce(success({ items: [{ ticket, dataUrl }] }));
    await render();
    const image = host.querySelector<HTMLImageElement>('.personal-progress-peer-avatar img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toBe(dataUrl);
    expect(reads.mock.calls[2]?.[0]).toBe('/api/progress/groups/' + SP04_TEST_GROUP + '/avatars');
    const options = reads.mock.calls[2]?.[1];
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual({ tickets: [ticket] });
    expect(reads.mock.calls.every(([url]) => !url.includes(ticket))).toBe(true);
    await act(async () => image!.dispatchEvent(new Event('error')));
    expect(image?.getAttribute('src')).toBe(peer.avatarSrc);
  });
});

describe('SP-04 server-bounded responsive peer counts', () => {
  it('fills every available desktop slot using the peer-row gap, not the body gap', () => {
    expect(groupRatingPreviewLimit(1100, 116, 74, 16, 5)).toBe(12);
    expect(groupRatingPreviewLimit(1100, 116, 74, 16, 8)).toBe(11);
  });
  it.each([
    [160, 0],
    [320, 2],
    [380, 3],
    [381, 3],
    [390, 3],
    [520, 4],
    [521, 4],
    [1024, 11],
    [1440, 16],
  ] as const)('chooses a bounded preview for width %i', (width, expected) => {
    expect(groupRatingPreviewLimit(width)).toBe(expected);
  });
});
