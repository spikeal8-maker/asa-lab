import {
  boardPreviewFigure,
  defineModule,
  type BoardPreviewPiece,
  type ModuleDiagnostic,
} from '@asa-lab/module-sdk';
import {
  createInitialCheckersProjectDocument,
  validateCheckersProjectDocument,
  type CheckersProjectDocument,
} from './domain/project.js';

export interface CheckersAnalysisSummary {
  readonly lightMen: number;
  readonly lightKings: number;
  readonly darkMen: number;
  readonly darkKings: number;
  readonly moveCount: number;
  readonly result: CheckersProjectDocument['game']['result'];
}

const CHECKERS_MANIFEST = {
  moduleKey: 'checkers',
  moduleVersion: '0.1.0',
  displayName: 'ASA Шашки',
  shortDescription: 'Русские шашки: обучение, задания, боты и безопасная игра в классе.',
  defaultProjectTitlePrefix: 'Шашечная партия',
  projectType: 'checkers-game',
  schemaVersion: 1,
  editorRoute: '/projects/:projectId/checkers',
  viewerRoute: '/view/projects/:versionId/checkers',
  safeModeSupported: true,
  availability: 'active',
  previewKind: 'board',
  iconKey: 'checkers',
  categories: ['logic', 'games', 'training'],
} as const;

function invalidDocument(message: string): readonly ModuleDiagnostic[] {
  return [
    {
      code: 'checkers_document_invalid',
      severity: 'error',
      message,
    },
  ];
}

/**
 * Russian draughts on a 64-square board. Squares are named a1..h8 with rank 1
 * at the bottom, and the preview is drawn top-down, so the rank is flipped.
 */
function checkersPreviewFigure(payload: CheckersProjectDocument) {
  const pieces: BoardPreviewPiece[] = payload.game.pieces.map((piece) => ({
    file: piece.square.charCodeAt(0) - 'a'.charCodeAt(0),
    rank: 8 - Number(piece.square.slice(1)),
    fill: piece.side === 'light' ? '#f4ead8' : '#2f3b45',
    stroke: piece.side === 'light' ? '#8a7a5c' : '#0f1519',
    crowned: piece.kind === 'king',
  }));
  return boardPreviewFigure({ size: 8, light: '#e8eae2', dark: '#4a7a63', pieces });
}

export const CHECKERS_MODULE = defineModule<CheckersProjectDocument, CheckersAnalysisSummary>(
  CHECKERS_MANIFEST,
  {
    createEmptyProject: () => createInitialCheckersProjectDocument(),
    validate: (payload: unknown) => {
      const parsed = validateCheckersProjectDocument(payload);
      if (!parsed.ok) return { ok: false, diagnostics: invalidDocument(parsed.message) };
      return { ok: true, payload: parsed.value, diagnostics: [] };
    },
    createPreview: (payload: CheckersProjectDocument) => ({
      kind: 'board',
      summary: `${payload.game.pieces.length} шашек · ${payload.game.moveHistory.length} ходов`,
      figure: checkersPreviewFigure(payload),
      inlineData: JSON.stringify({
        ruleset: payload.game.ruleset,
        sideToMove: payload.game.sideToMove,
        pieces: payload.game.pieces,
      }),
    }),
    analyse: (payload: CheckersProjectDocument) => ({
      lightMen: payload.game.pieces.filter(
        (piece) => piece.side === 'light' && piece.kind === 'man',
      ).length,
      lightKings: payload.game.pieces.filter(
        (piece) => piece.side === 'light' && piece.kind === 'king',
      ).length,
      darkMen: payload.game.pieces.filter((piece) => piece.side === 'dark' && piece.kind === 'man')
        .length,
      darkKings: payload.game.pieces.filter(
        (piece) => piece.side === 'dark' && piece.kind === 'king',
      ).length,
      moveCount: payload.game.moveHistory.length,
      result: payload.game.result,
    }),
  },
);
