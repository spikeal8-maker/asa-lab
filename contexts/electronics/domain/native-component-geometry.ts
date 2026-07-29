import type { TerminalElectricalRole, TerminalId } from './component-model.js';

export const NATIVE_GRID_PITCH_MM = 2.54;
export const NATIVE_GEOMETRY_EPSILON_MM = 0.02;

export type NativeGeometryEvidence =
  | 'owner_asset_calibrated'
  | 'manufacturer_official'
  | 'manufacturer_typical'
  | 'reference_capture_required';

export type NativeMountingMode = 'terminal-grid' | 'breadboard-hole' | 'free-physical';
export type QuarterTurn = 0 | 90 | 180 | 270;

export interface NativePointMm {
  readonly xMm: number;
  readonly yMm: number;
}

export interface NativeSizeMm {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm?: number;
}

export interface NativeTerminalGeometry extends NativePointMm {
  readonly id: TerminalId;
  readonly label: string;
  readonly role: TerminalElectricalRole;
  readonly requiresHole: boolean;
}

export interface NativeAssetCalibration {
  readonly viewBoxWidth: number;
  readonly viewBoxHeight: number;
  readonly terminalA: { readonly id: TerminalId; readonly x: number; readonly y: number };
  readonly terminalB: { readonly id: TerminalId; readonly x: number; readonly y: number };
  readonly targetTerminalSpanMm: number;
}

export interface NativeComponentGeometry {
  readonly key: string;
  readonly bodyMm: NativeSizeMm;
  readonly bodyOriginMm: NativePointMm;
  readonly envelopeMm: NativeSizeMm;
  readonly terminals: readonly NativeTerminalGeometry[];
  readonly mountingMode: NativeMountingMode;
  readonly evidence: NativeGeometryEvidence;
  readonly evidenceSource: string;
  readonly referenceBehaviorVerified: boolean;
  readonly assetCalibration?: NativeAssetCalibration;
}

