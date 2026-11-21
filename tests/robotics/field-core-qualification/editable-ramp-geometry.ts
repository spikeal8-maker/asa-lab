/** Pure metric construction shared by the qualification model, plan and profile. */
export type RampVector = readonly [number, number, number];
export interface EditableRampInput {
  readonly lengthMeters: number;
  readonly widthMeters: number;
  readonly riseMeters: number;
  readonly baseThicknessMeters: number;
  readonly originMeters: RampVector;
  readonly headingRadians: number;
}
export interface EditableRampGeometry {
  readonly angleRadians: number;
  readonly slopingLengthMeters: number;
  readonly volumeCubicMeters: number;
  readonly upslope: RampVector;
  readonly transverse: RampVector;
  readonly tangent: RampVector;
  readonly normal: RampVector;
  readonly vertices: readonly RampVector[];
  readonly faces: readonly (readonly [number, number, number])[];
  readonly top: readonly RampVector[];
  readonly plan: readonly (readonly [number, number])[];
  readonly profile: readonly (readonly [number, number])[];
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new Error('RAMP_NONFINITE');
  return value;
}
function positive(value: number): number {
  if (finite(value) <= 0) throw new Error('RAMP_NONPOSITIVE_DIMENSION');
  return value;
}

/** Angle edits retain the current horizontal length. Angles use radians. */
export function rampRiseForAngle(lengthMeters: number, angleRadians: number): number {
  positive(lengthMeters);
  finite(angleRadians);
  if (angleRadians < 0 || angleRadians >= Math.PI / 2) throw new Error('RAMP_ANGLE_RANGE');
  const rise = finite(lengthMeters * Math.tan(angleRadians));
  const recovered = Math.atan2(rise, lengthMeters);
  const roundoff = 32 * Number.EPSILON * Math.max(1, Math.abs(angleRadians));
  if ((angleRadians > 0 && rise === 0) || Math.abs(recovered - angleRadians) > roundoff)
    throw new Error('RAMP_ANGLE_UNREPRESENTABLE');
  return rise;
}

export function createEditableRampGeometry(input: EditableRampInput): EditableRampGeometry {
  const length = positive(input.lengthMeters);
  const width = positive(input.widthMeters);
  const thickness = positive(input.baseThicknessMeters);
  const rise = finite(input.riseMeters);
  if (rise < 0) throw new Error('RAMP_NEGATIVE_RISE');
  if (!Array.isArray(input.originMeters) || input.originMeters.length !== 3)
    throw new Error('RAMP_ORIGIN_SHAPE');
  input.originMeters.forEach(finite);
  const heading = finite(input.headingRadians);
  const c = Math.cos(heading),
    s = Math.sin(heading);
  const theta = Math.atan2(rise, length);
  if (theta >= Math.PI / 2 || (rise > 0 && theta === 0))
    throw new Error('RAMP_ANGLE_UNREPRESENTABLE');
  const slopingLength = finite(Math.hypot(length, rise));
  const volume = positive(length * width * (thickness + rise / 2));
  const e: RampVector = [c, s, 0],
    b: RampVector = [-s, c, 0];
  const point = (u: number, v: number, z: number): RampVector => [
    finite(input.originMeters[0] + u * c - v * s),
    finite(input.originMeters[1] + u * s + v * c),
    finite(input.originMeters[2] + z),
  ];
  const footprint = [
    [0, -width / 2],
    [length, -width / 2],
    [length, width / 2],
    [0, width / 2],
  ] as const;
  const vertices: RampVector[] = [
    ...footprint.map(([u, v]) => point(u, v, -thickness)),
    ...footprint.map(([u, v]) => point(u, v, rise * (u / length))),
  ];
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [2, 3, 7],
    [2, 7, 6],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [3, 0, 4],
    [3, 4, 7],
    [4, 5, 6],
    [4, 6, 7],
  ] as const;
  for (const [ia, ib, ic] of faces) {
    const a = vertices[ia]!,
      bb = vertices[ib]!,
      cc = vertices[ic]!;
    const ab = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]];
    const ac = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
    positive(
      Math.hypot(
        ab[1]! * ac[2]! - ab[2]! * ac[1]!,
        ab[2]! * ac[0]! - ab[0]! * ac[2]!,
        ab[0]! * ac[1]! - ab[1]! * ac[0]!,
      ),
    );
  }
  return {
    angleRadians: theta,
    slopingLengthMeters: slopingLength,
    volumeCubicMeters: volume,
    upslope: e,
    transverse: b,
    tangent: [(length * c) / slopingLength, (length * s) / slopingLength, rise / slopingLength],
    normal: [(-rise * c) / slopingLength, (-rise * s) / slopingLength, length / slopingLength],
    vertices,
    faces,
    top: vertices.slice(4),
    plan: footprint.map(([u, v]) => {
      const p = point(u, v, 0);
      return [p[0], p[1]];
    }),
    profile: [
      [0, -thickness],
      [length, -thickness],
      [length, rise],
      [0, 0],
    ],
  };
}
