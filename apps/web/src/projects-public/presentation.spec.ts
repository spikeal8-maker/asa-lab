import { expect, it } from 'vitest';
import { PUBLIC_PROJECT_MODULES } from './presentation';

it('offers exactly the three publisher modules and keeps games in Games', () => {
  expect(PUBLIC_PROJECT_MODULES.map((module) => module.value)).toEqual([
    'three-d',
    'electronics',
    'blocks',
  ]);
});
