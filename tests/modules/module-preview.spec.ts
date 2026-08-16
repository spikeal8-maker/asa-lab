import { describe, expect, it } from 'vitest';
import {
  previewDigest,
  MODULE_PREVIEW_SHAPE_LIMIT,
  type ModulePreviewFigure,
  type ModuleProviderV1,
} from '../../packages/module-sdk/src/index';
import { CHECKERS_MODULE } from '../../contexts/checkers/module';
import { CHESS_MODULE } from '../../contexts/chess/module';
import { ELECTRONICS_MODULE } from '../../contexts/electronics/module';
import { THREE_D_MODULE } from '../../contexts/three-d/module';
import { EMPTY_DOCUMENT } from '../../contexts/electronics/domain/document';
import {
  createEmptyThreeDDocument,
  createThreeDNode,
} from '../../contexts/three-d/domain/document';

/**
 * The platform promise for previews is "the same version always produces the
 * same safe preview". These tests hold every active module to it at once, so a
 * new module cannot ship a preview that is random, unbounded, or drawn outside
 * the card it has to fit into.
 */

interface PreviewCase {
  readonly name: string;
  readonly provider: ModuleProviderV1<never, unknown>;
  readonly payload: unknown;
}

function providerOf(module: {
  provider?: ModuleProviderV1<never, unknown>;
}): ModuleProviderV1<never, unknown> {
  const provider = module.provider;
  if (!provider) throw new Error('active module without a provider');
  return provider;
}

function electronicsWithParts(): unknown {
  return {
    ...EMPTY_DOCUMENT,
    components: [
      { id: 'src', kind: 'source', position: { x: 40, y: 40 }, value: 9 },
      { id: 'r1', kind: 'resistor', position: { x: 140, y: 40 }, value: 220 },
      { id: 'd1', kind: 'led', position: { x: 140, y: 160 }, value: 2 },
    ],
    connections: [
      {
        id: 'w1',
        from: { componentId: 'src', terminal: 'a' },
        to: { componentId: 'r1', terminal: 'a' },
      },
      {
        id: 'w2',
        from: { componentId: 'r1', terminal: 'b' },
        to: { componentId: 'd1', terminal: 'a' },
      },
    ],
  };
}

function sceneWithParts(): unknown {
  const empty = createEmptyThreeDDocument();
  const box = createThreeDNode('box', 'box-1');
  const cylinder = createThreeDNode('cylinder', 'cyl-1');
  return {
    ...empty,
    nodes: [
      box,
      {
        ...cylinder,
        operation: 'hole',
        transform: { ...cylinder.transform, position: { x: 30, y: 0, z: 25 } },
      },
    ],
  };
}

const cases: readonly PreviewCase[] = [
  {
    name: 'checkers',
    provider: providerOf(CHECKERS_MODULE),
    payload: providerOf(CHECKERS_MODULE).createEmptyProject(),
  },
  {
    name: 'chess',
    provider: providerOf(CHESS_MODULE),
    payload: providerOf(CHESS_MODULE).createEmptyProject(),
  },
  {
    name: 'electronics',
    provider: providerOf(ELECTRONICS_MODULE),
    payload: electronicsWithParts(),
  },
  { name: 'three-d', provider: providerOf(THREE_D_MODULE), payload: sceneWithParts() },
];

function figureOf(entry: PreviewCase): ModulePreviewFigure {
  const validation = entry.provider.validate(entry.payload);
  expect(validation.ok, `${entry.name} fixture must be a valid document`).toBe(true);
  if (!validation.ok) throw new Error('unreachable');
  const preview = entry.provider.createPreview(validation.payload);
  expect(preview.figure, `${entry.name} must draw something`).toBeDefined();
  return preview.figure as ModulePreviewFigure;
}

