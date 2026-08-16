import {
  boardPreviewFigure,
  defineModule,
  type BoardPreviewPiece,
  type ModuleDiagnostic,
} from '@asa-lab/module-sdk';
import { chooseChessBotMove, evaluateChessPosition } from './domain/bot.js';
import {
  createEmptyChessDocument,
  validateChessDocument,
  type ChessDocument,
} from './domain/document.js';
import { getChessStatus, parseFen } from './domain/chess.js';

/**
 * The board straight from the FEN placement field, which lists ranks from 8
 * down to 1 — the same order the preview draws them, so no flip is needed.
 * Pieces are discs rather than glyphs: at thumbnail size a king and a queen are
 * the same three pixels, and a wrong glyph reads worse than an honest disc.
 */
function chessPreviewFigure(fen: string) {
  const placement = fen.split(' ')[0] ?? '';
  const pieces: BoardPreviewPiece[] = [];
  let rank = 0;
  for (const row of placement.split('/')) {
    if (rank > 7) break;
    let file = 0;
    for (const symbol of row) {
      if (symbol >= '1' && symbol <= '8') {
        file += Number(symbol);
        continue;
      }
      if (file <= 7) {
        const white = symbol === symbol.toUpperCase();
        pieces.push({
          file,
          rank,
          fill: white ? '#f7f4ee' : '#2b2b2b',
          stroke: white ? '#8d8b84' : '#101010',
          crowned: symbol.toLowerCase() === 'k' || symbol.toLowerCase() === 'q',
        });
      }
      file += 1;
    }
    rank += 1;
  }
  return boardPreviewFigure({ size: 8, light: '#eef0e6', dark: '#4c8264', pieces });
}

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

export const CHESS_MODULE = defineModule<ChessDocument, ChessAnalysisSummary>(CHESS_MANIFEST, {
  createEmptyProject: () => createEmptyChessDocument('analysis'),
  validate: (payload: unknown) => {
    const parsed = validateChessDocument(payload);
    if (!parsed.ok) return { ok: false, diagnostics: invalidDocument(parsed.message) };
    return { ok: true, payload: parsed.value, diagnostics: [] };
  },
  createPreview: (payload: ChessDocument) => ({
    kind: 'board',
    summary: `${payload.moves.length} полуходов · ${payload.result === '*' ? 'партия не завершена' : payload.result}`,
    figure: chessPreviewFigure(payload.currentFen),
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
});
