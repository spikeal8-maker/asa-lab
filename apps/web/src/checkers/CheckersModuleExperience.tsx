import * as CheckersDomain from '@asa-lab/checkers';
import type {
  CheckersAssignmentKind,
  CheckersBotId,
  CheckersPuzzle,
  CheckersPuzzleAttempt,
  CheckersReactionId,
} from '@asa-lab/checkers';
import { useEffect, useMemo, useState } from 'react';
import type { PublicUser } from '../api';
import { newClientId } from '../client-id';
import { CheckersStudentHome, type CheckersHomeCard } from './CheckersStudentHome';
import { CheckersTeacherDashboard } from './CheckersTeacherDashboard';
import { CheckersWorkspace, type CheckersWorkspaceMove } from './CheckersWorkspace';
import { useCheckersProject, type CreateCheckersAssignmentInput } from './use-checkers-project';
import './checkers.css';

const {
  CHECKERS_BOTS,
  CHECKERS_CURRICULUM,
  CHECKERS_REACTIONS,
  CHECKERS_STARTER_PUZZLES,
  createCheckersPuzzleAttempt,
  requestCheckersPuzzleHint,
  submitCheckersPuzzleMove,
} = CheckersDomain;

interface CheckersModuleExperienceProps {
  projectId: string;
  onBack: () => void;
  user: PublicUser;
}

type CheckersSurface = 'home' | 'play' | 'learning' | 'bots' | 'review' | 'teacher';

export function resolveCheckersLandingSurface(
  projectScope: 'personal' | 'classroom',
  canManageClassroom: boolean,
): 'home' | 'teacher' {
  return projectScope === 'classroom' && canManageClassroom ? 'teacher' : 'home';
}

const ASSIGNMENT_KINDS: readonly { value: CheckersAssignmentKind; label: string }[] = [
  { value: 'puzzle-set', label: 'Набор задач' },
  { value: 'lesson', label: 'Урок' },
  { value: 'bot-milestone', label: 'Победа над ботом' },
  { value: 'game', label: 'Учебная партия' },
] as const;

function assignmentKindLabel(kind: CheckersAssignmentKind): string {
  return ASSIGNMENT_KINDS.find((item) => item.value === kind)?.label ?? 'Задание';
}

function formatDue(value: string | null): string {
  if (!value) return 'без срока';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(
    new Date(value),
  );
}

function AssignmentDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: CreateCheckersAssignmentInput) => boolean;
}): JSX.Element {
  const [title, setTitle] = useState('Обязательное взятие');
  const [kind, setKind] = useState<CheckersAssignmentKind>('puzzle-set');
  const [targetRef, setTargetRef] = useState(CHECKERS_STARTER_PUZZLES[0]!.id);
  const [dueDate, setDueDate] = useState('');
  const [hintsAllowed, setHintsAllowed] = useState(true);
  const [minimumScore, setMinimumScore] = useState(70);

  return (
    <div className="checkers-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="checkers-assignment-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkers-assignment-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="checkers-kicker">ASA Шашки · педагог</span>
            <h2 id="checkers-assignment-title">Новое задание</h2>
          </div>
          <button type="button" className="checkers-link-button" onClick={onClose}>
            Закрыть
          </button>
        </header>
        <label>
          Название
          <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Формат
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as CheckersAssignmentKind)}
          >
            {ASSIGNMENT_KINDS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Учебный материал
          <select value={targetRef} onChange={(event) => setTargetRef(event.target.value)}>
            {CHECKERS_STARTER_PUZZLES.map((puzzle) => (
              <option key={puzzle.id} value={puzzle.id}>
                {puzzle.title}
              </option>
            ))}
            {CHECKERS_BOTS.map((bot) => (
              <option key={bot.id} value={`bot:${bot.id}`}>
                Бот · {bot.displayName}
              </option>
            ))}
          </select>
        </label>
        <div className="checkers-dialog-grid">
          <label>
            Срок
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </label>
          <label>
            Минимальный результат
            <input
              type="number"
              min={0}
              max={100}
              value={minimumScore}
              onChange={(event) => setMinimumScore(Number(event.target.value))}
            />
          </label>
        </div>
        <label className="checkers-checkbox-row">
          <input
            type="checkbox"
            checked={hintsAllowed}
            onChange={(event) => setHintsAllowed(event.target.checked)}
          />
          Разрешить ступенчатые подсказки
        </label>
        <footer>
          <button type="button" className="checkers-link-button" onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="checkers-primary-action"
            disabled={!title.trim()}
            onClick={() => {
              const created = onCreate({
                title,
                kind,
                targetRef,
                dueAt: dueDate ? new Date(`${dueDate}T20:59:00.000Z`).toISOString() : null,
                hintsAllowed,
                minimumScore,
              });
              if (created) onClose();
            }}
          >
            Назначить классу
          </button>
        </footer>
      </section>
    </div>
  );
}

