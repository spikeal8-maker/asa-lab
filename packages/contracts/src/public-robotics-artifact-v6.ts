import type { PublicArtifactProvenance } from './public-artifact.js';
import {
  PUBLIC_ROBOTICS_ROBOT_FIELDS,
  PUBLIC_ROBOTICS_LIMITS,
} from './public-robotics-artifact.js';
import type {
  PublicRoboticsPoint,
  PublicRoboticsPose,
  PublicRoboticsRobot,
  PublicRoboticsField,
  PublicRoboticsFloorMark,
} from './public-robotics-artifact.js';

export type PublicRoboticsBodyV6 = PublicRoboticsPose & {
  readonly id: string;
  readonly label?: string;
  readonly heightMeters: number;
} & (
    | { readonly kind: 'can'; readonly radiusMeters: number }
    | { readonly kind: 'box'; readonly widthMeters: number; readonly depthMeters: number }
  );
export type PublicRoboticsFloorMarkV6 =
  | PublicRoboticsFloorMark
  | {
      readonly id: string;
      readonly label?: string;
      readonly kind: 'curve';
      readonly start: PublicRoboticsPoint;
      readonly control: PublicRoboticsPoint;
      readonly end: PublicRoboticsPoint;
      readonly widthMeters: number;
      readonly color: string;
    };
export interface PublicRoboticsFieldV6 extends Omit<PublicRoboticsField, 'floorMarks'> {
  readonly floorMarks: readonly PublicRoboticsFloorMarkV6[];
  readonly bodies: readonly PublicRoboticsBodyV6[];
  readonly surface: 'smooth' | 'wood' | 'carpet';
  readonly tiles: { readonly enabled: boolean; readonly sizeMeters: number };
}
export interface PublicRoboticsWorldV6 {
  readonly field: PublicRoboticsFieldV6;
  readonly robot: PublicRoboticsRobot;
  readonly initialPose: PublicRoboticsPose;
}
/** Frozen geometry only. Group editing metadata and all mechanical/electronic parameters stay private. */
export interface PublicRoboticsArtifactV6 {
  readonly schemaVersion: 6;
  readonly status: 'display';
  readonly viewerFamily: 'robotics';
  readonly provenance: PublicArtifactProvenance;
  readonly capabilities: Readonly<{ readOnly: true; interactive: true; download: false }>;
  readonly world: PublicRoboticsWorldV6;
}
export const PUBLIC_ROBOTICS_V6_LIMITS = Object.freeze({ ...PUBLIC_ROBOTICS_LIMITS, bodies: 12 });

/** Strict public wire schema. Validation never executes or returns editor/runtime input. */
export function validatePublicRoboticsArtifactV6(
  input: unknown,
):
  | { readonly ok: true; readonly artifact: PublicRoboticsArtifactV6 }
  | { readonly ok: false; readonly reason: 'invalid-public-artifact' } {
  try {
    let nodes = 0;
    const seen = new Set<object>();
    function inspect(value: unknown, depth: number): void {
      if (++nodes > PUBLIC_ROBOTICS_V6_LIMITS.nodes || depth > PUBLIC_ROBOTICS_V6_LIMITS.depth)
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
      if (keys.length > PUBLIC_ROBOTICS_V6_LIMITS.nodes) throw Error();
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
    if (new TextEncoder().encode(serialized).byteLength > PUBLIC_ROBOTICS_V6_LIMITS.bytes)
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
      envelope.schemaVersion !== 6 ||
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
      'bodies',
      'surface',
      'tiles',
    ]);
    const width = number(field.widthMeters, 0.8, 6);
    const height = number(field.heightMeters, 0.8, 6);
    const diagonal = Math.hypot(width, height);
    number(field.gridMeters, 0.02, 0.5);
    if (!['smooth', 'wood', 'carpet'].includes(String(field.surface))) throw Error();
    const tiles = record(field.tiles, ['enabled', 'sizeMeters']);
    if (typeof tiles.enabled !== 'boolean') throw Error();
    number(tiles.sizeMeters, 0.1, 1);
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
    for (const raw of collection(field.obstacles, PUBLIC_ROBOTICS_V6_LIMITS.walls)) {
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
    for (const raw of collection(field.balls, PUBLIC_ROBOTICS_V6_LIMITS.balls)) {
      const ball = record(raw, ['id', 'xMeters', 'yMeters', 'radiusMeters'], ['label']);
      identity(ball);
      number(ball.xMeters, 0, width);
      number(ball.yMeters, 0, height);
      number(ball.radiusMeters, 0.02, 0.25);
    }
    for (const raw of collection(field.floorMarks, PUBLIC_ROBOTICS_V6_LIMITS.floorMarks)) {
      const mark = record(
        raw,
        ['id', 'kind', 'color', 'widthMeters'],
        ['label', 'start', 'control', 'end', 'xMeters', 'yMeters', 'heightMeters'],
      );
      identity(mark);
      if (!/^#[0-9a-f]{6}$/i.test(text(mark.color, 7))) throw Error();
      if (mark.kind === 'line' || mark.kind === 'curve') {
        record(
          mark,
          [
            'id',
            'kind',
            'color',
            'widthMeters',
            'start',
            'end',
            ...(mark.kind === 'curve' ? ['control'] : []),
          ],
          ['label'],
        );
        if (mark.kind === 'curve') point(mark.control);
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
    const bodies = collection(field.bodies, 12);
    if (bodies.length + (field.balls as unknown[]).length > 12) throw Error();
    for (const raw of bodies) {
      const item = record(
        raw,
        ['id', 'kind', 'xMeters', 'yMeters', 'heightMeters', 'headingRadians'],
        ['label', 'radiusMeters', 'widthMeters', 'depthMeters'],
      );
      identity(item);
      number(item.xMeters, 0, width);
      number(item.yMeters, 0, height);
      number(item.heightMeters, 0.01, 1);
      number(item.headingRadians, -Math.PI, Math.PI);
      if (item.kind === 'can') {
        record(
          item,
          ['id', 'kind', 'xMeters', 'yMeters', 'heightMeters', 'headingRadians', 'radiusMeters'],
          ['label'],
        );
        number(item.radiusMeters, 0.02, 0.25);
      } else if (item.kind === 'box') {
        record(
          item,
          [
            'id',
            'kind',
            'xMeters',
            'yMeters',
            'heightMeters',
            'headingRadians',
            'widthMeters',
            'depthMeters',
          ],
          ['label'],
        );
        number(item.widthMeters, 0.04, 0.6);
        number(item.depthMeters, 0.04, 0.6);
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
    const artifact = JSON.parse(serialized) as PublicRoboticsArtifactV6;
    freeze(artifact);
    return { ok: true, artifact };
  } catch {
    return { ok: false, reason: 'invalid-public-artifact' };
  }
}
