import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './admin-api';
interface Policy {
  enabled: boolean;
  version: number;
}
const URL = '/api/admin/v1/publications/acquisition';
export function PublicationAcquisitionSettings({
  onAccessDenied,
}: {
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    const result = await call<Policy>(URL);
    if (current !== generation.current) return;
    if (result.ok) {
      setPolicy(result.data);
      setError(null);
    } else {
      setPolicy(null);
      setError('Не удалось прочитать общее разрешение.');
      if ([401, 403].includes(result.status)) onAccessDenied();
    }
  }, [onAccessDenied]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  async function save() {
    if (!policy || inFlight.current || !reason.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const current = ++generation.current;
    try {
      const result = await call<Policy>(URL, {
        method: 'POST',
        body: JSON.stringify({
          enabled: !policy.enabled,
          expectedVersion: policy.version,
          reason: reason.trim(),
        }),
      });
      if (current !== generation.current) return;
      if (result.ok) {
        setPolicy(result.data);
        setReason('');
      } else {
        setPolicy(null);
        setError(
          result.status === 409
            ? 'Настройка изменилась. Прочитайте актуальное состояние.'
            : 'Изменение не подтверждено.',
        );
        if ([401, 403].includes(result.status)) onAccessDenied();
      }
    } catch {
      if (current === generation.current) {
        setPolicy(null);
        setError('Изменение не подтверждено.');
      }
    } finally {
      inFlight.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <div className="publication-acquisition-settings" aria-busy={busy}>
      <p>
        <strong>
          Получение публичных проектов:{' '}
          {policy ? (policy.enabled ? 'разрешено' : 'запрещено') : 'проверяем…'}
        </strong>
      </p>
      <p>Общий запрет действует для всех аккаунтов и учеников. Просмотр остаётся доступным.</p>
      {policy ? (
        <>
          <label>
            Причина изменения{' '}
            <input
              value={reason}
              maxLength={500}
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
            {busy ? 'Сохраняем…' : policy.enabled ? 'Запретить получение' : 'Разрешить получение'}
          </button>
        </>
      ) : null}
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            Проверить состояние
          </button>
        </>
      ) : null}
    </div>
  );
}
