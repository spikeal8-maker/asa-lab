// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LessonBlock } from '../../api';
import { LessonBlocks } from '../../components/LessonBlocks';

// These tests exercise the real renderer with native resource events. Network
// requests and decoding are browser concerns, not capabilities of jsdom.
const samples = [
  {
    block: {
      id: 'image-1',
      type: 'image',
      url: '/assets/course-image.png',
      alt: 'Схема резистора',
      caption: 'Схема урока',
    },
    tag: 'img',
    label: 'Схема урока',
    failure: 'Не удалось загрузить изображение',
    success: 'load',
  },
  {
    block: {
      id: 'video-1',
      type: 'video',
      url: '/assets/course-video.mp4',
      title: 'Видео урока',
    },
    tag: 'video',
    label: 'Видео урока',
    failure: 'Не удалось загрузить видео',
    success: 'loadeddata',
  },
  {
    block: {
      id: 'audio-1',
      type: 'audio',
      url: '/assets/course-audio.mp3',
      title: 'Аудио урока',
    },
    tag: 'audio',
    label: 'Аудио урока',
    failure: 'Не удалось загрузить аудио',
    success: 'loadeddata',
  },
] as const;

const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let root: Root;
let host: HTMLDivElement;

beforeAll(() => {
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
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

afterAll(() => {
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});

async function render(blocks: readonly LessonBlock[], compact = false): Promise<void> {
  await act(async () => root.render(createElement(LessonBlocks, { blocks, compact })));
}

async function resourceEvent(element: Element, event: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new Event(event, { bubbles: false, cancelable: false }));
  });
}

function retryButton(container: Element = host): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('.lesson-media-error button');
  expect(button).not.toBeNull();
  return button!;
}

