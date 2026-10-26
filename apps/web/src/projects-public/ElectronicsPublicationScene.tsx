import { useMemo, useRef, useState } from 'react';
import type { ElectronicsDisplayArtifact } from '@asa-lab/contracts';
import type { SchematicComponent } from '../api';
import { catalogEntry, renderedSize, terminalPosition } from '../electronics/component-catalog';
import { ProductionComponentVisual } from '../electronics/NativeOpticalComponentVisual';
import { componentTransform } from '../electronics/workbench-model';
import { roundedWirePath, wirePoints } from '../electronics/workbench-geometry';

/** A frozen presentation model; no editor, document state or runtime is mounted. */
export function ElectronicsPublicationScene({
  artifact,
}: {
  readonly artifact: ElectronicsDisplayArtifact;
}): JSX.Element {
  const scene = useMemo(() => {
    const components = artifact.components.map((source) => {
      const { pinIds, ...display } = source;
      const component: SchematicComponent = Object.freeze({
        ...display,
        position: Object.freeze({ ...source.position }),
        ...(pinIds ? { pinIds: [...pinIds] } : {}),
      });
      if (component.pinIds) Object.freeze(component.pinIds);
      const entry = catalogEntry(component);
      if (!entry) throw new Error('Unsupported public component');
      return Object.freeze({
        component,
        entry,
        size: renderedSize(entry),
        bounds: renderedSize(entry, component.rotation),
      });
    });
    const indexed = new Map(components.map((item) => [item.component.id, item]));
    const wires = artifact.connections.map((wire) => {
      const from = indexed.get(wire.from.componentId)?.component;
      const to = indexed.get(wire.to.componentId)?.component;
      const a = from && terminalPosition(from, from.position, wire.from.terminal, from.rotation);
      const b = to && terminalPosition(to, to.position, wire.to.terminal, to.rotation);
      if (!a || !b) throw new Error('Unsupported public terminal');
      return Object.freeze({
        id: wire.id,
        color: wire.color ?? '#287b63',
        points: Object.freeze(
          wirePoints(a, b, wire.vertices).map((point) => Object.freeze({ ...point })),
        ),
      });
    });
    const points = [
      ...components.flatMap(({ component: c, bounds }) => [
        c.position,
        { x: c.position.x + bounds.width, y: c.position.y + bounds.height },
      ]),
      ...wires.flatMap((wire) => wire.points),
    ];
    const minX = points.length ? Math.min(...points.map((point) => point.x)) : 0;
    const minY = points.length ? Math.min(...points.map((point) => point.y)) : 0;
    const maxX = points.length ? Math.max(...points.map((point) => point.x)) : 200;
    const maxY = points.length ? Math.max(...points.map((point) => point.y)) : 150;
    const width = Math.max(320, maxX - minX + 80);
    const height = Math.max(width / 1.6, maxY - minY + 80);
    return {
      components: Object.freeze(components),
      wires: Object.freeze(wires),
      fit: { x: minX - 40, y: minY - 40, width, height },
    };
  }, [artifact]);
  const [view, setView] = useState(scene.fit);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const zoom = (factor: number) =>
    setView((current) => {
      const width = Math.max(
        scene.fit.width / 8,
        Math.min(scene.fit.width * 4, current.width * factor),
      );
      const height = (width * current.height) / current.width;
      return {
        x: current.x + (current.width - width) / 2,
        y: current.y + (current.height - height) / 2,
        width,
        height,
      };
    });
  return (
    <section
      className="public-electronics-viewer"
      data-testid="public-electronics-viewer"
      aria-label="Опубликованная электрическая схема"
    >
      <div className="public-electronics-tools" role="toolbar" aria-label="Просмотр схемы">
        <span>Схема · только просмотр</span>
        <button
          type="button"
          data-testid="public-electronics-zoom-out"
          aria-label="Уменьшить схему"
          onClick={() => zoom(1.25)}
        >
          −
        </button>
        <output aria-label="Масштаб">{Math.round((scene.fit.width / view.width) * 100)}%</output>
        <button
          type="button"
          data-testid="public-electronics-zoom-in"
          aria-label="Увеличить схему"
          onClick={() => zoom(0.8)}
        >
          +
        </button>
        <button
          type="button"
          data-testid="public-electronics-fit"
          onClick={() => setView(scene.fit)}
        >
          Вписать
        </button>
      </div>
      <svg
        data-testid="public-electronics-scene"
        className="public-electronics-scene"
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        tabIndex={0}
        role="img"
        aria-label="Схема. Стрелки перемещают, плюс и минус меняют масштаб, Home вписывает схему. На сенсорном экране перемещайте схему по горизонтали."
        onKeyDown={(event) => {
          const direction = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          }[event.key];
          if (direction) {
            event.preventDefault();
            setView((current) => ({
              ...current,
              x: current.x + (direction[0]! * current.width) / 10,
              y: current.y + (direction[1]! * current.height) / 10,
            }));
          } else if (['+', '=', '-', 'Home'].includes(event.key)) {
            event.preventDefault();
            if (event.key === 'Home') setView(scene.fit);
            else zoom(event.key === '-' ? 1.25 : 0.8);
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          drag.current = { ...start, x: event.clientX, y: event.clientY };
          if (rect.width && rect.height)
            setView((current) => {
              const scale = Math.min(rect.width / current.width, rect.height / current.height);
              return {
                ...current,
                x: current.x - dx / scale,
                y: current.y - (event.pointerType === 'touch' ? 0 : dy / scale),
              };
            });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <g data-testid="public-electronics-viewport" pointerEvents="none" aria-hidden="true">
          {scene.wires.map((wire) => (
            <path
              key={wire.id}
              data-testid="public-electronics-wire"
              data-wire-id={wire.id}
              d={roundedWirePath(wire.points)}
              fill="none"
              stroke={wire.color}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {scene.components.map(({ component, entry, size }) => (
            <g
              key={component.id}
              data-testid="public-electronics-component"
              data-component-id={component.id}
              transform={componentTransform(component)}
            >
              <ProductionComponentVisual
                component={component}
                entry={entry}
                width={size.width}
                height={size.height}
                visualState="default"
                simulationRunning={false}
              />
            </g>
          ))}
        </g>
      </svg>
      <p className="public-electronics-hint">
        Перетаскивайте схему · Масштаб кнопками + / − · Home — вписать
      </p>
    </section>
  );
}
