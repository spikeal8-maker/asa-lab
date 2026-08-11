import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChessEditorHeader, chessAvatarText } from '../ChessEditorHeader';

describe('Chess editor header adapter', () => {
  it('maps the three panels, three actions, status and user primitives', () => {
    const html = renderToStaticMarkup(
      createElement(ChessEditorHeader, {
        projectTitle: 'Испанская партия',
        persistedProjectTitle: 'Испанская партия',
        onProjectTitleChange: vi.fn(),
        onProjectTitleCommit: vi.fn(),
        saveStatus: 'saving',
        statusDetail: 'Игра с ASA Bot',
        busy: false,
        onBack: vi.fn(),
        onNewGame: vi.fn(),
        onCheckpoint: vi.fn(),
        onSave: vi.fn(),
        userDisplayName: 'Анна Иванова',
      }),
    );

    expect(html).toContain('data-module-id="chess"');
    expect(html).not.toContain('Панель шахматного проекта');
    expect(html).toContain('>Новая</span>');
    expect(html).toContain('>Версия</span>');
    expect(html).toContain('>Сохранить</span>');
    expect(html).toContain('aria-label="Сохранение…: Игра с ASA Bot"');
    expect(html).toContain('aria-label="Пользователь Анна Иванова"');
    expect(html).toContain('>АИ</span>');
  });

  it('disables Version and Save while busy but keeps New available', () => {
    const html = renderToStaticMarkup(
      createElement(ChessEditorHeader, {
        projectTitle: 'Проект',
        persistedProjectTitle: 'Проект',
        onProjectTitleChange: vi.fn(),
        onProjectTitleCommit: vi.fn(),
        saveStatus: 'saved',
        statusDetail: 'Анализ',
        busy: true,
        onBack: vi.fn(),
        onNewGame: vi.fn(),
        onCheckpoint: vi.fn(),
        onSave: vi.fn(),
        userDisplayName: 'Иван',
      }),
    );
    const newButton = html.match(/<button[^>]*>\s*<span>Новая<\/span><\/button>/)?.[0] ?? '';
    const versionButton = html.match(/<button[^>]*>\s*<span>Версия<\/span><\/button>/)?.[0] ?? '';
    const saveButton = html.match(/<button[^>]*>\s*<span>Сохранить<\/span><\/button>/)?.[0] ?? '';

    expect(newButton).not.toContain('disabled');
    expect(versionButton).toContain('disabled=""');
    expect(saveButton).toContain('disabled=""');
  });

  it('builds stable two-letter avatars from display-name primitives', () => {
    expect(chessAvatarText('Анна Иванова')).toBe('АИ');
    expect(chessAvatarText(' Magnus   Carlsen ')).toBe('MC');
    expect(chessAvatarText('')).toBe('?');
  });
});
