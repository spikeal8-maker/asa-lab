import type { SchematicComponent, Terminal } from '../document.js';

export interface ModelIssue {
  readonly code: string;
  readonly message: string;
}

export interface DeviceDiagnostic {
  readonly code: string;
  readonly severity: 'warning' | 'error';
  readonly message: string;
  readonly suggestedAction?: string;
}

export interface NormalizedDevice<Parameters> {
  readonly componentId: string;
  readonly component: SchematicComponent;
  readonly parameters: Parameters;
}

/** Restricted matrix assembly surface available to a linear DC device model. */
export interface DcStampContext {
  node(component: SchematicComponent, terminal: Terminal): number;
  stampConductance(leftNode: number, rightNode: number, conductanceSiemens: number): void;
  stampVoltageSource(
    componentId: string,
    positiveNode: number,
    negativeNode: number,
    voltageVolt: number,
    seriesResistanceOhm: number,
  ): void;
}

/** Restricted matrix surface for a bounded, iterative DC device model. */
export interface IterativeDcStampContext {
  node(component: SchematicComponent, terminal: Terminal): number;
  stampConductance(leftNode: number, rightNode: number, conductanceSiemens: number): void;
  stampOffset(leftNode: number, rightNode: number, currentAmp: number): void;
  stampVccs(
    outputPositiveNode: number,
    outputNegativeNode: number,
    controlPositiveNode: number,
    controlNegativeNode: number,
    transconductanceSiemens: number,
  ): void;
}

/**
 * Nonlinear devices own their parameters, iteration state and observations.
 * The general solver only provides matrix operations and convergence bounds.
 */
export interface IterativeDcDeviceModel<Parameters, IterationState, OperatingPoint, Observation> {
  readonly id: string;
  readonly version: number;
  readonly analyses: readonly ['dc'];
  validate(component: SchematicComponent): readonly ModelIssue[];
  normalize(component: SchematicComponent): NormalizedDevice<Parameters>;
  initialIterationState(instance: NormalizedDevice<Parameters>): IterationState;
  stampDc(
    context: IterativeDcStampContext,
    instance: NormalizedDevice<Parameters>,
    state: IterationState,
  ): void;
  evaluateIteration(
    instance: NormalizedDevice<Parameters>,
    state: IterationState,
    operatingPoint: OperatingPoint,
  ): { readonly state: IterationState; readonly changed: boolean };
  observe(
    instance: NormalizedDevice<Parameters>,
    state: IterationState,
    operatingPoint: OperatingPoint,
  ): Observation;
}

export interface DcOperatingPoint {
  readonly voltageDrop: number;
  /** Current reported to the user for this component at the solved operating point. */
  readonly current: number;
}

export interface DeviceModel<Parameters, Observation = never> {
  readonly id: string;
  readonly version: number;
  readonly analyses: readonly ['dc'];
  validate(component: SchematicComponent): readonly ModelIssue[];
  normalize(component: SchematicComponent): NormalizedDevice<Parameters>;
  stampDc(context: DcStampContext, instance: NormalizedDevice<Parameters>): void;
  observe?(instance: NormalizedDevice<Parameters>, operatingPoint: DcOperatingPoint): Observation;
}
