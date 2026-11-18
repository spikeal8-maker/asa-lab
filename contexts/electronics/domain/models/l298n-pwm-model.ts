import type { ElectronicsDocument, Terminal } from '../document.js';
import type { ArduinoRuntimeState } from '../arduino-program-runtime.js';
import { isArduinoUno } from '../arduino-model.js';
import { arduinoServoWaveforms } from '../arduino-servo-runtime.js';
import { terminalKey } from '../netlist.js';
import { isL298n } from './l298n-dc-model.js';
import { l298nControlNetIndices } from './l298n-input-network.js';
import {
  advanceArduinoTimedWaveform,
  arduinoWaveformLevelAt,
  arduinoWaveformNextDueMicroseconds,
  createArduinoTimedWaveform,
} from '../arduino-waveform-runtime.js';

const PWM_FREQUENCY_HZ: Readonly<Record<string, number>> = {
  d3: 490,
  d5: 980,
  d6: 980,
  d9: 490,
  d10: 490,
  d11: 490,
};

function waveform(pin: string, meanVoltage: number) {
  const frequency = PWM_FREQUENCY_HZ[pin];
  if (!frequency || !Number.isFinite(meanVoltage) || meanVoltage <= 0 || meanVoltage >= 5)
    return undefined;
  const duty = Math.round((meanVoltage / 5) * 255);
  if (duty <= 0 || duty >= 255) return undefined;
  // Retain the declared Uno timer origin/profile, but use the existing shared
  // microsecond/rational edge machinery instead of floating frame-time modulo.
  return createArduinoTimedWaveform(0, frequency, undefined, duty, 255);
}

export function sampleL298nArduinoPwmVoltage(
  pin: string,
  meanVoltage: number,
  simulationTimeMs: number,
): number {
  const signal = waveform(pin, meanVoltage);
  if (!signal) return meanVoltage;
  const at = Math.round(simulationTimeMs * 1000);
  if (!Number.isSafeInteger(at) || at < 0) return Number.NaN;
  return arduinoWaveformLevelAt(signal, at) * 5;
}

type ArduinoCurrentSampler = (
  componentId: string,
  voltages: Readonly<Partial<Record<Terminal, number>>>,
  branch: {
    readonly id: string;
    readonly terminal: Terminal;
    readonly ground: Terminal;
    readonly targetVoltage: number;
    readonly resistanceOhm: number;
  },
  options: {
    readonly simulationTimeMs?: number;
    readonly l298nPwmSampleTimeMs?: number | undefined;
  },
  committedTimeMs?: number,
) => number;

const sampleArduinoCurrent: ArduinoCurrentSampler = (_componentId, voltages, branch) => {
  const positive = voltages[branch.terminal] ?? 0;
  const ground = voltages[branch.ground] ?? 0;
  return (positive - ground - branch.targetVoltage) / branch.resistanceOhm;
};

/**
 * The direct and incremental quality audits must reconstruct the same source
 * voltage as the physical frame: held interval, committed state, then request.
 * This pure projection shares PWM eligibility and never advances a clock.
 */
export function createL298nArduinoCurrentSampler(
  document: ElectronicsDocument,
  nodes: ReadonlyMap<string, number>,
): ArduinoCurrentSampler {
  if (!document.components.some(isL298n)) return sampleArduinoCurrent;
  const controls = l298nControlNetIndices(document, nodes);
  if (controls.size === 0) return sampleArduinoCurrent;
  return (componentId, voltages, branch, options, committedTimeMs): number => {
    const target =
      !branch.id.startsWith('servo-') &&
      controls.has(nodes.get(terminalKey(componentId, branch.terminal)) ?? -1)
        ? sampleL298nArduinoPwmVoltage(
            branch.terminal,
            branch.targetVoltage,
            options.l298nPwmSampleTimeMs ?? committedTimeMs ?? options.simulationTimeMs ?? 0,
          )
        : branch.targetVoltage;
    const positive = voltages[branch.terminal] ?? 0;
    const ground = voltages[branch.ground] ?? 0;
    return (positive - ground - target) / branch.resistanceOhm;
  };
}

/**
 * Return the next electrical boundary to the EXISTING Arduino scheduler. No
 * private timer/state or UI time is advanced here. GPIO mean duty remains in
 * canonical runtime; each completed electrical interval uses its held level.
 */
export function nextL298nPwmEdgeMicroseconds(
  document: ElectronicsDocument,
  nodes: ReadonlyMap<string, number>,
  controlNodes: ReadonlySet<number>,
  states: ReadonlyMap<string, ArduinoRuntimeState>,
  atMicroseconds: number,
): number {
  if (controlNodes.size === 0) return Number.POSITIVE_INFINITY;
  if (!Number.isSafeInteger(atMicroseconds) || atMicroseconds < 0)
    throw new RangeError('L298N PWM boundary needs canonical nonnegative microseconds');
  let next = Number.POSITIVE_INFINITY;
  for (const board of document.components) {
    if (!isArduinoUno(board)) continue;
    const state = states.get(board.id);
    if (!state) continue;
    const servoPins = new Set(arduinoServoWaveforms(state.servo).map((signal) => signal.pin));
    for (const [pin, voltage] of Object.entries(state.outputVoltages)) {
      if (
        state.pinModes[pin] !== 'OUTPUT' ||
        state.tones[pin] ||
        servoPins.has(pin) ||
        voltage === undefined
      )
        continue;
      const node = nodes.get(terminalKey(board.id, pin as Terminal));
      if (node === undefined || !controlNodes.has(node)) continue;
      const signal = waveform(pin, voltage);
      if (!signal) continue;
      const current = advanceArduinoTimedWaveform(signal, atMicroseconds).state;
      if (!current) continue;
      const due = arduinoWaveformNextDueMicroseconds(current);
      if (!(due > atMicroseconds))
        throw new Error('L298N PWM must not schedule a zero-duration loop');
      next = Math.min(next, due);
    }
  }
  return next;
}
