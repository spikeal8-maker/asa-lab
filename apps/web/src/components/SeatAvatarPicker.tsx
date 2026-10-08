import { useEffect, useRef, useState } from 'react';
import { useAvatarModule } from './use-avatar-module';
import { seatAvatar } from '../creator-portal/default-avatars';
import { CloseIcon } from '../electronics/workbench-icons';
import { InfoHint } from './InfoHint';
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
  const dismiss = useRef<HTMLButtonElement | null>(null);
  const { module, failed, canRetry, retry } = useAvatarModule(open);
  const AvatarSelection = module?.AvatarSelection;
  const current = seatAvatar(seatId, value);
  useEffect(() => {
    if (open) dismiss.current?.focus();
  }, [open]);
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
          aria-label="Выбрать аватар ученика"
          disabled={busy}
          onClick={(event) => {
            opener.current = event.currentTarget;
            setSelected('current');
            setOpen(true);
          }}
        >
          <img src={current.src} alt="Аватар ученика" width={72} height={72} />
        </button>
        <InfoHint label="Информация об аватаре ученика">
          Выберите готовую картинку и нажмите «Использовать». Выбор войдёт в изменения ученика; он
          сохранится только после кнопки «Сохранить» в этой форме. Загрузка своего изображения для
          профиля ученика недоступна.
        </InfoHint>
      </div>
      {open ? (
        <div
          className="seat-avatar-staged-selection"
          role="region"
          aria-label="Выбор аватара ученика"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="seat-avatar-selection-heading">
            <button
              ref={dismiss}
              type="button"
              aria-label="Закрыть выбор аватара ученика"
              onClick={close}
            >
              <CloseIcon />
            </button>
          </div>
          {AvatarSelection ? (
            <AvatarSelection
              current={{ src: current.src, label: 'Аватар' }}
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
            <button
              type="button"
              className="btn-primary"
              disabled={busy || selected === 'current'}
              onClick={() => {
                onChange(selected);
                close();
              }}
            >
              Использовать
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
