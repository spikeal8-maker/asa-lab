import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  gameAccessApi,
  gameAccessMessage,
  type ClassroomGamesPolicy,
} from '../games/game-access-api';
import { chessNetworkApi } from '../chess/chess-network-api';
import type { ChessNetworkPolicy, ChessNetworkScope } from '@asa-lab/contracts';
import './classroom-games-settings.css';

/** Class and individual controls share one authoritative version. A stale
 * response from another class/Seat cannot populate the currently shown form.
 */
export function ClassroomGamesSettings({
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
  const inputId = useId();
  const generation = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [policy, setPolicy] = useState<ClassroomGamesPolicy | null>(null);
  const [mode, setMode] = useState<ClassroomGamesPolicy['mode']>('allow');
  const [override, setOverride] =
    useState<NonNullable<ClassroomGamesPolicy['override']>>('inherit');
  const [threshold, setThreshold] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [networkDirty, setNetworkDirty] = useState(false);

  const adopt = useCallback((value: ClassroomGamesPolicy): void => {
    setPolicy(value);
    setMode(value.mode);
    setOverride(value.override ?? 'inherit');
    setThreshold(value.threshold === null ? '' : String(value.threshold));
  }, []);

  useEffect(() => {
    const token = ++generation.current;
    setPolicy(null);
    setError(null);
    setNotice(null);
    setSaving(false);
    void gameAccessApi
      .readPolicy(classroomId, seatId)
      .then((result) => {
        if (token !== generation.current) return;
        if (result.ok) adopt(result.data);
        else setError('Не удалось загрузить доступ к играм.');
      })
      .catch(() => {
        if (token === generation.current) setError('Не удалось загрузить доступ к играм.');
      });
    return () => {
      generation.current++;
    };
  }, [classroomId, seatId, attempt, adopt]);

  const numericThreshold = Number(threshold);
  const validThreshold =
    mode !== 'rating_threshold' ||
    (threshold.trim() !== '' &&
      Number.isFinite(numericThreshold) &&
      numericThreshold >= 0 &&
      numericThreshold <= 100);
  const dirty =
    policy !== null &&
    (seatId
      ? override !== (policy.override ?? 'inherit')
      : mode !== policy.mode ||
        (mode === 'rating_threshold' && numericThreshold !== policy.threshold) ||
        policy.state === 'revoked');

  useEffect(() => {
    onDirtyChange?.(dirty || networkDirty);
    return () => onDirtyChange?.(false);
  }, [dirty, networkDirty, onDirtyChange]);

  async function save(): Promise<void> {
    if (!policy || saving || readOnly || (!seatId && !validThreshold)) return;
    const token = generation.current;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = seatId
        ? await gameAccessApi.saveSeat(classroomId, seatId, {
            override,
            expectedVersion: policy.version,
          })
        : await gameAccessApi.saveClass(classroomId, {
            mode,
            threshold: mode === 'rating_threshold' ? numericThreshold : null,
            expectedVersion: policy.version,
          });
      if (token !== generation.current) return;
      if (result.ok) {
        adopt(result.data);
        setNotice('Доступ к играм сохранён.');
      } else {
        setError(
          result.status === 409
            ? 'Настройки уже изменились. Обновите их и повторите изменение.'
            : 'Не удалось сохранить доступ к играм.',
        );
      }
    } catch {
      if (token === generation.current) setError('Не удалось сохранить доступ к играм.');
    } finally {
      if (token === generation.current) setSaving(false);
    }
  }

  return (
    <fieldset
      className={`classroom-games-settings${seatId ? ' classroom-games-settings--seat' : ''}`}
      aria-busy={saving || (!policy && !error)}
    >
      <legend>{seatId ? 'Игры ученика' : 'Игры в классе'}</legend>
      {!policy && !error ? <p role="status">Проверяем доступ к играм…</p> : null}
      {policy ? (
        <>
          <div className="classroom-games-settings-row">
            <label htmlFor={`${inputId}-mode`}>
              {seatId ? 'Индивидуальный доступ' : 'Доступ к играм'}
            </label>
            {seatId ? (
              <select
                id={`${inputId}-mode`}
                value={override}
                disabled={readOnly || saving}
                onChange={(event) => setOverride(event.target.value as typeof override)}
              >
                <option value="inherit">По правилу класса</option>
                <option value="allow">Разрешить</option>
                <option value="deny">Запретить</option>
              </select>
            ) : (
              <select
                id={`${inputId}-mode`}
                value={mode}
                disabled={readOnly || saving}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                <option value="allow">Разрешены</option>
                <option value="deny">Запрещены</option>
                <option value="rating_threshold">По рейтингу класса</option>
              </select>
            )}
            {!seatId && mode === 'rating_threshold' ? (
              <label className="classroom-games-threshold">
                Рейтинг от
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="any"
                  value={threshold}
                  disabled={readOnly || saving}
                  onChange={(event) => setThreshold(event.target.value)}
                  aria-label="Порог рейтинга для игр"
                />
              </label>
            ) : null}
            <button
              type="button"
              className="btn-secondary"
              disabled={readOnly || saving || !dirty || (!seatId && !validThreshold)}
              onClick={() => void save()}
            >
              {saving ? 'Сохраняем…' : 'Сохранить доступ'}
            </button>
          </div>
          <p className="classroom-games-help">
            {seatId && policy.admission
              ? gameAccessMessage(policy.admission)
              : policy.state === 'revoked'
                ? 'Доступ приостановлен. Сохраните правило, чтобы возобновить управление играми.'
                : 'Самостоятельные шахматы и шашки. Безопасный режим настраивается отдельно.'}
          </p>
          {!seatId && mode === 'rating_threshold' ? (
            <p className="classroom-games-help">
              Используется текущий рейтинг ученика в этом классе. Если рейтинг недоступен, игры
              закрыты.
            </p>
          ) : null}
        </>
      ) : null}
      {!seatId && (
        <ClassroomNetworkSettings
          key={classroomId}
          classroomId={classroomId}
          readOnly={readOnly}
          onDirtyChange={setNetworkDirty}
        />
      )}
      {error ? (
        <p role="alert" className="classroom-games-settings-error">
          {error}{' '}
          <button
            type="button"
            className="btn-ghost"
            disabled={saving}
            onClick={() => {
              if (dirty && !window.confirm('Несохранённый выбор будет потерян. Обновить правило?'))
                return;
              setAttempt((value) => value + 1);
            }}
          >
            Обновить настройки
          </button>
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="classroom-games-settings-notice">
          {notice}
        </p>
      ) : null}
    </fieldset>
  );
}

