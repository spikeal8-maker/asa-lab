import { CHECKERS_BOT_IDS, type CheckersBotId } from './bot.js';
import {
  createInitialCheckersDocument,
  validateCheckersDocument,
  type CheckersDocument,
  type CheckersDocumentResult,
} from './document.js';
import {
  CHECKERS_CONCEPT_IDS,
  createEmptyConceptProgress,
  validateCheckersAssignment,
  type CheckersAssignment,
  type CheckersConceptId,
  type CheckersConceptProgress,
  type CheckersLearningEvidence,
} from './learning.js';

export interface CheckersEducationState {
  readonly selectedBotId: CheckersBotId;
  readonly unlockedBotRung: number;
  readonly winsOnCurrentRung: number;
  readonly completedPuzzleIds: readonly string[];
  readonly progress: readonly CheckersConceptProgress[];
  readonly evidence: readonly CheckersLearningEvidence[];
  readonly assignments: readonly CheckersAssignment[];
  readonly reactionsEnabled: boolean;
  readonly lastActivityAt: string | null;
}

export interface CheckersProjectDocument {
  readonly schemaVersion: 1;
  readonly kind: 'asa-checkers-project';
  readonly game: CheckersDocument;
  readonly education: CheckersEducationState;
}

const PROJECT_KEYS = new Set(['schemaVersion', 'kind', 'game', 'education']);
const EDUCATION_KEYS = new Set([
  'selectedBotId',
  'unlockedBotRung',
  'winsOnCurrentRung',
  'completedPuzzleIds',
  'progress',
  'evidence',
  'assignments',
  'reactionsEnabled',
  'lastActivityAt',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function validIsoOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function validStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 128) &&
    new Set(value).size === value.length
  );
}

function validateProgress(
  value: unknown,
): CheckersDocumentResult<readonly CheckersConceptProgress[]> {
  if (!Array.isArray(value)) return { ok: false, message: 'education.progress must be an array' };
  const progress: CheckersConceptProgress[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      return { ok: false, message: `education.progress[${index}] has an invalid shape` };
    }
    const conceptId = item['conceptId'];
    if (
      typeof conceptId !== 'string' ||
      !CHECKERS_CONCEPT_IDS.includes(conceptId as CheckersConceptId)
    ) {
      return { ok: false, message: `education.progress[${index}].conceptId is invalid` };
    }
    const studentId = item['studentId'];
    const mastery = item['mastery'];
    const attempts = item['attempts'];
    const successfulAttempts = item['successfulAttempts'];
    const evidenceIds = item['evidenceIds'];
    const lastPracticedAt = item['lastPracticedAt'];
    const nextReviewAt = item['nextReviewAt'];
    if (typeof studentId !== 'string' || studentId.length === 0) {
      return { ok: false, message: `education.progress[${index}].studentId is invalid` };
    }
    if (typeof mastery !== 'number' || !Number.isInteger(mastery) || mastery < 0 || mastery > 100) {
      return { ok: false, message: `education.progress[${index}].mastery is invalid` };
    }
    if (
      typeof attempts !== 'number' ||
      !Number.isInteger(attempts) ||
      attempts < 0 ||
      typeof successfulAttempts !== 'number' ||
      !Number.isInteger(successfulAttempts) ||
      successfulAttempts < 0 ||
      successfulAttempts > attempts
    ) {
      return { ok: false, message: `education.progress[${index}] attempts are invalid` };
    }
    if (
      !validStringList(evidenceIds) ||
      !validIsoOrNull(lastPracticedAt) ||
      !validIsoOrNull(nextReviewAt)
    ) {
      return { ok: false, message: `education.progress[${index}] evidence dates are invalid` };
    }
    progress.push({
      studentId,
      conceptId: conceptId as CheckersConceptId,
      mastery,
      attempts,
      successfulAttempts,
      evidenceIds,
      lastPracticedAt,
      nextReviewAt,
    });
  }
  if (new Set(progress.map((item) => item.conceptId)).size !== progress.length) {
    return { ok: false, message: 'education.progress concept ids must be unique' };
  }
  return { ok: true, value: progress };
}

function validateEvidence(
  value: unknown,
): CheckersDocumentResult<readonly CheckersLearningEvidence[]> {
  if (!Array.isArray(value)) return { ok: false, message: 'education.evidence must be an array' };
  const evidence = value as CheckersLearningEvidence[];
  for (const [index, item] of evidence.entries()) {
    if (
      !isRecord(item) ||
      typeof item['id'] !== 'string' ||
      typeof item['studentId'] !== 'string' ||
      typeof item['sourceId'] !== 'string' ||
      typeof item['occurredAt'] !== 'string' ||
      !Number.isFinite(Date.parse(item['occurredAt'])) ||
      !CHECKERS_CONCEPT_IDS.includes(item['conceptId'] as CheckersConceptId) ||
      !['lesson-check', 'puzzle-attempt', 'game-demonstration', 'teacher-review'].includes(
        String(item['kind']),
      ) ||
      !['correct', 'incorrect', 'demonstrated', 'needs-work'].includes(String(item['outcome'])) ||
      typeof item['firstAttempt'] !== 'boolean' ||
      typeof item['transferPosition'] !== 'boolean' ||
      typeof item['hintLevel'] !== 'number' ||
      !Number.isInteger(item['hintLevel']) ||
      item['hintLevel'] < 0 ||
      item['hintLevel'] > 5 ||
      typeof item['score'] !== 'number' ||
      !Number.isInteger(item['score']) ||
      item['score'] < 0 ||
      item['score'] > 100
    ) {
      return { ok: false, message: `education.evidence[${index}] is invalid` };
    }
  }
  if (new Set(evidence.map((item) => item.id)).size !== evidence.length) {
    return { ok: false, message: 'education.evidence ids must be unique' };
  }
  return { ok: true, value: evidence };
}

