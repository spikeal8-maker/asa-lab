import { useEffect, useState } from 'react';
import { ledForwardVoltageAtCurrent, ordinaryLedProfile } from '@asa-lab/electronics';
import {
  CATEGORY_OPTIONS,
  selectedFamilyVariant,
  visualAsset,
  type ComponentCategory,
} from './component-catalog';
import { ComponentPreview } from './component-preview';
import { CollapseIcon, ExpandIcon, ListIcon, SearchIcon, WireIcon } from './workbench-icons';
import { WIRE_COLORS } from './workbench-model';
import {
  defaultResistanceUnit,
  RESISTANCE_UNITS,
  resistanceDisplayValue,
  resistanceValueInOhms,
  type ResistanceUnit,
} from './workbench-values';
import { SEVEN_SEGMENT_COLOUR_OPTIONS } from './production-asset-contracts';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';
import {
  componentInformationProfile,
  readMetricBinding,
  type HelpSection,
} from './component-information';

function valueLabel(kind: string): string {
  if (kind === 'source') return 'Напряжение';
  if (kind === 'diode') return 'Прямое падение';
  if (kind === 'potentiometer') return 'Сопротивление';
  if (kind === 'lamp') return 'Сопротивление нити';
  return 'Сопротивление';
}

const LED_COLOUR_OPTIONS = [
  { value: 'green', label: 'Зелёный' },
  { value: 'yellow', label: 'Жёлтый' },
  { value: 'orange', label: 'Оранжевый' },
  { value: 'blue', label: 'Синий' },
  { value: 'red', label: 'Красный' },
  { value: 'white', label: 'Белый' },
] as const;

function projectVariantLabel(familyId: string, variantId: string, fallback: string): string {
  if (familyId === 'breadboard') {
    if (variantId === 'breadboard-small') return 'Малая — 170 точек';
    if (variantId === 'breadboard-medium') return 'Средняя — 420 точек';
    if (variantId === 'breadboard-large') return 'Большая — 882 точки';
  }
  if (familyId === 'battery-holder-aa') {
    const cells = Number(variantId.split('-').at(-1));
    if (Number.isFinite(cells)) {
      return `${cells} ${cells === 1 ? 'батарея' : cells < 5 ? 'батареи' : 'батарей'} AA — ${cells * 1.5} В`;
    }
  }
  return fallback;
}

