import { createInitialCheckersDocument, type CheckersDocument } from '@asa-lab/checkers';
import { CheckersBoardV2 } from './CheckersBoardV2';
import './checkers-parity.css';
import './checkers.css';

export interface CheckersLobbyAssignment {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export interface CheckersLobbyResume {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
}

export interface CheckersLobbyViewModel {
  readonly studentName: string;
  readonly resume?: CheckersLobbyResume;
  readonly assignments: readonly CheckersLobbyAssignment[];
  readonly learningProgressLabel: string;
  readonly learningProgressPercent: number;
  readonly currentBotName: string;
  readonly classPlayAvailable: boolean;
  readonly classGameCount: number;
  readonly teacherFeedback?: string;
}
const initial = createInitialCheckersDocument('game');
export function CheckersLobby({
  model,
  projectTitle,
  position = initial,
  onBack,
  onOpen,
}: {
  model: CheckersLobbyViewModel;
  projectTitle: string;
  position?: CheckersDocument;
  onBack(): void;
  onOpen(id: string): void;
}): JSX.Element {
  return (
    <main className="checkers-compact-home" id="main-content" tabIndex={-1}>
      <header className="checkers-compact-heading">
        <button type="button" aria-label="Вернуться к играм ASA Lab" onClick={onBack}>
          ← Игры
        </button>
        <h1>Шашки</h1>
      </header>
      <div className="checkers-compact-layout">
        <section className="checkers-compact-board" aria-label="Доска шашек">
          <CheckersBoardV2 pieces={position.pieces} disabled />
        </section>
        <section className="checkers-compact-actions" aria-label="Начать игру в шашки">
          <h2>С кем сыграем?</h2>
          <button
            className="checkers-primary-action"
            type="button"
            onClick={() => onOpen('bot-play')}
          >
            Играть с компьютером
          </button>
          <button type="button" onClick={() => onOpen('network')}>
            Играть с человеком
          </button>
          <button type="button" onClick={() => onOpen('local-play')}>
            Вдвоём на одном устройстве
          </button>
          {model.resume && (
            <button type="button" onClick={() => onOpen(model.resume!.id)}>
              Продолжить партию · {model.resume.title}
            </button>
          )}
          {model.resume && (
            <p>
              <strong>Незавершённая партия</strong>
              <br />
              {model.resume.title}
              <br />
              {model.resume.detail}
            </p>
          )}
          <p>Русские шашки · 64 клетки · обязательное взятие</p>
          <details>
            <summary>Обучение и задания</summary>
            <button type="button" onClick={() => onOpen('learning-path')}>
              Задачи и обучение
            </button>
            <p aria-label={model.learningProgressLabel}>{model.learningProgressLabel}</p>
            {model.classPlayAvailable && (
              <button type="button" onClick={() => onOpen('class-play')}>
                Открыть игры класса
              </button>
            )}
            {model.assignments.length > 0 && <h2>Назначенные задания</h2>}
            {model.assignments.map((item) => (
              <article key={item.id}>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                <button type="button" onClick={() => onOpen(item.id)}>
                  Открыть
                </button>
              </article>
            ))}
            {model.teacherFeedback && <p>{model.teacherFeedback}</p>}
          </details>
          <small>{projectTitle}</small>
        </section>
      </div>
    </main>
  );
}
