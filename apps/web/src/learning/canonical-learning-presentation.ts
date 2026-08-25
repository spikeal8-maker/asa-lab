import type { CanonicalLearningSurfaceState, CanonicalLearningWorkflowState } from '../api';

const LABELS: Record<CanonicalLearningWorkflowState, string> = {
  not_applicable: 'Не назначено',
  not_started: 'Не начато',
  in_progress: 'В работе',
  submitted: 'Сдано · результат ещё не опубликован',
  waiting_review: 'Ждёт проверки',
  changes_requested: 'Нужна доработка',
  completed: 'Выполнено',
  invalidated: 'Попытка отменена',
};

export function canonicalLearningLabel(state: CanonicalLearningSurfaceState | null): string | null {
  return state ? LABELS[state.workflowState] : null;
}

export function canonicalLearningClass(state: CanonicalLearningSurfaceState | null): string {
  if (!state) return '';
  if (['submitted', 'waiting_review', 'completed'].includes(state.workflowState)) return ' is-done';
  if (['in_progress', 'changes_requested'].includes(state.workflowState)) return ' is-working';
  return '';
}

export function canonicalSubmissionLocked(state: CanonicalLearningSurfaceState | null): boolean {
  return state
    ? ['submitted', 'waiting_review', 'completed', 'invalidated'].includes(state.workflowState)
    : false;
}