describe('Course inline media failure and explicit recovery', () => {
  const cases = [
    { context: 'compact preview', compact: true },
    { context: 'learner', compact: false },
  ].flatMap((context) => samples.map((sample) => ({ ...context, ...sample })));

  it.each(cases)(
    '$context exposes the native $tag error with accessible actions',
    async (sample) => {
      await render([sample.block], sample.compact);
      const element = host.querySelector(sample.tag)!;
      expect(element).not.toBeNull();
      expect(host.querySelector('[role="alert"]')).toBeNull();
      const nativeError = vi.fn();
      element.addEventListener('error', nativeError, { once: true });

      await resourceEvent(element, 'error');

      expect(nativeError).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(sample.failure);
      expect(host.textContent).toContain(sample.label);
      expect(host.textContent).not.toContain(sample.block.url);
      const retry = retryButton();
      expect(retry.textContent?.trim()).toBe('Повторить загрузку');
      expect(retry.type).toBe('button');
      expect(retry.disabled).toBe(false);
      retry.focus();
      expect(document.activeElement).toBe(retry);
      const open = host.querySelector<HTMLAnchorElement>('.lesson-media-error a')!;
      expect(open.textContent?.trim()).toBe('Открыть отдельно');
      expect(open.getAttribute('href')).toBe(sample.block.url);
      expect(open.target).toBe('_blank');
      expect(open.rel).toBe('noreferrer');
      expect(host.firstElementChild?.classList.contains('is-compact')).toBe(sample.compact);
    },
  );

  it.each(samples)(
    '$tag retries the same URL only on request and ignores old attempt events',
    async (sample) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
      const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
      await render([sample.block]);
      const failed = host.querySelector(sample.tag)!;
      await resourceEvent(failed, 'error');
      await resourceEvent(failed, 'error');
      expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
      expect(host.querySelector(sample.tag)).toBe(failed);
      expect(fetch).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
      const container = failed.parentElement!;

      await act(async () => retryButton().click());

      const retried = host.querySelector(sample.tag)!;
      expect(retried).not.toBe(failed);
      expect(retried.getAttribute('src')).toBe(sample.block.url);
      expect(document.activeElement).toBe(container);
      expect(container.tabIndex).toBe(-1);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(retried.hasAttribute('autoplay')).toBe(false);
      await resourceEvent(failed, 'error');
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await resourceEvent(retried, sample.success);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await resourceEvent(retried, 'error');
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(sample.failure);
      await resourceEvent(failed, sample.success);
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(sample.failure);
      await act(async () => retryButton().click());
      expect(host.querySelector(sample.tag)).not.toBe(retried);
      expect(host.querySelector(sample.tag)?.getAttribute('src')).toBe(sample.block.url);
      expect(fetch).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
      expect(load).not.toHaveBeenCalled();
    },
  );

  it.each(samples)(
    '$tag clears its failure on a current resource success event',
    async (sample) => {
      await render([sample.block]);
      const element = host.querySelector(sample.tag)!;
      await resourceEvent(element, 'error');
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      await resourceEvent(element, sample.success);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(host.querySelector(sample.tag)).toBe(element);
      expect(host.textContent).toContain(sample.label);
    },
  );

  it.each(samples)(
    '$tag resets on source or lesson block identity changes and ignores late old events',
    async (sample) => {
      await render([sample.block]);
      const oldSource = host.querySelector(sample.tag)!;
      await resourceEvent(oldSource, 'error');
      const changedSource = { ...sample.block, url: '/assets/next-lesson-resource' };
      await render([changedSource]);
      const current = host.querySelector(sample.tag)!;
      expect(current).not.toBe(oldSource);
      expect(current.getAttribute('src')).toBe(changedSource.url);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await resourceEvent(oldSource, 'error');
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await resourceEvent(current, 'error');
      await resourceEvent(oldSource, sample.success);
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(sample.failure);

      await render([{ ...changedSource, id: 'next-lesson-block' }]);
      const nextLesson = host.querySelector(sample.tag)!;
      expect(nextLesson).not.toBe(current);
      expect(nextLesson.getAttribute('src')).toBe(changedSource.url);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await resourceEvent(current, 'error');
      expect(host.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it.each(samples)(
    '$tag resets copied block state across lesson/run scopes without resetting runtime slots',
    async (sample) => {
      function Runtime({ label }: { label: string }): JSX.Element {
        const [count, setCount] = useState(0);
        return createElement(
          'button',
          { onClick: () => setCount(count + 1) },
          `${label}: ${count}`,
        );
      }
      const blocks: readonly LessonBlock[] = [
        sample.block,
        {
          id: 'activity',
          type: 'activity',
          learningActivityVersionId: '11111111-1111-4111-8111-111111111111',
        },
        {
          id: 'material',
          type: 'manual-material',
          learningActivityVersionId: '22222222-2222-4222-8222-222222222222',
        },
      ];
      async function renderScope(run: string, lesson: string): Promise<void> {
        await act(async () =>
          root.render(
            createElement(LessonBlocks, {
              blocks,
              mediaScopeKey: JSON.stringify([run, lesson]),
              renderActivity: () => createElement(Runtime, { label: 'Практика' }),
              renderMaterial: () => createElement(Runtime, { label: 'Материал' }),
            }),
          ),
        );
      }
      await renderScope('run-1', 'lesson-1');
      const runtimeButtons = [...host.querySelectorAll<HTMLButtonElement>('section button')];
      await act(async () => runtimeButtons.forEach((button) => button.click()));
      const original = host.querySelector(sample.tag)!;
      await resourceEvent(original, 'error');
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(sample.failure);

      // Duplicate lessons retain exactly the same block IDs and media URLs.
      await renderScope('run-1', 'lesson-2');
      const copiedLesson = host.querySelector(sample.tag)!;
      expect(copiedLesson).not.toBe(original);
      expect(copiedLesson.getAttribute('src')).toBe(sample.block.url);
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await resourceEvent(original, 'error');
      expect(host.querySelector('[role="alert"]')).toBeNull();
      await resourceEvent(copiedLesson, 'error');
      await resourceEvent(original, sample.success);
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(sample.failure);

      await renderScope('run-2', 'lesson-2');
      expect(host.querySelector(sample.tag)).not.toBe(copiedLesson);
      expect(host.querySelector(sample.tag)?.getAttribute('src')).toBe(sample.block.url);
      await resourceEvent(copiedLesson, 'error');
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect([...host.querySelectorAll('section button')]).toEqual(runtimeButtons);
      expect(runtimeButtons.map((button) => button.textContent)).toEqual([
        'Практика: 1',
        'Материал: 1',
      ]);
    },
  );

  it('preserves failure for an unchanged resource and resets when its media type changes', async () => {
    const image = samples[0].block;
    await render([image]);
    const original = host.querySelector('img')!;
    await resourceEvent(original, 'error');
    await render([{ ...image, alt: 'Обновлённая схема', caption: 'Новая подпись' }]);
    expect(host.querySelector('img')).toBe(original);
    expect(original.getAttribute('alt')).toBe('Обновлённая схема');
    expect(host.textContent).toContain('Новая подпись');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await render([{ id: image.id, type: 'video', url: image.url, title: 'Новый тип' }]);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('video')?.getAttribute('src')).toBe(image.url);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await resourceEvent(original, 'error');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('isolates failures and retries between multiple local blocks', async () => {
    await render(samples.map((sample) => sample.block));
    for (const sample of samples) await resourceEvent(host.querySelector(sample.tag)!, 'error');
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(3);
    const video = host.querySelector('video')!;
    const audio = host.querySelector('audio')!;
    await act(async () => retryButton(host.querySelector('img')!.parentElement!).click());
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(2);
    expect(video.parentElement?.querySelector('[role="alert"]')?.textContent).toBe(
      samples[1].failure,
    );
    expect(audio.parentElement?.querySelector('[role="alert"]')?.textContent).toBe(
      samples[2].failure,
    );
    expect(host.querySelector('video')).toBe(video);
    expect(host.querySelector('audio')).toBe(audio);
  });

  it('retains image and media attributes, hidden blocks and unrelated runtime state', async () => {
    function Runtime({ label }: { label: string }): JSX.Element {
      const [count, setCount] = useState(0);
      return createElement('button', { onClick: () => setCount(count + 1) }, `${label}: ${count}`);
    }
    const activity = {
      id: 'activity-1',
      type: 'activity',
      learningActivityVersionId: '11111111-1111-4111-8111-111111111111',
    } as const;
    const material = {
      id: 'material-1',
      type: 'manual-material',
      learningActivityVersionId: '22222222-2222-4222-8222-222222222222',
    } as const;
    const hidden = { ...samples[0].block, id: 'hidden', url: '/assets/hidden.png', hidden: true };
    const blocks = [...samples.map((sample) => sample.block), hidden, activity, material];
    await act(async () =>
      root.render(
        createElement(LessonBlocks, {
          blocks,
          renderActivity: () => createElement(Runtime, { label: 'Практика' }),
          renderMaterial: () => createElement(Runtime, { label: 'Материал' }),
        }),
      ),
    );
    const runtimeButtons = [...host.querySelectorAll<HTMLButtonElement>('section button')];
    await act(async () => runtimeButtons.forEach((button) => button.click()));
    const image = host.querySelector('img')!;
    expect(host.querySelectorAll('img')).toHaveLength(1);
    expect(image.getAttribute('alt')).toBe(samples[0].block.alt);
    expect(image.getAttribute('loading')).toBe('lazy');
    await resourceEvent(image, 'error');
    await act(async () => retryButton().click());
    expect(host.querySelector('img')?.getAttribute('alt')).toBe(samples[0].block.alt);
    expect(host.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    for (const tag of ['video', 'audio']) {
      const media = host.querySelector(tag)!;
      expect(media.hasAttribute('controls')).toBe(true);
      expect(media.getAttribute('preload')).toBe('metadata');
      expect(media.hasAttribute('autoplay')).toBe(false);
    }
    expect(host.querySelector('[data-block-id="activity-1"] button')?.textContent).toBe(
      'Практика: 1',
    );
    expect(host.querySelector('[data-block-id="material-1"] button')?.textContent).toBe(
      'Материал: 1',
    );
    expect([...host.querySelectorAll('section button')]).toEqual(runtimeButtons);
  });

  it('does not retain a failed hidden lesson block when it is shown again', async () => {
    const block = samples[0].block;
    await render([block]);
    const old = host.querySelector('img')!;
    await resourceEvent(old, 'error');
    await render([{ ...block, hidden: true }]);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await render([block]);
    expect(host.querySelector('img')).not.toBe(old);
    await resourceEvent(old, 'error');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('preserves the local embedding boundary and file navigation without availability claims', async () => {
    const blocks = [
      { ...samples[0].block, id: 'external-image', url: 'https://example.invalid/image.png' },
      { ...samples[1].block, id: 'external-video', url: 'https://example.invalid/video.mp4' },
      { ...samples[2].block, id: 'external-audio', url: 'https://example.invalid/audio.mp3' },
      { ...samples[0].block, id: 'protocol-relative-image', url: '//example.invalid/image.png' },
      { ...samples[2].block, id: 'non-asset-audio', url: '/api/private/audio.mp3' },
      { ...samples[0].block, id: 'traversal', url: '/assets/../private.png' },
      {
        id: 'external-file',
        type: 'file',
        url: 'https://example.invalid/file.pdf',
        label: 'Внешний PDF',
      },
      { id: 'local-file', type: 'file', url: '/assets/course-file.pdf', label: 'Материал урока' },
    ] as const;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await render(blocks);
    expect(host.querySelectorAll('img,video,audio')).toHaveLength(0);
    const links = [...host.querySelectorAll<HTMLAnchorElement>('a')];
    expect(links).toHaveLength(blocks.length);
    links.forEach((link, index) => {
      expect(link.getAttribute('href')).toBe(blocks[index].url);
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noreferrer');
    });
    expect(host.textContent).toContain('Внешний PDF');
    expect(host.textContent).toContain('Материал урока');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
