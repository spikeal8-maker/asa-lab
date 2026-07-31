import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PinManifest {
  pinId: string;
  pinPosition: { xMm: number; yMm: number; xViewBox: number; yViewBox: number };
}

interface ComponentManifest {
  id: string;
  physicalWidthMm: number;
  physicalHeightMm: number;
  viewBox: string;
  pinCount: number;
  pins: PinManifest[];
  stateVariants: Array<{ file: string; sha256: string }>;
}

interface OwnerAssetManifest {
  provenance: string;
  worldUnitsPerMm: number;
  components: ComponentManifest[];
}

const publicRoot = resolve(process.cwd(), 'apps/web/public');
const manifestPath = resolve(publicRoot, 'assets/electronics/owner-supplied/manifest.json');
const manifestText = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText) as OwnerAssetManifest;

const assetSha256 = (file: string) =>
  createHash('sha256')
    .update(readFileSync(resolve(publicRoot, 'assets/electronics/owner-supplied', file)))
    .digest('hex');

describe('owner-supplied electronics contact sheet manifest', () => {
  it('uses one physical scale and contains no arbitrary render width', () => {
    expect(manifest.provenance).toBe('owner_supplied');
    expect(manifest.worldUnitsPerMm).toBe(8);
    expect(manifestText).not.toContain('renderWidth');

    for (const component of manifest.components) {
      expect(component.physicalWidthMm).toBeGreaterThan(0);
      expect(component.physicalHeightMm).toBeGreaterThan(0);
      expect(component.physicalWidthMm * manifest.worldUnitsPerMm).toBeGreaterThan(0);
      expect(component.physicalHeightMm * manifest.worldUnitsPerMm).toBeGreaterThan(0);
    }
  });

  it('preserves the required button and SPDT pin topologies', () => {
    const button = manifest.components.find((component) => component.id === 'button-tactile-6mm');
    const switchSpdt = manifest.components.find(
      (component) => component.id === 'switch-slide-spdt',
    );

    expect(button).toMatchObject({ pinCount: 4, physicalWidthMm: 10, physicalHeightMm: 10 });
    expect(button?.pins.map((pin) => pin.pinId)).toEqual(['SW-A1', 'SW-B1', 'SW-A2', 'SW-B2']);
    expect(switchSpdt).toMatchObject({ pinCount: 3, physicalWidthMm: 18, physicalHeightMm: 10 });
    expect(switchSpdt?.pins.map((pin) => pin.pinId)).toEqual([
      'throw-left',
      'common',
      'throw-right',
    ]);
  });

  it('keeps every terminal inside its physical asset envelope', () => {
    for (const component of manifest.components) {
      expect(component.pins).toHaveLength(component.pinCount);
      for (const pin of component.pins) {
        expect(pin.pinPosition.xMm).toBeGreaterThanOrEqual(0);
        expect(pin.pinPosition.xMm).toBeLessThanOrEqual(component.physicalWidthMm);
        expect(pin.pinPosition.yMm).toBeGreaterThanOrEqual(0);
        expect(pin.pinPosition.yMm).toBeLessThanOrEqual(component.physicalHeightMm);
      }
    }
  });

  it('matches every committed SVG to the owner archive hash', () => {
    for (const component of manifest.components) {
      for (const variant of component.stateVariants) {
        expect(assetSha256(variant.file), variant.file).toBe(variant.sha256);
      }
    }
  });
});
