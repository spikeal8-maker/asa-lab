import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { servoVisualRotation } from '../OwnerServoVisual';

const root = resolve(process.cwd(), 'apps/web');
const ownerSvg = readFileSync(
  resolve(
    root,
    'public/assets/electronics/component-database/components/motors/servo-motor/component.svg',
  ),
  'utf8',
);
const visualSource = readFileSync(resolve(root, 'src/electronics/OwnerServoVisual.tsx'), 'utf8');

describe('owner servo visual', () => {
  it('maps physical angle to deterministic owner horn rotation', () => {
    expect(servoVisualRotation(0)).toBe(-90);
    expect(servoVisualRotation(90)).toBe(0);
    expect(servoVisualRotation(180)).toBe(90);
    expect(servoVisualRotation(-10)).toBe(-90);
    expect(servoVisualRotation(999)).toBe(90);
  });

  it('uses exact owner groups and rotates only the horn around the owner axis', () => {
    for (const id of ['wires', 'connector', 'body', 'gears', 'horn'])
      expect(ownerSvg).toContain(`id="${id}"`);
    expect(visualSource).toContain('114.5 314');
    expect(visualSource).toContain('#wires');
    expect(visualSource).toContain('#connector');
    expect(visualSource).toContain('#body');
    expect(visualSource).toContain('#gears');
    expect(visualSource).toContain('#horn');
    expect(visualSource).not.toContain('<path');
  });
});
