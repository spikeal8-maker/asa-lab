import { describe, expect, it } from 'vitest';
import {
  createChessPuzzleSession,
  playChessPuzzleMove,
  requestChessPuzzleHint,
  retryChessPuzzleSession,
  validateChessPuzzle,
  type ChessPuzzle,
} from '../domain/puzzle';
import { START_FEN } from '../domain/chess';

const puzzle: ChessPuzzle = {
  schemaVersion: 2,
  id: 'opening-development-001',
  contentVersion: '2026-08-12.1',
  title: 'Захватите центр и развейте коня',
  initialFen: START_FEN,
  solutionLinesUci: [
    ['e2e4', 'e7e5', 'g1f3'],
    ['d2d4', 'd7d5', 'g1f3'],
  ],
  themes: ['calculation'],
  rating: 400,
  maxMistakes: 2,
  explanation: 'Белые занимают центр, а затем развивают королевского коня.',
  provenance: {
    kind: 'asa_original',
    sourceId: 'asa-lab-test-opening-001',
    createdAt: '2026-08-12T00:00:00Z',
    license: 'ASA-Lab-Original',
  },
};

describe('ASA Chess versioned puzzle lifecycle', () => {
  it('validates legal accepted branches and strict original provenance', () => {
    expect(validateChessPuzzle(puzzle)).toEqual({ ok: true, value: puzzle });
    expect(validateChessPuzzle({ ...puzzle, tenantId: 'foreign' })).toEqual({
      ok: false,
      message: 'Puzzle contains unsupported field: tenantId.',
    });
    expect(validateChessPuzzle({ ...puzzle, initialFen: ` ${START_FEN} ` })).toEqual({
      ok: false,
      message: 'Puzzle initialFen must use canonical FEN.',
    });
    expect(validateChessPuzzle({ ...puzzle, solutionLinesUci: [['e2e5']] })).toEqual({
      ok: false,
      message: 'Puzzle solution move 1 (e2e5) is illegal.',
    });
  });

  it('accepts either trusted branch and replays its deterministic reply', () => {
    const ePawn = playChessPuzzleMove(puzzle, createChessPuzzleSession(puzzle), 'e2e4');
    expect(ePawn).toMatchObject({
      ok: true,
      outcome: 'correct',
      automaticReplies: ['e7e5'],
      session: { cursor: 2, playedUci: ['e2e4', 'e7e5'] },
    });
    const dPawn = playChessPuzzleMove(puzzle, createChessPuzzleSession(puzzle), 'd2d4');
    expect(dPawn).toMatchObject({
      ok: true,
      outcome: 'correct',
      automaticReplies: ['d7d5'],
      session: { cursor: 2, playedUci: ['d2d4', 'd7d5'] },
    });
  });

  it('rejects illegal input without recording an attempt and records a legal wrong move', () => {
    const session = createChessPuzzleSession(puzzle);
    expect(playChessPuzzleMove(puzzle, session, 'e2e5')).toEqual({
      ok: false,
      outcome: 'invalid',
      session,
      message: 'Illegal puzzle move.',
    });
    expect(playChessPuzzleMove(puzzle, session, 'g1f3')).toMatchObject({
      ok: false,
      outcome: 'incorrect',
      session: { attempts: 1, mistakes: 1, currentFen: START_FEN },
    });
  });

  it('pins a session to the immutable puzzle content version', () => {
    const session = createChessPuzzleSession(puzzle);
    expect(
      playChessPuzzleMove({ ...puzzle, contentVersion: '2026-08-13.1' }, session, 'e2e4'),
    ).toMatchObject({
      ok: false,
      outcome: 'invalid',
    });
  });

  it('exhausts a bounded attempt and retries from the exact initial position', () => {
    const first = playChessPuzzleMove(puzzle, createChessPuzzleSession(puzzle), 'g1f3');
    expect(first).toMatchObject({ ok: false, outcome: 'incorrect' });
    if (first.ok) return;
    const second = playChessPuzzleMove(puzzle, first.session, 'g1f3');
    expect(second).toMatchObject({
      ok: false,
      outcome: 'incorrect',
      session: { status: 'exhausted', attempts: 2, mistakes: 2 },
    });
    if (second.ok) return;
    expect(retryChessPuzzleSession(puzzle, second.session)).toMatchObject({
      ok: true,
      value: { status: 'active', currentFen: START_FEN, cursor: 0, attempts: 2, mistakes: 2 },
    });
  });

  it('solves only at an accepted terminal and reveals three progressive hints', () => {
    const first = playChessPuzzleMove(puzzle, createChessPuzzleSession(puzzle), 'e2e4');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(playChessPuzzleMove(puzzle, first.session, 'g1f3')).toMatchObject({
      ok: true,
      outcome: 'solved',
      session: { status: 'solved', attempts: 2 },
    });

    const h1 = requestChessPuzzleHint(puzzle, createChessPuzzleSession(puzzle));
    expect(h1).toMatchObject({ ok: true, value: { level: 1, from: 'd2' } });
    if (!h1.ok) return;
    const h2 = requestChessPuzzleHint(puzzle, h1.value.session);
    expect(h2).toMatchObject({ ok: true, value: { level: 2, from: 'd2', to: 'd4' } });
    if (!h2.ok) return;
    expect(requestChessPuzzleHint(puzzle, h2.value.session)).toMatchObject({
      ok: true,
      value: { level: 3, moveUci: 'd2d4' },
    });
  });
});
