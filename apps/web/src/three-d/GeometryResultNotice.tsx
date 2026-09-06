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
          <strong>Не удалось рассчитать объединение</strong>
          <span>Исходные детали остались в проекте. STL недоступен до успешного расчёта.</span>
          <ul>
            {failures.map((group) => (
              <li key={group.groupId}>
                {group.label}:{' '}
                {group.status === 'stale'
                  ? 'показана устаревшая модель, не результат последних изменений.'
                  : 'результат не показан.'}
              </li>
            ))}
          </ul>
          <button type="button" onClick={onRetry} disabled={pending}>
            Повторить расчёт
          </button>
        </>
      ) : pending ? (
        <span>
          Рассчитываем объединение… Показанные группы могут быть устаревшими. STL пока недоступен.
        </span>
      ) : (
        <span>
          Пустой результат: {emptyCount}. Операция не оставила объёма. Исходные детали остались в
          проекте; можно отменить действие.
        </span>
      )}
    </div>
  );
}
