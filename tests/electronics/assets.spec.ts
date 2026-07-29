import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  WORKBENCH_CATALOG,
  renderedSize,
  renderedSizeMillimetres,
  snapComponentOrigin,
  terminalPosition,
} from '../../apps/web/src/electronics/component-catalog';
import {
  BREADBOARD_PITCH_MM,
  BREADBOARD_PITCH_UNITS,
  STAGE_HEIGHT_UNITS,
  STAGE_WIDTH_UNITS,
  workbenchUnitsToMm,
} from '../../apps/web/src/electronics/workbench-scale';

/** TST-ELECTRONICS-ASSETS-001: every catalog asset is a real, sanitised vector
 * file and active geometry is calibrated to a 2.54 mm breadboard grid. */

const PUBLIC_ROOT = join(process.cwd(), 'apps', 'web', 'public');

function assetPaths(): string[] {
  const paths = new Set<string>();
  for (const entry of WORKBENCH_CATALOG) {
    if (entry.asset) paths.add(entry.asset);
    for (const stateAsset of Object.values(entry.stateAssets ?? {})) {
      if (stateAsset) paths.add(stateAsset);
    }
  }
  return [...paths];
}

function nearInteger(value: number, tolerance = 0.0001): boolean {
  return Math.abs(value - Math.round(value)) <= tolerance;
}

describe('electronics component assets', () => {
  const paths = assetPaths();

  it('the catalog references at least the three active components', () => {
    expect(paths.length).toBeGreaterThanOrEqual(3);
    for (const required of [
      '/assets/electronics/components/power-source.svg',
      '/assets/electronics/components/resistor.svg',
      '/assets/electronics/components/led-red-off.svg',
    ]) {
      expect(paths).toContain(required);
    }
  });

  it.each(assetPaths())('%s exists, is vector and keeps its viewBox', (assetPath) => {
    const file = join(PUBLIC_ROOT, assetPath.replace(/^\//, ''));
    expect(existsSync(file), `missing asset: ${assetPath}`).toBe(true);
    const svg = readFileSync(file, 'utf8');

    expect(svg.trimStart().startsWith('<svg'), 'must be a bare SVG root').toBe(true);
    expect(svg, 'viewBox is required for scaling without distortion').toMatch(/viewBox="/);

    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/<foreignObject/i);
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
    expect(svg, 'no raster payloads').not.toMatch(/<image\b/i);
    expect(svg, 'no base64 data URIs').not.toMatch(/data:image\//i);
    expect(svg, 'no remote references').not.toMatch(
      /(?:href|url\()\s*["']?(?:https?:)?\/\/(?!www\.w3\.org)/i,
    );
    expect(svg, 'editor metadata must be stripped').not.toMatch(/sodipodi|inkscape|<metadata/i);
  });

  it('active components declare semantic terminals inside their viewBox', () => {
    for (const entry of WORKBENCH_CATALOG.filter((item) => item.enabled)) {
      expect(entry.terminals, `${entry.key} must expose terminals`).not.toBeNull();
      for (const terminal of Object.values(entry.terminals ?? {})) {
        expect(terminal.id).toMatch(/^[a-z0-9-]+$/);
        expect(terminal.label.length).toBeGreaterThan(0);
        expect(terminal.role.length).toBeGreaterThan(0);
        expect(terminal.x).toBeGreaterThanOrEqual(0);
        expect(terminal.x).toBeLessThanOrEqual(entry.viewBox.width);
        expect(terminal.y).toBeGreaterThanOrEqual(0);
        expect(terminal.y).toBeLessThanOrEqual(entry.viewBox.height);
      }
    }
  });

  it('active terminal spans equal their declared breadboard-pitch spans', () => {
    for (const entry of WORKBENCH_CATALOG.filter((item) => item.enabled)) {
      expect(entry.kind).not.toBeNull();
      expect(entry.terminals).not.toBeNull();
      expect(entry.physical.terminalSpanPitches).toBeGreaterThan(0);
      const origin = { x: 0, y: 0 };
      const a = terminalPosition(entry.kind!, origin, 'a', 0)!;
      const b = terminalPosition(entry.kind!, origin, 'b', 0)!;
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      const expected = entry.physical.terminalSpanPitches! * BREADBOARD_PITCH_UNITS;
      expect(span, `${entry.key} terminal span`).toBeCloseTo(expected, 6);
      expect(workbenchUnitsToMm(span)).toBeCloseTo(
        entry.physical.terminalSpanPitches! * BREADBOARD_PITCH_MM,
        6,
      );
    }
  });

  it('new placements align both terminals to the half-pitch grid in every rotation', () => {
    for (const entry of WORKBENCH_CATALOG.filter((item) => item.enabled)) {
      for (const rotation of [0, 90, 180, 270] as const) {
        const origin = snapComponentOrigin(entry.kind!, { x: 137.3, y: 91.7 }, rotation);
        for (const terminal of ['a', 'b'] as const) {
          const point = terminalPosition(entry.kind!, origin, terminal, rotation)!;
          expect(nearInteger(point.x / (BREADBOARD_PITCH_UNITS / 2))).toBe(true);
          expect(nearInteger(point.y / (BREADBOARD_PITCH_UNITS / 2))).toBe(true);
        }
      }
    }
  });

  it('rendered physical envelopes are finite and fit the initial field', () => {
    for (const entry of WORKBENCH_CATALOG.filter((item) => item.enabled)) {
      const size = renderedSize(entry);
      const mm = renderedSizeMillimetres(entry);
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
      expect(size.width).toBeLessThan(STAGE_WIDTH_UNITS);
      expect(size.height).toBeLessThan(STAGE_HEIGHT_UNITS);
      expect(mm.width).toBeGreaterThan(0);
      expect(mm.height).toBeGreaterThan(0);
    }
  });

  it('the initial field is physically defined rather than pixel-only', () => {
    expect(STAGE_WIDTH_UNITS).toBe(1600);
    expect(STAGE_HEIGHT_UNITS).toBe(980);
    expect(workbenchUnitsToMm(STAGE_WIDTH_UNITS)).toBeCloseTo(203.2, 5);
    expect(workbenchUnitsToMm(STAGE_HEIGHT_UNITS)).toBeCloseTo(124.46, 5);
  });

  it('disabled components remain outside the simulated set and disclose provisional geometry', () => {
    for (const entry of WORKBENCH_CATALOG.filter((item) => !item.enabled)) {
      expect(entry.kind, `${entry.key} must not claim a simulated kind`).toBeNull();
      expect(entry.physical.bodyMm.width).toBeGreaterThan(0);
      expect(entry.physical.bodyMm.height).toBeGreaterThan(0);
      expect(entry.physical.evidence).toBe('reference_capture_required');
      expect(entry.terminals).toBeNull();
    }
  });
});
