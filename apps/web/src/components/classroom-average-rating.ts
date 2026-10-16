const ratingFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function participantNoun(count: number): string {
  if (count % 100 >= 11 && count % 100 <= 14) return 'участников';
  if (count % 10 === 1) return 'участник';
  if (count % 10 >= 2 && count % 10 <= 4) return 'участника';
  return 'участников';
}

/** Display the canonical participant score; never turn an unavailable score into zero. */
export function classroomAverageRatingPresentation(
  averageRating: number | null | undefined,
  participants: number | null | undefined,
  periodDays: number | null | undefined,
): { value: string; detail: string } {
  const period = [7, 30, 90].includes(periodDays ?? 0)
    ? `за последние ${periodDays} дней`
    : 'за выбранный период';
  const count =
    typeof participants === 'number' && Number.isInteger(participants) && participants >= 0
      ? participants
      : 0;
  const valid =
    count > 0 &&
    typeof averageRating === 'number' &&
    Number.isFinite(averageRating) &&
    averageRating >= 0 &&
    averageRating <= 100;
  return {
    value: valid ? ratingFormatter.format(averageRating) : '—',
    detail: valid
      ? `Средний рейтинг ${period}: ${count} ${participantNoun(count)}. Шкала от 0 до 100. Нулевые результаты учитываются.`
      : `Нет рассчитанного рейтинга ${period}. Участников расчёта: ${count}.`,
  };
}
