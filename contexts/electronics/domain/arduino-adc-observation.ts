import type { ElectronicsDocument, Terminal } from './document.js';
import type { ArduinoPinMode, ArduinoTerminalVoltages } from './arduino-program-runtime.js';

/** Transient sampling context, never persisted or mixed into solved numeric voltages. */
export const ADC_OBSERVATION = Symbol('educational-unconnected-adc');
export interface AdcObservation {
  readonly boardId: string;
  readonly atMicroseconds: number;
  readonly unconnected: ReadonlySet<Terminal>;
}
export type ObservedArduinoInputs = ArduinoTerminalVoltages & {
  readonly [ADC_OBSERVATION]?: AdcObservation;
};

/** Declared educational interference, not a calibrated prediction of ambient noise.
 * Fixed code-unit FNV mixing and 1 ms canonical buckets have no advancing RNG state.
 */
export function unconnectedAdcReading(context: AdcObservation, pin: Terminal): number {
  let hash = 2166136261;
  const identity = `${context.boardId.length}:${context.boardId}:${pin}`;
  for (let index = 0; index < identity.length; index++)
    hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
  hash = Math.imul(hash ^ Math.floor(context.atMicroseconds / 1000), 16777619);
  hash ^= hash >>> 16;
  return (hash >>> 0) % 1024;
}

/** Conservative boundary: only INPUT pins and ideal wire/breadboard contacts.
 * A resistor, open switch or any other external device suppresses this model.
 * Prepared terminal nodes describe wires, unlike solver numerical islands/GMIN.
 */
export function observeArduinoInputs(
  voltages: ArduinoTerminalVoltages,
  document: ElectronicsDocument,
  terminalNodes: ReadonlyMap<string, ReadonlyMap<Terminal, number | undefined>>,
  boardId: string,
  atMicroseconds: number,
  mode: (boardId: string, pin: Terminal) => ArduinoPinMode | undefined,
): ObservedArduinoInputs {
  const blocked = new Set<number>();
  for (const component of document.components) {
    if (component.kind === 'wire' || component.kind === 'breadboard') continue;
    const uno =
      component.componentTypeId === 'arduino-uno' || component.variantId === 'arduino-uno';
    for (const [pin, node] of terminalNodes.get(component.id) ?? []) {
      if (
        node !== undefined &&
        (!uno ||
          !/^(a[0-5]|d([0-9]|1[0-3]))$/.test(pin) ||
          (mode(component.id, pin) ?? 'INPUT') !== 'INPUT')
      )
        blocked.add(node);
    }
  }
  const unconnected = new Set<Terminal>();
  for (const [pin, node] of terminalNodes.get(boardId) ?? [])
    if (/^a[0-5]$/.test(pin) && node !== undefined && !blocked.has(node)) unconnected.add(pin);
  return Object.assign({}, voltages, {
    [ADC_OBSERVATION]: { boardId, atMicroseconds, unconnected },
  });
}
