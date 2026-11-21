import { useState } from 'react';
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
  const [chosen, setChosen] = useState<CheckersBotId>(selectedBotId);
  const selected = bots.find((bot) => bot.id === chosen) ?? bots[0]!;
  return (
    <main className="checkers-compact-setup" id="main-content" tabIndex={-1}>
      <header className="checkers-compact-heading">
        <button type="button" onClick={onBack}>
          ← Шашки
        </button>
        <h1>Игра с компьютером</h1>
      </header>
      <section className="checkers-setup-card">
        <fieldset className="checkers-difficulty">
          <legend>Уровень сложности</legend>
          {(['iskra', 'taktik', 'master'] as const).map((id, index) => (
            <label key={id}>
              <input
                type="radio"
                name="checkers-difficulty"
                checked={chosen === id}
                onChange={() => setChosen(id)}
              />
              {['Лёгкий', 'Средний', 'Сложный'][index]}
            </label>
          ))}
        </fieldset>
        <p>
          <strong>{selected.displayName}</strong> · {selected.description}
        </p>
        <fieldset className="checkers-difficulty">
          <legend>Какими шашками играть?</legend>
          {(['light', 'dark', 'random'] as const).map((side, index) => (
            <label key={side}>
              <input
                type="radio"
                name="checkers-side"
                checked={sideChoice === side}
                onChange={() => onSideChoice(side)}
              />
              {['Светлыми', 'Тёмными', 'Случайный цвет'][index]}
            </label>
          ))}
        </fieldset>
        <button type="button" className="checkers-primary-action" onClick={() => onStart(chosen)}>
          Начать партию
        </button>
        <details>
          <summary>Все боты и учебная лестница</summary>
          {bots.map((bot) => (
            <button
              type="button"
              key={bot.id}
              aria-pressed={chosen === bot.id}
              onClick={() => setChosen(bot.id)}
            >
              {bot.displayName} · уровень {bot.rung}
            </button>
          ))}
          <button type="button" onClick={onOpenCampaign}>
            Открыть учебную лестницу
          </button>
        </details>
      </section>
    </main>
  );
}
