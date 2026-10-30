import { describe, expect, it } from 'vitest';
import * as engine from '../engine';
import * as leaf from '../timed-state';

describe('pure canonical timed-state leaf compatibility', () => {
  it('preserves the existing engine export identity and wire version', () => {
    expect(engine.resetElectronicsTimedState).toBe(leaf.resetElectronicsTimedState);
    expect(engine.ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION).toBe(1);
    expect(leaf.ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION).toBe(
      engine.ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION,
    );
    expect(leaf.resetElectronicsTimedState()).toEqual({
      version: 1,
      lifecycle: 'running',
      continuation: null,
    });
  });
  it('returns independent mutable generations without retaining a solver or document', () => {
    const a = leaf.resetElectronicsTimedState();
    const b = leaf.resetElectronicsTimedState();
    expect(a).not.toBe(b);
    expect(Object.keys(a).sort()).toEqual(['continuation', 'lifecycle', 'version']);
  });
});
