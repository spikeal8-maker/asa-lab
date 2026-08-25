import { describe, expect, it } from 'vitest';
import type { ComponentResult, SchematicComponent } from '../../api';
import { workbenchCatalog } from '../component-catalog';
import {
  componentInformationProfile,
  helpContentDigest,
  isHelpContentPublishable,
  propertyBindingPatch,
  readMetricBinding,
  readPropertyBinding,
  validateComponentInformationKinds,
} from '../component-information';
import { componentHelpSections } from '../component-help-content';

const resistor: SchematicComponent = {
  id: 'r1',
  kind: 'resistor',
  componentTypeId: 'resistor-axial',
  variantId: 'resistor-axial',
  position: { x: 0, y: 0 },
  value: 1000,
  name: 'R1',
};

const measurement: ComponentResult = {
  componentId: 'r1',
  voltageDrop: 5,
  current: 0.005,
  terminalVoltages: { a: 5, b: 0 },
  power: 0.025,
};

describe('component information registry', () => {
  it('covers every enabled catalog family through a typed component kind profile', () => {
    const enabled = workbenchCatalog().filter((family) => family.enabled);
    const kinds = enabled.flatMap((family) =>
      family.variants.filter((variant) => variant.enabled).map((variant) => variant.entry.kind),
    );
    expect(validateComponentInformationKinds(kinds)).toEqual([]);
    for (const family of enabled) {
      const variant = family.variants.find((candidate) => candidate.enabled);
      expect(variant).toBeDefined();
      const profile = componentInformationProfile(family.familyId, variant!.entry.kind);
      expect(profile.componentFamilyId).toBe(family.familyId);
      expect(profile.compactFields.map((field) => field.fieldId)).toContain('name');
    }
  });

  it('resolves property bindings without string paths', () => {
    expect(readPropertyBinding('component-name', resistor)).toBe('R1');
    expect(readPropertyBinding('resistance-ohm', resistor)).toBe(1000);
    expect(propertyBindingPatch('resistance-ohm', 2200)).toEqual({ value: 2200 });
    expect(propertyBindingPatch('led-colour', 'blue')).toEqual({
      stateProperties: { ledColour: 'blue' },
    });
  });

  it('formats only finite metrics supplied by the solver result', () => {
    expect(readMetricBinding('current', measurement)).toBe(5);
    expect(readMetricBinding('power', measurement)).toBe(0.025);
    expect(readMetricBinding('brightness', measurement)).toBeNull();
    expect(readMetricBinding('current', { ...measurement, current: Number.NaN })).toBeNull();
  });

  it('provides structured help for every component kind without HTML', () => {
    for (const family of workbenchCatalog().filter((candidate) => candidate.enabled)) {
      const variant = family.variants.find((candidate) => candidate.enabled)!;
      const sections = componentHelpSections(variant.entry.kind, variant.entry.description);
      expect(sections[0]).toMatchObject({ id: 'description', title: 'Описание' });
      expect(sections.every((section) => !/<\/?[a-z][^>]*>/i.test(section.text))).toBe(true);
    }
  });

  it('publishes help only through a matching external approval digest', () => {
    const content = {
      componentFamilyId: 'resistor',
      locale: 'ru',
      contentVersion: 1,
      contentStatus: 'approved' as const,
      sections: componentHelpSections('resistor', 'Резистор ограничивает ток.'),
    };
    const approval = {
      componentFamilyId: 'resistor',
      locale: 'ru',
      contentVersion: 1,
      contentDigest: helpContentDigest(content),
      reviewedBy: 'content-reviewer',
      engineeringApprovedBy: 'electronics-reviewer',
      ownerPublishedBy: 'owner',
      reviewedAt: '2026-08-25T18:00:00.000Z',
      sourceCommitSha: 'a'.repeat(40),
    };
    expect(isHelpContentPublishable(content, null)).toBe(false);
    expect(isHelpContentPublishable(content, approval)).toBe(true);
    expect(
      isHelpContentPublishable(
        {
          ...content,
          sections: [
            ...content.sections,
            { id: 'safety', title: 'Безопасность', text: 'Проверьте пределы.' },
          ],
        },
        approval,
      ),
    ).toBe(false);
  });
});
