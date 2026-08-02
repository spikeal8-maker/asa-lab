import { useState } from 'react';
import {
  CATEGORY_OPTIONS,
  selectedFamilyVariant,
  visualAsset,
  type ComponentCategory,
} from './component-catalog';
import { ComponentPreview } from './component-preview';
import { CollapseIcon, ExpandIcon, ListIcon, SearchIcon, WireIcon } from './workbench-icons';
import { DRAG_MIME, WIRE_COLORS } from './workbench-model';
import {
  defaultResistanceUnit,
  RESISTANCE_UNITS,
  resistanceDisplayValue,
  resistanceValueInOhms,
  type ResistanceUnit,
} from './workbench-values';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';

function valueLabel(kind: string): string {
  if (kind === 'source') return 'Напряжение';
  if (kind === 'diode') return 'Прямое падение';
  if (kind === 'potentiometer') return 'Полное сопротивление';
  if (kind === 'lamp') return 'Сопротивление нити';
  return 'Сопротивление';
}

function componentHelp(kind: string): string {
  const help: Readonly<Record<string, string>> = {
    source: 'Напряжение задаёт разность потенциалов между положительным и отрицательным выводами.',
    resistor:
      'Сопротивление ограничивает ток. Значение можно вводить в Ω, kΩ или другой выбранной единице; полосы на корпусе обновляются автоматически.',
    led: 'Цвет выбирается до запуска. Яркость, ток и перегрузка рассчитываются электрической схемой.',
    'rgb-led':
      'Каналы R, G и B рассчитываются отдельно относительно общего анода или общего катода.',
    'seven-segment': 'Сегменты A–G и DP светятся только от тока через реальные выводы индикатора.',
    button: 'Четырёхконтактная кнопка замыкает пары клемм только пока она удерживается.',
    switch: 'SPDT соединяет общий вывод с одной из двух клемм.',
    potentiometer: 'Положение движка делит полное сопротивление на два плеча.',
    diode: 'Диод проводит ток от анода к катоду после достижения прямого падения напряжения.',
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
                    draggable={family.enabled}
                    aria-disabled={!family.enabled}
                    onDragStart={(event) => {
                      if (!family.enabled) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.setData(DRAG_MIME, selectedVariant.componentTypeId);
                      event.dataTransfer.effectAllowed = 'copy';
                      const art = event.currentTarget.querySelector('.workbench-catalog-art');
                      if (art instanceof HTMLElement) {
                        const box = art.getBoundingClientRect();
                        event.dataTransfer.setDragImage(art, box.width / 2, box.height / 2);
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
                      onClick={() => {
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
              aria-label="Справка о параметрах"
              aria-expanded={helpOpen}
            >
              ?
            </button>
          </div>

          {helpOpen && c.selectedComponent ? (
            <div className="workbench-inspector-help-popover" role="note">
              {componentHelp(c.selectedComponent.kind)}
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
                      onChange={(event) =>
                        c.updateSelectedValue(
                          resistanceComponent
                            ? resistanceValueInOhms(Number(event.target.value), resistanceUnit)
                            : Number(event.target.value),
                        )
                      }
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

              {c.selectedEntry.key === 'led-5mm' ? (
                <fieldset className="workbench-state-controls">
                  <legend>Состояние LED</legend>
                  <label>
                    <span>Цвет</span>
                    <select
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
                  <div className="workbench-calculated-property">
                    <span>Расчётная яркость</span>
                    <output>{c.componentLedBrightness(c.selectedComponent)}%</output>
                    <small>Определяется током, напряжением и сопротивлением цепи.</small>
                  </div>
                </fieldset>
              ) : null}

              {c.selectedEntry.key === 'rgb-led' ? (
                <fieldset className="workbench-state-controls">
                  <legend>RGB-светодиод</legend>
                  <label>
                    <span>Общий вывод</span>
                    <select
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
                  {(['red', 'green', 'blue'] as const).map((channel) => (
                    <div className="workbench-calculated-property" key={channel}>
                      <span>{channel.toUpperCase()}</span>
                      <output>
                        {measurement?.branchBrightness?.[channel]?.toFixed(0) ?? '0'}%
                      </output>
                      <small>{formatCurrent(measurement?.branchCurrents?.[channel] ?? 0)}</small>
                    </div>
                  ))}
                </fieldset>
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

              {c.simulationRunning ? (
                <dl className="workbench-terminal-list">
                  {Object.entries(c.selectedEntry.terminals)
                    .slice(0, c.selectedComponent.kind === 'breadboard' ? 0 : undefined)
                    .map(([terminal, spec]) => (
                      <div key={terminal}>
                        <dt>Вывод {spec?.label ?? terminal}</dt>
                        <dd>{`${measurement?.terminalVoltages[terminal]?.toFixed(3) ?? '—'} В`}</dd>
                      </div>
                    ))}
                </dl>
              ) : null}

              {Object.keys(c.selectedComponent.holeBindings ?? {}).length > 0 ? (
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

              {c.simulationRunning && measurement ? (
                <dl className="workbench-measurements">
                  <div>
                    <dt>Ток</dt>
                    <dd>{formatCurrent(measurement.current)}</dd>
                  </div>
                  <div>
                    <dt>Падение</dt>
                    <dd>{measurement.voltageDrop.toFixed(3)} В</dd>
                  </div>
                  {measurement.power !== undefined ? (
                    <div>
                      <dt>Мощность</dt>
                      <dd>{measurement.power.toFixed(3)} Вт</dd>
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
