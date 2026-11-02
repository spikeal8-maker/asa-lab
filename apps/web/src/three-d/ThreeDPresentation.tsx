import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { ThreeDDocument } from '@asa-lab/three-d';
import { SceneRuntime } from './viewport/SceneRuntime';
import { geometryResultIsCurrent } from './geometry/result-state';
import './three-d-presentation.css';

export interface ThreeDPresentationHandle {
  readonly dispose: () => void;
  readonly rotate: (x: number, y: number) => void;
  readonly zoom: (direction: 1 | -1) => void;
  readonly fit: () => void;
  readonly pointer: (x: number, y: number) => void;
}
/** Shared geometry renderer only. There is no project ID, save hook or editing command. */
export const ThreeDPresentation = forwardRef<
  ThreeDPresentationHandle,
  {
    readonly document: ThreeDDocument;
    readonly onReady: () => void;
    readonly onError: () => void;
    readonly passive?: boolean;
  }
>(({ document, onReady, onError, passive = false }, ref) => {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<SceneRuntime | null>(null);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  useImperativeHandle(
    ref,
    () => ({
      dispose: () => {
        runtime.current?.dispose();
        runtime.current = null;
      },
      rotate: (x, y) => runtime.current?.orbitBy(x, y),
      zoom: (direction) => runtime.current?.zoom(direction),
      fit: () => {
        runtime.current?.setView('home');
        runtime.current?.fitToScene();
      },
      pointer: (x, y) => {
        const yaw = (x * Math.PI) / 5,
          pitch = Math.PI / 4 - (y * Math.PI) / 12;
        runtime.current?.setCameraDirection({
          x: Math.sin(yaw) * Math.cos(pitch),
          y: Math.sin(pitch),
          z: Math.cos(yaw) * Math.cos(pitch),
        });
        runtime.current?.fitToScene();
      },
    }),
    [],
  );
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    try {
      const scene = new SceneRuntime(
        element,
        {
          onSelect: () => {},
          onTransformCommit: () => {},
          onTransformCommitMany: () => {},
          onWebGlError: () => callbacks.current.onError(),
          onGeometryStateChange: (state) => {
            if (!disposed && state.groups.some((group) => group.status === 'error'))
              callbacks.current.onError();
            if (!disposed && geometryResultIsCurrent(state, document)) {
              runtime.current?.fitToScene();
              callbacks.current.onReady();
            }
          },
        },
        true,
      );
      runtime.current = scene;
      if (passive) {
        const canvas = element.querySelector('canvas');
        if (canvas) {
          canvas.tabIndex = -1;
          canvas.setAttribute('aria-hidden', 'true');
        }
      }
      scene.setDocument(document, []);
      scene.setView('home');
      scene.fitToScene();
    } catch {
      callbacks.current.onError();
    }
    return () => {
      disposed = true;
      runtime.current?.dispose();
      runtime.current = null;
    };
  }, [document, passive]);
  return <div ref={host} className="three-d-presentation" data-testid="three-d-presentation" />;
});
