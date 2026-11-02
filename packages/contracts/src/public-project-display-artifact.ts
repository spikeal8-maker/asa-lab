import { publicArduinoBlocks } from './public-arduino-blocks.js';
import {
  validatePublicThreeDArtifact,
  type PublicThreeDArtifact,
} from './public-three-d-artifact.js';
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
/** Only inert native geometry configuration; never a runtime state property bag. */
export interface PublicDisplayVisualProperties {
  readonly mirrorX?: boolean;
  readonly mirrorY?: boolean;
  readonly pinLayout?: 'RCBG' | 'RCGB' | 'BRCG';
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
  readonly state?: boolean;
  readonly visualProperties?: PublicDisplayVisualProperties;
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
/** Public execution inputs, not a serialized editor or persisted runtime. */
export interface PublicSimulationComponent extends PublicDisplayComponent {
  readonly electricalModelId?: string;
  readonly electricalModelVersion?: number;
  readonly modelProfileId?: string;
  readonly modelProfileVersion?: number;
  readonly wiperPosition?: number;
  readonly stateProperties?: Readonly<
    Record<string, string | number | boolean | readonly string[]>
  >;
  readonly holeBindings?: Readonly<
    Record<string, { readonly breadboardComponentId: string; readonly holeId: string }>
  >;
  readonly internalConnections?: readonly (readonly [string, string])[];
}
export interface ElectronicsSimulationArtifact extends Omit<
  ElectronicsDisplayArtifact,
  'schemaVersion' | 'status' | 'components'
> {
  readonly schemaVersion: 3;
  readonly status: 'simulation';
  readonly solverIterations: number;
  readonly components: readonly PublicSimulationComponent[];
}
export type PublicProjectDisplayArtifact =
  | PublicArtifact
  | ElectronicsDisplayArtifact
  | ElectronicsSimulationArtifact
  | PublicThreeDArtifact;
/** Only canonical physical configuration and inert native presentation inputs. */
export const PUBLIC_ELECTRONICS_PROPERTIES = Object.freeze([
  'mirrorX',
  'mirrorY',
  'pinLayout',
  'ledColour',
  'segmentColor',
  'ambientTemperatureCelsius',
  'commonMode',
  'continuousCurrentAmp',
  'displayEnabled',
  'distanceMeters',
  'illumination',
  'initialVoltageVolt',
  'internalResistanceOhm',
  'maxCollectorCurrent',
  'maxContinuousCurrentAmp',
  'maxDrainCurrent',
  'maxPower',
  'measurementMode',
  'moisturePercent',
  'motionDetected',
  'outputEnabled',
  'outputLoadTorqueNewtonMeter',
  'piezoMode',
  'powerRatingWatt',
  'shaftLocked',
  'temperatureCelsius',
  'thresholdVoltage',
  'transconductanceFactor',
  'transistorType',
  'voltageRatingVolt',
  'waveform',
  'voltageSetpointVolt',
  'currentLimitAmp',
  'frequencyHz',
  'amplitudeVpp',
  'dcOffsetVolt',
  'voltsPerDivision',
  'timePerDivisionMs',
  'triggerLevelVolt',
  'meterRange',
  'arduinoBlocks',
  'arduinoSource',
  'arduinoCodeMode',
  'cells',
  'colour',
  'tolerancePercent',
  'resistanceUnit',
  'piezoVariant',
  'currentGain',
  'baseEmitterVoltage',
  'saturationVoltage',
  'motorAssemblyProfileId',
  'outputResistanceOhm',
  'coupling',
]);
export const PUBLIC_ELECTRONICS_EDITOR_PROPERTIES = Object.freeze([
  'arduinoWorkspace',
  'arduinoSerialOpen',
  'arduinoBaudRate',
  'ledBrightness',
  'ledFault',
  'red',
  'green',
  'blue',
  'lampLevel',
  'contactState',
  'selectedThrow',
]);
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
  if (
    input &&
    typeof input === 'object' &&
    Object.getOwnPropertyDescriptor(input, 'schemaVersion')?.value === 4
  )
    return validatePublicThreeDArtifact(input);
  const v1 = validatePublicArtifact(input);
  if (v1.ok) return v1;
  if (
    input &&
    typeof input === 'object' &&
    Object.getOwnPropertyDescriptor(input, 'schemaVersion')?.value === 3
  )
    return validateSimulationArtifact(input);
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
        ['componentTypeId', 'variantId', 'rotation', 'name', 'pinIds', 'state', 'visualProperties'],
      );
      if ('state' in c && typeof c.state !== 'boolean') throw Error();
      if ('visualProperties' in c) {
        const visual = object(c.visualProperties, [], ['mirrorX', 'mirrorY', 'pinLayout']);
        for (const key of ['mirrorX', 'mirrorY'])
          if (key in visual && typeof visual[key] !== 'boolean') throw Error();
        if (
          'pinLayout' in visual &&
          (typeof visual.pinLayout !== 'string' ||
            !['RCBG', 'RCGB', 'BRCG'].includes(visual.pinLayout))
        )
          throw Error();
      }
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