describe.each(cases)('$name preview', (entry) => {
  it('draws a figure for a project with content', () => {
    const figure = figureOf(entry);
    expect(figure.shapes.length).toBeGreaterThan(0);
  });

  it('produces the same picture every time', () => {
    const first = figureOf(entry);
    const second = figureOf(entry);
    expect(second).toEqual(first);
  });

  it('produces the same digest every time', () => {
    const validation = entry.provider.validate(entry.payload);
    if (!validation.ok) throw new Error('unreachable');
    const preview = entry.provider.createPreview(validation.payload);
    expect(previewDigest(entry.provider.createPreview(validation.payload))).toBe(
      previewDigest(preview),
    );
  });

  it('declares a viewBox a card can scale', () => {
    const figure = figureOf(entry);
    expect(figure.viewBox.width).toBeGreaterThan(0);
    expect(figure.viewBox.height).toBeGreaterThan(0);
    expect(Number.isFinite(figure.viewBox.width)).toBe(true);
    expect(Number.isFinite(figure.viewBox.height)).toBe(true);
  });

  it('stays within the shape budget', () => {
    expect(figureOf(entry).shapes.length).toBeLessThanOrEqual(MODULE_PREVIEW_SHAPE_LIMIT);
  });

  /**
   * Every coordinate is finite and every colour is a plain CSS colour. A card
   * renders these values straight into an SVG, so a NaN would blank the card
   * and a `url(...)` fill would be a way to smuggle a request out of a preview.
   */
  it('emits only finite coordinates and literal colours', () => {
    for (const shape of figureOf(entry).shapes) {
      for (const [key, value] of Object.entries(shape)) {
        if (typeof value === 'number') {
          expect(Number.isFinite(value), `${entry.name}.${key}`).toBe(true);
        }
        if (key === 'fill' || key === 'stroke') {
          expect(String(value), `${entry.name}.${key}`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
        }
      }
    }
  });

  it('keeps the drawing inside its own viewBox', () => {
    const figure = figureOf(entry);
    const { width, height } = figure.viewBox;
    for (const shape of figure.shapes) {
      if (shape.shape === 'rect') {
        expect(shape.x).toBeGreaterThanOrEqual(0);
        expect(shape.y).toBeGreaterThanOrEqual(0);
        expect(shape.x + shape.width).toBeLessThanOrEqual(width + 0.001);
        expect(shape.y + shape.height).toBeLessThanOrEqual(height + 0.001);
      }
      if (shape.shape === 'circle') {
        expect(shape.cx - shape.r).toBeGreaterThanOrEqual(-0.001);
        expect(shape.cy - shape.r).toBeGreaterThanOrEqual(-0.001);
        expect(shape.cx + shape.r).toBeLessThanOrEqual(width + 0.001);
        expect(shape.cy + shape.r).toBeLessThanOrEqual(height + 0.001);
      }
      if (shape.shape === 'line') {
        for (const coordinate of [shape.x1, shape.x2]) {
          expect(coordinate).toBeGreaterThanOrEqual(-0.001);
          expect(coordinate).toBeLessThanOrEqual(width + 0.001);
        }
        for (const coordinate of [shape.y1, shape.y2]) {
          expect(coordinate).toBeGreaterThanOrEqual(-0.001);
          expect(coordinate).toBeLessThanOrEqual(height + 0.001);
        }
      }
    }
  });
});

describe('empty projects', () => {
  /**
   * A brand-new project has nothing to show. Drawing an empty frame would tell
   * the learner less than the summary line does, so the figure is left out and
   * the card falls back to text.
   */
  it('leaves out the figure when there is nothing to draw', () => {
    const electronics = providerOf(ELECTRONICS_MODULE);
    expect(electronics.createPreview(EMPTY_DOCUMENT as never).figure).toBeUndefined();

    const threeD = providerOf(THREE_D_MODULE);
    expect(threeD.createPreview(createEmptyThreeDDocument() as never).figure).toBeUndefined();
  });

  it('still returns a summary the card can show instead', () => {
    const electronics = providerOf(ELECTRONICS_MODULE);
    expect(electronics.createPreview(EMPTY_DOCUMENT as never).summary).toContain('0 компонентов');
  });
});
