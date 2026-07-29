import { describe, expect, it } from 'vitest';
import {
  breadboardHoleWorldMm,
  createBreadboardDefinition,
} from '../domain/breadboard';
import {
  partTerminalWorldMm,
  snapPartToBreadboard,
  type PhysicalPartDefinitionMm,
} from '../domain/breadboard-placement';

const board = createBreadboardDefinition('mini-170');
const boardPlacement = { xMm: 100, yMm: 40, rotation: 0 as const };

const resistor: PhysicalPartDefinitionMm = {
  widthMm: 25.4,
  heightMm: 2.5,
  terminals: [
    { id: 'a', xMm: 0, yMm: 1.25 },
    { id: 'b', xMm: 25.4, yMm: 1.25 },
  ],
};

const led: PhysicalPartDefinitionMm = {
  widthMm: 2.54,
  heightMm: 8.6,
  terminals: [
    { id: 'a', xMm: 0, yMm: 8.6 },
    { id: 'b', xMm: 2.54, yMm: 8.6 },
  ],
};

describe('component-to-breadboard placement solver', () => {
  it('snaps a 10-pitch resistor into two distinct holes on one terminal row', () => {
    const target = breadboardHoleWorldMm(
      board,
      'mini-170:terminal:1:a',
      boardPlacement,
    )!;
    const result = snapPartToBreadboard(
      board,
      boardPlacement,
      resistor,
      { xMm: target.xMm + 0.6, yMm: target.yMm - 1.25 - 0.4, rotation: 0 },
      'a',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments.map((assignment) => assignment.hole.id)).toEqual([
      'mini-170:terminal:1:a',
      'mini-170:terminal:11:a',
    ]);
    expect(result.maximumErrorMm).toBeLessThan(0.001);
    const a = partTerminalWorldMm(resistor, result.placement, 'a')!;
    const b = partTerminalWorldMm(resistor, result.placement, 'b')!;
    expect(a).toEqual(
      breadboardHoleWorldMm(board, 'mini-170:terminal:1:a', boardPlacement),
    );
    expect(b).toEqual(
      breadboardHoleWorldMm(board, 'mini-170:terminal:11:a', boardPlacement),
    );
  });

  it('snaps a one-pitch LED into adjacent holes with stable anode/cathode identities', () => {
    const target = breadboardHoleWorldMm(
      board,
      'mini-170:terminal:5:c',
      boardPlacement,
    )!;
    const result = snapPartToBreadboard(
      board,
      boardPlacement,
      led,
      { xMm: target.xMm + 0.2, yMm: target.yMm - 8.6 + 0.1, rotation: 0 },
      'a',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments).toMatchObject([
      { terminalId: 'a', hole: { id: 'mini-170:terminal:5:c' } },
      { terminalId: 'b', hole: { id: 'mini-170:terminal:6:c' } },
    ]);
  });

  it('supports a rotated through-hole component across compatible rows', () => {
    const target = breadboardHoleWorldMm(
      board,
      'mini-170:terminal:8:a',
      boardPlacement,
    )!;
    const result = snapPartToBreadboard(
      board,
      boardPlacement,
      resistor,
      { xMm: target.xMm - 2.5 + 0.1, yMm: target.yMm + 0.2, rotation: 90 },
      'a',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments.map((assignment) => assignment.hole.id)).toEqual([
      'mini-170:terminal:8:a',
      'mini-170:terminal:8:i',
    ]);
  });

  it('rejects a part whose lead spacing cannot land on the board pitch', () => {
    const malformed: PhysicalPartDefinitionMm = {
      widthMm: 3,
      heightMm: 4,
      terminals: [
        { id: 'a', xMm: 0, yMm: 2 },
        { id: 'b', xMm: 3, yMm: 2 },
      ],
    };
    const target = breadboardHoleWorldMm(
      board,
      'mini-170:terminal:1:a',
      boardPlacement,
    )!;
    const result = snapPartToBreadboard(
      board,
      boardPlacement,
      malformed,
      { xMm: target.xMm, yMm: target.yMm - 2, rotation: 0 },
      'a',
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'terminal_hole_not_found',
      terminalId: 'b',
    });
  });

  it('rejects two leads that would occupy one physical hole', () => {
    const colliding: PhysicalPartDefinitionMm = {
      widthMm: 5,
      heightMm: 5,
      terminals: [
        { id: 'a', xMm: 2.5, yMm: 2.5 },
        { id: 'b', xMm: 2.5, yMm: 2.5 },
      ],
    };
    const target = breadboardHoleWorldMm(
      board,
      'mini-170:terminal:1:a',
      boardPlacement,
    )!;
    const result = snapPartToBreadboard(
      board,
      boardPlacement,
      colliding,
      { xMm: target.xMm - 2.5, yMm: target.yMm - 2.5, rotation: 0 },
      'a',
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'terminals_collide_on_one_hole',
      terminalId: 'b',
    });
  });

  it('does not pull a component onto a distant board', () => {
    const result = snapPartToBreadboard(
      board,
      boardPlacement,
      resistor,
      { xMm: 1000, yMm: 1000, rotation: 0 },
      'a',
    );
    expect(result).toMatchObject({ ok: false, code: 'anchor_hole_not_found' });
  });

  it('rejects invalid physical terminal geometry before snapping', () => {
    const invalid: PhysicalPartDefinitionMm = {
      widthMm: 10,
      heightMm: 10,
      terminals: [{ id: 'outside', xMm: 11, yMm: 5 }],
    };
    const result = snapPartToBreadboard(
      board,
      boardPlacement,
      invalid,
      { xMm: 100, yMm: 40, rotation: 0 },
      'outside',
    );
    expect(result).toMatchObject({ ok: false, code: 'invalid_part_geometry' });
  });
});
