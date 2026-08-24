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
    new URL('../../../public/assets/electronics/owner-catalog/manifest.json', import.meta.url),
    'utf8',
  ),
) as OwnerCatalogManifest;

describe('owner SVG runtime catalog adapter', () => {
  it('loads the complete owner catalog and fails closed on a runtime SHA substitution', () => {
    const manifestUrl = new URL(OWNER_CATALOG_MANIFEST_URL, 'http://asa-lab.local');
    expect(manifestUrl.pathname).toBe('/assets/electronics/owner-catalog/manifest.json');
    expect(manifestUrl.searchParams.get('rev')).toBeTruthy();

    configureProductionLibrary(manifest);
    expect(ownerCatalogItems().length).toBeGreaterThan(33);
    expect(productionCatalog().length).toBeGreaterThan(0);

    // Directly owner-approved runtime SVGs live under owner-approved; every
    // other enabled part keeps its byte-exact owner archive SVG under owner-audit.
    const ownerApproved = new Set([
      'arduino-uno',
      'battery-1.5v',
      'battery-3v',
      'battery-6v',
      'battery-9v',
      'diode-do35',
      'diode-do41',
      'photoresistor',
      'piezo-disc',
      'seven-segment-display',
      'transistor-npn',
      'transistor-pnp',
      'transistor-fet',
    ]);
    for (const item of productionCatalog()) {
      expect(item.catalogStatus, item.key).toBe('enabled');
      expect(item.provenance, item.key).toBe(
        ownerApproved.has(item.key) ? 'owner_supplied' : 'exact_owner_svg',
      );
      expect(item.sourceOwnerPath, item.key).not.toBe('');
      expect(item.sourceSha256, item.key).toMatch(/^[0-9a-f]{64}$/);
      expect(item.runtimePath, item.key).toMatch(
        ownerApproved.has(item.key)
          ? /^\/assets\/electronics\/owner-approved\/.*\.svg$/
          : /^\/assets\/electronics\/owner-audit\/.*\.svg$/,
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
