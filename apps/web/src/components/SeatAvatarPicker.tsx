import { useRef, useState } from 'react';
import { useAvatarModule } from './use-avatar-module';
import { seatAvatar } from '../creator-portal/default-avatars';
import './seat-avatar.css';

/** Teacher editing: Use stages a key; only the enclosing form persists it. */
export function SeatAvatarPicker({
  seatId,
  value,
  busy = false,
  onChange,
}: {
  readonly seatId: string;
  readonly value: string | null;
  readonly busy?: boolean;
  readonly onChange: (avatarKey: string | null) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('current');
  const opener = useRef<HTMLButtonElement | null>(null);
  const { module, failed, canRetry, retry } = useAvatarModule(open);
  const AvatarSelection = module?.AvatarSelection;
  const current = seatAvatar(seatId, value);
  function close(): void {
    setOpen(false);
    if (opener.current?.isConnected) opener.current.focus();
  }
  return (
    <div className="seat-avatar-picker">
      <div className="seat-avatar-current">
        <button
          type="button"
          className="account-avatar-preview-button"
          aria-label="Увеличить и выбрать аватар ученика"
          disabled={busy}
          onClick={(event) => {
            opener.current = event.currentTarget;
            setSelected('current');
            setOpen(true);
          }}
        >
          <img src={current.src} alt="Текущий аватар ученика" width={72} height={72} />
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={(event) => {
            opener.current = event.currentTarget;
            setSelected('current');
            setOpen(true);
          }}
        >
          Выбрать аватар ученика
        </button>
      </div>
      {open ? (
        <div className="seat-avatar-staged-selection">
          {AvatarSelection ? (
            <AvatarSelection
              current={{ src: current.src, label: 'Текущий аватар' }}
              automatic={{ src: seatAvatar(seatId, null).src, label: 'Автоматический аватар' }}
              selected={selected}
              busy={busy}
              onSelect={setSelected}
            />
          ) : failed ? (
            <div role="alert">
              <p>Не удалось открыть выбор аватара.</p>
              <button type="button" disabled={!canRetry} onClick={retry}>
                Повторить
              </button>
            </div>
          ) : (
            <p role="status">Открываем аватары…</p>
          )}
          <div className="avatar-chooser-actions">
            <button type="button" className="btn-secondary" onClick={close}>
              Отменить выбор аватара
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || selected === 'current'}
              onClick={() => {
                onChange(selected === 'automatic' ? null : selected);
                close();
              }}
            >
              Использовать аватар
            </button>
          </div>
          <p className="account-hint">Аватар изменится после сохранения настроек ученика.</p>
        </div>
      ) : null}
    </div>
  );
}
