import { useMemo, useState, type DragEvent } from 'react';
import type { PrimitiveKind, ShapeOperation } from '@asa-lab/three-d';
import { CommentIcon, SearchIcon } from '../electronics/workbench-icons';
import { ShapeThumbnail } from './ShapeThumbnail';
import { GridIcon, RulerIcon } from './three-d-icons';

interface ShapeLibraryProps {
  readonly onAdd: (
    primitive: PrimitiveKind,
    position?: { x: number; z: number },
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
  { primitive: 'box', label: 'Параллелепипед', color: '#d71920', category: 'basic' },
  { primitive: 'cylinder', label: 'Цилиндр', color: '#df7414', category: 'basic' },
  { primitive: 'sphere', label: 'Сфера', color: '#0099c6', category: 'basic' },
  { primitive: 'cone', label: 'Конус', color: '#6e2786', category: 'basic' },
  { primitive: 'torus', label: 'Тор', color: '#0098c7', category: 'basic' },
  { primitive: 'wedge', label: 'Клин', color: '#2f7d3a', category: 'basic' },
  { primitive: 'roof', label: 'Крыша', color: '#58a84f', category: 'basic' },
  { primitive: 'pyramid', label: 'Пирамида', color: '#f2c313', category: 'basic' },
  { primitive: 'half-sphere', label: 'Полусфера', color: '#d94693', category: 'round' },
  { primitive: 'tube', label: 'Труба', color: '#e68117', category: 'round' },
  { primitive: 'rounded-box', label: 'Скруглённый блок', color: '#1e70c9', category: 'round' },
  { primitive: 'polygon', label: 'Многоугольник', color: '#304c97', category: 'generators' },
  { primitive: 'capsule', label: 'Капсула', color: '#00a5c8', category: 'round' },
  { primitive: 'paraboloid', label: 'Параболоид', color: '#7fb34d', category: 'generators' },
  { primitive: 'diamond', label: 'Ромб', color: '#d82633', category: 'symbols' },
  { primitive: 'star', label: 'Звезда', color: '#f2c313', category: 'symbols' },
  { primitive: 'heart', label: 'Сердце', color: '#b7653f', category: 'symbols' },
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
