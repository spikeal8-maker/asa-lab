import type { DragEvent } from 'react';
import type { PrimitiveKind } from '@asa-lab/three-d';

interface ShapeLibraryProps {
  readonly onAdd: (primitive: PrimitiveKind) => void;
}

const SHAPES: readonly { primitive: PrimitiveKind; label: string }[] = [
  { primitive: 'box', label: 'Параллелепипед' },
  { primitive: 'cylinder', label: 'Цилиндр' },
  { primitive: 'sphere', label: 'Сфера' },
  { primitive: 'cone', label: 'Конус' },
  { primitive: 'torus', label: 'Тор' },
  { primitive: 'wedge', label: 'Клин' },
  { primitive: 'roof', label: 'Крыша' },
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
        {SHAPES.map(({ primitive, label }) => (
          <button
            type="button"
            className={`asa3d-shape-card shape-${primitive}`}
            key={primitive}
            draggable
            onDragStart={(event) => beginDrag(event, primitive)}
            onClick={() => onAdd(primitive)}
            title={`Добавить: ${label}`}
          >
            <span className="asa3d-shape-preview" aria-hidden="true" />
            <small>{label}</small>
          </button>
        ))}
      </div>
      <p className="asa3d-library-hint">Перетащите форму на плоскость или нажмите на неё.</p>
    </aside>
  );
}
