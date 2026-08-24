import { useMemo, useState, type DragEvent } from 'react';
import { THREE_D_SHAPE_COLORS, type PrimitiveKind, type ShapeOperation } from '@asa-lab/three-d';
import { CommentIcon, SearchIcon } from '../electronics/workbench-icons';
import { ShapeThumbnail } from './ShapeThumbnail';
import { GridIcon, RulerIcon } from './three-d-icons';

interface ShapeLibraryProps {
  readonly onAdd: (
    primitive: PrimitiveKind,
    position?: { x: number; y?: number; z: number },
    additive?: boolean,
    operation?: ShapeOperation,
  ) => void;
  readonly onDragStateChange: (
    placement: { readonly primitive: PrimitiveKind; readonly operation: ShapeOperation } | null,
  ) => void;
  readonly gridVisible: boolean;
  readonly onToggleGrid: () => void;
  readonly onOpenGridSettings: () => void;
  readonly rulerVisible: boolean;
  readonly onToggleRuler: () => void;
}

type ShapeCategory = 'basic' | 'round' | 'generators' | 'symbols';

const CATEGORIES: readonly { readonly id: ShapeCategory; readonly label: string }[] = [
  { id: 'basic', label: 'Основные формы' },
  { id: 'round', label: 'Круглые формы' },
  { id: 'generators', label: 'Генераторы форм' },
  { id: 'symbols', label: 'Символы и знаки' },
];

const SHAPES: readonly {
  primitive: PrimitiveKind;
  label: string;
  color: string;
  category: ShapeCategory;
}[] = [
  { primitive: 'box', label: 'Параллелепипед', color: THREE_D_SHAPE_COLORS.box, category: 'basic' },
  {
    primitive: 'cylinder',
    label: 'Цилиндр',
    color: THREE_D_SHAPE_COLORS.cylinder,
    category: 'basic',
  },
  { primitive: 'sphere', label: 'Сфера', color: THREE_D_SHAPE_COLORS.sphere, category: 'basic' },
  {
    primitive: 'extrude-sketch',
    label: 'Extrude sketch',
    color: THREE_D_SHAPE_COLORS['extrude-sketch'],
    category: 'basic',
  },
  {
    primitive: 'revolve-sketch',
    label: 'Revolve sketch',
    color: THREE_D_SHAPE_COLORS['revolve-sketch'],
    category: 'basic',
  },
  {
    primitive: 'scribble',
    label: 'Scribble',
    color: THREE_D_SHAPE_COLORS.scribble,
    category: 'basic',
  },
  { primitive: 'cone', label: 'Конус', color: THREE_D_SHAPE_COLORS.cone, category: 'basic' },
  {
    primitive: 'pyramid',
    label: 'Пирамида',
    color: THREE_D_SHAPE_COLORS.pyramid,
    category: 'basic',
  },
  { primitive: 'roof', label: 'Крыша', color: THREE_D_SHAPE_COLORS.roof, category: 'basic' },
  { primitive: 'text', label: 'Текст', color: THREE_D_SHAPE_COLORS.text, category: 'basic' },
  {
    primitive: 'round-roof',
    label: 'Круглая кровля',
    color: THREE_D_SHAPE_COLORS['round-roof'],
    category: 'basic',
  },
  {
    primitive: 'half-sphere',
    label: 'Полусфера',
    color: THREE_D_SHAPE_COLORS['half-sphere'],
    category: 'basic',
  },
  { primitive: 'torus', label: 'Тор', color: THREE_D_SHAPE_COLORS.torus, category: 'basic' },
  { primitive: 'tube', label: 'Труба', color: THREE_D_SHAPE_COLORS.tube, category: 'basic' },
  { primitive: 'ring', label: 'Кольцо', color: THREE_D_SHAPE_COLORS.ring, category: 'basic' },
  { primitive: 'wedge', label: 'Клин', color: THREE_D_SHAPE_COLORS.wedge, category: 'basic' },
  {
    primitive: 'polygon',
    label: 'Многоугольник',
    color: THREE_D_SHAPE_COLORS.polygon,
    category: 'basic',
  },
  {
    primitive: 'icosahedron',
    label: 'Икосаэдр',
    color: THREE_D_SHAPE_COLORS.icosahedron,
    category: 'basic',
  },
  { primitive: 'star', label: 'Звезда', color: THREE_D_SHAPE_COLORS.star, category: 'basic' },
  {
    primitive: 'star-6',
    label: 'Звезда',
    color: THREE_D_SHAPE_COLORS['star-6'],
    category: 'basic',
  },
  { primitive: 'heart', label: 'Сердце', color: THREE_D_SHAPE_COLORS.heart, category: 'basic' },
  {
    primitive: 'rounded-box',
    label: 'Скруглённый блок',
    color: THREE_D_SHAPE_COLORS['rounded-box'],
    category: 'round',
  },
  {
    primitive: 'capsule',
    label: 'Капсула',
    color: THREE_D_SHAPE_COLORS.capsule,
    category: 'round',
  },
  {
    primitive: 'paraboloid',
    label: 'Параболоид',
    color: THREE_D_SHAPE_COLORS.paraboloid,
    category: 'generators',
  },
  { primitive: 'diamond', label: 'Ромб', color: THREE_D_SHAPE_COLORS.diamond, category: 'symbols' },
];

