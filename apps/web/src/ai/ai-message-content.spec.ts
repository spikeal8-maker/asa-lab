import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiMessageContent } from './AiMessageContent';

function render(content: string): string {
  return renderToStaticMarkup(createElement(AiMessageContent, { content }));
}

afterEach(() => vi.unstubAllGlobals());

describe('AI mathematical Markdown', () => {
  it('does not download incomplete streamed code', () => {
    const html = renderToStaticMarkup(
      createElement(AiMessageContent, { content: '```html\n<!doctype html>\n```', pending: true }),
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Скачать код: index.html"/);
    expect(render('```html\n<!doctype html>\n```')).not.toContain('disabled=""');
  });
  it('renders inline and block formulae with accessible MathML', () => {
    const html = render('Энергия $E = mc^2$.\n\n$$\n\\frac{a+b}{2} = \\sqrt{x}\n$$');
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML"');
    expect(html).toContain('<mfrac>');
    expect(html).toContain('<msqrt>');
  });

  it.each([
    '$\\frac{unfinished$',
    '$\\def\\loop{\\loop}\\loop$',
    '$$\n\\frac{<script>alert(1)</script>\n$$',
  ])('keeps malformed or recursive input readable without crashing: %s', (content) => {
    const html = render(content);
    expect(html).toContain('katex-error');
    expect(html).not.toContain('<script>');
  });

  it('does not enable HTML, URLs, external images or untrusted KaTeX commands', () => {
    vi.stubGlobal('window', { location: { origin: 'https://asa.example.test' } });
    const html = render(
      '<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))\n\n' +
        '$\\href{javascript:alert(1)}{click}$\n\n' +
        '$\\includegraphics{https://outside.example.test/image.png}$\n\n' +
        '$\\htmlClass{injected}{x}$',
    );
    expect(html).not.toMatch(/<(?:img|script|iframe)\b/);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('class="injected"');
    expect(html).not.toContain('src="https://outside.example.test');
  });

  it('keeps code literal and preserves safe Markdown links and tables', () => {
    vi.stubGlobal('window', { location: { origin: 'https://asa.example.test' } });
    const html = render(
      '```js\nconst formula = "$E=mc^2$";\n```\n\n' +
        '[Guide](https://example.test/guide)\n\n| A | B |\n| - | - |\n| 1 | 2 |',
    );
    expect(html).not.toContain('class="katex"');
    expect(html).toContain('$E=mc^2$');
    expect(html).toContain('Копировать код');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('aria-label="Таблица ответа"');
  });

  it('caps user supplied math sizes', () => {
    const html = render('$\\rule{100000em}{100000em}$');
    expect(html).not.toMatch(/(?:style|width|height)="[^"]*100000em/);
    expect(html).toContain('border-right-width:8em');
  });
});
