import { EditorHeader } from '../components/editor-chrome/EditorHeader';
import './checkers.css';

export interface CheckersHomeCard {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly progressLabel?: string;
  readonly progressPercent?: number;
  readonly actionLabel: string;
}

export interface CheckersStudentHomeViewModel {
  readonly studentName: string;
  readonly recommendation: CheckersHomeCard;
  readonly assignments: readonly CheckersHomeCard[];
  readonly reviewCount: number;
  readonly learningUnit: number;
  readonly learningUnitsTotal: number;
  readonly masteryPercent: number;
  readonly currentBotName: string;
  readonly botRung: number;
  readonly botRungsTotal: number;
  readonly classPlayAvailable: boolean;
  readonly teacherFeedback?: string;
}

function Progress({ value, label }: { value: number; label: string }): JSX.Element {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="checkers-progress" aria-label={`${label}: ${clamped}%`}>
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}

function HomeCard({
  card,
  featured = false,
  onOpen,
}: {
  card: CheckersHomeCard;
  featured?: boolean;
  onOpen: (id: string) => void;
}): JSX.Element {
  return (
    <article className={`checkers-home-card${featured ? ' featured' : ''}`}>
      <span className="checkers-home-eyebrow">{card.eyebrow}</span>
      <h3>{card.title}</h3>
      <p>{card.description}</p>
      {card.progressPercent !== undefined ? (
        <>
          <Progress value={card.progressPercent} label={card.progressLabel ?? card.title} />
          <small>{card.progressLabel}</small>
        </>
      ) : null}
      <button type="button" onClick={() => onOpen(card.id)}>
        {card.actionLabel}
      </button>
    </article>
  );
}

export function CheckersStudentHome({
  model,
  projectTitle,
  onBack,
  onOpen,
}: {
  model: CheckersStudentHomeViewModel;
  projectTitle: string;
  onBack: () => void;
  onOpen: (id: string) => void;
}): JSX.Element {
  return (
    <>
      <EditorHeader
        moduleId="checkers"
        onExit={onBack}
        exitLabel="Вернуться к проектам ASA Lab"
        title={{ kind: 'readonly', text: projectTitle }}
        status={{ kind: 'saved', label: 'Прогресс сохранён', icon: '✓' }}
        navigation={{
          ariaLabel: 'Разделы шашек',
          items: [
            { id: 'learning', label: 'Обучение', onActivate: () => onOpen('learning-path') },
            { id: 'bots', label: 'Боты', onActivate: () => onOpen('bot-ladder') },
            {
              id: 'class',
              label: 'Класс',
              disabled: !model.classPlayAvailable,
              onActivate: () => onOpen('class-play'),
            },
          ],
        }}
        avatar={{ label: model.studentName, text: model.studentName.slice(0, 2).toUpperCase() }}
      />
      <main className="checkers-home" id="main-content" tabIndex={-1}>
        <section className="checkers-home-welcome" aria-labelledby="checkers-home-title">
          <div>
            <span className="checkers-kicker">ASA Шашки</span>
            <h1 id="checkers-home-title">{model.studentName}, твой следующий ход</h1>
            <p>Здесь собраны задания, обучение, игры и повторение — ничего не потеряется.</p>
          </div>
          <div
            className="checkers-mastery-ring"
            aria-label={`Общее освоение ${model.masteryPercent}%`}
          >
            <strong>{model.masteryPercent}%</strong>
            <span>освоено</span>
          </div>
        </section>

        {model.teacherFeedback ? (
          <section className="checkers-teacher-feedback" aria-labelledby="checkers-feedback-title">
            <span className="checkers-home-eyebrow">От педагога</span>
            <h2 id="checkers-feedback-title">Учебная рекомендация</h2>
            <p>{model.teacherFeedback}</p>
          </section>
        ) : null}

        <section className="checkers-home-primary" aria-label="Рекомендованное действие">
          <HomeCard card={model.recommendation} featured onOpen={onOpen} />
          <div className="checkers-home-stats">
            <button type="button" onClick={() => onOpen('learning-path')}>
              <span>Путь обучения</span>
              <strong>
                {model.learningUnit} / {model.learningUnitsTotal}
              </strong>
              <small>текущий модуль</small>
            </button>
            <button type="button" onClick={() => onOpen('review-queue')}>
              <span>Повторить</span>
              <strong>{model.reviewCount}</strong>
              <small>коротких заданий</small>
            </button>
            <button type="button" onClick={() => onOpen('bot-ladder')}>
              <span>Соперник</span>
              <strong>{model.currentBotName}</strong>
              <small>
                уровень {model.botRung} из {model.botRungsTotal}
              </small>
            </button>
          </div>
        </section>

        <section className="checkers-home-section" aria-labelledby="checkers-assignments-title">
          <div className="checkers-section-heading">
            <div>
              <span className="checkers-home-eyebrow">От педагога</span>
              <h2 id="checkers-assignments-title">Мои задания</h2>
            </div>
            <button
              type="button"
              className="checkers-link-button"
              onClick={() => onOpen('assignments')}
            >
              Все задания
            </button>
          </div>
          {model.assignments.length > 0 ? (
            <div className="checkers-home-grid">
              {model.assignments.slice(0, 3).map((card) => (
                <HomeCard key={card.id} card={card} onOpen={onOpen} />
              ))}
            </div>
          ) : (
            <div className="checkers-home-empty">
              <strong>Новых заданий пока нет</strong>
              <span>Можно продолжить свой учебный путь или сыграть с ботом.</span>
            </div>
          )}
        </section>

        <section className="checkers-class-card" aria-labelledby="checkers-class-title">
          <div>
            <span className="checkers-home-eyebrow">Игра в классе</span>
            <h2 id="checkers-class-title">Вместе — без открытого чата</h2>
            <p>Можно принять вызов одноклассника и отправлять только добрые готовые реакции.</p>
          </div>
          <button
            type="button"
            disabled={!model.classPlayAvailable}
            onClick={() => onOpen('class-play')}
          >
            {model.classPlayAvailable ? 'Открыть игры класса' : 'Сейчас нет доступных игр'}
          </button>
        </section>
      </main>
    </>
  );
}
