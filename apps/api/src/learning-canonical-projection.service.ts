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

interface EvidenceRow {
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
  resultSelectionSource: 'gradebook_pointer' | 'none';
  selectedAttemptId: string | null;
  selectedResult: CanonicalAdapterInput['resultSelection']['selectedCompatibilityResult'];
  selectionConflict: CanonicalAdapterInput['resultSelection']['conflict'];
  validUnselectedResultCount: number;
  compatibilityGradingUnknown: boolean;
  reusableAuthoredContent: boolean;
}

export interface CanonicalLearningSurfaceState {
  workflowState: CanonicalLearningState['workflowState'];
  selectedResult: CanonicalLearningState['selectedResult'];
  flags: CanonicalLearningFlag[];
  learnerMessageCode: CanonicalLearningState['visibility']['learnerMessageCode'];
  compatibilityDiagnostic?: string;
}

export interface CanonicalLearningProjection {
  key: string;
  state: CanonicalLearningState;
  surface: CanonicalLearningSurfaceState;
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
      activityRunId: null,
    },
    identity: {
      learnerId: row.learnerId,
      seatId: row.seatId,
      accountId: row.accountId,
      principalId: row.principalId,
      resolution: row.identityResolution,
    },
    participation: null,
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
      selectedRevision: null,
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

  private async read(
    functionCall: string,
    parameters: string[],
    audience: ProjectionAudience,
    asOf: string,
  ): Promise<Map<string, CanonicalLearningProjection>> {
    if (!this.enabled()) return new Map();
    const result = await this.pool.query<{ evidence: EvidenceRow }>(
      `SELECT evidence FROM ${functionCall}`,
      parameters,
    );
    return new Map(
      result.rows.map(({ evidence }) => {
        const state = resolveEvidence(evidence, asOf);
        const key = canonicalProjectionKey(evidence.seatId, evidence.classroomAssignmentId);
        return [
          key,
          {
            key,
            state,
            surface: surfaceState(state, audience),
            compatibilityGradingUnknown: evidence.compatibilityGradingUnknown,
            reusableAuthoredContent: evidence.reusableAuthoredContent,
            projectId: evidence.legacyWork?.projectId ?? null,
          },
        ];
      }),
    );
  }
}
