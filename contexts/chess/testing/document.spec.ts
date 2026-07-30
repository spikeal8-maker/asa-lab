import { describe, expect, it } from 'vitest';
import {
  agreeDrawChessDocument,
  createEmptyChessDocument,
  exportChessPgn,
  importChessPgn,
  playChessDocumentMove,
  resetChessDocument,
  resignChessDocument,
  undoChessDocumentMove,
  validateChessDocument,
} from '../domain/document';

describe('ASA Chess project document', () => {
  it('creates strict analysis and playable defaults', () => {
    expect(createEmptyChessDocument('analysis')).toMatchObject({
      schemaVersion: 1,
      variant: 'standard',
      mode: 'analysis',
      clock: null,
      bot: null,
      result: '*',
      termination: 'ongoing',
    });
    expect(createEmptyChessDocument('local')).toMatchObject({
      mode: 'local',
      clock: {
        initialMs: 600000,
        incrementMs: 5000,
        whiteMs: 600000,
        blackMs: 600000,
      },
      bot: null,
    });
    expect(createEmptyChessDocument('computer')).toMatchObject({
      mode: 'computer',
      bot: { color: 'black', level: 2 },
    });
  });

  it('plays and validates a saved opening with clocks', () => {
    let document = createEmptyChessDocument('local');
    for (const [move, elapsed] of [
      ['e2e4', 3000],
      ['e7e5', 2000],
      ['g1f3', 5000],
      ['b8c6', 4000],
    ] as const) {
      const next = playChessDocumentMove(document, move, elapsed);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      document = next.value;
    }
    expect(document.moves.map((move) => move.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(document.clock).toMatchObject({ whiteMs: 602000, blackMs: 604000 });
    expect(validateChessDocument(document)).toEqual({ ok: true, value: document });
  });

  it('times out before applying a move and preserves the board', () => {
    const base = {
      ...createEmptyChessDocument('local'),
      clock: { initialMs: 1000, incrementMs: 0, whiteMs: 1000, blackMs: 1000 },
    };
    const result = playChessDocumentMove(base, 'e2e4', 1000);
    expect(result).toEqual({
      ok: true,
      value: {
        ...base,
        clock: { initialMs: 1000, incrementMs: 0, whiteMs: 0, blackMs: 1000 },
        result: '0-1',
        termination: 'timeout',
      },
    });
  });

  it('undoes and resets without corrupting immutable move records', () => {
    const first = playChessDocumentMove(createEmptyChessDocument('analysis'), 'e2e4');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = playChessDocumentMove(first.value, 'e7e5');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const undone = undoChessDocumentMove(second.value);
    expect(undone.moves.map((move) => move.san)).toEqual(['e4']);
    expect(undone.currentFen).toBe(first.value.currentFen);
    expect(resetChessDocument(second.value)).toMatchObject({
      moves: [],
      currentFen: second.value.initialFen,
      result: '*',
      termination: 'ongoing',
    });
  });

  it('supports resignation and agreed draw only while the game is active', () => {
    const base = createEmptyChessDocument('local');
    expect(resignChessDocument(base, 'white')).toMatchObject({
      ok: true,
      value: { result: '0-1', termination: 'resignation' },
    });
    const draw = agreeDrawChessDocument(base);
    expect(draw).toMatchObject({
      ok: true,
      value: { result: '1/2-1/2', termination: 'draw_agreement' },
    });
    if (!draw.ok) return;
    expect(resignChessDocument(draw.value, 'black')).toEqual({
      ok: false,
      message: 'The game is already finished.',
    });
  });

  it('exports and imports a deterministic PGN', () => {
    let document = createEmptyChessDocument('analysis');
    for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) {
      const next = playChessDocumentMove(document, move);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      document = next.value;
    }
    const pgn = exportChessPgn(document);
    expect(pgn).toContain('[Event "ASA Chess project"]');
    expect(pgn).toContain('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
    const imported = importChessPgn(pgn);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.currentFen).toBe(document.currentFen);
    expect(imported.value.moves.map((move) => move.san)).toEqual(
      document.moves.map((move) => move.san),
    );
    expect(validateChessDocument(imported.value).ok).toBe(true);
  });

  it('imports comments and side variations without applying them', () => {
    const imported = importChessPgn(`
[Event "Training"]
[Result "*"]

1. e4 {Main move} e5 (1... c5 2. Nf3) 2. Nf3 $1 Nc6 *
`);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.moves.map((move) => move.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });

  it.each([
    ['top-level authority over-posting', { tenantId: 'foreign' }, 'Chess document contains unsupported field: tenantId.'],
    ['analysis clock', { mode: 'analysis', clock: { initialMs: 1, incrementMs: 0, whiteMs: 1, blackMs: 1 } }, 'Analysis mode must not persist a running game clock.'],
    ['computer without bot', { mode: 'computer', clock: { initialMs: 1000, incrementMs: 0, whiteMs: 1000, blackMs: 1000 }, bot: null }, 'Computer mode requires exactly one bot configuration.'],
  ])('rejects %s', (_name, override, message) => {
    const document = { ...createEmptyChessDocument('analysis'), ...override };
    expect(validateChessDocument(document)).toEqual({ ok: false, message });
  });

  it('rejects a forged move history and annotation over-posting', () => {
    const first = playChessDocumentMove(createEmptyChessDocument('analysis'), 'e2e4');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const forgedMove = {
      ...first.value,
      moves: [{ ...first.value.moves[0]!, san: 'Qh5' }],
    };
    expect(validateChessDocument(forgedMove)).toEqual({
      ok: false,
      message: 'Move 1 notation or resulting FEN is inconsistent.',
    });

    const forgedAnnotation = {
      ...createEmptyChessDocument('analysis'),
      annotations: [
        { id: 'a1', kind: 'comment', ply: 0, text: 'ok', role: 'platform_admin' },
      ],
    };
    expect(validateChessDocument(forgedAnnotation)).toEqual({
      ok: false,
      message: 'invalid comment annotation.',
    });
  });
});
