import type { PublicArtifactProvenance } from './public-artifact.js';

export interface PublicRoboticsPoint {
  readonly xMeters: number;
  readonly yMeters: number;
}
export interface PublicRoboticsPose extends PublicRoboticsPoint {
  readonly headingRadians: number;
}
export interface PublicRoboticsWall extends PublicRoboticsPoint {
  readonly id: string;
  readonly label?: string;
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly headingRadians?: number;
}
export interface PublicRoboticsBall extends PublicRoboticsPoint {
  readonly id: string;
  readonly label?: string;
  readonly radiusMeters: number;
}
export type PublicRoboticsFloorMark = {
  readonly id: string;
  readonly label?: string;
  readonly color: string;
  readonly widthMeters: number;
} & (
  | {
      readonly kind: 'line';
      readonly start: PublicRoboticsPoint;
      readonly end: PublicRoboticsPoint;
    }
  | (PublicRoboticsPoint & { readonly kind: 'area'; readonly heightMeters: number })
);
export interface PublicRoboticsField {
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly gridMeters: number;
  readonly obstacles: readonly PublicRoboticsWall[];
  readonly balls: readonly PublicRoboticsBall[];
  readonly floorMarks: readonly PublicRoboticsFloorMark[];
}
export interface PublicRoboticsRobot {
  readonly bodyLengthMeters: number;
  readonly bodyWidthMeters: number;
  readonly wheelRadiusMeters: number;
  readonly wheelWidthMeters: number;
  readonly wheelTrackMeters: number;
  readonly sensorForwardMeters: number;
  readonly sensorLateralMeters: number;
  readonly sensorHeadingRadians: number;
}
/** Source geometry in SI units, Y upwards. No circuit, program, bindings or runtime state. */
export interface PublicRoboticsWorld {
  readonly field: PublicRoboticsField;
  readonly robot: PublicRoboticsRobot;
  readonly initialPose: PublicRoboticsPose;
}
export interface PublicRoboticsArtifact {
  readonly schemaVersion: 5;
  readonly status: 'display';
  readonly viewerFamily: 'robotics';
  readonly provenance: PublicArtifactProvenance;
  readonly capabilities: Readonly<{ readOnly: true; interactive: true; download: false }>;
  readonly world: PublicRoboticsWorld;
}
export const PUBLIC_ROBOTICS_ROBOT_FIELDS = [
  'bodyLengthMeters',
  'bodyWidthMeters',
  'wheelRadiusMeters',
  'wheelWidthMeters',
  'wheelTrackMeters',
  'sensorForwardMeters',
  'sensorLateralMeters',
  'sensorHeadingRadians',
] as const;
export const PUBLIC_ROBOTICS_LIMITS = Object.freeze({
  bytes: 65536,
  nodes: 4096,
  depth: 8,
  walls: 24,
  balls: 12,
  floorMarks: 48,
});

