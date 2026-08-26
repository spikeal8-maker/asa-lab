import {
  createEmptyThreeDDocument,
  createThreeDNode,
  type PrimitiveKind,
  type ThreeDDocument,
  type ThreeDDimensions,
  type ThreeDNode,
  type Vector3Value,
} from '../../domain/document.js';
import type { ThreeDGeometryCase } from './expectations.js';

type NodeOptions = {
  readonly position?: Vector3Value;
  readonly rotation?: Vector3Value;
  readonly scale?: Vector3Value;
  readonly dimensions?: ThreeDDimensions;
  readonly operation?: 'solid' | 'hole';
};

function node(primitive: PrimitiveKind, id: string, options: NodeOptions = {}): ThreeDNode {
  const source = createThreeDNode(primitive, id);
  return {
    ...source,
    operation: options.operation ?? source.operation,
    dimensions: options.dimensions ?? source.dimensions,
    transform: {
      position: options.position ?? source.transform.position,
      rotation: options.rotation ?? source.transform.rotation,
      scale: options.scale ?? source.transform.scale,
    },
  };
}

function document(nodes: readonly ThreeDNode[]): ThreeDDocument {
  return { ...createEmptyThreeDDocument(), nodes };
}

function linearBoxes(count: number, spacing: number, overlap = 0): readonly ThreeDNode[] {
  return Array.from({ length: count }, (_, index) =>
    node('box', `linear-${count}-${index}`, {
      position: { x: index * (spacing - overlap), y: 5, z: 0 },
      dimensions: { width: spacing, depth: 10, height: 10 },
    }),
  );
}

function gridBoxes(count: number): readonly ThreeDNode[] {
  const columns = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, index) =>
    node('box', `grid-${count}-${index}`, {
      position: {
        x: (index % columns) * 6,
        y: 2.5,
        z: Math.floor(index / columns) * 6,
      },
      dimensions: { width: 5, depth: 5, height: 5 },
    }),
  );
}

const printable = { kind: 'valid-solid', toleranceProfile: 'printable-v1' } as const;
const legacy = (issue: string) => ({ kind: 'known-legacy-failure', issue }) as const;

