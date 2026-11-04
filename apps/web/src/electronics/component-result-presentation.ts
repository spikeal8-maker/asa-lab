import type { ComponentResult } from '../api';
import type { ComponentVisualState } from './component-catalog';

export function ordinaryLedVisualState(result: ComponentResult | undefined): ComponentVisualState {
  if (
    result?.presentationState === 'failed' ||
    result?.deviceHealth === 'failed_open' ||
    result?.damageState === 'failed'
  )
    return 'burned';
  if (result?.junctionState === 'reverse_blocking') return 'reverse';
  if (result?.presentationState === 'destructive') return 'overcurrent';
  return result?.lit ? 'lit' : 'off';
}
