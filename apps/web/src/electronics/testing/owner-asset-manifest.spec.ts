import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ImportedAsset {
  componentId: string;
  state: string;
  sourceArchive: string;
  sourceFile: string;
  sha256: string;
  importedFile: string;
  acceptance: string;
  svg?: {
    hasEmbeddedRaster: boolean;
    hasExternalReference: boolean;
    transparencyAudit: string;
  };
}

interface LogicalComponent {
  id: string;
  category: string;
  inventoryStatus: string;
  canonicalPackageStatus: string;
  canonicalAssetCount: number;
  physicalDimensions: { physicalWidthMm: number | null; physicalHeightMm: number | null };
}

interface AuditManifest {
  provenance: string;
  auditScope: string;
  sourceArchives: Array<{ id: string; sha256: string; fileCount: number; committedToGit: boolean }>;
  summary: {
    outerFilesClassified: number;
    nestedFilesClassified: number;
    logicalComponents: number;
    presentLogicalComponents: number;
    absentRequestedLogicalComponents: number;
    importedReviewAssets: number;
  };
  logicalComponents: LogicalComponent[];
  fileInventory: Array<{
    sourceArchive: string;
    sourceFile: string;
    sha256: string;
    role: string;
    componentFamily: string;
  }>;
  nestedArchiveInventory: Array<{ sourceArchive: string; sourceFile: string; sha256: string }>;
  importedReviewAssets: ImportedAsset[];
}

const publicRoot = resolve(process.cwd(), 'apps/web/public');
const auditRoot = resolve(publicRoot, 'assets/electronics/owner-audit');
const loadJson = <T>(file: string): T =>
  JSON.parse(readFileSync(resolve(auditRoot, file), 'utf8')) as T;

const manifest = loadJson<AuditManifest>('manifest.json');
const stateMap = loadJson<{
  families: Array<{
    componentId: string;
    colors?: Record<string, Array<{ brightnessPercent: number; file: string }>>;
    variants?: Array<{ state: string; file: string }>;
    presentCellCounts?: number[];
    absentRequestedCellCounts?: number[];
  }>;
}>('state-family-map.json');
const footprints = loadJson<{
  boards: Array<{
    componentId: string;
    physical: { holePitchMm: number; totalTiePoints: number };
    holes: unknown[];
    groups: Record<string, unknown>;
    groupCount: number;
  }>;
  componentFootprints: Array<{ componentId: string; status: string; pitchMm?: number }>;
}>('breadboard-footprint-map.json');
const pinMap = loadJson<{
  components: Array<{ componentId: string; pinCount: number; status: string }>;
}>('pin-map.json');

const component = (id: string) => {
  const found = manifest.logicalComponents.find((item) => item.id === id);
  expect(found, id).toBeDefined();
  return found as LogicalComponent;
};

