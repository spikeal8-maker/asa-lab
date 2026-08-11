import { describe, expect, it } from 'vitest';
import {
  createChessPuzzleSession,
  playChessPuzzleMove,
  requestChessPuzzleHint,
  resetChessPuzzleSession,
  validateChessPuzzle,
  type ChessPuzzle,
} from '../domain/puzzle';
import { START_FEN } from '../domain/chess';

const puzzle: ChessPuzzle = {
  schemaVersion: 1,
  id: 'opening-development-001',
  title: 'Захватите центр и развейте коня',
  initialFen: START_FEN,
  solutionUci: ['e2e4', 'e7e5', 'g1f3'],
  themes: ['calculation'],
  rating: 400,
  explanation: 'Белые занимают центр, после симметричного ответа развивают королевского коня.',
};

describe('ASA Chess puzzle lifecycle', () => {
  it('validates a complete legal solution line', () => {
    expect(validateChessPuzzle(puzzle)).toEqual({ ok: true, value: puzzle });
  });

  it('rejects illegal, unsafe and over-posted puzzle definitions', () => {
    expect(validateChessPuzzle({ ...puzzle, solutionUci: ['e2e5'] })).toEqual({
      ok: false,
      message: 'Puzzle solution move 1 (e2e5) is illegal.',
    });
    expect(validateChessPuzzle({ ...puzzle, tenantId: 'foreign' })).toEqual({
      ok: false,
      message: 'Puzzle contains unsupported field: tenantId.',
    });
    expect(validateChessPuzzle({ ...puzzle, themes: ['calculation', 'calculation'] })).toEqual({
      ok: false,
      message: 'Puzzle themes are invalid or duplicated.',
    });
  });

  it('records an incorrect attempt without moving the board', () => {
    const session = createChessPuzzleSession(puzzle);
    const result = playChessPuzzleMove(puzzle, session, 'd2d4');
    expect(result).toMatchObject({
      ok: false,
      outcome: 'incorrect',
      session: {
        currentFen: START_FEN,
        cursor: 0,
        attempts: 1,
        mistakes: 1,
        status: 'active',
      },
    });
  });

  it('automatically replies for the opponent and waits for the next learner move', () => {
    const session = createChessPuzzleSession(puzzle);
    const result = playChessPuzzleMove(puzzle, session, 'e2e4');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).toMatchObject({
      outcome: 'correct',
      automaticReplies: ['e7e5'],
      session: {
        cursor: 2,
        attempts: 1,
        mistakes: 0,
        status: 'active',
        playedUci: ['e2e4', 'e7e5'],
      },
    });
  });

  it('solves after the final expected learner move', () => {
    const first = playChessPuzzleMove(puzzle, createChessPuzzleSession(puzzle), 'e2e4');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const solved = playChessPuzzleMove(puzzle, first.session, 'g1f3');
    expect(solved).toMatchObject({
      ok: true,
      outcome: 'solved',
      automaticReplies: [],
      session: { cursor: 3, status: 'solved', attempts: 2 },
    });
    if (!solved.ok) return;
    expect(playChessPuzzleMove(puzzle, solved.session, 'b8c6')).toMatchObject({
      ok: false,
      outcome: 'finished',
    });
  });

  it('reveals progressive hints and records their use', () => {
    let session = createChessPuzzleSession(puzzle);
    const first = requestChessPuzzleHint(puzzle, session);
    expect(first).toMatchObject({
      ok: true,
      value: { level: 1, from: 'e2', session: { hintsUsed: 1 } },
    });
    if (!first.ok) return;
    session = first.value.session;
    const second = requestChessPuzzleHint(puzzle, session);
    expect(second).toMatchObject({
      ok: true,
      value: { level: 2, from: 'e2', to: 'e4', session: { hintsUsed: 2 } },
    });
    if (!second.ok) return;
    const third = requestChessPuzzleHint(puzzle, second.value.session);
    expect(third).toMatchObject({
      ok: true,
      value: { level: 3, moveUci: 'e2e4', session: { hintsUsed: 3 } },
    });
  });

  it('resets all attempt state', () => {
    const wrong = playChessPuzzleMove(puzzle, createChessPuzzleSession(puzzle), 'd2d4');
    expect(wrong.ok).toBe(false);
    expect(resetChessPuzzleSession(puzzle)).toEqual(createChessPuzzleSession(puzzle));
  });
});
