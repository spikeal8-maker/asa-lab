import type { SchematicComponent } from '../document.js';

export const BRUSHED_MOTOR_PROFILE_REGISTRY_VERSION = 1;
export const MOTOR_ASSEMBLY_PROFILE_PROPERTY = 'motorAssemblyProfileId';

export type MotorComponentTypeId = 'dc-motor' | 'gearmotor';
export type MotorParameterBasis =
  'vendor_reported' | 'derived_from_vendor_reference' | 'educational_assumption';

export interface MotorProfileSource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly accessedOn: string;
  readonly kind: 'vendor_product_page' | 'internal_engineering_contract';
}

export interface MotorNumericParameter {
  readonly value: number;
  readonly unit: string;
  readonly basis: MotorParameterBasis;
  readonly sourceIds: readonly string[];
  readonly formula?: string;
}

export interface MotorReferencePoint {
  readonly sourceId: string;
  readonly voltageVolt: number;
  readonly noLoadSpeedRpm: number;
  readonly noLoadCurrentAmp: number;
  readonly stallCurrentAmp: number;
  readonly outputStallTorqueNewtonMeter?: number;
}

export interface MotorTransmissionProfile {
  readonly gearRatio: MotorNumericParameter;
  readonly material: 'none' | 'plastic' | 'bi-metal';
  readonly efficiencyLowerBound: MotorNumericParameter;
  readonly efficiencyUpperBound: MotorNumericParameter;
}

export interface BrushedMotorAssemblyProfile {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly componentTypeId: MotorComponentTypeId;
  readonly displayName: string;
  readonly activation: 'math_5b_required';
  readonly selectionStatus: 'selectable_reference' | 'reference_only_visual_variant_required';
  readonly operatingVoltageMin: MotorNumericParameter;
  readonly operatingVoltageMax: MotorNumericParameter;
  readonly fitReferenceVoltageVolt: number;
  readonly referencePoints: readonly MotorReferencePoint[];
  readonly armatureResistanceOhm: MotorNumericParameter;
  readonly armatureInductanceHenry: MotorNumericParameter;
  readonly backEmfVoltSecondPerRadian: MotorNumericParameter;
  readonly torqueNewtonMeterPerAmpere: MotorNumericParameter;
  readonly rotorInertiaKgMeterSquared: MotorNumericParameter;
  readonly viscousFrictionNewtonMeterSecondPerRadian: MotorNumericParameter;
  readonly thermalCapacitanceJoulePerCelsius: MotorNumericParameter;
  readonly thermalResistanceCelsiusPerWatt: MotorNumericParameter;
  readonly warningTemperatureCelsius: MotorNumericParameter;
  readonly failureTemperatureCelsius: MotorNumericParameter;
  readonly transmission: MotorTransmissionProfile;
}

export interface MotorProfileSelectionError {
  readonly code:
    | 'not_a_motor'
    | 'invalid_motor_profile'
    | 'incompatible_motor_profile'
    | 'motor_profile_not_selectable';
  readonly message: string;
}

export type MotorProfileSelection =
  | { readonly ok: true; readonly profile: BrushedMotorAssemblyProfile }
  | { readonly ok: false; readonly error: MotorProfileSelectionError };

const INTERNAL_ASSUMPTIONS_SOURCE_ID = 'asa-math-5a-educational-assumptions-v1';

export const BRUSHED_MOTOR_PROFILE_SOURCES: readonly MotorProfileSource[] = [
  {
    id: 'pololu-1117-product-page',
    title: 'Brushed DC Motor: 130-Size, 6V, 11.5kRPM, 800mA Stall',
    url: 'https://www.pololu.com/product/1117',
    accessedOn: '2026-08-30',
    kind: 'vendor_product_page',
  },
  {
    id: 'adafruit-3777-product-page',
    title: 'DC Gearbox Motor - TT Motor - 200RPM - 3 to 6VDC',
    url: 'https://www.adafruit.com/product/3777',
    accessedOn: '2026-08-30',
    kind: 'vendor_product_page',
  },
  {
    id: 'adafruit-3801-product-page',
    title: 'TT Motor Bi-Metal Gearbox - 1:90 Gear Ratio',
    url: 'https://www.adafruit.com/product/3801',
    accessedOn: '2026-08-30',
    kind: 'vendor_product_page',
  },
  {
    id: INTERNAL_ASSUMPTIONS_SOURCE_ID,
    title: 'ASA Lab MATH-5A declared educational assumptions',
    url: 'docs/product/electronics/README.md#math-5--dc-motor-и-мотор-редуктор',
    accessedOn: '2026-08-30',
    kind: 'internal_engineering_contract',
  },
];

