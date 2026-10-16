import type { LearnerResult } from '../api';
import type { JournalResult } from '../classroom-journal-api';
import type { ParticipantProfile } from '../classroom-participants-api';

/** Match journal evidence by canonical class ID, never by a display title. */
export function learnerJournalItems(
  items: readonly JournalResult[],
  classroomId: string | null,
): JournalResult[] {
  return items
    .filter((entry) => classroomId === null || entry.classroomId === classroomId)
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        right.publishedAt.localeCompare(left.publishedAt) ||
        left.id.localeCompare(right.id),
    );
}

/** A grade from canonical assessment evidence is not interchangeable with a journal mark. */
export function learnerResultLabel(result: LearnerResult): string {
  const selected = result.canonicalState?.selectedResult;
  if (selected?.displayGrade !== null && selected?.displayGrade !== undefined)
    return selected.displayGrade;
  if (selected) {
    if (selected.rawPoints !== null && selected.maxPoints !== null)
      return selected.rawPoints + ' / ' + selected.maxPoints;
    return 'Без балла';
  }
  if (result.displayGrade !== null) return result.displayGrade;
  if (result.points !== null && result.maxPoints !== null)
    return result.points + ' / ' + result.maxPoints;
  return 'Без балла';
}

export function learnerRankLabel(profile: ParticipantProfile | undefined): string {
  if (!profile || profile.metrics.score === null || profile.metrics.rank === null) return '—';
  return String(profile.metrics.rank);
}

export function learnerScoreLabel(profile: ParticipantProfile | undefined): string {
  if (!profile || profile.metrics.score === null) return '—';
  return profile.metrics.score.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export function learnerGrantedMerits(profile: ParticipantProfile | undefined) {
  return (profile?.merits ?? []).filter((merit) => merit.granted);
}
