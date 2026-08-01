import { describe, expect, it } from 'vitest';
import { OWNER_RUNTIME_ASSET_BY_ID } from '../production-manifest-adapter';

const REQUIRED_OWNER_COMPONENTS = [
  'resistor-axial',
  'led-5mm',
  'button-tactile-6mm',
  'potentiometer',
  'electrolytic-capacitor',
  'switch-spdt',
  'battery-9v',
  'breadboard-small',
  'breadboard-medium',
  'breadboard-large',
  'arduino-uno',
  'dc-motor',
  'servo-motor',
  'battery-holder-aa-1',
  'battery-holder-aa-2',
  'battery-holder-aa-3',
  'battery-holder-aa-4',
  'battery-holder-aa-6',
  'battery-holder-aa-8',
  'diode-do35',
  'diode-do41',
  'rgb-led',
  'seven-segment-display',
  'incandescent-lamp',
] as const;

describe('owner SVG runtime allowlist', () => {
  it('contains the confirmed owner component families', () => {
    for (const componentId of REQUIRED_OWNER_COMPONENTS) {
      expect(OWNER_RUNTIME_ASSET_BY_ID[componentId], componentId).toBeTruthy();
    }
  });

  it('never exposes generated production artwork, raster or source PNG references', () => {
    for (const [componentId, asset] of Object.entries(OWNER_RUNTIME_ASSET_BY_ID)) {
      expect(asset, componentId).toMatch(
        /^\/assets\/electronics\/(owner-supplied|owner-audit\/components)\//,
      );
      expect(asset, componentId).toMatch(/\.svg$/i);
      expect(asset, componentId).not.toContain('/production/');
      expect(asset, componentId).not.toContain('/source-reference/');
      expect(asset, componentId).not.toMatch(/\.(png|jpe?g|webp|gif)$/i);
    }
  });

  it('does not silently substitute missing owner SVG components', () => {
    expect(OWNER_RUNTIME_ASSET_BY_ID['battery-1.5v']).toBeUndefined();
    expect(OWNER_RUNTIME_ASSET_BY_ID['battery-3v']).toBeUndefined();
    expect(OWNER_RUNTIME_ASSET_BY_ID['battery-6v']).toBeUndefined();
    expect(OWNER_RUNTIME_ASSET_BY_ID['microbit-preview']).toBeUndefined();
    expect(OWNER_RUNTIME_ASSET_BY_ID['vibration-motor-preview']).toBeUndefined();
  });
});
