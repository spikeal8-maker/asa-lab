// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { ClassroomNavigator } from '../ClassroomNavigator';

// Only API/session boundaries are mocked; navigation and placement use the implementation.
const mocks = vi.hoisted(() => ({ list: vi.fn(), listeners: new Set<() => void>() }));
vi.mock('../../api', () => ({ api: { listClassrooms: mocks.list } }));
vi.mock('../../session-fetch', () => ({
  onSessionLoggedOut: (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => {
      mocks.listeners.delete(listener);
    };
  },
}));
const row = (id: string, title: string) =>
  ({ id, title, status: 'active', teacherRole: 'owner' }) as const;
const response = (...items: ReturnType<typeof row>[]) => ({
  ok: true as const,
  data: { items, meta: { total: items.length } },
});
let host: HTMLDivElement;
let root: Root;
let navigate: Mock<(id: string, title: string) => void>;
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}
async function render(id = 'b', title = '4Б Робототехника') {
  await act(async () =>
    root.render(
      createElement(ClassroomNavigator, {
        classroom: row(id, title),
        onNavigateClassroom: navigate,
      }),
    ),
  );
}
async function click(element: Element) {
  await act(async () => (element as HTMLElement).click());
}
async function key(element: Element, value: string) {
  await act(async () =>
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
    ),
  );
}
function opener() {
  return host.querySelector<HTMLButtonElement>('h1 button')!;
}
function panel() {
  return host.querySelector<HTMLDivElement>('[role="dialog"]')!;
}
function items() {
  return [...panel().querySelectorAll<HTMLButtonElement>('button[title]')];
}
function pending() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  mocks.list.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  return (value: ReturnType<typeof response>) => act(async () => resolve(value));
}
const ready = () =>
  response(row('a', '3А'), row('b', '4Б Робототехника'), row('c', '10Б-1 Роботы'));

