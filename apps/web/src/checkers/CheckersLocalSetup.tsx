export function CheckersLocalSetup({
  autoFlip,
  onAutoFlipChange,
  onStart,
  onBack,
}: {
  autoFlip: boolean;
  onAutoFlipChange: (enabled: boolean) => void;
  onStart: () => void;
  onBack: () => void;
}): JSX.Element {
  return (
    <main className="checkers-learning-shell checkers-local-setup" id="main-content" tabIndex={-1}>
      <header className="checkers-surface-heading">
        <div>
          <button type="button" className="checkers-link-button" onClick={onBack}>
            ← На главную шашек
          </button>
          <span className="checkers-kicker">Локальная партия</span>
          <h1>Два игрока за одним устройством</h1>
          <p>
            Светлые и тёмные ходят по очереди на этой же доске. Аккаунт второго игрока и подключение
            к классу не нужны.
          </p>
        </div>
      </header>
      <section className="checkers-local-players" aria-label="Стороны локальной партии">
        <article>
          <span className="checkers-local-piece light" aria-hidden="true" />
          <div>
            <span className="checkers-home-eyebrow">Игрок 1</span>
            <h2>Светлые</h2>
            <p>Делают первый ход.</p>
          </div>
        </article>
        <article>
          <span className="checkers-local-piece dark" aria-hidden="true" />
          <div>
            <span className="checkers-home-eyebrow">Игрок 2</span>
            <h2>Тёмные</h2>
            <p>Ходят после светлых.</p>
          </div>
        </article>
      </section>

      <section className="checkers-local-options" aria-labelledby="checkers-local-options-title">
        <div>
          <span className="checkers-home-eyebrow">Удобство за одним экраном</span>
          <h2 id="checkers-local-options-title">Поворачивать доску после хода</h2>
          <p>
            Если включено, после завершённого хода доска разворачивается к стороне, которая ходит
            следующей. В любой момент её всё равно можно перевернуть вручную.
          </p>
        </div>
        <label className="checkers-local-toggle">
          <input
            type="checkbox"
            checked={autoFlip}
            onChange={(event) => onAutoFlipChange(event.target.checked)}
          />
          <span>{autoFlip ? 'Автоповорот включён' : 'Автоповорот выключен'}</span>
        </label>
      </section>

      <section className="checkers-local-start">
        <div>
          <strong>Можно начинать сразу</strong>
          <p>Партия сохранится как незавершённая и сможет быть продолжена после перезагрузки.</p>
        </div>
        <button type="button" className="checkers-primary-action" onClick={onStart}>
          Начать локальную партию
        </button>
      </section>
    </main>
  );
}
