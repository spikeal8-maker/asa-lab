import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { CameraDirection, CameraViewState, StandardCameraView } from './SceneRuntime';

interface ViewCubeProps {
  readonly orientation: CameraViewState;
  readonly onOrbit: (deltaX: number, deltaY: number) => void;
  readonly onSetView: (view: StandardCameraView) => void;
  readonly onSetDirection: (direction: CameraDirection) => void;
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

interface SnapZone extends CameraDirection {
  readonly id: string;
  readonly kind: 'edge' | 'corner';
  readonly label: string;
}

const SNAP_ZONES: readonly SnapZone[] = [
  ...[-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) =>
      [-1, 1].map((z) => ({
        id: `corner-${x}-${y}-${z}`,
        kind: 'corner' as const,
        label: `угол ${x < 0 ? 'слева' : 'справа'}, ${y < 0 ? 'снизу' : 'сверху'}, ${z < 0 ? 'сзади' : 'спереди'}`,
        x,
        y,
        z,
      })),
    ),
  ),
  ...([-1, 1] as const).flatMap((a) =>
    ([-1, 1] as const).flatMap((b) => [
      {
        id: `edge-x-${a}-${b}`,
        kind: 'edge' as const,
        label: `ребро ${a < 0 ? 'слева' : 'справа'}, ${b < 0 ? 'снизу' : 'сверху'}`,
        x: a,
        y: b,
        z: 0,
      },
      {
        id: `edge-y-${a}-${b}`,
        kind: 'edge' as const,
        label: `ребро ${a < 0 ? 'снизу' : 'сверху'}, ${b < 0 ? 'сзади' : 'спереди'}`,
        x: 0,
        y: a,
        z: b,
      },
      {
        id: `edge-z-${a}-${b}`,
        kind: 'edge' as const,
        label: `ребро ${a < 0 ? 'слева' : 'справа'}, ${b < 0 ? 'сзади' : 'спереди'}`,
        x: a,
        y: 0,
        z: b,
      },
    ]),
  ),
];

const FACE_NORMALS: Readonly<Record<StandardCameraView, CameraDirection | null>> = {
  home: null,
  front: { x: 0, y: 0, z: 1 },
  back: { x: 0, y: 0, z: -1 },
  right: { x: 1, y: 0, z: 0 },
  left: { x: -1, y: 0, z: 0 },
  top: { x: 0, y: 1, z: 0 },
  bottom: { x: 0, y: -1, z: 0 },
};

export function ViewCube({
  orientation,
  onOrbit,
  onSetView,
  onSetDirection,
}: ViewCubeProps): JSX.Element {
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const style = {
    '--asa3d-cube-pitch': `${-orientation.pitch}deg`,
    '--asa3d-cube-yaw': `${-orientation.yaw}deg`,
  } as CSSProperties;
  const yaw = (orientation.yaw * Math.PI) / 180;
  const pitch = (orientation.pitch * Math.PI) / 180;
  const cameraDirection = {
    x: Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: Math.cos(yaw) * Math.cos(pitch),
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    setDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    // Keep a real click stable on small faces/edges even when a mouse or a
    // finger jitters by a few pixels between pointerdown and pointerup.
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 4) return;
    if (!drag.moved) event.currentTarget.setPointerCapture(event.pointerId);
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.moved = true;
    event.preventDefault();
    onOrbit(deltaX, deltaY);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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
              data-active={(() => {
                const normal = FACE_NORMALS[view];
                return normal &&
                  normal.x * cameraDirection.x +
                    normal.y * cameraDirection.y +
                    normal.z * cameraDirection.z >
                    0.62
                  ? 'true'
                  : 'false';
              })()}
              aria-label={`Вид: ${label.toLocaleLowerCase('ru-RU')}`}
              onClick={() => {
                if (!dragRef.current?.moved) onSetView(view);
                dragRef.current = null;
              }}
            >
              {label}
            </button>
          ))}
          {SNAP_ZONES.map((zone) => (
            <button
              key={zone.id}
              type="button"
              className={`asa3d-view-cube-zone ${zone.kind}`}
              style={
                {
                  '--asa3d-zone-x': `${zone.x * 28}px`,
                  '--asa3d-zone-y': `${-zone.y * 28}px`,
                  '--asa3d-zone-z': `${zone.z * 28}px`,
                } as CSSProperties
              }
              aria-label={`Вид: ${zone.label}`}
              title={`Вид: ${zone.label}`}
              onClick={() => {
                if (!dragRef.current?.moved) onSetDirection({ x: zone.x, y: zone.y, z: zone.z });
                dragRef.current = null;
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
