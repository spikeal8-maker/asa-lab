import type { PublicArtifact, PublicArtifactProvenance } from './public-artifact.js';
import { validatePublicArtifact } from './public-artifact.js';
export type PublicDisplayComponentKind =
  | 'source'
  | 'resistor'
  | 'led'
  | 'rgb-led'
  | 'seven-segment'
  | 'button'
  | 'switch'
  | 'potentiometer'
  | 'photoresistor'
  | 'piezo'
  | 'diode'
  | 'transistor'
  | 'lamp'
  | 'breadboard'
  | 'visual'
  | 'wire';
export interface PublicDisplayPoint {
  readonly x: number;
  readonly y: number;
}
export interface PublicDisplayComponent {
  readonly id: string;
  readonly kind: PublicDisplayComponentKind;
  readonly componentTypeId?: string;
  readonly variantId?: string;
  readonly position: PublicDisplayPoint;
  readonly value: number;
  readonly rotation?: 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315;
  readonly name?: string;
  readonly pinIds?: readonly string[];
}
export interface PublicDisplayConnection {
  readonly id: string;
  readonly from: { readonly componentId: string; readonly terminal: string };
  readonly to: { readonly componentId: string; readonly terminal: string };
  readonly color?: string;
  readonly vertices?: readonly PublicDisplayPoint[];
}
export interface ElectronicsDisplayArtifact {
  readonly schemaVersion: 2;
  readonly status: 'display';
  readonly viewerFamily: 'electronics';
  readonly provenance: PublicArtifactProvenance;
  readonly capabilities: {
    readonly readOnly: true;
    readonly interactive: true;
    readonly download: false;
  };
  readonly components: readonly PublicDisplayComponent[];
  readonly connections: readonly PublicDisplayConnection[];
}
export type PublicProjectDisplayArtifact = PublicArtifact | ElectronicsDisplayArtifact;
export const ELECTRONICS_DISPLAY_LIMITS = Object.freeze({
  maxBytes: 524288,
  maxDepth: 8,
  maxNodes: 50000,
  maxComponents: 300,
  maxConnections: 800,
  maxVertices: 48,
  maxCoordinate: 100000,
});
const kinds = new Set(
  'source resistor led rgb-led seven-segment button switch potentiometer photoresistor piezo diode transistor lamp breadboard visual wire'.split(
    ' ',
  ),
);
function object(v: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.getPrototypeOf(v) !== Object.prototype
  )
    throw Error();
  const keys = Reflect.ownKeys(v);
  if (
    required.some((k) => !keys.includes(k)) ||
    keys.some((k) => typeof k !== 'string' || ![...required, ...optional].includes(k))
  )
    throw Error();
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d?.enumerable || !('value' in d)) throw Error();
  }
  return v as Record<string, unknown>;
}
function str(v: unknown, max = 64): asserts v is string {
  if (
    typeof v !== 'string' ||
    v.length < 1 ||
    v.length > max ||
    /[<>]/.test(v) ||
    Array.from(v).some((character) => character.charCodeAt(0) < 32)
  )
    throw Error();
}
function num(v: unknown, max = 100000): asserts v is number {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > max) throw Error();
}
function point(v: unknown) {
  const p = object(v, ['x', 'y']);
  num(p.x);
  num(p.y);
}
/** Strict v2 display schema. No editor/runtime DTO or arbitrary property bag. */
export function validatePublicProjectDisplayArtifact(
  input: unknown,
):
  | { readonly ok: true; readonly artifact: PublicProjectDisplayArtifact }
  | { readonly ok: false; readonly reason: 'invalid-public-artifact' } {
  const v1 = validatePublicArtifact(input);
  if (v1.ok) return v1;
  try {
    let nodes = 0;
    const seen = new Set<object>();
    function inspect(v: unknown, depth: number): void {
      if (++nodes > 50000 || depth > 8) throw Error();
      if (v === null || typeof v === 'boolean') return;
      if (typeof v === 'number') {
        num(v, Number.MAX_VALUE);
        return;
      }
      if (typeof v === 'string') {
        if (v.length > 128) throw Error();
        return;
      }
      if (!v || typeof v !== 'object' || seen.has(v)) throw Error();
      seen.add(v);
      if (Object.getPrototypeOf(v) !== (Array.isArray(v) ? Array.prototype : Object.prototype))
        throw Error();
      if (Array.isArray(v) && (v.length > 50000 || Reflect.ownKeys(v).length !== v.length + 1))
        throw Error();
      for (const key of Reflect.ownKeys(v)) {
        if (Array.isArray(v) && key === 'length') continue;
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (typeof key !== 'string' || !d?.enumerable || !('value' in d)) throw Error();
        inspect(d.value, depth + 1);
      }
    }
    inspect(input, 0);
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 524288) throw Error();
    const a = object(input, [
      'schemaVersion',
      'status',
      'viewerFamily',
      'provenance',
      'capabilities',
      'components',
      'connections',
    ]);
    if (a.schemaVersion !== 2 || a.status !== 'display' || a.viewerFamily !== 'electronics')
      throw Error();
    const p = object(a.provenance, ['publicationId', 'revisionNumber']);
    if (
      typeof p.publicationId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(p.publicationId) ||
      !Number.isInteger(p.revisionNumber) ||
      Number(p.revisionNumber) < 1 ||
      Number(p.revisionNumber) > 2147483647
    )
      throw Error();
    const cap = object(a.capabilities, ['readOnly', 'interactive', 'download']);
    if (cap.readOnly !== true || cap.interactive !== true || cap.download !== false) throw Error();
    if (
      !Array.isArray(a.components) ||
      a.components.length > 300 ||
      !Array.isArray(a.connections) ||
      a.connections.length > 800
    )
      throw Error();
    const ids = new Map<string, Set<string>>();
    for (const raw of a.components) {
      const c = object(
        raw,
        ['id', 'kind', 'position', 'value'],
        ['componentTypeId', 'variantId', 'rotation', 'name', 'pinIds'],
      );
      str(c.id);
      if (ids.has(c.id) || !kinds.has(String(c.kind))) throw Error();
      point(c.position);
      num(c.value, 1e15);
      for (const k of ['componentTypeId', 'variantId', 'name'])
        if (k in c) str(c[k], k === 'name' ? 128 : 64);
      if (
        'rotation' in c &&
        (typeof c.rotation !== 'number' ||
          ![0, 45, 90, 135, 180, 225, 270, 315].includes(c.rotation))
      )
        throw Error();
      if ('pinIds' in c && (!Array.isArray(c.pinIds) || c.pinIds.length > 128)) throw Error();
      const pins = (c.pinIds ??
        (c.kind === 'potentiometer' ? ['a', 'b', 'wiper'] : ['a', 'b'])) as unknown[];
      pins.forEach((v) => str(v));
      ids.set(c.id, new Set(pins as string[]));
    }
    const wires = new Set<string>();
    for (const raw of a.connections) {
      const w = object(raw, ['id', 'from', 'to'], ['color', 'vertices']);
      str(w.id);
      if (wires.has(w.id)) throw Error();
      wires.add(w.id);
      for (const k of ['from', 'to']) {
        const e = object(w[k], ['componentId', 'terminal']);
        str(e.componentId);
        str(e.terminal);
        if (!ids.get(e.componentId)?.has(e.terminal)) throw Error();
      }
      if ('color' in w && (typeof w.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(w.color)))
        throw Error();
      if ('vertices' in w) {
        if (!Array.isArray(w.vertices) || w.vertices.length > 48) throw Error();
        w.vertices.forEach(point);
      }
    }
    const result = JSON.parse(JSON.stringify(input)) as ElectronicsDisplayArtifact;
    function freeze(v: unknown): void {
      if (v && typeof v === 'object') {
        Object.values(v).forEach(freeze);
        Object.freeze(v);
      }
    }
    freeze(result);
    return { ok: true, artifact: result };
  } catch {
    return { ok: false, reason: 'invalid-public-artifact' };
  }
}
