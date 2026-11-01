// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicProjectPage } from './PublicProjectPage';
import { publicProjectsApi, type PublicProject } from './api';

const publication: PublicProject = {
  publicationId: 'public-id',
  revisionId: 'revision-v1',
  revisionNo: 2,
  versionNo: 3,
  title: 'Длинное название проекта',
  summary: null,
  description: 'Описание работы',
  tags: ['схема'],
  license: 'public-domain',
  moduleKey: 'electronics',
  authorLabel: 'Автор',
  featured: true,
  pinned: true,
  publishedAt: '2026-10-21T10:00:00Z',
  preview: { url: '/cover.png', width: 400, height: 240, contentType: 'image/png' },
  capabilities: { viewer: 'static', canCopy: false, downloadFormats: [] },
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.spyOn(publicProjectsApi, 'artifact').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      artifact: {
        schemaVersion: 1,
        status: 'static-only',
        viewerFamily: 'electronics',
        reason: 'viewer-not-available',
        provenance: {
          publicationId: publication.publicationId,
          revisionNumber: publication.revisionNo,
        },
        capabilities: { readOnly: true, interactive: false, download: false },
      },
    },
  });
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () =>
    root.render(createElement(PublicProjectPage, { publicationId: 'public-id', onBack: vi.fn() })),
  );
}
it('reads title, honest cover, real actions, then description and publication facts', async () => {
  vi.spyOn(publicProjectsApi, 'get').mockResolvedValue({
    ok: true,
    status: 200,
    data: { publication },
  });
  await render();
  const article = container.querySelector('article')!;
  expect([...article.children].map((element) => element.tagName)).toEqual(['HEADER', 'DIV']);
  expect(article.querySelector('aside')?.textContent).toContain('Автор');
  expect(container.querySelector('.public-project-title-toggle')).toBeNull();
  expect(article.querySelector('.public-project-info')).toBeNull();
  expect(article.querySelector('.public-project-viewer button')).toBeNull();
  expect(article.querySelector('a[target="_blank"]')).toBeNull();
  expect(article.querySelector('.public-project-copy')).toBeNull();
  expect(container.textContent).not.toContain('Обновить публикацию');
  expect(article.querySelector('details summary')?.textContent).toContain('Лицензия');
  expect(article.querySelector('dl')?.textContent).toContain('Версия проекта3');
  expect(container.querySelector('[data-testid="public-project-pinned"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="public-project-featured"]')).not.toBeNull();
  const share = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Копировать ссылку',
  )!;
  await act(async () => share.click());
  expect(container.querySelector<HTMLInputElement>('.publication-share input')?.value).toContain(
    '/#/public-projects/public-id',
  );
});
it('keeps metadata and actions usable without an image, description or tags', async () => {
  vi.spyOn(publicProjectsApi, 'get').mockResolvedValue({
    ok: true,
    status: 200,
    data: { publication: { ...publication, preview: null, description: null, tags: [] } },
  });
  await render();
  expect(
    container.querySelector('[data-testid="public-project-preview-unavailable"]'),
  ).not.toBeNull();
  expect(container.querySelector('a[target="_blank"]')).toBeNull();
  expect(container.querySelector('[aria-label="Теги"]')).toBeNull();
  expect(container.querySelector('dl')?.textContent).toContain('Лицензия');
});
it('shows loading, retries a failed request, and closes an unavailable publication', async () => {
  let finish!: (result: Awaited<ReturnType<typeof publicProjectsApi.get>>) => void;
  const get = vi.spyOn(publicProjectsApi, 'get').mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Загружаем');
  await act(async () =>
    finish({
      ok: false,
      status: 503,
      error: { code: 'server_error', message: 'Сервис недоступен' },
    }),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Не удалось загрузить');
  get.mockResolvedValueOnce({
    ok: false,
    status: 404,
    error: { code: 'not_found', message: 'Публикация не найдена' },
  });
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  expect(container.querySelector('h1')?.textContent).toBe('Публикация недоступна');
  expect(container.querySelector('article')).toBeNull();
});
it('keeps a failed image honest without adding a public update control', async () => {
  const get = vi
    .spyOn(publicProjectsApi, 'get')
    .mockResolvedValue({ ok: true, status: 200, data: { publication } });
  await render();
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(
    container.querySelector('[data-testid="public-project-preview-unavailable"]')?.textContent,
  ).toContain('Изображение не загрузилось');
  expect(container.querySelector('.public-project-refresh')).toBeNull();
  expect(get).toHaveBeenCalledTimes(1);
});

it('copies the URL without expanding an address field on clipboard success', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  vi.spyOn(publicProjectsApi, 'get').mockResolvedValue({
    ok: true,
    status: 200,
    data: { publication },
  });
  await render();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('.publication-share button')!.click(),
  );
  expect(container.querySelector('.publication-share [role="status"]')?.textContent).toContain(
    'Ссылка скопирована',
  );
  expect(container.querySelector('.publication-share input')).toBeNull();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});

