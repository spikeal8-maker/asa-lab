export type CanonicalWorkflowState =
  | 'not_applicable'
  | 'not_started'
  | 'in_progress'
  | 'submitted'
  | 'waiting_review'
  | 'changes_requested'
  | 'completed'
  | 'invalidated';

export type CanonicalLearningFlag =
  | 'late'
  | 'excused'
  | 'revision_in_progress'
  | 'withdrawn'
  | 'after_due'
  | 'legacy_unresolved'
  | 'legacy_compatibility'
  | 'unselected_result'
  | 'visibility_restricted';

const FLAG_ORDER: readonly CanonicalLearningFlag[] = [
  'late',
  'excused',
  'revision_in_progress',
  'withdrawn',
  'after_due',
  'legacy_unresolved',
  'legacy_compatibility',
  'unselected_result',
  'visibility_restricted',
];

export interface AttemptSnapshot {
  id: string;
  attemptNumber: number;
  state:
    | 'in_progress'
    | 'submitted'
    | 'evaluating'
    | 'accepted'
    | 'changes_requested'
    | 'incomplete'
    | 'excused'
    | 'invalidated';
  startedAt: string;
  submittedAt: string | null;
  lateState: 'on_time' | 'late' | 'excused' | null;
}

export interface AssessmentResultSnapshot {
  id: string;
  attemptId: string;
  rawPoints: number | null;
  maxPoints: number | null;
  percentageBasisPoints: number | null;
  displayGrade: string | null;
  outcome: 'passed' | 'failed' | 'incomplete' | 'excused' | null;
  publishedAt: string;
}

export interface ResultRevisionSnapshot extends Omit<AssessmentResultSnapshot, 'id'> {
  id: string;
  completionValue: boolean | null;
}

export interface CanonicalSelectedResult {
  attemptId: string;
  resultRevisionId: string | null;
  compatibilityAssessmentResultId: string | null;
  rawPoints: number | null;
  maxPoints: number | null;
  percentageBasisPoints: number | null;
  displayGrade: string | null;
  completionValue: boolean | null;
  outcome: 'passed' | 'failed' | 'incomplete' | 'excused' | null;
  publishedAt: string;
}

export interface CanonicalLearningStateInput {
  scope: {
    tenantId: string;
    schoolId: string;
    classroomId: string;
    kind: 'direct_project' | 'course_project' | 'quiz';
    classroomAssignmentId: string | null;
    activityRunId: string | null;
  };
  identity: {
    learnerId: string | null;
    seatId: string | null;
    accountId: string | null;
    principalId: string | null;
    resolution: 'learner_identity' | 'seat_compatibility' | 'unresolved';
  };
  participation: null | {
    applicable: boolean;
    status: 'assigned' | 'active' | 'withdrawn';
    excused: boolean;
  };
  compatibilityAssignment: {
    applicableToSeat: boolean;
    legacyWork: null | {
      projectId: string;
      startedAt: string;
      submittedAt: string | null;
    };
    courseProgressPresent: boolean;
  };
  attempts: {
    latest: AttemptSnapshot | null;
    selectedAttemptExists: boolean;
  };
  resultSelection: {
    source: 'canonical' | 'gradebook_pointer' | 'none';
    selectedAttemptId: string | null;
    selectedRevision: ResultRevisionSnapshot | null;
    selectedCompatibilityResult: AssessmentResultSnapshot | null;
    validUnselectedResultCount: number;
    conflict:
      | null
      | 'pointer_scope_mismatch'
      | 'attempt_result_mismatch'
      | 'selected_attempt_missing'
      | 'selected_result_missing';
  };
  lifecycle: {
    seatStatus: 'issued' | 'active' | 'suspended' | 'removed' | 'absent';
    classroomAccess: 'active' | 'ended' | 'unknown';
  };
  timing: {
    asOf: string;
    effectiveDueAt: string | null;
  };
}

export type CanonicalAdapterInput = Omit<CanonicalLearningStateInput, 'scope'> & {
  scope: Omit<CanonicalLearningStateInput['scope'], 'kind'>;
};

export interface CanonicalLearningState {
  workflowState: CanonicalWorkflowState;
  selectedResult: CanonicalSelectedResult | null;
  flags: CanonicalLearningFlag[];
  provenance: {
    identityAuthority: 'learner_identity' | 'student_seat_compatibility' | 'unresolved';
    workflowAuthority:
      | 'activity_participation'
      | 'latest_attempt'
      | 'legacy_classroom_work'
      | 'course_progress_compatibility'
      | 'assignment_absence';
    resultAuthority: 'canonical_result_selection' | 'gradebook_pointer_compatibility' | 'none';
    learnerId: string | null;
    seatId: string | null;
    activityRunId: string | null;
    classroomAssignmentId: string | null;
    workflowAttemptId: string | null;
    selectedAttemptId: string | null;
    sourcesRead: string[];
    conflicts: string[];
  };
  visibility: {
    historyExists: boolean;
    authorizedTeacherHistory: 'visible' | 'restricted';
    learnerCurrentAccess: 'visible' | 'restricted';
    learnerMessageCode: null | 'access_not_active' | 'access_suspended' | 'access_ended';
  };
}

