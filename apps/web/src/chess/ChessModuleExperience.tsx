import { useCallback, useEffect, useState } from 'react';
import type { PublicUser } from '../api';
import { ChessEditor } from './ChessEditor';
import { ChessHome } from './ChessHome';
import { ChessOnlineLobby } from './ChessOnlineLobby';
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

  const navigate = useCallback(
    (page: ChessPage, panelTab: ChessPanelTab = 'game'): void => {
      const next = { page, panelTab } satisfies ChessRouteState;
      const hash = chessRouteToHash(props.projectId, next);
      setRoute(next);
      if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    },
    [props.projectId],
  );

  if (route.page === 'home') {
    return (
      <ChessHome
        {...props}
        onOpenBoard={() => navigate('play')}
        onOpenOnline={() => navigate('online')}
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
  if (route.page === 'online') {
    return (
      <ChessOnlineLobby
        user={props.user}
        onExit={props.onBack}
        onBackToProject={() => navigate('home')}
      />
    );
  }
  return (
    <ChessEditor
      key={route.page}
      {...props}
      initialPanelTab={route.panelTab}
      startNewGame={route.page === 'bots'}
      onPanelTabChange={(panelTab) => navigate('play', panelTab)}
      onHome={() => navigate('home')}
    />
  );
}
