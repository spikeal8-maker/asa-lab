import type { CheckersBotId } from './bot.js';
import type { CheckersDocumentResult } from './document.js';

export const CHECKERS_CONCEPT_IDS = [
  'board-and-coordinates',
  'man-movement',
  'mandatory-capture',
  'backward-capture',
  'multi-capture',
  'promotion',
  'flying-king',
  'safe-pieces-and-exchange',
  'tempo',
  'elementary-combinations',
  'opposition',
  'breakthrough',
  'promotion-races',
  'king-endgames',
  'draw-awareness',
  'opening-principles',
  'full-game-planning',
  'clocks-and-fair-play',
] as const;

export type CheckersConceptId = (typeof CHECKERS_CONCEPT_IDS)[number];

export interface CheckersCurriculumUnit {
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly conceptIds: readonly CheckersConceptId[];
  readonly prerequisiteUnitIds: readonly string[];
}

export const CHECKERS_CURRICULUM: readonly CheckersCurriculumUnit[] = [
  {
    id: 'unit-01-board',
    order: 1,
    title: 'Доска, координаты, цель и очередь хода',
    conceptIds: ['board-and-coordinates'],
    prerequisiteUnitIds: [],
  },
  {
    id: 'unit-02-man',
    order: 2,
    title: 'Ход простой шашки',
    conceptIds: ['man-movement'],
    prerequisiteUnitIds: ['unit-01-board'],
  },
  {
    id: 'unit-03-capture',
    order: 3,
    title: 'Обязательное взятие',
    conceptIds: ['mandatory-capture'],
    prerequisiteUnitIds: ['unit-02-man'],
  },
  {
    id: 'unit-04-series',
    order: 4,
    title: 'Взятие назад и серии',
    conceptIds: ['backward-capture', 'multi-capture'],
    prerequisiteUnitIds: ['unit-03-capture'],
  },
  {
    id: 'unit-05-king',
    order: 5,
    title: 'Превращение и летающая дамка',
    conceptIds: ['promotion', 'flying-king'],
    prerequisiteUnitIds: ['unit-04-series'],
  },
  {
    id: 'unit-06-position',
    order: 6,
    title: 'Безопасность, размен и темп',
    conceptIds: ['safe-pieces-and-exchange', 'tempo'],
    prerequisiteUnitIds: ['unit-05-king'],
  },
  {
    id: 'unit-07-combinations',
    order: 7,
    title: 'Первые комбинации',
    conceptIds: ['elementary-combinations'],
    prerequisiteUnitIds: ['unit-06-position'],
  },
  {
    id: 'unit-08-breakthrough',
    order: 8,
    title: 'Оппозиция, прорыв и гонки',
    conceptIds: ['opposition', 'breakthrough', 'promotion-races'],
    prerequisiteUnitIds: ['unit-07-combinations'],
  },
  {
    id: 'unit-09-endgames',
    order: 9,
    title: 'Дамочные окончания и ничья',
    conceptIds: ['king-endgames', 'draw-awareness'],
    prerequisiteUnitIds: ['unit-08-breakthrough'],
  },
  {
    id: 'unit-10-planning',
    order: 10,
    title: 'Дебют и план на партию',
    conceptIds: ['opening-principles', 'full-game-planning'],
    prerequisiteUnitIds: ['unit-09-endgames'],
  },
  {
    id: 'unit-11-fair-play',
    order: 11,
    title: 'Матч, часы и честная игра',
    conceptIds: ['clocks-and-fair-play'],
    prerequisiteUnitIds: ['unit-10-planning'],
  },
] as const;

export type CheckersEvidenceKind =
  'lesson-check' | 'puzzle-attempt' | 'game-demonstration' | 'teacher-review';
export type CheckersEvidenceOutcome = 'correct' | 'incorrect' | 'demonstrated' | 'needs-work';

export interface CheckersLearningEvidence {
  readonly id: string;
  readonly studentId: string;
  readonly conceptId: CheckersConceptId;
  readonly kind: CheckersEvidenceKind;
  readonly outcome: CheckersEvidenceOutcome;
  readonly sourceId: string;
  readonly occurredAt: string;
  readonly firstAttempt: boolean;
  readonly hintLevel: 0 | 1 | 2 | 3 | 4 | 5;
  readonly transferPosition: boolean;
  readonly score: number;
}

