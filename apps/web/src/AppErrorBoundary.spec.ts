import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

describe('application error boundary', () => {
  it('renders the application normally before an error', () => {
    const markup = renderToStaticMarkup(
      createElement(AppErrorBoundary, null, createElement('p', null, 'working')),
    );
    expect(markup).toContain('working');
  });

  it('shows a bounded recovery screen without exposing the error message', () => {
    const boundary = new AppErrorBoundary({ children: null });
    boundary.state = { failed: true };
    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain('ASA Lab не удалось открыть');
    expect(html).toContain('Обновить страницу');
    expect(html).not.toContain('token');
  });
});
