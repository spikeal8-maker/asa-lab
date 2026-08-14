import { describe, expect, it } from 'vitest';
import {
  CHECKERS_CONCEPT_IDS,
  applyCheckersLearningEvidence,
  buildCheckersStudentHome,
  createEmptyConceptProgress,
  validateCheckersAssignment,
  type CheckersAssignment,
  type CheckersConceptProgress,
  type CheckersLearningEvidence,
  type CheckersStudentAssignment,
} from '../domain/learning';

const evidence: CheckersLearningEvidence = {
  id: 'evidence-1',
  studentId: 'student-1',
  conceptId: 'mandatory-capture',
  kind: 'puzzle-attempt',
  outcome: 'correct',
  sourceId: 'puzzle-1',
  occurredAt: '2026-08-11T10:00:00.000Z',
  firstAttempt: true,
  hintLevel: 0,
  transferPosition: false,
  score: 100,
};

const assignment: CheckersAssignment = {
  id: 'assignment-1',
  classroomId: 'class-1',
  teacherId: 'teacher-1',
  title: 'Обязательное взятие',
  kind: 'lesson',
  targetRef: 'unit-03-capture',
  assigneeKind: 'class',
  assigneeIds: ['class-1'],
  dueAt: '2026-08-10T10:00:00.000Z',
  attemptLimit: 3,
  hintsAllowed: true,
  maxHintLevel: 3,
  minimumScore: 80,
  requiredCompletions: 1,
  status: 'assigned',
};

describe('Checkers concept mastery and spaced review', () => {
  it('records successful evidence and schedules transparent review', () => {
    const result = applyCheckersLearningEvidence(
      createEmptyConceptProgress('student-1', 'mandatory-capture'),
      evidence,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        studentId: 'student-1',
        conceptId: 'mandatory-capture',
        mastery: 19,
        attempts: 1,
        successfulAttempts: 1,
        evidenceIds: ['evidence-1'],
        lastPracticedAt: '2026-08-11T10:00:00.000Z',
        nextReviewAt: '2026-08-18T10:00:00.000Z',
      },
    });
  });

  it('returns mistakes quickly and refuses duplicate or foreign evidence', () => {
    const previous: CheckersConceptProgress = {
      ...createEmptyConceptProgress('student-1', 'mandatory-capture'),
      mastery: 40,
    };
    const mistake = { ...evidence, id: 'mistake-1', outcome: 'incorrect' as const, score: 0 };
    const result = applyCheckersLearningEvidence(previous, mistake);

    expect(result.ok && result.value.mastery).toBe(32);
    expect(result.ok && result.value.nextReviewAt).toBe('2026-08-12T10:00:00.000Z');
    if (!result.ok) return;
    expect(applyCheckersLearningEvidence(result.value, mistake)).toEqual({
      ok: false,
      message: 'learning evidence has already been applied',
    });
    expect(
      applyCheckersLearningEvidence(result.value, { ...evidence, studentId: 'student-2' }),
    ).toEqual({
      ok: false,
      message: 'learning evidence does not belong to this concept progress',
    });
  });
});

describe('teacher assignments and Student Checkers Home', () => {
  it('validates completion, hint and targeting controls', () => {
    expect(validateCheckersAssignment(assignment)).toEqual({ ok: true, value: assignment });
    expect(
      validateCheckersAssignment({ ...assignment, hintsAllowed: false, maxHintLevel: 2 }),
    ).toEqual({
      ok: false,
      message: 'assignment without hints must set maxHintLevel to 0',
    });
    expect(validateCheckersAssignment({ ...assignment, assigneeIds: [] })).toEqual({
      ok: false,
      message: 'assignment must have unique assignees',
    });
  });

  it('prioritises overdue teacher work and restores the latest activity', () => {
    const studentAssignment: CheckersStudentAssignment = {
      assignment,
      state: 'in-progress',
      completedCount: 0,
      bestScore: 60,
    };
    const home = buildCheckersStudentHome(
      {
        studentId: 'student-1',
        assignments: [studentAssignment],
        progress: [],
        resumeItems: [
          {
            id: 'lesson-old',
            kind: 'lesson',
            title: 'Старое занятие',
            route: '/checkers/learn/old',
            updatedAt: '2026-08-09T10:00:00.000Z',
          },
          {
            id: 'game-new',
            kind: 'game',
            title: 'Партия с Искрой',
            route: '/checkers/game/game-new',
            updatedAt: '2026-08-11T09:00:00.000Z',
          },
        ],
        botProgress: {
          currentBotId: 'iskra',
          unlockedRung: 1,
          winsOnCurrentRung: 0,
          winsNeededForNextRung: 2,
          conceptEvidenceMet: false,
        },
      },
      '2026-08-11T10:00:00.000Z',
    );

    expect(home.continueItem?.id).toBe('game-new');
    expect(home.recommendation).toEqual({
      kind: 'assignment',
      targetId: 'assignment-1',
      title: 'Обязательное взятие',
      reason: 'overdue-teacher-work',
    });
    expect(home.totalConcepts).toBe(18);
  });

  it('routes due review before self-learning and bot progression', () => {
    const review = {
      ...createEmptyConceptProgress('student-1', 'mandatory-capture'),
      mastery: 55,
      nextReviewAt: '2026-08-11T09:00:00.000Z',
    };
    const base = {
      studentId: 'student-1',
      assignments: [],
      resumeItems: [],
      botProgress: {
        currentBotId: 'sledopyt' as const,
        unlockedRung: 2,
        winsOnCurrentRung: 1,
        winsNeededForNextRung: 2,
        conceptEvidenceMet: true,
      },
    };

    expect(
      buildCheckersStudentHome({ ...base, progress: [review] }, '2026-08-11T10:00:00.000Z')
        .recommendation,
    ).toMatchObject({ kind: 'review', targetId: 'mandatory-capture' });

    const mastered = CHECKERS_CONCEPT_IDS.map((conceptId) => ({
      ...createEmptyConceptProgress('student-1', conceptId),
      mastery: 100,
    }));
    expect(
      buildCheckersStudentHome({ ...base, progress: mastered }, '2026-08-11T10:00:00.000Z')
        .recommendation,
    ).toMatchObject({ kind: 'bot', targetId: 'sledopyt' });
  });
});