function ClassroomNetworkSettings({
  classroomId,
  readOnly,
  onDirtyChange,
}: {
  classroomId: string;
  readOnly: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const id = useId();
  const generation = useRef(0);
  const [policy, setPolicy] = useState<ChessNetworkPolicy | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [scope, setScope] = useState<ChessNetworkScope>('classroom');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const current = ++generation.current;
    setError(null);
    setPolicy(null);
    void chessNetworkApi
      .readPolicy(classroomId)
      .then((result) => {
        if (current !== generation.current) return;
        if (result.ok) {
          setPolicy(result.data);
          setEnabled(result.data.enabled);
          setScope(result.data.scope);
        } else setError('Не удалось загрузить настройки сетевой игры.');
      })
      .catch(() => {
        if (current === generation.current)
          setError('Не удалось загрузить настройки сетевой игры.');
      });
    return () => {
      generation.current++;
    };
  }, [classroomId, attempt]);
  const dirty = Boolean(policy && (enabled !== policy.enabled || scope !== policy.scope));
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  async function save() {
    if (!policy || busy || readOnly) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const current = generation.current;
    try {
      const result = await chessNetworkApi.savePolicy(classroomId, {
        enabled,
        scope,
        expectedVersion: policy.version,
      });
      if (current !== generation.current) return;
      if (result.ok) {
        setPolicy(result.data);
        setNotice('Настройки сетевой игры сохранены.');
      } else
        setError(
          result.status === 409
            ? 'Настройки изменились. Обновите их перед сохранением.'
            : 'Не удалось сохранить настройки сети.',
        );
    } catch {
      if (current === generation.current) setError('Не удалось сохранить настройки сети.');
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <fieldset className="classroom-network-settings" aria-busy={busy}>
      <legend>Сетевая игра в шахматы</legend>
      {!policy && !error && <p role="status">Загружаем настройки сети…</p>}
      {policy && (
        <>
          <div className="classroom-games-settings-row">
            <label htmlFor={id}>Разрешить сетевую игру</label>
            <input
              id={id}
              type="checkbox"
              checked={enabled}
              disabled={readOnly || busy}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <label htmlFor={`${id}-scope`}>Круг соперников</label>
            <select
              id={`${id}-scope`}
              value={scope}
              disabled={readOnly || busy || !enabled}
              onChange={(event) => setScope(event.target.value as ChessNetworkScope)}
            >
              <option value="classroom">Только свой класс</option>
              <option value="school">Только своя школа</option>
              <option value="platform">Вся платформа</option>
            </select>
            <button
              type="button"
              className="btn-secondary"
              disabled={!dirty || readOnly || busy}
              onClick={() => void save()}
            >
              Сохранить сетевой режим
            </button>
          </div>
          <p className="classroom-games-help">
            Сеть доступна только ученикам, которым разрешены игры. Эти ограничения сохраняются и в
            связанном личном аккаунте. Изменение правил останавливает текущие партии без результата.
          </p>
        </>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" disabled={busy} onClick={() => setAttempt((value) => value + 1)}>
            Обновить сеть
          </button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </fieldset>
  );
}