export interface CheckersConceptProgress {
  readonly studentId: string;
  readonly conceptId: CheckersConceptId;
  readonly mastery: number;
  readonly attempts: number;
  readonly successfulAttempts: number;
  readonly evidenceIds: readonly string[];
  readonly lastPracticedAt: string | null;
  readonly nextReviewAt: string | null;
}

export type CheckersAssignmentKind =
  'lesson' | 'position' | 'puzzle-set' | 'bot-milestone' | 'game';
export type CheckersAssignmentStatus = 'draft' | 'assigned' | 'closed';
export type CheckersAssigneeKind = 'class' | 'group' | 'student';

export interface CheckersAssignment {
  readonly id: string;
  readonly classroomId: string;
  readonly teacherId: string;
  readonly title: string;
  readonly kind: CheckersAssignmentKind;
  readonly targetRef: string;
  readonly assigneeKind: CheckersAssigneeKind;
  readonly assigneeIds: readonly string[];
  readonly dueAt: string | null;
  readonly attemptLimit: number | null;
  readonly hintsAllowed: boolean;
  readonly maxHintLevel: 0 | 1 | 2 | 3 | 4 | 5;
  readonly minimumScore: number;
  readonly requiredCompletions: number;
  readonly status: CheckersAssignmentStatus;
}

export interface CheckersStudentAssignment {
  readonly assignment: CheckersAssignment;
  readonly state: 'not-started' | 'in-progress' | 'completed' | 'returned';
  readonly completedCount: number;
  readonly bestScore: number | null;
}

export interface CheckersResumeItem {
  readonly id: string;
  readonly kind: 'lesson' | 'puzzle' | 'game' | 'review';
  readonly title: string;
  readonly route: string;
  readonly updatedAt: string;
}

export interface CheckersBotProgress {
  readonly currentBotId: CheckersBotId;
  readonly unlockedRung: number;
  readonly winsOnCurrentRung: number;
  readonly winsNeededForNextRung: number;
  readonly conceptEvidenceMet: boolean;
}

export interface CheckersStudentHomeInput {
  readonly studentId: string;
  readonly assignments: readonly CheckersStudentAssignment[];
  readonly progress: readonly CheckersConceptProgress[];
  readonly resumeItems: readonly CheckersResumeItem[];
  readonly botProgress: CheckersBotProgress;
}

export interface CheckersHomeRecommendation {
  readonly kind: 'assignment' | 'review' | 'learning' | 'bot';
  readonly targetId: string;
  readonly title: string;
  readonly reason:
    | 'overdue-teacher-work'
    | 'teacher-work-due-next'
    | 'spaced-review-due'
    | 'next-unlocked-concept'
    | 'bot-progression';
}

export interface CheckersStudentHome {
  readonly studentId: string;
  readonly continueItem: CheckersResumeItem | null;
  readonly assignments: readonly CheckersStudentAssignment[];
  readonly reviewQueue: readonly CheckersConceptProgress[];
  readonly recommendation: CheckersHomeRecommendation;
  readonly botProgress: CheckersBotProgress;
  readonly overallMastery: number;
  readonly masteredConcepts: number;
  readonly totalConcepts: number;
}

