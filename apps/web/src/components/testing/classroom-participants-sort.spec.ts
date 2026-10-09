import { describe, expect, it } from 'vitest';
import { sortClassroomRoster } from '../classroom-roster-sort';
import type { ClassroomStudentSeat } from '../../api';
import type { ParticipantMetrics } from '../../classroom-participants-api';

const students = [
  { id: 'b', displayLabel: 'Борис' },
  { id: 'a', displayLabel: 'Анна' },
  { id: 'z', displayLabel: 'Нет данных' },
] as ClassroomStudentSeat[];
const metric = (totalWorks: number): ParticipantMetrics => ({
  seatId: '',
  totalWorks,
  archivedWorks: 0,
  score: 50,
  rank: 1,
  role: 'student',
  avatarUrl: null,
  factors: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
  sources: { projects: 0, logins: 0, days: 0, time: 0, grades: 0 },
});
const metrics: ReadonlyMap<string, ParticipantMetrics> = new Map([
  ['a', metric(0)],
  ['b', metric(10)],
]);
describe('participant roster ordering', () => {
  it('sorts actual project counts, preserves zero and keeps unknown values last', () => {
    expect(sortClassroomRoster(students, 'works', 'desc', metrics).map((s) => s.id)).toEqual([
      'b',
      'a',
      'z',
    ]);
    expect(sortClassroomRoster(students, 'works', 'asc', metrics).map((s) => s.id)).toEqual([
      'a',
      'b',
      'z',
    ]);
    expect(students.map((s) => s.id)).toEqual(['b', 'a', 'z']);
  });
  it('uses stable alphabetical ties in either direction and keeps rating-off values last', () => {
    expect(sortClassroomRoster(students, 'rating', 'desc', metrics).map((s) => s.id)).toEqual([
      'a',
      'b',
      'z',
    ]);
    expect(sortClassroomRoster(students, 'rating', 'asc', metrics).map((s) => s.id)).toEqual([
      'a',
      'b',
      'z',
    ]);
    const off = new Map(metrics);
    off.set('a', { ...metric(0), score: null, rank: null });
    expect(sortClassroomRoster(students, 'rating', 'asc', off).map((s) => s.id)).toEqual([
      'b',
      'a',
      'z',
    ]);
  });
});