function parameter(
  value: number,
  unit: string,
  basis: MotorParameterBasis,
  sourceIds: readonly string[],
  formula?: string,
): MotorNumericParameter {
  return {
    value,
    unit,
    basis,
    sourceIds,
    ...(formula === undefined ? {} : { formula }),
  };
}

function educational(value: number, unit: string): MotorNumericParameter {
  return parameter(value, unit, 'educational_assumption', [INTERNAL_ASSUMPTIONS_SOURCE_ID]);
}

function radiansPerSecond(rpm: number): number {
  return (rpm * 2 * Math.PI) / 60;
}

function referencePointAt(
  points: readonly MotorReferencePoint[],
  voltageVolt: number,
): MotorReferencePoint {
  const point = points.find((candidate) => candidate.voltageVolt === voltageVolt);
  if (!point) throw new Error(`Missing ${voltageVolt} V motor reference point`);
  return point;
}

function fitLinearMotor(
  point: MotorReferencePoint,
  gearRatio: number,
): {
  readonly resistanceOhm: number;
  readonly backEmfConstant: number;
  readonly torqueConstant: number;
  readonly viscousFriction: number;
} {
  const resistanceOhm = point.voltageVolt / point.stallCurrentAmp;
  const motorSpeedRadianPerSecond = radiansPerSecond(point.noLoadSpeedRpm * gearRatio);
  const effectiveBackEmfVolt = point.voltageVolt - point.noLoadCurrentAmp * resistanceOhm;
  const backEmfConstant = effectiveBackEmfVolt / motorSpeedRadianPerSecond;
  // In coherent SI units Kt [N·m/A] and Ke [V·s/rad] have the same value.
  const torqueConstant = backEmfConstant;
  const viscousFriction = (torqueConstant * point.noLoadCurrentAmp) / motorSpeedRadianPerSecond;
  return { resistanceOhm, backEmfConstant, torqueConstant, viscousFriction };
}

const POLULU_1117_POINTS: readonly MotorReferencePoint[] = [
  {
    sourceId: 'pololu-1117-product-page',
    voltageVolt: 6,
    noLoadSpeedRpm: 11_500,
    noLoadCurrentAmp: 0.07,
    stallCurrentAmp: 0.8,
  },
];

const ADAFRUIT_3777_POINTS: readonly MotorReferencePoint[] = [
  {
    sourceId: 'adafruit-3777-product-page',
    voltageVolt: 3,
    noLoadSpeedRpm: 120,
    noLoadCurrentAmp: 0.15,
    stallCurrentAmp: 1.1,
    outputStallTorqueNewtonMeter: 0.039_226_6,
  },
  {
    sourceId: 'adafruit-3777-product-page',
    voltageVolt: 4.5,
    noLoadSpeedRpm: 185,
    noLoadCurrentAmp: 0.155,
    stallCurrentAmp: 1.2,
  },
  {
    sourceId: 'adafruit-3777-product-page',
    voltageVolt: 6,
    noLoadSpeedRpm: 250,
    noLoadCurrentAmp: 0.16,
    stallCurrentAmp: 1.5,
    outputStallTorqueNewtonMeter: 0.078_453_2,
  },
];

const ADAFRUIT_3801_POINTS: readonly MotorReferencePoint[] = [
  {
    sourceId: 'adafruit-3801-product-page',
    voltageVolt: 3,
    noLoadSpeedRpm: 60,
    noLoadCurrentAmp: 0.08,
    stallCurrentAmp: 0.5,
  },
  {
    sourceId: 'adafruit-3801-product-page',
    voltageVolt: 4.5,
    noLoadSpeedRpm: 90,
    noLoadCurrentAmp: 0.09,
    stallCurrentAmp: 0.8,
  },
  {
    sourceId: 'adafruit-3801-product-page',
    voltageVolt: 6,
    noLoadSpeedRpm: 120,
    noLoadCurrentAmp: 0.1,
    stallCurrentAmp: 1,
  },
];

