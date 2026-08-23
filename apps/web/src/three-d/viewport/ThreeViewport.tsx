import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  PRIMITIVE_KINDS,
  type PrimitiveKind,
  type ShapeOperation,
  type ThreeDDimensions,
  type ThreeDDocument,
  type ThreeDTransform,
} from '@asa-lab/three-d';
import { SceneRuntime, type CameraViewState, type StandardCameraView } from './SceneRuntime';
import type { DirectManipulationCommit } from './DirectManipulator';

export interface ThreeViewportHandle {
  readonly setView: (view: StandardCameraView) => void;
  readonly orbitBy: (deltaX: number, deltaY: number) => void;
  readonly zoom: (direction: 1 | -1) => void;
  readonly fit: () => void;
  /**
   * A canvas holding a frame of the whole scene, for the project card. The
   * frame is drawn during this call and the drawing buffer is not preserved,
   * so the caller must read the canvas before yielding to the browser.
   */
  readonly captureFrame: () => HTMLCanvasElement | null;
}

interface ThreeViewportProps {
  readonly document: ThreeDDocument;
  readonly selectedIds: readonly string[];
  readonly workplaneY: number;
  readonly onSelect: (nodeId: string | null, additive?: boolean) => void;
  readonly onTransformCommit: (
    nodeId: string,
    transform: ThreeDTransform,
    dimensions?: ThreeDDimensions,
  ) => void;
  readonly onTransformCommitMany: (commits: readonly DirectManipulationCommit[]) => void;
  readonly onDropPrimitive: (
    primitive: PrimitiveKind,
    position: { x: number; y?: number; z: number },
    additive?: boolean,
    operation?: ShapeOperation,
  ) => void;
  readonly activePlacement: {
    readonly primitive: PrimitiveKind;
    readonly operation: ShapeOperation;
  } | null;
  readonly onCameraChange?: (state: CameraViewState) => void;
}

const PRIMITIVES = new Set<PrimitiveKind>(PRIMITIVE_KINDS);

export const ThreeViewport = forwardRef<ThreeViewportHandle, ThreeViewportProps>(
  function ThreeViewport(props, ref): JSX.Element {
    const containerRef = useRef<HTMLDivElement>(null);
    const runtimeRef = useRef<SceneRuntime | null>(null);
    const [webGlError, setWebGlError] = useState<string | null>(null);
    const [runtimeGeneration, setRuntimeGeneration] = useState(0);
    const [runtimeReady, setRuntimeReady] = useState(false);
    const propsRef = useRef(props);
    propsRef.current = props;

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      let retryTimer = 0;
      const startRuntime = (): void => {
        setRuntimeReady(false);
        setWebGlError(null);
        runtimeRef.current?.dispose();
        runtimeRef.current = null;
        try {
          runtimeRef.current = new SceneRuntime(container, {
            onSelect: (nodeId, additive) => propsRef.current.onSelect(nodeId, additive),
            onTransformCommit: (nodeId, transform, dimensions) =>
              propsRef.current.onTransformCommit(nodeId, transform, dimensions),
            onTransformCommitMany: (commits) => propsRef.current.onTransformCommitMany(commits),
            onWebGlError: setWebGlError,
            onCameraChange: (state) => propsRef.current.onCameraChange?.(state),
          });
          runtimeRef.current.setDocument(propsRef.current.document, propsRef.current.selectedIds);
          runtimeRef.current.setWorkplaneY(propsRef.current.workplaneY);
          setRuntimeReady(true);
        } catch (error) {
          runtimeRef.current?.dispose();
          runtimeRef.current = null;
          setWebGlError(
            error instanceof Error
              ? error.message
              : 'Не удалось запустить 3D-сцену. Попробуйте ещё раз.',
          );
          if (runtimeGeneration < 2) {
            retryTimer = window.setTimeout(() => setRuntimeGeneration((value) => value + 1), 700);
          }
        }
      };
      const startTimer = window.setTimeout(startRuntime, 0);
      return () => {
        window.clearTimeout(startTimer);
        window.clearTimeout(retryTimer);
        runtimeRef.current?.dispose();
        runtimeRef.current = null;
      };
    }, [runtimeGeneration]);

    useEffect(() => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      try {
        runtime.setDocument(props.document, props.selectedIds);
      } catch (error) {
        runtime.dispose();
        runtimeRef.current = null;
        setRuntimeReady(false);
        setWebGlError(
          error instanceof Error
            ? error.message
            : 'Не удалось обновить 3D-сцену. Запустите рабочую плоскость снова.',
        );
      }
    }, [props.document, props.selectedIds]);

    useEffect(() => {
      runtimeRef.current?.setWorkplaneY(props.workplaneY);
    }, [props.workplaneY]);

    useEffect(() => {
      if (!props.activePlacement) runtimeRef.current?.clearPlacementPreview();
    }, [props.activePlacement]);

    useImperativeHandle(
      ref,
      () => ({
        setView: (view) => runtimeRef.current?.setView(view),
        orbitBy: (deltaX, deltaY) => runtimeRef.current?.orbitBy(deltaX, deltaY),
        zoom: (direction) => runtimeRef.current?.zoom(direction),
        fit: () => runtimeRef.current?.fitToScene(),
        captureFrame: () => runtimeRef.current?.captureFrame() ?? null,
      }),
      [],
    );

    const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const primitive = event.dataTransfer.getData('application/x-asa-3d-primitive');
      if (!PRIMITIVES.has(primitive as PrimitiveKind)) return;
      const operationValue = event.dataTransfer.getData('application/x-asa-3d-operation');
      const operation: ShapeOperation =
        operationValue === 'hole' || props.activePlacement?.operation === 'hole' ? 'hole' : 'solid';
      const point = runtimeRef.current?.workplanePoint(event.clientX, event.clientY);
      runtimeRef.current?.clearPlacementPreview();
      if (point)
        props.onDropPrimitive(primitive as PrimitiveKind, point, event.shiftKey, operation);
    };

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const placement = props.activePlacement;
      if (placement)
        runtimeRef.current?.setPlacementPreview(
          placement.primitive,
          placement.operation,
          event.clientX,
          event.clientY,
        );
    };

    const handleDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
      const related = event.relatedTarget;
      if (related instanceof Node && event.currentTarget.contains(related)) return;
      runtimeRef.current?.clearPlacementPreview();
    };

    return (
      <div
        ref={containerRef}
        className="asa3d-viewport"
        data-testid="asa3d-viewport"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-runtime-ready={runtimeReady ? 'true' : 'false'}
        data-selected-node-id={props.selectedIds.at(-1) ?? ''}
        data-selected-node-ids={props.selectedIds.join(',')}
      >
        {!runtimeReady && !webGlError && (
          <div className="asa3d-viewport-starting" role="status">
            <span className="asa3d-loader" />
            <span>Запускаем рабочую плоскость…</span>
          </div>
        )}
        {webGlError && (
          <div className="asa3d-webgl-error" role="alert">
            <strong>3D-ускорение не запустилось</strong>
            <span>{webGlError}</span>
            <button type="button" onClick={() => setRuntimeGeneration((value) => value + 1)}>
              Запустить снова
            </button>
          </div>
        )}
      </div>
    );
  },
);
