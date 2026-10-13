// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type AuthoredActivityLearnerPreview, type LessonBlock } from '../api';
import {
  LessonBlockEditor,
  MAX_LESSON_BLOCKS,
  createLessonBlock,
  deleteLessonBlock,
  duplicateLessonBlock,
  insertLessonBlock,
  lessonBlocksValid,
  moveLessonBlock,
  setLessonActivityVersion,
  setLessonBlockHidden,
} from './LessonBlockEditor';
import { LessonBlocks } from './LessonBlocks';

const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let root: Root | null = null;
let container: HTMLDivElement | null = null;
beforeAll(() => {
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  reactGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
function ControlledEditor({
  blocks: initial,
  onChange,
}: {
  readonly blocks: LessonBlock[];
  readonly onChange: (value: LessonBlock[]) => void;
}) {
  const [blocks, setBlocks] = useState(initial);
  return createElement(LessonBlockEditor, {
    blocks,
    activities: [],
    onChange: (value) => {
      setBlocks(value);
      onChange(value);
    },
  });
}
async function mountEditor(blocks: LessonBlock[], onChange = vi.fn()) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(ControlledEditor, { blocks, onChange }));
    await flush();
  });
  return onChange;
}
function button(label: string, scope: HTMLElement = container!) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error('Missing button: ' + label);
  return found;
}
const pinnedVersion = '33333333-3333-4333-8333-333333333333';
const currentVersion = '11111111-1111-4111-8111-111111111111';
function exactPreview(
  id: string,
  versionNumber: number,
  title: string,
): AuthoredActivityLearnerPreview {
  return {
    source: { kind: 'published', id, versionNumber, draftRevision: null, contentDigest: id },
    assignment: {
      title,
      goal: 'Точная цель ' + versionNumber,
      brief: 'Точное содержание ' + versionNumber,
      blocks: [{ type: 'paragraph', text: 'Точное содержание ' + versionNumber }],
      sampleImage: null,
    },
    moduleKey: 'electronics',
    resultMode: 'completion',
    maxPoints: null,
    policies: {},
    learnerRuntime: false,
  };
}
function mockCanonicalRoots() {
  vi.spyOn(api, 'authoredActivities').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          id: 'own-published',
          title: 'Название источника v3',
          kind: 'project',
          draftRevision: 4,
          currentPublishedVersionId: currentVersion,
        },
        {
          id: 'own-draft',
          title: 'Черновая практика',
          kind: 'project',
          draftRevision: 1,
          currentPublishedVersionId: null,
        },
        {
          id: 'own-manual',
          title: 'Обычный материал',
          kind: 'manual',
          draftRevision: 1,
          currentPublishedVersionId: '44444444-4444-4444-8444-444444444444',
        },
      ],
    },
  });
  vi.spyOn(api, 'authorVersions').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        { id: pinnedVersion, versionNumber: 2 },
        { id: currentVersion, versionNumber: 3 },
      ],
    },
  });
  vi.spyOn(api, 'listModules').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      items: [
        {
          moduleKey: 'electronics',
          moduleVersion: '1',
          displayName: 'Электроника',
          shortDescription: 'Электрические схемы',
          defaultProjectTitlePrefix: 'Схема',
          projectType: 'schematic',
          schemaVersion: 1,
          editorRoute: 'electronics',
          viewerRoute: 'electronics',
          safeModeSupported: true,
          availability: 'active',
          previewKind: 'schematic',
          iconKey: 'electronics',
          categories: [],
          creatable: true,
          learningCapabilities: {
            assignable: true,
            editableEvidence: true,
            submitProjectVersion: true,
            preview: 'snapshot',
          },
        },
      ],
    },
  });
}

