import { useState } from 'react';
import type {
  BooleanOperation,
  PrimitiveKind,
  ThreeDCommand,
  ThreeDDimensions,
  ThreeDNode,
} from '@asa-lab/three-d';
import { ChevronIcon, ViewIcon } from '../electronics/workbench-icons';

interface GroupSelection {
  readonly id: string;
  readonly nodes: readonly ThreeDNode[];
  readonly operation: BooleanOperation;
  readonly onOperationChange: (operation: BooleanOperation) => void;
}

interface ShapeInspectorProps {
  readonly node?: ThreeDNode | undefined;
  readonly group?: GroupSelection | undefined;
  readonly execute: (command: ThreeDCommand) => void;
}

const COLORS = ['#ef3340', '#f68b1f', '#f6c800', '#5fbf5f', '#27a9e1', '#006fb9', '#8a4bb8'];

function numeric(value: string, fallback: number, minimum?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return minimum === undefined ? parsed : Math.max(minimum, parsed);
}

function groupTitle(operation: BooleanOperation): string {
  if (operation === 'difference') return 'Subtract';
  if (operation === 'intersection') return 'Intersect';
  return 'Union';
}

function primitiveTitle(node: ThreeDNode): string {
  const labels: Partial<Record<PrimitiveKind, string>> = {
    box: 'Параллелепипед',
    cylinder: 'Цилиндр',
    sphere: 'Сфера',
    cone: 'Конус',
    torus: 'Тор',
    wedge: 'Клин',
    roof: 'Крыша',
    pyramid: 'Пирамида',
  };
  return node.name.trim() || labels[node.primitive] || 'Форма';
}

