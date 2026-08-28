import type { SchematicComponent, Terminal } from '../document.js';
import { electricalModelIdentityForComponent } from '../model-identity.js';
import {
  ORDINARY_LED_PROFILES,
  RGB_LED_PROFILES,
  ordinaryLedProfile,
  rgbLedProfile,
  type LedJunctionProfile,
  type LedLinearSegment,
} from '../led-model.js';
import { canonicalNpnDcProfileRegistry } from './npn-dc-model.js';

export interface DiodeJunctionProfile {
  readonly forwardSegments: readonly LedLinearSegment[];
  readonly nominalCurrentAmp: number;
  readonly destructiveCurrentAmp: number;
  readonly repetitivePeakReverseVoltage: number;
  readonly brightnessExponent: number;
  readonly nearLimitWarning: boolean;
}

/**
 * Versioned DC assumptions for the two owner-supplied axial packages.
 *
 * DO-35 follows a 1N4148-class signal diode (200 mA continuous, 100 V reverse).
 * DO-41 follows a 1N4007-class rectifier (1 A average, 1000 V reverse). The
 * bounded piecewise-linear curves keep the solver deterministic while making
 * the two catalog variants electrically different rather than visual aliases.
 */
export const DIODE_JUNCTION_PROFILES: Readonly<Record<string, DiodeJunctionProfile>> = {
  'generic-signal-diode-do35': {
    forwardSegments: [
      { minimumCurrentAmp: 0, kneeVoltage: 0.58, dynamicResistanceOhm: 12 },
      { minimumCurrentAmp: 0.01, kneeVoltage: 0.67, dynamicResistanceOhm: 3 },
      { minimumCurrentAmp: 0.1, kneeVoltage: 0.94, dynamicResistanceOhm: 0.3 },
    ],
    nominalCurrentAmp: 0.2,
    destructiveCurrentAmp: 0.45,
    repetitivePeakReverseVoltage: 100,
    brightnessExponent: 1,
    nearLimitWarning: true,
  },
  'generic-rectifier-diode-do41': {
    forwardSegments: [
      { minimumCurrentAmp: 0, kneeVoltage: 0.56, dynamicResistanceOhm: 4 },
      { minimumCurrentAmp: 0.05, kneeVoltage: 0.73, dynamicResistanceOhm: 0.6 },
      { minimumCurrentAmp: 0.5, kneeVoltage: 0.96, dynamicResistanceOhm: 0.14 },
    ],
    nominalCurrentAmp: 1,
    destructiveCurrentAmp: 3,
    repetitivePeakReverseVoltage: 1000,
    brightnessExponent: 1,
    nearLimitWarning: true,
  },
};

/** Included in modelSetDigest so numerical profile changes cannot masquerade as the same model. */
export function canonicalNonlinearDcProfileRegistry(): string {
  return JSON.stringify({
    registryVersion: 2,
    diodes: DIODE_JUNCTION_PROFILES,
    ordinaryLeds: ORDINARY_LED_PROFILES,
    rgbLeds: RGB_LED_PROFILES,
    npn: canonicalNpnDcProfileRegistry(),
  });
}

const LEGACY_DIODE_PROFILE: DiodeJunctionProfile = {
  forwardSegments: [{ minimumCurrentAmp: 0, kneeVoltage: 0.7, dynamicResistanceOhm: 2 }],
  nominalCurrentAmp: 0.2,
  destructiveCurrentAmp: 0.45,
  repetitivePeakReverseVoltage: 100,
  brightnessExponent: 1,
  nearLimitWarning: true,
};

