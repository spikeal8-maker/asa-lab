import { describe, expect, it } from 'vitest';
import {
  CanonicalLearningContractError,
  adaptCourseProjectCanonicalInput,
  adaptDirectProjectCanonicalInput,
  adaptQuizCanonicalInput,
  resolveCanonicalLearningState,
  type CanonicalAdapterInput,
  type CanonicalLearningStateInput,
} from '../domain/canonical-learning-state.js';

function baseInput(): CanonicalLearningStateInput {
  return {
    scope: {
      tenantId: 'tenant-1',
      schoolId: 'school-1',
      classroomId: 'classroom-1',
      kind: 'direct_project',
      classroomAssignmentId: 'assignment-1',
      activityRunId: null,
    },
    identity: {
      learnerId: 'learner-1',
      seatId: 'seat-1',
      accountId: null,
      principalId: 'principal-1',
      resolution: 'learner_identity',
    },
    participation: null,
    compatibilityAssignment: {
      applicableToSeat: true,
      legacyWork: null,
      courseProgressPresent: false,
    },
    attempts: { latest: null, selectedAttemptExists: false },
    resultSelection: {
      source: 'none',
      selectedAttemptId: null,
      selectedRevision: null,
      selectedCompatibilityResult: null,
      validUnselectedResultCount: 0,
      conflict: null,
    },
    lifecycle: { seatStatus: 'active', classroomAccess: 'active' },
    timing: { asOf: '2026-08-24T12:00:00.000Z', effectiveDueAt: null },
  };
}

