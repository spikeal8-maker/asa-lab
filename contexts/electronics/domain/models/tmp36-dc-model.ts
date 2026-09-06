import type { SchematicComponent } from '../document.js';
import { componentModelIdentityIsInstalled } from '../model-identity.js';
import type { DeviceDiagnostic, IterativeDcDeviceModel } from './device-model.js';

/**
 * Educational steady-state TMP36 TO-92, not a transistor-level die model.
 * Analog Devices TMP35/36/37 Rev. H, pp. 1, 3: transfer, supply, load and pinout.
 * 60 ohm follows typical 6 m°C/uA load regulation at 25°C; 50 uA is the
 * conservative quiescent bound. 250 uA is the chosen short-current guard.
 * No accuracy scatter, startup delay, thermal inertia or self-heating simulation.
 */
export const TMP36_PROFILE = Object.freeze({
  id: 'tmp36-to92-dc',
  version: 1,
  minimumTemperatureCelsius: -40,
  maximumTemperatureCelsius: 125,
  defaultTemperatureCelsius: 25,
  minimumSupplyVolt: 2.7,
  maximumSupplyVolt: 5.5,
  offsetVolt: 0.5,
  sensitivityVoltPerCelsius: 0.01,
  outputResistanceOhm: 60,
  quiescentCurrentAmp: 50e-6,
  ratedOutputCurrentAmp: 50e-6,
  shortCircuitCurrentAmp: 250e-6,
  // Numerical off-state leakage dominates the solver's 1 pS reference shunts,
  // so a floating supply lead cannot look like a powered pin. Not a datasheet specification.
  supplyLeakageSiemens: 1e-9,
});
const GMIN = 1e-12;
export type Tmp36PowerState = 'powered' | 'unpowered' | 'undervoltage' | 'overvoltage' | 'reversed';
type OutputRegion = 'regulated' | 'current-limit' | 'high-impedance';
export interface Tmp36State {
  readonly power: Tmp36PowerState;
  readonly output: OutputRegion;
}
export interface Tmp36OperatingPoint {
  /** Both voltages relative to the sensor's GND, never global ground. */
  readonly supplyVolt: number;
  readonly outputVolt: number;
}
export interface Tmp36Observation {
  readonly sensorTemperatureCelsius: number;
  readonly sensorPowerState: Tmp36PowerState;
  readonly sensorOutputRegion: OutputRegion;
  readonly sensorOutputVoltageVolt: number;
  readonly sensorSupplyVoltageVolt: number;
  readonly sensorOutputCurrentAmp: number;
  readonly current: number;
  readonly power: number;
  readonly terminalCurrents: Readonly<Record<string, number>>;
  readonly diagnostics: readonly DeviceDiagnostic[];
}
function powerState(voltage: number): Tmp36PowerState {
  if (voltage < -1e-6) return 'reversed';
  if (voltage < 1e-6) return 'unpowered';
  if (voltage < TMP36_PROFILE.minimumSupplyVolt - 1e-9) return 'undervoltage';
  if (voltage > TMP36_PROFILE.maximumSupplyVolt + 1e-9) return 'overvoltage';
  return 'powered';
}
export const TMP36_DEVICE_MODEL: IterativeDcDeviceModel<
  { readonly temperatureCelsius: number; readonly targetVoltageVolt: number },
  Tmp36State,
  Tmp36OperatingPoint,
  Tmp36Observation
