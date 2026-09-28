import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { TaskBlocks } from '../../components/TaskBlocks';

describe('plain-text task block renderer', () => {
  it('preserves order, escapes markup and allows only safe link targets', () => {
    const html = renderToStaticMarkup(
      createElement(TaskBlocks, {
        blocks: [
          { type: 'heading', text: 'First' },
          { type: 'paragraph', text: '<script>alert(1)</script>' },
          { type: 'list', items: ['One', 'Two'] },
          { type: 'callout', text: 'Notice' },
          { type: 'link', text: 'Read', href: 'https://example.org/' },
          { type: 'link', text: 'Unsafe', href: 'javascript:alert(1)' },
        ],
      }),
    );
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('&lt;script&gt;'));
    expect(html.indexOf('One')).toBeLessThan(html.indexOf('Notice'));
    expect(html.indexOf('Notice')).toBeLessThan(html.indexOf('Read'));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