function profile(input: {
  readonly profileId: string;
  readonly componentTypeId: MotorComponentTypeId;
  readonly displayName: string;
  readonly selectionStatus: BrushedMotorAssemblyProfile['selectionStatus'];
  readonly sourceId: string;
  readonly voltageMin: number;
  readonly voltageMax: number;
  readonly referencePoints: readonly MotorReferencePoint[];
  readonly fitReferenceVoltageVolt: number;
  readonly gearRatio: number;
  readonly material: MotorTransmissionProfile['material'];
  readonly efficiencyLowerBound: number;
  readonly efficiencyUpperBound: number;
  readonly armatureInductanceHenry: number;
  readonly rotorInertiaKgMeterSquared: number;
  readonly thermalCapacitanceJoulePerCelsius: number;
  readonly thermalResistanceCelsiusPerWatt: number;
}): BrushedMotorAssemblyProfile {
  const fitPoint = referencePointAt(input.referencePoints, input.fitReferenceVoltageVolt);
  const fit = fitLinearMotor(fitPoint, input.gearRatio);
  const derivedSources = [fitPoint.sourceId, INTERNAL_ASSUMPTIONS_SOURCE_ID];
  const transmissionBasis =
    input.material === 'none' ? 'derived_from_vendor_reference' : 'vendor_reported';
  const transmissionSources =
    input.material === 'none' ? [INTERNAL_ASSUMPTIONS_SOURCE_ID] : [input.sourceId];
  return {
    profileId: input.profileId,
    profileVersion: 1,
    componentTypeId: input.componentTypeId,
    displayName: input.displayName,
    activation: 'math_5b_required',
    selectionStatus: input.selectionStatus,
    operatingVoltageMin: parameter(input.voltageMin, 'V', 'vendor_reported', [input.sourceId]),
    operatingVoltageMax: parameter(input.voltageMax, 'V', 'vendor_reported', [input.sourceId]),
    fitReferenceVoltageVolt: input.fitReferenceVoltageVolt,
    referencePoints: input.referencePoints,
    armatureResistanceOhm: parameter(
      fit.resistanceOhm,
      'Ohm',
      'derived_from_vendor_reference',
      [fitPoint.sourceId],
      'R = V / I_stall',
    ),
    armatureInductanceHenry: educational(input.armatureInductanceHenry, 'H'),
    backEmfVoltSecondPerRadian: parameter(
      fit.backEmfConstant,
      'V*s/rad',
      'derived_from_vendor_reference',
      derivedSources,
      'Ke = (V - I0*R) / omega_motor',
    ),
    torqueNewtonMeterPerAmpere: parameter(
      fit.torqueConstant,
      'N*m/A',
      'derived_from_vendor_reference',
      derivedSources,
      'Kt = Ke in coherent SI units',
    ),
    rotorInertiaKgMeterSquared: educational(input.rotorInertiaKgMeterSquared, 'kg*m^2'),
    viscousFrictionNewtonMeterSecondPerRadian: parameter(
      fit.viscousFriction,
      'N*m*s/rad',
      'derived_from_vendor_reference',
      derivedSources,
      'b = Kt*I0 / omega_motor',
    ),
    thermalCapacitanceJoulePerCelsius: educational(input.thermalCapacitanceJoulePerCelsius, 'J/C'),
    thermalResistanceCelsiusPerWatt: educational(input.thermalResistanceCelsiusPerWatt, 'C/W'),
    warningTemperatureCelsius: educational(90, 'C'),
    failureTemperatureCelsius: educational(150, 'C'),
    transmission: {
      gearRatio: parameter(
        input.gearRatio,
        'ratio',
        transmissionBasis,
        transmissionSources,
        input.material === 'none' ? 'direct drive identity ratio' : undefined,
      ),
      material: input.material,
      efficiencyLowerBound: educational(input.efficiencyLowerBound, 'ratio'),
      efficiencyUpperBound: educational(input.efficiencyUpperBound, 'ratio'),
    },
  };
}

