import { describe, expect, it } from 'vitest';
import {
  adaptCourseProjectCanonicalInput,
  adaptDirectProjectCanonicalInput,
  adaptQuizCanonicalInput,
  resolveCanonicalLearningState,
  type CanonicalAdapterInput,
} from '../../contexts/learning/domain/canonical-learning-state.js';

describe('LRN-M0-006 canonical adapter consistency', () => {
  it('gives direct project, course project and quiz the same semantic DTO', () => {
    const input: CanonicalAdapterInput = {
      scope: {
        tenantId: 'tenant',
        schoolId: 'school',
        classroomId: 'classroom',
        classroomAssignmentId: 'assignment',
        activityRunId: null,
      },
      identity: {
        learnerId: 'learner',
        seatId: 'seat',
        accountId: null,
        principalId: null,
        resolution: 'learner_identity',
      },
      participation: null,
      compatibilityAssignment: {
        applicableToSeat: true,
        legacyWork: null,
        courseProgressPresent: false,
      },
      attempts: {
        latest: {
          id: 'attempt',
          attemptNumber: 1,
          state: 'evaluating',
          startedAt: '2026-08-24T10:00:00.000Z',
          submittedAt: '2026-08-24T11:00:00.000Z',
          lateState: 'on_time',
        },
        selectedAttemptExists: false,
      },
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
    const semantic = [
      adaptDirectProjectCanonicalInput(input),
      adaptCourseProjectCanonicalInput(input),
      adaptQuizCanonicalInput(input),
    ].map((adapted) => {
      const result = resolveCanonicalLearningState(adapted);
      return {
        workflowState: result.workflowState,
        selectedResult: result.selectedResult,
        flags: result.flags,
      };
    });
    expect(semantic).toEqual([semantic[0], semantic[0], semantic[0]]);
    expect(semantic[0]).toEqual({
      workflowState: 'waiting_review',
      selectedResult: null,
      flags: [],
    });
  });
});
