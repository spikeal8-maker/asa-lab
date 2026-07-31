import { CATEGORY_LABELS, visualAsset, type ComponentCategory } from './component-catalog';
import type { Terminal } from '../api';
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
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" aria-label="Вид списка">
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
              {c.filteredCatalog.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className="workbench-catalog-card"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_MIME, entry.kind);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => c.addComponent(entry.kind)}
                  title={`Добавить: ${entry.label}`}
                >
                  <span className="workbench-catalog-art">
                    <ComponentPreview preview={entry.preview} asset={visualAsset(entry)} />
                  </span>
                  <span>{entry.label}</span>
                </button>
              ))}
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
                  asset={visualAsset(c.selectedEntry, c.componentVisualState(c.selectedComponent))}
                />
              </div>
              <label>
                <span>Имя</span>
                <input
                  type="text"
                  maxLength={120}
                  value={c.selectedComponent.name ?? c.selectedEntry.label}
                  onChange={(event) => c.updateSelectedName(event.target.value)}
                />
              </label>
              {!['button', 'switch'].includes(c.selectedComponent.kind) ? (
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
              {c.selectedComponent.kind === 'switch' || c.selectedComponent.kind === 'button' ? (
                <label className="workbench-toggle-property">
                  <span>
                    {c.selectedComponent.kind === 'button' ? 'Кнопка нажата' : 'Контакт замкнут'}
                  </span>
                  <input
                    type="checkbox"
                    checked={c.selectedComponent.state === true}
                    onChange={(event) => c.setSelectedState(event.target.checked)}
                  />
                </label>
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

              <dl className="workbench-terminal-list">
                {Object.entries(c.selectedEntry.terminals).map(([terminal, spec]) => (
                  <div key={terminal}>
                    <dt>Вывод {spec?.label ?? terminal}</dt>
                    <dd>
                      {c.simulationRunning
                        ? `${measurement?.terminalVoltages[terminal as Terminal]?.toFixed(3) ?? '—'} В`
                        : '—'}
                    </dd>
                  </div>
                ))}
              </dl>

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
