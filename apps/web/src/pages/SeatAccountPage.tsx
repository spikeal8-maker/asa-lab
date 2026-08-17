import { useState } from 'react';
import { api, type ClassroomStudentSession } from '../api';
import { SeatAvatarPicker } from '../components/SeatAvatarPicker';

/**
 * A learner's own settings.
 *
 * Same page as a teacher's, in the sense that matters: the same shell, the same
 * headings, the same panel — so a child who later gets an account of their own
 * is already in a place they know. What differs is how little a seat owns. Its
 * name and its login are the teacher's to set, because a register a child can
 * rename is not a register. Its picture is not: a face you did not choose is
 * somebody else's idea of you, and choosing one is the first thing anybody does
 * in a product like this.
 */
export function SeatAccountPage({
  seat,
  onSeatChanged,
}: {
  readonly seat: ClassroomStudentSession;
  readonly onSeatChanged: (seat: ClassroomStudentSession) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(avatarKey: string | null): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await api.setClassroomSeatAvatar(avatarKey);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось сохранить аватар.');
      return;
    }
    onSeatChanged(result.data);
    setNotice(avatarKey ? 'Аватар сохранён.' : 'Вернули аватар по умолчанию.');
  }

  return (
    <main id="main-content" className="account-page account-settings-page" tabIndex={-1}>
      <header className="account-heading">
        <p className="portal-eyebrow">Настройки</p>
        <h1>Мой профиль</h1>
        <p>Здесь можно выбрать аватар. Имя и вход в класс настраивает преподаватель.</p>
      </header>

      <div className="account-settings-shell">
        <aside className="account-settings-navigation" aria-label="Разделы настроек">
          <strong>Настройки</strong>
          <nav>
            <button type="button" className="active" aria-current="page">
              <span aria-hidden="true">👤</span>
              Профиль
            </button>
          </nav>
        </aside>

        <div className="account-settings-content">
          {error ? (
            <p className="account-message error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="account-message success" role="status">
              {notice}
            </p>
          ) : null}

          <section className="account-settings-section" aria-labelledby="seat-profile-title">
            <div className="account-section-heading">
              <p className="account-card-kicker">Профиль</p>
              <h2 id="seat-profile-title">Как вас видят в классе</h2>
              <p>Аватар появится в списке класса и рядом с вашими работами.</p>
            </div>

            <SeatAvatarPicker
              seatId={seat.student.seatId}
              value={seat.student.avatarKey}
              busy={busy}
              onChange={(key) => void choose(key)}
            />

            <dl className="seat-account-facts">
              <div>
                <dt>Имя в классе</dt>
                <dd>{seat.student.displayName}</dd>
              </div>
              <div>
                <dt>Класс</dt>
                <dd>{seat.classroom.title}</dd>
              </div>
              <div>
                <dt>Преподаватель</dt>
                <dd>{seat.classroom.teacherDisplayName}</dd>
              </div>
              <div>
                <dt>Безопасный режим</dt>
                <dd>{seat.student.safeMode ? 'Включён' : 'Выключен'}</dd>
              </div>
            </dl>
            <p className="account-hint">
              Чтобы изменить имя или вход, попросите преподавателя — он делает это в списке класса.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
