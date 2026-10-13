import { describe, expect, it } from 'vitest';
import { classroomStudentNavigation } from '../classroom-student-navigation';
import { sortClassroomRoster } from '../classroom-roster-sort';
import type { ClassroomStudentSeat } from '../../api';

const seats = ['Борис', 'Анна', 'Яна'].map((displayLabel, i) => ({
  id: String(i + 1),
  displayLabel,
  submittedCount: i,
  awaitingReview: 0,
  studentCode: null,
  loginMethod: 'account' as const,
  loginHandle: null,
  safeMode: true,
  status: 'active' as const,
  avatarKey: null,
  lastActiveAt: null,
  createdAt: '',
})) satisfies ClassroomStudentSeat[];

describe('teacher review navigation', () => {
  it('uses the current displayed sort order, with wraparound at both ends', () => {
    const ordered = sortClassroomRoster(seats, 'name', 'asc');
    expect(ordered.map((s) => s.displayLabel)).toEqual(['Анна', 'Борис', 'Яна']);
    const first = classroomStudentNavigation(ordered, ordered[0]!.id)!;
    expect([first.previous.displayLabel, first.next.displayLabel, first.position, first.total])
      .toEqual(['Яна', 'Борис', 1, 3]);
    const last = classroomStudentNavigation(ordered, ordered[2]!.id)!;
    expect([last.previous.displayLabel, last.next.displayLabel, last.position])
      .toEqual(['Борис', 'Анна', 3]);
  });

  it('follows an alternative teacher sort and ignores search filtering', () => {
    const ordered = sortClassroomRoster(seats, 'submitted', 'desc');
    const chosen = ordered[1]!;
    // The teacher may have searched for one person. The navigator still
    // receives the complete sorted class, not the one filtered row.
    const onlySearchResult = ordered.filter((s) => s.id === chosen.id);
    expect(onlySearchResult).toHaveLength(1);
    const navigation = classroomStudentNavigation(ordered, chosen.id)!;
    expect(navigation.total).toBe(3);
    expect(navigation.previous.id).toBe(ordered[0]!.id);
    expect(navigation.next.id).toBe(ordered[2]!.id);
  });

  it('never crosses a missing seat and handles empty or one-person classes', () => {
    expect(classroomStudentNavigation([], '1')).toBeNull();
    expect(classroomStudentNavigation(seats, 'foreign-class-seat')).toBeNull();
    const one = classroomStudentNavigation([seats[0]!], seats[0]!.id)!;
    expect(one.total).toBe(1);
    expect(one.previous.id).toBe(one.next.id);
  });
});
