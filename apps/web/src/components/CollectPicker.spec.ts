// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type Collection } from '../api';
import { CollectPicker } from './CollectPicker';

vi.mock('../api', () => ({
  api: {
    listCollections: vi.fn(),
    collectionsHolding: vi.fn(),
    setCollectionItem: vi.fn(),
    createCollection: vi.fn(),
  },
}));

let host: HTMLDivElement;
let root: Root;
const close = vi.fn();
const entry: Collection = {
  id: 'collection-a',
  title: 'Моя длинная подборка проектов',
  itemCount: 2,
  createdAt: '2026-01-01T00:00:00Z',
};
const success = { ok: true as const, status: 200, data: { ok: true as const } };
const failure = {
  ok: false as const,
  status: 403,
  error: { code: 'forbidden', message: 'Not allowed' },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.resetAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(api.listCollections).mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [entry] },
  });
  vi.mocked(api.collectionsHolding).mockResolvedValue({
    ok: true,
    status: 200,
    data: { collectionIds: [] },
  });
  vi.mocked(api.setCollectionItem).mockResolvedValue(success);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => {
    root.render(
      createElement(CollectPicker, { projectId: 'project-a', title: 'Моя работа', onClose: close }),
    );
  });
}

function checkbox() {
  return host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

function draft() {
  return host.querySelector<HTMLInputElement>('.collect-picker-create input')!;
}

async function click(element: Element) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(draft(), value);
    draft().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

describe('Actual collection picker lifecycle (aria feature evidence remains N/A)', () => {
  it('loads exact project membership and retains accessible dialog and close controls', async () => {
    vi.mocked(api.collectionsHolding).mockResolvedValue({
      ok: true,
      status: 200,
      data: { collectionIds: [entry.id] },
    });
    await render();
    expect(api.collectionsHolding).toHaveBeenCalledWith('project-a');
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe(
      'collect-title',
    );
    expect(host.textContent).toContain('Моя работа');
    expect(checkbox().checked).toBe(true);
    await click(host.querySelector('.modal-actions button')!);
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('disables mutation controls while pending, then updates membership and refreshes', async () => {
    const mutation = deferred<Awaited<ReturnType<typeof api.setCollectionItem>>>();
    vi.mocked(api.setCollectionItem).mockReturnValueOnce(mutation.promise);
    await render();
    await click(checkbox());
    expect(api.setCollectionItem).toHaveBeenCalledExactlyOnceWith(entry.id, 'project-a', true);
    expect(checkbox().disabled).toBe(true);
    expect(draft().disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => mutation.resolve(success));
    expect(checkbox().checked).toBe(true);
    expect(checkbox().disabled).toBe(false);
    expect(draft().disabled).toBe(false);
    expect(api.listCollections).toHaveBeenCalledTimes(2);
    await click(checkbox());
    expect(api.setCollectionItem).toHaveBeenLastCalledWith(entry.id, 'project-a', false);
    expect(checkbox().checked).toBe(false);
  });

  it('preserves membership on rejected mutation and releases busy controls', async () => {
    vi.mocked(api.setCollectionItem).mockResolvedValueOnce(failure);
    await render();
    await click(checkbox());
    expect(checkbox().checked).toBe(false);
    expect(checkbox().disabled).toBe(false);
    expect(draft().disabled).toBe(false);
    expect(api.listCollections).toHaveBeenCalledTimes(1);
  });

  it('creates the trimmed collection, adds the exact project and releases busy state', async () => {
    const creation = deferred<Awaited<ReturnType<typeof api.createCollection>>>();
    vi.mocked(api.createCollection).mockReturnValueOnce(creation.promise);
    await render();
    await type('  Новая подборка  ');
    await submit();
    expect(api.createCollection).toHaveBeenCalledExactlyOnceWith('Новая подборка');
    expect(draft().disabled).toBe(true);
    const created = { ...entry, id: 'collection-new', title: 'Новая подборка' };
    vi.mocked(api.listCollections).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { items: [created] },
    });
    await act(async () => creation.resolve({ ok: true, status: 200, data: { id: created.id } }));
    expect(api.setCollectionItem).toHaveBeenCalledExactlyOnceWith(created.id, 'project-a', true);
    expect(checkbox().checked).toBe(true);
    expect(draft().value).toBe('');
    expect(draft().disabled).toBe(false);
  });

  it('rejects blank creation and recovers after a rejected creation without adding an item', async () => {
    await render();
    await type('   ');
    await submit();
    expect(api.createCollection).not.toHaveBeenCalled();
    vi.mocked(api.createCollection).mockResolvedValueOnce(failure);
    await type('Запрещённая подборка');
    await submit();
    expect(api.setCollectionItem).not.toHaveBeenCalled();
    expect(checkbox().checked).toBe(false);
    expect(draft().disabled).toBe(false);
    expect(draft().value).toBe('');
  });
});
