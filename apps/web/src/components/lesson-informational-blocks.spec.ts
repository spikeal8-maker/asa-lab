import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LessonBlock } from '../api';
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
    expect(markup).toContain('+ Текст');
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

  it('renders Activity add/select controls, disables drafts and preserves a missing current pin', () => {
    const pinnedVersion = '33333333-3333-4333-8333-333333333333';
    const blocks: LessonBlock[] = [
      { id: 'activity-pinned', type: 'activity', learningActivityVersionId: pinnedVersion },
    ];
    const markup = renderToStaticMarkup(
      createElement(LessonBlockEditor, {
        blocks,
        activities: [
          {
            id: 'published',
            title: 'Опубликованная практика',
            currentPublishedVersionId: '11111111-1111-4111-8111-111111111111',
          },
          {
            id: 'draft',
            title: 'Черновая практика',
            currentPublishedVersionId: null,
          },
        ],
        onChange: () => undefined,
      }),
    );

    expect(markup).toContain('+ Практика');
    expect(markup).toContain('Выберите опубликованную активность…');
    expect(markup).toContain('Опубликованная практика');
    expect(markup).toContain('Черновая практика · черновик — сначала опубликуйте');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('Закреплённая версия');
    expect(markup).toContain(`value="${pinnedVersion}"`);
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
