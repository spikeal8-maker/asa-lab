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

    const cameraFill = lights.find(
      (light): light is THREE.DirectionalLight =>
        light instanceof THREE.DirectionalLight && light.intensity === 0.46,
    );
    expect(cameraFill?.position.toArray()).toEqual([-70, 70, 190]);
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

  it('keeps hard-edge lines visible at surface junctions without revealing hidden edges', () => {
    const box = createThreeDNode('box', 'biased-outline-box');
    const mesh = createBooleanMesh([box], 'union');
    const outline = mesh?.getObjectByName(MODEL_EDGE_NAME) as THREE.LineSegments | undefined;
    const material = outline?.material as THREE.LineBasicMaterial | undefined;

    expect(material?.depthTest).toBe(true);
    expect(material?.depthWrite).toBe(false);
    expect(material?.opacity).toBeGreaterThanOrEqual(0.8);
    expect(material?.customProgramCacheKey()).toBe('asa-model-outline-depth-bias-v1');

    const shader = { vertexShader: '#include <project_vertex>' };
    material?.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as never);
    expect(shader.vertexShader).toContain('gl_Position.z -= 0.00035 * gl_Position.w');
    if (mesh) disposeObject(mesh);
  });

  it('outlines only the hard boundary of a coplanar box union', () => {
    const first = createThreeDNode('box', 'edge-box-first');
    const secondSource = createThreeDNode('box', 'edge-box-second');
    const second = {
      ...secondSource,
      transform: {
        ...secondSource.transform,
        position: { ...secondSource.transform.position, x: 8 },
      },
    };
    const mesh = createBooleanMesh([first, second], 'union');
    const outline = mesh?.getObjectByName(MODEL_EDGE_NAME) as THREE.LineSegments | undefined;
    const position = outline?.geometry.getAttribute('position');

    expect(outline).toBeInstanceOf(THREE.LineSegments);
    expect(position?.count).toBe(24);
    for (let offset = 0; position && offset + 1 < position.count; offset += 2) {
      const start = new THREE.Vector3().fromBufferAttribute(position, offset);
      const end = new THREE.Vector3().fromBufferAttribute(position, offset + 1);
      const delta = end.sub(start);
      const changedAxes = [delta.x, delta.y, delta.z].filter(
        (component) => Math.abs(component) > 1e-4,
      );
      expect(changedAxes).toHaveLength(1);
    }
    if (mesh) disposeObject(mesh);
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

  it('bends multilingual text in both directions without changing its solid contract', () => {
    const text = createThreeDNode('text', 'curved-text');
    const flat = createPrimitiveGeometry({
      ...text,
      parameters: { ...text.parameters, text: 'ASA Лаб', curveAngle: 0 },
    });
    const outward = createPrimitiveGeometry({
      ...text,
      parameters: { ...text.parameters, text: 'ASA Лаб', curveAngle: 120 },
    });
    const inward = createPrimitiveGeometry({
      ...text,
      parameters: { ...text.parameters, text: 'ASA Лаб', curveAngle: -120 },
    });
    const flatPositions = Array.from(flat.getAttribute('position').array);
    const outwardPositions = Array.from(outward.getAttribute('position').array);
    const inwardPositions = Array.from(inward.getAttribute('position').array);

    expect(outwardPositions).not.toEqual(flatPositions);
    expect(inwardPositions).not.toEqual(flatPositions);
    expect(outwardPositions).not.toEqual(inwardPositions);
    expect(outward.getAttribute('normal').count).toBe(outward.getAttribute('position').count);
    flat.dispose();
    outward.dispose();
    inward.dispose();
  });

  it.each(['roof', 'wedge'] as const)('keeps every %s face flat-shaded', (primitive) => {
    const geometry = createPrimitiveGeometry(createThreeDNode(primitive, `${primitive}-flat`));
    expect(geometry.getIndex()).toBeNull();
    const normals = geometry.getAttribute('normal');
    for (let offset = 0; offset < normals.count; offset += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(normals, offset);
      const b = new THREE.Vector3().fromBufferAttribute(normals, offset + 1);
      const c = new THREE.Vector3().fromBufferAttribute(normals, offset + 2);
      expect(a.distanceTo(b)).toBeLessThan(0.000001);
      expect(a.distanceTo(c)).toBeLessThan(0.000001);
    }
    geometry.dispose();
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

  it('rebuilds the pyramid and ring when their Tinkercad side controls change', () => {
    const pyramid = createThreeDNode('pyramid', 'pyramid-sides');
    const trianglePyramid = createPrimitiveGeometry({ ...pyramid, sides: 3 });
    const octagonalPyramid = createPrimitiveGeometry({ ...pyramid, sides: 8 });
    const ring = createThreeDNode('ring', 'ring-sides');
    const coarseRing = createPrimitiveGeometry({ ...ring, sides: 8 });
    const smoothRing = createPrimitiveGeometry({ ...ring, sides: 64 });

    expect(octagonalPyramid.getAttribute('position').count).toBeGreaterThan(
      trianglePyramid.getAttribute('position').count,
    );
    expect(smoothRing.getAttribute('position').count).toBeGreaterThan(
      coarseRing.getAttribute('position').count,
    );
    trianglePyramid.dispose();
    octagonalPyramid.dispose();
    coarseRing.dispose();
    smoothRing.dispose();
  });

  it('rebuilds tube, polygon and the extruded star from their individual parameters', () => {
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
    const star = createThreeDNode('star-6', 'star-parameters');
    const sixPointStar = createPrimitiveGeometry(star);
    const twelvePointStar = createPrimitiveGeometry({
      ...star,
      parameters: { ...star.parameters, points: 12, innerRatio: 0.25 },
    });

    expect(tubeGeometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(beveledPolygon.getAttribute('position').count).toBeGreaterThan(0);
    expect(twelvePointStar.getAttribute('position').count).toBeGreaterThan(
      sixPointStar.getAttribute('position').count,
    );
    tubeGeometry.dispose();
    beveledPolygon.dispose();
    sixPointStar.dispose();
    twelvePointStar.dispose();
  });

  it('keeps the two Tinkercad stars as distinct printable solids', () => {
    const pointed = createPrimitiveGeometry(createThreeDNode('star', 'pointed-star'));
    const extruded = createPrimitiveGeometry(createThreeDNode('star-6', 'extruded-star'));
    pointed.computeBoundingBox();
    extruded.computeBoundingBox();

    expect(pointed.getAttribute('position').count).toBe(60);
    expect(extruded.getAttribute('position').count).toBeGreaterThan(
      pointed.getAttribute('position').count,
    );
    expect(pointed.boundingBox?.max.y).toBeCloseTo(0.5, 5);
    expect(extruded.boundingBox?.max.y).toBeCloseTo(0.5, 5);
    pointed.dispose();
    extruded.dispose();
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

  it('preserves curved source normals through boolean grouping', () => {
    const sphere = createThreeDNode('sphere', 'smooth-sphere');
    const box = {
      ...createThreeDNode('box', 'separate-box'),
      transform: {
        ...createThreeDNode('box', 'separate-box-transform').transform,
        position: { x: 40, y: 10, z: 0 },
      },
    };
    const geometry = createBooleanGeometry([sphere, box], 'union');
    const positions = geometry?.getAttribute('position');
    const normals = geometry?.getAttribute('normal');
    let hasInterpolatedCurvedNormal = false;

    if (positions && normals) {
      for (let offset = 0; offset + 2 < positions.count; offset += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(positions, offset);
        const b = new THREE.Vector3().fromBufferAttribute(positions, offset + 1);
        const c = new THREE.Vector3().fromBufferAttribute(positions, offset + 2);
        const faceNormal = b.sub(a).cross(c.sub(a)).normalize();
        for (let index = 0; index < 3; index += 1) {
          const vertexNormal = new THREE.Vector3().fromBufferAttribute(normals, offset + index);
          if (Math.abs(faceNormal.dot(vertexNormal)) < 0.999) {
            hasInterpolatedCurvedNormal = true;
            break;
          }
        }
        if (hasInterpolatedCurvedNormal) break;
      }
    }

    expect(geometry).not.toBeNull();
    expect(hasInterpolatedCurvedNormal).toBe(true);
    geometry?.dispose();
  });

  it('does not emit zero-area needles for overlapping unions and spherical holes', () => {
    const box = createThreeDNode('box', 'clean-box');
    const cylinder = {
      ...createThreeDNode('cylinder', 'clean-cylinder'),
      transform: {
        ...createThreeDNode('cylinder', 'clean-cylinder-transform').transform,
        position: { x: 8, y: 10, z: 0 },
      },
    };
    const sphereHole = {
      ...createThreeDNode('sphere', 'clean-sphere-hole'),
      operation: 'hole' as const,
      dimensions: { width: 12, depth: 12, height: 12 },
    };
    const union = createBooleanGeometry([box, cylinder], 'union');
    const difference = createBooleanGeometry([box, sphereHole], 'difference');

    for (const geometry of [union, difference]) {
      expect(geometry).not.toBeNull();
      const position = geometry?.getAttribute('position');
      const normal = geometry?.getAttribute('normal');
      expect(position?.count).toBeGreaterThan(0);
      for (const value of [...(position?.array ?? []), ...(normal?.array ?? [])]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      for (let offset = 0; position && offset + 2 < position.count; offset += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(position, offset);
        const b = new THREE.Vector3().fromBufferAttribute(position, offset + 1);
        const c = new THREE.Vector3().fromBufferAttribute(position, offset + 2);
        expect(b.sub(a).cross(c.sub(a)).lengthSq()).toBeGreaterThan(1e-10);
      }
      geometry?.dispose();
    }
  });

  it('keeps feature outlines finite and compact for house, curved union and hole workflows', () => {
    const wallSource = createThreeDNode('box', 'outlined-house-wall');
    const wall = {
      ...wallSource,
      dimensions: { width: 30, depth: 24, height: 20 },
      transform: { ...wallSource.transform, position: { x: -35, y: 10, z: 0 } },
    };
    const roofSource = createThreeDNode('roof', 'outlined-house-roof');
    const roof = {
      ...roofSource,
      dimensions: { width: 34, depth: 24, height: 14 },
      transform: { ...roofSource.transform, position: { x: -35, y: 26, z: 0 } },
    };
    const boxSource = createThreeDNode('box', 'outlined-curved-box');
    const box = {
      ...boxSource,
      transform: { ...boxSource.transform, position: { x: 20, y: 10, z: 0 } },
    };
    const cylinderSource = createThreeDNode('cylinder', 'outlined-curved-cylinder');
    const cylinder = {
      ...cylinderSource,
      transform: { ...cylinderSource.transform, position: { x: 28, y: 10, z: 0 } },
    };
    const hole = {
      ...createThreeDNode('sphere', 'outlined-sphere-hole'),
      operation: 'hole' as const,
      dimensions: { width: 12, depth: 12, height: 12 },
    };
    const scenarios = [
      createBooleanMesh([wall, roof], 'union'),
      createBooleanMesh([box, cylinder], 'union'),
      createBooleanMesh([boxSource, hole], 'difference'),
    ];

    for (const mesh of scenarios) {
      const outline = mesh?.getObjectByName(MODEL_EDGE_NAME) as THREE.LineSegments | undefined;
      const edges = outline?.geometry.getAttribute('position');
      const faces = mesh?.geometry.getAttribute('position');
      expect(outline).toBeInstanceOf(THREE.LineSegments);
      expect(edges?.count).toBeGreaterThan(0);
      expect(edges?.count).toBeLessThan(faces?.count ?? 0);
      for (let offset = 0; edges && offset + 1 < edges.count; offset += 2) {
        const start = new THREE.Vector3().fromBufferAttribute(edges, offset);
        const end = new THREE.Vector3().fromBufferAttribute(edges, offset + 1);
        expect(start.toArray().every(Number.isFinite)).toBe(true);
        expect(end.toArray().every(Number.isFinite)).toBe(true);
        expect(start.distanceToSquared(end)).toBeGreaterThan(1e-8);
      }
      if (mesh) disposeObject(mesh);
    }
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
