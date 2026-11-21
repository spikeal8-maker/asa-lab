// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, type PublicKnowledgeItem } from '../api';
import { publicProjectsApi, type PublicProject } from '../projects-public/api';
import { HomePublicShelves } from './HomePublicShelves';

let host: HTMLDivElement;
let root: Root;
let observer: ShelfVisibilityObserver;
const onGallery = vi.fn();
const onWork = vi.fn();
const onKnowledge = vi.fn();
const onCourse = vi.fn();
const work: PublicProject = {
  publicationId: 'published',
  revisionId: 'revision',
  revisionNo: 1,
  versionNo: 1,
  title: 'Исследование электрической цепи с очень длинным названием',
  summary: null,
  description: null,
  tags: [],
  license: 'reserved',
  moduleKey: 'electronics',
  authorLabel: 'Александра Константинопольская',
  authorAvatarUrl: '/api/public-projects/published/author-avatar',
  featured: true,
  pinned: true,
  likeCount: 7,
  copyCount: 3,
  publishedAt: '2026-10-30T00:00:00Z',
  preview: null,
  capabilities: { viewer: 'static', canCopy: false, downloadFormats: [] },
};
const course: PublicKnowledgeItem = {
  id: 'public-course',
  title: 'Знакомство с электроникой',
  summary: null,
  authorName: 'Автор курса',
  publishedAt: '2026-10-30T00:00:00Z',
  lessonCount: 12,
};

class ShelfVisibilityObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin: string;
  readonly thresholds = [0];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
  constructor(
    private readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.rootMargin = options?.rootMargin ?? '0px';
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  show(isIntersecting = true): void {
    const target = host.querySelector('.home-public-shelves')!;
    const bounds = target.getBoundingClientRect();
    this.callback(
      [
        {
          target,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          time: 0,
          rootBounds: null,
          boundingClientRect: bounds,
          intersectionRect: bounds,
        },
      ],
      this,
    );
  }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'IntersectionObserver',
    vi.fn(function (callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      observer = new ShelfVisibilityObserver(callback, options);
      return observer;
    }),
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  host = document.createElement('div');
  host.className = 'creator-home';
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(publicProjectsApi, 'list').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [work], nextOffset: null },
  });
  vi.spyOn(publicProjectsApi, 'artifact');
  vi.spyOn(api, 'publicKnowledge').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [course], nextOffset: null },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function render(): Promise<void> {
  await act(async () =>
    root.render(createElement(HomePublicShelves, { onGallery, onWork, onKnowledge, onCourse })),
  );
}

async function reveal(): Promise<void> {
  await act(async () => observer.show());
}

it('keeps both feeds lazy and renders the real community metadata once the shelf is near view', async () => {
  await render();
  expect(publicProjectsApi.list).not.toHaveBeenCalled();
  expect(api.publicKnowledge).not.toHaveBeenCalled();
  expect(observer.observe).toHaveBeenCalledWith(host.querySelector('.home-public-shelves'));
  expect(observer.rootMargin).toBe('240px');
  await act(async () => observer.show(false));
  expect(publicProjectsApi.list).not.toHaveBeenCalled();
  await reveal();
  expect(publicProjectsApi.list).toHaveBeenCalledTimes(1);
  expect(api.publicKnowledge).toHaveBeenCalledWith(0, 10);
  expect(observer.disconnect).toHaveBeenCalledTimes(1);
  const section = host.querySelector('.home-community-shelf')!;
  expect(section.querySelector('.home-community-heading p')?.textContent).toBe(
    'Работы пользователей платформы',
  );
  const card = section.querySelector('.public-project-card')!;
  expect(card.querySelector('h3')?.textContent).toBe(work.title);
  expect(card.querySelector('h3')?.getAttribute('title')).toBe(work.title);
  expect(card.querySelector('h2')).toBeNull();
  expect(card.querySelector('.public-project-author')?.textContent).toBe(work.authorLabel);
  expect(card.querySelector('time')?.getAttribute('datetime')).toBe(work.publishedAt);
  expect(card.querySelector('[aria-label="7 нравится"]')).not.toBeNull();
  expect(card.querySelector('[aria-label="3 добавлений в свои проекты"]')).not.toBeNull();
  expect(card.querySelector('[title="Добавили к себе"]')).not.toBeNull();
  expect(card.querySelector('[data-testid="public-project-pinned"]')).not.toBeNull();
  expect(card.querySelector('[data-testid="public-project-featured"]')).not.toBeNull();
  expect(card.querySelector('.public-project-avatar img')?.getAttribute('src')).toBe(
    work.authorAvatarUrl,
  );
  expect(card.querySelectorAll('a')).toHaveLength(1);
  expect(card.querySelector('a a, a button')).toBeNull();
  expect(card.textContent).not.toMatch(/скачиваний|загрузок/);
});

