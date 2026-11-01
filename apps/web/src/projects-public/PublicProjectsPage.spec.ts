// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PublicProjectListView } from '../creator-portal/navigation';
import { PublicProjectsPage } from './PublicProjectsPage';
import { publicProjectsApi, type PublicProject } from './api';

let host: HTMLDivElement;
let root: Root;
const onView = vi.fn();
const onOpen = vi.fn();
const work: PublicProject = {
  publicationId: 'published',
  revisionId: 'revision',
  revisionNo: 1,
  versionNo: 1,
  title: 'Схема автора',
  summary: null,
  description: null,
  tags: [],
  license: 'reserved',
  moduleKey: 'electronics',
  authorLabel: 'Автор проекта',
  featured: true,
  pinned: true,
  likeCount: 7,
  copyCount: 3,
  publishedAt: '2026-10-30T00:00:00Z',
  preview: null,
  capabilities: { viewer: 'static', canCopy: false, downloadFormats: [] },
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(publicProjectsApi, 'list').mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [work], nextOffset: null },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
async function render(view: PublicProjectListView) {
  await act(async () => root.render(createElement(PublicProjectsPage, { view, onView, onOpen })));
}
function category(name: string) {
  return [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Среда проекта"] button')].find(
    (button) => button.textContent?.trim() === name,
  )!;
}
it('exposes real module chips and retains the committed search when switching categories', async () => {
  await render({ kind: 'public-projects', search: 'лампа', module: 'electronics' });
  expect(category('Электроника').getAttribute('aria-pressed')).toBe('true');
  await act(async () => category('3D-моделирование').click());
  expect(onView).toHaveBeenLastCalledWith({
    kind: 'public-projects',
    search: 'лампа',
    module: 'three-d',
  });
  expect(publicProjectsApi.list).toHaveBeenCalledWith({ search: 'лампа', module: 'electronics' });
});
it('shows an unknown URL category honestly and allows returning to all without dropping search', async () => {
  await render({ kind: 'public-projects', search: 'схема', module: 'future-module' });
  expect(category('future-module').getAttribute('aria-pressed')).toBe('true');
  await act(async () => category('Все').click());
  expect(onView).toHaveBeenLastCalledWith({ kind: 'public-projects', search: 'схема' });
});
it('submits the current search value while preserving module filtering', async () => {
  await render({ kind: 'public-projects', search: '  лампа  ', module: 'electronics' });
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(onView).toHaveBeenLastCalledWith({
    kind: 'public-projects',
    search: 'лампа',
    module: 'electronics',
  });
  const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(submit.getAttribute('aria-label')).toBe('Найти');
});
it('keeps immutable card navigation, actual likes and editorial metadata without invented totals', async () => {
  await render({ kind: 'public-projects' });
  const card = host.querySelector<HTMLAnchorElement>('.public-project-card-link')!;
  expect(card.getAttribute('href')).toBe('/#/public-projects/published');
  expect(card.querySelector('[aria-label="7 нравится"]')).not.toBeNull();
  expect(card.querySelector('[data-testid="public-project-featured"]')).not.toBeNull();
  expect(card.querySelector('[data-testid="public-project-pinned"]')).not.toBeNull();
  expect(host.querySelector('.public-projects-results')?.textContent).toContain('Показано 1');
  expect(host.textContent).not.toMatch(/просмотров|комментариев|ремиксов/);
  await act(async () => card.click());
  expect(onOpen).toHaveBeenCalledWith('published');
});

it('places identity and real likes on the preview, with a separate title overlay', async () => {
  await render({ kind: 'public-projects' });
  const cover = host.querySelector('.public-project-card-cover')!;
  expect(cover.querySelector('.public-project-author')?.textContent).toBe(work.authorLabel);
  expect(cover.querySelector('.public-project-avatar')?.getAttribute('aria-hidden')).toBe('true');
  expect(cover.querySelector('.public-project-card-identity')?.getAttribute('title')).toBe(
    work.authorLabel,
  );
  expect(cover.querySelector('[aria-label="7 нравится"]')).not.toBeNull();
  expect(cover.querySelector('[aria-label="3 добавлений в свои проекты"]')).not.toBeNull();
  expect(cover.querySelector('time')?.getAttribute('datetime')).toBe(work.publishedAt);
  const footer = host.querySelector('.public-project-card-body')!;
  expect(footer.children).toHaveLength(1);
  expect(footer.querySelector('h2')?.getAttribute('title')).toBe(work.title);
  expect(footer.querySelector('.public-project-author, time')).toBeNull();
  expect(host.textContent).not.toMatch(/скачиваний|загрузок/);
});

it('does not fabricate a count when an older server omits copy statistics', async () => {
  const legacy = { ...work };
  Reflect.deleteProperty(legacy, 'copyCount');
  vi.mocked(publicProjectsApi.list).mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [legacy], nextOffset: null },
  });
  await render({ kind: 'public-projects' });
  expect(host.querySelector('[title="Добавили к себе"]')).toBeNull();
});

it('shows the real author avatar, keeps initials on failure and ignores stale games filters', async () => {
  vi.mocked(publicProjectsApi.list).mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          ...work,
          authorLabel: 'Анна Петрова',
          authorAvatarUrl: '/api/public-projects/published/author-avatar',
        },
      ],
      nextOffset: null,
    },
  });
  await render({ kind: 'public-projects', module: 'chess' });
  expect(publicProjectsApi.list).toHaveBeenLastCalledWith({});
  expect(category('Шахматы')).toBeUndefined();
  expect(category('Шашки')).toBeUndefined();
  const avatar = host.querySelector('.public-project-avatar img')!;
  expect(avatar.getAttribute('src')).toBe('/api/public-projects/published/author-avatar');
  expect(host.querySelector('.public-project-author')?.textContent).toBe('Анна Петрова');
  await act(async () => avatar.dispatchEvent(new Event('error')));
  expect(host.querySelector('.public-project-avatar')?.textContent).toBe('АП');
});
