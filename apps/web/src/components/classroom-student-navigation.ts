import type { ClassroomStudentSeat } from '../api';

/** Student identity and review order come from the teacher's current class roster. */
export type StudentNavigationItem = Pick<ClassroomStudentSeat, 'id' | 'displayLabel'>;

export interface ClassroomStudentNavigation {
  previous: StudentNavigationItem;
  next: StudentNavigationItem;
  position: number;
  total: number;
}

/**
 * Return the neighbors in the *sorted full roster* (not the search result).
 * Opening one found pupil must not trap review inside a one-result filter.
 * Wraps last→first and first→last; never uses display names as identity.
 */
export function classroomStudentNavigation(
  sortedRoster: readonly StudentNavigationItem[],
  seatId: string,
): ClassroomStudentNavigation | null {
  const position = sortedRoster.findIndex((student) => student.id === seatId);
  if (position < 0) return null;
  const total = sortedRoster.length;
  return {
    previous: sortedRoster[(position + total - 1) % total]!,
    next: sortedRoster[(position + 1) % total]!,
    position: position + 1,
    total,
  };
}