describe('LRN-M0-006 canonical learning state', () => {
  it('does not create work semantics for an assigned unit with no evidence', () => {
    const result = resolveCanonicalLearningState(baseInput());
    expect(result.workflowState).toBe('not_started');
    expect(result.selectedResult).toBeNull();
    expect(result.flags).toEqual([]);
  });

  it('keeps a legacy-only submission truthful and unresolved', () => {
    const input = baseInput();
    input.compatibilityAssignment.legacyWork = {
      projectId: 'project-1',
      startedAt: '2026-08-24T10:00:00.000Z',
      submittedAt: '2026-08-24T11:00:00.000Z',
    };
    const result = resolveCanonicalLearningState(input);
    expect(result.workflowState).toBe('submitted');
    expect(result.selectedResult).toBeNull();
    expect(result.flags).toEqual(['legacy_unresolved', 'legacy_compatibility']);
  });

  it('maps changes_requested from Attempt even when legacy submitted_at is absent', () => {
    const input = baseInput();
    input.attempts.latest = {
      id: 'attempt-2',
      attemptNumber: 2,
      state: 'changes_requested',
      startedAt: '2026-08-24T10:00:00.000Z',
      submittedAt: '2026-08-24T11:00:00.000Z',
      lateState: 'on_time',
    };
    expect(resolveCanonicalLearningState(input).workflowState).toBe('changes_requested');
  });

  it('keeps an older selected result while a revision is in progress', () => {
    const input = baseInput();
    input.attempts = {
      latest: {
        id: 'attempt-2',
        attemptNumber: 2,
        state: 'in_progress',
        startedAt: '2026-08-24T11:30:00.000Z',
        submittedAt: null,
        lateState: null,
      },
      selectedAttemptExists: true,
    };
    input.resultSelection = {
      source: 'gradebook_pointer',
      selectedAttemptId: 'attempt-1',
      selectedRevision: null,
      selectedCompatibilityResult: {
        id: 'result-1',
        attemptId: 'attempt-1',
        rawPoints: 80,
        maxPoints: 100,
        percentageBasisPoints: 8000,
        displayGrade: '4',
        outcome: 'passed',
        publishedAt: '2026-08-24T11:00:00.000Z',
      },
      validUnselectedResultCount: 0,
      conflict: null,
    };
    const result = resolveCanonicalLearningState(input);
    expect(result.workflowState).toBe('in_progress');
    expect(result.selectedResult?.attemptId).toBe('attempt-1');
    expect(result.flags).toContain('revision_in_progress');
  });

  it('does not auto-select an unpointed result', () => {
    const input = baseInput();
    input.resultSelection.validUnselectedResultCount = 1;
    const result = resolveCanonicalLearningState(input);
    expect(result.selectedResult).toBeNull();
    expect(result.flags).toContain('unselected_result');
  });

  it('does not use an invalidated latest Attempt as its own selected result', () => {
    const input = baseInput();
    input.attempts = {
      latest: {
        id: 'attempt-1',
        attemptNumber: 1,
        state: 'invalidated',
        startedAt: '2026-08-24T10:00:00.000Z',
        submittedAt: '2026-08-24T11:00:00.000Z',
        lateState: 'on_time',
      },
      selectedAttemptExists: true,
    };
    input.resultSelection = {
      source: 'gradebook_pointer',
      selectedAttemptId: 'attempt-1',
      selectedRevision: null,
      selectedCompatibilityResult: {
        id: 'result-1',
        attemptId: 'attempt-1',
        rawPoints: 10,
        maxPoints: 10,
        percentageBasisPoints: 10000,
        displayGrade: '5',
        outcome: 'passed',
        publishedAt: '2026-08-24T11:00:00.000Z',
      },
      validUnselectedResultCount: 0,
      conflict: null,
    };
    const result = resolveCanonicalLearningState(input);
    expect(result.workflowState).toBe('invalidated');
    expect(result.selectedResult).toBeNull();
    expect(result.flags).toContain('unselected_result');
  });

  it.each([
    ['suspended', 'access_suspended'],
    ['removed', 'access_ended'],
  ] as const)('preserves history while %s access is restricted', (seatStatus, message) => {
    const input = baseInput();
    input.lifecycle.seatStatus = seatStatus;
    input.compatibilityAssignment.legacyWork = {
      projectId: 'project-1',
      startedAt: '2026-08-24T10:00:00.000Z',
      submittedAt: null,
    };
    const result = resolveCanonicalLearningState(input);
    expect(result.visibility.historyExists).toBe(true);
    expect(result.visibility.learnerCurrentAccess).toBe('restricted');
    expect(result.visibility.learnerMessageCode).toBe(message);
  });

  it('uses explicit asOf for after_due and stable flag ordering', () => {
    const input = baseInput();
    input.timing.effectiveDueAt = '2026-08-24T11:59:00.000Z';
    input.lifecycle.seatStatus = 'removed';
    const result = resolveCanonicalLearningState(input);
    expect(result.flags).toEqual(['withdrawn', 'after_due', 'visibility_restricted']);
  });

  it.each([
    ['invalid asOf', (input: CanonicalLearningStateInput) => (input.timing.asOf = 'never')],
    [
      'unknown access',
      (input: CanonicalLearningStateInput) => (input.lifecycle.classroomAccess = 'unknown'),
    ],
    [
      'unresolved identity',
      (input: CanonicalLearningStateInput) => (input.identity.resolution = 'unresolved'),
    ],
  ])('fails closed for %s', (_label, mutate) => {
    const input = baseInput();
    mutate(input);
    expect(() => resolveCanonicalLearningState(input)).toThrow(CanonicalLearningContractError);
  });

  it('keeps direct, course and quiz semantics equal through one resolver', () => {
    const { scope, ...rest } = baseInput();
    const adapterInput: CanonicalAdapterInput = {
      ...rest,
      scope: {
        tenantId: scope.tenantId,
        schoolId: scope.schoolId,
        classroomId: scope.classroomId,
        classroomAssignmentId: scope.classroomAssignmentId,
        activityRunId: scope.activityRunId,
      },
    };
    const outputs = [
      adaptDirectProjectCanonicalInput(adapterInput),
      adaptCourseProjectCanonicalInput(adapterInput),
      adaptQuizCanonicalInput(adapterInput),
    ].map(resolveCanonicalLearningState);
    expect(
      outputs.map(({ workflowState, selectedResult, flags }) => ({
        workflowState,
        selectedResult,
        flags,
      })),
    ).toEqual(
      [outputs[0], outputs[0], outputs[0]].map(({ workflowState, selectedResult, flags }) => ({
        workflowState,
        selectedResult,
        flags,
      })),
    );
  });
});
