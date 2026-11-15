/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRoboticsBall,
  createRoboticsWorldV3Document,
  type RoboticsWorldDocument,
} from '@asa-lab/robotics/world-document';
import {
  FieldCameraGesture,
  FIELD_CAMERA_MIN_SCALE,
  FIELD_CAMERA_MAX_SCALE,
  fieldCameraViewBox,
  fieldScreenToWorld,
  fieldWorldToScreen,
  fitFieldCamera,
  panFieldCamera,
  zoomFieldCameraAt,
  type FieldCamera,
} from '../field-camera';
import { RobotFieldEditor } from '../RobotFieldEditor';
import { createRoboticsWorldState, measureRoboticsDistance } from '../world';

const viewport = { width: 900, height: 600 };
const initial: FieldCamera = { xMeters: 2.5, yMeters: 2.5, pixelsPerMeter: 100 };

describe('FIELD-CAMERA-001 orthographic transform and gesture ownership', () => {
  it('keeps the world point under a cursor through 20 zooms to substantially less than 1 CSS px', () => {
    const anchor = { x: 147.125, y: 482.75 };
    const point = fieldScreenToWorld(initial, viewport, anchor);
    let camera = panFieldCamera(initial, { x: 83, y: -41 });
    const control = fieldScreenToWorld(camera, viewport, anchor);
    for (let i = 0; i < 20; i += 1) {
      camera = zoomFieldCameraAt(camera, viewport, anchor, i % 3 === 0 ? 0.67 : 1.29);
      const screen = fieldWorldToScreen(camera, viewport, control);
      expect(Math.hypot(screen.x - anchor.x, screen.y - anchor.y)).toBeLessThan(1e-8);
    }
    expect(point.xMeters).toBeCloseTo(-0.52875, 12);
    expect(point.yMeters).toBeCloseTo(0.6725, 12);
  });

  it('matches SVG millimetres/Y direction and round-trips all viewport corners after pan and zoom', () => {
    const camera = zoomFieldCameraAt(
      panFieldCamera(initial, { x: -39, y: 61 }),
      viewport,
      { x: 360, y: 180 },
      2.3,
    );
    const box = fieldCameraViewBox(camera, viewport, 5).split(' ').map(Number);
    for (const screen of [
      { x: 0, y: 0 },
      { x: 900, y: 600 },
      { x: 719.7, y: 117.3 },
    ]) {
      const point = fieldScreenToWorld(camera, viewport, screen);
      const svgScreen = {
        x: ((point.xMeters * 1000 - box[0]!) / box[2]!) * viewport.width,
        y: (((5 - point.yMeters) * 1000 - box[1]!) / box[3]!) * viewport.height,
      };
      expect(svgScreen.x).toBeCloseTo(screen.x, 10);
      expect(svgScreen.y).toBeCloseTo(screen.y, 10);
      expect(fieldWorldToScreen(camera, viewport, point).x).toBeCloseTo(screen.x, 10);
    }
  });

  it('limits scale including extreme wheel factors and rejects invalid input', () => {
    let camera = zoomFieldCameraAt(initial, viewport, { x: 200, y: 90 }, Number.MAX_VALUE);
    expect(camera.pixelsPerMeter).toBe(FIELD_CAMERA_MAX_SCALE);
    camera = zoomFieldCameraAt(camera, viewport, { x: 200, y: 90 }, Number.MIN_VALUE);
    expect(camera.pixelsPerMeter).toBe(FIELD_CAMERA_MIN_SCALE);
    for (const factor of [0, -1, Infinity, NaN]) {
      expect(zoomFieldCameraAt(camera, viewport, { x: 200, y: 90 }, factor)).toBe(camera);
    }
    expect(Object.values(camera).every(Number.isFinite)).toBe(true);
  });

  it('fits bounds without modifying them and translates in the correct world direction', () => {
    const bounds = Object.freeze({ minX: 0, minY: 0, maxX: 5, maxY: 5 });
    const fit = fitFieldCamera(bounds, viewport);
    expect(fit.xMeters).toBe(2.5);
    expect(fit.yMeters).toBe(2.5);
    const pan = panFieldCamera(initial, { x: 50, y: 25 });
    expect(pan).toEqual({ xMeters: 2, yMeters: 2.75, pixelsPerMeter: 100 });
    expect(fieldWorldToScreen(fit, viewport, { xMeters: 0, yMeters: 0 }).y).toBeLessThan(600);
    expect(fieldWorldToScreen(fit, viewport, { xMeters: 5, yMeters: 5 }).x).toBeLessThan(900);
  });

  it('keeps ordinary object pointers outside the camera and consumes explicit temporary pan', () => {
    const gesture = new FieldCameraGesture();
    expect(gesture.pointerDown(1, 'mouse', { x: 30, y: 40 }, false)).toBe(false);
    expect(gesture.pointerMove(1, { x: 90, y: 40 }, initial, viewport).handled).toBe(false);
    expect(gesture.pointerDown(1, 'mouse', { x: 30, y: 40 }, true)).toBe(true);
    expect(gesture.pointerMove(1, { x: 90, y: 40 }, initial, viewport).camera.xMeters).toBe(1.9);
    expect(gesture.pointerUp(1)).toBe(true);
    expect(gesture.active).toBe(false);
  });

  it('combines two-finger centroid translation and pinch, then consumes the remaining finger', () => {
    const gesture = new FieldCameraGesture();
    expect(gesture.pointerDown(1, 'touch', { x: 300, y: 300 }, false)).toBe(false);
    expect(gesture.pointerDown(2, 'touch', { x: 500, y: 300 }, false)).toBe(true);
    const control = fieldScreenToWorld(initial, viewport, { x: 400, y: 300 });
    const changed = gesture.pointerMove(2, { x: 700, y: 300 }, initial, viewport);
    expect(changed.camera.pixelsPerMeter).toBe(200);
    expect(fieldWorldToScreen(changed.camera, viewport, control)).toEqual({ x: 500, y: 300 });
    expect(gesture.pointerUp(1)).toBe(true);
    const one = gesture.pointerMove(2, { x: 710, y: 330 }, changed.camera, viewport);
    expect(one.handled).toBe(true);
    expect(one.camera).toBe(changed.camera);
    expect(gesture.pointerUp(2)).toBe(true);
    expect(gesture.active).toBe(false);
  });

  it('releases every pointer on cancel and ignores moves after cancellation', () => {
    const gesture = new FieldCameraGesture();
    gesture.pointerDown(3, 'touch', { x: 100, y: 100 }, false);
    gesture.pointerDown(4, 'touch', { x: 200, y: 100 }, false);
    expect(gesture.cancel()).toEqual([3, 4]);
    expect(gesture.pointerMove(4, { x: 250, y: 140 }, initial, viewport).handled).toBe(false);
    expect(gesture.pointerUp(4)).toBe(false);
    expect(gesture.active).toBe(false);
  });
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('FIELD-CAMERA-001 actual field editor integration', () => {
  let root: Root;
  let container: HTMLDivElement;
  let dimensions = viewport;
  const source = createRoboticsWorldV3Document('arena');
  const world = {
    ...source,
    field: {
      ...source.field,
      balls: [createRoboticsBall('camera-test', { xMeters: 1, yMeters: 1 })],
    },
  };
  const commit = vi.fn<(value: RoboticsWorldDocument) => boolean>(() => true);
  const originalRect = Element.prototype.getBoundingClientRect;

  beforeEach(async () => {
    dimensions = viewport;
    commit.mockClear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (
        this.classList.contains('robotics-field-canvas') ||
        this.classList.contains('robotics-field')
      ) {
        return {
          x: 10,
          y: 20,
          left: 10,
          top: 20,
          width: dimensions.width,
          height: dimensions.height,
          right: 10 + dimensions.width,
          bottom: 20 + dimensions.height,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalRect.call(this);
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const state = createRoboticsWorldState(world);
    await act(async () => {
      root.render(
        createElement(RobotFieldEditor, {
          world,
          state,
          distance: measureRoboticsDistance(world, state.pose, state.balls, state.bodies),
          running: false,
          showGrid: true,
          onShowGridChange: vi.fn(),
          onCommit: commit,
          sourceSchemaVersion: 3,
          onUpgradeField: () => false,
          canUndo: false,
          canRedo: false,
          onUndo: vi.fn(),
          onRedo: vi.fn(),
        }),
      );
    });
    const svg = field();
    svg.setPointerCapture = vi.fn();
    svg.hasPointerCapture = () => false;
    svg.releasePointerCapture = vi.fn();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const field = () => container.querySelector<SVGSVGElement>('svg.robotics-field')!;
  const canvas = () => container.querySelector<HTMLDivElement>('.robotics-field-canvas')!;
  const box = () => field().getAttribute('viewBox')!;
  const button = (name: string) =>
    container.querySelector<HTMLButtonElement>('button[aria-label="' + name + '"]')!;
  const atWorld = (x: number, y: number) => {
    const [left, top, width, height] = box().split(' ').map(Number);
    return {
      x: 10 + ((x * 1000 - left!) / width!) * 900,
      y: 20 + (((5 - y) * 1000 - top!) / height!) * 600,
    };
  };
  async function pointer(
    target: Element,
    type: string,
    x: number,
    y: number,
    options: { id?: number; type?: string; button?: number; primary?: boolean } = {},
  ) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      clientX: x,
      clientY: y,
      pointerId: options.id ?? 1,
      pointerType: options.type ?? 'mouse',
      button: options.button ?? 0,
      buttons: type === 'pointerup' ? 0 : 1,
      isPrimary: options.primary ?? true,
    });
    await act(async () => {
      target.dispatchEvent(event);
    });
  }
  async function wheel(x = 370, y = 280, deltaY = -120) {
    await act(async () => {
      canvas().dispatchEvent(
        new WheelEvent('wheel', {
          clientX: x,
          clientY: y,
          deltaY,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  }

  const zoomLabel = () => container.querySelector('output[aria-label="Масштаб поля"]')!.textContent;
  const cameraMetrics = () => {
    const [left, top, width, height] = box().split(' ').map(Number);
    return {
      centerX: left! + width! / 2,
      centerY: top! + height! / 2,
      pixelsPerMeter: (dimensions.width * 1000) / width!,
    };
  };

  it('restores legacy zoom levels for buttons and keyboard without committing the project', async () => {
    const original = cameraMetrics();
    expect(zoomLabel()).toBe('100%');
    for (const label of ['125%', '150%', '200%', '300%']) {
      await act(async () => button('Приблизить поле').click());
      expect(zoomLabel()).toBe(label);
      expect(cameraMetrics().centerX).toBeCloseTo(original.centerX, 8);
      expect(cameraMetrics().centerY).toBeCloseTo(original.centerY, 8);
    }
    for (const label of ['200%', '150%', '125%', '100%']) {
      await act(async () => button('Отдалить поле').click());
      expect(zoomLabel()).toBe(label);
    }
    for (const [key, label] of [
      ['+', '125%'],
      ['=', '150%'],
      ['-', '125%'],
    ] as const) {
      await act(async () => {
        canvas().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
      expect(zoomLabel()).toBe(label);
    }
    expect(commit).not.toHaveBeenCalled();
  });

  it('keeps button direction after continuous wheel zoom below and above legacy levels', async () => {
    for (const delta of [600, -600]) {
      await act(async () => button('Показать поле целиком').click());
      await wheel(370, 280, delta);
      await wheel(370, 280, delta);
      const before = cameraMetrics().pixelsPerMeter;
      await act(async () => button('Приблизить поле').click());
      const nearer = cameraMetrics().pixelsPerMeter;
      expect(nearer).toBeGreaterThan(before);
      await act(async () => button('Отдалить поле').click());
      expect(cameraMetrics().pixelsPerMeter).toBeLessThan(nearer);
      expect(Number.isFinite(cameraMetrics().pixelsPerMeter)).toBe(true);
    }
    expect(commit).not.toHaveBeenCalled();
  });

  it('keeps fit at 100% through the responsive resize and zoom sequence', async () => {
    await act(async () => button('Показать поле целиком').click());
    for (const width of [390, 320, 700, 900]) {
      dimensions = { width, height: 600 };
      await act(async () => window.dispatchEvent(new Event('resize')));
      expect(zoomLabel()).toBe('100%');
      await act(async () => button('Приблизить поле').click());
      expect(zoomLabel()).toBe('125%');
      await act(async () => button('Показать поле целиком').click());
      expect(zoomLabel()).toBe('100%');
    }
    expect(commit).not.toHaveBeenCalled();
  });

  it('preserves a manually panned and zoomed camera through resize instead of fitting it', async () => {
    await pointer(field(), 'pointerdown', 270, 220);
    await pointer(field(), 'pointermove', 350, 240);
    await pointer(field(), 'pointerup', 350, 240);
    await wheel();
    const manual = cameraMetrics();
    dimensions = { width: 390, height: 700 };
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(cameraMetrics().centerX).toBeCloseTo(manual.centerX, 8);
    expect(cameraMetrics().centerY).toBeCloseTo(manual.centerY, 8);
    expect(cameraMetrics().pixelsPerMeter).toBeCloseTo(manual.pixelsPerMeter, 8);
    expect(commit).not.toHaveBeenCalled();
  });

  it('pans blank space and navigates/zooms without any project commit or field DOM enlargement', async () => {
    const original = box();
    await pointer(field(), 'pointerdown', 270, 220);
    await pointer(field(), 'pointermove', 350, 240);
    await pointer(field(), 'pointerup', 350, 240);
    expect(box()).not.toBe(original);
    await wheel();
    await act(async () => button('К роботу').click());
    await act(async () => button('Показать поле целиком').click());
    expect(box()).toBe(original);
    expect(commit).not.toHaveBeenCalled();
    expect(container.querySelector('.robotics-field-zoom-surface')).toBeNull();
    expect(canvas().dataset.cameraGesturing).toBe('false');
  });

  it('moves an object under its pointer after pan/zoom while keeping the camera fixed', async () => {
    await pointer(field(), 'pointerdown', 230, 180);
    await pointer(field(), 'pointermove', 260, 210);
    await pointer(field(), 'pointerup', 260, 210);
    await wheel(350, 260);
    const view = box();
    const start = atWorld(1, 1);
    const end = atWorld(1.2, 1.1);
    const ball = field().querySelector('[data-scene-key="ball:camera-test"]')!;
    await pointer(ball, 'pointerdown', start.x, start.y);
    await pointer(field(), 'pointermove', end.x, end.y);
    await pointer(field(), 'pointerup', end.x, end.y);
    expect(box()).toBe(view);
    expect(commit).toHaveBeenCalledTimes(1);
    const changed = commit.mock.calls[0]![0] as unknown as typeof world;
    expect(changed.field.balls[0]!.xMeters).toBeCloseTo(1.2, 4);
    expect(changed.field.balls[0]!.yMeters).toBeCloseTo(1.1, 4);
  });

  it('resizes an existing handle after zoom without moving the camera or object centre', async () => {
    await wheel(340, 270);
    const start = atWorld(1, 1);
    const ball = field().querySelector('[data-scene-key="ball:camera-test"]')!;
    await pointer(ball, 'pointerdown', start.x, start.y);
    await pointer(field(), 'pointerup', start.x, start.y);
    const view = box();
    const handle = field().querySelector('[data-vector-kind="ball"][data-vector-handle="radius"]')!;
    const radius = world.field.balls[0]!.radiusMeters;
    const from = atWorld(1 + radius, 1);
    const to = atWorld(1 + radius + 0.03, 1);
    await pointer(handle, 'pointerdown', from.x, from.y);
    await pointer(field(), 'pointermove', to.x, to.y);
    await pointer(field(), 'pointerup', to.x, to.y);
    expect(box()).toBe(view);
    expect(commit).toHaveBeenCalledTimes(1);
    const changed = commit.mock.calls[0]![0];
    expect(changed.field.balls[0]!.radiusMeters).toBeCloseTo(radius + 0.03, 4);
    expect(changed.field.balls[0]!.xMeters).toBe(1);
    expect(changed.field.balls[0]!.yMeters).toBe(1);
  });

  it('preserves grid snapping when an object is dragged after pan and zoom', async () => {
    await wheel(350, 260);
    const snap = [...container.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Привязка'))!
      .querySelector('input')!;
    await act(async () => snap.click());
    const start = atWorld(1, 1);
    const end = atWorld(1.173, 1.127);
    const ball = field().querySelector('[data-scene-key="ball:camera-test"]')!;
    const view = box();
    await pointer(ball, 'pointerdown', start.x, start.y);
    await pointer(field(), 'pointermove', end.x, end.y);
    await pointer(field(), 'pointerup', end.x, end.y);
    expect(box()).toBe(view);
    expect(commit).toHaveBeenCalledTimes(1);
    const changed = commit.mock.calls[0]![0];
    expect(changed.field.balls[0]!.xMeters).toBeCloseTo(
      Math.round(1.173 / world.field.gridMeters) * world.field.gridMeters,
      4,
    );
    expect(changed.field.balls[0]!.yMeters).toBeCloseTo(
      Math.round(1.127 / world.field.gridMeters) * world.field.gridMeters,
      4,
    );
  });

  it('defers drawing on first touch, takes over for pinch, and does not place on either finger release', async () => {
    await act(async () => button('Линия').click());
    const original = box();
    await pointer(field(), 'pointerdown', 250, 200, { id: 11, type: 'touch' });
    await pointer(field(), 'pointerdown', 450, 200, { id: 12, type: 'touch', primary: false });
    await pointer(field(), 'pointermove', 520, 240, { id: 12, type: 'touch', primary: false });
    await pointer(field(), 'pointerup', 520, 240, { id: 12, type: 'touch', primary: false });
    await pointer(field(), 'pointerup', 250, 200, { id: 11, type: 'touch' });
    expect(box()).not.toBe(original);
    expect(canvas().dataset.drawing).toBe('false');
    expect(commit).not.toHaveBeenCalled();
    expect(canvas().dataset.cameraGesturing).toBe('false');
  });

  it('cancels a provisional object drag when the second touch takes camera ownership', async () => {
    const start = atWorld(1, 1);
    const ball = field().querySelector('[data-scene-key="ball:camera-test"]')!;
    const original = box();
    await pointer(ball, 'pointerdown', start.x, start.y, { id: 21, type: 'touch' });
    await pointer(field(), 'pointermove', start.x + 10, start.y, { id: 21, type: 'touch' });
    await pointer(field(), 'pointerdown', start.x + 100, start.y, {
      id: 22,
      type: 'touch',
      primary: false,
    });
    await pointer(field(), 'pointermove', start.x + 150, start.y + 20, {
      id: 22,
      type: 'touch',
      primary: false,
    });
    await pointer(field(), 'pointerup', start.x + 150, start.y + 20, {
      id: 22,
      type: 'touch',
      primary: false,
    });
    await pointer(field(), 'pointerup', start.x + 10, start.y, { id: 21, type: 'touch' });
    expect(box()).not.toBe(original);
    expect(commit).not.toHaveBeenCalled();
    expect(canvas().dataset.cameraGesturing).toBe('false');
  });

  it('cancels object drafts on blur and camera gestures on pointercancel without a later edit', async () => {
    const start = atWorld(1, 1);
    const ball = field().querySelector('[data-scene-key="ball:camera-test"]')!;
    await pointer(ball, 'pointerdown', start.x, start.y);
    await pointer(field(), 'pointermove', start.x + 35, start.y);
    await act(async () => window.dispatchEvent(new Event('blur')));
    await pointer(field(), 'pointerup', start.x + 35, start.y);
    expect(commit).not.toHaveBeenCalled();
    await pointer(field(), 'pointerdown', 200, 150, { button: 1 });
    await pointer(field(), 'pointermove', 240, 180, { button: 1 });
    await pointer(field(), 'pointercancel', 240, 180, { button: 1 });
    const view = box();
    await pointer(field(), 'pointermove', 330, 230);
    expect(box()).toBe(view);
    expect(canvas().dataset.cameraGesturing).toBe('false');
  });

  it('preserves view through a hidden tab and ignores Space in text inputs', async () => {
    await wheel();
    const view = box();
    dimensions = { width: 0, height: 0 };
    await act(async () => window.dispatchEvent(new Event('resize')));
    dimensions = viewport;
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(box()).toBe(view);
    const input = document.createElement('textarea');
    container.append(input);
    await act(async () => input.focus());
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }),
      ),
    );
    expect(canvas().dataset.pan).toBe('false');
    expect(commit).not.toHaveBeenCalled();
  });
});