export const THREE_D_GEOMETRY_CORPUS: readonly ThreeDGeometryCase[] = [
  {
    id: 'union-identical-boxes',
    problemIds: ['3D-CORE-004'],
    tags: ['union', 'coincident', 'box'],
    tier: 'correctness',
    document: document([node('box', 'identical-a'), node('box', 'identical-b')]),
    operation: 'union',
    expectation: printable,
  },
  {
    id: 'union-coplanar-overlap',
    problemIds: ['3D-CORE-003', '3D-CORE-004'],
    tags: ['union', 'coplanar', 'box'],
    tier: 'correctness',
    document: document([
      node('box', 'coplanar-a'),
      node('box', 'coplanar-b', { position: { x: 8, y: 10, z: 0 } }),
    ]),
    operation: 'union',
    expectation: legacy('coplanar overlap currently produces open or non-manifold edges'),
  },
  {
    id: 'union-edge-touch',
    problemIds: ['3D-CORE-004'],
    tags: ['union', 'touching-edge', 'non-manifold-risk'],
    tier: 'correctness',
    document: document([
      node('box', 'edge-a'),
      node('box', 'edge-b', { position: { x: 20, y: 10, z: 20 } }),
    ]),
    operation: 'union',
    expectation: legacy('touching solids require an explicit manifold policy'),
  },
  {
    id: 'union-point-touch',
    problemIds: ['3D-CORE-004'],
    tags: ['union', 'touching-point', 'non-manifold-risk'],
    tier: 'correctness',
    document: document([
      node('box', 'point-a'),
      node('box', 'point-b', { position: { x: 20, y: 30, z: 20 } }),
    ]),
    operation: 'union',
    expectation: legacy('point-touch topology is not validated by the legacy BSP'),
  },
  {
    id: 'union-box-cylinder-junction',
    problemIds: ['3D-CORE-003', '3D-CORE-004', '3D-CORE-005'],
    tags: ['union', 'curved', 'internal-junction'],
    tier: 'interaction',
    document: document([
      node('box', 'junction-box'),
      node('cylinder', 'junction-cylinder', { position: { x: 8, y: 10, z: 0 } }),
    ]),
    operation: 'union',
    expectation: legacy('curved junction topology needs corpus evidence'),
  },
  {
    id: 'difference-spherical-cavity',
    problemIds: ['3D-CORE-003', '3D-CORE-004', '3D-CORE-005'],
    tags: ['difference', 'sphere', 'cavity'],
    tier: 'interaction',
    document: document([
      node('box', 'sphere-cut-box', { dimensions: { width: 30, depth: 30, height: 30 } }),
      node('sphere', 'sphere-cut-hole', {
        operation: 'hole',
        position: { x: 0, y: 15, z: 11 },
        dimensions: { width: 18, depth: 18, height: 18 },
      }),
    ]),
    operation: 'difference',
    expectation: legacy('spherical cavity must be proven closed and consistently oriented'),
  },
  {
    id: 'difference-nested-holes',
    problemIds: ['3D-CORE-004'],
    tags: ['difference', 'nested-holes'],
    tier: 'correctness',
    document: document([
      node('box', 'nested-solid', { dimensions: { width: 40, depth: 40, height: 30 } }),
      node('cylinder', 'nested-hole-a', {
        operation: 'hole',
        position: { x: -7, y: 15, z: 0 },
        dimensions: { width: 14, depth: 14, height: 40 },
      }),
      node('cylinder', 'nested-hole-b', {
        operation: 'hole',
        position: { x: 7, y: 15, z: 0 },
        dimensions: { width: 14, depth: 14, height: 40 },
      }),
    ]),
    operation: 'difference',
    expectation: legacy('multiple subtractors have no topology validation in the legacy BSP'),
  },
  {
    id: 'difference-thin-wall',
    problemIds: ['3D-CORE-004'],
    tags: ['difference', 'thin-wall', 'epsilon'],
    tier: 'correctness',
    document: document([
      node('box', 'thin-outer', { dimensions: { width: 20, depth: 20, height: 20 } }),
      node('box', 'thin-inner', {
        operation: 'hole',
        position: { x: 0, y: 10.0005, z: 0 },
        dimensions: { width: 19.999, depth: 19.999, height: 19.999 },
      }),
    ]),
    operation: 'difference',
    expectation: legacy('thin walls near BSP epsilon need a defined rejection threshold'),
  },
  {
    id: 'union-rotated-nonuniform',
    problemIds: ['3D-CORE-004'],
    tags: ['union', 'rotation', 'nonuniform-scale'],
    tier: 'correctness',
    document: document([
      node('box', 'scaled-box', {
        rotation: { x: 12, y: 31, z: 7 },
        scale: { x: 1.8, y: 0.6, z: 1.2 },
      }),
      node('cylinder', 'scaled-cylinder', {
        position: { x: 5, y: 10, z: 2 },
        rotation: { x: 90, y: 0, z: 18 },
        scale: { x: 0.8, y: 1.4, z: 1.1 },
      }),
    ]),
    operation: 'union',
    expectation: legacy('transformed curved operands need normalized topology evidence'),
  },
  {
    id: 'union-mirrored-operands',
    problemIds: ['3D-CORE-004'],
    tags: ['union', 'negative-scale', 'orientation'],
    tier: 'correctness',
    document: document([
      node('wedge', 'mirror-a', { position: { x: -4, y: 10, z: 0 } }),
      node('wedge', 'mirror-b', {
        position: { x: 4, y: 10, z: 0 },
        scale: { x: -1, y: 1, z: 1 },
      }),
    ]),
    operation: 'union',
    expectation: legacy('negative determinant transforms need winding validation'),
  },
  {
    id: 'union-roof-wedge',
    problemIds: ['3D-CORE-004', '3D-PARITY-001'],
    tags: ['union', 'roof', 'wedge', 'faceted'],
    tier: 'interaction',
    document: document([
      node('roof', 'roof-part', { position: { x: -4, y: 6, z: 0 } }),
      node('wedge', 'wedge-part', { position: { x: 6, y: 10, z: 0 } }),
    ]),
    operation: 'union',
    expectation: legacy('faceted shape union needs a closed-mesh baseline'),
  },
  {
    id: 'union-text-curved-text',
    problemIds: ['3D-CORE-004', '3D-PARITY-001'],
    tags: ['union', 'text', 'cyrillic', 'curved-text'],
    tier: 'interaction',
    document: document([
      {
        ...node('text', 'text-flat', { position: { x: -10, y: 2, z: 0 } }),
        parameters: {
          ...createThreeDNode('text', 'text-flat-parameters').parameters,
          text: 'ASA Лаб',
        },
      },
      {
        ...node('text', 'text-curved', { position: { x: 10, y: 2, z: 0 } }),
        parameters: {
          ...createThreeDNode('text', 'text-curved-parameters').parameters,
          text: '3D',
          curveAngle: 90,
        },
      },
    ]),
    operation: 'union',
    expectation: legacy('text boolean output needs font and topology evidence'),
  },
  {
    id: 'union-10-overlapping-boxes',
    problemIds: ['3D-CORE-001', '3D-CORE-002'],
    tags: ['union', 'chain-10', 'overlap'],
    tier: 'interaction',
    document: document(linearBoxes(10, 10, 2)),
    operation: 'union',
    expectation: legacy('interaction baseline; performance budget is not yet approved'),
  },
  {
    id: 'union-100-grid-boxes',
    problemIds: ['3D-CORE-001', '3D-CORE-002', '3D-DATA-001'],
    tags: ['union', '100-objects', 'stress'],
    tier: 'stress',
    document: document(gridBoxes(100)),
    operation: 'union',
    expectation: legacy('stress baseline; performance budget is not yet approved'),
  },
  {
    id: 'union-500-grid-boxes',
    problemIds: ['3D-CORE-001', '3D-CORE-002', '3D-DATA-001'],
    tags: ['union', '500-objects', 'stress'],
    tier: 'stress',
    document: document(gridBoxes(500)),
    operation: 'union',
    expectation: legacy('stress baseline; performance budget is not yet approved'),
  },
  {
    id: 'union-chain-20',
    problemIds: ['3D-CORE-001', '3D-CORE-002'],
    tags: ['union', 'chain-20', 'stress'],
    tier: 'stress',
    document: document(linearBoxes(20, 10, 1)),
    operation: 'union',
    expectation: legacy('operation-chain baseline; budget is not yet approved'),
  },
  {
    id: 'union-chain-50',
    problemIds: ['3D-CORE-001', '3D-CORE-002'],
    tags: ['union', 'chain-50', 'stress'],
    tier: 'stress',
    document: document(linearBoxes(50, 10, 1)),
    operation: 'union',
    expectation: legacy('operation-chain baseline; budget is not yet approved'),
  },
] as const;
