import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import type {
  BooleanOperation,
  PrimitiveKind,
  ThreeDCommand,
  ThreeDDimensions,
  ThreeDNode,
  Vector2Value,
} from '@asa-lab/three-d';
import { ChevronIcon, ViewIcon } from '../electronics/workbench-icons';
import { measureTextWidthAtHeight } from './viewport/geometry';

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

const COLORS = [
  '#ef8e83',
  '#f8ba84',
  '#f7dfa3',
  '#beddb8',
  '#9bdbe3',
  '#66bdd3',
  '#9db7e5',
  '#c9b5df',
  '#e7a8cf',
  '#dfb980',
  '#f3f4f4',
  '#9fa9ad',
  '#e31c2b',
  '#f5831f',
  '#f2c313',
  '#4aa94b',
  '#54c5d1',
  '#009cc5',
  '#304c97',
  '#7c3f98',
  '#d9007e',
  '#a97c50',
  '#d7dcde',
  '#667075',
  '#a71920',
  '#dd521d',
  '#e9a916',
  '#08743d',
  '#16545d',
  '#006d91',
  '#142d64',
  '#422c70',
  '#981b55',
  '#603813',
  '#b9c0c3',
  '#272c2f',
] as const;

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
    text: 'Текст',
    'round-roof': 'Круглая кровля',
    ring: 'Кольцо',
    icosahedron: 'Икосаэдр',
    star: 'Звезда объёмная',
    'star-6': 'Звезда',
    'extrude-sketch': 'Extrude sketch',
    'revolve-sketch': 'Revolve sketch',
    scribble: 'Scribble',
  };
  return node.name.trim() || labels[node.primitive] || 'Форма';
}