describe('informational lesson blocks', () => {
  it('creates the four canonical block payloads used by the editor', () => {
    expect(createLessonBlock('code')).toMatchObject({ type: 'code', text: '' });
    expect(createLessonBlock('formula')).toMatchObject({ type: 'formula', text: '' });
    expect(createLessonBlock('table')).toMatchObject({ type: 'table', rows: [['']] });

    const divider = createLessonBlock('divider');
    expect(divider).toMatchObject({ type: 'divider' });
    expect('text' in divider).toBe(false);
  });

  it('keeps existing add, settings, move and delete controls as native editor controls', () => {
    const blocks: LessonBlock[] = [
      { id: 'heading', type: 'heading', text: 'Heading', level: 2 },
      { id: 'callout', type: 'callout', text: 'Callout', tone: 'tip' },
      { id: 'code', type: 'code', text: 'const x = 1;', language: 'javascript' },
      {
        id: 'image',
        type: 'image',
        url: '/assets/example.png',
        alt: 'Example',
        caption: 'Caption',
      },
      { id: 'table', type: 'table', rows: [['A', 'B']] },
    ];
    const markup = renderToStaticMarkup(
      createElement(LessonBlockEditor, { blocks, activities: [], onChange: () => undefined }),
    );

    expect(markup).toContain('aria-label="Поднять блок 1"');
    expect(markup).toContain('aria-label="Опустить блок 1"');
    expect(markup).toContain('aria-label="Удалить блок 1"');
    expect(markup).toContain('aria-label="Уровень заголовка"');
    expect(markup).toContain('aria-label="Тип врезки"');
    expect(markup).toContain('aria-label="Язык кода"');
    expect(markup).toContain('aria-label="Описание изображения"');
    expect(markup).toContain('+ Строка');
    expect(markup).toContain('+ Добавить содержимое');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('role="menu"');
    expect(markup).not.toContain('+ Текст');
    expect(markup).toContain('type="button"');
  });

  it('duplicates all 12 block kinds with new ids and exact settings', () => {
    const blocks: LessonBlock[] = [
      { id: 'paragraph', type: 'paragraph', text: 'Paragraph' },
      { id: 'heading', type: 'heading', text: 'Heading', level: 3 },
      { id: 'callout', type: 'callout', text: 'Tip', tone: 'warning' },
      {
        id: 'image',
        type: 'image',
        url: '/assets/image.png',
        alt: 'Alt',
        caption: 'Caption',
      },
      { id: 'video', type: 'video', url: '/assets/video.mp4', title: 'Video' },
      { id: 'audio', type: 'audio', url: '/assets/audio.mp3', title: 'Audio' },
      { id: 'file', type: 'file', url: 'https://example.test/file.pdf', label: 'File' },
      {
        id: 'table',
        type: 'table',
        rows: [
          ['A', 'B'],
          ['1', '2'],
        ],
      },
      { id: 'formula', type: 'formula', text: 'U = I × R' },
      { id: 'code', type: 'code', text: 'const x = 1;', language: 'typescript' },
      { id: 'divider', type: 'divider' },
      {
        id: 'activity',
        type: 'activity',
        learningActivityVersionId: '11111111-1111-4111-8111-111111111111',
      },
    ];

    for (const source of blocks) {
      const duplicated = duplicateLessonBlock([source], source.id);
      expect(duplicated).toHaveLength(2);
      const copy = duplicated[1] as LessonBlock;
      expect(copy.id).not.toBe(source.id);
      expect({ ...copy, id: source.id }).toEqual(source);
    }
  });

  it('deep-copies table rows instead of sharing nested arrays', () => {
    const source: LessonBlock = {
      id: 'table',
      type: 'table',
      rows: [
        ['A', 'B'],
        ['1', '2'],
      ],
    };
    const duplicated = duplicateLessonBlock([source], source.id);
    const copy = duplicated[1];
    expect(copy?.type).toBe('table');
    if (!copy || copy.type !== 'table') throw new Error('table duplicate missing');
    copy.rows[0]![0] = 'changed';
    expect(source.rows[0]![0]).toBe('A');
  });

  it('hides and shows an Activity block without changing its id or exact version', () => {
    const source: LessonBlock = {
      id: 'activity-1',
      type: 'activity',
      learningActivityVersionId: '11111111-1111-4111-8111-111111111111',
    };
    const hidden = setLessonBlockHidden([source], source.id, true);
    expect(hidden[0]).toMatchObject({
      id: 'activity-1',
      hidden: true,
      learningActivityVersionId: source.learningActivityVersionId,
    });
    const shown = setLessonBlockHidden(hidden, source.id, false);
    expect(shown[0]).toMatchObject({
      id: 'activity-1',
      hidden: false,
      learningActivityVersionId: source.learningActivityVersionId,
    });
  });

  it('inserts canonical defaults directly above and below the selected block', () => {
    const source: LessonBlock = { id: 'source', type: 'paragraph', text: 'Source' };
    const above = insertLessonBlock([source], source.id, 'before', 'divider');
    expect(above).toHaveLength(2);
    expect(above[0]).toMatchObject({ type: 'divider', hidden: false });
    expect(above[0]?.id).not.toBe(source.id);
    expect(above[1]?.id).toBe(source.id);

    const below = insertLessonBlock([source], source.id, 'after', 'code');
    expect(below[0]?.id).toBe(source.id);
    expect(below[1]).toMatchObject({ type: 'code', text: '', hidden: false });
  });

  it('creates an invalid empty Activity block and accepts a selected published UUID', () => {
    const empty = createLessonBlock('activity');
    expect(empty).toMatchObject({
      type: 'activity',
      learningActivityVersionId: '',
      hidden: false,
    });
    expect(lessonBlocksValid([empty])).toBe(false);

    const selected = setLessonActivityVersion(
      [empty],
      empty.id,
      '11111111-1111-4111-8111-111111111111',
    );
    expect(selected[0]).toMatchObject({
      id: empty.id,
      type: 'activity',
      learningActivityVersionId: '11111111-1111-4111-8111-111111111111',
    });
    expect(lessonBlocksValid(selected)).toBe(true);
  });

  it('changes the exact Activity version while keeping the persistent block id', () => {
    const source: LessonBlock = {
      id: 'activity-version',
      type: 'activity',
      learningActivityVersionId: '11111111-1111-4111-8111-111111111111',
      hidden: false,
    };
    const changed = setLessonActivityVersion(
      [source],
      source.id,
      '22222222-2222-4222-8222-222222222222',
    );
    expect(changed[0]).toEqual({
      ...source,
      learningActivityVersionId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('opens the single native add-content menu and closes it after adding text', async () => {
    const original: LessonBlock = { id: 'existing', type: 'paragraph', text: 'Original' };
    const change = await mountEditor([original]);
    const trigger = button('+ Добавить содержимое');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(container!.querySelector('[role="menu"]')).toBeNull();
    await act(async () => trigger.click());
    const menu = container!.querySelector<HTMLElement>('[role="menu"]')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(menu.getAttribute('aria-label')).toBe('Добавить содержимое урока');
    expect(button('+ Текст', menu).getAttribute('role')).toBe('menuitem');
    expect(button('+ Практика', menu).getAttribute('role')).toBe('menuitem');
    expect(
      [...menu.querySelectorAll('[role="menuitem"]')].every((item) => item.tagName === 'BUTTON'),
    ).toBe(true);
    await act(async () => button('+ Текст', menu).click());
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.calls[0]?.[0]).toEqual([
      original,
      expect.objectContaining({ type: 'paragraph', text: '' }),
    ]);
    expect(container!.querySelector('[role="menu"]')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('preserves a historical pin, excludes drafts/manuals and selects only server-confirmed canonical metadata', async () => {
    mockCanonicalRoots();
    let resolve!: (value: Awaited<ReturnType<typeof api.previewAuthoredActivityVersion>>) => void;
    const read = vi
      .spyOn(api, 'previewAuthoredActivityVersion')
      .mockImplementation(async (_rootId, versionId) => {
        if (versionId === pinnedVersion)
          return {
            ok: true,
            status: 200,
            data: exactPreview(pinnedVersion, 2, 'Закреплённая практика v2'),
          };
        return new Promise((done) => {
          resolve = done;
        });
      });
    const change = await mountEditor([
      { id: 'activity-pinned', type: 'activity', learningActivityVersionId: pinnedVersion },
    ]);
    expect(container!.textContent).toContain('Закреплённая практика v2');
    expect(container!.textContent).toContain('Точное содержание 2');
    expect(container!.textContent).toContain('Электроника');
    expect(read).toHaveBeenCalledWith('own-published', pinnedVersion);
    expect(change).not.toHaveBeenCalled();
    await act(async () => {
      button('Заменить практику').click();
      await flush();
    });
    const picker = container!.querySelector<HTMLElement>('[aria-label="Выбор практики"]')!;
    expect(picker.textContent).toContain('Название источника v3');
    expect(picker.textContent).not.toContain('Черновая практика');
    expect(picker.textContent).not.toContain('Обычный материал');
    await act(async () => button('Добавить', picker).click());
    expect(change).not.toHaveBeenCalled();
    expect(container!.textContent).toContain('Закреплённая практика v2');
    expect(read).toHaveBeenCalledWith('own-published', currentVersion);
    // Selection and subsequent pinned preview both require exact server reads.
    read.mockImplementation(async (_rootId, versionId) => ({
      ok: true,
      status: 200,
      data: exactPreview(versionId, 3, 'Опубликованная практика v3'),
    }));
    await act(async () => {
      resolve({
        ok: true,
        status: 200,
        data: exactPreview(currentVersion, 3, 'Опубликованная практика v3'),
      });
      await flush();
    });
    expect(api.listModules).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledTimes(1);
    expect(change.mock.calls[0]?.[0]).toEqual([
      { id: 'activity-pinned', type: 'activity', learningActivityVersionId: currentVersion },
    ]);
    expect(container!.textContent).toContain('Опубликованная практика v3');
    expect(container!.textContent).toContain('Точная цель 3');
    expect(container!.textContent).not.toContain('Закреплённая практика v2');
    expect(container!.querySelector('[aria-label="Выбор практики"]')).toBeNull();
  });

  it('keeps an unavailable historical pin unchanged and never substitutes the current version', async () => {
    mockCanonicalRoots();
    const read = vi.spyOn(api, 'previewAuthoredActivityVersion').mockResolvedValue({
      ok: true,
      status: 200,
      data: exactPreview(currentVersion, 3, 'Future content'),
    });
    const change = await mountEditor([
      { id: 'activity-pinned', type: 'activity', learningActivityVersionId: pinnedVersion },
    ]);
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain(
      'Сервер не подтвердил закреплённую версию',
    );
    expect(container!.textContent).not.toContain('Future content');
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('own-published', pinnedVersion);
    expect(change).not.toHaveBeenCalled();
  });

  it('inserts an empty Activity block above and below through generic insertion semantics', () => {
    const source: LessonBlock = { id: 'source-activity-insert', type: 'paragraph', text: 'Source' };
    const above = insertLessonBlock([source], source.id, 'before', 'activity');
    expect(above[0]).toMatchObject({
      type: 'activity',
      learningActivityVersionId: '',
      hidden: false,
    });
    expect(above[1]?.id).toBe(source.id);

    const below = insertLessonBlock([source], source.id, 'after', 'activity');
    expect(below[0]?.id).toBe(source.id);
    expect(below[1]).toMatchObject({
      type: 'activity',
      learningActivityVersionId: '',
      hidden: false,
    });
  });

  it('keeps existing move and delete semantics', () => {
    const blocks: LessonBlock[] = [
      { id: 'a', type: 'paragraph', text: 'A' },
      {
        id: 'b',
        type: 'activity',
        learningActivityVersionId: '11111111-1111-4111-8111-111111111111',
      },
      { id: 'c', type: 'paragraph', text: 'C' },
    ];
    expect(moveLessonBlock(blocks, 1, -1).map((block) => block.id)).toEqual(['b', 'a', 'c']);
    expect(moveLessonBlock(blocks, 1, 1).map((block) => block.id)).toEqual(['a', 'c', 'b']);
    expect(deleteLessonBlock(blocks, 'b').map((block) => block.id)).toEqual(['a', 'c']);
  });

  it('enforces the 40-block boundary for duplicate and insert', () => {
    const blocks = Array.from({ length: MAX_LESSON_BLOCKS - 1 }, (_, index): LessonBlock => ({
      id: 'p-' + index,
      type: 'paragraph',
      text: String(index),
    }));
    const forty = duplicateLessonBlock(blocks, blocks[0]!.id);
    expect(forty).toHaveLength(MAX_LESSON_BLOCKS);
    expect(duplicateLessonBlock(forty, forty[0]!.id)).toHaveLength(MAX_LESSON_BLOCKS);
    expect(insertLessonBlock(forty, forty[0]!.id, 'after', 'divider')).toHaveLength(
      MAX_LESSON_BLOCKS,
    );
  });

  it('treats missing hidden as visible and rejects a non-boolean hidden value', () => {
    expect(lessonBlocksValid([{ id: 'p', type: 'paragraph', text: 'ok' }])).toBe(true);
    expect(
      lessonBlocksValid([
        { id: 'p', type: 'paragraph', text: 'ok', hidden: 'yes' } as unknown as LessonBlock,
      ]),
    ).toBe(false);
  });

  it('renders Activity blocks in mixed lesson order and keeps hidden Activity absent', () => {
    const blocks: LessonBlock[] = [
      { id: 'intro', type: 'paragraph', text: 'Перед практикой' },
      {
        id: 'activity-a',
        type: 'activity',
        learningActivityVersionId: '11111111-1111-4111-8111-111111111111',
      },
      { id: 'note', type: 'callout', text: 'Между практиками', tone: 'note' },
      {
        id: 'activity-b',
        type: 'activity',
        learningActivityVersionId: '22222222-2222-4222-8222-222222222222',
      },
      { id: 'file', type: 'file', url: 'https://example.test/help.pdf', label: 'Памятка' },
      {
        id: 'hidden-activity',
        type: 'activity',
        learningActivityVersionId: '33333333-3333-4333-8333-333333333333',
        hidden: true,
      },
    ];
    const markup = renderToStaticMarkup(
      createElement(LessonBlocks, {
        blocks,
        renderActivity: (block) => createElement('span', null, `Runtime ${block.id}`),
      }),
    );

    const sequence = [
      'Перед практикой',
      'Runtime activity-a',
      'Между практиками',
      'Runtime activity-b',
      'Памятка',
    ].map((value) => markup.indexOf(value));
    expect(sequence.every((position) => position >= 0)).toBe(true);
    expect(sequence).toEqual([...sequence].sort((left, right) => left - right));
    expect(markup).not.toContain('Runtime hidden-activity');

    const preview = renderToStaticMarkup(
      createElement(LessonBlocks, {
        blocks: [
          {
            id: 'preview-activity',
            type: 'activity',
            learningActivityVersionId: '44444444-4444-4444-8444-444444444444',
          },
        ],
      }),
    );
    expect(preview).toContain('Практика');
    expect(preview).toContain('data-block-id="preview-activity"');
  });

  it('does not render hidden draft blocks or fall back to legacy content when blocks exist', () => {
    const blocks: LessonBlock[] = [
      { id: 'visible', type: 'paragraph', text: 'Visible block' },
      { id: 'hidden', type: 'paragraph', text: 'Hidden block', hidden: true },
    ];
    const markup = renderToStaticMarkup(
      createElement(LessonBlocks, { blocks, legacyContent: 'Legacy fallback' }),
    );
    expect(markup).toContain('Visible block');
    expect(markup).not.toContain('Hidden block');
    expect(markup).not.toContain('Legacy fallback');

    const onlyHidden = renderToStaticMarkup(
      createElement(LessonBlocks, {
        blocks: [{ id: 'hidden', type: 'paragraph', text: 'Secret', hidden: true }],
        legacyContent: 'Legacy fallback',
      }),
    );
    expect(onlyHidden).toBe('');
  });

  it('keeps table structure bounded in client validation', () => {
    expect(
      lessonBlocksValid([
        {
          id: 'table',
          type: 'table',
          rows: [
            ['A', 'B'],
            ['1', '2'],
          ],
        },
      ]),
    ).toBe(true);
    expect(
      lessonBlocksValid([
        {
          id: 'table',
          type: 'table',
          rows: Array.from({ length: 31 }, (_, index) => [String(index)]),
        },
      ]),
    ).toBe(false);
    expect(lessonBlocksValid([{ id: 'table', type: 'table', rows: [['A', 'B'], ['1']] }])).toBe(
      false,
    );
  });

  it('renders code as escaped text together with formula, table and divider', () => {
    const blocks: LessonBlock[] = [
      {
        id: 'code',
        type: 'code',
        language: 'javascript',
        text: '<script>globalThis.compromised = true</script>\n  const x = 1;',
      },
      { id: 'formula', type: 'formula', text: 'U = I × R' },
      {
        id: 'table',
        type: 'table',
        rows: [
          ['Элемент', 'Значение'],
          ['R1', '220 Ω'],
        ],
      },
      { id: 'divider', type: 'divider' },
    ];

    const markup = renderToStaticMarkup(createElement(LessonBlocks, { blocks }));

    expect(markup).toContain('&lt;script&gt;globalThis.compromised = true&lt;/script&gt;');
    expect(markup).not.toContain('<script>');
    expect(markup).toContain('  const x = 1;');
    expect(markup).toContain('U = I × R');
    expect(markup).toContain('<table');
    expect(markup).toContain('<td>220 Ω</td>');
    expect(markup).toContain('<hr');
  });
});