export type NativeGeometryValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function roundMm(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function terminalDistanceMm(
  geometry: NativeComponentGeometry,
  terminalA: TerminalId,
  terminalB: TerminalId,
): number | null {
  const a = geometry.terminals.find((terminal) => terminal.id === terminalA);
  const b = geometry.terminals.find((terminal) => terminal.id === terminalB);
  if (!a || !b) return null;
  return Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
}

export function calibratedAssetSizeMm(
  calibration: NativeAssetCalibration,
): NativeSizeMm {
  const assetSpan = Math.hypot(
    calibration.terminalB.x - calibration.terminalA.x,
    calibration.terminalB.y - calibration.terminalA.y,
  );
  if (
    !finitePositive(calibration.viewBoxWidth) ||
    !finitePositive(calibration.viewBoxHeight) ||
    !finitePositive(assetSpan) ||
    !finitePositive(calibration.targetTerminalSpanMm)
  ) {
    throw new Error('invalid native asset calibration');
  }
  const scaleMmPerAssetUnit = calibration.targetTerminalSpanMm / assetSpan;
  return {
    widthMm: roundMm(calibration.viewBoxWidth * scaleMmPerAssetUnit),
    heightMm: roundMm(calibration.viewBoxHeight * scaleMmPerAssetUnit),
  };
}

export function rotateNativePoint(
  envelope: NativeSizeMm,
  point: NativePointMm,
  rotation: QuarterTurn,
): NativePointMm {
  if (rotation === 90) {
    return { xMm: roundMm(envelope.heightMm - point.yMm), yMm: roundMm(point.xMm) };
  }
  if (rotation === 180) {
    return {
      xMm: roundMm(envelope.widthMm - point.xMm),
      yMm: roundMm(envelope.heightMm - point.yMm),
    };
  }
  if (rotation === 270) {
    return { xMm: roundMm(point.yMm), yMm: roundMm(envelope.widthMm - point.xMm) };
  }
  return { xMm: roundMm(point.xMm), yMm: roundMm(point.yMm) };
}

export function rotatedEnvelopeMm(
  envelope: NativeSizeMm,
  rotation: QuarterTurn,
): NativeSizeMm {
  if (rotation === 90 || rotation === 270) {
    return {
      widthMm: envelope.heightMm,
      heightMm: envelope.widthMm,
      ...(envelope.depthMm === undefined ? {} : { depthMm: envelope.depthMm }),
    };
  }
  return envelope;
}

export function validateNativeComponentGeometry(
  geometry: NativeComponentGeometry,
): NativeGeometryValidation {
  if (!geometry.key.trim()) {
    return { ok: false, code: 'geometry_key_missing', message: 'Geometry key is required.' };
  }
  if (
    !finitePositive(geometry.bodyMm.widthMm) ||
    !finitePositive(geometry.bodyMm.heightMm) ||
    !finitePositive(geometry.envelopeMm.widthMm) ||
    !finitePositive(geometry.envelopeMm.heightMm)
  ) {
    return {
      ok: false,
      code: 'invalid_physical_dimensions',
      message: 'Body and placement envelope must have positive finite dimensions.',
    };
  }
  if (
    geometry.bodyMm.widthMm > geometry.envelopeMm.widthMm + NATIVE_GEOMETRY_EPSILON_MM ||
    geometry.bodyMm.heightMm > geometry.envelopeMm.heightMm + NATIVE_GEOMETRY_EPSILON_MM
  ) {
    return {
      ok: false,
      code: 'body_outside_envelope',
      message: 'Physical body does not fit inside the placement envelope.',
    };
  }
  if (
    !finiteNonNegative(geometry.bodyOriginMm.xMm) ||
    !finiteNonNegative(geometry.bodyOriginMm.yMm) ||
    geometry.bodyOriginMm.xMm + geometry.bodyMm.widthMm >
      geometry.envelopeMm.widthMm + NATIVE_GEOMETRY_EPSILON_MM ||
    geometry.bodyOriginMm.yMm + geometry.bodyMm.heightMm >
      geometry.envelopeMm.heightMm + NATIVE_GEOMETRY_EPSILON_MM
  ) {
    return {
      ok: false,
      code: 'invalid_body_origin',
      message: 'Body origin places the body outside the component envelope.',
    };
  }
  if (geometry.terminals.length === 0) {
    return { ok: false, code: 'terminals_missing', message: 'At least one terminal is required.' };
  }
  const terminalIds = new Set<string>();
  for (const terminal of geometry.terminals) {
    if (!terminal.id || terminalIds.has(terminal.id)) {
      return {
        ok: false,
        code: 'duplicate_terminal_id',
        message: `Terminal ID must be unique: ${terminal.id || '<empty>'}.`,
      };
    }
    terminalIds.add(terminal.id);
    if (
      !finiteNonNegative(terminal.xMm) ||
      !finiteNonNegative(terminal.yMm) ||
      terminal.xMm > geometry.envelopeMm.widthMm + NATIVE_GEOMETRY_EPSILON_MM ||
      terminal.yMm > geometry.envelopeMm.heightMm + NATIVE_GEOMETRY_EPSILON_MM
    ) {
      return {
        ok: false,
        code: 'terminal_outside_envelope',
        message: `Terminal ${terminal.id} is outside the physical envelope.`,
      };
    }
  }
  if (
    geometry.mountingMode === 'breadboard-hole' &&
    geometry.terminals.some((terminal) => !terminal.requiresHole)
  ) {
    return {
      ok: false,
      code: 'breadboard_terminal_not_inserted',
      message: 'Every terminal of a breadboard-hole component must require a real hole.',
    };
  }
  if (geometry.assetCalibration) {
    const calibration = geometry.assetCalibration;
    if (!terminalIds.has(calibration.terminalA.id) || !terminalIds.has(calibration.terminalB.id)) {
      return {
        ok: false,
        code: 'asset_calibration_terminal_missing',
        message: 'Asset calibration must reference existing stable terminals.',
      };
    }
    try {
      calibratedAssetSizeMm(calibration);
    } catch {
      return {
        ok: false,
        code: 'invalid_asset_calibration',
        message: 'Asset calibration values are invalid.',
      };
    }
  }
  return { ok: true };
}

export function createAxialResistorGeometry(
  pitchMultiple = 10,
): NativeComponentGeometry {
  if (!Number.isInteger(pitchMultiple) || pitchMultiple < 4 || pitchMultiple > 20) {
    throw new Error('axial resistor pitchMultiple must be an integer from 4 to 20');
  }
  const bodyMm = { widthMm: 6.3, heightMm: 2.5, depthMm: 2.5 } as const;
  const terminalMarginMm = 1.3;
  const terminalSpanMm = pitchMultiple * NATIVE_GRID_PITCH_MM;
  const envelopeMm = {
    widthMm: roundMm(terminalSpanMm + terminalMarginMm * 2),
    heightMm: 10.5,
    depthMm: 2.5,
  } as const;
  return {
    key: `axial-resistor-${pitchMultiple}-pitch`,
    bodyMm,
    bodyOriginMm: {
      xMm: roundMm((envelopeMm.widthMm - bodyMm.widthMm) / 2),
      yMm: roundMm((envelopeMm.heightMm - bodyMm.heightMm) / 2),
    },
    envelopeMm,
    terminals: [
      {
        id: 'a',
        label: '1',
        role: 'passive',
        xMm: terminalMarginMm,
        yMm: envelopeMm.heightMm / 2,
        requiresHole: true,
      },
      {
        id: 'b',
        label: '2',
        role: 'passive',
        xMm: roundMm(terminalMarginMm + terminalSpanMm),
        yMm: envelopeMm.heightMm / 2,
        requiresHole: true,
      },
    ],
    mountingMode: 'breadboard-hole',
    evidence: 'manufacturer_typical',
    evidenceSource:
      'Typical 1/4 W axial body; current foundation uses a 10-pitch educational lead span. Exact reference lead behavior requires capture.',
    referenceBehaviorVerified: false,
  };
}

export const ACTIVE_NATIVE_COMPONENT_GEOMETRY = {
  source: {
    key: 'aa-holder-2x-free',
    bodyMm: { widthMm: 44, heightMm: 76.6, depthMm: 16 },
    bodyOriginMm: { xMm: 1.5, yMm: 2.7 },
    envelopeMm: { widthMm: 47, heightMm: 82, depthMm: 16 },
    terminals: [
      {
        id: 'a',
        label: '+',
        role: 'positive',
        xMm: 28.596,
        yMm: 7.16,
        requiresHole: false,
      },
      {
        id: 'b',
        label: '−',
        role: 'negative',
        xMm: 18.436,
        yMm: 7.16,
        requiresHole: false,
      },
    ],
    mountingMode: 'free-physical',
    evidence: 'owner_asset_calibrated',
    evidenceSource: 'Owner SVG terminals calibrated to a 10.16 mm span.',
    referenceBehaviorVerified: true,
    assetCalibration: {
      viewBoxWidth: 485,
      viewBoxHeight: 843,
      terminalA: { id: 'a', x: 295.5, y: 74 },
      terminalB: { id: 'b', x: 190.5, y: 74 },
      targetTerminalSpanMm: 10.16,
    },
  },
  resistor: createAxialResistorGeometry(10),
  led: {
    key: 'led-5mm-one-pitch',
    bodyMm: { widthMm: 5, heightMm: 8.6, depthMm: 5 },
    bodyOriginMm: { xMm: 0, yMm: 0 },
    envelopeMm: { widthMm: 5, heightMm: 8.6, depthMm: 5 },
    terminals: [
      {
        id: 'a',
        label: 'A',
        role: 'anode',
        xMm: 1.23,
        yMm: 8.6,
        requiresHole: true,
      },
      {
        id: 'b',
        label: 'K',
        role: 'cathode',
        xMm: 3.77,
        yMm: 8.6,
        requiresHole: true,
      },
    ],
    mountingMode: 'breadboard-hole',
    evidence: 'manufacturer_typical',
    evidenceSource: 'Typical 5 mm through-hole LED with 2.54 mm lead pitch.',
    referenceBehaviorVerified: false,
    assetCalibration: {
      viewBoxWidth: 240,
      viewBoxHeight: 400,
      terminalA: { id: 'a', x: 83, y: 372 },
      terminalB: { id: 'b', x: 209, y: 372 },
      targetTerminalSpanMm: 2.54,
    },
  },
} as const satisfies Readonly<Record<'source' | 'resistor' | 'led', NativeComponentGeometry>>;
