import { useEffect, useRef, useState } from 'react';
import { api, type ClassroomStudentSession } from '../api';
import { createAvatarDataUrl } from '../creator-portal/avatar-file';
import {
  DEFAULT_AVATARS,
  defaultAvatarFile,
  defaultAvatarForAccount,
  notifyProfileAvatarChanged,
  seatAvatar,
} from '../creator-portal/default-avatars';
import type { AvatarActor } from './avatar-chooser-events';
import { AvatarSelection } from './AvatarSelection';
export { AvatarSelection } from './AvatarSelection';

export interface AvatarChooserProps {
  readonly actor: AvatarActor;
  readonly currentUrl: string;
  readonly accountAvatarLoaded: boolean;
  readonly seat?: ClassroomStudentSession | undefined;
  readonly isCurrent: () => boolean;
  readonly onAccountLoaded: (url: string | null) => void;
  readonly onSeatChanged?: ((seat: ClassroomStudentSession) => void) | undefined;
  readonly onClose: () => void;
}

export function AvatarChooser({
  actor,
  currentUrl,
  accountAvatarLoaded,
  seat,
  isCurrent,
  onAccountLoaded,
  onSeatChanged,
  onClose,
}: AvatarChooserProps): JSX.Element {
  const [selected, setSelected] = useState('current');
  const [current, setCurrent] = useState(currentUrl);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(actor.kind === 'account' && !accountAvatarLoaded);
  const suppliedAvatar = useRef({ url: currentUrl, loaded: accountAvatarLoaded, version: 0 });
  if (
    suppliedAvatar.current.url !== currentUrl ||
    suppliedAvatar.current.loaded !== accountAvatarLoaded
  ) {
    suppliedAvatar.current = {
      url: currentUrl,
      loaded: accountAvatarLoaded,
      version: suppliedAvatar.current.version + 1,
    };
  }
  const operation = useRef(0);
  const locked = useRef(false);
  const alive = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const automatic =
    actor.kind === 'seat' ? seatAvatar(actor.id, null) : defaultAvatarForAccount(actor.id);
  const valid = () => alive.current && isCurrent();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current += 1;
    };
  }, []);
  useEffect(() => {
    setCurrent(currentUrl);
    if (accountAvatarLoaded) setLoading(false);
  }, [currentUrl, accountAvatarLoaded]);
  // A failed initial shell read can be retried here; never overwrite a newer save.
  async function loadCurrent(): Promise<void> {
    const epoch = ++operation.current;
    const version = suppliedAvatar.current.version;
    setLoading(true);
    setError(null);
    try {
      const result = await api.accountAvatar();
      if (!valid() || epoch !== operation.current || version !== suppliedAvatar.current.version)
        return;
      if (!result.ok) throw new Error('Не удалось загрузить текущий аватар.');
      onAccountLoaded(result.data.avatarDataUrl);
      setCurrent(result.data.avatarDataUrl ?? automatic.src);
    } catch (reason) {
      if (valid() && epoch === operation.current)
        setError(reason instanceof Error ? reason.message : 'Не удалось загрузить текущий аватар.');
    } finally {
      if (valid() && epoch === operation.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (loading) void loadCurrent();
  }, []); // Only the opening read; retries are explicit.

  async function prepare(file: File): Promise<void> {
    if (locked.current || loading) return;
    locked.current = true;
    const epoch = ++operation.current;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await createAvatarDataUrl(file);
      if (!valid() || epoch !== operation.current) return;
      setUploaded(dataUrl);
      setSelected('uploaded');
    } catch (reason) {
      if (valid() && epoch === operation.current)
        setError(reason instanceof Error ? reason.message : 'Не удалось обработать файл.');
    } finally {
      if (valid() && epoch === operation.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }

  async function save(): Promise<void> {
    if (locked.current || loading || !valid() || selected === 'current') return;
    locked.current = true;
    const epoch = ++operation.current;
    const stillCurrent = () => valid() && epoch === operation.current;
    setBusy(true);
    setError(null);
    try {
      if (actor.kind === 'seat') {
        if (!seat || !onSeatChanged || !stillCurrent()) return;
        const result = await api.setClassroomSeatAvatar(selected === 'automatic' ? null : selected);
        if (!stillCurrent()) return;
        if (!result.ok) throw new Error(result.error.message || 'Не удалось сохранить аватар.');
        onSeatChanged(result.data);
      } else {
        let dataUrl: string | null = null;
        if (selected === 'uploaded') dataUrl = uploaded;
        else if (selected !== 'automatic') {
          const avatar = DEFAULT_AVATARS.find((item) => item.id === selected);
          if (!avatar) return;
          const file = await defaultAvatarFile(avatar);
          if (!stillCurrent()) return;
          dataUrl = await createAvatarDataUrl(file);
        }
        // Identity may change while a file downloads or the bitmap is processed.
        if (!stillCurrent()) return;
        const result = await api.updateAccountAvatar(dataUrl);
        if (!stillCurrent()) return;
        if (!result.ok) throw new Error(result.error.message || 'Не удалось сохранить аватар.');
        onAccountLoaded(result.data.avatarDataUrl);
        notifyProfileAvatarChanged(result.data.avatarDataUrl);
      }
      if (stillCurrent()) onClose();
    } catch (reason) {
      if (stillCurrent())
        setError(reason instanceof Error ? reason.message : 'Не удалось сохранить аватар.');
    } finally {
      if (stillCurrent()) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <>
      {loading ? <p role="status">Загружаем текущий аватар…</p> : null}
      <AvatarSelection
        current={{ src: current, label: 'Текущий аватар' }}
        automatic={{ src: automatic.src, label: 'Автоматический аватар' }}
        {...(uploaded ? { uploaded: { src: uploaded, label: 'Загруженный аватар' } } : {})}
        selected={selected}
        busy={busy || loading}
        uploadAction={
          actor.kind === 'account' ? (
            <div className="avatar-chooser-upload">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || loading}
                onClick={() => input.current?.click()}
              >
                Загрузить своё изображение
              </button>
              <p className="avatar-chooser-file-hint">PNG, JPEG или WebP · до 8 МБ</p>
            </div>
          ) : undefined
        }
        onSelect={(key) => {
          setSelected(key);
          setError(null);
        }}
      />
      <div className="avatar-chooser-feedback" aria-live="polite">
        {busy ? <p role="status">Подготавливаем и сохраняем аватар…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {error && !accountAvatarLoaded && selected === 'current' ? (
          <button type="button" onClick={() => void loadCurrent()}>
            Повторить загрузку
          </button>
        ) : null}
      </div>
      <footer className="avatar-chooser-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || loading || selected === 'current'}
          onClick={() => void save()}
        >
          Использовать
        </button>
      </footer>
      {actor.kind === 'account' ? (
        <>
          <input
            ref={input}
            tabIndex={-1}
            className="portal-avatar-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Загрузить свой аватар"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void prepare(file);
            }}
          />
        </>
      ) : null}
    </>
  );
}