export function ShapeInspector({ node, group, execute }: ShapeInspectorProps): JSX.Element | null {
  const selectionKey = group ? `group:${group.id}` : node?.id;
  const [collapsedKey, setCollapsedKey] = useState<string | null>(null);
  const [colorOpenKey, setColorOpenKey] = useState<string | null>(null);
  if (!selectionKey || (!node && !group)) return null;
  const expanded = collapsedKey !== selectionKey;
  const nodes = group?.nodes ?? (node ? [node] : []);
  const locked = nodes.length > 0 && nodes.every((item) => item.locked);
  const hidden = nodes.length > 0 && nodes.every((item) => !item.visible);
  const operation = nodes.every((item) => item.operation === 'hole') ? 'hole' : 'solid';
  const selectedColor = nodes.every((item) => item.color === nodes[0]?.color)
    ? (nodes[0]?.color ?? '#e31c2b')
    : null;
  const selectedOpacity = nodes.every((item) => item.opacity === nodes[0]?.opacity)
    ? (nodes[0]?.opacity ?? 1)
    : 1;
  const colorOpen = colorOpenKey === selectionKey;

  const executeForNodes = (command: (item: ThreeDNode) => ThreeDCommand): void => {
    nodes.forEach((item) => execute(command(item)));
  };

  const setOperation = (value: 'solid' | 'hole'): void => {
    executeForNodes((item) => ({ type: 'set-operation', nodeId: item.id, operation: value }));
  };

  const setColor = (color: string): void => {
    executeForNodes((item) => ({ type: 'set-color', nodeId: item.id, color }));
  };

  const setOpacity = (opacity: number): void => {
    executeForNodes((item) => ({ type: 'set-opacity', nodeId: item.id, opacity }));
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
              aria-label="Цвет тела"
              aria-pressed={operation === 'solid'}
              aria-expanded={colorOpen}
              disabled={locked}
              onClick={() => {
                if (operation !== 'solid') {
                  setOperation('solid');
                  return;
                }
                setColorOpenKey(colorOpen ? null : selectionKey);
              }}
            >
              <i
                className="solid"
                style={
                  selectedColor
                    ? { backgroundColor: selectedColor, opacity: selectedOpacity }
                    : undefined
                }
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

          {colorOpen && operation === 'solid' && (
            <section className="asa3d-color-popover" aria-label="Палитра цвета тела">
              <header>
                <strong>Сплошные цвета</strong>
                <button
                  type="button"
                  onClick={() => setColorOpenKey(null)}
                  aria-label="Закрыть палитру"
                >
                  ×
                </button>
              </header>
              <div className="asa3d-color-presets">
                {COLORS.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={selectedColor === color ? 'selected' : ''}
                    style={{ backgroundColor: color }}
                    disabled={locked}
                    onClick={() => setColor(color)}
                    aria-label={`Цвет ${color}`}
                  />
                ))}
              </div>
              <div className="asa3d-color-options">
                <label
                  className="asa3d-custom-color asa3d-custom-color-wide"
                  title="Пользовательский цвет"
                >
                  <span>+</span>
                  <em>Пользовательский</em>
                  <input
                    type="color"
                    value={selectedColor ?? '#e31c2b'}
                    disabled={locked}
                    onChange={(event) => setColor(event.currentTarget.value)}
                    aria-label="Выбрать пользовательский цвет"
                  />
                </label>
                <button
                  type="button"
                  className={selectedOpacity < 1 ? 'active' : ''}
                  aria-pressed={selectedOpacity < 1}
                  onClick={() => setOpacity(selectedOpacity < 1 ? 1 : 0.45)}
                  disabled={locked}
                >
                  <i style={{ backgroundColor: selectedColor ?? '#e31c2b' }} />
                  Прозрачный
                </button>
              </div>
            </section>
          )}

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
              key={(node as ThreeDNode).id}
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
  const [sketchOpen, setSketchOpen] = useState(
    !node.parameters.sketchAccepted &&
      ['extrude-sketch', 'revolve-sketch', 'scribble'].includes(node.primitive),
  );
  const maximumRadius = Math.max(
    0,
    Math.min(node.dimensions.width, node.dimensions.depth, node.dimensions.height) / 2,
  );
  const maximumCylinderBevel = Math.max(
    0,
    Math.min(node.dimensions.width, node.dimensions.depth, node.dimensions.height) / 8,
  );
  const basicShape = [
    'box',
    'cylinder',
    'sphere',
    'extrude-sketch',
    'revolve-sketch',
    'scribble',
    'cone',
    'pyramid',
    'roof',
    'text',
    'round-roof',
    'half-sphere',
    'torus',
    'tube',
    'ring',
    'wedge',
    'polygon',
    'icosahedron',
    'star',
    'star-6',
    'heart',
  ].includes(node.primitive);
  const dimensionRows = (
    node.primitive === 'box'
      ? [
          ['width', 'Длина'],
          ['depth', 'Ширина'],
          ['height', 'Высота'],
        ]
      : basicShape
        ? []
        : [
            ['width', 'Ширина'],
            ['depth', 'Глубина'],
            ['height', 'Высота'],
          ]
  ) as readonly (readonly [keyof ThreeDDimensions, string])[];
  const replaceParameters = (values: Partial<ThreeDNode['parameters']>): void => {
    execute({
      type: 'replace-node',
      node: { ...node, parameters: { ...node.parameters, ...values } },
    });
  };
  const replaceConeRadius = (parameter: 'topRadius' | 'baseRadius', value: number): void => {
    const parameters = { ...node.parameters, [parameter]: value };
    const diameter = Math.max(parameters.topRadius, parameters.baseRadius) * 2;
    execute({
      type: 'replace-node',
      node: {
        ...node,
        parameters,
        dimensions: { ...node.dimensions, width: diameter, depth: diameter },
      },
    });
  };

  return (
    <section className="asa3d-compact-properties">
      <h3>Свойства</h3>

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
            unit=""
            disabled={node.locked}
            onChange={(value) => execute({ type: 'replace-node', node: { ...node, sides: value } })}
          />
        </>
      )}

      {node.primitive === 'cone' && (
        <>
          <RangeProperty
            label="Верхний радиус"
            value={node.parameters.topRadius}
            min={0}
            max={100}
            step={0.1}
            disabled={node.locked}
            onChange={(value) => replaceConeRadius('topRadius', value)}
          />
          <RangeProperty
            label="Радиус основания"
            value={node.parameters.baseRadius}
            min={0.1}
            max={100}
            step={0.1}
            disabled={node.locked}
            onChange={(value) => replaceConeRadius('baseRadius', value)}
          />
          <RangeProperty
            label="Высота"
            value={node.dimensions.height}
            min={0.1}
            max={100}
            step={0.1}
            disabled={node.locked}
            onChange={(value) => replaceDimension('height', String(value))}
          />
          <RangeProperty
            label="Стороны"
            value={node.sides}
            min={3}
            max={128}
            step={1}
            unit=""
            disabled={node.locked}
            onChange={(value) => execute({ type: 'replace-node', node: { ...node, sides: value } })}
          />
        </>
      )}

      {node.primitive === 'cylinder' && (
        <>
          <RangeProperty
            label="Стороны"
            value={node.sides}
            min={12}
            max={128}
            step={1}
            unit=""
            disabled={node.locked}
            onChange={(value) => execute({ type: 'replace-node', node: { ...node, sides: value } })}
          />
          <RangeProperty
            label="Скос"
            value={Math.min(node.bevel, maximumCylinderBevel)}
            min={0}
            max={maximumCylinderBevel}
            step={0.1}
            disabled={node.locked}
            onChange={(value) => execute({ type: 'replace-node', node: { ...node, bevel: value } })}
          />
          <RangeProperty
            label="Сегменты"
            value={node.parameters.bevelSegments}
            min={1}
            max={10}
            step={1}
            unit=""
            disabled={node.locked}
            onChange={(value) =>
              execute({
                type: 'replace-node',
                node: {
                  ...node,
                  parameters: { ...node.parameters, bevelSegments: value },
                },
              })
            }
          />
        </>
      )}

      {node.primitive === 'text' && (
        <>
          <label className="asa3d-compact-text-field">
            <span>Text</span>
            <input
              type="text"
              maxLength={128}
              value={node.parameters.text}
              disabled={node.locked}
              onChange={(event) => {
                const text = event.currentTarget.value;
                execute({
                  type: 'replace-node',
                  node: {
                    ...node,
                    parameters: { ...node.parameters, text },
                    dimensions: {
                      ...node.dimensions,
                      width:
                        measureTextWidthAtHeight(text, node.parameters.font) *
                        node.parameters.fontSize,
                    },
                  },
                });
              }}
            />
          </label>
          <label className="asa3d-compact-text-field">
            <span>Шрифт</span>
            <select
              value={node.parameters.font}
              disabled={node.locked}
              onChange={(event) => {
                const font = event.currentTarget.value as ThreeDNode['parameters']['font'];
                execute({
                  type: 'replace-node',
                  node: {
                    ...node,
                    parameters: { ...node.parameters, font },
                    dimensions: {
                      ...node.dimensions,
                      width:
                        measureTextWidthAtHeight(node.parameters.text, font) *
                        node.parameters.fontSize,
                    },
                  },
                });
              }}
            >
              <option value="sans">Noto Sans · АБВ / ABC</option>
              <option value="serif">Noto Serif · АБВ / ABC</option>
              <option value="mono">Noto Mono · АБВ / ABC</option>
            </select>
          </label>
          <RangeProperty
            label="Изгиб"
            value={node.parameters.curveAngle}
            min={-180}
            max={180}
            step={5}
            unit="°"
            disabled={node.locked}
            onChange={(value) => replaceParameters({ curveAngle: value })}
          />
          <RangeProperty
            label="Высота"
            value={node.parameters.fontSize}
            min={0.1}
            max={100}
            step={0.1}
            disabled={node.locked}
            onChange={(value) =>
              execute({
                type: 'replace-node',
                node: {
                  ...node,
                  parameters: { ...node.parameters, fontSize: value },
                  dimensions: {
                    ...node.dimensions,
                    width: Math.max(
                      0.1,
                      node.dimensions.width * (value / node.parameters.fontSize),
                    ),
                    depth: value,
                  },
                },
              })
            }
          />
          <RangeProperty
            label="Скос"
            value={node.bevel}
            min={0}
            max={2.5}
            step={0.1}
            disabled={node.locked}
            onChange={(value) => execute({ type: 'replace-node', node: { ...node, bevel: value } })}
          />
          <RangeProperty
            label="Сегменты"
            value={node.parameters.segments}
            min={0}
            max={5}
            step={1}
            unit=""
            disabled={node.locked}
            onChange={(value) => replaceParameters({ segments: value })}
          />
        </>
      )}

      {node.primitive === 'sphere' && (
        <RangeProperty
          label="Шаги"
          value={node.parameters.steps}
          min={3}
          max={64}
          step={1}
          unit=""
          disabled={node.locked}
          onChange={(value) => replaceParameters({ steps: value })}
        />
      )}

      {node.primitive === 'pyramid' && (
        <RangeProperty
          label="Стороны"
          value={node.sides}
          min={3}
          max={28}
          step={1}
          unit=""
          disabled={node.locked}
          onChange={(value) => execute({ type: 'replace-node', node: { ...node, sides: value } })}
        />
      )}

      {node.primitive === 'torus' && (
        <>
          <RangeProperty
            label="Радиус"
            value={node.parameters.radius}
            min={0.1}
            max={100}
            step={0.1}
            disabled={node.locked}
            onChange={(value) => {
              const diameter = 2 * (value + node.parameters.tubeRadius);
              execute({
                type: 'replace-node',
                node: {
                  ...node,
                  parameters: { ...node.parameters, radius: value },
                  dimensions: { ...node.dimensions, width: diameter, depth: diameter },
                },
              });
            }}
          />
          <RangeProperty
            label="Труба"
            value={node.parameters.tubeRadius}
            min={0.1}
            max={100}
            step={0.1}
            disabled={node.locked}
            onChange={(value) => {
              const diameter = 2 * (node.parameters.radius + value);
              execute({
                type: 'replace-node',
                node: {
                  ...node,
                  parameters: { ...node.parameters, tubeRadius: value },
                  dimensions: {
                    ...node.dimensions,
                    width: diameter,
                    depth: diameter,
                    height: value * 2,
                  },
                },
              });
            }}
          />
          <RangeProperty
            label="Стороны"
            value={node.sides}
            min={3}
            max={64}
            step={1}
            unit=""
            disabled={node.locked}
            onChange={(value) => execute({ type: 'replace-node', node: { ...node, sides: value } })}
          />
          <RangeProperty
            label="Шаги"
            value={node.parameters.steps}
            min={3}
            max={128}
            step={1}
            unit=""
            disabled={node.locked}
            onChange={(value) => replaceParameters({ steps: value })}
          />
        </>
      )}

      {node.primitive === 'tube' && (
        <>
          <RangeProperty
            label="Радиус"
            value={node.parameters.radius}
            min={0.1}
            max={100}
            step={0.1}
            disabled={node.locked}
            onChange={(value) =>
              execute({
                type: 'replace-node',
                node: {
                  ...node,
                  parameters: { ...node.parameters, radius: value },
                  dimensions: { ...node.dimensions, width: value * 2, depth: value * 2 },
                },
              })
            }
          />
          <RangeProperty
            label="Толщина стенки"
            value={node.parameters.wallThickness}
            min={0.1}
            max={30}
            step={0.1}
            disabled={node.locked}
            onChange={(value) => replaceParameters({ wallThickness: value })}
          />
          <RangeProperty
            label="Стороны"
            value={node.sides}
            min={3}
            max={128}
            step={1}
            unit=""
            disabled={node.locked}
            onChange={(value) => execute({ type: 'replace-node', node: { ...node, sides: value } })}
          />
          <RangeProperty
            label="Скос"
            value={node.bevel}
            min={0}
            max={5}
            step={0.1}
            disabled={node.locked}
            onChange={(value) => execute({ type: 'replace-node', node: { ...node, bevel: value } })}
          />
          <RangeProperty
            label="Сегменты скоса"
            value={node.parameters.bevelSegments}
            min={1}
            max={10}
            step={1}
            unit=""
            disabled={node.locked}
            onChange={(value) => replaceParameters({ bevelSegments: value })}
          />
        </>
      )}

      {node.primitive === 'ring' && (
        <RangeProperty
          label="Стороны"
          value={node.sides}
          min={3}
          max={128}
          step={1}
          unit=""
          disabled={node.locked}
          onChange={(value) => execute({ type: 'replace-node', node: { ...node, sides: value } })}
        />
      )}

      {node.primitive === 'polygon' && (
        <>
          <RangeProperty
            label="Стороны"
            value={node.sides}
            min={3}
            max={12}
            step={1}
            unit=""
            disabled={node.locked}
            onChange={(value) => execute({ type: 'replace-node', node: { ...node, sides: value } })}
          />
          <RangeProperty
            label="Скос"
            value={node.bevel}
            min={0}
            max={2.5}
            step={0.1}
            disabled={node.locked}
            onChange={(value) => execute({ type: 'replace-node', node: { ...node, bevel: value } })}
          />
          <RangeProperty
            label="Сегменты"
            value={node.parameters.bevelSegments}
            min={1}
            max={10}
            step={1}
            unit=""
            disabled={node.locked}
            onChange={(value) => replaceParameters({ bevelSegments: value })}
          />
        </>
      )}

      {(node.primitive === 'extrude-sketch' ||
        node.primitive === 'revolve-sketch' ||
        node.primitive === 'scribble') && (
        <>
          <button
            type="button"
            className="asa3d-sketch-edit-button"
            disabled={node.locked}
            onClick={() => setSketchOpen(true)}
          >
            Редактировать эскиз
          </button>
          {node.primitive === 'extrude-sketch' && (
            <>
              <RangeProperty
                label="Верхний масштаб"
                value={node.parameters.topScale}
                min={0.1}
                max={2}
                step={0.05}
                unit=""
                disabled={node.locked}
                onChange={(value) => replaceParameters({ topScale: value })}
              />
              <RangeProperty
                label="Нижний масштаб"
                value={node.parameters.baseScale}
                min={0.1}
                max={2}
                step={0.05}
                unit=""
                disabled={node.locked}
                onChange={(value) => replaceParameters({ baseScale: value })}
              />
              <RangeProperty
                label="Скручивание"
                value={node.parameters.twist}
                min={-360}
                max={360}
                step={1}
                unit="°"
                disabled={node.locked}
                onChange={(value) => replaceParameters({ twist: value })}
              />
              <RangeProperty
                label="Шаги скручивания"
                value={node.parameters.twistSteps}
                min={1}
                max={32}
                step={1}
                unit=""
                disabled={node.locked}
                onChange={(value) => replaceParameters({ twistSteps: value })}
              />
              <label className="asa3d-compact-text-field">
                <span>Режим</span>
                <select
                  value={node.parameters.smoothTwist ? 'smooth' : 'steps'}
                  disabled={node.locked}
                  onChange={(event) =>
                    replaceParameters({ smoothTwist: event.currentTarget.value === 'smooth' })
                  }
                >
                  <option value="steps">По шагам</option>
                  <option value="smooth">Плавный</option>
                </select>
              </label>
            </>
          )}
          {node.primitive === 'revolve-sketch' && (
            <RangeProperty
              label="Стороны"
              value={node.sides}
              min={3}
              max={128}
              step={1}
              unit=""
              disabled={node.locked}
              onChange={(value) =>
                execute({ type: 'replace-node', node: { ...node, sides: value } })
              }
            />
          )}
        </>
      )}

      {sketchOpen && (
        <SketchEditor
          primitive={node.primitive}
          initialPoints={node.parameters.sketchPoints}
          onCancel={() => {
            replaceParameters({ sketchAccepted: true });
            setSketchOpen(false);
          }}
          onApply={(sketchPoints) => {
            replaceParameters({ sketchPoints, sketchAccepted: true });
            setSketchOpen(false);
          }}
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

interface SketchEditorProps {
  readonly primitive: PrimitiveKind;
  readonly initialPoints: readonly Vector2Value[];
  readonly onCancel: () => void;
  readonly onApply: (points: readonly Vector2Value[]) => void;
}

function SketchEditor({
  primitive,
  initialPoints,
  onCancel,
  onApply,
}: SketchEditorProps): JSX.Element {
  const [points, setPoints] = useState<readonly Vector2Value[]>(initialPoints);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const revolve = primitive === 'revolve-sketch';
  const toPoint = (event: ReactPointerEvent<SVGSVGElement>): Vector2Value => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const screenX = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 320;
    const screenY = ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 220;
    return revolve
      ? {
          x: Math.min(1, Math.max(0.02, (screenX - 40) / 240)),
          y: Math.min(1, Math.max(-1, (110 - screenY) / 90)),
        }
      : {
          x: Math.min(1, Math.max(-1, (screenX - 160) / 120)),
          y: Math.min(1, Math.max(-1, (110 - screenY) / 90)),
        };
  };
  const screenPoint = (point: Vector2Value): { x: number; y: number } => ({
    x: revolve ? 40 + point.x * 240 : 160 + point.x * 120,
    y: 110 - point.y * 90,
  });
  const updatePoint = (index: number, point: Vector2Value): void => {
    setPoints((current) => current.map((item, itemIndex) => (itemIndex === index ? point : item)));
  };

  return (
    <div
      className="asa3d-sketch-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Редактор эскиза"
    >
      <section className="asa3d-sketch-editor">
        <header>
          <strong>
            {revolve ? 'Revolve sketch' : primitive === 'scribble' ? 'Scribble' : 'Extrude sketch'}
          </strong>
          <span>Щёлкните для точки, перетаскивайте существующие точки.</span>
        </header>
        <svg
          viewBox="0 0 320 220"
          aria-label="Область эскиза"
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget || points.length >= 256) return;
            setPoints((current) => [...current, toPoint(event)]);
          }}
          onPointerMove={(event) => {
            if (dragIndex === null) return;
            updatePoint(dragIndex, toPoint(event));
          }}
          onPointerUp={() => setDragIndex(null)}
          onPointerLeave={() => setDragIndex(null)}
        >
          <defs>
            <pattern id="asa3d-sketch-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#d7edf4" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="320" height="220" fill="url(#asa3d-sketch-grid)" pointerEvents="none" />
          {revolve && <line x1="40" y1="15" x2="40" y2="205" className="asa3d-sketch-axis" />}
          <polygon
            points={points
              .map((point) => {
                const screen = screenPoint(point);
                return `${screen.x},${screen.y}`;
              })
              .join(' ')}
            className={revolve ? 'revolve' : ''}
            pointerEvents="none"
          />
          {points.map((point, index) => {
            const screen = screenPoint(point);
            return (
              <circle
                key={`${index}-${point.x}-${point.y}`}
                cx={screen.x}
                cy={screen.y}
                r="6"
                tabIndex={0}
                aria-label={`Точка ${index + 1}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setDragIndex(index);
                }}
              />
            );
          })}
        </svg>
        <footer>
          <span>{points.length} точек</span>
          <button
            type="button"
            disabled={points.length <= 3}
            onClick={() => setPoints((current) => current.slice(0, -1))}
          >
            Удалить последнюю
          </button>
          <button type="button" onClick={() => setPoints(initialPoints)}>
            Сбросить
          </button>
          <button type="button" onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            className="primary"
            disabled={points.length < 3}
            onClick={() => onApply(points)}
          >
            Принять эскиз
          </button>
        </footer>
      </section>
    </div>
  );
}

interface RangePropertyProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly unit?: string;
  readonly onChange: (value: number) => void;
}

function RangeProperty({
  label,
  value,
  min,
  max,
  step,
  disabled,
  unit = 'мм',
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
        aria-label={unit ? `${label}, ${unit}` : label}
        onChange={(event) => onChange(numeric(event.currentTarget.value, value, min))}
      />
    </label>
  );
}
