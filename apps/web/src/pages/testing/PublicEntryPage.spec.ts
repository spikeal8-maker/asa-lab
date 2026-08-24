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

  it('keeps the exact sign-in label unique for browser journeys', () => {
    const html = renderToStaticMarkup(createElement(PublicEntryPage, { onChoose: vi.fn() }));

    expect(html.match(/>Войти<\/button>/g)).toHaveLength(1);
    expect(html).toContain('data-testid="entry-header-sign-up"');
    expect(html).toContain('>Зарегистрироваться</button>');
    expect(html).toContain('>Уже есть аккаунт</button>');
  });

  it('keeps projects primary without presenting blocks or drawing as future modules', () => {
    const html = renderToStaticMarkup(createElement(PublicEntryPage, { onChoose: vi.fn() }));

    expect(html).not.toMatch(/STEM-лаборатория для школы|в разработке|будущая среда|планируется/i);
    expect(html).toContain('Придумывайте. Создавайте. Проверяйте.');
    expect(html).toContain('/social/asa-lab-og.png');
    expect(html).toContain('собственного проекта');
    expect(html).toContain('Посмотреть возможности');
    expect(html).toContain('Визуальные алгоритмы');
    expect(html).toContain('Рисование и черчение');
  });
});
