import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ordinaryLedAsset, ordinaryLedState } from '../production-asset-contracts';
import { OWNER_RUNTIME_ASSET_BY_ID } from '../production-manifest-adapter';

const repositoryRoot = process.cwd();
const publicRoot = resolve(repositoryRoot, 'apps/web/public');

function runtimePath(asset: string): string {
  return resolve(publicRoot, asset.replace(/^\//, ''));
}

describe('Electronics owner SVG foundation', () => {
  it('keeps owner evidence and source manifests intact', () => {
    expect(
      existsSync(resolve(publicRoot, 'assets/electronics/owner-supplied/manifest.json')),
    ).toBe(true);
    expect(existsSync(resolve(publicRoot, 'assets/electronics/owner-audit'))).toBe(true);
  });

  it('routes every runtime component to an owner SVG rather than generated production art', () => {
    expect(Object.keys(OWNER_RUNTIME_ASSET_BY_ID).length).toBeGreaterThan(20);
    for (const [componentId, asset] of Object.entries(OWNER_RUNTIME_ASSET_BY_ID)) {
      expect(asset, componentId).toMatch(
        /^\/assets\/electronics\/(owner-supplied|owner-audit\/components)\/.*\.svg$/,
      );
      expect(asset, componentId).not.toContain('/production/');
      expect(asset, componentId).not.toContain('/source-reference/');
      const path = runtimePath(asset);
      expect(existsSync(path), `${componentId}: ${path}`).toBe(true);
      const svg = readFileSync(path, 'utf8');
      expect(svg, componentId).toMatch(/<svg\b/i);
      expect(svg, componentId).not.toMatch(/<image\b|data:image|base64|<foreignObject\b|<script\b/i);
      expect(svg, componentId).not.toMatch(/(?:href|xlink:href)=["']https?:\/\//i);
    }
  });

  it('uses the complete owner LED state family directly from owner-audit', () => {
    for (const colour of ['blue', 'green', 'orange', 'red', 'white', 'yellow'] as const) {
      for (const brightness of [0, 1, 25, 50, 75, 100]) {
        const asset = ordinaryLedAsset(ordinaryLedState(colour, brightness));
        expect(asset).toBe(
          `/assets/electronics/owner-audit/components/led/${colour}/led_${colour}_i${String(
            brightness,
          ).padStart(3, '0')}.svg`,
        );
        expect(existsSync(runtimePath(asset)), asset).toBe(true);
      }
    }
    for (const fault of ['reverse', 'overcurrent', 'burned'] as const) {
      expect(existsSync(runtimePath(ordinaryLedAsset(ordinaryLedState('red', 50, fault))))).toBe(
        true,
      );
    }
  });

  it('keeps known missing components missing instead of substituting a traced PNG', () => {
    for (const componentId of [
      'battery-1.5v',
      'battery-3v',
      'battery-6v',
      'microbit-preview',
      'vibration-motor-preview',
    ]) {
      expect(OWNER_RUNTIME_ASSET_BY_ID[componentId], componentId).toBeUndefined();
    }
  });

  it('removes the two scripts that generated and replaced runtime artwork', () => {
    expect(existsSync(resolve(repositoryRoot, 'tools/vectorize_owner_references.py'))).toBe(false);
    expect(existsSync(resolve(repositoryRoot, 'tools/build_electronics_production_assets.py'))).toBe(
      false,
    );
  });
});