export class CanonicalLearningContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CanonicalLearningContractError';
  }
}

function parseTimestamp(value: string, code: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new CanonicalLearningContractError(code);
  return result;
}

function mapAttemptState(state: AttemptSnapshot['state']): CanonicalWorkflowState {
  switch (state) {
    case 'in_progress':
      return 'in_progress';
    case 'submitted':
      return 'submitted';
    case 'evaluating':
      return 'waiting_review';
    case 'accepted':
    case 'incomplete':
    case 'excused':
      return 'completed';
    case 'changes_requested':
      return 'changes_requested';
    case 'invalidated':
      return 'invalidated';
  }
}

function adaptSelectedResult(input: CanonicalLearningStateInput): CanonicalSelectedResult | null {
  const selection = input.resultSelection;
  if (selection.conflict !== null || selection.source === 'none') return null;
  if (selection.selectedAttemptId === null || !input.attempts.selectedAttemptExists) return null;
  if (
    input.attempts.latest?.state === 'invalidated' &&
    input.attempts.latest.id === selection.selectedAttemptId
  ) {
    return null;
  }
  if (selection.source === 'canonical' && selection.selectedRevision !== null) {
    const result = selection.selectedRevision;
    if (result.attemptId !== selection.selectedAttemptId) return null;
    return {
      attemptId: result.attemptId,
      resultRevisionId: result.id,
      compatibilityAssessmentResultId: null,
      rawPoints: result.rawPoints,
      maxPoints: result.maxPoints,
      percentageBasisPoints: result.percentageBasisPoints,
      displayGrade: result.displayGrade,
      completionValue: result.completionValue,
      outcome: result.outcome,
      publishedAt: result.publishedAt,
    };
  }
  if (selection.source === 'gradebook_pointer' && selection.selectedCompatibilityResult !== null) {
    const result = selection.selectedCompatibilityResult;
    if (result.attemptId !== selection.selectedAttemptId) return null;
    return {
      attemptId: result.attemptId,
      resultRevisionId: null,
      compatibilityAssessmentResultId: result.id,
      rawPoints: result.rawPoints,
      maxPoints: result.maxPoints,
      percentageBasisPoints: result.percentageBasisPoints,
      displayGrade: result.displayGrade,
      completionValue: null,
      outcome: result.outcome,
      publishedAt: result.publishedAt,
    };
  }
  return null;
}

