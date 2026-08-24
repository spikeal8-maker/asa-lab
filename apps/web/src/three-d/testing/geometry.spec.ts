import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createThreeDNode, PRIMITIVE_KINDS, THREE_D_SHAPE_COLORS } from '@asa-lab/three-d';
import {
  MODEL_EDGE_NAME,
  createCadSurfaceColor,
  createNodeObject,
  createPrimitiveGeometry,
  createPrimitiveGeometryForKind,
  disposeObject,
  measureTextWidthAtHeight,
} from '../viewport/geometry';
import { addCadSceneLights } from '../viewport/cad-appearance';
import { createBooleanGeometry, createBooleanMesh } from '../viewport/csg';

describe('ASA 3D primitive geometry', () => {
  it('keeps exact millimetre dimensions in the mesh transform', () => {
    const node = {
      ...createThreeDNode('box', 'box-1'),
      dimensions: { width: 31.5, depth: 18, height: 7.25 },
    };
    const object = createNodeObject(node);
    const mesh = object.children[0];
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh?.scale.toArray()).toEqual([31.5, 7.25, 18]);
    disposeObject(object);
  });

  it('adds readable hard edges without a face-covering silhouette or changing geometry', () => {
    const object = createNodeObject(createThreeDNode('box', 'outlined-box'));
    const mesh = object.children[0] as THREE.Mesh;
    const hardEdges = mesh.getObjectByName(MODEL_EDGE_NAME);

    expect(hardEdges).toBeInstanceOf(THREE.LineSegments);
    expect(hardEdges?.userData['modelOutline']).toBe(true);
    expect(mesh.children).toHaveLength(1);
    expect(mesh.geometry.getAttribute('position').count).toBe(24);
    disposeObject(object);
  });

  it('renders a hole as a translucent non-depth-writing shape', () => {
    const node = { ...createThreeDNode('cylinder', 'hole-1'), operation: 'hole' as const };
    const object = createNodeObject(node);
    const mesh = object.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.depthWrite).toBe(false);
    disposeObject(object);
  });

  it('uses calibrated CAD surface tint without cast shadows', () => {
    const object = createNodeObject(createThreeDNode('box', 'bright-box'));
    const mesh = object.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

    expect(mesh.material.color.getHexString()).toBe(
      createCadSurfaceColor('#d71920').getHexString(),
    );
    expect(mesh.material.emissive.getHexString()).toBe('000000');
    expect(mesh.material.emissiveIntensity).toBe(0);
    expect(mesh.material.roughness).toBe(0.9);
    expect(mesh.material.toneMapped).toBe(false);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    expect(mesh.children).toHaveLength(1);
    expect(mesh.children[0]?.name).toBe(MODEL_EDGE_NAME);
    disposeObject(object);
  });

  it('uses the canonical palette and calibrated material for every catalog primitive', () => {
    for (const primitive of PRIMITIVE_KINDS) {
      const node = createThreeDNode(primitive, `material-${primitive}`);
      const object = createNodeObject(node);
      const mesh = object.children[0] as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshStandardMaterial
      >;

      expect(node.color, primitive).toBe(THREE_D_SHAPE_COLORS[primitive]);
      expect(mesh.material.color.getHexString(), primitive).toBe(
        createCadSurfaceColor(THREE_D_SHAPE_COLORS[primitive]).getHexString(),
      );
      expect(mesh.material.emissive.getHexString(), primitive).toBe('000000');
      expect(mesh.material.toneMapped, primitive).toBe(false);
      expect(mesh.castShadow, primitive).toBe(false);
      expect(mesh.receiveShadow, primitive).toBe(false);
      disposeObject(object);
    }
  });

  it('keeps every scene light neutral enough to preserve non-red shape hues', () => {
    const scene = new THREE.Scene();
    addCadSceneLights(scene);

    const lights = scene.children.filter(
      (child): child is THREE.Light => child instanceof THREE.Light,
    );
    expect(lights).toHaveLength(5);
    for (const light of lights) {
      const channels = light.color.toArray();
      expect(Math.max(...channels) - Math.min(...channels), light.type).toBeLessThan(0.08);
    }
  });

  it('uses the same calibrated material for boolean results', () => {
    const box = createThreeDNode('box', 'boolean-box');
    const cylinder = createThreeDNode('cylinder', 'boolean-cylinder');
    const mesh = createBooleanMesh([box, cylinder], 'union');

    expect(mesh).not.toBeNull();
    const material = mesh?.material as THREE.MeshStandardMaterial;
    expect(material.color.getHexString()).toBe(createCadSurfaceColor(box.color).getHexString());
    expect(material.emissive.getHexString()).toBe('000000');
    expect(mesh?.castShadow).toBe(false);
    expect(mesh?.receiveShadow).toBe(false);
    mesh?.geometry.dispose();
    material.dispose();
  });

  it('builds editable Latin and Cyrillic text from real glyph contours', () => {
    const text = createThreeDNode('text', 'real-text');
    const latin = createPrimitiveGeometry({
      ...text,
      parameters: { ...text.parameters, text: 'ASA Lab' },
    });
    const cyrillic = createPrimitiveGeometry({
      ...text,
      parameters: { ...text.parameters, text: 'Привет, мир!' },
    });
    const positions = cyrillic.getAttribute('position');
    const fractionalCoordinates = Array.from(positions.array).filter(
      (value) => Math.abs(value - Math.round(value)) > 0.001,
    );

    expect(latin.getAttribute('position').count).toBeGreaterThan(100);
    expect(cyrillic.getAttribute('position').count).toBeGreaterThan(300);
    expect(fractionalCoordinates.length).toBeGreaterThan(100);
    expect(measureTextWidthAtHeight('Привет')).toBeGreaterThan(measureTextWidthAtHeight('Я'));
    latin.dispose();
    cyrillic.dispose();
  });

  it('uses the saved radius and steps for a rounded parallelepiped', () => {
    const node = { ...createThreeDNode('box', 'rounded-box'), bevel: 3, sides: 8 };
    const geometry = createPrimitiveGeometry(node);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox?.getSize(new THREE.Vector3());
    expect(geometry.getAttribute('position').count).toBeGreaterThan(36);
    expect(size?.x).toBeCloseTo(1, 5);
    expect(size?.y).toBeCloseTo(1, 5);
    expect(size?.z).toBeCloseTo(1, 5);
    geometry.dispose();
  });

  it('normalises every catalog primitive to exact width, height and depth', () => {
    for (const primitive of PRIMITIVE_KINDS) {
      const geometry = createPrimitiveGeometryForKind(primitive, 48);
      geometry.computeBoundingBox();
      const size = geometry.boundingBox?.getSize(new THREE.Vector3());
      expect(size, primitive).toBeDefined();
      expect(size?.x, primitive).toBeCloseTo(1, 5);
      expect(size?.y, primitive).toBeCloseTo(1, 5);
      expect(size?.z, primitive).toBeCloseTo(1, 5);
      geometry.dispose();
    }
  });

  it('builds a reversible frustum from independent cone radii', () => {
    const cone = {
      ...createThreeDNode('cone', 'frustum'),
      parameters: {
        ...createThreeDNode('cone', 'frustum').parameters,
        topRadius: 10,
        baseRadius: 4,
      },
    };
    const geometry = createPrimitiveGeometry(cone);
    const positions = geometry.getAttribute('position');
    let topRadius = 0;
    let baseRadius = 0;
    for (let index = 0; index < positions.count; index += 1) {
      const radius = Math.hypot(positions.getX(index), positions.getZ(index));
      if (positions.getY(index) > 0.49) topRadius = Math.max(topRadius, radius);
      if (positions.getY(index) < -0.49) baseRadius = Math.max(baseRadius, radius);
    }
    expect(topRadius).toBeCloseTo(0.5, 2);
    expect(baseRadius).toBeCloseTo(0.2, 2);
    geometry.dispose();
  });

  it('builds real beveled cylinder geometry from inspector parameters', () => {
    const node = createThreeDNode('cylinder', 'cylinder-bevel');
    const plainGeometry = createPrimitiveGeometry(node);
    const beveledGeometry = createPrimitiveGeometry({
      ...node,
      bevel: 2.5,
      parameters: { ...node.parameters, bevelSegments: 6 },
    });

    expect(beveledGeometry.getAttribute('position').count).toBeGreaterThan(
      plainGeometry.getAttribute('position').count,
    );
    for (const value of beveledGeometry.getAttribute('position').array) {
      expect(Number.isFinite(value)).toBe(true);
    }
    plainGeometry.dispose();
    beveledGeometry.dispose();
  });

  it('uses the saved Tinkercad step counts for sphere and torus geometry', () => {
    const sphere = createThreeDNode('sphere', 'sphere-steps');
    const coarseSphere = createPrimitiveGeometry({
      ...sphere,
      parameters: { ...sphere.parameters, steps: 6 },
    });
    const smoothSphere = createPrimitiveGeometry({
      ...sphere,
      parameters: { ...sphere.parameters, steps: 48 },
    });
    const torus = createThreeDNode('torus', 'torus-steps');
    const coarseTorus = createPrimitiveGeometry({
      ...torus,
      sides: 6,
      parameters: { ...torus.parameters, steps: 8 },
    });
    const smoothTorus = createPrimitiveGeometry({
      ...torus,
      sides: 32,
      parameters: { ...torus.parameters, steps: 64 },
    });

    expect(smoothSphere.getAttribute('position').count).toBeGreaterThan(
      coarseSphere.getAttribute('position').count,
    );
    expect(smoothTorus.getAttribute('position').count).toBeGreaterThan(
      coarseTorus.getAttribute('position').count,
    );
    coarseSphere.dispose();
    smoothSphere.dispose();
    coarseTorus.dispose();
    smoothTorus.dispose();
  });

  it('rebuilds tube, polygon and star meshes from their individual parameters', () => {
    const tube = createThreeDNode('tube', 'tube-parameters');
    const tubeGeometry = createPrimitiveGeometry({
      ...tube,
      bevel: 2,
      parameters: { ...tube.parameters, wallThickness: 5, bevelSegments: 6 },
    });
    const polygon = createThreeDNode('polygon', 'polygon-parameters');
    const beveledPolygon = createPrimitiveGeometry({
      ...polygon,
      bevel: 1.5,
      parameters: { ...polygon.parameters, bevelSegments: 5 },
    });
    const star = createThreeDNode('star', 'star-parameters');
    const fivePointStar = createPrimitiveGeometry(star);
    const twelvePointStar = createPrimitiveGeometry({
      ...star,
      parameters: { ...star.parameters, points: 12, innerRatio: 0.25 },
    });

    expect(tubeGeometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(beveledPolygon.getAttribute('position').count).toBeGreaterThan(0);
    expect(twelvePointStar.getAttribute('position').count).toBeGreaterThan(
      fivePointStar.getAttribute('position').count,
    );
    tubeGeometry.dispose();
    beveledPolygon.dispose();
    fivePointStar.dispose();
    twelvePointStar.dispose();
  });

  it('turns saved sketch points and twist into printable geometry', () => {
    const extrude = createThreeDNode('extrude-sketch', 'extrude-sketch');
    const plain = createPrimitiveGeometry(extrude);
    const twisted = createPrimitiveGeometry({
      ...extrude,
      parameters: {
        ...extrude.parameters,
        twist: 180,
        twistSteps: 12,
        topScale: 0.5,
        sketchPoints: [
          { x: -1, y: -1 },
          { x: 1, y: -1 },
          { x: 0.7, y: 0.2 },
          { x: 0, y: 1 },
          { x: -0.7, y: 0.2 },
        ],
      },
    });
    const revolve = createThreeDNode('revolve-sketch', 'revolve-sketch');
    const revolved = createPrimitiveGeometry(revolve);

    expect(twisted.getAttribute('position').count).toBeGreaterThan(
      plain.getAttribute('position').count,
    );
    expect(revolved.getAttribute('position').count).toBeGreaterThan(0);
    for (const geometry of [plain, twisted, revolved]) {
      for (const value of geometry.getAttribute('position').array) {
        expect(Number.isFinite(value)).toBe(true);
      }
      geometry.dispose();
    }
  });

  it('subtracts a hole from a solid into printable boolean geometry', () => {
    const solid = createThreeDNode('box', 'solid');
    const hole = {
      ...createThreeDNode('cylinder', 'hole'),
      operation: 'hole' as const,
      dimensions: { width: 8, depth: 8, height: 30 },
    };
    const geometry = createBooleanGeometry([solid, hole], 'difference');
    expect(geometry).not.toBeNull();
    expect(geometry?.getAttribute('position').count).toBeGreaterThan(36);
    geometry?.dispose();
  });

  it('switches boolean modes without losing the saved solid and hole roles', () => {
    const solid = createThreeDNode('box', 'solid');
    const hole = {
      ...createThreeDNode('cylinder', 'hole'),
      operation: 'hole' as const,
      dimensions: { width: 8, depth: 8, height: 30 },
    };
    const nodes = [solid, hole] as const;
    const differenceBefore = createBooleanGeometry(nodes, 'difference');
    const intersection = createBooleanGeometry(nodes, 'intersection');
    const differenceAfter = createBooleanGeometry(nodes, 'difference');

    expect(differenceBefore?.getAttribute('position').count).toBeGreaterThan(36);
    expect(intersection?.getAttribute('position').count).toBeGreaterThan(0);
    expect(differenceAfter?.getAttribute('position').count).toBe(
      differenceBefore?.getAttribute('position').count,
    );
    expect(nodes.map((node) => node.operation)).toEqual(['solid', 'hole']);

    differenceBefore?.dispose();
    intersection?.dispose();
    differenceAfter?.dispose();
  });
});
