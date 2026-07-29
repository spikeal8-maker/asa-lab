import type { SchematicDocument } from '../api';
import {
  componentBehavior,
  formatComponentValue,
  WORKBENCH_VALUE_CONTROLS,
} from './component-behavior';
import {
  catalogEntry,
  componentPhysicalSummary,
  physicalEvidenceLabel,
  visualAsset,
} from './component-catalog';
import type { Selection } from './workbench-model';

interface WorkbenchInspectorProps {
  document: SchematicDocument;
  selection: Selection;
  simulation:
    | {
        current: number;
        components: Array<{
          componentId: string;
          voltageDrop: number;
          current: number;
          lit?: boolean;
        }>;
      }
    | null;
  ledStates: ReadonlyMap<string, string>;
  onValueChange(value: number): void;
  onResetValue(): void;
  onDuplicate(): void;
  onRotate(): void;
  onDelete(): void;
  onWireColorChange(color: string): void;
  onToggleWireRoute(): void;
}

export function WorkbenchInspector({
  document,
  selection,
  simulation,
  ledStates,
  onValueChange,
  onResetValue,
  onDuplicate,
  onRotate,
  onDelete,
  onWireColorChange,
  onToggleWireRoute,
}: WorkbenchInspectorProps) {
  if (!selection) {
    return (
      <aside className="workbench-inspector" aria-label="Инспектор">
        <div className="workbench-inspector-empty">
          <strong>Инспектор</strong>
          <p>Выберите компонент или провод. Здесь появятся свойства и действия.</p>
        </div>
      </aside>
    );
  }

  if (selection.kind === 'wire') {
    const wire = document.connections.find((item) => item.id === selection.id);
    if (!wire) return null;
    return (
      <aside className="workbench-inspector" aria-label="Свойства провода">
        <div className="workbench-inspector-preview wire-preview" aria-hidden="true">
          <span style={{ background: wire.color ?? '#c93f47' }} />
        </div>
        <div className="workbench-inspector-body">
          <div className="workbench-inspector-heading">
            <div>
              <span className="eyebrow">Провод</span>
              <h2>Соединение</h2>
            </div>
          </div>
          <dl className="wire-endpoints">
            <div>
              <dt>Откуда</dt>
              <dd>
                {wire.from.componentId}:{wire.from.terminal}
              </dd>
            </div>
            <div>
              <dt>Куда</dt>
              <dd>
                {wire.to.componentId}:{wire.to.terminal}
              </dd>
            </div>
          </dl>
          <label className="inspector-field">
            <span>Цвет</span>
            <input
              type="color"
              value={wire.color ?? '#c93f47'}
              onChange={(event) => onWireColorChange(event.target.value)}
            />
          </label>
          <button type="button" className="secondary-button" onClick={onToggleWireRoute}>
            Изменить трассу
          </button>
          <button type="button" className="danger-button" onClick={onDelete}>
            Удалить провод
          </button>
        </div>
      </aside>
    );
  }

  const component = document.components.find((item) => item.id === selection.id);
  if (!component || component.kind === 'wire') return null;
  const entry = catalogEntry(component.kind);
  if (!entry) return null;
  const behavior = componentBehavior(component, simulation, ledStates);
  const control = WORKBENCH_VALUE_CONTROLS[component.kind];
  const readOnlyPlanned = entry.enabled !== true || entry.kind !== component.kind;
  const measured = simulation?.components.find((item) => item.componentId === component.id);
  const asset = visualAsset(
    entry,
    component.kind === 'led'
      ? ((behavior.assetState ?? 'off') as
          | 'off'
          | 'lit'
          | 'reverse'
          | 'overcurrent'
          | 'burned')
      : 'default',
  );

  return (
    <aside className="workbench-inspector" aria-label={`Свойства: ${entry.label}`}>
      <div className="workbench-inspector-preview">
        {asset ? <img src={asset} alt="" /> : <span className="preview-fallback" aria-hidden="true" />}
      </div>
      <div className="workbench-inspector-body">
        <div className="workbench-inspector-heading">
          <div>
            <span className="eyebrow">Компонент</span>
            <h2>{entry.label}</h2>
          </div>
          <span className={`inspector-state state-${behavior.tone}`}>{behavior.label}</span>
        </div>
        <p className="inspector-note">{behavior.note}</p>
        {readOnlyPlanned && (
          <div className="inspector-readonly-notice" role="status">
            <strong>Нативный просмотр без редактирования</strong>
            <span>
              Физическая геометрия и существующие соединения сохранены. Добавление, перенос,
              поворот и удаление этого компонента включатся только после полного browser gate.
            </span>
          </div>
        )}
        <dl className="component-physical-details">
          <div>
            <dt>Физический размер</dt>
            <dd>{componentPhysicalSummary(entry)}</dd>
          </div>
          <div>
            <dt>Источник размера</dt>
            <dd>{physicalEvidenceLabel(entry)}</dd>
          </div>
          <div>
            <dt>Сетка</dt>
            <dd>{entry.placement.mode === 'breadboard-hole' ? 'Отверстия 2,54 мм' : 'Физическая полусетка'}</dd>
          </div>
          <div>
            <dt>Reference-поведение</dt>
            <dd>{entry.physical.referenceBehaviorVerified ? 'Проверено' : 'Требуется проверка'}</dd>
          </div>
        </dl>
        <label className="inspector-field">
          <span>{control.label}</span>
          <input
            type="number"
            value={component.value}
            min={control.minimum}
            max={control.maximum}
            step={control.step}
            disabled={!control.editable || readOnlyPlanned}
            onChange={(event) => onValueChange(Number(event.target.value))}
          />
          <small>
            {formatComponentValue(component.kind, component.value)} · допустимо{' '}
            {control.minimum}–{control.maximum} {control.unit}
          </small>
        </label>
        <div className="inspector-measurements" aria-label="Результаты симуляции">
          <div>
            <span>Ток</span>
            <strong>{measured ? `${(measured.current * 1000).toFixed(1)} мА` : '—'}</strong>
          </div>
          <div>
            <span>Падение</span>
            <strong>{measured ? `${measured.voltageDrop.toFixed(2)} В` : '—'}</strong>
          </div>
        </div>
        <div className="inspector-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onResetValue}
            disabled={!control.editable || readOnlyPlanned}
          >
            Сбросить
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onDuplicate}
            disabled={readOnlyPlanned}
          >
            Дублировать
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onRotate}
            disabled={readOnlyPlanned}
          >
            Повернуть
          </button>
        </div>
        <button
          type="button"
          className="danger-button"
          onClick={onDelete}
          disabled={readOnlyPlanned}
        >
          Удалить компонент
        </button>
      </div>
    </aside>
  );
}