export function resolveCanonicalLearningState(
  input: CanonicalLearningStateInput,
): CanonicalLearningState {
  const asOf = parseTimestamp(input.timing.asOf, 'invalid_as_of');
  const dueAt =
    input.timing.effectiveDueAt === null
      ? null
      : parseTimestamp(input.timing.effectiveDueAt, 'invalid_due_at');
  if (input.lifecycle.classroomAccess === 'unknown') {
    throw new CanonicalLearningContractError('unknown_classroom_access');
  }
  if (input.identity.resolution === 'unresolved') {
    throw new CanonicalLearningContractError('unresolved_learner_identity');
  }
  if (input.identity.resolution === 'learner_identity' && input.identity.learnerId === null) {
    throw new CanonicalLearningContractError('missing_learner_identity');
  }
  if (input.resultSelection.validUnselectedResultCount < 0) {
    throw new CanonicalLearningContractError('invalid_unselected_result_count');
  }

  const latest = input.attempts.latest;
  const legacy = input.compatibilityAssignment.legacyWork;
  const applicable =
    input.participation?.applicable ?? input.compatibilityAssignment.applicableToSeat;
  let workflowState: CanonicalWorkflowState;
  let workflowAuthority: CanonicalLearningState['provenance']['workflowAuthority'];
  const flags = new Set<CanonicalLearningFlag>();
  const conflicts: string[] = [];

  if (latest !== null) {
    parseTimestamp(latest.startedAt, 'invalid_attempt_started_at');
    if (latest.submittedAt !== null)
      parseTimestamp(latest.submittedAt, 'invalid_attempt_submitted_at');
    workflowState = mapAttemptState(latest.state);
    workflowAuthority = 'latest_attempt';
    if (latest.lateState === 'late') flags.add('late');
    if (latest.lateState === 'excused' || latest.state === 'excused') flags.add('excused');
    if (legacy !== null && legacy.submittedAt !== latest.submittedAt) {
      flags.add('legacy_compatibility');
      conflicts.push('attempt_legacy_submission_mismatch');
    }
  } else if (legacy !== null && legacy.submittedAt !== null) {
    parseTimestamp(legacy.startedAt, 'invalid_legacy_started_at');
    parseTimestamp(legacy.submittedAt, 'invalid_legacy_submitted_at');
    workflowState = 'submitted';
    workflowAuthority = 'legacy_classroom_work';
    flags.add('legacy_unresolved');
    flags.add('legacy_compatibility');
  } else if (legacy !== null) {
    parseTimestamp(legacy.startedAt, 'invalid_legacy_started_at');
    workflowState = 'in_progress';
    workflowAuthority = 'legacy_classroom_work';
    flags.add('legacy_compatibility');
  } else if (!applicable) {
    workflowState = 'not_applicable';
    workflowAuthority = 'assignment_absence';
  } else {
    workflowState = 'not_started';
    workflowAuthority = input.participation
      ? 'activity_participation'
      : input.compatibilityAssignment.courseProgressPresent
        ? 'course_progress_compatibility'
        : 'assignment_absence';
  }

  const selectedResult = adaptSelectedResult(input);
  const selection = input.resultSelection;
  const selectionInvalid =
    selection.conflict !== null ||
    (selection.source !== 'none' && selectedResult === null) ||
    (selection.source === 'none' && selection.validUnselectedResultCount > 0);
  if (selectionInvalid) {
    flags.add('unselected_result');
    if (selection.conflict !== null) conflicts.push(selection.conflict);
  }
  if (
    latest?.state === 'in_progress' &&
    selectedResult !== null &&
    selectedResult.attemptId !== latest.id
  ) {
    flags.add('revision_in_progress');
  }
  if (input.participation?.excused === true) flags.add('excused');
  if (input.participation?.status === 'withdrawn') flags.add('withdrawn');
  if (dueAt !== null && asOf > dueAt) flags.add('after_due');

  let learnerCurrentAccess: 'visible' | 'restricted' = 'visible';
  let learnerMessageCode: CanonicalLearningState['visibility']['learnerMessageCode'] = null;
  if (input.lifecycle.classroomAccess === 'ended' || input.lifecycle.seatStatus === 'removed') {
    learnerCurrentAccess = 'restricted';
    learnerMessageCode = 'access_ended';
    flags.add('withdrawn');
    flags.add('visibility_restricted');
  } else if (input.lifecycle.seatStatus === 'suspended') {
    learnerCurrentAccess = 'restricted';
    learnerMessageCode = 'access_suspended';
    flags.add('visibility_restricted');
  } else if (input.lifecycle.seatStatus !== 'active') {
    learnerCurrentAccess = 'restricted';
    learnerMessageCode = 'access_not_active';
    flags.add('visibility_restricted');
  }

  const resultAuthority: CanonicalLearningState['provenance']['resultAuthority'] =
    selectedResult === null
      ? 'none'
      : selection.source === 'canonical'
        ? 'canonical_result_selection'
        : 'gradebook_pointer_compatibility';
  const sourcesRead = [
    'identity',
    input.participation ? 'activity_participation' : 'classroom_assignment',
    ...(latest ? ['learning_attempts'] : []),
    ...(legacy ? ['classroom_assignment_work'] : []),
    ...(selection.source === 'gradebook_pointer'
      ? ['gradebook_entries', 'assessment_results']
      : []),
  ];
  const historyExists = latest !== null || legacy !== null || selectedResult !== null;

  return {
    workflowState,
    selectedResult,
    flags: FLAG_ORDER.filter((flag) => flags.has(flag)),
    provenance: {
      identityAuthority:
        input.identity.resolution === 'learner_identity'
          ? 'learner_identity'
          : 'student_seat_compatibility',
      workflowAuthority,
      resultAuthority,
      learnerId: input.identity.learnerId,
      seatId: input.identity.seatId,
      activityRunId: input.scope.activityRunId,
      classroomAssignmentId: input.scope.classroomAssignmentId,
      workflowAttemptId: latest?.id ?? null,
      selectedAttemptId: selectedResult?.attemptId ?? null,
      sourcesRead,
      conflicts,
    },
    visibility: {
      historyExists,
      authorizedTeacherHistory: 'visible',
      learnerCurrentAccess,
      learnerMessageCode,
    },
  };
}

function adapt(
  input: CanonicalAdapterInput,
  kind: CanonicalLearningStateInput['scope']['kind'],
): CanonicalLearningStateInput {
  return { ...input, scope: { ...input.scope, kind } };
}

export function adaptDirectProjectCanonicalInput(
  input: CanonicalAdapterInput,
): CanonicalLearningStateInput {
  return adapt(input, 'direct_project');
}

export function adaptCourseProjectCanonicalInput(
  input: CanonicalAdapterInput,
): CanonicalLearningStateInput {
  return adapt(input, 'course_project');
}

export function adaptQuizCanonicalInput(input: CanonicalAdapterInput): CanonicalLearningStateInput {
  return adapt(input, 'quiz');
}
