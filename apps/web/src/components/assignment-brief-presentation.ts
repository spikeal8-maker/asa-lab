import type {
  CanonicalLearningSelectedResult,
  CanonicalLearningSurfaceState,
  CanonicalLearningWorkflowState,
} from '../api';

const WORKFLOW_LABELS: Record<CanonicalLearningWorkflowState, string> = {
  not_applicable: 'Не назначено',
  not_started: 'Не начато',
  in_progress: 'В работе',
  submitted: 'На проверке',
  waiting_review: 'На проверке',
  changes_requested: 'Нужна доработка',
  completed: 'Выполнено',
  invalidated: 'Попытка отменена',
};

export function assignmentBriefWorkflowLabel(
  state: CanonicalLearningSurfaceState | null,
  submittedAt: string | null,
): string {
  if (state) return WORKFLOW_LABELS[state.workflowState];
  return submittedAt ? 'На проверке' : 'В работе';
}

export function assignmentBriefSelectedResult(
  state: CanonicalLearningSurfaceState | null,
): CanonicalLearningSelectedResult | null {
  return state?.selectedResult ?? null;
}

export function assignmentBriefResultText(
  state: CanonicalLearningSurfaceState | null,
  variant: 'anchor' | 'panel',
): string | null {
  const result = assignmentBriefSelectedResult(state);
  if (!result) return null;
  if (result.rawPoints !== null && result.maxPoints !== null) {
    return result.rawPoints + '/' + result.maxPoints;
  }
  const displayGrade = result.displayGrade?.trim();
  if (displayGrade) return displayGrade;
  if (result.completionValue === true) return variant === 'anchor' ? '✓' : '✓ Принято';
  return null;
}

export function assignmentBriefSubmitLabel(
  state: CanonicalLearningSurfaceState | null,
  resumedAfterChangesRequested = false,
): string {
  return resumedAfterChangesRequested || state?.flags.includes('revision_in_progress')
    ? 'Отправить повторно'
    : 'Отправить на проверку';
}
