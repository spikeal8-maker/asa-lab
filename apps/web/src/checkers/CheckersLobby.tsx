import { EditorHeader } from '../components/editor-chrome/EditorHeader';
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
interface CheckersLobbyMode {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly marker: string;
  readonly disabled?: boolean;
  readonly featured?: boolean;
}

function ModeCard({
  mode,
  onOpen,
}: {
  mode: CheckersLobbyMode;
  onOpen: (id: string) => void;
}): JSX.Element {
  return (
    <article
      className={`checkers-lobby-mode${mode.featured ? ' featured' : ''}${mode.disabled ? ' disabled' : ''}`}
    >
      <div className="checkers-lobby-mode-marker" aria-hidden="true">
        {mode.marker}
      </div>
      <span className="checkers-home-eyebrow">{mode.eyebrow}</span>
      <h3>{mode.title}</h3>
      <p>{mode.description}</p>
      <button type="button" disabled={mode.disabled} onClick={() => onOpen(mode.id)}>
        {mode.actionLabel}
      </button>
    </article>
  );
}

function AssignmentCard({
  assignment,
  onOpen,
}: {
  assignment: CheckersLobbyAssignment;
  onOpen: (id: string) => void;
}): JSX.Element {
  return (
    <article className="checkers-home-card">
      <span className="checkers-home-eyebrow">От преподавателя</span>
      <h3>{assignment.title}</h3>
      <p>{assignment.description}</p>
      <button type="button" onClick={() => onOpen(assignment.id)}>
        Открыть
      </button>
    </article>
  );
}
export function CheckersLobby({
  model,
  projectTitle,
  onBack,
  onOpen,
}: {
  model: CheckersLobbyViewModel;
  projectTitle: string;
  onBack: () => void;
  onOpen: (id: string) => void;
}): JSX.Element {
  const modes: readonly CheckersLobbyMode[] = [
    {
      id: 'bot-play',
      eyebrow: 'Доступно сейчас',
      title: 'Играть с ботом',
      description: `Выберите соперника. Сейчас выбран ${model.currentBotName}.`,
      actionLabel: 'Выбрать бота',
      marker: 'BOT',
      featured: true,
    },
    {
      id: 'local-play',
      eyebrow: 'Следующий этап',
      title: 'Играть вдвоём',
      description: 'Два игрока за одним устройством без класса и без отдельной комнаты.',
      actionLabel: 'Будет в CK-103',
      marker: '2×',
      disabled: true,
    },
    {
      id: 'friend-play',
      eyebrow: 'Онлайн · следующий этап',
      title: 'Играть с другом',
      description: 'Приватная игра по ссылке или короткому коду без открытого чата.',
      actionLabel: 'Будет в CK-106',
      marker: '#',
      disabled: true,
    },
    {
      id: 'class-play',
      eyebrow: model.classPlayAvailable ? 'Ваш класс' : 'Нужен проект класса',
      title: 'Играть в классе',
      description: model.classPlayAvailable
        ? `${model.classGameCount} открытых игр или вызовов. Только участники вашего класса.`
        : 'Вызовы одноклассников доступны внутри проекта, привязанного к классу.',
      actionLabel: model.classPlayAvailable ? 'Открыть игры класса' : 'Недоступно здесь',
      marker: 'КЛ',
      disabled: !model.classPlayAvailable,
    },
    {
      id: 'learning-path',
      eyebrow: model.learningProgressLabel,
      title: 'Задачи и обучение',
      description: 'Правила, обязательные взятия, дамки и комбинации — отдельно от обычной игры.',
      actionLabel: 'Открыть задачи',
      marker: '✓',
    },
    {
      id: 'history',
      eyebrow: 'После единой модели матчей',
      title: 'Мои партии',
      description: 'История сыгранных партий, повторный просмотр и разбор появятся после CK-105.',
      actionLabel: 'Пока недоступно',
      marker: '↺',
      disabled: true,
    },
  ];

  return (
    <>
      <EditorHeader
        moduleId="checkers"
        onExit={onBack}
        exitLabel="Вернуться к играм ASA Lab"
        title={{ kind: 'readonly', text: projectTitle }}
        status={{ kind: 'saved', label: 'Прогресс сохранён', icon: '✓' }}
        navigation={{
          ariaLabel: 'Разделы шашек',
          items: [
            { id: 'learning', label: 'Задачи', onActivate: () => onOpen('learning-path') },
            { id: 'bots', label: 'Боты', onActivate: () => onOpen('bot-play') },
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
      <main className="checkers-home checkers-lobby" id="main-content" tabIndex={-1}>
        <section className="checkers-lobby-hero" aria-labelledby="checkers-lobby-title">
          <div>
            <span className="checkers-kicker">ASA Шашки</span>
            <h1 id="checkers-lobby-title">Выберите, как хотите играть</h1>
            <p>
              {model.studentName}, здесь партия, задачи и класс разделены. Никаких скрытых шагов
              перед началом игры.
            </p>
          </div>
          <div className="checkers-lobby-progress" aria-label={model.learningProgressLabel}>
            <strong>{model.learningProgressPercent}%</strong>
            <span>{model.learningProgressLabel}</span>
          </div>
        </section>

        {model.resume ? (
          <section className="checkers-resume-card" aria-labelledby="checkers-resume-title">
            <div>
              <span className="checkers-home-eyebrow">Незавершённая партия</span>
              <h2 id="checkers-resume-title">{model.resume.title}</h2>
              <p>{model.resume.detail}</p>
            </div>
            <button type="button" onClick={() => onOpen(model.resume!.id)}>
              Продолжить партию
            </button>
          </section>
        ) : null}

        <section className="checkers-lobby-section" aria-labelledby="checkers-modes-title">
          <div className="checkers-section-heading">
            <div>
              <span className="checkers-home-eyebrow">Играть</span>
              <h2 id="checkers-modes-title">Режимы шашек</h2>
            </div>
          </div>
          <div className="checkers-lobby-mode-grid">
            {modes.map((mode) => (
              <ModeCard key={mode.id} mode={mode} onOpen={onOpen} />
            ))}
          </div>
        </section>

        {model.teacherFeedback ? (
          <section className="checkers-teacher-feedback" aria-labelledby="checkers-feedback-title">
            <span className="checkers-home-eyebrow">От преподавателя</span>
            <h2 id="checkers-feedback-title">Учебная рекомендация</h2>
            <p>{model.teacherFeedback}</p>
          </section>
        ) : null}

        {model.assignments.length > 0 ? (
          <section className="checkers-home-section" aria-labelledby="checkers-assignments-title">
            <div className="checkers-section-heading">
              <div>
                <span className="checkers-home-eyebrow">От преподавателя</span>
                <h2 id="checkers-assignments-title">Назначенные задания</h2>
              </div>
            </div>
            <div className="checkers-home-grid">
              {model.assignments.slice(0, 3).map((assignment) => (
                <AssignmentCard key={assignment.id} assignment={assignment} onOpen={onOpen} />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
