import { describe, expect, it } from 'vitest';
import type { ComponentKind, SchematicDocument } from '../../apps/web/src/api';
import {
  WORKBENCH_VALUE_CONTROLS,
  formatComponentValue,
  validEditableValue,
} from '../../apps/web/src/electronics/component-behavior';
import {
  resetSelectionValueToNominal,
  updateSelectionValue,
} from '../../apps/web/src/electronics/workbench-document';
import { COMPONENT_VALUE_MODELS } from '../../contexts/electronics/domain/component-model';
import { parseElectronicsDocument } from '../../contexts/electronics/domain/document';

const kinds: ComponentKind[] = ['source', 'resistor', 'led', 'wire'];

function document(kind: Exclude<ComponentKind, 'wire'>, value: number): SchematicDocument {
  return {
    schemaVersion: 1,
    geometryProfile: 'breadboard-2.54mm-v1',
    components: [{ id: 'selected', kind, position: { x: 0, y: 0 }, value }],
    connections: [],
  };
}

describe('component electrical model contract', () => {
  it('keeps domain validation and web controls synchronized', () => {
    for (const kind of kinds) {
      const domain = COMPONENT_VALUE_MODELS[kind];
      const web = WORKBENCH_VALUE_CONTROLS[kind];
      expect(web).toMatchObject({
        label: domain.label,
        unit: domain.unit,
        defaultValue: domain.defaultValue,
        minimum: domain.minimum,
        maximum: domain.maximum,
        editable: domain.editable,
      });
      expect(web.presets).toEqual(domain.presets ?? []);
      expect(web.step).toBe(domain.step ?? 0);
    }
  });

  it('allows resistor edits only inside the declared range', () => {
    expect(validEditableValue('resistor', 330)).toBe(330);
    expect(validEditableValue('resistor', 1)).toBe(1);
    expect(validEditableValue('resistor', 0)).toBeNull();
    expect(validEditableValue('resistor', Number.NaN)).toBeNull();
    expect(validEditableValue('resistor', 1_000_000_001)).toBeNull();
  });

  it('does not turn fixed battery and LED assets into arbitrary devices', () => {
    expect(validEditableValue('source', 5)).toBeNull();
    expect(validEditableValue('led', 3)).toBeNull();
    expect(
      updateSelectionValue(document('source', 3), { kind: 'component', id: 'selected' }, 5),
    ).toBeNull();
    expect(
      updateSelectionValue(document('led', 2), { kind: 'component', id: 'selected' }, 3),
    ).toBeNull();
  });

  it('can explicitly restore a legacy fixed-component value to its native nominal', () => {
    const resetSource = resetSelectionValueToNominal(
      document('source', 5),
      { kind: 'component', id: 'selected' },
    );
    const resetLed = resetSelectionValueToNominal(
      document('led', 2.8),
      { kind: 'component', id: 'selected' },
    );
    expect(resetSource?.components[0]?.value).toBe(3);
    expect(resetLed?.components[0]?.value).toBe(2);
  });

  it('rejects values outside the domain model even if a client bypasses the UI', () => {
    const invalid = [
      { kind: 'source', value: 0 },
      { kind: 'source', value: 61 },
      { kind: 'resistor', value: 0 },
      { kind: 'resistor', value: 1_000_000_001 },
      { kind: 'led', value: 0.1 },
      { kind: 'led', value: 11 },
      { kind: 'wire', value: 1 },
    ];
    for (const item of invalid) {
      const parsed = parseElectronicsDocument({
        schemaVersion: 1,
        geometryProfile: 'breadboard-2.54mm-v1',
        components: [
          {
            id: 'x',
            kind: item.kind,
            position: { x: 0, y: 0 },
            value: item.value,
          },
        ],
        connections: [],
      });
      expect(parsed.ok, JSON.stringify(item)).toBe(false);
    }
  });

  it('formats educational resistor values without changing stored numbers', () => {
    expect(formatComponentValue('resistor', 330)).toBe('330 Ом');
    expect(formatComponentValue('resistor', 4_700)).toBe('4.7 кОм');
    expect(formatComponentValue('resistor', 1_000_000)).toBe('1 МОм');
    expect(formatComponentValue('source', 3)).toBe('3 В');
  });
});
