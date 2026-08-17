import { DEFAULT_AVATARS, seatAvatar } from '../creator-portal/default-avatars';
import './seat-avatar.css';

/**
 * The set of faces a class seat can wear.
 *
 * The same grid serves two people. A teacher opens it from the register, to fix
 * the picture a child is unhappy with or to tell two Alinas apart at a glance.
 * The child opens it from their own settings, which is the more important of
 * the two — a picture you did not choose is somebody else's idea of you.
 *
 * There is no upload. A class register full of photographs of children is a
 * thing to be responsible for, and this product has no business creating one.
 */
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
  const current = seatAvatar(seatId, value);
  return (
    <div className="seat-avatar-picker">
      <div className="seat-avatar-current">
        <img src={current.src} alt="" width={72} height={72} />
        <span>
          <strong>{value ? current.label : 'Выдан автоматически'}</strong>
          <small>Выберите любой — он появится в списке класса и у ученика.</small>
        </span>
      </div>
      <ul className="seat-avatar-grid" aria-label="Аватары">
        {DEFAULT_AVATARS.map((avatar) => {
          const chosen = value === avatar.id;
          return (
            <li key={avatar.id}>
              <button
                type="button"
                className={chosen ? 'is-chosen' : undefined}
                aria-pressed={chosen}
                aria-label={avatar.label}
                disabled={busy}
                onClick={() => onChange(chosen ? null : avatar.id)}
              >
                <img src={avatar.src} alt="" width={48} height={48} loading="lazy" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
