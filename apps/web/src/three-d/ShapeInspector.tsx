import { useState } from 'react';
import type { ThreeDCommand, ThreeDNode, Vector3Value } from '@asa-lab/three-d';

interface ShapeInspectorProps {
  readonly node: ThreeDNode;
  readonly execute: (command: ThreeDCommand) => void;
  readonly onClose: () => void;
}

const COLORS = [
  '#ef3340',
  '#f68b1f',
  '#f6c800',
  '#5fbf5f',
  '#27a9e1',
  '#006fb9',
  '#8a4bb8',
  '#d94693',
];

function numeric(value: string, fallback: number, minimum?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return minimum === undefined ? parsed : Math.max(minimum, parsed);
}

type VectorKey = keyof Vector3Value;

export function ShapeInspector({ node, execute, onClose }: ShapeInspectorProps): JSX.Element {
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const expanded = expandedNodeId === node.id;
  const maximumRadius = Math.max(
    0,
    Math.min(node.dimensions.width, node.dimensions.depth, node.dimensions.height) / 2,
  );
  const replacePosition = (axis: VectorKey, value: string): void => {
    execute({
      type: 'replace-transform',
      nodeId: node.id,
      value: {
        ...node.transform,
        position: {
          ...node.transform.position,
          [axis]: numeric(value, node.transform.position[axis]),
        },
      },
    });
  };
  const replaceRotation = (axis: VectorKey, value: string): void => {
    execute({
      type: 'replace-transform',
      nodeId: node.id,
      value: {
        ...node.transform,
        rotation: {
          ...node.transform.rotation,
          [axis]: numeric(value, node.transform.rotation[axis]),
        },
      },
    });
  };
  const replaceDimension = (dimension: 'width' | 'depth' | 'height', value: string): void => {
    execute({
      type: 'replace-dimensions',
      nodeId: node.id,
      value: {
        ...node.dimensions,
        [dimension]: numeric(value, node.dimensions[dimension], 0.1),
      },
    });
  };

  return (
    <aside
      className={`asa3d-inspector ${expanded ? 'expanded' : 'compact'}`}
      aria-label="Параметры выбранной формы"
    >
      <header>
        <span
          className={`asa3d-inspector-swatch ${node.operation}`}
          style={node.operation === 'solid' ? { backgroundColor: node.color } : undefined}
          aria-hidden="true"
        />
        <input
          key={node.id}
          defaultValue={node.name}
          aria-label="Название формы"
          onBlur={(event) =>
            execute({ type: 'rename', nodeId: node.id, name: event.currentTarget.value })
          }
        />
        <button
          type="button"
          className="asa3d-inspector-expand"
          aria-label={expanded ? 'Свернуть параметры формы' : 'Развернуть параметры формы'}
          aria-expanded={expanded}
          onClick={() => setExpandedNodeId(expanded ? null : node.id)}
        >
          {expanded ? '⌃' : '⌄'}
        </button>
        <button type="button" onClick={onClose} aria-label="Закрыть параметры">
          ×
        </button>
      </header>

      <section className="asa3d-operation-picker" aria-label="Тип формы">
        <button
          type="button"
          className={node.operation === 'solid' ? 'selected' : ''}
          aria-pressed={node.operation === 'solid'}
          disabled={node.locked}
          onClick={() => execute({ type: 'set-operation', nodeId: node.id, operation: 'solid' })}
        >
          <i className="solid" aria-hidden="true" />
          Тело
        </button>
        <button
          type="button"
          className={node.operation === 'hole' ? 'selected' : ''}
          aria-pressed={node.operation === 'hole'}
          disabled={node.locked}
          onClick={() => execute({ type: 'set-operation', nodeId: node.id, operation: 'hole' })}
        >
          <i className="hole" aria-hidden="true" />
          Отверстие
        </button>
      </section>

      {expanded && (
        <div className="asa3d-inspector-details">
          <section>
            <h3>Цвет</h3>
            <div className="asa3d-color-grid">
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
                    execute({
                      type: 'set-color',
                      nodeId: node.id,
                      color: event.currentTarget.value,
                    })
                  }
                  aria-label="Выбрать свой цвет"
                />
              </label>
            </div>
          </section>

          <section>
            <h3>Размер, мм</h3>
            <div className="asa3d-field-grid">
              {(
                [
                  ['width', 'Ш'],
                  ['depth', 'Г'],
                  ['height', 'В'],
                ] as const
              ).map(([dimension, label]) => (
                <label key={dimension}>
                  <span>{label}</span>
                  <input
                    type="number"
                    aria-label={
                      { width: 'Ширина, мм', depth: 'Глубина, мм', height: 'Высота, мм' }[dimension]
                    }
                    min="0.1"
                    max="10000"
                    step="0.1"
                    value={node.dimensions[dimension]}
                    disabled={node.locked}
                    onChange={(event) => replaceDimension(dimension, event.currentTarget.value)}
                  />
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3>Положение, мм</h3>
            <div className="asa3d-field-grid axes">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <label key={axis}>
                  <span>{axis.toUpperCase()}</span>
                  <input
                    type="number"
                    aria-label={`Положение ${axis.toUpperCase()}, мм`}
                    step="0.1"
                    value={node.transform.position[axis]}
                    disabled={node.locked}
                    onChange={(event) => replacePosition(axis, event.currentTarget.value)}
                  />
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3>Поворот, °</h3>
            <div className="asa3d-field-grid axes">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <label key={axis}>
                  <span>{axis.toUpperCase()}</span>
                  <input
                    type="number"
                    aria-label={`Поворот ${axis.toUpperCase()}, градусов`}
                    step="1"
                    value={node.transform.rotation[axis]}
                    disabled={node.locked}
                    onChange={(event) => replaceRotation(axis, event.currentTarget.value)}
                  />
                </label>
              ))}
            </div>
          </section>

          {node.primitive === 'box' && (
            <section>
              <h3>Форма</h3>
              <label className="asa3d-range-row asa3d-range-labelled">
                <span>Радиус</span>
                <input
                  type="range"
                  min="0"
                  max={maximumRadius}
                  step="0.5"
                  value={Math.min(node.bevel, maximumRadius)}
                  disabled={node.locked}
                  onChange={(event) =>
                    execute({
                      type: 'replace-node',
                      node: { ...node, bevel: Number(event.currentTarget.value) },
                    })
                  }
                />
                <output>{Math.min(node.bevel, maximumRadius).toFixed(1)}</output>
              </label>
              <label className="asa3d-range-row asa3d-range-labelled">
                <span>Шаги</span>
                <input
                  type="range"
                  min="3"
                  max="24"
                  step="1"
                  value={Math.min(24, node.sides)}
                  disabled={node.locked}
                  onChange={(event) =>
                    execute({
                      type: 'replace-node',
                      node: { ...node, sides: Number(event.currentTarget.value) },
                    })
                  }
                />
                <output>{Math.min(24, node.sides)}</output>
              </label>
            </section>
          )}

          {(node.primitive === 'cylinder' ||
            node.primitive === 'cone' ||
            node.primitive === 'sphere') && (
            <section>
              <h3>Детализация</h3>
              <label className="asa3d-range-row asa3d-range-labelled">
                <span>Стороны</span>
                <input
                  type="range"
                  min="8"
                  max="64"
                  step="1"
                  value={node.sides}
                  disabled={node.locked}
                  onChange={(event) =>
                    execute({
                      type: 'replace-node',
                      node: { ...node, sides: Number(event.currentTarget.value) },
                    })
                  }
                />
                <output>{node.sides}</output>
              </label>
            </section>
          )}
        </div>
      )}

      <footer>
        <button
          type="button"
          className={node.locked ? 'active' : ''}
          aria-pressed={node.locked}
          onClick={() => execute({ type: 'set-locked', nodeId: node.id, locked: !node.locked })}
        >
          <span aria-hidden="true">{node.locked ? '▣' : '□'}</span>
          {node.locked ? 'Разблокировать' : 'Заблокировать'}
        </button>
        <button
          type="button"
          className={!node.visible ? 'active' : ''}
          aria-pressed={!node.visible}
          onClick={() => execute({ type: 'set-visible', nodeId: node.id, visible: !node.visible })}
        >
          <span aria-hidden="true">{node.visible ? '◉' : '○'}</span>
          {node.visible ? 'Скрыть' : 'Показать'}
        </button>
      </footer>
    </aside>
  );
}
