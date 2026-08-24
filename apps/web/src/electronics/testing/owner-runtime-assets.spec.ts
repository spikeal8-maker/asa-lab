import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  configureProductionLibrary,
  OWNER_CATALOG_MANIFEST_URL,
  ownerCatalogItems,
  productionCatalog,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';

const manifest = JSON.parse(
  readFileSync(
    new URL('../../../public/assets/electronics/component-database/catalog.json', import.meta.url),
    'utf8',
  ),
) as OwnerCatalogManifest;

describe('owner SVG runtime catalog adapter', () => {
  it('loads the complete owner catalog and fails closed on a runtime SHA substitution', () => {
    const manifestUrl = new URL(OWNER_CATALOG_MANIFEST_URL, 'http://asa-lab.local');
    expect(manifestUrl.pathname).toBe('/assets/electronics/component-database/catalog.json');
    expect(manifestUrl.searchParams.get('rev')).toBeTruthy();

    configureProductionLibrary(manifest);
    expect(ownerCatalogItems().length).toBeGreaterThan(33);
    expect(productionCatalog().length).toBeGreaterThan(0);

    for (const item of productionCatalog()) {
      expect(item.catalogStatus, item.key).toBe('enabled');
      expect(['owner_supplied', 'exact_owner_svg'], item.key).toContain(item.provenance);
      expect(item.sourceOwnerPath, item.key).not.toBe('');
      expect(item.sourceSha256, item.key).toMatch(/^[0-9a-f]{64}$/);
      expect(item.runtimePath, item.key).toMatch(
        /^\/assets\/electronics\/component-database\/components\/.*\.svg$/,
      );
      expect(item.runtimeSha256, item.key).toBe(item.sourceSha256);
    }

    expect(ownerCatalogItems().some((entry) => entry.key === 'microbit')).toBe(false);
    const vibrationMotor = ownerCatalogItems().find((entry) => entry.key === 'vibration-motor');
    expect(vibrationMotor?.catalogStatus).toBe('disabled_missing_svg');
    expect(vibrationMotor?.enabled).toBe(false);
    expect(vibrationMotor?.asset).toBe('');

    const substitution = structuredClone(manifest) as unknown as {
      components: Array<{ status: string; runtimeSha256: string }>;
    };
    const enabled = substitution.components.find((item) => item.status === 'enabled');
    if (!enabled) throw new Error('focused fixture contains no enabled owner SVG');
    enabled.runtimeSha256 = '0'.repeat(64);

    expect(() =>
      configureProductionLibrary(substitution as unknown as OwnerCatalogManifest),
    ).toThrow(/owner catalog rejected runtime substitution/);

    const unknownScale = structuredClone(manifest) as unknown as {
      components: Array<{ status: string; physicalWidthMm: number | null }>;
    };
    const scaled = unknownScale.components.find((item) => item.status === 'enabled');
    if (!scaled) throw new Error('focused fixture contains no enabled owner SVG');
    scaled.physicalWidthMm = null;
    expect(() =>
      configureProductionLibrary(unknownScale as unknown as OwnerCatalogManifest),
    ).toThrow(/owner catalog rejected unknown physical scale/);

    const reversedLed = structuredClone(manifest) as unknown as {
      components: Array<{
        componentId: string;
        pins: Array<{ id: string; xMm: number }>;
      }>;
    };
    const led = reversedLed.components.find((item) => item.componentId === 'led-5mm');
    if (!led) throw new Error('focused fixture contains no owner LED');
    const anode = led.pins.find((pin) => pin.id === 'anode');
    const cathode = led.pins.find((pin) => pin.id === 'cathode');
    if (!anode || !cathode) throw new Error('focused fixture contains incomplete LED pins');
    [anode.xMm, cathode.xMm] = [cathode.xMm, anode.xMm];
    expect(() =>
      configureProductionLibrary(reversedLed as unknown as OwnerCatalogManifest),
    ).toThrow(/owner catalog rejected LED polarity/);
  });
});