describe('complete owner Electronics asset foundation audit', () => {
  it('anchors the audit to the owner-confirmed canonical archive', () => {
    expect(manifest.provenance).toBe('owner_supplied');
    expect(manifest.auditScope).toContain('owner-confirmed canonical SVG archive');
    expect(manifest.sourceArchives[0]).toMatchObject({
      id: 'canonical-components-svg',
      sha256: 'c5bfd26760db7a92d06e0b51b0bde3bb45595278a762bab3ab9198abb04b4d75',
      fileCount: 1447,
      committedToGit: false,
    });
  });

  it('classifies every unique outer and nested package file', () => {
    expect(manifest.summary).toMatchObject({
      outerFilesClassified: 2225,
      nestedFilesClassified: 800,
      logicalComponents: 33,
      presentLogicalComponents: 32,
      absentRequestedLogicalComponents: 1,
      importedReviewAssets: 697,
    });
    expect(manifest.fileInventory).toHaveLength(2225);
    expect(manifest.nestedArchiveInventory).toHaveLength(800);

    const outerKeys = new Set(
      manifest.fileInventory.map((item) => `${item.sourceArchive}\u0000${item.sourceFile}`),
    );
    expect(outerKeys.size).toBe(manifest.fileInventory.length);
    for (const item of manifest.fileInventory) {
      expect(item.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(item.role).not.toBe('');
      expect(item.componentFamily).not.toBe('');
    }
  });

  it('classifies mandatory component categories without pretending that 8 items are the catalog', () => {
    const required = [
      'arduino-uno',
      'rgb-led',
      'seven-segment-display',
      'breadboard-small',
      'photoresistor',
      'dc-motor',
      'servo-motor',
      'button-tactile-6mm',
      'switch-spdt',
      'resistor-axial',
      'potentiometer',
      'electrolytic-capacitor',
      'transistor-npn',
    ];
    required.forEach((id) => expect(component(id).inventoryStatus, id).toBe('present'));
    expect(manifest.logicalComponents.length).toBeGreaterThan(8);
    expect(component('seven-segment-display').category).toBe('displays');
    expect(component('photoresistor').category).toBe('sensors');
    expect(component('dc-motor').category).toBe('motors');
  });

  it('records every owner battery-holder variant and the missing 5-cell variant honestly', () => {
    [1, 2, 3, 4, 6, 8].forEach((count) => {
      expect(component(`battery-holder-aa-${count}`)).toMatchObject({
        inventoryStatus: 'present',
        canonicalPackageStatus: 'present',
      });
    });
    expect(component('battery-holder-aa-5')).toMatchObject({
      inventoryStatus: 'absent_after_outer_and_nested_archive_scan',
      canonicalPackageStatus: 'not_present_in_canonical_svg_package',
      canonicalAssetCount: 0,
    });
    const family = stateMap.families.find((item) => item.componentId === 'battery-holder-family');
    expect(family).toMatchObject({
      presentCellCounts: [1, 2, 3, 4, 6, 8],
      absentRequestedCellCounts: [5],
    });
  });

  it('contains all six LED colours and every 0–100 brightness state', () => {
    const family = stateMap.families.find((item) => item.componentId === 'led-5mm');
    expect(Object.keys(family?.colors ?? {}).sort()).toEqual([
      'blue',
      'green',
      'orange',
      'red',
      'white',
      'yellow',
    ]);
    Object.values(family?.colors ?? {}).forEach((variants) => {
      expect(variants).toHaveLength(101);
      expect(variants.map((variant) => variant.brightnessPercent)).toEqual(
        Array.from({ length: 101 }, (_, index) => index),
      );
    });
  });

  it('contains the complete non-debug RGB LED state family', () => {
    const family = stateMap.families.find((item) => item.componentId === 'rgb-led');
    expect(family?.variants).toHaveLength(19);
    expect(family?.variants?.map((variant) => variant.state)).toEqual(
      expect.arrayContaining([
        'off',
        'red_25',
        'red_50',
        'red_100',
        'green_100',
        'blue_100',
        'cyan_100',
        'magenta_100',
        'yellow_100',
        'white_100',
        'warm_white',
        'violet_soft',
        'overcurrent_warn',
      ]),
    );
  });

  it('preserves physical, pin and breadboard metadata without guessing missing dimensions', () => {
    expect(component('battery-1.5v').physicalDimensions).toMatchObject({
      physicalWidthMm: null,
      physicalHeightMm: null,
    });
    expect(component('seven-segment-display').physicalDimensions).toMatchObject({
      physicalWidthMm: 12.7,
      physicalHeightMm: 19.05,
    });
    expect(pinMap.components.find((item) => item.componentId === 'arduino-uno')).toMatchObject({
      pinCount: 31,
      status: 'owner_manual_map',
    });
    expect(pinMap.components.find((item) => item.componentId === 'rgb-led')).toMatchObject({
      pinCount: 4,
      status: 'owner_declared',
    });
    expect(footprints.boards.map((board) => board.physical.totalTiePoints)).toEqual([
      170, 420, 882,
    ]);
    footprints.boards.forEach((board) => {
      expect(board.physical.holePitchMm).toBe(2.54);
      expect(board.holes).toHaveLength(board.physical.totalTiePoints);
      expect(board.groupCount).toBe(Object.keys(board.groups).length);
      expect(board.groupCount).toBeGreaterThan(0);
    });
  });

  it('keeps every imported review asset byte-identical to its archive hash', () => {
    expect(manifest.importedReviewAssets).toHaveLength(697);
    for (const asset of manifest.importedReviewAssets) {
      const bytes = readFileSync(resolve(auditRoot, asset.importedFile));
      expect(createHash('sha256').update(bytes).digest('hex'), asset.importedFile).toBe(
        asset.sha256,
      );
    }
  });

  it('accepts no embedded raster or opaque pixel-vectorized background as an exact SVG', () => {
    const exactAssets = manifest.importedReviewAssets.filter((asset) =>
      ['owner_verified_pack', 'owner_exact_svg'].includes(asset.acceptance),
    );
    for (const asset of exactAssets) {
      expect(asset.svg?.hasEmbeddedRaster, asset.importedFile).toBe(false);
      expect(asset.svg?.hasExternalReference, asset.importedFile).toBe(false);
      expect(asset.svg?.transparencyAudit, asset.importedFile).toBe('pass');
    }
  });
});
