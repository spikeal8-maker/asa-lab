// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningPage, learningSection, hasCourseAssignment } from '../LearningPage';
import { api, type SeatCourseRun } from '../../api';
import { setTelemetryContext } from '../../telemetry-context';
import { AttendedClassesPage } from '../AttendedClassesPage';

const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

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
