import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { createAvatarDataUrl } from '../creator-portal/avatar-file';
import {
  DEFAULT_AVATARS,
  defaultAvatarFile,
  defaultAvatarForAccount,
  seatAvatar,
} from '../creator-portal/default-avatars';
import type { AvatarActor } from './avatar-chooser-events';
import { AvatarSelection } from './AvatarSelection';
import type { AvatarSave } from './use-avatar-save';
export { AvatarSelection } from './AvatarSelection';

export interface AvatarChooserProps {
  readonly actor: AvatarActor;
  readonly currentUrl: string;
  readonly accountAvatarLoaded: boolean;
  readonly isCurrent: () => boolean;
  readonly onAccountLoaded: (url: string | null) => void;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly onSave: (input: AvatarSave) => Promise<boolean>;
  readonly onClearSaveError: () => void;
  readonly onClose: () => void;
}

export function AvatarChooser({
  actor,
  currentUrl,
  accountAvatarLoaded,
  isCurrent,
  onAccountLoaded,
  saving,
  saveError,
  onSave,
  onClearSaveError,
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
    if (locked.current || saving || loading) return;
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
    if (locked.current || saving || loading || !valid() || selected === 'current') return;
    locked.current = true;
    const epoch = ++operation.current;
    const stillCurrent = () => valid() && epoch === operation.current;
    setBusy(true);
    setError(null);
    try {
      if (actor.kind === 'seat') {
        if (!stillCurrent()) return;
        if (
          !(await onSave({ kind: 'seat', avatarKey: selected === 'automatic' ? null : selected }))
        )
          return;
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
        if (!(await onSave({ kind: 'account', dataUrl }))) return;
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
        current={{ src: current, label: 'Аватар' }}
        {...(uploaded ? { uploaded: { src: uploaded, label: 'Аватар' } } : {})}
        selected={selected}
        busy={busy || saving || loading}
        onSelect={(key) => {
          setSelected(key);
          setError(null);
          onClearSaveError();
        }}
      />
      <div className="avatar-chooser-feedback" aria-live="polite">
        {busy || saving ? (
          <p role="status">
            {saving
              ? 'Сохраняем аватар… Закрытие окна не отменяет отправленный запрос.'
              : 'Подготавливаем аватар…'}
          </p>
        ) : null}
        {error || saveError ? <p role="alert">{error || saveError}</p> : null}
        {error && !accountAvatarLoaded && selected === 'current' ? (
          <button type="button" onClick={() => void loadCurrent()}>
            Повторить загрузку
          </button>
        ) : null}
      </div>
      <footer className="avatar-chooser-actions">
        {actor.kind === 'account' ? (
          <button
            type="button"
            className="avatar-chooser-upload"
            disabled={busy || saving || loading}
            onClick={() => input.current?.click()}
          >
            Загрузить
          </button>
        ) : null}
        <button
          type="button"
          className="btn-primary"
          disabled={busy || saving || loading || selected === 'current'}
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