function validIso(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function evidenceDelta(evidence: CheckersLearningEvidence): number {
  if (evidence.outcome === 'incorrect') return -8;
  if (evidence.outcome === 'needs-work') return -5;

  const base: Record<CheckersEvidenceKind, number> = {
    'lesson-check': 10,
    'puzzle-attempt': 12,
    'game-demonstration': 14,
    'teacher-review': 18,
  };
  const firstAttempt = evidence.firstAttempt ? 4 : 0;
  const transfer = evidence.transferPosition ? 4 : 0;
  const hintPenalty = evidence.hintLevel * 2;
  const scoreAdjustment = Math.round((evidence.score - 70) / 10);
  return Math.max(2, base[evidence.kind] + firstAttempt + transfer - hintPenalty + scoreAdjustment);
}

function reviewIntervalDays(evidence: CheckersLearningEvidence, mastery: number): number {
  if (evidence.outcome === 'incorrect' || evidence.outcome === 'needs-work') return 1;
  if (evidence.hintLevel >= 4) return 1;
  if (evidence.hintLevel >= 2) return 3;
  if (mastery >= 85) return 30;
  if (mastery >= 70) return 14;
  return 7;
}

function plusDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function createEmptyConceptProgress(
  studentId: string,
  conceptId: CheckersConceptId,
): CheckersConceptProgress {
  return {
    studentId,
    conceptId,
    mastery: 0,
    attempts: 0,
    successfulAttempts: 0,
    evidenceIds: [],
    lastPracticedAt: null,
    nextReviewAt: null,
  };
}

export function applyCheckersLearningEvidence(
  progress: CheckersConceptProgress,
  evidence: CheckersLearningEvidence,
): CheckersDocumentResult<CheckersConceptProgress> {
  if (progress.studentId !== evidence.studentId || progress.conceptId !== evidence.conceptId) {
    return { ok: false, message: 'learning evidence does not belong to this concept progress' };
  }
  if (!validIso(evidence.occurredAt)) {
    return { ok: false, message: 'learning evidence occurredAt must be an ISO timestamp' };
  }
  if (evidence.score < 0 || evidence.score > 100 || !Number.isInteger(evidence.score)) {
    return { ok: false, message: 'learning evidence score must be an integer from 0 to 100' };
  }
  if (progress.evidenceIds.includes(evidence.id)) {
    return { ok: false, message: 'learning evidence has already been applied' };
  }

  const successful = evidence.outcome === 'correct' || evidence.outcome === 'demonstrated';
  const mastery = clamp(progress.mastery + evidenceDelta(evidence), 0, 100);
  return {
    ok: true,
    value: {
      ...progress,
      mastery,
      attempts: progress.attempts + 1,
      successfulAttempts: progress.successfulAttempts + Number(successful),
      evidenceIds: [...progress.evidenceIds, evidence.id],
      lastPracticedAt: evidence.occurredAt,
      nextReviewAt: plusDays(evidence.occurredAt, reviewIntervalDays(evidence, mastery)),
    },
  };
}

export function validateCheckersAssignment(
  assignment: CheckersAssignment,
): CheckersDocumentResult<CheckersAssignment> {
  if (!assignment.id || !assignment.classroomId || !assignment.teacherId || !assignment.targetRef) {
    return { ok: false, message: 'assignment identifiers must be non-empty' };
  }
  if (!assignment.title.trim() || assignment.title.length > 120) {
    return { ok: false, message: 'assignment title must contain 1 to 120 characters' };
  }
  if (
    assignment.assigneeIds.length === 0 ||
    new Set(assignment.assigneeIds).size !== assignment.assigneeIds.length
  ) {
    return { ok: false, message: 'assignment must have unique assignees' };
  }
  if (assignment.dueAt !== null && !validIso(assignment.dueAt)) {
    return { ok: false, message: 'assignment dueAt must be null or an ISO timestamp' };
  }
  if (
    assignment.attemptLimit !== null &&
    (!Number.isInteger(assignment.attemptLimit) || assignment.attemptLimit < 1)
  ) {
    return { ok: false, message: 'assignment attemptLimit must be null or a positive integer' };
  }
  if (!assignment.hintsAllowed && assignment.maxHintLevel !== 0) {
    return { ok: false, message: 'assignment without hints must set maxHintLevel to 0' };
  }
  if (assignment.minimumScore < 0 || assignment.minimumScore > 100) {
    return { ok: false, message: 'assignment minimumScore must be from 0 to 100' };
  }
  if (!Number.isInteger(assignment.requiredCompletions) || assignment.requiredCompletions < 1) {
    return { ok: false, message: 'assignment requiredCompletions must be a positive integer' };
  }
  return { ok: true, value: assignment };
}

function timestamp(value: string | null): number {
  return value === null ? Number.POSITIVE_INFINITY : Date.parse(value);
}

function assignmentSort(left: CheckersStudentAssignment, right: CheckersStudentAssignment): number {
  const leftDue = timestamp(left.assignment.dueAt);
  const rightDue = timestamp(right.assignment.dueAt);
  if (leftDue < rightDue) return -1;
  if (leftDue > rightDue) return 1;
  if (left.assignment.id < right.assignment.id) return -1;
  if (left.assignment.id > right.assignment.id) return 1;
  return 0;
}

function unitMastery(
  unit: CheckersCurriculumUnit,
  progress: ReadonlyMap<CheckersConceptId, CheckersConceptProgress>,
): number {
  if (unit.conceptIds.length === 0) return 0;
  return Math.round(
    unit.conceptIds.reduce((sum, conceptId) => sum + (progress.get(conceptId)?.mastery ?? 0), 0) /
      unit.conceptIds.length,
  );
}

function nextUnlockedUnit(
  progress: ReadonlyMap<CheckersConceptId, CheckersConceptProgress>,
): CheckersCurriculumUnit {
  const units = new Map(CHECKERS_CURRICULUM.map((unit) => [unit.id, unit] as const));
  return (
    CHECKERS_CURRICULUM.find((unit) => {
      if (unitMastery(unit, progress) >= 80) return false;
      return unit.prerequisiteUnitIds.every((id) => {
        const prerequisite = units.get(id);
        return prerequisite ? unitMastery(prerequisite, progress) >= 60 : false;
      });
    }) ?? CHECKERS_CURRICULUM[0]!
  );
}

export function buildCheckersStudentHome(
  input: CheckersStudentHomeInput,
  now = new Date().toISOString(),
): CheckersStudentHome {
  const nowTimestamp = Date.parse(now);
  if (!Number.isFinite(nowTimestamp)) throw new Error('student home now must be an ISO timestamp');

  const assignments = input.assignments
    .filter((item) => item.assignment.status === 'assigned' && item.state !== 'completed')
    .sort(assignmentSort);
  const overdue = assignments.find(
    (item) => item.assignment.dueAt !== null && Date.parse(item.assignment.dueAt) < nowTimestamp,
  );
  const reviewQueue = input.progress
    .filter((item) => item.nextReviewAt !== null && Date.parse(item.nextReviewAt) <= nowTimestamp)
    .sort(
      (left, right) =>
        timestamp(left.nextReviewAt) - timestamp(right.nextReviewAt) ||
        left.mastery - right.mastery,
    );
  const continueItem =
    [...input.resumeItems].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )[0] ?? null;
  const progress = new Map(input.progress.map((item) => [item.conceptId, item] as const));
  const nextUnit = nextUnlockedUnit(progress);

  let recommendation: CheckersHomeRecommendation;
  const nextAssignment = overdue ?? assignments[0];
  if (nextAssignment) {
    recommendation = {
      kind: 'assignment',
      targetId: nextAssignment.assignment.id,
      title: nextAssignment.assignment.title,
      reason: overdue ? 'overdue-teacher-work' : 'teacher-work-due-next',
    };
  } else if (reviewQueue[0]) {
    recommendation = {
      kind: 'review',
      targetId: reviewQueue[0].conceptId,
      title: 'Короткое повторение',
      reason: 'spaced-review-due',
    };
  } else if (unitMastery(nextUnit, progress) < 80) {
    recommendation = {
      kind: 'learning',
      targetId: nextUnit.id,
      title: nextUnit.title,
      reason: 'next-unlocked-concept',
    };
  } else {
    recommendation = {
      kind: 'bot',
      targetId: input.botProgress.currentBotId,
      title: 'Следующая игра с ботом',
      reason: 'bot-progression',
    };
  }

  const masterySum = CHECKERS_CONCEPT_IDS.reduce(
    (sum, conceptId) => sum + (progress.get(conceptId)?.mastery ?? 0),
    0,
  );
  return {
    studentId: input.studentId,
    continueItem,
    assignments,
    reviewQueue,
    recommendation,
    botProgress: input.botProgress,
    overallMastery: Math.round(masterySum / CHECKERS_CONCEPT_IDS.length),
    masteredConcepts: CHECKERS_CONCEPT_IDS.filter(
      (conceptId) => (progress.get(conceptId)?.mastery ?? 0) >= 80,
    ).length,
    totalConcepts: CHECKERS_CONCEPT_IDS.length,
  };
}
