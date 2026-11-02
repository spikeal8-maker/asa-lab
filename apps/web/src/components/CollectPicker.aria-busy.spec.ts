// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
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

it('reports idle, pending and settled membership mutation through the actual dialog aria-busy', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const entry: Collection = {
    id: 'collection-aria',
    title: 'Доступная подборка',
    itemCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
  };
  let finish!: (value: Awaited<ReturnType<typeof api.setCollectionItem>>) => void;
  const mutation = new Promise<Awaited<ReturnType<typeof api.setCollectionItem>>>((resolve) => {
    finish = resolve;
  });
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
  vi.mocked(api.setCollectionItem).mockReturnValueOnce(mutation);
  try {
    await act(async () => {
      root.render(
        createElement(CollectPicker, {
          projectId: 'project-aria',
          title: 'Моя работа',
          onClose: vi.fn(),
        }),
      );
    });
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const checkbox = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(dialog.getAttribute('aria-busy')).toBe('false');
    await act(async () => checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(api.setCollectionItem).toHaveBeenCalledExactlyOnceWith(entry.id, 'project-aria', true);
    expect(checkbox.disabled).toBe(true);
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    await act(async () => finish({ ok: true, status: 200, data: { ok: true } }));
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(false);
    expect(dialog.getAttribute('aria-busy')).toBe('false');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
