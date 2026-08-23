import { useEffect, useState } from 'react';
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

function valueLabel(kind: string): string {
  if (kind === 'source') return 'Напряжение';
  if (kind === 'diode') return 'Прямое падение';
  if (kind === 'potentiometer') return 'Полное сопротивление';
  if (kind === 'lamp') return 'Сопротивление нити';
  return 'Сопротивление';
}

function componentHelp(kind: string, componentKey?: string): string {
  if (componentKey === 'arduino-uno') {
    return 'Arduino Uno выполняет setup() один раз, затем повторяет loop(). Питание 5 В и 3,3 В доступно всегда. Ниже показаны все цифровые, аналоговые и силовые выводы; свободный вывод — нормальное состояние, а не ошибка.';
  }
  const help: Readonly<Record<string, string>> = {
    source: 'Напряжение задаёт разность потенциалов между положительным и отрицательным выводами.',
    resistor:
      'Сопротивление ограничивает ток. Значение можно вводить в Ω, kΩ или другой выбранной единице; полосы на корпусе обновляются автоматически.',
    led: 'Цвет выбирается до запуска. Яркость, ток и перегрузка рассчитываются электрической схемой.',
    'rgb-led': 'Каналы R, G и B рассчитываются отдельно относительно общего катода.',
    'seven-segment': 'Сегменты A–G и DP светятся только от тока через реальные выводы индикатора.',
    button: 'Четырёхконтактная кнопка замыкает пары клемм только пока она удерживается.',
    switch: 'SPDT соединяет общий вывод с одной из двух клемм.',
    potentiometer: 'Положение движка делит полное сопротивление на два плеча.',
    diode: 'Диод проводит ток от анода к катоду после достижения прямого падения напряжения.',
    transistor:
      'Биполярные NPN/PNP управляют током коллектора током базы; полевой (N-канал) — током стока от напряжения затвора. Модель различает отсечку, активный режим и насыщение.',
    lamp: 'Яркость лампы рассчитывается по электрической мощности на нити.',
    breadboard: 'Отверстия макетной платы соединены внутренними группами с шагом 2,54 мм.',
  };
  return help[kind] ?? 'Параметры компонента сохраняются вместе с проектом.';
}

