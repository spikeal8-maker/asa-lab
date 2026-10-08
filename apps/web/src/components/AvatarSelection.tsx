import { DEFAULT_AVATARS } from '../creator-portal/default-avatars';
import './avatar-chooser.css';

export interface AvatarPreview {
  readonly src: string;
  readonly label: string;
}

/** Slots: fixed-size preview | independently scrolling, naturally sized catalogue. */
export function AvatarSelection({
  current,
  automatic,
  uploaded,
  selected,
  busy = false,
  onSelect,
  uploadAction,
}: {
  readonly current: AvatarPreview;
  readonly automatic: AvatarPreview;
  readonly uploaded?: AvatarPreview | undefined;
  readonly selected: string;
  readonly busy?: boolean;
  readonly onSelect: (key: string) => void;
  readonly uploadAction?: JSX.Element | undefined;
}): JSX.Element {
  const preview =
    selected === 'current'
      ? current
      : selected === 'automatic'
        ? automatic
        : selected === 'uploaded'
          ? (uploaded ?? current)
          : (DEFAULT_AVATARS.find((avatar) => avatar.id === selected) ?? current);
  return (
    <div className="avatar-selection">
      <figure className="avatar-selection-preview">
        <img src={preview.src} alt="Предпросмотр аватара" width={240} height={240} />
        <figcaption>{preview.label}</figcaption>
      </figure>
      <div className="avatar-selection-library">
        <select
          className="avatar-selection-menu"
          aria-label="Вариант аватара"
          disabled={busy}
          value={selected}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="current">Текущий аватар</option>
          <option value="automatic">Автоматический аватар</option>
          {uploaded ? <option value="uploaded">Загруженный аватар</option> : null}
          {DEFAULT_AVATARS.some((avatar) => avatar.id === selected) ? (
            <option value={selected}>{preview.label}</option>
          ) : null}
        </select>
        <div className="avatar-selection-options">
          <button
            type="button"
            disabled={busy}
            aria-pressed={selected === 'current'}
            onClick={() => onSelect('current')}
          >
            Текущий аватар
          </button>
          <button
            type="button"
            disabled={busy}
            aria-pressed={selected === 'automatic'}
            onClick={() => onSelect('automatic')}
          >
            Автоматический аватар
          </button>
          {uploaded ? (
            <button
              type="button"
              disabled={busy}
              aria-pressed={selected === 'uploaded'}
              onClick={() => onSelect('uploaded')}
            >
              Загруженный аватар
            </button>
          ) : null}
        </div>
        <div className="avatar-selection-grid" aria-label="Стандартные аватары">
          {DEFAULT_AVATARS.map((avatar) => (
            <button
              type="button"
              key={avatar.id}
              aria-label={`Выбрать: ${avatar.label}`}
              aria-pressed={selected === avatar.id}
              disabled={busy}
              onClick={() => onSelect(avatar.id)}
            >
              <img src={avatar.src} alt="" width={64} height={64} loading="lazy" />
            </button>
          ))}
        </div>
        {uploadAction}
      </div>
    </div>
  );
}