export const BRUSHED_MOTOR_ASSEMBLY_PROFILES: readonly BrushedMotorAssemblyProfile[] = [
  profile({
    profileId: 'pololu-1117-130-6v',
    componentTypeId: 'dc-motor',
    displayName: '130-size brushed DC motor, 6 V educational reference',
    selectionStatus: 'selectable_reference',
    sourceId: 'pololu-1117-product-page',
    voltageMin: 3,
    voltageMax: 12,
    referencePoints: POLULU_1117_POINTS,
    fitReferenceVoltageVolt: 6,
    gearRatio: 1,
    material: 'none',
    efficiencyLowerBound: 1,
    efficiencyUpperBound: 1,
    armatureInductanceHenry: 0.000_45,
    rotorInertiaKgMeterSquared: 0.000_000_25,
    thermalCapacitanceJoulePerCelsius: 5,
    thermalResistanceCelsiusPerWatt: 12,
  }),
  profile({
    profileId: 'adafruit-3777-tt-48to1',
    componentTypeId: 'gearmotor',
    displayName: 'TT plastic gearmotor 1:48, 3-6 V educational reference',
    selectionStatus: 'selectable_reference',
    sourceId: 'adafruit-3777-product-page',
    voltageMin: 3,
    voltageMax: 6,
    referencePoints: ADAFRUIT_3777_POINTS,
    fitReferenceVoltageVolt: 6,
    gearRatio: 48,
    material: 'plastic',
    efficiencyLowerBound: 0.25,
    efficiencyUpperBound: 0.65,
    armatureInductanceHenry: 0.000_35,
    rotorInertiaKgMeterSquared: 0.000_000_2,
    thermalCapacitanceJoulePerCelsius: 7,
    thermalResistanceCelsiusPerWatt: 10,
  }),
  profile({
    profileId: 'adafruit-3801-tt-bimetal-90to1',
    componentTypeId: 'gearmotor',
    displayName: 'TT bi-metal gearmotor 1:90, 3-6 V educational reference',
    selectionStatus: 'reference_only_visual_variant_required',
    sourceId: 'adafruit-3801-product-page',
    voltageMin: 3,
    voltageMax: 6,
    referencePoints: ADAFRUIT_3801_POINTS,
    fitReferenceVoltageVolt: 6,
    gearRatio: 90,
    material: 'bi-metal',
    efficiencyLowerBound: 0.25,
    efficiencyUpperBound: 0.7,
    armatureInductanceHenry: 0.000_45,
    rotorInertiaKgMeterSquared: 0.000_000_2,
    thermalCapacitanceJoulePerCelsius: 7,
    thermalResistanceCelsiusPerWatt: 10,
  }),
];

export const DEFAULT_BRUSHED_MOTOR_PROFILE_IDS: Readonly<Record<MotorComponentTypeId, string>> = {
  'dc-motor': 'pololu-1117-130-6v',
  gearmotor: 'adafruit-3777-tt-48to1',
};

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function brushedMotorProfile(profileId: string): BrushedMotorAssemblyProfile | undefined {
  return BRUSHED_MOTOR_ASSEMBLY_PROFILES.find((profile) => profile.profileId === profileId);
}

export function brushedMotorProfilesForComponent(
  componentTypeId: MotorComponentTypeId,
): readonly BrushedMotorAssemblyProfile[] {
  return BRUSHED_MOTOR_ASSEMBLY_PROFILES.filter(
    (profile) => profile.componentTypeId === componentTypeId,
  ).sort((left, right) => ordinalCompare(left.profileId, right.profileId));
}

export function resolveBrushedMotorProfileSelection(
  component: SchematicComponent,
): MotorProfileSelection {
  if (component.componentTypeId !== 'dc-motor' && component.componentTypeId !== 'gearmotor') {
    return {
      ok: false,
      error: { code: 'not_a_motor', message: 'Компонент не является DC-мотором.' },
    };
  }
  const configured = component.stateProperties?.[MOTOR_ASSEMBLY_PROFILE_PROPERTY];
  if (configured !== undefined && typeof configured !== 'string') {
    return {
      ok: false,
      error: {
        code: 'invalid_motor_profile',
        message: 'Профиль двигателя должен быть идентификатором из реестра.',
      },
    };
  }
  const profileId = configured ?? DEFAULT_BRUSHED_MOTOR_PROFILE_IDS[component.componentTypeId];
  const selected = brushedMotorProfile(profileId);
  if (!selected) {
    return {
      ok: false,
      error: {
        code: 'invalid_motor_profile',
        message: `Профиль двигателя ${profileId} отсутствует в реестре.`,
      },
    };
  }
  if (selected.componentTypeId !== component.componentTypeId) {
    return {
      ok: false,
      error: {
        code: 'incompatible_motor_profile',
        message: `Профиль ${profileId} несовместим с ${component.componentTypeId}.`,
      },
    };
  }
  if (selected.selectionStatus !== 'selectable_reference') {
    return {
      ok: false,
      error: {
        code: 'motor_profile_not_selectable',
        message: `Профиль ${profileId} требует подтверждённого визуального варианта.`,
      },
    };
  }
  return { ok: true, profile: selected };
}

