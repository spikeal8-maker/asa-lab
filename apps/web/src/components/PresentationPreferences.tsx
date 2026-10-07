import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { call } from '../api-call';
import { onSessionLoggedOut } from '../session-fetch';
import { hasSettingsDraft, type SettingsDraft } from './settings-navigation';
export interface Presentation {
  motion: 'system' | 'reduce';
  sidebar: 'expanded' | 'collapsed';
}
interface Snapshot extends Presentation {
  revision: number;
}
const defaults: Presentation = { motion: 'system', sidebar: 'expanded' };
const seatStorage = 'asa-seat-presentation-session';
function untilExpiry(expiresAt: string, expired: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    const delay = Date.parse(expiresAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      expired();
      return;
    }
    timer = setTimeout(schedule, Math.min(delay, 2147483647));
  };
  schedule();
  return () => {
    if (timer) clearTimeout(timer);
  };
}
/** Runs above the shell/editor branch, so expiration and actor changes clear
 * temporary preferences even while the learner works in an editor. */
export function usePresentationSessionLifetime(
  actor: string | null | undefined,
  expiresAt?: string,
) {
  useEffect(() => {
    if (actor === undefined) return;
    try {
      const stored = JSON.parse(sessionStorage.getItem(seatStorage) ?? 'null');
      if (!actor || stored?.actor !== `${actor}:${expiresAt ?? ''}`)
        sessionStorage.removeItem(seatStorage);
    } catch {
      /* Disabled storage must not affect authentication. */
    }
    if (!actor || !expiresAt) return;
    return untilExpiry(expiresAt, () => {
      try {
        sessionStorage.removeItem(seatStorage);
      } catch {
        /* Safe exit. */
      }
    });
  }, [actor, expiresAt]);
}
function valid(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Snapshot;
  return (
    (v.motion === 'system' || v.motion === 'reduce') &&
    (v.sidebar === 'expanded' || v.sidebar === 'collapsed') &&
    Number.isSafeInteger(v.revision) &&
    v.revision >= 0
  );
}
interface State extends SettingsDraft {
  draft: Presentation;
  busy: boolean;
  loaded: boolean;
  error: string;
  notice: string;
  seat: boolean;
  actorChanged: boolean;
  preview: (value: Presentation) => void;
  reset: () => void;
  reload: () => Promise<void>;
  toggleSidebar: () => Promise<void>;
}
const Context = createContext<State | null>(null);
export function usePresentation(): State {
  const value = useContext(Context);
  if (!value) throw new Error('presentation provider missing');
  return value;
}
export function PresentationProvider({
  actor,
  seat = false,
  expiresAt,
  children,
}: {
  actor: string;
  seat?: boolean;
  expiresAt?: string;
  children: ReactNode;
}) {
  const [saved, setSaved] = useState<Snapshot>({ ...defaults, revision: 0 });
  const [draft, setDraft] = useState<Presentation>(defaults);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [actorChanged, setActorChanged] = useState(false);
  const live = useRef(true),
    inFlight = useRef(false),
    dirtyRef = useRef(false);
  const pending = useRef<{
    motion: Presentation['motion'];
    sidebar: Presentation['sidebar'];
    revision: number;
    requestId: string;
  } | null>(null);
  const generation = useRef(0);
  const requests = useRef(new AbortController());
  const dirty = draft.motion !== saved.motion || draft.sidebar !== saved.sidebar;
  dirtyRef.current = dirty;
  const sessionKey = `${actor}:${expiresAt ?? ''}`;
  const accountHeaders = { 'x-asa-presentation-account': actor };
  function changedAccount() {
    setActorChanged(true);
    endSession(
      'Аккаунт изменился в другом окне. Оформление не сохранено. Обновите страницу, чтобы продолжить в текущем аккаунте.',
    );
  }
  function endSession(message = '') {
    live.current = false;
    requests.current.abort();
    generation.current++;
    pending.current = null;
    inFlight.current = false;
    dirtyRef.current = false;
    try {
      sessionStorage.removeItem(seatStorage);
    } catch {
      /* Session termination must continue even when storage is unavailable. */
    }
    setSaved({ ...defaults, revision: 0 });
    setDraft(defaults);
    setLoaded(false);
    setBusy(false);
    setNotice('');
    setError(message);
  }
  async function reload() {
    if (!live.current || inFlight.current || dirtyRef.current) return;
    const current = ++generation.current;
    setError('');
    setLoaded(false);
    if (seat) {
      let value: Snapshot = { ...defaults, revision: 0 };
      try {
        const stored = JSON.parse(sessionStorage.getItem(seatStorage) ?? 'null');
        if (
          stored?.actor === sessionKey &&
          valid(stored.value) &&
          Date.parse(expiresAt ?? '') > Date.now()
        )
          value = { ...stored.value, sidebar: 'expanded' };
        else sessionStorage.removeItem(seatStorage);
      } catch {
        /* Storage failure is shown if the learner saves. */
      }
      if (live.current) {
        setSaved(value);
        setDraft(value);
        setLoaded(true);
      }
      return;
    }
    const result = await call<Snapshot>('/api/account/presentation', {
      signal: requests.current.signal,
      headers: accountHeaders,
    });
    if (!live.current || current !== generation.current) return;
    if (!result.ok && result.error.code === 'actor_changed') {
      changedAccount();
      return;
    }
    if (result.ok && valid(result.data)) {
      setSaved(result.data);
      setDraft(result.data);
      setLoaded(true);
    } else setError('Не удалось загрузить оформление. Проверьте соединение и повторите.');
  }
  useEffect(() => {
    live.current = true;
    requests.current = new AbortController();
    const unsubscribe = onSessionLoggedOut(() => endSession());
    const stopExpiry = seat
      ? untilExpiry(expiresAt ?? '', () => endSession('Учебный вход завершён. Войдите снова.'))
      : undefined;
    void reload();
    return () => {
      live.current = false;
      requests.current.abort();
      generation.current++;
      unsubscribe();
      stopExpiry?.();
    };
    // Provider is keyed by the authenticated actor/session by App.
  }, []);
  function preview(value: Presentation) {
    if (!live.current || busy || !loaded) return;
    setDraft(value);
    setNotice('');
    setError('');
  }
  function discard() {
    if (!live.current || busy) return;
    pending.current = null;
    setDraft(saved);
    setNotice('');
  }
  async function persist(value: Presentation): Promise<boolean> {
    if (!loaded || inFlight.current || !live.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let snapshot: Snapshot | null = null;
    if (seat) {
      if (
        !expiresAt ||
        !Number.isFinite(Date.parse(expiresAt)) ||
        Date.parse(expiresAt) <= Date.now()
      ) {
        endSession('Учебный вход завершён. Войдите снова.');
      } else
        try {
          snapshot = { ...value, revision: saved.revision + 1 };
          sessionStorage.setItem(
            seatStorage,
            JSON.stringify({ actor: sessionKey, value: snapshot }),
          );
        } catch {
          snapshot = null;
          setError('Предпросмотр только здесь; не сохранено. Хранилище сеанса недоступно.');
        }
    } else {
      const old = pending.current;
      const command =
        old &&
        old.motion === value.motion &&
        old.sidebar === value.sidebar &&
        old.revision === saved.revision
          ? old
          : { ...value, revision: saved.revision, requestId: crypto.randomUUID() };
      pending.current = command;
      const result = await call<Snapshot>('/api/account/presentation', {
        method: 'PUT',
        signal: requests.current.signal,
        headers: accountHeaders,
        body: JSON.stringify(command),
      });
      if (!live.current) {
        inFlight.current = false;
        return false;
      }
      if (result.ok && valid(result.data)) {
        snapshot = result.data;
        pending.current = null;
      } else {
        if (!result.ok && result.error.code === 'actor_changed') {
          changedAccount();
          return false;
        }
        if (!result.ok && result.status === 409) pending.current = null;
        setError(
          !result.ok && result.status === 409
            ? 'Оформление изменено в другом окне. Предпросмотр не сохранён. Отмените изменения и загрузите сохранённое оформление.'
            : 'Предпросмотр только здесь; не сохранено. Повторите сохранение.',
        );
      }
    }
    inFlight.current = false;
    if (!live.current) return false;
    setBusy(false);
    if (!snapshot) return false;
    setSaved(snapshot);
    setDraft(snapshot);
    setNotice(
      seat ? 'Сохранено до выхода из этого учебного сеанса.' : 'Оформление сохранено в аккаунте.',
    );
    return true;
  }
  async function toggleSidebar() {
    if (dirty || hasSettingsDraft() || busy || !loaded) return;
    const next = {
      ...saved,
      sidebar: saved.sidebar === 'collapsed' ? 'expanded' : 'collapsed',
    } as Presentation;
    // Header changes are saved, rather than becoming a hidden Settings draft.
    await persist(next);
  }
  return (
    <Context.Provider
      value={{
        draft,
        dirty,
        busy,
        loaded,
        error,
        notice,
        seat,
        actorChanged,
        preview,
        save: () => persist(draft),
        discard,
        reset: () => preview(defaults),
        reload,
        toggleSidebar,
      }}
    >
      <div className="presentation-shell" data-motion={draft.motion}>
        {children}
      </div>
    </Context.Provider>
  );
}
export function PresentationControls() {
  const p = usePresentation();
  return (
    <form
      className="account-profile-form account-presentation"
      onSubmit={(e) => {
        e.preventDefault();
        void p.save();
      }}
      aria-label="Оформление"
    >
      <p className="account-hint">
        {p.seat
          ? 'До выхода из этого учебного сеанса, только в этом браузере.'
          : 'Сохраняется в аккаунте и применяется на других устройствах.'}
      </p>
      {!p.loaded && !p.error ? <p role="status">Загружаем оформление…</p> : null}
      <label>
        Движение
        <select
          value={p.draft.motion}
          disabled={!p.loaded || p.busy}
          onChange={(e) =>
            p.preview({ ...p.draft, motion: e.target.value as Presentation['motion'] })
          }
        >
          <option value="system">Как в системе</option>
          <option value="reduce">Уменьшить движение</option>
        </select>
      </label>
      {!p.seat ? (
        <label>
          Боковая панель
          <select
            value={p.draft.sidebar}
            disabled={!p.loaded || p.busy}
            onChange={(e) =>
              p.preview({ ...p.draft, sidebar: e.target.value as Presentation['sidebar'] })
            }
          >
            <option value="expanded">Полная</option>
            <option value="collapsed">Свёрнутая</option>
          </select>
        </label>
      ) : null}
      {p.dirty ? (
        <p role="status" className="account-hint">
          Предпросмотр только здесь; изменения ещё не сохранены.
        </p>
      ) : null}
      {p.error ? (
        <p role="alert" className="account-message error">
          {p.error}
        </p>
      ) : null}
      {p.notice ? (
        <p role="status" className="account-message success">
          {p.notice}
        </p>
      ) : null}
      <div className="account-form-actions">
        <button type="submit" className="btn-primary" disabled={!p.dirty || p.busy || !p.loaded}>
          {p.busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!p.dirty || p.busy}
          onClick={p.discard}
        >
          Отменить
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!p.loaded || p.busy}
          onClick={p.reset}
        >
          По умолчанию
        </button>
      </div>
      {p.actorChanged ? (
        <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>
          Обновить страницу
        </button>
      ) : p.error ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={p.busy || p.dirty}
          onClick={() => void p.reload()}
        >
          Загрузить сохранённое оформление
        </button>
      ) : null}
    </form>
  );
}
