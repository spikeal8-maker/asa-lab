import type { SchematicComponent } from '../document.js';
import { componentModelIdentityIsInstalled } from '../model-identity.js';
import type { DeviceDiagnostic, IterativeDcDeviceModel } from './device-model.js';

/** Three-wire resistive module. Circuit topology follows SparkFun's original
 * VCC/GND/SIG sensor; resistance endpoints are an explicit educational soil
 * calibration, NOT a universal conversion to volumetric water content. */
export const SOIL_MOISTURE_PROFILE = Object.freeze({
  id: 'asa-resistive-soil-divider',
  version: 1,
  dryResistanceOhm: 1_000_000,
  wetResistanceOhm: 1_000,
  dividerResistanceOhm: 10_000,
  defaultMoisturePercent: 50,
  minimumSupplyVolt: 3.3,
  maximumSupplyVolt: 5,
});
export function soilResistanceOhm(moisturePercent: number): number {
  return (
    SOIL_MOISTURE_PROFILE.dryResistanceOhm *
    (SOIL_MOISTURE_PROFILE.wetResistanceOhm / SOIL_MOISTURE_PROFILE.dryResistanceOhm) **
      (moisturePercent / 100)
  );
}
export interface SoilObservation {
  readonly sensorMoisturePercent: number;
  readonly sensorResistanceOhm: number;
  readonly sensorPowerState: 'powered' | 'unpowered' | 'undervoltage' | 'overvoltage' | 'reversed';
  readonly sensorOutputRegion: 'divider';
  readonly sensorOutputVoltageVolt: number;
  readonly sensorSupplyVoltageVolt: number;
  readonly sensorOutputCurrentAmp: number;
  readonly current: number;
  readonly power: number;
  readonly terminalCurrents: Readonly<Record<string, number>>;
  readonly diagnostics: readonly DeviceDiagnostic[];
}
export const SOIL_MOISTURE_MODEL: IterativeDcDeviceModel<
  { readonly moisturePercent: number; readonly soilResistanceOhm: number },
  null,
  { readonly supplyVolt: number; readonly outputVolt: number },
  SoilObservation
> = {
  id: 'resistive-soil-sensor',
  version: 1,
  analyses: ['dc'],
  validate(component) {
    const value = component.stateProperties?.['moisturePercent'] ?? 50;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
      ? []
      : [{ code: 'invalid_moisture', message: 'Влажность должна быть числом от 0 до 100 %.' }];
  },
  normalize(component) {
    const error = SOIL_MOISTURE_MODEL.validate(component)[0];
    if (error) throw new RangeError(error.message);
    const moisturePercent = Number(component.stateProperties?.['moisturePercent'] ?? 50);
    return {
      componentId: component.id,
      component,
      parameters: { moisturePercent, soilResistanceOhm: soilResistanceOhm(moisturePercent) },
    };
  },
  initialIterationState() {
    return null;
  },
  stampDc(context, instance) {
    const supply = context.node(instance.component, 'vcc');
    const output = context.node(instance.component, 'signal');
    const ground = context.node(instance.component, 'gnd');
    context.stampConductance(supply, output, 1 / instance.parameters.soilResistanceOhm);
    context.stampConductance(output, ground, 1 / SOIL_MOISTURE_PROFILE.dividerResistanceOhm);
  },
  evaluateIteration() {
    return { state: null, changed: false };
  },
  observe(instance, _state, point) {
    const { supplyVolt: vs, outputVolt: vo } = point;
    const r = instance.parameters.soilResistanceOhm;
    const supplyCurrent = (vs - vo) / r;
    const groundCurrent = -vo / SOIL_MOISTURE_PROFILE.dividerResistanceOhm;
    const outputCurrent = -supplyCurrent - groundCurrent;
    const powerState =
      vs < -1e-6
        ? 'reversed'
        : vs < 1e-6
          ? 'unpowered'
          : vs < SOIL_MOISTURE_PROFILE.minimumSupplyVolt - 1e-3
            ? 'undervoltage'
            : vs > SOIL_MOISTURE_PROFILE.maximumSupplyVolt + 1e-3
              ? 'overvoltage'
              : 'powered';
    const diagnostics: DeviceDiagnostic[] = [];
    if (powerState !== 'powered')
      diagnostics.push({
        code: 'soil_sensor_power',
        severity: 'warning',
        message:
          'Датчик влажности: проверьте питание 3,3–5 В и общий провод. Показание вне рабочего питания недостоверно.',
        suggestedAction:
          'VCC — питание, GND — общий провод, SIG — аналоговый выход. Пассивный делитель не генерирует питание.',
      });
    const expected =
      (vs * SOIL_MOISTURE_PROFILE.dividerResistanceOhm) /
      (r + SOIL_MOISTURE_PROFILE.dividerResistanceOhm);
    if (powerState === 'powered' && Math.abs(vo - expected) > 0.02 * vs)
      diagnostics.push({
        code: 'soil_sensor_load',
        severity: 'warning',
        message: 'Датчик влажности: внешняя цепь заметно изменяет напряжение SIG.',
        suggestedAction:
          'Используйте высокоомный вход. Проверьте нагрузку, внешнее напряжение и режим INPUT_PULLUP.',
      });
    return {
      sensorMoisturePercent: instance.parameters.moisturePercent,
      sensorResistanceOhm: r,
      sensorPowerState: powerState,
      sensorOutputRegion: 'divider',
      sensorOutputVoltageVolt: vo,
      sensorSupplyVoltageVolt: vs,
      sensorOutputCurrentAmp: -outputCurrent,
      current: supplyCurrent,
      power: (vs - vo) ** 2 / r + vo ** 2 / SOIL_MOISTURE_PROFILE.dividerResistanceOhm,
      terminalCurrents: { vcc: supplyCurrent, signal: outputCurrent, gnd: groundCurrent },
      diagnostics,
    };
  },
};
export function createSoilMoistureDevice(component: SchematicComponent) {
  if (
    component.componentTypeId !== 'soil-moisture-sensor' ||
    !componentModelIdentityIsInstalled(component) ||
    SOIL_MOISTURE_MODEL.validate(component).length
  )
    return null;
  return { model: SOIL_MOISTURE_MODEL, instance: SOIL_MOISTURE_MODEL.normalize(component) };
}
