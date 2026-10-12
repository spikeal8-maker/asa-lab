// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentCodeButton } from '../StudentCodeButton';

let root: Root;
let container: HTMLDivElement;
const code = 'Test42';
const edit = vi.fn(),
  copied = vi.fn(),
  denied = vi.fn();
let clipboard = vi.fn(async (value: string): Promise<void> => {
  void value;
});
async function render(showAll = false, epoch = 0, value = code) {
  await act(async () =>
    root.render(
      createElement(StudentCodeButton, {
        code: value,
        showAll,
        epoch,
        onEdit: edit,
        onCopied: copied,
        onDenied: denied,
      }),
    ),
  );
}
function button() {
  return container.querySelector('button')!;
}
async function click(detail = 1) {
  await act(async () => button().dispatchEvent(new MouseEvent('click', { bubbles: true, detail })));
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  clipboard = vi.fn(async (value: string): Promise<void> => {
    void value;
  });
  vi.stubGlobal('navigator', { clipboard: { writeText: clipboard } });
  edit.mockClear();
  copied.mockClear();
  denied.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('explicit credential disclosure', () => {
  it('keeps the real credential out of text and every attribute until reveal', async () => {
    await render();
    expect(container.innerHTML).not.toContain(code);
    expect(button().textContent).toBe('******');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    await click();
    expect(button().textContent).toBe(code);
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(code);
    expect(copied).toHaveBeenCalledOnce();
  });
  it('confirms clipboard only after its promise resolves', async () => {
    let resolve!: () => void;
    clipboard.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    await render();
    await click();
    expect(button().textContent).toBe(code);
    expect(copied).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(copied).toHaveBeenCalledOnce();
  });
  it('keeps a denied copy visible for manual copying without claiming success', async () => {
    clipboard.mockRejectedValue(new Error('denied'));
    await render();
    await click(0);
    expect(button().textContent).toBe(code);
    expect(denied).toHaveBeenCalledOnce();
    expect(copied).not.toHaveBeenCalled();
  });
  it('first double click reveals once; a subsequent double click edits without copying', async () => {
    vi.useFakeTimers();
    await render();
    await click(1);
    await click(2);
    await act(async () =>
      button().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })),
    );
    expect(edit).not.toHaveBeenCalled();
    expect(clipboard).toHaveBeenCalledOnce();
    await click(1);
    await click(2);
    await act(async () =>
      button().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })),
    );
    await act(async () => vi.runAllTimers());
    expect(edit).toHaveBeenCalledOnce();
    expect(clipboard).toHaveBeenCalledOnce();
  });
  it('supports F2 and keyboard activation without generating a code', async () => {
    await render();
    await act(async () =>
      button().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'F2' })),
    );
    expect(edit).toHaveBeenCalledOnce();
    expect(clipboard).not.toHaveBeenCalled();
    await click(0);
    expect(clipboard).toHaveBeenCalledExactlyOnceWith(code);
  });
  it('header hide clears individual disclosure and rotation cannot copy the old code', async () => {
    await render();
    await click();
    await render(true, 1);
    expect(button().textContent).toBe(code);
    await render(false, 2);
    expect(container.innerHTML).not.toContain(code);
    await render(false, 3, 'New456');
    await click(0);
    expect(clipboard.mock.calls.map(([value]) => value)).toEqual([code, 'New456']);
  });
  it('cleans delayed single clicks and ignores late clipboard receipts on unmount', async () => {
    vi.useFakeTimers();
    await render(true);
    await click(1);
    await act(async () => root.render(null));
    await act(async () => vi.runAllTimers());
    expect(clipboard).not.toHaveBeenCalled();
    let resolve!: () => void;
    clipboard.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    await render();
    await click();
    await act(async () => root.render(null));
    await act(async () => resolve());
    expect(copied).not.toHaveBeenCalled();
  });
});
