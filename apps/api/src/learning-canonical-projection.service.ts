import type pg from 'pg';
import {
  adaptCourseProjectCanonicalInput,
  adaptDirectProjectCanonicalInput,
  adaptQuizCanonicalInput,
  resolveCanonicalLearningState,
  type CanonicalAdapterInput,
  type CanonicalLearningFlag,
  type CanonicalLearningState,
} from '@asa-lab/learning';

type ProjectionAudience = 'learner' | 'teacher';

export interface EvidenceRow {
  tenantId: string;
  schoolId: string;
  classroomId: string;
  classroomAssignmentId: string;
  kind: 'direct_project' | 'course_project' | 'quiz';
  dueAt: string | null;
  assignmentStatus: 'open' | 'closed';
  seatId: string;
  accountId: string | null;
  principalId: string | null;
  learnerId: string | null;
  identityResolution: 'learner_identity' | 'seat_compatibility';
  seatStatus: 'issued' | 'active' | 'suspended' | 'removed';
  classroomAccess: 'active' | 'ended';
  legacyWork: null | { projectId: string; startedAt: string; submittedAt: string | null };
  courseProgressPresent: boolean;
  attempt: CanonicalAdapterInput['attempts']['latest'];
  selectedAttemptExists: boolean;
  activityRunId?: string | null;
  participation?: CanonicalAdapterInput['participation'];
  selectedRevision?: CanonicalAdapterInput['resultSelection']['selectedRevision'];
  resultSelectionSource: 'canonical' | 'gradebook_pointer' | 'none';
  selectedAttemptId: string | null;
  selectedResult: CanonicalAdapterInput['resultSelection']['selectedCompatibilityResult'];
  selectionConflict: CanonicalAdapterInput['resultSelection']['conflict'];
  validUnselectedResultCount: number;
  compatibilityGradingUnknown: boolean;
  reusableAuthoredContent: boolean;
  projectId?: string | null;
}

export interface TeacherReviewQueueMetadata {
  seatId: string;
  displayLabel: string;
  assignmentId: string;
  activityRunId: string;
  activityVersionId: string;
  title: string;
  createdAt: string;
  originAvailable: boolean;
  originLabel: string;
}

export interface CanonicalLearningSurfaceState {
  activityRunId?: string | null;
  effectiveDueAt?: string | null;
  workflowState: CanonicalLearningState['workflowState'];
  selectedResult: CanonicalLearningState['selectedResult'];
  flags: CanonicalLearningFlag[];
  learnerMessageCode: CanonicalLearningState['visibility']['learnerMessageCode'];
  compatibilityDiagnostic?: string;
}

export interface CourseParticipationProof {
  classroomAssignmentId: string;
  applicable: boolean;
  excused: boolean;
}

export interface CanonicalCourseLearnerSnapshot {
  projections: Map<string, CanonicalLearningProjection>;
  participationByRun: Map<string, CourseParticipationProof>;
  /** Canonical results for individual runs, including siblings on a shared handout. */
  courseProjectionsByRun: Map<string, CanonicalLearningProjection | null>;
}

export function canonicalCourseParticipationKey(seatId: string, activityRunId: string): string {
  return `${seatId}:${activityRunId}`;
}

export interface CanonicalLearningProjection {
  key: string;
  state: CanonicalLearningState;
  surface: CanonicalLearningSurfaceState;
  /** Assigned/excused facts come from the exact participation, not a Project/Attempt. */
  participationApplicability: { applicable: boolean; excused: boolean } | null;
  compatibilityGradingUnknown: boolean;
  reusableAuthoredContent: boolean;
  projectId: string | null;
}

const LEARNER_SAFE_FLAGS = new Set<CanonicalLearningFlag>([
  'late',
  'excused',
  'revision_in_progress',
  'withdrawn',
  'after_due',
  'visibility_restricted',
]);

export function canonicalProjectionKey(seatId: string, assignmentId: string): string {
  return `${seatId}:${assignmentId}`;
}

export function canonicalReadsEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment['LEARNING_CANONICAL_READS'] !== 'legacy';
}

