import { useState } from 'react';
import type { PublicUser } from '../api';
import { ChessEditor } from './ChessEditor';
import { ChessPuzzleTrainer } from './ChessPuzzleTrainer';

interface ChessModuleExperienceProps {
  projectId: string;
  onBack: () => void;
  user: PublicUser;
}

type ChessSurface = 'project' | 'training';

/**
 * Module-local surface switch. Project persistence stays in ChessEditor;
 * training uses an original built-in foundation set and does not mutate the
 * current project until the future Activity/Assignment integration is added.
 */
export function ChessModuleExperience(props: ChessModuleExperienceProps): JSX.Element {
  const [surface, setSurface] = useState<ChessSurface>('project');
  if (surface === 'training') {
    return <ChessPuzzleTrainer onBackToProject={() => setSurface('project')} />;
  }
  return (
    <div className="asa-chess-experience">
      <ChessEditor {...props} />
      <button
        type="button"
        className="asa-chess-training-launcher"
        onClick={() => setSurface('training')}
        aria-label="Открыть шахматные задачи"
      >
        <span aria-hidden="true">◆</span>
        <span><strong>Задачи</strong><small>Тренировка</small></span>
      </button>
    </div>
  );
}
