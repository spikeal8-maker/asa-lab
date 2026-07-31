import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORLD_UNITS_PER_MM, productionLibraryEligible } from '../production-asset-contracts';

interface PinAnchor {
  id: string;
  xMm: number;
  yMm: number;
  toleranceMm: number;
}

interface ProductionComponent {
  componentId: string;
  status: string;
  provenance: string | null;
  productionSvg: string | null;
  productionSha256?: string;
  physicalWidthMm: number | null;
  physicalHeightMm: number | null;
  pins: PinAnchor[];
  reviewStatus: Parameters<typeof productionLibraryEligible>[0];
  libraryEligible: boolean;
}

interface ProductionManifest {
  referenceAuditSha: string;
  worldUnitsPerMm: number;
  renderRule: string;
  summary: Record<string, number>;
  components: ProductionComponent[];
}

interface ReferenceManifest {
  referenceAuditSha: string;
  immutable: boolean;
  components: Array<{
    componentId: string;
    status: string;
    sourceFile: string | null;
    referenceFile: string | null;
    sha256: string | null;
  }>;
}

const publicRoot = resolve(process.cwd(), 'apps/web/public');
const productionRoot = resolve(publicRoot, 'assets/electronics/production');
const referenceRoot = resolve(publicRoot, 'assets/electronics/reference');
const auditRoot = resolve(publicRoot, 'assets/electronics/owner-audit');
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const manifest = readJson<ProductionManifest>(resolve(productionRoot, 'manifest.json'));
const references = readJson<ReferenceManifest>(resolve(referenceRoot, 'manifest.json'));

const digest = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const svgFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? svgFiles(path) : entry.name.endsWith('.svg') ? [path] : [];
  });

describe('Electronics production vector foundation', () => {
  it('keeps the accepted archive audit as immutable reference evidence', () => {
    expect(manifest.referenceAuditSha).toBe('9654ce3b9cd2605cb69d9b2d3f8821618364e480');
    expect(references.referenceAuditSha).toBe(manifest.referenceAuditSha);
    expect(references.immutable).toBe(true);
    for (const reference of references.components.filter(
      (item) => item.status === 'reference_found',
    )) {
      const source = resolve(publicRoot, (reference.sourceFile as string).replace(/^\//, ''));
      const copy = resolve(publicRoot, (reference.referenceFile as string).replace(/^\//, ''));
      expect(digest(source), reference.componentId).toBe(reference.sha256);
      expect(digest(copy), reference.componentId).toBe(reference.sha256);
      expect(source.startsWith(auditRoot)).toBe(true);
    }
  });

  it('represents the full 33-item catalog and keeps 5xAA honestly missing', () => {
    expect(manifest.summary).toEqual({
      logicalComponents: 33,
      candidateForOwnerReview: 32,
      missingReference: 1,
      ownerAccepted: 0,
      productionReady: 0,
    });
    const missing = manifest.components.filter((item) => item.status === 'missing_reference');
    expect(missing.map((item) => item.componentId)).toEqual(['battery-holder-aa-5']);
    for (const count of [1, 2, 3, 4, 6, 8]) {
      expect(
        manifest.components.find((item) => item.componentId === `battery-holder-aa-${count}`)
          ?.status,
      ).toBe('candidate_for_owner_review');
    }
  });

  it('uses only transparent vector production files with no raster or active content', () => {
    const files = svgFiles(productionRoot);
    expect(files.length).toBeGreaterThan(650);
    expect(
      readdirSync(productionRoot, { recursive: true }).some((name) =>
        String(name).endsWith('.png'),
      ),
    ).toBe(false);
    for (const path of files) {
      const svg = readFileSync(path, 'utf8');
      expect(svg, path).not.toMatch(/<image\b|data:image|base64|<foreignObject\b|<script\b/i);
      expect(svg, path).not.toMatch(/(?:href|xlink:href)=["']https?:\/\//i);
      expect(svg, path).not.toMatch(/checkerboard|transparency-grid|pixel-vector/i);
    }
  });

  it('derives every rendered size from physical millimetres and one world scale', () => {
    expect(manifest.worldUnitsPerMm).toBe(WORLD_UNITS_PER_MM);
    expect(manifest.renderRule).toContain('arbitrary renderWidth forbidden');
    const button = manifest.components.find((item) => item.componentId === 'button-tactile-6mm');
    expect(button?.physicalWidthMm).toBe(10);
    expect(button?.physicalHeightMm).toBe(10);
    for (const component of manifest.components.filter(
      (item) => item.status !== 'missing_reference',
    )) {
      expect(component.physicalWidthMm, component.componentId).toBeGreaterThan(0);
      expect(component.physicalHeightMm, component.componentId).toBeGreaterThan(0);
    }
  });

  it('places every declared pin on a production terminal within the 0.25mm contract', () => {
    for (const component of manifest.components.filter(
      (item) => item.status !== 'missing_reference',
    )) {
      expect(component.pins.length, component.componentId).toBeGreaterThan(0);
      const svgPath = resolve(publicRoot, (component.productionSvg as string).replace(/^\//, ''));
      const svg = readFileSync(svgPath, 'utf8');
      for (const pin of component.pins) {
        expect(pin.xMm, `${component.componentId}:${pin.id}`).toBeGreaterThanOrEqual(0);
        expect(pin.yMm, `${component.componentId}:${pin.id}`).toBeGreaterThanOrEqual(0);
        expect(pin.xMm, `${component.componentId}:${pin.id}`).toBeLessThanOrEqual(
          component.physicalWidthMm as number,
        );
        expect(pin.yMm, `${component.componentId}:${pin.id}`).toBeLessThanOrEqual(
          component.physicalHeightMm as number,
        );
        expect(pin.toleranceMm, `${component.componentId}:${pin.id}`).toBeLessThanOrEqual(0.25);
        expect(svg, `${component.componentId}:${pin.id}`).toContain(`data-pin-id="${pin.id}"`);
      }
      expect(digest(svgPath), component.componentId).toBe(component.productionSha256);
    }
  });

  it('gates all candidates until the owner accepts the production visuals', () => {
    for (const component of manifest.components) {
      expect(component.reviewStatus.owner_accepted, component.componentId).toBe(false);
      expect(component.reviewStatus.production_ready, component.componentId).toBe(false);
      expect(component.libraryEligible, component.componentId).toBe(false);
      expect(
        productionLibraryEligible(
          component.reviewStatus,
          component.reviewStatus.breadboard_fit_pass !== null,
        ),
      ).toBe(false);
    }
  });
});
