import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseElectronicsDocument, solveCircuit, electricalModelFor } from '@asa-lab/electronics';
import type { SchematicDocument } from '../../api';
import {
  configureProductionLibrary,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';
import { catalogEntry, terminalPosition } from '../component-catalog';
import { ProductionComponentVisual } from '../ProductionComponentVisual';
import {
  componentAssetContainsPoint,
  preloadComponentHitMask,
  componentHitMaskStatus,
} from '../component-hit-testing';
import {
  addComponentToDocument,
  connectTerminals,
  updateSelectionState,
} from '../workbench-document';
import { normalizeLoadedDocument } from '../use-workbench-project-state';
import { applyRuntimeComponentOverrides } from '../workbench-runtime-controls';

const manifest = () =>
  JSON.parse(
    readFileSync(
      resolve('apps/web/public/assets/electronics/component-database/catalog.json'),
      'utf8',
    ),
  ) as OwnerCatalogManifest;
const empty: SchematicDocument = {
  schemaVersion: 4,
  components: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};
beforeEach(() => configureProductionLibrary(manifest()));

function circuit(open: boolean, led = false): SchematicDocument {
  let document = empty;
  for (const [type, id] of [
    ['battery-holder-aa-2', 'source'],
    ['switch-spst', 'switch'],
    ['resistor-axial', 'resistor'],
    ...(led ? [['led-5mm', 'led']] : []),
  ]) {
    document = addComponentToDocument(document, type!, { x: 0, y: 0 }, id!).document;
  }
  document = {
    ...document,
    components: document.components.map((component) =>
      component.id === 'switch' ? { ...component, state: open } : component,
    ),
  };
  for (const [id, from, terminal, to, pin] of [
    ['feed', 'source', 'BAT+', 'switch', 'common'],
    ['contact', 'switch', 'throw-left', 'resistor', 'lead-1'],
    ...(led
      ? [
          ['load', 'resistor', 'lead-2', 'led', 'anode'],
          ['return', 'led', 'cathode', 'source', 'BAT-'],
        ]
      : [['return', 'resistor', 'lead-2', 'source', 'BAT-']]),
  ]) {
    const result = connectTerminals(
      document,
      { componentId: from!, terminal: terminal! },
      { componentId: to!, terminal: pin! },
      id!,
      '#e3212b',
    );
    if (result.kind === 'created') document = result.document;
  }
  return document;
}

describe('two external terminal SPST', () => {
  it('creates a new SPST open without changing the SPDT default or saved positions', () => {
    const document = addComponentToDocument(empty, 'switch-spst', { x: 0, y: 0 }, 'new').document;
    expect(document.components[0]).toMatchObject({
      state: true,
      stateProperties: { contactState: 'open' },
    });
    const spdt = addComponentToDocument(empty, 'switch-spdt', { x: 0, y: 0 }, 'old').document;
    expect(spdt.components[0]).toMatchObject({
      state: false,
      stateProperties: { selectedThrow: 'left' },
    });
    const openCircuit = circuit(true, true);
    const actual = solveCircuit(openCircuit);
    expect(actual.solved).toBe(true);
    expect(actual.components.find((component) => component.componentId === 'switch')?.current).toBe(
      0,
    );
  });
  it.each([false, true])(
    'solves resistive/LED circuits, finite and deterministic (LED=%s)',
    (led) => {
      for (const open of [false, true]) {
        const document = circuit(open, led);
        const solved = solveCircuit(document);
        expect(solved.solved).toBe(true);
        expect(solved.numericalResidual).toBeLessThanOrEqual(solved.numericalTolerance);
        expect(JSON.stringify(solved)).toBe(JSON.stringify(solveCircuit(document)));
        const checkFinite = (value: unknown): void => {
          if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
          else if (value && typeof value === 'object') Object.values(value).forEach(checkFinite);
        };
        checkFinite(solved);
        const contact = solved.components.find((component) => component.componentId === 'switch')!;
        if (open) {
          expect(contact.current).toBe(0);
          expect(solved.current).toBeCloseTo(0, 10);
          if (led)
            expect(
              solved.components.find((component) => component.componentId === 'led')?.lit,
            ).toBe(false);
        } else {
          expect(contact.current).toBeGreaterThan(0);
          expect(contact.current).toBeCloseTo(solved.current, 8);
          if (led)
            expect(
              solved.components.find((component) => component.componentId === 'led')?.lit,
            ).toBe(true);
        }
      }
    },
  );

  it('has a distinct two-terminal model and rejects removed/missing/foreign model terminals', () => {
    const document = circuit(false);
    const contact = document.components.find((component) => component.id === 'switch')!;
    expect(contact.pinIds).toEqual(['throw-left', 'common']);
    expect(electricalModelFor(contact)).toMatchObject({
      id: 'spst-switch',
      topology: 'two-terminal',
      requiredTerminals: ['throw-left', 'common'],
    });
    expect(
      parseElectronicsDocument({
        ...document,
        connections: [
          {
            id: 'bad',
            from: { componentId: 'switch', terminal: 'throw-right' },
            to: { componentId: 'source', terminal: 'BAT-' },
          },
        ],
      }).ok,
    ).toBe(false);
    for (const change of [
      { pinIds: ['common'] },
      { pinIds: ['common', 'throw-left', 'throw-right'] },
      { electricalModelId: 'spdt-switch' },
    ]) {
      const invalid = {
        ...document,
        components: document.components.map((component) =>
          component.id === 'switch' ? { ...component, ...change } : component,
        ),
      };
      expect(solveCircuit(invalid).solved).toBe(false);
    }
    const disconnected = {
      ...document,
      connections: document.connections.filter((wire) => wire.id !== 'feed'),
    };
    expect(
      solveCircuit(disconnected).components.find((component) => component.componentId === 'switch')
        ?.current ?? 0,
    ).toBe(0);
  });

  it('roundtrips both positions, keeps b on left, and isolates runtime toggles from saved/undo documents', () => {
    for (const open of [false, true]) {
      const original = circuit(open);
      const parsed = parseElectronicsDocument(JSON.parse(JSON.stringify(original)));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const loaded = normalizeLoadedDocument(
        JSON.parse(JSON.stringify(parsed.document)) as SchematicDocument,
      );
      const contact = loaded.components.find((component) => component.id === 'switch')!;
      expect(contact.state).toBe(open);
      expect(contact.pinIds).toEqual(['throw-left', 'common']);
      expect(terminalPosition(contact, contact.position, 'b')).toEqual(
        terminalPosition(contact, contact.position, 'throw-left'),
      );
      const aliased = normalizeLoadedDocument({
        ...loaded,
        connections: loaded.connections.map((wire) =>
          wire.id === 'contact'
            ? { ...wire, from: { componentId: 'switch', terminal: 'b' } }
            : wire,
        ),
      });
      expect(aliased.connections.find((wire) => wire.id === 'contact')?.from.terminal).toBe(
        'throw-left',
      );
      const bytes = JSON.stringify(loaded);
      const runtime = applyRuntimeComponentOverrides(loaded, true, { switch: { state: !open } });
      expect(runtime?.components.find((component) => component.id === 'switch')?.state).toBe(!open);
      expect(JSON.stringify(loaded)).toBe(bytes);
      expect(applyRuntimeComponentOverrides(loaded, false, { switch: { state: !open } })).toBe(
        loaded,
      );
      const updated = updateSelectionState(
        loaded,
        { kind: 'component', id: 'switch', ids: ['switch'] },
        !open,
      )!;
      expect(
        updated.components.find((component) => component.id === 'switch')?.stateProperties
          ?.contactState,
      ).toBe(open ? 'closed' : 'open');
      expect(updated.connections).toEqual(loaded.connections);
    }
  });

  it('shares unchanged body/slider with SPDT and removes only the right normal/selection pin', async () => {
    const spst = catalogEntry('switch-spst')!;
    const spdt = catalogEntry('switch-spdt')!;
    for (const open of [false, true])
      for (const selected of [false, true]) {
        const markup = (type: string) =>
          renderToStaticMarkup(
            createElement(ProductionComponentVisual, {
              entry: catalogEntry(type)!,
              component: {
                id: 'switch',
                componentTypeId: type,
                kind: 'switch',
                position: { x: 0, y: 0 },
                value: 0,
                state: open,
              },
              width: 35.56,
              height: 19.05,
              visualState: open ? 'on' : 'default',
              selected,
            }),
          );
        const original = markup('switch-spdt');
        const derived = markup('switch-spst');
        expect(derived).toBe(
          original
            .replace('tinkercad-spdt-three-pin', 'tinkercad-spst-two-pin')
            .replaceAll(/<line x1="10"(?: y1="0")? x2="10" y2="-5"[^>]*><\/line>/g, ''),
        );
        expect(derived).not.toContain('<image');
      }
    expect(spst.physicalSizeMm).toEqual(spdt.physicalSizeMm);
    expect(spst.terminals).toEqual({
      'throw-left': spdt.terminals['throw-left'],
      common: spdt.terminals.common,
    });
    await preloadComponentHitMask(spst, 35.56, 19.05);
    expect(componentHitMaskStatus(spst, 35.56, 19.05)).toBe('missing');
    expect(componentAssetContainsPoint(spst, 35.56, 19.05, { x: 30.48, y: 18 })).toBe(false);
    expect(componentAssetContainsPoint(spst, 35.56, 19.05, { x: 5.08, y: 18 })).toBe(false);
    expect(componentAssetContainsPoint(spst, 35.56, 19.05, { x: 17.78, y: 18 })).toBe(false);
  });

  it('rejects a malformed derivation and preserves original-owner fail-closed checks', () => {
    for (const change of [
      { stateContract: { type: 'spst' } },
      { componentId: 'switch-forged' },
      { runtimeSha256: 'forged' },
    ]) {
      const data = manifest();
      const items = data.components as Array<OwnerCatalogManifest['components'][number]>;
      const index = items.findIndex((item) => item.componentId === 'switch-spst');
      items[index] = { ...items[index]!, ...change };
      expect(() => configureProductionLibrary(data)).toThrow();
    }
    const data = manifest();
    const items = data.components as Array<OwnerCatalogManifest['components'][number]>;
    const index = items.findIndex((item) => item.componentId === 'switch-spdt');
    items[index] = { ...items[index]!, runtimeSha256: 'forged' };
    expect(() => configureProductionLibrary(data)).toThrow();
  });
});
