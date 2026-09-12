import type { CheckersBotDefinition, CheckersBotId, CheckersSide } from '@asa-lab/checkers';

export type CheckersBotSideChoice = CheckersSide | 'random';

export function resolveCheckersBotSideChoice(
  choice: CheckersBotSideChoice,
  randomValue = Math.random(),
): CheckersSide {
  if (choice !== 'random') return choice;
  return randomValue < 0.5 ? 'light' : 'dark';
}

export function CheckersBotSetup({
  bots,
  selectedBotId,
  sideChoice,
  onSideChoice,
  onStart,
  onOpenCampaign,
  onBack,
}: {
  bots: readonly CheckersBotDefinition[];
  selectedBotId: CheckersBotId;
  sideChoice: CheckersBotSideChoice;
  onSideChoice: (choice: CheckersBotSideChoice) => void;
  onStart: (botId: CheckersBotId) => void;
  onOpenCampaign: () => void;
  onBack: () => void;
}): JSX.Element {
  const selected = bots.find((bot) => bot.id === selectedBotId) ?? bots[0]!;
  return (
    <main className="checkers-learning-shell checkers-bot-setup" id="main-content" tabIndex={-1}>
      <header className="checkers-surface-heading">
        <div>
          <button type="button" className="checkers-link-button" onClick={onBack}>
            ← На главную шашек
          </button>
          <span className="checkers-kicker">Свободная игра</span>
          <h1>Выберите соперника и начинайте партию</h1>
          <p>
            Здесь нет учебных блокировок: любой бот доступен сразу. Лестница прогресса живёт
            отдельно.
          </p>
        </div>
      </header>

      <section className="checkers-bot-quick-start" aria-labelledby="checkers-bot-quick-title">
        <div>
          <span className="checkers-home-eyebrow">Быстрый старт</span>
          <h2 id="checkers-bot-quick-title">{selected.displayName}</h2>
          <p>{selected.description}</p>
        </div>
        <button
          type="button"
          className="checkers-primary-action"
          onClick={() => onStart(selected.id)}
        >
          Начать игру
        </button>
      </section>
      <fieldset className="checkers-side-choice checkers-free-side-choice">
        <legend>Какими шашками играть?</legend>
        <label>
          <input
            type="radio"
            name="checkers-free-side"
            value="light"
            checked={sideChoice === 'light'}
            onChange={() => onSideChoice('light')}
          />
          Светлыми — первый ход ваш
        </label>
        <label>
          <input
            type="radio"
            name="checkers-free-side"
            value="dark"
            checked={sideChoice === 'dark'}
            onChange={() => onSideChoice('dark')}
          />
          Тёмными — первым ходит бот
        </label>
        <label>
          <input
            type="radio"
            name="checkers-free-side"
            value="random"
            checked={sideChoice === 'random'}
            onChange={() => onSideChoice('random')}
          />
          Случайно — сторона выбирается при старте
        </label>
      </fieldset>
      <section className="checkers-bot-grid" aria-label="Свободные соперники ASA Bot">
        {bots.map((bot) => (
          <article key={bot.id} className="checkers-bot-card">
            <span className="checkers-bot-rung">Уровень {bot.rung}</span>
            <div className="checkers-bot-token" aria-hidden="true">
              {bot.rung}
            </div>
            <h2>{bot.displayName}</h2>
            <p>{bot.description}</p>
            <small>
              {bot.id === selectedBotId
                ? 'Последний выбранный соперник.'
                : bot.rung <= 2
                  ? 'Спокойный уровень для быстрой партии.'
                  : bot.rung <= 4
                    ? 'Тактика и комбинации средней сложности.'
                    : 'Сильная позиционная и тактическая игра.'}
            </small>
            <button type="button" onClick={() => onStart(bot.id)}>
              Играть с {bot.displayName}
            </button>
          </article>
        ))}
      </section>

      <section className="checkers-bot-campaign-link" aria-label="Учебная лестница ботов">
        <div>
          <span className="checkers-home-eyebrow">Хотите проходить уровни?</span>
          <h2>Лестница ASA Bot</h2>
          <p>
            Учебная кампания по-прежнему открывает соперников последовательно и сохраняет прогресс.
          </p>
        </div>
        <button type="button" className="checkers-link-button" onClick={onOpenCampaign}>
          Открыть лестницу
        </button>
      </section>
    </main>
  );
}
