import type { SchematicComponent, Terminal } from '../document.js';
import type {
  IterativeDcDeviceModel,
  IterativeDcStampContext,
  ModelIssue,
  NormalizedDevice,
} from './device-model.js';

export const L298N_TYPE = 'l298n-motor-driver';
export const L298N_TERMINALS = [
  '+12V',
  'GND',
  '+5V',
  'OUT1',
  'OUT2',
  'OUT3',
  'OUT4',
  'IN1',
  'IN2',
  'IN3',
  'IN4',
] as const;
export type L298nBridgeMode =
  'coast' | 'forward' | 'reverse' | 'brake-low' | 'brake-high' | 'unknown';
export type L298nLogic = 'low' | 'high' | 'unknown';
export interface L298nParameters {
  readonly enaJumperInstalled: boolean;
  readonly enbJumperInstalled: boolean;
  readonly regulatorJumperInstalled: boolean;
  readonly outputOnResistanceOhm: number;
  readonly logicLoadResistanceOhm: number;
}
export interface L298nChannelState {
  readonly mode: L298nBridgeMode;
  readonly firstRail: '+12V' | 'GND' | null;
  readonly secondRail: '+12V' | 'GND' | null;
}
export interface L298nIterationState {
  readonly channelA: L298nChannelState;
  readonly channelB: L298nChannelState;
  readonly logicPowered: boolean;
  readonly motorPowered: boolean;
  readonly inputKnown: boolean;
  readonly regulatorOn: boolean;
  readonly regulatorConflict: boolean;
}
export interface L298nOperatingPoint {
  readonly terminalVoltages: Readonly<Record<Terminal, number>>;
  readonly drivenTerminals: ReadonlySet<string>;
  readonly externalLogicSourcePresent?: boolean;
}
export interface L298nObservation {
  readonly componentId: string;
  readonly channelA: L298nBridgeMode;
  readonly channelB: L298nBridgeMode;
  readonly logicPowered: boolean;
  readonly motorPowered: boolean;
  readonly ledOn: boolean;
  readonly terminalCurrents: Readonly<Record<string, number>>;
  readonly supplyCurrentAmp: number;
  readonly powerWatt: number;
  readonly overCurrent: boolean;
  readonly unsupported: boolean;
}
const COAST: L298nChannelState = Object.freeze({
  mode: 'coast',
  firstRail: null,
  secondRail: null,
});
const UNKNOWN: L298nChannelState = Object.freeze({
  mode: 'unknown',
  firstRail: null,
  secondRail: null,
});
const INITIAL: L298nIterationState = Object.freeze({
  channelA: COAST,
  channelB: COAST,
  logicPowered: false,
  motorPowered: false,
  inputKnown: true,
  regulatorOn: false,
  regulatorConflict: false,
});
const OUTPUT_ON_RESISTANCE_OHM = 1.2;
const LOGIC_LOAD_RESISTANCE_OHM = 1250;
const MAX_CHANNEL_CURRENT_AMP = 2;
const REGULATOR_GAIN_SIEMENS = 10;
const REGULATOR_MAX_CURRENT_AMP = 0.5;

export function isL298n(component: SchematicComponent): boolean {
  return component.componentTypeId === L298N_TYPE;
}
export function l298nConfiguration(component: SchematicComponent) {
  const props = component.stateProperties ?? {};
  return {
    enaJumperInstalled: props['enaJumperInstalled'] !== false,
    enbJumperInstalled: props['enbJumperInstalled'] !== false,
    regulatorJumperInstalled: props['regulatorJumperInstalled'] !== false,
  };
}
function logicLevel(value: number, reference: number, driven: boolean): L298nLogic {
  if (!driven || !Number.isFinite(value) || !Number.isFinite(reference)) return 'unknown';
  const relative = value - reference;
  if (relative >= -0.3 && relative <= 0.8) return 'low';
  if (relative >= 2 && relative <= 5.5) return 'high';
  return 'unknown';
}
function channelState(
  enable: L298nLogic,
  first: L298nLogic,
  second: L298nLogic,
): L298nChannelState {
  if (enable === 'unknown') return UNKNOWN;
  if (enable === 'low') return COAST;
  if (first === 'unknown' || second === 'unknown') return UNKNOWN;
  if (first === 'high' && second === 'low')
    return { mode: 'forward', firstRail: '+12V', secondRail: 'GND' };
  if (first === 'low' && second === 'high')
    return { mode: 'reverse', firstRail: 'GND', secondRail: '+12V' };
  return first === 'low'
    ? { mode: 'brake-low', firstRail: 'GND', secondRail: 'GND' }
    : { mode: 'brake-high', firstRail: '+12V', secondRail: '+12V' };
}