function formatCurrent(value: number): string {
  return `${(value * 1000).toFixed(2)} мА`;
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
  const measurement = c.selectedComponent
    ? c.resultByComponent.get(c.selectedComponent.id)
    : undefined;
  const selectedIsArduino = c.selectedEntry?.key === 'arduino-uno';
  useEffect(() => setHelpOpen(false), [c.selectedComponent?.id]);
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
                const selectedVariant = selectedFamilyVariant(
                  family,
                  c.libraryVariant(family.familyId),
                );
                return (
                  <article
                    key={family.familyId}
                    className={`workbench-catalog-card${family.enabled ? '' : ' disabled'}${
                      c.libraryVariantPopover === family.familyId ? ' popover-open' : ''
                    }`}
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
                      aria-expanded={
                        family.variants.length > 1
                          ? c.libraryVariantPopover === family.familyId
                          : undefined
                      }
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
          className={`workbench-inspector${c.libraryOpen ? '' : ' library-hidden'}`}
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
            <button
              type="button"
              className="workbench-inspector-help"
              onClick={() => setHelpOpen((value) => !value)}
              aria-label={
                selectedIsArduino ? 'Показать подробные параметры Arduino' : 'Справка о параметрах'
              }
              aria-expanded={helpOpen}
            >
              ?
            </button>
          </div>

          {helpOpen && c.selectedComponent ? (
            <div className="workbench-inspector-help-popover" role="note">
              {componentHelp(c.selectedComponent.kind, c.selectedEntry?.key)}
            </div>
          ) : null}

          {c.selectedComponent &&
          c.selectedEntry &&
          c.selection.kind === 'component' &&
          c.selection.ids.length === 1 ? (
            <div className="workbench-inspector-body">
              {c.selectedFamily && c.selectedFamily.variants.length > 1 ? (
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
              {selectedIsArduino ? (
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
                  <small>
                    {helpOpen
                      ? 'Подробные выводы раскрыты ниже.'
                      : 'Нажмите ?, чтобы раскрыть выводы и измерения.'}
                  </small>
                </div>
              ) : null}
              {c.selectedComponent.kind === 'piezo' ? (
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
              {['source', 'resistor', 'potentiometer', 'diode', 'lamp'].includes(
                c.selectedComponent.kind,
              ) ? (
                <label>
                  <span>{valueLabel(c.selectedComponent.kind)}</span>
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
              {c.selectedEntry.key === 'resistor-axial' ? (
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
              {c.selectedComponent.kind === 'switch' || c.selectedComponent.kind === 'button' ? (
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
              {c.selectedComponent.kind === 'button' ? (
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
              {c.selectedComponent.kind === 'potentiometer' ? (
                <label>
                  <span>
                    Положение движка: {Math.round((c.selectedComponent.wiperPosition ?? 0.5) * 100)}
                    %
                  </span>
                  <input
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

              {c.selectedComponent.kind === 'transistor' ? (
                <fieldset className="workbench-state-controls">
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
                      <span>Коэффициент усиления hFE</span>
                      <input
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
                  <div className="workbench-calculated-property">
                    <span>Рабочая область</span>
                    <output>
                      {measurement?.operatingRegion === 'saturation'
                        ? 'Насыщение'
                        : measurement?.operatingRegion === 'active'
                          ? 'Активный режим'
                          : measurement?.operatingRegion === 'ohmic'
                            ? 'Омическая область'
                            : 'Отсечка'}
                    </output>
                    <small>
                      {transistorType === 'fet'
                        ? `VGS(th) ${Number(c.selectedComponent.stateProperties?.['thresholdVoltage'] ?? 2).toFixed(1)} В · ток затвора 0`
                        : 'VBE 0,7 В · VCE(sat) 0,2 В'}
                    </small>
                  </div>
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

              {c.selectedEntry.key === 'rgb-led' ? (
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

              {c.selectedEntry.key === 'seven-segment-display' ? (
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
                  <div className="workbench-segment-measurements">
                    {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].map((segment) => (
                      <span key={segment}>
                        {segment.toUpperCase()}{' '}
                        {measurement?.branchBrightness?.[segment]?.toFixed(0) ?? '0'}%
                      </span>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {c.selectedComponent.kind === 'breadboard' ? (
                <div className="workbench-breadboard-summary">
                  <strong>{c.selectedComponent.pinIds?.length ?? 0} отверстий</strong>
                  <span>Шаг 2,54 мм · внутренние группы активны</span>
                </div>
              ) : null}

              {!['led-5mm', 'rgb-led'].includes(c.selectedEntry.key) &&
              (!selectedIsArduino || helpOpen) ? (
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

              {!['led-5mm', 'rgb-led'].includes(c.selectedEntry.key) &&
              Object.keys(c.selectedComponent.holeBindings ?? {}).length > 0 ? (
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

              {c.simulationRunning &&
              measurement &&
              !['led-5mm', 'rgb-led'].includes(c.selectedEntry.key) &&
              (!selectedIsArduino || helpOpen) ? (
                <dl className="workbench-measurements">
                  {c.selectedComponent.kind === 'transistor' ? (
                    <>
                      <div>
                        <dt>{transistorType === 'fet' ? 'Ток затвора' : 'Ток базы'}</dt>
                        <dd>{formatCurrent(measurement.baseCurrent ?? 0)}</dd>
                      </div>
                      <div>
                        <dt>{transistorType === 'fet' ? 'Ток стока' : 'Ток коллектора'}</dt>
                        <dd>{formatCurrent(measurement.collectorCurrent ?? 0)}</dd>
                      </div>
                      <div>
                        <dt>{transistorType === 'fet' ? 'Ток истока' : 'Ток эмиттера'}</dt>
                        <dd>{formatCurrent(measurement.emitterCurrent ?? 0)}</dd>
                      </div>
                    </>
                  ) : null}
                  {c.selectedComponent.kind !== 'transistor' ? (
                    <div>
                      <dt>Ток</dt>
                      <dd>{formatCurrent(measurement.current)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>
                      {c.selectedComponent.kind === 'transistor'
                        ? transistorType === 'fet'
                          ? 'VDS'
                          : 'VCE'
                        : 'Падение'}
                    </dt>
                    <dd>{measurement.voltageDrop.toFixed(3)} В</dd>
                  </div>
                  {measurement.power !== undefined ? (
                    <div>
                      <dt>Мощность</dt>
                      <dd>{measurement.power.toFixed(3)} Вт</dd>
                    </div>
                  ) : null}
                  {c.selectedComponent.kind === 'resistor' &&
                  measurement.powerUtilizationPercent !== undefined ? (
                    <div>
                      <dt>Нагрузка по мощности</dt>
                      <dd>{measurement.powerUtilizationPercent.toFixed(0)}%</dd>
                    </div>
                  ) : null}
                  {measurement.brightness !== undefined &&
                  ['led', 'rgb-led', 'seven-segment', 'lamp'].includes(c.selectedComponent.kind) ? (
                    <div>
                      <dt>Яркость</dt>
                      <dd>{measurement.brightness.toFixed(0)}%</dd>
                    </div>
                  ) : null}
                  {c.selectedComponent.kind === 'led' || c.selectedComponent.kind === 'lamp' ? (
                    <div>
                      <dt>Состояние</dt>
                      <dd>{measurement.lit ? 'Горит' : 'Не горит'}</dd>
                    </div>
                  ) : null}
                </dl>
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
