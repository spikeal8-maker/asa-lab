import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  configureProductionLibrary,
  ownerCatalogItems,
  productionCatalog,
  productionCatalogEntry,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';

const repositoryRoot = process.cwd();
const publicRoot = resolve(repositoryRoot, 'apps/web/public');
const manifest = JSON.parse(
  readFileSync(resolve(publicRoot, 'assets/electronics/owner-catalog/manifest.json'), 'utf8'),
) as OwnerCatalogManifest;

function runtimePath(asset: string): string {
  return resolve(publicRoot, asset.replace(/^\//, ''));
}

beforeAll(() => configureProductionLibrary(manifest));

describe('Electronics owner SVG foundation', () => {
  it('keeps owner evidence and source manifests intact', () => {
    expect(
      existsSync(resolve(publicRoot, 'assets/electronics/owner-supplied/manifest.json')),
    ).toBe(true);
    expect(existsSync(resolve(publicRoot, 'assets/electronics/owner-audit'))).toBe(true);
    expect(existsSync(resolve(publicRoot, 'assets/electronics/owner-catalog/manifest.json'))).toBe(
      true,
    );
  });

  it('routes every enabled runtime component to a byte-matched owner SVG', () => {
    expect(productionCatalog().length).toBeGreaterThan(0);
    for (const entry of productionCatalog()) {
      expect(entry.catalogStatus, entry.key).toBe('enabled');
      expect(entry.provenance, entry.key).toBe('exact_owner_svg');
      expect(entry.asset, entry.key).toMatch(
        /^\/assets\/electronics\/owner-audit\/.*\.svg$/,
      );
      expect(entry.asset, entry.key).not.toContain('/production/');
      expect(entry.asset, entry.key).not.toContain('/source-reference/');
      expect(entry.runtimeSha256, entry.key).toBe(entry.sourceSha256);
      const path = runtimePath(entry.asset);
      expect(existsSync(path), `${entry.key}: ${path}`).toBe(true);
      const svg = readFileSync(path, 'utf8');
      expect(svg, entry.key).toMatch(/<svg\b/i);
      expect(svg, entry.key).not.toMatch(
        /<image\b|data:image|base64|<foreignObject\b|<script\b/i,
      );
      expect(svg, entry.key).not.toMatch(/(?:href|xlink:href)=["']https?:\/\//i);
    }
  });

  it('uses the complete owner LED state family directly from owner-audit', () => {
    const led = productionCatalogEntry('led-5mm');
    expect(led).not.toBeNull();
    if (!led) return;
    for (const colour of ['blue', 'green', 'orange', 'red', 'white', 'yellow'] as const) {
      for (const brightness of [0, 1, 25, 50, 75, 100]) {
        const key = `${colour}:${brightness}`;
        const asset = led.stateAssets[key];
        expect(asset, key).toBe(
          `/assets/electronics/owner-audit/components/led/${colour}/led_${colour}_i${String(
            brightness,
          ).padStart(3, '0')}.svg`,
        );
        expect(existsSync(runtimePath(asset as string)), asset).toBe(true);
      }
    }
    for (const state of [
      'led_red_reverse_polarity',
      'led_orange_overcurrent',
      'led_red_burned',
    ]) {
      const asset = led.stateAssets[state];
      expect(asset, state).toMatch(/^\/assets\/electronics\/owner-audit\/.*\.svg$/);
      expect(existsSync(runtimePath(asset as string)), asset).toBe(true);
    }
  });

  it('keeps missing components disabled instead of substituting traced or invented art', () => {
    for (const componentId of ['microbit', 'vibration-motor']) {
      const entry = ownerCatalogItems().find((item) => item.key === componentId);
      expect(entry?.catalogStatus, componentId).toBe('disabled_missing_svg');
      expect(entry?.enabled, componentId).toBe(false);
      expect(entry?.asset, componentId).toBe('');
    }
  });

  it('removes the two scripts that generated and replaced runtime artwork', () => {
    expect(existsSync(resolve(repositoryRoot, 'tools/vectorize_owner_references.py'))).toBe(false);
    expect(existsSync(resolve(repositoryRoot, 'tools/build_electronics_production_assets.py'))).toBe(
      false,
    );
  });
});
