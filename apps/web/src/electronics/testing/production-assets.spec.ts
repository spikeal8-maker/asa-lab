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
      readFileSync(
        resolve(publicRoot, 'assets/electronics/component-database/catalog.json'),
        'utf8',
      ),
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

  it('keeps direct owner uploads byte-exact in the component database', () => {
    const imports = JSON.parse(
      readFileSync(
        resolve(publicRoot, 'assets/electronics/component-database/owner-imports.json'),
        'utf8',
      ),
    ) as {
      imports: Array<{
        componentId: string;
        originalFileName: string;
        sha256: string;
        runtimePath: string;
        transformation: string;
      }>;
    };
    expect(imports.imports).toMatchObject([
      {
        componentId: 'battery-3v',
        originalFileName: 'cr2032_coin_battery_holder.svg',
        sha256: 'e4407e650802233542cf810d02f341934ff231f19a7e4e1aa43b4de1591687e5',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'dc-motor',
        originalFileName: 'dc_motor_top_view.svg',
        sha256: '4074817d886f6e6ec2fd9c412c28f656e26f32becd117096c4317affe2fd7d84',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'electrolytic-capacitor',
        originalFileName: 'capacitor_electrolytic.svg',
        sha256: 'd7872267d260ccb6868502e89993068c24ef5008cffd80ac584461520f88bd09',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'gearmotor',
        originalFileName: 'мотор_редуктор_arduino.svg',
        sha256: '03a40143d0b91ae5bd3f87f559a521f61ad1b161536d5b849899cf15296117dd',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'multimeter',
        originalFileName: 'multimeter_strict_path_only.svg',
        sha256: '962775623d7e6a12fcc2b9ccc2ee0888aa0a4029f6d585524fb2e40a14bad333',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'oscilloscope',
        originalFileName: 'осциллограф_компонент_без_подложки.svg',
        sha256: 'c1e1d8244d3f0e650ccb010cbe8e8e35fc1580264b9615312aa899034f6d66f8',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'pir-sensor',
        originalFileName: 'pir_sensor_555-28027_pure_vector.svg',
        sha256: '11b415352c2cf216d04e7f0caa6f290a6fa2da44a2c3879e82702e7a6e9223dc',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'piezo-passive-buzzer',
        originalFileName: 'piezo_element_component.svg',
        sha256: 'fb5dde02f30a6f736fb205473f78e6f5cc3d4fe24e772bfb2d72b21854b9a110',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'potentiometer',
        originalFileName: 'potentiometer_v4.svg',
        sha256: '2f1b10b7a2b0b5edccc39a56d892d1baab9718eea4a7b513edd6a50e9f12cee5',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'regulated-power-supply',
        originalFileName: 'reg_power_supply.svg',
        sha256: '869a2535a195f531af6eeb2ed4c0ae2cf3c6a41411319c6e141ce549642bfe6b',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'servo-motor',
        originalFileName: 'servo_motor_top_clean_v2.svg',
        sha256: '2227b5058f77028eae3909ba63f129cec1931e9be2962e2ff87f61c551fdd964',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'signal-generator',
        originalFileName: 'генератор_сигналов.svg',
        sha256: '9bdc19304ef2bc128020364b245bd9bbdc6db2cc6f8bcf2ae640cbdfb71c6196',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'soil-moisture-sensor',
        originalFileName: 'soil_moisture_sensor (2).svg',
        sha256: '09de32dc6f5dd345bf4dabdfc05496e4a188264a3e8b8f123061b766decf6bf3',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'ultrasonic-hc-sr04',
        originalFileName: 'HC_SR04_sensor_v2.svg',
        sha256: '5120ca5300c1b86c618d7dd9c5d2c88eb6c52ba4478d2b3f5bb9d9b5b5ca65be',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'ultrasonic-sensor',
        originalFileName: 'ASA_Lab_PING_3pin_sensor.svg',
        sha256: 'fcca7e406eb6a949ea3c0edd7c46c10c4a4235bf9d880ae2dd1622d37c59d96f',
        transformation: 'none_byte_exact_copy',
      },
      {
        componentId: 'vibration-motor',
        originalFileName: 'ASA_Lab_vibration_motor.svg',
        sha256: 'f17c24306a12af8c14fa5e6caee11c343bf69a67ecadbd91b3f0afbf0eaf1c1d',
        transformation: 'none_byte_exact_copy',
      },
    ]);
    for (const item of imports.imports) {
      expect(
        createHash('sha256').update(readFileSync(runtimePath(item.runtimePath))).digest('hex'),
      ).toBe(item.sha256);
    }
  });

  it('routes every runtime component to an owner SVG rather than generated production art', () => {
    const itemsWithOwnerArt = ownerCatalogItems().filter((item) => item.asset);
    expect(itemsWithOwnerArt.length).toBeGreaterThan(20);
    for (const item of itemsWithOwnerArt) {
      expect(item.asset, item.key).toMatch(
        /^\/assets\/electronics\/component-database\/components\/.*\.svg$/,
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

  it('never exposes raster artwork through component cards or state assets', () => {
    for (const item of ownerCatalogItems()) {
      for (const asset of [item.asset, ...Object.values(item.stateAssets)].filter(Boolean)) {
        expect(asset, item.key).toMatch(/\.svg$/i);
        expect(asset, item.key).not.toMatch(/\.(?:png|jpe?g|webp|gif)(?:$|[?#])/i);
      }
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
    expect(potentiometer?.physicalSizeMm).toEqual({ width: 12.192, height: 13.884 });
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

    for (const [componentId, width, height, pinSpan, axis] of [
      ['diode-do35', 6, 18, 10.16, 'y'],
      ['diode-do41', 20, 7, 10.16, 'x'],
    ] as const) {
      const diode = catalog.find((item) => item.key === componentId);
      expect(diode?.physicalSizeMm, componentId).toEqual({ width, height });
      const coordinate = axis === 'x' ? 'xMm' : 'yMm';
      expect(
        (diode?.terminals.cathode?.[coordinate] ?? 0) -
          (diode?.terminals.anode?.[coordinate] ?? 0),
        `${componentId}:pin-span-${axis}`,
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
      '/assets/electronics/component-database/components/led/blue/led_blue_i000.svg',
    );
    expect(
      visualAsset(
        led!,
        { ...component, stateProperties: { ...component.stateProperties, ledColour: 'green' } },
        'default',
      ),
    ).toBe(
      '/assets/electronics/component-database/components/led/green/led_green_i000.svg',
    );
    expect(visualAsset(led!, component, 'off')).toBe(
      '/assets/electronics/component-database/components/led/blue/led_blue_i000.svg',
    );
    expect(visualAsset(led!, component, 'reverse')).toBe(
      '/assets/electronics/component-database/components/led/special/led_red_reverse_polarity.svg',
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
    ).toBe(
      '/assets/electronics/component-database/components/led/blue/led_blue_i060.svg',
    );
    expect(visualAsset(led!, component, 'burned')).toBe(
      '/assets/electronics/component-database/components/led/special/led_red_burned.svg',
    );
  });

  it('uses the complete owner LED state family from the component database', () => {
    for (const colour of ['blue', 'green', 'orange', 'red', 'white', 'yellow'] as const) {
      for (const brightness of [0, 1, 25, 50, 75, 100]) {
        const asset = ordinaryLedAsset(ordinaryLedState(colour, brightness));
        expect(asset).toBe(
          `/assets/electronics/component-database/components/led/${colour}/led_${colour}_i${String(
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

  it('uses the owner battery SVGs while keeping genuinely missing artwork disabled', () => {
    for (const componentId of ['battery-3v']) {
      const item = ownerCatalogItems().find((candidate) => candidate.key === componentId);
      expect(item?.asset).toMatch(
        /^\/assets\/electronics\/component-database\/components\/.*\.svg$/,
      );
      expect(item).toMatchObject({ enabled: true, simulationSupported: true });
    }
    expect(ownerCatalogItems().some((item) => item.key === 'battery-1.5v')).toBe(false);
    expect(ownerCatalogItems().some((item) => item.key === 'battery-6v')).toBe(false);
    expect(ownerCatalogItems().find((item) => item.key === 'vibration-motor')).toMatchObject({
      enabled: true,
      simulationSupported: false,
    });
    expect(ownerCatalogItems().some((item) => item.key === 'microbit')).toBe(false);
  });

  it('removes the two scripts that generated and replaced runtime artwork', () => {
    expect(existsSync(resolve(repositoryRoot, 'tools/vectorize_owner_references.py'))).toBe(false);
    expect(
      existsSync(resolve(repositoryRoot, 'tools/build_electronics_production_assets.py')),
    ).toBe(false);
  });
});
