import { Fragment, useEffect } from 'react';
import { ClassJoinQr } from './ClassJoinQr';
import './class-share.css';

/**
 * The class code, put on the wall.
 *
 * A teacher shows this on a projector while thirty children type. That is the
 * whole purpose, so the code is as large as the screen allows and nothing else
 * competes with it — no navigation, no register, no advice. The reference
 * product has this screen and it is the right idea; what it does not have is
 * the square, and a camera does not mistype nine characters.
 *
 * Managing the code — replacing it, closing the door — lives here too, because
 * this is the moment a teacher is thinking about who can get in.
 */
export function ClassShareScreen({
  title,
  joinCode,
  joinUrl,
  busy,
  onCopyCode,
  onCopyLink,
  onRotate,
  onRevoke,
  onClose,
}: {
  readonly title: string;
  readonly joinCode: string | null;
  readonly joinUrl: string | null;
  readonly busy: boolean;
  readonly onCopyCode: () => void;
  readonly onCopyLink: () => void;
  readonly onRotate: () => void;
  readonly onRevoke: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  // Escape closes it: a teacher leaving this screen is usually in a hurry and
  // is not looking for a button.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="class-share"
      role="dialog"
      aria-modal="true"
      aria-label={`Вход в класс ${title}`}
    >
      <header className="class-share-head">
        <span>{title}</span>
        <button type="button" className="class-share-close" onClick={onClose}>
          Закрыть
        </button>
      </header>

      {joinCode ? (
        <div className="class-share-body">
          <p className="class-share-lead">Откройте ASA Lab и введите код класса</p>
          {/* Three groups, not one string: at the size this needs to be, a
              single line would run off a narrow screen, and a code read aloud
              is read in threes anyway. */}
          <p className="class-share-code" data-testid="class-share-code">
            {joinCode.split(' ').map((group, index) => (
              <Fragment key={`${group}-${index}`}>
                {index > 0 ? ' ' : null}
                <span>{group}</span>
              </Fragment>
            ))}
          </p>
          {joinUrl ? (
            <div className="class-share-qr">
              <ClassJoinQr url={joinUrl} label={`Ссылка на класс ${title}`} />
              <span>или наведите камеру</span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="class-share-body">
          <p className="class-share-lead">Вход по коду закрыт</p>
          <p className="class-share-note">
            Ученики, которые уже вошли, сохраняют доступ. Откройте вход, чтобы впустить новых.
          </p>
        </div>
      )}

      <footer className="class-share-actions">
        {joinCode ? (
          <>
            <button type="button" className="btn-secondary" onClick={onCopyCode}>
              Копировать код
            </button>
            {joinUrl ? (
              <button type="button" className="btn-secondary" onClick={onCopyLink}>
                Копировать ссылку
              </button>
            ) : null}
          </>
        ) : null}
        <button type="button" className="btn-secondary" disabled={busy} onClick={onRotate}>
          {joinCode ? 'Сменить код' : 'Открыть вход'}
        </button>
        {joinCode ? (
          <button type="button" className="btn-ghost danger" disabled={busy} onClick={onRevoke}>
            Закрыть вход
          </button>
        ) : null}
      </footer>
    </div>
  );
}
