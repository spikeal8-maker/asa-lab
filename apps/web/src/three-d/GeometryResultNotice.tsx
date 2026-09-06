import type { GeometryResultState } from './geometry/result-state';

export function GeometryResultNotice({
  state,
  onRetry,
}: {
  readonly state: GeometryResultState | null;
  readonly onRetry: () => void;
}): JSX.Element | null {
  if (!state) return null;
  const failures = state.groups.filter(
    (group) => group.status === 'stale' || group.status === 'error',
  );
  const pending = state.groups.some((group) => group.status === 'pending');
  const emptyCount = state.groups.filter((group) => group.status === 'valid-empty').length;
  if (failures.length === 0 && !pending && emptyCount === 0) return null;
  return (
    <div
      className="asa3d-geometry-notice"
      data-testid="asa3d-geometry-notice"
      role={failures.length > 0 ? 'alert' : 'status'}
      aria-live={failures.length > 0 ? 'assertive' : 'polite'}
    >
      {failures.length > 0 ? (
        <>
          <span>
            {failures.some((group) => group.status === 'stale')
              ? 'Не получилось объединить. Показана прежняя форма.'
              : 'Не получилось объединить. Исходные детали не потеряны.'}
          </span>
          <button type="button" onClick={onRetry} disabled={pending}>
            Повторить
          </button>
        </>
      ) : pending ? (
        <span>Объединяем…</span>
      ) : (
        <span>Вырезано всё. Можно отменить действие.</span>
      )}
    </div>
  );
}
