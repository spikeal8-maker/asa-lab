import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import type { ThreeDDocument } from '@asa-lab/three-d';
import { createBooleanMesh } from './viewport/csg';
import { createNodeObject, disposeObject } from './viewport/geometry';

function safeFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zа-яё0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'asa-3d'
  );
}

function download(data: BlobPart, mime: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadThreeDJson(document: ThreeDDocument, title: string): void {
  download(
    JSON.stringify(document, null, 2),
    'application/json',
    `${safeFileName(title)}.asa3d.json`,
  );
}

export function downloadThreeDStl(document: ThreeDDocument, title: string): void {
  const scene = new THREE.Scene();
  const groupedIds = new Set(document.nodes.filter((node) => node.groupId).map((node) => node.id));
  const objects: THREE.Object3D[] = document.nodes
    .filter((node) => node.visible && node.operation === 'solid' && !groupedIds.has(node.id))
    .map((node) => createNodeObject(node));
  const groups = new Map<string, typeof document.nodes>();
  for (const node of document.nodes) {
    if (!node.groupId) continue;
    const members = groups.get(node.groupId) ?? [];
    groups.set(node.groupId, [...members, node]);
  }
  for (const nodes of groups.values()) {
    const mesh = createBooleanMesh(nodes, nodes[0]?.groupOperation ?? 'union');
    if (mesh) objects.push(mesh);
  }
  scene.add(...objects);
  scene.updateMatrixWorld(true);
  const result = new STLExporter().parse(scene, { binary: true });
  download(result, 'model/stl', `${safeFileName(title)}.stl`);
  objects.forEach(disposeObject);
}
