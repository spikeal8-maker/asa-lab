import { describe, expect, it, vi } from 'vitest';
import { TouchNavigation } from '../viewport/TouchNavigation';

function setup(model = false) {
  const view = new EventTarget();
  const container = Object.assign(new EventTarget(), {
    ownerDocument: { defaultView: view },
  });
  const captured = new Set<number>();
  const canvas = {
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  };
  const callbacks = {
    targetsModel: vi.fn(() => model),
    cancelModelGesture: vi.fn(),
    clearSelection: vi.fn(),
    orbit: vi.fn(),
    panZoom: vi.fn(),
  };
  const navigation = new TouchNavigation(
    container as unknown as HTMLElement,
    canvas as unknown as HTMLCanvasElement,
    callbacks,
  );
  const send = (
    type: string,
    id = 1,
    x = 0,
    y = 0,
    target: unknown = canvas,
    pointerType = 'touch',
  ) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      pointerId: id,
      clientX: x,
      clientY: y,
      pointerType,
    });
    Object.defineProperty(event, 'target', { value: target });
    container.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { send, navigation, callbacks, captured, view };
}

describe('phone gesture ownership', () => {
  it('passes a single model touch through without moving the camera', () => {
    const { send, callbacks, navigation } = setup(true);
    expect(send('pointerdown')).toBe(false);
    expect(send('pointermove', 1, 20, 10)).toBe(false);
    expect(send('pointerup', 1, 20, 10)).toBe(false);
    expect(callbacks.orbit).not.toHaveBeenCalled();
    expect(callbacks.cancelModelGesture).not.toHaveBeenCalled();
    expect(navigation.isActive()).toBe(false);
  });

  it('orbits on empty canvas, with a dead zone and without clearing the selection', () => {
    const { send, callbacks, captured } = setup();
    expect(send('pointerdown')).toBe(true);
    expect(captured.has(1)).toBe(true);
    send('pointermove', 1, 2, 0);
    expect(callbacks.orbit).not.toHaveBeenCalled();
    send('pointermove', 1, 22, 10);
    expect(callbacks.orbit).toHaveBeenCalledWith(20, 10);
    expect(send('pointerup')).toBe(true);
    expect(callbacks.clearSelection).not.toHaveBeenCalled();
    expect(captured.size).toBe(0);
  });

  it('clears selection on an empty tap, not a cancelled touch', () => {
    const { send, callbacks } = setup();
    send('pointerdown');
    send('pointercancel');
    expect(callbacks.clearSelection).not.toHaveBeenCalled();
    send('pointerdown');
    send('pointerup');
    expect(callbacks.clearSelection).toHaveBeenCalledOnce();
  });

  it('cancels a model preview when the second finger arrives, then pans and pinches', () => {
    const { send, callbacks, navigation } = setup(true);
    send('pointerdown', 1, 100, 100);
    expect(send('pointerdown', 2, 200, 100)).toBe(true);
    expect(callbacks.cancelModelGesture).toHaveBeenCalledOnce();
    expect(send('pointermove', 2, 220, 120)).toBe(true);
    expect(callbacks.panZoom).toHaveBeenCalledWith(10, 10, 100 / Math.hypot(120, 20));
    expect(send('pointerup', 2)).toBe(true);
    expect(send('pointermove', 1, 120, 110)).toBe(true);
    expect(callbacks.orbit).not.toHaveBeenCalled();
    expect(send('pointerup', 1)).toBe(true);
    expect(navigation.isActive()).toBe(false);
    expect(send('pointerdown', 3)).toBe(false);
  });

  it('does not jump when a third finger replaces one of the first two', () => {
    const { send, callbacks } = setup();
    send('pointerdown', 1, 0, 0);
    send('pointerdown', 2, 100, 0);
    send('pointerdown', 3, 200, 0);
    send('pointerup', 1);
    send('pointermove', 3, 210, 0);
    expect(callbacks.panZoom).toHaveBeenCalledWith(5, 0, 100 / 110);
  });

  it('keeps the pinch ratio finite when fingers touch', () => {
    const { send, callbacks } = setup();
    send('pointerdown', 1);
    send('pointerdown', 2);
    send('pointermove', 2, 0, 1);
    expect(callbacks.panZoom).toHaveBeenCalledWith(0, 0.5, 1);
  });

  it('cancels model gestures on pointer cancellation and loss of window focus', () => {
    const { send, callbacks, navigation, view } = setup(true);
    send('pointerdown');
    expect(send('pointercancel')).toBe(true);
    send('pointerdown');
    view.dispatchEvent(new Event('blur'));
    expect(callbacks.cancelModelGesture).toHaveBeenCalledTimes(2);
    expect(navigation.isActive()).toBe(false);
  });

  it('ignores mouse and inspector events and removes listeners when disposed', () => {
    const { send, callbacks, navigation } = setup();
    expect(send('pointerdown', 1, 0, 0, {})).toBe(false);
    expect(send('pointerdown', 1, 0, 0, undefined, 'mouse')).toBe(false);
    expect(callbacks.targetsModel).not.toHaveBeenCalled();
    navigation.dispose();
    expect(send('pointerdown')).toBe(false);
  });
});