/** Strict public wire schema. Validation never executes or returns editor/runtime input. */
export function validatePublicRoboticsArtifact(
  input: unknown,
):
  | { readonly ok: true; readonly artifact: PublicRoboticsArtifact }
  | { readonly ok: false; readonly reason: 'invalid-public-artifact' } {
  try {
    let nodes = 0;
    const seen = new Set<object>();
    function inspect(value: unknown, depth: number): void {
      if (++nodes > PUBLIC_ROBOTICS_LIMITS.nodes || depth > PUBLIC_ROBOTICS_LIMITS.depth)
        throw Error();
      if (value === null || typeof value === 'boolean') return;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw Error();
        return;
      }
      if (typeof value === 'string') {
        if (value.length > 128) throw Error();
        return;
      }
      if (!value || typeof value !== 'object' || seen.has(value)) throw Error();
      const array = Array.isArray(value);
      if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype))
        throw Error();
      seen.add(value);
      const keys = Reflect.ownKeys(value);
      if (keys.length > PUBLIC_ROBOTICS_LIMITS.nodes) throw Error();
      if (array && (value.length > 48 || keys.length !== value.length + 1)) throw Error();
      for (const key of keys) {
        if (array && key === 'length') continue;
        if (typeof key !== 'string' || key.length > 80) throw Error();
        if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) throw Error();
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !('value' in descriptor)) throw Error();
        inspect(descriptor.value, depth + 1);
      }
    }
    function record(
      value: unknown,
      required: readonly string[],
      optional: readonly string[] = [],
    ): Record<string, unknown> {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
      const keys = Object.keys(value);
      if (
        required.some((key) => !Object.hasOwn(value, key)) ||
        keys.some((key) => !required.includes(key) && !optional.includes(key))
      )
        throw Error();
      return value as Record<string, unknown>;
    }
    function number(value: unknown, minimum: number, maximum: number): number {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < minimum ||
        value > maximum
      )
        throw Error();
      return value;
    }
    function text(value: unknown, maximum: number): string {
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > maximum ||
        [...value].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        throw Error();
      return value;
    }
    function collection(value: unknown, maximum: number): unknown[] {
      if (!Array.isArray(value) || value.length > maximum) throw Error();
      return value;
    }
    inspect(input, 0);
    const serialized = JSON.stringify(input);
    if (new TextEncoder().encode(serialized).byteLength > PUBLIC_ROBOTICS_LIMITS.bytes)
      throw Error();
    const envelope = record(input, [
      'schemaVersion',
      'status',
      'viewerFamily',
      'provenance',
      'capabilities',
      'world',
    ]);
    if (
      envelope.schemaVersion !== 5 ||
      envelope.status !== 'display' ||
      envelope.viewerFamily !== 'robotics'
    )
      throw Error();
    const provenance = record(envelope.provenance, ['publicationId', 'revisionNumber']);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        text(provenance.publicationId, 36),
      ) ||
      !Number.isInteger(provenance.revisionNumber)
    )
      throw Error();
    number(provenance.revisionNumber, 1, 2147483647);
    const capabilities = record(envelope.capabilities, ['readOnly', 'interactive', 'download']);
    if (
      capabilities.readOnly !== true ||
      capabilities.interactive !== true ||
      capabilities.download !== false
    )
      throw Error();
    const world = record(envelope.world, ['field', 'robot', 'initialPose']);
    const field = record(world.field, [
      'widthMeters',
      'heightMeters',
      'gridMeters',
      'obstacles',
      'balls',
      'floorMarks',
    ]);
    const width = number(field.widthMeters, 0.8, 2.4);
    const height = number(field.heightMeters, 0.8, 2.4);
    const diagonal = Math.hypot(width, height);
    number(field.gridMeters, 0.02, 0.5);
    const ids = new Set<string>();
    function identity(item: Record<string, unknown>): void {
      const id = text(item.id, 64);
      if (ids.has(id)) throw Error();
      ids.add(id);
      if (Object.hasOwn(item, 'label')) text(item.label, 80);
    }
    function point(value: unknown): void {
      const p = record(value, ['xMeters', 'yMeters']);
      number(p.xMeters, 0, width);
      number(p.yMeters, 0, height);
    }
    for (const raw of collection(field.obstacles, PUBLIC_ROBOTICS_LIMITS.walls)) {
      const wall = record(
        raw,
        ['id', 'xMeters', 'yMeters', 'widthMeters', 'heightMeters'],
        ['label', 'headingRadians'],
      );
      identity(wall);
      number(wall.xMeters, -diagonal, width);
      number(wall.yMeters, -diagonal, height);
      number(wall.widthMeters, 0.02, diagonal);
      number(wall.heightMeters, 0.02, diagonal);
      if (Object.hasOwn(wall, 'headingRadians')) number(wall.headingRadians, -Math.PI, Math.PI);
    }
    for (const raw of collection(field.balls, PUBLIC_ROBOTICS_LIMITS.balls)) {
      const ball = record(raw, ['id', 'xMeters', 'yMeters', 'radiusMeters'], ['label']);
      identity(ball);
      number(ball.xMeters, 0, width);
      number(ball.yMeters, 0, height);
      number(ball.radiusMeters, 0.02, 0.25);
    }
    for (const raw of collection(field.floorMarks, PUBLIC_ROBOTICS_LIMITS.floorMarks)) {
      const mark = record(
        raw,
        ['id', 'kind', 'color', 'widthMeters'],
        ['label', 'start', 'end', 'xMeters', 'yMeters', 'heightMeters'],
      );
      identity(mark);
      if (!/^#[0-9a-f]{6}$/i.test(text(mark.color, 7))) throw Error();
      if (mark.kind === 'line') {
        record(mark, ['id', 'kind', 'color', 'widthMeters', 'start', 'end'], ['label']);
        point(mark.start);
        point(mark.end);
        number(mark.widthMeters, 0.005, 0.2);
      } else if (mark.kind === 'area') {
        record(
          mark,
          ['id', 'kind', 'color', 'widthMeters', 'xMeters', 'yMeters', 'heightMeters'],
          ['label'],
        );
        number(mark.xMeters, 0, width);
        number(mark.yMeters, 0, height);
        number(mark.widthMeters, 0.02, width);
        number(mark.heightMeters, 0.02, height);
      } else throw Error();
    }
    const robot = record(world.robot, PUBLIC_ROBOTICS_ROBOT_FIELDS);
    number(robot.bodyLengthMeters, 0.05, 0.5);
    number(robot.bodyWidthMeters, 0.05, 0.5);
    number(robot.wheelRadiusMeters, 0.01, 0.1);
    number(robot.wheelWidthMeters, 0.005, 0.1);
    number(robot.wheelTrackMeters, 0.05, 0.5);
    number(robot.sensorForwardMeters, -0.3, 0.3);
    number(robot.sensorLateralMeters, -0.3, 0.3);
    number(robot.sensorHeadingRadians, -Math.PI, Math.PI);
    const pose = record(world.initialPose, ['xMeters', 'yMeters', 'headingRadians']);
    number(pose.xMeters, 0, width);
    number(pose.yMeters, 0, height);
    number(pose.headingRadians, -Math.PI, Math.PI);
    function freeze(value: unknown): void {
      if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
      }
    }
    const artifact = JSON.parse(serialized) as PublicRoboticsArtifact;
    freeze(artifact);
    return { ok: true, artifact };
  } catch {
    return { ok: false, reason: 'invalid-public-artifact' };
  }
}