// Model layout from the inline style actually committed on the dialog. A stale
// 240px initial height would hide the need to scroll the current item at 220px.
function installRevealGeometry() {
  const measuredHeights: string[] = [];
  vi.stubGlobal('innerHeight', 200);
  vi.stubGlobal('visualViewport', undefined);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.matches('h1 button')) return rect(8, 42, 200, 44);
    if (this.getAttribute('role') === 'dialog') {
      measuredHeights.push(this.style.maxHeight);
      return rect(8, 0, 320, Number.parseFloat(this.style.maxHeight));
    }
    if (this.getAttribute('aria-current') === 'true') {
      const scroll = this.closest<HTMLElement>('[role="dialog"]')?.scrollTop ?? 0;
      return rect(8, 176 - scroll, 300, 44);
    }
    return rect(8, 0, 300, 44);
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.getAttribute('role') === 'dialog' ? Number.parseFloat(this.style.maxHeight) : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientTop', 'get').mockReturnValue(0);
  return measuredHeights;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.list.mockReset();
  mocks.listeners.clear();
  mocks.list.mockResolvedValue(ready());
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  navigate = vi.fn<(id: string, title: string) => void>();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  expect(mocks.listeners.size).toBe(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('preserves the full heading and fetches once across callback changes', async () => {
  await render();
  expect(host.querySelector('h1')?.textContent).toBe('4Б Робототехника');
  expect(opener().querySelector('.classroom-nav-chevron')?.getAttribute('aria-hidden')).toBe(
    'true',
  );
  expect(opener().querySelector('.classroom-nav-chevron')?.textContent).toBe('');
  expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('Предыдущий класс: 3А');
  navigate = vi.fn<(id: string, title: string) => void>();
  await render();
  expect(mocks.list).toHaveBeenCalledTimes(1);
});

it('preserves an exact heading and keeps previous class title out of visible body text', async () => {
  const previousTitle = 'Класс A с отдельными данными';
  mocks.list.mockResolvedValueOnce(
    response(row('a', previousTitle), row('b', 'Класс B после перехода')),
  );
  await render('b', 'Класс B после перехода');
  expect(host.querySelector('h1')?.textContent).toBe('Класс B после перехода');
  const previous = host.querySelector<HTMLButtonElement>('.classroom-nav-neighbor')!;
  expect(previous.textContent).toContain('Класс A');
  expect(previous.textContent).not.toContain(previousTitle);
  expect(previous.getAttribute('title')).toBe(previousTitle);
  expect(previous.getAttribute('aria-label')).toBe(`Предыдущий класс: ${previousTitle}`);
  expect(host.textContent).not.toContain(previousTitle);
});

it('restores focus immediately, calls navigation once and commits closure after the click', async () => {
  await render();
  navigate.mockImplementation(() => {
    expect(document.activeElement).toBe(opener());
  });
  await click(opener());
  await click(items()[2]!);
  expect(navigate).toHaveBeenCalledExactlyOnceWith('c', '10Б-1 Роботы');
  expect(panel()).toBeNull();
  expect(opener().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(opener());
});

it('supports arrows, Home, End, Escape and outside dismissal', async () => {
  await render();
  await key(opener(), 'ArrowDown');
  const list = items();
  expect(document.activeElement).toBe(list[1]);
  await key(list[1]!, 'Home');
  expect(document.activeElement).toBe(list[0]);
  await key(list[0]!, 'ArrowDown');
  expect(document.activeElement).toBe(list[1]);
  await key(list[1]!, 'End');
  expect(document.activeElement?.textContent).toBe('Закрыть');
  await key(document.activeElement!, 'ArrowUp');
  expect(document.activeElement).toBe(list[2]);
  await key(list[2]!, 'Escape');
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(opener());
  await click(opener());
  await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  expect(panel()).toBeNull();
});

it('keeps internal popup scroll open but dismisses external scroll', async () => {
  await render();
  await click(opener());
  const dialog = panel();
  await act(async () => dialog.dispatchEvent(new Event('scroll')));
  expect(panel()).toBe(dialog);
  await act(async () => items()[0]!.dispatchEvent(new Event('scroll')));
  expect(panel()).toBe(dialog);
  await act(async () => document.dispatchEvent(new Event('scroll')));
  expect(panel()).toBeNull();
  expect(document.activeElement).toBe(opener());
});

it('reveals already-ready content only after final placement and uses fresh geometry on reopening', async () => {
  const measuredHeights = installRevealGeometry();
  await render();
  await click(opener());
  const first = panel();
  expect(first.style.maxHeight).toBe('100px');
  expect(measuredHeights).toEqual(['100px']);
  expect(first.scrollTop).toBe(120);
  expect(document.activeElement).toBe(items()[1]);
  await key(panel(), 'Escape');

  measuredHeights.length = 0;
  vi.stubGlobal('innerHeight', 160);
  await click(opener());
  const second = panel();
  expect(second).not.toBe(first);
  expect(second.style.maxHeight).toBe('60px');
  expect(measuredHeights).toEqual(['60px']);
  expect(second.scrollTop).toBe(160);
  expect(document.activeElement).toBe(items()[1]);

  await act(async () => {
    second.scrollTop = 0;
    second.dispatchEvent(new Event('scroll'));
  });
  await render();
  expect(panel()).toBe(second);
  expect(second.scrollTop).toBe(0);
  expect(measuredHeights).toEqual(['60px']);
  await act(async () => items()[0]!.focus());
  await render();
  expect(document.activeElement).toBe(items()[0]);
  expect(measuredHeights).toEqual(['60px']);
});

it('focuses loading content, then reveals and focuses the current item once using committed placement', async () => {
  const measuredHeights = installRevealGeometry();
  const resolve = pending();
  await render();
  await click(opener());
  const dialog = panel();
  expect(dialog.getAttribute('aria-label')).toBe('Выбрать класс');
  expect(dialog.hasAttribute('aria-modal')).toBe(false);
  expect(document.activeElement).toBe(dialog);
  expect(dialog.querySelector('[role="status"]')?.textContent).toContain('Загружаем');
  expect(dialog.querySelector('button')?.textContent).toBe('Закрыть');
  expect(dialog.style.maxHeight).toBe('100px');
  expect(measuredHeights).toEqual([]);
  await resolve(ready());
  expect(document.activeElement).toBe(items()[1]);
  expect(measuredHeights).toEqual(['100px']);
  expect(dialog.scrollTop).toBe(120);
  await act(async () => {
    dialog.scrollTop = 0;
    dialog.dispatchEvent(new Event('scroll'));
  });
  await render();
  expect(panel()).toBe(dialog);
  expect(dialog.scrollTop).toBe(0);
  expect(measuredHeights).toEqual(['100px']);
  await act(async () => items()[0]!.focus());
  await render();
  expect(document.activeElement).toBe(items()[0]);
  expect(measuredHeights).toEqual(['100px']);
});

it('does not steal focus after keyboard interaction while loading', async () => {
  const measuredHeights = installRevealGeometry();
  const resolve = pending();
  await render();
  await click(opener());
  await key(panel(), 'End');
  const close = document.activeElement;
  expect(close?.textContent).toBe('Закрыть');
  await resolve(ready());
  expect(document.activeElement).toBe(close);
  expect(panel().scrollTop).toBe(0);
  expect(measuredHeights).toEqual([]);
});

it.each(['pointerdown', 'wheel', 'touchstart'])(
  'suppresses the loading handoff after %s without requiring focus to move',
  async (type) => {
    const measuredHeights = installRevealGeometry();
    const resolve = pending();
    await render();
    await click(opener());
    const dialog = panel();
    await act(async () => dialog.dispatchEvent(new Event(type, { bubbles: true })));
    expect(document.activeElement).toBe(dialog);
    await resolve(ready());
    expect(document.activeElement).toBe(dialog);
    expect(dialog.scrollTop).toBe(0);
    expect(measuredHeights).toEqual([]);
  },
);

it('preserves a loading handoff across internal scroll and refreshes placement when reopened before readiness', async () => {
  const measuredHeights = installRevealGeometry();
  const resolve = pending();
  await render();
  await click(opener());
  expect(panel().style.maxHeight).toBe('100px');
  await key(panel(), 'Escape');
  vi.stubGlobal('innerHeight', 160);
  await click(opener());
  const dialog = panel();
  expect(dialog.style.maxHeight).toBe('60px');
  await act(async () => dialog.dispatchEvent(new Event('scroll')));
  expect(panel()).toBe(dialog);
  await resolve(ready());
  expect(document.activeElement).toBe(items()[1]);
  expect(measuredHeights).toEqual(['60px']);
  expect(dialog.scrollTop).toBe(160);
});

it('offers usable error controls and keeps retry open through async readiness', async () => {
  mocks.list.mockResolvedValueOnce(response());
  await render();
  await click(opener());
  expect(document.activeElement).toBe(panel());
  expect(panel().querySelector('[role="status"]')?.textContent).toContain(
    'Текущий класс остаётся открытым',
  );
  const resolve = pending();
  await key(panel(), 'Home');
  expect(document.activeElement?.textContent).toBe('Повторить');
  await click(document.activeElement!);
  expect(document.activeElement).toBe(panel());
  expect(panel().textContent).toContain('Загружаем');
  await resolve(ready());
  expect(document.activeElement).toBe(items()[1]);
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it('anchors short above content by its bottom, including offset visual viewports', async () => {
  vi.stubGlobal('innerHeight', 800);
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 30,
    offsetTop: 100,
    width: 320,
    height: 400,
  });
  vi.stubGlobal('visualViewport', viewport);
  mocks.list.mockResolvedValueOnce(response(row('b', '4Б Робототехника')));
  await render();
  vi.spyOn(opener(), 'getBoundingClientRect').mockReturnValue(rect(320, 450, 60, 44));
  await click(opener());
  expect(panel().style.top).toBe('');
  expect(panel().style.bottom).toBe('356px');
  expect(panel().style.maxHeight).toBe('336px');
  expect(panel().style.width).toBe('304px');
  expect(panel().style.left).toBe('38px');
  // No full-height top offset: CSS resolves the actual short content height.
  await act(async () => viewport.dispatchEvent(new Event('resize')));
  expect(panel()).toBeNull();
});

it('clamps below placement to a narrow visual viewport and dismisses viewport movement', async () => {
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 10,
    offsetTop: 20,
    width: 280,
    height: 500,
  });
  vi.stubGlobal('visualViewport', viewport);
  await render();
  vi.spyOn(opener(), 'getBoundingClientRect').mockReturnValue(rect(260, 30, 50, 44));
  await click(opener());
  expect(panel().style.left).toBe('18px');
  expect(panel().style.width).toBe('264px');
  expect(panel().style.top).toBe('80px');
  expect(panel().style.bottom).toBe('');
  await act(async () => viewport.dispatchEvent(new Event('scroll')));
  expect(panel()).toBeNull();
});

