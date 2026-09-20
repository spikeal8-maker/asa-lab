import type { SchematicComponent } from '../document.js';
import { componentModelIdentityIsInstalled } from '../model-identity.js';
import type { DeviceDiagnostic, IterativeDcDeviceModel } from './device-model.js';

export const PIR_SENSOR_PROFILE = Object.freeze({
  minimumSupplyVolt: 3,
  maximumSupplyVolt: 6,
  logicHighVolt: 3.3,
  outputResistanceOhm: 100,
});

export type PirSensorPowerState =
  'powered' | 'unpowered' | 'undervoltage' | 'overvoltage' | 'reversed';

export type PirSensorOutputRegion = 'digital-high' | 'digital-low' | 'high-impedance';

export interface PirSensorState {
  readonly power: PirSensorPowerState;
  readonly output: PirSensorOutputRegion;
  readonly targetVoltageVolt: number;
}

export interface PirSensorObservation {
  readonly sensorMotionDetected: boolean;
  readonly sensorPowerState: PirSensorPowerState;
  readonly sensorOutputRegion: PirSensorOutputRegion;
  readonly sensorOutputVoltageVolt: number;
  readonly sensorSupplyVoltageVolt: number;
  readonly sensorOutputCurrentAmp: number;
  readonly current: number;
  readonly power: number;
  readonly terminalCurrents: Readonly<Record<string, number>>;
  readonly diagnostics: readonly DeviceDiagnostic[];
}

function powerState(voltage: number): PirSensorPowerState {
  if (voltage < -1e-6) return 'reversed';
  if (voltage < 1e-6) return 'unpowered';
  if (voltage < PIR_SENSOR_PROFILE.minimumSupplyVolt - 1e-9) return 'undervoltage';
  if (voltage > PIR_SENSOR_PROFILE.maximumSupplyVolt + 1e-9) return 'overvoltage';
  return 'powered';
}

export const PIR_SENSOR_MODEL: IterativeDcDeviceModel<
  { readonly motionDetected: boolean },
  PirSensorState,
  { readonly supplyVolt: number; readonly outputVolt: number },
  PirSensorObservation
> = {
  id: 'pir-motion-sensor',
  version: 1,
  analyses: ['dc'],
  validate(component) {
    const value = component.stateProperties?.['motionDetected'];
    return value === undefined || typeof value === 'boolean'
      ? []
      : [{ code: 'invalid_motion_state', message: 'motionDetected должен быть boolean.' }];
  },
  normalize(component) {
    const issue = PIR_SENSOR_MODEL.validate(component)[0];
    if (issue) throw new RangeError(issue.message);
    return {
      componentId: component.id,
      component,
      parameters: { motionDetected: component.stateProperties?.['motionDetected'] === true },
    };
  },
  initialIterationState() {
    return { power: 'unpowered', output: 'high-impedance', targetVoltageVolt: 0 };
  },
  stampDc(context, instance, state) {
    const supply = context.node(instance.component, 'vcc');
    const output = context.node(instance.component, 'signal');
    const ground = context.node(instance.component, 'gnd');
    context.stampConductance(supply, ground, 1e-9);
    if (state.output === 'high-impedance') return;
    const conductance = 1 / PIR_SENSOR_PROFILE.outputResistanceOhm;
    context.stampConductance(output, ground, conductance);
    context.stampOffset(output, ground, conductance * state.targetVoltageVolt);
  },
  evaluateIteration(instance, previous, point) {
    const power = powerState(point.supplyVolt);
    const targetVoltageVolt =
      power === 'powered' && instance.parameters.motionDetected
        ? Math.min(PIR_SENSOR_PROFILE.logicHighVolt, Math.max(0, point.supplyVolt))
        : 0;
    const output: PirSensorOutputRegion =
      power !== 'powered'
        ? 'high-impedance'
        : instance.parameters.motionDetected
          ? 'digital-high'
          : 'digital-low';
    const state = { power, output, targetVoltageVolt };
    return {
      state,
      changed:
        previous.power !== power ||
        previous.output !== output ||
        previous.targetVoltageVolt !== targetVoltageVolt,
    };
  },
  observe(instance, state, point) {
    const signalCurrent =
      state.output === 'high-impedance'
        ? 0
        : (point.outputVolt - state.targetVoltageVolt) / PIR_SENSOR_PROFILE.outputResistanceOhm;
    const supplyCurrent =
      point.supplyVolt * 1e-9 + (state.power === 'powered' ? Math.max(0, -signalCurrent) : 0);
    const diagnostics: readonly DeviceDiagnostic[] =
      state.power === 'powered'
        ? []
        : [
            {
              code: 'pir_sensor_power',
              severity: 'warning',
              message: `PIR: питание ${state.power}; цифровой выход находится в высокоомном состоянии.`,
            },
          ];
    return {
      sensorMotionDetected: instance.parameters.motionDetected,
      sensorPowerState: state.power,
      sensorOutputRegion: state.output,
      sensorOutputVoltageVolt: point.outputVolt,
      sensorSupplyVoltageVolt: point.supplyVolt,
      sensorOutputCurrentAmp: -signalCurrent,
      current: supplyCurrent,
      power: point.supplyVolt * supplyCurrent + point.outputVolt * signalCurrent,
      terminalCurrents: {
        vcc: supplyCurrent,
        signal: signalCurrent,
        gnd: -supplyCurrent - signalCurrent,
      },
      diagnostics,
    };
  },
};

