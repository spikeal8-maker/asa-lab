import { defineModule, type ModuleDiagnostic } from '@asa-lab/module-sdk';
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
