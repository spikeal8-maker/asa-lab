import { useEffect, useRef, useState } from 'react';
import { call } from '../api-call';
import './classroom-games-settings.css';
type Override = 'inherit' | 'allow' | 'deny';
interface Policy {
  publish: boolean;
  download: boolean;
  version: number;
  publishOverride?: Override;
  downloadOverride?: Override;
}
export function ClassroomProjectSettings({
  classroomId,
  seatId,
  readOnly = false,
  onDirtyChange,
}: {
  classroomId: string;
  seatId?: string;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const path = `/api/project-distribution/classrooms/${encodeURIComponent(classroomId)}/${seatId ? `seats/${encodeURIComponent(seatId)}` : 'policy'}`;
  const dirty = !!policy && !!draft && JSON.stringify(policy) !== JSON.stringify(draft);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const token = ++generation.current;
    setPolicy(null);
    setDraft(null);
    setError(null);
    setNotice(null);
    setBusy(false);
    void call<Policy>(path, { cache: 'no-store' })
      .then((result) => {
        if (token !== generation.current) return;
        if (result.ok) {
          setPolicy(result.data);
          setDraft(result.data);
        } else setError('Не удалось загрузить разрешения проектов.');
      })
      .catch(() => {
        if (token === generation.current) setError('Не удалось загрузить разрешения проектов.');
      });
    return () => {
      generation.current++;
    };
  }, [path, attempt]);
  async function save(): Promise<void> {
    if (!draft || !policy || busy || readOnly) return;
    const token = generation.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const input = seatId
        ? {
            publishOverride: draft.publishOverride,
            downloadOverride: draft.downloadOverride,
            expectedVersion: policy.version,
          }
        : { publish: draft.publish, download: draft.download, expectedVersion: policy.version };
      const result = await call<Policy>(path, { method: 'PUT', body: JSON.stringify(input) });
      if (token !== generation.current) return;
      if (result.ok) {
        setPolicy(result.data);
        setDraft(result.data);
        setNotice('Разрешения проектов сохранены.');
      } else
        setError(
          result.status === 409
            ? 'Настройки уже изменились. Обновите их и повторите изменение.'
            : 'Не удалось сохранить разрешения проектов.',
        );
    } catch {
      if (token === generation.current) setError('Не удалось сохранить разрешения проектов.');
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  return (
    <fieldset className="classroom-games-settings" aria-busy={busy || (!policy && !error)}>
      <legend>{seatId ? 'Проекты ученика' : 'Проекты класса'}</legend>
      {!draft && !error ? <p role="status">Загружаем разрешения проектов…</p> : null}
      {draft ? (
        <>
          {(['publish', 'download'] as const).map((key) => (
            <label className="classroom-games-settings-row" key={key}>
              {key === 'publish' ? 'Публикация проектов' : 'Скачивание проектов'}
              {seatId ? (
                <select
                  aria-label={key === 'publish' ? 'Публикация проектов' : 'Скачивание проектов'}
                  value={draft[`${key}Override`] ?? 'inherit'}
                  disabled={readOnly || busy}
                  onChange={(event) =>
                    setDraft({ ...draft, [`${key}Override`]: event.target.value })
                  }
                >
                  <option value="inherit">Как в классе</option>
                  <option value="allow">Разрешить</option>
                  <option value="deny">Запретить</option>
                </select>
              ) : (
                <input
                  type="checkbox"
                  checked={draft[key]}
                  disabled={readOnly || busy}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })}
                />
              )}
            </label>
          ))}
          <p className="classroom-games-help">
            Получение копий действует только при общем разрешении администратора платформы и
            согласии автора. «Разрешить» для класса или ученика не отменяет общий запрет.
          </p>
          <p className="classroom-games-help">
            Выключение публикации запрещает новые публикации и обновления. Уже опубликованные работы
            остаются доступны. Просмотр работ от этих разрешений не зависит.
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={readOnly || busy || !dirty}
            onClick={() => void save()}
          >
            {busy ? 'Сохраняем…' : 'Сохранить разрешения'}
          </button>
        </>
      ) : null}
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" disabled={busy} onClick={() => setAttempt((value) => value + 1)}>
            Обновить разрешения
          </button>
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </fieldset>
  );
}
