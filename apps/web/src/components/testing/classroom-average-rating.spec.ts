import { describe, expect, it } from 'vitest';
import { classroomAverageRatingPresentation } from '../classroom-average-rating';

describe('classroom average rating', () => {
  it('includes an actual zero and explains the denominator and period in Russian', () => {
    expect(classroomAverageRatingPresentation(0, 2, 7)).toEqual({
      value: '0,0',
      detail:
        'Средний рейтинг за последние 7 дней: 2 участника. Шкала от 0 до 100. Нулевые результаты учитываются.',
    });
    expect(classroomAverageRatingPresentation(17.35, 4, 30).value).toBe('17,4');
    expect(classroomAverageRatingPresentation(100, 1, 90).detail).toContain('1 участник.');
  });

  it('does not substitute missing or disabled ratings with a fabricated zero', () => {
    expect(classroomAverageRatingPresentation(null, 0, 90).value).toBe('—');
    expect(classroomAverageRatingPresentation(0, 0, 90).value).toBe('—');
    expect(classroomAverageRatingPresentation(undefined, undefined, undefined).value).toBe('—');
    expect(classroomAverageRatingPresentation(Number.NaN, 1, 7).value).toBe('—');
  });
});