export function CheckersModuleExperience(props: CheckersModuleExperienceProps): JSX.Element {
  const checkers = useCheckersProject(props.projectId, props.user);
  const [surface, setSurface] = useState<CheckersSurface>('home');
  const [activePuzzle, setActivePuzzle] = useState<CheckersPuzzle | null>(null);
  const [attempt, setAttempt] = useState<CheckersPuzzleAttempt | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [assignmentDialog, setAssignmentDialog] = useState(false);

  useEffect(() => {
    if (checkers.project?.scope !== 'classroom') return;
    setSurface(resolveCheckersLandingSurface(checkers.project.scope, checkers.canManageClassroom));
  }, [checkers.canManageClassroom, checkers.project?.scope]);

  const mastery = useMemo(() => {
    const progress = checkers.document?.education.progress ?? [];
    return progress.length === 0
      ? 0
      : Math.round(progress.reduce((sum, item) => sum + item.mastery, 0) / progress.length);
  }, [checkers.document]);

  if (checkers.loadState === 'loading') {
    return (
      <main className="checkers-loading" role="status" aria-live="polite">
        <span className="checkers-kicker">ASA Шашки</span>
        <h1>Загружаем партию и учебный прогресс…</h1>
      </main>
    );
  }
  if (checkers.loadState === 'error' || !checkers.document || !checkers.project) {
    return (
      <main className="checkers-loading" role="alert">
        <span className="checkers-kicker">ASA Шашки</span>
        <h1>Проект не открыт</h1>
        <p>{checkers.notice}</p>
        <div>
          <button
            type="button"
            className="checkers-primary-action"
            onClick={() => void checkers.reload()}
          >
            Повторить
          </button>
          <button type="button" className="checkers-link-button" onClick={props.onBack}>
            К проектам
          </button>
        </div>
      </main>
    );
  }

  const document = checkers.document;
  const selectedBot = CHECKERS_BOTS.find((bot) => bot.id === document.education.selectedBotId)!;

  const startPuzzle = (puzzle: CheckersPuzzle): void => {
    const created = createCheckersPuzzleAttempt(puzzle, `attempt-${newClientId()}`, props.user.id);
    if (!created.ok) {
      checkers.setNotice(created.message);
      return;
    }
    setActivePuzzle(puzzle);
    setAttempt(created.value);
    setHint(null);
    checkers.openLesson(created.value.document, puzzle.title);
    setSurface('learning');
  };

  const playWorkspaceMove = (move: CheckersWorkspaceMove): void => {
    if (!activePuzzle || !attempt) {
      const legal = checkers.legalMoves.find(
        (candidate) => candidate.pieceId === move.pieceId && candidate.notation === move.notation,
      );
      if (legal) checkers.playMove(legal);
      return;
    }
    const outcome = submitCheckersPuzzleMove(activePuzzle, attempt, {
      pieceId: move.pieceId,
      path: move.path,
    });
    if (!outcome.ok) {
      checkers.setNotice(outcome.message);
      return;
    }
    setAttempt(outcome.value.attempt);
    if (outcome.value.feedback === 'illegal') {
      checkers.setNotice('Этот ход не разрешён правилами русских шашек.');
      return;
    }
    if (outcome.value.feedback === 'incorrect') {
      checkers.setNotice('Ход допустим, но не решает задачу. Попробуй ещё раз.');
      return;
    }
    checkers.openLesson(outcome.value.attempt.document, activePuzzle.title);
    if (outcome.value.feedback === 'solved') {
      checkers.completePuzzle(outcome.value.attempt, outcome.value.conceptIds);
    } else {
      checkers.setNotice('Верно. Продолжи обязательную последовательность.');
    }
  };

  const workspace = (
    <CheckersWorkspace
      model={{
        projectTitle: checkers.projectTitle,
        saveState: checkers.saveStatus,
        userName: props.user.displayName,
        mode: activePuzzle ? 'learn' : surface === 'review' ? 'review' : 'play',
        modeLabel: activePuzzle
          ? `Задача · ${activePuzzle.title}`
          : `Игра с ботом · ${selectedBot.displayName}`,
        opponentLabel: checkers.botThinking
          ? `${selectedBot.displayName} думает…`
          : selectedBot.displayName,
        sideToMove: document.game.sideToMove,
        pieces: document.game.pieces,
        legalMoves: checkers.legalMoves,
        moveHistory: document.game.moveHistory.map((move) => ({
          ply: move.ply,
          notation: move.path.join(move.capturedIds.length > 0 ? ':' : '-'),
        })),
        instructionTitle: activePuzzle?.title ?? 'Сыграй полноценную партию',
        instruction:
          activePuzzle?.instruction ??
          'Выбирай шашку и подсвеченное поле. Если взятие возможно, система разрешит только взятие.',
        ...(hint ? { hintText: hint } : {}),
        reactionsEnabled: document.education.reactionsEnabled,
      }}
      onBack={() => {
        setActivePuzzle(null);
        setAttempt(null);
        setHint(null);
        setSurface(checkers.project?.scope === 'classroom' ? 'teacher' : 'home');
      }}
      onRename={(title) => void checkers.renameProject(title)}
      onModeChange={(mode) => {
        setActivePuzzle(null);
        setAttempt(null);
        if (mode === 'learn') setSurface('learning');
        else if (mode === 'review') setSurface('review');
        else setSurface('play');
      }}
      onMove={playWorkspaceMove}
      {...(activePuzzle && attempt
        ? {
            onHint: () => {
              const result = requestCheckersPuzzleHint(activePuzzle, attempt);
              if (!result.ok) return;
              setAttempt(result.value.attempt);
              setHint(result.value.hint);
            },
          }
        : {})}
      onReaction={(reactionId) =>
        checkers.setNotice(
          `Реакция «${CHECKERS_REACTIONS[reactionId as CheckersReactionId]}» готова. Свободного чата нет.`,
        )
      }
      onToggleReactions={checkers.toggleReactions}
    />
  );

  let content: JSX.Element;
  if (surface === 'play' || (surface === 'learning' && activePuzzle) || surface === 'review') {
    content = workspace;
  } else if (surface === 'bots') {
    content = (
      <main className="checkers-learning-shell" id="main-content" tabIndex={-1}>
        <header className="checkers-surface-heading">
          <div>
            <button
              type="button"
              className="checkers-link-button"
              onClick={() => setSurface('home')}
            >
              ← На главную шашек
            </button>
            <span className="checkers-kicker">Лестница ASA Bot</span>
            <h1>Шесть соперников — от первого хода до мастера</h1>
            <p>Следующий уровень открывается после двух побед и доказанного решения задач.</p>
          </div>
        </header>
        <section className="checkers-bot-grid" aria-label="Соперники ASA Bot">
          {CHECKERS_BOTS.map((bot) => {
            const locked = bot.rung > document.education.unlockedBotRung;
            return (
              <article key={bot.id} className={`checkers-bot-card${locked ? ' locked' : ''}`}>
                <span className="checkers-bot-rung">Уровень {bot.rung}</span>
                <div className="checkers-bot-token" aria-hidden="true">
                  {bot.rung}
                </div>
                <h2>{bot.displayName}</h2>
                <p>{bot.description}</p>
                <small>
                  Поиск: глубина {bot.searchDepth} · до{' '}
                  {bot.defaultNodeBudget.toLocaleString('ru-RU')} узлов
                </small>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    if (checkers.startBotGame(bot.id as CheckersBotId)) setSurface('play');
                  }}
                >
                  {locked ? 'Сначала предыдущий уровень' : 'Начать партию'}
                </button>
              </article>
            );
          })}
        </section>
      </main>
    );
  } else if (surface === 'learning') {
    content = (
      <main className="checkers-learning-shell" id="main-content" tabIndex={-1}>
        <header className="checkers-surface-heading">
          <div>
            <button
              type="button"
              className="checkers-link-button"
              onClick={() => setSurface('home')}
            >
              ← На главную шашек
            </button>
            <span className="checkers-kicker">Самообучение</span>
            <h1>Путь русских шашек</h1>
            <p>
              11 последовательных тем и позиции, проверяемые тем же движком, что и обычная партия.
            </p>
          </div>
          <strong>
            {document.education.completedPuzzleIds.length} / {CHECKERS_STARTER_PUZZLES.length} задач
          </strong>
        </header>
        <section className="checkers-curriculum-strip" aria-label="Учебная программа">
          {CHECKERS_CURRICULUM.map((unit) => (
            <article key={unit.id}>
              <span>{unit.order}</span>
              <strong>{unit.title}</strong>
            </article>
          ))}
        </section>
        <section className="checkers-puzzle-grid" aria-labelledby="checkers-puzzles-title">
          <div className="checkers-section-heading">
            <div>
              <span className="checkers-home-eyebrow">Практика</span>
              <h2 id="checkers-puzzles-title">Стартовые задачи ASA</h2>
            </div>
          </div>
          <div className="checkers-home-grid">
            {CHECKERS_STARTER_PUZZLES.map((puzzle, index) => {
              const complete = document.education.completedPuzzleIds.includes(puzzle.id);
              return (
                <article className="checkers-home-card" key={puzzle.id}>
                  <span className="checkers-home-eyebrow">Задача {index + 1}</span>
                  <h3>{puzzle.title}</h3>
                  <p>{puzzle.instruction}</p>
                  <small>{complete ? '✓ Доказательство сохранено' : '5 ступеней подсказки'}</small>
                  <button type="button" onClick={() => startPuzzle(puzzle)}>
                    {complete ? 'Решить ещё раз' : 'Начать'}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    );
  } else if (surface === 'teacher') {
    content = (
      <CheckersTeacherDashboard
        model={{
          classroomTitle: checkers.project.title,
          studentCount: 0,
          activeThisWeek: 0,
          assignmentCompletionPercent: 0,
          needsAttention: 0,
          assignments: document.education.assignments.map((assignment) => ({
            id: assignment.id,
            title: assignment.title,
            kindLabel: assignmentKindLabel(assignment.kind),
            dueLabel: formatDue(assignment.dueAt),
            completed: 0,
            assigned: assignment.assigneeIds.length,
            status:
              assignment.status === 'assigned'
                ? ('active' as const)
                : assignment.status === 'draft'
                  ? ('draft' as const)
                  : ('closed' as const),
          })),
          students: [],
          concepts: CHECKERS_CURRICULUM.slice(0, 6).map((unit) => ({
            id: unit.id,
            shortLabel: String(unit.order),
            fullLabel: unit.title,
          })),
          masteryByStudent: {},
        }}
        onBack={props.onBack}
        onCreateAssignment={() => setAssignmentDialog(true)}
        onOpenAssignment={(id) =>
          checkers.setNotice(`Задание ${id} хранится в черновике проекта класса.`)
        }
        onOpenStudent={() => undefined}
      />
    );
  } else {
    const assignmentCards: CheckersHomeCard[] = document.education.assignments.map(
      (assignment) => ({
        id: assignment.id,
        eyebrow: 'От педагога',
        title: assignment.title,
        description: `${assignmentKindLabel(assignment.kind)} · ${formatDue(assignment.dueAt)}`,
        actionLabel: 'Открыть',
      }),
    );
    content = (
      <CheckersStudentHome
        model={{
          studentName: props.user.displayName,
          recommendation: {
            id: assignmentCards[0]?.id ?? 'learning-path',
            eyebrow: assignmentCards.length > 0 ? 'Сначала это' : 'Следующий шаг',
            title: assignmentCards[0]?.title ?? 'Обязательное взятие',
            description:
              assignmentCards[0]?.description ??
              'Короткая позиция научит видеть главное правило партии.',
            progressLabel: `${document.education.completedPuzzleIds.length} из ${CHECKERS_STARTER_PUZZLES.length} задач`,
            progressPercent: Math.round(
              (document.education.completedPuzzleIds.length / CHECKERS_STARTER_PUZZLES.length) *
                100,
            ),
            actionLabel: 'Продолжить',
          },
          assignments: assignmentCards,
          reviewCount: document.education.progress.filter(
            (item) => item.nextReviewAt && Date.parse(item.nextReviewAt) <= Date.now(),
          ).length,
          learningUnit: Math.min(11, document.education.completedPuzzleIds.length + 1),
          learningUnitsTotal: 11,
          masteryPercent: mastery,
          currentBotName: selectedBot.displayName,
          botRung: document.education.unlockedBotRung,
          botRungsTotal: CHECKERS_BOTS.length,
          classPlayAvailable: checkers.project.scope === 'classroom',
        }}
        onOpen={(id) => {
          if (id === 'bot-ladder') setSurface('bots');
          else if (id === 'class-play') setSurface('play');
          else setSurface('learning');
        }}
      />
    );
  }

  return (
    <div className="checkers-experience">
      {checkers.notice ? (
        <div className="checkers-global-notice" role="status" aria-live="polite">
          <span>{checkers.notice}</span>
          <button
            type="button"
            onClick={() => checkers.setNotice(null)}
            aria-label="Закрыть сообщение"
          >
            ×
          </button>
        </div>
      ) : null}
      {content}
      {assignmentDialog ? (
        <AssignmentDialog
          onClose={() => setAssignmentDialog(false)}
          onCreate={checkers.createAssignment}
        />
      ) : null}
    </div>
  );
}
