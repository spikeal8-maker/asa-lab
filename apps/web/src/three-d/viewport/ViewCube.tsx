import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { CameraViewState, StandardCameraView } from './SceneRuntime';

interface ViewCubeProps {
  readonly orientation: CameraViewState;
  readonly onOrbit: (deltaX: number, deltaY: number) => void;
  readonly onSetView: (view: StandardCameraView) => void;
}

interface DragState {
  readonly pointerId: number;
  x: number;
  y: number;
  moved: boolean;
}

const FACES: readonly { view: StandardCameraView; label: string }[] = [
  { view: 'front', label: 'СПЕРЕДИ' },
  { view: 'back', label: 'СЗАДИ' },
  { view: 'right', label: 'СПРАВА' },
  { view: 'left', label: 'СЛЕВА' },
  { view: 'top', label: 'СВЕРХУ' },
  { view: 'bottom', label: 'СНИЗУ' },
];

export function ViewCube({ orientation, onOrbit, onSetView }: ViewCubeProps): JSX.Element {
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const style = {
    '--asa3d-cube-pitch': `${-orientation.pitch}deg`,
    '--asa3d-cube-yaw': `${orientation.yaw}deg`,
  } as CSSProperties;

  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    if (Math.abs(deltaX) + Math.abs(deltaY) < 0.5) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.moved = true;
    event.preventDefault();
    onOrbit(deltaX, deltaY);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  return (
    <div
      className="asa3d-view-cube"
      data-testid="asa3d-view-cube"
      data-dragging={dragging ? 'true' : 'false'}
      aria-label="Куб управления видом. Потяните мышью или пальцем для вращения"
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={(event) => {
        if (!dragRef.current?.moved) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = null;
      }}
    >
      <div className="asa3d-view-cube-scene">
        <div className="asa3d-view-cube-body" style={style}>
          {FACES.map(({ view, label }) => (
            <button
              key={view}
              type="button"
              className={`asa3d-view-cube-face ${view}`}
              aria-label={`Вид: ${label.toLocaleLowerCase('ru-RU')}`}
              onClick={() => {
                if (!dragRef.current?.moved) onSetView(view);
                dragRef.current = null;
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
