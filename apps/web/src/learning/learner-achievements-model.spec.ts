import { describe, expect, it } from 'vitest';
import type { LearnerResult } from '../api';
import type { JournalResult } from '../classroom-journal-api';
import type { ParticipantProfile } from '../classroom-participants-api';
import {
  learnerGrantedMerits,
  learnerJournalItems,
  learnerRankLabel,
  learnerResultLabel,
  learnerScoreLabel,
} from './learner-achievements-model';

function grade(id: string, classroomId: string, date: string): JournalResult {
  return {
    id,
    columnId: id,
    seatId: 'own-seat',
    revision: 1,
    value: 5,
    reason: null,
    supersedesId: null,
    authorId: 'teacher',
    authorName: 'Преподаватель',
    publishedAt: date + 'T10:00:00Z',
    date,
    category: 'Практика',
    preset: 'five',
    scaleVersion: 1,
    classroomId,
    classroomTitle: 'Одинаковое название',
    timeZone: 'Europe/Moscow',
  };
}

describe('student achievements presentation', () => {
  it('separates same-named classes using exact IDs and orders journal dates', () => {
    const input = [
      grade('a', 'class-1', '2026-10-10'),
      grade('b', 'class-2', '2026-10-15'),
      grade('c', 'class-1', '2026-10-16'),
    ];
    expect(learnerJournalItems(input, 'class-1').map((item) => item.id)).toEqual(['c', 'a']);
    expect(learnerJournalItems(input, null).map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('uses the selected canonical revision, not an older compatibility grade', () => {
    const result = {
      displayGrade: '4',
      points: 4,
      maxPoints: 5,
      canonicalState: {
        selectedResult: { displayGrade: '5', rawPoints: 20, maxPoints: 20 },
      },
    } as LearnerResult;
    expect(learnerResultLabel(result)).toBe('5');
    expect(
      learnerResultLabel({
        ...result,
        canonicalState: { selectedResult: { displayGrade: null, rawPoints: 0, maxPoints: 10 } },
      } as LearnerResult),
    ).toBe('0 / 10');
    expect(
      learnerResultLabel({
        ...result,
        canonicalState: {
          selectedResult: { displayGrade: null, rawPoints: null, maxPoints: null },
        },
      } as LearnerResult),
    ).toBe('Без балла');
  });

  it('never invents disabled ratings and only displays granted merits', () => {
    const profile = {
      metrics: { score: null, rank: null },
      merits: [
        { id: 'one', title: 'Исследователь', description: '', granted: true, grantedAt: null },
        { id: 'two', title: 'Черновик', description: '', granted: false, grantedAt: null },
      ],
    } as ParticipantProfile;
    expect(learnerRankLabel(profile)).toBe('—');
    expect(learnerScoreLabel(profile)).toBe('—');
    expect(learnerGrantedMerits(profile).map((item) => item.id)).toEqual(['one']);
    expect(learnerRankLabel(undefined)).toBe('—');
  });
});