function validateAssignments(
  value: unknown,
): CheckersDocumentResult<readonly CheckersAssignment[]> {
  if (!Array.isArray(value))
    return { ok: false, message: 'education.assignments must be an array' };
  const assignments: CheckersAssignment[] = [];
  for (const [index, item] of value.entries()) {
    const validated = validateCheckersAssignment(item as CheckersAssignment);
    if (!validated.ok) {
      return { ok: false, message: `education.assignments[${index}]: ${validated.message}` };
    }
    assignments.push(validated.value);
  }
  if (new Set(assignments.map((item) => item.id)).size !== assignments.length) {
    return { ok: false, message: 'education.assignment ids must be unique' };
  }
  return { ok: true, value: assignments };
}

export function createInitialCheckersProjectDocument(
  studentId = 'project-owner',
): CheckersProjectDocument {
  return {
    schemaVersion: 1,
    kind: 'asa-checkers-project',
    game: createInitialCheckersDocument(),
    education: {
      selectedBotId: 'iskra',
      unlockedBotRung: 1,
      winsOnCurrentRung: 0,
      completedPuzzleIds: [],
      progress: CHECKERS_CONCEPT_IDS.map((conceptId) =>
        createEmptyConceptProgress(studentId, conceptId),
      ),
      evidence: [],
      assignments: [],
      reactionsEnabled: true,
      lastActivityAt: null,
    },
  };
}

/** Accepts the original board-only draft and upgrades it in memory so projects
 * created by the first Checkers foundation remain openable. */
export function validateCheckersProjectDocument(
  value: unknown,
): CheckersDocumentResult<CheckersProjectDocument> {
  const legacy = validateCheckersDocument(value);
  if (legacy.ok) {
    return {
      ok: true,
      value: { ...createInitialCheckersProjectDocument(), game: legacy.value },
    };
  }
  if (!isRecord(value) || !hasExactKeys(value, PROJECT_KEYS)) {
    return { ok: false, message: 'checkers project document has an invalid shape' };
  }
  if (value['schemaVersion'] !== 1 || value['kind'] !== 'asa-checkers-project') {
    return { ok: false, message: 'checkers project identity is invalid' };
  }
  const game = validateCheckersDocument(value['game']);
  if (!game.ok) return game;
  const education = value['education'];
  if (!isRecord(education) || !hasExactKeys(education, EDUCATION_KEYS)) {
    return { ok: false, message: 'checkers education state has an invalid shape' };
  }
  const selectedBotId = education['selectedBotId'];
  const unlockedBotRung = education['unlockedBotRung'];
  const winsOnCurrentRung = education['winsOnCurrentRung'];
  if (
    typeof selectedBotId !== 'string' ||
    !CHECKERS_BOT_IDS.includes(selectedBotId as CheckersBotId) ||
    typeof unlockedBotRung !== 'number' ||
    !Number.isInteger(unlockedBotRung) ||
    unlockedBotRung < 1 ||
    unlockedBotRung > CHECKERS_BOT_IDS.length ||
    typeof winsOnCurrentRung !== 'number' ||
    !Number.isInteger(winsOnCurrentRung) ||
    winsOnCurrentRung < 0
  ) {
    return { ok: false, message: 'checkers bot progression is invalid' };
  }
  const completedPuzzleIds = education['completedPuzzleIds'];
  if (!validStringList(completedPuzzleIds)) {
    return { ok: false, message: 'education.completedPuzzleIds is invalid' };
  }
  const progress = validateProgress(education['progress']);
  if (!progress.ok) return progress;
  const evidence = validateEvidence(education['evidence']);
  if (!evidence.ok) return evidence;
  const assignments = validateAssignments(education['assignments']);
  if (!assignments.ok) return assignments;
  if (
    typeof education['reactionsEnabled'] !== 'boolean' ||
    !validIsoOrNull(education['lastActivityAt'])
  ) {
    return { ok: false, message: 'checkers activity settings are invalid' };
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      kind: 'asa-checkers-project',
      game: game.value,
      education: {
        selectedBotId: selectedBotId as CheckersBotId,
        unlockedBotRung,
        winsOnCurrentRung,
        completedPuzzleIds,
        progress: progress.value,
        evidence: evidence.value,
        assignments: assignments.value,
        reactionsEnabled: education['reactionsEnabled'],
        lastActivityAt: education['lastActivityAt'],
      },
    },
  };
}
