export {
  CHECKERS_FILES,
  CHECKERS_RANKS,
  createInitialCheckersDocument,
  isDarkSquare,
  isCheckersSquare,
  validateCheckersDocument,
  type CheckersDocument,
  type CheckersDocumentResult,
  type CheckersGameMode,
  type CheckersMoveRecord,
  type CheckersPiece,
  type CheckersPieceKind,
  type CheckersResult,
  type CheckersRuleset,
  type CheckersSide,
  type CheckersSquare,
} from './domain/document.js';
export { CHECKERS_MODULE, type CheckersAnalysisSummary } from './module.js';
export {
  applyCheckersMove,
  generateLegalCheckersMoves,
  getCheckersGameStatus,
  type CheckersGameStatus,
  type CheckersLegalMove,
  type CheckersMoveInput,
} from './domain/rules.js';
export {
  CHECKERS_BOTS,
  CHECKERS_BOT_IDS,
  chooseCheckersBotMove,
  type CheckersBotDecision,
  type CheckersBotDefinition,
  type CheckersBotExplanation,
  type CheckersBotId,
  type CheckersBotSearchOptions,
} from './domain/bot.js';
