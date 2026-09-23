import { describe, expect, it } from 'vitest';
import type { CanonicalLearningSurfaceState } from '../../apps/web/src/api';
import {
  assignmentBriefResultText,
  assignmentBriefSelectedResult,
  assignmentBriefSubmitLabel,
  assignmentBriefWorkflowLabel,
} from '../../apps/web/src/components/assignment-brief-presentation';

function state(
  workflowState: CanonicalLearningSurfaceState['workflowState'],
  selectedResult: CanonicalLearningSurfaceState['selectedResult'] = null,
): CanonicalLearningSurfaceState {
  return {
    workflowState,
    selectedResult,
    flags: [],
    learnerMessageCode: null,
  };
}

const gradedResult: NonNullable<CanonicalLearningSurfaceState['selectedResult']> = {
  attemptId: 'attempt-1',
  resultRevisionId: 'result-1',
  compatibilityAssessmentResultId: null,
  rawPoints: 8,
  maxPoints: 10,
  percentageBasisPoints: 8000,
  displayGrade: null,
  completionValue: null,
  outcome: 'passed',
  publishedAt: '2026-09-23T12:00:00.000Z',
};

const completionResult: NonNullable<CanonicalLearningSurfaceState['selectedResult']> = {
  ...gradedResult,
  rawPoints: null,
  maxPoints: null,
  percentageBasisPoints: null,
  completionValue: true,
};

describe('UX0 learner task presentation', () => {
  it('uses short workflow labels without unpublished-result copy', () => {
    expect(assignmentBriefWorkflowLabel(state('in_progress'), null)).toBe('В работе');
    expect(assignmentBriefWorkflowLabel(state('submitted'), '2026-09-23T12:00:00.000Z')).toBe(
      'На проверке',
    );
    expect(assignmentBriefWorkflowLabel(state('waiting_review'), null)).toBe('На проверке');
    expect(assignmentBriefWorkflowLabel(state('changes_requested'), null)).toBe('Нужна доработка');
    expect(assignmentBriefWorkflowLabel(state('completed'), null)).toBe('Выполнено');
    expect(assignmentBriefWorkflowLabel(state('submitted'), null)).not.toContain(
      'результат ещё не опубликован',
    );
  });

  it('renders released graded and completion values only from canonical selectedResult', () => {
    const graded = state('completed', gradedResult);
    expect(assignmentBriefSelectedResult(graded)).toBe(gradedResult);
    expect(assignmentBriefResultText(graded, 'anchor')).toBe('8/10');
    expect(assignmentBriefResultText(graded, 'panel')).toBe('8/10');

    const completion = state('completed', completionResult);
    expect(assignmentBriefResultText(completion, 'anchor')).toBe('✓');
    expect(assignmentBriefResultText(completion, 'panel')).toBe('✓ Принято');
  });

  it('does not invent a released result when selectedResult is absent or non-displayable', () => {
    expect(assignmentBriefSelectedResult(state('completed'))).toBeNull();
    expect(assignmentBriefResultText(state('completed'), 'anchor')).toBeNull();
    expect(
      assignmentBriefResultText(
        state('completed', {
          ...gradedResult,
          rawPoints: null,
          maxPoints: null,
          displayGrade: null,
          completionValue: null,
        }),
        'panel',
      ),
    ).toBeNull();
  });

  it('uses the resubmission label after a confirmed resume or a canonical revision flag', () => {
    expect(assignmentBriefSubmitLabel(state('in_progress'))).toBe('Отправить на проверку');
    expect(assignmentBriefSubmitLabel(state('in_progress'), true)).toBe('Отправить повторно');
    expect(
      assignmentBriefSubmitLabel({
        ...state('in_progress'),
        flags: ['revision_in_progress'],
      }),
    ).toBe('Отправить повторно');
  });
});
