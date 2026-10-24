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

    // Signup repeats in the hero, but login stays in the header at every width.
    const headerActions = html.match(
      /<div class="public-home-header-actions"[^>]*>(.*?)<\/div>/,
    )?.[1];
    expect(headerActions).toBeDefined();
    expect(headerActions!.match(/>Войти<\/button>/g)).toHaveLength(1);
    expect(headerActions!.match(/>Создать аккаунт<\/button>/g)).toHaveLength(1);
    const menu = html.match(/<details class="public-home-mobile-menu"[^>]*>(.*?)<\/details>/)?.[1];
    expect(menu).not.toMatch(/>Войти<\/button>/);
    expect(menu).toContain('Создать аккаунт');
    const hero = html.match(/<section class="public-home-hero".*?<\/section>/)?.[0];
    expect(hero).toContain('Создать аккаунт');
    expect(hero).not.toContain('Начать создавать');
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
