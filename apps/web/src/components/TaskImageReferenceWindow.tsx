import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  clampTaskImageReferenceRect,
  defaultTaskImageReferenceRect,
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
  imageAlt,
  title = 'Схема',
  onClose,
}: {
  readonly src: string;
  readonly assignmentTitle: string;
  readonly imageAlt?: string;
  readonly title?: string;
  readonly onClose: () => void;
}): JSX.Element {
  const [rect, setRect] = useState<TaskImageReferenceRect>(readRect);
  const [unavailable, setUnavailable] = useState(false);
  const legacySample = imageAlt === undefined;
  const rectRef = useRef(rect);
  const operation = useRef<PointerOperation | null>(null);
  rectRef.current = rect;

  useEffect(() => setUnavailable(false), [src]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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

  function moveWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    const step = event.shiftKey ? 40 : 10;
    let deltaX = 0;
    let deltaY = 0;
    switch (event.key) {
      case 'ArrowLeft':
        deltaX = -step;
        break;
      case 'ArrowRight':
        deltaX = step;
        break;
      case 'ArrowUp':
        deltaY = -step;
        break;
      case 'ArrowDown':
        deltaY = step;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = moveTaskImageReferenceRect(
      rectRef.current,
      deltaX,
      deltaY,
      window.innerWidth,
      window.innerHeight,
    );
    rectRef.current = next;
    setRect(next);
    window.localStorage.setItem(RECT_KEY, JSON.stringify(next));
  }

  function changeSize(delta: number): void {
    const next = clampTaskImageReferenceRect(
      {
        ...rectRef.current,
        width: rectRef.current.width + delta,
        height: rectRef.current.height + Math.round(delta * 0.75),
      },
      window.innerWidth,
      window.innerHeight,
    );
    rectRef.current = next;
    setRect(next);
    window.localStorage.setItem(RECT_KEY, JSON.stringify(next));
  }

  function resetRect(): void {
    const next = defaultTaskImageReferenceRect(window.innerWidth, window.innerHeight);
    rectRef.current = next;
    setRect(next);
    window.localStorage.removeItem(RECT_KEY);
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
          aria-label={legacySample ? 'Переместить окно схемы' : `Переместить окно: ${title}`}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          title={
            legacySample
              ? 'Переместить окно схемы мышью или стрелками'
              : 'Переместить окно мышью или стрелками'
          }
          onPointerDown={beginMove}
          onKeyDown={moveWithKeyboard}
        >
          <span id="task-image-reference-title">{title}</span>
          <span aria-hidden="true">⠿</span>
        </button>
        <button
          type="button"
          className="task-image-reference-action"
          aria-label={legacySample ? 'Уменьшить окно схемы' : `Уменьшить окно: ${title}`}
          title={legacySample ? 'Уменьшить окно схемы' : 'Уменьшить окно'}
          onClick={() => changeSize(-40)}
        >
          −
        </button>
        <button
          type="button"
          className="task-image-reference-action"
          aria-label={legacySample ? 'Увеличить окно схемы' : `Увеличить окно: ${title}`}
          title={legacySample ? 'Увеличить окно схемы' : 'Увеличить окно'}
          onClick={() => changeSize(40)}
        >
          +
        </button>
        <button
          type="button"
          className="task-image-reference-action"
          aria-label={legacySample ? 'Сбросить положение схемы' : `Сбросить положение: ${title}`}
          title={
            legacySample ? 'Сбросить положение и размер схемы' : 'Сбросить положение и размер окна'
          }
          onClick={resetRect}
        >
          ↺
        </button>
        <button
          type="button"
          className="task-image-reference-close"
          aria-label={legacySample ? 'Закрыть схему' : `Закрыть окно: ${title}`}
          title={legacySample ? 'Закрыть схему' : 'Закрыть окно'}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="task-image-reference-body">
        {unavailable ? (
          <p role="alert">
            {legacySample ? 'Образец сейчас недоступен.' : 'Изображение сейчас недоступно.'}{' '}
            Обновите задание и попробуйте снова.
          </p>
        ) : (
          <img
            data-testid="task-image-reference-image"
            src={src}
            alt={imageAlt ?? `Схема задания: ${assignmentTitle}`}
            draggable={false}
            onError={() => setUnavailable(true)}
          />
        )}
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