export function WorkbenchSidebars({
  controller: c,
}: {
  controller: ElectronicsWorkbenchController;
}): JSX.Element {
  const [helpOpen, setHelpOpen] = useState(false);
  const [stateOpen, setStateOpen] = useState(false);
  const [helpSections, setHelpSections] = useState<readonly HelpSection[] | null>(null);
  const measurement = c.selectedComponent
    ? c.resultByComponent.get(c.selectedComponent.id)
    : undefined;
  const selectedIsArduino = c.selectedEntry?.key === 'arduino-uno';
  const selectedIsPotentiometer = c.selectedComponent?.kind === 'potentiometer';
  const selectedIsAdjustableSource = c.selectedEntry?.key === 'regulated-power-supply';
  const selectedDiagnostics = c.selectedComponent
    ? (c.diagnosticsByComponent.get(c.selectedComponent.id) ?? [])
    : [];
  const selectedDiagnosticSeverity = selectedDiagnostics.some(
    (diagnostic) => diagnostic.severity === 'error',
  )
    ? 'error'
    : selectedDiagnostics.some((diagnostic) => diagnostic.severity === 'warning')
      ? 'warning'
      : undefined;
  const selectedLedColour =
    c.selectedComponent?.kind === 'led'
      ? String(c.selectedComponent.stateProperties?.['ledColour'] ?? 'red')
      : null;
  const selectedLedProfile = selectedLedColour ? ordinaryLedProfile(selectedLedColour) : null;
  const selectedLedColourLabel =
    LED_COLOUR_OPTIONS.find((option) => option.value === selectedLedColour)?.label ??
    selectedLedColour;
  useEffect(() => {
    setHelpSections(null);
  }, [c.selectedComponent?.id]);
  useEffect(() => {
    if (!helpOpen || !c.selectedComponent || !c.selectedEntry) return;
    let active = true;
    setHelpSections(null);
    void import('./component-help-content').then(({ componentHelpSections }) => {
      if (active) {
        setHelpSections(
          componentHelpSections(
            c.selectedComponent!.kind,
            c.selectedEntry!.description,
            c.selectedEntry!.key,
            selectedLedColour ? { ledColour: selectedLedColour } : undefined,
          ),
        );
      }
    });
    return () => {
      active = false;
    };
  }, [c.selectedComponent, c.selectedEntry, helpOpen, selectedLedColour]);
  const informationProfile =
    c.selectedComponent && c.selectedFamily
      ? componentInformationProfile(c.selectedFamily.familyId, c.selectedComponent.kind)
      : null;
  const technicalMetrics =
    informationProfile && measurement
      ? informationProfile.technicalMetrics.flatMap((metric) => {
          const value = readMetricBinding(metric.metricBindingId, measurement);
          return value === null ? [] : [{ ...metric, value }];
        })
      : [];
  const resistanceComponent =
    c.selectedComponent && ['resistor', 'potentiometer', 'lamp'].includes(c.selectedComponent.kind)
      ? c.selectedComponent
      : null;
  const storedResistanceUnit = resistanceComponent?.stateProperties?.['resistanceUnit'];
  const resistanceUnit =
    typeof storedResistanceUnit === 'string' &&
    RESISTANCE_UNITS.some((candidate) => candidate.id === storedResistanceUnit)
      ? (storedResistanceUnit as ResistanceUnit)
      : defaultResistanceUnit(resistanceComponent?.value ?? 0);
  const transistorType = (() => {
    if (c.selectedComponent?.kind !== 'transistor') return null;
    const raw = String(c.selectedComponent.stateProperties?.['transistorType'] ?? '');
    if (raw === 'pnp' || raw === 'fet' || raw === 'npn') return raw;
    const typeId = String(
      c.selectedComponent.variantId ?? c.selectedComponent.componentTypeId ?? '',
    );
    if (typeId.includes('pnp')) return 'pnp';
    if (typeId.includes('fet')) return 'fet';
    return 'npn';
  })();
  const transistorOverloaded =
    measurement?.stressState === 'overcurrent' || measurement?.stressState === 'burned';
  const transistorStateLabel = transistorOverloaded
    ? 'Перегрузка — возможен перегрев'
    : measurement?.stressState === 'warning'
      ? 'Повышенная нагрузка'
      : measurement?.operatingRegion === 'saturation'
        ? 'Полностью открыт как ключ'
        : measurement?.operatingRegion === 'active'
          ? 'Регулирует ток'
          : measurement?.operatingRegion === 'ohmic'
            ? 'Открыт — проводит ток'
            : 'Закрыт — ток нагрузки не проходит';
  const transistorStateExplanation = transistorOverloaded
    ? (measurement?.baseCurrent ?? 0) > (measurement?.collectorCurrent ?? 0)
      ? 'Ток базы слишком большой. Добавьте ограничивающий резистор в цепь базы.'
      : 'Ток нагрузки или нагрев выше безопасного предела.'
    : measurement?.operatingRegion === 'saturation'
      ? 'Транзистор работает как замкнутый электронный выключатель.'
      : measurement?.operatingRegion === 'active'
        ? 'Небольшой ток базы управляет током нагрузки.'
        : measurement?.operatingRegion === 'ohmic'
          ? 'Канал открыт и проводит ток между стоком и истоком.'
          : 'Управляющего напряжения недостаточно для открытия.';
  return (
    <>
      <aside
        className={`workbench-library${c.libraryOpen ? '' : ' collapsed'}`}
        aria-label="Библиотека компонентов"
      >
        <button
          type="button"
          className="workbench-library-collapse"
          onClick={() => c.setLibraryOpen((value) => !value)}
          aria-label={c.libraryOpen ? 'Свернуть библиотеку' : 'Открыть библиотеку'}
        >
          {c.libraryOpen ? <ExpandIcon /> : <CollapseIcon />}
          <span className="workbench-library-handle-label">
            {c.libraryOpen ? 'Скрыть компоненты' : 'Компоненты'}
          </span>
        </button>
        {c.libraryOpen ? (
          <>
            <div className="workbench-library-heading">
              <div>
                <span>Компоненты</span>
                <select
                  value={c.category}
                  onChange={(event) => c.setCategory(event.target.value as ComponentCategory)}
                  aria-label="Категория компонентов"
                >
                  {CATEGORY_OPTIONS.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                aria-label={
                  c.libraryView === 'grid' ? 'Переключить на список' : 'Переключить на сетку'
                }
                aria-pressed={c.libraryView === 'list'}
                onClick={() => c.setLibraryView(c.libraryView === 'grid' ? 'list' : 'grid')}
              >
                <ListIcon />
              </button>
            </div>
            <label className="workbench-library-search">
              <span className="sr-only">Поиск компонентов</span>
              <input
                value={c.libraryQuery}
                onChange={(event) => c.setLibraryQuery(event.target.value)}
                placeholder="Поиск"
              />
              <SearchIcon />
            </label>
            <div
              className={`workbench-catalog-grid${c.libraryView === 'list' ? ' list-view' : ''}`}
              data-library-view={c.libraryView}
            >
              {c.filteredCatalog.map((family) => {
                const selectedVariant = selectedFamilyVariant(family, null);
                return (
                  <article
                    key={family.familyId}
                    className={`workbench-catalog-card${family.enabled ? '' : ' disabled'}`}
                    aria-disabled={!family.enabled}
                    // Pressing a card picks the part up. It used to start the
                    // browser's own drag and hand it a picture of the catalogue
                    // thumbnail, so what followed the cursor was a snapshot of the
                    // list entry rather than the component — and it was dropped
                    // through a different code path than the one clicking uses.
                    // Now both do the same thing: the component itself follows the
                    // pointer and lands where it is put.
                    onPointerDown={(event) => {
                      if (!family.enabled || event.button !== 0) return;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      c.beginFamilyPlacement(family.familyId, {
                        pointerId: event.pointerId,
                        clientX: event.clientX,
                        clientY: event.clientY,
                      });
                      event.preventDefault();
                    }}
                    onPointerMove={(event) =>
                      c.moveFamilyPlacement(event.pointerId, event.clientX, event.clientY)
                    }
                    onPointerUp={(event) => {
                      c.finishFamilyPlacement(event.pointerId, event.clientX, event.clientY);
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                    }}
                    onPointerCancel={(event) => {
                      c.cancelFamilyPlacement(event.pointerId);
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                    }}
                    data-family-id={family.familyId}
                    data-catalog-tier={family.catalogTier}
                    data-selected-variant={selectedVariant.variantId}
                  >
                    {family.enabled &&
                    family.simulationStatus === 'not_yet_supported' &&
                    selectedVariant.entry.blockReason ? (
                      <span
                        className="workbench-catalog-model-warning"
                        role="img"
                        aria-label="Математическая модель ещё не готова"
                        title="Можно размещать и соединять. Математическая модель ещё не готова."
                      >
                        !
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="workbench-catalog-add"
                      disabled={!family.enabled}
                      // The card's pointerdown already picked the part up; this
                      // stays so the catalogue is reachable from the keyboard,
                      // where there is no pointer to press.
                      onClick={(event) => {
                        if (event.detail !== 0) return;
                        c.beginFamilyPlacement(family.familyId);
                      }}
                      title={
                        family.enabled
                          ? `Добавить: ${family.familyLabel}`
                          : (family.blockReason ?? 'Недоступно')
                      }
                      aria-label={family.familyLabel}
                    >
                      <span className="workbench-catalog-art">
                        <ComponentPreview
                          preview={selectedVariant.entry.preview}
                          asset={visualAsset(selectedVariant.entry)}
                          entry={selectedVariant.entry}
                        />
                      </span>
                      <span className="workbench-catalog-copy">
                        <span className="workbench-catalog-name">{family.familyLabel}</span>
                        {c.libraryView === 'list' ? (
                          <small>{selectedVariant.entry.description}</small>
                        ) : null}
                      </span>
                      {c.libraryView === 'list' ? (
                        <span className="workbench-catalog-chevron" aria-hidden="true">
                          ›
                        </span>
                      ) : null}
                    </button>
                  </article>
                );
              })}
              {c.filteredCatalog.length === 0 ? (
                <p className="workbench-catalog-empty">Компоненты не найдены.</p>
              ) : null}
            </div>
          </>
        ) : null}
      </aside>

      {c.selection ? (
        <aside
          className={`workbench-inspector${
            selectedIsPotentiometer ? ' is-potentiometer' : ''
          }${c.libraryOpen ? '' : ' library-hidden'}`}
          aria-label="Параметры выделения"
        >
          <div className="workbench-inspector-heading">
            <div>
              <span>
                {c.selection.kind === 'wire'
                  ? 'Провод'
                  : c.selection.ids.length > 1
                    ? `Выбрано: ${c.selection.ids.length}`
                    : (c.selectedFamily?.familyLabel ?? c.selectedEntry?.label ?? 'Компонент')}
              </span>
            </div>
            {c.selectedComponent ? (
              <div className="workbench-inspector-information-actions">
                <button
                  type="button"
                  className="workbench-inspector-help"
                  onClick={() => {
                    setStateOpen((value) => !value);
                    setHelpOpen(false);
                  }}
                  aria-label={`Техническое состояние ${
                    c.selectedFamily?.familyLabel ?? c.selectedEntry?.label ?? 'компонента'
                  }`}
                  aria-expanded={stateOpen}
                  data-diagnostic-severity={selectedDiagnosticSeverity}
                >
                  i
                </button>
                <button
                  type="button"
                  className="workbench-inspector-help"
                  onClick={() => {
                    setHelpOpen((value) => !value);
                    setStateOpen(false);
                  }}
                  aria-label={`Справка о компоненте ${
                    c.selectedFamily?.familyLabel ?? c.selectedEntry?.label ?? 'компонента'
                  }`}
                  aria-expanded={helpOpen}
                  data-active={helpOpen}
                >
                  ?
                </button>
              </div>
            ) : null}
          </div>

          {helpOpen && c.selectedComponent && c.selectedEntry ? (
            <div className="workbench-inspector-help-popover" role="region" aria-label="Справка">
              {helpSections ? (
                helpSections.map((section) => (
                  <section key={section.id}>
                    <strong>{section.title}</strong>
                    <p>{section.text}</p>
                  </section>
                ))
              ) : (
                <p>Загрузка справки…</p>
              )}
            </div>
          ) : null}

          {c.selectedComponent &&
          c.selectedEntry &&
          c.selection.kind === 'component' &&
          c.selection.ids.length === 1 ? (
            <div className="workbench-inspector-body" data-testid="component-compact-properties">
              {c.selectedFamily &&
              c.selectedFamily.variants.length > 1 &&
              (!selectedIsPotentiometer || stateOpen) ? (
                <label>
                  <span>Вариант</span>
                  <select
                    aria-label={`Вариант ${c.selectedFamily.familyLabel} в проекте`}
                    value={c.selectedComponent.variantId ?? c.selectedEntry.key}
                    onChange={(event) => c.setSelectedVariant(event.target.value)}
                  >
                    {c.selectedFamily.variants.map((variant) => (
                      <option
                        key={variant.variantId}
                        value={variant.variantId}
                        disabled={!variant.enabled}
                      >
                        {projectVariantLabel(
                          c.selectedFamily?.familyId ?? '',
                          variant.variantId,
                          variant.variantLabel,
                        )}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                <span>Имя</span>
                <input
                  type="text"
                  maxLength={120}
                  value={c.selectedComponent.name ?? c.selectedEntry.label}
                  onChange={(event) => c.updateSelectedName(event.target.value)}
                />
              </label>
              {selectedIsArduino && stateOpen ? (
                <div className="workbench-arduino-summary" data-testid="arduino-compact-summary">
                  <div>
                    <strong>
                      {c.simulationRunning ? 'Моделирование выполняется' : 'Плата готова'}
                    </strong>
                    <span>Питание: 5,0 В · 3,3 В · GND</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => c.resetArduinoRuntime(c.selectedComponent!.id)}
                    disabled={!c.simulationRunning}
                  >
                    Reset
                  </button>
                  <small>Подробные выводы показаны в техническом состоянии.</small>
                </div>
              ) : null}
              {c.selectedComponent.kind === 'piezo' && stateOpen ? (
                <div className="workbench-piezo-summary" data-testid="piezo-runtime-summary">
                  <strong>
                    {c.resultByComponent.get(c.selectedComponent.id)?.energized
                      ? 'Звук воспроизводится'
                      : 'Нет переменного сигнала'}
                  </strong>
                  <span>
                    Частота:{' '}
                    {Math.round(c.resultByComponent.get(c.selectedComponent.id)?.frequencyHz ?? 0)}{' '}
                    Гц
                  </span>
                  <small>
                    Пассивный пьезоэлемент звучит от tone() или быстрого переключения вывода, но не
                    от постоянного уровня.
                  </small>
                </div>
              ) : null}
              {selectedIsAdjustableSource ||
              c.selectedEntry.key === 'electrolytic-capacitor' ||
              ['resistor', 'potentiometer', 'lamp'].includes(c.selectedComponent.kind) ||
              (c.selectedComponent.kind === 'diode' &&
                !c.selectedComponent.componentTypeId &&
                stateOpen) ? (
                <label>
                  <span>
                    {c.selectedEntry.key === 'electrolytic-capacitor'
                      ? 'Ёмкость'
                      : valueLabel(c.selectedComponent.kind)}
                  </span>
                  <div className="workbench-value-field">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={
                        resistanceComponent
                          ? resistanceDisplayValue(c.selectedComponent.value, resistanceUnit)
                          : c.selectedComponent.value
                      }
                      onChange={(event) => {
                        const displayValue = event.target.valueAsNumber;
                        if (!Number.isFinite(displayValue)) return;
                        if (resistanceComponent) {
                          c.updateSelectedResistanceValue(
                            resistanceValueInOhms(displayValue, resistanceUnit),
                            resistanceUnit,
                          );
                        } else {
                          c.updateSelectedValue(displayValue);
                        }
                      }}
                    />
                    {resistanceComponent ? (
                      <select
                        className="workbench-unit-select"
                        aria-label="Единица сопротивления"
                        value={resistanceUnit}
                        onChange={(event) =>
                          c.setSelectedProperties({ resistanceUnit: event.target.value })
                        }
                      >
                        {RESISTANCE_UNITS.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{c.selectedEntry.unit}</span>
                    )}
                  </div>
                </label>
              ) : null}
              {c.selectedEntry.key === 'electrolytic-capacitor' && stateOpen ? (
                <label>
                  <span>Допустимое напряжение</span>
                  <div className="workbench-value-field">
                    <input
                      aria-label="Допустимое напряжение конденсатора"
                      type="number"
                      min="1"
                      max="1000"
                      step="1"
                      value={Number(
                        c.selectedComponent.stateProperties?.['voltageRatingVolt'] ?? 25,
                      )}
                      onChange={(event) =>
                        c.setSelectedProperties(
                          { voltageRatingVolt: Number(event.target.value) },
                          'Допустимое напряжение конденсатора изменено.',
                        )
                      }
                    />
                    <span>В</span>
                  </div>
                </label>
              ) : null}
              {c.selectedEntry.key === 'resistor-axial' && stateOpen ? (
                <>
                  <label>
                    <span>Допуск</span>
                    <select
                      aria-label="Допуск резистора"
                      value={String(c.selectedComponent.stateProperties?.['tolerancePercent'] ?? 5)}
                      onChange={(event) =>
                        c.setSelectedProperties(
                          { tolerancePercent: Number(event.target.value) },
                          'Допуск резистора изменён.',
                        )
                      }
                    >
                      {[1, 2, 5, 10].map((tolerance) => (
                        <option key={tolerance} value={tolerance}>
                          ±{tolerance}%
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Допустимая мощность</span>
                    <select
                      aria-label="Допустимая мощность резистора"
                      value={String(
                        c.selectedComponent.stateProperties?.['powerRatingWatt'] ?? 0.25,
                      )}
                      onChange={(event) =>
                        c.setSelectedProperties(
                          { powerRatingWatt: Number(event.target.value) },
                          'Допустимая мощность резистора изменена.',
                        )
                      }
                    >
                      {[0.125, 0.25, 0.5, 1, 2].map((watts) => (
                        <option key={watts} value={watts}>
                          {watts} Вт
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              {stateOpen &&
              (c.selectedComponent.kind === 'switch' || c.selectedComponent.kind === 'button') ? (
                <label className="workbench-toggle-property">
                  <span>
                    {c.selectedComponent.kind === 'button'
                      ? 'Кнопка нажата'
                      : 'SPDT: common → right'}
                  </span>
                  <input
                    type="checkbox"
                    disabled={!c.simulationRunning}
                    checked={c.selectedComponent.state === true}
                    onChange={(event) => c.setSelectedState(event.target.checked)}
                  />
                </label>
              ) : null}
              {c.selectedComponent.kind === 'button' && stateOpen ? (
                <button
                  type="button"
                  className="workbench-momentary-button"
                  disabled={!c.simulationRunning}
                  onPointerDown={() => c.setSelectedState(true)}
                  onPointerUp={() => c.setSelectedState(false)}
                  onPointerLeave={() => c.setSelectedState(false)}
                >
                  Удерживать кнопку
                </button>
              ) : null}
              {c.selectedComponent.kind === 'potentiometer' && stateOpen ? (
                <label>
                  <span>Положение</span>
                  <input
                    aria-label="Положение движка"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    disabled={!c.simulationRunning}
                    value={c.selectedComponent.wiperPosition ?? 0.5}
                    onChange={(event) => c.setSelectedWiper(Number(event.target.value))}
                  />
                </label>
              ) : null}

              {c.selectedComponent.kind === 'transistor' && stateOpen ? (
                <fieldset className="workbench-state-controls workbench-transistor-controls">
                  <legend>
                    {transistorType === 'fet'
                      ? 'Полевой транзистор (N-канал)'
                      : transistorType === 'pnp'
                        ? 'PNP-транзистор'
                        : 'NPN-транзистор'}
                  </legend>
                  {transistorType === 'fet' ? (
                    <label>
                      <span>Пороговое напряжение затвора, В</span>
                      <input
                        type="number"
                        min="0.5"
                        max="5"
                        step="0.1"
                        value={Number(
                          c.selectedComponent.stateProperties?.['thresholdVoltage'] ??
                            c.selectedComponent.value,
                        )}
                        onChange={(event) =>
                          c.setSelectedProperties(
                            { thresholdVoltage: Number(event.target.value) },
                            'Пороговое напряжение транзистора изменено.',
                          )
                        }
                      />
                    </label>
                  ) : (
                    <label>
                      <span>Усиление hFE</span>
                      <input
                        aria-label="Номинальный коэффициент усиления транзистора hFE"
                        type="number"
                        min="1"
                        max="1000"
                        step="1"
                        value={Number(
                          c.selectedComponent.stateProperties?.['currentGain'] ??
                            c.selectedComponent.value,
                        )}
                        onChange={(event) =>
                          c.setSelectedProperties(
                            { currentGain: Number(event.target.value) },
                            'Коэффициент усиления транзистора изменён.',
                          )
                        }
                      />
                    </label>
                  )}
                  <div
                    className={`workbench-transistor-state${transistorOverloaded ? ' overload' : ''}`}
                    data-testid="transistor-state-summary"
                  >
                    <strong>{transistorStateLabel}</strong>
                    <small>{transistorStateExplanation}</small>
                  </div>
                  {transistorType === 'npn' && measurement ? (
                    <dl className="workbench-transistor-currents" aria-label="Токи транзистора">
                      <div>
                        <dt>Ток управления (база)</dt>
                        <dd>{((measurement.baseCurrent ?? 0) * 1_000).toFixed(2)} мА</dd>
                      </div>
                      <div>
                        <dt>Ток нагрузки (коллектор)</dt>
                        <dd>{((measurement.collectorCurrent ?? 0) * 1_000).toFixed(2)} мА</dd>
                      </div>
                      <div>
                        <dt>Общий ток (эмиттер)</dt>
                        <dd>{((measurement.emitterCurrent ?? 0) * 1_000).toFixed(2)} мА</dd>
                      </div>
                    </dl>
                  ) : null}
                </fieldset>
              ) : null}

              {c.selectedEntry.key === 'led-5mm' ? (
                <label>
                  <span>цвет</span>
                  <select
                    aria-label="Цвет светодиода"
                    value={String(c.selectedComponent.stateProperties?.['ledColour'] ?? 'red')}
                    onChange={(event) =>
                      c.setSelectedProperties(
                        { ledColour: event.target.value },
                        'Цвет LED изменён.',
                      )
                    }
                  >
                    {LED_COLOUR_OPTIONS.map((colour) => (
                      <option key={colour.value} value={colour.value}>
                        {colour.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {c.selectedEntry.key === 'rgb-led' && stateOpen ? (
                <label>
                  <span>Разводка выводов</span>
                  <select
                    aria-label="Разводка выводов RGB-светодиода"
                    value={String(c.selectedComponent.stateProperties?.['pinLayout'] ?? 'RCBG')}
                    onChange={(event) =>
                      c.setSelectedProperties({
                        pinLayout: event.target.value,
                        commonMode: 'common-cathode',
                      })
                    }
                  >
                    <option value="RCBG">RCBG</option>
                    <option value="RCGB">RCGB</option>
                    <option value="BRCG">BRCG</option>
                  </select>
                </label>
              ) : null}

              {c.selectedEntry.key === 'seven-segment-display' && stateOpen ? (
                <fieldset className="workbench-state-controls">
                  <legend>Семисегментный индикатор</legend>
                  <label>
                    <span>Общий вывод</span>
                    <select
                      aria-label="Тип общего вывода семисегментного индикатора"
                      value={String(
                        c.selectedComponent.stateProperties?.['commonMode'] ?? 'common-cathode',
                      )}
                      onChange={(event) =>
                        c.setSelectedProperties({ commonMode: event.target.value })
                      }
                    >
                      <option value="common-cathode">Общий катод</option>
                      <option value="common-anode">Общий анод</option>
                    </select>
                  </label>
                  <label>
                    <span>Цвет сегментов</span>
                    <select
                      aria-label="Цвет сегментов индикатора"
                      value={String(c.selectedComponent.stateProperties?.['segmentColor'] ?? 'red')}
                      onChange={(event) =>
                        c.setSelectedProperties(
                          { segmentColor: event.target.value },
                          'Цвет индикатора изменён.',
                        )
                      }
                    >
                      {SEVEN_SEGMENT_COLOUR_OPTIONS.map((colour) => (
                        <option key={colour.value} value={colour.value}>
                          {colour.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {stateOpen ? (
                    <div className="workbench-segment-measurements">
                      {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((segment) => (
                        <span key={segment}>
                          {segment.toUpperCase()}{' '}
                          {measurement?.branchBrightness?.[segment]?.toFixed(0) ?? '0'}%
                        </span>
                      ))}
                    </div>
                  ) : null}
                </fieldset>
              ) : null}

              {c.selectedComponent.kind === 'breadboard' && stateOpen ? (
                <div className="workbench-breadboard-summary">
                  <strong>{c.selectedComponent.pinIds?.length ?? 0} отверстий</strong>
                  <span>Шаг 2,54 мм · внутренние группы активны</span>
                </div>
              ) : null}

              {stateOpen ? (
                <dl
                  className="workbench-terminal-list"
                  aria-label="Подключение выводов"
                  data-testid={selectedIsArduino ? 'arduino-pin-details' : undefined}
                >
                  {Object.entries(c.selectedEntry.terminals)
                    .slice(0, c.selectedComponent.kind === 'breadboard' ? 0 : undefined)
                    .map(([terminal, spec]) => {
                      const connected =
                        c.terminalConnectionCount(c.selectedComponent!.id, terminal) > 0;
                      const voltage = measurement?.terminalVoltages[terminal];
                      return (
                        <div key={terminal}>
                          <dt>{spec?.label ?? terminal}</dt>
                          <dd
                            className={`workbench-terminal-status${connected ? ' connected' : ''}${
                              selectedIsArduino ? ' arduino-pin-status' : ''
                            }`}
                            title={c.terminalConnectionLabel(c.selectedComponent!.id, terminal)}
                          >
                            {connected ? 'Подключён' : 'Свободен'}
                            {c.simulationRunning && voltage !== undefined
                              ? ` · ${voltage.toFixed(3)} В`
                              : ''}
                          </dd>
                        </div>
                      );
                    })}
                </dl>
              ) : null}

              {stateOpen && Object.keys(c.selectedComponent.holeBindings ?? {}).length > 0 ? (
                <div className="workbench-hole-bindings" data-testid="hole-bindings">
                  <strong>Отверстия макетки</strong>
                  {Object.entries(c.selectedComponent.holeBindings ?? {}).map(
                    ([pinId, binding]) => (
                      <span key={pinId}>
                        {pinId} → {binding.holeId}
                      </span>
                    ),
                  )}
                </div>
              ) : null}

              {stateOpen && measurement && technicalMetrics.length > 0 ? (
                <dl
                  className="workbench-measurements"
                  data-profile-family={informationProfile?.componentFamilyId}
                >
                  {technicalMetrics.map((metric) => (
                    <div key={metric.metricId}>
                      <dt>{metric.label}</dt>
                      <dd>
                        {typeof metric.value === 'number'
                          ? metric.value.toFixed(metric.precision)
                          : metric.value}{' '}
                        {metric.unit}
                      </dd>
                    </div>
                  ))}
                  {measurement.powerUtilizationPercent !== undefined ? (
                    <div>
                      <dt>Нагрузка по мощности</dt>
                      <dd>{measurement.powerUtilizationPercent.toFixed(0)}%</dd>
                    </div>
                  ) : null}
                  {measurement.currentUtilizationPercent !== undefined ? (
                    <div>
                      <dt>Нагрузка по току</dt>
                      <dd>{measurement.currentUtilizationPercent.toFixed(0)}%</dd>
                    </div>
                  ) : null}
                  {measurement.temperatureCelsius !== undefined ? (
                    <div>
                      <dt>Температура</dt>
                      <dd>{measurement.temperatureCelsius.toFixed(1)} °C</dd>
                    </div>
                  ) : null}
                  {measurement.accumulatedDamagePercent !== undefined &&
                  measurement.accumulatedDamagePercent > 0 ? (
                    <div>
                      <dt>Накопленный износ</dt>
                      <dd>{measurement.accumulatedDamagePercent.toFixed(0)}%</dd>
                    </div>
                  ) : null}
                  {measurement.internalResistanceOhm !== undefined ? (
                    <div>
                      <dt>Внутреннее сопротивление</dt>
                      <dd>{measurement.internalResistanceOhm.toFixed(3)} Ом</dd>
                    </div>
                  ) : null}
                  {measurement.voltageSag !== undefined ? (
                    <div>
                      <dt>Просадка напряжения</dt>
                      <dd>{measurement.voltageSag.toFixed(3)} В</dd>
                    </div>
                  ) : null}
                  {measurement.internalPower !== undefined ? (
                    <div>
                      <dt>Нагрев источника</dt>
                      <dd>{measurement.internalPower.toFixed(3)} Вт</dd>
                    </div>
                  ) : null}
                  {c.selectedEntry.key === 'electrolytic-capacitor' &&
                  measurement.voltageRatingVolt !== undefined ? (
                    <div>
                      <dt>Допустимое напряжение</dt>
                      <dd>{measurement.voltageRatingVolt.toFixed(0)} В</dd>
                    </div>
                  ) : null}
                  {(c.selectedComponent.kind === 'diode' || c.selectedComponent.kind === 'led') &&
                  measurement.reverseVoltageLimitVolt !== undefined ? (
                    <>
                      <div>
                        <dt>
                          {c.selectedComponent.kind === 'led'
                            ? 'Номинальный ток'
                            : 'Длительный ток'}
                        </dt>
                        <dd>
                          {((measurement.continuousCurrentLimitAmp ?? 0) * 1000).toFixed(0)} мА
                        </dd>
                      </div>
                      {c.selectedComponent.kind === 'led' &&
                      measurement.destructiveCurrentLimitAmp !== undefined ? (
                        <div>
                          <dt>Разрушительный ток</dt>
                          <dd>{(measurement.destructiveCurrentLimitAmp * 1000).toFixed(0)} мА</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Обратный предел</dt>
                        <dd>{(measurement.reverseVoltageLimitVolt ?? 0).toFixed(0)} В</dd>
                      </div>
                    </>
                  ) : null}
                  {measurement.lit !== undefined && c.selectedComponent.kind !== 'led' ? (
                    <div>
                      <dt>Состояние</dt>
                      <dd>{measurement.lit ? 'Активен' : 'Не активен'}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              {stateOpen && selectedLedProfile && selectedLedColourLabel ? (
                <dl className="workbench-measurements" data-testid="led-reference-profile">
                  <div>
                    <dt>Опорный компонент</dt>
                    <dd>Светодиод 5 мм · {selectedLedColourLabel}</dd>
                  </div>
                  <div>
                    <dt>Прямое напряжение при 20 мА</dt>
                    <dd>
                      {ledForwardVoltageAtCurrent(
                        selectedLedProfile.nominalCurrentAmp,
                        selectedLedProfile,
                      ).toFixed(2)}{' '}
                      В
                    </dd>
                  </div>
                </dl>
              ) : null}
              {stateOpen && selectedDiagnostics.length > 0 ? (
                <div
                  className="workbench-component-diagnostics"
                  data-testid="component-diagnostics"
                >
                  <strong>Диагностика схемы</strong>
                  {selectedDiagnostics.map((diagnostic) => (
                    <div key={`${diagnostic.code}:${diagnostic.message}`}>
                      <span data-severity={diagnostic.severity}>{diagnostic.message}</span>
                      {diagnostic.suggestedAction ? (
                        <small>{diagnostic.suggestedAction}</small>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {c.selectedWire ? (
            <div className="workbench-inspector-body">
              <p>Цвет провода</p>
              <div className="workbench-wire-swatches">
                {WIRE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={(c.selectedWire?.color ?? '#e3212b') === color ? 'active' : ''}
                    style={{ background: color }}
                    onClick={() => c.setWireColor(color)}
                    aria-label={`Цвет ${color}`}
                  />
                ))}
              </div>
              <div className="workbench-inspector-actions vertical">
                <button type="button" onClick={c.toggleWireRoute}>
                  <WireIcon /> Проложить автоматически под 90°
                </button>
                <button type="button" onClick={c.removeWireBends}>
                  Убрать изгибы
                </button>
                <button type="button" onClick={() => c.beginReconnect('from')}>
                  Переподключить начало
                </button>
                <button type="button" onClick={() => c.beginReconnect('to')}>
                  Переподключить конец
                </button>
                <button type="button" className="danger" onClick={c.removeSelection}>
                  Удалить
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}
