import {
  defineModule,
  MODULE_PREVIEW_SHAPE_LIMIT,
  type ModuleDiagnostic,
  type ModulePreviewFigure,
  type ModulePreviewShape,
} from '@asa-lab/module-sdk';
import {
  createEmptyThreeDDocument,
  parseThreeDDocument,
  type PrimitiveKind,
  type ThreeDDocument,
} from './domain/document.js';

const THREE_D_PREVIEW_MARGIN = 4;
const THREE_D_PREVIEW_GROUND = '#f2f4f7';
const THREE_D_PREVIEW_EDGE = '#33414d';
const THREE_D_PREVIEW_HOLE_EDGE = '#9aa6b2';

/** Primitives whose footprint on the work plane is a circle, not a square. */
const ROUND_FOOTPRINT = new Set<PrimitiveKind>([
  'cylinder',
  'sphere',
  'cone',
  'torus',
  'half-sphere',
  'tube',
  'paraboloid',
  'polygon',
]);

/**
 * The scene seen from above: width and depth on the work plane, height ignored.
 * A true render would need the WebGL runtime, which is the one thing a project
 * card must not load — and a plan view is what a modeller recognises anyway.
 *
 * Holes are drawn in the ground colour, so a cut reads as a cut rather than as
 * another block. Nodes keep their document order, which is the order the editor
 * stacks them in, so the preview matches what the modeller sees.
 */
function threeDPreviewFigure(payload: ThreeDDocument): ModulePreviewFigure | undefined {
  const boxes = payload.nodes
    .filter((node) => node.visible)
    .map((node) => {
      const width = Math.max(1, Math.abs(node.dimensions.width * node.transform.scale.x));
      const depth = Math.max(1, Math.abs(node.dimensions.depth * node.transform.scale.z));
      return {
        node,
        x: node.transform.position.x - width / 2,
        y: node.transform.position.z - depth / 2,
        width,
        depth,
      };
    });
  if (boxes.length === 0) return undefined;

  const minX = Math.min(...boxes.map((box) => box.x)) - THREE_D_PREVIEW_MARGIN;
  const minY = Math.min(...boxes.map((box) => box.y)) - THREE_D_PREVIEW_MARGIN;
  const maxX = Math.max(...boxes.map((box) => box.x + box.width)) + THREE_D_PREVIEW_MARGIN;
  const maxY = Math.max(...boxes.map((box) => box.y + box.depth)) + THREE_D_PREVIEW_MARGIN;

  const shapes: ModulePreviewShape[] = boxes.map((box) => {
    const hole = box.node.operation === 'hole';
    const fill = hole ? THREE_D_PREVIEW_GROUND : box.node.color;
    const stroke = hole ? THREE_D_PREVIEW_HOLE_EDGE : THREE_D_PREVIEW_EDGE;
    const x = box.x - minX;
    const y = box.y - minY;
    if (ROUND_FOOTPRINT.has(box.node.primitive)) {
      return {
        shape: 'circle',
        cx: x + box.width / 2,
        cy: y + box.depth / 2,
        r: Math.min(box.width, box.depth) / 2,
        fill,
        stroke,
      };
    }
    return { shape: 'rect', x, y, width: box.width, height: box.depth, radius: 1, fill, stroke };
  });

  return {
    viewBox: { width: maxX - minX, height: maxY - minY },
    background: THREE_D_PREVIEW_GROUND,
    shapes: shapes.slice(0, MODULE_PREVIEW_SHAPE_LIMIT),
  };
}

export interface ThreeDAnalysisSummary {
  readonly objectCount: number;
  readonly solidCount: number;
  readonly holeCount: number;
  readonly approximateBoundingVolumeMm3: number;
}

const THREE_D_MANIFEST = {
  moduleKey: 'three-d',
  moduleVersion: '0.1.0',
  displayName: 'ASA 3D',
  shortDescription: 'Браузерное 3D-моделирование из простых форм с точными размерами.',
  defaultProjectTitlePrefix: '3D-модель',
  projectType: 'three-d-scene',
  schemaVersion: 1,
  editorRoute: '/projects/:projectId/three-d',
  viewerRoute: '/view/projects/:versionId/three-d',
  safeModeSupported: true,
  availability: 'active',
  previewKind: 'scene',
  iconKey: 'three-d',
  categories: ['design', 'engineering', 'creative'],
} as const;

function invalidDocument(message: string): readonly ModuleDiagnostic[] {
  return [{ code: 'three_d_document_invalid', severity: 'error', message }];
}

function analyse(document: ThreeDDocument): ThreeDAnalysisSummary {
  return {
    objectCount: document.nodes.length,
    solidCount: document.nodes.filter((node) => node.operation === 'solid').length,
    holeCount: document.nodes.filter((node) => node.operation === 'hole').length,
    approximateBoundingVolumeMm3: document.nodes.reduce(
      (sum, node) => sum + node.dimensions.width * node.dimensions.depth * node.dimensions.height,
      0,
    ),
  };
}

export const THREE_D_MODULE = defineModule<ThreeDDocument, ThreeDAnalysisSummary>(
  THREE_D_MANIFEST,
  {
    createEmptyProject: createEmptyThreeDDocument,
    validate: (payload: unknown) => {
      const parsed = parseThreeDDocument(payload);
      if (!parsed.ok) return { ok: false, diagnostics: invalidDocument(parsed.message) };
      return { ok: true, payload: parsed.value, diagnostics: [] };
    },
    createPreview: (payload) => {
      const objectCount = analyse(payload).objectCount;
      const summary = `${objectCount} объектов · ${payload.units}`;
      const inlineData = JSON.stringify({ objectCount });
      const figure = threeDPreviewFigure(payload);
      // An empty scene has nothing to draw, and a blank card is worse than
      // the object count on its own.
      return figure
        ? { kind: 'scene', summary, inlineData, figure }
        : { kind: 'scene', summary, inlineData };
    },
    analyse,
  },
);
