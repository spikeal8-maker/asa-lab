import { useState } from 'react';
import type { PublicUser } from '@asa-lab/web-api-client';
import { ChessEditor } from './ChessEditor';
import { ChessOnlineLobby } from './ChessOnlineLobby';
import { ChessPuzzleTrainer } from './ChessPuzzleTrainer';
import { ChessReviewPage } from './ChessReviewPage';
import './chess-training.css';
import './chess-review.css';
import './chess-surfaces.css';

interface ChessModuleExperienceProps {
  projectId: string;
  onBack: () => void;
  user: PublicUser;
}

type ChessSurface = 'project' | 'training' | 'review' | 'online';

/**
 * Module-local surface switch. Project persistence stays in ChessEditor;
 * training uses the original starter corpus; review reads the current project;
 * online uses the separate server-authoritative chess-live aggregate.
 */
export function ChessModuleExperience(props: ChessModuleExperienceProps): JSX.Element {
  const [surface, setSurface] = useState<ChessSurface>('project');
  if (surface === 'training') {
    return <ChessPuzzleTrainer onBackToProject={() => setSurface('project')} />;
  }
  if (surface === 'review') {
    return (
      <ChessReviewPage projectId={props.projectId} onBackToProject={() => setSurface('project')} />
    );
  }
  if (surface === 'online') {
    return <ChessOnlineLobby user={props.user} onBackToProject={() => setSurface('project')} />;
  }
  return (
    <div className="asa-chess-experience">
      <ChessEditor {...props} />
      <nav className="asa-chess-surface-launchers" aria-label="Разделы ASA Chess">
        <button
          type="button"
          className="asa-chess-surface-launcher online"
          onClick={() => setSurface('online')}
          aria-label="Открыть онлайн-шахматы"
        >
          <span aria-hidden="true">⌁</span>
          <span>
            <strong>Онлайн</strong>
            <small>Вызовы и поиск</small>
          </span>
        </button>
        <button
          type="button"
          className="asa-chess-surface-launcher"
          onClick={() => setSurface('training')}
          aria-label="Открыть шахматные задачи"
        >
          <span aria-hidden="true">◆</span>
          <span>
            <strong>Задачи</strong>
            <small>Тренировка</small>
          </span>
        </button>
        <button
          type="button"
          className="asa-chess-surface-launcher review"
          onClick={() => setSurface('review')}
          aria-label="Открыть разбор шахматной партии"
        >
          <span aria-hidden="true">◎</span>
          <span>
            <strong>Разбор</strong>
            <small>ASA Quality</small>
          </span>
        </button>
      </nav>
    </div>
  );
}
