// @vitest-environment jsdom

import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonalProgressSummaryV1 } from '@asa-lab/contracts';
import {
  api,
  type ApiResult,
  type ModuleSummary,
  type Project,
  type SessionPayload,
  type SeatAssignment,
} from '../../api';
import * as apiCall from '../../api-call';
import { CreatorHomePage } from '../CreatorHomePage';
import { QuickProjectCreation, useProjectScroll } from '../../creator-portal/QuickProjectCreation';
import { setTelemetryContext } from '../../telemetry-context';
import type { OwnProgressActor } from '../../creator-portal/personal-progress';

vi.mock('../../creator-portal/HomePublicShelves', () => ({ HomePublicShelves: () => null }));
vi.mock('../../creator-portal/QuickProjectCreation', async (original) => {
  const actual = await original<typeof import('../../creator-portal/QuickProjectCreation')>();
  return { ...actual, useProjectScroll: vi.fn(() => vi.fn()) };
});
const actor = {
  kind: 'account',
  accountId: 'home-account',
  displayName: 'Ученик',
} satisfies OwnProgressActor;
const session = {} as SessionPayload;
const success = <T>(data: T): ApiResult<T> => ({ ok: true, status: 200, data });
const failure: ApiResult<never> = {
  ok: false,
  status: 503,
  error: { code: 'unavailable', message: 'Ошибка запроса' },
};
const module3d: ModuleSummary = {
  moduleKey: 'three-d',
  moduleVersion: '1',
  displayName: '3D-моделирование',
  shortDescription: '',
  defaultProjectTitlePrefix: 'Модель',
  projectType: 'three-d',
  schemaVersion: 1,
  editorRoute: '',
  viewerRoute: '',
  safeModeSupported: true,
  availability: 'active',
  previewKind: 'scene',
  iconKey: 'three-d',
  categories: [],
  creatable: true,
};
function project(title: string, moduleKey = 'electronics'): Project {
  return {
    id: title,
    title,
    moduleKey,
    scope: 'personal',
    classroomId: null,
    status: 'active',
    createdAt: '2026-11-12',
    updatedAt: '2026-11-12',
    preview: null,
    snapshotRevision: null,
    copiedFrom: {
      projectId: 'source',
      title: 'Длинное исходное название работы',
      author: 'Александра Константинопольская',
      at: '2026-11-12',
    },
  };
}
function progressSummary(): PersonalProgressSummaryV1 {
  return {
    scope: { kind: 'account', accountId: actor.accountId },
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
    groups: { availability: 'available', items: [], hasMore: false, nextCursor: null },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
let host: HTMLDivElement;
let root: Root;
let frames: string[];
const onCreated = vi.fn();
const onNavigate = vi.fn();
const onOpenProject = vi.fn();
const onAllProjects = vi.fn();
const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
function ready(workspaceId = 'personal') {
  setTelemetryContext({ kind: 'account', accountId: actor.accountId, workspaceId }, true, 'home');
}
function Harness() {
  useLayoutEffect(() => {
    frames.push(host.textContent ?? '');
  });
  return createElement(QuickProjectCreation, {
    contextKey: 'own-context',
    onCreated,
    children: createElement(CreatorHomePage, {
      session,
      actor,
      onNavigate,
      onOpenProject,
      onAllProjects,
      onOpenWork: vi.fn(),
      onOpenCourse: vi.fn(),
    }),
  });
}
async function render() {
  await act(async () => root.render(createElement(Harness)));
}
function section(key: string) {
  return host.querySelector(`[data-module="${key}"]`)!;
}
function createButton(key: string) {
  return section(key).querySelector<HTMLButtonElement>('.home-create-button')!;
}
beforeEach(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  frames = [];
  ready();
  sessionStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(apiCall, 'call').mockResolvedValue(success(progressSummary()));
  vi.spyOn(api, 'accountAvatar').mockResolvedValue(success({ avatarDataUrl: null }));
  vi.spyOn(api, 'listProjectModules').mockResolvedValue(success({ items: [module3d] }));
  vi.spyOn(api, 'listProjects').mockResolvedValue(success({ items: [] }));
  vi.spyOn(api, 'attendedAssignments').mockResolvedValue(success({ items: [] }));
  vi.spyOn(api, 'accountQuizzes').mockResolvedValue(success({ items: [] }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setTelemetryContext(null, false, 'unknown');
  vi.restoreAllMocks();
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('Personal Home sections', () => {
  it('renders completed module reads independently and keeps existing work when creation is unavailable', async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.listProjects>>>();
    vi.mocked(api.listProjects).mockImplementation((options) =>
      options?.module === 'three-d'
        ? pending.promise
        : Promise.resolve(
            options?.module === 'electronics'
              ? success({ items: [project('Моя схема')] })
              : options?.module === 'blocks'
                ? failure
                : success({ items: [] }),
          ),
    );
    await render();
    expect(host.querySelectorAll('.creator-module-section')).toHaveLength(4);
    expect(section('electronics').textContent).toContain('Моя схема');
    expect(section('electronics').querySelector('.project-card-origin')?.textContent).toBe(
      'Копия работы «Длинное исходное название работы», автор Александра Константинопольская',
    );
    expect(createButton('electronics').disabled).toBe(true);
    expect(section('electronics').textContent).toContain('Сейчас недоступно');
    expect(section('three-d').textContent).toContain('Загружаем проекты');
    expect(section('blocks').textContent).toContain('Проекты этой среды сейчас не загрузились');
    expect(section('robotics').textContent).toContain('Пока нет программ');
    expect(vi.mocked(useProjectScroll).mock.lastCall?.[0]).toBe(false);
    await act(async () => pending.resolve(success({ items: [] })));
    expect(vi.mocked(useProjectScroll).mock.lastCall?.[0]).toBe(true);
    const before = vi.mocked(api.listProjects).mock.calls.length;
    vi.mocked(api.listProjects).mockResolvedValue(
      success({ items: [project('Загруженная программа', 'blocks')] }),
    );
    await act(async () =>
      section('blocks').querySelector<HTMLButtonElement>('.home-module-error button')!.click(),
    );
    expect(api.listProjects).toHaveBeenCalledTimes(before + 1);
    expect(vi.mocked(api.listProjects).mock.lastCall?.[0]?.module).toBe('blocks');
    expect(section('blocks').textContent).toContain('Загруженная программа');
    expect(section('electronics').textContent).toContain('Моя схема');
  });

  it('distinguishes a module-catalog error from confirmed unavailability and retains four useful entry points', async () => {
    vi.mocked(api.listProjectModules)
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(success({ items: [module3d] }));
    await render();
    expect(host.querySelectorAll('.creator-module-section')).toHaveLength(4);
    expect(host.textContent).toContain('Открыть знания');
    expect(host.textContent).toContain('Открыть обучение');
    expect(host.textContent).not.toContain('Заданий для продолжения пока нет');
    for (const node of host.querySelectorAll('.home-module-availability'))
      expect(node.textContent).toBe('Не удалось проверить доступность среды.');
    expect(host.textContent).not.toContain('Сейчас недоступно');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('.portal-create-notice button')!.click(),
    );
    expect(createButton('three-d').disabled).toBe(false);
    expect(section('electronics').textContent).toContain('Сейчас недоступно');
    await act(async () =>
      section('electronics').querySelector<HTMLButtonElement>('.home-module-all')!.click(),
    );
    expect(onAllProjects).toHaveBeenCalledWith('electronics');
  });

  it('waits for initial summary, actionable work and module availability before restoring scroll', async () => {
    const pendingSummary = deferred<ApiResult<PersonalProgressSummaryV1>>();
    const pendingWork = deferred<Awaited<ReturnType<typeof api.attendedAssignments>>>();
    const pendingModules = deferred<Awaited<ReturnType<typeof api.listProjectModules>>>();
    vi.mocked(apiCall.call).mockReturnValue(pendingSummary.promise);
    vi.mocked(api.attendedAssignments).mockReturnValue(pendingWork.promise);
    vi.mocked(api.listProjectModules).mockReturnValue(pendingModules.promise);
    await render();
    expect(vi.mocked(useProjectScroll).mock.lastCall?.[0]).toBe(false);
    expect(section('three-d').textContent).toContain('Пока нет моделей');
    await act(async () => pendingModules.resolve(success({ items: [module3d] })));
    await act(async () => pendingSummary.resolve(success(progressSummary())));
    expect(vi.mocked(useProjectScroll).mock.lastCall?.[0]).toBe(false);
    await act(async () => pendingWork.resolve(success({ items: [] })));
    expect(vi.mocked(useProjectScroll).mock.lastCall?.[0]).toBe(true);
  });

  it('links to a canonical quiz-only next action and keeps its load independent of project failure', async () => {
    vi.mocked(api.listProjects).mockResolvedValue(failure);
    vi.mocked(api.accountQuizzes).mockResolvedValue(
      success({
        items: [
          {
            assignmentId: 'quiz-only',
            title: 'Проверка цепи',
            status: 'open',
            attemptLimit: 2,
            attemptsUsed: 0,
            latestResult: null,
            canonicalState: { workflowState: 'not_started' },
          },
        ],
      } as Awaited<ReturnType<typeof api.accountQuizzes>> extends ApiResult<infer T> ? T : never),
    );
    await render();
    const link = host.querySelector<HTMLAnchorElement>('.personal-progress-next a')!;
    expect(link.textContent).toBe('Начать: Проверка цепи');
    expect(link.getAttribute('href')).toBe('/#/learning?assignment=quiz-only');
    expect(section('three-d').textContent).toContain('Проекты этой среды сейчас не загрузились');
  });

  it('links to a modern Direct quiz from assignments when the legacy quiz endpoint is empty, without starting work', async () => {
    vi.mocked(api.attendedAssignments).mockResolvedValue(
      success({
        items: [
          {
            id: 'modern-quiz',
            title: 'Современный тест',
            activityKind: 'quiz',
            activityRunId: 'modern-run',
            status: 'open',
            projectId: null,
            submittedAt: null,
            classroomTitle: 'Учебная группа',
            canonicalState: null,
          } as SeatAssignment & { classroomTitle: string },
        ],
      }),
    );
    const pendingProof = deferred<Awaited<ReturnType<typeof api.readQuizLearning>>>();
    const proof = vi.spyOn(api, 'readQuizLearning').mockReturnValue(pendingProof.promise);
    const projectStart = vi.spyOn(api, 'startLearningWork');
    const quizStart = vi.spyOn(api, 'startQuizLearning');
    await render();
    expect(api.accountQuizzes).toHaveBeenCalledTimes(1);
    expect(proof).toHaveBeenCalledExactlyOnceWith('modern-run');
    expect(host.querySelector('.personal-progress-next a')).toBeNull();
    expect(vi.mocked(useProjectScroll).mock.lastCall?.[0]).toBe(false);
    await act(async () =>
      pendingProof.resolve(
        success({
          participationId: 'part',
          attempt: null,
          title: 'Современный тест',
          instructions: null,
          canStart: true,
        }),
      ),
    );
    expect(vi.mocked(useProjectScroll).mock.lastCall?.[0]).toBe(true);
    const link = host.querySelector<HTMLAnchorElement>('.personal-progress-next a')!;
    expect(link.textContent).toBe('Начать: Современный тест');
    expect(link.getAttribute('href')).toBe('/#/learning?assignment=modern-quiz');
    expect(projectStart).not.toHaveBeenCalled();
    expect(quizStart).not.toHaveBeenCalled();
  });
});

describe('Home session and creation boundaries', () => {
  it('hides old private cards and retires late lists and next actions across same-ID logout/login', async () => {
    const pendingProjects = deferred<Awaited<ReturnType<typeof api.listProjects>>>();
    const pendingWork = deferred<Awaited<ReturnType<typeof api.attendedAssignments>>>();
    vi.mocked(api.listProjects).mockImplementation((options) =>
      options?.module === 'three-d'
        ? pendingProjects.promise
        : Promise.resolve(success({ items: [project('PREVIOUS CARD')] })),
    );
    vi.mocked(api.attendedAssignments)
      .mockReturnValueOnce(pendingWork.promise)
      .mockResolvedValue(success({ items: [] }));
    await render();
    expect(host.textContent).toContain('PREVIOUS CARD');
    vi.mocked(api.listProjects).mockResolvedValue(success({ items: [] }));
    frames.length = 0;
    await act(async () => {
      setTelemetryContext(null, false, 'home');
      root.render(createElement(Harness));
    });
    expect(host.textContent).not.toContain('PREVIOUS CARD');
    expect(frames.every((frame) => !frame.includes('PREVIOUS CARD'))).toBe(true);
    await act(async () => ready());
    await act(async () => {
      pendingProjects.resolve(success({ items: [project('LATE PRIVATE')] }));
      pendingWork.resolve(
        success({
          items: [
            {
              id: 'late',
              title: 'LATE ASSIGNMENT',
              status: 'open',
              projectId: 'late',
              submittedAt: null,
            } as SeatAssignment & { classroomTitle: string },
          ],
        }),
      );
    });
    expect(host.textContent).not.toMatch(/PREVIOUS CARD|LATE PRIVATE|LATE ASSIGNMENT/);
    expect(api.listProjects).toHaveBeenCalledTimes(8);
  });

  it('keeps QuickProjectCreation one-flight and reuses the same idempotency key after an uncertain response', async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.createProject>>>();
    const create = vi
      .spyOn(api, 'createProject')
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(
        success({ project: project('Новая модель', 'three-d'), created: false }),
      );
    await render();
    await act(async () => {
      createButton('three-d').click();
      createButton('three-d').click();
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(createButton('three-d').disabled).toBe(true);
    await act(async () => pending.resolve({ ...failure, status: 0 }));
    await act(async () =>
      host.querySelector<HTMLButtonElement>('.portal-create-notice button')!.click(),
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0].idempotencyKey).toBe(create.mock.calls[1]![0].idempotencyKey);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated.mock.calls[0]![0].title).toBe('Новая модель');
    expect(sessionStorage.getItem('asa-pending-create:own-context')).toBeNull();
  });
});
