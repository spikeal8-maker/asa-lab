import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PublicEntryPage } from '../PublicEntryPage';

describe('PublicEntryPage licensing notice', () => {
  it('offers the corresponding source from the public entry page', () => {
    const html = renderToStaticMarkup(createElement(PublicEntryPage, { onChoose: vi.fn() }));

    expect(html).toContain('Исходный код · AGPL-3.0');
    expect(html).toContain('href="https://github.com/spikeal8-maker/asa-lab"');
    expect(html).toContain('Бренд и отдельные материалы защищены.');
  });
});
