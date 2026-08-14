import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChessSectionHeader } from '../../apps/web/src/chess/ChessSectionHeader';

describe('ASA Chess section header', () => {
  it('keeps internal chess pages inside the shared ASA Lab editor chrome', () => {
    const html = renderToStaticMarkup(
      createElement(ChessSectionHeader, {
        user: { id: 'user-1', displayName: 'Мария', email: 'maria@example.test' },
        title: 'Онлайн-шахматы',
        status: {
          kind: 'saved',
          label: 'Rapid 1200',
          detail: '0 подтверждённых партий',
        },
        onExit: vi.fn(),
        onHome: vi.fn(),
      }),
    );

    expect(html).toContain('ASA Lab');
    expect(html).toContain('Онлайн-шахматы');
    expect(html).toContain('<h1 class="sr-only">Онлайн-шахматы</h1>');
    expect(html).toContain('Rapid 1200');
    expect(html).toContain('Главная');
    expect(html).toContain('Пользователь Мария');
  });
});
