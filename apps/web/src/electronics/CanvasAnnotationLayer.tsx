import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { SchematicAnnotation } from '../api';
import type { Point } from './workbench-geometry';
import type { CanvasAnnotationsController } from './use-canvas-annotations';
import { boundedAnnotation, CANVAS_ANNOTATION_LIMITS } from './workbench-annotations';

interface Gesture {
  pointerId: number;
  origin: Point;
  client: Point;
  annotation: SchematicAnnotation;
  resize: boolean;
  target: SVGGElement;
}

export function CanvasAnnotationLayer({
  controller,
  toWorld,
}: {
  controller: CanvasAnnotationsController;
  toWorld: (event: ReactPointerEvent<SVGGElement>) => Point;
}) {
  const gesture = useRef<Gesture | null>(null);
  const layer = useRef<SVGGElement | null>(null);
  const [worldPerPixel, setWorldPerPixel] = useState(1);
  const [preview, setPreview] = useState<SchematicAnnotation | null>(null);
  const cancel = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    setPreview(null);
    try {
      if (current?.target.hasPointerCapture(current.pointerId))
        current.target.releasePointerCapture(current.pointerId);
    } catch {
      /* removed node */
    }
  }, []);
  useLayoutEffect(() => {
    const matrix = layer.current?.getScreenCTM?.();
    const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
    if (Number.isFinite(scale) && scale > 0)
      setWorldPerPixel((old) => (Math.abs(old - 1 / scale) < 1e-9 ? old : 1 / scale));
  });
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [cancel]);
  const moved = (event: ReactPointerEvent<SVGGElement>, current: Gesture) =>
    Math.hypot(event.clientX - current.client.x, event.clientY - current.client.y) >= 3;
  const proposed = (event: ReactPointerEvent<SVGGElement>, current: Gesture) => {
    const point = toWorld(event),
      dx = point.x - current.origin.x,
      dy = point.y - current.origin.y;
    return boundedAnnotation(
      current.resize
        ? {
            ...current.annotation,
            size: {
              width: current.annotation.size.width + dx,
              height: current.annotation.size.height + dy,
            },
          }
        : {
            ...current.annotation,
            position: {
              x: current.annotation.position.x + dx,
              y: current.annotation.position.y + dy,
            },
          },
    );
  };
  return (
    <g ref={layer} className="workbench-annotation-layer" data-testid="canvas-annotation-layer">
      {controller.items.map((item) => {
        const annotation = preview?.id === item.id ? preview : item;
        const selected = controller.selectedIds.includes(item.id);
        return (
          <g
            key={item.id}
            data-canvas-annotation={item.id}
            data-testid="canvas-annotation"
            data-annotation-x={annotation.position.x}
            data-annotation-y={annotation.position.y}
            transform={`translate(${annotation.position.x} ${annotation.position.y})`}
            className={`workbench-annotation${selected ? ' selected' : ''}`}
            role="group"
            tabIndex={0}
            aria-label={`Текст на схеме: ${annotation.text || 'Пустой текст'}`}
            onFocus={() => {
              if (!selected) controller.select(item.id);
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || gesture.current) return;
              event.preventDefault();
              event.stopPropagation();
              controller.select(item.id);
              event.currentTarget.focus();
              const resize = (event.target as Element).closest('[data-annotation-resize]') !== null;
              gesture.current = {
                pointerId: event.pointerId,
                origin: toWorld(event),
                client: { x: event.clientX, y: event.clientY },
                annotation: item,
                resize,
                target: event.currentTarget,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = gesture.current;
              if (!current || current.pointerId !== event.pointerId) return;
              event.preventDefault();
              event.stopPropagation();
              if (moved(event, current)) setPreview(proposed(event, current));
            }}
            onPointerUp={(event) => {
              const current = gesture.current;
              if (!current || current.pointerId !== event.pointerId) return;
              event.preventDefault();
              event.stopPropagation();
              const next = proposed(event, current);
              gesture.current = null;
              setPreview(null);
              if (moved(event, current))
                controller.update(
                  item.id,
                  current.resize ? { size: next.size } : { position: next.position },
                  current.annotation,
                );
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={(event) => {
              event.stopPropagation();
              cancel();
            }}
            onLostPointerCapture={() => {
              if (gesture.current) cancel();
            }}
          >
            <rect
              className="workbench-annotation-box"
              width={annotation.size.width}
              height={annotation.size.height}
              rx={3}
              vectorEffect="non-scaling-stroke"
            />
            <foreignObject
              width={annotation.size.width}
              height={annotation.size.height}
              pointerEvents="none"
            >
              <div
                className="workbench-annotation-content"
                style={{ fontSize: annotation.fontSize }}
              >
                {annotation.text}
              </div>
            </foreignObject>
            {selected ? (
              <g
                data-annotation-resize="true"
                className="workbench-annotation-resize"
                aria-label="Изменить размер текста"
              >
                <rect
                  x={annotation.size.width - 20 * worldPerPixel}
                  y={annotation.size.height - 20 * worldPerPixel}
                  width={40 * worldPerPixel}
                  height={40 * worldPerPixel}
                  fill="transparent"
                />
                <rect
                  x={annotation.size.width - 6 * worldPerPixel}
                  y={annotation.size.height - 6 * worldPerPixel}
                  width={12 * worldPerPixel}
                  height={12 * worldPerPixel}
                  fill="#1286b5"
                  pointerEvents="none"
                />
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

export function CanvasAnnotationEditor({
  controller,
}: {
  controller: CanvasAnnotationsController;
}) {
  const annotation = controller.selected;
  const selectedId = annotation?.id;
  const text = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (selectedId && controller.editing) text.current?.focus();
  }, [selectedId, controller.editing]);
  if (!annotation) return null;
  return (
    <section
      className="workbench-annotation-editor"
      aria-label="Текст на схеме"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          controller.clear();
        }
      }}
    >
      <div className="workbench-annotation-heading">
        <strong>Текст на схеме</strong>
        <button type="button" onClick={controller.clear} aria-label="Закрыть свойства текста">
          ×
        </button>
      </div>
      <label>
        Текст
        <textarea
          ref={text}
          aria-label="Текст на схеме"
          maxLength={CANVAS_ANNOTATION_LIMITS.textLength}
          value={annotation.text}
          onChange={(event) =>
            controller.update(annotation.id, { text: event.currentTarget.value })
          }
        />
      </label>
      <div className="workbench-annotation-fields">
        {(['fontSize', 'width', 'height'] as const).map((field) => {
          const value = field === 'fontSize' ? annotation.fontSize : annotation.size[field];
          const label =
            field === 'fontSize'
              ? 'Размер шрифта'
              : field === 'width'
                ? 'Ширина текста'
                : 'Высота текста';
          return (
            <label key={field}>
              {label}
              <input
                key={`${annotation.id}:${field}:${value}`}
                type="number"
                aria-label={label}
                defaultValue={value}
                min={
                  field === 'fontSize'
                    ? CANVAS_ANNOTATION_LIMITS.minFontSize
                    : field === 'width'
                      ? CANVAS_ANNOTATION_LIMITS.minWidth
                      : CANVAS_ANNOTATION_LIMITS.minHeight
                }
                max={
                  field === 'fontSize'
                    ? CANVAS_ANNOTATION_LIMITS.maxFontSize
                    : CANVAS_ANNOTATION_LIMITS.maxSize
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    event.currentTarget.value = String(value);
                    event.currentTarget.blur();
                  }
                }}
                onBlur={(event) => {
                  const next = event.currentTarget.valueAsNumber;
                  if (!Number.isFinite(next)) {
                    event.currentTarget.value = String(value);
                    return;
                  }
                  controller.update(
                    annotation.id,
                    field === 'fontSize'
                      ? { fontSize: next }
                      : { size: { ...annotation.size, [field]: next } },
                  );
                }}
              />
            </label>
          );
        })}
      </div>
      <div className="workbench-annotation-actions">
        <button type="button" onClick={controller.copy}>
          Копировать текст
        </button>
        <button type="button" onClick={controller.remove}>
          Удалить текст
        </button>
      </div>
    </section>
  );
}
