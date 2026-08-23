import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SchematicComponent } from '../../api';
import { visualAsset } from '../component-catalog';
import { ordinaryLedAsset, ordinaryLedState } from '../production-asset-contracts';
import {
  configureProductionLibrary,
  ownerCatalogItems,
  productionCatalog,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';

const repositoryRoot = process.cwd();
const publicRoot = resolve(repositoryRoot, 'apps/web/public');

function runtimePath(asset: string): string {
  return resolve(publicRoot, asset.replace(/^\//, ''));
}

beforeAll(() => {
  configureProductionLibrary(
    JSON.parse(
      readFileSync(resolve(publicRoot, 'assets/electronics/owner-catalog/manifest.json'), 'utf8'),
    ) as OwnerCatalogManifest,
  );
});

describe('Electronics owner SVG foundation', () => {
  it('keeps owner evidence and source manifests intact', () => {
    expect(existsSync(resolve(publicRoot, 'assets/electronics/owner-supplied/manifest.json'))).toBe(
      true,
    );
    expect(existsSync(resolve(publicRoot, 'assets/electronics/owner-audit'))).toBe(true);
  });

  it('routes every runtime component to an owner SVG rather than generated production art', () => {
    const itemsWithOwnerArt = ownerCatalogItems().filter((item) => item.asset);
    expect(itemsWithOwnerArt.length).toBeGreaterThan(20);
    for (const item of itemsWithOwnerArt) {
      expect(item.asset, item.key).toMatch(
        /^\/assets\/electronics\/(owner-audit|owner-approved)\/.*\.svg$/,
      );
      expect(item.asset, item.key).not.toContain('/production/');
      expect(item.asset, item.key).not.toContain('/source-reference/');
      const path = runtimePath(item.asset);
      expect(existsSync(path), `${item.key}: ${path}`).toBe(true);
      const svg = readFileSync(path, 'utf8');
      expect(svg, item.key).toMatch(/<svg\b/i);
      expect(svg, item.key).not.toMatch(/<image\b|data:image|base64|<foreignObject\b|<script\b/i);
      expect(svg, item.key).not.toMatch(/(?:href|xlink:href)=["']https?:\/\//i);
    }
  });

  it('calibrates visual canvases to the breadboard while keeping pins on owner artwork', () => {
    const catalog = productionCatalog();
    const resistor = catalog.find((item) => item.key === 'resistor-axial');
    expect(resistor?.physicalSizeMm).toEqual({ width: 2.54, height: 11.582 });
    expect(resistor?.assetFit).toBe('stretch');

    const led = catalog.find((item) => item.key === 'led-5mm');
    expect(led?.physicalSizeMm).toEqual({ width: 4.8381, height: 8.0635 });
    expect((led?.terminals.anode?.xMm ?? 0) - (led?.terminals.cathode?.xMm ?? 0)).toBeCloseTo(
      2.54,
      4,
    );

    const button = catalog.find((item) => item.key === 'button-tactile-6mm');
    expect(button?.physicalSizeMm).toEqual({ width: 10, height: 10 });
    expect(
      (button?.terminals['SW-B1']?.xMm ?? 0) - (button?.terminals['SW-A1']?.xMm ?? 0),
    ).toBeCloseTo(5.08, 4);
    expect(
      (button?.terminals['SW-A2']?.yMm ?? 0) - (button?.terminals['SW-A1']?.yMm ?? 0),
    ).toBeCloseTo(7.62, 4);

    const spdt = catalog.find((item) => item.key === 'switch-spdt');
    expect(spdt?.physicalSizeMm).toEqual({ width: 7.112, height: 3.81 });
    expect(
      (spdt?.terminals.common?.xMm ?? 0) - (spdt?.terminals['throw-left']?.xMm ?? 0),
    ).toBeCloseTo(2.54, 4);

    const potentiometer = catalog.find((item) => item.key === 'potentiometer');
    expect(potentiometer?.physicalSizeMm).toEqual({ width: 12.192, height: 13.716 });
    expect(
      (potentiometer?.terminals.wiper?.xMm ?? 0) -
        (potentiometer?.terminals['terminal-1']?.xMm ?? 0),
    ).toBeCloseTo(2.54, 4);
    expect(
      (potentiometer?.terminals['terminal-2']?.xMm ?? 0) -
        (potentiometer?.terminals.wiper?.xMm ?? 0),
    ).toBeCloseTo(2.54, 4);

    const photoresistor = catalog.find((item) => item.key === 'photoresistor');
    expect(photoresistor).toMatchObject({
      enabled: true,
      simulationSupported: true,
      provenance: 'owner_supplied',
      defaultStateProperties: { illumination: 0.5 },
      viewBox: { x: 0, y: 0, width: 150, height: 177 },
    });
    expect(
      (photoresistor?.terminals['lead-1']?.xMm ?? 0) -
        (photoresistor?.terminals['lead-2']?.xMm ?? 0),
    ).toBeCloseTo(2.54, 4);
    expect(
      createHash('sha256')
        .update(readFileSync(runtimePath(photoresistor?.asset ?? '')))
        .digest('hex'),
    ).toBe('9d4ad8754adfffd7a824d324ea7ed2ed7dee3587dd0f2509ecaf68b685b5936b');

    const transistor = catalog.find((item) => item.key === 'transistor-npn');
    expect(transistor?.assetFit).toBe('meet');
    expect(transistor?.viewBox).toEqual({ x: 118, y: 54, width: 155, height: 258 });
    expect(transistor?.terminals).toMatchObject({
      base: { xMm: 2.9135, yMm: 9.6371 },
      collector: { xMm: 0.3735, yMm: 9.6371 },
      emitter: { xMm: 5.4535, yMm: 9.6371 },
    });
    expect(transistor?.footprint?.pinOffsetsMm).toEqual([
      [0, 0],
      [-2.54, 0],
      [2.54, 0],
    ]);

    const batteryOne = catalog.find((item) => item.key === 'battery-holder-aa-1');
    expect(batteryOne?.physicalSizeMm).toEqual({ width: 20, height: 60.2 });
    for (const item of catalog.filter((candidate) => candidate.familyId === 'battery-holder-aa')) {
      const svg = readFileSync(runtimePath(item.asset), 'utf8');
      expect(item.assetFit, item.key).toBe('meet');
      expect(item.physicalSizeMm.height, `${item.key}:holder-height`).toBe(60.2);
      expect(item.physicalSizeMm.width, `${item.key}:holder-width`).toBeCloseTo(
        item.viewBox.width * (20 / 283),
        3,
      );
      const topPosts = svg.match(/<g id="top-posts">([\s\S]*?)<\/g>/)?.[1] ?? '';
      const freeEnds = [
        ...topPosts.matchAll(/<rect x="([0-9.]+)" y="10" width="([0-9.]+)" height="([0-9.]+)"/g),
      ];
      expect(freeEnds, `${item.key}:wire-free-ends`).toHaveLength(2);
      for (const [index, pinId] of (['BAT-', 'BAT+'] as const).entries()) {
        const pin = item.terminals[pinId];
        const ownerFreeEnd = freeEnds[index];
        expect(pin, `${item.key}:${pinId}`).toBeDefined();
        expect(ownerFreeEnd, `${item.key}:${pinId}:owner-free-end`).toBeDefined();
        if (!ownerFreeEnd) continue;
        const ownerX = Number(ownerFreeEnd[1]) + Number(ownerFreeEnd[2]) / 2;
        expect(pin?.xMm, `${item.key}:${pinId}:wire-x`).toBeCloseTo(
          ownerX * (item.physicalSizeMm.width / item.viewBox.width),
          3,
        );
        // Centre of the drawn free end, on both axes. The horizontal coordinate
        // was already its centre while the vertical one was its top edge, so a
        // wire met the very tip of the metal — where the rounded corner is
        // already curving away — and read as not quite touching the contact.
        const ownerY = 10 + Number(ownerFreeEnd[3]) / 2;
        const ownerScale = Math.min(
          item.physicalSizeMm.width / item.viewBox.width,
          item.physicalSizeMm.height / item.viewBox.height,
        );
        const verticalInset = (item.physicalSizeMm.height - item.viewBox.height * ownerScale) / 2;
        expect(pin?.yMm, `${item.key}:${pinId}:wire-y`).toBeCloseTo(
          verticalInset + ownerY * ownerScale,
          3,
        );
      }
    }

    for (const [componentId, width, height, pinSpan] of [
      ['diode-do35', 18, 6, 10.16],
      ['diode-do41', 20, 7, 10.16],
    ] as const) {
      const diode = catalog.find((item) => item.key === componentId);
      expect(diode?.physicalSizeMm, componentId).toEqual({ width, height });
      expect(
        (diode?.terminals.cathode?.xMm ?? 0) - (diode?.terminals.anode?.xMm ?? 0),
        `${componentId}:pin-span`,
      ).toBeCloseTo(pinSpan, 4);
    }
  });

  it('keeps the selected LED package colour unlit while electrical brightness is stopped', () => {
    const led = productionCatalog().find((item) => item.key === 'led-5mm');
    expect(led).toBeDefined();
    const component: SchematicComponent = {
      id: 'led-preview',
      kind: 'led',
      componentTypeId: 'led-5mm',
      position: { x: 0, y: 0 },
      value: 2,
      stateProperties: { ledColour: 'blue', ledBrightness: 0, ledFault: 'none' },
    };

    expect(visualAsset(led!, component, 'default')).toBe(
      '/assets/electronics/owner-audit/components/led/blue/led_blue_i000.svg',
    );
    expect(
      visualAsset(
        led!,
        { ...component, stateProperties: { ...component.stateProperties, ledColour: 'green' } },
        'default',
      ),
    ).toBe('/assets/electronics/owner-audit/components/led/green/led_green_i000.svg');
    expect(visualAsset(led!, component, 'off')).toBe(
      '/assets/electronics/owner-audit/components/led/blue/led_blue_i000.svg',
    );
    expect(visualAsset(led!, component, 'reverse')).toBe(
      '/assets/electronics/owner-audit/components/led/special/led_red_reverse_polarity.svg',
    );
    expect(
      visualAsset(
        led!,
        {
          ...component,
          stateProperties: {
            ...component.stateProperties,
            ledColour: 'blue',
            ledBrightness: 60,
          },
        },
        'overcurrent',
      ),
    ).toBe('/assets/electronics/owner-audit/components/led/blue/led_blue_i060.svg');
    expect(visualAsset(led!, component, 'burned')).toBe(
      '/assets/electronics/owner-audit/components/led/special/led_red_burned.svg',
    );
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
    for (const componentId of ['battery-1.5v', 'battery-3v', 'battery-6v', 'vibration-motor']) {
      expect(ownerCatalogItems().find((item) => item.key === componentId)?.asset).toBe('');
    }
    expect(ownerCatalogItems().some((item) => item.key === 'microbit')).toBe(false);
  });

  it('removes the two scripts that generated and replaced runtime artwork', () => {
    expect(existsSync(resolve(repositoryRoot, 'tools/vectorize_owner_references.py'))).toBe(false);
    expect(
      existsSync(resolve(repositoryRoot, 'tools/build_electronics_production_assets.py')),
    ).toBe(false);
  });
});
