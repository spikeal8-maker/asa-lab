import {
  selectionBounds,
  type AlignmentAxis,
  type AlignmentMode,
  type BooleanOperation,
  type ThreeDNode,
  type ThreeDRulerSettings,
} from '@asa-lab/three-d';

interface SelectionToolsProps {
  readonly nodes: readonly ThreeDNode[];
  readonly groupId: string | null;
  readonly ruler: ThreeDRulerSettings;
  readonly onAlign: (axis: AlignmentAxis, mode: AlignmentMode) => void;
  readonly onGroupOperation: (operation: BooleanOperation) => void;
  readonly onRulerOrigin: () => void;
}

const AXES: readonly { axis: AlignmentAxis; label: string }[] = [
  { axis: 'x', label: 'X · ширина' },
  { axis: 'y', label: 'Y · высота' },
  { axis: 'z', label: 'Z · глубина' },
];

const MODES: readonly { mode: AlignmentMode; label: string }[] = [
  { mode: 'minimum', label: 'К началу' },
  { mode: 'center', label: 'По центру' },
  { mode: 'maximum', label: 'К концу' },
];

export function SelectionTools({
  nodes,
  groupId,
  ruler,
  onAlign,
  onGroupOperation,
  onRulerOrigin,
}: SelectionToolsProps): JSX.Element {
  const bounds = selectionBounds(nodes);
  const operation = nodes[0]?.groupOperation ?? 'union';
  const precision = ruler.precision;
  return (
    <aside className="asa3d-selection-tools" aria-label="Инструменты выбранных объектов">
      <header>
        <strong>
          {groupId ? `Булева группа · ${nodes.length}` : `Выбрано объектов · ${nodes.length}`}
        </strong>
      </header>
      {groupId && (
        <label className="asa3d-boolean-mode">
          <span>Булева операция</span>
          <select
            value={operation}
            onChange={(event) => onGroupOperation(event.currentTarget.value as BooleanOperation)}
          >
            <option value="union">Объединение</option>
            <option value="difference">Вычитание отверстий</option>
            <option value="intersection">Пересечение тел</option>
          </select>
        </label>
      )}
      {!groupId && nodes.length > 1 && (
        <section>
          <h3>Выравнивание</h3>
          {AXES.map(({ axis, label }) => (
            <div className="asa3d-align-row" key={axis}>
              <span>{label}</span>
              <div>
                {MODES.map(({ mode, label: modeLabel }) => (
                  <button
                    key={mode}
                    type="button"
                    aria-label={`${label}: ${modeLabel}`}
                    title={`${label}: ${modeLabel}`}
                    onClick={() => onAlign(axis, mode)}
                  >
                    <i className={`${axis}-${mode}`} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
      {ruler.visible && bounds && (
        <section className="asa3d-ruler-readout">
          <h3>Линейка · мм</h3>
          <div>
            <label>
              <span>X</span>
              <output>{(bounds.min.x - ruler.origin.x).toFixed(precision)}</output>
            </label>
            <label>
              <span>Y</span>
              <output>{(bounds.min.y - ruler.origin.y).toFixed(precision)}</output>
            </label>
            <label>
              <span>Z</span>
              <output>{(bounds.min.z - ruler.origin.z).toFixed(precision)}</output>
            </label>
          </div>
          <div>
            <label>
              <span>Ш</span>
              <output>{bounds.size.x.toFixed(precision)}</output>
            </label>
            <label>
              <span>В</span>
              <output>{bounds.size.y.toFixed(precision)}</output>
            </label>
            <label>
              <span>Г</span>
              <output>{bounds.size.z.toFixed(precision)}</output>
            </label>
          </div>
          <button type="button" onClick={onRulerOrigin}>
            Сделать угол выделения нулём
          </button>
        </section>
      )}
    </aside>
  );
}
