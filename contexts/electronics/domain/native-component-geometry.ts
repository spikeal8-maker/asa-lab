import type { TerminalElectricalRole, TerminalId } from './component-model.js';

export const NATIVE_GRID_PITCH_MM = 2.54;
export const NATIVE_GEOMETRY_EPSILON_MM = 0.02;
export const NATIVE_ASSET_TERMINAL_EPSILON_MM = 0.02;

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

export interface NativeAssetTerminalAnchor {
  readonly id: TerminalId;
  readonly x: number;
  readonly y: number;
}

export interface NativeAssetCalibration {
  readonly viewBoxWidth: number;
  readonly viewBoxHeight: number;
  readonly terminals: readonly NativeAssetTerminalAnchor[];
  readonly scaleReference: {
    readonly fromTerminalId: TerminalId;
    readonly toTerminalId: TerminalId;
    readonly targetSpanMm: number;
  };
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
  readonly assetOriginMm?: NativePointMm;
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

function assetTerminal(
  calibration: NativeAssetCalibration,
  terminalId: TerminalId,
): NativeAssetTerminalAnchor | null {
  return calibration.terminals.find((terminal) => terminal.id === terminalId) ?? null;
}

function assetScaleMmPerUnit(calibration: NativeAssetCalibration): number {
  const from = assetTerminal(calibration, calibration.scaleReference.fromTerminalId);
  const to = assetTerminal(calibration, calibration.scaleReference.toTerminalId);
  if (!from || !to) throw new Error('asset scale reference terminal is missing');
  const assetSpan = Math.hypot(to.x - from.x, to.y - from.y);
  if (
    !finitePositive(calibration.viewBoxWidth) ||
    !finitePositive(calibration.viewBoxHeight) ||
    !finitePositive(assetSpan) ||
    !finitePositive(calibration.scaleReference.targetSpanMm)
  ) {
    throw new Error('invalid native asset calibration');
  }
  return calibration.scaleReference.targetSpanMm / assetSpan;
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
  const scaleMmPerAssetUnit = assetScaleMmPerUnit(calibration);
  return {
    widthMm: roundMm(calibration.viewBoxWidth * scaleMmPerAssetUnit),
    heightMm: roundMm(calibration.viewBoxHeight * scaleMmPerAssetUnit),
  };
}

export function centeredAssetOriginMm(
  envelope: NativeSizeMm,
  calibration: NativeAssetCalibration,
): NativePointMm {
  const size = calibratedAssetSizeMm(calibration);
  if (
    size.widthMm > envelope.widthMm + NATIVE_GEOMETRY_EPSILON_MM ||
    size.heightMm > envelope.heightMm + NATIVE_GEOMETRY_EPSILON_MM
  ) {
    throw new Error('calibrated asset does not fit inside the native envelope');
  }
  return {
    xMm: roundMm((envelope.widthMm - size.widthMm) / 2),
    yMm: roundMm((envelope.heightMm - size.heightMm) / 2),
  };
}

export function calibratedAssetTerminalMm(
  geometry: NativeComponentGeometry,
  terminalId: TerminalId,
): NativePointMm | null {
  const calibration = geometry.assetCalibration;
  const origin = geometry.assetOriginMm;
  if (!calibration || !origin) return null;
  const anchor = assetTerminal(calibration, terminalId);
  if (!anchor) return null;
  const scale = assetScaleMmPerUnit(calibration);
  return {
    xMm: roundMm(origin.xMm + anchor.x * scale),
    yMm: roundMm(origin.yMm + anchor.y * scale),
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
  if (geometry.assetCalibration || geometry.assetOriginMm) {
    if (!geometry.assetCalibration || !geometry.assetOriginMm) {
      return {
        ok: false,
        code: 'incomplete_asset_calibration',
        message: 'Asset calibration and asset origin must be provided together.',
      };
    }
    const calibration = geometry.assetCalibration;
    const assetTerminalIds = new Set<string>();
    for (const anchor of calibration.terminals) {
      if (!anchor.id || assetTerminalIds.has(anchor.id)) {
        return {
          ok: false,
          code: 'duplicate_asset_terminal_id',
          message: `Asset terminal ID must be unique: ${anchor.id || '<empty>'}.`,
        };
      }
      assetTerminalIds.add(anchor.id);
      if (!terminalIds.has(anchor.id)) {
        return {
          ok: false,
          code: 'asset_calibration_terminal_missing',
          message: `Asset terminal ${anchor.id} has no matching native terminal.`,
        };
      }
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
        return {
          ok: false,
          code: 'invalid_asset_calibration',
          message: `Asset terminal ${anchor.id} has invalid coordinates.`,
        };
      }
    }
    let assetSize: NativeSizeMm;
    try {
      assetSize = calibratedAssetSizeMm(calibration);
    } catch {
      return {
        ok: false,
        code: 'invalid_asset_calibration',
        message: 'Asset calibration values are invalid.',
      };
    }
    const assetOrigin = geometry.assetOriginMm;
    if (
      !finiteNonNegative(assetOrigin.xMm) ||
      !finiteNonNegative(assetOrigin.yMm) ||
      assetOrigin.xMm + assetSize.widthMm >
        geometry.envelopeMm.widthMm + NATIVE_GEOMETRY_EPSILON_MM ||
      assetOrigin.yMm + assetSize.heightMm >
        geometry.envelopeMm.heightMm + NATIVE_GEOMETRY_EPSILON_MM
    ) {
      return {
        ok: false,
        code: 'asset_outside_envelope',
        message: 'Calibrated asset does not fit inside the native component envelope.',
      };
    }
    for (const terminal of geometry.terminals) {
      const calibrated = calibratedAssetTerminalMm(geometry, terminal.id);
      if (!calibrated) continue;
      const error = Math.hypot(calibrated.xMm - terminal.xMm, calibrated.yMm - terminal.yMm);
      if (error > NATIVE_ASSET_TERMINAL_EPSILON_MM) {
        return {
          ok: false,
          code: 'asset_terminal_mismatch',
          message: `Native terminal ${terminal.id} differs from the calibrated SVG anchor by ${roundMm(error)} mm.`,
        };
      }
    }
  }
  return { ok: true };
}

const SOURCE_ASSET_CALIBRATION: NativeAssetCalibration = {
  viewBoxWidth: 485,
  viewBoxHeight: 843,
  terminals: [
    { id: 'a', x: 295.5, y: 74 },
    { id: 'b', x: 190.5, y: 74 },
  ],
  scaleReference: { fromTerminalId: 'a', toTerminalId: 'b', targetSpanMm: 10.16 },
};

const RESISTOR_ASSET_CALIBRATION: NativeAssetCalibration = {
  viewBoxWidth: 260,
  viewBoxHeight: 96,
  terminals: [
    { id: 'a', x: 12, y: 48 },
    { id: 'b', x: 248, y: 48 },
  ],
  scaleReference: { fromTerminalId: 'a', toTerminalId: 'b', targetSpanMm: 25.4 },
};

const LED_ASSET_CALIBRATION: NativeAssetCalibration = {
  viewBoxWidth: 240,
  viewBoxHeight: 400,
  terminals: [
    { id: 'a', x: 83, y: 372 },
    { id: 'b', x: 209, y: 372 },
  ],
  scaleReference: { fromTerminalId: 'a', toTerminalId: 'b', targetSpanMm: 2.54 },
};

function nativeTerminalsFromAsset(
  calibration: NativeAssetCalibration,
  origin: NativePointMm,
  labels: Readonly<Record<string, { readonly label: string; readonly role: TerminalElectricalRole; readonly requiresHole: boolean }>>,
): NativeTerminalGeometry[] {
  const scale = assetScaleMmPerUnit(calibration);
  return calibration.terminals.map((terminal) => {
    const definition = labels[terminal.id];
    if (!definition) throw new Error(`native terminal definition missing for ${terminal.id}`);
    return {
      id: terminal.id,
      label: definition.label,
      role: definition.role,
      requiresHole: definition.requiresHole,
      xMm: roundMm(origin.xMm + terminal.x * scale),
      yMm: roundMm(origin.yMm + terminal.y * scale),
    };
  });
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
  const bodyOriginMm = {
    xMm: roundMm((envelopeMm.widthMm - bodyMm.widthMm) / 2),
    yMm: roundMm((envelopeMm.heightMm - bodyMm.heightMm) / 2),
  };
  const base: NativeComponentGeometry = {
    key: `axial-resistor-${pitchMultiple}-pitch`,
    bodyMm,
    bodyOriginMm,
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
      'Typical 1/4 W axial body. The current 10-pitch SVG is calibrated; flexible lead geometry requires a separate native lead renderer and reference capture.',
    referenceBehaviorVerified: false,
  };
  if (pitchMultiple !== 10) return base;
  const assetOriginMm = centeredAssetOriginMm(envelopeMm, RESISTOR_ASSET_CALIBRATION);
  return {
    ...base,
    assetCalibration: RESISTOR_ASSET_CALIBRATION,
    assetOriginMm,
    terminals: nativeTerminalsFromAsset(RESISTOR_ASSET_CALIBRATION, assetOriginMm, {
      a: { label: '1', role: 'passive', requiresHole: true },
      b: { label: '2', role: 'passive', requiresHole: true },
    }),
  };
}

const SOURCE_ENVELOPE = { widthMm: 47, heightMm: 82, depthMm: 16 } as const;
const SOURCE_ASSET_ORIGIN = centeredAssetOriginMm(SOURCE_ENVELOPE, SOURCE_ASSET_CALIBRATION);
const LED_ENVELOPE = { widthMm: 5, heightMm: 8.6, depthMm: 5 } as const;
const LED_ASSET_ORIGIN = centeredAssetOriginMm(LED_ENVELOPE, LED_ASSET_CALIBRATION);

export const ACTIVE_NATIVE_COMPONENT_GEOMETRY = {
  source: {
    key: 'aa-holder-2x-free',
    bodyMm: { widthMm: 44, heightMm: 76.6, depthMm: 16 },
    bodyOriginMm: { xMm: 1.5, yMm: 2.7 },
    envelopeMm: SOURCE_ENVELOPE,
    terminals: nativeTerminalsFromAsset(SOURCE_ASSET_CALIBRATION, SOURCE_ASSET_ORIGIN, {
      a: { label: '+', role: 'positive', requiresHole: false },
      b: { label: '−', role: 'negative', requiresHole: false },
    }),
    mountingMode: 'free-physical',
    evidence: 'owner_asset_calibrated',
    evidenceSource: 'Owner SVG terminals calibrated to a 10.16 mm span and centred in a 47 × 82 mm envelope.',
    referenceBehaviorVerified: true,
    assetCalibration: SOURCE_ASSET_CALIBRATION,
    assetOriginMm: SOURCE_ASSET_ORIGIN,
  },
  resistor: createAxialResistorGeometry(10),
  led: {
    key: 'led-5mm-one-pitch',
    bodyMm: { widthMm: 5, heightMm: 8.6, depthMm: 5 },
    bodyOriginMm: { xMm: 0, yMm: 0 },
    envelopeMm: LED_ENVELOPE,
    terminals: nativeTerminalsFromAsset(LED_ASSET_CALIBRATION, LED_ASSET_ORIGIN, {
      a: { label: 'A', role: 'anode', requiresHole: true },
      b: { label: 'K', role: 'cathode', requiresHole: true },
    }),
    mountingMode: 'breadboard-hole',
    evidence: 'manufacturer_typical',
    evidenceSource:
      'Typical 5 mm through-hole red LED. The owner SVG is calibrated to one 2.54 mm lead pitch and centred in the physical envelope.',
    referenceBehaviorVerified: false,
    assetCalibration: LED_ASSET_CALIBRATION,
    assetOriginMm: LED_ASSET_ORIGIN,
  },
} as const satisfies Readonly<Record<'source' | 'resistor' | 'led', NativeComponentGeometry>>;
