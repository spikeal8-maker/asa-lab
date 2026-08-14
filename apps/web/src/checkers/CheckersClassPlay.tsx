import type { CheckersClassPlay as CheckersClassPlayModel } from '../api';
import type { CheckersDocument } from '@asa-lab/checkers';
import './checkers.css';

function statusLabel(status: 'pending' | 'active' | 'declined' | 'finished'): string {
  if (status === 'pending') return 'Ожидает ответа';
  if (status === 'active') return 'Идёт партия';
  if (status === 'finished') return 'Завершена';
  return 'Отклонена';
}

export function CheckersClassPlay({
  model,
  onBack,
  onChallenge,
  onAccept,
  onOpenGame,
}: {
  model: CheckersClassPlayModel<CheckersDocument>;
  onBack: () => void;
  onChallenge: (opponentId: string, mode: 'friendly' | 'team') => Promise<boolean>;
  onAccept: (gameId: string) => Promise<boolean>;
  onOpenGame: (gameId: string) => void;
}): JSX.Element {
  return (
    <main className="checkers-class-play" id="main-content" tabIndex={-1}>
      <header className="checkers-surface-heading">
        <div>
          <button type="button" className="checkers-link-button" onClick={onBack}>
            ← На главную шашек
          </button>
          <span className="checkers-kicker">Игра в классе</span>
          <h1>Вызовы только своим одноклассникам</h1>
          <p>Игры видны участникам и педагогу. Сообщений, ссылок и картинок здесь нет.</p>
        </div>
      </header>

      <section className="checkers-safety-card" aria-labelledby="checkers-safety-title">
        <div>
          <span aria-hidden="true">✓</span>
          <div>
            <h2 id="checkers-safety-title">Безопасное общение</h2>
            <p>
              Только шесть готовых добрых реакций. Их можно скрыть, а любой эпизод — передать
              педагогу одним нажатием без свободного текста.
            </p>
          </div>
        </div>
      </section>

      <section className="checkers-class-section" aria-labelledby="checkers-classmates-title">
        <div className="checkers-section-heading">
          <div>
            <span className="checkers-home-eyebrow">Мой класс</span>
            <h2 id="checkers-classmates-title">Одноклассники</h2>
          </div>
        </div>
        {model.classmates.length > 0 ? (
          <div className="checkers-classmate-grid">
            {model.classmates.map((classmate) => (
              <article key={classmate.id}>
                <div className="checkers-classmate-avatar" aria-hidden="true">
                  {classmate.displayName.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <h3>{classmate.displayName}</h3>
                  <p>Участник этого класса</p>
                </div>
                <div>
                  <button
                    type="button"
                    className="checkers-primary-action"
                    onClick={() => void onChallenge(classmate.id, 'friendly')}
                  >
                    Дружеский вызов
                  </button>
                  <button
                    type="button"
                    className="checkers-link-button"
                    onClick={() => void onChallenge(classmate.id, 'team')}
                  >
                    Командная цель
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="checkers-home-empty">
            <strong>Пока нет другого ученика</strong>
            <span>Педагог может добавить существующий аккаунт в этот шашечный класс.</span>
          </div>
        )}
      </section>

      <section className="checkers-class-section" aria-labelledby="checkers-class-games-title">
        <div className="checkers-section-heading">
          <div>
            <span className="checkers-home-eyebrow">Только мои партии</span>
            <h2 id="checkers-class-games-title">Вызовы и игры</h2>
          </div>
        </div>
        {model.games.length > 0 ? (
          <div className="checkers-class-game-list">
            {model.games.map((game) => {
              const opponent = game.side === 'light' ? game.darkPlayer : game.lightPlayer;
              const mayAccept = game.status === 'pending' && game.side === 'dark';
              const mayOpen = game.status === 'active' || game.status === 'finished';
              return (
                <article key={game.id}>
                  <div>
                    <span className={`checkers-class-game-status ${game.status}`}>
                      {statusLabel(game.status)}
                    </span>
                    <h3>{opponent.displayName}</h3>
                    <p>
                      {game.mode === 'team'
                        ? 'Командная цель'
                        : game.mode === 'teacher-event'
                          ? 'Матч педагога'
                          : 'Дружеская партия'}{' '}
                      · вы играете {game.side === 'light' ? 'светлыми' : 'тёмными'}
                    </p>
                  </div>
                  {mayAccept ? (
                    <button
                      type="button"
                      className="checkers-primary-action"
                      onClick={() => void onAccept(game.id)}
                    >
                      Принять вызов
                    </button>
                  ) : mayOpen ? (
                    <button
                      type="button"
                      className="checkers-primary-action"
                      onClick={() => onOpenGame(game.id)}
                    >
                      {game.status === 'finished' ? 'Открыть разбор' : 'Открыть партию'}
                    </button>
                  ) : (
                    <span>Ждём одноклассника</span>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="checkers-home-empty">
            <strong>Вызовов пока нет</strong>
            <span>Выберите одноклассника выше. Участники всегда остаются внутри класса.</span>
          </div>
        )}
      </section>
    </main>
  );
}
