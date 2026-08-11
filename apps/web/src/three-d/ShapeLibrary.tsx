import { useMemo, useState, type DragEvent } from 'react';
import type { PrimitiveKind } from '@asa-lab/three-d';
import { CommentIcon, SearchIcon } from '../electronics/workbench-icons';
import { ShapeThumbnail } from './ShapeThumbnail';
import { GridIcon, RulerIcon } from './three-d-icons';

interface ShapeLibraryProps {
  readonly onAdd: (primitive: PrimitiveKind) => void;
  readonly gridVisible: boolean;
  readonly onToggleGrid: () => void;
  readonly onOpenGridSettings: () => void;
}

const SHAPES: readonly { primitive: PrimitiveKind; label: string; color: string }[] = [
  { primitive: 'box', label: 'Параллелепипед', color: '#d71920' },
  { primitive: 'cylinder', label: 'Цилиндр', color: '#df7414' },
  { primitive: 'sphere', label: 'Сфера', color: '#0099c6' },
  { primitive: 'cone', label: 'Конус', color: '#6e2786' },
  { primitive: 'torus', label: 'Тор', color: '#0098c7' },
  { primitive: 'wedge', label: 'Клин', color: '#2f7d3a' },
  { primitive: 'roof', label: 'Крыша', color: '#58a84f' },
];

function beginDrag(event: DragEvent<HTMLButtonElement>, primitive: PrimitiveKind): void {
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData('application/x-asa-3d-primitive', primitive);
}

export function ShapeLibrary({
  onAdd,
  gridVisible,
  onToggleGrid,
  onOpenGridSettings,
}: ShapeLibraryProps): JSX.Element {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showHint, setShowHint] = useState(true);
  const filteredShapes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru');
    if (!searchOpen || !normalized) return SHAPES;
    return SHAPES.filter(({ label }) => label.toLocaleLowerCase('ru').includes(normalized));
  }, [query, searchOpen]);

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
        <button type="button" title="Линейка и параметры сетки" onClick={onOpenGridSettings}>
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
        <span>Основные формы</span>
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
        {filteredShapes.map(({ primitive, label, color }) => (
          <button
            type="button"
            className={`asa3d-shape-card shape-${primitive}`}
            key={primitive}
            draggable
            onDragStart={(event) => beginDrag(event, primitive)}
            onClick={() => onAdd(primitive)}
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
    </aside>
  );
}
