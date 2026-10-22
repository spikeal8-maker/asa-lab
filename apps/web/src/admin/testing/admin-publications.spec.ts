// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPublicationsPage } from '../AdminPublicationsPage';
import { call, type AdminScope } from '../admin-api';
import {
  adminHref,
  adminSectionFromLocation,
  scopeSupportsAdminSection,
} from '../admin-navigation';

vi.mock('../admin-api', () => ({ call: vi.fn() }));

const publication = {
  publicationId: 'publication-1',
  revisionId: 'revision-1',
  title: 'Реальный проект',
  authorLabel: 'Публичный автор',
  moduleKey: 'electronics',
  publishedAt: '2026-10-21T12:00:00Z',
  state: 'public',
  hidden: false,
  moderationVersion: 0,
  reason: null,
  moderatedAt: null,
  featured: false,
  editorialVersion: 0,
  lifecycleVersion: 0,
};
let root: Root;
let host: HTMLDivElement;
const denied = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(call).mockReset();
  denied.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(hidden = false, nextOffset: number | null = null) {
  vi.mocked(call).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          ...publication,
          hidden,
          moderationVersion: hidden ? 1 : 0,
          reason: hidden ? 'Нарушение' : null,
        },
      ],
      nextOffset,
    },
  });
  await act(async () =>
    root.render(createElement(AdminPublicationsPage, { onAccessDenied: denied })),
  );
}
function button(label: string): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find((item) => item.textContent === label)!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function enterReason(value = 'Проверенная причина') {
  await act(async () => {
    const field = host.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field,
      value,
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function submit() {
  host
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('publications moderation', () => {
  it('exposes the route only for a platform administrator', () => {
    expect(adminHref('publications')).toBe('/#/admin/publications');
    expect(adminSectionFromLocation({ hash: '#/admin/publications' })).toBe('publications');
    for (const kind of ['platform', 'organization'] as const) {
      for (const role of ['platform_admin', 'moderator', 'school_admin', 'owner'] as const) {
        const scope: AdminScope = {
          kind,
          role,
          id: null,
          title: 'Scope',
          permissions: ['administration.moderation.read'],
        };
        expect(scopeSupportsAdminSection(scope, 'publications')).toBe(
          kind === 'platform' && role === 'platform_admin',
        );
      }
    }
  });
  it('loads real metadata and an authorized same-origin frozen image with fallback', async () => {
    await mount();
    expect(call).toHaveBeenCalledExactlyOnceWith('/api/admin/v1/publications?offset=0&limit=25');
    expect(host.textContent).toContain('Публичный автор');
    const image = host.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('/api/admin/v1/publications/publication-1/image');
    await act(async () => image.dispatchEvent(new Event('error')));
    expect(host.querySelector('[aria-label="Превью недоступно"]')).not.toBeNull();
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/#/public-projects/publication-1');
  });
  it.each([false, true])(
    'requires reason and explicit confirmation (hidden=%s)',
    async (hidden) => {
      await mount(hidden);
      await click(hidden ? 'Восстановить' : 'Скрыть');
      expect(call).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain('Рабочий проект не удаляется');
      expect(button(hidden ? 'Подтвердить восстановление' : 'Подтвердить скрытие').disabled).toBe(
        true,
      );
      await enterReason('   ');
      await act(async () => submit());
      expect(call).toHaveBeenCalledTimes(1);
      await enterReason();
      vi.mocked(call).mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          publicationId: publication.publicationId,
          hidden: !hidden,
          reason: hidden ? null : 'Проверенная причина',
          moderatedAt: '2026-10-22T00:00:00Z',
          moderationVersion: hidden ? 2 : 1,
        },
      });
      await act(async () => submit());
      expect(call).toHaveBeenLastCalledWith(
        `/api/admin/v1/publications/publication-1/${hidden ? 'restore' : 'hide'}`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: 'Проверенная причина',
            expectedVersion: hidden ? 1 : 0,
            expectedRevisionId: publication.revisionId,
          }),
        },
      );
      expect(host.querySelector('dialog')).toBeNull();
      expect(host.querySelector('a') !== null).toBe(hidden);
    },
  );
  it('publishes a real editorial toggle only after a matching server receipt', async () => {
    await mount();
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        publicationId: publication.publicationId,
        revisionId: publication.revisionId,
        featured: true,
        editorialVersion: 1,
        lifecycleVersion: 0,
      },
    });
    await click('Выбор редакции');
    expect(call).toHaveBeenLastCalledWith('/api/admin/v1/publications/publication-1/featured', {
      method: 'POST',
      body: JSON.stringify({
        featured: true,
        expectedVersion: 0,
        expectedRevisionId: publication.revisionId,
        expectedModerationVersion: 0,
        expectedLifecycleVersion: 0,
      }),
    });
    expect(host.querySelector('[data-testid="admin-publication-featured"]')?.textContent).toContain(
      'Выбор редакции',
    );
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        publicationId: publication.publicationId,
        revisionId: publication.revisionId,
        featured: false,
        editorialVersion: 2,
        lifecycleVersion: 0,
      },
    });
    await click('Снять отметку');
    expect(button('Выбор редакции')).not.toBeNull();
    expect(host.querySelector('[data-testid="admin-publication-featured"]')).toBeNull();
  });

  it('keeps a failed editorial request uncommitted and never shows it for hidden content', async () => {
    await mount();
    vi.mocked(call).mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'conflict', message: 'Changed' },
    });
    await click('Выбор редакции');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('изменилась');
    expect(host.querySelector('[data-testid="admin-publication-featured"]')).toBeNull();
  });

  it('blocks duplicate submissions and never invents success after a server error', async () => {
    await mount();
    await click('Скрыть');
    await enterReason();
    let finish!: (value: Awaited<ReturnType<typeof call>>) => void;
    vi.mocked(call).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      submit();
      submit();
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(button('Сохраняем…').disabled).toBe(true);
    await act(async () =>
      finish({ ok: false, status: 500, error: { code: 'server_error', message: 'Failed' } }),
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Изменение не подтверждено',
    );
    expect(host.querySelector('dialog')).not.toBeNull();
    expect(host.querySelector('a')).not.toBeNull();
  });
  it.each([401, 403])('stops interactions after HTTP %s', async (status) => {
    await mount();
    await click('Скрыть');
    await enterReason();
    vi.mocked(call).mockResolvedValueOnce({
      ok: false,
      status,
      error: { code: 'forbidden', message: 'Denied' },
    });
    await act(async () => submit());
    expect(denied).toHaveBeenCalledTimes(1);
    expect(button('Обновить').disabled).toBe(true);
    expect(host.querySelector('img')).toBeNull();
  });
  it('cancels without a write and restores focus', async () => {
    await mount();
    const trigger = button('Скрыть');
    await click('Скрыть');
    await click('Отмена');
    expect(call).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });
  it('keeps hidden publications private while allowing the authorized preview', async () => {
    await mount(true);
    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent).toContain('Причина: Нарушение');
    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      '/api/admin/v1/publications/publication-1/image',
    );
    await click('Восстановить');
    expect(call).toHaveBeenCalledTimes(1);
    expect(host.querySelector('textarea')).toBe(document.activeElement);
  });
  it('shows loading and a retryable list error without displaying sample data', async () => {
    let finish!: () => void;
    vi.mocked(call).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { ok: false, status: 500, error: { code: 'server_error', message: 'Failed' } };
    });
    await act(async () =>
      root.render(createElement(AdminPublicationsPage, { onAccessDenied: denied })),
    );
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Загружаем');
    expect(button('Обновить').disabled).toBe(true);
    await act(async () => finish());
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('li')).toBeNull();
    expect(button('Обновить').disabled).toBe(false);
  });
  it('loads another page and refreshes from offset zero', async () => {
    await mount(false, 25);
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { items: [], nextOffset: null },
    });
    await click('Показать ещё');
    expect(call).toHaveBeenLastCalledWith('/api/admin/v1/publications?offset=25&limit=25');
    vi.mocked(call).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { items: [], nextOffset: null },
    });
    await click('Обновить');
    expect(host.textContent).toContain('Публикаций пока нет');
    expect(call).toHaveBeenLastCalledWith('/api/admin/v1/publications?offset=0&limit=25');
  });
});
