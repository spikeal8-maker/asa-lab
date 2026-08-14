import {
  ASA_CHESS_PUZZLES,
  parseFen,
  validateChessDocument,
  type ChessDocument,
  type ChessPosition,
} from '@asa-lab/chess';
import { useEffect, useState } from 'react';
import { api, type Project, type PublicUser } from '../api';
import { EditorHeader } from '../components/editor-chrome/EditorHeader';
import { ChessBoard } from './ChessBoard';
import { chessAvatarText } from './ChessEditorHeader';
import { buildChessHomeSummary } from './chess-home-ui';
import './chess-home.css';

interface ChessHomeProps {
  readonly projectId: string;
  readonly user: PublicUser;
  readonly onBack: () => void;
  readonly onOpenBoard: () => void;
  readonly onOpenOnline: () => void;
  readonly onOpenTraining: () => void;
  readonly onOpenLearning: () => void;
  readonly onOpenReview: () => void;
  readonly onOpenBot: () => void;
}

interface ChessHomeNavigationProps {
  readonly user: PublicUser;
  readonly onBack: () => void;
  readonly onOpenBoard: () => void;
  readonly onOpenOnline: () => void;
  readonly onOpenTraining: () => void;
  readonly onOpenLearning: () => void;
  readonly onOpenReview: () => void;
  readonly onOpenBot: () => void;
}

function ChessHomeNavigation(props: ChessHomeNavigationProps): JSX.Element {
  const items = [
    {
      label: 'Главная',
      note: 'Шахматный центр',
      icon: '♔',
      selected: true,
      action: () => undefined,
    },
    {
      label: 'Играть',
      note: 'Доска и партии',
      icon: '♞',
      selected: false,
      action: props.onOpenBoard,
    },
    {
      label: 'Онлайн',
      note: 'Вызовы и поиск',
      icon: '◉',
      selected: false,
      action: props.onOpenOnline,
    },
    {
      label: 'Задачи',
      note: 'Тактика и рейтинг',
      icon: '◆',
      selected: false,
      action: props.onOpenTraining,
    },
    {
      label: 'Учёба',
      note: 'Уроки ASA',
      icon: '▰',
      selected: false,
      action: props.onOpenLearning,
    },
    { label: 'Боты', note: '12 соперников', icon: '♟', selected: false, action: props.onOpenBot },
    {
      label: 'Разбор',
      note: 'Ошибки и повторы',
      icon: '◎',
      selected: false,
      action: props.onOpenReview,
    },
  ] as const;

  return (
    <aside className="asa-chess-home-sidebar">
      <div className="asa-chess-home-brand" aria-label="ASA Chess">
        <span aria-hidden="true">♞</span>
        <strong>ASA Chess</strong>
      </div>
      <nav aria-label="Меню ASA Chess">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            className={item.selected ? 'is-selected' : ''}
            aria-current={item.selected ? 'page' : undefined}
            aria-label={item.label}
            onClick={item.action}
          >
            <span className="asa-chess-home-nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.note}</small>
            </span>
          </button>
        ))}
      </nav>
      <div className="asa-chess-home-sidebar-footer">
        <button type="button" className="asa-chess-home-projects" onClick={props.onBack}>
          <span aria-hidden="true">←</span>
          <span>
            <strong>Все проекты</strong>
            <small>Вернуться в ASA Lab</small>
          </span>
        </button>
        <div className="asa-chess-home-user">
          <span>{chessAvatarText(props.user.displayName)}</span>
          <strong>{props.user.displayName}</strong>
        </div>
      </div>
    </aside>
  );
}

