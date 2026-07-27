import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WORKBENCH_CATALOG } from '../../apps/web/src/electronics/component-catalog';

/** TST-ELECTRONICS-ASSETS-001: every catalog asset is a real, sanitised vector
 * file — the owner's artwork must stay vector and must not smuggle scripts,
 * remote references or raster payloads into the workbench. */

const PUBLIC_ROOT = join(process.cwd(), 'apps', 'web', 'public');

function assetPaths(): string[] {
  const paths = new Set<string>();
  for (const entry of WORKBENCH_CATALOG) {
    if (entry.asset) {
      paths.add(entry.asset);
    }
    for (const stateAsset of Object.values(entry.stateAssets ?? {})) {
      if (stateAsset) {
        paths.add(stateAsset);
      }
    }
  }
  return [...paths];
}

describe('electronics component assets', () => {
  const paths = assetPaths();

  it('the catalog references at least the three active components', () => {
    expect(paths.length).toBeGreaterThanOrEqual(3);
    for (const required of [
      '/assets/electronics/components/power-source.svg',
      '/assets/electronics/components/resistor.svg',
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

    // Sanitisation contract for anything shipped into the browser.
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

  it('active components declare terminals inside their viewBox', () => {
    for (const entry of WORKBENCH_CATALOG.filter((item) => item.enabled)) {
      expect(entry.terminals, `${entry.key} must expose terminals`).not.toBeNull();
      for (const terminal of Object.values(entry.terminals ?? {})) {
        expect(terminal.x).toBeGreaterThanOrEqual(0);
        expect(terminal.x).toBeLessThanOrEqual(entry.viewBox.width);
        expect(terminal.y).toBeGreaterThanOrEqual(0);
        expect(terminal.y).toBeLessThanOrEqual(entry.viewBox.height);
      }
    }
  });

  it('components that are not enabled stay out of the simulated set', () => {
    for (const entry of WORKBENCH_CATALOG.filter((item) => !item.enabled)) {
      expect(entry.kind, `${entry.key} must not claim a simulated kind`).toBeNull();
    }
  });
});
