import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { resistorBandState } from '../production-asset-contracts';
import {
  configureProductionLibrary,
  productionCatalogEntry,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';

const publicRoot = resolve(process.cwd(), 'apps/web/public');
const manifest = JSON.parse(
  readFileSync(resolve(publicRoot, 'assets/electronics/owner-catalog/manifest.json'), 'utf8'),
) as OwnerCatalogManifest;

beforeAll(() => configureProductionLibrary(manifest));

describe('owner axial resistor visual', () => {
  it('uses the exact owner archive SVG selected by the fail-closed catalog', () => {
    const resistor = productionCatalogEntry('resistor-axial');
    expect(resistor).not.toBeNull();
    if (!resistor) return;
    expect(resistor.catalogStatus).toBe('enabled');
    expect(resistor.provenance).toBe('exact_owner_svg');
    expect(resistor.asset).toMatch(/^\/assets\/electronics\/owner-audit\/.*\.svg$/);
    expect(resistor.asset).not.toContain('/production/');
    expect(resistor.runtimeSha256).toBe(resistor.sourceSha256);
  });

  it('keeps the selected owner artwork vector-only and free of raster embedding', () => {
    const resistor = productionCatalogEntry('resistor-axial');
    expect(resistor).not.toBeNull();
    if (!resistor) return;
    const svg = readFileSync(resolve(publicRoot, resistor.asset.replace(/^\//, '')), 'utf8');
    expect(svg).toMatch(/<svg\b/i);
    expect(svg).not.toMatch(/<image\b|data:image|base64|<foreignObject\b|<script\b/i);
  });

  it('keeps the electrical colour-code calculation independent of the source artwork', () => {
    expect(resistorBandState(220, 5).bands).toEqual(['red', 'red', 'brown', 'gold']);
    expect(resistorBandState(300, 5).bands).toEqual(['orange', 'black', 'brown', 'gold']);
    expect(resistorBandState(4_700, 5).bands).toEqual(['yellow', 'violet', 'red', 'gold']);
    expect(resistorBandState(10_000, 1).bands).toEqual(['brown', 'black', 'orange', 'brown']);
  });
});