it('preserves public destinations and the independent knowledge card markup and action', async () => {
  await render();
  await reveal();
  const cardLink = host.querySelector<HTMLAnchorElement>('.public-project-card-link')!;
  expect(cardLink.getAttribute('href')).toBe('/#/public-projects/published');
  await act(async () => cardLink.click());
  expect(onWork).toHaveBeenCalledWith('published');

  const knowledge = host.querySelector('.home-public-card')!;
  expect(host.querySelectorAll('.home-public-card')).toHaveLength(1);
  expect(knowledge.querySelector('strong')?.textContent).toBe(course.title);
  expect(knowledge.querySelector('.home-knowledge-cover')?.textContent).toContain('12 уроков');
  expect(knowledge.textContent).toContain(course.authorName);
  expect(knowledge.querySelector('.public-project-card-meta')).toBeNull();
  const courseLink = knowledge.querySelector<HTMLAnchorElement>('a')!;
  expect(courseLink.getAttribute('href')).toBe('/#/knowledge/public-course');
  await act(async () => courseLink.click());
  expect(onCourse).toHaveBeenCalledWith(course.id);
  expect(host.querySelectorAll('.home-shelf-track[tabindex="0"]')).toHaveLength(2);
});

it.each(['three-d', 'electronics', 'blocks', 'robotics'])(
  'uses the existing artwork and passive preview for %s without fetching an artifact',
  async (moduleKey) => {
    vi.mocked(publicProjectsApi.list).mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [{ ...work, moduleKey }], nextOffset: null },
    });
    await render();
    await reveal();
    const card = host.querySelector('.public-project-card')!;
    expect(
      card.querySelector(`.publication-module[data-module="${moduleKey}"] svg`),
    ).not.toBeNull();
    expect(
      card.querySelector('[data-testid="public-project-preview-unavailable"]')?.textContent,
    ).toBe('Предпросмотр недоступен');
    expect(card.querySelectorAll('canvas')).toHaveLength(0);
    expect(publicProjectsApi.artifact).not.toHaveBeenCalled();
  },
);

it('shows genuine zero counters and omits an unavailable legacy copy count', async () => {
  const legacy = { ...work, publicationId: 'legacy', copyCount: 3 };
  Reflect.deleteProperty(legacy, 'copyCount');
  vi.mocked(publicProjectsApi.list).mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [{ ...work, copyCount: 0, likeCount: 0 }, legacy], nextOffset: null },
  });
  await render();
  await reveal();
  const [zero, unavailable] = host.querySelectorAll('.public-project-card');
  expect(zero.querySelector('[aria-label="0 добавлений в свои проекты"]')?.textContent).toBe('0');
  expect(zero.querySelector('[aria-label="0 нравится"]')?.textContent).toBe('0');
  expect(unavailable.querySelector('[title="Добавили к себе"]')).toBeNull();
});

it('uses existing image-error and avatar fallbacks without losing the publication link', async () => {
  vi.mocked(publicProjectsApi.list).mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          ...work,
          preview: {
            url: '/published-cover.png',
            contentType: 'image/png',
            width: 640,
            height: 480,
          },
        },
      ],
      nextOffset: null,
    },
  });
  await render();
  await reveal();
  const card = host.querySelector('.public-project-card')!;
  const preview = card.querySelector('[data-testid="public-project-card-preview"]')!;
  expect(preview.getAttribute('loading')).toBe('lazy');
  expect(preview.getAttribute('width')).toBe('640');
  await act(async () => preview.dispatchEvent(new Event('error')));
  expect(
    card.querySelector('[data-testid="public-project-preview-unavailable"]')?.textContent,
  ).toBe('Изображение не загрузилось');
  const avatar = card.querySelector('.public-project-avatar img')!;
  await act(async () => avatar.dispatchEvent(new Event('error')));
  expect(card.querySelector('.public-project-avatar')?.textContent).toBe('АК');
  expect(card.querySelector('a')?.getAttribute('href')).toBe('/#/public-projects/published');
});
