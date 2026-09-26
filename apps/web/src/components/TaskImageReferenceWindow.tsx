import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  clampTaskImageReferenceRect,
  moveTaskImageReferenceRect,
  parseTaskImageReferenceRect,
  resizeTaskImageReferenceRect,
  type TaskImageReferenceRect,
  type TaskImageReferenceResizeEdge,
} from './task-image-reference-window-layout';
import './task-image-reference-window.css';

const RECT_KEY = 'asa-task-image-reference-rect-v1';

const RESIZE_EDGES: readonly TaskImageReferenceResizeEdge[] = [
  'top',
  'right',
  'bottom',
  'left',
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
];

type PointerOperation =
  | {
      readonly kind: 'move';
      readonly startX: number;
      readonly startY: number;
      readonly startRect: TaskImageReferenceRect;
      readonly pointerId: number;
      readonly target: HTMLElement;
    }
  | {
      readonly kind: 'resize';
      readonly edge: TaskImageReferenceResizeEdge;
      readonly startX: number;
      readonly startY: number;
      readonly startRect: TaskImageReferenceRect;
      readonly pointerId: number;
      readonly target: HTMLElement;
    };

function readRect(): TaskImageReferenceRect {
  return parseTaskImageReferenceRect(
    window.localStorage.getItem(RECT_KEY),
    window.innerWidth,
    window.innerHeight,
  );
}

export function TaskImageReferenceWindow({
  src,
  assignmentTitle,
  onClose,
}: {
  readonly src: string;
  readonly assignmentTitle: string;
  readonly onClose: () => void;
}): JSX.Element {
  const [rect, setRect] = useState<TaskImageReferenceRect>(readRect);
  const rectRef = useRef(rect);
  const operation = useRef<PointerOperation | null>(null);
  rectRef.current = rect;

  useEffect(() => {
    const onPointerMove = (event: PointerEvent): void => {
      const current = operation.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const deltaX = event.clientX - current.startX;
      const deltaY = event.clientY - current.startY;
      const next =
        current.kind === 'move'
          ? moveTaskImageReferenceRect(
              current.startRect,
              deltaX,
              deltaY,
              window.innerWidth,
              window.innerHeight,
            )
          : resizeTaskImageReferenceRect(
              current.startRect,
              current.edge,
              deltaX,
              deltaY,
              window.innerWidth,
              window.innerHeight,
            );
      rectRef.current = next;
      setRect(next);
    };
    const finish = (event: PointerEvent): void => {
      const current = operation.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (current.target.hasPointerCapture(current.pointerId)) {
        current.target.releasePointerCapture(current.pointerId);
      }
      operation.current = null;
      window.localStorage.setItem(RECT_KEY, JSON.stringify(rectRef.current));
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, []);

  useEffect(() => {
    const onResize = (): void => {
      const next = clampTaskImageReferenceRect(
        rectRef.current,
        window.innerWidth,
        window.innerHeight,
      );
      rectRef.current = next;
      setRect(next);
      window.localStorage.setItem(RECT_KEY, JSON.stringify(next));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function beginMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    operation.current = {
      kind: 'move',
      startX: event.clientX,
      startY: event.clientY,
      startRect: rectRef.current,
      pointerId: event.pointerId,
      target: event.currentTarget,
    };
  }

  function beginResize(
    edge: TaskImageReferenceResizeEdge,
    event: ReactPointerEvent<HTMLSpanElement>,
  ): void {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    operation.current = {
      kind: 'resize',
      edge,
      startX: event.clientX,
      startY: event.clientY,
      startRect: rectRef.current,
      pointerId: event.pointerId,
      target: event.currentTarget,
    };
  }

  const style: CSSProperties = {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };

  return (
    <aside
      className="task-image-reference-window"
      data-testid="task-image-reference-window"
      role="dialog"
      aria-labelledby="task-image-reference-title"
      style={style}
    >
      <header className="task-image-reference-header">
        <button
          type="button"
          className="task-image-reference-drag"
          data-testid="task-image-reference-drag"
          aria-label="Переместить окно схемы"
          title="Переместить окно схемы"
          onPointerDown={beginMove}
        >
          <span id="task-image-reference-title">Схема</span>
          <span aria-hidden="true">⠿</span>
        </button>
        <button
          type="button"
          className="task-image-reference-close"
          aria-label="Закрыть схему"
          title="Закрыть схему"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="task-image-reference-body">
        <img
          data-testid="task-image-reference-image"
          src={src}
          alt={`Схема задания: ${assignmentTitle}`}
          draggable={false}
        />
      </div>
      {RESIZE_EDGES.map((edge) => (
        <span
          key={edge}
          className={`task-image-reference-resize task-image-reference-resize-${edge}`}
          data-testid={`task-image-reference-resize-${edge}`}
          aria-hidden="true"
          onPointerDown={(event) => beginResize(edge, event)}
        />
      ))}
    </aside>
  );
}
