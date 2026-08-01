import {
  CATEGORY_OPTIONS,
  selectedFamilyVariant,
  visualAsset,
  type ComponentCategory,
} from './component-catalog';
import { ComponentPreview } from './component-preview';
import {
  CollapseIcon,
  DeleteIcon,
  DuplicateIcon,
  ExpandIcon,
  ListIcon,
  MinusIcon,
  RotateIcon,
  SearchIcon,
  WireIcon,
} from './workbench-icons';
import { DRAG_MIME, WIRE_COLORS } from './workbench-model';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';

function valueLabel(kind: string): string {
  if (kind === 'source') return 'Напряжение';
  if (kind === 'led' || kind === 'diode') return 'Прямое падение';
  return 'Сопротивление';
}

function formatCurrent(value: number): string {
  return `${(value * 1000).toFixed(2)} мА`;
}

export function WorkbenchSidebars({
  controller: c,
}: {
  controller: ElectronicsWorkbenchController;
}): JSX.Element {
  const measurement = c.selectedComponent
    ? c.resultByComponent.get(c.selectedComponent.id)
    : undefined;
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
                        if (family.variants.length > 1) {
                          c.toggleLibraryVariantPopover(family.familyId);
                        } else {
                          c.addFamily(family.familyId);
                        }
                      }}
                      title={family.enabled ? `Добавить: ${family.familyLabel}` : 'В разработке'}
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
                        />
                      </span>
                      <span className="workbench-catalog-name">{family.familyLabel}</span>
                    </button>
                    {family.enabled &&
                    family.variants.length > 1 &&
                    c.libraryVariantPopover === family.familyId ? (
                      <div
                        className="workbench-variant-popover"
                        role="dialog"
                        aria-label={`Варианты: ${family.familyLabel}`}
                      >
                        <strong>{family.familyLabel}</strong>
                        <div className="workbench-variant-options">
                          {family.variants.map((variant) => (
                            <button
                              key={variant.variantId}
                              type="button"
                              className={
                                selectedVariant.variantId === variant.variantId ? 'selected' : ''
                              }
                              aria-pressed={selectedVariant.variantId === variant.variantId}
                              onClick={() =>
                                c.setLibraryVariant(family.familyId, variant.variantId)
                              }
                            >
                              {variant.variantLabel}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="workbench-variant-add"
                          onClick={() => {
                            c.addFamily(family.familyId);
                            c.setLibraryVariantPopover(null);
                          }}
                        >
                          Добавить
                        </button>
                      </div>
                    ) : null}
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
                    : (c.selectedEntry?.label ?? 'Компонент')}
              </span>
              <small>{c.selection.kind === 'wire' ? 'Соединение' : 'Инспектор компонента'}</small>
            </div>
            <button
              type="button"
              onClick={() => c.setSelection(null)}
              aria-label="Закрыть параметры"
            >
              <MinusIcon />
            </button>
          </div>

          {c.selectedComponent && c.selectedEntry ? (
            <div className="workbench-inspector-body">
              <div className="workbench-inspector-preview">
                <ComponentPreview
                  preview={c.selectedEntry.preview}
                  asset={visualAsset(
                    c.selectedEntry,
                    c.selectedComponent,
                    c.componentVisualState(c.selectedComponent),
                  )}
                />
              </div>
              <p className="workbench-production-id">
                Production · {c.selectedEntry.key} · {c.selectedEntry.physicalSizeMm.width}×
                {c.selectedEntry.physicalSizeMm.height} мм
              </p>
              {c.selectedFamily && c.selectedFamily.variants.length > 1 ? (
                <label>
                  <span>Вариант</span>
                  <select
                    aria-label={`Вариант ${c.selectedFamily.familyLabel} в проекте`}
                    value={c.selectedComponent.variantId ?? c.selectedEntry.key}
                    onChange={(event) => c.setSelectedVariant(event.target.value)}
                  >
                    {c.selectedFamily.variants.map((variant) => (
                      <option key={variant.variantId} value={variant.variantId}>
                        {variant.variantLabel}
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
              {['source', 'resistor', 'led', 'potentiometer', 'diode', 'lamp'].includes(
                c.selectedComponent.kind,
              ) ? (
                <label>
                  <span>{valueLabel(c.selectedComponent.kind)}</span>
                  <div className="workbench-value-field">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={c.selectedComponent.value}
                      onChange={(event) => c.updateSelectedValue(Number(event.target.value))}
                    />
                    <span>{c.selectedEntry.unit}</span>
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
                    checked={c.selectedComponent.state === true}
                    onChange={(event) => c.setSelectedState(event.target.checked)}
                  />
                </label>
              ) : null}
              {c.selectedComponent.kind === 'button' ? (
                <button
                  type="button"
                  className="workbench-momentary-button"
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
                      {['red', 'green', 'blue', 'yellow', 'orange', 'white'].map((colour) => (
                        <option key={colour} value={colour}>
                          {colour}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>
                      Яркость: {Number(c.selectedComponent.stateProperties?.['ledBrightness'] ?? 0)}
                      %
                    </span>
                    <input
                      aria-label="Яркость обычного LED"
                      type="range"
                      min="0"
                      max="100"
                      value={Number(c.selectedComponent.stateProperties?.['ledBrightness'] ?? 0)}
                      onChange={(event) =>
                        c.setSelectedProperties({ ledBrightness: Number(event.target.value) })
                      }
                    />
                  </label>
                </fieldset>
              ) : null}

              {c.selectedEntry.key === 'rgb-led' ? (
                <fieldset className="workbench-state-controls">
                  <legend>RGB-смешение</legend>
                  {(['red', 'green', 'blue'] as const).map((channel) => (
                    <label key={channel}>
                      <span>
                        {channel.toUpperCase()}:{' '}
                        {Number(c.selectedComponent?.stateProperties?.[channel] ?? 0)}%
                      </span>
                      <input
                        aria-label={`RGB ${channel}`}
                        type="range"
                        min="0"
                        max="100"
                        value={Number(c.selectedComponent?.stateProperties?.[channel] ?? 0)}
                        onChange={(event) =>
                          c.setSelectedProperties({ [channel]: Number(event.target.value) })
                        }
                      />
                    </label>
                  ))}
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
                      <option value="common-cathode">common-cathode</option>
                      <option value="common-anode">common-anode</option>
                    </select>
                  </label>
                </fieldset>
              ) : null}

              {c.selectedEntry.key === 'seven-segment-display' ? (
                <fieldset className="workbench-state-controls">
                  <legend>Семисегментный индикатор</legend>
                  <label>
                    <span>Символ</span>
                    <select
                      aria-label="Символ семисегментного индикатора"
                      value={String(c.selectedComponent.stateProperties?.['glyph'] ?? '0')}
                      onChange={(event) =>
                        c.setSelectedProperties({ glyph: event.target.value, segmentMask: '' })
                      }
                    >
                      {['0', '8', 'A', '1', '2', '3', '4', '5', '6', '7', '9'].map((glyph) => (
                        <option key={glyph}>{glyph}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Произвольная маска (a,b,c,d,e,f,g,dp)</span>
                    <input
                      aria-label="Маска сегментов"
                      value={String(c.selectedComponent.stateProperties?.['segmentMask'] ?? '')}
                      onChange={(event) =>
                        c.setSelectedProperties({ segmentMask: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>
                      Яркость:{' '}
                      {Number(c.selectedComponent.stateProperties?.['segmentBrightness'] ?? 100)}%
                    </span>
                    <input
                      aria-label="Яркость семисегментного индикатора"
                      type="range"
                      min="0"
                      max="100"
                      value={Number(
                        c.selectedComponent.stateProperties?.['segmentBrightness'] ?? 100,
                      )}
                      onChange={(event) =>
                        c.setSelectedProperties({ segmentBrightness: Number(event.target.value) })
                      }
                    />
                  </label>
                </fieldset>
              ) : null}

              {c.selectedEntry.key === 'incandescent-lamp' ? (
                <label>
                  <span>Визуальное состояние лампы</span>
                  <select
                    aria-label="Состояние лампы"
                    value={String(c.selectedComponent.stateProperties?.['lampLevel'] ?? 'off')}
                    onChange={(event) => c.setSelectedProperties({ lampLevel: event.target.value })}
                  >
                    {['off', 'dim', 'on', 'max'].map((state) => (
                      <option key={state}>{state}</option>
                    ))}
                  </select>
                </label>
              ) : null}

              {c.selectedComponent.kind === 'breadboard' ? (
                <div className="workbench-breadboard-summary">
                  <strong>{c.selectedComponent.pinIds?.length ?? 0} отверстий</strong>
                  <span>Шаг 2,54 мм · внутренние группы активны</span>
                </div>
              ) : null}

              {!c.selectedEntry.simulationSupported && c.selectedComponent.kind !== 'breadboard' ? (
                <p className="workbench-simulation-note">
                  Визуальная production-модель. Электрическая симуляция пока не поддерживается.
                </p>
              ) : null}

              <dl className="workbench-terminal-list">
                {Object.entries(c.selectedEntry.terminals)
                  .slice(0, c.selectedComponent.kind === 'breadboard' ? 0 : undefined)
                  .map(([terminal, spec]) => (
                    <div key={terminal}>
                      <dt>Вывод {spec?.label ?? terminal}</dt>
                      <dd>
                        {c.simulationRunning
                          ? `${measurement?.terminalVoltages[terminal]?.toFixed(3) ?? '—'} В`
                          : '—'}
                      </dd>
                    </div>
                  ))}
              </dl>

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
                  {c.selectedComponent.kind === 'led' || c.selectedComponent.kind === 'lamp' ? (
                    <div>
                      <dt>Состояние</dt>
                      <dd>{measurement.lit ? 'Горит' : 'Не горит'}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              <div className="workbench-inspector-actions">
                <button type="button" onClick={c.rotateSelected}>
                  <RotateIcon /> Повернуть
                </button>
                <button type="button" onClick={c.duplicateSelected}>
                  <DuplicateIcon /> Копировать
                </button>
                <button type="button" className="danger" onClick={c.removeSelection}>
                  <DeleteIcon /> Удалить
                </button>
              </div>
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
                  <WireIcon /> Добавить/изменить изгиб
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
                  <DeleteIcon /> Удалить
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}