function numericParameters(profile: BrushedMotorAssemblyProfile): readonly MotorNumericParameter[] {
  return [
    profile.operatingVoltageMin,
    profile.operatingVoltageMax,
    profile.armatureResistanceOhm,
    profile.armatureInductanceHenry,
    profile.backEmfVoltSecondPerRadian,
    profile.torqueNewtonMeterPerAmpere,
    profile.rotorInertiaKgMeterSquared,
    profile.viscousFrictionNewtonMeterSecondPerRadian,
    profile.thermalCapacitanceJoulePerCelsius,
    profile.thermalResistanceCelsiusPerWatt,
    profile.warningTemperatureCelsius,
    profile.failureTemperatureCelsius,
    profile.transmission.gearRatio,
    profile.transmission.efficiencyLowerBound,
    profile.transmission.efficiencyUpperBound,
  ];
}

export function validateBrushedMotorProfileRegistry(): readonly string[] {
  const issues: string[] = [];
  const sourceIds = new Set(BRUSHED_MOTOR_PROFILE_SOURCES.map((source) => source.id));
  const profileIds = new Set<string>();
  for (const profile of BRUSHED_MOTOR_ASSEMBLY_PROFILES) {
    if (profileIds.has(profile.profileId)) issues.push(`duplicate profile ${profile.profileId}`);
    profileIds.add(profile.profileId);
    for (const parameterValue of numericParameters(profile)) {
      if (!Number.isFinite(parameterValue.value)) {
        issues.push(`${profile.profileId} contains a non-finite ${parameterValue.unit} value`);
      }
      if (parameterValue.value <= 0) {
        issues.push(`${profile.profileId} contains a non-positive ${parameterValue.unit} value`);
      }
      for (const sourceId of parameterValue.sourceIds) {
        if (!sourceIds.has(sourceId)) issues.push(`${profile.profileId} references ${sourceId}`);
      }
    }
    for (const point of profile.referencePoints) {
      if (!sourceIds.has(point.sourceId))
        issues.push(`${profile.profileId} references ${point.sourceId}`);
      for (const value of [
        point.voltageVolt,
        point.noLoadSpeedRpm,
        point.noLoadCurrentAmp,
        point.stallCurrentAmp,
        ...(point.outputStallTorqueNewtonMeter === undefined
          ? []
          : [point.outputStallTorqueNewtonMeter]),
      ]) {
        if (!Number.isFinite(value) || value <= 0) {
          issues.push(`${profile.profileId} contains an invalid reference point`);
        }
      }
    }
    if (
      profile.transmission.efficiencyLowerBound.value >
      profile.transmission.efficiencyUpperBound.value
    ) {
      issues.push(`${profile.profileId} has an inverted efficiency range`);
    }
    if (profile.transmission.efficiencyUpperBound.value > 1) {
      issues.push(`${profile.profileId} claims transmission efficiency above 1`);
    }
    if (profile.warningTemperatureCelsius.value >= profile.failureTemperatureCelsius.value) {
      issues.push(`${profile.profileId} warning temperature is not below failure`);
    }
  }
  for (const [componentTypeId, profileId] of Object.entries(DEFAULT_BRUSHED_MOTOR_PROFILE_IDS)) {
    const selected = brushedMotorProfile(profileId);
    if (
      selected?.componentTypeId !== componentTypeId ||
      selected.selectionStatus !== 'selectable_reference'
    ) {
      issues.push(`default ${profileId} is invalid for ${componentTypeId}`);
    }
  }
  return issues;
}

export function canonicalBrushedMotorProfileRegistry(): string {
  return JSON.stringify({
    registryVersion: BRUSHED_MOTOR_PROFILE_REGISTRY_VERSION,
    sources: [...BRUSHED_MOTOR_PROFILE_SOURCES].sort((left, right) =>
      ordinalCompare(left.id, right.id),
    ),
    profiles: [...BRUSHED_MOTOR_ASSEMBLY_PROFILES].sort((left, right) =>
      ordinalCompare(left.profileId, right.profileId),
    ),
    defaults: DEFAULT_BRUSHED_MOTOR_PROFILE_IDS,
  });
}

export function canonicalBrushedMotorReferenceFixtures(): string {
  return JSON.stringify({
    schema: 'asa-lab.electronics-brushed-motor-reference-fixtures.v1',
    registryVersion: BRUSHED_MOTOR_PROFILE_REGISTRY_VERSION,
    profiles: [...BRUSHED_MOTOR_ASSEMBLY_PROFILES]
      .sort((left, right) => ordinalCompare(left.profileId, right.profileId))
      .map((profile) => ({
        profileId: profile.profileId,
        profileVersion: profile.profileVersion,
        componentTypeId: profile.componentTypeId,
        fitReferenceVoltageVolt: profile.fitReferenceVoltageVolt,
        referencePoints: profile.referencePoints,
      })),
  });
}
