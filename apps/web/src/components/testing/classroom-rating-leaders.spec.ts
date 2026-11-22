import { describe, expect, it } from 'vitest';
import {
  classroomRatingLeaders,
  classroomRatingLeaderLabel,
  type RatingClassroom,
} from '../classroom-rating-leaders';
import type { ObservationRating } from '../../classroom-observation-api';

const item = (id: string, title = id): RatingClassroom => ({
  id,
  title,
  status: 'active',
  teacherRole: 'owner',
});
const metric = (averageRating: number | null, overrides: Partial<ObservationRating> = {}) => ({
  averageRating,
  ratingParticipants: 2,
  ratingPeriodDays: 30 as const,
  ...overrides,
});
const rows = [item('a'), item('b'), item('c'), item('d')];

describe('classroomRatingLeaders', () => {
  it('returns at most three ranks by canonical score', () => {
    const result = classroomRatingLeaders(
      rows,
      new Map([
        ['a', metric(40)],
        ['b', metric(90)],
        ['c', metric(60)],
        ['d', metric(80)],
      ]),
    );
    expect([...result].map(([id, value]) => [id, value.rank])).toEqual([
      ['b', 1],
      ['d', 2],
      ['c', 3],
    ]);
  });

  it('excludes null and preserves a real zero', () => {
    const result = classroomRatingLeaders(
      rows.slice(0, 2),
      new Map([
        ['a', metric(null)],
        ['b', metric(0)],
      ]),
    );
    expect([...result.keys()]).toEqual(['b']);
    expect(result.get('b')?.score).toBe(0);
  });

  it('suppresses all badges for each omitted or undefined required field before eligibility filters', () => {
    const fields = ['averageRating', 'ratingParticipants', 'ratingPeriodDays'] as const;
    const incompleteClasses = [
      item('b'),
      { ...item('b'), status: 'archived' },
      { ...item('b'), teacherRole: 'student' },
    ];
    for (const field of fields) {
      for (const classroom of incompleteClasses) {
        const omitted: Partial<ObservationRating> = { ...metric(70) };
        delete omitted[field];
        const undefinedField = { ...metric(70), [field]: undefined };
        for (const incomplete of [omitted, undefinedField]) {
          const metrics = new Map<string, Partial<ObservationRating>>([
            ['a', metric(80)],
            ['b', incomplete],
          ]);
          expect(classroomRatingLeaders([item('a'), classroom], metrics).size).toBe(0);
        }
      }
    }
  });

  it('keeps valid peers and zero ranked when an explicit null rating is fully provided', () => {
    const result = classroomRatingLeaders(
      rows.slice(0, 3),
      new Map([
        ['a', metric(null, { ratingPeriodDays: 7 })],
        ['b', metric(80)],
        ['c', metric(0)],
      ]),
    );
    expect([...result].map(([id, leader]) => [id, leader.rank, leader.score])).toEqual([
      ['b', 1, 80],
      ['c', 2, 0],
    ]);
    expect(result.has('a')).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity, -0.01, 100.01])('excludes invalid score %s', (score) => {
    expect(classroomRatingLeaders([item('a')], new Map([['a', metric(score)]]))).toEqual(new Map());
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'excludes invalid participant count %s',
    (ratingParticipants) => {
      expect(
        classroomRatingLeaders([item('a')], new Map([['a', metric(50, { ratingParticipants })]]))
          .size,
      ).toBe(0);
    },
  );

  it('requires a supported period and participant count', () => {
    for (const value of [
      { averageRating: 50, ratingParticipants: 1 },
      { averageRating: 50, ratingPeriodDays: 30 as const },
    ]) {
      expect(classroomRatingLeaders([item('a')], new Map([['a', value]])).size).toBe(0);
    }
  });

  it('suppresses mixed comparable periods', () => {
    expect(
      classroomRatingLeaders(
        rows.slice(0, 2),
        new Map([
          ['a', metric(80, { ratingPeriodDays: 7 })],
          ['b', metric(70, { ratingPeriodDays: 90 })],
        ]),
      ).size,
    ).toBe(0);
  });

  it('does not compare periods belonging to invalid ratings', () => {
    expect([
      ...classroomRatingLeaders(
        rows.slice(0, 2),
        new Map([
          ['a', metric(80)],
          ['b', metric(null, { ratingPeriodDays: 7 })],
        ]),
      ).keys(),
    ]).toEqual(['a']);
  });

  it('suppresses an incomplete snapshot of the complete role list', () => {
    expect(classroomRatingLeaders(rows, new Map([['a', metric(100)]])).size).toBe(0);
  });

  it('orders ties naturally by Russian name and then id, independently of input order', () => {
    const classes = [item('z', 'Класс 10'), item('b', 'Класс 2'), item('a', 'Класс 2')];
    const metrics = new Map(classes.map(({ id }) => [id, metric(80)]));
    const result = classroomRatingLeaders(classes, metrics);
    expect([...result.keys()]).toEqual(['a', 'b', 'z']);
    expect([...classroomRatingLeaders([...classes].reverse(), metrics).keys()]).toEqual([
      'a',
      'b',
      'z',
    ]);
    expect(result.get('a')?.tied).toBe(true);
    expect(classroomRatingLeaderLabel(result.get('a')!)).toContain('названием класса');
    expect(classroomRatingLeaderLabel(result.get('a')!)).toContain('30 дней');
  });

  it('excludes archived and enrolled classes but includes co-teaching', () => {
    const classes = [
      { ...item('a'), status: 'archived' },
      { ...item('b'), teacherRole: 'student' },
      { ...item('c'), teacherRole: 'co_teacher' },
      { ...item('d'), status: 'deleted' },
    ];
    expect([
      ...classroomRatingLeaders(classes, new Map(classes.map(({ id }) => [id, metric(90)]))).keys(),
    ]).toEqual(['c']);
  });

  it('does not mutate inputs and ranks unrounded scores', () => {
    const classes = Object.freeze([Object.freeze(item('a')), Object.freeze(item('b'))]);
    const a = Object.freeze(metric(80.041));
    const b = Object.freeze(metric(80.049));
    const metrics = new Map([
      ['a', a],
      ['b', b],
    ]);
    const before = [...metrics];
    const result = classroomRatingLeaders(classes, metrics);
    expect([...result.keys()]).toEqual(['b', 'a']);
    expect(result.get('b')?.score).toBe(80.049);
    expect(classes.map(({ id }) => id)).toEqual(['a', 'b']);
    expect([...metrics]).toEqual(before);
  });
});
