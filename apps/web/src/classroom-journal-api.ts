import { call } from './api-call';
import type { ApiResult } from './api-call';

async function confirmedJournal<T>(
  request: Promise<ApiResult<T>>,
  valid: (data: T) => boolean,
): Promise<ApiResult<T>> {
  const result = await request;
  if (result.ok && (!result.data || !valid(result.data)))
    return {
      ok: false,
      status: 0,
      error: {
        code: 'incomplete_response',
        message: 'Ответ сервера не получен полностью. Повторите запрос.',
      },
    };
  return result;
}

export type JournalPreset = 'five' | 'hundred' | 'three_five' | 'smileys' | 'symbols';
export type JournalScale = { preset: JournalPreset; version: number };
export type JournalScope = 'account' | 'seat';
export type JournalRange = { from: string; to: string; today: string; timeZone: string };
export type JournalPage = { range: JournalRange; offset: number; nextOffset: number | null };
export type JournalQuery = {
  from?: string;
  to?: string;
  offset?: number;
  limit?: number;
  columnId?: string;
  slotKey?: string;
};
export type JournalColumn = {
  id: string;
  date: string;
  category: string;
  preset: JournalPreset;
  scaleVersion: number;
  headerRevision?: number;
  slotKey?: string | null;
};
export type JournalQuickInput = {
  columnId?: string;
  slotKey?: string;
  date: string;
  category: string;
  expectedScaleVersion: number;
  expectedHeaderRevision: number;
  requestId: string;
  seatId?: string;
  value?: number | null;
  reason?: string | null;
  expectedRevision?: number;
};
export type JournalQuickResult = {
  column: JournalColumn;
  grade: JournalGrade | null;
  scale: JournalScale;
};
export type JournalGrade = {
  id: string;
  columnId: string;
  seatId: string;
  revision: number;
  value: number | null;
  reason: string | null;
  supersedesId: string | null;
  authorId: string;
  authorName: string;
  publishedAt: string;
};
export type JournalSnapshot = JournalPage & {
  reservedSlotKeys?: string[];
  status: string;
  timeZone: string;
  scale: JournalScale;
  students: { id: string; name: string; status: string }[];
  columns: JournalColumn[];
  grades: JournalGrade[];
};
export type JournalResult = JournalGrade &
  Omit<JournalColumn, 'id'> & { classroomId: string; classroomTitle: string; timeZone: string };
export type JournalResultsPage = JournalPage & { items: JournalResult[] };
export function journalMonthRange(month: string): { from: string; to: string } {
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
export function journalShiftMonth(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
}
function queryString(input: JournalQuery): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(input))
    if (value !== undefined) query.set(name, String(value));
  return `?${query.toString()}`;
}
export const journalPresets: Record<JournalPreset, string> = {
  five: '0–5 баллов',
  hundred: '0–100 баллов',
  three_five: '3–5 (3, 4, 5)',
  smileys: 'Смайлики',
  symbols: 'Значки',
};
export function journalLevels(preset: JournalPreset): number[] {
  return preset === 'hundred'
    ? Array.from({ length: 101 }, (_, i) => i)
    : preset === 'three_five'
      ? [3, 4, 5]
      : preset === 'five'
        ? [0, 1, 2, 3, 4, 5]
        : [1, 2, 3, 4, 5];
}
export function journalGradeLabel(preset: JournalPreset | undefined, value: number | null): string {
  if (value === null) return 'Нет оценки';
  if (!preset) return 'Шкала недоступна';
  if (preset === 'smileys')
    return ['😟', '🙁', '😐', '🙂', '😃'][value - 1] ?? 'Неизвестный уровень';
  if (preset === 'symbols') return ['○', '◔', '◑', '◕', '●'][value - 1] ?? 'Неизвестный уровень';
  return String(value);
}
export function journalAccessibleLabel(
  preset: JournalPreset | undefined,
  value: number | null,
): string {
  const label = journalGradeLabel(preset, value);
  return value !== null && preset !== undefined && ['smileys', 'symbols'].includes(preset)
    ? `${label} — уровень ${value} из 5`
    : label;
}
export function journalRevisionLabel(
  preset: JournalPreset | undefined,
  value: number | null,
): string {
  return value === null ? 'Отозвана' : journalAccessibleLabel(preset, value);
}
export const journalApi = {
  quick: (classId: string, input: JournalQuickInput) =>
    confirmedJournal(
      call<JournalQuickResult>(`/api/classrooms/${classId}/journal/quick`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      (data) =>
        typeof data.column?.id === 'string' &&
        typeof data.scale?.version === 'number' &&
        (input.slotKey === undefined || data.column.slotKey === input.slotKey) &&
        (input.seatId === undefined ||
          (typeof data.grade?.id === 'string' &&
            data.grade.seatId === input.seatId &&
            data.grade.columnId === data.column.id &&
            data.grade.value === input.value &&
            data.grade.revision === (input.expectedRevision ?? 0) + 1)),
    ),
  read: (classId: string, query: JournalQuery = {}) =>
    confirmedJournal(
      call<JournalSnapshot>(`/api/classrooms/${classId}/journal${queryString(query)}`),
      (data) =>
        typeof data.status === 'string' &&
        typeof data.scale?.version === 'number' &&
        typeof data.range?.from === 'string' &&
        typeof data.range.today === 'string' &&
        typeof data.timeZone === 'string' &&
        Array.isArray(data.columns) &&
        Array.isArray(data.students) &&
        Array.isArray(data.grades),
    ),
  settings: (classId: string) =>
    call<{ status: string; scale: JournalScale; timeZone: string }>(
      `/api/classrooms/${classId}/journal/settings`,
    ),
  history: (classId: string, columnId: string, seatId: string, beforeRevision?: number) =>
    call<{ items: JournalGrade[]; nextBeforeRevision: number | null }>(
      `/api/classrooms/${classId}/journal/${columnId}/${seatId}/history?limit=20${beforeRevision === undefined ? '' : `&beforeRevision=${beforeRevision}`}`,
    ),
  scale: (
    classId: string,
    input: { preset: JournalPreset; expectedRevision: number; requestId: string },
  ) =>
    call<JournalScale>(`/api/classrooms/${classId}/journal/scale`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  column: (
    classId: string,
    input: { date: string; category: string; expectedRevision: number; requestId: string },
  ) =>
    call<{ id: string }>(`/api/classrooms/${classId}/journal/column`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  grade: (
    classId: string,
    input: {
      columnId: string;
      seatId: string;
      value: number | null;
      reason: string | null;
      expectedRevision: number;
      requestId: string;
    },
  ) =>
    confirmedJournal(
      call<JournalGrade>(`/api/classrooms/${classId}/journal/grade`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
      (data) =>
        typeof data.id === 'string' &&
        data.columnId === input.columnId &&
        data.seatId === input.seatId &&
        data.revision === input.expectedRevision + 1 &&
        data.value === input.value,
    ),
  results: (scope: JournalScope, query: JournalQuery = {}) =>
    call<JournalResultsPage>(
      `${scope === 'seat' ? '/api/class-join/journal/results' : '/api/learning/journal/results'}${queryString(query)}`,
    ),
};