function adapterInput(row: EvidenceRow, asOf: string): CanonicalAdapterInput {
  return {
    scope: {
      tenantId: row.tenantId,
      schoolId: row.schoolId,
      classroomId: row.classroomId,
      classroomAssignmentId: row.classroomAssignmentId,
      activityRunId: row.activityRunId ?? null,
    },
    identity: {
      learnerId: row.learnerId,
      seatId: row.seatId,
      accountId: row.accountId,
      principalId: row.principalId,
      resolution: row.identityResolution,
    },
    participation: row.participation ?? null,
    compatibilityAssignment: {
      applicableToSeat: true,
      legacyWork: row.legacyWork,
      courseProgressPresent: row.courseProgressPresent,
    },
    attempts: {
      latest: row.attempt,
      selectedAttemptExists: row.selectedAttemptExists,
    },
    resultSelection: {
      source: row.resultSelectionSource,
      selectedAttemptId: row.selectedAttemptId,
      selectedRevision: row.selectedRevision ?? null,
      selectedCompatibilityResult: row.selectedResult,
      validUnselectedResultCount: row.validUnselectedResultCount,
      conflict: row.selectionConflict,
    },
    lifecycle: {
      seatStatus: row.seatStatus,
      classroomAccess: row.classroomAccess,
    },
    timing: { asOf, effectiveDueAt: row.dueAt },
  };
}

function resolveEvidence(row: EvidenceRow, asOf: string): CanonicalLearningState {
  const input = adapterInput(row, asOf);
  if (row.kind === 'quiz') return resolveCanonicalLearningState(adaptQuizCanonicalInput(input));
  if (row.kind === 'course_project') {
    return resolveCanonicalLearningState(adaptCourseProjectCanonicalInput(input));
  }
  return resolveCanonicalLearningState(adaptDirectProjectCanonicalInput(input));
}

function surfaceState(
  state: CanonicalLearningState,
  audience: ProjectionAudience,
): CanonicalLearningSurfaceState {
  const flags =
    audience === 'teacher'
      ? state.flags
      : state.flags.filter((flag) => LEARNER_SAFE_FLAGS.has(flag));
  return {
    workflowState: state.workflowState,
    selectedResult: state.selectedResult,
    flags,
    learnerMessageCode: state.visibility.learnerMessageCode,
    ...(audience === 'teacher' && state.flags.includes('legacy_unresolved')
      ? {
          compatibilityDiagnostic: 'Историческая сдача: точное immutable evidence не восстановлено',
        }
      : {}),
  };
}

/** Resolve one exact origin without the handout-keyed list projection. */
export function canonicalProjectionFromEvidence(
  evidence: EvidenceRow,
  key: string,
  asOf: string,
  audience: ProjectionAudience = 'learner',
): CanonicalLearningProjection {
  const state = resolveEvidence(evidence, asOf);
  return {
    key,
    state,
    participationApplicability: evidence.participation
      ? {
          applicable: evidence.participation.applicable === true,
          excused: evidence.participation.excused === true,
        }
      : null,
    surface: {
      ...surfaceState(state, audience),
      effectiveDueAt: evidence.dueAt,
      activityRunId: evidence.activityRunId ?? null,
    },
    compatibilityGradingUnknown: evidence.compatibilityGradingUnknown,
    reusableAuthoredContent: evidence.reusableAuthoredContent,
    projectId: evidence.projectId ?? evidence.legacyWork?.projectId ?? null,
  };
}

