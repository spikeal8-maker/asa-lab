import type { ElectronicsDocument } from './document.js';
import type { CapacitorTransientState } from './models/capacitor-transient-model.js';
import {
  clockedRcStateIsCompatible,
  clockedPhysicalStateIsCompatible,
  type ArduinoThermalEpoch,
} from './solver.js';

export type ArduinoCircuitClockProfile =
  'dc-inputs-v1' | 'rc-inputs-v2' | 'electrothermal-v1' | 'electrothermal-events-v2';

const MAX_TIME_US = 2 ** 50 - 1001;
// Fixed barriers independent of UI refresh times. Adaptive trial steps stay inside each barrier.
export const PHYSICS_QUANTUM_US = 1000;
export function integerTime(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME_US;
}

// Reuse a zero-duration solve only when every carried physical input is identical.
// Object.is also distinguishes signed zero; no state or frame is retained between advances.
export function identicalPhysicalState(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        identicalPhysicalState(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ),
    )
  );
}

export function invalidClockThermalEpoch(
  epoch: ArduinoThermalEpoch,
  componentId: string | undefined,
  reachedMicroseconds: number,
): boolean {
  return (
    epoch.componentId !== componentId ||
    !integerTime(epoch.atMicroseconds) ||
    epoch.atMicroseconds > reachedMicroseconds ||
    !Number.isFinite(epoch.temperatureCelsius) ||
    !Number.isFinite(epoch.accumulatedDamage) ||
    epoch.accumulatedDamage < 0 ||
    !Number.isFinite(epoch.loadRatio) ||
    epoch.loadRatio < 0 ||
    epoch.loadRatio > 20
  );
}

export function invalidClockPhysicalCheckpoint(
  document: ElectronicsDocument,
  profile: ArduinoCircuitClockProfile,
  reachedMicroseconds: number,
  physicalState: CapacitorTransientState | undefined,
): boolean {
  if (profile === 'dc-inputs-v1') return physicalState !== undefined;
  if (!physicalState) return reachedMicroseconds >= PHYSICS_QUANTUM_US;
  const isCompatible =
    profile === 'electrothermal-v1' || profile === 'electrothermal-events-v2'
      ? clockedPhysicalStateIsCompatible
      : clockedRcStateIsCompatible;
  return (
    !isCompatible(document, physicalState, reachedMicroseconds / 1000) ||
    !integerTime(Math.round(physicalState.simulationTimeMs * 1000)) ||
    Math.round(physicalState.simulationTimeMs * 1000) / 1000 !== physicalState.simulationTimeMs ||
    reachedMicroseconds - Math.round(physicalState.simulationTimeMs * 1000) >= PHYSICS_QUANTUM_US
  );
}
