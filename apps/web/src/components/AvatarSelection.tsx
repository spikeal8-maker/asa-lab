import { useEffect, useRef, useState } from 'react';
import { DEFAULT_AVATARS } from '../creator-portal/default-avatars';
import './avatar-chooser.css';

export interface AvatarPreview {
  readonly src: string;
  readonly label: string;
}

/** The catalogue comes first. Enlarging a picture never confirms the choice. */
export function AvatarSelection({
  current,
  uploaded,
  selected,
  busy = false,
  onSelect,
}: {
  readonly current: AvatarPreview;
  readonly uploaded?: AvatarPreview | undefined;
  readonly selected: string;
  readonly busy?: boolean;
  readonly onSelect: (key: string) => void;
}): JSX.Element {
  const [enlarged, setEnlarged] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const back = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (selected === 'uploaded') setEnlarged(true);
  }, [selected, uploaded?.src]);
  useEffect(() => {
    if (enlarged) back.current?.focus();
    else opener.current?.focus();
  }, [enlarged]);
  const preview =
    selected === 'uploaded'
      ? (uploaded ?? current)
      : (DEFAULT_AVATARS.find((avatar) => avatar.id === selected) ?? current);
  function show(key: string, button: HTMLButtonElement): void {
    opener.current = button;
    onSelect(key);
    setEnlarged(true);
  }
  return (
    <div className="avatar-selection">
      <div className="avatar-selection-grid" aria-label="Аватары" hidden={enlarged}>
        <button
          type="button"
          aria-label="Посмотреть свой аватар"
          aria-pressed={selected === 'current'}
          disabled={busy}
          onClick={(event) => show('current', event.currentTarget)}
        >
          <img src={current.src} alt="" width={56} height={56} />
        </button>
        {uploaded ? (
          <button
            type="button"
            aria-label="Посмотреть загруженное изображение"
            aria-pressed={selected === 'uploaded'}
            disabled={busy}
            onClick={(event) => show('uploaded', event.currentTarget)}
          >
            <img src={uploaded.src} alt="" width={56} height={56} />
          </button>
        ) : null}
        {DEFAULT_AVATARS.map((avatar) => (
          <button
            type="button"
            key={avatar.id}
            aria-label={`Выбрать: ${avatar.label}`}
            aria-pressed={selected === avatar.id}
            disabled={busy}
            onClick={(event) => show(avatar.id, event.currentTarget)}
          >
            <img src={avatar.src} alt="" width={56} height={56} loading="lazy" />
          </button>
        ))}
      </div>
      {enlarged ? (
        <div className="avatar-selection-preview">
          <button
            ref={back}
            type="button"
            className="avatar-selection-back"
            aria-label="Вернуться к аватарам"
            onClick={() => setEnlarged(false)}
          >
            <span aria-hidden="true">←</span>
          </button>
          <img src={preview.src} alt="Предпросмотр аватара" width={240} height={240} />
        </div>
      ) : null}
    </div>
  );
}
