import { describe, expect, it } from 'vitest';
import {
  COMPONENT_TERMINAL_MODELS,
  COMPONENT_VALUE_MODELS,
} from '../../contexts/electronics/domain/component-model';
import {
  WORKBENCH_CATALOG,
  catalogEntry,
  terminalIds,
  terminalSpec,
} from '../../apps/web/src/electronics/component-catalog';

const activeKinds = ['source', 'resistor', 'led'] as const;

describe('visual/electrical component registry contract', () => {
  it.each(activeKinds)('%s uses the same stable terminal IDs, labels and roles in domain and UI', (kind) => {
    const entry = catalogEntry(kind)!;
    const domain = COMPONENT_TERMINAL_MODELS[kind];
    expect(terminalIds(entry)).toEqual(domain.map((terminal) => terminal.id));
    for (const expected of domain) {
      const visual = terminalSpec(entry, expected.id);
      expect(visual).toMatchObject({
        id: expected.id,
        label: expected.label,
        role: expected.role,
      });
      expect(visual?.semanticId).not.toBe('');
    }
  });

  it.each(activeKinds)('%s UI nominal and unit match the domain value model', (kind) => {
    const entry = catalogEntry(kind)!;
    const model = COMPONENT_VALUE_MODELS[kind];
    expect(entry.defaultValue).toBe(model.defaultValue);
    expect(entry.unit).toBe(model.unit);
  });

  it('has unique catalogue keys and no enabled component without a full native contract', () => {
    const keys = WORKBENCH_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of WORKBENCH_CATALOG.filter((candidate) => candidate.enabled)) {
      expect(entry.kind).not.toBeNull();
      expect(entry.asset).toMatch(/^\/assets\/electronics\/components\/.+\.svg$/);
      expect(entry.terminals.length).toBeGreaterThanOrEqual(2);
      expect(entry.renderWidth).toBeGreaterThan(0);
      expect(entry.physical.bodyMm.width).toBeGreaterThan(0);
      expect(entry.physical.bodyMm.height).toBeGreaterThan(0);
      expect(entry.physical.referenceBehaviorVerified).toBeDefined();
    }
  });

  it('keeps unavailable parts visible but electrically inert', () => {
    for (const entry of WORKBENCH_CATALOG.filter((candidate) => !candidate.enabled)) {
      expect(entry.kind).toBeNull();
      expect(entry.terminals).toEqual([]);
      expect(entry.defaultValue).toBe(0);
      expect(entry.unit).toBe('');
      expect(entry.physical.referenceBehaviorVerified).toBe(false);
    }
  });

  it('separates physical evidence from reference-behavior evidence', () => {
    const arduino = WORKBENCH_CATALOG.find((entry) => entry.key === 'arduino')!;
    expect(arduino.physical.evidence).toBe('manufacturer_official');
    expect(arduino.physical.referenceBehaviorVerified).toBe(false);
    expect(arduino.enabled).toBe(false);

    const resistor = catalogEntry('resistor')!;
    expect(resistor.physical.evidence).toBe('manufacturer_typical');
    expect(resistor.physical.referenceBehaviorVerified).toBe(false);
    expect(resistor.enabled).toBe(true);
  });
});
