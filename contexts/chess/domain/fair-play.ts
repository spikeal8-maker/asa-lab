export type ChessSessionPolicy =
  | 'analysis_project'
  | 'post_game_review'
  | 'puzzle_training'
  | 'local_unrated'
  | 'classroom_training'
  | 'protected_live_rated'
  | 'live_spectator';

export type ChessCapability =
  | 'engine_analysis'
  | 'opening_explorer'
  | 'move_hints'
  | 'undo'
  | 'takeback_request'
  | 'annotations'
  | 'pgn_export'
  | 'chat'
  | 'spectate_live_without_delay';

export interface ChessFairPlayPolicy {
  readonly policy: ChessSessionPolicy;
  readonly allowed: ReadonlySet<ChessCapability>;
  readonly spectatorDelayMs: number;
  readonly serverAuthoritativeMoves: boolean;
  readonly serverAuthoritativeClock: boolean;
  readonly reason: string;
}

const set = (...capabilities: readonly ChessCapability[]): ReadonlySet<ChessCapability> =>
  new Set(capabilities);

export const CHESS_FAIR_PLAY_POLICIES: Readonly<Record<ChessSessionPolicy, ChessFairPlayPolicy>> = {
  analysis_project: {
    policy: 'analysis_project',
    allowed: set(
      'engine_analysis',
      'opening_explorer',
      'move_hints',
      'undo',
      'annotations',
      'pgn_export',
    ),
    spectatorDelayMs: 0,
    serverAuthoritativeMoves: false,
    serverAuthoritativeClock: false,
    reason:
      'Private project analysis may use assistance because no protected competitive result exists.',
  },
  post_game_review: {
    policy: 'post_game_review',
    allowed: set('engine_analysis', 'opening_explorer', 'move_hints', 'annotations', 'pgn_export'),
    spectatorDelayMs: 0,
    serverAuthoritativeMoves: true,
    serverAuthoritativeClock: true,
    reason: 'The game is finished and immutable; analysis cannot alter its competitive result.',
  },
  puzzle_training: {
    policy: 'puzzle_training',
    allowed: set('move_hints', 'undo', 'annotations'),
    spectatorDelayMs: 0,
    serverAuthoritativeMoves: true,
    serverAuthoritativeClock: true,
    reason: 'Hints are an explicit part of training and are recorded in the attempt.',
  },
  local_unrated: {
    policy: 'local_unrated',
    allowed: set('undo', 'takeback_request', 'annotations', 'pgn_export'),
    spectatorDelayMs: 0,
    serverAuthoritativeMoves: false,
    serverAuthoritativeClock: false,
    reason:
      'Local play has no public rating; engine assistance remains off by default to preserve the game experience.',
  },
  classroom_training: {
    policy: 'classroom_training',
    allowed: set('takeback_request', 'annotations', 'pgn_export'),
    spectatorDelayMs: 0,
    serverAuthoritativeMoves: true,
    serverAuthoritativeClock: true,
    reason: 'Teacher-scoped training uses explicit grants; assistance is visible and auditable.',
  },
  protected_live_rated: {
    policy: 'protected_live_rated',
    allowed: set('pgn_export'),
    spectatorDelayMs: 0,
    serverAuthoritativeMoves: true,
    serverAuthoritativeClock: true,
    reason:
      'Engine, explorer, hints, undo and hidden assistance are forbidden during a protected rated game.',
  },
  live_spectator: {
    policy: 'live_spectator',
    allowed: set('chat'),
    spectatorDelayMs: 15_000,
    serverAuthoritativeMoves: true,
    serverAuthoritativeClock: true,
    reason:
      'Live spectators receive a delayed board and cannot attach analysis to the protected player session.',
  },
};

export interface ChessCapabilityDecision {
  readonly allowed: boolean;
  readonly policy: ChessSessionPolicy;
  readonly capability: ChessCapability;
  readonly reason: string;
  readonly spectatorDelayMs: number;
}

export function chessCapabilityDecision(
  policy: ChessSessionPolicy,
  capability: ChessCapability,
): ChessCapabilityDecision {
  const contract = CHESS_FAIR_PLAY_POLICIES[policy];
  return {
    allowed: contract.allowed.has(capability),
    policy,
    capability,
    reason: contract.reason,
    spectatorDelayMs: contract.spectatorDelayMs,
  };
}

export function requireChessCapability(
  policy: ChessSessionPolicy,
  capability: ChessCapability,
): void {
  const decision = chessCapabilityDecision(policy, capability);
  if (!decision.allowed) {
    throw new Error(`chess capability ${capability} is denied by ${policy}: ${decision.reason}`);
  }
}
