import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PublicEntryPage } from '../PublicEntryPage';

describe('PublicEntryPage licensing notice', () => {
  it('offers the corresponding source from the public entry page', () => {
    const html = renderToStaticMarkup(createElement(PublicEntryPage, { onChoose: vi.fn() }));

    expect(html).toContain('Исходный код · AGPL-3.0');
    expect(html).toContain('href="https://github.com/spikeal8-maker/asa-lab"');
    // The accepted public landing predates Result A; retain both source access
    // and the actual footer licensing notice, not the superseded sentence case.
    expect(html).toContain('Код: AGPL-3.0-only · бренд и отдельные материалы защищены.');
    expect(html).toContain('src="/landing/creator-avatar.jpg"');
    expect(html).not.toMatch(/<img[^>]+src="https?:/);
  });

  it('offers unambiguous account actions within the header and a separate class-code path', () => {
    const html = renderToStaticMarkup(createElement(PublicEntryPage, { onChoose: vi.fn() }));

    // Desktop, mobile and hero legitimately repeat the same action. Result A
    // journeys select an accessible region instead of imposing page-wide uniqueness.
    const headerActions = html.match(
      /<div class="public-home-header-actions"[^>]*>(.*?)<\/div>/,
    )?.[1];
    expect(headerActions).toBeDefined();
    expect(headerActions!.match(/>Войти<\/button>/g)).toHaveLength(1);
    expect(headerActions!.match(/>Создать аккаунт<\/button>/g)).toHaveLength(1);
    expect(html).toContain('У меня есть код класса →');
  });

  it('keeps projects primary without presenting blocks or drawing as future modules', () => {
    const html = renderToStaticMarkup(createElement(PublicEntryPage, { onChoose: vi.fn() }));

    expect(html).not.toMatch(/STEM-лаборатория для школы|в разработке|будущая среда|планируется/i);
    // Check the shipped landing's project-first semantics, not obsolete hero artwork/copy.
    expect(html).toContain('Проект — центр ASA Lab');
    expect(html).toContain('Создавай. Пробуй. Делись. Улучшай.');
    expect(html).toContain('/landing/home-dashboard.png');
    expect(html).toContain('Свои проекты');
    expect(html).toContain('Виртуальная электроника');
    expect(html).toContain('3D и CAD');
    expect(html).toContain('Блочное программирование');
    expect(html).toContain('Рисование');
  });
});
