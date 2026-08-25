import * as THREE from 'three';

export const CAD_AMBIENT_TINT = new THREE.Color('#f5f7f8');
export const CAD_SURFACE_TINT_BLEND = 0.004;
export const CAD_THUMBNAIL_TINT_BLEND = 0.004;

const LEGACY_CANONICAL_COLOR_OVERRIDES: Readonly<Record<string, string>> = {
  '#d71920': '#e31c2b',
};

function canonicalCadColor(color: string): string {
  return LEGACY_CANONICAL_COLOR_OVERRIDES[color.toLowerCase()] ?? color;
}

export function createCadSurfaceColor(color: string): THREE.Color {
  return new THREE.Color(canonicalCadColor(color)).lerp(CAD_AMBIENT_TINT, CAD_SURFACE_TINT_BLEND);
}

export function createCadShadedColor(color: string | THREE.Color, intensity: number): THREE.Color {
  return new THREE.Color(color)
    .multiplyScalar(intensity)
    .lerp(CAD_AMBIENT_TINT, CAD_THUMBNAIL_TINT_BLEND);
}

export function createCadSolidMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: createCadSurfaceColor(color),
    emissive: '#000000',
    emissiveIntensity: 0,
    roughness: 0.9,
    metalness: 0,
    toneMapped: false,
  });
}

export function addCadSceneLights(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight('#ffffff', 0.25));
  scene.add(new THREE.HemisphereLight('#ffffff', '#b5bcc0', 1));

  const key = new THREE.DirectionalLight('#ffffff', 1.62);
  key.position.set(110, 240, -60);
  key.castShadow = false;
  scene.add(key);

  const overhead = new THREE.DirectionalLight('#ffffff', 0.14);
  overhead.position.set(0, 260, 0);
  scene.add(overhead);

  // A camera-side fill separates vertical and concave faces without washing
  // out the already-correct bright top faces. The previous 0.08 fill left the
  // dominant front red near #8a1119; the reference is around #b51723.
  const fill = new THREE.DirectionalLight('#ffffff', 0.46);
  fill.position.set(-70, 70, 190);
  scene.add(fill);
}
