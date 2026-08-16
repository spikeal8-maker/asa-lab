import {
  defineModule,
  MODULE_PREVIEW_SHAPE_LIMIT,
  type ModuleDiagnostic,
  type ModulePreviewFigure,
  type ModulePreviewShape,
} from '@asa-lab/module-sdk';
import {
  EMPTY_DOCUMENT,
  parseElectronicsDocument,
  type ElectronicsDocument,
} from './domain/document.js';
import { analyseCircuit, type SimulationResult } from './domain/simulation.js';

/**
 * A part's footprint in document units. Positions are stored in world units of
 * five per millimetre, so this is roughly a 9 mm package — close enough to the
 * real components that the spacing in a preview matches the spacing a learner
 * laid out, without the module having to know the parts catalogue.
 */
const PREVIEW_PART = 44;
const PREVIEW_PADDING = 22;

/**
 * The circuit as it is laid out: a block per component where the learner put
 * it, a line per connection. The extent comes from the components themselves
 * rather than from the saved viewport, so the preview shows the work and not
 * wherever the editor happened to be scrolled when it was saved — that is what
 * makes the same document always produce the same picture.
 */
function electronicsPreviewFigure(payload: ElectronicsDocument): ModulePreviewFigure | undefined {
  if (payload.components.length === 0) return undefined;

  const xs = payload.components.map((component) => component.position.x);
  const ys = payload.components.map((component) => component.position.y);
  const minX = Math.min(...xs) - PREVIEW_PADDING;
  const minY = Math.min(...ys) - PREVIEW_PADDING;
  const width = Math.max(...xs) - minX + PREVIEW_PART + PREVIEW_PADDING;
  const height = Math.max(...ys) - minY + PREVIEW_PART + PREVIEW_PADDING;

  const centres = new Map<string, { x: number; y: number }>();
  for (const component of payload.components) {
    centres.set(component.id, {
      x: component.position.x - minX + PREVIEW_PART / 2,
      y: component.position.y - minY + PREVIEW_PART / 2,
    });
  }

  const shapes: ModulePreviewShape[] = [];
  for (const connection of payload.connections) {
    const from = centres.get(connection.from.componentId);
    const to = centres.get(connection.to.componentId);
    if (!from || !to) continue;
    shapes.push({
      shape: 'line',
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      stroke: connection.color ?? '#c2453f',
      width: 5,
    });
  }

  // Parts last so a wire never crosses over the part it joins.
  for (const component of payload.components) {
    shapes.push({
      shape: 'rect',
      x: component.position.x - minX,
      y: component.position.y - minY,
      width: PREVIEW_PART,
      height: PREVIEW_PART,
      radius: 6,
      fill: '#3f6f8f',
      stroke: '#22475c',
    });
  }

  return {
    viewBox: { width, height },
    background: '#e8edf1',
    shapes: shapes.slice(0, MODULE_PREVIEW_SHAPE_LIMIT),
  };
}

const ELECTRONICS_MANIFEST = {
  moduleKey: 'electronics',
  moduleVersion: '3.1.0',
  displayName: 'Электроника',
  shortDescription: 'Создание электрических схем, соединение компонентов и моделирование.',
  projectType: 'circuit',
  schemaVersion: 3,
  editorRoute: '/projects/:projectId/electronics',
  viewerRoute: '/view/projects/:versionId/electronics',
  safeModeSupported: true,
  availability: 'active',
  previewKind: 'schematic',
  iconKey: 'circuit',
  categories: ['engineering', 'electronics'],
} as const;

function invalidDocument(message: string): readonly ModuleDiagnostic[] {
  return [
    {
      code: 'electronics_document_invalid',
      severity: 'error',
      message,
    },
  ];
}

/** First-party Electronics provider registered through the same contract that
 * future Blocks, 3D and board modules will use. Browser and server consumers
 * use the same deterministic simulation contract. */
export const ELECTRONICS_MODULE = defineModule<ElectronicsDocument, SimulationResult>(
  ELECTRONICS_MANIFEST,
  {
    createEmptyProject: () => EMPTY_DOCUMENT,
    validate: (payload: unknown) => {
      const parsed = parseElectronicsDocument(payload);
      if (!parsed.ok) {
        return { ok: false, diagnostics: invalidDocument(parsed.message) };
      }
      return { ok: true, payload: parsed.document, diagnostics: [] };
    },
    createPreview: (payload: ElectronicsDocument) => {
      const summary = `${payload.components.length} компонентов · ${payload.connections.length} соединений`;
      const figure = electronicsPreviewFigure(payload);
      // An empty circuit has nothing to draw, and an empty box is worse than
      // the count on its own.
      return figure ? { kind: 'schematic', summary, figure } : { kind: 'schematic', summary };
    },
    analyse: (payload: ElectronicsDocument) => analyseCircuit(payload),
  },
);
