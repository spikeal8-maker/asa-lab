import type { ElectronicsDocument, ProductionStateValue, SchematicComponent } from './document.js';
import { electricalModelIdentityForComponent } from './model-identity.js';

export const SIMULATION_INPUT_DIGEST_VERSION = 'asa-electronics-simulation-input-v2';

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | CanonicalObject;
interface CanonicalObject {
  readonly [key: string]: CanonicalValue;
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finiteNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${path} must be finite`);
  return Object.is(value, -0) ? 0 : value;
}

function canonicalStateValue(value: ProductionStateValue, path: string): CanonicalValue {
  if (typeof value === 'number') return finiteNumber(value, path);
  if (typeof value === 'object') return Array.from(value, (item) => String(item));
  return value;
}

function canonicalStateProperties(
  component: SchematicComponent,
): Readonly<Record<string, CanonicalValue>> {
  return Object.fromEntries(
    Object.entries(component.stateProperties ?? {})
      .sort(([left], [right]) => ordinalCompare(left, right))
      .map(([key, value]) => [key, canonicalStateValue(value, `${component.id}.${key}`)]),
  );
}

function canonicalComponent(component: SchematicComponent): CanonicalObject {
  const modelIdentity = electricalModelIdentityForComponent(component);
  const holeBindings = Object.entries(component.holeBindings ?? {})
    .sort(([left], [right]) => ordinalCompare(left, right))
    .map(([terminalId, binding]) => ({
      terminalId,
      breadboardComponentId: binding.breadboardComponentId,
      holeId: binding.holeId,
    }));
  const internalConnections = [...(component.internalConnections ?? [])]
    .map(([left, right]) => (ordinalCompare(left, right) <= 0 ? [left, right] : [right, left]))
    .sort(([leftA, rightA], [leftB, rightB]) =>
      ordinalCompare(`${leftA}\u0000${rightA}`, `${leftB}\u0000${rightB}`),
    );
  return {
    componentInstanceId: component.id,
    componentTypeId: component.componentTypeId ?? null,
    variantId: component.variantId ?? null,
    electricalModelId: modelIdentity.electricalModelId,
    electricalModelVersion: modelIdentity.electricalModelVersion,
    modelProfileId: modelIdentity.modelProfileId,
    modelProfileVersion: modelIdentity.modelProfileVersion,
    kind: component.kind,
    value: finiteNumber(component.value, `${component.id}.value`),
    state: component.state ?? null,
    wiperPosition:
      component.wiperPosition === undefined
        ? null
        : finiteNumber(component.wiperPosition, `${component.id}.wiperPosition`),
    stateProperties: canonicalStateProperties(component),
    terminalIds: [...(component.pinIds ?? [])].sort(ordinalCompare),
    holeBindings,
    internalConnections,
  };
}

function canonicalize(value: CanonicalValue): CanonicalValue {
  if (typeof value === 'number') return finiteNumber(value, 'canonical payload');
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => ordinalCompare(left, right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

export function canonicalSimulationInput(
  document: ElectronicsDocument,
  simulationTimeMs = 0,
): string {
  const connections = [...document.connections]
    .sort((left, right) => ordinalCompare(left.id, right.id))
    .map((connection) => ({
      connectionId: connection.id,
      from: {
        componentInstanceId: connection.from.componentId,
        terminalId: connection.from.terminal,
      },
      to: {
        componentInstanceId: connection.to.componentId,
        terminalId: connection.to.terminal,
      },
    }));
  const payload: CanonicalObject = {
    digestVersion: SIMULATION_INPUT_DIGEST_VERSION,
    documentSchemaVersion: document.schemaVersion,
    analysis: {
      electricalMode: simulationTimeMs > 0 ? 'transient' : 'dc',
      controllerRuntime: document.components.some((component) =>
        String(component.componentTypeId ?? component.variantId ?? '').includes('arduino'),
      )
        ? 'arduino'
        : 'none',
      simulationTimeMs: finiteNumber(simulationTimeMs, 'simulationTimeMs'),
      maxIterations: finiteNumber(document.simulation.maxIterations, 'simulation.maxIterations'),
    },
    components: [...document.components]
      .filter((component) => component.kind !== 'wire')
      .sort((left, right) => ordinalCompare(left.id, right.id))
      .map(canonicalComponent),
    connections,
  };
  return JSON.stringify(canonicalize(payload));
}

// Browser-safe SHA-256. The same implementation is bundled into the API and
// web packages, so no platform-specific crypto serializer can change the digest.
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  view.setUint32(paddedLength - 8, high, false);
  view.setUint32(paddedLength - 4, low, false);

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const rotateRight = (value: number, bits: number): number =>
    (value >>> bits) | (value << (32 - bits));
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotateRight(words[index - 15] as number, 7) ^
        rotateRight(words[index - 15] as number, 18) ^
        ((words[index - 15] as number) >>> 3);
      const s1 =
        rotateRight(words[index - 2] as number, 17) ^
        rotateRight(words[index - 2] as number, 19) ^
        ((words[index - 2] as number) >>> 10);
      words[index] = ((words[index - 16] as number) + s0 + (words[index - 7] as number) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let index = 0; index < 64; index += 1) {
      const sum1 =
        rotateRight(e as number, 6) ^ rotateRight(e as number, 11) ^ rotateRight(e as number, 25);
      const choice = ((e as number) & (f as number)) ^ (~(e as number) & (g as number));
      const temp1 =
        ((hh as number) + sum1 + choice + (k[index] as number) + (words[index] as number)) >>> 0;
      const sum0 =
        rotateRight(a as number, 2) ^ rotateRight(a as number, 13) ^ rotateRight(a as number, 22);
      const majority =
        ((a as number) & (b as number)) ^
        ((a as number) & (c as number)) ^
        ((b as number) & (c as number));
      const temp2 = (sum0 + majority) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = ((d as number) + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = ((h[0] as number) + (a as number)) >>> 0;
    h[1] = ((h[1] as number) + (b as number)) >>> 0;
    h[2] = ((h[2] as number) + (c as number)) >>> 0;
    h[3] = ((h[3] as number) + (d as number)) >>> 0;
    h[4] = ((h[4] as number) + (e as number)) >>> 0;
    h[5] = ((h[5] as number) + (f as number)) >>> 0;
    h[6] = ((h[6] as number) + (g as number)) >>> 0;
    h[7] = ((h[7] as number) + (hh as number)) >>> 0;
  }
  return h.map((value) => value.toString(16).padStart(8, '0')).join('');
}

export function simulationInputDigest(document: ElectronicsDocument, simulationTimeMs = 0): string {
  return sha256Hex(canonicalSimulationInput(document, simulationTimeMs));
}
