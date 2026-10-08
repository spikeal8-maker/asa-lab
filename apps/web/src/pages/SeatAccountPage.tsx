import { PresentationControls, usePresentation } from '../components/PresentationPreferences';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  requestSettingsNavigation,
  pushSettingsAwareLocation,
  settingsPanelFromLocation,
  useSettingsDraftGuard,
  type SettingsDraft,
} from '../components/settings-navigation';
import { api, type ClassroomStudentSession, type SeatAward } from '../api';
import { requestAvatarChooser } from '../components/avatar-chooser-events';
import { InfoHint } from '../components/InfoHint';
import { seatAvatar } from '../creator-portal/default-avatars';
import { LearningNotificationPreferences } from '../components/LearningNotificationPreferences';
import { awardOf } from '../components/SeatAwards';
import '../components/seat-awards.css';
import '../components/seat-avatar.css';

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
export function SeatAccountPage({ seat }: { readonly seat: ClassroomStudentSession }): JSX.Element {
  const [awards, setAwards] = useState<SeatAward[] | null>(null);
  const [awardsError, setAwardsError] = useState(false);
  const [panel, setPanel] = useState(() => settingsPanelFromLocation());
  const [notificationsDirty, setNotificationsDirty] = useState(false);
  const notificationControl = useRef<SettingsDraft | null>(null);
  const awardsGeneration = useRef(0);
  const loadAwards = useCallback(async () => {
    const generation = ++awardsGeneration.current;
    setAwardsError(false);
    try {
      const result = await api.mySeatAwards();
      if (generation !== awardsGeneration.current) return;
      if (result.ok) setAwards(result.data.items);
      else setAwardsError(true);
    } catch {
      if (generation === awardsGeneration.current) setAwardsError(true);
    }
  }, []);
  const presentation = usePresentation();
  const draftDialog = useSettingsDraftGuard([
    presentation,
    {
      dirty: notificationsDirty,
      save: async () => (await notificationControl.current?.save()) ?? false,
      discard: () => notificationControl.current?.discard(),
    },
  ]);
  const panels = [
    { id: 'profile', label: 'Мой профиль' },
    { id: 'interface', label: 'Интерфейс' },
    { id: 'notifications', label: 'Уведомления' },
  ] as const;
  const selectedPanel = panels.some((item) => item.id === panel) ? panel : 'profile';
  function changePanel(next: (typeof panels)[number]['id']) {
    if (next === selectedPanel) return;
    requestSettingsNavigation(() => {
      setPanel(next);
      pushSettingsAwareLocation(`#/account/${next}`);
      window.dispatchEvent(new Event('settings-route'));
    });
  }

  useEffect(() => {
    void loadAwards();
    const sync = () => setPanel(settingsPanelFromLocation());
    window.addEventListener('settings-route', sync);
    return () => {
      awardsGeneration.current += 1;
      window.removeEventListener('settings-route', sync);
    };
  }, [loadAwards]);

  return (
    <main id="main-content" className="account-page account-settings-page" tabIndex={-1}>
      <header className="account-heading">
        <h1>Настройки</h1>
      </header>

      <div className="account-settings-shell">
        <label className="account-mobile-panel-picker">
          <select
            aria-label="Выбрать раздел настроек"
            value={selectedPanel}
            onChange={(event) => changePanel(event.target.value as (typeof panels)[number]['id'])}
          >
            {panels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <aside className="account-settings-navigation" aria-label="Разделы настроек">
          <nav>
            {panels.map((item) => (
              <button
                key={item.id}
                type="button"
                className={selectedPanel === item.id ? 'active' : undefined}
                aria-current={selectedPanel === item.id ? 'page' : undefined}
                onClick={() => changePanel(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="account-settings-content">
          <div hidden={selectedPanel !== 'notifications'}>
            <section className="account-settings-section" aria-label="Уведомления">
              <h2 className="account-panel-title">Уведомления</h2>
              <LearningNotificationPreferences
                seat
                teaching={false}
                controlRef={notificationControl}
                onDirtyChange={setNotificationsDirty}
              />
            </section>
          </div>
          {selectedPanel === 'interface' ? (
            <section className="account-settings-section" aria-label="Интерфейс">
              <h2 className="account-panel-title">Интерфейс</h2>
              <PresentationControls />
              <p>Дата и время показаны в часовом поясе класса. Его настраивает преподаватель.</p>
              <a className="btn-secondary" href="#/help">
                Помощь
              </a>
            </section>
          ) : null}
          <div hidden={selectedPanel !== 'profile'}>
            <section className="account-settings-section" aria-labelledby="seat-profile-title">
              <h2 id="seat-profile-title" className="account-panel-title">
                Профиль
              </h2>

              <div className="seat-avatar-current">
                <button
                  type="button"
                  className="account-avatar-preview-button"
                  aria-label="Выбрать аватар"
                  onClick={() => requestAvatarChooser({ kind: 'seat', id: seat.student.seatId })}
                >
                  <img
                    src={seatAvatar(seat.student.seatId, seat.student.avatarKey).src}
                    alt="Аватар"
                    width={72}
                    height={72}
                  />
                </button>
                <InfoHint label="Информация об аватаре">
                  Нажмите на аватар, выберите картинку и подтвердите кнопкой «Использовать». Её
                  увидят в вашем классе и рядом с вашими работами. Для профиля ученика доступны
                  готовые аватары; загрузка своего изображения недоступна.
                </InfoHint>
              </div>

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
                Чтобы изменить имя или вход, попросите преподавателя — он делает это в списке
                класса.
              </p>
            </section>

            {/* What the teacher has noticed. First on the page after the picture,
              because it is the reason a child opens this at all. */}
            <section className="account-settings-section" aria-labelledby="seat-awards-heading">
              <div className="account-section-heading">
                <p className="account-card-kicker">Достижения</p>
                <h2 id="seat-awards-heading">Мои значки</h2>
                <p>Их выдаёт преподаватель за то, что у вас получилось.</p>
              </div>
              {awardsError ? (
                <div role="alert">
                  <p>Не удалось загрузить значки. Ваши достижения сохранены.</p>
                  <button type="button" className="btn-secondary" onClick={() => void loadAwards()}>
                    Повторить загрузку значков
                  </button>
                </div>
              ) : awards === null ? (
                <p role="status">Загружаем…</p>
              ) : awards.length === 0 ? (
                <p className="account-hint">
                  Пока ни одного. Значки появляются за работы, идеи и помощь другим.
                </p>
              ) : (
                <ul className="seat-award-earned" data-testid="seat-awards-earned">
                  {awards.map((award) => {
                    const meta = awardOf(award.awardKey);
                    return (
                      <li key={award.awardKey}>
                        <i aria-hidden="true">{meta?.glyph ?? '🏅'}</i>
                        <span>
                          <strong>{meta?.label ?? award.awardKey}</strong>
                          {award.note ? <small>{award.note}</small> : null}
                          <em>{award.awardedBy}</em>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
      {draftDialog}
    </main>
  );
}
