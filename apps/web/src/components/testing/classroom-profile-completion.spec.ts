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
  type ParticipantManualHistory,
} from '../../classroom-participants-api';
import {
  ParticipantGradeHistory,
  ParticipantMeritsAndAvatars,
  StudentParticipantSummary,
} from '../ClassroomParticipantPanels';
import { ParticipantAssignmentsList } from '../ParticipantAssignmentsList';
import { ManualClassroomJournal } from '../ManualClassroomJournal';
import { StudentJournalResults } from '../StudentJournalResults';
import { ClassroomStudentPage } from '../../pages/ClassroomStudentPage';
import * as avatarFiles from '../../creator-portal/avatar-file';
import { notifySessionLoggedOut } from '../../session-fetch';
import { SchoolTimeProvider } from '../school-time';

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
function labelled<T extends HTMLInputElement | HTMLTextAreaElement>(name: string): T {
  const label = [...host.querySelectorAll('label')].find(
    (node) => node.textContent?.trim() === name,
  );
  expect(label, `exact label: ${name}`).toBeDefined();
  expect(label!.control).not.toBeNull();
  return label!.control as T;
}
async function fill(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype =
      control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
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

function ownProfile(id = 'seat-a'): ParticipantProfile {
  const data = profile('student', id);
  data.avatars = ['saved', 'draft'].map((key) => ({
    id: key,
    title: key,
    url: `/avatar/${key}`,
    secret: false,
    available: true,
    selected: key === 'saved',
    permitted: true,
  }));
  return data;
}

function summaryReads(mode: 'Account' | 'Seat') {
  const accountProfile = vi.spyOn(participantsApi, 'profile').mockResolvedValue(ok(ownProfile()));
  const seatProfile = vi.spyOn(participantsApi, 'seatProfile').mockResolvedValue(ok(ownProfile()));
  const accountGrades = vi
    .spyOn(participantsApi, 'grades')
    .mockResolvedValue(ok(grades('five', [0])));
  const seatGrades = vi
    .spyOn(participantsApi, 'seatGrades')
    .mockResolvedValue(ok(grades('five', [0])));
  const history = ok<ParticipantManualHistory>({
    preset: 'five',
    items: [{ ...grade(0), reason: 'История моего профиля' }],
    nextBeforeRevision: null,
  });
  const accountHistory = vi.spyOn(participantsApi, 'history').mockResolvedValue(history);
  const seatHistory = vi.spyOn(participantsApi, 'seatHistory').mockResolvedValue(history);
  const empty = ok<ParticipantAssignments>({ offset: 0, nextOffset: null, items: [] });
  const accountAssignments = vi.spyOn(participantsApi, 'assignments').mockResolvedValue(empty);
  const seatAssignments = vi.spyOn(participantsApi, 'seatAssignments').mockResolvedValue(empty);
  return {
    read: mode === 'Account' ? accountProfile : seatProfile,
    historyRead: mode === 'Account' ? accountHistory : seatHistory,
    forbidden:
      mode === 'Account'
        ? [seatProfile, seatGrades, seatHistory, seatAssignments]
        : [accountProfile, accountGrades, accountHistory, accountAssignments],
  };
}

function ownHistoryDetails(): HTMLDetailsElement {
  const details = [...host.querySelectorAll<HTMLDetailsElement>('details')].find((element) =>
    element.querySelector('.participant-grades'),
  );
  expect(details, 'the grade-history panel, not the rating explanation').toBeDefined();
  return details!;
}
async function openOwnSummary() {
  const details = ownHistoryDetails();
  await act(async () => details.querySelector('summary')!.click());
  expect(details.open).toBe(true);
  await click('История');
  const draft = host.querySelector<HTMLButtonElement>('[aria-label="Выбрать draft"]')!;
  await act(async () => draft.click());
  return {
    details,
    draft,
    recognition: host.querySelector('.participant-recognition')!,
    history: host.querySelector('.participant-history')!,
  };
}

describe('participant completion DOM behavior', () => {
  for (const mode of ['Account', 'Seat'] as const) {
    const props =
      mode === 'Account' ? { accountSeat: { classroomId: 'class', seatId: 'seat-a' } } : {};

    it(`${mode} summary keeps mounted recognition, selected avatar and open history during and after same-identity focus refresh`, async () => {
      const reads = summaryReads(mode);
      await render(createElement(StudentParticipantSummary, props));
      const before = await openOwnSummary();
      let resolveRefresh!: (value: ApiResult<ParticipantProfile>) => void;
      reads.read.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );
      await act(async () => window.dispatchEvent(new Event('focus')));
      const expectPreserved = () => {
        expect(host.querySelector('.participant-recognition')).toBe(before.recognition);
        expect(before.recognition.isConnected).toBe(true);
        expect(ownHistoryDetails()).toBe(before.details);
        expect(before.details.open).toBe(true);
        expect(host.querySelector('.participant-history')).toBe(before.history);
        expect(before.history.isConnected).toBe(true);
        expect(host.querySelector('[aria-label="Выбрать draft"]')).toBe(before.draft);
        expect(before.draft.getAttribute('aria-pressed')).toBe('true');
      };
      expectPreserved();
      const updated = ownProfile();
      updated.metrics.totalWorks = 7;
      await act(async () => resolveRefresh(ok(updated)));
      expectPreserved();
      expect(host.textContent).toContain('Всего работ: 7');
      expect(reads.read).toHaveBeenCalledTimes(2);
      expect(reads.historyRead).toHaveBeenCalledOnce();
      if (mode === 'Account') expect(reads.read).toHaveBeenLastCalledWith('class', 'seat-a');
      else expect(reads.read).toHaveBeenLastCalledWith();
      for (const forbidden of reads.forbidden) expect(forbidden).not.toHaveBeenCalled();
    });

    for (const boundary of ['logout', 'denied', 'error', 'scope', 'returned-seat'] as const) {
      // Seat identity is supplied by /me, so its scope change is the returned-seat case.
      if (mode === 'Seat' && boundary === 'scope') continue;
      it(`${mode} summary clears child state at ${boundary} and ignores the older profile response`, async () => {
        const reads = summaryReads(mode);
        await render(createElement(StudentParticipantSummary, props));
        const before = await openOwnSummary();
        let resolveOld!: (value: ApiResult<ParticipantProfile>) => void;
        reads.read.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveOld = resolve;
            }),
        );
        await act(async () => window.dispatchEvent(new Event('focus')));
        expect(before.recognition.isConnected).toBe(true);
        expect(before.history.isConnected).toBe(true);
        if (boundary === 'logout') {
          await act(async () => notifySessionLoggedOut());
          expect(host.textContent).toContain('Войдите, чтобы открыть профиль.');
        } else if (boundary === 'denied' || boundary === 'error') {
          reads.read.mockResolvedValue({
            ok: false,
            status: boundary === 'denied' ? 403 : 500,
            error: { code: 'unavailable', message: 'Профиль недоступен' },
          });
          await act(async () => window.dispatchEvent(new Event('focus')));
          expect(host.textContent).toContain('Профиль недоступен');
        } else {
          const next = ownProfile('seat-b');
          next.merits = [
            {
              id: 'new',
              title: 'Заслуга нового ученика',
              description: '',
              granted: true,
              grantedAt: null,
            },
          ];
          reads.read.mockResolvedValue(ok(next));
          if (boundary === 'scope' && mode === 'Account') {
            await render(
              createElement(StudentParticipantSummary, {
                accountSeat: { classroomId: 'other-class', seatId: 'seat-b' },
              }),
            );
            expect(reads.read).toHaveBeenLastCalledWith('other-class', 'seat-b');
          } else await act(async () => window.dispatchEvent(new Event('focus')));
          expect(host.textContent).toContain('Заслуга нового ученика');
          expect(ownHistoryDetails().open).toBe(false);
          expect(
            host.querySelector('[aria-label="Выбрать saved"]')?.getAttribute('aria-pressed'),
          ).toBe('true');
        }
        expect(before.recognition.isConnected).toBe(false);
        expect(before.history.isConnected).toBe(false);
        expect(before.details.isConnected).toBe(false);
        const old = ownProfile();
        old.merits = [
          {
            id: 'old',
            title: 'Запоздавший прежний профиль',
            description: '',
            granted: true,
            grantedAt: null,
          },
        ];
        await act(async () => resolveOld(ok(old)));
        expect(host.textContent).not.toContain('Запоздавший прежний профиль');
        expect(host.textContent).not.toContain('История моего профиля');
        expect(host.querySelector('.participant-history')).toBeNull();
        if (boundary === 'logout' || boundary === 'denied' || boundary === 'error') {
          expect(host.querySelector('.participant-recognition')).toBeNull();
          reads.read.mockResolvedValue(ok(ownProfile()));
          await click('Повторить');
          expect(ownHistoryDetails().open).toBe(false);
          expect(
            host.querySelector('[aria-label="Выбрать saved"]')?.getAttribute('aria-pressed'),
          ).toBe('true');
          expect(host.querySelector('.participant-history')).toBeNull();
        }
        for (const forbidden of reads.forbidden) expect(forbidden).not.toHaveBeenCalled();
      });
    }
  }

  it('keeps exact labels, merit drafts, avatar choice and prepared upload across awards and focus refreshes, clearing them on denial/logout', async () => {
    const data = profile();
    data.avatars = ['saved', 'draft'].map((id) => ({
      id,
      title: id,
      url: `/avatar/${id}`,
      secret: false,
      available: true,
      selected: id === 'saved',
      permitted: true,
    }));
    const read = vi
      .spyOn(participantsApi, 'profile')
      .mockImplementation(async () => ok({ ...data }));
    vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(grades('five', [])));
    vi.spyOn(api, 'listProjectModules').mockResolvedValue(ok({ items: [] }));
    vi.spyOn(participantsApi, 'works').mockResolvedValue(
      ok({
        items: [],
        totalWorks: 0,
        visibleWorks: 0,
        filteredWorks: 0,
        offset: 0,
        hasMore: false,
      }),
    );
    const awards = vi.spyOn(participantsApi, 'listSeatAwards').mockResolvedValue(ok({ items: [] }));
    await render(
      createElement(ClassroomStudentPage, {
        classroomId: 'class',
        classroomTitle: 'Класс',
        seatId: 'seat-a',
        onBack: vi.fn(),
        onOpenProject: vi.fn(),
      }),
    );
    await click('Заслуги');
    expect(awards).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);
    const title = labelled<HTMLInputElement>('Название заслуги');
    const description = labelled<HTMLTextAreaElement>('Описание');
    const descriptionId = description.id;
    await fill(title, 'Мастер класса');
    await fill(description, 'Аккуратная работа');
    expect(labelled('Название заслуги')).toBe(title);
    expect(labelled('Описание')).toBe(description);
    expect(description.labels?.[0]?.htmlFor).toBe(descriptionId);
    expect(description.labels?.[0]?.contains(description)).toBe(false);
    const draftAvatar = host.querySelector<HTMLButtonElement>('[aria-label="Выбрать draft"]')!;
    await act(async () => draftAvatar.click());
    await fill(labelled('Название аватара'), 'Подготовленный аватар');
    vi.spyOn(avatarFiles, 'createAvatarDataUrl').mockResolvedValue('data:image/webp;base64,AA==');
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,AA==',
    );
    const uploadInput = labelled<HTMLInputElement>('Файлы аватаров');
    await act(async () => {
      Object.defineProperty(uploadInput, 'files', {
        value: [new File(['png'], 'avatar.png', { type: 'image/png' })],
      });
      uploadInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const prepared = host.querySelector('img[alt="Подготовленный аватар"]');
    expect(prepared).not.toBeNull();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(read).toHaveBeenCalledTimes(3);
    expect(awards).toHaveBeenCalledOnce();
    expect(title.isConnected).toBe(true);
    expect(description.isConnected).toBe(true);
    expect(title.value).toBe('Мастер класса');
    expect(description.value).toBe('Аккуратная работа');
    expect(labelled('Название заслуги')).toBe(title);
    expect(labelled('Описание')).toBe(description);
    expect(description.id).toBe(descriptionId);
    expect(description.labels?.[0]?.textContent).toBe('Описание');
    expect(draftAvatar.getAttribute('aria-pressed')).toBe('true');
    expect(prepared!.isConnected).toBe(true);
    expect(labelled('Название аватара').value).toBe('Подготовленный аватар');
    read.mockResolvedValue({
      ok: false,
      status: 403,
      error: { code: 'forbidden', message: 'Доступ отозван' },
    });
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(host.querySelector('.participant-recognition')).toBeNull();
    expect(host.textContent).toContain('Доступ отозван');
    read.mockResolvedValue(ok(data));
    await click('Повторить');
    expect(labelled('Описание').value).toBe('');
    expect(labelled('Название заслуги').value).toBe('');
    expect(labelled('Название аватара').value).toBe('');
    expect(host.querySelector('img[alt="Подготовленный аватар"]')).toBeNull();
    expect(host.querySelector('[aria-label="Выбрать saved"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    await fill(labelled('Описание'), 'Черновик прежнего аккаунта');
    await act(async () => notifySessionLoggedOut());
    expect(host.querySelector('.participant-recognition')).toBeNull();
    expect(host.textContent).toContain('Войдите, чтобы открыть профиль.');
    await click('Повторить');
    expect(labelled('Описание').value).toBe('');
  });

  for (const next of [
    { classroomId: 'other-class', seatId: 'seat-a' },
    { classroomId: 'class', seatId: 'seat-b' },
  ]) {
    it(`clears recognition drafts when the scope changes to ${next.classroomId}/${next.seatId}`, async () => {
      const props = {
        classroomId: 'class',
        seatId: 'seat-a',
        profile: profile(),
        onChanged: vi.fn(),
      };
      await render(createElement(ParticipantMeritsAndAvatars, props));
      await fill(labelled('Название заслуги'), 'Чужая заслуга');
      await fill(labelled('Описание'), 'Чужое описание');
      await fill(labelled('Название аватара'), 'Чужой аватар');
      await render(
        createElement(ParticipantMeritsAndAvatars, {
          ...props,
          ...next,
          profile: profile('student', next.seatId),
        }),
      );
      expect(labelled('Название заслуги').value).toBe('');
      expect(labelled('Описание').value).toBe('');
      expect(labelled('Название аватара').value).toBe('');
    });
  }

  it('does not label an archived teacher view as the teachers own pupil achievements', async () => {
    const data = profile();
    data.status = 'archived';
    await render(
      createElement(ParticipantMeritsAndAvatars, {
        classroomId: 'class',
        seatId: 'seat-a',
        profile: data,
        readOnly: true,
        onChanged: vi.fn(),
      }),
    );
    expect(host.textContent).toContain('Заслуги преподавателя');
    expect(host.textContent).not.toContain('Мои заслуги');
    expect(host.textContent).not.toContain('Доступные мне аватары');
    expect(
      [...host.querySelectorAll('button')]
        .filter((button) => !button.disabled)
        .map((button) => button.textContent),
    ).toEqual(['Отмена выбора']);
  });
  it('the compact pupil summary selects the newest lesson dates rather than storage row order', async () => {
    const data = grades('five', [1, 2, 3, 4]);
    data.journal.columns.forEach((column, index) => {
      column.date = ['2026-10-03', '2026-10-01', '2026-10-04', '2026-10-02'][index]!;
    });
    vi.spyOn(participantsApi, 'grades').mockResolvedValue(ok(data));
    await render(
      createElement(ParticipantGradeHistory, {
        classroomId: 'class',
        seatId: 'seat-a',
        compact: true,
      }),
    );
    expect(
      [...host.querySelectorAll('.participant-grade-summary li strong')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['3', '1', '4']);
    expect(host.querySelectorAll('.participant-grade-summary button')).toHaveLength(0);
  });

  for (const timeZone of ['America/Los_Angeles', 'Pacific/Kiritimati']) {
    it(`keeps calendar lesson dates and shows semantic local history time with a year in ${timeZone}, preserving open history on refresh`, async () => {
      const stamp = '2026-10-11T00:01:02.123456+00:00';
      const data = grades('five', [0, null]);
      data.journal.columns[0]!.date = '2026-10-01';
      data.journal.columns[0]!.category = 'Очень длинное название занятия'.repeat(3);
      vi.spyOn(participantsApi, 'grades').mockImplementation(async () => ok({ ...data }));
      const historyRead = vi.spyOn(participantsApi, 'history').mockResolvedValue(
        ok({
          preset: 'five',
          nextBeforeRevision: 2,
          items: [
            {
              ...grade(null),
              id: 'revision-3',
              revision: 3,
              publishedAt: stamp,
              authorName: 'ДлинноеИмяПреподавателя'.repeat(5),
              reason: 'Подробная причина изменения'.repeat(8),
            },
            { ...grade(0), id: 'revision-2', revision: 2, publishedAt: stamp },
          ],
        }),
      );
      await render(
        createElement(SchoolTimeProvider, {
          timeZone,
          children: createElement(ParticipantGradeHistory, {
            classroomId: 'class',
            seatId: 'seat-a',
          }),
        }),
      );
      const lesson = host.querySelector<HTMLTimeElement>('.participant-grade-context time')!;
      expect(lesson.dateTime).toBe('2026-10-01');
      expect(lesson.textContent).toBe('01.10.2026');
      expect(host.querySelector('.participant-grade-author')?.textContent).toBe('Преподаватель');
      expect(
        [...host.querySelectorAll('.participant-grade-value')].map((n) => n.textContent),
      ).toEqual(['0', 'Отозвана']);
      expect(host.querySelector('button')?.classList.contains('btn-secondary')).toBe(true);
      await click('История');
      const history = host.querySelector('.participant-history')!;
      expect(history.querySelectorAll('ol li')).toHaveLength(2);
      expect(history.textContent).toContain('Версия 2: 0');
      expect(history.textContent).toContain('Версия 3: Отозвана');
      const expected = new Intl.DateTimeFormat('ru-RU', {
        timeZone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(stamp));
      for (const time of history.querySelectorAll<HTMLTimeElement>('time')) {
        expect(time.dateTime).toBe(stamp);
        expect(time.textContent).toBe(expected);
        expect(time.textContent).toContain('2026');
        expect(time.textContent).not.toContain('T00:01');
        expect(time.textContent).not.toContain('+00:00');
        expect(time.textContent).not.toContain('123456');
      }
      await act(async () => window.dispatchEvent(new Event('focus')));
      expect(history.isConnected).toBe(true);
      expect(historyRead).toHaveBeenCalledOnce();
      historyRead.mockResolvedValue(
        ok({
          preset: 'five',
          nextBeforeRevision: null,
          items: [{ ...grade(5), id: 'revision-1', revision: 1, publishedAt: stamp }],
        }),
      );
      await click('Ещё история');
      expect(host.querySelectorAll('.participant-history ol li')).toHaveLength(3);
      expect(historyRead).toHaveBeenLastCalledWith('class', 'seat-a', 'column-0', 2);
      await click('Закрыть историю');
      expect(host.querySelector('.participant-history')).toBeNull();
    });
  }

  for (const boundary of ['logout', 'scope', 'revocation', 'history-denial'] as const) {
    it(`disables pending history actions and discards an old response at ${boundary}`, async () => {
      const gradeRead = vi
        .spyOn(participantsApi, 'grades')
        .mockResolvedValue(ok(grades('five', [0])));
      let resolveOld!: (value: ApiResult<ParticipantManualHistory>) => void;
      vi.spyOn(participantsApi, 'history')
        .mockResolvedValueOnce(
          ok({
            preset: 'five',
            items: [{ ...grade(0), reason: 'Прежняя история' }],
            nextBeforeRevision: 1,
          }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveOld = resolve;
            }),
        );
      await render(
        createElement(ParticipantGradeHistory, { classroomId: 'class', seatId: 'seat-a' }),
      );
      await click('История');
      await click('Ещё история');
      expect(
        [...host.querySelectorAll<HTMLButtonElement>('li button')].every((b) => b.disabled),
      ).toBe(true);
      await act(async () => window.dispatchEvent(new Event('focus')));
      expect(host.textContent).toContain('Прежняя история');
      if (boundary === 'logout') {
        await act(async () => notifySessionLoggedOut());
        expect(host.textContent).toContain('Войдите, чтобы открыть оценки.');
      } else if (boundary === 'scope') {
        gradeRead.mockResolvedValue(ok(grades('five', [5])));
        await render(
          createElement(ParticipantGradeHistory, { classroomId: 'class', seatId: 'seat-b' }),
        );
        expect(host.querySelector('.participant-grade-value')?.textContent).toBe('5');
      } else if (boundary === 'revocation') {
        gradeRead.mockResolvedValue({
          ok: false,
          status: 403,
          error: { code: 'forbidden', message: 'Доступ отозван' },
        });
        await act(async () => window.dispatchEvent(new Event('focus')));
        expect(host.querySelector('.participant-grade-value')).toBeNull();
        expect(host.textContent).toContain('Доступ отозван');
      }
      if (boundary === 'history-denial') {
        await act(async () =>
          resolveOld({
            ok: false,
            status: 403,
            error: { code: 'forbidden', message: 'История недоступна' },
          }),
        );
        expect(host.querySelector('.participant-grade-value')).toBeNull();
        expect(host.textContent).toContain('История недоступна');
      } else
        await act(async () =>
          resolveOld(
            ok({
              preset: 'five',
              items: [{ ...grade(1), reason: 'Запоздавшие чужие данные' }],
              nextBeforeRevision: null,
            }),
          ),
        );
      expect(host.querySelector('.participant-history')).toBeNull();
      expect(host.textContent).not.toContain('Прежняя история');
      expect(host.textContent).not.toContain('Запоздавшие чужие данные');
    });
  }

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
    expect(host.querySelector('.participant-role-hint')).toBeNull();
    vi.mocked(participantsApi.profile).mockResolvedValue(ok(profile('helper', 'seat-b')));
    await render(createElement(ClassroomStudentPage, { ...props, seatId: 'seat-b' }));
    expect(
      host.querySelector('.participant-hero')?.nextElementSibling?.getAttribute('aria-label'),
    ).toBe('Классы помощника');
    expect(host.textContent).toContain('Доступный класс помощника');
    expect(host.querySelector('.participant-grade-summary')).toBeNull();
    expect(host.querySelector('.participant-role-hint')).not.toBeNull();
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
        learnerView: true,
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
