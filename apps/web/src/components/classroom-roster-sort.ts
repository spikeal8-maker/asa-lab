import type { ClassroomStudentSeat } from '../api';

export type ClassroomRosterSort = 'name' | 'code' | 'submitted' | 'awaiting' | 'active' | 'safe';

/** Sort only presentation copies. Student identity never depends on row number. */
export function sortClassroomRoster(
  students: readonly ClassroomStudentSeat[],
  key: ClassroomRosterSort,
  direction: 'asc' | 'desc',
): ClassroomStudentSeat[] {
  const names = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
  const factor = direction === 'asc' ? 1 : -1;
  const time = (value: string | null): number => {
    const parsed = value ? Date.parse(value) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...students].sort((a, b) => {
    const difference =
      key === 'name'
        ? names.compare(a.displayLabel, b.displayLabel)
        : key === 'code'
          ? (a.studentCode ?? '') < (b.studentCode ?? '')
            ? -1
            : (a.studentCode ?? '') > (b.studentCode ?? '')
              ? 1
              : 0
          : key === 'submitted'
            ? (a.submittedCount ?? 0) - (b.submittedCount ?? 0)
            : key === 'awaiting'
              ? (a.awaitingReview ?? 0) - (b.awaitingReview ?? 0)
              : key === 'safe'
                ? Number(a.safeMode) - Number(b.safeMode)
                : time(a.lastActiveAt) - time(b.lastActiveAt);
    return (
      difference * factor ||
      names.compare(a.displayLabel, b.displayLabel) ||
      a.id.localeCompare(b.id)
    );
  });
}
