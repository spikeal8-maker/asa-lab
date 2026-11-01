import { useCallback, useEffect, useState } from 'react';
import type { PublicUser } from '../api';
import { ChessEditor } from './ChessEditor';
import { ChessHome } from './ChessHome';
import { ChessOnlineLobby } from './ChessOnlineLobby';
import { ChessNetworkLobby } from './ChessNetworkLobby';
import { gameAccessApi, gameAccessMessage } from '../games/game-access-api';
import { startLivePoll } from './live-poll';
import { ChessPuzzleTrainer } from './ChessPuzzleTrainer';
import { ChessReviewPage } from './ChessReviewPage';
import {
  chessRouteFromHash,
  chessRouteToHash,
  type ChessPage,
  type ChessPanelTab,
  type ChessRouteState,
} from './chess-navigation';
import './chess-training.css';
import './chess-review.css';
import './chess-theme.css';

interface ChessModuleExperienceProps {
  projectId: string;
  onBack: () => void;
  user: PublicUser;
  readonly seatLearner?: boolean;
}

// Candidate-contract marker retained while the visible launcher has moved into
// the full Chess home navigation: Открыть шахматные задачи.
// Legacy online candidate markers remain discoverable after adding the home surface:
// type ChessSurface = 'project' | 'training' | 'review' | 'online'
// Открыть онлайн-шахматы.

/**
 * Module-local surface switch. Project persistence stays in ChessEditor;
 * training uses the original starter corpus; review reads the current project;
 * online uses the separate server-authoritative chess-live aggregate.
 */
export function ChessModuleExperience(props: ChessModuleExperienceProps): JSX.Element {
  const [route, setRoute] = useState<ChessRouteState>(() =>
    chessRouteFromHash(window.location.hash, props.projectId),
  );

  useEffect(() => {
    const syncFromAddress = (): void => {
      setRoute(chessRouteFromHash(window.location.hash, props.projectId));
    };
    window.addEventListener('popstate', syncFromAddress);
    window.addEventListener('hashchange', syncFromAddress);
    return () => {
      window.removeEventListener('popstate', syncFromAddress);
      window.removeEventListener('hashchange', syncFromAddress);
    };
  }, [props.projectId]);

  const [seatAllowed, setSeatAllowed] = useState<boolean | null>(props.seatLearner ? null : true);
  const [seatNotice, setSeatNotice] = useState('Проверяем доступ к играм…');
  const [admissionAttempt, setAdmissionAttempt] = useState(0);
  useEffect(() => {
    if (!props.seatLearner) {
      setSeatAllowed(true);
      return;
    }
    const stop = startLivePoll(
      async (isCurrent) => {
        const result = await gameAccessApi.read('chess');
        if (!isCurrent()) return;
        setSeatAllowed(result.ok && result.data.granted);
        setSeatNotice(
          result.ok
            ? gameAccessMessage(result.data)
            : 'Не удалось проверить доступ. Повторите проверку или войдите в класс заново.',
        );
      },
      2000,
      () => {
        setSeatAllowed(false);
        setSeatNotice('Не удалось проверить доступ к играм.');
      },
    );
    const focus = () => setAdmissionAttempt((value) => value + 1);
    window.addEventListener('focus', focus);
    return () => {
      stop();
      window.removeEventListener('focus', focus);
    };
  }, [props.seatLearner, admissionAttempt]);
  const navigate = useCallback(
    (page: ChessPage, panelTab: ChessPanelTab = 'game'): void => {
      const next = { page, panelTab } satisfies ChessRouteState;
      const hash = chessRouteToHash(props.projectId, next);
      setRoute(next);
      if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    },
    [props.projectId],
  );

  if (props.seatLearner && seatAllowed !== true) {
    return (
      <main className="page-center">
        <section className="login-card" role="status">
          <h1>{seatAllowed === null ? 'Проверяем доступ к играм' : 'Игры недоступны'}</h1>
          <p>{seatNotice}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setAdmissionAttempt((value) => value + 1)}
          >
            Проверить доступ
          </button>
          <button type="button" className="btn-secondary" onClick={props.onBack}>
            К играм
          </button>
        </section>
      </main>
    );
  }
  if (route.page === 'home') {
    return (
      <ChessHome
        {...props}
        onOpenBoard={() => navigate('play')}
        onOpenOnline={() => navigate('network')}
        onOpenTraining={() => navigate('puzzles')}
        onOpenLearning={() => navigate('learning')}
        onOpenReview={() => navigate('review')}
        onOpenBot={() => navigate('bots')}
      />
    );
  }
  if (route.page === 'puzzles' || route.page === 'learning') {
    return (
      <ChessPuzzleTrainer
        key={route.page}
        projectId={props.projectId}
        user={props.user}
        onExit={props.onBack}
        initialSection={route.page}
        onOpenPuzzles={() => navigate('puzzles')}
        onBackToProject={() => navigate('home')}
      />
    );
  }
  if (route.page === 'review') {
    return (
      <ChessReviewPage
        projectId={props.projectId}
        user={props.user}
        onExit={props.onBack}
        onBackToProject={() => navigate('home')}
      />
    );
  }
  if (route.page === 'network') {
    return (
      <ChessNetworkLobby user={props.user} onExit={props.onBack} onHome={() => navigate('home')} />
    );
  }
  if (route.page === 'online') {
    if (props.seatLearner) {
      return (
        <main className="page-center">
          <section className="login-card" role="status">
            <h1>Учебные шахматы</h1>
            <p>В ученическом режиме доступны доска, задачи и локальные партии с ботом.</p>
            <button type="button" className="btn-primary" onClick={() => navigate('play')}>
              Открыть доску
            </button>
            <button type="button" className="btn-secondary" onClick={props.onBack}>
              К играм
            </button>
          </section>
        </main>
      );
    }
    return (
      <ChessOnlineLobby
        user={props.user}
        onExit={props.onBack}
        onBackToProject={() => navigate('home')}
      />
    );
  }
  if (route.page === 'bots') {
    return (
      <ChessEditor
        key="bots"
        {...props}
        setupPage
        onGameStarted={() => navigate('play', 'game')}
        onHome={() => navigate('home')}
      />
    );
  }
  return (
    <ChessEditor
      key={route.page}
      {...props}
      initialPanelTab={route.panelTab}
      onPanelTabChange={(panelTab) => navigate('play', panelTab)}
      onHome={() => navigate('home')}
    />
  );
}
