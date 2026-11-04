import { useEffect, useRef, useState } from 'react';
import { call } from './admin-api';

interface Settings {
  likeCount: number;
  reactionsEnabled: boolean;
  reactionsVersion: number;
}
export function PublicationReactionSettings({
  publicationId,
  revisionId,
  initial,
  onAccessDenied,
}: {
  readonly publicationId: string;
  readonly revisionId: string;
  readonly initial: Settings;
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(initial);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function save() {
    if (!settings || inFlight.current || !reason.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await call<Settings>(
        `/api/admin/v1/publications/${encodeURIComponent(publicationId)}/reactions`,
        {
          method: 'POST',
          body: JSON.stringify({
            enabled: !settings.reactionsEnabled,
            expectedVersion: settings.reactionsVersion,
            expectedRevisionId: revisionId,
            reason: reason.trim(),
          }),
        },
      );
      if (!active.current) return;
      if (result.ok) {
        setSettings(result.data);
        setReason('');
      } else {
        setSettings(null);
        setError(
          result.status === 409
            ? 'Настройка изменилась. Обновите список публикаций.'
            : 'Изменение не подтверждено. Обновите список публикаций.',
        );
        if (result.status === 401 || result.status === 403) onAccessDenied();
      }
    } catch {
      if (active.current) {
        setSettings(null);
        setError('Ответ не получен. Обновите список публикаций.');
      }
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <details className="publication-reaction-settings" data-testid="admin-publication-reactions">
      <summary>
        {settings
          ? `${settings.likeCount} нравится · Реакции ${settings.reactionsEnabled ? 'включены' : 'выключены'}`
          : 'Реакции: обновите список'}
      </summary>
      {settings ? (
        <>
          <label>
            Причина изменения
            <input
              aria-label="Причина изменения реакций"
              maxLength={500}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !reason.trim()}
            onClick={() => void save()}
          >
            {settings.reactionsEnabled ? 'Отключить реакции' : 'Включить реакции'}
          </button>
          <small>
            Накопленные лайки сохраняются. Свой лайк можно убрать и при отключённых реакциях.
          </small>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </details>
  );
}
