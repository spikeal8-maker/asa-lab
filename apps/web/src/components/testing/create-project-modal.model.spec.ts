import { describe, expect, it } from 'vitest';
import { orderModulesForCreation } from '../create-project-modal.model';

describe('create project module order', () => {
  it('keeps games out of the project chooser without mutating the complete catalog', () => {
    const catalog = [
      { moduleKey: 'blocks', displayName: 'Блоки' },
      { moduleKey: 'chess', displayName: 'ASA Chess' },
      { moduleKey: 'drawing', displayName: 'Черчение' },
      { moduleKey: 'electronics', displayName: 'Электроника' },
      { moduleKey: 'three-d', displayName: 'ASA 3D' },
      { moduleKey: 'checkers', displayName: 'ASA Шашки' },
      { moduleKey: 'robotics', displayName: 'Робототехника' },
    ] as const;

    expect(orderModulesForCreation(catalog).map((module) => module.moduleKey)).toEqual([
      'electronics',
      'three-d',
      'blocks',
      'robotics',
      'drawing',
    ]);
    expect(catalog[0]?.moduleKey).toBe('blocks');
  });
});