export interface NonlinearDcBranch {
  readonly component: SchematicComponent;
  readonly id: string;
  readonly anode: Terminal;
  readonly cathode: Terminal;
  readonly forwardSegments: readonly LedLinearSegment[];
  readonly nominalCurrentAmp: number;
  readonly destructiveCurrentAmp: number;
  readonly repetitivePeakReverseVoltage: number;
  readonly brightnessExponent: number;
  readonly nearLimitWarning: boolean;
  readonly emitsLight: boolean;
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

function branchFromLedProfile(input: {
  readonly component: SchematicComponent;
  readonly id: string;
  readonly anode: Terminal;
  readonly cathode: Terminal;
  readonly profile: LedJunctionProfile;
}): NonlinearDcBranch {
  const fallback: LedLinearSegment = {
    minimumCurrentAmp: 0,
    kneeVoltage: input.profile.kneeVoltage,
    dynamicResistanceOhm: input.profile.dynamicResistanceOhm,
  };
  return {
    component: input.component,
    id: input.id,
    anode: input.anode,
    cathode: input.cathode,
    forwardSegments: input.profile.linearSegments ?? [fallback],
    nominalCurrentAmp: input.profile.nominalCurrentAmp,
    destructiveCurrentAmp: input.profile.burnoutCurrentAmp,
    repetitivePeakReverseVoltage: 5,
    brightnessExponent: input.profile.brightnessExponent,
    nearLimitWarning: input.profile.nearLimitWarning ?? true,
    emitsLight: true,
  };
}

export function nonlinearDcBranchesForComponent(
  component: SchematicComponent,
): readonly NonlinearDcBranch[] {
  const identity = electricalModelIdentityForComponent(component);
  if (component.kind === 'led') {
    const colour = String(component.stateProperties?.['ledColour'] ?? 'red');
    return [
      branchFromLedProfile({
        component,
        id: 'led',
        anode: component.componentTypeId ? 'anode' : 'a',
        cathode: component.componentTypeId ? 'cathode' : 'b',
        profile: ordinaryLedProfile(colour),
      }),
    ];
  }
  if (component.kind === 'diode') {
    const declared = DIODE_JUNCTION_PROFILES[identity.modelProfileId] ?? LEGACY_DIODE_PROFILE;
    const value = Number(component.value);
    const forwardSegments =
      identity.modelProfileId.startsWith('legacy-') && Number.isFinite(value) && value > 0
        ? [{ ...declared.forwardSegments[0]!, kneeVoltage: value }]
        : declared.forwardSegments;
    return [
      {
        component,
        id: 'diode',
        anode: component.componentTypeId ? 'anode' : 'a',
        cathode: component.componentTypeId ? 'cathode' : 'b',
        forwardSegments,
        nominalCurrentAmp: declared.nominalCurrentAmp,
        destructiveCurrentAmp: declared.destructiveCurrentAmp,
        repetitivePeakReverseVoltage: declared.repetitivePeakReverseVoltage,
        brightnessExponent: declared.brightnessExponent,
        nearLimitWarning: declared.nearLimitWarning,
        emitsLight: false,
      },
    ];
  }
  if (component.kind === 'rgb-led') {
    const common = 'common';
    const commonAnode = component.stateProperties?.['commonMode'] === 'common-anode';
    return ['red', 'green', 'blue'].map((channel) =>
      branchFromLedProfile({
        component,
        id: channel,
        anode: commonAnode ? common : channel,
        cathode: commonAnode ? channel : common,
        profile: rgbLedProfile(channel),
      }),
    );
  }
  if (component.kind === 'seven-segment') {
    const common = 'bottom-3';
    const commonAnode = component.stateProperties?.['commonMode'] === 'common-anode';
    const profile: LedJunctionProfile = {
      kneeVoltage: 1.9,
      dynamicResistanceOhm: 8,
      nominalCurrentAmp: 0.01,
      burnoutCurrentAmp: 0.02,
      brightnessExponent: 0.65,
    };
    return Object.entries(SEVEN_SEGMENT_TERMINALS).map(([segment, terminal]) =>
      branchFromLedProfile({
        component,
        id: segment,
        anode: commonAnode ? common : terminal,
        cathode: commonAnode ? terminal : common,
        profile,
      }),
    );
  }
  return [];
}

export function nonlinearBranchKey(branch: NonlinearDcBranch): string {
  return `${branch.component.id}:${branch.id}`;
}

export function nonlinearSegmentAt(branch: NonlinearDcBranch, index: number): LedLinearSegment {
  return branch.forwardSegments[Math.min(Math.max(0, index), branch.forwardSegments.length - 1)]!;
}

export function nonlinearSegmentIndex(branch: NonlinearDcBranch, currentAmp: number): number {
  let selected = 0;
  for (const [index, segment] of branch.forwardSegments.entries()) {
    if (currentAmp + 1e-10 < segment.minimumCurrentAmp) break;
    selected = index;
  }
  return selected;
}
