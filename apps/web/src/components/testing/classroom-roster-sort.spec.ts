import { describe, expect, it } from 'vitest';
import type { ClassroomStudentSeat } from '../../api';
import { sortClassroomRoster } from '../classroom-roster-sort';

const seats: ClassroomStudentSeat[] = [
  {
    id: '3',
    displayLabel: 'Яна',
    studentCode: 'Ab7k',
    loginHandle: 'Ab7k',
    safeMode: true,
    status: 'active',
    avatarKey: null,
    lastActiveAt: null,
    createdAt: '',
    submittedCount: 1,
    awaitingReview: 0,
  },
  {
    id: '1',
    displayLabel: 'Анна',
    studentCode: 'cd89',
    loginHandle: 'cd89',
    safeMode: false,
    status: 'active',
    avatarKey: null,
    lastActiveAt: '2026-10-07T12:00:00Z',
    createdAt: '',
    submittedCount: 3,
    awaitingReview: 2,
  },
  {
    id: '2',
    displayLabel: 'Борис',
    studentCode: 'CD89',
    loginHandle: 'CD89',
    safeMode: true,
    status: 'active',
    avatarKey: null,
    lastActiveAt: 'invalid',
    createdAt: '',
    submittedCount: 2,
    awaitingReview: 1,
  },
];
describe('classroom roster presentation sorting', () => {
  it('starts alphabetically without mutating identities or source order', () => {
    expect(sortClassroomRoster(seats, 'name', 'asc').map((s) => s.id)).toEqual(['1', '2', '3']);
    expect(seats.map((s) => s.id)).toEqual(['3', '1', '2']);
  });
  it('reverses alphabetic order', () => {
    expect(sortClassroomRoster(seats, 'name', 'desc').map((s) => s.id)).toEqual(['3', '2', '1']);
  });
  it.each(['submitted', 'awaiting'] as const)('sorts the %s column both ways', (key) => {
    expect(sortClassroomRoster(seats, key, 'desc').map((s) => s.id)).toEqual(['1', '2', '3']);
    expect(sortClassroomRoster(seats, key, 'asc').map((s) => s.id)).toEqual(['3', '2', '1']);
  });
  it('puts missing or invalid activity behind real timestamps', () => {
    expect(sortClassroomRoster(seats, 'active', 'desc')[0]?.id).toBe('1');
  });
  it('sorts codes case-sensitively', () => {
    expect(sortClassroomRoster(seats, 'code', 'asc').map((s) => s.studentCode)).toEqual([
      'Ab7k',
      'CD89',
      'cd89',
    ]);
  });
  it('sorts safe-mode values', () => {
    expect(sortClassroomRoster(seats, 'safe', 'asc')[0]?.id).toBe('1');
  });
  it('keeps stable identity order for equal values', () => {
    const same = seats.map((s) => ({ ...s, displayLabel: 'Анна', submittedCount: 0 }));
    expect(sortClassroomRoster(same, 'submitted', 'desc').map((s) => s.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });
});