function validateSimulationArtifact(
  input: unknown,
):
  | { readonly ok: true; readonly artifact: ElectronicsSimulationArtifact }
  | { readonly ok: false; readonly reason: 'invalid-public-artifact' } {
  try {
    let nodes = 0;
    const seen = new Set<object>();
    function inspect(value: unknown, depth: number): void {
      if (++nodes > 50000 || depth > 10) throw Error();
      if (typeof value === 'string') {
        if (value.length > 65536) throw Error();
        return;
      }
      if (value === null || typeof value === 'boolean') return;
      if (typeof value === 'number') {
        num(value, Number.MAX_VALUE);
        return;
      }
      if (!value || typeof value !== 'object' || seen.has(value)) throw Error();
      seen.add(value);
      if (
        Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype)
      )
        throw Error();
      if (Array.isArray(value) && Reflect.ownKeys(value).length !== value.length + 1) throw Error();
      for (const key of Reflect.ownKeys(value)) {
        if (Array.isArray(value) && key === 'length') continue;
        const d = Object.getOwnPropertyDescriptor(value, key);
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
      'solverIterations',
    ]);
    if (a.schemaVersion !== 3 || a.status !== 'simulation' || !Array.isArray(a.components))
      throw Error();
    if (
      !Number.isInteger(a.solverIterations) ||
      Number(a.solverIterations) < 4 ||
      Number(a.solverIterations) > 100
    )
      throw Error();
    const components = a.components.map((raw) => {
      const c = object(
        raw,
        ['id', 'kind', 'position', 'value'],
        [
          'componentTypeId',
          'variantId',
          'rotation',
          'name',
          'pinIds',
          'state',
          'visualProperties',
          'electricalModelId',
          'electricalModelVersion',
          'modelProfileId',
          'modelProfileVersion',
          'wiperPosition',
          'stateProperties',
          'holeBindings',
          'internalConnections',
        ],
      );
      for (const key of ['electricalModelId', 'modelProfileId']) if (key in c) str(c[key]);
      for (const key of ['electricalModelVersion', 'modelProfileVersion'])
        if (key in c && (!Number.isSafeInteger(c[key]) || Number(c[key]) < 1)) throw Error();
      if (
        'wiperPosition' in c &&
        (typeof c.wiperPosition !== 'number' || c.wiperPosition < 0 || c.wiperPosition > 1)
      )
        throw Error();
      if ('stateProperties' in c) {
        const properties = object(c.stateProperties, [], [...PUBLIC_ELECTRONICS_PROPERTIES]);
        if (
          ('arduinoSource' in properties ||
            'arduinoCodeMode' in properties ||
            'arduinoBlocks' in properties) &&
          c.componentTypeId !== 'arduino-uno' &&
          c.variantId !== 'arduino-uno'
        )
          throw Error();
        if (
          'arduinoCodeMode' in properties &&
          !['blocks', 'blocks-text', 'text'].includes(String(properties.arduinoCodeMode))
        )
          throw Error();
        for (const [key, value] of Object.entries(properties)) {
          if (key === 'arduinoBlocks') {
            if (
              typeof value !== 'string' ||
              publicArduinoBlocks(value) !== value ||
              !['blocks', 'blocks-text'].includes(String(properties.arduinoCodeMode))
            )
              throw Error();
          } else if (key === 'arduinoSource') {
            if (
              typeof value !== 'string' ||
              !value.trim() ||
              value.length > 65536 ||
              value.includes(String.fromCharCode(0))
            )
              throw Error();
          } else if (Array.isArray(value)) {
            if (key !== 'pinLayout' || value.length > 128) throw Error();
            value.forEach((v) => str(v));
          } else if (typeof value === 'string') str(value, 128);
          else if (typeof value === 'number') num(value, 1e15);
          else if (typeof value !== 'boolean') throw Error();
        }
      }
      if (c.componentTypeId === 'arduino-uno' || c.variantId === 'arduino-uno') {
        const properties = c.stateProperties as Record<string, unknown> | undefined;
        if (typeof properties?.arduinoSource !== 'string' || !properties.arduinoSource.trim())
          throw Error();
      }
      if ('holeBindings' in c) {
        const bindings = c.holeBindings as Record<string, unknown>;
        object(bindings, [], Object.keys(bindings));
        if (Object.keys(bindings).length > 128) throw Error();
        for (const [terminal, rawBinding] of Object.entries(bindings)) {
          str(terminal);
          const binding = object(rawBinding, ['breadboardComponentId', 'holeId']);
          str(binding.breadboardComponentId);
          str(binding.holeId);
        }
      }
      if ('internalConnections' in c) {
        if (!Array.isArray(c.internalConnections) || c.internalConnections.length > 128)
          throw Error();
        for (const pair of c.internalConnections) {
          if (!Array.isArray(pair) || pair.length !== 2) throw Error();
          pair.forEach((v) => str(v));
        }
      }
      const display = { ...c };
      for (const key of [
        'electricalModelId',
        'electricalModelVersion',
        'modelProfileId',
        'modelProfileVersion',
        'wiperPosition',
        'stateProperties',
        'holeBindings',
        'internalConnections',
      ])
        delete display[key];
      return display;
    });
    const display = validatePublicProjectDisplayArtifact({
      viewerFamily: a.viewerFamily,
      provenance: a.provenance,
      capabilities: a.capabilities,
      connections: a.connections,
      schemaVersion: 2,
      status: 'display',
      components,
    });
    if (!display.ok || display.artifact.schemaVersion !== 2) throw Error();
    const result = JSON.parse(JSON.stringify(input)) as ElectronicsSimulationArtifact;
    const freeze = (value: unknown): void => {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    };
    freeze(result);
    return { ok: true, artifact: result };
  } catch {
    return { ok: false, reason: 'invalid-public-artifact' };
  }
}
