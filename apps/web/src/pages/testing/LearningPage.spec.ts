import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearningPage, learningSection } from '../LearningPage';
import { AttendedClassesPage } from '../AttendedClassesPage';

afterEach(() => vi.unstubAllGlobals());

describe('learning workspace destinations', () => {
  it.each([
    ['#/learning', 'overview'],
    ['#/learning?view=unknown', 'overview'],
    ['#/learning?assignment=work&learner=seat', 'assignments'],
    ['#/learning?courseRun=course&lesson=lesson&assignment=work', 'courses'],
    ['#/learning?journalColumn=column&journalMonth=2026-10', 'results'],
    ['#/learning?joinRequest=request', 'classes'],
    ['#/learning?learner=seat', 'classes'],
    ['#/learning?view=completed&assignment=work', 'completed'],
  ])('routes %s to %s without changing academic state', (hash, section) => {
    expect(learningSection(hash)).toBe(section);
  });

  it('embeds Account with one main, one page heading and one navigation', () => {
    vi.stubGlobal('window', { location: { hash: '#/learning?view=classes&learner=seat' } });
    const html = renderToStaticMarkup(
      createElement(LearningPage, { seat: null, onOpenProject: vi.fn() }),
    );
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/id="main-content"/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Разделы моего обучения"');
    expect(html).toContain('attend-code');
    expect(html).toContain('view=courses&amp;learner=seat');
    expect(html).not.toContain('attended-heading');
  });

  it('keeps the standalone Account class page landmark and join form', () => {
    vi.stubGlobal('window', { location: { hash: '#/classes' } });
    const html = renderToStaticMarkup(
      createElement(AttendedClassesPage, { onOpenProject: vi.fn() }),
    );
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain('>Я учусь</h1>');
    expect(html).toContain('attend-code');
    expect(html).toContain('Мои оценки по датам');
  });
});
