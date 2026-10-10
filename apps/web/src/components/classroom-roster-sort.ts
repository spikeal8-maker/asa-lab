import type { ClassroomStudentSeat } from '../api';
import type { ParticipantMetrics } from '../classroom-participants-api';

export type ClassroomRosterSort =
  'name' | 'code' | 'submitted' | 'awaiting' | 'active' | 'safe' | 'works' | 'rating';

/** Sort only presentation copies. Student identity never depends on row number. */
export function sortClassroomRoster(
  students: readonly ClassroomStudentSeat[],
  key: ClassroomRosterSort,
  direction: 'asc' | 'desc',
  metrics: ReadonlyMap<string, ParticipantMetrics> = new Map(),
): ClassroomStudentSeat[] {
  const names = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
  const factor = direction === 'asc' ? 1 : -1;
  const time = (value: string | null): number => {
    const parsed = value ? Date.parse(value) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...students].sort((a, b) => {
    if (key === 'works' || key === 'rating') {
      const left = key === 'works' ? metrics.get(a.id)?.totalWorks : metrics.get(a.id)?.score;
      const right = key === 'works' ? metrics.get(b.id)?.totalWorks : metrics.get(b.id)?.score;
      return (
        (left == null ? (right == null ? 0 : 1) : right == null ? -1 : (left - right) * factor) ||
        names.compare(a.displayLabel, b.displayLabel) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );
    }
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
