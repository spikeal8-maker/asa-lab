import { defineModule, type ModuleDiagnostic } from '@asa-lab/module-sdk';
import { chooseChessBotMove, evaluateChessPosition } from './domain/bot.js';
import {
  createEmptyChessDocument,
  validateChessDocument,
  type ChessDocument,
} from './domain/document.js';
import { getChessStatus, parseFen } from './domain/chess.js';

export interface ChessAnalysisSummary {
  readonly status: ReturnType<typeof getChessStatus>;
  readonly evaluationCp: number;
  readonly bestMoveUci: string | null;
  readonly searchedNodes: number;
}

const CHESS_MANIFEST = {
  moduleKey: 'chess',
  moduleVersion: '0.1.0',
  displayName: 'ASA Chess',
  shortDescription: 'Шахматные партии, анализ позиций, игра с локальным соперником или ASA Bot.',
  projectType: 'chess-game',
  schemaVersion: 1,
  editorRoute: '/projects/:projectId/chess',
  viewerRoute: '/view/projects/:versionId/chess',
  safeModeSupported: true,
  availability: 'active',
  previewKind: 'board',
  iconKey: 'chess',
  categories: ['logic', 'games', 'training'],
} as const;

function invalidDocument(message: string): readonly ModuleDiagnostic[] {
  return [
    {
      code: 'chess_document_invalid',
      severity: 'error',
      message,
    },
  ];
}

export const CHESS_MODULE = defineModule<ChessDocument, ChessAnalysisSummary>(
  CHESS_MANIFEST,
  {
    createEmptyProject: () => createEmptyChessDocument('analysis'),
    validate: (payload: unknown) => {
      const parsed = validateChessDocument(payload);
      if (!parsed.ok) return { ok: false, diagnostics: invalidDocument(parsed.message) };
      return { ok: true, payload: parsed.value, diagnostics: [] };
    },
    createPreview: (payload: ChessDocument) => ({
      kind: 'board',
      summary: `${payload.moves.length} полуходов · ${payload.result === '*' ? 'партия не завершена' : payload.result}`,
      inlineData: payload.currentFen,
    }),
    analyse: (payload: ChessDocument) => {
      const parsed = parseFen(payload.currentFen);
      if (!parsed.ok) {
        return {
          status: {
            state: 'ongoing',
            inCheck: false,
            winner: null,
            result: '*',
            legalMoveCount: 0,
          },
          evaluationCp: 0,
          bestMoveUci: null,
          searchedNodes: 0,
        };
      }
      const status = getChessStatus(parsed.value);
      const best = status.result === '*' ? chooseChessBotMove(parsed.value, 1) : null;
      return {
        status,
        evaluationCp: evaluateChessPosition(parsed.value),
        bestMoveUci: best?.uci ?? null,
        searchedNodes: best?.nodes ?? 0,
      };
    },
  },
);
