import { describe, expect, it } from 'vitest';
import {
  CHESS_FAIR_PLAY_POLICIES,
  chessCapabilityDecision,
  requireChessCapability,
} from '../domain/fair-play';

describe('ASA Chess fair-play policy', () => {
  it('allows analysis only in explicit analysis or completed-review contexts', () => {
    expect(chessCapabilityDecision('analysis_project', 'engine_analysis').allowed).toBe(true);
    expect(chessCapabilityDecision('post_game_review', 'engine_analysis').allowed).toBe(true);
    expect(chessCapabilityDecision('protected_live_rated', 'engine_analysis').allowed).toBe(false);
    expect(chessCapabilityDecision('live_spectator', 'engine_analysis').allowed).toBe(false);
  });

  it('keeps protected rated moves and clocks server-authoritative', () => {
    expect(CHESS_FAIR_PLAY_POLICIES.protected_live_rated).toMatchObject({
      serverAuthoritativeMoves: true,
      serverAuthoritativeClock: true,
      spectatorDelayMs: 0,
    });
    expect(CHESS_FAIR_PLAY_POLICIES.protected_live_rated.allowed).not.toContain('undo');
    expect(CHESS_FAIR_PLAY_POLICIES.protected_live_rated.allowed).not.toContain('move_hints');
  });

  it('requires a spectator delay and denies hidden live analysis', () => {
    expect(CHESS_FAIR_PLAY_POLICIES.live_spectator.spectatorDelayMs).toBe(15_000);
    expect(chessCapabilityDecision('live_spectator', 'spectate_live_without_delay').allowed).toBe(
      false,
    );
  });

  it('throws a policy-specific denial instead of silently enabling a UI control', () => {
    expect(() => requireChessCapability('protected_live_rated', 'opening_explorer')).toThrow(
      /denied by protected_live_rated/,
    );
    expect(() => requireChessCapability('analysis_project', 'opening_explorer')).not.toThrow();
  });
});
