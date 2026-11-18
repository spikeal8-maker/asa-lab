import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseElectronicsDocument } from '@asa-lab/electronics';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { SchematicComponent } from '../../api';
import { L298nLedOverlay } from '../L298nLedOverlay';
import { l298nExternalEnablePad, terminalPosition } from '../component-catalog';
import {
  configureProductionLibrary,
  ownerCatalogItems,
  productionCatalogEntry,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';

const root = process.cwd();
const asset =
  'apps/web/public/assets/electronics/component-database/components/drivers/l298n/component.svg';
const ownerSha = '289c604c4ff4e1e74a733e2d01c18b2beab58721f6b4c5c369de37e34a425498';
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');
const manifest = JSON.parse(
  source('apps/web/public/assets/electronics/component-database/catalog.json'),
) as OwnerCatalogManifest;
const ownerItem =
  manifest.components.find((item) => item.componentId === 'l298n-motor-driver') ??
  (() => {
    throw new Error('Original L298N catalog entry missing');
  })();
configureProductionLibrary(manifest);

function board(
  enabledA: boolean,
  enabledB: boolean,
  rotation: 0 | 90 | 180 | 270 = 0,
): SchematicComponent {
  return {
    id: 'l298n-instance-1',
    kind: 'visual',
    componentTypeId: 'l298n-motor-driver',
    value: 0,
    rotation,
    position: { x: 300, y: 200 },
    pinIds: [
      ...ownerItem.pins.map((pin) => pin.id),
      ...(enabledA ? [] : ['ENA']),
      ...(enabledB ? [] : ['ENB']),
    ],
    stateProperties: {
      enaJumperInstalled: enabledA,
      enbJumperInstalled: enabledB,
      regulatorJumperInstalled: true,
    },
  };
}
const stage = source('apps/web/src/electronics/WorkbenchStage.tsx');
const sidebar = source('apps/web/src/electronics/WorkbenchSidebars.tsx');
const controller = source('apps/web/src/electronics/use-electronics-workbench.ts');
const visual = source('apps/web/src/electronics/ProductionComponentVisual.tsx');

describe('L298N full feature-branch UI/state contract (#1199 P2)', () => {
  it('enables owner-sourced 43x43-mm catalog only after integrated domain slice', () => {
    expect(ownerItem).toMatchObject({
      status: 'enabled',
      catalogTier: 'core',
      simulationSupport: 'l298n_dual_hbridge_v1',
      provenance: 'owner_supplied',
      physicalWidthMm: 43,
      physicalHeightMm: 43,
      viewBox: [0, 0, 43, 43],
      runtimeSha256: ownerSha,
    });
    const entry = productionCatalogEntry('l298n-motor-driver');
    expect(entry).toMatchObject({
      enabled: true,
      simulationSupported: true,
      defaultStateProperties: {
        enaJumperInstalled: true,
        enbJumperInstalled: true,
        regulatorJumperInstalled: true,
      },
    });
    expect(ownerCatalogItems().filter((item) => item.key === 'l298n-motor-driver')).toHaveLength(1);
    expect(ownerItem.pins).toHaveLength(11);
  });

  it('preserves the exact owner SVG and never regenerates it for logic LED state', () => {
    const bytes = readFileSync(resolve(root, asset));
    expect(bytes.length).toBe(42273);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(ownerSha);
    expect(visual).toContain("import { L298nLedOverlay } from './L298nLedOverlay'");
    expect(visual).toContain("entry.key === 'l298n-motor-driver'");
    expect(visual).toMatch(/powered=\{simulationRunning && result\?\.lit === true\}/);
  });

  it('renders LED1 at owner coordinates and only with provided committed logic state', () => {
    const off = renderToStaticMarkup(
      createElement(L298nLedOverlay, { componentId: 'driver-a', powered: false }),
    );
    const on = renderToStaticMarkup(
      createElement(L298nLedOverlay, { componentId: 'driver-a', powered: true }),
    );
    expect(off).toContain('data-l298n-led="driver-a"');
    expect(off).toContain('data-l298n-led-state="off"');
    expect(off).toContain('x="56.2"');
    expect(on).toContain('data-l298n-led-state="on"');
    expect(on).toContain('cx="60.9"');
    expect(on).toMatch(/cy="113\.8/);
    expect((on.match(/<circle/g) ?? []).length).toBe(2);
    expect((off.match(/<circle/g) ?? []).length).toBe(0);
    expect(off).not.toMatch(/<image|<animate/i);
  });

  it('makes disconnected ENA and ENB into real wire pins only with shunts removed', () => {
    const installed = board(true, true);
    expect(l298nExternalEnablePad(installed, 'ENA')).toBeNull();
    expect(l298nExternalEnablePad(installed, 'ENB')).toBeNull();
    const disconnected = board(false, false);
    expect(l298nExternalEnablePad(disconnected, 'ENA')).toEqual({ xMm: 5.63, yMm: 22.32 });
    expect(l298nExternalEnablePad(disconnected, 'ENB')).toEqual({ xMm: 5.64, yMm: 34.96 });
    for (const invalid of ['5V_EN', 'ENA_pin2', 'ENB_pin2', '+5V_EN']) {
      expect(l298nExternalEnablePad(disconnected, invalid)).toBeNull();
    }
    expect(disconnected.pinIds).toHaveLength(13);
    expect(installed.pinIds).toHaveLength(11);
  });

  it('places optional ENA and ENB on real header pad coordinates for rotations and mirroring', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const [mirrorX, mirrorY] of [
        [false, false],
        [false, true],
        [true, false],
        [true, true],
      ]) {
        const part = {
          ...board(false, false, rotation),
          stateProperties: {
            enaJumperInstalled: false,
            enbJumperInstalled: false,
            mirrorX,
            mirrorY,
          },
        };
        for (const [terminal, xMm, yMm] of [
          ['ENA', 5.63, 22.32],
          ['ENB', 5.64, 34.96],
        ] as const) {
          const result = terminalPosition(part, part.position, terminal, rotation);
          expect(result, terminal).not.toBeNull();
          const x = (mirrorX ? 43 - xMm : xMm) * 5;
          const y = (mirrorY ? 43 - yMm : yMm) * 5;
          const expected =
            rotation === 0
              ? { x, y }
              : rotation === 90
                ? { x: 215 - y, y: x }
                : rotation === 180
                  ? { x: 215 - x, y: 215 - y }
                  : { x: y, y: 215 - x };
          expect(result!.x).toBeCloseTo(300 + expected.x, 7);
          expect(result!.y).toBeCloseTo(200 + expected.y, 7);
        }
      }
    }
  });

  it('retains top-wire hit layer and only adds optional terminal hitboxes for L298N', () => {
    expect(stage).toContain('l298nExternalEnablePad');
    expect(stage).toContain("component.componentTypeId === 'l298n-motor-driver'");
    expect(stage.indexOf('data-testid="wire-layer"')).toBeLessThan(
      stage.indexOf('data-testid="terminal-overlay-layer"'),
    );
    expect(stage).toContain('data-terminal-component-id={component.id}');
    expect(stage).toContain('data-terminal-id={terminal}');
  });

  it('offers three physical shunts through standard undoable document commits, never runtime-only', () => {
    expect(sidebar).toContain('data-testid="l298n-jumper-controls"');
    for (const key of ['enaJumperInstalled', 'enbJumperInstalled', 'regulatorJumperInstalled']) {
      expect(sidebar).toContain(key);
      expect(controller).toContain(key);
    }
    expect(sidebar).toContain('disabled={c.simulationRunning}');
    expect(sidebar).toContain('c.setSelectedL298nJumper(property, event.target.checked)');
    const handler = controller.slice(
      controller.indexOf('  function setSelectedL298nJumper('),
      controller.indexOf('  function setMultimeterMeasurementMode('),
    );
    expect(handler).toContain('structuralEditAllowed()');
    expect(handler).toContain('alreadyWired');
    expect(handler).toContain('commitDocument({');
    expect(handler).toContain('pinIds');
    expect(handler).toContain('setNotice(');
    expect(handler).not.toContain('setRuntimeComponentOverride(');
  });

  it('executes the real editor jumper handler, roundtrips through the document parser and protects wired ENA', () => {
    const start = controller.indexOf('  function setSelectedL298nJumper(');
    const end = controller.indexOf('  function setMultimeterMeasurementMode(');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const exactHandler = controller.slice(start, end);
    const compiled = ts.transpileModule(exactHandler, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
    }).outputText;
    let latest: import('@asa-lab/electronics').ElectronicsDocument = {
      schemaVersion: 4,
      components: [board(true, true)],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    };
    const committed: (typeof latest)[] = [];
    let notice = '';
    const scope = {
      document: latest,
      selection: { kind: 'component', id: 'l298n-instance-1' },
      structuralEditAllowed: () => true,
      commitDocument: (next: typeof latest) => {
        committed.push(next);
        latest = next;
        scope.document = next;
      },
      setNotice: (message: string) => {
        notice = message;
      },
    };
    const toggle = runInNewContext(compiled + '\nsetSelectedL298nJumper;', scope) as (
      key: 'enaJumperInstalled' | 'enbJumperInstalled' | 'regulatorJumperInstalled',
      installed: boolean,
    ) => void;

    toggle('enaJumperInstalled', false);
    expect(committed).toHaveLength(1);
    expect(latest.components[0]?.pinIds).toContain('ENA');
    expect(latest.components[0]?.stateProperties?.enaJumperInstalled).toBe(false);
    const parsed = parseElectronicsDocument(JSON.parse(JSON.stringify(latest)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.document.components[0]?.pinIds).toContain('ENA');
    expect(parsed.document.components[0]?.stateProperties?.enaJumperInstalled).toBe(false);
    latest = parsed.document;
    scope.document = latest;

    latest = {
      ...latest,
      connections: [
        {
          id: 'pwm-wire',
          from: { componentId: 'l298n-instance-1', terminal: 'ENA' },
          to: { componentId: 'uno-1', terminal: 'd3' },
        },
      ],
    };
    scope.document = latest;
    toggle('enaJumperInstalled', true);
    expect(notice).toContain('PWM');
    expect(latest.components[0]?.stateProperties?.enaJumperInstalled).toBe(false);
    expect(committed).toHaveLength(1);

    latest = { ...latest, connections: [] };
    scope.document = latest;
    toggle('enaJumperInstalled', true);
    expect(latest.components[0]?.pinIds).not.toContain('ENA');
    expect(latest.components[0]?.stateProperties?.enaJumperInstalled).toBe(true);
    toggle('enbJumperInstalled', false);
    expect(latest.components[0]?.pinIds).toContain('ENB');
    expect(latest.components[0]?.stateProperties?.enbJumperInstalled).toBe(false);
    expect(committed).toHaveLength(3);
  });
});