type PirDevice = {
  readonly model: typeof PIR_SENSOR_MODEL;
  readonly instance: ReturnType<typeof PIR_SENSOR_MODEL.normalize>;
};
type VoltageAt = (component: SchematicComponent, terminal: 'vcc' | 'signal' | 'gnd') => number;

export function createPirSensorDevices(
  components: readonly SchematicComponent[],
): readonly PirDevice[] {
  return components.flatMap((component) =>
    component.componentTypeId === 'pir-sensor' &&
    componentModelIdentityIsInstalled(component) &&
    PIR_SENSOR_MODEL.validate(component).length === 0
      ? [{ model: PIR_SENSOR_MODEL, instance: PIR_SENSOR_MODEL.normalize(component) }]
      : [],
  );
}

export function initialPirSensorStates(devices: readonly PirDevice[]): Map<string, PirSensorState> {
  return new Map(
    devices.map((device) => [
      device.instance.componentId,
      device.model.initialIterationState(device.instance),
    ]),
  );
}

export function stampPirSensorDevices(
  context: Parameters<typeof PIR_SENSOR_MODEL.stampDc>[0],
  devices: readonly PirDevice[],
  states: ReadonlyMap<string, PirSensorState>,
): void {
  for (const device of devices)
    device.model.stampDc(context, device.instance, states.get(device.instance.componentId)!);
}

function operatingPoint(component: SchematicComponent, voltageAt: VoltageAt) {
  const ground = voltageAt(component, 'gnd');
  return {
    supplyVolt: voltageAt(component, 'vcc') - ground,
    outputVolt: voltageAt(component, 'signal') - ground,
  };
}

export function evaluatePirSensorDevices(
  devices: readonly PirDevice[],
  states: Map<string, PirSensorState>,
  voltageAt: VoltageAt,
): boolean {
  let changed = false;
  for (const device of devices) {
    const id = device.instance.componentId;
    const evaluated = device.model.evaluateIteration(
      device.instance,
      states.get(id)!,
      operatingPoint(device.instance.component, voltageAt),
    );
    states.set(id, evaluated.state);
    changed ||= evaluated.changed;
  }
  return changed;
}

export function observePirSensorDevices(
  devices: readonly PirDevice[],
  states: ReadonlyMap<string, PirSensorState>,
  voltageAt: VoltageAt,
): ReadonlyMap<string, PirSensorObservation> {
  return new Map(
    devices.map((device) => [
      device.instance.componentId,
      device.model.observe(
        device.instance,
        states.get(device.instance.componentId)!,
        operatingPoint(device.instance.component, voltageAt),
      ),
    ]),
  );
}