it('tears down publication content when exact artifact access is revoked', async () => {
  vi.spyOn(publicProjectsApi, 'get').mockResolvedValue({
    ok: true,
    status: 200,
    data: { publication },
  });
  vi.mocked(publicProjectsApi.artifact).mockResolvedValue({
    ok: false,
    status: 410,
    error: { code: 'publication_unavailable', message: 'Недоступно' },
  });
  await render();
  expect(container.querySelector('[data-testid="public-project-unavailable"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="public-electronics-scene"]')).toBeNull();
  expect(container.querySelector('article')).toBeNull();
});

it('rejects an artifact from a different immutable revision', async () => {
  vi.spyOn(publicProjectsApi, 'get').mockResolvedValue({
    ok: true,
    status: 200,
    data: { publication },
  });
  vi.mocked(publicProjectsApi.artifact).mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      artifact: {
        schemaVersion: 1,
        status: 'static-only',
        viewerFamily: 'electronics',
        reason: 'viewer-not-available',
        provenance: {
          publicationId: publication.publicationId,
          revisionNumber: publication.revisionNo + 1,
        },
        capabilities: { readOnly: true, interactive: false, download: false },
      },
    },
  });
  await render();
  expect(container.querySelector('[data-testid="public-project-unavailable"]')).not.toBeNull();
  expect(container.querySelector('article')).toBeNull();
});

it('reveals and collapses a long full heading through an accessible control', async () => {
  const title = 'Оченьдлинноеназвание'.repeat(9);
  vi.spyOn(publicProjectsApi, 'get').mockResolvedValue({
    ok: true,
    status: 200,
    data: { publication: { ...publication, title } },
  });
  await render();
  const heading = container.querySelector('h1')!;
  const toggle = container.querySelector<HTMLButtonElement>('.public-project-title-toggle')!;
  expect(heading.textContent).toBe(title);
  expect(toggle.getAttribute('aria-controls')).toBe(heading.id);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(toggle.textContent).toBe('Свернуть название');
  expect(heading.textContent).toBe(title);
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.textContent).toBe('Название целиком');
});

it('groups the single back link and title, public author/date, and actual copy metric', async () => {
  vi.spyOn(publicProjectsApi, 'get').mockResolvedValue({
    ok: true,
    status: 200,
    data: { publication: { ...publication, copyCount: 4 } },
  });
  await render();
  expect(container.querySelectorAll('.public-project-back')).toHaveLength(1);
  const topline = container.querySelector('.public-project-detail-topline')!;
  expect(topline.querySelector('a')?.getAttribute('href')).toBe('/#/explore');
  expect(topline.querySelector('h1')?.textContent).toBe(publication.title);
  expect(container.querySelector('.public-project-authorline time')?.getAttribute('datetime')).toBe(
    publication.publishedAt,
  );
  expect(
    container.querySelector('.public-project-detail-avatar')?.getAttribute('aria-hidden'),
  ).toBe('true');
  expect(container.querySelector('[aria-label="Добавили к себе: 4"]')).not.toBeNull();
  expect(container.querySelector('.public-project-about time')).toBeNull();
  expect(container.textContent).not.toMatch(/Включить комментарии|Все комментарии/);
});
it('expands long descriptions with a linked accessible control', async () => {
  vi.spyOn(publicProjectsApi, 'get').mockResolvedValue({
    ok: true,
    status: 200,
    data: { publication: { ...publication, description: 'Длинное описание проекта. '.repeat(60) } },
  });
  await render();
  const paragraph = container.querySelector('.public-project-description')!;
  const button = container.querySelector<HTMLButtonElement>('.public-project-description-toggle')!;
  expect(paragraph.classList.contains('is-collapsed')).toBe(true);
  expect(button.getAttribute('aria-controls')).toBe(paragraph.id);
  expect(button.getAttribute('aria-expanded')).toBe('false');
  await act(async () => button.click());
  expect(paragraph.classList.contains('is-collapsed')).toBe(false);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  await act(async () => button.click());
  expect(paragraph.classList.contains('is-collapsed')).toBe(true);
});
