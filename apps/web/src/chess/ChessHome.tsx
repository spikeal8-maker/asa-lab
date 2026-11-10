import {
  ASA_BOT_PROFILES,
  parseFen,
  validateChessDocument,
  type ChessDocument,
  type ChessPosition,
} from '@asa-lab/chess';
import { useEffect, useState } from 'react';
import { api, type Project, type PublicUser } from '../api';
import { ChessBoard } from './ChessBoard';
import { buildChessHomeSummary } from './chess-home-ui';
import { chessNetworkApi } from './chess-network-api';
import { startLivePoll } from './live-poll';
import './chess-home.css';

interface ChessHomeProps {
  readonly seatLearner?: boolean;
  readonly projectId: string;
  readonly user: PublicUser;
  readonly onBack: () => void;
  readonly onOpenBoard: () => void;
  readonly onOpenLocal: () => void;
  readonly onOpenOnline: () => void;
  readonly onOpenTraining: () => void;
  readonly onOpenLearning: () => void;
  readonly onOpenReview: () => void;
  readonly onOpenBot: () => void;
}

export function ChessHome(props: ChessHomeProps): JSX.Element {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocument] = useState<ChessDocument | null>(null);
  const [position, setPosition] = useState<ChessPosition | null>(null);
  const [notice, setNotice] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [networkAllowed, setNetworkAllowed] = useState(false);
  useEffect(
    () =>
      startLivePoll(
        async (isCurrent) => {
          const result = await chessNetworkApi.access();
          if (isCurrent()) setNetworkAllowed(result.ok && result.data.allowed);
        },
        5000,
        () => setNetworkAllowed(false),
      ),
    [],
  );

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
  }, [props.projectId, loadAttempt]);

  if (state !== 'ready' || !document || !position || !project) {
    return (
      <main className="asa-chess-home-loading" role="status" aria-live="polite">
        <div>
          <p>{state === 'error' ? notice : 'Загружаем шахматный центр…'}</p>
          {state === 'error' && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setState('loading');
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              Повторить загрузку
            </button>
          )}
        </div>
      </main>
    );
  }

  const summary = buildChessHomeSummary(document);
  const latestMove = document.moves.at(-1)?.uci;
  return (
    <main className="asa-chess-home-shell">
      <div className="asa-chess-home-title-row">
        <h1>Шахматы</h1>
        <button type="button" aria-label="Вернуться к играм" onClick={props.onBack}>
          К играм
        </button>
      </div>
      <div className="asa-chess-home-layout">
        <section className="asa-chess-home-modes" aria-label="Начать игру">
          <button
            type="button"
            className="asa-chess-home-start"
            aria-label="Играть с компьютером"
            onClick={props.onOpenBot}
          >
            <span aria-hidden="true">♟</span>
            <span>
              <strong>Играть с компьютером</strong>
              <small>3 уровня сложности · {ASA_BOT_PROFILES.length} ботов</small>
            </span>
          </button>
          {networkAllowed && (
            <button
              type="button"
              className="asa-chess-home-start"
              aria-label="Играть с человеком"
              onClick={props.onOpenOnline}
            >
              <span aria-hidden="true">♞</span>
              <span>
                <strong>Играть с человеком</strong>
                <small>Пригласить соперника онлайн</small>
              </span>
            </button>
          )}
          <button
            type="button"
            className="asa-chess-home-start is-secondary"
            aria-label="Двое на одном устройстве"
            onClick={props.onOpenLocal}
          >
            <span aria-hidden="true">♔</span>
            <span>
              <strong>Двое на одном устройстве</strong>
              <small>Выберите время и начните партию</small>
            </span>
          </button>
          {!networkAllowed && (
            <p className="asa-chess-home-access-note">Онлайн-игра сейчас недоступна.</p>
          )}
        </section>
        <section className="asa-chess-home-board-panel" aria-label="Ваша шахматная доска">
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
          {(document.mode !== 'analysis' || summary.halfMoves > 0) && document.result === '*' && (
            <button type="button" className="asa-chess-home-resume" onClick={props.onOpenBoard}>
              Продолжить партию <span aria-hidden="true">→</span>
            </button>
          )}
        </section>
        <div className="asa-chess-home-tools" aria-label="Тренировки и разбор">
          <button type="button" aria-label="Шахматные задачи" onClick={props.onOpenTraining}>
            <strong>Шахматные задачи</strong>
            <small>
              Решено {summary.solvedPuzzles} из {summary.totalPuzzles} · рейтинг{' '}
              {summary.puzzleRating}
            </small>
          </button>
          <button type="button" onClick={props.onOpenLearning}>
            <strong>Уроки шахмат</strong>
            <small>Правила, тактика и объяснения</small>
          </button>
          <button type="button" aria-label="Разобрать свою партию" onClick={props.onOpenReview}>
            <strong>Разобрать свою партию</strong>
            <small>Посмотреть ходы и ошибки</small>
          </button>
        </div>
      </div>
    </main>
  );
}