export class LearningCanonicalProjectionService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  enabled(): boolean {
    return canonicalReadsEnabled(this.environment);
  }

  async forTeacher(
    accountId: string,
    classroomId: string,
    asOf = new Date().toISOString(),
  ): Promise<Map<string, CanonicalLearningProjection>> {
    return this.read(
      'learning_canonical_evidence_for_teacher($1, $2)',
      [accountId, classroomId],
      'teacher',
      asOf,
    );
  }

  /** One authorized batched reader; every workflow and selected result stays run-scoped. */
  async forTeacherReviewQueue(accountId: string, classroomId: string, assignmentId: string) {
    const rows = await this.pool.query<{
      detail: TeacherReviewQueueMetadata;
      evidence: EvidenceRow;
    }>('SELECT detail,evidence FROM learning_teacher_review_queue($1,$2,$3)', [
      accountId,
      classroomId,
      assignmentId,
    ]);
    const projections = new Map<string, CanonicalLearningProjection | null>();
    const asOf = new Date().toISOString();
    if (this.enabled())
      for (const row of rows.rows) {
        const key = canonicalCourseParticipationKey(row.detail.seatId, row.detail.activityRunId);
        const evidence = row.evidence;
        const matches =
          evidence.activityRunId === row.detail.activityRunId &&
          evidence.seatId === row.detail.seatId &&
          evidence.classroomId === classroomId &&
          evidence.classroomAssignmentId === assignmentId &&
          !!evidence.participation;
        projections.set(
          key,
          projections.has(key) || !matches
            ? null
            : canonicalProjectionFromEvidence(evidence, key, asOf, 'teacher'),
        );
      }
    return { rows: rows.rows.map((row) => row.detail), projections };
  }

  async forTeacherAccount(
    accountId: string,
    asOf = new Date().toISOString(),
  ): Promise<Map<string, CanonicalLearningProjection>> {
    return this.read(
      'learning_canonical_evidence_for_teacher_account($1)',
      [accountId],
      'teacher',
      asOf,
    );
  }

  async forSeat(
    seatId: string,
    asOf = new Date().toISOString(),
  ): Promise<Map<string, CanonicalLearningProjection>> {
    return this.read('learning_canonical_evidence_for_seat($1)', [seatId], 'learner', asOf);
  }

  async forAccount(
    accountId: string,
    asOf = new Date().toISOString(),
  ): Promise<Map<string, CanonicalLearningProjection>> {
    return this.read('learning_canonical_evidence_for_account($1)', [accountId], 'learner', asOf);
  }

  /** One canonical read supplies both the legacy handout view and exact Course Run applicability. */
  async forSeatCourseRuns(
    seatId: string,
    asOf = new Date().toISOString(),
  ): Promise<CanonicalCourseLearnerSnapshot> {
    return this.readSnapshot('learning_canonical_evidence_for_seat($1)', [seatId], 'learner', asOf);
  }

  async forAccountCourseRuns(
    accountId: string,
    asOf = new Date().toISOString(),
  ): Promise<CanonicalCourseLearnerSnapshot> {
    return this.readSnapshot(
      'learning_canonical_evidence_for_account($1)',
      [accountId],
      'learner',
      asOf,
    );
  }

  private async read(
    functionCall: string,
    parameters: string[],
    audience: ProjectionAudience,
    asOf: string,
  ): Promise<Map<string, CanonicalLearningProjection>> {
    return (await this.readSnapshot(functionCall, parameters, audience, asOf)).projections;
  }

  private async readSnapshot(
    functionCall: string,
    parameters: string[],
    audience: ProjectionAudience,
    asOf: string,
  ): Promise<CanonicalCourseLearnerSnapshot> {
    const projections = new Map<string, CanonicalLearningProjection>();
    const participationByRun = new Map<string, CourseParticipationProof>();
    const courseProjectionsByRun = new Map<string, CanonicalLearningProjection | null>();
    if (!this.enabled()) return { projections, participationByRun, courseProjectionsByRun };
    const result = await this.pool.query<{ evidence: EvidenceRow }>(
      `SELECT evidence FROM ${functionCall}`,
      parameters,
    );
    for (const { evidence } of result.rows) {
      const key = canonicalProjectionKey(evidence.seatId, evidence.classroomAssignmentId);
      projections.set(key, canonicalProjectionFromEvidence(evidence, key, asOf, audience));
      // Handout-keyed canonical state may collapse sibling Activity Runs.
      // Preserve every learner/Run participation independently of work origin.
      if (evidence.kind === 'course_project' && evidence.activityRunId && evidence.participation) {
        const runKey = canonicalCourseParticipationKey(evidence.seatId, evidence.activityRunId);
        if (courseProjectionsByRun.has(runKey)) {
          // Multiple evidence rows for the same learner/run are ambiguous.
          // Never choose one accepted result or exemption arbitrarily.
          courseProjectionsByRun.set(runKey, null);
          participationByRun.delete(runKey);
        } else {
          courseProjectionsByRun.set(
            runKey,
            canonicalProjectionFromEvidence(evidence, runKey, asOf, audience),
          );
          const active =
            evidence.participation.status === 'assigned' ||
            evidence.participation.status === 'active';
          participationByRun.set(runKey, {
            classroomAssignmentId: evidence.classroomAssignmentId,
            applicable: active && evidence.participation.applicable === true,
            excused:
              active &&
              evidence.participation.applicable === true &&
              evidence.participation.excused === true,
          });
        }
      }
    }
    return { projections, participationByRun, courseProjectionsByRun };
  }
}
