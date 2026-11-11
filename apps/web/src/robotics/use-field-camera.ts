import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react';
import {
  FieldCameraGesture,
  fitFieldCamera,
  fieldScreenToWorld,
  zoomFieldCameraAt,
  type FieldBounds,
  type FieldCamera,
  type FieldScreenPoint,
  type FieldViewport,
} from './field-camera';

function isTextEditor(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .cm-editor, .monaco-editor, .blocklyWidgetDiv',
      ),
    )
  );
}

export function useFieldCamera(
  canvasRef: RefObject<HTMLDivElement | null>,
  bounds: FieldBounds,
  options: {
    onStart: (keepPointerCapture: boolean) => void;
    onCancel: () => void;
    isEditing: () => boolean;
  },
) {
  const [view, setView] = useState<{ camera: FieldCamera | null; viewport: FieldViewport }>({
    camera: null,
    viewport: { width: 1, height: 1 },
  });
  const [spacePressed, setSpacePressed] = useState(false);
  const [gesturing, setGesturing] = useState(false);
  const viewRef = useRef(view);
  const optionsRef = useRef(options);
  const boundsRef = useRef(bounds);
  const spaceRef = useRef(false);
  const insideRef = useRef(false);
  const gesture = useRef(new FieldCameraGesture());
  optionsRef.current = options;
  boundsRef.current = bounds;

  const update = useCallback((camera: FieldCamera) => {
    const current = viewRef.current;
    if (
      current.camera?.xMeters === camera.xMeters &&
      current.camera.yMeters === camera.yMeters &&
      current.camera.pixelsPerMeter === camera.pixelsPerMeter
    )
      return;
    const next = { ...current, camera };
    viewRef.current = next;
    setView(next);
  }, []);

  const cancel = useCallback(() => {
    const ids = gesture.current.cancel();
    const svg = canvasRef.current?.querySelector<SVGSVGElement>('svg.robotics-field');
    for (const pointerId of ids) {
      if (svg?.hasPointerCapture?.(pointerId)) svg.releasePointerCapture(pointerId);
    }
    setGesturing(false);
    spaceRef.current = false;
    setSpacePressed(false);
  }, [canvasRef]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      // Hidden workspace tabs retain both camera and their last useful viewport.
      if (rect.width <= 0 || rect.height <= 0) return;
      const current = viewRef.current;
      const viewport = { width: rect.width, height: rect.height };
      if (
        current.camera &&
        Math.abs(viewport.width - current.viewport.width) < 0.01 &&
        Math.abs(viewport.height - current.viewport.height) < 0.01
      )
        return;
      const next = {
        viewport,
        camera: current.camera ?? fitFieldCamera(boundsRef.current, viewport),
      };
      viewRef.current = next;
      setView(next);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(canvas);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [canvasRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      if (!viewRef.current.camera) return;
      event.preventDefault();
      // A wheel event cannot change the reference frame halfway through an
      // object/handle drag. Camera gestures themselves remain continuous.
      if (optionsRef.current.isEditing()) return;
      const rect = canvas.getBoundingClientRect();
      const current = viewRef.current;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const delta = Math.max(-600, Math.min(600, event.deltaY * unit));
      update(
        zoomFieldCameraAt(
          current.camera!,
          current.viewport,
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          Math.exp(-delta * 0.002),
        ),
      );
    };
    const blur = () => {
      cancel();
      insideRef.current = false;
      optionsRef.current.onCancel();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (isTextEditor(event.target)) return;
      const fieldActive = insideRef.current || canvas.contains(document.activeElement);
      if (event.code === 'Space' && fieldActive) {
        event.preventDefault();
        spaceRef.current = true;
        setSpacePressed(true);
      }
      if (event.key === 'Escape' && (fieldActive || gesture.current.active)) {
        event.preventDefault();
        cancel();
        optionsRef.current.onCancel();
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      spaceRef.current = false;
      setSpacePressed(false);
    };
    const focus = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !canvas.contains(event.target) &&
        (gesture.current.active || optionsRef.current.isEditing())
      ) {
        cancel();
        optionsRef.current.onCancel();
      }
      if (isTextEditor(event.target)) {
        spaceRef.current = false;
        setSpacePressed(false);
      }
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('focusin', focus);
    return () => {
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('focusin', focus);
      const ids = gesture.current.cancel();
      const svg = canvas.querySelector<SVGSVGElement>('svg.robotics-field');
      for (const id of ids) if (svg?.hasPointerCapture?.(id)) svg.releasePointerCapture(id);
    };
  }, [canvasRef, cancel, update]);

  function screenPoint(clientX: number, clientY: number): FieldScreenPoint | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0
      ? { x: clientX - rect.left, y: clientY - rect.top }
      : null;
  }

  function point(clientX: number, clientY: number) {
    const local = screenPoint(clientX, clientY);
    const current = viewRef.current;
    return local && current.camera
      ? fieldScreenToWorld(current.camera, current.viewport, local)
      : null;
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>, requestedPan: boolean) {
    const local = screenPoint(event.clientX, event.clientY);
    if (!local || !viewRef.current.camera) return false;
    const wasActive = gesture.current.active;
    const handled = gesture.current.pointerDown(
      event.pointerId,
      event.pointerType,
      local,
      requestedPan || event.button === 1 || (event.button === 0 && spaceRef.current),
    );
    if (handled || event.pointerType === 'touch') {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    if (handled) {
      if (!wasActive) optionsRef.current.onStart(true);
      setGesturing(true);
    }
    return handled;
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const local = screenPoint(event.clientX, event.clientY);
    const current = viewRef.current;
    if (!local || !current.camera) return false;
    const result = gesture.current.pointerMove(
      event.pointerId,
      local,
      current.camera,
      current.viewport,
    );
    if (result.handled) {
      event.preventDefault();
      update(result.camera);
    }
    return result.handled;
  }

  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    const handled = gesture.current.pointerUp(event.pointerId);
    if (handled) {
      event.preventDefault();
      setGesturing(gesture.current.active);
    }
    return handled;
  }

  function lostPointerCapture(event: PointerEvent<SVGSVGElement>) {
    if (!gesture.current.has(event.pointerId)) return;
    cancel();
    optionsRef.current.onCancel();
  }

  function fit(nextBounds = boundsRef.current) {
    optionsRef.current.onStart(false);
    cancel();
    update(fitFieldCamera(nextBounds, viewRef.current.viewport));
  }

  function zoom(factor: number) {
    const current = viewRef.current;
    if (!current.camera || optionsRef.current.isEditing()) return;
    update(
      zoomFieldCameraAt(
        current.camera,
        current.viewport,
        {
          x: current.viewport.width / 2,
          y: current.viewport.height / 2,
        },
        factor,
      ),
    );
  }

  return {
    ...view,
    spacePressed,
    gesturing,
    point,
    pointerDown,
    pointerMove,
    pointerUp,
    lostPointerCapture,
    cancel,
    fit,
    zoom,
    enter: () => {
      insideRef.current = true;
    },
    leave: () => {
      insideRef.current = false;
    },
  };
}
