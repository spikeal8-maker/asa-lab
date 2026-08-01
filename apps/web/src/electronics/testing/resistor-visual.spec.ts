import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { resistorBandState } from '../production-asset-contracts';
import {
  configureProductionLibrary,
  productionCatalogEntry,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';

const OWNER_CATALOG = JSON.parse(
  readFileSync(
    new URL('../../../public/assets/electronics/owner-catalog/manifest.json', import.meta.url),
    'utf8',
  ),
) as OwnerCatalogManifest;

const OWNER_RESISTOR = readFileSync(
  new URL(
    '../../../public/assets/electronics/owner-audit/components/reference-candidates/resistor-axial.svg',
    import.meta.url,
  ),
  'utf8',
);

beforeAll(() => configureProductionLibrary(OWNER_CATALOG));

describe('owner axial resistor visual', () => {
  it('uses the owner archive SVG directly', () => {
    expect(productionCatalogEntry('resistor-axial')?.asset).toBe(
      '/assets/electronics/owner-audit/components/reference-candidates/resistor-axial.svg',
    );
  });

  it('keeps the owner artwork transparent and purely vector', () => {
    expect(OWNER_RESISTOR).not.toContain('<image');
    expect(OWNER_RESISTOR).not.toContain('data:image');
    expect(OWNER_RESISTOR).not.toContain('<foreignObject');
    expect(OWNER_RESISTOR).not.toContain('fill="#F4F5F6"');
    expect(OWNER_RESISTOR).not.toMatch(/<rect[^>]+width="106"[^>]+height="282"/);
  });

  it('derives resistance colour codes without replacing the owner body SVG', () => {
    expect(resistorBandState(220, 5).bands).toEqual(['red', 'red', 'brown', 'gold']);
    expect(resistorBandState(300, 5).bands).toEqual(['orange', 'black', 'brown', 'gold']);
    expect(resistorBandState(4_700, 5).bands).toEqual(['yellow', 'violet', 'red', 'gold']);
    expect(resistorBandState(10_000, 1).bands).toEqual(['brown', 'black', 'orange', 'brown']);
  });
});
