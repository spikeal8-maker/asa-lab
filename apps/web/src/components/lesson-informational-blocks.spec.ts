import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LessonBlock } from '../api';
import { LessonBlockEditor, createLessonBlock, lessonBlocksValid } from './LessonBlockEditor';
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
      createElement(LessonBlockEditor, { blocks, onChange: () => undefined }),
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
