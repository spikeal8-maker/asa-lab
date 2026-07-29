import { describe, expect, it } from 'vitest';
import { createBreadboardDefinition } from '../domain/breadboard';
import {
  breadboardRenderHole,
  buildBreadboardRenderModel,
} from '../domain/breadboard-render-model';

describe('native breadboard render model', () => {
  it('derives all 400 half-board holes from the electrical definition', () => {
    const model = buildBreadboardRenderModel(createBreadboardDefinition('half-400'));
    expect(model).toMatchObject({
      kind: 'half-400',
      widthMm: 83.5,
      heightMm: 54.5,
      terminalCount: 400,
    });
    expect(new Set(model.holes.map((hole) => hole.id)).size).toBe(400);
    expect(model.internalBusCount).toBe(64);
  });

  it('keeps every visible hole and hit target tied to one stable electrical ID', () => {
    const model = buildBreadboardRenderModel(createBreadboardDefinition('half-400'));
    for (const hole of model.holes) {
      expect(hole.visibleRadiusMm).toBeGreaterThan(0);
      expect(hole.hitRadiusMm).toBeGreaterThan(hole.visibleRadiusMm);
      expect(hole.hitRadiusMm).toBeCloseTo(1.27, 6);
      expect(hole.accessibleName).toContain(hole.internalBusId);
      expect(hole.xMm).toBeGreaterThanOrEqual(0);
      expect(hole.xMm).toBeLessThanOrEqual(model.widthMm);
      expect(hole.yMm).toBeGreaterThanOrEqual(0);
      expect(hole.yMm).toBeLessThanOrEqual(model.heightMm);
    }
  });

  it('renders a 5.08 mm physical centre trench rather than inventing another hole row', () => {
    const model = buildBreadboardRenderModel(createBreadboardDefinition('half-400'));
    expect(model.channel.heightMm).toBeCloseTo(5.08, 6);
    expect(model.channel.widthMm).toBeCloseTo(82.6, 6);
    const upper = breadboardRenderHole(model, 'half-400:terminal:1:e')!;
    const lower = breadboardRenderHole(model, 'half-400:terminal:1:f')!;
    expect(lower.yMm - upper.yMm).toBeCloseTo(7.62, 6);
    expect(model.channel.yMm).toBeGreaterThan(upper.yMm);
    expect(model.channel.yMm + model.channel.heightMm).toBeLessThan(lower.yMm);
  });

  it('derives four continuous power-rail guides for the half board', () => {
    const model = buildBreadboardRenderModel(createBreadboardDefinition('half-400'));
    expect(model.rails.map((rail) => rail.id)).toEqual([
      'top-positive',
      'top-negative',
      'bottom-positive',
      'bottom-negative',
    ]);
    for (const rail of model.rails) {
      expect(rail.segments).toHaveLength(1);
      expect(rail.segments[0]?.id).toContain('continuous');
      expect(rail.x2Mm).toBeGreaterThan(rail.x1Mm);
    }
  });

  it('keeps full-board split rails visible as separate segments', () => {
    const model = buildBreadboardRenderModel(createBreadboardDefinition('full-830'));
    for (const rail of model.rails) {
      expect(rail.segments).toHaveLength(2);
      expect(rail.segments.map((segment) => segment.id).sort()).toEqual([
        `${rail.id}:left`,
        `${rail.id}:right`,
      ]);
      expect(rail.segments[0]?.x2Mm).toBeLessThan(rail.segments[1]?.x1Mm ?? 0);
    }
  });

  it('uses sparse printed labels rather than rendering 400 persistent text labels', () => {
    const model = buildBreadboardRenderModel(createBreadboardDefinition('half-400'));
    const columnLabels = model.labels.filter((label) => label.kind === 'column');
    const rowLabels = model.labels.filter((label) => label.kind === 'row');
    const polarityLabels = model.labels.filter((label) => label.kind === 'rail-polarity');
    expect(columnLabels.map((label) => label.text)).toEqual([
      '1',
      '1',
      '5',
      '5',
      '10',
      '10',
      '15',
      '15',
      '20',
      '20',
      '25',
      '25',
      '30',
      '30',
    ]);
    expect(rowLabels).toHaveLength(10);
    expect(polarityLabels).toHaveLength(4);
    expect(model.labels.length).toBeLessThan(40);
  });

  it('gives field holes and rail holes human-readable accessible descriptions', () => {
    const model = buildBreadboardRenderModel(createBreadboardDefinition('half-400'));
    expect(breadboardRenderHole(model, 'half-400:terminal:7:c')?.accessibleName).toContain(
      'Отверстие c7',
    );
    expect(breadboardRenderHole(model, 'half-400:rail:top-positive:4')?.accessibleName).toContain(
      'верхняя положительная шина',
    );
    expect(breadboardRenderHole(model, 'missing')).toBeNull();
  });
});
