import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  configureProductionLibrary,
  ownerCatalogItems,
  productionCatalog,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';

const root = process.cwd();
const assetRelativePath =
  'apps/web/public/assets/electronics/component-database/components/drivers/l298n/component.svg';
const catalogRelativePath = 'apps/web/public/assets/electronics/component-database/catalog.json';
const manifest = JSON.parse(
  readFileSync(resolve(root, catalogRelativePath), 'utf8'),
) as OwnerCatalogManifest;
const matches = manifest.components.filter((item) => item.componentId === 'l298n-motor-driver');
const ownerSha = '289c604c4ff4e1e74a733e2d01c18b2beab58721f6b4c5c369de37e34a425498';

describe('L298N P0A owner artwork and disabled catalog intake (#1199)', () => {
  it('retains the exact owner-provided, optimized 42,273-byte SVG', () => {
    const bytes = readFileSync(resolve(root, assetRelativePath));
    const checksum = createHash('sha256').update(bytes).digest('hex');
    expect(bytes.byteLength).toBe(42273);
    expect(checksum).toBe(ownerSha);
    const xml = bytes.toString('utf8');
    expect(xml).toMatch(/<svg\b/i);
    expect(xml).not.toMatch(/<image(?:\s|>)/i);
    expect(xml).not.toMatch(/data:image\//i);
  });

  it('registers exactly one owner-supplied 43×43-mm preview, without enabling a model', () => {
    expect(manifest.schema).toBe('asa-lab.electronics-component-database.v1');
    expect(manifest.worldUnitsPerMm).toBe(5);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      componentId: 'l298n-motor-driver',
      familyId: 'l298n-motor-driver',
      category: 'motors',
      catalogTier: 'preview',
      provenance: 'owner_supplied',
      status: 'disabled_missing_model',
      physicalWidthMm: 43,
      physicalHeightMm: 43,
      viewBox: [0, 0, 43, 43],
      sourceOwnerArchive: 'ASA_LAB_L298N_INTEGRATION_v1_1_TOP_WIRES.zip',
      sourceOwnerPath: 'assets/l298n-board.display.svg',
      sourceSha256: ownerSha,
      runtimePath: '/assets/electronics/component-database/components/drivers/l298n/component.svg',
      runtimeSha256: ownerSha,
      simulationSupport: 'not_implemented_in_domain_solver',
    });
  });

  it('keeps eleven real electrical terminals separate from six configuration pads', () => {
    const entry = matches[0];
    expect(entry.pins).toHaveLength(11);
    expect(entry.pins.map((pin) => pin.id)).toEqual([
      '+12V',
      'GND',
      '+5V',
      'OUT1',
      'OUT2',
      'OUT3',
      'OUT4',
      'IN1',
      'IN2',
      'IN3',
      'IN4',
    ]);
    expect(entry.pins.map((pin) => [pin.xMm, pin.yMm])).toEqual([
      [5.23, 8.38],
      [5.23, 13.46],
      [5.23, 18.54],
      [10.85, 4.07],
      [15.93, 4.07],
      [11.7, 38.78],
      [16.78, 38.78],
      [4.84, 24.58],
      [4.84, 27.12],
      [4.84, 29.66],
      [4.84, 32.2],
    ]);
    expect(entry.stateContract).toMatchObject({
      type: 'l298n_dual_hbridge_v1',
      wireTerminals: 11,
      jumperPads: 6,
      enableJumpers: ['ENA', 'ENB'],
      regulatorJumper: '5V_EN',
      indicatorLed: 'logic_5v',
      motorChannels: 2,
    });
  });

  it('fails closed in the real production catalog adapter until solver acceptance', () => {
    configureProductionLibrary(manifest);
    const ownerEntry = ownerCatalogItems().find((item) => item.key === 'l298n-motor-driver');
    expect(ownerEntry).toMatchObject({
      catalogStatus: 'disabled_missing_model',
      enabled: false,
      simulationSupported: false,
      sourceSha256: ownerSha,
      runtimeSha256: ownerSha,
    });
    expect(productionCatalog().some((item) => item.key === 'l298n-motor-driver')).toBe(false);
  });
});
