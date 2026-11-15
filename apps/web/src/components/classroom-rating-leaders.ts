import type { ObservationRating } from '../classroom-observation-api';

export interface RatingClassroom {
  id: string;
  title: string;
  status: string;
  teacherRole?: string;
}

export interface ClassroomRatingLeader {
  rank: 1 | 2 | 3;
  score: number;
  periodDays: ObservationRating['ratingPeriodDays'];
  tied: boolean;
}

type RatingMetric = Partial<ObservationRating>;
const names = new Intl.Collator('ru-RU', { sensitivity: 'base', numeric: true });

function validRating(metric: RatingMetric | undefined): metric is ObservationRating {
  return (
    metric !== undefined &&
    typeof metric.averageRating === 'number' &&
    Number.isFinite(metric.averageRating) &&
    metric.averageRating >= 0 &&
    metric.averageRating <= 100 &&
    typeof metric.ratingParticipants === 'number' &&
    Number.isSafeInteger(metric.ratingParticipants) &&
    metric.ratingParticipants > 0 &&
    (metric.ratingPeriodDays === 7 ||
      metric.ratingPeriodDays === 30 ||
      metric.ratingPeriodDays === 90)
  );
}

/** Pass the complete authorized role list, before search or visual sorting. */
export function classroomRatingLeaders(
  roleItems: readonly RatingClassroom[],
  metrics: ReadonlyMap<string, RatingMetric>,
): Map<string, ClassroomRatingLeader> {
  const result = new Map<string, ClassroomRatingLeader>();
  if (
    roleItems.some((item) => {
      const metric = metrics.get(item.id);
      return (
        metric === undefined ||
        metric.averageRating === undefined ||
        metric.ratingParticipants === undefined ||
        metric.ratingPeriodDays === undefined
      );
    })
  )
    return result;

  const candidates: Array<{ classroom: RatingClassroom; rating: ObservationRating }> = [];
  for (const classroom of roleItems) {
    if (
      classroom.status !== 'active' ||
      (classroom.teacherRole !== 'owner' && classroom.teacherRole !== 'co_teacher')
    )
      continue;
    const rating = metrics.get(classroom.id);
    if (validRating(rating)) candidates.push({ classroom, rating });
  }
  if (new Set(candidates.map(({ rating }) => rating.ratingPeriodDays)).size > 1) return result;

  candidates.sort(
    (a, b) =>
      b.rating.averageRating! - a.rating.averageRating! ||
      names.compare(a.classroom.title, b.classroom.title) ||
      (a.classroom.id < b.classroom.id ? -1 : a.classroom.id > b.classroom.id ? 1 : 0),
  );
  candidates.slice(0, 3).forEach(({ classroom, rating }, index) => {
    result.set(classroom.id, {
      rank: (index + 1) as 1 | 2 | 3,
      score: rating.averageRating!,
      periodDays: rating.ratingPeriodDays,
      tied: candidates.some(
        (candidate) =>
          candidate.classroom.id !== classroom.id &&
          candidate.rating.averageRating === rating.averageRating,
      ),
    });
  });
  return result;
}

export function classroomRatingLeaderLabel(leader: ClassroomRatingLeader): string {
  return `${leader.rank}-е место по среднему рейтингу среди активных классов текущей роли за последние ${leader.periodDays} дней. Рейтинг: ${leader.score} из 100.${leader.tied ? ' Есть равный рейтинг.' : ''} При равном рейтинге порядок определяется названием класса (числа по возрастанию), затем идентификатором.`;
}