> = {
  id: 'analog-temperature-sensor',
  version: 1,
  analyses: ['dc'],
  validate(component) {
    const value = component.stateProperties?.['temperatureCelsius'] ?? 25;
    return typeof value === 'number' && Number.isFinite(value) && value >= -40 && value <= 125
      ? []
      : [
          {
            code: 'invalid_temperature',
            message: 'Температура TMP36 должна быть числом от −40 до 125 °C.',
          },
        ];
  },
  normalize(component) {
    const problem = TMP36_DEVICE_MODEL.validate(component)[0];
    if (problem) throw new RangeError(problem.message);
    const temperatureCelsius = Number(component.stateProperties?.['temperatureCelsius'] ?? 25);
    return {
      componentId: component.id,
      component,
      parameters: {
        temperatureCelsius,
        targetVoltageVolt:
          TMP36_PROFILE.offsetVolt + TMP36_PROFILE.sensitivityVoltPerCelsius * temperatureCelsius,
      },
    };
  },
  initialIterationState() {
    return { power: 'unpowered', output: 'high-impedance' };
  },
  stampDc(context, instance, state) {
    const supply = context.node(instance.component, 'pin-1');
    const output = context.node(instance.component, 'pin-2');
    const ground = context.node(instance.component, 'pin-3');
    context.stampConductance(supply, ground, TMP36_PROFILE.supplyLeakageSiemens);
    context.stampConductance(output, ground, GMIN);
    if (state.power !== 'powered') return;
    context.stampOffset(ground, supply, TMP36_PROFILE.quiescentCurrentAmp);
    // I(V+ -> OUT) = (Vtarget - Vout)/Rout: power comes from V+, not an ideal source.
    if (state.output === 'regulated') {
      const conductance = 1 / TMP36_PROFILE.outputResistanceOhm;
      context.stampVccs(supply, output, output, ground, -conductance);
      context.stampOffset(output, supply, instance.parameters.targetVoltageVolt * conductance);
    } else if (state.output === 'current-limit') {
      context.stampOffset(output, supply, TMP36_PROFILE.shortCircuitCurrentAmp);
    }
  },
  evaluateIteration(instance, previous, point) {
    const power = powerState(point.supplyVolt);
    const demand =
      (instance.parameters.targetVoltageVolt - point.outputVolt) /
      TMP36_PROFILE.outputResistanceOhm;
    const output: OutputRegion =
      power !== 'powered'
        ? 'high-impedance'
        : previous.power !== 'powered'
          ? 'regulated'
          : demand > TMP36_PROFILE.shortCircuitCurrentAmp + 1e-12
            ? 'current-limit'
            : demand < -1e-12
              ? 'high-impedance'
              : 'regulated';
    return {
      state: { power, output },
      changed: previous.power !== power || previous.output !== output,
    };
  },
  observe(instance, state, point) {
    const outputCurrent =
      state.power !== 'powered' || state.output === 'high-impedance'
        ? 0
        : state.output === 'current-limit'
          ? TMP36_PROFILE.shortCircuitCurrentAmp
          : (instance.parameters.targetVoltageVolt - point.outputVolt) /
            TMP36_PROFILE.outputResistanceOhm;
    const quiescent = state.power === 'powered' ? TMP36_PROFILE.quiescentCurrentAmp : 0;
    const supplyCurrent =
      quiescent + outputCurrent + point.supplyVolt * TMP36_PROFILE.supplyLeakageSiemens;
    const outputTerminalCurrent = -outputCurrent + point.outputVolt * GMIN;
    const diagnostics: DeviceDiagnostic[] = [];
    if (state.power !== 'powered') {
      const reasons = {
        unpowered: 'нет питания',
        undervoltage: 'недостаточное питание',
        overvoltage: 'питание выше рабочего диапазона',
        reversed: 'перепутана полярность питания',
      };
      diagnostics.push({
        code: 'temperature_sensor_power',
        severity: 'warning',
        message: `TMP36: ${reasons[state.power]}. Температурный выход не активен.`,
        suggestedAction: 'Подайте 2,7–5,5 В между выводами 1 (+Vs) и 3 (GND). Вывод 2 — выход.',
      });
    } else if (outputCurrent > TMP36_PROFILE.ratedOutputCurrentAmp + 1e-12) {
      diagnostics.push({
        code: 'temperature_sensor_load',
        severity: 'warning',
        message: 'TMP36: нагрузка выхода превышает 50 мкА; показание температуры недостоверно.',
        suggestedAction: 'Подключите выход к высокоомному входу мультиметра или Arduino.',
      });
    } else if (point.outputVolt > instance.parameters.targetVoltageVolt + 1e-6) {
      diagnostics.push({
        code: 'temperature_sensor_backfeed',
        severity: 'warning',
        message: 'TMP36: внешняя цепь поднимает напряжение выхода; это не температурное показание.',
        suggestedAction: 'Проверьте режим входа Arduino и внешние источники на выводе 2.',
      });
    }
    return {
      sensorTemperatureCelsius: instance.parameters.temperatureCelsius,
      sensorPowerState: state.power,
      sensorOutputRegion: state.output,
      sensorOutputVoltageVolt: point.outputVolt,
      sensorSupplyVoltageVolt: point.supplyVolt,
      sensorOutputCurrentAmp: outputCurrent,
      current: supplyCurrent,
      power: point.supplyVolt * supplyCurrent + point.outputVolt * outputTerminalCurrent,
      terminalCurrents: {
        'pin-1': supplyCurrent,
        'pin-2': outputTerminalCurrent,
        'pin-3': -supplyCurrent - outputTerminalCurrent,
      },
      diagnostics,
    };
  },
};
export function createTmp36DcDevice(component: SchematicComponent) {
  if (
    component.componentTypeId !== 'temperature-sensor' ||
    !componentModelIdentityIsInstalled(component)
  )
    return null;
  // Bad inputs reach the solver's invalid-property result, not an exception during setup.
  if (TMP36_DEVICE_MODEL.validate(component).length > 0) return null;
  return { model: TMP36_DEVICE_MODEL, instance: TMP36_DEVICE_MODEL.normalize(component) };
}
