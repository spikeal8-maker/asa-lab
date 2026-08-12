import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type {
  PrimitiveKind,
  ThreeDDimensions,
  ThreeDDocument,
  ThreeDTransform,
} from '@asa-lab/three-d';
import { SceneRuntime } from './SceneRuntime';

export interface ThreeViewportHandle {
  readonly setView: (view: 'home' | 'top' | 'front' | 'right') => void;
  readonly zoom: (direction: 1 | -1) => void;
  readonly fit: () => void;
}

interface ThreeViewportProps {
  readonly document: ThreeDDocument;
  readonly selectedId: string | null;
  readonly onSelect: (nodeId: string | null) => void;
  readonly onTransformCommit: (
    nodeId: string,
    transform: ThreeDTransform,
    dimensions?: ThreeDDimensions,
  ) => void;
  readonly onDropPrimitive: (primitive: PrimitiveKind, position: { x: number; z: number }) => void;
}

const PRIMITIVES = new Set<PrimitiveKind>([
  'box',
  'cylinder',
  'sphere',
  'cone',
  'torus',
  'wedge',
  'roof',
]);

export const ThreeViewport = forwardRef<ThreeViewportHandle, ThreeViewportProps>(
  function ThreeViewport(props, ref): JSX.Element {
    const containerRef = useRef<HTMLDivElement>(null);
    const runtimeRef = useRef<SceneRuntime | null>(null);
    const [webGlError, setWebGlError] = useState<string | null>(null);
    const propsRef = useRef(props);
    propsRef.current = props;

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      try {
        runtimeRef.current = new SceneRuntime(container, {
          onSelect: (nodeId) => propsRef.current.onSelect(nodeId),
          onTransformCommit: (nodeId, transform, dimensions) =>
            propsRef.current.onTransformCommit(nodeId, transform, dimensions),
          onWebGlError: setWebGlError,
        });
      } catch {
        runtimeRef.current = null;
      }
      return () => {
        runtimeRef.current?.dispose();
        runtimeRef.current = null;
      };
    }, []);

    useEffect(() => {
      runtimeRef.current?.setDocument(props.document, props.selectedId);
    }, [props.document, props.selectedId]);

    useImperativeHandle(
      ref,
      () => ({
        setView: (view) => runtimeRef.current?.setView(view),
        zoom: (direction) => runtimeRef.current?.zoom(direction),
        fit: () => runtimeRef.current?.fitToScene(),
      }),
      [],
    );

    const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const primitive = event.dataTransfer.getData('application/x-asa-3d-primitive');
      if (!PRIMITIVES.has(primitive as PrimitiveKind)) return;
      const point = runtimeRef.current?.workplanePoint(event.clientX, event.clientY);
      if (point) props.onDropPrimitive(primitive as PrimitiveKind, point);
    };

    return (
      <div
        ref={containerRef}
        className="asa3d-viewport"
        data-testid="asa3d-viewport"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        {webGlError && (
          <div className="asa3d-webgl-error" role="alert">
            <strong>3D-ускорение не запустилось</strong>
            <span>{webGlError}</span>
          </div>
        )}
      </div>
    );
  },
);
