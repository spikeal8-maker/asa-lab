// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { ApiResult } from '../../api-call';
import { journalApi, type JournalGrade, type JournalPreset } from '../../classroom-journal-api';
import {
  participantsApi,
  type ParticipantProfile,
  type ParticipantGrades,
  type ParticipantAssignments,
} from '../../classroom-participants-api';
import {
  ParticipantGradeHistory,
  ParticipantMeritsAndAvatars,
} from '../ClassroomParticipantPanels';
import { ParticipantAssignmentsList } from '../ParticipantAssignmentsList';
import { ManualClassroomJournal } from '../ManualClassroomJournal';
import { StudentJournalResults } from '../StudentJournalResults';
import { ClassroomStudentPage } from '../../pages/ClassroomStudentPage';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(null, '', '/#/learning');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const ok = <T>(data: T): ApiResult<T> => ({ ok: true, status: 200, data });
async function render(node: ReturnType<typeof createElement>) {
  await act(async () => root.render(node));
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
function grade(value: number | null, index = 0): JournalGrade {
  return {
    id: `grade-${index}`,
    columnId: `column-${index}`,
    seatId: 'seat-a',
    revision: 1,
    value,
    reason: null,
    supersedesId: null,
    authorId: 'teacher',
    authorName: 'Преподаватель',
    publishedAt: '2026-10-10T10:00:00Z',
  };
}
function grades(preset: JournalPreset, values: Array<number | null>): ParticipantGrades {
  return {
    journal: {
      offset: 0,
      nextOffset: null,
      columns: values.map((_, i) => ({
        id: `column-${i}`,
        date: '2026-10-10',
        category: `Урок ${i}`,
        preset,
      })),
      grades: values.map(grade),
    },
    resultOffset: 0,
    nextResultOffset: null,
    results: [],
  };
}
function profile(role: 'student' | 'helper' = 'student', id = 'seat-a'): ParticipantProfile {
  return {
    status: 'active',
    student: {
      id,
      displayLabel: id,
      avatarKey: null,
      status: 'active',
      safeMode: true,
      lastActiveAt: null,
    },
    settings: {
      periodDays: 30,
      revision: 0,
      factors: { projects: true, logins: false, days: false, time: false, grades: false },
    },
    metrics: {
      seatId: id,
      totalWorks: 0,
      archivedWorks: 0,
      score: 0,
      rank: 1,
      factors: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
      sources: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
      role,
      avatarUrl: null,
    },
    helperClasses:
      role === 'helper' ? [{ id: 'class-visible', title: 'Доступный класс помощника' }] : [],
    builtinAwards: [],
    activity: [],
    merits: [],
    avatars: [],
    submittedCount: 0,
    awaitingReview: 0,
  };
}
const assigned = (id: string, title: string): ParticipantAssignments => ({
  offset: 0,
  nextOffset: null,
  items: [
    {
      id,
      title,
      kind: 'project',
      moduleKey: 'three-d',
      dueAt: null,
      assignmentId: id,
      courseRunId: null,
      activityRunId: 'run',
      projectId: null,
      status: 'not_started',
      canonicalState: null,
    },
  ],
});

describe('participant completion DOM behavior', () => {
  for (const [preset, labels] of [
    ['symbols', ['○', '◔', '◑', '◕', '●']],
    ['smileys', ['😟', '🙁', '😐', '🙂', '😃']],
  ] as const) {
    it(`renders all five ${preset} levels identically in the journal, profile, learner results and immutable history`, async () => {
      const data = grades(preset, [1, 2, 3, 4, 5]);
      vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(data));
      vi.spyOn(participantsApi, 'history').mockResolvedValue(
        ok({
          preset,
          items: [1, 2, 3, 4, 5].map((value, i) => ({
            ...grade(value, i),
            columnId: 'column-0',
            revision: i + 1,
          })),
          nextBeforeRevision: null,
        }),
      );
      vi.spyOn(journalApi, 'read').mockResolvedValue(
        ok({
          status: 'active',
          timeZone: 'UTC',
          scale: { preset, version: 1 },
          range: { from: '2026-10-01', to: '2026-10-31', today: '2026-10-10', timeZone: 'UTC' },
          offset: 0,
          nextOffset: null,
          columns: data.journal.columns.map((c) => ({ ...c, scaleVersion: 1 })),
          grades: data.journal.grades.map((g, i) => grade(g.value, i)),
          students: [{ id: 'seat-a', name: 'Анна', status: 'active' }],
        }),
      );
      vi.spyOn(journalApi, 'results').mockResolvedValue(
        ok({
          range: { from: '2026-10-01', to: '2026-10-31', today: '2026-10-10', timeZone: 'UTC' },
          offset: 0,
          nextOffset: null,
          items: data.journal.grades.map((g, i) => ({
            ...grade(g.value, i),
            ...data.journal.columns[i]!,
            scaleVersion: 1,
            classroomId: 'class',
            classroomTitle: 'Класс',
            timeZone: 'UTC',
          })),
        }),
      );
      await render(
        createElement(
          'div',
          {},
          createElement(ManualClassroomJournal, { classroomId: 'class' }),
          createElement(ParticipantGradeHistory, { classroomId: 'class', seatId: 'seat-a' }),
          createElement(StudentJournalResults, { scope: 'seat' }),
        ),
      );
      const cells = [...host.querySelectorAll<HTMLButtonElement>('.manual-journal-cell')];
      expect(cells.map((cell) => cell.textContent)).toEqual(labels);
      const expected = labels.map((label, i) => `${label} — уровень ${i + 1} из 5`);
      expect(
        [...host.querySelectorAll('.participant-grades li strong')].map((n) => n.textContent),
      ).toEqual(expected);
      expect([...host.querySelectorAll('li b')].map((n) => n.textContent)).toEqual(expected);
      for (let i = 0; i < 5; i++)
        expect(cells[i]?.getAttribute('aria-label')).toContain(expected[i]);
      await click('История');
      const history = host.querySelector('.participant-grades ol')!;
      for (const label of expected) expect(history.textContent).toContain(label);
    });
  }
  it('distinguishes numeric zero, null/revocation and a missing preset, including history', async () => {
    const data = grades('five', [0, null]);
    vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(data));
    vi.spyOn(journalApi, 'read').mockResolvedValue(
      ok({
        status: 'active',
        timeZone: 'UTC',
        scale: { preset: 'five', version: 1 },
        range: { from: '2026-10-01', to: '2026-10-31', today: '2026-10-10', timeZone: 'UTC' },
        offset: 0,
        nextOffset: null,
        columns: [
          ...data.journal.columns.map((column) => ({ ...column, scaleVersion: 1 })),
          {
            id: 'ungraded',
            date: '2026-10-10',
            category: 'Нет оценки',
            preset: 'five',
            scaleVersion: 1,
          },
        ],
        grades: data.journal.grades.map((value, index) => grade(value.value, index)),
        students: [{ id: 'seat-a', name: 'Анна', status: 'active' }],
      }),
    );
    vi.spyOn(participantsApi, 'history').mockResolvedValue(
      ok({
        preset: 'five',
        items: [
          { ...grade(null), revision: 2 },
          { ...grade(0), id: 'older' },
        ],
        nextBeforeRevision: null,
      }),
    );
    await render(
      createElement(
        'div',
        {},
        createElement(ParticipantGradeHistory, { classroomId: 'class', seatId: 'seat-a' }),
        createElement(ManualClassroomJournal, { classroomId: 'class' }),
      ),
    );
    const cells = [...host.querySelectorAll<HTMLButtonElement>('.manual-journal-cell')];
    expect(cells.map((cell) => cell.textContent)).toEqual(['0', 'Отозвана', '—']);
    expect(cells[1]?.getAttribute('aria-label')).toContain('Отозвана');
    expect(cells[2]?.getAttribute('aria-label')).toContain('Нет оценки');
    expect([...host.querySelectorAll('li strong')].map((n) => n.textContent)).toEqual([
      '0',
      'Отозвана',
    ]);
    await click('История');
    expect(host.querySelector('ol')?.textContent).toContain('Версия 1: 0');
    expect(host.querySelector('ol')?.textContent).toContain('Версия 2: Отозвана');
    const missing = grades('symbols', [3]);
    missing.journal.columns = [];
    vi.mocked(participantsApi.grades).mockResolvedValue(ok(missing));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(host.querySelector('li strong')?.textContent).toBe('Шкала недоступна');
  });
  it('shows grades immediately below the pupil hero and actual helper classes instead; history remains available', async () => {
    vi.spyOn(participantsApi, 'profile').mockResolvedValue(ok(profile()));
    vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(grades('five', [0])));
    vi.spyOn(participantsApi, 'works').mockResolvedValue(
      ok({
        totalWorks: 0,
        visibleWorks: 0,
        filteredWorks: 0,
        offset: 0,
        hasMore: false,
        items: [],
      }),
    );
    vi.spyOn(api, 'listProjectModules').mockResolvedValue(ok({ items: [] }));
    const props = {
      classroomId: 'class',
      classroomTitle: 'Класс',
      seatId: 'seat-a',
      onBack: vi.fn(),
      onOpenProject: vi.fn(),
    };
    await render(createElement(ClassroomStudentPage, props));
    expect(
      host.querySelector('.participant-hero')?.nextElementSibling?.getAttribute('aria-label'),
    ).toBe('Последние оценки');
    expect(host.querySelector('.participant-grade-summary strong')?.textContent).toBe('0');
    vi.mocked(participantsApi.profile).mockResolvedValue(ok(profile('helper', 'seat-b')));
    await render(createElement(ClassroomStudentPage, { ...props, seatId: 'seat-b' }));
    expect(
      host.querySelector('.participant-hero')?.nextElementSibling?.getAttribute('aria-label'),
    ).toBe('Классы помощника');
    expect(host.textContent).toContain('Доступный класс помощника');
    expect(host.querySelector('.participant-grade-summary')).toBeNull();
    await click('Оценки и история');
    expect(host.querySelector('.participant-grades')).not.toBeNull();
  });
  it('loads assigned work independently of projects and clears a delayed previous pupil response', async () => {
    let resolveOld!: (value: ApiResult<ParticipantAssignments>) => void;
    vi.spyOn(participantsApi, 'assignments')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
      )
      .mockResolvedValue(ok(assigned('new-task', 'Новое назначение')));
    const works = vi.spyOn(participantsApi, 'works');
    await render(
      createElement(ParticipantAssignmentsList, { classroomId: 'class', seatId: 'seat-a' }),
    );
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await render(
      createElement(ParticipantAssignmentsList, { classroomId: 'class', seatId: 'seat-b' }),
    );
    await act(async () => resolveOld(ok(assigned('old-task', 'Чужое назначение'))));
    expect(host.textContent).toContain('Новое назначение');
    expect(host.textContent).not.toContain('Чужое назначение');
    expect(host.textContent).toContain('Не начато');
    expect(host.textContent).not.toContain('Открыть проект');
    expect(works).not.toHaveBeenCalled();
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      '#/classrooms/class?assignment=new-task&learner=seat-b',
    );
  });
  it('uses only Seat reads, handles empty/error/retry/archive and never falls back to an Account', async () => {
    const seat = vi
      .spyOn(participantsApi, 'seatAssignments')
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        error: { code: 'unauthorized', message: 'Войдите' },
      })
      .mockResolvedValue(ok({ offset: 0, nextOffset: null, items: [] }));
    const account = vi.spyOn(participantsApi, 'assignments');
    await render(
      createElement(ParticipantAssignmentsList, {
        classroomId: 'class',
        seatId: 'seat-a',
        seatSession: true,
        learner: true,
        readOnly: true,
      }),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Войдите');
    await click('Повторить');
    expect(host.textContent).toContain('Назначенных заданий пока нет.');
    expect(host.textContent).toContain('Класс в архиве');
    expect(seat).toHaveBeenCalledTimes(2);
    expect(account).not.toHaveBeenCalled();
  });
  it('presents learner recognition without teacher/API language and preserves selecting an available secret avatar', async () => {
    const data = profile('helper');
    data.merits = [
      {
        id: 'merit',
        title: 'Мастер',
        description: 'Аккуратная работа',
        granted: true,
        grantedAt: null,
      },
    ];
    data.avatars = [
      {
        id: 'avatar',
        title: 'Секретный мастер',
        url: '/avatar',
        secret: true,
        available: true,
        selected: true,
        permitted: true,
      },
    ];
    const save = vi.spyOn(participantsApi, 'seatAvatar').mockResolvedValue(ok({ saved: true }));
    const changed = vi.fn().mockResolvedValue(undefined);
    await render(
      createElement(ParticipantMeritsAndAvatars, {
        classroomId: 'class',
        seatId: 'seat-a',
        profile: data,
        readOnly: true,
        onChanged: changed,
      }),
    );
    expect(host.textContent).toContain('Мои заслуги');
    expect(host.textContent).toContain('Доступные мне аватары');
    expect(host.textContent).not.toContain('Заслуги преподавателя');
    expect(host.textContent).not.toContain('API');
    expect(host.textContent).not.toContain('чужим оценкам');
    await click('Сохранить аватар');
    expect(save).toHaveBeenCalledWith('avatar', expect.any(String));
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