function beginDrag(
  event: DragEvent<HTMLButtonElement>,
  primitive: PrimitiveKind,
  operation: ShapeOperation,
): void {
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('application/x-asa-3d-primitive', primitive);
  event.dataTransfer.setData('application/x-asa-3d-operation', operation);
  const transparentDragImage = globalThis.document.createElement('canvas');
  transparentDragImage.width = 1;
  transparentDragImage.height = 1;
  event.dataTransfer.setDragImage(transparentDragImage, 0, 0);
}

const HOLE_SHORTCUTS = SHAPES.filter(
  ({ primitive }) => primitive === 'box' || primitive === 'cylinder' || primitive === 'sphere',
);

export function ShapeLibrary({
  onAdd,
  onDragStateChange,
  gridVisible,
  onToggleGrid,
  onOpenGridSettings,
  rulerVisible,
  onToggleRuler,
}: ShapeLibraryProps): JSX.Element {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showHint, setShowHint] = useState(true);
  const [category, setCategory] = useState<ShapeCategory>('basic');
  const filteredShapes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru');
    if (searchOpen && normalized)
      return SHAPES.filter(({ label }) => label.toLocaleLowerCase('ru').includes(normalized));
    return SHAPES.filter((shape) => shape.category === category);
  }, [category, query, searchOpen]);

  return (
    <aside className="asa3d-library" aria-label="Библиотека форм">
      <header className="asa3d-library-tools" aria-label="Инструменты рабочей плоскости">
        <button
          type="button"
          className={gridVisible ? 'active' : ''}
          title={gridVisible ? 'Скрыть рабочую плоскость' : 'Показать рабочую плоскость'}
          aria-pressed={gridVisible}
          onClick={onToggleGrid}
        >
          <GridIcon />
        </button>
        <button
          type="button"
          className={rulerVisible ? 'active' : ''}
          title="Расширенная линейка"
          aria-pressed={rulerVisible}
          onClick={onToggleRuler}
        >
          <RulerIcon />
        </button>
        <button
          type="button"
          className={showHint ? 'active' : ''}
          title="Подсказка по добавлению форм"
          aria-pressed={showHint}
          onClick={() => setShowHint((visible) => !visible)}
        >
          <CommentIcon />
        </button>
      </header>
      <div className="asa3d-library-title">
        <label className="asa3d-library-category">
          <span className="sr-only">Каталог форм</span>
          <select
            aria-label="Каталог форм"
            value={category}
            onChange={(event) => setCategory(event.currentTarget.value as ShapeCategory)}
          >
            {CATEGORIES.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label="Поиск форм"
          aria-expanded={searchOpen}
          onClick={() => setSearchOpen((open) => !open)}
        >
          <SearchIcon />
        </button>
      </div>
      {searchOpen && (
        <label className="asa3d-library-search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            autoFocus
            aria-label="Название формы"
            placeholder="Поиск формы"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query && (
            <button type="button" aria-label="Очистить поиск" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </label>
      )}
      <div className="asa3d-shape-grid">
        {!searchOpen &&
          category === 'basic' &&
          HOLE_SHORTCUTS.map(({ primitive, label }) => (
            <button
              type="button"
              className={`asa3d-shape-card asa3d-hole-card shape-${primitive}`}
              key={`hole-${primitive}`}
              draggable
              onDragStart={(event) => {
                beginDrag(event, primitive, 'hole');
                onDragStateChange({ primitive, operation: 'hole' });
              }}
              onDragEnd={() => onDragStateChange(null)}
              onClick={(event) => onAdd(primitive, undefined, event.shiftKey, 'hole')}
              aria-label={`Отверстие: ${label}`}
              title={`Добавить отверстие: ${label}`}
            >
              <ShapeThumbnail primitive={primitive} color="#aeb9c0" operation="hole" />
              <small>Отверстие</small>
            </button>
          ))}
        {filteredShapes.map(({ primitive, label, color }) => (
          <button
            type="button"
            className={`asa3d-shape-card shape-${primitive}`}
            key={primitive}
            data-primitive={primitive}
            data-category={category}
            draggable
            onDragStart={(event) => {
              beginDrag(event, primitive, 'solid');
              onDragStateChange({ primitive, operation: 'solid' });
            }}
            onDragEnd={() => onDragStateChange(null)}
            onClick={(event) => onAdd(primitive, undefined, event.shiftKey, 'solid')}
            title={`Добавить: ${label}`}
          >
            <ShapeThumbnail primitive={primitive} color={color} />
            <small>{label}</small>
          </button>
        ))}
        {filteredShapes.length === 0 && <p className="asa3d-library-empty">Форма не найдена</p>}
      </div>
      {showHint && (
        <p className="asa3d-library-hint">Перетащите форму на плоскость или нажмите на неё.</p>
      )}
      <button type="button" className="asa3d-library-settings" onClick={onOpenGridSettings}>
        Параметры рабочей плоскости
      </button>
    </aside>
  );
}
