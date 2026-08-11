import type { DragEvent } from 'react';
import type { PrimitiveKind } from '@asa-lab/three-d';
import { ShapeThumbnail } from './ShapeThumbnail';

interface ShapeLibraryProps {
  readonly onAdd: (primitive: PrimitiveKind) => void;
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

export function ShapeLibrary({ onAdd }: ShapeLibraryProps): JSX.Element {
  return (
    <aside className="asa3d-library" aria-label="Библиотека форм">
      <header className="asa3d-library-tools" aria-label="Инструменты рабочей плоскости">
        <button type="button" title="Рабочая плоскость">
          ▦
        </button>
        <button type="button" title="Линейка">
          ∟
        </button>
        <button type="button" title="Заметка">
          ◰
        </button>
      </header>
      <div className="asa3d-library-title">
        <span>Основные формы</span>
        <button type="button" aria-label="Поиск форм">
          ⌕
        </button>
      </div>
      <div className="asa3d-shape-grid">
        {SHAPES.map(({ primitive, label, color }) => (
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
      </div>
      <p className="asa3d-library-hint">Перетащите форму на плоскость или нажмите на неё.</p>
    </aside>
  );
}
