import { call } from './api-call';

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
};
export type JournalColumn = {
  id: string;
  date: string;
  category: string;
  preset: JournalPreset;
  scaleVersion: number;
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
export function journalGradeLabel(preset: JournalPreset, value: number | null): string {
  if (value === null) return 'Нет оценки';
  if (preset === 'smileys')
    return ['😟', '🙁', '😐', '🙂', '😃'][value - 1] ?? 'Неизвестный уровень';
  if (preset === 'symbols') return ['○', '◔', '◑', '◕', '●'][value - 1] ?? 'Неизвестный уровень';
  return String(value);
}
export function journalAccessibleLabel(preset: JournalPreset, value: number | null): string {
  const label = journalGradeLabel(preset, value);
  return value !== null && ['smileys', 'symbols'].includes(preset)
    ? `${label} — уровень ${value} из 5`
    : label;
}
export const journalApi = {
  read: (classId: string, query: JournalQuery = {}) =>
    call<JournalSnapshot>(`/api/classrooms/${classId}/journal${queryString(query)}`),
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
    call<JournalGrade>(`/api/classrooms/${classId}/journal/grade`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  results: (scope: JournalScope, query: JournalQuery = {}) =>
    call<JournalResultsPage>(
      `${scope === 'seat' ? '/api/class-join/journal/results' : '/api/learning/journal/results'}${queryString(query)}`,
    ),
};
