import type { SchematicComponent, Terminal } from '../document.js';

export interface ModelIssue {
  readonly code: string;
  readonly message: string;
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

export interface DeviceModel<Parameters> {
  readonly id: string;
  readonly version: number;
  readonly analyses: readonly ['dc'];
  validate(component: SchematicComponent): readonly ModelIssue[];
  normalize(component: SchematicComponent): NormalizedDevice<Parameters>;
  stampDc(context: DcStampContext, instance: NormalizedDevice<Parameters>): void;
}