export function ShapeInspector({ node, group, execute }: ShapeInspectorProps): JSX.Element | null {
  const selectionKey = group ? `group:${group.id}` : node?.id;
  const [collapsedKey, setCollapsedKey] = useState<string | null>(null);
  if (!selectionKey || (!node && !group)) return null;
  const expanded = collapsedKey !== selectionKey;
  const nodes = group?.nodes ?? (node ? [node] : []);
  const locked = nodes.length > 0 && nodes.every((item) => item.locked);
  const hidden = nodes.length > 0 && nodes.every((item) => !item.visible);
  const operation = nodes.every((item) => item.operation === 'hole') ? 'hole' : 'solid';

  const executeForNodes = (command: (item: ThreeDNode) => ThreeDCommand): void => {
    nodes.forEach((item) => execute(command(item)));
  };

  const setOperation = (value: 'solid' | 'hole'): void => {
    executeForNodes((item) => ({ type: 'set-operation', nodeId: item.id, operation: value }));
  };

  const toggleLocked = (): void => {
    executeForNodes((item) => ({ type: 'set-locked', nodeId: item.id, locked: !locked }));
  };

  const toggleVisible = (): void => {
    executeForNodes((item) => ({ type: 'set-visible', nodeId: item.id, visible: hidden }));
  };

  const replaceDimension = (dimension: keyof ThreeDDimensions, value: string): void => {
    if (!node) return;
    execute({
      type: 'replace-dimensions',
      nodeId: node.id,
      value: {
        ...node.dimensions,
        [dimension]: numeric(value, node.dimensions[dimension], 0.1),
      },
    });
  };

  const title = group ? groupTitle(group.operation) : primitiveTitle(node as ThreeDNode);

  return (
    <aside
      className={`asa3d-inspector ${expanded ? 'expanded' : 'compact'}`}
      aria-label={group ? 'Параметры выбранной группы' : 'Параметры выбранной формы'}
      data-testid={group ? 'asa3d-group-inspector' : 'asa3d-shape-inspector'}
    >
      <header>
        <button
          type="button"
          className="asa3d-inspector-expand"
          aria-label={expanded ? 'Свернуть параметры' : 'Развернуть параметры'}
          aria-expanded={expanded}
          onClick={() => setCollapsedKey(expanded ? selectionKey : null)}
        >
          <ChevronIcon className={expanded ? 'expanded' : ''} />
        </button>
        {node ? (
          <input
            key={node.id}
            defaultValue={title}
            aria-label="Название формы"
            onBlur={(event) =>
              execute({ type: 'rename', nodeId: node.id, name: event.currentTarget.value })
            }
          />
        ) : (
          <strong>{title}</strong>
        )}
        <button
          type="button"
          className={locked ? 'active' : ''}
          aria-label={locked ? 'Разблокировать' : 'Заблокировать'}
          aria-pressed={locked}
          onClick={toggleLocked}
        >
          <span className={`asa3d-lock-icon ${locked ? 'locked' : ''}`} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={hidden ? 'active' : ''}
          aria-label={hidden ? 'Показать' : 'Скрыть'}
          aria-pressed={hidden}
          onClick={toggleVisible}
        >
          <ViewIcon aria-hidden="true" />
        </button>
      </header>

      {expanded && (
        <>
          <section className="asa3d-operation-picker" aria-label="Тип формы">
            <button
              type="button"
              className={operation === 'solid' ? 'selected' : ''}
              aria-pressed={operation === 'solid'}
              disabled={locked}
              onClick={() => setOperation('solid')}
            >
              <i
                className="solid"
                style={!group && node ? { backgroundColor: node.color } : undefined}
                aria-hidden="true"
              />
              <span>Тело</span>
            </button>
            <button
              type="button"
              className={operation === 'hole' ? 'selected' : ''}
              aria-pressed={operation === 'hole'}
              disabled={locked}
              onClick={() => setOperation('hole')}
            >
              <i className="hole" aria-hidden="true" />
              <span>Отверстие</span>
            </button>
          </section>

          {group ? (
            <section className="asa3d-compact-properties">
              <h3>Свойства</h3>
              <span className="asa3d-property-caption">
                Тип группы: {groupTitle(group.operation)}
              </span>
              <div className="asa3d-boolean-buttons" aria-label="Булева операция группы">
                {(
                  [
                    ['union', 'Объединение'],
                    ['difference', 'Вычитание'],
                    ['intersection', 'Пересечение'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={group.operation === value ? 'selected' : ''}
                    aria-label={label}
                    aria-pressed={group.operation === value}
                    onClick={() => group.onOperationChange(value)}
                  >
                    <i className={`boolean-icon ${value}`} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <ShapeProperties
              node={node as ThreeDNode}
              execute={execute}
              replaceDimension={replaceDimension}
            />
          )}
        </>
      )}
    </aside>
  );
}

interface ShapePropertiesProps {
  readonly node: ThreeDNode;
  readonly execute: (command: ThreeDCommand) => void;
  readonly replaceDimension: (dimension: keyof ThreeDDimensions, value: string) => void;
}

function ShapeProperties({ node, execute, replaceDimension }: ShapePropertiesProps): JSX.Element {
  const maximumRadius = Math.max(
    0,
    Math.min(node.dimensions.width, node.dimensions.depth, node.dimensions.height) / 2,
  );
  const dimensionRows = [
    ['width', node.primitive === 'box' ? 'Длина' : 'Ширина'],
    ['depth', 'Глубина'],
    ['height', 'Высота'],
  ] as const;

  return (
    <section className="asa3d-compact-properties">
      <h3>Свойства</h3>

      <div className="asa3d-compact-colors" aria-label="Цвет тела">
        {COLORS.map((color) => (
          <button
            type="button"
            key={color}
            className={node.color === color ? 'selected' : ''}
            style={{ backgroundColor: color }}
            disabled={node.locked}
            onClick={() => execute({ type: 'set-color', nodeId: node.id, color })}
            aria-label={`Цвет ${color}`}
          />
        ))}
        <label className="asa3d-custom-color" title="Свой цвет">
          <span>+</span>
          <input
            type="color"
            value={node.color}
            disabled={node.locked}
            onChange={(event) =>
              execute({ type: 'set-color', nodeId: node.id, color: event.currentTarget.value })
            }
            aria-label="Выбрать свой цвет"
          />
        </label>
      </div>

      {node.primitive === 'box' && (
        <>
          <RangeProperty
            label="Радиус"
            value={Math.min(node.bevel, maximumRadius)}
            min={0}
            max={maximumRadius}
            step={0.5}
            disabled={node.locked}
            onChange={(value) => execute({ type: 'replace-node', node: { ...node, bevel: value } })}
          />
          <RangeProperty
            label="Шаги"
            value={Math.min(24, node.sides)}
            min={3}
            max={24}
            step={1}
            disabled={node.locked}
            onChange={(value) => execute({ type: 'replace-node', node: { ...node, sides: value } })}
          />
        </>
      )}

      {(node.primitive === 'cylinder' ||
        node.primitive === 'cone' ||
        node.primitive === 'sphere') && (
        <RangeProperty
          label="Стороны"
          value={node.sides}
          min={8}
          max={64}
          step={1}
          disabled={node.locked}
          onChange={(value) => execute({ type: 'replace-node', node: { ...node, sides: value } })}
        />
      )}

      {dimensionRows.map(([dimension, label]) => (
        <RangeProperty
          key={dimension}
          label={label}
          value={node.dimensions[dimension]}
          min={0.1}
          max={500}
          step={0.1}
          disabled={node.locked}
          onChange={(value) => replaceDimension(dimension, String(value))}
        />
      ))}
    </section>
  );
}

interface RangePropertyProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}

function RangeProperty({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: RangePropertyProps): JSX.Element {
  const safeMaximum = Math.max(min, max);
  return (
    <label className="asa3d-compact-range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={safeMaximum}
        step={step}
        value={Math.min(safeMaximum, Math.max(min, value))}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <input
        type="number"
        min={min}
        max={safeMaximum}
        step={step}
        value={Number(value.toFixed(step < 1 ? 1 : 0))}
        disabled={disabled}
        aria-label={`${label}, мм`}
        onChange={(event) => onChange(numeric(event.currentTarget.value, value, min))}
      />
    </label>
  );
}
