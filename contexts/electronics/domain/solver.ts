import {
  terminalsForComponent,
  type ElectronicsDocument,
  type SchematicComponent,
  type Terminal,
} from './document.js';
import { arduinoOutputBranches, isArduinoUno } from './arduino-model.js';
import { photoresistorResistanceOhm } from './photoresistor-model.js';
import { buildNetlist, terminalKey } from './netlist.js';
import {
  unsupportedElectricalComponents,
  validateElectricalTerminalContract,
} from './model-registry.js';
import {
  ledBrightnessPercent,
  ordinaryLedProfile,
  rgbLedProfile,
  type LedJunctionProfile,
  type LedLinearSegment,
} from './led-model.js';

export type DiagnosticCode =
  | 'circuit_ok'
  | 'no_source'
  | 'open_circuit'
  | 'short_circuit'
  | 'invalid_property'
  | 'invalid_terminal_contract'
  | 'conflicting_sources'
  | 'reverse_polarity'
  | 'resistor_near_limit'
  | 'resistor_overload'
  | 'led_near_limit'
  | 'led_overcurrent'
  | 'led_burnout'
  | 'transistor_reverse_bias'
  | 'transistor_overcurrent'
  | 'unsupported_component'
  | 'unsupported_topology'
  | 'numerical_instability'
  | 'nonconvergent_topology';
export type DiagnosticSeverity = 'info' | 'warning' | 'error';
export type SimulationSolveStatus = 'solved' | 'invalid' | 'unsupported' | 'nonconvergent';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly componentIds?: readonly string[];
  readonly wireIds?: readonly string[];
  readonly netIds?: readonly string[];
  readonly suggestedAction?: string;
  readonly anchors?: readonly DiagnosticAnchor[];
}

export interface DiagnosticAnchor {
  readonly kind: 'component' | 'wire' | 'net';
  readonly id: string;
}

export interface ComponentResult {
  readonly componentId: string;
  readonly voltageDrop: number;
  readonly current: number;
  readonly terminalVoltages: Readonly<Partial<Record<Terminal, number>>>;
  readonly power?: number;
  readonly brightness?: number;
  readonly branchCurrents?: Readonly<Record<string, number>>;
  readonly branchBrightness?: Readonly<Record<string, number>>;
  readonly lit?: boolean;
  readonly energized?: boolean;
  readonly currentUtilizationPercent?: number;
  readonly powerUtilizationPercent?: number;
  readonly stressState?: 'normal' | 'warning' | 'overcurrent' | 'burned';
  readonly operatingRegion?: 'cutoff' | 'active' | 'saturation' | 'ohmic';
  readonly baseCurrent?: number;
  readonly collectorCurrent?: number;
  readonly emitterCurrent?: number;
  readonly currentGain?: number;
}

export interface NodeResult {
  readonly id: string;
  readonly voltage: number;
  readonly terminals: readonly string[];
}

export interface SolveResult {
  readonly solved: boolean;
  readonly status: SimulationSolveStatus;
  readonly current: number;
  readonly components: readonly ComponentResult[];
  readonly nodes: readonly NodeResult[];
  readonly diagnostics: readonly Diagnostic[];
  readonly iterations: number;
  readonly numericalResidual: number;
  readonly numericalTolerance: number;
}

export interface SolveOptions {
  readonly simulationTimeMs?: number;
}

const GMIN = 1e-12;
const CLOSED_RESISTANCE = 1e-4;
const DIODE_ON_RESISTANCE = 2;
const SEVEN_SEGMENT_ON_RESISTANCE = 8;
const LED_NOMINAL_CURRENT_A = 0.02;
const LED_WARNING_RATIO = 0.8;
const RESISTOR_WARNING_RATIO = 0.8;
const DEFAULT_RESISTOR_POWER_RATING_W = 0.25;
const LAMP_MIN_POWER_W = 0.001;
const LAMP_NOMINAL_POWER_W = 1.5;
const SHORT_CIRCUIT_CURRENT_A = 5;
const NPN_DEFAULT_CURRENT_GAIN = 100;
const NPN_DEFAULT_BASE_EMITTER_VOLTAGE = 0.7;
const NPN_DEFAULT_SATURATION_VOLTAGE = 0.2;
const NPN_BASE_EMITTER_RESISTANCE = 10;
const NPN_SATURATION_RESISTANCE = 0.5;
const NPN_DEFAULT_MAX_COLLECTOR_CURRENT_A = 0.2;
const FET_DEFAULT_THRESHOLD_VOLTAGE = 2;
const FET_DEFAULT_TRANSCONDUCTANCE_FACTOR = 0.05;
const FET_DEFAULT_MAX_DRAIN_CURRENT_A = 0.5;
const FET_MIN_OHMIC_CONDUCTANCE = 1e-4;

