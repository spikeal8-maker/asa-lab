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
    expect(
      readMetricBinding('source-operating-mode', {
        ...measurement,
        sourceOperatingMode: 'absorbing',
      }),
    ).toBe('Принимает обратный ток');
    expect(
      componentInformationProfile('battery-holder', 'source').technicalMetrics.map(
        (metric) => metric.metricId,
      ),
    ).toContain('source-operating-mode');
    expect(
      readMetricBinding('junction-state', { ...measurement, junctionState: 'conducting' }),
    ).toBe('Открыт — проводит ток');
    expect(
      readMetricBinding('junction-state', { ...measurement, junctionState: 'reverse_blocking' }),
    ).toBe('Закрыт — обратное включение');
    expect(
      readMetricBinding('junction-state', {
        ...measurement,
        junctionState: 'conducting',
        lit: true,
      }),
    ).toBe('Открыт — светится');
    expect(
      readMetricBinding('junction-state', {
        ...measurement,
        junctionState: 'conducting',
        stressState: 'burned',
      }),
    ).toBe('Разрушительный режим');
    expect(
      componentInformationProfile('ordinary-led', 'led').technicalMetrics.map(
        (metric) => metric.metricId,
      ),
    ).toEqual(['junction-state', 'voltage-drop', 'current', 'power', 'brightness']);
    expect(
      readMetricBinding('operating-region', { ...measurement, operatingRegion: 'cutoff' }),
    ).toBe('Закрыт — ток нагрузки не проходит');
    expect(
      readMetricBinding('operating-region', { ...measurement, operatingRegion: 'active' }),
    ).toBe('Регулирует ток');
    expect(
      readMetricBinding('operating-region', { ...measurement, operatingRegion: 'saturation' }),
    ).toBe('Полностью открыт как ключ');
    expect(
      componentInformationProfile('transistor', 'transistor').technicalMetrics.map(
        (metric) => metric.metricId,
      ),
    ).toEqual(['voltage-drop', 'current', 'power']);
  });

  it('keeps fixed battery voltage read-only while the regulated supply remains adjustable', () => {
    expect(
      componentInformationProfile('battery-holder-aa', 'source').compactFields.map(
        (field) => field.fieldId,
      ),
    ).toEqual(['name']);
    expect(
      componentInformationProfile('regulated-power-supply', 'source').compactFields.map(
        (field) => field.fieldId,
      ),
    ).toEqual(['name', 'value']);
  });

  it('provides structured help for every component kind without HTML', () => {
    for (const family of workbenchCatalog().filter((candidate) => candidate.enabled)) {
      const variant = family.variants.find((candidate) => candidate.enabled)!;
      const sections = componentHelpSections(
        variant.entry.kind,
        variant.entry.description,
        variant.entry.key,
      );
      expect(sections[0]).toMatchObject({ id: 'description' });
      expect(sections[0]?.title.length).toBeGreaterThan(0);
      expect(sections.every((section) => !/<\/?[a-z][^>]*>/i.test(section.text))).toBe(true);
    }
  });

  it('explains why the two diode packages are not interchangeable', () => {
    const do35 = componentHelpSections('diode', 'Диод.', 'diode-do35');
    const do41 = componentHelpSections('diode', 'Диод.', 'diode-do41');
    expect(do35.map((section) => section.title)).toEqual([
      'Описание',
      'Принцип работы',
      'Чем отличаются варианты',
    ]);
    expect(do35[0]?.text).toContain('малосигнальный');
    expect(do41[0]?.text).toContain('выпрямительный');
    expect(do35.some((section) => section.title === 'Подключение')).toBe(false);
    expect(do35.at(-1)?.text).toContain('200 мА');
    expect(do41.at(-1)?.text).toContain('1 А');
  });

  it('explains the ordinary LED colour model and electrical limits without generic filler', () => {
    const sections = componentHelpSections('led', 'Светодиод.', 'led-5mm', {
      ledColour: 'blue',
    });
    expect(sections.map((section) => section.title)).toEqual([
      'Что имитируется',
      'Рабочая точка',
      'Как подобрать резистор',
      'Пределы модели',
    ]);
    expect(sections[0]?.text).toContain('синий');
    expect(sections[1]?.text).toContain('3.01 В');
    expect(sections[2]?.text).toContain('R =');
    expect(sections.at(-1)?.text).toContain('20 мА');
    expect(sections.at(-1)?.text).toContain('120 мА');
    expect(sections.some((section) => section.title === 'Подключение')).toBe(false);
  });

  it('explains potentiometer terminals and fixed battery behaviour in beginner language', () => {
    const potentiometer = componentHelpSections('potentiometer', 'Потенциометр.', 'potentiometer');
    const battery = componentHelpSections('source', 'Батарейный отсек.', 'battery-holder-aa-8');
    expect(potentiometer.at(-1)?.text).toContain('второй край тогда может оставаться свободным');
    expect(battery[0]?.text).toContain('12 В');
    expect(battery.some((section) => section.text.includes('не регулируется'))).toBe(true);
    expect(battery.some((section) => section.text.includes('нагрузку по току'))).toBe(true);
  });

  it('explains the NPN key and points beginners to the calculated operating point', () => {
    const sections = componentHelpSections('transistor', 'Транзистор.', 'transistor-npn');
    expect(sections.map((section) => section.title)).toEqual([
      'Что имитируется',
      'Как он работает',
      'NPN как ключ',
      'Если появился красный знак',
    ]);
    expect(sections[1]?.text).toContain('электронный выключатель');
    expect(sections[2]?.text).toContain('ограничивающий резистор');
    expect(sections.at(-1)?.text).toContain('не ошибку сервера');
  });

  it('shows capacitor charge data in I and explains polarity in help', () => {
    const profile = componentInformationProfile('capacitor', 'visual');
    expect(profile.compactFields.map((field) => field.fieldId)).toEqual(['name', 'capacitance']);
    expect(profile.technicalMetrics.map((metric) => metric.metricId)).toEqual([
      'capacitance',
      'voltage-drop',
      'current',
      'power',
      'charge',
      'stored-energy',
    ]);
    expect(readMetricBinding('charge', { ...measurement, chargeCoulomb: 250e-6 })).toBeCloseTo(
      250,
      12,
    );
    expect(
      readMetricBinding('stored-energy', { ...measurement, storedEnergyJoule: 0.0005 }),
    ).toBeCloseTo(0.5, 12);
    const sections = componentHelpSections('visual', 'Конденсатор.', 'electrolytic-capacitor');
    expect(sections.map((section) => section.title)).toEqual([
      'Что имитируется',
      'Заряд и разряд',
      'Полярность',
      'Допустимое напряжение',
    ]);
    expect(sections[2]?.text).toContain('Обратная полярность опасна');
  });

  it('explains the confirmed 1:48 gearmotor without pretending that gearing creates power', () => {
    const profile = componentInformationProfile('gearmotor', 'visual');
    expect(profile.technicalMetrics.map((metric) => metric.metricId)).toEqual([
      'voltage-drop',
      'current',
      'power',
    ]);
    expect(profile.terminalPresentation).toBe('full');
    const sections = componentHelpSections('visual', 'Мотор-редуктор.', 'gearmotor');
    expect(sections.map((section) => section.title)).toEqual([
      'Что имитируется',
      'Что делает редуктор',
      'Что смотреть во вкладке I',
      'Питание и нагрузка',
    ]);
    expect(sections[0]?.text).toContain('1:48');
    expect(sections[1]?.text).toContain('не создаёт дополнительную мощность');
    expect(sections[2]?.text).toContain('скорость выходного вала');
    expect(sections[3]?.text).toContain('3–6 В');
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
