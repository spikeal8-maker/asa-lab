import type { ElectronicsTimedState } from './engine.js';

export const ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION = 1 as const;

export function resetElectronicsTimedState(): ElectronicsTimedState {
  return {
    version: ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION,
    lifecycle: 'running',
    continuation: null,
  };
}
