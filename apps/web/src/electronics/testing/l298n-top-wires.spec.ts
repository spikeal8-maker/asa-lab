import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { SchematicComponent } from '../../api';
import { terminalPosition } from '../component-catalog';
import {
  configureProductionLibrary,
  ownerCatalogItems,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';

const L298N = 'l298n-motor-driver';
const repositoryRoot = process.cwd();
const stageSource = readFileSync(
  resolve(repositoryRoot, 'apps/web/src/electronics/WorkbenchStage.tsx'),
  'utf8',
);
const manifest = JSON.parse(
  readFileSync(
    resolve(repositoryRoot, 'apps/web/public/assets/electronics/component-database/catalog.json'),
    'utf8',
  ),
) as OwnerCatalogManifest;

const owner = manifest.components.find((item) => item.componentId === L298N);
if (!owner) throw new Error('L298N owner catalog entry is missing');

function actualPaintPredicate() {
  // Exercise the predicate from WorkbenchStage itself, without duplicating
  // its conditions inside this test.
  const match = stageSource.match(
    /function wiresAboveComponentBody\(\{ kind, componentTypeId \}: SchematicComponent\): boolean \{([\s\S]*?)\n\}/,
  );
  if (!match) throw new Error('WorkbenchStage paint predicate was moved or renamed');
  return runInNewContext(
    `(function wiresAboveComponentBody({kind, componentTypeId}) {${match[1]}\n})`,
  ) as (component: { kind: string; componentTypeId: string }) => boolean;
}

function expectedTerminal(
  xMm: number,
  yMm: number,
  rotation: number,
  mirrorX: boolean,
  mirrorY: boolean,
): { x: number; y: number } {
  const x = mirrorX ? (43 - xMm) * 5 : xMm * 5;
  const y = mirrorY ? (43 - yMm) * 5 : yMm * 5;
  if (rotation === 90) return { x: 215 - y, y: x };
  if (rotation === 180) return { x: 215 - x, y: 215 - y };
  if (rotation === 270) return { x: y, y: 215 - x };
  return { x, y };
}

describe('L298N P0B top-wire route in the actual ASA Lab Workbench (#1199)', () => {
  it('routes only the L298N body below wires, retaining existing exceptions', () => {
    const predicate = actualPaintPredicate();
    expect(predicate({ kind: 'visual', componentTypeId: L298N })).toBe(true);
    expect(predicate({ kind: 'breadboard', componentTypeId: 'breadboard-large' })).toBe(true);
    expect(predicate({ kind: 'visual', componentTypeId: 'arduino-uno' })).toBe(true);
    expect(predicate({ kind: 'visual', componentTypeId: 'regulated-power-supply' })).toBe(true);
    for (const componentTypeId of ['dc-motor', 'gearmotor', 'led-5mm', 'resistor-axial']) {
      expect(predicate({ kind: 'visual', componentTypeId })).toBe(false);
    }
    expect(predicate({ kind: 'wire', componentTypeId: 'wire' })).toBe(false);
  });

  it('paints body before hit/wire and terminal markers above wires', () => {
    const layers = [
      'breadboard-body-layer',
      'workbench-wire-hit-layer',
      'data-testid="wire-layer"',
      'data-testid="component-body-layer"',
      'data-testid="terminal-overlay-layer"',
      'data-testid="wire-editor-layer"',
    ];
    const offsets = layers.map((layer) => stageSource.indexOf(layer));
    expect(offsets.every((offset) => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(stageSource).toMatch(/\.filter\(wiresAboveComponentBody\)[\s\S]*?renderComponentBody/);
    expect(stageSource).toMatch(
      /component\.kind !== 'wire' && !wiresAboveComponentBody\(component\)/,
    );
    expect(stageSource).toContain('renderComponentTerminalOverlay(component)');
    expect(stageSource).toContain('data-terminal-component-id={component.id}');
    expect(stageSource).toContain('data-terminal-id={terminal}');
    expect((stageSource.match(/data-testid="schematic-wire"/g) ?? []).length).toBe(1);
  });

  it('preserves 11 actual screw/header terminal identities, never six pseudo-power terminals', () => {
    expect(owner.pins).toHaveLength(11);
    expect(owner.pins.map((pin) => pin.id)).toEqual([
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
    expect(owner.stateContract).toMatchObject({
      wireTerminals: 11,
      jumperPads: 6,
      enableJumpers: ['ENA', 'ENB'],
      regulatorJumper: '5V_EN',
    });
    expect(owner.status).toBe('disabled_missing_model');
  });

  it('uses the host terminal geometry for all orientations and mirror states', () => {
    // Enable only in memory to test Workbench geometry. Never change the
    // committed catalog: until the physics model is accepted it stays disabled.
    configureProductionLibrary({
      ...manifest,
      components: manifest.components.map((item) =>
        item.componentId === L298N ? { ...item, status: 'enabled' as const } : item,
      ),
    });
    try {
      const enabledOwner = ownerCatalogItems().find((item) => item.key === L298N);
      expect(enabledOwner?.physicalSizeMm).toEqual({ width: 43, height: 43 });
      for (const rotation of [0, 90, 180, 270]) {
        for (const [mirrorX, mirrorY] of [
          [false, false],
          [true, false],
          [false, true],
          [true, true],
        ]) {
          const component = {
            id: 'test-l298n',
            kind: 'visual',
            componentTypeId: L298N,
            position: { x: 300, y: 150 },
            value: 0,
            rotation: rotation as 0 | 90 | 180 | 270,
            stateProperties: { mirrorX, mirrorY },
          } satisfies SchematicComponent;
          for (const pin of owner.pins) {
            const actual = terminalPosition(component, component.position, pin.id, rotation);
            const expected = expectedTerminal(pin.xMm, pin.yMm, rotation, mirrorX, mirrorY);
            expect(actual?.x, pin.id).toBeCloseTo(300 + expected.x, 8);
            expect(actual?.y, pin.id).toBeCloseTo(150 + expected.y, 8);
          }
        }
      }
    } finally {
      configureProductionLibrary(manifest);
    }
  });
});
