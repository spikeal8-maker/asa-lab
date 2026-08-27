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
