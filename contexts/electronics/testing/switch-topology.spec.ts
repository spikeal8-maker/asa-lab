import { describe, expect, it } from 'vitest';
import {
  buttonContactPairs,
  spdtConnections,
  spdtSelectedTerminal,
  spdtStateForThrow,
  spdtThrowFromState,
} from '../domain/switch-topology.js';

describe('controlled contact topology', () => {
  it('keeps both tactile-button sides permanent and adds only a momentary bridge', () => {
    expect(buttonContactPairs(false)).toEqual([
      ['SW-A1', 'SW-A2'],
      ['SW-B1', 'SW-B2'],
    ]);
    expect(buttonContactPairs(true)).toEqual([
      ['SW-A1', 'SW-A2'],
      ['SW-B1', 'SW-B2'],
      ['SW-A1', 'SW-B1'],
    ]);
  });

  it('maps the saved boolean to exactly one deterministic SPDT throw', () => {
    expect(spdtThrowFromState(undefined)).toBe('left');
    expect(spdtThrowFromState(false)).toBe('left');
    expect(spdtThrowFromState(true)).toBe('right');
    expect(spdtStateForThrow('left')).toBe(false);
    expect(spdtStateForThrow('right')).toBe(true);
    expect(spdtConnections('left')).toEqual([['common', 'throw-left']]);
    expect(spdtConnections('right')).toEqual([['common', 'throw-right']]);
    expect(spdtSelectedTerminal(false)).toBe('throw-left');
    expect(spdtSelectedTerminal(true)).toBe('throw-right');
  });
});