export function ChessHome(props: ChessHomeProps): JSX.Element {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocument] = useState<ChessDocument | null>(null);
  const [position, setPosition] = useState<ChessPosition | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    void api.openProject<ChessDocument>(props.projectId).then((response) => {
      if (!active) return;
      if (!response.ok) {
        setNotice(response.error.message || 'Шахматный центр не удалось открыть.');
        setState('error');
        return;
      }
      const parsedDocument = validateChessDocument(response.data.draft.document);
      if (!parsedDocument.ok) {
        setNotice(`Повреждён шахматный документ: ${parsedDocument.message}`);
        setState('error');
        return;
      }
      const parsedPosition = parseFen(parsedDocument.value.currentFen);
      if (!parsedPosition.ok) {
        setNotice(`Повреждена шахматная позиция: ${parsedPosition.message}`);
        setState('error');
        return;
      }
      setProject(response.data.project);
      setDocument(parsedDocument.value);
      setPosition(parsedPosition.value);
      setState('ready');
    });
    return () => {
      active = false;
    };
  }, [props.projectId]);

  if (state !== 'ready' || !document || !position || !project) {
    return (
      <main className="asa-chess-home-loading" role="status" aria-live="polite">
        {state === 'error' ? notice : 'Загружаем шахматный центр…'}
      </main>
    );
  }

  const summary = buildChessHomeSummary(document);
  const nextPuzzle =
    ASA_CHESS_PUZZLES.find((puzzle) => puzzle.id === summary.nextPuzzleId) ?? ASA_CHESS_PUZZLES[0]!;
  const puzzlePositionResult = parseFen(nextPuzzle.initialFen);
  const puzzlePosition = puzzlePositionResult.ok ? puzzlePositionResult.value : position;
  const firstName = props.user.displayName.trim().split(/\s+/)[0] || props.user.displayName;
  const latestMove = document.moves.at(-1)?.uci;

  return (
    <main className="asa-chess-home-shell">
      <EditorHeader
        moduleId="chess"
        onExit={props.onBack}
        exitLabel="Вернуться к проектам"
        title={{ kind: 'readonly', text: project.title }}
        status={{
          kind: 'saved',
          label: 'Синхронизировано',
          detail: `Прогресс задач ${summary.solvedPuzzles} из ${summary.totalPuzzles}`,
        }}
        actions={[
          {
            id: 'open-board',
            label: 'Открыть доску',
            emphasis: 'primary',
            onActivate: props.onOpenBoard,
          },
        ]}
        avatar={{
          label: `Пользователь ${props.user.displayName}`,
          text: chessAvatarText(props.user.displayName),
          title: props.user.displayName,
        }}
      />

      <div className="asa-chess-home-body">
        <ChessHomeNavigation {...props} />
        <section className="asa-chess-home-content" aria-labelledby="asa-chess-home-title">
          <header className="asa-chess-home-welcome">
            <div>
              <span>Шахматный центр ASA Lab</span>
              <h1 id="asa-chess-home-title">Добро пожаловать, {firstName}</h1>
              <p>Играйте, решайте задачи и разбирайте ошибки — весь прогресс хранится в проекте.</p>
            </div>
            <div className="asa-chess-home-rating" aria-label="Рейтинг задач">
              <span aria-hidden="true">♜</span>
              <div>
                <small>Рейтинг задач</small>
                <strong>{summary.puzzleRating}</strong>
              </div>
            </div>
          </header>

          <div className="asa-chess-home-hero-grid">
            <article className="asa-chess-home-card asa-chess-home-play-card">
              <div className="asa-chess-home-card-copy">
                <span className="asa-chess-home-kicker">Продолжить проект</span>
                <h2>Партия и анализ</h2>
                <p>
                  {summary.halfMoves === 0
                    ? 'Начните новую партию или откройте свободную доску.'
                    : `В текущей позиции записано ${summary.halfMoves} полуходов.`}
                </p>
                <div className="asa-chess-home-play-actions">
                  <button type="button" className="is-primary" onClick={props.onOpenBoard}>
                    <span aria-hidden="true">♞</span> Продолжить на доске
                  </button>
                  <button type="button" onClick={props.onOpenOnline}>
                    Играть онлайн
                  </button>
                  <button type="button" onClick={props.onOpenBot}>
                    Выбрать бота
                  </button>
                </div>
              </div>
              <div className="asa-chess-home-mini-board" aria-label="Текущая позиция проекта">
                <ChessBoard
                  position={position}
                  orientation={document.orientation}
                  selectedSquare={null}
                  legalMoves={[]}
                  lastMoveUci={latestMove}
                  disabled
                  testId="asa-chess-home-position"
                  onSquare={() => undefined}
                  onMove={() => undefined}
                />
              </div>
            </article>

            <article className="asa-chess-home-card asa-chess-home-puzzle-card">
              <div className="asa-chess-home-puzzle-board" aria-hidden="true">
                <ChessBoard
                  position={puzzlePosition}
                  orientation={puzzlePosition.turn}
                  selectedSquare={null}
                  legalMoves={[]}
                  disabled
                  testId="asa-chess-home-puzzle"
                  onSquare={() => undefined}
                  onMove={() => undefined}
                />
              </div>
              <div>
                <span className="asa-chess-home-kicker">Рекомендуемая задача</span>
                <h2>{nextPuzzle.title}</h2>
                <p>
                  Ход за {puzzlePosition.turn === 'white' ? 'белых' : 'чёрных'}. Найдите лучший ход
                  в позиции.
                </p>
                <button type="button" className="is-primary" onClick={props.onOpenTraining}>
                  Решать задачу
                </button>
              </div>
            </article>
          </div>

          <div className="asa-chess-home-feature-grid">
            <article className="asa-chess-home-card asa-chess-home-feature is-training">
              <span className="asa-chess-home-feature-icon" aria-hidden="true">
                ◆
              </span>
              <div>
                <small>Задачи</small>
                <h2>
                  {summary.solvedPuzzles} из {summary.totalPuzzles} решено
                </h2>
              </div>
              <div
                className="asa-chess-home-progress"
                aria-label={`Решено ${summary.learningPercent}%`}
              >
                <span style={{ width: `${summary.learningPercent}%` }} />
              </div>
              <button type="button" onClick={props.onOpenTraining}>
                Продолжить тренировку
              </button>
            </article>

            <article className="asa-chess-home-card asa-chess-home-feature is-lessons">
              <span className="asa-chess-home-feature-icon" aria-hidden="true">
                ▰
              </span>
              <div>
                <small>Учёба</small>
                <h2>Уроки по вашим ошибкам</h2>
              </div>
              <p>После решения задач ASA предложит оригинальный урок по нужной теме.</p>
              <button type="button" onClick={props.onOpenLearning}>
                Открыть обучение
              </button>
            </article>

            <article className="asa-chess-home-card asa-chess-home-feature is-bots">
              <span className="asa-chess-home-feature-icon" aria-hidden="true">
                ♟
              </span>
              <div>
                <small>ASA Bot</small>
                <h2>{summary.botName ?? '12 профилей соперников'}</h2>
              </div>
              <p>Выберите подходящий уровень и сыграйте локальную учебную партию.</p>
              <button type="button" onClick={props.onOpenBot}>
                Играть с ботом
              </button>
            </article>
          </div>

          <div className="asa-chess-home-lower-grid">
            <section
              className="asa-chess-home-card asa-chess-home-activity"
              aria-label="История проекта"
            >
              <header>
                <div>
                  <span className="asa-chess-home-kicker">История проекта</span>
                  <h2>Последняя активность</h2>
                </div>
                <button type="button" onClick={props.onOpenReview}>
                  Разобрать партию
                </button>
              </header>
              {summary.recentMoves.length > 0 ? (
                <ol>
                  {summary.recentMoves.map((move, index) => (
                    <li key={`${move}-${index}`}>
                      <span>{summary.halfMoves - summary.recentMoves.length + index + 1}</span>
                      <strong>{move}</strong>
                      <small>Сохранённый ход</small>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="asa-chess-home-empty-activity">
                  <span aria-hidden="true">♙</span>
                  <p>Ходов пока нет. Начните партию — здесь появится история для разбора.</p>
                </div>
              )}
            </section>

            <aside
              className="asa-chess-home-card asa-chess-home-stats"
              aria-label="Прогресс проекта"
            >
              <span className="asa-chess-home-kicker">Ваш прогресс</span>
              <dl>
                <div>
                  <dt>Задачи</dt>
                  <dd>
                    {summary.solvedPuzzles}/{summary.totalPuzzles}
                  </dd>
                </div>
                <div>
                  <dt>Рейтинг</dt>
                  <dd>{summary.puzzleRating}</dd>
                </div>
                <div>
                  <dt>Ходы</dt>
                  <dd>{summary.completedMoves}</dd>
                </div>
              </dl>
              <p>Показатели вычисляются только из сохранённых данных этого проекта.</p>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
