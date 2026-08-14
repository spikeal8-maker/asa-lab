import {
  ASA_BOT_PROFILES,
  ASA_CHESS_PUZZLES,
  solvedChessPuzzleCount,
  type ChessDocument,
} from '@asa-lab/chess';

export interface ChessHomeSummary {
  readonly solvedPuzzles: number;
  readonly totalPuzzles: number;
  readonly learningPercent: number;
  readonly puzzleRating: number;
  readonly halfMoves: number;
  readonly completedMoves: number;
  readonly recentMoves: readonly string[];
  readonly nextPuzzleId: string;
  readonly botName: string | null;
}

export function buildChessHomeSummary(document: ChessDocument): ChessHomeSummary {
  const solvedPuzzles = solvedChessPuzzleCount(document.learning);
  const nextPuzzle =
    ASA_CHESS_PUZZLES.find(
      (puzzle) => document.learning.attempts[puzzle.id]?.status !== 'solved',
    ) ?? ASA_CHESS_PUZZLES[0]!;
  const botName = document.bot?.profileId
    ? (ASA_BOT_PROFILES.find((profile) => profile.id === document.bot?.profileId)?.displayName ??
      null)
    : null;

  return {
    solvedPuzzles,
    totalPuzzles: ASA_CHESS_PUZZLES.length,
    learningPercent:
      ASA_CHESS_PUZZLES.length === 0
        ? 0
        : Math.round((solvedPuzzles / ASA_CHESS_PUZZLES.length) * 100),
    puzzleRating: document.learning.rating.current,
    halfMoves: document.moves.length,
    completedMoves: Math.ceil(document.moves.length / 2),
    recentMoves: document.moves.slice(-6).map((move) => move.san),
    nextPuzzleId: nextPuzzle.id,
    botName,
  };
}
