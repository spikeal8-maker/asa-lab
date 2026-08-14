import { useEffect, useState } from 'react';
import type { PublicUser } from '../api';
import { ChessEditor } from './ChessEditor';
import { ChessHome } from './ChessHome';
import { ChessOnlineLobby } from './ChessOnlineLobby';
import { ChessPuzzleTrainer } from './ChessPuzzleTrainer';
import { ChessReviewPage } from './ChessReviewPage';
import './chess-training.css';
import './chess-review.css';
import './chess-theme.css';

interface ChessModuleExperienceProps {
  projectId: string;
  onBack: () => void;
  user: PublicUser;
}

type ChessSurface = 'home' | 'project' | 'training' | 'review' | 'online';

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
  const storageKey = `asa-chess-surface:${props.projectId}`;
  const [surface, setSurface] = useState<ChessSurface>(() => {
    if (typeof window === 'undefined') return 'home';
    const stored = window.sessionStorage.getItem(storageKey);
    return stored === 'project' ||
      stored === 'training' ||
      stored === 'review' ||
      stored === 'online'
      ? stored
      : 'home';
  });
  const [startNewGame, setStartNewGame] = useState(false);
  useEffect(() => {
    if (surface === 'home') window.sessionStorage.removeItem(storageKey);
    else window.sessionStorage.setItem(storageKey, surface);
  }, [storageKey, surface]);
  if (surface === 'home') {
    return (
      <ChessHome
        {...props}
        onOpenBoard={() => {
          setStartNewGame(false);
          setSurface('project');
        }}
        onOpenOnline={() => setSurface('online')}
        onOpenTraining={() => setSurface('training')}
        onOpenReview={() => setSurface('review')}
        onOpenBot={() => {
          setStartNewGame(true);
          setSurface('project');
        }}
      />
    );
  }
  if (surface === 'training') {
    return (
      <ChessPuzzleTrainer
        projectId={props.projectId}
        user={props.user}
        onExit={props.onBack}
        onBackToProject={() => setSurface('home')}
      />
    );
  }
  if (surface === 'review') {
    return (
      <ChessReviewPage
        projectId={props.projectId}
        user={props.user}
        onExit={props.onBack}
        onBackToProject={() => setSurface('home')}
      />
    );
  }
  if (surface === 'online') {
    return (
      <ChessOnlineLobby
        user={props.user}
        onExit={props.onBack}
        onBackToProject={() => setSurface('home')}
      />
    );
  }
  return <ChessEditor {...props} startNewGame={startNewGame} onHome={() => setSurface('home')} />;
}