function formatReferenceMilliamp(currentAmp: number): string {
  const rounded = Math.round(Math.abs(currentAmp) * 10_000) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} mA`;
}

const SEVEN_SEGMENT_TERMINALS: Readonly<Record<string, Terminal>> = {
  a: 'top-4',
  b: 'top-5',
  c: 'bottom-4',
  d: 'bottom-2',
  e: 'bottom-1',
  f: 'top-2',
  g: 'top-1',
  dp: 'bottom-5',
};

interface DiodeBranch {
  readonly component: SchematicComponent;
  readonly id: string;
  readonly anode: Terminal;
  readonly cathode: Terminal;
  readonly forwardVoltage: number;
  readonly resistance: number;
  readonly nominalCurrent: number;
  readonly maxCurrent: number;
  readonly brightnessExponent: number;
  readonly linearSegments?: readonly LedLinearSegment[];
  readonly nearLimitWarning: boolean;
}

type TransistorOperatingRegion = 'cutoff' | 'active' | 'saturation' | 'ohmic';

type TransistorType = 'npn' | 'pnp' | 'fet';

interface BjtTransistorModel {
  readonly transistorType: 'npn' | 'pnp';
  readonly component: SchematicComponent;
  readonly base: Terminal;
  readonly collector: Terminal;
  readonly emitter: Terminal;
  readonly currentGain: number;
  readonly baseEmitterVoltage: number;
  readonly saturationVoltage: number;
  readonly maxCollectorCurrent: number;
}

interface FetTransistorModel {
  readonly transistorType: 'fet';
  readonly component: SchematicComponent;
  readonly gate: Terminal;
  readonly source: Terminal;
  readonly drain: Terminal;
  readonly thresholdVoltage: number;
  readonly transconductanceFactor: number;
  readonly maxDrainCurrent: number;
}

type TransistorModel = BjtTransistorModel | FetTransistorModel;

function boundedProperty(
  component: SchematicComponent,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(component.stateProperties?.[key] ?? fallback);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function transistorTypeOf(component: SchematicComponent): TransistorType {
  const raw = String(component.stateProperties?.['transistorType'] ?? '').toLowerCase();
  if (raw === 'pnp' || raw === 'fet' || raw === 'npn') return raw;
  const typeId = component.componentTypeId ?? '';
  if (typeId.includes('pnp')) return 'pnp';
  if (typeId.includes('fet')) return 'fet';
  return 'npn';
}

function transistorModel(component: SchematicComponent): TransistorModel | null {
  if (component.kind !== 'transistor') return null;
  const transistorType = transistorTypeOf(component);
  if (transistorType === 'fet') {
    return {
      transistorType,
      component,
      gate: 'gate',
      source: 'source',
      drain: 'drain',
      thresholdVoltage: boundedProperty(
        component,
        'thresholdVoltage',
        FET_DEFAULT_THRESHOLD_VOLTAGE,
        0.5,
        5,
      ),
      transconductanceFactor: boundedProperty(
        component,
        'transconductanceFactor',
        FET_DEFAULT_TRANSCONDUCTANCE_FACTOR,
        0.001,
        10,
      ),
      maxDrainCurrent: boundedProperty(
        component,
        'maxDrainCurrent',
        FET_DEFAULT_MAX_DRAIN_CURRENT_A,
        0.001,
        20,
      ),
    };
  }
  return {
    transistorType,
    component,
    base: 'base',
    collector: 'collector',
    emitter: 'emitter',
    currentGain: boundedProperty(component, 'currentGain', NPN_DEFAULT_CURRENT_GAIN, 1, 1_000),
    baseEmitterVoltage: boundedProperty(
      component,
      'baseEmitterVoltage',
      NPN_DEFAULT_BASE_EMITTER_VOLTAGE,
      0.4,
      1.2,
    ),
    saturationVoltage: boundedProperty(
      component,
      'saturationVoltage',
      NPN_DEFAULT_SATURATION_VOLTAGE,
      0.05,
      0.6,
    ),
    maxCollectorCurrent: boundedProperty(
      component,
      'maxCollectorCurrent',
      NPN_DEFAULT_MAX_COLLECTOR_CURRENT_A,
      0.001,
      20,
    ),
  };
}

function diodeBranchKey(branch: DiodeBranch): string {
  return `${branch.component.id}:${branch.id}`;
}

function diodeLinearSegments(branch: DiodeBranch): readonly LedLinearSegment[] {
  return (
    branch.linearSegments ?? [
      {
        minimumCurrentAmp: 0,
        kneeVoltage: branch.forwardVoltage,
        dynamicResistanceOhm: branch.resistance,
      },
    ]
  );
}

function diodeLinearSegment(branch: DiodeBranch, index: number): LedLinearSegment {
  const segments = diodeLinearSegments(branch);
  return segments[Math.min(Math.max(0, index), segments.length - 1)]!;
}

function diodeLinearSegmentIndex(branch: DiodeBranch, currentAmp: number): number {
  const segments = diodeLinearSegments(branch);
  let selected = 0;
  for (const [index, segment] of segments.entries()) {
    if (currentAmp + 1e-10 < segment.minimumCurrentAmp) break;
    selected = index;
  }
  return selected;
}

function ledBrightness(
  current: number,
  profile: Pick<LedJunctionProfile, 'nominalCurrentAmp' | 'brightnessExponent'>,
): number {
  return ledBrightnessPercent(current, profile);
}

function componentDiodeBranches(component: SchematicComponent): readonly DiodeBranch[] {
  if (component.kind === 'led') {
    const colour = String(component.stateProperties?.['ledColour'] ?? 'red');
    const profile = ordinaryLedProfile(colour);
    return [
      {
        component,
        id: 'led',
        anode: logicalTerminal(component, 'a'),
        cathode: logicalTerminal(component, 'b'),
        forwardVoltage: profile.kneeVoltage,
        resistance: profile.dynamicResistanceOhm,
        nominalCurrent: profile.nominalCurrentAmp,
        maxCurrent: profile.burnoutCurrentAmp,
        brightnessExponent: profile.brightnessExponent,
        ...(profile.linearSegments ? { linearSegments: profile.linearSegments } : {}),
        nearLimitWarning: profile.nearLimitWarning ?? true,
      },
    ];
  }
  if (component.kind === 'diode') {
    return [
      {
        component,
        id: 'diode',
        anode: logicalTerminal(component, 'a'),
        cathode: logicalTerminal(component, 'b'),
        forwardVoltage: component.value,
        resistance: DIODE_ON_RESISTANCE,
        nominalCurrent: LED_NOMINAL_CURRENT_A,
        maxCurrent: Number.POSITIVE_INFINITY,
        brightnessExponent: 0.65,
        nearLimitWarning: false,
      },
    ];
  }
  if (component.kind === 'rgb-led') {
    const common = 'common';
    const commonAnode = component.stateProperties?.['commonMode'] === 'common-anode';
    return ['red', 'green', 'blue'].map((channel) => {
      const profile = rgbLedProfile(channel);
      return {
        component,
        id: channel,
        anode: commonAnode ? common : channel,
        cathode: commonAnode ? channel : common,
        forwardVoltage: profile.kneeVoltage,
        resistance: profile.dynamicResistanceOhm,
        nominalCurrent: profile.nominalCurrentAmp,
        maxCurrent: profile.burnoutCurrentAmp,
        brightnessExponent: profile.brightnessExponent,
        ...(profile.linearSegments ? { linearSegments: profile.linearSegments } : {}),
        nearLimitWarning: profile.nearLimitWarning ?? true,
      };
    });
  }
  if (component.kind === 'seven-segment') {
    const common = 'bottom-3';
    const commonAnode = component.stateProperties?.['commonMode'] === 'common-anode';
    return Object.entries(SEVEN_SEGMENT_TERMINALS).map(([segment, terminal]) => ({
      component,
      id: segment,
      anode: commonAnode ? common : terminal,
      cathode: commonAnode ? terminal : common,
      forwardVoltage: 1.9,
      resistance: SEVEN_SEGMENT_ON_RESISTANCE,
      nominalCurrent: 0.01,
      maxCurrent: 0.02,
      brightnessExponent: 0.65,
      nearLimitWarning: true,
    }));
  }
  return [];
}

type LogicalTerminal = 'a' | 'b' | 'wiper';

function logicalTerminal(component: SchematicComponent, terminal: LogicalTerminal): Terminal {
  const type = component.componentTypeId;
  if (!type) return terminal;
  if (component.kind === 'source' && type) {
    const positive = component.pinIds?.includes('BAT+') ? 'BAT+' : 'positive';
    const negative = component.pinIds?.includes('BAT-') ? 'BAT-' : 'negative';
    return terminal === 'a' ? positive : negative;
  }
  if (component.kind === 'resistor' || component.kind === 'photoresistor')
    return terminal === 'a' ? 'lead-1' : 'lead-2';
  if (component.kind === 'led' || component.kind === 'diode') {
    return terminal === 'a' ? 'anode' : 'cathode';
  }
  if (component.kind === 'button') return terminal === 'a' ? 'SW-A1' : 'SW-B1';
  if (component.kind === 'switch') {
    if (terminal === 'a') return 'common';
    return component.state === true ? 'throw-right' : 'throw-left';
  }
  if (component.kind === 'potentiometer') {
    if (terminal === 'wiper') return 'wiper';
    return terminal === 'a' ? 'terminal-1' : 'terminal-2';
  }
  if (component.kind === 'lamp') return terminal === 'a' ? 'L1' : 'L2';
  return terminal;
}

function isSimulated(component: SchematicComponent): boolean {
  return isArduinoUno(component) || !['breadboard', 'visual', 'wire'].includes(component.kind);
}

/**
 * Presentation rounding for solved values. The default must stay far below the
 * verification tolerances in `simulation.ts` (1 µA KCL, 1 nV source voltage):
 * the quality check reads these rounded numbers, so rounding at 6 digits
 * leaked up to 0.5 µA per branch and rejected an eight-branch seven-segment
 * display as nonconvergent although the solve itself was exact.
 */
function round(value: number, digits = 12): number {
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

/**
 * An open switch or a reverse-biased junction conducts nothing. The linear
 * solve still returns GMIN-scale residue (~pA) there; reporting it as a
 * measured current would be inventing a value, so anything below the
 * deadband — a thousand times tighter than the 1 µA KCL tolerance — is zero.
 */
const CURRENT_DEADBAND_AMP = 1e-9;
function roundCurrent(value: number): number {
  return Math.abs(value) < CURRENT_DEADBAND_AMP ? 0 : round(value);
}

function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index] as number]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]?.[column] ?? 0) > Math.abs(augmented[pivot]?.[column] ?? 0)) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot]?.[column] ?? 0) < 1e-14) return null;
    [augmented[column], augmented[pivot]] = [
      augmented[pivot] as number[],
      augmented[column] as number[],
    ];
    const divisor = augmented[column]?.[column] as number;
    for (let cell = column; cell <= size; cell += 1) {
      (augmented[column] as number[])[cell] = (augmented[column]?.[cell] as number) / divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]?.[column] as number;
      if (Math.abs(factor) < 1e-18) continue;
      for (let cell = column; cell <= size; cell += 1) {
        (augmented[row] as number[])[cell] =
          (augmented[row]?.[cell] as number) - factor * (augmented[column]?.[cell] as number);
      }
    }
  }
  return augmented.map((row) => row[size] as number);
}

function propertyError(component: SchematicComponent): string | null {
  if (!Number.isFinite(component.value) || component.value < 0)
    return 'Значение должно быть неотрицательным числом.';
  if (component.kind === 'source' && component.value <= 0)
    return 'Напряжение источника должно быть больше нуля.';
  if ((component.kind === 'lamp' || component.kind === 'potentiometer') && component.value <= 0) {
    return 'Сопротивление должно быть больше нуля.';
  }
  if ((component.kind === 'led' || component.kind === 'diode') && component.value <= 0)
    return 'Прямое падение напряжения должно быть больше нуля.';
  if (component.kind === 'transistor') {
    if (transistorTypeOf(component) === 'fet') {
      const thresholdVoltage = Number(
        component.stateProperties?.['thresholdVoltage'] ?? FET_DEFAULT_THRESHOLD_VOLTAGE,
      );
      const transconductanceFactor = Number(
        component.stateProperties?.['transconductanceFactor'] ??
          FET_DEFAULT_TRANSCONDUCTANCE_FACTOR,
      );
      const maxDrainCurrent = Number(
        component.stateProperties?.['maxDrainCurrent'] ?? FET_DEFAULT_MAX_DRAIN_CURRENT_A,
      );
      if (!Number.isFinite(thresholdVoltage) || thresholdVoltage < 0.5 || thresholdVoltage > 5)
        return 'Пороговое напряжение затвора должно быть от 0,5 до 5 В.';
      if (
        !Number.isFinite(transconductanceFactor) ||
        transconductanceFactor < 0.001 ||
        transconductanceFactor > 10
      )
        return 'Крутизна полевого транзистора должна быть от 0,001 до 10 А/В².';
      if (!Number.isFinite(maxDrainCurrent) || maxDrainCurrent < 0.001 || maxDrainCurrent > 20)
        return 'Допустимый ток стока должен быть от 1 мА до 20 А.';
      return null;
    }
    const currentGain = Number(component.stateProperties?.['currentGain'] ?? component.value);
    const baseEmitterVoltage = Number(
      component.stateProperties?.['baseEmitterVoltage'] ?? NPN_DEFAULT_BASE_EMITTER_VOLTAGE,
    );
    const saturationVoltage = Number(
      component.stateProperties?.['saturationVoltage'] ?? NPN_DEFAULT_SATURATION_VOLTAGE,
    );
    const maxCollectorCurrent = Number(
      component.stateProperties?.['maxCollectorCurrent'] ?? NPN_DEFAULT_MAX_COLLECTOR_CURRENT_A,
    );
    if (!Number.isFinite(currentGain) || currentGain < 1 || currentGain > 1_000)
      return 'Коэффициент усиления hFE должен быть от 1 до 1000.';
    if (
      !Number.isFinite(baseEmitterVoltage) ||
      baseEmitterVoltage < 0.4 ||
      baseEmitterVoltage > 1.2
    )
      return 'Напряжение база–эмиттер должно быть от 0,4 до 1,2 В.';
    if (!Number.isFinite(saturationVoltage) || saturationVoltage < 0.05 || saturationVoltage > 0.6)
      return 'Напряжение насыщения должно быть от 0,05 до 0,6 В.';
    if (
      !Number.isFinite(maxCollectorCurrent) ||
      maxCollectorCurrent < 0.001 ||
      maxCollectorCurrent > 20
    )
      return 'Допустимый ток коллектора должен быть от 1 мА до 20 А.';
  }
  if (component.kind === 'potentiometer' && (component.wiperPosition ?? 0.5) < 0)
    return 'Положение движка должно быть от 0 до 1.';
  if (component.kind === 'potentiometer' && (component.wiperPosition ?? 0.5) > 1)
    return 'Положение движка должно быть от 0 до 1.';
  return null;
}

function resistorPowerRatingWatt(component: SchematicComponent): number {
  const configured = Number(component.stateProperties?.['powerRatingWatt']);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_RESISTOR_POWER_RATING_W;
}

function withDiagnosticAnchors(diagnostic: Diagnostic): Diagnostic {
  if (diagnostic.anchors) return diagnostic;
  const anchors: DiagnosticAnchor[] = [
    ...(diagnostic.componentIds ?? []).map((id) => ({ kind: 'component' as const, id })),
    ...(diagnostic.wireIds ?? []).map((id) => ({ kind: 'wire' as const, id })),
    ...(diagnostic.netIds ?? []).map((id) => ({ kind: 'net' as const, id })),
  ];
  return anchors.length === 0 ? diagnostic : { ...diagnostic, anchors };
}

export function solveCircuit(
  document: ElectronicsDocument,
  options: SolveOptions = {},
): SolveResult {
  const diagnostics: Diagnostic[] = [];
  const netlist = buildNetlist(document);
  const sources = document.components.filter((component) => component.kind === 'source');
  const arduinoBranches = document.components.flatMap((component) =>
    arduinoOutputBranches(component, options.simulationTimeMs ?? 0).map((branch) => ({
      component,
      ...branch,
    })),
  );
  const sourceProviderIds = [
    ...sources.map((source) => source.id),
    ...document.components.filter(isArduinoUno).map((component) => component.id),
  ];
  const empty = (
    status: Exclude<SimulationSolveStatus, 'solved'>,
    iterations = 0,
    numericalResidual = 0,
    numericalTolerance = 0,
  ): SolveResult => ({
    solved: false,
    status,
    current: 0,
    components: [],
    nodes: [],
    diagnostics: diagnostics.map(withDiagnosticAnchors),
    iterations,
    numericalResidual,
    numericalTolerance,
  });

  const invalid = document.components.flatMap((component) => {
    const message = propertyError(component);
    return message ? [{ component, message }] : [];
  });
  for (const entry of invalid) {
    diagnostics.push({
      code: 'invalid_property',
      severity: 'error',
      message: `${entry.component.name ?? entry.component.id}: ${entry.message}`,
      componentIds: [entry.component.id],
      suggestedAction: 'Исправьте значение в инспекторе компонента.',
    });
  }
  if (invalid.length > 0) return empty('invalid');
  const invalidTerminalContracts = document.components.flatMap((component) => {
    const contract = validateElectricalTerminalContract(component);
    return contract.valid ? [] : [{ component, missing: contract.missing }];
  });
  for (const entry of invalidTerminalContracts) {
    diagnostics.push({
      code: 'invalid_terminal_contract',
      severity: 'error',
      message: `${entry.component.name ?? entry.component.id}: отсутствуют обязательные выводы ${entry.missing.join(', ')}.`,
      componentIds: [entry.component.id],
      suggestedAction: 'Восстановите подтверждённый pin map компонента перед моделированием.',
    });
  }
  if (invalidTerminalContracts.length > 0) return empty('invalid');
  const unsupported = unsupportedElectricalComponents(document.components);
  if (unsupported.length > 0) {
    diagnostics.push({
      code: 'unsupported_component',
      severity: 'error',
      message: `${unsupported.length} компонент(а) не имеют подтверждённой электрической модели. Расчёт остановлен без вымышленных значений.`,
      componentIds: unsupported.map((component) => component.id),
      suggestedAction:
        'Удалите неподдерживаемый компонент или дождитесь отдельной реализации его модели.',
    });
    return empty('unsupported');
  }
  if (sources.length === 0 && arduinoBranches.length === 0) {
    diagnostics.push({
      code: 'no_source',
      severity: 'error',
      message: 'В схеме нет источника постоянного напряжения.',
      suggestedAction: 'Добавьте источник и соедините замкнутую цепь.',
    });
    return empty('invalid');
  }

  for (const source of sources) {
    const a = netlist.nodeOf.get(terminalKey(source.id, logicalTerminal(source, 'a')));
    const b = netlist.nodeOf.get(terminalKey(source.id, logicalTerminal(source, 'b')));
    if (a === undefined || b === undefined || a === b) {
      diagnostics.push({
        code: 'short_circuit',
        severity: 'error',
        message: 'Выводы источника соединены одной идеальной сетью — короткое замыкание.',
        componentIds: [source.id],
        netIds: a === undefined ? [] : [`net-${a}`],
        suggestedAction: 'Разорвите прямое соединение и добавьте нагрузку.',
      });
      return empty('invalid');
    }
  }

  const sourceByNodePair = new Map<
    string,
    { readonly sourceId: string; readonly orientedVoltage: number }
  >();
  for (const source of sources) {
    const positive = netlist.nodeOf.get(
      terminalKey(source.id, logicalTerminal(source, 'a')),
    ) as number;
    const negative = netlist.nodeOf.get(
      terminalKey(source.id, logicalTerminal(source, 'b')),
    ) as number;
    const low = Math.min(positive, negative);
    const high = Math.max(positive, negative);
    const key = `${low}:${high}`;
    const orientedVoltage = positive === low ? source.value : -source.value;
    const existing = sourceByNodePair.get(key);
    if (!existing) {
      sourceByNodePair.set(key, { sourceId: source.id, orientedVoltage });
      continue;
    }
    const sameVoltage = Math.abs(existing.orientedVoltage - orientedVoltage) <= 1e-9;
    diagnostics.push({
      code: sameVoltage ? 'unsupported_topology' : 'conflicting_sources',
      severity: 'error',
      message: sameVoltage
        ? 'Параллельные идеальные источники не имеют однозначного распределения токов.'
        : 'Источники задают разные напряжения между одной парой электрических сетей.',
      componentIds: [existing.sourceId, source.id],
      netIds: [`net-${low}`, `net-${high}`],
      suggestedAction: sameVoltage
        ? 'Оставьте один источник или добавьте подтверждённые внутренние сопротивления.'
        : 'Разъедините конфликтующие источники и проверьте их полярность.',
    });
    return empty(sameVoltage ? 'unsupported' : 'invalid');
  }

  // Every disconnected electrical island needs its own voltage reference.
  // Using one global reference forces unrelated loose parts and open sources
  // through tiny GMIN paths. That makes an otherwise ordinary circuit badly
  // conditioned: placing a second, unused battery beside a working LED branch
  // used to be enough for harmless floating-point residue to reject the whole
  // simulation. Wires and breadboard groups are already collapsed by the
  // netlist; component terminals join those nets into independent islands.
  const islandParent = Array.from({ length: netlist.nodeCount }, (_, node) => node);
  const findIsland = (node: number): number => {
    let root = node;
    while (islandParent[root] !== root) root = islandParent[root] as number;
    let current = node;
    while (islandParent[current] !== current) {
      const next = islandParent[current] as number;
      islandParent[current] = root;
      current = next;
    }
    return root;
  };
  const joinIsland = (left: number, right: number): void => {
    const leftRoot = findIsland(left);
    const rightRoot = findIsland(right);
    if (leftRoot !== rightRoot) islandParent[rightRoot] = leftRoot;
  };
  for (const component of document.components.filter(isSimulated)) {
    const nodes = terminalsForComponent(component)
      .map((terminal) => netlist.nodeOf.get(terminalKey(component.id, terminal)))
      .filter((node): node is number => node !== undefined);
    const first = nodes[0];
    if (first === undefined) continue;
    for (const node of nodes.slice(1)) joinIsland(first, node);
  }
  const referenceByIsland = new Map<number, number>();
  for (const source of sources) {
    const negative = netlist.nodeOf.get(
      terminalKey(source.id, logicalTerminal(source, 'b')),
    ) as number;
    const island = findIsland(negative);
    if (!referenceByIsland.has(island)) referenceByIsland.set(island, negative);
  }
  for (const branch of arduinoBranches) {
    const ground = netlist.nodeOf.get(terminalKey(branch.component.id, branch.ground));
    if (ground === undefined) continue;
    const island = findIsland(ground);
    if (!referenceByIsland.has(island)) referenceByIsland.set(island, ground);
  }
  for (let node = 0; node < netlist.nodeCount; node += 1) {
    const island = findIsland(node);
    if (!referenceByIsland.has(island)) referenceByIsland.set(island, node);
  }
  const referenceNodes = new Set(referenceByIsland.values());

  const nodeVariables = new Map<number, number>();
  for (let node = 0; node < netlist.nodeCount; node += 1) {
    if (!referenceNodes.has(node)) nodeVariables.set(node, nodeVariables.size);
  }
  const nodeVariableCount = nodeVariables.size;
  const size = nodeVariableCount + sources.length;
  const diodeBranches = document.components.flatMap(componentDiodeBranches);
  const diodeStates = new Map<string, boolean>();
  const diodeSegmentIndices = new Map<string, number>();
  const transistorModels = document.components.flatMap((component) => {
    const model = transistorModel(component);
    return model ? [model] : [];
  });
  const transistorRegions = new Map<string, TransistorOperatingRegion>();
  const fetOverdrives = new Map<string, number>();
  // Start nonlinear junctions open. A real forward voltage discovered by the
  // first linear solve turns them on; an isolated LED must not create its own
  // artificial voltage across otherwise floating terminals.
  for (const branch of diodeBranches) {
    const key = diodeBranchKey(branch);
    diodeStates.set(key, false);
    diodeSegmentIndices.set(key, 0);
  }
  for (const transistor of transistorModels) {
    transistorRegions.set(transistor.component.id, 'cutoff');
    if (transistor.transistorType === 'fet') fetOverdrives.set(transistor.component.id, 0);
  }

  let solution: number[] | null = null;
  let converged = false;
  let iterations = 1;
  let finalMatrix: number[][] | null = null;
  let finalRhs: number[] | null = null;
  const maxIterations = document.simulation.maxIterations;
  const nodeIndex = (component: SchematicComponent, terminal: LogicalTerminal): number =>
    netlist.nodeOf.get(terminalKey(component.id, logicalTerminal(component, terminal))) as number;
  const physicalNodeIndex = (component: SchematicComponent, terminal: Terminal): number =>
    netlist.nodeOf.get(terminalKey(component.id, terminal)) as number;
  const voltageFrom = (values: number[], node: number): number =>
    referenceNodes.has(node) ? 0 : (values[nodeVariables.get(node) as number] as number);

  for (; iterations <= maxIterations; iterations += 1) {
    const matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
    const rhs = Array<number>(size).fill(0);
    const stampConductance = (left: number, right: number, conductance: number): void => {
      const li = nodeVariables.get(left);
      const ri = nodeVariables.get(right);
      if (li !== undefined) matrix[li]![li] += conductance;
      if (ri !== undefined) matrix[ri]![ri] += conductance;
      if (li !== undefined && ri !== undefined) {
        matrix[li]![ri] -= conductance;
        matrix[ri]![li] -= conductance;
      }
    };
    const stampOffset = (left: number, right: number, current: number): void => {
      const li = nodeVariables.get(left);
      const ri = nodeVariables.get(right);
      if (li !== undefined) rhs[li] += current;
      if (ri !== undefined) rhs[ri] -= current;
    };
    const stampVccs = (
      outputPositive: number,
      outputNegative: number,
      controlPositive: number,
      controlNegative: number,
      transconductance: number,
    ): void => {
      const op = nodeVariables.get(outputPositive);
      const on = nodeVariables.get(outputNegative);
      const cp = nodeVariables.get(controlPositive);
      const cn = nodeVariables.get(controlNegative);
      if (op !== undefined && cp !== undefined) matrix[op]![cp] += transconductance;
      if (op !== undefined && cn !== undefined) matrix[op]![cn] -= transconductance;
      if (on !== undefined && cp !== undefined) matrix[on]![cp] -= transconductance;
      if (on !== undefined && cn !== undefined) matrix[on]![cn] += transconductance;
    };

    for (const variable of nodeVariables.values()) matrix[variable]![variable] += GMIN;
    for (const branch of arduinoBranches) {
      const positive = physicalNodeIndex(branch.component, branch.terminal);
      const ground = physicalNodeIndex(branch.component, branch.ground);
      const conductance = 1 / branch.resistanceOhm;
      stampConductance(positive, ground, conductance);
      stampOffset(positive, ground, conductance * branch.targetVoltage);
    }
    for (const component of document.components) {
      if (isArduinoUno(component)) continue;
      if (!isSimulated(component) || component.kind === 'source') continue;
      if (['led', 'diode', 'rgb-led', 'seven-segment', 'transistor'].includes(component.kind))
        continue;
      const a = nodeIndex(component, 'a');
      const b = nodeIndex(component, 'b');
      if (component.kind === 'resistor') {
        stampConductance(a, b, 1 / Math.max(CLOSED_RESISTANCE, component.value));
      } else if (component.kind === 'photoresistor') {
        stampConductance(a, b, 1 / photoresistorResistanceOhm(component));
      } else if (component.kind === 'lamp') {
        stampConductance(a, b, 1 / component.value);
      } else if (component.kind === 'switch') {
        if (component.componentTypeId || component.state === true) {
          stampConductance(a, b, 1 / CLOSED_RESISTANCE);
        }
      } else if (component.kind === 'button') {
        if (component.state === true) stampConductance(a, b, 1 / CLOSED_RESISTANCE);
      } else if (component.kind === 'potentiometer') {
        const wiper = nodeIndex(component, 'wiper');
        const position = component.wiperPosition ?? 0.5;
        stampConductance(a, wiper, 1 / Math.max(CLOSED_RESISTANCE, component.value * position));
        stampConductance(
          wiper,
          b,
          1 / Math.max(CLOSED_RESISTANCE, component.value * (1 - position)),
        );
      }
    }

    for (const branch of diodeBranches) {
      const anode = physicalNodeIndex(branch.component, branch.anode);
      const cathode = physicalNodeIndex(branch.component, branch.cathode);
      const key = diodeBranchKey(branch);
      const active = diodeStates.get(key) === true;
      if (active) {
        const segment = diodeLinearSegment(branch, diodeSegmentIndices.get(key) ?? 0);
        const conductance = 1 / segment.dynamicResistanceOhm;
        stampConductance(anode, cathode, conductance);
        stampOffset(anode, cathode, conductance * segment.kneeVoltage);
      } else {
        stampConductance(anode, cathode, GMIN);
      }
    }

    for (const transistor of transistorModels) {
      const region = transistorRegions.get(transistor.component.id) ?? 'cutoff';
      if (transistor.transistorType === 'fet') {
        const drain = physicalNodeIndex(transistor.component, transistor.drain);
        const source = physicalNodeIndex(transistor.component, transistor.source);
        const gate = physicalNodeIndex(transistor.component, transistor.gate);
        if (region === 'cutoff') {
          stampConductance(drain, source, GMIN);
          continue;
        }
        const overdrive = Math.max(0, fetOverdrives.get(transistor.component.id) ?? 0);
        if (region === 'active') {
          // Saturation region: drain current source Id = gm · (Vgs − Vth),
          // gm = k · Vov from the previous iteration (fixed-point style).
          const transconductance = transistor.transconductanceFactor * overdrive;
          stampConductance(drain, source, FET_MIN_OHMIC_CONDUCTANCE);
          stampVccs(drain, source, gate, source, transconductance);
          stampOffset(drain, source, transconductance * transistor.thresholdVoltage);
        } else {
          // Ohmic (triode) region: drain–source behaves as a conductance k · Vov.
          const conductance = Math.max(
            FET_MIN_OHMIC_CONDUCTANCE,
            transistor.transconductanceFactor * overdrive,
          );
          stampConductance(drain, source, conductance);
        }
        continue;
      }
      const base = physicalNodeIndex(transistor.component, transistor.base);
      const collector = physicalNodeIndex(transistor.component, transistor.collector);
      const emitter = physicalNodeIndex(transistor.component, transistor.emitter);
      if (region === 'cutoff') {
        stampConductance(base, emitter, GMIN);
        stampConductance(collector, emitter, GMIN);
        continue;
      }

      const baseEmitterConductance = 1 / NPN_BASE_EMITTER_RESISTANCE;
      stampConductance(base, emitter, baseEmitterConductance);
      if (transistor.transistorType === 'pnp') {
        // PNP mirrors NPN: the junction conducts emitter → base and the
        // collector current flows emitter → collector.
        stampOffset(emitter, base, baseEmitterConductance * transistor.baseEmitterVoltage);
        if (region === 'active') {
          const transconductance = transistor.currentGain * baseEmitterConductance;
          stampVccs(emitter, collector, emitter, base, transconductance);
          stampOffset(emitter, collector, transconductance * transistor.baseEmitterVoltage);
        } else {
          const saturationConductance = 1 / NPN_SATURATION_RESISTANCE;
          stampConductance(collector, emitter, saturationConductance);
          stampOffset(emitter, collector, saturationConductance * transistor.saturationVoltage);
        }
        continue;
      }
      stampOffset(base, emitter, baseEmitterConductance * transistor.baseEmitterVoltage);
      if (region === 'active') {
        const transconductance = transistor.currentGain * baseEmitterConductance;
        stampVccs(collector, emitter, base, emitter, transconductance);
        stampOffset(collector, emitter, transconductance * transistor.baseEmitterVoltage);
      } else {
        const saturationConductance = 1 / NPN_SATURATION_RESISTANCE;
        stampConductance(collector, emitter, saturationConductance);
        stampOffset(collector, emitter, saturationConductance * transistor.saturationVoltage);
      }
    }

    for (const [sourcePosition, source] of sources.entries()) {
      const a = nodeIndex(source, 'a');
      const b = nodeIndex(source, 'b');
      const row = nodeVariableCount + sourcePosition;
      const ai = nodeVariables.get(a);
      const bi = nodeVariables.get(b);
      if (ai !== undefined) {
        matrix[ai]![row] += 1;
        matrix[row]![ai] += 1;
      }
      if (bi !== undefined) {
        matrix[bi]![row] -= 1;
        matrix[row]![bi] -= 1;
      }
      rhs[row] = source.value;
    }

    finalMatrix = matrix;
    finalRhs = rhs;
    solution = solveLinear(matrix, rhs);
    if (!solution) break;
    let changed = false;
    for (const branch of diodeBranches) {
      const key = diodeBranchKey(branch);
      const segmentIndex = diodeSegmentIndices.get(key) ?? 0;
      const segment = diodeLinearSegment(branch, segmentIndex);
      const drop =
        voltageFrom(solution, physicalNodeIndex(branch.component, branch.anode)) -
        voltageFrom(solution, physicalNodeIndex(branch.component, branch.cathode));
      const next = drop >= segment.kneeVoltage - 0.02;
      if (next !== diodeStates.get(key)) {
        diodeStates.set(key, next);
        changed = true;
      }
      const current =
        diodeStates.get(key) === true
          ? Math.max(0, (drop - segment.kneeVoltage) / segment.dynamicResistanceOhm)
          : 0;
      const nextSegmentIndex = diodeLinearSegmentIndex(branch, current);
      if (nextSegmentIndex !== segmentIndex) {
        diodeSegmentIndices.set(key, nextSegmentIndex);
        changed = true;
      }
    }
    for (const transistor of transistorModels) {
      const currentRegion = transistorRegions.get(transistor.component.id) ?? 'cutoff';
      if (transistor.transistorType === 'fet') {
        const gateVoltage = voltageFrom(
          solution,
          physicalNodeIndex(transistor.component, transistor.gate),
        );
        const drainVoltage = voltageFrom(
          solution,
          physicalNodeIndex(transistor.component, transistor.drain),
        );
        const sourceVoltage = voltageFrom(
          solution,
          physicalNodeIndex(transistor.component, transistor.source),
        );
        const overdrive = gateVoltage - sourceVoltage - transistor.thresholdVoltage;
        const drainSourceDrop = drainVoltage - sourceVoltage;
        fetOverdrives.set(transistor.component.id, Math.max(0, overdrive));
        const nextRegion: TransistorOperatingRegion =
          overdrive <= 0.02
            ? 'cutoff'
            : drainSourceDrop >= overdrive - (currentRegion === 'active' ? 0.05 : 0)
              ? 'active'
              : 'ohmic';
        if (nextRegion !== currentRegion) {
          transistorRegions.set(transistor.component.id, nextRegion);
          changed = true;
        }
        continue;
      }
      const baseVoltage = voltageFrom(
        solution,
        physicalNodeIndex(transistor.component, transistor.base),
      );
      const collectorVoltage = voltageFrom(
        solution,
        physicalNodeIndex(transistor.component, transistor.collector),
      );
      const emitterVoltage = voltageFrom(
        solution,
        physicalNodeIndex(transistor.component, transistor.emitter),
      );
      // For PNP the junction voltages are measured emitter-relative.
      const baseEmitterDrop =
        transistor.transistorType === 'pnp'
          ? emitterVoltage - baseVoltage
          : baseVoltage - emitterVoltage;
      const collectorEmitterDrop =
        transistor.transistorType === 'pnp'
          ? emitterVoltage - collectorVoltage
          : collectorVoltage - emitterVoltage;
      const nextRegion: TransistorOperatingRegion =
        baseEmitterDrop < transistor.baseEmitterVoltage - 0.02
          ? 'cutoff'
          : currentRegion === 'saturation' ||
              collectorEmitterDrop <= transistor.saturationVoltage + 0.05
            ? 'saturation'
            : 'active';
      if (nextRegion !== currentRegion) {
        transistorRegions.set(transistor.component.id, nextRegion);
        changed = true;
      }
    }
    if (!changed) {
      converged = true;
      break;
    }
  }

  if (!solution || !converged) {
    diagnostics.push({
      code: 'nonconvergent_topology',
      severity: 'error',
      message: 'DC-расчёт не сошёлся для этой топологии.',
      suggestedAction: 'Проверьте источники, короткие замыкания и полярность диодов.',
    });
    return empty('nonconvergent', iterations);
  }

  const numericalResidual = Math.max(
    0,
    ...(finalMatrix ?? []).map((row, rowIndex) =>
      Math.abs(
        row.reduce(
          (sum, coefficient, columnIndex) =>
            sum + coefficient * ((solution as number[])[columnIndex] ?? 0),
          0,
        ) - ((finalRhs ?? [])[rowIndex] ?? 0),
      ),
    ),
  );
  const numericalScale = Math.max(
    1,
    ...(finalRhs ?? []).map(Math.abs),
    ...(solution ?? []).map(Math.abs),
  );
  const numericalTolerance = 1e-9 * numericalScale;
  if (!Number.isFinite(numericalResidual) || numericalResidual > numericalTolerance) {
    diagnostics.push({
      code: 'numerical_instability',
      severity: 'error',
      message: 'Численная невязка DC-расчёта превышает допустимый предел.',
      suggestedAction: 'Проверьте источники, экстремальные сопротивления и короткие замыкания.',
    });
    return empty('nonconvergent', iterations, numericalResidual, numericalTolerance);
  }

  const voltageAt = (component: SchematicComponent, terminal: LogicalTerminal): number =>
    voltageFrom(solution as number[], nodeIndex(component, terminal));
  const physicalVoltageAt = (component: SchematicComponent, terminal: Terminal): number => {
    const node = netlist.nodeOf.get(terminalKey(component.id, terminal));
    return node === undefined ? 0 : voltageFrom(solution as number[], node);
  };
  const sourceCurrents = new Map<string, number>();
  for (const [position, source] of sources.entries()) {
    sourceCurrents.set(source.id, solution[nodeVariableCount + position] as number);
  }
  const currentDeliveredByArduinoBranch = (branch: (typeof arduinoBranches)[number]): number => {
    const measured =
      physicalVoltageAt(branch.component, branch.terminal) -
      physicalVoltageAt(branch.component, branch.ground);
    return (branch.targetVoltage - measured) / branch.resistanceOhm;
  };
  const resultForBranch = (branch: DiodeBranch) => {
    const key = diodeBranchKey(branch);
    const segment = diodeLinearSegment(branch, diodeSegmentIndices.get(key) ?? 0);
    const voltageDrop =
      physicalVoltageAt(branch.component, branch.anode) -
      physicalVoltageAt(branch.component, branch.cathode);
    const current = diodeStates.get(key)
      ? Math.max(0, (voltageDrop - segment.kneeVoltage) / segment.dynamicResistanceOhm)
      : 0;
    return {
      voltageDrop,
      current,
      brightness: ledBrightness(current, {
        nominalCurrentAmp: branch.nominalCurrent,
        brightnessExponent: branch.brightnessExponent,
      }),
    };
  };
  const transistorResultById = new Map(
    transistorModels.map((transistor) => {
      const operatingRegion = transistorRegions.get(transistor.component.id) ?? 'cutoff';
      if (transistor.transistorType === 'fet') {
        const gateVoltage = physicalVoltageAt(transistor.component, transistor.gate);
        const drainVoltage = physicalVoltageAt(transistor.component, transistor.drain);
        const sourceVoltage = physicalVoltageAt(transistor.component, transistor.source);
        const gateSourceDrop = gateVoltage - sourceVoltage;
        const drainSourceDrop = drainVoltage - sourceVoltage;
        const overdrive = Math.max(0, gateSourceDrop - transistor.thresholdVoltage);
        const drainCurrent =
          operatingRegion === 'cutoff'
            ? 0
            : operatingRegion === 'active'
              ? transistor.transconductanceFactor * overdrive * overdrive
              : Math.max(0, transistor.transconductanceFactor * overdrive * drainSourceDrop);
        return [
          transistor.component.id,
          {
            operatingRegion,
            baseEmitterDrop: gateSourceDrop,
            collectorEmitterDrop: drainSourceDrop,
            baseCurrent: 0,
            collectorCurrent: drainCurrent,
            emitterCurrent: drainCurrent,
            currentGain: 0,
            maxCollectorCurrent: transistor.maxDrainCurrent,
          },
        ] as const;
      }
      const baseVoltage = physicalVoltageAt(transistor.component, transistor.base);
      const collectorVoltage = physicalVoltageAt(transistor.component, transistor.collector);
      const emitterVoltage = physicalVoltageAt(transistor.component, transistor.emitter);
      // For PNP both junction drops are reported emitter-relative, so the same
      // thresholds and diagnostics apply as for NPN.
      const baseEmitterDrop =
        transistor.transistorType === 'pnp'
          ? emitterVoltage - baseVoltage
          : baseVoltage - emitterVoltage;
      const collectorEmitterDrop =
        transistor.transistorType === 'pnp'
          ? emitterVoltage - collectorVoltage
          : collectorVoltage - emitterVoltage;
      const baseCurrent =
        operatingRegion === 'cutoff'
          ? 0
          : Math.max(
              0,
              (baseEmitterDrop - transistor.baseEmitterVoltage) / NPN_BASE_EMITTER_RESISTANCE,
            );
      const collectorCurrent =
        operatingRegion === 'cutoff'
          ? 0
          : operatingRegion === 'active'
            ? Math.max(0, transistor.currentGain * baseCurrent)
            : Math.max(
                0,
                (collectorEmitterDrop - transistor.saturationVoltage) / NPN_SATURATION_RESISTANCE,
              );
      return [
        transistor.component.id,
        {
          operatingRegion,
          baseEmitterDrop,
          collectorEmitterDrop,
          baseCurrent,
          collectorCurrent,
          emitterCurrent: baseCurrent + collectorCurrent,
          currentGain: transistor.currentGain,
          maxCollectorCurrent: transistor.maxCollectorCurrent,
        },
      ] as const;
    }),
  );

  const components: ComponentResult[] = document.components
    .filter((component) => component.kind !== 'wire')
    .map((component) => {
      const terminalVoltages: Partial<Record<Terminal, number>> = {};
      for (const terminal of terminalsForComponent(component)) {
        terminalVoltages[terminal] = round(physicalVoltageAt(component, terminal));
      }
      const branches = diodeBranches.filter((branch) => branch.component.id === component.id);
      const branchResults = branches.map((branch) => ({ branch, ...resultForBranch(branch) }));
      const componentArduinoBranches = arduinoBranches.filter(
        (branch) => branch.component.id === component.id,
      );
      const arduinoBranchResults = componentArduinoBranches.map((branch) => ({
        branch,
        voltageDrop:
          physicalVoltageAt(component, branch.terminal) -
          physicalVoltageAt(component, branch.ground),
        current: currentDeliveredByArduinoBranch(branch),
      }));
      const transistorResult = transistorResultById.get(component.id);
      const voltageDrop =
        transistorResult?.collectorEmitterDrop ??
        branchResults[0]?.voltageDrop ??
        arduinoBranchResults.find((entry) => entry.branch.id === 'd13')?.voltageDrop ??
        arduinoBranchResults[0]?.voltageDrop ??
        (isSimulated(component) ? voltageAt(component, 'a') - voltageAt(component, 'b') : 0);
      let current = 0;
      if (component.kind === 'source') current = -(sourceCurrents.get(component.id) ?? 0);
      else if (isArduinoUno(component))
        current = Math.max(0, ...arduinoBranchResults.map((entry) => Math.abs(entry.current)));
      else if (component.kind === 'resistor')
        current = voltageDrop / Math.max(CLOSED_RESISTANCE, component.value);
      else if (component.kind === 'photoresistor')
        current = voltageDrop / photoresistorResistanceOhm(component);
      else if (component.kind === 'lamp') current = voltageDrop / component.value;
      else if (component.kind === 'switch')
        current = component.componentTypeId
          ? voltageDrop / CLOSED_RESISTANCE
          : component.state === true
            ? voltageDrop / CLOSED_RESISTANCE
            : 0;
      else if (component.kind === 'button')
        current = component.state === true ? voltageDrop / CLOSED_RESISTANCE : 0;
      else if (component.kind === 'potentiometer') {
        const position = component.wiperPosition ?? 0.5;
        current =
          (voltageAt(component, 'a') - voltageAt(component, 'wiper')) /
          Math.max(CLOSED_RESISTANCE, component.value * position);
      } else if (transistorResult) current = transistorResult.collectorCurrent;
      else if (branches.length > 0)
        current = branchResults.reduce((sum, branch) => sum + branch.current, 0);
      const power = Math.abs(
        isArduinoUno(component)
          ? arduinoBranchResults.reduce(
              (sum, entry) => sum + Math.abs(entry.current * entry.voltageDrop),
              0,
            )
          : transistorResult
            ? transistorResult.collectorCurrent * transistorResult.collectorEmitterDrop +
              transistorResult.baseCurrent * transistorResult.baseEmitterDrop
            : component.kind === 'lamp'
              ? current * voltageDrop
              : branchResults.length > 0
                ? branchResults.reduce(
                    (sum, branch) => sum + branch.current * branch.voltageDrop,
                    0,
                  )
                : current * voltageDrop,
      );
      const branchCurrents = transistorResult
        ? transistorTypeOf(component) === 'fet'
          ? {
              gate: roundCurrent(transistorResult.baseCurrent),
              drain: roundCurrent(transistorResult.collectorCurrent),
              source: roundCurrent(transistorResult.emitterCurrent),
            }
          : {
              base: roundCurrent(transistorResult.baseCurrent),
              collector: roundCurrent(transistorResult.collectorCurrent),
              emitter: roundCurrent(transistorResult.emitterCurrent),
            }
        : isArduinoUno(component)
          ? Object.fromEntries(
              arduinoBranchResults.map(({ branch, current: branchCurrent }) => [
                branch.id,
                roundCurrent(branchCurrent),
              ]),
            )
          : Object.fromEntries(
              branchResults.map(({ branch, current: branchCurrent }) => [
                branch.id,
                roundCurrent(branchCurrent),
              ]),
            );
      const branchBrightness = Object.fromEntries(
        branchResults.map(({ branch, brightness }) => [branch.id, round(brightness, 2)]),
      );
      const brightness =
        component.kind === 'lamp'
          ? Math.min(100, Math.pow(power / LAMP_NOMINAL_POWER_W, 0.55) * 100)
          : Math.max(0, ...Object.values(branchBrightness));
      const resistorPowerRating =
        component.kind === 'resistor' ? resistorPowerRatingWatt(component) : undefined;
      const powerUtilizationPercent =
        resistorPowerRating === undefined ? undefined : (power / resistorPowerRating) * 100;
      const currentUtilizationPercent =
        branches.length > 0
          ? Math.max(
              0,
              ...branchResults.map(({ branch, current: branchCurrent }) =>
                Math.abs((branchCurrent / branch.nominalCurrent) * 100),
              ),
            )
          : undefined;
      const stressState =
        powerUtilizationPercent !== undefined
          ? powerUtilizationPercent > 200
            ? 'burned'
            : powerUtilizationPercent > 100
              ? 'overcurrent'
              : powerUtilizationPercent >= RESISTOR_WARNING_RATIO * 100
                ? 'warning'
                : 'normal'
          : branches.length === 0
            ? undefined
            : branchResults.some(
                  ({ branch, current: branchCurrent }) =>
                    Math.abs(branchCurrent) > branch.maxCurrent,
                )
              ? 'burned'
              : branchResults.some(
                    ({ branch, current: branchCurrent }) =>
                      Math.abs(branchCurrent) > branch.nominalCurrent,
                  )
                ? 'overcurrent'
                : branchResults.some(
                      ({ branch, current: branchCurrent }) =>
                        branch.nearLimitWarning &&
                        Math.abs(branchCurrent) >= branch.nominalCurrent * LED_WARNING_RATIO,
                    )
                  ? 'warning'
                  : 'normal';
      return {
        componentId: component.id,
        voltageDrop: round(voltageDrop),
        current: roundCurrent(current),
        terminalVoltages,
        power: round(power),
        brightness: round(brightness, 2),
        ...(branches.length > 0 || transistorResult || isArduinoUno(component)
          ? {
              branchCurrents,
              ...(branches.length > 0 ? { branchBrightness } : {}),
            }
          : {}),
        ...(currentUtilizationPercent === undefined || stressState === undefined
          ? {}
          : {
              currentUtilizationPercent: round(currentUtilizationPercent, 2),
            }),
        ...(powerUtilizationPercent === undefined
          ? {}
          : { powerUtilizationPercent: round(powerUtilizationPercent, 2) }),
        ...(stressState === undefined ? {} : { stressState }),
        ...(component.kind === 'led' ||
        component.kind === 'rgb-led' ||
        component.kind === 'seven-segment'
          ? { lit: brightness > 0 }
          : {}),
        ...(component.kind === 'lamp'
          ? {
              lit: Math.abs(current * voltageDrop) >= LAMP_MIN_POWER_W,
              energized: Math.abs(current) > 1e-6,
            }
          : {}),
        ...(isArduinoUno(component) ? { energized: true } : {}),
        ...(transistorResult
          ? {
              operatingRegion: transistorResult.operatingRegion,
              baseCurrent: roundCurrent(transistorResult.baseCurrent),
              collectorCurrent: roundCurrent(transistorResult.collectorCurrent),
              emitterCurrent: roundCurrent(transistorResult.emitterCurrent),
              currentGain: round(transistorResult.currentGain, 2),
            }
          : {}),
      };
    });

  for (const component of document.components.filter((item) => item.kind === 'resistor')) {
    const result = components.find((entry) => entry.componentId === component.id);
    if (!result) continue;
    const rating = resistorPowerRatingWatt(component);
    const utilization = result.powerUtilizationPercent ?? 0;
    if (utilization > 100) {
      diagnostics.push({
        code: 'resistor_overload',
        severity: 'error',
        message: `${component.name ?? component.id}: мощность ${result.power?.toFixed(3) ?? '0.000'} Вт превышает номинал ${rating.toFixed(3)} Вт. Резистор перегревается и может выйти из строя.`,
        componentIds: [component.id],
        suggestedAction:
          'Увеличьте сопротивление или допустимую мощность резистора либо уменьшите напряжение питания.',
      });
    } else if (utilization >= RESISTOR_WARNING_RATIO * 100) {
      diagnostics.push({
        code: 'resistor_near_limit',
        severity: 'warning',
        message: `${component.name ?? component.id}: мощность ${result.power?.toFixed(3) ?? '0.000'} Вт близка к номиналу ${rating.toFixed(3)} Вт.`,
        componentIds: [component.id],
        suggestedAction: 'Оставьте запас по мощности или выберите более мощный резистор.',
      });
    }
  }

  for (const component of document.components.filter(
    (item) => componentDiodeBranches(item).length > 0,
  )) {
    const componentBranches = diodeBranches.filter(
      (branch) => branch.component.id === component.id,
    );
    const result = components.find((entry) => entry.componentId === component.id);
    const reverseBranches = componentBranches.filter((branch) => {
      const anodeVoltage = result?.terminalVoltages[branch.anode] ?? 0;
      const cathodeVoltage = result?.terminalVoltages[branch.cathode] ?? 0;
      return anodeVoltage - cathodeVoltage < -0.05;
    });
    if (reverseBranches.length > 0) {
      const isTwoTerminalDiode = component.kind === 'led' || component.kind === 'diode';
      diagnostics.push({
        code: 'reverse_polarity',
        severity: 'warning',
        message: `${component.name ?? component.id}: обратная полярность${
          isTwoTerminalDiode
            ? ' — анод подключён к минусу, катод к плюсу.'
            : ` ${reverseBranches.map((branch) => branch.id).join(', ')}.`
        }`,
        componentIds: [component.id],
        suggestedAction: isTwoTerminalDiode
          ? 'Подключите BAT+ к аноду, BAT− к катоду.'
          : 'Проверьте анод, катод и общий вывод.',
      });
    }
    const nearLimit = componentBranches.filter((branch) => {
      const current = Math.abs(result?.branchCurrents?.[branch.id] ?? 0);
      return (
        branch.nearLimitWarning &&
        current >= branch.nominalCurrent * LED_WARNING_RATIO &&
        current <= branch.nominalCurrent
      );
    });
    if (nearLimit.length > 0) {
      diagnostics.push({
        code: 'led_near_limit',
        severity: 'warning',
        message: `${component.name ?? component.id}: ток близок к номинальному пределу в ${nearLimit.map((branch) => branch.id).join(', ')}. Светодиод пока работает, но запас по току мал.`,
        componentIds: [component.id],
        suggestedAction: 'Увеличьте сопротивление, чтобы оставить безопасный запас по току.',
      });
    }
    const overloaded = componentBranches.filter(
      (branch) => Math.abs(result?.branchCurrents?.[branch.id] ?? 0) > branch.nominalCurrent,
    );
    if (overloaded.length > 0) {
      const current = Math.abs(result?.branchCurrents?.[overloaded[0]!.id] ?? 0);
      diagnostics.push({
        code: 'led_overcurrent',
        severity: 'warning',
        message:
          component.kind === 'led'
            ? `Сила тока в светодиоде равна ${formatReferenceMilliamp(current)} (максимальное рекомендуемое значение — 20.0 mA). Это может привести к сокращению срока службы светодиода.`
            : `${component.name ?? component.id}: ток выше номинальных ${(overloaded[0]!.nominalCurrent * 1000).toFixed(0)} мА в ${overloaded.map((branch) => branch.id).join(', ')}. Возможна деградация светодиода.`,
        componentIds: [component.id],
        ...(component.kind === 'led'
          ? {}
          : { suggestedAction: 'Увеличьте токоограничивающее сопротивление.' }),
      });
    }
    const burnedOut = componentBranches.filter(
      (branch) => Math.abs(result?.branchCurrents?.[branch.id] ?? 0) > branch.maxCurrent,
    );
    if (burnedOut.length > 0) {
      const current = Math.abs(result?.branchCurrents?.[burnedOut[0]!.id] ?? 0);
      diagnostics.push({
        code: 'led_burnout',
        severity: 'error',
        message:
          component.kind === 'led'
            ? `Сила тока в светодиоде равна ${formatReferenceMilliamp(current)} (абсолютное максимальное значение — 20.0 mA).`
            : `${component.name ?? component.id}: ток превысил разрушительный предел ${(burnedOut[0]!.maxCurrent * 1000).toFixed(0)} мА в ${burnedOut.map((branch) => branch.id).join(', ')}. Светодиод перегорел в этой рабочей точке.`,
        componentIds: [component.id],
        ...(component.kind === 'led'
          ? {}
          : {
              suggestedAction:
                'Остановите моделирование, уменьшите напряжение или добавьте сопротивление.',
            }),
      });
    }
  }

  for (const transistor of transistorModels) {
    const result = transistorResultById.get(transistor.component.id);
    if (!result) continue;
    if (transistor.transistorType === 'fet') {
      if (Math.abs(result.baseEmitterDrop) > 20) {
        diagnostics.push({
          code: 'transistor_reverse_bias',
          severity: 'error',
          message: `${transistor.component.name ?? transistor.component.id}: напряжение затвор–исток ${result.baseEmitterDrop.toFixed(1)} В превышает пробивное для затвора.`,
          componentIds: [transistor.component.id],
          suggestedAction: 'Проверьте распиновку S, G, D и полярность питания.',
        });
      }
      if (result.collectorCurrent > result.maxCollectorCurrent) {
        diagnostics.push({
          code: 'transistor_overcurrent',
          severity: 'error',
          message: `${transistor.component.name ?? transistor.component.id}: ток стока ${(result.collectorCurrent * 1000).toFixed(1)} мА превышает допустимые ${(result.maxCollectorCurrent * 1000).toFixed(1)} мА.`,
          componentIds: [transistor.component.id],
          suggestedAction: 'Увеличьте сопротивление нагрузки или уменьшите напряжение затвора.',
        });
      }
      continue;
    }
    if (result.baseEmitterDrop < -5) {
      diagnostics.push({
        code: 'transistor_reverse_bias',
        severity: 'error',
        message: `${transistor.component.name ?? transistor.component.id}: обратное напряжение база–эмиттер ${Math.abs(result.baseEmitterDrop).toFixed(2)} В превышает безопасный предел.`,
        componentIds: [transistor.component.id],
        suggestedAction: 'Проверьте распиновку B, C, E и полярность питания.',
      });
    }
    if (result.collectorCurrent > result.maxCollectorCurrent) {
      diagnostics.push({
        code: 'transistor_overcurrent',
        severity: 'error',
        message: `${transistor.component.name ?? transistor.component.id}: ток коллектора ${(result.collectorCurrent * 1000).toFixed(1)} мА превышает допустимые ${(result.maxCollectorCurrent * 1000).toFixed(1)} мА.`,
        componentIds: [transistor.component.id],
        suggestedAction: 'Увеличьте сопротивление нагрузки или уменьшите ток базы.',
      });
    }
  }

  const totalSourceCurrent = Math.max(
    0,
    ...sources.map((source) => Math.abs(sourceCurrents.get(source.id) ?? 0)),
    ...arduinoBranches.map((branch) => Math.abs(currentDeliveredByArduinoBranch(branch))),
  );
  if (totalSourceCurrent > SHORT_CIRCUIT_CURRENT_A) {
    diagnostics.push({
      code: 'short_circuit',
      severity: 'error',
      message: `Ток источника ${totalSourceCurrent.toFixed(2)} А указывает на короткое замыкание.`,
      componentIds: sourceProviderIds,
      suggestedAction: 'Остановите моделирование и добавьте сопротивление в путь тока.',
    });
  } else if (sources.length > 0 && totalSourceCurrent < 1e-8) {
    diagnostics.push({
      code: 'open_circuit',
      severity: 'warning',
      message: 'Источник не отдаёт ток: цепь разомкнута или блокируется полярным элементом.',
      componentIds: sourceProviderIds,
      suggestedAction: 'Замкните переключатель и проверьте все соединения и полярность.',
    });
  }

  if (!diagnostics.some((diagnostic) => diagnostic.severity !== 'info')) {
    diagnostics.push({
      code: 'circuit_ok',
      severity: 'info',
      message: `DC-расчёт завершён. Ток источника ${(totalSourceCurrent * 1000).toFixed(2)} мА.`,
    });
  }

  const nodes: NodeResult[] = Array.from({ length: netlist.nodeCount }, (_, node) => ({
    id: `net-${node}`,
    voltage: round(voltageFrom(solution as number[], node)),
    terminals: netlist.terminalsByNode.get(node) ?? [],
  }));
  return {
    solved: true,
    status: 'solved',
    current: roundCurrent(totalSourceCurrent),
    components,
    nodes,
    diagnostics: diagnostics.map(withDiagnosticAnchors),
    iterations,
    numericalResidual,
    numericalTolerance,
  };
}
