/** Public Games Chess protocol. Source identity and education membership are private. */
export type ChessNetworkScope = 'classroom' | 'school' | 'platform';
export interface ChessNetworkPolicy {
  enabled: boolean;
  scope: ChessNetworkScope;
  version: number;
}
export interface ChessNetworkAccess {
  player: { playerId: string; displayAlias: string };
  allowed: boolean;
  reason: string;
  scopes: ChessNetworkScope[];
}
export interface ChessNetworkInvite {
  id: string;
  code: string;
  scope: ChessNetworkScope;
  status: 'open' | 'accepted' | 'cancelled' | 'expired';
  initialMs: number;
  incrementMs: number;
  colorPreference: 'white' | 'black' | 'random';
  expiresAt: number;
  matchId: string | null;
  version: number;
}
export interface ChessNetworkMatch {
  id: string;
  status: 'active' | 'finished' | 'aborted';
  version: number;
  sequence: number;
  scope: ChessNetworkScope;
  white: { playerId: string; displayAlias: string };
  black: { playerId: string; displayAlias: string };
  viewerColor: 'white' | 'black';
  currentFen: string;
  moves: { uci: string; san: string }[];
  whiteRemainingMs: number;
  blackRemainingMs: number;
  activeColor: 'white' | 'black';
  serverNowMs: number;
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  termination: string;
  drawOfferedBy: string | null;
  updatedAt: number;
}
export type ChessNetworkAction = 'move' | 'resign' | 'draw-offer' | 'draw-accept' | 'draw-decline';