it('handles an HTTP-level failure result without displaying stale class navigation', async () => {
  mocks.list.mockResolvedValueOnce({
    ok: false,
    status: 403,
    error: { code: 'FORBIDDEN', message: 'Access denied' },
  });
  await render();
  const neighbors = host.querySelectorAll<HTMLButtonElement>('.classroom-nav-neighbor');
  expect([...neighbors].every((button) => button.disabled)).toBe(true);
  await click(opener());
  expect(panel().querySelector('[role="status"]')?.textContent).toContain(
    'Текущий класс остаётся открытым',
  );
  await key(panel(), 'Home');
  expect(document.activeElement?.textContent).toBe('Повторить');
});

it('handles rejection locally with disabled neighbor slots', async () => {
  mocks.list.mockRejectedValueOnce(new Error('network'));
  await render();
  const neighbors = host.querySelectorAll<HTMLButtonElement>('.classroom-nav-neighbor');
  expect([...neighbors].every((button) => button.disabled)).toBe(true);
  expect(opener().textContent).toContain('4Б Робототехника');
  await click(opener());
  await key(panel(), 'Home');
  expect(document.activeElement?.textContent).toBe('Повторить');
  await key(panel(), 'Escape');
  expect(document.activeElement).toBe(opener());
});

it('ignores old route responses', async () => {
  const resolve = pending();
  await render();
  await render('c', '10Б-1 Роботы');
  await resolve(response(row('b', '4Б Робототехника')));
  expect(host.querySelector('button')?.getAttribute('aria-label')).toBe(
    'Предыдущий класс: 4Б Робототехника',
  );
});

it('clears on logout and ignores late resolution and later context fetches', async () => {
  const resolve = pending();
  await render();
  await click(opener());
  await act(async () => {
    for (const listener of mocks.listeners) listener();
  });
  await resolve(ready());
  expect(opener().disabled).toBe(true);
  expect(panel()).toBeNull();
  await render('c', '10Б-1 Роботы');
  expect(mocks.list).toHaveBeenCalledTimes(1);
});

it('ignores resolution after disposal', async () => {
  const resolve = pending();
  await render();
  await act(async () => root.render(null));
  await resolve(ready());
  expect(host.textContent).toBe('');
  expect(mocks.listeners.size).toBe(0);
});
