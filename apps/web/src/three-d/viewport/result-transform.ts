import * as THREE from 'three';
import type { ThreeDDimensions, ThreeDNode, ThreeDTransform } from '@asa-lab/three-d';

/** Transform from a primitive's normalized geometry into world space. */
export function dimensionMatrix(
  transform: ThreeDTransform,
  dimensions: ThreeDDimensions,
): THREE.Matrix4 {
  const { position, rotation, scale } = transform;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(position.x, position.y, position.z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(rotation.x),
        THREE.MathUtils.degToRad(rotation.y),
        THREE.MathUtils.degToRad(rotation.z),
      ),
    ),
    new THREE.Vector3(
      scale.x * dimensions.width,
      scale.y * dimensions.height,
      scale.z * dimensions.depth,
    ),
  );
}

/** Only reuse the preview when every operand underwent the SAME affine change. */
export function commonResultTransform(
  before: readonly ThreeDNode[],
  after: readonly ThreeDNode[],
): THREE.Matrix4 | null {
  if (!before.length || before.length !== after.length) return null;
  let common: THREE.Matrix4 | null = null;
  for (let index = 0; index < before.length; index += 1) {
    const previous = before[index]!;
    const next = after[index]!;
    // Dimensions affect normalized rounding for these primitives. Never call
    // a changed bevel/profile merely a scaled copy of the confirmed result.
    const shapeKey = (node: ThreeDNode): string =>
      JSON.stringify({
        ...node,
        transform: undefined,
        dimensions: undefined,
        roundingScale:
          node.bevel > 0 && ['box', 'cylinder', 'polygon'].includes(node.primitive)
            ? node.bevel /
              Math.min(node.dimensions.width, node.dimensions.height, node.dimensions.depth)
            : 0,
      });
    if (shapeKey(previous) !== shapeKey(next)) return null;
    const matrix = dimensionMatrix(next.transform, next.dimensions).multiply(
      dimensionMatrix(previous.transform, previous.dimensions).invert(),
    );
    if (!matrix.elements.every(Number.isFinite)) return null;
    if (
      common &&
      !matrix.elements.every((value, i) => Math.abs(value - common!.elements[i]!) <= 1e-7)
    )
      return null;
    common = matrix;
  }
  return common;
}

export function transformOperand(node: ThreeDNode, delta: THREE.Matrix4): ThreeDNode {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const size = new THREE.Vector3();
  delta
    .clone()
    .multiply(dimensionMatrix(node.transform, { width: 1, height: 1, depth: 1 }))
    .decompose(position, quaternion, size);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion);
  return {
    ...node,
    transform: {
      position: { x: position.x, y: position.y, z: position.z },
      rotation: {
        x: THREE.MathUtils.radToDeg(rotation.x),
        y: THREE.MathUtils.radToDeg(rotation.y),
        z: THREE.MathUtils.radToDeg(rotation.z),
      },
      // Keep the primitive profile and its bevel dimensions intact: resizing
      // a finished group scales its geometry, not the primitive's parameters.
      scale: { x: size.x, y: size.y, z: size.z },
    },
  };
}
