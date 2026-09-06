interface Point {
  readonly x: number;
  readonly y: number;
}

interface TouchNavigationCallbacks {
  readonly targetsModel: (x: number, y: number) => boolean;
  readonly cancelModelGesture: () => void;
  readonly clearSelection: () => void;
  readonly orbit: (dx: number, dy: number) => void;
  readonly panZoom: (dx: number, dy: number, scale: number) => void;
}

/** Routes touches before the canvas manipulator and OrbitControls see them.
 * A second finger cancels the uncommitted model preview, never commits it.
 * Remaining fingers must lift before a new model gesture can start.
 */
export class TouchNavigation {
  private readonly points = new Map<number, Point>();
  private mode: 'model' | 'orbit' | 'multi' | 'settling' | null = null;
  private origin: Point | null = null;
  private moved = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: TouchNavigationCallbacks,
  ) {
    container.addEventListener('pointerdown', this.down, { capture: true, passive: false });
    container.addEventListener('pointermove', this.move, { capture: true, passive: false });
    container.addEventListener('pointerup', this.up, { capture: true });
    container.addEventListener('pointercancel', this.up, { capture: true });
    container.ownerDocument.defaultView?.addEventListener('blur', this.cancel);
  }

  isActive(): boolean {
    return this.points.size > 0;
  }

  private consume(event: PointerEvent): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  private readonly down = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || event.target !== this.canvas) return;
    const point = { x: event.clientX, y: event.clientY };
    this.points.set(event.pointerId, point);
    if (this.points.size === 1) {
      this.origin = point;
      this.moved = false;
      this.mode = this.callbacks.targetsModel(point.x, point.y) ? 'model' : 'orbit';
      if (this.mode === 'model') return;
    } else {
      if (this.mode === 'model') this.callbacks.cancelModelGesture();
      this.mode = 'multi';
    }
    for (const id of this.points.keys()) this.canvas.setPointerCapture(id);
    this.consume(event);
  };

  private readonly move = (event: PointerEvent): void => {
    const previous = this.points.get(event.pointerId);
    if (!previous) return;
    const before = [...this.points.values()];
    const point = { x: event.clientX, y: event.clientY };
    this.points.set(event.pointerId, point);
    if (this.mode === 'model') return;
    this.consume(event);
    if (this.mode === 'orbit' && this.origin) {
      this.moved ||= Math.hypot(point.x - this.origin.x, point.y - this.origin.y) > 4;
      if (this.moved) this.callbacks.orbit(point.x - previous.x, point.y - previous.y);
    } else if (this.mode === 'multi') {
      const [a, b] = before;
      const [c, d] = this.points.values();
      if (!a || !b || !c || !d) return;
      const oldDistance = Math.hypot(a.x - b.x, a.y - b.y);
      const newDistance = Math.hypot(c.x - d.x, c.y - d.y);
      this.callbacks.panZoom(
        (c.x + d.x - a.x - b.x) / 2,
        (c.y + d.y - a.y - b.y) / 2,
        oldDistance > 4 && newDistance > 4 ? oldDistance / newDistance : 1,
      );
    }
  };

  private readonly up = (event: PointerEvent): void => {
    if (!this.points.has(event.pointerId)) return;
    const cancelled = event.type === 'pointercancel';
    if (this.mode !== 'model' || cancelled) this.consume(event);
    if (cancelled && this.mode === 'model') this.callbacks.cancelModelGesture();
    if (this.mode === 'orbit' && !this.moved && !cancelled) this.callbacks.clearSelection();
    this.points.delete(event.pointerId);
    // The model manipulator owns its capture until it has committed pointerup.
    if (this.mode !== 'model' && this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    if (this.points.size === 0) this.mode = null;
    else if (this.points.size === 1) this.mode = 'settling';
  };

  private readonly cancel = (): void => {
    if (this.mode === 'model') this.callbacks.cancelModelGesture();
    for (const id of this.points.keys()) {
      if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    }
    this.points.clear();
    this.mode = null;
  };

  dispose(): void {
    this.cancel();
    this.container.removeEventListener('pointerdown', this.down, { capture: true });
    this.container.removeEventListener('pointermove', this.move, { capture: true });
    this.container.removeEventListener('pointerup', this.up, { capture: true });
    this.container.removeEventListener('pointercancel', this.up, { capture: true });
    this.container.ownerDocument.defaultView?.removeEventListener('blur', this.cancel);
  }
}
