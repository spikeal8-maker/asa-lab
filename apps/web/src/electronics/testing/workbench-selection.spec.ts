import { describe, expect, it } from 'vitest';
import { nextComponentSelection, type Selection } from '../workbench-model';

describe('component multi-selection', () => {
  it('adds and removes components with Shift-style additive selection', () => {
    let selection: Selection = nextComponentSelection(null, 'a', false);
    selection = nextComponentSelection(selection, 'b', true);
    selection = nextComponentSelection(selection, 'c', true);
    expect(selection).toEqual({
      kind: 'component',
      id: 'a',
      ids: ['a', 'b', 'c'],
    });

    selection = nextComponentSelection(selection, 'b', true);
    expect(selection).toEqual({
      kind: 'component',
      id: 'a',
      ids: ['a', 'c'],
    });
  });

  it('moves the primary id when its component is toggled out', () => {
    const selected: Selection = { kind: 'component', id: 'a', ids: ['a', 'b'] };
    expect(nextComponentSelection(selected, 'a', true)).toEqual({
      kind: 'component',
      id: 'b',
      ids: ['b'],
    });
  });

  it('returns to single selection without the additive modifier', () => {
    const selected: Selection = { kind: 'component', id: 'a', ids: ['a', 'b'] };
    expect(nextComponentSelection(selected, 'c', false)).toEqual({
      kind: 'component',
      id: 'c',
      ids: ['c'],
    });
  });
});