/**
 * Restricted iterative DeviceModel for the EXISTING ASA Lab MNA matrix.
 * Resistive output stages are stamped onto the canonical nets and loaded by
 * the real motor model. Control inputs come from actual net voltages at this
 * physical-time step, including Arduino PWM transitions.
 *
 * 78M05 is a bounded KCL-conserving linear-pass approximation active only
 * for 7–12 V at VS with the regulator shunt fitted. It draws actual supply
 * current from VS; simultaneous external +5 V supply is fail-closed.
 * External 4.5–5.5 V logic supply is used when the shunt is removed.
 */
export const L298N_DC_MODEL: IterativeDcDeviceModel<
  L298nParameters,
  L298nIterationState,
  L298nOperatingPoint,
  L298nObservation
> = {
  id: 'l298n-dual-hbridge',
  version: 1,
  analyses: ['dc'],
  validate(component): readonly ModelIssue[] {
    const issues: ModelIssue[] = [];
    if (!isL298n(component)) {
      return [{ code: 'l298n_wrong_component', message: 'Ожидается L298N.' }];
    }
    const pins = new Set(component.pinIds ?? []);
    for (const id of L298N_TERMINALS) {
      if (!pins.has(id))
        issues.push({ code: 'l298n_missing_pin', message: 'Нет контакта ' + id + '.' });
    }
    const state = component.stateProperties ?? {};
    for (const key of ['enaJumperInstalled', 'enbJumperInstalled', 'regulatorJumperInstalled']) {
      if (state[key] !== undefined && typeof state[key] !== 'boolean') {
        issues.push({
          code: 'l298n_invalid_jumper',
          message: 'Неверная конфигурация ' + key + '.',
        });
      }
    }
    const config = l298nConfiguration(component);
    if (!config.enaJumperInstalled && !pins.has('ENA')) {
      issues.push({
        code: 'l298n_ena_missing',
        message: 'При снятом шунте ENA требуется вход ENA.',
      });
    }
    if (!config.enbJumperInstalled && !pins.has('ENB')) {
      issues.push({
        code: 'l298n_enb_missing',
        message: 'При снятом шунте ENB требуется вход ENB.',
      });
    }
    return issues;
  },
  normalize(component): NormalizedDevice<L298nParameters> {
    return {
      componentId: component.id,
      component,
      parameters: {
        ...l298nConfiguration(component),
        outputOnResistanceOhm: OUTPUT_ON_RESISTANCE_OHM,
        logicLoadResistanceOhm: LOGIC_LOAD_RESISTANCE_OHM,
      },
    };
  },
  initialIterationState(): L298nIterationState {
    return INITIAL;
  },
  stampDc(context: IterativeDcStampContext, instance: NormalizedDevice<L298nParameters>, state) {
    const component = instance.component;
    context.stampConductance(
      context.node(component, '+5V'),
      context.node(component, 'GND'),
      1 / instance.parameters.logicLoadResistanceOhm,
    );
    if (state.regulatorOn) {
      // The internal linear pass element transfers KCL current from VS to the
      // +5V rail. A high-gain VCCS with 5 V setpoint is NOT a free source:
      // the same current is drawn from VS at each physical-time solve.
      const logic = context.node(component, '+5V');
      const motorSupply = context.node(component, '+12V');
      const ground = context.node(component, 'GND');
      context.stampVccs(logic, motorSupply, logic, ground, REGULATOR_GAIN_SIEMENS);
      context.stampOffset(logic, motorSupply, REGULATOR_GAIN_SIEMENS * 5);
    }
    if (!state.motorPowered || !state.logicPowered) return;
    for (const [terminal, rail] of [
      ['OUT1', state.channelA.firstRail],
      ['OUT2', state.channelA.secondRail],
      ['OUT3', state.channelB.firstRail],
      ['OUT4', state.channelB.secondRail],
    ] as const) {
      if (rail === null) continue;
      context.stampConductance(
        context.node(component, terminal),
        context.node(component, rail),
        1 / instance.parameters.outputOnResistanceOhm,
      );
    }
  },
  evaluateIteration(instance, state, point) {
    const v = (terminal: string) => point.terminalVoltages[terminal] ?? Number.NaN;
    const ground = v('GND');
    const logicVolt = v('+5V') - ground;
    const motorVolt = v('+12V') - ground;
    const logicPowered = logicVolt >= 4.5 && logicVolt <= 5.5;
    const motorPowered = motorVolt >= 4.5 && motorVolt <= 35;
    const regulatorConflict =
      instance.parameters.regulatorJumperInstalled && point.externalLogicSourcePresent === true;
    const regulatorOn =
      instance.parameters.regulatorJumperInstalled &&
      !regulatorConflict &&
      motorVolt >= 7 &&
      motorVolt <= 12;
    const input = (terminal: string) =>
      logicLevel(v(terminal), ground, point.drivenTerminals.has(terminal));
    const config = instance.parameters;
    const ena: L298nLogic = config.enaJumperInstalled ? 'high' : input('ENA');
    const enb: L298nLogic = config.enbJumperInstalled ? 'high' : input('ENB');
    const channelA =
      logicPowered && motorPowered ? channelState(ena, input('IN1'), input('IN2')) : COAST;
    const channelB =
      logicPowered && motorPowered ? channelState(enb, input('IN3'), input('IN4')) : COAST;
    const next: L298nIterationState = {
      channelA,
      channelB,
      logicPowered,
      motorPowered,
      inputKnown: channelA.mode !== 'unknown' && channelB.mode !== 'unknown',
      regulatorOn,
      regulatorConflict,
    };
    return {
      state: next,
      changed:
        next.channelA.mode !== state.channelA.mode ||
        next.channelB.mode !== state.channelB.mode ||
        next.logicPowered !== state.logicPowered ||
        next.motorPowered !== state.motorPowered ||
        next.inputKnown !== state.inputKnown ||
        next.regulatorOn !== state.regulatorOn ||
        next.regulatorConflict !== state.regulatorConflict,
    };
  },
  observe(instance, state, point) {
    const v = (terminal: string) => point.terminalVoltages[terminal] ?? 0;
    const currents: Record<string, number> = Object.fromEntries(
      [...L298N_TERMINALS, 'ENA', 'ENB'].map((terminal) => [terminal, 0]),
    );
    const iLogic = (v('+5V') - v('GND')) / instance.parameters.logicLoadResistanceOhm;
    currents['+5V'] += iLogic;
    currents['GND'] -= iLogic;
    let powerWatt = iLogic * (v('+5V') - v('GND'));
    const regulatorCurrent = state.regulatorOn
      ? REGULATOR_GAIN_SIEMENS * (5 - (v('+5V') - v('GND')))
      : 0;
    currents['+12V'] += regulatorCurrent;
    currents['+5V'] -= regulatorCurrent;
    powerWatt += regulatorCurrent * (v('+12V') - v('+5V'));
    let overCurrent = regulatorCurrent < -0.001 || regulatorCurrent > REGULATOR_MAX_CURRENT_AMP;
    const edges = [
      ['OUT1', state.channelA.firstRail],
      ['OUT2', state.channelA.secondRail],
      ['OUT3', state.channelB.firstRail],
      ['OUT4', state.channelB.secondRail],
    ] as const;
    for (const [terminal, rail] of edges) {
      if (rail === null) continue;
      const current = (v(terminal) - v(rail)) / instance.parameters.outputOnResistanceOhm;
      currents[terminal] += current;
      currents[rail] -= current;
      powerWatt += current * current * instance.parameters.outputOnResistanceOhm;
      if (Math.abs(current) > MAX_CHANNEL_CURRENT_AMP) overCurrent = true;
    }
    return {
      componentId: instance.componentId,
      channelA: state.channelA.mode,
      channelB: state.channelB.mode,
      logicPowered: state.logicPowered,
      motorPowered: state.motorPowered,
      ledOn: state.logicPowered,
      terminalCurrents: currents,
      supplyCurrentAmp: currents['+12V'],
      powerWatt,
      overCurrent,
      unsupported: !state.inputKnown || overCurrent || state.regulatorConflict,
    };
  },
};
