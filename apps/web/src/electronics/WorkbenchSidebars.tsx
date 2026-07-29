import {
  WORKBENCH_VALUE_CONTROLS,
  formatComponentValue,
  isNominalWorkbenchValue,
} from './component-behavior';
import {
  CATEGORY_LABELS,
  componentPhysicalSummary,
  renderedSizeMillimetres,
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

export function WorkbenchSidebars({
  controller: c,
}: {
  controller: ElectronicsWorkbenchController;
}): JSX.Element {
  const valueControl = c.selectedComponent
    ? WORKBENCH_VALUE_CONTROLS[c.selectedComponent.kind]
    : null;
  const nonNominal =
    c.selectedComponent &&
    valueControl &&
    !isNominalWorkbenchValue(c.selectedComponent.kind, c.selectedComponent.value);

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
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" aria-label="Вид списка" disabled title="Список появится позже">
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
            <div className="workbench-catalog-grid">
              {c.filteredCatalog.map((entry) => {
                const disabled = !entry.enabled || c.simulationRunning;
                const disabledReason = !entry.enabled
                  ? `${entry.label}: модель и точная геометрия ещё проверяются`
                  : 'Остановите моделирование, чтобы добавить компонент';
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className={`workbench-catalog-card${entry.enabled ? '' : ' disabled'}`}
                    disabled={disabled}
                    draggable={entry.enabled && !c.simulationRunning}
                    onDragStart={(event) => {
                      if (entry.kind && !c.simulationRunning) {
                        event.dataTransfer.setData(DRAG_MIME, entry.kind);
                        event.dataTransfer.effectAllowed = 'copy';
                      }
                    }}
                    onClick={() => entry.kind && entry.kind !== 'wire' && c.addComponent(entry.kind)}
                    title={disabled ? disabledReason : `Добавить: ${entry.label}`}
                  >
                    <span className="workbench-catalog-art">
                      <ComponentPreview preview={entry.preview} asset={visualAsset(entry)} />
                    </span>
                    <span>{entry.label}</span>
                    <small>
                      {entry.enabled
                        ? componentPhysicalSummary(entry)
                        : `Скоро · ${componentPhysicalSummary(entry)}`}
                    </small>
                  </button>
                );
              })}
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
                {c.selection.kind === 'wire' ? 'Провод' : (c.selectedEntry?.label ?? 'Компонент')}
              </span>
              <small>{c.selection.kind === 'wire' ? 'Соединение' : 'Параметры компонента'}</small>
            </div>
            <button
              type="button"
              onClick={() => c.setSelection(null)}
              aria-label="Закрыть параметры"
            >
              <MinusIcon />
            </button>
          </div>
          {c.selectedComponent && c.selectedEntry && valueControl ? (
            <div className="workbench-inspector-body">
              <div className="workbench-inspector-preview">
                <ComponentPreview
                  preview={c.selectedEntry.preview}
                  asset={visualAsset(c.selectedEntry, c.componentVisualState(c.selectedComponent))}
                />
              </div>
              <dl className="workbench-measurements" aria-label="Физическая геометрия компонента">
                <div>
                  <dt>Корпус</dt>
                  <dd>{componentPhysicalSummary(c.selectedEntry)}</dd>
                </div>
                <div>
                  <dt>На поле</dt>
                  <dd>
                    {renderedSizeMillimetres(c.selectedEntry).width.toFixed(1)} ×{' '}
                    {renderedSizeMillimetres(c.selectedEntry).height.toFixed(1)} мм
                  </dd>
                </div>
                <div>
                  <dt>Масштаб</dt>
                  <dd>
                    {c.selectedEntry.physical.evidence === 'owner_asset_calibrated'
                      ? 'По авторскому asset'
                      : c.selectedEntry.physical.evidence === 'manufacturer_typical'
                        ? 'Типовой физический размер'
                        : 'Требует reference-проверки'}
                  </dd>
                </div>
              </dl>
              <label>
                <span>{valueControl.label}</span>
                <div className="workbench-value-field">
                  <input
                    type="number"
                    min={valueControl.minimum}
                    max={valueControl.maximum}
                    step={valueControl.step}
                    value={c.selectedComponent.value}
                    disabled={!valueControl.editable || c.simulationRunning}
                    aria-describedby="workbench-component-value-help"
                    onChange={(event) => c.updateSelectedValue(Number(event.target.value))}
                  />
                  <span>{valueControl.unit}</span>
                </div>
              </label>
              <p id="workbench-component-value-help" className="workbench-property-help">
                {valueControl.help}
              </p>
              {valueControl.presets.length > 0 ? (
                <div className="workbench-value-presets" aria-label="Типовые номиналы">
                  {valueControl.presets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={c.simulationRunning}
                      className={c.selectedComponent?.value === preset ? 'active' : ''}
                      onClick={() => c.updateSelectedValue(preset)}
                    >
                      {formatComponentValue(c.selectedComponent!.kind, preset)}
                    </button>
                  ))}
                </div>
              ) : null}
              {nonNominal ? (
                <div className="workbench-model-warning" role="note">
                  <strong>Legacy-номинал: {formatComponentValue(c.selectedComponent.kind, c.selectedComponent.value)}</strong>
                  <span>
                    Нативный номинал этого конкретного SVG-компонента —{' '}
                    {formatComponentValue(c.selectedComponent.kind, valueControl.defaultValue)}.
                  </span>
                  <button
                    type="button"
                    disabled={c.simulationRunning}
                    onClick={c.resetSelectedValue}
                  >
                    Вернуть нативный номинал
                  </button>
                </div>
              ) : null}
              {c.simulationRunning && c.resultByComponent.get(c.selectedComponent.id) ? (
                <dl className="workbench-measurements">
                  <div>
                    <dt>Ток</dt>
                    <dd>
                      {((c.resultByComponent.get(c.selectedComponent.id)?.current ?? 0) * 1000).toFixed(2)} мА
                    </dd>
                  </div>
                  <div>
                    <dt>Падение</dt>
                    <dd>
                      {(c.resultByComponent.get(c.selectedComponent.id)?.voltageDrop ?? 0).toFixed(3)} В
                    </dd>
                  </div>
                  {c.selectedComponent.kind === 'led' ? (
                    <div>
                      <dt>Состояние</dt>
                      <dd>
                        {c.resultByComponent.get(c.selectedComponent.id)?.lit ? 'Горит' : 'Не горит'}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              <div className="workbench-inspector-actions">
                <button type="button" onClick={c.rotateSelected} disabled={c.simulationRunning}>
                  <RotateIcon /> Повернуть
                </button>
                <button type="button" onClick={c.duplicateSelected} disabled={c.simulationRunning}>
                  <DuplicateIcon /> Копировать
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={c.removeSelection}
                  disabled={c.simulationRunning}
                >
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
                    disabled={c.simulationRunning}
                    className={(c.selectedWire?.color ?? '#e3212b') === color ? 'active' : ''}
                    style={{ background: color }}
                    onClick={() => c.setWireColor(color)}
                    aria-label={`Цвет ${color}`}
                  />
                ))}
              </div>
              <div className="workbench-inspector-actions">
                <button type="button" onClick={c.toggleWireRoute} disabled={c.simulationRunning}>
                  <WireIcon /> Изгиб
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={c.removeSelection}
                  disabled={c.simulationRunning}
                >
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
